# Nova 影库 · 交接说明

> 写于 2026-11-25。这份文件的目的：**换人（或换 AI）接手时，不用重新摸一遍**。
> 配套文件：`PROJECT-HISTORY.md`（完整纪事与历史版本）、`docs/decisions.md`（已否决清单）、`docs/ui-rules.md`（UI 规范）、`sync/README.md`（上游同步工具链）。

---

## 一、现在的状态

| 项 | 值 |
|---|---|
| 版本 | **v1.6.6**（唯一真值：`src/lib/version.ts` 的 `CURRENT_VERSION`） |
| 线上镜像 | `ghcr.io/ffuufuu/nova-moontv:latest` = `18a3606b7cdd` |
| 回滚点 | `rollback-prev` = `58429b27417c`（v1.6.5） |
| 容器 | `moontv-core`（3000）、`moontv-kvrocks`（6666）、`npm-app-1`（80/81/443）、`dockercopilot` |
| 磁盘 | 39G，已用 17G（**44%**）；镜像只留 latest + rollback-prev；build cache 约 400MB |
| 资源 | core 内存 133/957MB，CPU 空载 0%，0 重启 |
| 源 | **51 个**，全部直连（`proxyMode` 全 false），都在 `admin:config` 里，**不要动** |
| 面板 | `ourVersion 1.6.6 / upToDate true`，读 `sync/upstream-state.json` 做基线 |
| 上游基线 | `a726372` / v227.1.0 |

---

## 二、本轮（2026-11-22 ~ 11-25）做完的七个版本

### v1.6.0 — 上游 v227.1.0 首次实战合并
- 同步工具升级到 v2：auto/manual 双轨 + 依赖闭环 + 34 条排除清单 + 三份补丁 + `split_patch.py`
- 结果：auto 20 / manual 20 / skip 0，断链 0，+406/−385，镜像 `010c335167b1`
- 坑：CI 连挂两次（#79/#80），Actions 日志面板虚拟化读不到 TS 报错 → 本地 `git archive` + `pnpm install` + `npx tsc --noEmit` 才定位到 `Favorite.is_invalid` 缺失

### v1.6.1 — 版本面板改底部抽屉（第一次翻车后）
- 用户截图：面板整屏铺满、底部按钮被 tab 遮住
- 根因三层：`z-[200]` 低于顶栏 999 / 底栏 600；手机宽 424px < `max-w-lg` 512px 导致满宽；`max-h-[88vh]` 近整屏
- 改为底部抽屉：`items-end`、上圆角、抓手条、`max-h-[80vh]`、安全区
- 结果：仍被顶栏压住 → 用户原话「修半天修了个寂寞」

### v1.6.2 — 层级与高度修正
- `z-[1000]`（压过 999/600）、`max-h-[62vh]`、删掉占高的「流程」段、按钮区加 `env(safe-area-inset-bottom)`
- 验证方式：容器内 bundle grep 到 `z-[1000]`、CSS 里 grep 到 `max-h-[62vh]`
- 沉淀出 `docs/ui-rules.md`：顶栏 999 / 底栏 600 / 自建模态 1000+

### v1.6.3 — 版本真值统一 + 品牌残留
- `sync/restamp.sh` 重写为**单一真值**：只认 `version.ts`，自动写 `VERSION.txt` + `package.json`，`--check` 报不一致
- 修掉两处品牌残留：登录页底部 GitHub 链接指向自己仓库；`UserMenu` 文案「MoonTV Plus 电视端」→「Nova 影库电视端」
- 注意：`restamp.sh` 无参数调用时按当前 `version.ts` 重写派生文件；**要先改 `version.ts` 再跑**，否则会把旧版本号重新刷回去（本轮踩过）

### v1.6.4 — 图片代理认新番剧域名
- 上游把番剧镜像 `bangumi.lol` → `bgm.lat`，而 `image-proxy` 只认旧域名，会把新图当豆瓣图加 `Referer: movie.douban.com` → 封面被打回
- 修法：`isBangumiImageUrl` 增加 `bgm.lat`、`api.bgm.lat`（旧域名保留）

### v1.6.5 — 换源按集号对齐
- `handleSourceChange` 新增 `epNumOf()`（支持 `SxxEyy` / 纯数字 / `第N集`），用旧源当前集标题取集号，在新源里找**唯一匹配**才切换
- 越界处理由「跳第 1 集」改为「退到最后一集」+ toast「新源集数较少，已定位到第 N 集并沿用播放进度」
- `source-health` 排序加 `recencyBonus`：6 小时内成功过 +8

