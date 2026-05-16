// study_coread.js — 学习模块：共读功能（悬浮球版）
// 依赖：study_core.js / study_db.js / study_ai.js / study_bookshelf.js
// ★ V8：共读消息存入 studyCoreadMessages 独立表，不再依赖 book.coreadMessages 字段
// =====================================================

// ── 共读设置（按书存取：db.studySettings.coread[bookId]）────────────

const _COREAD_DEFAULTS = {
  charId: '', personaId: '', worldbookIds: [],
  historyCount: 20, prevPages: 1, nextPages: 0
};

function _getCoreadSettings() {
  const bookId = window._study.state.reader.bookId;
  const all = getStudySettings().coread || {};
  // 兼容旧全局格式：若 all 直接含 charId 字段说明是旧数据，忽略
  if (bookId && all[bookId]) return { ..._COREAD_DEFAULTS, ...all[bookId] };
  return { ..._COREAD_DEFAULTS };
}

async function _updateCoreadSettings(patch) {
  const bookId = window._study.state.reader.bookId;
  if (!bookId) return;
  const all     = getStudySettings().coread || {};
  const current = (all[bookId] && typeof all[bookId] === 'object') ? all[bookId] : {};
  await updateStudySettings({ coread: { ...all, [bookId]: { ...current, ...patch } } });
}

// ── 运行时状态 ───────────────────────────────────────────
// ★ _coread 是模块级变量，切书时必须通过 _resetCoread() 显式清空

const _coread = {
  active:     false,
  expanded:   false,
  char:       null,
  persona:    null,
  bookId:     null,   // ★ 新增：记录当前绑定的书，用于切书检测
  messages:   [],
  generating: false,
};

// ── 重置共读状态（切书 / 退出时调用）────────────────────

function _resetCoread() {
  _coread.active     = false;
  _coread.expanded   = false;
  _coread.char       = null;
  _coread.persona    = null;
  _coread.bookId     = null;
  _coread.messages   = [];
  _coread.generating = false;
}

// ── 辅助：获取当前书 ──────────────────────────────────────

function _getCurrentBook() {
  const bookId = window._study.state.reader.bookId;
  return getAllStudyBooks().find(b => b.id === bookId);
}

// ── 持久化：追加 / 更新 DB 中的共读消息 ─────────────────
// 不再整本 book.coreadMessages 全量写，而是单条精准操作

async function _appendCoreadMsg(msg) {
  const bookId = window._study.state.reader.bookId;
  if (!bookId) return;
  if (typeof appendCoreadMessageToDB === 'function') {
    await appendCoreadMessageToDB(bookId, msg);
  }
}

async function _updateLastCoreadMsg(content) {
  const bookId = window._study.state.reader.bookId;
  if (!bookId) return;
  if (typeof updateLastCoreadMessageInDB === 'function') {
    await updateLastCoreadMessageInDB(bookId, content);
  }
}

// ── 渲染：更新悬浮球旁气泡 ───────────────────────────────

function _renderCoreadMessages() {
  const charMsgs = _coread.messages.filter(m => m.role === 'char');
  const lastChar = charMsgs[charMsgs.length - 1];

  const bubbleEl = document.getElementById('reader-bubble-text');
  if (bubbleEl) {
    if (_coread.generating) {
      bubbleEl.innerHTML = `
        <span class="coread-typing-dot"></span>
        <span class="coread-typing-dot"></span>
        <span class="coread-typing-dot"></span>`;
    } else {
      bubbleEl.textContent = lastChar?.content || '发送消息开始交流吧';
    }
  }

  const sendBtn = document.getElementById('coread-send-btn');
  if (sendBtn) {
    sendBtn.disabled = _coread.generating;
  }
}

// ── 进入共读（显示悬浮球） ───────────────────────────────

