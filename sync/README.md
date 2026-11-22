# 上游同步（吃原版红利，不炸自家站点）

## 一句话

每天自动看一眼上游 `mtvpls/MoonTVPlus` 的 `main` 有没有变；变了就**只取后端/接口/播放/后台的增量**，做一次三方合并，干净就开 PR，脏就开 issue 列冲突——**永远不会自动动 main**。

## 为什么这么设计

- 上游每次发版都把 `main` 重写成一个 squash 提交（当前是 `8a1137b v227.0.1`），没有可 cherry-pick 的逐条历史 → 只能**快照差分**。
- 我们的树和上游差 118 个文件、−23000 行（删了六个模块），直接 merge 必然一塌糊涂 → 用**白名单路径**把 UI 外壳和已删模块过滤掉。
- 品牌名、版本号每版都会被上游覆盖 → 合并后**自动重刷**（`sync/restamp.sh`）。

## 三个入口

| 场景 | 做法 |
|---|---|
| 日常（自动） | GitHub Actions `Upstream Watch`，每天北京时间 02:00 跑一次 |
| 手动检查 | `bash sync/upstream-sync.sh` |
| 手动尝试合并 | `bash sync/upstream-sync.sh --apply` |

## 文件

- `sync/upstream-state.json`：上次同步到的上游 sha（基线）
- `sync/sync-paths.conf`：纳入合并的路径白名单
- `sync/upstream-sync.sh`：检测 / 生成补丁 / 试合并
- `sync/restamp.sh`：品牌与版本号还原
- `sync/patches/`：每次生成的增量补丁（可下载、可复现）
- `sync/reports/`：每次的检测报告与 `last-result.json`

## 一次上游更新会发生什么

1. Actions 发现上游 sha 变了 → 跑 `--apply`。
2. **补丁能干净落地**：推一个 `auto/upstream-<sha>` 分支 + 开 PR（标题带 sha），正文附报告。你 review 后合并 → 按版本号规则升版本（如 `1.4.0`）→ 构建 → 上线 → `bash sync/upstream-sync.sh --mark <sha>`。
3. **有冲突**：什么都不改，直接开 issue，正文列出冲突文件和人工处理步骤。你按步骤在本地解，解完照常升版本上线，再 `--mark`。

## 红线

- 只推 `auto/upstream-*` 分支，**不推 main**；
- 冲突时 `git reset --hard main` 并删掉临时分支，工作区保持干净；
- 补丁只涉及白名单路径，UI 外壳与已删模块永远不进；
- 版本号与品牌文件固定还原成我们的，上游改不动。

## 常见改法

- 想多吃一点 UI 修复：往 `sync/sync-paths.conf` 里加路径；
- 想少吃一点（只吃 `src/lib`）：把其他行注释掉；
- 上游仓库改名/换地址：改 `sync/upstream-state.json` 与脚本里的 `UPSTREAM_URL`。
