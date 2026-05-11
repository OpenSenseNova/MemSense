"""
Grade OpenClaw QA responses using LLM judge.

Usage:
    uv run python judge.py output/answers.txt.json
    uv run python judge.py output/answers.txt.json --output output/grades.json
    uv run python judge.py output/qa.memsense_test_2.jsonl \
        --base-url https://ark.cn-beijing.volces.com/api/v3 \
        --token "" \
        --model deepseek-v3-2-251201 \
        --output output/grades.json \
        --concurrency 5
    # 新增：指定并发数
    uv run python judge.py output/answers.txt.json --concurrency 5 --output output/grades.json
"""

import argparse
import asyncio
import json
import sys
from typing import List, Dict, Any

from judge_util import grade_answers, load_answers

# 默认并发数（可根据API限流调整，建议5-10）
DEFAULT_CONCURRENCY = 5

# 新增：带并发限制的批量评分函数（封装原grade_answers）
async def grade_answers_with_concurrency(
    answers: List[Dict[str, Any]],
    base_url: str | None = None,
    api_key: str | None = None,
    model: str = "gpt-4o-mini",
    concurrency: int = DEFAULT_CONCURRENCY
) -> List[Dict[str, Any]]:
    """
    带并发限制的批量评分函数
    :param answers: 待评分的答案列表
    :param base_url: LLM API基础地址
    :param api_key: LLM API密钥
    :param model: 评分使用的模型
    :param concurrency: 最大并发数
    :return: 评分后的结果列表
    """
    # 创建信号量，限制并发数
    semaphore = asyncio.Semaphore(concurrency)
    
    # 加载环境变量并创建OpenAI客户端（复用原逻辑）
    from judge_util import AsyncOpenAI, load_dotenv, os
    load_dotenv()
    client = AsyncOpenAI(
        base_url=base_url or os.getenv("OPENAI_BASE_URL"),
        api_key=api_key or os.getenv("OPENAI_API_KEY"),
    )

    # 定义带信号量的单条评分函数
    async def grade_single(item: Dict[str, Any]) -> bool:
        async with semaphore:  # 关键：获取信号量，达到上限时等待
            from judge_util import locomo_grader
            return await locomo_grader(
                client,
                model,
                item["question"],
                item["expected"],
                item["response"],
            )

    # 创建所有任务（每个任务都通过信号量控制）
    tasks = [grade_single(item) for item in answers]
    
    # 执行所有任务并收集结果
    results = await asyncio.gather(*tasks)

    # 组装最终结果（和原grade_answers逻辑一致）
    graded = []
    for item, is_correct in zip(answers, results):
        graded.append({**item, "grade": is_correct})

    return graded

async def run(
    input_path: str,
    output_path: str | None,
    base_url: str | None,
    token: str | None,
    model: str,
    concurrency: int = DEFAULT_CONCURRENCY
) -> None:
    answers = load_answers(input_path)
    print(f"Loaded {len(answers)} answers from {input_path}", file=sys.stderr)
    print(f"Grading with concurrency limit: {concurrency}", file=sys.stderr)

    # 使用带并发限制的评分函数
    graded = await grade_answers_with_concurrency(
        answers, 
        base_url=base_url, 
        api_key=token, 
        model=model,
        concurrency=concurrency
    )

    correct = sum(1 for g in graded if g["grade"])
    total = len(graded)
    score = correct / total if total > 0 else 0.0

    print(f"\nResults: {correct}/{total} correct ({score:.2%})")

    # Per-category breakdown if categories exist
    categories = {}
    for g in graded:
        cat = g.get("category", "unknown")
        categories.setdefault(cat, {"correct": 0, "total": 0})
        categories[cat]["total"] += 1
        if g["grade"]:
            categories[cat]["correct"] += 1

    if len(categories) > 1:
        print("\nPer-category scores:")
        for cat in sorted(categories):
            c = categories[cat]
            pct = c["correct"] / c["total"] if c["total"] > 0 else 0.0
            print(f"  Category {cat}: {c['correct']}/{c['total']} ({pct:.2%})")

    if output_path:
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(
                {"score": score, "correct": correct, "total": total, "grades": graded},
                f,
                indent=2,
                ensure_ascii=False,
            )
        print(f"\nGrades written to {output_path}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description="Grade QA responses with LLM judge")
    parser.add_argument("input", help="Path to answers JSON file")
    parser.add_argument("--output", default=None, help="Path to write grades JSON")
    parser.add_argument(
        "--base-url",
        default=None,
        help="LLM API base URL (or set OPENAI_BASE_URL env var)",
    )
    parser.add_argument(
        "--token",
        default=None,
        help="LLM API key (or set OPENAI_API_KEY env var)",
    )
    parser.add_argument(
        "--model",
        default="gpt-4o-mini",
        help="Model name for grading (default: gpt-4o-mini)",
    )
    # 新增：并发数参数
    parser.add_argument(
        "--concurrency",
        type=int,
        default=DEFAULT_CONCURRENCY,
        help=f"Max concurrent API requests (default: {DEFAULT_CONCURRENCY})",
    )
    args = parser.parse_args()

    asyncio.run(run(
        args.input, 
        args.output, 
        args.base_url, 
        args.token, 
        args.model,
        args.concurrency
    ))


if __name__ == "__main__":
    main()
