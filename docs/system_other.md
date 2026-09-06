# 基础设施 / 设置 / 社区 / 游戏 / 主页 索引

> 覆盖：`js/core/`（全项目地基）、`js/api/`（第三方 API）、`js/settings/`（设置页）、`js/forum/`（社区喵坛）、`js/rpg_game.js`（游戏）、`js/home.js`/`js/world_book.js`（主屏/世界书）。这些文件被整个项目共用。

## 一、基础设施 `js/core/`

| 文件 | 职责 / 关键函数 |
|---|---|
| **globals.js** (105) | 全项目全局状态（全挂 `window`）：`MESSAGES_PER_PAGE=50`、导航/聊天/多选/世界书/番茄钟/表情包/Peek/RPG 状态变量、6 个 SVG 图标、`defaultIcons`(16 应用图标)、`defaultWidgetSettings` |
| **database.js** (1150) | **Dexie 数据库中枢**：库 `QChatDB_ee` v7–v16 共 10 代迁移、`loadData`/`saveData`、约 40 个分表读写函数（`saveSinglePost`/`saveForumMeta` 等）。全部表见主 INDEX.md |
| **lazy_load.js** (516) | 消息/论坛懒加载引擎：每会话只载最近 1500 条、论坛只载窗口；上下翻页、搜索定位、乱序自检。`fetchOlderForumPosts`/`fetchAroundMessage`。`LAZY_LOAD`/`LAZY_FORUM` 默认开，localStorage 设 '0' 紧急回滚 |
| **utils.js** (1078) | 通用工具：`switchScreen`(路由切换)、`showToast`/队列、`setAndroidThemeColor`、`compressImage`、`copyTextToClipboard`、`AppUI`(alert/confirm/prompt/**promptMultiline**/select/form 弹窗族；`promptMultiline` 是 textarea 版 prompt，回车换行、Ctrl/Cmd+Enter 提交，清单类长文本用它)、`AppHelp`、base64 编解码、`historyToPlainText`、`getRandomValue` |

## 二、第三方 API 层 `js/api/`

| 文件 | 职责 |
|---|---|
| **llm_client.js** | 文本 LLM 统一适配层：`callLLM()` 吃 OpenAI 形状 messages，SSE 解析与 finishReason 归一都在这里。三家 provider 的差异只在两个函数：`buildLLMRequestTarget()`（端点 + 鉴权头，**加新 provider 只改这里**）和 `llmIsGeminiShape()`（请求/响应体形状）。`gemini` 与 `vertexExpress` 体形状相同、只差端点与鉴权（前者 `?key=` query，后者 `x-goog-api-key` 头）；vertexExpress 填了 Project ID 会钉定 `projects/{id}/locations/global/...`（留空则区域由 Google 自选，部分模型 404），模型清单内置在 `VERTEX_EXPRESS_MODELS`（Express 的列模型端点要 OAuth，拉不动）。测试见 `tests/llm_client.test.cjs` |
| **weather_api.js** | 和风天气：Host/Key 校验、地点预设、每日 800 次额度计数与预扣、实况/24h/城市查询 |
| **tts_api.js** (912) | 语音合成统一层，**豆包 + MiniMax** 两家：凭据/API 地址/模型/语速/音调/Group ID 全在**单条音色预设**里（同生图预设，不再有全局 Key），按秒配额"预扣+校正"、并发 2 限流。豆包鉴权走 `?api_key=`（X-Api-Key 不在其 CORS 白名单）、MiniMax 走 `Authorization` 头且**业务错误码藏在 HTTP 200 的 `base_resp.status_code` 里**、音频是 hex；MiniMax 的 `GroupId` 是选填（实测官方端点不带也能过鉴权），填了才拼进 query。**音调两家同刻度（整数半音 -12~12）但字段名不同**（豆包 `audio_config.pitch_rate` / MiniMax `voice_setting.pitch`），且**为 0 时整个字段不发**，让没调过的请求和加这个功能之前逐字节一致。**这一层不管语气**——语气是注入给语言模型的，见 `chat_voice_settings.js`。加一家只改 `TTS_PROVIDERS` + 写一个 `_synthesizeXxx`。测试见 `tests/tts_api.test.cjs` |
| **github_repo_api.js** (485) | GitHub Contents API：仓库定义/用途绑定（backup/voice/image 三用途）、带超时重试、上传下载连通检查、旧 config 迁移 |
| **image_generation_api.js** | 图像生成：`IMAGE_PROVIDERS` 两家（预留 NAI 等）、生图预设归一化 `resolveImagePresetForChat`、`generateImage`。**vertexExpress**（Google 直连）走 Gemini 原生 `generateContent` + `x-goog-api-key`，`responseModalities` 必含 IMAGE（不给只回文字），图从 `inlineData` 直接取字节，参考图就是同轮多一个 inlineData part（不分流）；UI 那个像素 size 换算成 `imageConfig` 的 `imageSize`（只用 1K/2K —— 512 仅 flash-image 支持、4K 又贵又慢）与最接近的合法 `aspectRatio`（Gemini 不认 7:4 这种）。**openai 兼容双端点：有参考图走 `/chat/completions`（多模态，唯一能带图的路），没参考图走 `/images/generations`**；中转站返图位置各家不同，靠 `_findImageInChatResponse` 递归识别。测试见 `tests/image_generation_api.test.cjs` |

