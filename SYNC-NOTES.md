# 魔改同步说明（SYNC NOTES）

本仓库是 MoonTVPlus 的自用魔改版，不是标准 fork。改得比较深，和上游整体 merge 会大量冲突。

本文档记录：改了什么、哪些能直接取上游、哪些要手工合、哪些碰不得。以后想吃上游更新时照这里做。

---

## 一、基线

- 本仓库第一个提交：`819ab24`（导入原版代码并做初始改造）
- 上游远端已配置：`upstream -> https://github.com/mtvpls/MoonTVPlus.git`
- 截至 2026-11-15，上游最新：`8a1137b v227.0.1`

本仓库没有保留上游的完整提交历史（是重新初始化的），所以**不能用 `git merge upstream/main`**，只能按文件取用。

---

## 二、改动清单（相对 `819ab24`）

统计：新增 2 · 修改 23 · 删除 74

### 2.1 新增文件（上游没有，取上游时不会冲突）

- `src/components/FullscreenEpisodeDrawer.tsx` — 全屏选集抽屉（腾讯式四列 + 50 集分段）
- `src/hooks/useShowPlayerToolbar.ts` — 播放器工具条开关的运行时配置 hook

### 2.2 高风险修改（改得很深，上游一动就冲突）

| 文件 | 改了什么 |
|---|---|
| `src/app/play/page.tsx` | 选集按钮、抽屉接入、弹幕彻底关闭、工具条开关、竖屏点击滚动、退出全屏收起、快捷快进等 |
| `src/app/admin/page.tsx` | 电脑端配置数组减 6 项、手机端折叠面板减 5 块、求片/追番提级、新增工具条开关 |
| `src/components/EpisodeSelector.tsx` | 删弹幕 tab 与内容块，只剩选集/换源 |
| `src/app/layout.tsx` | 注入 `SHOW_PLAYER_TOOLBAR` 运行时配置 |

### 2.3 中风险修改（改了文案或小逻辑）

- `src/lib/config.ts` — 默认站名 Nova 影库、`ShowPlayerToolbar` 默认值
- `src/lib/admin.types.ts` — 补 `ShowPlayerToolbar` 类型
- `src/app/api/admin/site/route.ts` — 白名单加 `ShowPlayerToolbar`（**这个必须记得，漏了开关会存不进去**）
- `src/app/globals.css` — 隐藏弹幕按钮的样式
- `src/components/UserMenu.tsx` — 客户端/插件卡片文案中性化
- `src/components/AIChatPanel.tsx`、`src/components/SiteProvider.tsx`、`src/components/BannerCarousel.tsx`、`src/app/page.tsx`、`src/app/warning/page.tsx` — 品牌文案
- `src/lib/email.service.ts`、`src/lib/email.templates.ts`、`src/lib/telegram.ts`、`src/lib/ai-orchestrator.ts`、`src/lib/ai-tool-agent.ts`、`src/app/api/admin/email/route.ts`、`src/app/api/admin/telegram/route.ts` — 默认站名与 AI 人设
- `.github/workflows/docker-image.yml`、`.github/workflows/docker-image-lite.yml` — 去掉 push 触发，避免每次红叉

### 2.4 已删除（上游更新这些会撞 modify/delete）

- `src/app/books/**`（8 个页面 + 目录）
- `src/app/manga/**`（7 个页面）
- `src/app/music/**`（全部页面与样式）
- `src/app/private-library/page.tsx`
- `src/app/advanced-recommendation/page.tsx`
- `src/app/api/books/**`、`src/app/api/manga/**`、`src/app/api/music/**`（共 50 余个接口）

---

## 三、绝对不能改的东西

这些看着像"品牌残留"，但改了会出事：

| 位置 | 原因 |
|---|---|
| `dbName = 'MoonTVPlus'`（`UserMenu.tsx`、`DownloadContext.tsx`、`DownloadManagementPanel.tsx`、`indexeddb-video-cache.ts`、`download-db.ts`） | 浏览器本地数据库名。改了之后已有的下载记录、播放缓存全部读不到 |
| `User-Agent: MoonTVPlus/1.0`（`bangumi.server.ts`） | 外部请求标识，部分站点会据此返回不同结果 |
| `version_check.ts`、`VersionPanel.tsx` 里的 GitHub 链接 | 升级检查用，指向原仓库才有意义 |
| `auth-cookie.ts` 的 `ua.includes('moontvplus')` | 客户端识别逻辑 |
| `admin.types.ts`、`source-detail/route.ts` 等注释 | 纯注释，无影响 |

---

## 四、同步流程

### 第 1 步：先看上游动了什么

```bash
git fetch upstream main
git log --oneline HEAD..upstream/main | head -30
```

### 第 2 步：判断某个文件我们改过没有

```bash
git log --oneline 819ab24..HEAD -- src/lib/某个文件.ts
```

- **无输出** = 我们没动过 = 可以安全取用
- **有输出** = 我们改过 = 要先看差异

### 第 3 步：取用

**没改过的文件**（推荐，冲突为零）：

```bash
git checkout upstream/main -- src/lib/xxx.ts
```

**改过的文件**（先看差异再决定）：

```bash
git diff HEAD upstream/main -- src/app/play/page.tsx
```

手工挑需要的部分，别整体覆盖。

### 第 4 步：验证

```bash
git commit -m "sync: 从上游取 xxx"
git push origin main
```

等 `Build & Push Image` 通过 → 服务器 `docker pull` → 测试站 `docker compose up -d` → 刷新验证。

**永远先在测试站验证，别直接动正式站。**

---

## 五、上游什么最值得取

优先级从高到低：

1. **`src/lib/api-adapters/**`** — 新视频源适配、解析规则修复。这是原版更新里最实用的部分
2. **`package.json`** — 依赖安全更新
3. **`src/lib/` 里的抓取、反爬、代理逻辑**
4. **`src/app/api/` 里我们没动过的接口**
5. **`next.config.*`**

基本不用取的：UI 布局、已删的书籍漫画音乐模块、CHANGELOG。

---

## 六、已知风险提醒

- 上游若新增**配置字段**，记得同步改三处：`src/lib/admin.types.ts`（类型）、`src/lib/config.ts`（默认值）、`src/app/api/admin/site/route.ts`（保存白名单）。漏掉白名单会导致"保存成功但值存不进去"
- 上游若改 `play/page.tsx` 的播放器初始化，我们的选集按钮和抽屉可能失效，需要重新测
- 上游若改 `admin/page.tsx` 的面板结构，我们的精简可能被冲掉
