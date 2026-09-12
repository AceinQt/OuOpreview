# 学习子系统索引 — `js/study/`

> 学习模块：书架/阅读器 + 章节笔记 + 题库/考卷/AI 批改 + 共读 + 番茄钟。数据层统一走 `study_db.js`。

## 架构分层

```
main.js: StudyModule.renderMain()（study_core.js 导出，唯一模块出口）
    ├─ study_core.js    ← 共享状态 _study、工具栏、事件绑定、注册 _screenEnterHooks
    ├─ study_home.js    ← 学习首页（任务tab）
    ├─ study_sidebar.js ← 学习设置侧栏
    ├─ study_bookshelf.js ← 书架/阅读器/书籍信息
    │     ├─ study_summary.js ← 章节笔记（AI 生成 memorySummaries）
    │     └─ study_coread.js  ← 共读悬浮球
    ├─ study_bank.js    ← 题库管理
    ├─ study_test.js    ← 考卷/答题
    ├─ study_ai.js      ← AI 调用层（生成题目/批改）
    └─ study_db.js      ← 数据层（对 db.* 内存 + dexieDB 双写 CRUD）
pomodoro.js（独立，main.js 直接 setupPomodoroApp()，与 StudyModule 无依赖）
```

加载顺序（index.html）：`study_core → pomodoro → study_home → study_sidebar → study_bookshelf → study_summary → study_coread → study_test → study_ai → study_bank → study_db`。

## 文件职责速查

| 文件 | 职责 / 关键函数 |
|---|---|
| **study_core.js** (147) | 模块基石：`window._study` 共享状态/工具（`h()` 转义、SVG icons）、世界书多选弹窗、`_studyInit()` 一次性绑定、`_screenEnterHooks` 注册；导出 `window.StudyModule.renderMain()` |
| **study_db.js** (284) | 数据层：`saveStudyBook`/`updateStudyBook`/`bulkSaveBankQuestions`/`saveStudyExam`/`saveExamRecord` 等 CRUD，全部 async；删书级联清理 |
| **study_home.js** (166) | 首页：昵称/问候语 + 任务 tab（全部/专注/测试）+ 卡片 `_renderFocusCard`/`_renderTestCard`；`studyRenderHome()` |
| **study_sidebar.js** (106) | 设置侧栏：填值+绑定（昵称/文字 API/向量 API 预设 select）；`studyInitSidebar()`；写 `studySettings` |
| **study_bookshelf.js** (1447) | 书架+阅读器+书籍信息：封面压缩、章节正则、`_splitPages`/`_domSplitPages` 分页、目录 `_buildToc`、书签、续读卡、导入弹窗；入口 `studyRenderBookshelf`/`studyOpenReader`/`studyOpenBookInfo`。**导入支持 `.txt` / `.docx`（docx 走 mammoth），编码可选 UTF-8 / GBK / Big5（TextDecoder），`#imp-file` accept=".txt,.docx"、`#imp-encoding`** |
| **study_summary.js** (661) | 章节总结（笔记）：`studyOpenBookSummary`/`studyRenderBookSummaryScreen`，按章节调 AI 生成 `memorySummaries` |
| **study_coread.js** (905) | 共读悬浮球：`studyEnterCoread`/`studyExitCoread`/`_coreadCharReply`；按书存于 `studySettings.coread[bookId]` |
| **study_test.js** (1669) | 考卷 CRUD/答题/交卷/结果/AI 批改：`studyRenderTest`/`_openExam`/`_submitCurrentQuestion`/`_handInExam`/`_runAnalysis`；入口 `studyInitTest` |
| **study_ai.js** (261) | AI 调用层：`callAI(prompt,{systemPrompt,onStream})` 统一入口（SSE 流式）、`_getStudyApiConfig()` 预设选择、`generateStudyQuestions` 生成题目、`analyzeStudyQuestion` 批改（`#GRADE`/`#ANALYSIS` 解析） |
| **study_bank.js** (949) | 题库管理：三个 screen（详情/单题编辑/新增），AI/导入/手动三种来源；入口 `studyRenderBankPanel`/`studyOpenBank` |
| **pomodoro.js** (810) | 番茄钟：`setupPomodoroApp()` 总入口，任务 CRUD、`startTimer`/`pauseTimer`/`stopTimer`、`getPomodoroAiReply`(陪伴鼓励/戳一戳)、背景自定义 |

## 数据组织（学习数据层级）

**书籍/导入 → 题库(studyBanks) → 题目(studyQuestions) → 考卷(studyExams) → 考试记录(studyExamRecords)**

- 题库 `study_bank.js`，题目三种来源：AI 生成（`generateStudyQuestions`，可选章节/字数范围）、CSV 导入、手动。
- 考卷答题 `study_test.js`，AI 批改走 `analyzeStudyQuestion`（流式，主观题用 `#GRADE/#ANALYSIS` 标签解析），结果页 `_renderExamResultScreen`。
- 番茄钟专注时长累计；"专注"tab 卡片直跳 pomodoro。
- 词语/背题没有独立模块，靠考卷 + 题型 `choice/qa` 实现。

## 数据库表（Dexie，v11 后稳定）

| 表 | 用途 |
|---|---|
| `studyBooks` | 书籍元数据（无 content），含 `lastPage`/`lastReadAt`/`bookmarks`/`memorySummaries` |
| `studyBookContents` | 书籍正文（导入时一次写，体积大） |
| `studyQuestions` | 题目（`type: choice\|qa`） |
| `studyRecords` | 单题学习记录 |
| `studyBanks` | 题库 |
| `studyExams` | 考卷（`bankIds[]`/`drawCount`/`graderCharId` 等） |
| `studyExamRecords` | 考试记录（`status: in_progress\|done`） |
| `studyCoreadMessages` | 共读消息（按 bookId 增删） |
| `studyPageCache` | 分页缓存 |
| `globalSettings` | `studySettings`、`pomodoroTasks`、`pomodoroSettings` |

## 约定
`window._study` 共享状态；`StudyModule.{renderMain}` 唯一出口；公开函数 `studyXxx`、模块内部 `_xxx`；跨 screen 刷新走 `window._screenEnterHooks[screenId]=fn`。
