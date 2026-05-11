"""
Ingest conversations directly to memsense memory API.

Usage:
    uv run python ingest.py ./locomo10_small.json --task memory_test --user test_user --token YOUR_TOKEN
"""

import argparse
import json
import os
import sys
import time
import subprocess
from datetime import datetime
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


def build_turn_pairs(messages: list[dict]) -> list[tuple[str, str]]:
    """Group consecutive same-speaker messages then pair adjacent groups.

    Returns list of (user_text, assistant_text) tuples. Each pair represents
    one round-trip exchange. A trailing single-speaker group is preserved with
    an empty assistant side so turn-mode ingest does not lose facts.

    First speaker becomes "user", responder becomes "assistant". Speaker role
    can flip if conversation starts the other way around — that's fine, what
    matters for QAQ is that next chunk's user_text is the same-session
    follow-up, which `saveChunk`'s reverse back-fill handles via session_id.
    """
    if not messages:
        return []

    groups: list[tuple[str, list[str]]] = []
    for msg in messages:
        speaker = msg.get("speaker", "")
        formatted = format_locomo_message(msg)
        if groups and groups[-1][0] == speaker:
            groups[-1][1].append(formatted)
        else:
            groups.append((speaker, [formatted]))

    pairs: list[tuple[str, str]] = []
    i = 0
    while i + 1 < len(groups):
        _, msgs_a = groups[i]
        _, msgs_b = groups[i + 1]
        user_text = "\n".join(msgs_a).strip()
        asst_text = "\n".join(msgs_b).strip()
        if user_text and asst_text:
            pairs.append((user_text, asst_text))
        i += 2

    if i < len(groups):
        _, trailing_msgs = groups[i]
        user_text = "\n".join(trailing_msgs).strip()
        if user_text:
            pairs.append((user_text, ""))

    return pairs


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
    speaker_a = conv["speaker_a"]
    speaker_b = conv["speaker_b"]
    speakers = f"{speaker_a} & {speaker_b}"

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

        header = f"[group chat conversation: {date_time}]"
        parts = []
        parts_a = []
        parts_b = []
        if head:
            parts.append(head)
            parts_a.append(head)
            parts_b.append(head)
        parts.append(header)
        parts_a.append(header)
        parts_b.append(header)
        for msg in conv[sk]:
            formatted = format_locomo_message(msg)
            parts.append(formatted)
            speaker = msg.get("speaker", "")
            if speaker == speaker_a:
                parts_a.append(formatted)
            elif speaker == speaker_b:
                parts_b.append(formatted)
            else:
                parts_a.append(formatted)
                parts_b.append(formatted)
        if tail:
            parts.append(tail)
            parts_a.append(tail)
            parts_b.append(tail)
        combined = "\n\n".join(parts)

        sessions.append({
            "message": combined,
            "speaker_a_text": "\n\n".join(parts_a),
            "speaker_b_text": "\n\n".join(parts_b),
            "turn_pairs": build_turn_pairs(conv[sk]),
            "meta": {
                "sample_id": item["sample_id"],
                "session_key": sk,
                "date_time": date_time,
                "speakers": speakers,
                "speaker_a": speaker_a,
                "speaker_b": speaker_b,
            },
        })

    return sessions


def _extract_json_object(text: str) -> dict | None:
    """Extract the outermost JSON object from *text*, handling nested braces."""
    # Try markdown code fence first
    import re
    fence = re.search(r'```(?:json)?\s*(\{[\s\S]*\})\s*```', text)
    if fence:
        try:
            return json.loads(fence.group(1))
        except json.JSONDecodeError:
            pass

    # Greedy brace-matching: find outermost { … }
    start = text.find('{')
    if start == -1:
        return None
    depth = 0
    for i in range(start, len(text)):
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start:i + 1])
                except json.JSONDecodeError:
                    break
    return None


