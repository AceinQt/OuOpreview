# 偷看手机 + 记忆摘要 索引 — `js/peek/` `js/summary/`

## 一、记忆摘要模块 `js/summary/`（角色记忆/日记）

> 目的：为角色扮演聊天提供"记忆"——短期总结、长期总结、角色日记（第一人称），供 AI 生成时注入上下文，让角色"记得"过往剧情。

### 文件职责速查

| 文件 | 职责 / 关键函数 |
|---|---|
| **summary_core.js** (56) | 基础：全局状态（Tab/子Tab/详情ID 变量）+ `getCurrentChatObject()` + `getShortSummaryContent()`（从 memoryChunks 拼短期总结正文）。**须最先加载** |
| **summary_init.js** (1000) | 页面初始化主函数 `setupMemoryJournalScreen()`：新建弹窗（按序号/按时间/空白三模式）、向量面板、设置保存、滚动分页监听等全部事件绑定 |
| **summary_generate.js** (961) | AI 生成核心：切块（30 分钟间隔+字数/条数上限）、Prompt 构建（世界书/人设/历史总结注入）、OpenAI 兼容 API 调用、解析 `#CHUNK_BLOCK_N#` 块标签与【标题】【内容】、顺风车主动消息（`SECRET_CHAT` 标签），落库 memories/memoryChunks |
| **summary_render.js** (214) | 渲染层：Markdown 渲染（保护颜文字、泰文分流、加粗、引用高亮）、纯文本渲染、`applyJournalFont()` 动态 @font-face 切换手写字体 |
| **summary_list.js** (1068) | 列表与详情：分页懒加载卡片（每页 15 条）、详情页分流（总结/日记）、总结分块详情、摘要编辑后清除 embedding、二次调用重试失败块、清除孤立切块 |
| **memory_vector.js** (522) | 向量化管理：批量调 embedding API（每批 10 块，含后台保活音频防中断）、统计面板刷新、预览/执行清理（只删 embedding 保文字固善）、重置访问强化计数 |
| **memory_retrieval.js** (343) | 检索与重排：余弦相似度 + Bayesian 乘法锚定重排（时间半衰期、情绪分、访问强化）、`formatRetrievedContext()` 三级注入（高→原文/中→总结全文/低→块摘要） |

### 入口 / 初始化 / 检索
- 入口：聊天室菜单 `memory-journal` 分支（`js/chat/chat_room.js:~1830`）→ `renderMemoryScreen()` + `switchScreen('memory-journal-screen')`。
- 初始化：`main.js:403` `setupMemoryJournalScreen()` 一次性绑定；加载顺序 core → render → list → generate → init。
- 检索：`buildRetrievedMemoryContext(recentHistory, chat)` 被 `js/chat/chat_ai_service.js:689` 在发消息时调用，注入记忆上下文。
- 数据：`memories`（`&id, chatId, memType`，挂回 char/group 的 memorySummaries/memoryJournals/longTermSummaries）+ `memoryChunks`（切块+embedding）。

## 二、偷看角色手机 `js/peek/`（9 个伪 App）

> 真实用途：模拟 AI 角色手机桌面，含 9 个伪 App，内容全部 AI 生成，供玩家窥探角色私密生活，并可触发"顺风车"主动消息。

### 文件职责速查

| 文件 | 职责 / 关键函数 |
|---|---|
| **peek_core.js** (950) | 基础：9 个 App 清单、通用分页器 `window.PeekPager`、多选删除管理器 `PeekDeleteManager`、API 配置/调用、Prompt 上下文、主屏/设置渲染、确认弹窗入口 `setupPeekFeature()` |
| **peek_messages.js** (730) | 角色私信列表与对话详情（向上翻页每页 30 条）、私信内容生成 |
| **peek_album.js** (278) | 相册：按日期分组（从 createdAt/id 时间戳回推）、照片生成 |
| **peek_memos.js** (302) | 备忘录列表/详情/生成（每页 20 条） |
| **peek_cart.js** (241) | 购物车列表渲染与生成（商品含规格/价格） |
| **peek_browser.js** (214) | 浏览器历史列表渲染与生成（标题+URL+批注） |
| **peek_steps.js** (158) | 步数应用：今日步数、进度环、活动轨迹渲染与生成 |
| **peek_drafts.js** (344) | 草稿箱：多条增量存储、旧单条格式自动迁移 |
| **peek_transfer.js** (233) | 中转站（文件传输助手式）渲染与生成 |
| **peek_unlock.js** (502) | 角色社交媒体**小号**（私密账号发帖流），渲染/生成/相对时间格式化 |
| **peek_batch.js** (384) | 一键批量生成：单次 API 调用用 `===APP:xxx===` 分段协议产出全部 App + `===PROACTIVE_MESSAGES===` 顺风车消息，各 App 独立解析容错 |

### 入口 / 初始化 / 存data
- 入口：聊天侧边栏 `#sidebar-peek-btn` 或角色页 `#peek-btn` → `window.openPeekScreen(charId)` → 确认弹窗 → `setupPeekFeature()` 确认回调：设 `activePeekCharId`、初始化 `db.peekData[charId]`、指向 `window.peekContentCache` → `renderPeekScreen()` + `switchScreen('peek-screen')`。
- 初始化：`main.js:401` `setupPeekFeature()`。设置存 `character.peekScreenSettings`。
- 数据：`peekData`（`&charId`）。
- 命名空间：`window.PeekPager`/`PeekDeleteManager`/`peekContentCache`/`activePeekCharId`/`openPeekScreen`/`savePeekData`；`generatingPeekApps` Set 防重复生成。
