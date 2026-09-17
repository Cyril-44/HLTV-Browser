# HLTV 页面结构研究笔记（2026-09-17 实测）

通过无头 Chromium 实地抓取验证。所有时间一律取 `data-unix`（epoch ms），本地渲染。

## 反爬 / 引擎

- `www.hltv.org` HTML 页面：Cloudflare 按 TLS 指纹拦截（plain fetch / curl / got-scraping 全部 403，`/rss/news` 例外）。
- 可行方案：`playwright-core`（无浏览器下载，~14MB）+ 系统浏览器（msedge → chrome → 已装 chromium）。真 Chromium TLS 栈直接通过。
- `data-client-country-iso` 说明 HLTV 按请求方地理渲染 —— 时间文本不可信，只信 `data-unix`。

## /matches

- live 容器：`.liveMatches`（带 `data-scorebot-url`）→ `.match-wrapper`
- 通用：`.match-wrapper` attrs：`data-match-id` `data-stars` `data-event-id` `data-eventtype` `data-region` `lan` `live` `team1` `team2`
- 队伍：`.match-teams .match-teamname`；赛制：`.match-meta`（live 时另有 `.match-meta-live`）；时间：`.match-time[data-unix]`
- 事件名：live/嵌入 `.match-event[data-event-headline][data-event-id]`；upcoming 分组头 `.event-headline-text`
- live 比分占位：`.current-map-score[data-livescore-team]` + `[data-livescore-maps-won-for]`（scorebot JS 填充）

## scorebot（Engine.IO v4 + socket.io，polling 可用）

1. `GET https://scorebot-lb.hltv.org/socket.io/?EIO=4&transport=polling&t=x` → `0{"sid":...,"pingInterval":25000}`
2. `POST ...&sid=` body `40`
3. 订阅列表：`42["readyForScores","{\"token\":\"\",\"listIds\":[id,...]}"]`；单场：`42["readyForMatch","{\"token\":\"\",\"listId\":\"2398090\"}"]`
4. GET 长轮询收帧（多帧以 `\x1e` 分隔）；服务端 `2` → 回 POST `3`
- `score` 事件：`{listId, mapScores:{"1":{firstHalf,secondHalf,overtime,mapOrdinal,scores:{teamId:rounds},currentCtId,currentTId,map:"de_mirage",mapOver}}, wins:{teamId:maps}, forcedLive}`
- `log` 事件（JSON 字符串）：`{log:[{PlayerJoin:{playerName,playerNick}},{MatchStarted:{map}},{Suicide:{playerName,side,weapon}},{RoundEnd:{counterTerroristScore,terroristScore,winner,winType:"Bomb_Defused"}},{PlayerQuit:{...}},...]}`（击杀事件同理由此流下发）
- Node 直连 scorebot 也被 CF 拦 → 所有请求走页面内 `fetch`（浏览器上下文）

## 比赛页 `/matches/<id>/<slug>`

- 头：`.teamsBoxDropdown`：`.dropdownTeam .teamName`、`.time[data-unix]`、`.date[data-unix]`
- vetoes：顺序列表 "1. X removed Y ... was left over"
- 地图：`g-grid maps` 内每图：图名 + 双方分 + 半场 `(7:5; 1:8)` + STATS 链接
- `#scorebotElement` attrs：`data-scorebot-url/-id` `data-team1-name/-id/-logo` `data-team2-*` `data-max-rounds-regulation/-overtime`
- 统计：`#match-stats .stats-content[id="{mapStatId|all}-content"]` → `table.totalstats`（每队一张）
  - 列 class：`.kd.traditional-data`(K-D) / `.kd.eco-adjusted-data`(eK-eD) / `.roundSwing` / `.adr`×2 / `.kast`×2 / `.rating`
  - **传统值与 Eco 调整值都在 HTML**（`.hidden` 显隐切换）
  - 地图 tab：`.stats-menu-link .dynamic-map-name-full`（id 属性 = mapStatId）
  - T/CT 侧数据不在页面，在 `Detailed stats` 子页 `/stats/matches/mapstatsid/<id>/<slug>`
- 阵容：`#lineups`；评论/历史同理新闻页

## /results

- 行：`.result-con > a[href]` → `.team-cell .team1 .team`（胜方 `.team-won`）、`.result-score`（`score-won/lost`）、`.event .event-name`、`.map-text`（bo3）
- 结构：`.tab-content[id=eventId] > .results-holder > .results-sublist`（内含日期头，`data-unix`）

## /events

- 月份分组 `.events-month > .standard-headline`；大赛卡片 `.big-event`（`.big-event-name` `.big-event-location` `.top-team-logos`）；小赛 `.small-event`（内 `table.table` td 按表头 Date/Prize/Type/Teams 对位）

## 赛事页 `/events/<id>/<slug>`

- 信息表：`.event-header-component table.info`：Date（data-unix 双值）、`.prizepool`、`.teamsNumber`、`.location`
- 赛制：`table.formats tr`：`th.format-header` + `td.format-data`
- 队伍：`.teams-attending .team-box`：`.team-name .text`、`.event-world-rank`、`.event-vrs-rank`、`.logo-box img.logo`
- **对阵 JSON**：`.slotted-bracket-placeholder[data-slotted-bracket-json]`（SingleElimination / DoubleElimination8…）
  - round slot matchup：`match{matchId,startTime,numberOfMaps,matchPageURL}` `score{team1Score,team2Score,team1Winner}` `team1/2{type,name,logo{dayLogoURL}}`
- 瑞士轮：`.event-groups-container` `.swiss-visual-column`（标题 0:0/1:0…）
- 关联比赛入口：`/matches?event=<id>`、`/results?event=<id>`

## 新闻

- 列表（首页）：`.standard-list a.newsline.article`：`.newstext` 标题、`.newsrecent` 相对时间、评论数 div
- 文章 `article.newsitem`：`.headline`、`.authorName`、`.date[data-unix]`、`.headertext` 导语、正文 `p.news-block` / `blockquote` / `.image-con picture` / `.audioCon iframe`（Spotify 等）
- 评论：`.forum[data-forum-thread-id]` → `.post`：`.replyNum`、`.fan-con`、`.authorAnchor`、**`.forum-middle` 正文**、`.time[data-unix]`；嵌套 `.children .threading`
