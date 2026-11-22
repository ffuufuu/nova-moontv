#!/usr/bin/env bash
# 上游（mtvpls/MoonTVPlus）更新同步助手 v2
#
# 背景：上游每次发版都把 main 重写成「一个 squash 提交」，没有可 cherry-pick 的逐条历史。
# 所以走「快照差分 + 白名单 + 自动/人工双轨 + 三方合并 + 品牌/版本重刷」。
#
# v2 相对 v1 的改动（2026-11 首次真实上游更新后总结）：
#   1) 补丁拆成两份：`.auto.patch`（我们没碰过的文件，可机器合）/ `.manual.patch`（我们改过的文件，必须人眼）
#   2) 只处理「我们树里真实存在」的文件——上游新增的、我们已删模块的文件直接跳过并列出
#   3) `--apply` 默认只合 auto；`--apply-all` 才连 manual 一起走三方合并
#   4) 合完自动跑 `sync/restamp.sh`（版本号 + 品牌还原），不再手写三个文件
#   5) 报告里给出三组清单与 manual 文件的上下游改动量（+/−），方便决定吃不吃
#
# 用法：
#   bash sync/upstream-sync.sh                    # 检测 + 生成报告与三份补丁（不改代码）
#   bash sync/upstream-sync.sh --apply            # 在 auto/ 分支上只合 auto 补丁
#   bash sync/upstream-sync.sh --apply-all        # auto + manual 都合（冲突则整体回滚）
#   bash sync/upstream-sync.sh --old X --new Y    # 指定快照 sha
#   bash sync/upstream-sync.sh --mark X           # 合并进 main 后，把上游状态记为 X

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
APPLY_ALL=0
MARK=""
ONLY=""

while [ $# -gt 0 ]; do
  case "$1" in
    --old) OLD="$2"; shift 2 ;;
    --new) NEW="$2"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    --apply-all) APPLY=1; APPLY_ALL=1; shift ;;
    --only) ONLY="$2"; shift 2 ;;
    --mark) MARK="$2"; shift 2 ;;
    -h|--help) sed -n '3,26p' "$0"; exit 0 ;;
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
import json, sys, datetime
p, sha = sys.argv[1], sys.argv[2]
try:
    d = json.load(open(p))
except Exception:
    d = {}
d["sha"] = sha
d["synced_at"] = datetime.date.today().isoformat()
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
PATCH_AUTO="$PATCH_DIR/upstream-$SHORT.auto.patch"
PATCH_MANUAL="$PATCH_DIR/upstream-$SHORT.manual.patch"
REPORT="$REPORT_DIR/upstream-$STAMP-$SHORT.md"
PATHS=$(grep -v '^#' "$CONF_FILE" 2>/dev/null | grep -v '^$' | tr '\n' ' ')

if [ -z "$PATHS" ]; then
  echo "sync/sync-paths.conf 里没有可用路径，退出" >&2
  exit 1
fi

# ---------- 1. 全量补丁 ----------
git diff --binary "$OLD" "$NEW" -- $PATHS > "$PATCH" || true
PATCH_LINES=$(wc -l < "$PATCH" | tr -d ' ')
FILES=$(git diff --name-only "$OLD" "$NEW" -- $PATHS)
FILE_COUNT=$(printf '%s\n' "$FILES" | grep -c . || true)
TOTAL_COUNT=$(git diff --name-only "$OLD" "$NEW" | grep -c . || true)
SKIPPED_COUNT=$((TOTAL_COUNT - FILE_COUNT))
STAT=$(git diff --stat "$OLD" "$NEW" -- $PATHS | tail -1)

# ---------- 2. 分组：auto / manual / skip（含依赖闭环） ----------
SPLIT_DIR=$(mktemp -d /tmp/up-split-XXXXXX)
printf '%s\n' "$FILES" > "$SPLIT_DIR/files.txt"
python3 sync/split_patch.py --old "$OLD" --new "$NEW" --files "$SPLIT_DIR/files.txt" \
  --conf "$CONF_FILE" --outdir "$SPLIT_DIR" || true