def _extract_json_array(text: str) -> list | None:
    """Extract the outermost JSON array from *text*."""
    start = text.find('[')
    if start == -1:
        return None
    depth = 0
    for i in range(start, len(text)):
        if text[i] == '[':
            depth += 1
        elif text[i] == ']':
            depth -= 1
            if depth == 0:
                try:
                    arr = json.loads(text[start:i + 1])
                    if isinstance(arr, list):
                        return arr
                except json.JSONDecodeError:
                    break
    return None


def _parse_tagger_output(raw_text: str) -> dict | None:
    """Try to parse tagger JSON from LLM output. Returns None on failure."""
    # Direct parse
    try:
        v = json.loads(raw_text)
        if isinstance(v, dict) and ("tags" in v or "memory_kind" in v):
            return v
        if isinstance(v, list):
            return {"tags": v, "memory_kind": "episodic", "summary": None}
    except json.JSONDecodeError:
        pass

    # Extract from wrapper (openclaw envelope)
    try:
        envelope = json.loads(raw_text)
        inner = envelope.get('result', {}).get('payloads', [{}])[0].get('text', '')
        if inner:
            return _parse_tagger_output(inner)
    except (json.JSONDecodeError, AttributeError, IndexError, TypeError):
        pass

    obj = _extract_json_object(raw_text)
    if obj and ("tags" in obj or "memory_kind" in obj):
        return obj

    arr = _extract_json_array(raw_text)
    if arr:
        return {"tags": arr, "memory_kind": "episodic", "summary": None}

    return None


TAG_RETRY_LIMIT = int(os.environ.get("MEMSENSE_TAG_RETRY", "3"))


def generate_tags_with_openclaw(content: str) -> dict:
    """Generate tags using openclaw agent, retrying on parse failure."""
    prompt = f"""You are a background memory tagger. Return JSON only.
Task: generate up to 8 concise tags, one memory_kind, a brief summary, and optional facets for this content.
memory_kind must be exactly one of: stable, preference, episodic, ephemeral.
Choose stable for long-lived facts or durable identity/preferences; preference for user preferences that can evolve over time; episodic for notable events/decisions/context; ephemeral for very short-lived instructions or temporary state.
Tags rules: lowercase, short noun/verb phrases, no punctuation noise, no duplicate synonyms.
Summary: one or two concise sentences (max 200 chars) capturing core topic and intent. Adapt to content: for events, include key 5W elements (who, what, when, where, why) as relevant; for documents or scientific information, distill the main finding or thesis like an abstract. Keep it factual and clear.
Facets (optional): extract only the facet types that are explicitly present in the content.
  - personal_info: concrete facts about the user (name, location, job, age, relationships, etc.)
  - preferences: user likes/dislikes, habits, preferred tools, communication style, etc.
  - events: specific dated or time-bound occurrences, actions taken, or decisions made.
Omit a facet key entirely if no relevant content exists. Keep each facet value concise (max 200 chars).
Output format: {{"memory_kind": "preference", "tags": ["tag1", "tag2"], "summary": "brief summary", "facets": {{"personal_info": "...", "preferences": "...", "events": "..."}}}}

Input:
{content}"""

    last_error = None
    for attempt in range(TAG_RETRY_LIMIT):
        try:
            result = subprocess.run(
                ['openclaw', 'agent', '--session-id', 'memsense-tagger', '--message', prompt, '--json', '--timeout', '90'],
                capture_output=True, text=True, timeout=95
            )
            if result.returncode != 0:
                last_error = f"openclaw exit {result.returncode}: {result.stderr[:100]}"
                print(f"      [tag-warn] attempt {attempt+1}/{TAG_RETRY_LIMIT} failed: {last_error}", file=sys.stderr)
                continue

            parsed = _parse_tagger_output(result.stdout)
            if parsed and parsed.get("tags"):
                return {
                    "tags": parsed.get("tags", [])[:8],
                    "memory_kind": parsed.get("memory_kind", "episodic"),
                    "summary": parsed.get("summary", None),
                    "facets": parsed.get("facets") or {},
                }

            last_error = "JSON parse failed or empty tags"
            print(f"      [tag-warn] attempt {attempt+1}/{TAG_RETRY_LIMIT}: {last_error} (raw: {result.stdout[:120]}…)", file=sys.stderr)
        except Exception as e:
            last_error = str(e)[:120]
            print(f"      [tag-warn] attempt {attempt+1}/{TAG_RETRY_LIMIT} exception: {last_error}", file=sys.stderr)

    print(f"      [tag-error] all {TAG_RETRY_LIMIT} attempts exhausted – {last_error}", file=sys.stderr)
    return {"tags": [], "memory_kind": "episodic", "summary": None, "facets": {}}


