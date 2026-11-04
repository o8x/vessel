#!/usr/bin/env bash
# 更新版本号、写入 CHANGELOG、提交版本 commit 并打 tag。
#
# 用法：scripts/bump.sh <version>
#   例：scripts/bump.sh 6.2.0
#
# 版本号请按 SemVer 自行判断（新功能 MINOR，修复 PATCH，破坏性变更 MAJOR）。
# 本脚本要求工作区干净，避免把业务代码混进版本 commit。
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="${1:-}"
VERSION="${VERSION#v}"

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "usage: scripts/bump.sh <major.minor.patch>" >&2
  exit 1
fi

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "working tree is not clean; commit or stash changes first" >&2
  exit 1
fi

python3 scripts/changelog.py generate "$VERSION"

python3 - "$VERSION" <<'PY'
import json
import re
import sys
from pathlib import Path

version = sys.argv[1]

pkg_path = Path('package.json')
pkg = json.loads(pkg_path.read_text(encoding='utf-8'))
pkg['version'] = version
pkg_path.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

for rel in ('docs/PRD.md', 'docs/prd/02-overview.md'):
    path = Path(rel)
    if not path.exists():
        continue
    text = path.read_text(encoding='utf-8')
    text = re.sub(r'(\| 当前版本 \| )[^|]*?( \|)', r'\g<1>' + version + r'\g<2>', text)
    text = re.sub(r'(- \*\*当前版本\*\*：)[0-9]+\.[0-9]+\.[0-9]+(。)', r'\g<1>' + version + r'\g<2>', text)
    path.write_text(text, encoding='utf-8')
PY

git add CHANGELOG.md package.json docs/PRD.md docs/prd/02-overview.md
git commit -m "Bump v$VERSION"
git tag "v$VERSION"

echo "[bump] committed and tagged v$VERSION"