AUTO_LIST=()
MANUAL_LIST=()
SKIP_LIST=()
while IFS= read -r f; do [ -n "$f" ] && AUTO_LIST+=("$f"); done < "$SPLIT_DIR/auto.txt"
while IFS= read -r f; do [ -n "$f" ] && MANUAL_LIST+=("$f"); done < "$SPLIT_DIR/manual.txt"
while IFS= read -r f; do [ -n "$f" ] && SKIP_LIST+=("$f"); done < "$SPLIT_DIR/skip.txt"

# manual 文件的上游改动量（+/−），报告里用
manual_stat() {
  local f="$1"
  local n
  n=$(git diff --numstat "$OLD" "$NEW" -- "$f" | awk '{print "+"$1" -"$2}')
  echo "${n:-+0 -0}"
}

if [ "${#AUTO_LIST[@]}" -gt 0 ]; then
  git diff --binary "$OLD" "$NEW" -- "${AUTO_LIST[@]}" > "$PATCH_AUTO" || true
else
  : > "$PATCH_AUTO"
fi
if [ "${#MANUAL_LIST[@]}" -gt 0 ]; then
  git diff --binary "$OLD" "$NEW" -- "${MANUAL_LIST[@]}" > "$PATCH_MANUAL" || true
else
  : > "$PATCH_MANUAL"
fi

# ---------- 3. 报告 ----------
{
  echo "# 上游更新检测报告"
  echo
  echo "- 时间：$(date '+%Y-%m-%d %H:%M:%S %z')"
  echo "- 上游 ${OLD:0:7} → ${NEW:0:7}"
  echo "- 白名单：$(echo $PATHS | tr ' ' '、')"
  echo "- 白名单内文件 ${FILE_COUNT} 个 / 补丁 ${PATCH_LINES} 行；白名单外未纳入 ${SKIPPED_COUNT:-0} 个"
  echo "- 增量统计：${STAT:-无}"
  echo "- 分组口径：命中 \`:!\` 排除 / 我们删过 / 依赖缺失 → 不进 auto；我们改过的文件一律 manual"
  echo
  echo "## 一、可以机器合（我们没有改过的文件，${#AUTO_LIST[@]} 个）"
  echo '```'
  printf '%s\n' "${AUTO_LIST[@]:-（无）}" | sed 's/^/- /'
  echo '```'
  echo
  echo "## 二、必须人工看（我们改过的文件，${#MANUAL_LIST[@]} 个）"
  echo
  echo "| 文件 | 上游改动量 | 原因 |"
  echo "|---|---|---|"
  if [ "${#MANUAL_LIST[@]}" -gt 0 ]; then
    while IFS=$'\t' read -r mf reason; do
      [ -z "$mf" ] && continue
      echo "| \`$mf\` | $(manual_stat "$mf") | ${reason:-我们改过} |"
    done < "$SPLIT_DIR/reasons.tsv"
  else
    echo "| — | — | 本次没有交集 |"
  fi
  echo
  echo "## 三、跳过（我们树里没有这些文件，${#SKIP_LIST[@]} 个）"
  echo
  echo "已删模块（漫画/AI/Emby/OpenList/TVBox bridge 等）或上游新增但与我们无关的文件，一律不吃。"
  echo '```'
  printf '%s\n' "${SKIP_LIST[@]:-（无）}" | sed 's/^/- /'
  echo '```'
} > "$REPORT"

CLEAN="false"
BRANCH=""

