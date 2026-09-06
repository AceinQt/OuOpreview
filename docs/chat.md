# 聊天子系统索引 — `js/chat/`

> 项目里最大最复杂的模块。聊天全过程：会话列表 → 打开聊天室 → 发消息 → AI 回复 → 气泡渲染 → 富媒体（图片/语音/贴纸/通话）。

## 架构分层（自上而下）

```
chat_list.js(会话列表)──────────┐
chat_room.js(聊天室主控)────────┤ ← 渲染游标 _renderTopCeil/_renderBottomFloor
    ├─ chat_bubble_factory.js ──┤ ← 每条消息→DOM气泡
    ├─ chat_actions.js ─────────┤ ← 长按菜单/编辑/撤回/多选
    ├─ chat_search.js ──────────┤ ← 搜索定位
    ├─ chat_feature_*.js ───────┤ ← +面板及富媒体
    └─ chat_ai_service.js ──────┘ ← AI层(收束所有回复)
          ├─ private_prompt/group_prompt/proactive_prompt(提示词)
          ├─ chat_weather_context(天气注入)
          ├─ chat_voice_service(语音合成) → chat_voice_store
          ├─ chat_voice_settings(语音语气注入，被两个 prompt 文件调用)
          ├─ chat_image_service(生图) → chat_image_store
          ├─ summary/memory_retrieval(记忆检索)
          └─ api/(third-party API层)
```

初始化入口：`main.js` 里 `setupChatListScreen()` → `setupChatRoom()` → `setupChatSettings()` → 各 `setupXxxSystem()`。进入聊天：`openChatRoom(chatId,type)` 起。

## 文件职责速查

