#!/usr/bin/env bash
# 合并闸门：上游 auto 合完之后，先跑这个，红就别推。
# 用法（在本地 checkout 里）：
#   bash sync/verify.sh                # 只做类型检查（最快，~2 分钟）
#   bash sync/verify.sh --build        # 类型 + 完整 next build
#   BASE_URL=http://127.0.0.1:3000 SMOKE_USER=chen SMOKE_PASS=123456 \
#     bash sync/verify.sh --smoke      # 部署后对容器冒烟
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT" || exit 1

DO_BUILD=0
DO_SMOKE=0
for a in "$@"; do
  case "$a" in
    --build) DO_BUILD=1 ;;
    --smoke) DO_SMOKE=1 ;;
    --all) DO_BUILD=1; DO_SMOKE=1 ;;
    *) echo "未知参数: $a"; exit 2 ;;
  esac
done

fail() { echo "❌ $1"; exit 1; }

# ---------- 0. 环境 ----------
if command -v node >/dev/null 2>&1; then
  NODE_OK=1
else
  NODE_OK=0
fi
if [ "$NODE_OK" = "1" ]; then
  if [ ! -d node_modules ]; then
    echo "== 0/3 安装依赖（首次约 1 分钟）=="
    pnpm install --frozen-lockfile --ignore-scripts || fail "依赖安装失败"
  fi

  # ---------- 1. 类型 ----------
  echo "== 1/3 TypeScript =="
  npx tsc --noEmit -p tsconfig.json || fail "类型检查失败（这就是 CI 会挂的那条错，按行号改）"

  # ---------- 2. 构建 ----------
  if [ "$DO_BUILD" = "1" ]; then
    echo "== 2/3 next build =="
    LOG=$(mktemp)
    if ! npx next build >"$LOG" 2>&1; then
      echo "构建失败，最后 40 行："
      tail -40 "$LOG"
      echo "完整日志: $LOG"
      exit 1
    fi
    echo "构建通过（日志: $LOG）"
  else
    echo "== 2/3 跳过 next build（加 --build 打开）=="
  fi
else
  echo "== 当前环境没装 node，跳过类型/构建（请在本地 checkout 里跑）=="
fi

# ---------- 3. 冒烟 ----------
if [ "$DO_SMOKE" = "1" ]; then
  BASE=${BASE_URL:-http://127.0.0.1:3000}
  CK=$(mktemp)
  echo "== 3/3 冒烟 $BASE =="
  code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
  if [ -n "${SMOKE_USER:-}" ]; then
    L=$(code -c "$CK" -X POST "$BASE/api/login" -H 'Content-Type: application/json' \
      -d "{\"username\":\"$SMOKE_USER\",\"password\":\"$SMOKE_PASS\"}")
    echo "  login            $L"
    [ "$L" = "200" ] || fail "登录失败，后面接口没法验"
  fi
  for p in "/" "/admin" "/api/upstream/report" "/api/tvbox/config" "/api/favorites" "/api/playrecords" "/api/search?q=%E4%B8%89%E4%BD%93"; do
    C=$(code -b "$CK" "$BASE$p")
    printf '  %-28s %s\n' "$p" "$C"
    [ "$C" = "200" ] || [ "$C" = "307" ] || SMOKE_FAIL=1
  done
  [ "${SMOKE_FAIL:-0}" = "0" ] || fail "有接口非 200/307，看容器日志"
fi

echo "✅ 闸门通过"
