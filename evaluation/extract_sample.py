#!/usr/bin/env python3
import json
import sys

input_file = '/Users/zhangruixi/code/project/memsense/evaluation/locomo10.json'
output_file = '/Users/zhangruixi/code/project/memsense/evaluation/locomo10_extracted.json'
sample_id = sys.argv[1] if len(sys.argv) > 1 else 'conv-26'

with open(input_file, 'r') as f:
    data = json.load(f)

result = [item for item in data if item.get('sample_id') == sample_id]

with open(output_file, 'w') as f:
    json.dump(result, f, indent=2, ensure_ascii=False)

print(f"Extracted sample_id='{sample_id}' to {output_file}")