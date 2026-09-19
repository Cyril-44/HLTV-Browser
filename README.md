# HLTV Browser (nextgen)

在 VSCode 侧栏中速览 HLTV —— 比赛、赛果、赛事、新闻，全部朴实无华、文字优先。

> 本分支（`nextgen`）为从零重写版本。

## 设计原则

1. **朴实无华**：不使用任何自定义背景与装饰性图标（无 AK 图标、无花哨配色），详情页使用 VSCode 主题原生观感，只展示 HLTV 页面上能看到的信息。
2. **文字优先、媒体统一开关**：默认不发任何图片 / 第三方嵌入（Twitch、X、Spotify……）请求，仅显示文字占位；页面右上角一个按钮统一控制 —— 一键全部加载，再点全部关闭。
3. **时间可信**：HLTV 页面上的时间文本随请求方所在时区变化，因此一律解析页面 `data-unix` / JSON 中的绝对时间戳（epoch），在扩展内转换为用户本地时区显示。
4. **轻量克制**：页面缓存为会话快照（抓一次用到手动刷新）；scorebot 实时流只服务于"正在看"的内容（展开中的卡片 / 打开中的详情页），折叠或关闭即退订。
5. **一页一抓**：每个页面一个会话内至多抓取一次，之后全部走缓存；只有用户点击刷新按钮才会清空缓存重新抓取（沿用初代项目验证过的请求模型，从不触发 Cloudflare 风控）。侧栏仅抓取标题所需的列表页，展开某一项时才抓取该项对应的详情页。

## 功能大纲

### 侧栏结构

活动栏（Activity Bar）注册 `HLTV` 容器，包含四个视图，视图标题栏提供刷新按钮：

```
HLTV
├── Matches   进行中 / 即将开始的比赛
├── Results   已结束的比赛
├── Events    近期赛事（大赛优先）
└── News      最新新闻
```

### Matches（比赛）

- 列表项标题：`战队A - 战队B`，附**本地时区**的开始时间与赛事名。
- **单击展开详情卡片**（树内子节点，展开时才抓取该场比赛页）：
  - 赛制（如 `Best of 3 (LAN)`）、阶段（如 Upper bracket quarter-final）、开始时间、赛事名；
  - 地图列表与各图比分（含半场分，如 `Nuke 8 - 13 (7:5;1:8)`）、BP 步数；
  - 进行中的比赛：卡片内**实时更新比分**（scorebot 驱动）。
- **右键菜单**：
  - `打开详细页面` —— 在 VSCode 编辑器区域打开比赛详情页；
  - `在 HLTV 打开` —— 用系统浏览器打开对应 `hltv.org` 链接。
- **比赛详情页**（编辑器内 webview，纯文字、无背景）：
  - 基本信息区：双方、赛制（如 `Best of 3 (LAN)`）、时间、赛事、阶段（如 Semi-final）；
  - **BP / Veto 过程**（如 `1. Vitality removed Ancient` … `Inferno was left over`）；
  - 地图区：每图比分含半场分（如 `Dust2 13 - 11 (8:4; 5:7)`）；
  - 进行中：**实时计分板** —— 击杀提示（kill feed，文字化呈现）与选手实时数据，随轮询刷新；
  - 已结束：每张已结束的地图可展开**选手数据表**（K-D、ADR、KAST、Rating 3.0，及其 Eco 调整版本 eK-D / eADR / eKAST / Swing），筛选与网页端同步：阵营 `Both / T / CT`、地图 `All / 单图`、`Eco-adjusted` 开关。

### Results（赛果）

- 列表项标题：`战队A 2 - 0 战队B`（横杠两边显示比分；BO1 显示地图比分如 `13 - 9`，弃权标记为 `def.`），附时间与赛事名。
- 单击展开详情卡片：赛制、地图与各图比分。
- 右键菜单与详情页同 Matches（无实时部分），头部另有 HLTV 的 Featured Results 置顶逻辑。

### Events（赛事）