async function studyEnterCoread() {
  const cfg = _getCoreadSettings();
  if (!cfg.charId) {
    if (typeof showToast === 'function') showToast('请先点击右上角⚙设置绑定共读共读者');
    return;
  }

  const char    = (db.characters || []).find(c => c.id === cfg.charId);
  const persona = cfg.personaId
    ? (db.userPersonas || []).find(p => (p.id || p.nickname) === cfg.personaId)
    : null;

  if (!char) {
    if (typeof showToast === 'function') showToast('绑定共读者不存在，请重新设置');
    return;
  }

  const bookId = window._study.state.reader.bookId;

  _coread.active     = true;
  _coread.expanded   = false;
  _coread.char       = char;
  _coread.persona    = persona;
  _coread.bookId     = bookId;
  _coread.generating = false;

  // ★ V8：从独立表读取共读消息，不再从 book.coreadMessages 读
  if (typeof getCoreadMessagesFromDB === 'function') {
    _coread.messages = await getCoreadMessagesFromDB(bookId);
  } else {
    _coread.messages = [];
  }

  // 设置悬浮球头像
  const floatAvatar = document.getElementById('reader-float-avatar');
  if (floatAvatar) floatAvatar.src = char.avatar || '';

  // 显示悬浮球（默认收起状态）
  const ball = document.getElementById('reader-float-ball');
  if (ball) ball.style.display = 'flex';

  // 关闭 header 和底部菜单（回到沉浸模式）
  document.getElementById('reader-app-header')?.classList.remove('reader-header-visible');
  document.getElementById('reader-bottom-menu')?.classList.remove('visible');

  _renderCoreadMessages();
}

// ── 退出共读 ─────────────────────────────────────────────

function studyExitCoread() {
  _resetCoread(); // ★ 完整重置，不留残留

  document.getElementById('reader-float-ball')?.style.setProperty('display', 'none');
  document.getElementById('reader-bubble-wrap')?.style.setProperty('display', 'none');
  document.getElementById('reader-coread-input-bar')?.style.setProperty('display', 'none');
  document.getElementById('reader-float-ball')?.classList.remove('expanded');
}

// ── 气泡位置同步（跟随悬浮球，自动判断左右上下）────────────
// ★ 从 study_bookshelf.js 拆分时遗漏，补回此处

function _syncBubblePosition() {
  const ball = document.getElementById('reader-float-ball');
  const wrap = document.getElementById('reader-bubble-wrap');
  if (!ball || !wrap) return;

  const rect        = ball.getBoundingClientRect();
  const W           = window.innerWidth;
  const H           = window.innerHeight;
  const gap         = 10;
  const INPUT_BAR_H = 80; // 底部输入栏高度

  // 气泡尺寸：首次渲染前可能为 0，用保守最小值兜底
  const MIN_BW = 40;
  const MIN_BH = 60;
  const bw = Math.max(wrap.offsetWidth  || 0, MIN_BW);
  const bh = Math.max(wrap.offsetHeight || 0, MIN_BH);

  // 三个方向的剩余空间
  const spaceRight = W - rect.right - gap;
  const spaceLeft  = rect.left - gap;
  const spaceBelow = H - rect.bottom - gap - INPUT_BAR_H;

  const canRight = spaceRight >= bw;
  const canLeft  = spaceLeft  >= bw;
  const canBelow = spaceBelow >= bh;

  let left, top;

  if (canRight) {
    // 头像偏左：气泡放右侧
    left = rect.right + gap;
    top  = canBelow ? rect.top : rect.bottom - bh;
  } else if (canLeft) {
    // 头像偏右：气泡放左侧
    left = rect.left - bw - gap;
    top  = canBelow ? rect.top : rect.bottom - bh;
  } else {
    // 头像居中：上下排列
    left = rect.left + rect.width / 2 - bw / 2;
    top  = canBelow ? rect.bottom + gap : rect.top - bh - gap;
  }

  // 兜底：防止溢出屏幕边缘
  left = Math.max(8, Math.min(W - bw - 8, left));
  top  = Math.max(8, Math.min(H - INPUT_BAR_H - bh - 4, top));

  wrap.style.left   = left + 'px';
  wrap.style.top    = top  + 'px';
  wrap.style.right  = 'auto';
  wrap.style.bottom = 'auto';
}

// ── 切换悬浮球展开/收起 ──────────────────────────────────

// 供 _closeAllReaderPanels 调用：收起共读对话框+输入栏
function _collapseCoread() {
  if (!_coread.active || !_coread.expanded) return;
  _coread.expanded = false;
  document.getElementById('reader-float-ball')?.classList.remove('expanded');
  document.getElementById('reader-bubble-wrap')?.style.setProperty('display', 'none');
  document.getElementById('reader-coread-input-bar')?.style.setProperty('display', 'none');
}