# ---------- 4. 应用 ----------
if [ "$APPLY" = "1" ]; then
  BRANCH="auto/upstream-$SHORT"
  git checkout -B "$BRANCH" main --quiet
  APPLY_LOG="/tmp/upstream-apply-$SHORT.log"
  : > "$APPLY_LOG"
  OK=1

  if [ -s "$PATCH_AUTO" ]; then
    if ! git apply -3 --whitespace=nowarn "$PATCH_AUTO" >> "$APPLY_LOG" 2>&1; then
      OK=0
    fi
  fi

  if [ "$APPLY_ALL" = "1" ] && [ -s "$PATCH_MANUAL" ]; then
    echo "--- 开始合 manual 补丁 ---" >> "$APPLY_LOG"
    if ! git apply -3 --whitespace=nowarn "$PATCH_MANUAL" >> "$APPLY_LOG" 2>&1; then
      OK=0
    fi
  fi

  CONFLICTS=$(git diff --name-only --diff-filter=U | head -20)
  [ -n "$CONFLICTS" ] && OK=0

  if [ "$OK" = "1" ]; then
    bash sync/restamp.sh >> "$APPLY_LOG" 2>&1 || true
    BRAND_HITS=$(git diff --name-only main -- 'src/**' 2>/dev/null | xargs -r grep -l 'MoonTV' 2>/dev/null | head -20 || true)
    git add -A -- $PATHS 2>/dev/null || true
    git add src/lib/version.ts VERSION.txt package.json 2>/dev/null || true
    git -c user.name='upstream-bot' -c user.email='upstream-bot@users.noreply.github.com' \
      commit -q -m "chore(upstream): 同步上游 ${NEW:0:7} 的增量（自动合并，待人工确认）" || true
    CLEAN="true"
    {
      echo
      echo "## 四、自动合并结果：干净"
      echo "- 分支：\`$BRANCH\`"
      echo "- 已合入：auto ${#AUTO_LIST[@]} 个文件$([ "$APPLY_ALL" = "1" ] && echo " + manual ${#MANUAL_LIST[@]} 个")"
      echo "- 未合入：manual ${#MANUAL_LIST[@]} 个（需人工）"
      if [ -n "${BRAND_HITS:-}" ]; then
        echo "- 可能残留上游品牌名，合并前核对："
        echo '```'
        echo "$BRAND_HITS"
        echo '```'
      fi
      echo "- 下一步：\`git diff main..$BRANCH\` 审阅 → 通过后合 main、升版本、构建、部署，再 \`bash sync/upstream-sync.sh --mark $NEW\`"
    } >> "$REPORT"
  else
    {
      echo
      echo "## 四、自动合并结果：有冲突（已整体回滚，main 未改动）"
      echo '```'
      grep -E 'error:|Applied patch|conflict|--- ' "$APPLY_LOG" | head -40
      [ -n "$CONFLICTS" ] && { echo; echo "冲突文件："; echo "$CONFLICTS" | sed 's/^/  - /'; }
      echo '```'
      echo
      echo "人工步骤："
      echo "1. \`git checkout -B auto/upstream-$SHORT main\`"
      echo "2. \`git apply -3 $PATCH_AUTO\`（auto 部分先落地）"
      echo "3. 需要上游改动时再逐个 \`git apply -3 --include=<file> $PATCH_MANUAL\`"
      echo "4. \`bash sync/restamp.sh\`，构建验证后合 main"
      echo "5. \`bash sync/upstream-sync.sh --mark $NEW\`"
    } >> "$REPORT"
    git reset --hard --quiet main
    git checkout main --quiet
    git branch -D "$BRANCH" --quiet 2>/dev/null || true
  fi
fi

python3 - "$RESULT_FILE" "$CLEAN" "$BRANCH" "$NEW" "${#AUTO_LIST[@]}" "${#MANUAL_LIST[@]}" "${#SKIP_LIST[@]}" <<'PY'
import json, sys
json.dump({
    "changed": True,
    "clean": sys.argv[2] == "true",
    "branch": sys.argv[3],
    "upstream_sha": sys.argv[4],
    "auto_files": int(sys.argv[5]),
    "manual_files": int(sys.argv[6]),
    "skipped_files": int(sys.argv[7]),
}, open(sys.argv[1], "w"), ensure_ascii=False, indent=2)
PY

echo "报告：$REPORT"
echo "补丁：$PATCH / $PATCH_AUTO / $PATCH_MANUAL"
echo "文件分类：auto ${#AUTO_LIST[@]} / manual ${#MANUAL_LIST[@]} / skip ${#SKIP_LIST[@]}"
if [ "$APPLY" = "1" ]; then
  if [ "$CLEAN" = "true" ]; then
    echo "自动合并成功，分支：$BRANCH"
  else
    echo "自动合并未完成（详见报告）"
  fi
fi
exit 0