### v1.6.6 — 搜索瘦身 + 健康分持久化
| 改动 | 文件 | 实测 |
|---|---|---|
| 搜索结果按源截断（单源 20 / 总 200） | `src/lib/search-cap.ts`（新）+ 两条搜索路由 | 体积 **1,028,568B → 302,437B（−70.6%）**，条数 536 → 120，冷搜索 2.84s → 2.24s |
| 源健康分持久化到 kvrocks 哈希 `nova:source-health` | `src/lib/source-health.ts` | 重启后日志「已恢复 51 条源健康记录」 |
| 弹幕上游 503 失败 60 秒短路 + 超时 30s→10s | `src/app/api/danmaku/search/route.ts` | 日志报错显著减少 |

要点：`episodes` 字段**一个都没裁**——播放页要用它做源测速和直连，这是查代码确认后才下的手。
新增常量在 `search-cap.ts`：`SEARCH_MAX_PER_SOURCE = 20`、`SEARCH_MAX_TOTAL = 200`。觉得结果太少就只改这两个数。

### 同期完成的运维项
- `sync/verify.sh` 三道闸门（`tsc` / `--build` / `--smoke` 8 个接口）
- `sync/manual-backlog.md` 20 条 manual 台账
- `sync/check.py` + `sync/README-check.md` 宿主机检测脚本版本化
- 磁盘清理：`docker image prune -f` 回收 5.0G；新增 `/usr/local/bin/moontv-docker-prune.sh`（`0 5 * * 0`，只清悬空镜像 + 7 天前 builder 缓存）
- `/opt/disk-check.sh` 阈值 85% → **75%**（半小时一次，越线自动 prune，日志 `/var/log/disk-alert.log`）

---

## 三、基线数据（以后改完拿来对比）

| 指标 | 值 | 怎么测 |
|---|---|---|
| 首页 HTML | 约 55KB | `curl -o /dev/null -w "%{size_download}"` |
| 搜索 `庆余年` | 302KB / 约 2.2s（冷），0.02s（缓存） | `/api/search?q=...` |
| 详情接口 | 21 源实测 0.12–0.81s | `/api/source-detail?source=&id=&title=` |
| 海报 | 首次 1.97s（现拉豆瓣）、二次 8.8ms | `/api/image-proxy?url=...` |
| 播放记录 / 收藏 / 上游报告 | 7–9ms | 带 cookie |
| 静态资源下载 | 10.8 MB/s | 说明**出口不是瓶颈**（早期「3M 带宽」的前提已过时） |
| 前端 `/play` 脚本 | 27 个文件，raw ≈1.9MB，gzip ≈700KB | 由于上一行，暂不建议为此动 play 页 |

---

## 四、否决清单（别再提）

完整在 `docs/decisions.md`。这里只列最容易反复出现的：

| 事项 | 结论 |
|---|---|
| 登录失败限流 / 封禁 / 换强口令（A1） | **用户明确否决**（「登陆限流不弄ok？次次说」），永不再提；用户接受公网弱口令风险 |
| 开 HTTP/2（改 NPM 配置） | 已评估收益明确，**用户决定不做**；注意 NPM 面板日后保存会覆盖配置 |
| 换播放器内核（Artplayer → xgplayer/vidstack/video.js） | 评估后**不建议**：331 个调用点 + 31 处事件 + 2 插件 + 2 个页面 |
| `/play` 包体积瘦身 | 因出口 10.8MB/s，优先级降为零 |
| 代理播放分片缓存 | 51 源全直连，播放不占服务器带宽，无意义 |
| TVBox 订阅专项（`tvbox/subscribe`） | 不做，现有 `/api/tvbox/subscribe?token=550556` 够用 |
| 后台源批量测速 / 手机播放页外壳重做 / 底部搜索按钮 / 假数据 / 只换色不换布局 / 手机端 iframe 内嵌后台 | 历史否决 |

---

## 五、工具链速查

```bash
# 发版（改完代码后）
python3 - <<'PY'            # 1. 先改唯一真值
import re;p='src/lib/version.ts';s=open(p).read()
open(p,'w').write(re.sub(r"CURRENT_VERSION\s*=\s*'[^']*'","CURRENT_VERSION = 'x.y.z'",s))
PY
bash sync/restamp.sh        # 2. 派生 VERSION.txt 与 package.json
bash sync/restamp.sh --check # 3. 应输出三处一致
bash sync/verify.sh         # 4. 类型（服务器无 node 会跳过，需本地跑）
git push origin main        # 5. 触发 Actions「Build & Push Image」
# 6. 等构建成功（约 8–12 分钟）→ 服务器拉镜像（约 12–15 分钟）
docker tag $(docker inspect -f '{{.Image}}' moontv-core) ghcr.io/ffuufuu/nova-moontv:rollback-prev
setsid nohup docker pull ghcr.io/ffuufuu/nova-moontv:latest > /tmp/pull.log 2>&1 &
cd /opt/moontvplus && docker compose up -d --force-recreate moontv-core
BASE_URL=http://127.0.0.1:3000 SMOKE_USER=xxx SMOKE_PASS=xxx bash sync/verify.sh --smoke
```

