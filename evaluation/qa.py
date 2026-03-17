"""
Run QA evaluation against memsense memory.

Usage:
    uv run python qa.py ./locomo10_small.json --task qa_test --user test_user --token YOUR_TOKEN
"""

import argparse
import asyncio
import json
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
            resp = requests.post(url, json=payload, headers=headers, timeout=300)
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
            return response_text, usage
        except Exception as e:
            if attempt < retries:
                print(f"    [retry {attempt + 1}/{retries}] {e}", file=sys.stderr)
                time.sleep(1)
            else:
                raise
    raise RuntimeError(f"Failed after {retries + 1} attempts")


async def run_sample_qa(item: dict, sample_idx: int, args: argparse.Namespace, semaphore: asyncio.Semaphore) -> tuple[list[dict], dict]:
    """Process QA for a single sample."""
    sample_id = item["sample_id"]
    user_key = args.user or f"eval-{sample_idx}"
    qas = [q for q in item.get("qa", []) if str(q.get("category", "")) != "5"]

    if args.count is not None:
        qas = qas[:args.count]

    sample_usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
    records = []

    async with semaphore:
        print(f"\n=== Sample {sample_id} [{sample_idx}] (user={user_key}) ===", file=sys.stderr)
        print(f"    Running {len(qas)} QA question(s)...", file=sys.stderr)

        for qi, qa in enumerate(qas, start=1):
            question = qa["question"]
            expected = str(qa["answer"])
            category = qa.get("category", "")
            evidence = qa.get("evidence", [])

            print(f"  [{sample_idx}] Q{qi}/{len(qas)}: {question[:60]}{'...' if len(question) > 60 else ''}", file=sys.stderr)

            try:
                response, usage = await asyncio.to_thread(
                    send_message,
                    args.base_url, args.token, user_key, question,
                )
                print(f"  [{sample_idx}]   A: {response[:60]}{'...' if len(response) > 60 else ''}", file=sys.stderr)
                print(f"  [{sample_idx}]   tokens: in={usage.get('input_tokens',0)} out={usage.get('output_tokens',0)}", file=sys.stderr)
                for k in sample_usage:
                    sample_usage[k] += usage.get(k, 0)
            except Exception as e:
                response = f"[ERROR] {e}"
                usage = {}
                print(f"  [{sample_idx}]   A: {response}", file=sys.stderr)

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

    return records, sample_usage


def main():
    parser = argparse.ArgumentParser(description="Run QA evaluation")
    parser.add_argument("input", help="Path to LoCoMo JSON file")
    parser.add_argument("--base-url", default="http://127.0.0.1:18789", help="API base URL")
    parser.add_argument("--token", required=True, help="Auth token")
    parser.add_argument("--sample", type=int, default=None, help="Sample index (0-based)")
    parser.add_argument("--count", type=int, default=None, help="Number of QA questions to run")
    parser.add_argument("--user", default=None, help="User ID")
    parser.add_argument("--parallel", "-p", type=int, default=1, help="Number of samples to process concurrently")
    parser.add_argument("--task", required=True, help="Task name for output file")

    args = parser.parse_args()

    samples = load_locomo_data(args.input, args.sample)
    parallel = min(args.parallel, 10)

    print(f"    user: {args.user or 'eval-{sample_idx}'}", file=sys.stderr)
    print(f"    parallel: {parallel}", file=sys.stderr)

    async def _run():
        semaphore = asyncio.Semaphore(parallel)
        tasks = [
            run_sample_qa(item, idx + 1, args, semaphore)
            for idx, item in enumerate(samples)
        ]
        return await asyncio.gather(*tasks)

    results_list = asyncio.run(_run())

    total_usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
    all_records = []
    for records, sample_usage in results_list:
        all_records.extend(records)
        for k in total_usage:
            total_usage[k] += sample_usage[k]

    print(f"\n    total tokens: in={total_usage['input_tokens']} out={total_usage['output_tokens']} total={total_usage['total_tokens']}", file=sys.stderr)

    # Save individual sample results
    for records, _ in results_list:
        if records:
            sample_idx = records[0]["sample_idx"]
            jsonl_path = f"output/qa.{args.task}.{sample_idx}.jsonl"
            with open(jsonl_path, "w", encoding="utf-8") as f:
                for record in records:
                    f.write(json.dumps(record, ensure_ascii=False) + "\n")
            print(f"    [{sample_idx}] written to {jsonl_path}", file=sys.stderr)

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