| 文件 | 职责 / 关键函数 |
|---|---|
| **chat_room.js** (1879) | 聊天室主控。`setupChatRoom()` / `openChatRoom(chatId,type)` / `renderMessages()` / `loadOlderFromDB`/`loadNewerMessages` / `formatSmartTime` / `processTimePerception`。维护渲染游标。**改聊天 UI/分页/时序逻辑主要在此** |
| **chat_list.js** (876) | 会话列表 + 联系人。`setupChatListScreen()` / `setupAddCharModal()` / `renderContacts`/`renderCharacters`。写 `characters/groups/userPersonas` |
| **chat_bubble_factory.js** (787) | 气泡 DOM 工厂。`createMessageBubbleElement(message)`（时间分割/撤回/引用/贴纸/语音/图片卡） |
| **bubble_css_preset.js** (1210) | 气泡主题/CSS 预设与沙盒预览。`setupBubblePresets()` 等；被 chat_settings 调用 |
| **chat_actions.js** (532) | 消息长按上下文菜单 + 消息操作：`createContextMenu` / `startMessageEdit`/`saveMessageEdit` / `enterMultiSelectMode` / `withdrawMessage` |
| **chat_ai_service.js** (1098) | **核心 AI 层**。`getAiReply(chatId,chatType,…)` / `handleAiReplyContent` / `processStream` / `handleRegenerate` / `getMixedContent`(混合内容标签) / `showApiError` |
| **chat_store.js** (36) | 聊天室统一数据管家（抹平私聊/群聊差异）。`getCurrentChat()` / `getMyIdentity(chat)` |
| **chat_settings.js** (606) | 单聊设置侧栏。`setupChatSettings()` / `saveSettingsFromSidebar` / `updateCustomBubbleStyle` |
| **chat_search.js** (390) | 聊天内搜索。`setupSearchSystem` / `openSearchModal` / `performSearch` / `jumpToMessageInChat`（与分页/merge 配合） |
| **char_info.js** (433) | 角色编辑页 + token 统计。`setupCharacterEditScreen` / `openCharacterScreen` / `renderTokenStats` |
| **user_info.js** (315) | 用户人设编辑页。`setupUserPersonaScreen` / `openUserPersonaScreen` |
| **group_info.js** (528) | 群信息页。`setupGroupInfoScreen` / `openGroupInfoScreen` |
| **group_settings.js** (978) | 群聊创建/侧栏/成员管理。`setupGroupChatSystem` / `saveGroupSettingsFromSidebar` |
| **char_import.js** (287) | 角色卡导入（PNG/JSON）。`handleCharacterImport` / `parseCharPng`/`parseCharJson` → 写 `characters` |
| **private_prompt.js** (286) | 私聊系统提示词：`generatePrivateSystemPrompt(character, retrievedContext, weatherText)` |
| **group_prompt.js** (182) | 群聊系统提示词：`generateGroupSystemPrompt(group, …)` |
| **proactive_prompt.js** (146) | 主动消息专用 prompt：`generateProactivePrivatePrompt`/`generateProactiveGroupPrompt` |
| **chat_weather_context.js** (335) | 天气注入 + 设置对话框。`getWeatherPromptContext(chat)` / `openWeatherSettingDialog` |
| **chat_feature_sticker.js** (673) | 表情包面板/分类/管理。`setupStickerSystem()`。写 `myStickers` |
| **chat_feature_basic.js** (948) | "+"面板杂项：语音文字消息、照片/视频描述、转账、礼物、位置、时间跳过、图片识别(vision)、图片转文字。多个 `setupXxxSystem` + `window.convertImageMessageToText` |
| **chat_feature_offline.js** (161) | 线下模式（仅私聊）。`applyOfflineNarrationCss` / `updateOfflineModeUI`（禁 sticker bar 按钮）/ `isOfflineModeActive`（数据层判断，"+"面板置灰与点击拦截用） |
| **chat_feature_proactive.js** (1463) | 主动/定时消息引擎 + 后台保活音频。`openProactiveMessagingSettings` / `pushProactiveMessage` / `checkAndDeliverProactiveMessages` / `triggerIdleProactiveGeneration` / `window.ensureBgAudioUnlocked` |
| **chat_feature_call.js** (1081) | 语音/视频通话。`startCall` / `endCall` / `showIncomingCall` / `recoverInterruptedCall` / `openCallHistory` |
| **notification_center.js** | IIFE：`window.NotifyCenter`（`openChatFromNotification`/`buildPushPayload`） |
| **push_node.js** (895) | IIFE：`window.PushNode`（CF Worker Web Push，`addTask`/`cancelChat`/`subscribe`） |
| **chat_image_service.js** (695) | 生图业务：`generateImageForMessage` / `prepareImageForMessages`(推气泡前预生成) / `applyPreparedImage` / `queueAutoImageGeneration`(兜底) / `getImageStorageAvailability` / `deleteImageMessageMedia`(删图：**先删云端再删本地**，云端失败即中止；删完摘掉 media，气泡自动退回纯文字+可重新生成) |
| **chat_image_store.js** (550) | 图片字节存储 LRU：`putImageCache`/`getImageCacheBytes`/`enforceImageCacheLimit`（只碰 `imageCache` 表）；末尾还有图片查看器（`openImageViewer`：大图 + 右上角 X + 底部固定工具栏的下载/删除，图裂时下载置灰、删除保持可用） |
| **chat_image_settings.js** (66) | 聊天级生图绑定 UI：`openImageGenerationSettingDialog` |
| **chat_voice_service.js** (428) | 语音业务（不碰 DOM/endpoint，也不认识哪家服务商）：`ensureVoiceClip` / `prepareVoiceForMessages` / `retryVoiceArchive`。自动合成的闸门是 `voicePresetReady(profile)`（逐条预设看有没有 Key + 音色 ID），不是全局 Key |
| **chat_voice_store.js** (457) | 语音存储 LRU（`voiceClips`+`voiceClipData` 两表）：`putVoiceClip`/`getVoiceClipBytes`/`migrateVoiceKeysToV2`。缓存键只认预设 id，所以改语速/音调/换服务商都不会让已有音频作废（要作废得顶 `VOICE_KEY_VERSION`，或用气泡菜单单条重生成）——**所以调完音调想听效果，得对着已有语音单条重生成** |
| **chat_voice_settings.js** (200) | 聊天级语音设置 UI + 语气注入。侧栏「语音」一行点开是折叠弹窗（私聊/群聊共用 `#voice-setting-modal`，同图像那套）：`openVoiceSettingDialog(current, {includePreset})` / `normalizeChatVoiceBinding` / `formatVoiceSettingLabel` / `formatVoiceToneOnlyLabel` / `buildVoiceTonePromptLine`。★ 一行下面挂着两个**性质不同**的旋钮：音色（`voicePresetId`，TTS 层，花钱）+ 语气要求（`voiceTonePrompt`，注入语言模型，不进 TTS 请求）。群聊传 `includePreset:false` —— 群里没有群级音色（按成员选），弹窗把音色那节换成指路说明。语气**空 = 一个字都不注入**；注入的句子只在这个文件里定义一次，私聊和群聊都调同一个函数，两边各抄一份必然静默漂移 |
| **chat_voice_player.js** (487) | 语音气泡播放（唯一碰 DOM 的语音文件）：`handleVoiceBubbleClick` / `regenerateVoiceClip` / `downloadVoiceClip`（状态在 `data-voice-state`） |

