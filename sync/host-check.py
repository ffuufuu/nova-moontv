#!/usr/bin/env python3
# 上游更新检测（宿主侧，被 cron 或站内「立即检查」触发）
# 数据源：
#   - 我们的版本号：/opt/custom-moontv/src/lib/version.ts（回退 VERSION.txt）
#   - 上次真正同步到的上游：/opt/custom-moontv/sync/upstream-state.json（与 GitHub Actions 同一本账）
#   - 上游最新：GitHub API
#   - 该版增量补丁：/opt/custom-moontv/sync/patches/upstream-<short>.patch（由 sync/upstream-sync.sh 生成）
import json, os, re, subprocess, urllib.request, datetime

REPO = "mtvpls/MoonTVPlus"
WORK = "/opt/custom-moontv"
OUTS = [
    "/opt/moontvplus/upstream/report.json",
]
BASE_FILE = "/opt/upstream-check/base.txt"
BASE_VER_FILE = "/opt/upstream-check/base-version.txt"
STATE_FILE = os.path.join(WORK, "sync/upstream-state.json")
VERSION_TS = os.path.join(WORK, "src/lib/version.ts")
VERSION_TXT = os.path.join(WORK, "VERSION.txt")
PATCH_DIR = os.path.join(WORK, "sync/patches")
DEFAULT_BASE = "8a1137b56cd0acc0ddf1f1cc7009e6f80a8efc24"
DEFAULT_VER = "227.0.1"

OUR_REPO = "ffuufuu/nova-moontv"
WORKFLOW_URL = "https://github.com/%s/actions/workflows/upstream-watch.yml" % OUR_REPO
PR_URL = "https://github.com/%s/pulls?q=is%%3Apr+head%%3Aauto%%2Fupstream" % OUR_REPO
ISSUE_URL = "https://github.com/%s/issues?q=is%%3Aissue+is%%3Aopen+upstream" % OUR_REPO

HIGH_RISK = {
    "src/components/SearchPageClient.tsx",
    "src/components/UserMenu.tsx",
    "src/app/admin/page.tsx",
    "src/app/layout.tsx",
    "src/lib/config.ts",
    "src/lib/admin.types.ts",
    "src/app/api/admin/site/route.ts",
    "src/lib/version.ts",
    "src/components/VersionPanel.tsx",
    "src/app/play/page.tsx",
    "src/components/EpisodeSelector.tsx",
    "src/components/FullscreenEpisodeDrawer.tsx",
}
SKIP_PREFIX = (".github/workflows/", "migrations/")
SKIP_FILES = {
    "package.json", "next.config.js", "open-next.config.ts",
    "src/lib/auth.ts", "src/lib/auth-cookie.ts", "src/lib/db.ts",
}


def http(url, raw=False):
    req = urllib.request.Request(url, headers={
        "User-Agent": "nova-upstream-check",
        "Accept": "application/vnd.github+json",
    })
    with urllib.request.urlopen(req, timeout=20) as r:
        data = r.read().decode()
        return data if raw else json.loads(data)


def our_version():
    try:
        text = open(VERSION_TS, encoding="utf-8").read()
        m = re.search(r"CURRENT_VERSION\s*=\s*'([^']+)'", text)
        if m:
            return m.group(1)
    except Exception:
        pass
    try:
        v = open(VERSION_TXT, encoding="utf-8").read().strip()
        if v:
            return v.lstrip("v")
    except Exception:
        pass
    return "0.0.0"


