import argparse
import json
from pathlib import Path



def process(input_file, output_file):
    with open(input_file, 'r', encoding='utf-8') as f_in, open(output_file, 'w', encoding='utf-8') as f_out:
        for line in f_in:
            data = json.loads(line)
            response = data.get('response', '')

            # 跳过包含这些错误的行
            if (response == "LLM request timed out." or
                "⚠️ custom-api-claude-codecmd-com (claude-opus-4-5) returned a billing error" in response or
                "[ERROR] HTTPConnectionPool(host='127.0.0.1'" in response or
                "The AI service is temporarily overloaded." in response or
                "Unauthorized - Invalid token" in response):
                continue

            f_out.write(line)

    print("过滤完成！")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True, help='Input JSONL file')
    args = parser.parse_args()

    input_file = args.input
    output_file = str(Path(input_file).with_suffix('')) + '.filter' + Path(input_file).suffix

    process(input_file, output_file)
