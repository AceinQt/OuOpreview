// study_db.js — 学习模块数据层
// 操作 window.db 内存对象 + 同步到 dexieDB（精准保存）
// 所有写操作为 async；读操作为同步（直接读内存）
// ★ V8：书籍正文 → studyBookContents 表，共读消息 → studyCoreadMessages 表，分页缓存 → studyPageCache 表
// =====================================================

function _genStudyId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

// ── Books ──────────────────────────────────────────

/**
 * 导入新书：元数据写 studyBooks，正文单独写 studyBookContents
 * book 参数中必须含有 content 字段（原文）
 */
async function saveStudyBook(book) {
  const content = book.content || '';
  const newBook = { ...book, id: _genStudyId('book'), createdAt: Date.now() };
  // 元数据不含正文
  delete newBook.content;
  delete newBook.coreadMessages; // 防御旧数据混入

  db.studyBooks.push(newBook);
  await saveStudyBookToDB(newBook);                          // 只写元数据
  await saveStudyBookContentToDB(newBook.id, content);      // 正文独立写

  return newBook;
}

/**
 * 删除书籍：级联删除元数据 / 正文 / 题目 / 记录 / 共读消息 / 分页缓存
 */
async function deleteStudyBook(bookId) {
  db.studyBooks     = db.studyBooks.filter(b => b.id !== bookId);
  db.studyQuestions = db.studyQuestions.filter(q => q.bookId !== bookId);
  db.studyRecords   = db.studyRecords.filter(r => r.bookId !== bookId);
  // database.js 的 deleteStudyBookFromDB 已级联删除所有关联表
  await deleteStudyBookFromDB(bookId);
}

/**
 * 部分更新书籍元数据（patch 只需包含要改的字段，不含 content）
 */
async function updateStudyBook(bookId, patch) {
  const book = db.studyBooks.find(b => String(b.id) === String(bookId));
  if (!book) return null;
  // 防止意外把正文塞进元数据
  const safePatch = { ...patch };
  delete safePatch.content;
  delete safePatch.coreadMessages;
  Object.assign(book, safePatch);
  if (typeof saveStudyBookToDB === 'function') await saveStudyBookToDB(book);
  return book;
}

function getAllStudyBooks() {
  return db.studyBooks || [];
}

// ── Questions ──────────────────────────────────────

async function saveStudyQuestion(question) {
  const newQ = { ...question, id: _genStudyId('q'), createdAt: Date.now() };
  db.studyQuestions.push(newQ);
  await saveStudyQuestionToDB(newQ);
  return newQ;
}

// 生成题库时批量保存，减少 IDB 事务数
async function bulkSaveStudyQuestions(questions) {
  db.studyQuestions.push(...questions);
  await bulkSaveStudyQuestionsToDB(questions);
}

async function deleteStudyQuestion(qId) {
  db.studyQuestions = db.studyQuestions.filter(q => q.id !== qId);
  await deleteStudyQuestionFromDB(qId);
}

function getQuestionsByBook(bookId) {
  return (db.studyQuestions || []).filter(q => q.bookId === bookId);
}

function getAllStudyQuestions() {
  return db.studyQuestions || [];
}

// ── Records ────────────────────────────────────────

async function saveStudyRecord(record) {
  const newRec = { ...record, id: _genStudyId('rec'), date: Date.now() };
  db.studyRecords.push(newRec);
  await saveStudyRecordToDB(newRec);
  return newRec;
}

function getAllStudyRecords() {
  return db.studyRecords || [];
}

function getRecordsByBook(bookId) {
  return (db.studyRecords || []).filter(r => r.bookId === bookId);
}

function getRecordsByQuestion(qId) {
  return (db.studyRecords || []).filter(r => r.questionId === qId);
}

// ── Study Settings (绑定人设 / API预设) ──────────────

function getStudySettings() {
  return db.studySettings || { boundPersonaId: null, textApiPresetName: null, embeddingApiPresetName: null };
}

async function updateStudySettings(patch) {
  db.studySettings = { ...getStudySettings(), ...patch };
  await saveStudySettingsToDB();
}

// 从 db.userPersonas 取出当前绑定的人设对象（没绑定返回 null）
function getStudyBoundPersona() {
  const { boundPersonaId } = getStudySettings();
  if (!boundPersonaId) return null;
  return (db.userPersonas || []).find(p => p.id === boundPersonaId) || null;
}
