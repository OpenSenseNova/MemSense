"""
Run QA evaluation against memsense memory.

Usage:
    uv run python qa.py ./locomo10_small.json --task qa_test --user test_user --token YOUR_TOKEN
"""

import argparse
import asyncio
import json
import os
import sys
import time
import requests


def load_locomo_data(path: str, sample_index: int | None = None) -> list[dict]:
    """Load LoCoMo JSON and optionally filter to one sample."""
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if sample_index is not None:
        if sample_index < 0 or sample_index >= len(data):
            print(f"Error: sample index {sample_index} out of range (0-{len(data)-1})", file=sys.stderr)
            sys.exit(1)
        return [data[sample_index]]
    return data


def get_session_id(user: str) -> str | None:
    """Read the current session ID for the given user from sessions.json."""
    sessions_file = os.path.expanduser("~/.openclaw/agents/main/sessions/sessions.json")
    try:
        with open(sessions_file, "r") as f:
            data = json.load(f)
        key = f"agent:main:openresponses-user:{user}"
        return data.get(key, {}).get("sessionId")
    except Exception as e:
        print(f"    [reset] could not read session ID: {e}", file=sys.stderr)
        return None


def reset_session(session_id: str) -> None:
    """Archive the session .jsonl file by renaming it with a timestamp suffix."""
    sessions_dir = os.path.expanduser("~/.openclaw/agents/main/sessions")
    src = os.path.join(sessions_dir, f"{session_id}.jsonl")
    if not os.path.exists(src):
        return
    dst = f"{src}.{int(time.time())}"
    try:
        os.rename(src, dst)
        print(f"    [reset] archived {session_id}.jsonl", file=sys.stderr)
    except Exception as e:
        print(f"    [reset] error: {e}", file=sys.stderr)


def send_message(base_url: str, token: str, user: str, message: str, retries: int = 2) -> tuple[str, dict]:
    """Send message to API and return response."""
    url = f"{base_url}/v1/responses"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    }
    payload = {
        "model": "openclaw",
        "input": message,
        "stream": False,
        "user": user,
    }

    for attempt in range(retries + 1):
        try:
            resp = requests.post(url, json=payload, headers=headers, timeout=300, proxies={"http": None, "https": None})
            if not resp.ok:
                print(f"    [error] {resp.status_code}: {resp.text[:200]}", file=sys.stderr)
            resp.raise_for_status()
            body = resp.json()

            # Extract response text
            response_text = ""
            for item in body.get("output", []):
                if item.get("type") == "message":
                    for content in item.get("content", []):
                        if content.get("type") == "output_text":
                            response_text = content.get("text", "")
                            break

            usage = body.get("usage", {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0})

            # Detect abnormally long responses
            if usage.get("output_tokens", 0) > 4000:
                print(f"    [warning] Abnormally long response: {usage.get('output_tokens')} tokens", file=sys.stderr)

            return response_text, usage
        except Exception as e:
            if attempt < retries:
                print(f"    [retry {attempt + 1}/{retries}] {e}", file=sys.stderr)
                time.sleep(0.5)
            else:
                raise
    raise RuntimeError(f"Failed after {retries + 1} attempts")


