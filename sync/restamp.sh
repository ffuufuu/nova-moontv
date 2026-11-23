#!/usr/bin/env bash
# 品牌 / 版本号重刷：上游合并后把「属于我们的东西」强制还原，避免被上游覆盖。
# 版本真值唯一来源：src/lib/version.ts；VERSION.txt 与 package.json 由它派生。
# 用法：bash sync/restamp.sh [--check]
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT" || exit 1
CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

echo "== 版本真值（src/lib/version.ts）=="
V=$(grep -o "CURRENT_VERSION = '[^']*'" src/lib/version.ts 2>/dev/null | sed "s/.*'\(.*\)'/\1/")
if [ -z "${V:-}" ]; then
  echo "  ❌ 读不到 CURRENT_VERSION，停下"
  exit 1
fi
echo "  $V"

if [ "$CHECK" = "1" ]; then
  TXT=$(cat VERSION.txt 2>/dev/null || true)
  PKG=$(grep -m1 '"version"' package.json | sed 's/.*: *"\(.*\)",*/\1/')
  [ "$TXT" = "$V" ] && echo "  VERSION.txt 一致" || echo "  ❌ VERSION.txt=$TXT 与真值不一致"
  [ "$PKG" = "$V" ] && echo "  package.json 一致" || echo "  ❌ package.json=$PKG 与真值不一致"
else
  printf '%s\n' "$V" > VERSION.txt
  python3 - "$V" <<'PY'
import json, sys
v = sys.argv[1]
p = 'package.json'
d = json.load(open(p, encoding='utf-8'))
d['version'] = v
json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
open(p, 'a', encoding='utf-8').write('\n')
print('  package.json →', v)
PY
  echo "  VERSION.txt → $V"
fi

echo "== 品牌残留检查 =="
HITS=$(grep -rl "MoonTV" src/app/login src/components/UserMenu.tsx src/app/layout.tsx 2>/dev/null || true)
if [ -n "$HITS" ]; then echo "  发现残留："; echo "$HITS" | sed 's/^/    /'; else echo "  关键界面无上游品牌残留"; fi
echo "== 完成 =="