function _toggleFloatBall() {
  if (!_coread.active) return;
  _coread.expanded = !_coread.expanded;

  const ball       = document.getElementById('reader-float-ball');
  const bubbleWrap = document.getElementById('reader-bubble-wrap');
  const inputBar   = document.getElementById('reader-coread-input-bar');

  if (_coread.expanded) {
    ball?.classList.add('expanded');
    if (bubbleWrap) bubbleWrap.style.display = 'flex';
    if (inputBar)   inputBar.style.display   = 'flex';
    // 等气泡渲染完一帧再定位（display:none→flex 后 offsetWidth 需一帧才有值）
    requestAnimationFrame(() => _syncBubblePosition());
    // 关闭其他面板，避免干扰
    if (typeof _closeAllReaderPanels === 'function') {
      _closeAllReaderPanels('coread');
    } else {
      document.getElementById('reader-app-header')?.classList.remove('reader-header-visible');
      document.getElementById('reader-bottom-menu')?.classList.remove('visible');
    }
  } else {
    ball?.classList.remove('expanded');
    if (bubbleWrap) bubbleWrap.style.display = 'none';
    if (inputBar)   inputBar.style.display   = 'none';
  }
}

// ── 发送消息 ─────────────────────────────────────────────

async function studySendCoreadMessage() {
  const input = document.getElementById('coread-input');
  const text  = input?.value.trim();
  if (!text || _coread.generating) return;

  const userName = _coread.persona?.realName || _coread.persona?.nickname || _coread.char?.myName || db.settings?.userNickname || '读者';
const userMsg = { role: 'user', content: text, timestamp: Date.now(), userName };
  _coread.messages.push(userMsg);
  if (input) input.value = '';
  _renderCoreadMessages();

  // ★ V8：单条追加到 DB，不再整本写
  await _appendCoreadMsg(userMsg);
  await _coreadCharReply(text);
}

// ── 辅助：组装前后页内容 ──────────────────────────────────

function _buildPageContext() {
  const cfg       = _getCoreadSettings();
  const prevPages = cfg.prevPages ?? 1;
  const nextPages = cfg.nextPages ?? 0;
  const s         = window._study.state.reader;
  const pages     = s.pages || [];
  const cur       = s.page  || 0;

  const parts = [];

  // 前 N 页
  for (let i = Math.max(0, cur - prevPages); i < cur; i++) {
    if (pages[i]) parts.push(`【第${i + 1}页】\n${pages[i].substring(0, 600)}`);
  }

  // 当前页
  if (pages[cur]) parts.push(`【当前页（第${cur + 1}页）】\n${pages[cur].substring(0, 800)}`);

  // 后 N 页
  const maxPage = pages.length - 1;
  for (let i = cur + 1; i <= Math.min(maxPage, cur + nextPages); i++) {
    if (pages[i]) parts.push(`【第${i + 1}页】\n${pages[i].substring(0, 600)}`);
  }

  return parts.join('\n\n');
}

// ── AI Prompt 组装 ────────────────────────────────────────

function _buildCoreadSystemPrompt() {
  const char    = _coread.char;
  const persona = _coread.persona;
  const cfg     = _getCoreadSettings();
  const book    = _getCurrentBook();

const charName  = char.realName || char.remarkName || char.name || '共读者';
  // 真名优先，昵称备选，再 fallback 到 char.myName
  const userName  = persona?.realName || persona?.nickname || char.myName || db.settings?.userNickname || '读者';
  // 读者描述：优先取实时 persona，没有再取 char.myPersona
  const userDesc  = persona?.persona || char.myPersona || '一个正在读书的人。';
  const charPersona = char.persona || char.description || '一个热心的陪读人。';
  const charStatus  = char.status  || '';
  const bookTitle   = book?.title       || '某本书';
  const bookDesc    = book?.description || '';

  const allWbIds = cfg.worldbookIds || [];
  const allWbs   = db.worldBooks || [];
  const wbBefore = allWbs.filter(w => allWbIds.includes(w.id) && w.position === 'before').map(w => w.content).filter(Boolean).join('\n');
  const wbAfter  = allWbs.filter(w => allWbIds.includes(w.id) && w.position === 'after').map(w => w.content).filter(Boolean).join('\n');

  let prompt = '';

  // ── 共读情境（置顶）──
  prompt += `你（${charName}）正在和我（ ${userName}） 一起读一本书。\n\n`;
  
    // ── 世界观 ──
  if (wbBefore) prompt += `【世界观】\n${wbBefore}\n\n`;
  
  prompt += `【你们正在阅读的书的信息】\n`;
  prompt += `书名：${bookTitle}\n`;
  if (bookDesc) prompt += `内容简介：${bookDesc}\n`;
  prompt += '\n';

  // ── 共读者信息 ──
    prompt += `【人设信息】\n`;
  prompt += `你的姓名是：${charName}，昵称是：${char.remarkName}。\n`;
  prompt += `\n你的人设是：\n${charPersona}\n\n`;

  // ── 读者信息 ──
  prompt += `我的姓名是：${userName}，昵称是：${persona?.nickname}。\n`;
 if (userDesc) prompt += `我的人设是：\n${userDesc}\n\n`;

  // ── 其他世界书 ──
  if (wbAfter) prompt += `【其他重要事项说明】\n${wbAfter}\n\n`;

  return prompt;
}

