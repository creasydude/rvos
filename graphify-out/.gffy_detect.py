import json
from graphify.detect import detect
from pathlib import Path
result = detect(Path(r'C:\Personal Files\Projects\rvos'))
Path(r'C:\Personal Files\Projects\rvos\graphify-out\.graphify_detect.json').write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
print(f'Detected {result["total_files"]} files')
print(f'skipped_sensitive={result.get("skipped_sensitive")}')
print(f'total_words={result.get("total_words")}')
print('files by type:', {k: len(v) for k, v in result.get('files', {}).items()})