def _parse_locomo_datetime(dt_str: str) -> int | None:
    """Parse LoCoMo date like '1:56 pm on 8 May, 2023' into epoch ms."""
    if not dt_str:
        return None
    try:
        return int(datetime.strptime(dt_str, "%I:%M %p on %d %B, %Y").timestamp() * 1000)
    except (ValueError, TypeError):
        return None


def _pipeline_metric(data: dict, section_key: str, metric_key: str) -> int:
    for section in data.get("sections", []):
        if section.get("key") == section_key:
            return int(section.get("metrics", {}).get(metric_key, 0) or 0)
    return 0


def wait_for_embedding_jobs(base_url: str, dashboard_token: str = "", timeout_s: int = 900) -> bool:
    """Wait until embedding jobs are drained so QA sees a complete vector index."""
    url = f"{base_url}/v1/dashboard/pipeline_status"
    headers = {}
    if dashboard_token:
        headers["x-memsense-token"] = dashboard_token

    deadline = time.time() + timeout_s
    last_report = 0.0
    while time.time() < deadline:
        try:
            resp = requests.get(url, headers=headers, timeout=10, proxies={"http": None, "https": None})
            if resp.status_code in (401, 403):
                print("    [wait-warn] dashboard token rejected; skip embedding wait", file=sys.stderr)
                return False
            resp.raise_for_status()
            body = resp.json()
            data = body.get("data", {}) if body.get("ok") else {}
            pending = _pipeline_metric(data, "embedding_jobs", "pending")
            running = _pipeline_metric(data, "embedding_jobs", "running")
            failed = _pipeline_metric(data, "embedding_jobs", "failed")
            now = time.time()
            if pending == 0 and running == 0:
                if failed:
                    print(f"    [wait-warn] embedding jobs drained with failed={failed}", file=sys.stderr)
                else:
                    print("    [wait] embedding jobs drained", file=sys.stderr)
                return True
            if now - last_report >= 10:
                print(f"    [wait] embedding jobs pending={pending} running={running} failed={failed}", file=sys.stderr)
                last_report = now
        except Exception as e:
            print(f"    [wait-warn] could not poll pipeline status: {str(e)[:120]}", file=sys.stderr)
            return False
        time.sleep(2)

    print(f"    [wait-warn] embedding jobs did not drain within {timeout_s}s", file=sys.stderr)
    return False


def _extract_speaker_lines(text: str, speaker_name: str) -> str:
    """Extract lines belonging to a specific speaker from conversation text."""
    result = []
    capturing = False
    for line in text.split("\n"):
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith(f"{speaker_name}:"):
            capturing = True
            result.append(stripped)
        elif ":" in stripped and not stripped.startswith("[") and not stripped.startswith("http"):
            capturing = False
        elif capturing:
            result.append(stripped)
        elif stripped.startswith("["):
            result.append(stripped)
    return "\n".join(result)


def _apply_tag_data_to_payload(payload: dict, tag_data: dict) -> None:
    payload["tags"] = tag_data.get("tags", [])
    payload["task_tag"] = tag_data.get("summary")
    if tag_data.get("memory_kind"):
        payload["memory_kind"] = tag_data["memory_kind"]
    payload["skip_tag_job"] = True

    facets = tag_data.get("facets") or {}
    if facets.get("personal_info"):
        payload["facet_personal_info"] = facets["personal_info"]
    if facets.get("preferences"):
        payload["facet_preferences"] = facets["preferences"]
    if facets.get("events"):
        payload["facet_events"] = facets["events"]


