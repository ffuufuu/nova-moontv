#!/usr/bin/env bash
# 上游（mtvpls/MoonTVPlus）更新同步助手
#
# 背景：上游每次发版都把 main 重写成「一个 squash 提交」，没有可 cherry-pick 的逐条历史。
# 所以这里走「快照差分 + 三方合并 + 品牌/版本重刷」：
#   1) 只取白名单路径里的增量（默认后端/接口/播放/后台，不碰我们大改过的 UI 外壳）
#   2) git apply -3 三方合并
#   3) 合并后把品牌与版本号文件强制还原成我们自己的
#   4) 生成可读报告；有冲突就整体回滚，绝不自动动 main
#
# 用法：
#   bash sync/upstream-sync.sh                  # 检测 + 生成报告/补丁（不改代码）
#   bash sync/upstream-sync.sh --apply          # 额外尝试应用到 auto/ 分支
#   bash sync/upstream-sync.sh --old X --new Y  # 指定快照 sha
#   bash sync/upstream-sync.sh --mark X         # 合并进 main 后，把上游状态记为 X

set -uo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT" || exit 1

STATE_FILE="sync/upstream-state.json"
CONF_FILE="sync/sync-paths.conf"
PATCH_DIR="sync/patches"
REPORT_DIR="sync/reports"
RESULT_FILE="sync/reports/last-result.json"
UPSTREAM_URL="https://github.com/mtvpls/MoonTVPlus.git"

mkdir -p "$PATCH_DIR" "$REPORT_DIR"

OLD=""
NEW=""
APPLY=0
MARK=""

while [ $# -gt 0 ]; do
  case "$1" in
    --old) OLD="$2"; shift 2 ;;
    --new) NEW="$2"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    --mark) MARK="$2"; shift 2 ;;
    -h|--help) sed -n '3,16p' "$0"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 1 ;;
  esac
done

state_sha() {
  python3 - "$STATE_FILE" <<'PY'
import json, sys
try:
    print(json.load(open(sys.argv[1]))["sha"])
except Exception:
    print("")
PY
}

if [ -n "$MARK" ]; then
  python3 - "$STATE_FILE" "$MARK" <<'PY'
import json, sys
p, sha = sys.argv[1], sys.argv[2]
try:
    d = json.load(open(p))
except Exception:
    d = {}
d["sha"] = sha
json.dump(d, open(p, "w"), ensure_ascii=False, indent=2)
print("已记录上游快照:", sha)
PY
  exit 0
fi

if ! git remote | grep -q '^upstream$'; then
  git remote add upstream "$UPSTREAM_URL"
fi
if ! git fetch upstream main --force --quiet 2>/dev/null; then
  echo "抓取上游失败（网络或权限问题），本次跳过" >&2
  exit 0
fi

[ -z "$NEW" ] && NEW=$(git rev-parse upstream/main)
[ -z "$OLD" ] && OLD=$(state_sha)

if [ -z "$OLD" ]; then
  echo "本地没有上游快照记录，先把当前上游记为基线"
  bash "$0" --mark "$NEW"
  exit 0
fi

if [ "$OLD" = "$NEW" ]; then
  echo "上游无更新（${NEW:0:7}）"
  printf '{"changed":false}\n' > "$RESULT_FILE"
  exit 0
fi

SHORT=$(echo "$NEW" | cut -c1-7)
STAMP=$(date +%Y%m%d-%H%M)
PATCH="$PATCH_DIR/upstream-$SHORT.patch"
REPORT="$REPORT_DIR/upstream-$STAMP-$SHORT.md"
PATHS=$(grep -v '^#' "$CONF_FILE" 2>/dev/null | grep -v '^$' | tr '\n' ' ')

if [ -z "$PATHS" ]; then
  echo "sync/sync-paths.conf 里没有可用路径，退出" >&2
  exit 1
fi

git diff --binary "$OLD" "$NEW" -- $PATHS > "$PATCH" || true
PATCH_LINES=$(wc -l < "$PATCH" | tr -d ' ')
FILES=$(git diff --name-only "$OLD" "$NEW" -- $PATHS)
FILE_COUNT=$(printf '%s\n' "$FILES" | grep -c . || true)
TOTAL_COUNT=$(git diff --name-only "$OLD" "$NEW" | grep -c . || true)
SKIPPED=$((TOTAL_COUNT - FILE_COUNT))
STAT=$(git diff --stat "$OLD" "$NEW" -- $PATHS | tail -1)