## 关键流程

### 气泡生成 pipeline（AI 响应 → DOM）
1. `chat_ai_service.getAiReply()` 发请求（prompt 来自 private/group/proactive_prompt + weather 上下文）。
2. `processStream`/`handleAiReplyContent` 用 `getMixedContent` 切分文本/贴纸/语音段，逐条写入 `chat.history` + `dexieDB.messages`。
3. 完成后调 `renderMessages(false,true)`。
4. chat_room 按渲染游标切片，每条交给 `createMessageBubbleElement` 生成 DOM（语音再经 chat_voice_player 刷新、图片卡经 chat_image_service 回填）。
5. 打字机循环**之前**先 `await prepareVoiceForMessages`(语音) + `await prepareImageForMessages`(生图)：整批语音合成完、那张图画完，才开始逐条推气泡，所以气泡一出现就能播/就是真实图片（等待期间「正在输入中…」一直挂着）。两者都有超时上限且不抛异常，接口挂了照常推消息。生图靠**提前占好消息 id**（缓存键由 id 推导）+ `applyPreparedImage` 装配，超时后由后台补写气泡；`queueAutoImageGeneration` 退化为线下模式/视频通话那一支的兜底。

### 富媒体归属
- **图片**：image_store(字节缓存) → image_service(生成/归档) → image_settings(绑定UI)；气泡渲染在 bubble_factory；vision 识图/图片转文字在 feature_basic；API 在 `api/image_generation_api.js` + `github_repo_api.js`。聊天设了**参考图**（`chat.imageReference`）时 API 层自动改走对话式生图：`/images/generations` 请求体里没有放图片的位置，参考图只能走 `/chat/completions`，且仅对多模态模型（Nano Banana / Gemini 系）有效。两种图片气泡的**右下角动作键统一**：`.pv-card` 放生图键 `.pv-card-generate`，真实图片 `.image-bubble` 放转文字键 `.image-ocr-btn`（都在 bubble_factory 里建；长按菜单里已经没有「转文字」了）。
- **语音**：voice_store → voice_service(合成调度/TTS/云端归档) → voice_player(DOM)；凭据和服务商差异在 `api/tts_api.js`（豆包 / MiniMax，**Key 随音色预设走**，一条预设一把）。
- **贴纸**：feature_sticker（`myStickers` 表）。**通话**：feature_call。**转账/礼物/位置/时间跳过**：feature_basic。

## 持久化
Dexie `QChatDB_ee` v16。热数据 `loadData()` 读进 `window.db`；messages 大表走 `core/lazy_load.js`（每会话最近 1500 条）。localStorage 仅少量开关（`last_proactive_run` 等）。

## 全局状态 / 约定
`window.currentChatId/currentChatType`、`window.db`、`window.dexieDB`、`_renderTopCeil/_renderBottomFloor`。全局函数 + `typeof` 防御互调；仅 NotifyCenter/PushNode 两个 IIFE 命名空间。