- 列表排序：**进行中赛事（Ongoing，带 ● LIVE 标记）置顶**，其后为 T1 级大赛（HLTV 卡片式 Featured 赛事）、小赛事，各自按时间排列。
- 列表项：赛事名 + 日期区间 + 类型（Intl. LAN / Reg. LAN / Online 等）。
- **单击展开**：该赛事当前的相关 Matches（复用 Matches 的卡片与详情视图，接入统一的数据层）。
- **右键 → 赛事详情页**：
  - 赛事格式卡片：瑞士轮 / 双败淘汰 / 单败淘汰等阶段结构；
  - 参赛战队、奖金池、地点、日期等（均为 HLTV 页面可见信息）；
  - 战队**默认不显示图标**，右上角"加载战队图标"按钮统一开关（一键全部加载 / 全部关闭）。

### News（新闻）

- 列表：最近新闻，标题即 HLTV 原文标题。
- **右键菜单**：`查看详细页面` / `在 HLTV 打开`。
- **新闻详情页**：完整的 HLTV 新闻页面（文字版）：
  - 标题、正文正常渲染；
  - 图片与第三方嵌入控件默认不加载，仅显示文字占位说明（如"[图片：xxx]"、"[嵌入：Twitch 直播]"）；右上角"加载媒体"按钮一键全部加载、再点全部关闭；
  - 评论区正常显示。

## 架构

### 总体分层

```
┌───────────────────────────── VSCode ─────────────────────────────┐
│  views/（四个树视图）      detail/（编辑器内 webview 详情页）          │
│      │                        │                                    │
│      └──────────┬─────────────┘                                    │
│             hltv/ 数据层（api + 解析器 + 会话快照缓存）                │
│                 │                                                  │
│             engine.ts 浏览器引擎（playwright-core + 系统浏览器）      │
│                 │                                                  │
│             scorebot.ts（Engine.IO v4 polling，实时比分/击杀流）      │
└────────────────────────── hltv.org ───────────────────────────────┘
```

- **浏览器引擎而非 HTTP 客户端**：HLTV 全站（除 RSS）按 TLS 指纹拦截非浏览器请求（实测 plain fetch / curl / got-scraping 全部 403），因此数据层基于 `playwright-core`（约 14MB 纯 JS，**不打包浏览器**）驱动系统已装的 Edge / Chrome / Chromium（可在设置 `hltv.browserPath` 指定），Windows 用户零额外下载。
- **完全复刻初代引擎的请求形态**（实测从不触发风控）：每次导航都使用**全新浏览器实例**、用完即关（天然串行、天然间隔、无状态污染）；上下文带真实 UA（读取二进制自带 UA 并清洗 headless 标记）、**真实本机时区**（UTC 与 CN IP 不符是典型机器人信号）、1440x1200 视口、文档级 HTTP 头（Accept / Accept-Language / Upgrade-Insecure-Requests）；**零请求拦截**（拦截子资源会破坏 CF 挑战页自身的探测脚本）；导航间 1.5–3 秒随机礼貌间隔。
- **scorebot 直连**：实时比分/击杀流/选手实时数据通过 HLTV 自家的 socket.io（`scorebot-lb.hltv.org`，Engine.IO v4 polling 传输）订阅 —— 以页面上下文 fetch 发起（CORS 放行），单场用 `readyForMatch`、列表用 `readyForScores`。
- **一页一抓**：页面一个会话内至多抓一次，缓存用到手动刷新；导航全串行且保持 ~1.5s 礼貌间隔。
- **实时按需**：树节点展开或详情页打开时才订阅 scorebot，折叠 / 关闭即退订（scorebot 走独立 socket，不产生页面请求）。
- **媒体策略集中实现**：webview 统一输出占位符，右上角按钮一键全部加载 / 全部关闭。

### 目录结构（实际实现）

