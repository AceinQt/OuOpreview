# ProjectOUOKIRO 项目索引总览

> 本文件是项目的快速导航地图。**改功能前先在这里查"功能→文件"**，再进对应子系统文件（同目录 `docs/*.md`），可避免全项目搜索、节省大量 token。

## 项目是什么

一个纯前端单页手机 App（无构建/无框架/无 ES module），模拟"角色扮演手机"：和 AI 角色聊天、角色记忆、偷看角色手机、学习测验、社区喵坛、像素 RPG 游戏等。所有代码为经典 `<script>` 全局函数，靠全局变量 + `typeof` 防御式互调。

## 入口与加载顺序

`index.html`（~7400 行，含全部页面 DOM）按依赖顺序用 `<script>` 引入所有 JS；**`js/main.js` 是唯一的应用入口**。加载顺序：`core`（globals→database→lazy_load→utils）→ `api` → 各功能文件 → `main.js`。

启动：`main.js` 的 `init()` 里先 `loadData()`(database.js 把 Dexie 表读进内存 `window.db`) → 按 `typeof xxx === 'function'` 逐个 `setupXxx()`（只绑 DOM 事件）→ `switchScreen('xxx-screen')` 进入页面（页面由各模块的 MutationObserver 或路由驱动渲染）。

## 目录结构（子系统）

| 目录 | 子系统 | 详细索引 |
|---|---|---|
| `js/core/` | 基础设施：globals 全局状态、database 数据库中枢、lazy_load 懒加载、utils 工具 | [system_other.md](docs/system_other.md) |
| `js/api/` | 第三方 API 层：llm_client（文本 LLM 统一层）/ weather / tts（语音统一层）/ github_repo / image_generation | [system_other.md](docs/system_other.md) |
| `js/chat/` | 聊天（最大模块） | [chat.md](docs/chat.md) |
| `js/study/` | 学习：书架/阅读/题库/考卷/番茄钟 | [study.md](docs/study.md) |
| `js/summary/` | 角色记忆摘要（短期/长期/日记 + 向量检索） | [peek_summary.md](docs/peek_summary.md) |
| `js/peek/` | 偷看角色手机（9 个伪 App） | [peek_summary.md](docs/peek_summary.md) |
| `js/forum/` | 社区喵坛 | [system_other.md](docs/system_other.md) |
| `js/rpg_game.js` | 像素风 JRPG 游戏（6842 行） | [system_other.md](docs/system_other.md) |
| `js/settings/` | 设置页（API/备份/存储/定制等） | [system_other.md](docs/system_other.md) |
| `js/home.js` `js/world_book.js` `js/main.js` | 主屏桌面 / 世界书管理 / 应用入口 | — |
| `js/lib/` | 第三方库本地副本（dexie / dompurify / marked），**不是本项目代码，不要改里面的文件**。文件名带版本号，由 `sw.js` 的 `js/lib/` 例外走缓存优先，保证离线可用；升级＝下新文件 + 改 `index.html` 的文件名。echarts 已移除（此前只为存储备份页一个环形饼图撑场，现该页用 `data_storage.js` 里手写的 SVG 环形图） | — |

CSS 对应：`css/pages/chat/`、`css/pages/study/`、`css/pages/forum.css`、`css/pages/rpg_game.css`、`css/pages/peek.css`、`css/pages/summary.css`、`css/pages/settings/`、`css/pages/home.css` 等。

## 数据库（Dexie / IndexedDB，库名 `QChatDB_ee`，当前 v16）

中枢在 `js/core/database.js`（1150 行）。运行时读写模式：**热数据由 `loadData()` 全量读进内存 `window.db`，写时内存+Dexie 双写**；大表（messages）走懒加载。

| 表 | 用途 |
|---|---|
| `characters` / `groups` / `userPersonas` | 角色 / 群聊 / 用户人设 |
| `worldBooks` / `myStickers` | 世界书 / 表情包 |
| `globalSettings` (key-value) | 全部全局设置（白名单项） |
| `messages` | 聊天消息（v13 加 `[chatId+timestamp]` 复合索引） |
| `memories` / `memoryChunks` | 记忆总结条目 / 向量切块 |
| `voiceClips` + `voiceClipData` | 语音元数据 / 音频字节（LRU） |
| `imageCache` | 图片本地缓存字节（不随备份导出） |
| `peekData` | 角色手机数据（按 charId） |
| `forumPosts` / `forumMetadata` | 论坛帖 / 论坛元数据 |
| `rpgProfiles` | RPG 存档 |
| `studyBooks/Contents/CoreadMessages/PageCache/Questions/Records/Banks/Exams/ExamRecords/BookSummaries` | 学习模块 10 张表 |

