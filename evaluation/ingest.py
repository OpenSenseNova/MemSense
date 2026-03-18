"""
Ingest conversations directly to memsense memory API.

Usage:
    uv run python ingest.py ./locomo10_small.json --task memory_test --user test_user --token YOUR_TOKEN
"""

import argparse
import json
import sys
import time
import subprocess
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


def format_locomo_message(msg: dict) -> str:
    """Format a single LoCoMo message."""
    speaker = msg.get("speaker", "unknown")
    text = msg.get("text", "")
    line = f"{speaker}: {text}"

    img_urls = msg.get("img_url", [])
    if isinstance(img_urls, str):
        img_urls = [img_urls]
    blip = msg.get("blip_caption", "")

    if img_urls:
        for url in img_urls:
            caption = f": {blip}" if blip else ""
            line += f"\n{url}{caption}"
    elif blip:
        line += f"\n({blip})"

    return line


def parse_session_range(s: str) -> tuple[int, int]:
    """Parse '1-4' or '3' into (lo, hi) inclusive tuple."""
    if "-" in s:
        lo, hi = s.split("-", 1)
        return int(lo), int(hi)
    n = int(s)
    return n, n


def build_session_messages(item: dict, session_range: tuple[int, int] | None = None, tail: str = "", head: str = "") -> list[dict]:
    """Build bundled session messages for one LoCoMo sample."""
    conv = item["conversation"]
    speakers = f"{conv['speaker_a']} & {conv['speaker_b']}"

    session_keys = sorted(
        [k for k in conv if k.startswith("session_") and not k.endswith("_date_time")],
        key=lambda k: int(k.split("_")[1]),
    )

    sessions = []
    for sk in session_keys:
        sess_num = int(sk.split("_")[1])
        if session_range:
            lo, hi = session_range
            if sess_num < lo or sess_num > hi:
                continue

        dt_key = f"{sk}_date_time"
        date_time = conv.get(dt_key, "")

        parts = []
        if head:
            parts.append(head)
        parts.append(f"[group chat conversation: {date_time}]")
        for msg in conv[sk]:
            parts.append(format_locomo_message(msg))
        if tail:
            parts.append(tail)
        combined = "\n\n".join(parts)

        sessions.append({
            "message": combined,
            "meta": {
                "sample_id": item["sample_id"],
                "session_key": sk,
                "date_time": date_time,
                "speakers": speakers,
            },
        })

    return sessions


def generate_tags_with_openclaw(content: str) -> dict:
    """Generate tags using openclaw agent."""
    prompt = f"""You are a background memory tagger. Return JSON only.
Task: generate up to 8 concise tags, one memory_kind, and a brief summary for this content.
memory_kind must be exactly one of: stable, preference, episodic, ephemeral.
Choose stable for long-lived facts or durable identity/preferences; preference for user preferences that can evolve over time; episodic for notable events/decisions/context; ephemeral for very short-lived instructions or temporary state.
Tags rules: lowercase, short noun/verb phrases, no punctuation noise, no duplicate synonyms.
Summary: one concise sentence (max 100 chars) capturing the core topic/intent.
Output format: {{"memory_kind": "preference", "tags": ["tag1", "tag2"], "summary": "brief summary"}}

Input:
{content}"""

    try:
        result = subprocess.run(
            ['openclaw', 'agent', '--session-id', 'memsense-tagger', '--message', prompt, '--json', '--timeout', '90'],
            capture_output=True, text=True, timeout=95
        )
        if result.returncode != 0:
            print(f"      [tag-error] openclaw failed: {result.stderr[:100]}", file=sys.stderr)
            return {"tags": [], "memory_kind": "episodic", "summary": None}

        data = json.loads(result.stdout)
        text = data.get('result', {}).get('payloads', [{}])[0].get('text', '')

        # Extract JSON from markdown code block
        import re
        match = re.search(r'```json\s*(\{.*?\})\s*```', text, re.DOTALL)
        if match:
            output = json.loads(match.group(1))
        else:
            match = re.search(r'\{.*?\}', text, re.DOTALL)
            if match:
                output = json.loads(match.group(0))
            else:
                return {"tags": [], "memory_kind": "episodic", "summary": None}

        return {
            "tags": output.get("tags", [])[:8],
            "memory_kind": output.get("memory_kind", "episodic"),
            "summary": output.get("summary", None)
        }
    except Exception as e:
        print(f"      [tag-error] {str(e)[:100]}", file=sys.stderr)
        return {"tags": [], "memory_kind": "episodic", "summary": None}