```
src/
  extension.ts              # 入口：视图注册、命令、菜单
  hltv/
    engine.ts               # playwright-core 浏览器引擎（挑战重试/限速/资源拦截）
    api.ts                  # 高层 API（会话快照缓存，手动刷新清空）
    cache.ts                # 带 in-flight 去重的快照缓存
    scorebot.ts             # Engine.IO v4 polling 客户端（score/log/scoreboard）
    types.ts                # 领域模型
    parse/
      matches.ts            # /matches：live + upcoming
      results.ts            # /results
      events.ts             # /events：大赛卡片 + 小赛行
      matchPage.ts          # 比赛页：BP/地图比分/统计表(含 Eco 列)/阵容/scorebot 属性
      eventPage.ts          # 赛事页：信息表/赛制/队伍/bracket JSON/瑞士轮
      news.ts               # 首页新闻列表 + 文章正文块 + 评论树
  views/
    common.ts               # MatchNode（标题 "A - B"、展开卡片、live 比分）
    matchesView.ts resultsView.ts eventsView.ts newsView.ts
  detail/
    webviewCommon.ts        # 朴实无华的共享外壳（仅 VSCode 主题变量）
    matchPage.ts            # 实时计分板/击杀流/地图统计 + Both·T·CT·Eco 筛选
    eventPage.ts            # 赛制/对阵卡片/战队（图标按需开关）
    newsPage.ts             # 正文/评论/图片与嵌入控件按需加载
  util/time.ts
scripts/
  parse-check.ts            # 开发用：对保存的 HTML 快照回归验证解析器
  e2e.ts e2e-scorebot.ts    # 开发用：真实引擎 + 真实网络的端到端测试
docs/research-notes.md      # HLTV 页面结构与 scorebot 协议研究笔记
```

### 关键技术决策

| 议题 | 决策 |
| --- | --- |
| 反爬 | Cloudflare 按 TLS 指纹拦截 → playwright-core + 系统浏览器（真 Chromium TLS 栈）；导航串行 + 礼貌间隔 + 挑战重试梯度 + **会话级快照缓存（仅手动刷新清空）** |
| 时区 | 只解析 `data-unix` / epoch，本地渲染（HLTV 显示文本随请求方地理/时区设置变化，不可信） |
| 实时数据 | scorebot socket.io polling：`score`（比分/半场/胜负）、`log`（击杀流，如 `ZywOo 击杀 mo0N [ak47] (HS)`）、`scoreboard`（选手实时 $/K/A/D/ADR/存活） |
| 选手统计 | Both / T / CT 三套表与传统 / Eco 调整两套列**全部内嵌于比赛页 HTML**（网站本身就是纯前端显隐切换），切侧零网络请求 |
| 对阵卡片 | 直接解析赛事页内嵌的 `data-slotted-bracket-json`（淘汰赛/双败完整对阵+比分+比赛链接） |
| 详情页载体 | webview panel；样式仅用 VSCode 主题 CSS 变量，零自定义背景、零装饰图标 |
| 媒体加载 | 默认零图片零嵌入请求；右上角按钮统一控制，一键全部加载、再点全部关闭（含赛事页战队图标） |

## 里程碑

- [x] **M0** 项目脚手架（TS + esbuild + F5 调试）
- [x] **M1** 数据层：浏览器引擎 + Matches / Results / Events / News 解析（对真实页面快照回归验证）
- [x] **M2** 侧栏四视图 + 刷新 + 右键"在 HLTV 打开"
- [x] **M3** 树内详情卡片（赛制 / 时间 / 地图 / live 比分实时更新）
- [x] **M4** 比赛详情页：地图选手统计（Both / T / CT / Eco-adjusted）
- [x] **M5** 实时：live 比分卡片 + 详情页实时计分板（击杀流 + 选手实时数据）
- [x] **M6** Events：大赛置顶、赛程下钻、赛事详情页（对阵卡片/瑞士轮/战队图标开关）
- [x] **M7** News 详情页：按需媒体加载 + 评论区

> 实时数据通道（scorebot）与全部页面解析已通过真实网络端到端验证（2026-09-18，含 live 比赛的击杀事件与选手实时表）。

## 使用前提

扩展需要一个 Chromium 系浏览器用于抓取（Cloudflare TLS 指纹要求），按以下顺序自动发现：