// ── API 调用（AI 点评当前页）─────────────────────────────

async function _coreadEvalPage() {
  if (_coread.generating) return;
  _coread.generating = true;
  _renderCoreadMessages(); // 立即显示省略号+禁用按钮

  const pageContext  = _buildPageContext();
  const systemPrompt = _buildCoreadSystemPrompt();
  const userPrompt   = pageContext;

  const charName = _coread.char?.realName || _coread.char?.remarkName || _coread.char?.name || '共读者';
const charMsg = { role: 'char', content: '', timestamp: Date.now(), charName };
  _coread.messages.push(charMsg);
  const msgIdx = _coread.messages.length - 1;

  // ★ 先追加一条空消息占位（流式结束后再更新 content）
  await _appendCoreadMsg(charMsg);

  try {
    let streamed = '';
    const reply = await callAI(userPrompt, {
      systemPrompt,
      onStream: (chunk) => {
        streamed += chunk;
        _coread.messages[msgIdx].content = streamed;
        _renderCoreadMessages();
      }
    });
    if (!streamed && reply) {
      _coread.messages[msgIdx].content = reply;
      _renderCoreadMessages();
    }
    // ★ 流式结束后把最终内容写回 DB
    await _updateLastCoreadMsg(_coread.messages[msgIdx].content);
  } catch (e) {
    _coread.messages[msgIdx].content = '（AI 连接失败）';
    _renderCoreadMessages();
    await _updateLastCoreadMsg('（AI 连接失败）');
  } finally {
    _coread.generating = false;
    _renderCoreadMessages(); // 恢复按钮
  }
}

async function _coreadCharReply(userText) {
  if (_coread.generating) return false;
  _coread.generating = true;
  _renderCoreadMessages(); // 立即禁用按钮+省略号

  const cfg          = _getCoreadSettings();
  const historyCount = cfg.historyCount ?? 20;
  const charName = _coread.char.realName || _coread.char.remarkName || _coread.char.name || '共读者';
  const userName = _coread.persona?.realName || _coread.persona?.nickname || _coread.char.myName || '读者';

  // 取最近 historyCount 条，但排除最后一条（就是本次 userMsg，末尾会单独拼）
const historyMsgs = _coread.messages.slice(-historyCount - 1, -1).filter(m => m.content);
const history = historyMsgs
  .map(m => {
    const name = m.role === 'user'
      ? (m.userName || userName)
      : (m.charName || charName);
    return `${name}：${m.content}`;
  }).join('\n');
  const pageContext  = _buildPageContext();
  const systemPrompt = _buildCoreadSystemPrompt('reply');
const instruction = `请以完全符合你性格的方式，简短地回复我的发言。`;
const userPrompt = `${pageContext}\n\n【对话历史】\n${history}\n\n【我的最新发言】\n${userName}：${userText}\n\n${instruction}`;

  const charMsg = { role: 'char', content: '', timestamp: Date.now(), charName };
  _coread.messages.push(charMsg);
  const msgIdx = _coread.messages.length - 1;

  // ★ 先追加空消息占位
  await _appendCoreadMsg(charMsg);

  let success = false;
  try {
    let streamed = '';
    const reply = await callAI(userPrompt, {
      systemPrompt,
      onStream: (chunk) => {
        streamed += chunk;
        _coread.messages[msgIdx].content = streamed;
        _renderCoreadMessages();
      }
    });
    if (!streamed && reply) {
      _coread.messages[msgIdx].content = reply;
      _renderCoreadMessages();
    }
    success = true;
    // ★ 流式结束后把最终内容写回 DB
    await _updateLastCoreadMsg(_coread.messages[msgIdx].content);
  } catch (e) {
    _coread.messages[msgIdx].content = '（AI 回复失败，请稍后重试）';
    _renderCoreadMessages();
    await _updateLastCoreadMsg('（AI 回复失败，请稍后重试）');
  } finally {
    _coread.generating = false;
    _renderCoreadMessages(); // 恢复按钮
  }
  return success;
}

