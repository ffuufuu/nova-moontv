#!/usr/bin/env bash
# 品牌 / 版本号重刷：上游合并后把「属于我们的东西」强制还原，避免被上游覆盖。
# 用法：bash sync/restamp.sh [--check]
#   --check 只检查不修改

set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT" || exit 1

CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

FILES="src/lib/version.ts VERSION.txt package.json"

echo "== 版本与品牌文件 =="
for f in $FILES; do
  if [ ! -f "$f" ]; then
    echo "  $f 缺失"
    continue
  fi
  if [ "$CHECK" = "1" ]; then
    if git diff --quiet main -- "$f" 2>/dev/null; then
      echo "  $f 正常"
    else
      echo "  $f 与 main 不一致，需要重刷"
    fi
  else
    git checkout main -- "$f" 2>/dev/null && echo "  已还原 $f"
  fi
done

echo "== 当前版本号 =="
grep -o "CURRENT_VERSION = '[^']*'" src/lib/version.ts 2>/dev/null || echo "  version.ts 读取失败"
cat VERSION.txt 2>/dev/null | sed 's/^/  VERSION.txt: /'
grep -m1 '"version"' package.json 2>/dev/null | sed 's/^/  package.json: /'

echo "== 品牌残留检查（不应出现上游品牌）=="
HITS=$(grep -rl "MoonTV" src/app/login src/components/UserMenu.tsx src/app/layout.tsx 2>/dev/null || true)
if [ -n "$HITS" ]; then
  echo "  发现残留，请核对："
  echo "$HITS" | sed 's/^/    /'
else
  echo "  关键界面无上游品牌残留"
fi

echo "== 完成 =="