def _print_tag_data(tag_data: dict) -> None:
    print(f"      [tags] {tag_data.get('tags', [])}", file=sys.stderr)
    if tag_data.get("summary"):
        print(f"      [summary] {tag_data['summary']}", file=sys.stderr)
    facets = tag_data.get("facets") or {}
    if facets:
        print(f"      [facets] {list(facets.keys())}", file=sys.stderr)


def save_to_memsense(base_url: str, content: str, user_key: str, session_key: str,
                     token: str = None, generate_tags: bool = False, max_chunk_size: int = 4000,
                     speaker_a_text: str = "", speaker_b_text: str = "",
                     date_time: str = "", speaker_b_name: str = "",
                     source: str = "eval_ingest_session",
                     precomputed_tag_data: dict | None = None) -> list[dict]:
    """Save content to memsense API, splitting into chunks if needed."""
    url = f"{base_url}/v1/memory/save"
    chunks = []

    if len(content) <= max_chunk_size:
        chunks = [(content, speaker_a_text, speaker_b_text)]
    else:
        parts = content.split("\n\n")
        current_chunk = ""
        for part in parts:
            if len(current_chunk) + len(part) + 2 <= max_chunk_size:
                current_chunk += ("\n\n" if current_chunk else "") + part
            else:
                if current_chunk:
                    b_chunk = _extract_speaker_lines(current_chunk, speaker_b_name) if speaker_b_name else ""
                    chunks.append((current_chunk, "", b_chunk))
                current_chunk = part
        if current_chunk:
            b_chunk = _extract_speaker_lines(current_chunk, speaker_b_name) if speaker_b_name else ""
            chunks.append((current_chunk, "", b_chunk))

    conv_ts = _parse_locomo_datetime(date_time)
    timestamp = conv_ts if conv_ts else int(time.time() * 1000)

    saved = []
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    for i, chunk_tuple in enumerate(chunks):
        chunk_text, a_text, b_text = chunk_tuple
        user_text = chunk_text
        asst_text = b_text if b_text else chunk_text
        qa_content = json.dumps({"user": user_text, "assistant": asst_text})
        payload = {
            "tenant_id": "default",
            "scope": "user",
            "session_id": f"agent:main:openresponses-user:{user_key}:{session_key}",
            "user_id": user_key,
            "content": qa_content,
            "type_hint": "qa_chunk",
            "source": source,
            "timestamp": timestamp,
        }

        if generate_tags or precomputed_tag_data:
            tag_data = precomputed_tag_data if precomputed_tag_data else generate_tags_with_openclaw(chunk_text)
            _apply_tag_data_to_payload(payload, tag_data)
            _print_tag_data(tag_data)
        resp = requests.post(url, json=payload, headers=headers, timeout=30, proxies={"http": None, "https": None})
        if not resp.ok:
            error_text = resp.text[:200]
            raise RuntimeError(f"API error {resp.status_code}: {error_text}")
        result = resp.json()
        if not result.get("ok"):
            raise RuntimeError(result.get("error", "save failed"))
        saved.append({"chunk_index": i, "data": result.get("data")})
    return saved