async def run_sample_qa(item: dict, sample_idx: int, args: argparse.Namespace, semaphore: asyncio.Semaphore) -> list[dict]:
    """Process QA for a single sample."""
    sample_id = item["sample_id"]
    user_key = args.user or f"eval-{sample_idx}"
    qas = [q for q in item.get("qa", []) if str(q.get("category", "")) != "5"]

    if args.count is not None:
        qas = qas[:args.count]

    # Load existing answers
    jsonl_path = f"output/qa.{args.task}.jsonl"
    existing = set()
    try:
        with open(jsonl_path, "r", encoding="utf-8") as f:
            for line in f:
                rec = json.loads(line)
                existing.add(rec["question"])
    except FileNotFoundError:
        pass

    records = []

    async with semaphore:
        print(f"\n=== Sample {sample_id} [{sample_idx}] (user={user_key}) ===", file=sys.stderr)
        print(f"    Running {len(qas)} QA question(s), {len(existing)} already answered...", file=sys.stderr)

        for qi, qa in enumerate(qas, start=1):
            question = qa["question"]
            expected = str(qa["answer"])
            category = qa.get("category", "")
            evidence = qa.get("evidence", [])

            if question in existing:
                print(f"  [{sample_idx}] Q{qi}/{len(qas)}: SKIP (already answered)", file=sys.stderr)
                continue

            print(f"  [{sample_idx}] Q{qi}/{len(qas)}: {question[:60]}{'...' if len(question) > 60 else ''}", file=sys.stderr)

            # Retry up to 3 times if error response detected
            max_retries = 1
            response = None
            usage = {}

            for retry_attempt in range(max_retries):
                try:
                    response, usage = await asyncio.to_thread(
                        send_message,
                        args.base_url, args.token, user_key, question,
                    )

                    # Check for error patterns
                    if (response == "LLM request timed out." or
                        "custom-api-claude-codecmd-com (claude-opus-4-5) returned a billing error" in response or
                        "[ERROR] HTTPConnectionPool(host='127.0.0.1'" in response or
                        "The AI service is temporarily overloaded." in response or
                        "Unauthorized - Invalid token" in response or
                        "503 no healthy upstream" in response or
                        "分组 CC-aws-high 下模型 claude-opus-4-5 无可用渠道" in response):

                        if retry_attempt < max_retries - 1:
                            print(f"  [{sample_idx}]   Error detected, retrying ({retry_attempt + 1}/{max_retries})...", file=sys.stderr)
                            await asyncio.sleep(0.5)
                            continue
                        else:
                            print(f"  [{sample_idx}]   Max retries reached, skipping question", file=sys.stderr)
                            response = None
                            break

                    print(f"  [{sample_idx}]   A: {response[:60]}{'...' if len(response) > 60 else ''}", file=sys.stderr)
                    print(f"  [{sample_idx}]   tokens: in={usage.get('input_tokens',0)} out={usage.get('output_tokens',0)}", file=sys.stderr)
                    break

                except Exception as e:
                    if retry_attempt < max_retries - 1:
                        print(f"  [{sample_idx}]   Exception: {e}, retrying ({retry_attempt + 1}/{max_retries})...", file=sys.stderr)
                        await asyncio.sleep(0.5)
                    else:
                        print(f"  [{sample_idx}]   Max retries reached after exception, skipping question", file=sys.stderr)
                        response = None
                        break

            # Skip saving if response is None (failed after retries)
            if response is None:
                continue

            record = {
                "sample_id": sample_id,
                "sample_idx": sample_idx,
                "qi": qi,
                "question": question,
                "expected": expected,
                "response": response,
                "category": category,
                "evidence": evidence,
                "usage": usage,
            }
            records.append(record)

            # Save immediately
            with open(jsonl_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")

            # Reset session to prevent history accumulation
            session_id = get_session_id(user_key)
            if session_id:
                reset_session(session_id)

    return records


def main():
    parser = argparse.ArgumentParser(description="Run QA evaluation")
    parser.add_argument("input", help="Path to LoCoMo JSON file")
    parser.add_argument("--base-url", default="http://127.0.0.1:8899", help="API base URL")
    parser.add_argument("--token", required=True, help="Auth token")
    parser.add_argument("--sample", type=int, default=None, help="Sample index (0-based)")
    parser.add_argument("--count", type=int, default=None, help="Number of QA questions to run")
    parser.add_argument("--user", default=None, help="User ID")
    parser.add_argument("--parallel", "-p", type=int, default=1, help="Number of samples to process concurrently")
    parser.add_argument("--task", required=True, help="Task name for output file")
    parser.add_argument("--overwrite", action="store_true", help="Remove existing output/qa.<task> files before running")

    args = parser.parse_args()

    if args.overwrite:
        for path in (f"output/qa.{args.task}.jsonl", f"output/qa.{args.task}.txt"):
            try:
                os.remove(path)
                print(f"    removed existing {path}", file=sys.stderr)
            except FileNotFoundError:
                pass

    samples = load_locomo_data(args.input, args.sample)
    parallel = min(args.parallel, 10)

    print(f"    user: {args.user}", file=sys.stderr)
    print(f"    parallel: {parallel}", file=sys.stderr)

    async def _run():
        semaphore = asyncio.Semaphore(parallel)
        tasks = [
            run_sample_qa(item, idx + 1, args, semaphore)
            for idx, item in enumerate(samples)
        ]
        return await asyncio.gather(*tasks)

    results_list = asyncio.run(_run())

    # Calculate total usage from saved files
    total_usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
    for idx, item in enumerate(samples):
        sample_idx = idx + 1
        jsonl_path = f"output/qa.{args.task}.jsonl"
        try:
            with open(jsonl_path, "r", encoding="utf-8") as f:
                for line in f:
                    rec = json.loads(line)
                    usage = rec.get("usage", {})
                    for k in total_usage:
                        total_usage[k] += usage.get(k, 0)
        except FileNotFoundError:
            pass

    print(f"\n    total tokens: in={total_usage['input_tokens']} out={total_usage['output_tokens']} total={total_usage['total_tokens']}", file=sys.stderr)

    # Save summary
    summary_path = f"output/qa.{args.task}.txt"
    with open(summary_path, "w", encoding="utf-8") as f:
        f.write("=== TOTAL USAGE ===\n")
        f.write(f"input_tokens: {total_usage['input_tokens']}\n")
        f.write(f"output_tokens: {total_usage['output_tokens']}\n")
        f.write(f"total_tokens: {total_usage['total_tokens']}\n")
    print(f"Summary written to {summary_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