常用全局状态（挂 `window`）：`db`（内存库）、`dexieDB`、`currentChatId/currentChatType`、`switchScreen()`、`AppUI`、`showToast`。仅两个 IIFE 命名空间：`window.NotifyCenter`、`window.PushNode`。

## 全局约定

- 无 run() 入口，顶层 `function` 即全局函数；跨文件 `typeof fn === 'function'` 防御式互调。
- 页面初始化统一 `setupXxx()`（事件绑定，一次），打开页面 `openXxxScreen()` / `switchScreen()`。
- `_xxx` 下划线前缀 = 模块内部函数。

## 功能 → 文件速查表（改功能先查这里）

> 我要实现/修改某个功能时，先在此定位文件，再进入 docs 看细节。

| 想改的东西 | 去哪些文件 |
|---|---|
| **聊天气泡渲染/样式** | `js/chat/chat_bubble_factory.js` + `js/chat/bubble_css_preset.js` + `js/chat/chat_room.js` + `css/pages/chat/chat_room.css` |
| **聊天主页面 / 消息列表 / 分页** | `js/chat/chat_room.js`（渲染游标 `_renderTopCeil/_renderBottomFloor`）、`js/chat/chat_list.js` |
| **消息长按菜单 / 编辑 / 撤回 / 多选** | `js/chat/chat_actions.js` |
| **AI 回复生成 / 发送流程** | `js/chat/chat_ai_service.js`（`getAiReply`）+ 提示词 `js/chat/private_prompt.js`（私聊）/`group_prompt.js`（群聊）/`proactive_prompt.js` |
| **AI 服务商/模型/key 设置** | `js/settings/api_settings.js`（chat/embedding tab）。**加新服务商**只需改 `js/api/llm_client.js` 的 `buildLLMRequestTarget`/`llmIsGeminiShape` + `CHAT_PROVIDER_URLS` 一条 + `index.html` 一个 `<option>`。**模型下拉的候选清单随预设走**（`modelList` 字段），拉不动接口时点 select 右边方块按钮手改，不用改代码 |
| **角色/群/人设编辑页** | `js/chat/char_info.js`、`group_info.js`、`user_info.js`、`group_settings.js`、`char_import.js`（角色卡导入） |
| **图片生成（AI 生图）** | 业务 `js/chat/chat_image_service.js` + 存储 `js/chat/chat_image_store.js` + 绑定UI `js/chat/chat_image_settings.js` + API `js/api/image_generation_api.js`。两家服务商：**vertexExpress**（Google 直连，原生 `generateContent`，图文同轮，只有一条路）；**openai 兼容**下**有参考图走 `/chat/completions`（只有这条路能带图），没参考图走 `/images/generations`** |
| **语音消息（TTS）** | 业务 `js/chat/chat_voice_service.js` + 播放 `js/chat/chat_voice_player.js` + 存储 `js/chat/chat_voice_store.js` + API `js/api/tts_api.js`。**加新语音服务商**只需在 `tts_api.js` 的 `TTS_PROVIDERS` 加一条 + 写一个 `_synthesizeXxx`；Key/地址/模型/语速/音调都在单条音色预设里 |
| **语音设置侧栏（音色 + 语气）** | `js/chat/chat_voice_settings.js` + `index.html` 的 `#voice-setting-modal`。侧栏「语音」**一行**点开折叠弹窗（同图像生成那套），下面挂两个性质不同的旋钮：**音色** `voicePresetId`（TTS 层，花钱）+ **语气要求** `voiceTonePrompt`（注入语言模型，一个字都不进 TTS 请求；空=不注入）。群聊传 `includePreset:false`——群里音色按成员选（`group_settings.js` 成员编辑弹窗），群级只有语气。提示词句子只在这个文件里定义一次，`private_prompt.js` / `group_prompt.js` 都调 `buildVoiceTonePromptLine` |
| **表情包/贴纸** | `js/chat/chat_feature_sticker.js` |
| **通话（语音/视频）** | `js/chat/chat_feature_call.js` |
| **转账/位置/时间跳过/图片识别** | `js/chat/chat_feature_basic.js`。⚠️「赠送礼物」发送入口已删（被分享卡片顶替），但**历史礼物消息的渲染/解析全套保留**（气泡 `chat_bubble_factory.js` 的 gift-card、`chat_room.js` 的已接收礼物回执、AI 主动送礼的提示词还在 `proactive_prompt.js`/`peek_core.js`），别当死代码清掉 |
| **分享卡片（万能：喵坛帖/文件/链接/商品）** | 格式与解析 `js/chat/chat_feature_share.js`（**唯一一份**，构建/解析/多行抠取都在这）+ 气泡 `chat_bubble_factory.js` + 样式 `css/pages/forum.css`（class 名带 `forum-` 是历史包袱）+ 喵坛入口 `js/forum/forum_share.js`。三个来源共用一套格式：+ 号面板手动发、AI 自己发（提示词里教了）、喵坛帖子分享。消息里**存全文**，卡片上的省略靠 CSS `line-clamp`；`js/chat/chat_ai_service.js` 里 AI 回复的抠取必须调 `maskShareBlocks`/`extractShareBlocks`，别自己写正则（正文含 `]` 会截半截） |
| **主动/定时消息、后台保活、离线模式** | `js/chat/chat_feature_proactive.js`、`chat_feature_offline.js`、`notification_center.js`、`push_node.js` |
| **Web Push 推送节点** | `js/chat/push_node.js` + `push-worker/` + `sw.js` |
| **聊天搜索（关键词/日期）** | `js/chat/chat_search.js` + `js/chat/chat_room.js` |
| **聊天天气注入** | `js/chat/chat_weather_context.js` + `js/api/weather_api.js` |
| **角色记忆（聊天注入历史）** | `js/summary/memory_retrieval.js`（构建接入上下文）、`js/summary/memory_vector.js`（向量化） |
| **记忆日记/总结列表页** | `js/summary/summary_init.js` + `summary_generate.js` + `summary_list.js` + `summary_render.js` |
| **偷看角色手机（9 个伪 App）** | `js/peek/peek_core.js`（入口/清单）+ 各 App 单独文件 + `peek_batch.js`（批量生成） |
| **学习首页 / 书架 / 阅读器** | `js/study/study_home.js`、`study_bookshelf.js`、`study_sidebar.js` |
| **章节总结（笔记）** | `js/study/study_summary.js` |
| **共读** | `js/study/study_coread.js` |
| **题库 / 考卷 / 答题 / AI 批改** | `js/study/study_bank.js`、`study_test.js`、`study_ai.js`、`study_db.js` |
| **番茄钟** | `js/study/pomodoro.js` |
| **论坛喵坛** | `js/forum/forum_core.js` + `forum_api.js` + `forum_generation.js` + `forum_render.js` + `forum_detail.js` + `forum_me_page.js` + `forum_bindings.js` + `forum_favorites.js` + `forum_share.js` |
| **像素 RPG 游戏** | `js/rpg_game.js`（单文件 6842 行） |
| **主屏桌面/图标/小组件** | `js/home.js` + `js/core/globals.js`(defaultIcons/defaultWidgetSettings) + `js/settings/customize.js` |
| **世界书管理** | `js/world_book.js` |
| **备份/恢复/云端备份** | `js/settings/backup_data.js` + `js/api/github_repo_api.js` + `js/settings/github_repos.js` |
| **存储占用分析页** | `js/settings/data_storage.js` |
| **数据懒加载（消息/论坛窗口）** | `js/core/lazy_load.js` |
| **运行状态/重启原因诊断** | `js/core/restart_diag.js`（必须第一个加载才能读到 `document.wasDiscarded`；手机上点「系统日志」页右上角圆形按钮，电脑控制台用 `OuODiag.report(n)` / `summary()` / `now()`） |
| **页面路由/弹窗/工具** | `js/core/utils.js`（`switchScreen`/`AppUI`/`showToast`） |
| **安卓返回键/滑动手势/安全区/屏幕适配** | `js/settings/system_back.js`、`swipe_back.js`、`safe_toggle.js`、`screen_adapt.js` |
| **全局字体/壁纸/自定义 CSS** | `js/settings/font_settings.js`、`wallpaper.js`、`customize.js` |
| **版本号/更新日志/教程** | `js/settings/update_log.js`（硬编码 Q.2.0）、`sw.js`（CACHE_NAME 是全站版本号唯一来源）、`tutorial.js` |

## 各子系统详细索引

- [聊天子系统](docs/chat.md)
- [学习子系统](docs/study.md)
- [偷看手机 + 记忆摘要](docs/peek_summary.md)
- [基础设施/设置 + 社区 + 游戏 + 主页](docs/system_other.md)