{
  echo "# 上游更新检测报告"
  echo
  echo "- 时间：$(date '+%Y-%m-%d %H:%M:%S %z')"
  echo "- 上游 ${OLD:0:7} → ${NEW:0:7}"
  echo "- 白名单路径：$(echo $PATHS | tr ' ' '、')"
  echo "- 纳入文件 ${FILE_COUNT} 个 / 补丁 ${PATCH_LINES} 行 / 未纳入文件 ${SKIPPED} 个"
  echo "- 增量统计：${STAT:-无}"
  echo
  echo "## 纳入的文件"
  echo '```'
  printf '%s\n' "$FILES" | sed 's/^/- /'
  echo '```'
} > "$REPORT"

CLEAN="false"
BRANCH=""

if [ "$APPLY" = "1" ]; then
  BRANCH="auto/upstream-$SHORT"
  git checkout -B "$BRANCH" main --quiet
  APPLY_LOG="/tmp/upstream-apply-$SHORT.log"
  if git apply -3 --whitespace=nowarn "$PATCH" > "$APPLY_LOG" 2>&1 && ! git diff --name-only --diff-filter=U | grep -q .; then
    for f in src/lib/version.ts VERSION.txt package.json; do
      git checkout main -- "$f" 2>/dev/null || true
    done
    BRAND_HITS=$(git diff --name-only main -- | xargs -r grep -l 'MoonTV' 2>/dev/null | head -20 || true)
    # 只提交白名单路径与重刷过的文件，避免把工作区里的杂项带进提交
    git add -A -- $PATHS 2>/dev/null || true
    git add src/lib/version.ts VERSION.txt package.json 2>/dev/null || true
    git -c user.name='upstream-bot' -c user.email='upstream-bot@users.noreply.github.com' \
      commit -q -m "chore(upstream): 同步上游 ${NEW:0:7} 的增量（自动合并，待人工确认）" || true
    CLEAN="true"
    {
      echo
      echo "## 自动合并结果：干净"
      echo "- 分支：\`$BRANCH\`"
      if [ -n "${BRAND_HITS:-}" ]; then
        echo "- 注意：以下文件可能残留上游品牌名，合并前人工核对："
        echo '```'
        echo "$BRAND_HITS"
        echo '```'
      fi
      echo "- 下一步：审阅该分支，通过后合并到 main 并 \`bash sync/upstream-sync.sh --mark $NEW\`"
    } >> "$REPORT"
  else
    {
      echo
      echo "## 自动合并结果：有冲突（已整体回滚，未改动 main）"
      echo '```'
      grep -E 'error:|Applied patch|conflict' "$APPLY_LOG" | head -40
      echo '```'
      echo
      echo "人工处理步骤："
      echo "1. \`git checkout -B auto/upstream-$SHORT main\`"
      echo "2. \`git apply -3 $PATCH\`，按冲突提示逐个解开"
      echo "3. 解完执行 \`bash sync/restamp.sh\`，再 \`npm run build\` 验证"
      echo "4. 合并 main 后执行 \`bash sync/upstream-sync.sh --mark $NEW\`"
    } >> "$REPORT"
    git reset --hard --quiet main
    git checkout main --quiet
    git branch -D "$BRANCH" --quiet 2>/dev/null || true
  fi
fi

python3 - "$RESULT_FILE" "$CLEAN" "$BRANCH" "$NEW" <<'PY'
import json, sys
json.dump({"changed": True, "clean": sys.argv[2] == "true", "branch": sys.argv[3], "upstream_sha": sys.argv[4]},
          open(sys.argv[1], "w"), ensure_ascii=False, indent=2)
PY

echo "报告：$REPORT"
echo "补丁：$PATCH"
if [ "$CLEAN" = "true" ]; then
  echo "自动合并成功，分支：$BRANCH"
else
  echo "自动合并未完成（详见报告）"
fi
exit 0