def sync_state():
    try:
        d = json.load(open(STATE_FILE, encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def patch_info(short, changed_set):
    """统计本次上游增量的补丁：文件数 / 撞高危的 / 可安全摘的"""
    p = os.path.join(PATCH_DIR, "upstream-%s.patch" % short)
    if not os.path.exists(p):
        return {"available": False, "files": 0, "highRisk": 0, "safe": 0, "path": ""}
    files = []
    try:
        with open(p, encoding="utf-8", errors="ignore") as f:
            for line in f:
                if line.startswith("diff --git "):
                    parts = line.split(" b/")
                    if len(parts) == 2:
                        files.append(parts[1].strip())
    except Exception:
        pass
    files = [f for f in files if f]
    high = [f for f in files if f in HIGH_RISK or f in changed_set or f.startswith(SKIP_PREFIX) or f in SKIP_FILES]
    return {
        "available": True,
        "files": len(files),
        "highRisk": len(high),
        "safe": max(0, len(files) - len(high)),
        "path": p,
    }


def main():
    st = sync_state()

    base = st.get("sha") or DEFAULT_BASE
    if os.path.exists(BASE_FILE):
        base = open(BASE_FILE).read().strip() or base
    base_ver = st.get("version") or DEFAULT_VER
    base_ver = base_ver.lstrip("v")
    if os.path.exists(BASE_VER_FILE):
        base_ver = open(BASE_VER_FILE).read().strip().lstrip("v") or base_ver

    # 上游最新提交
    latest = http("https://api.github.com/repos/%s/commits?per_page=1" % REPO)[0]
    latest_sha = latest["sha"]
    latest_date = latest["commit"]["author"]["date"][:10]
    latest_msg = latest["commit"]["message"].split("\n")[0]

    # 上游最新版本号（读 CHANGELOG）
    latest_ver = base_ver
    try:
        text = http("https://raw.githubusercontent.com/mtvpls/MoonTVPlus/main/CHANGELOG", raw=True)
        for line in text.splitlines():
            s = line.strip()
            if s.startswith("##") and "[" in s and "]" in s:
                latest_ver = s.split("[")[1].split("]")[0]
                break
    except Exception:
        pass

    # 咱们改过的文件
    changed = []
    try:
        changed = subprocess.run(
            ["git", "-C", WORK, "diff", "--name-only", "819ab24..HEAD"],
            capture_output=True, text=True, timeout=60
        ).stdout.splitlines()
    except Exception:
        pass
    changed_set = set(changed)

    commits = []
    if latest_sha != base:
        try:
            cmp = http("https://api.github.com/repos/%s/compare/%s...%s" % (REPO, base, latest_sha))
            for c in cmp.get("commits", []):
                sha = c["sha"]
                detail = http("https://api.github.com/repos/%s/commits/%s" % (REPO, sha))
                files = [f.get("filename", "") for f in detail.get("files", [])]
                commits.append({
                    "sha": sha[:7],
                    "date": c["commit"]["author"]["date"][:10],
                    "message": c["commit"]["message"].split("\n")[0],
                    "files": files,
                })
        except Exception as e:
            print("compare failed:", e)

    for c in commits:
        risk, reasons = "safe", []
        for f in c["files"]:
            if f.startswith(SKIP_PREFIX) or f in SKIP_FILES:
                risk = "skip"
                reasons.append("%s（不建议动）" % f)
            elif f in HIGH_RISK:
                if risk != "skip":
                    risk = "manual"
                reasons.append("%s（咱们改过）" % f)
            elif f in changed_set:
                if risk == "safe":
                    risk = "manual"
                reasons.append("%s（咱们改过）" % f)
        c["risk"] = risk
        c["reason"] = "；".join(reasons[:3])

    report = {
        "checkedAt": datetime.datetime.now(
            datetime.timezone(datetime.timedelta(hours=8))
        ).strftime("%Y-%m-%d %H:%M"),
        "ourVersion": our_version(),
        "baseVersion": base_ver,
        "baseCommit": base[:7],
        "latestVersion": latest_ver,
        "latestCommit": latest_sha[:7],
        "latestDate": latest_date,
        "latestMessage": latest_msg,
        "upToDate": latest_sha == base,
        "commits": commits,
        "summary": {
            "total": len(commits),
            "safe": sum(1 for c in commits if c["risk"] == "safe"),
            "manual": sum(1 for c in commits if c["risk"] == "manual"),
            "skip": sum(1 for c in commits if c["risk"] == "skip"),
        },
        "sync": {
            "auto": True,
            "cadence": "每天 02:00（北京时间）",
            "workflowUrl": WORKFLOW_URL,
            "prUrl": PR_URL,
            "issueUrl": ISSUE_URL,
            "lastSyncAt": st.get("synced_at", ""),
            "lastSyncCommit": base[:7],
            "patch": patch_info(latest_sha[:7], changed_set),
        },
    }
    for out in OUTS:
        try:
            os.makedirs(os.path.dirname(out), exist_ok=True)
            tmp = out + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(report, f, ensure_ascii=False, indent=2)
            os.replace(tmp, out)
            print("report written:", out)
        except Exception as e:
            print("write failed:", out, e)
    print("commits:", len(commits), "| upToDate:", report["upToDate"],
          "| ourVersion:", report["ourVersion"], "| base:", base[:7])


if __name__ == "__main__":
    main()