## 三、设置页 `js/settings/`

| 文件 | 职责 / 关键函数 |
|---|---|
| **api_settings.js** (2524) | **API 设置总页**：描述符驱动的 chat/embedding 预设 CRUD(`API_TAB_DEFS`) + 天气/语音/图像 tab；模型拉取/测试/导入导出。管理：chat(服务商/url/key/model/流式/温度)、embedding、weather、voice(音色预设：服务商/地址/key/Group ID/模型/音色 ID/语速/音调，**Key 随预设走**；切服务商由 `_applyVoiceProviderToForm` 自动填官方地址 + 改模型/Group 行显隐与语速音调 min/max，**加载预设时不能传 `autofillUrl`**否则冲掉中转地址；**切服务商时语速回默认、音调若新刻度装得下则原样保留**)、image(apiUrl/key/预设)；图像 tab 模型为 select，支持 `fetchImageModels` 拉取（失败可手动填）。**模型下拉的候选清单随预设走**：字段 `modelList`（描述符里 kind=`modelList`，必须排在 `model` 前面，先铺 option 再选中），select 本身就是清单的现场状态，读写走 `_readModelListFromSelect`/`_fillModelSelect`；点 select 右边方块按钮走 `editModelList` 弹多行文本框手改（拉取失败也进这个弹窗）；vertexExpress 点「拉取模型」是把 `VERTEX_EXPRESS_MODELS` **并入**而非替换 |
| **github_repos.js** (430) | GitHub 仓库设置页：仓库增删改 + 用途绑定 select(`GITHUB_PURPOSES`)、连通测试 |
| **backup_data.js** (1836) | 备份/恢复：gzip+base64、JSONL 流式、`GitHubService` 云端备份恢复、`performOptimizedCloudBackup` 每日自动备份。`exportPartialData` 支持单项导出：worldBooks / rpg / forum / personalization / settings / characters / study（**加新分类的导出按钮前必须在这里加 case**，否则点了报「未知分类」） |
| **data_storage.js** (603) | 存储分析页：按 10 类统计 Dexie 占用并渲染图表。顺序/配色/名称三张表由 `dataStorage.categoryOrder` 统一，饼图与详情列表共用 `orderedEntries()` —— **新增分类必须登记进 `categoryOrder`**。顺序按导出关系排（系统设置在首；角色/记忆/角色手机三项一起导出故相邻；本地媒体不导出排末）；配色沿这个顺序做深→浅单色蓝渐变，几个大项在顺序上已被拉开、自然落在渐变的不同段位。系统设置直接遍历 `globalSettingKeys` 白名单统计，加新设置项自动计入 |
| **customize.js** (518) | 自定义页：应用图标替换、首页小组件编辑、全局 CSS 及预设管理(`applyGlobalCss`) |
| **wallpaper.js** (85) | 壁纸上传（压缩存 `db.wallpaper`）+ 首页状态栏/导航栏取色 |
| **update_log.js** (285) | 硬编码版本号(Q.1.8)与更新日志、`checkForUpdates` |
| **tutorial.js** (38) | 教程页：手风琴 + 教程图片列表 |
| **font_settings.js** (41) | 全局字体 URL 设置/恢复默认(`db.fontUrl`) |
| **safe_toggle.js** (50) | 顶部/底部安全区开关（写 CSS 变量 `--safe-top/--safe-bottom`） |
| **screen_adapt.js** (40) | 屏幕自适应：按 360 基准改写 viewport meta 缩放 |
| **swipe_back.js** (166) | 左缘右滑返回手势 + 渐变指示条 overlay |
| **system_back.js** (170) | 安卓系统返回键接管：history 栈镜像（sentinel pushState、弹窗→页面逐层退） |

