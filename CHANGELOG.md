# Changelog

## 1.0.0 — 2026-09-19

首个正式版。基于 `nextgen` 分支从零重写，全部功能经真实赛事环境验证。

### ✨ 功能

- **侧栏四视图**：Matches / Results / Events / News，比赛行显示 `战队A - 战队B`（赛果含比分）+ 本地日期时间 + 赛事名；大赛（T1）在 Events 中置顶
- **展开详情卡片**：展开某行时才抓取该场比赛页（懒加载），卡片呈现赛制、阶段、逐图比分（含半场分）与 BP 步数；live 比赛卡片实时刷新比分
- **比赛详情页**（编辑器内 webview）：
  - 实时计分板：地图比分、Game log 击杀提示流（文字化）、选手实时数据（$ / K / A / D / ADR / 存活）
  - BP 全过程、地图与半场比分、阵容
  - 选手统计：Both / T / CT 三套内嵌表纯前端切换；Eco-adjusted 开关与网页端同步（K-D / eK-eD / Swing / ADR / eADR / KAST / eKAST / Rating 3.0）
- **赛事详情页**：淘汰赛 / 双败对阵卡片（内嵌 bracket JSON 解析）、瑞士轮分组、参赛战队与世界 / VRS 排名
- **新闻阅读页**：完整正文与评论树；图片及 Twitch / X / Spotify 等嵌入控件默认不加载，右上角按钮一键全部加载 / 关闭（iframe 关闭即销毁）
- **右键菜单**：打开详情页 / 在 HLTV.org 打开
- **中英双语**：界面、命令、设置描述随 VSCode 显示语言自动切换（`package.nls` + 内建字典）

### 🛠 工程与稳定性

- **抓取引擎**：`playwright-core`（不打包浏览器）复用系统 Edge / Chrome / Chrome for Testing（自动发现），完全复刻初代扩展的请求形态 —— 每次导航独立浏览器实例、真实 UA / 本地时区 / 文档级 HTTP 头、零请求拦截、1.5–3s 随机间隔
- **一页一抓**：所有页面会话内至多抓取一次，快照缓存持续到手动刷新 —— 从请求模型上根绝 Cloudflare 风控诱因
- **scorebot 实时通道**：Engine.IO v4 polling 协议自实现；fetch 页驻留 RSS 源（同源 + 凭证 cookie + 免挑战 + 零 JS 线程占用）；全部请求带超时中止
- **Cloudflare 应对**：自动挑战重试梯度 → 干净配置的人工验证弹窗（UA 绑定的 cookie 回放）→ `cfClearance` + `userAgent` 设置逃生通道；`proxyServer` 设置（含环境变量回退）保证验证走与日常浏览器相同的网络路径
- **时间处理**：一律解析 `data-unix` / epoch 时间戳本地渲染；Results 逐行时间戳（`data-zonedgrouping-entry-unix`）

### 📦 打包

- `npx @vscode/vsce package` 一键产出（约 3.5 MB）：cheerio 并入单文件 bundle，仅 playwright-core 整体随包；GPL-3.0 LICENSE

### 已知限制

- 无图形界面的环境（纯 SSH）无法弹出 CF 验证窗口，需等待风控冷却或使用 Cookie 逃生通道
- Cloudflare 对单一 IP 的高频访问仍可能触发临时风控；本扩展的请求模型已将访问量压至最低（每页每会话一次）

---

## 0.1.x（旧版，master 分支）

初代实现，见 master 分支历史。