1. 设置 `hltv.browserPath` 指定的浏览器；
2. 系统 **Microsoft Edge** / **Google Chrome**（Windows/macOS 常见）；
3. **Chrome for Testing**（`npx @puppeteer/browsers install chrome@stable` 安装，自动扫描 `~/.cache/puppeteer` 与 `~/chrome`，取最新版本）；
4. Playwright 管理的 Chromium（`~/.cache/ms-playwright`）。

频繁大量访问可能触发 Cloudflare 对本机 IP 的临时风控。此时扩展会先走自动重试梯度（同页 reload → 换新上下文）；若挑战仍不消解（IP 级标记），会**自动弹出浏览器窗口**（干净配置：无自动化标志、真实 UA），请在其中完成 Cloudflare 人机验证 —— 通过后窗口自动关闭，`cf_clearance` cookie 连同验证时的 UA 一起注入回无头引擎并继续加载（cookie 与 UA 绑定，必须成对使用）。无图形界面的环境（纯 SSH 等）无法弹窗。

**验证弹窗的浏览器必须能连通 `challenges.cloudflare.com`** —— 如果你的正常浏览器是走代理打开 HLTV 的，请把代理地址填入设置 `hltv.proxyServer`（如 `http://127.0.0.1:7890`，留空则回退到 `HTTPS_PROXY`/`HTTP_PROXY` 环境变量），否则验证流程会因网络不通而无限循环。

若 IP 已进入"挑战循环"（连真人验证也立即失效），两条路：

1. **等待冷却**（通常数小时至一天）；
2. **逃生通道**：用日常浏览器（信誉良好、可正常打开 hltv.org，且与扩展共用同一公网 IP）复制通行证：
   - F12 → Application（应用）→ Cookies → `https://www.hltv.org` → 复制 `cf_clearance` 的值 → 填入设置 `hltv.cfClearance`；
   - F12 → Console 输入 `navigator.userAgent` → 复制完整 UA 串 → 填入设置 `hltv.userAgent`（两者必须来自同一浏览器，cookie 只在 UA 匹配时有效）。

## 开发

```bash
npm install
npm run compile   # 类型检查 + 打包到 dist/
```

在 VSCode 中按 `F5` 启动扩展开发宿主（会自动启动 `npm: watch` 构建任务）。

| 脚本 | 说明 |
| --- | --- |
| `npm run watch` | 增量构建，配合 F5 调试 |
| `npm run typecheck` | 仅类型检查 |
| `npm run package` | 生产压缩打包（供 `.vsix` 打包用） |

开发辅助：`scripts/parse-check.ts`（对 `docs/research-notes.md` 所述页面快照做解析回归）、`scripts/e2e.ts`（真实引擎端到端，需本地 Chromium）。

## 打包与安装（.vsix）

```bash
npm install                # 首次或依赖变更后
npx @vscode/vsce package   # 打包
```

打包会自动先执行 `vscode:prepublish`（即 `npm run package`：TypeScript 类型检查 + esbuild 生产压缩），产物为项目根目录的 **`hltv-browser-vscode-extension-<version>.vsix`**（约 3.5 MB，已验证）。

体积构成：

- `dist/extension.js` —— 单文件 bundle，cheerio 等纯 JS 依赖已并入；
- `node_modules/playwright-core/` —— 唯一整体保留的依赖（运行时要启动浏览器进程，不能 bundle）；
- `resources/icon.svg`、`README.md`、`LICENSE`。

`scripts/`、`docs/`、`.agents/`、源码与测试快照均由 `.vscodeignore` 排除，不会进入安装包。

**安装**：

```bash
code --install-extension hltv-browser-vscode-extension-0.1.0.vsix
```

或在 VSCode 扩展面板 → `···` → **"从 VSIX 安装…"** 选择该文件。WSL Remote 场景下请在 WSL 侧安装（扩展宿主运行在 Linux）。安装后按 [使用前提](#使用前提) 确认可用浏览器，即可使用。

**发布新版本**：修改 `package.json` 的 `version` 后重新打包；如需发布到 Marketplace，执行 `npx @vscode/vsce publish`（需提前 `npx @vscode/vsce login <publisher>` 配置 Personal Access Token）。