def save_one_turn(base_url: str, user_text: str, asst_text: str, user_key: str,
                  session_key: str, token: str = None, generate_tags: bool = False,
                  date_time: str = "", tag_context: str = "",
                  precomputed_tag_data: dict | None = None,
                  source: str = "eval_ingest_turn") -> dict:
    """Save a single turn pair as one chunk.

    Uses per-session session_id (`...:{session_key}`) so reverse back-fill in
    `saveChunk` only links chunks within the same conversation, not across
    sessions on different days.

    tag_context: if provided, passed to the server-side tag worker as the text
    to generate tags/facets from. Use the full session text so the tag worker
    has enough context to produce meaningful facets even for short turns.
    """
    url = f"{base_url}/v1/memory/save"
    conv_ts = _parse_locomo_datetime(date_time)
    timestamp = conv_ts if conv_ts else int(time.time() * 1000)

    dated_user_text = user_text
    if date_time:
        dated_user_text = f"[group chat conversation: {date_time}]\n{user_text}"
    qa_content = json.dumps({"user": dated_user_text, "assistant": asst_text})
    payload = {
        "tenant_id": "default",
        "scope": "user",
        "session_id": f"agent:main:openresponses-user:{user_key}:{session_key}",
        "user_id": user_key,
        "content": qa_content,
        "type_hint": "qa_chunk",
        "source": source,
        "timestamp": timestamp,
    }

    if tag_context:
        payload["tag_context"] = tag_context

    if generate_tags or precomputed_tag_data:
        tag_data = precomputed_tag_data if precomputed_tag_data else \
            generate_tags_with_openclaw(tag_context if tag_context else f"{user_text}\n{asst_text}")
        _apply_tag_data_to_payload(payload, tag_data)
        _print_tag_data(tag_data)

    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    resp = requests.post(url, json=payload, headers=headers, timeout=30, proxies={"http": None, "https": None})
    if not resp.ok:
        raise RuntimeError(f"API error {resp.status_code}: {resp.text[:200]}")
    result = resp.json()
    if not result.get("ok"):
        raise RuntimeError(result.get("error", "save failed"))
    return result.get("data")


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
    parser.add_argument("--mode", choices=["hybrid", "session", "turn"], default="hybrid",
                        help="Chunking granularity: 'hybrid' (default, session chunks plus turn support), "
                             "'session' (full-session baseline), or 'turn' (turn-only ablation)")
    parser.add_argument("--no-wait-embeddings", action="store_true",
                        help="Do not wait for embedding jobs to drain after ingest")
    parser.add_argument("--wait-timeout", type=int, default=900,
                        help="Max seconds to wait for embedding jobs (default: 900)")
    parser.add_argument("--dashboard-token", default=os.environ.get("MEMSENSE_DASHBOARD_TOKEN", "demo"),
                        help="Dashboard token for polling pipeline status (default: env MEMSENSE_DASHBOARD_TOKEN or demo)")

    args = parser.parse_args()

    session_range = parse_session_range(args.sessions) if args.sessions else None
    samples = load_locomo_data(args.input, args.sample)
    results = []

    for item in samples:
        sample_id = item["sample_id"]
        sessions = build_session_messages(item, session_range, tail=args.tail, head=args.head)

        print(f"\n=== Sample {sample_id} ===", file=sys.stderr)
        print(f"    user: {args.user}", file=sys.stderr)
        print(f"    mode: {args.mode}", file=sys.stderr)
        print(f"    {len(sessions)} session(s) to ingest", file=sys.stderr)

        for sess in sessions:
            meta = sess["meta"]
            label = f"{meta['session_key']} ({meta['date_time']})"

            if args.mode in ("turn", "hybrid"):
                turn_pairs = sess.get("turn_pairs", [])
                if args.mode == "turn":
                    print(f"  [{label}] {len(turn_pairs)} turn pair(s)", file=sys.stderr)

                # 每个 session 只调一次 tagger（用完整 session 文本），结果复用给所有 turns
                session_tag_data = None
                if args.generate_tags and (turn_pairs or args.mode == "hybrid"):
                    print(f"    [tags] tagging session {meta['session_key']}...", file=sys.stderr)
                    session_tag_data = generate_tags_with_openclaw(sess["message"])

                if args.mode == "hybrid":
                    msg = sess["message"]
                    preview = msg.replace("\n", " | ")[:80]
                    print(f"  [{label}] hybrid: session + {len(turn_pairs)} turn pair(s)", file=sys.stderr)
                    print(f"    session preview: {preview}...", file=sys.stderr)
                    try:
                        saved_session = save_to_memsense(
                            args.base_url, msg, args.user, meta["session_key"], args.token,
                            generate_tags=False,
                            speaker_a_text=sess.get("speaker_a_text", ""),
                            speaker_b_text=sess.get("speaker_b_text", ""),
                            date_time=meta.get("date_time", ""),
                            speaker_b_name=meta.get("speaker_b", ""),
                            source="eval_ingest_session",
                            precomputed_tag_data=session_tag_data,
                        )
                    except Exception as e:
                        print(f"    -> [session-error] {e}", file=sys.stderr)
                        saved_session = []

                saved_turns = []
                for u_text, a_text in turn_pairs:
                    try:
                        data = save_one_turn(
                            args.base_url, u_text, a_text, args.user, meta["session_key"],
                            args.token,
                            generate_tags=False,
                            date_time=meta.get("date_time", ""),
                            tag_context=sess["message"],
                            precomputed_tag_data=session_tag_data,
                            source="eval_ingest_turn",
                        )
                        saved_turns.append({"chunk_index": len(saved_turns), "data": data})
                    except Exception as e:
                        print(f"    -> [turn-error] {e}", file=sys.stderr)

                if args.mode == "hybrid":
                    print(f"    -> saved {len(saved_session)} session chunk(s), {len(saved_turns)} turn chunk(s)", file=sys.stderr)
                    results.append({
                        "sample_id": sample_id,
                        "session": meta["session_key"],
                        "user": args.user,
                        "mode": args.mode,
                        "status": "success" if saved_session else "error",
                        "chunks_count": len(saved_session) + len(saved_turns),
                        "session_chunks_count": len(saved_session),
                        "turn_chunks_count": len(saved_turns),
                        "session_chunks": saved_session,
                        "turn_chunks": saved_turns,
                    })
                    continue

                print(f"    -> saved {len(saved_turns)} turn chunk(s)", file=sys.stderr)
                results.append({
                    "sample_id": sample_id,
                    "session": meta["session_key"],
                    "user": args.user,
                    "mode": args.mode,
                    "status": "success" if saved_turns else "error",
                    "chunks_count": len(saved_turns),
                    "chunks": saved_turns,
                })
                continue

            # legacy session-level mode
            msg = sess["message"]
            preview = msg.replace("\n", " | ")[:80]
            print(f"  [{label}] {preview}...", file=sys.stderr)
            try:
                saved = save_to_memsense(
                    args.base_url, msg, args.user, meta["session_key"], args.token, args.generate_tags,
                    speaker_a_text=sess.get("speaker_a_text", ""),
                    speaker_b_text=sess.get("speaker_b_text", ""),
                    date_time=meta.get("date_time", ""),
                    speaker_b_name=meta.get("speaker_b", ""),
                    source="eval_ingest_session",
                )
                print(f"    -> saved {len(saved)} chunk(s)", file=sys.stderr)
                results.append({
                    "sample_id": sample_id,
                    "session": meta["session_key"],
                    "user": args.user,
                    "mode": args.mode,
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
                    "mode": args.mode,
                    "status": "error",
                    "error": str(e),
                })

    if args.task:
        output_path = f"output/ingest.{args.task}.json"
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2, ensure_ascii=False)
        print(f"\nResults written to {output_path}", file=sys.stderr)

    if not args.no_wait_embeddings:
        print("\n[wait] waiting for embedding jobs before QA...", file=sys.stderr)
        wait_for_embedding_jobs(args.base_url, args.dashboard_token, args.wait_timeout)

    sessions_dir = os.path.expanduser("~/.openclaw/agents/main/sessions")
    if os.path.isdir(sessions_dir):
        cleared = 0
        for entry in os.listdir(sessions_dir):
            fp = os.path.join(sessions_dir, entry)
            if os.path.isfile(fp):
                os.remove(fp)
                cleared += 1
        print(f"\n[cleanup] cleared {cleared} file(s) from {sessions_dir}", file=sys.stderr)

if __name__ == "__main__":
    main()
