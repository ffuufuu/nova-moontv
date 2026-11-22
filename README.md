# Nova 影库

> 个人自用的影视聚合站点，基于 [MoonTVPlus](https://github.com/mtvpls/MoonTVPlus)（MIT）深度魔改。
>
> 本仓库为**私有仓库**，仅记录自己的改造过程与自用配置，不对外提供公开服务，也不分发镜像。

<div align="center">

![Version](https://img.shields.io/badge/version-1.5.0-2ea043)
![Next.js](https://img.shields.io/badge/Next.js-14-000?logo=nextdotjs)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3-38bdf8?logo=tailwindcss)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript)
![Docker](https://img.shields.io/badge/Docker-ready-blue?logo=docker)

</div>

---

## 这是什么

一台私有服务器上跑的影视聚合站（[nova.550556.xyz](https://nova.550556.xyz)）。接第三方采集站的接口做聚合搜索，点开就能在线看。

在上游 MoonTVPlus 的基础上，按自己的使用习惯做了大幅裁剪和本地化改造：删掉了用不上的模块，把搜索和播放的坑逐个填平，品牌改成「Nova 影库」，并建立了一套**自己的版本体系 + 上游增量同步机制**。

## 文档索引

| 文件 | 内容 |
|---|---|
| `PROJECT-HISTORY.md` | **项目纪事**：定位、时间线、每个版本的改动与实测数据、版本号规则、部署回滚、踩过的坑、封存区、待办 |
| `sync/README.md` | 上游同步工具链说明：检测、打补丁、三方合并、重打版本号 |
| `sync/upstream-state.json` | 当前同步基线（上游提交 sha / 版本 / 同步时间），站内面板与 Actions 都读这份 |
| `SOURCE_SCRIPT.md` | 自定义采集脚本源的写法 |

## 现有功能

- **多源聚合搜索**：接多个苹果CMS 采集站，一次搜索返回全源结果，默认按「标题 + 类型 + 年份」聚合成一张卡，卡内列多源
- **在线播放**：ArtPlayer + HLS.js，支持换源、选集、倍速、画面比例
- **全屏选集抽屉**：腾讯视频式的右侧抽屉，4 列方块网格，按 50 集分段标签
- **短剧竖屏模式**：短剧自动进入竖屏播放
- **观影室**：多人同步观影、进度同步
- **求片**：提交想看的片子，后台处理
- **收藏 / 继续观看**：进度多端同步
- **电视直播 / 网络直播**：分组浏览、自动测速
- **豆瓣榜单 / 追番订阅**
- **TVBox 订阅**：`/api/tvbox` 输出订阅配置（token 保护）
- **注册体系**：邀请码、扫码登录、OIDC
- **后台管理**：站点配置、视频源配置、用户管理、播放与体验默认值
- **版本面板**：右下角用户菜单显示 `v1.5.0`；面板内含「上游更新看板」（我方版本 / 基于上游 / 上游最新 / 该版增量统计 / 自动检测跳转）

## 性能与稳定性（相对上游的实质改动）

这些是 v1.1.0 之后逐版加上去的，细节与实测数据见 `PROJECT-HISTORY.md`。

| 改动 | 位置 | 效果 |
|---|---|---|
| 单源搜索超时 20s → 8s，脚本源 6s | `src/app/api/search/route.ts` | 一个慢源不再拖住整次搜索 |
| 死源降权与冷却 | `src/lib/source-health.ts` | 连续 3 次失败的源冷却 10 分钟，不写库只管内存 |
| 搜索结果共享缓存（5 分钟 / 50 条 LRU） | `src/lib/search-result-cache.ts` | 重复搜索 0.04s 返回（首次 2–3s） |
| 源排序按「权重 × 健康分 × 耗时 EMA」 | `src/lib/source-health.ts` | 快的、稳的源先返回结果 |
| 豆瓣 4s 超时 + 上次好数据兜底 | `src/app/api/douban*/route.ts` | 首页不再因为豆瓣抽风整块空白 |
| 播放缓冲上调 + HLS 重试加密 | `src/app/play/page.tsx` | 卡顿明显减少 |
| 连续 2 次致命错误自动换源 | 同上 | 单源挂掉自动切到下一个 |
| 记住上次播放成功的源 | 同上（localStorage `moontv:lastGoodSource`） | 同一部片下次直接走好用的源 |
| 海报/封面本地磁盘缓存 | `src/app/api/image-proxy/route.ts` | 10 张海报 6.22s → 0.10s（第二次全命中） |

## 版本与上游同步

- **版本号**：`src/lib/version.ts` 的 `CURRENT_VERSION`、`VERSION.txt`、`package.json` 三处必须一致；一次上线 = 一个版本（功能 minor+1，纯修 patch+1，架构 major+1）
- **纪事**：每次上线必须在 `PROJECT-HISTORY.md` 追加一行（版本 / 日期 / 提交 / 构建 / 一句话）
- **上游检测**：GitHub Actions「Upstream Watch」每天 UTC 18:00（北京 02:00）对比上游，无更新则什么都不做；有更新且不冲突就推 `auto/upstream-<sha>` 分支并开 PR，冲突则开 issue，**绝不直接动 main**
- **落地一次上游更新**：

```bash
bash sync/upstream-sync.sh --apply     # 白名单路径三方合并，冲突整体回滚
bash sync/restamp.sh                   # 强制还原自己的版本号/品牌
# 人工 review → 提交 → 构建 → 部署 → 在纪事补一行
```

白名单（只吃这些目录的改动）：`src/lib`、`src/app/api`、`src/app/play`、`src/app/admin`，配置在 `sync/sync-paths.conf`。

## 相对上游的改动

### 删掉的

| 模块 | 说明 |
|---|---|
| 弹幕系统 | 后端服务、设置面板、播放器控件、提示文案全部移除 |
| 豆瓣评论 / AI 评论 | 评论抓取与相似推荐整体下线 |
| 电子书、漫画、音乐 | 三个模块的页面与 API 一并删除 |
| 私人影库 | OpenList / Emby / 小雅接入移除 |
| AI 高级推荐 | 移除 |
| 网盘 / 磁力 / Emby / OPDS | 四类附加聚合移除 |
| Telegram 机器人 | 移除 |
| 原版 CI | 上游自带的两条自动构建流水线改为仅手动触发 |

### 加的

- **全屏选集抽屉**（`src/components/FullscreenEpisodeDrawer.tsx`）：用 `createPortal` 挂到全屏元素上，解决全屏 API 下页面其他 DOM 会被排除的问题
- **播放与体验默认值**：后台统一配置 17 项播放/搜索默认值，站点启动时下发到客户端浏览器本地，本机已设置的项不受影响
- **播放器下方工具条开关**：后台可控制那排外部打开按钮的显隐
- **品牌统一**：站点名、AI 人设、邮件模板等全部改为「Nova 影库」
- **版本面板改造**（`src/components/VersionPanel.tsx`）：从「上游更新看板」升级为含自动同步节奏、该版增量统计、检测记录/PR/issue 跳转的版本面板
- **上游同步工具链**（`sync/` + `.github/workflows/upstream-watch.yml`）：详见上面的「版本与上游同步」

## 技术栈

- **框架**：Next.js 14（App Router）+ TypeScript
- **样式**：TailwindCSS
- **播放器**：ArtPlayer + HLS.js
- **存储**：Kvrocks（站点配置、用户数据、播放记录）
- **部署**：Docker + docker compose

## 部署

镜像由 GitHub Actions 构建后推送到 GHCR，服务器拉取运行。

```bash
docker pull ghcr.io/ffuufuu/nova-moontv:latest
docker compose up -d --force-recreate
```

`docker-compose.yml` 需要两个服务：应用本体 + Kvrocks。

- 正式站目录：`/opt/moontvplus`，容器 `moontv-core`（3000）+ `moontv-kvrocks`（6666）
- **回滚**：镜像保留 `ghcr.io/ffuufuu/nova-moontv:rollback-prev`（当前指向上一版），改 compose 里的 tag 再 `up -d` 即可；代码侧 `git revert` 后重新构建
- **封面缓存**：落在 `/app/upstream/image-cache`（宿主机 `./upstream/image-cache`），30 天过期、总量 800MB 自动按最旧淘汰，可随时整个目录删掉重建
- 上游检查报告：`./upstream/report.json`，由宿主 `check.py` 生成，站内面板读它

> 注意：`src/lib/config.ts` 有进程级缓存 `cachedConfig`，直接改 Kvrocks 里的配置不会立即生效，需要 `docker restart` 容器；通过后台页面保存则会主动刷新缓存。

## 环境变量

主要几项：

| 变量 | 说明 |
|---|---|
| `STORAGE_TYPE` | 存储类型，如 `kvrocks` |
| `KVROCKS_URL` | Kvrocks 连接地址 |
| `NEXT_PUBLIC_STORAGE_TYPE` | 前端可见的存储类型 |
| `PASSWORD` | 站点访问密码 |
| `USERNAME` | 单用户模式下的用户名 |
| `NEXT_PUBLIC_SITE_NAME` | 站点名称 |
| `ENABLE_TVBOX_SUBSCRIBE` | 是否开启 TVBox 订阅输出 |
| `TVBOX_SUBSCRIBE_TOKEN` | TVBox 订阅令牌 |
| `IMAGE_CACHE_DIR` | 封面缓存目录，默认 `/app/upstream/image-cache` |

完整列表见上游文档，本项目实际只用到 Docker 部署所需的一部分。

## 免责声明

本站仅提供影视信息的聚合搜索，所有内容均来自第三方站点，本站不存储任何视频资源，不对内容的准确性与合法性负责。

本项目仅供个人学习与自用，请勿用于公开传播、商业用途或其他违反法律法规的场景。

## License

基于 [MoonTVPlus](https://github.com/mtvpls/MoonTVPlus)（MIT License）修改，本仓库的修改部分同样遵循 MIT。上游的版权声明与致谢予以保留。

## 致谢

- [MoonTVPlus](https://github.com/mtvpls/MoonTVPlus)
- [LunaTV](https://github.com/MoonTechLab/LunaTV)
- ArtPlayer、HLS.js、Next.js、TailwindCSS 等开源项目
