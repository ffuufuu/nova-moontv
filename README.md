# Nova 影库

> 个人自用的影视聚合站点，基于 [MoonTVPlus](https://github.com/mtvpls/MoonTVPlus)（MIT）深度魔改。
>
> 本仓库为**私有仓库**，仅记录自己的改造过程与自用配置，不对外提供公开服务，也不分发镜像。

<div align="center">

![Next.js](https://img.shields.io/badge/Next.js-14-000?logo=nextdotjs)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3-38bdf8?logo=tailwindcss)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript)
![Docker](https://img.shields.io/badge/Docker-ready-blue?logo=docker)

</div>

---

## 这是什么

一台私有服务器上跑的影视聚合站。接第三方采集站的接口做聚合搜索，点开就能在线看。

在上游 MoonTVPlus 的基础上，按自己的使用习惯做了大幅裁剪和本地化改造：删掉了用不上的模块，加了几个自己需要的东西，品牌改成「Nova 影库」。

## 现有功能

- **多源聚合搜索**：接多个苹果CMS 采集站，一次搜索返回全源结果，带聚合合并与测速优选
- **在线播放**：ArtPlayer + HLS.js，支持换源、选集、倍速、画面比例
- **全屏选集抽屉**：腾讯视频式的右侧抽屉，4 列方块网格，按 50 集分段标签
- **短剧竖屏模式**：短剧自动进入竖屏播放
- **观影室**：多人同步观影、进度同步
- **求片**：用户提交想看的片子，后台处理
- **收藏 / 继续观看**：进度多端同步
- **电视直播 / 网络直播**：分组浏览、自动测速
- **豆瓣榜单 / 追番订阅**
- **注册体系**：邀请码、扫码登录、OIDC
- **后台管理**：站点配置、视频源配置、用户管理、播放与体验默认值

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
docker compose up -d
```

`docker-compose.yml` 需要两个服务：应用本体 + Kvrocks。

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