def save_to_memsense(base_url: str, content: str, user_key: str, session_key: str, token: str = None, generate_tags: bool = False, max_chunk_size: int = 4000) -> list[dict]:
    """Save content to memsense API, splitting into chunks if needed."""
    url = f"{base_url}/v1/memory/save"
    chunks = []

    if len(content) <= max_chunk_size:
        chunks = [content]
    else:
        parts = content.split("\n\n")
        current_chunk = ""
        for part in parts:
            if len(current_chunk) + len(part) + 2 <= max_chunk_size:
                current_chunk += ("\n\n" if current_chunk else "") + part
            else:
                if current_chunk:
                    chunks.append(current_chunk)
                current_chunk = part
        if current_chunk:
            chunks.append(current_chunk)

    saved = []
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    for i, chunk in enumerate(chunks):
        qa_content = json.dumps({"user": chunk, "assistant": ""})
        payload = {
            "tenant_id": "default",
            "scope": "user",
            "session_id": f"agent:main:openresponses-user:{user_key}",
            "user_id": user_key,
            "content": qa_content,
            "type_hint": "qa_chunk",
            "source": "eval_ingest",
            "timestamp": int(time.time() * 1000),
        }

        if generate_tags:
            tag_data = generate_tags_with_openclaw(chunk)
            payload["tags"] = tag_data["tags"]
            payload["task_tag"] = tag_data["summary"]
            print(f"      [tags] {tag_data['tags']}", file=sys.stderr)
            if tag_data["summary"]:
                print(f"      [summary] {tag_data['summary']}", file=sys.stderr)
        resp = requests.post(url, json=payload, headers=headers, timeout=30)
        if not resp.ok:
            error_text = resp.text[:200]
            raise RuntimeError(f"API error {resp.status_code}: {error_text}")
        result = resp.json()
        if not result.get("ok"):
            raise RuntimeError(result.get("error", "save failed"))
        saved.append({"chunk_index": i, "data": result.get("data")})
    return saved


def main():
    parser = argparse.ArgumentParser(description="Ingest conversations to memsense")
    parser.add_argument("input", help="Path to LoCoMo JSON file")
    parser.add_argument("--base-url", default="http://127.0.0.1:8787", help="Memsense API base URL")
    parser.add_argument("--sample", type=int, default=None, help="Sample index (0-based)")
    parser.add_argument("--sessions", default=None, help="Session range, e.g. '1-4' or '3'")
    parser.add_argument("--tail", default="", help="Tail message appended after conversation")
    parser.add_argument("--head", default="", help="Head message prepended before conversation")
    parser.add_argument("--user", default="eval-user", help="User ID")
    parser.add_argument("--token", default=None, help="Auth token")
    parser.add_argument("--generate-tags", action="store_true", help="Generate tags using openclaw")
    parser.add_argument("--task", default=None, help="Task name for output file")

    args = parser.parse_args()

    session_range = parse_session_range(args.sessions) if args.sessions else None
    samples = load_locomo_data(args.input, args.sample)
    results = []

    for item in samples:
        sample_id = item["sample_id"]
        sessions = build_session_messages(item, session_range, tail=args.tail, head=args.head)

        print(f"\n=== Sample {sample_id} ===", file=sys.stderr)
        print(f"    user: {args.user}", file=sys.stderr)
        print(f"    {len(sessions)} session(s) to ingest", file=sys.stderr)

        for sess in sessions:
            meta = sess["meta"]
            msg = sess["message"]
            label = f"{meta['session_key']} ({meta['date_time']})"

            preview = msg.replace("\n", " | ")[:80]
            print(f"  [{label}] {preview}...", file=sys.stderr)

            try:
                saved = save_to_memsense(args.base_url, msg, args.user, meta["session_key"], args.token, args.generate_tags)
                print(f"    -> saved {len(saved)} chunk(s)", file=sys.stderr)
                results.append({
                    "sample_id": sample_id,
                    "session": meta["session_key"],
                    "user": args.user,
                    "status": "success",
                    "chunks_count": len(saved),
                    "chunks": saved,
                })
            except Exception as e:
                print(f"    -> [ERROR] {e}", file=sys.stderr)
                results.append({
                    "sample_id": sample_id,
                    "session": meta["session_key"],
                    "user": args.user,
                    "status": "error",
                    "error": str(e),
                })

    if args.task:
        output_path = f"output/ingest.{args.task}.json"
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2, ensure_ascii=False)
        print(f"\nResults written to {output_path}", file=sys.stderr)


if __name__ == "__main__":
    main()