## 四、社区喵坛 `js/forum/`

| 文件 | 职责 / 关键函数 |
|---|---|
| **forum_core.js** (335) | 论坛主入口 `setupForumFeature()`：分页+滚动加载、懒加载前缀补齐(`window.LAZY_FORUM`)、滚动位置记忆、匿名名"喵叽+4位代号"、自定义 CSS 注入、`setupBottomNavigation`、发帖(落库 `saveSinglePost`)、MutationObserver |
| **forum_api.js** (267) | AI 上下文/请求：`getWatchingPostsContext`、`getForumGenerationContext`(大 prompt)、`_getForumApiConfig`(预设回退全局)、`_forumStreamFetch`(SSE 流式) |
| **forum_render.js** (152) | 列表渲染：`renderHotPosts`(24h 热帖 Top3)、`renderForumPosts` |
| **forum_detail.js** (488) | 详情页：标题/正文/评论、星标收藏、评论回复/删除、删帖、复制、匿名回复 |
| **forum_me_page.js** (414) | "我"页 `setupMePageFeature`：昵称/人设/匿名代号/详情 CSS 编辑、统计、头像 |
| **forum_bindings.js** (210) | 绑定 `setupForumBindingFeature`：世界书/角色/群聊/聊天记录/专属 API 预设，写 `db.forumBindings` |
| **forum_favorites.js** (170) | 收藏/在看 `setupFavoritesFeature`：Tab 切换、批量删除；`window.renderFavoritesList` |
| **forum_share.js** (214) | 分享到聊天 `setupShareModal`：帖子→私聊/群聊 |
| **forum_generation.js** (631) | AI 生成核心：`handleForumRefresh`(AI 刷新新帖)、`handleGenerateComments`(楼层评论)；标签归一化 `normalizeForumTags`(编辑距离容错 `#AUTHOR#/#CONTENT#/...`)、随机网名 |

数据：内存挂在 `db`(`forumPosts`/`forumUserIdentity`/`favoritePostIds`/`watchingPostIds`/`forumBindings`) + Dexie 持久化；懒加载补帖 `window.fetchOlderForumPosts`(lazy_load.js:430)。

**New! 标记**：语义是「你还没看过」，实现是帖子/评论上的 `isNew` 字段，进入详情页即已读（`renderPostDetail` 收尾清标记 + `saveSinglePost` 落盘），与 peek 的红点同一套路。AI 生成的新帖与新评论才带 `isNew`，用户自己发的帖/回复不带。徽章只在论坛主列表显示，收藏页与 24h 热帖榜不显示。旧实现把标记写成标题前缀 `[New!] xxx`、靠下一次刷新遍历内存洗掉，论坛转懒加载后窗口外的帖子永远扫不到，标记只增不减 —— Dexie v17 已全表洗掉该前缀；`forumCleanTitle`(forum_core.js) 保留仅为兼容导入旧备份。