// ── 初始化：挂载 DOM 事件 ─────────────────────────────────

function studyInitCoread() {
  // 发送按钮 & 回车
  document.getElementById('coread-send-btn')?.addEventListener('click', studySendCoreadMessage);
  document.getElementById('coread-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      studySendCoreadMessage();
    }
  });

  studyInitCoreadSidebar();
}

// ── 历史记录底部 sheet ────────────────────────────────────

async function _openCoreadHistorySheet() {
  // ★ 如果共读未激活（读者直接点底部菜单"对话历史"），先从 DB 加载当前书的消息
  if (!_coread.active) {
  const bookId = window._study.state.reader.bookId;
  if (bookId && typeof getCoreadMessagesFromDB === 'function') {
    _coread.messages = await getCoreadMessagesFromDB(bookId);
  }
  // 补上：把 char/persona 也初始化
  const cfg = _getCoreadSettings();
  _coread.char    = (db.characters || []).find(c => c.id === cfg.charId) || null;
  _coread.persona = cfg.personaId
    ? (db.userPersonas || []).find(p => (p.id || p.nickname) === cfg.personaId)
    : null;
}

  let sheet = document.getElementById('coread-history-sheet');
  if (!sheet) {
    sheet = document.createElement('div');
    sheet.id = 'coread-history-sheet';
    sheet.className = 'action-sheet-overlay';
    sheet.innerHTML = `
      <div class="action-sheet coread-history-sheet-inner">
        <div class="coread-history-sheet-header">
          <span>对话记录</span>
          <button class="coread-history-sheet-close" id="coread-history-sheet-close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div id="coread-history-list" class="coread-history-list"></div>
      </div>`;
    document.body.appendChild(sheet);

    document.getElementById('coread-history-sheet-close')?.addEventListener('click', () => {
      sheet.classList.remove('visible');
    });
    sheet.addEventListener('click', (e) => {
      if (e.target === sheet) sheet.classList.remove('visible');
    });
  }

  const listEl = document.getElementById('coread-history-list');
  const { h }  = window._study;
  const char     = _coread.char;
  const charName = char ? (char.realName || char.remarkName || char.name || '共读者') : '共读者';
  const userName = _coread.persona?.realName || _coread.persona?.nickname || char?.myName || db.settings?.userNickname || '读者';

  if (!_coread.messages.length) {
    listEl.innerHTML = '<div class="coread-history-empty">暂无对话记录</div>';
  } else {
    listEl.innerHTML = _coread.messages.filter(m => m.content).map(m => {
  const isUser = m.role === 'user';
  const name = isUser ? (m.userName || userName) : (m.charName || charName);
      return `<div class="coread-history-row ${isUser ? 'user' : 'char'}">
          <span class="coread-history-name">${h(name)}</span>
          <div class="coread-history-bubble ${isUser ? 'user' : 'char'}">${h(m.content).replace(/\n/g, '<br>')}</div>
        </div>`;
    }).join('');
  }

  sheet.classList.add('visible');
  requestAnimationFrame(() => { listEl.scrollTop = listEl.scrollHeight; });
}

// ── 侧边栏（共读设置）────────────────────────────────────

let _coreadPendingWbIds = [];

