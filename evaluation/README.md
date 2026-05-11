# Memsense Evaluation

Evaluate memsense memory system using [LoCoMo](https://github.com/snap-research/locomo) conversation datasets.

## Quick Start

```bash
# 1. Ingest conversations to memsense
uv run python ingest.py ./locomo10_small.json \
    --task memsense_test_0 \
    --user memsense_test_0 \
    --token YOUR_TOKEN \
    --mode hybrid \
    --generate-tags

# 2. Run QA evaluation
uv run python qa.py ./locomo10_small.json \
    --task memsense_test_0 \
    --user memsense_test_0 \
    --token YOUR_TOKEN \
    --overwrite \
    --parallel 1

# 3. Grade QA results with LLM judge
uv run python judge.py output/qa.memsense_test_0.jsonl \
    --base-url https://ark.cn-beijing.volces.com/api/v3 \
    --token YOUR_LLM_TOKEN \
    --model doubao-seed-2-0-mini-260215 \
    --output output/grades.json \
    --concurrency 5
```

## Workflow

### 1. Ingest - Load conversations into memsense

Saves conversation sessions directly to memsense memory API (`/v1/memory/save`).

**Usage:**
```bash
uv run python ingest.py <input.json> --task <task_name> --user <user_id> --token <token>
```

**Options:**
- `--base-url`: Memsense API URL (default: `http://127.0.0.1:8787`)
- `--sample`: Sample index to process (0-based, default: all)
- `--sessions`: Session range, e.g. `1-4` or `3` (default: all)
- `--tail`: Text appended after each conversation
- `--head`: Text prepended before each conversation
- `--mode`: Chunking mode. Use `hybrid` for the recommended session-first retrieval path, `session` for the full-session baseline, and `turn` only for turn-level ablation.
- `--generate-tags`: Generate tags using openclaw agent
- waits for embedding jobs by default before QA; use `--no-wait-embeddings` only for debugging
- `--dashboard-token`: Token used to poll `/v1/dashboard/pipeline_status` while waiting (default: `demo`)
- `--task`: Task name for output file (required)
- `--user`: User ID (required, must match QA step)

**Recommended mode:** `hybrid` writes a full session chunk plus finer turn chunks. Search returns session chunks as the prompt-visible memory and uses turn chunks only as ranking support. Keep `top_k=4` for LoCoMo runs unless you are explicitly testing a token/recall trade-off.

**Output:**
- `output/ingest.<task>.json`: Ingestion results

### 2. QA - Run question answering

Sends QA questions to the API and records responses.

**Important:** The `--user` parameter must match the user ID used in the ingest step to ensure QA questions are answered using the correct memory context.

**Usage:**
```bash
uv run python qa.py <input.json> --task <task_name> --user <user_id> --token <token>
```

**Options:**
- `--base-url`: API URL (default: `http://127.0.0.1:18789`)
- `--sample`: Sample index (0-based, default: all)
- `--count`: Number of QA questions per sample (default: all)
- `--parallel`: Number of samples to process concurrently (default: 1, max: 10)
- `--overwrite`: Remove existing `output/qa.<task>.jsonl` and summary before running, so a rerun does not silently skip answered questions.
- `--task`: Task name for output file (required)
- `--user`: User ID (required, must match ingest step)

**Output:**
- `output/qa.<task>.<sample_idx>.jsonl`: Per-sample QA results
- `output/qa.<task>.txt`: Summary with token usage

### 3. Judge - Grade QA responses

Uses LLM to grade QA responses against expected answers.

**Usage:**
```bash
uv run python judge.py <qa_results.jsonl> --output <grades.json>
```

**Options:**
- `--base-url`: LLM API URL (or set `OPENAI_BASE_URL`)
- `--token`: LLM API key (or set `OPENAI_API_KEY`)
- `--model`: Model name (default: `gpt-4o-mini`)
- `--concurrency`: Max concurrent requests (default: 5)
- `--output`: Output file path

**Output:**
```json
{
  "score": 0.85,
  "correct": 17,
  "total": 20,
  "grades": [...]
}
```

## Dataset

`locomo10_small.json` contains 1 conversation sample with:
- 4 sessions
- Multiple QA pairs per sample

Full dataset: `locomo10.json` (10 samples, 272 sessions, 5,882 messages)

## Files

- `ingest.py` - Ingest conversations to memsense
- `qa.py` - Run QA evaluation
- `judge.py` - Grade QA responses with LLM
- `judge_util.py` - Grading utilities
- `locomo10_small.json` - Small test dataset
- `locomo10.json` - Full dataset

## Acknowledgments

This evaluation framework is based on and improved from [openclaw-eval](https://github.com/ZaynJarvis/openclaw-eval). Thanks to the original authors for their work.
