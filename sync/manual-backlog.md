# 上游增量「必须人工」台账

上游每版会产出一批 manual 文件（我们改过 / 依赖我们删掉的模块）。**这里记一次、以后只追加**，
不必每版重新判断。分类只有三种：`永久人工`（不打算合）、`待做`（有价值，排期）、`不做`（没价值）。

## 2026-11-22 · 上游 v227.1.0（`a726372`）· auto 20 / manual 20

| 文件 | 上游改动 | 原因 | 决策 |
|---|---|---|---|
| `src/app/play/page.tsx` | +925 −109 | 我们改过（v1.5.1 自动切源） | **永久人工**：结构已分叉，合=重写这一页 |
| `src/app/admin/page.tsx` | +231 −326 | 我们改过（17 项播放默认值后台接管） | **永久人工**：改完要重验全部默认值 |
| `src/app/api/admin/source/route.ts` | +70 −71 | 依赖 `admin-video-sources` + `tvbox-bridge.shared` | 不做（除非引 bridge） |
| `src/app/api/admin/config/route.ts` | +4 | 依赖 `tvbox-live.server` | 不做 |
| `src/app/api/admin/live/route.ts` | +39 −9 | 依赖 `tvbox-bridge.server` / `tvbox-live.server` | 不做 |
| `src/app/api/admin/live/refresh/route.ts` | +17 −2 | 依赖 `tvbox-live.server` | 不做 |
| `src/app/api/live/precheck/route.ts` | +47 −14 | 依赖 `tvbox-live.server` | 不做 |
| `src/app/api/live/sources/route.ts` | +35 −8 | 依赖 `tvbox-live.*` | 不做 |
| `src/app/api/source-detail/route.ts` | +58 −96 | 依赖 `tvbox-bridge.shared` | 不做 |
| `src/app/api/tvbox/subscribe/route.ts` | +100 −89 | 依赖 `tvbox-bridge.shared` / `tvbox-subscription.server` | **待做**：TVBox 订阅专项的第一块 |
| `src/app/api/cron/[password]/route.ts` | +21 −2 | 依赖 `favorite-title` + `tvbox-live.server` | 不做（cron 已在我们这版跑通） |
| `src/lib/live.ts` | +78 −209 | 依赖 `live-playlist` / `tvbox-live.*` | 不做 |
| `src/lib/tv-search.ts` | +107 | 依赖 `tvbox-bridge.shared` | 不做 |
| `src/lib/admin-video-sources.ts` | +75 | 依赖 `tvbox-bridge.shared` | 不做 |
| `src/lib/types.ts`（tvbox 线路字段） | +23 | 依赖 `tvbox-bridge.shared` | 不做（只补了收藏/播放记录字段） |
| `src/app/api/search/route.ts` | +37 −3 | 我们改过（流式共享缓存） | **不做（阻塞）**：+37 行全部依赖 `tvbox-bridge.server` 的 `resolveTVBoxBridgeSites` / `runTVBoxBridgeSearch`，不引 bridge 就没法单独摘 |
| `src/app/api/search/ws/route.ts` | +100 −2 | 我们改过（v1.2 流式） | **待做**：只挑断线重连相关 |
| `src/app/api/image-proxy/route.ts` | +2 −2 | 我们改过（v1.5.0 磁盘缓存） | **已做（v1.6.4）**：番剧镜像域名 `bangumi.lol` → `bgm.lat`，新域名一并认 |
| `src/lib/admin.types.ts` | +34 −2 | 我们改过 | 不做（跟着 admin 一起） |
| `src/lib/config.ts` | +21 −14 | 我们改过（默认值） | 不做（上游默认值跟我们冲突） |
| `src/lib/version.ts` | +1 −1 | 我们改过 | 不做（restamp 自动维护） |

## 规则

- 每版合并后把新的 manual 追加到本表，**不要覆盖**；
- `待做` 一次只推进 1–2 个，且必须“独立文件、不引新模块”；
- 出现新的 `永久人工`（例如将来再改 `play`/`admin`），直接标死，避免重复讨论。