function studyInitCoreadSidebar() {
  const sidebar     = document.getElementById('reader-coread-sidebar');
  const settingsBtn = document.getElementById('reader-coread-settings-btn');
  const form        = document.getElementById('reader-coread-settings-form');

  settingsBtn?.addEventListener('click', () => {
    _populateCoreadSidebar();
    // 关闭其他面板，只保留设置侧边栏
    if (typeof _closeAllReaderPanels === 'function') _closeAllReaderPanels('settings');
    sidebar?.classList.add('open');
  });

  document.getElementById('reader-coread-worldbook-btn')?.addEventListener('click', () => {
    _openCoreadWbModal();
  });

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const charId    = document.getElementById('reader-coread-char-select')?.value || '';
  const personaId = document.getElementById('reader-coread-persona-select')?.value || '';
  await _updateCoreadSettings({ charId, personaId, worldbookIds: _coreadPendingWbIds });

  // 补上：同步刷新运行时快照
  if (_coread.active) {
    _coread.char    = (db.characters || []).find(c => c.id === charId) || null;
    _coread.persona = personaId
      ? (db.userPersonas || []).find(p => (p.id || p.nickname) === personaId)
      : null;
    // 同步更新悬浮球头像
    const floatAvatar = document.getElementById('reader-float-avatar');
    if (floatAvatar) floatAvatar.src = _coread.char?.avatar || '';
  }

  sidebar?.classList.remove('open');
  if (typeof showToast === 'function') showToast('共读设置已保存');
});

  // ── 上文条数 ──────────────────────────────────────────
  document.getElementById('reader-coread-history-count-btn')?.addEventListener('click', async () => {
    const cfg = _getCoreadSettings();
    const cur = cfg.historyCount ?? 20;
    const val = await AppUI.prompt(
      `当前：${cur} 条`,
      '输入条数（1-100）',
      '读取上文条数'
    );
    if (val === null) return;
    const num = Math.min(100, Math.max(1, parseInt(val) || cur));
    await _updateCoreadSettings({ historyCount: num });
    _updateCoreadHistoryCountLabel();
    if (typeof showToast === 'function') showToast(`上文条数已设为 ${num} 条`);
  });

  // ── 前置页数 ──────────────────────────────────────────
  document.getElementById('reader-coread-prev-pages-btn')?.addEventListener('click', async () => {
    const cfg = _getCoreadSettings();
    const cur = cfg.prevPages ?? 1;
    const val = await AppUI.prompt(
      `当前：${cur} 页`,
      '输入页数（0-10）',
      '注入前置页数'
    );
    if (val === null) return;
    const num = Math.min(10, Math.max(0, parseInt(val) || 0));
    await _updateCoreadSettings({ prevPages: num });
    _updateCoreadPrevPagesLabel();
    if (typeof showToast === 'function') showToast(`前置页数已设为 ${num} 页`);
  });

  // ── 后置页数 ──────────────────────────────────────────
  document.getElementById('reader-coread-next-pages-btn')?.addEventListener('click', async () => {
    const cfg = _getCoreadSettings();
    const cur = cfg.nextPages ?? 0;
    const val = await AppUI.prompt(
      `当前：${cur} 页`,
      '输入页数（0-10）',
      '注入后置页数'
    );
    if (val === null) return;
    const num = Math.min(10, Math.max(0, parseInt(val) || 0));
    await _updateCoreadSettings({ nextPages: num });
    _updateCoreadNextPagesLabel();
    if (typeof showToast === 'function') showToast(`后置页数已设为 ${num} 页`);
  });

  document.getElementById('reader-coread-history-btn')?.addEventListener('click', () => {
    sidebar?.classList.remove('open');
    _openCoreadHistorySheet();
  });

  document.getElementById('reader-coread-clear-btn')?.addEventListener('click', async () => {
    const ok = typeof AppUI !== 'undefined'
      ? await AppUI.confirm('确定要清空本书的共读对话记录吗？', '清空确认', '清空', '取消')
      : confirm('确定要清空本书的共读对话记录吗？');
    if (!ok) return;

    const bookId = window._study.state.reader.bookId;
    _coread.messages = [];
    if (bookId && typeof clearCoreadMessagesInDB === 'function') {
      await clearCoreadMessagesInDB(bookId);
    }
    _renderCoreadMessages();

    const listEl = document.getElementById('coread-history-list');
    if (listEl) listEl.innerHTML = '<div class="coread-history-empty">暂无对话记录</div>';
    if (typeof showToast === 'function') showToast('共读记录已清空');
  });
// ── 重新分页 ──────────────────────────────────────────
  document.getElementById('reader-repaginate-btn')?.addEventListener('click', async () => {
    const ok = typeof AppUI !== 'undefined'
      ? await AppUI.confirm('将根据当前屏幕重新计算分页，书签将被清除。是否继续？', '重新分页', '继续', '取消')
      : confirm('将根据当前屏幕重新计算分页，书签将被清除。是否继续？');
    if (!ok) return;

    sidebar?.classList.remove('open');

    const bookId = window._study.state.reader.bookId;
    const book   = getAllStudyBooks().find(b => b.id === bookId);
    if (!book) return;

    // 清除书签
    book.bookmarks = [];
    if (typeof saveStudyBookToDB === 'function') await saveStudyBookToDB(book);

    // 清除分页缓存，强制重算
    if (typeof dexieDB !== 'undefined') await dexieDB.studyPageCache.delete(bookId);

    if (typeof showToast === 'function') showToast('正在重新分页…');

    // 重新打开阅读器（会触发完整的分页流程）
    if (typeof studyOpenReader === 'function') await studyOpenReader(book);
  });  
}