## 五、像素 RPG `js/rpg_game.js`（单文件 6842 行）

- **玩法**：Canvas 2D 像素风双人回合制 JRPG。标题→捏人(P1 主角 + P2 从 `db.characters` 选 AI 伙伴)→序章关卡→之后 AI 生成随机地图+剧情(无限冒险)。
- **核心循环** `RpgGame.loop()`(rAF，`update()` 按 `this.STATE` 分发：STORY/MAP/BATTLE_CMD/BATTLE_TARGET/BATTLE_ANIM/GAME_OVER)→ `updateMap`(移动/碰撞/遇敌 `startBattle`)→回合战斗(`playerTurn`/`enemyTurn`/`executeAction`，异常状态/掉落/升级)→家园系统(家具/商店 `openShop`/背包 `openInventory`)。
- **挂载**：入口 `setupRpgGame()` 懒创建单例 `window.rpgGameInstance`，MutationObserver 在 `#rpg-game-screen` 失活时 `stop()`。
- **全局**：`window.rpgGameInstance`/`rpgSelectedApiPreset`；顶层 `rpgStartNewGame`/`rpgBackToTitle`/`setupRpgCreateScreenLogic`/`rpgFetchAI`/`generateCharaSprite`/`generateMonsterSprite` 等；类 `RpgEntity`/`RpgGame`；常量 `RPG_CONFIG/RPG_ITEMS/RPG_DROP_CONFIG/RPG_ASSETS/RPG_FURNITURE/RPG_STATUS`。存档 `db.rpgProfiles`。

## 六、主屏 / 世界书

| 文件 | 职责 |
|---|---|
| **home.js** (357) | 手机主屏桌面：`setupHomeScreen()`(刷新圆圈背景/签名/INS 小组件/APP 图标)、`bindHomeScreenEventsOnce()`(幂等绑定)、`applyWallpaper`/`applyHomeScreenMode`、`setupInsWidgetAvatarModal`、`updateHomeChatBadge`(未读角标+PWA setAppBadge) |
| **world_book.js** (385) | 世界书管理：`setupWorldBookApp()`(增/编/表单 position before/after/category)、`renderWorldBookList()`(分类折叠)、长按多选批量删除(写 `dexieDB.worldBooks` 并同步 characters/groups 的 worldBookIds)、`renderCategorizedWorldBookList`(供角色编辑/RPG 复用的勾选列表) |

## 七、应用入口 `js/main.js`（670 行）

唯一入口。`init()` 顺序（约 340–425 行）：`loadData()` → 迁移(`migrateVoiceKeysToV2`/`migrateLegacyGithubConfig`) → 安全区/屏幕适配/主题色 → 全局外观(`applyGlobalFont/applyGlobalCss/applyPomodoroBackgrounds`) → **核心 setup：home → characterEdit → chatList → addCharModal → chatRoom → chatSettings → apiSettings → wallpaper → sticker → customize → tutorial → safeToggle/adapt/swipeBack/systemBack** → 预设(api/bubble/globalCssPresets) → 富媒体(voice/photoVideo/…/timeSkip) → worldBook → groupChat → 独立页(checkForUpdates/peek/chatExpansion/memoryJournal/deleteHistoryChunk/forumBinding/forum/shareModal/favorites/storageAnalysis/pomodoro/insWidget/rpgGame/userPersona/groupInfo) → 世界书多选按钮 → storage.persist → `__appInitDone` → 50ms 主动消息检测 → 500ms 淡出启动屏。

`init` 外：`window.load` 注册 sw.js、版本检查、Periodic Sync；`DOMContentLoaded` 解析 `#chat=` hash 冷启动；visibilitychange 隐藏时保存+广播；pagehide 兜底。

**真正的"启动开关"是 main.js 的这串 setup 调用**：新增功能时按同模式加一行 `typeof xxx === 'function' && setupXxx()` 即可。