**回滚**（出事先做这个，别分析）：
```bash
cd /opt/moontvplus
docker tag ghcr.io/ffuufuu/nova-moontv:rollback-prev ghcr.io/ffuufuu/nova-moontv:latest
docker compose up -d --force-recreate moontv-core
```

**本地类型校验**（服务器没 node）：服务器 `git archive HEAD -o /tmp/src.tar` → 下载解包 → `pnpm install --frozen-lockfile --ignore-scripts`（约 1 分钟）→ `npx tsc --noEmit` → `npx next build`。

**上游检查**：`python3 /opt/upstream-check/check.py`，结果落 `/opt/moontvplus/upstream/report.json`，容器经只读卷 `/app/upstream` 返回给面板。

---

## 六、踩过的坑

1. **Actions 读不到 TS 报错**：日志面板虚拟化，annotation 只有 buildx 的 `exit code: 1`。永远先在本地 `tsc`。
2. **`restamp.sh` 无参数**会按当前 `version.ts` 重刷派生文件，可能把版本号刷回旧的。先改 `version.ts`。
3. **`sed` 改 `if [ "$USE" -ge 85 ]` 不生效**：`[` 被当正则 bracket expression。改阈值用 python 字符串替换。
4. **每轮沙箱 `/tmp` 会清空**：本地构建目录要重建。
5. **`git reset --hard` 会回滚未提交的 `sync/*`**：调试同步工具时反复踩，先 commit 再实验。
6. **私有 GHCR 偶发卡住**：日志停在 `Pull complete` 十分钟不动 → `pkill` 后重启 `docker pull` 即恢复。
7. **`verify.sh --smoke` 用旧 cookie 会 401**：脚本内必须重新登录（已内置）。
8. **NPM 面板会覆盖 nginx 配置**：手改 `/data/nginx/proxy_host/2.conf` 后，哪天在面板点了保存就丢。改配置必须写进文档。
9. **`git push` 不触发构建的路径**：`**/*.md`、`sync/**`、`.github/**` 在 `paths-ignore` 里，纯文档提交不会构建（这是对的）。
10. **kvrocks 的 `DBSIZE` 读 0**：RocksDB 统计延迟，实际 `KEYS *` 有数据，不要被误导。

---

## 七、还没做的事

### 曾有讨论、明确未开工
| 事项 | 为什么值得 | 成本 |
|---|---|---|
| **可观测性**（前端错误 + 播放心跳上报到 `/api/telemetry`） | 现在你报「卡了」只能翻 docker logs 猜；有了才知道真机失败率和首帧耗时 | 低 |
| 分享卡片（`openGraph` / `og:image`） | `layout.tsx` 里一个都没有，发链接给朋友是裸链接 | 极低 |
| 安全响应头（HSTS / `X-Frame-Options` / `Referrer-Policy`） | 实测全缺；不加 CSP，只加这三条 | 极低 |
| 播放失败页可操作化 | 之前截图那个「哎呀，出现了一些问题」页面，没有换源/重试/返回任何出路 | 低 |
| 选集面板打开就定位当前集 | 现在可能从头滚 | 低 |

### 长期挂着、无优先级
- 追剧提醒（B1）、片单（B2）、PWA（B4）、拼音搜索（B5）、观影统计（B6）、一键短链（B8）
- 备份恢复演练 + 异地副本（A2）——备份每天 04:30 在跑，但**从没验证过能不能恢复**
- `README.md` 徽章已同步到 1.6.6，但正文部分描述仍偏旧

---

## 八、接手第一小时

1. `docker inspect -f '{{.Image}} {{.State.Status}}' moontv-core` → 应是 `18a3606b7cdd running`
2. `python3 /opt/upstream-check/check.py` → 面板 `ourVersion 1.6.6 / upToDate true`
3. `bash sync/verify.sh --smoke` → 8 项全 200
4. `git log --oneline -10` → 顶部应是 `ff57061 docs: 纪事补 v1.6.6…`
5. 读 `docs/decisions.md`，**别碰否决清单里的事**
6. `df -h /` 与 `docker images | grep nova-moontv` → 只应有两个 tag
7. 想改代码：先看 `PROJECT-HISTORY.md` 的「踩过的坑」和「版本号规则」，再动手

---

## 九、最后一句

这个站现在的问题不在「技术债」，而在「没有观测数据」——所有优化建议都是靠测接口、翻日志、看截图推出来的。真要再往前走一步，先给它装眼睛（第七节第一条），后面所有决定都会容易得多。