function _populateCoreadSidebar() {
  const cfg = _getCoreadSettings();
  _coreadPendingWbIds = [...(cfg.worldbookIds || [])];

  const charSel = document.getElementById('reader-coread-char-select');
  if (charSel) {
    charSel.innerHTML = '<option value="">不绑定</option>';
    (db.characters || []).forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.remarkName || c.name || c.id;
      if (c.id === cfg.charId) opt.selected = true;
      charSel.appendChild(opt);
    });
  }

  const personaSel = document.getElementById('reader-coread-persona-select');
  if (personaSel) {
    personaSel.innerHTML = '<option value="">默认</option>';
    (db.userPersonas || []).forEach(p => {
      const id = p.id || p.nickname;
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = p.nickname;
      if (id === cfg.personaId) opt.selected = true;
      personaSel.appendChild(opt);
    });
  }

  _updateCoreadWbLabel();
  _updateCoreadHistoryCountLabel();
  _updateCoreadPrevPagesLabel();
  _updateCoreadNextPagesLabel();
}

// ── label 更新辅助 ────────────────────────────────────────

function _updateCoreadWbLabel() {
  const label = document.getElementById('reader-coread-worldbook-label');
  if (!label) return;
  const count = _coreadPendingWbIds.length;
  label.textContent = count > 0 ? `关联 ${count} 本` : '未关联';
}

function _updateCoreadHistoryCountLabel() {
  const el = document.getElementById('reader-coread-history-count-label');
  if (el) el.textContent = `${_getCoreadSettings().historyCount ?? 20} 条`;
}

function _updateCoreadPrevPagesLabel() {
  const el = document.getElementById('reader-coread-prev-pages-label');
  if (el) el.textContent = `${_getCoreadSettings().prevPages ?? 1} 页`;
}

function _updateCoreadNextPagesLabel() {
  const el = document.getElementById('reader-coread-next-pages-label');
  if (el) el.textContent = `${_getCoreadSettings().nextPages ?? 0} 页`;
}

// ── 世界书关联 modal ──────────────────────────────────────

function _openCoreadWbModal() {
  const allWbs = db.worldBooks || [];
  if (!allWbs.length) {
    if (typeof showToast === 'function') showToast('暂无世界书，请先在世界书页面添加条目');
    return;
  }
  let modal = document.getElementById('coread-wb-select-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'coread-wb-select-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-window">
        <h3>关联世界书</h3>
        <ul id="coread-wb-list" class="list-container" style="max-height:40vh;overflow-y:auto;padding:0;margin:15px 0;"></ul>
        <button class="btn btn-primary" id="coread-wb-confirm-btn" style="margin-top:20px;">确认绑定</button>
      </div>`;
    document.body.appendChild(modal);
  }
  const listEl = document.getElementById('coread-wb-list');
  if (typeof renderCategorizedWorldBookList === 'function') {
    renderCategorizedWorldBookList(listEl, allWbs, _coreadPendingWbIds, 'coread-wb');
  } else {
    listEl.innerHTML = allWbs.map(w => `<li style="padding:8px 4px;display:flex;align-items:center;gap:8px;">
        <input type="checkbox" id="cwb-${w.id}" value="${w.id}" ${_coreadPendingWbIds.includes(w.id) ? 'checked' : ''}>
        <label for="cwb-${w.id}">${w.name || '未命名'}</label></li>`).join('');
  }
  modal.style.display = 'flex';
  const oldBtn = document.getElementById('coread-wb-confirm-btn');
  const newBtn = oldBtn.cloneNode(true);
  oldBtn.parentNode.replaceChild(newBtn, oldBtn);
  newBtn.addEventListener('click', () => {
    const checked = listEl.querySelectorAll('input[type="checkbox"]:checked');
    _coreadPendingWbIds = Array.from(checked).map(cb => cb.value);
    _updateCoreadWbLabel();
    modal.style.display = 'none';
    if (typeof showToast === 'function') showToast(`已关联 ${_coreadPendingWbIds.length} 个世界书`);
  });
  modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
}
