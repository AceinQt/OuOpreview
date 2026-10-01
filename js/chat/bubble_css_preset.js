// --- START OF FILE bubble_css_preset.js ---
const colorThemes = {
    'white_blue': {
        name: '默认',
        received: { bg: '#FFFFFF', text: '#1D1F21' },
        sent: { bg: '#0099FF', text: '#FFFFFF' }
    }
};
// =================================== 预览模板与沙盒渲染 ===================================
//
// 预览不再维护第二份 HTML —— 直接 clone index.html 里真实的 #chat-room-screen，
// 并且跑 chat_settings.js 用的同一个 scopeBubbleCss。
//
// 为什么这么改：以前预览是三份手写模板 + CSS 原样注入，实际应用是一套手写正则改写器。
// 两份结构会漂移（模板里给 .chat-input-wrapper 挂了内联 position、输入框是 disabled 的、
// 缺 #multi-select-bar 之类的兄弟节点），两条 CSS 通道语义又不同，于是「预览生效、
// 保存后不生效」是必然而不是偶发，底栏尤其明显。现在结构和改写都只有一份，
// 改 index.html 预览自动跟着变。
//
// 代价：clone 出来的东西里有一堆预览时不该出现的浮层（侧边栏、表情面板、多选栏），
// 得按 PREVIEW_HIDE_IDS 关掉；每个视图再决定滚到哪里、把哪些区域收窄。
let currentPreviewMode = 0; // 0:气泡, 1:顶部栏, 2:底部栏

// clone 出来后要强制隐藏的浮层/浮块（它们都住在 #chat-room-screen 里面）
const PREVIEW_HIDE_IDS = [
    'chat-settings-sidebar',   // 设置侧边栏
    'sticker-modal',           // 表情包面板
    'chat-expansion-panel',    // "+"扩展面板
    'multi-select-bar',        // 多选删除栏
    'chat-room-header-select', // 多选状态的顶栏
    'typing-indicator'         // "正在输入"指示器
];

// 三个预览视图。focus 决定 iframe 里滚动/裁切到哪个区域，
// 不再各自持有一份 HTML。
const previewModes = [
    { title: '预览 1/3：消息气泡 (Bubbles)', focus: 'bubbles' },
    { title: '预览 2/3：顶部栏 (Header)',    focus: 'header'  },
    { title: '预览 3/3：底部栏 (Footer & Input)', focus: 'footer' }
];

// 「基础」Tab 下面挂着三块面板，和上面三个预览视图一对一：
// 翻到顶栏就改顶栏、翻到底栏就改底栏。顺序必须和 previewModes 对齐。
// 「高级」只有一块 —— 三个视图写的是同一段 CSS，拆成三份没有意义。
const BASIC_PANE_IDS = ['pane-basic', 'pane-basic-header', 'pane-basic-footer'];
let currentAppearanceTab = 'basic'; // 'basic' | 'css'，对应 index.html 上的 data-tab

// 当前该亮哪块面板 = 「哪个 Tab」×「预览翻到第几页」。
// 两个维度都从模块级变量读，所以无论是点 Tab 还是点预览左右键都调这一个函数。
function syncAppearancePane() {
    const root = document.getElementById('tab-view-bubbles');
    if (!root) return;
    const paneId = (currentAppearanceTab === 'css') ? 'pane-css' : BASIC_PANE_IDS[currentPreviewMode];
    root.querySelectorAll('.content-pane').forEach(p => {
        p.classList.toggle('active', p.id === paneId);
    });
    root.querySelectorAll('.side-tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === currentAppearanceTab);
    });
}

// 重画预览。setupBubblePresets 里原本自己闭包了一份，但「切预设」「换预览页」这些
// 入口散在闭包内外，所以提到模块级来，让所有人调同一个。
function refreshBubbleCssPreview() {
    const box = document.getElementById('global-bubble-css-preview');
    const cssInput = document.getElementById('global-bubble-custom-css');
    if (!box || !cssInput) return;
    updateBubbleCssPreview(box, cssInput.value, false, colorThemes['white_blue']);
}

// 改 currentPreviewMode 的地方一律走这里 —— 直接赋值会出现
// 「预览翻到了底栏、下面的面板还停在气泡」。
function setPreviewMode(idx) {
    const n = previewModes.length;
    currentPreviewMode = ((idx % n) + n) % n;
    syncAppearancePane();
    refreshBubbleCssPreview();
}

// 预览用的假 chatId。scopeBubbleCss 会把它拼进 class，所以只能用合法 class 字符。
const PREVIEW_CHAT_ID = 'preview';


function _getBubblePresets() {
    let presets = db.bubbleCssPresets ||[];
    // 兼容迁移：如果有旧版本的 "默认(白/蓝)"，统一更名为 "默认"
    let oldDefault = presets.find(p => p.name === '默认(白/蓝)');
    if (oldDefault) {
        oldDefault.name = '默认';
        _saveBubblePresets(presets);
    }
    return presets;
}

function _saveBubblePresets(arr) {
    db.bubbleCssPresets = arr ||[];
   saveGlobalKeys(['bubbleCssPresets']);
}

// 预设的保存/删除/重命名会把新 CSS 直接注入用到该预设的每个聊天的
// customBubbleCss / useCustomBubbleCss / bubbleThemeName 三个字段。
// 渲染读的是 chat.customBubbleCss 而不是预设列表，所以这三个字段必须落盘；
// 过去只保存了 bubbleCssPresets，改动仅存在内存里靠切后台的全量 saveData 兜底，
// App 被系统杀掉就会整体回退到旧 CSS，用户看到的是"刚改的外观没了"。
// 落盘口径与 saveSingleChat 一致：剥掉 history 与独立存储的记忆字段。
async function _persistChatsAfterPresetChange() {
    try {
        if (typeof dexieDB === 'undefined') return;
        const strip = (src) => {
            const o = { ...src };
            delete o.history;
            delete o.memorySummaries;
            delete o.memoryJournals;
            delete o.longTermSummaries;
            if (window.isChunkMigrated) delete o.memoryChunks;
            return o;
        };
        if (dexieDB.characters && db.characters && db.characters.length) {
            await dexieDB.characters.bulkPut(db.characters.map(strip));
        }
        if (dexieDB.groups && db.groups && db.groups.length) {
            await dexieDB.groups.bulkPut(db.groups.map(strip));
        }
    } catch (e) {
        console.error('❌ 气泡预设同步到聊天的保存失败:', e);
    }
}
// =================================== 更新预览区域核心逻辑 ===================================

// 从一段预设 CSS 的 META 注释里取出时间格式。
// 位置是纯 CSS，格式不是 —— 它得由气泡工厂在渲染时拼成文字，所以要有人把它从 CSS 里
// 捞出来。实际聊天室走 chat_settings.js 的 updateCustomBubbleStyle（所有换预设/进聊天室
// 的唯一汇合点），预览走下面的 getDynamicBubblePreview，两边都调这一个函数，
// 免得"预览里是这个格式、聊天室里是另一个"。
function getMessageTimeFormatFromCss(css) {
    if (!css) return '';
    const m = String(css).match(/\/\* META:(.+?) \*\//);
    if (!m) return '';
    try {
        const parsed = JSON.parse(m[1]);
        return (typeof parsed.timeFormat === 'string') ? parsed.timeFormat : '';
    } catch (e) {
        return '';
    }
}

// 全景气泡预览生成器：将所有的气泡都放在一个窗口里
function getDynamicBubblePreview(timeFormat) {
    // 【教学指南：如何自己修改这里的预览气泡？】
    // 1. `getRow(isSent, html)` 是生成一行消息的函数，isSent 为 true 表示是我方发出的。
    // 2. 所有的预览内容都在下方的 `let html = ""` 中拼接。
    // 3. 如果你想改变它们在预览里的上下顺序，直接调换 `html += ...` 代码块的位置即可。
    // 4. 如果你想删掉某个预览（比如觉得太多了），直接删掉对应的 `html += ...` 行。

    // 样例时间固定挑一个能把所有占位符都试出来的时刻：2026-09-27(周日) 下午 13:05:09。
    // 分/秒故意带前导零，这样用户写 m 还是 mm 一眼看得出区别。
    const sampleTime = (typeof formatMessageTimestamp === 'function')
        ? formatMessageTimestamp(new Date(2026, 8, 27, 13, 5, 9).getTime(), timeFormat)
        : '13:05';

    // getRow 里的三个时间槽位必须和 chat_bubble_factory.js 真实那份结构一致
    // （头像列里一个、meta 行里一个、气泡后一个），否则「消息时间」的位置在预览里
    // 拨了没反应 —— 生成的规则正是冲着这三个 class 去的，缺哪个哪个位置就是空的。
    const getRow = (isSent, innerHtml) => `
        <div class="message-wrapper ${isSent ? 'sent' : 'received'}">
            <div class="message-bubble-row" ${isSent ? 'style="flex-direction: row-reverse;"' : ''}>
                <div class="message-avatar-col">
                    <img src="${isSent ? './png/avatar_default_me.jpg' : './png/avatar_default.jpg'}" class="message-avatar avatar">
                    <span class="message-time-avatar">${sampleTime}</span>
                </div>
                <div class="message-content-col" ${isSent ? 'style="align-items: flex-end;"' : ''}>
                    <div class="message-meta-info meta-time-only"><span class="message-time">${sampleTime}</span></div>
                    ${innerHtml}
                </div>
                <span class="message-time-tail">${sampleTime}</span>
            </div>
        </div>
    `;

    let html = "";

    // 1. 普通气泡
    html += getRow(false, `<div class="message-bubble received">这是一条对方发来的普通消息。</div>`);
    html += getRow(true, `<div class="message-bubble sent">这是我方回复的普通消息。</div>`);

// 2. 旁白气泡 (固定居中，不需要调 getRow，独立结构)
//    分「对方」(AI 写的，:not(.narration-mine)) 和「我方」(用户在"+"面板发的剧情旁白，
//    .narration-mine) 两类，各有一套独立设置，所以预览里必须两种都看得见 ——
//    只画一种的话，调完另一种会以为"没生效"。
//    连体拼接只在同类之间发生，所以预览里两组之间也应当是断开的。
    html += `
        <div class="message-wrapper system-notification narration-wrapper">
            <div class="narration-bubble markdown-content">这是【对方】的旁白，由 AI 写在【线下模式】和【通话】里，用来描述角色的行动。</div>
        </div>
        <div class="message-wrapper system-notification narration-wrapper">
            <div class="narration-bubble markdown-content">旁白固定显示在屏幕中间位置。相邻的同类旁白会连接为一整个气泡。</div>
        </div>
        <div class="message-wrapper system-notification narration-wrapper narration-mine">
            <div class="narration-bubble markdown-content">这是【我方】的旁白，是我自己在"+"面板里发的【剧情旁白】，样式单独一套。</div>
        </div>
        <div class="message-wrapper system-notification narration-wrapper narration-mine">
            <div class="narration-bubble markdown-content">我方旁白默认不带描边，用来和对方的旁白一眼分开；想加也可以在左边选「我方」后自己调。</div>
        </div>
    `;

    // 4. 引用气泡
    html += getRow(false, `
        <div class="message-bubble received">
            <div class="quoted-message"><span class="quoted-sender">我：</span><p class="quoted-text">之前说的话</p></div>
            这是对方回复的引用消息。
        </div>
    `);
    html += getRow(true, `
        <div class="message-bubble sent">
            <div class="quoted-message"><span class="quoted-sender">对方：</span><p class="quoted-text">对方之前说的话</p></div>
            这是我方回复的引用消息。
        </div>
    `);

    // 5. 转账气泡
    html += getRow(false, `
        <div class="transfer-card received-transfer">
            <div class="overlay"></div>
            <div class="transfer-content">
                <p class="transfer-title">转账给你</p><p class="transfer-amount">¥50.00</p><p class="transfer-status">待查收</p>
            </div>
        </div>
    `);
    html += getRow(true, `
        <div class="transfer-card sent-transfer">
            <div class="overlay"></div>
            <div class="transfer-content">
                <p class="transfer-title">给你转账</p><p class="transfer-amount">¥100.00</p><p class="transfer-status">待查收</p>
            </div>
        </div>
    `);

    // 3. 语音气泡（结构要跟 chat_bubble_factory.js 里真实那份保持一致，
    //    否则用户在这儿调完 CSS，回到聊天页发现长得不一样）
    html += getRow(false, `
        <div class="message-bubble voice-bubble received" data-voice-state="ready">
            <button type="button" class="voice-play-btn" data-voice-state="ready" tabindex="-1">
                <svg class="vp-icon-play" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </button>
            <span class="voice-wave"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
            <span class="duration">12"</span>
        </div>
    `);
    html += getRow(true, `
        <div class="message-bubble voice-bubble sent" data-voice-state="ready">
            <button type="button" class="voice-play-btn" data-voice-state="ready" tabindex="-1">
                <svg class="vp-icon-play" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </button>
            <span class="voice-wave"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
            <span class="duration">8"</span>
        </div>
    `);
    // 只返回消息内容，外壳由 buildPreviewShellHtml 从真实 DOM clone 出来
    return html;
}

// 从 index.html 真实的 #chat-room-screen clone 一份，改成适合预览的样子。
// 关键点是：不重写结构，只做「隐藏浮层 + 填示例内容」这两件事。
// 这样以后改 index.html 的顶栏/底栏，预览自动跟着变，不会再漂移。
// timeFormat 是一路透传给示例气泡的时间模板，来源是正在编辑的那段 CSS 的 META。
function buildPreviewShellHtml(timeFormat) {
    const real = document.getElementById('chat-room-screen');
    if (!real) return '';

    const clone = real.cloneNode(true);
    // scopeBubbleCss 生成的选择器是 #chat-room-screen.chat-active-preview.chat-active-preview，
    // 这里必须挂上同名 class，否则预览里什么都不生效。
    clone.classList.add('screen', 'active', `chat-active-${PREVIEW_CHAT_ID}`);
    // preview-root 是取景框用的钩子（见 updateBubbleCssPreview 里那段布局 CSS）
    clone.classList.add('preview-root');
    // 动画会让 iframe 每次重画都闪一下
    clone.classList.add('no-anim');

    // clone 出来的 id 会和主文档重名。iframe 是独立 document 所以不会真冲突，
    // 但内部 id 选择器（#sticker-bar 这类）要能命中，所以 id 一律保留。

    PREVIEW_HIDE_IDS.forEach(id => {
        const el = clone.querySelector(`#${id}`);
        if (el) el.style.setProperty('display', 'none', 'important');
    });

    // 设置侧边栏占了 clone 出来的一大半体积（几百个表单控件），预览里永远看不到，
    // 直接摘掉而不是 display:none —— 每次改一个字符都要重建一遍 iframe，省下来的是实打实的。
    const sidebar = clone.querySelector('#chat-settings-sidebar');
    if (sidebar) sidebar.remove();

    // 预览里不该出现真实数据：标题/状态换成示例文案
    const title = clone.querySelector('#chat-room-title');
    if (title) title.textContent = '聊天对象';
    const statusText = clone.querySelector('#chat-room-status-text');
    if (statusText) statusText.textContent = '在线';
    const subtitle = clone.querySelector('#chat-room-subtitle');
    if (subtitle) subtitle.style.display = 'flex';

    // 输入框：真实 DOM 里不是 disabled 的，预览也别 disable
    // （旧模板写了 disabled，用户针对 :disabled 调的样式在预览里对不上）
    const input = clone.querySelector('#message-input');
    if (input) {
        input.removeAttribute('disabled');
        input.setAttribute('value', '');
        input.setAttribute('placeholder', '输入消息...');
    }

    // 底栏两颗按钮同理：clone 取的是**当前活着的** DOM，正好在等 AI 回复时
    // #get-reply-btn 是 disabled 的（chat_ai_service.js 生成期间置的），
    // 而底栏的「颜色」生成的是 :not(:disabled) 规则 —— 不清掉这个属性，
    // 用户会看到预览里按钮是灰的、调色没反应，而且现象随有没有在生成而漂。
    clone.querySelectorAll('#send-message-btn, #get-reply-btn').forEach(btn => {
        btn.removeAttribute('disabled');
    });

    // 示例气泡塞进真实的 #message-area
    const area = clone.querySelector('#message-area');
    if (area) area.innerHTML = getDynamicBubblePreview(timeFormat);

    return clone.outerHTML;
}

// 每个预览视图额外补的一点布局 CSS。
// iframe 只有 200px 高，装不下整个聊天室，所以按视图把注意力放到对应区域：
// 看顶栏就把消息区压扁，看底栏就把底栏顶到可见处。
// 注意这些规则都不带用户 scope —— 它们是「取景框」，不该被用户 CSS 影响，
// 也不该影响用户判断自己写的样式生效没有。
// 取景框只有 200px 高，装不下「顶栏 + 一屏气泡 + 底栏」。
// 所以每个视图只留自己那一块：调气泡时不需要看见顶栏底栏（气泡全家福要占满整窗，
// 这也是旧模板的行为），调顶栏/底栏时反过来把消息区让出去。
const PREVIEW_FOCUS_CSS = {
    bubbles: `
        /* 气泡视图：把 chrome 收掉，200px 全给气泡全家福 */
        #chat-room-screen.preview-root .app-header,
        #chat-room-screen.preview-root .chat-input-wrapper { display: none !important; }
        #chat-room-screen.preview-root .message-area {
            padding-bottom: 10px !important;
            overflow-y: auto !important;
        }
    `,
    header: `
        /* 顶栏视图：只留顶栏，下面留一点消息区做背景参照 */
        #chat-room-screen.preview-root .chat-input-wrapper { display: none !important; }
        #chat-room-screen.preview-root .app-header { position: relative; z-index: 3; }
        #chat-room-screen.preview-root .message-area {
            padding-bottom: 10px !important;
            opacity: 0.35;
        }
    `,
    footer: `
        /* 底栏视图：只留底栏。它本身是 absolute bottom:0，
           顶栏收掉后把消息区淡成背景，视线落在底栏上 */
        #chat-room-screen.preview-root .app-header { display: none !important; }
        #chat-room-screen.preview-root .message-area { opacity: 0.35; }
        #chat-room-screen.preview-root .chat-input-wrapper { z-index: 60; }
    `
};

function updateBubbleCssPreview(previewContainer, css, useDefault, theme) {
    if (!previewContainer) return;

    const innerContainer = document.getElementById('preview-inner-container');
    const titleEl = document.getElementById('preview-mode-title');
    if (!innerContainer) return;

    const mode = previewModes[currentPreviewMode] || previewModes[0];
    if (titleEl) titleEl.textContent = mode.title;

    let iframe = document.getElementById('preview-iframe');
    if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'preview-iframe';
        iframe.style.width = '100%'; iframe.style.height = '100%';
        iframe.style.border = 'none'; iframe.style.borderRadius = '8px';
        iframe.style.backgroundColor = 'transparent';
        iframe.onload = () => { iframe.contentWindow.document.addEventListener('click', e => e.preventDefault()); };
        innerContainer.innerHTML = ''; innerContainer.appendChild(iframe);
    }

    const doc = iframe.contentWindow.document;
    doc.open();

    const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
        // 别把上一轮生成的 custom-bubble-style-for-* 也搬进来，
        // 否则用户当前编辑的 CSS 会和某个聊天已保存的那份叠在一起
        .filter(el => !(el.id || '').startsWith('custom-bubble-style-for-'))
        .filter(el => !(el.id || '').startsWith('offline-narration-style-'))
        .map(el => el.outerHTML).join('\n');

    // 不加 !important，这样你手写的高级 CSS 可以轻松覆盖它，也能防止气泡无 CSS 时变透明
    const fallbackCss = `
        /* 强制提供底层主题色兜底 */
        .message-wrapper.sent .message-bubble, .message-wrapper.sent .voice-bubble { background-color: ${theme.sent.bg}; color: ${theme.sent.text}; }
        .message-wrapper.received .message-bubble, .message-wrapper.received .voice-bubble { background-color: ${theme.received.bg}; color: ${theme.received.text}; }
    `;

    // 【关键】用户 CSS 走的是和实际应用完全一样的改写函数，只是 chatId 换成 'preview'。
    // 这条不能改成原样注入 —— 那正是「预览生效、实际不生效」的来源。
    const rawUserCss = (!useDefault && css) ? css : '';
    const userCss = (rawUserCss && typeof scopeBubbleCss === 'function')
        ? scopeBubbleCss(rawUserCss, PREVIEW_CHAT_ID)
        : '';

    // 时间格式取自**同一段** rawUserCss 的 META，而不是编辑器里的 basicState ——
    // 预览的口径始终是"这段 CSS 存下去会长什么样"，和位置/颜色那些保持一致
    const shellHtml = buildPreviewShellHtml(getMessageTimeFormatFromCss(rawUserCss));
    const focusCss = PREVIEW_FOCUS_CSS[mode.focus] || '';

    doc.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            ${styles}
            <style>
                html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: transparent; }

                /* 预览取景框：真实聊天室是 flex 撑满手机壳，这里要塞进 200px 的小窗 */
                #chat-room-screen.preview-root {
                    position: relative !important;
                    height: 100% !important; width: 100% !important;
                    display: flex !important; flex-direction: column !important;
                    background-color: #eef2f5 !important;
                    overflow: hidden !important;
                    transform: none !important;
                    animation: none !important;
                    /* 手机壳圆角变量在这里没有意义，清掉免得底栏出现奇怪的圆角 */
                    --phone-corner-radius: 0px;
                    /* 预览里没有刘海/home 条，安全区归零，否则底栏凭空多一截留白 */
                    --safe-bottom: 0px;
                }

                #chat-room-screen.preview-root::before {
                    content: "OuO";
                    position: absolute;
                    top: 50%; left: 50%;
                    transform: translate(-50%, -50%) rotate(-35deg);
                    font-size: 120px;
                    font-weight: 600;
                    color: rgba(0, 0, 0, 0.1);
                    font-family: Arial, sans-serif;
                    letter-spacing: 10px;
                    pointer-events: none;
                    white-space: nowrap;
                    z-index: 0;
                }

                /* 消息区在真实页面里靠 padding-bottom 避开底栏，预览窗太矮要收一收 */
                #chat-room-screen.preview-root .message-area {
                    padding: 10px !important;
                    padding-bottom: 90px !important;
                }

                #chat-room-screen.preview-root .message-area::-webkit-scrollbar { width: 4px; }
                #chat-room-screen.preview-root .message-area::-webkit-scrollbar-thumb { background: #ccc; border-radius: 4px; }

                ${focusCss}
                ${fallbackCss}
            </style>
            <style id="user-custom-css">${userCss}</style>
        </head>
        <body>
            ${shellHtml}
        </body>
        </html>
    `);
    doc.close();
}

// 供侧边栏获取选项并填充
function populateChatThemeSelects() {
    const privateSel = document.getElementById('setting-theme-color');
    const groupSel = document.getElementById('setting-group-theme-color');
    
    // 【修改点】过滤掉名称为“默认”的预设，防止和顶部的自带默认发生选项重复渲染
    const names = _getBubblePresets().filter(p => p.name !== '默认').map(p => p.name);

    // 预设名是用户自己起的，带 < 或 " 会把拼出来的 <option> 渲染坏，所以走
    // createElement + textContent —— 跟下面 renderGlobalBubblePresets 同一写法。
    // 两个 select 不能共用同一批 option 节点（会被搬走），所以每个现造一遍。
    const fill = (sel) => {
        if (!sel) return;
        sel.innerHTML = '';
        const def = document.createElement('option');
        def.value       = 'default';
        def.textContent = '默认';
        sel.appendChild(def);
        names.forEach(name => {
            const opt = document.createElement('option');
            opt.value       = `preset:${name}`;
            opt.textContent = name;
            sel.appendChild(opt);
        });
    };

    fill(privateSel);
    fill(groupSel);
}
window.populateChatThemeSelects = populateChatThemeSelects;

// 渲染全局列表下拉框
window.renderGlobalBubblePresets = function() {
    const select = document.getElementById('global-bubble-preset-select');
    if (!select) return;
    const presets = _getBubblePresets();
    select.innerHTML = '<option value="">— 新建预设 —</option>';
    presets.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        select.appendChild(opt);
    });
};

function setupBubblePresets() {
    // 记录当前正在编辑的预设原始名称 (空表示全新新建)
    let currentEditingPresetOriginalName = ""; 

    const nameInput = document.getElementById('global-bubble-preset-name');
    const cssInput = document.getElementById('global-bubble-custom-css');
    const saveBtn = document.getElementById('global-bubble-save-btn');
    const delBtn = document.getElementById('global-bubble-delete-btn');
    const addBtn = document.getElementById('global-bubble-add-btn');

    const updatePreview = () => refreshBubbleCssPreview();
    updatePreview();

    // ================== 分栏 Tab 切换逻辑 ==================
    // 按钮只管「哪个分组」，具体亮哪块面板交给 syncAppearancePane ——
    // 「基础」下面有三块（气泡/顶栏/底栏），选哪块取决于预览翻到了第几页。
    const tabContainer = document.getElementById('tab-view-bubbles');
    if (tabContainer) {
        tabContainer.querySelectorAll('.side-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                currentAppearanceTab = btn.dataset.tab || 'basic';
                syncAppearancePane();
            });
        });
    }

    // ================== 进阶基础 UI 数据管理与 CSS 生成 ==================
    // timePos: 消息时间放哪儿 —— 'none' 不显示 / 'avatar' 头像下方 / 'above' 气泡上方 / 'tail' 气泡后。
    //   三个槽位在气泡工厂里都画了出来（见 chat_bubble_factory.js 的组装段），这里只负责
    //   放开其中一个，所以换位置是纯 CSS 的事，已经渲染出来的气泡会立刻跟着动。
    //   ★ 老预设存的是布尔 `showTime`，迁移在 syncBasicUiFromCss 里：true → 'above'。
    // timeFormat: 时间文字的模板，**不是 CSS**，由气泡工厂在渲染时按它拼字符串
    //   （解析器 formatMessageTimestamp，说明文案见本文件底部的 AppHelp.register）。
    // avatarRadius: 头像圆角，0 = 方角，19 = 正圆（头像 38px，19px 正好是 50%）。
    // header / footer: 顶栏和底栏的设置，和气泡挤在**同一个** META 里 ——
    //   它们本来就是一个预设的三个视图，分开存会出现「换预设只换了气泡」。
    //   默认值一律照抄对应的静态 CSS，这样「没改过」就一个字节都不生成（见下面的 hasChanges）。
    //   · header.namePos  'left' = chat_room.css 的 `#chat-room-header-default .title-container`
    //     那套 static + flex-start + flex-grow:1，也就是**聊天室现在的样子**。
    //     ★ 别照 components.css 写成 'center'：那条只管别的页面的顶栏，聊天室这边
    //       早被 chat_room.css 顶掉了。写错的话「什么都没改」也会生成一堆 CSS，
    //       而且会把默认的靠左悄悄变成居中。
    //   · header.hideStatus 昵称下面那行小字（绿点 + 在线），即 #chat-room-subtitle
    //   · footer.send/reply/input 分别是 #send-message-btn / #get-reply-btn / #message-input，
    //     默认值来自 chat_room.css：两颗按钮 var(--primary-color)=#0099FF + radius 5 + border:none，
    //     输入框 #ffffff + radius 5 + border:none。
    const defaultBasicState = {
        hideAvatar: false, timePos: 'none', timeFormat: 'HH:mm', avatarRadius: 19, customFont: '',
        header: { namePos: 'left', hideStatus: false },
        footer: {
            hideSend: false,
            send:  { bg:'#0099FF', strokeW:0, strokeC:'#000000', radius:5 },
            reply: { bg:'#0099FF', strokeW:0, strokeC:'#000000', radius:5 },
            input: { bg:'#FFFFFF', strokeW:0, strokeC:'#000000', radius:5 }
        },
        styles: {
            normal_sent:   { bg:'#0099FF', fontSize:16, fontColor:'#FFFFFF', opacity:1, blur:0, strokeW:0, strokeC:'#000000', radius:8, strokeSides:[] },
            normal_received:   { bg:'#FFFFFF', fontSize:16, fontColor:'#333333', opacity:1, blur:0, strokeW:0, strokeC:'#000000', radius:8, strokeSides:[] },
            // 旁白也分我方/对方，和普通气泡一个口径：
            //   narration_received = AI 写的旁白（线下模式/通话），选择器 :not(.narration-mine)
            //   narration_sent     = 用户自己在"+"面板发的「剧情旁白」，选择器 .narration-mine
            // 曾经这两者共用一个 `narration` 键、我方靠生成端硬写一条 border:none 区分，
            // 于是"我方想单独换个底色/描边"做不到。现在各自独立。
            // ★ 我方的默认值 = 对方的默认值但描边归零，这样拆分前后长得一模一样
            //   （chat_room.css 的 `.narration-mine .narration-bubble { border: none }` 就是它）。
            //   改这里要同步 tests/narration_radius_stitch.test.cjs 的默认值断言。
            narration_received: { bg:'#FFFFFF', fontSize:15, fontColor:'#555555', opacity:0.8, blur:0, strokeW:3, strokeC:'#0099FF', radius:6, strokeSides:['left'] },
            narration_sent:     { bg:'#FFFFFF', fontSize:15, fontColor:'#555555', opacity:0.8, blur:0, strokeW:0, strokeC:'#0099FF', radius:6, strokeSides:[] },
            voice_sent:    { bg:'#0099FF', fontSize:14, fontColor:'#FFFFFF', opacity:1, blur:5, strokeW:0, strokeC:'#000000', radius:8, strokeSides:[] },
            voice_received:    { bg:'#FFFFFF', fontSize:14, fontColor:'#333333', opacity:1, blur:5, strokeW:0, strokeC:'#000000', radius:8, strokeSides:[] },
            transfer_sent: { bg:'#FF9900', fontSize:14, fontColor:'#FFFFFF', opacity:1, blur:0, strokeW:0, strokeC:'#000000', radius:8, strokeSides:[] },
            transfer_received: { bg:'#FF9900', fontSize:14, fontColor:'#FFFFFF', opacity:1, blur:0, strokeW:0, strokeC:'#000000', radius:8, strokeSides:[] },
            
            quote_sent:    { bg:'#FFFFFF', fontSize:13, fontColor:'#FFFFFF', opacity:0.1, blur:0, strokeW:3, strokeC:'#FFFFFF', radius:8, strokeSides: ['left'] },
            quote_received:    { bg:'#000000', fontSize:13, fontColor:'#555555', opacity:0.04, blur:0, strokeW:3, strokeC:'#0099FF', radius:8, strokeSides:['left'] }
        }
    };

    let basicState = JSON.parse(JSON.stringify(defaultBasicState));
    let currentSelectType = 'normal_sent';
    // 底栏那块面板上「修改对象」下拉选的是谁。三个对象共用同一组控件（和气泡那块同一套路）。
    let currentFooterTarget = 'send';

    // 底栏三个对象 → 真实 DOM 选择器。改 index.html 的底栏时这里要跟着动。
    const FOOTER_SELECTORS = {
        send:  '#send-message-btn',
        reply: '#get-reply-btn',
        input: '#message-input'
    };
    
    // 把 .voice-bubble 并入 normal，让它们共享同一套样式！
    const classSelectorsMap = {
        'normal': '.message-bubble, .voice-bubble', 
        'narration': '.narration-bubble', 
        'transfer': '.transfer-card', 
        'quote': '.quoted-message'
    };

    const START_MARKER = "/* --- 自动生成：基础外观开始 (请勿在此区块内手写) --- */";
    const END_MARKER = "/* --- 自动生成：基础外观结束 --- */";

    function hexToRgba(hex, alpha) {
        if (!hex) return 'transparent';
        if (hex.startsWith('rgb')) return hex;
        let r = 0, g = 0, b = 0;
        if (hex.length === 7) { r = parseInt(hex.substring(1,3), 16); g = parseInt(hex.substring(3,5), 16); b = parseInt(hex.substring(5,7), 16); }
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function generateCssFromState() {
        let basicCss = `${START_MARKER}\n/* META:${JSON.stringify(basicState)} */\n`;
        let hasChanges = false; // 核心标记：记录是否真的修改了基础样式
        
        // 判断全局设置是否修改
        if (basicState.hideAvatar !== defaultBasicState.hideAvatar) {
            if (basicState.hideAvatar) basicCss += `.message-avatar { display: none !important; }\n`;
            hasChanges = true;
        }
        // 头像圆角。默认 19 = 正圆，和 chat_room.css 里那条 border-radius:50% 是同一个意思，
        // 所以不改就一个字节都不生成。到顶时输出 50% 而不是 19px —— 万一以后头像尺寸变了，
        // 百分比还是正圆，19px 就变成一个莫名其妙的方角了。
        if (basicState.avatarRadius !== defaultBasicState.avatarRadius) {
            const r = basicState.avatarRadius >= 19 ? '50%' : `${basicState.avatarRadius}px`;
            basicCss += `.message-avatar { border-radius: ${r} !important; }\n`;
            hasChanges = true;
        }
        // 每条消息的时间放在哪儿。气泡工厂对每条消息画了三个槽位，默认全是 display:none
        // （chat_room.css），这里按用户选的位置放开一个。
        // ★「气泡上方」必须**同时**放开两条：时间本身，以及「整行只有时间」时被收掉的那整行。
        //   少放开第二条的话，私聊里选了这个位置等于什么都没发生（整行还是 display:none）。
        //   那一行为什么要整行收掉，见 chat_room.css 的 .meta-time-only 注释（gap:4px 的坑）。
        // ★ 另外两个位置**不能**放开 .meta-time-only：时间画在别的槽位里，
        //   meta 行仍然是空的，放开它就又把那 4px 空隙请回来了。
        // ★ 'avatar' 还要把 .message-avatar-col 从 display:contents 翻成真正的 flex 列，
        //   默认那个 contents 的用意见 chat_room.css 那段注释。
        if (basicState.timePos !== defaultBasicState.timePos) {
            if (basicState.timePos === 'above') {
                basicCss += `.message-time { display: inline !important; }\n`;
                basicCss += `.message-meta-info.meta-time-only { display: flex !important; }\n`;
            } else if (basicState.timePos === 'avatar') {
                basicCss += `.message-avatar-col { display: flex !important; }\n`;
                basicCss += `.message-time-avatar { display: block !important; }\n`;
            } else if (basicState.timePos === 'tail') {
                basicCss += `.message-time-tail { display: block !important; }\n`;
            }
            hasChanges = true;
        }
        // 时间格式只影响文字内容、生成不出 CSS，但仍要让 hasChanges 为真 ——
        // 否则整个自动生成区块（连同存着 timeFormat 的 META 注释）会被下面那段
        // 「没改动就彻底删掉」的逻辑连锅端走，用户改的格式存不下来。
        if (basicState.timeFormat !== defaultBasicState.timeFormat) {
            hasChanges = true;
        }
        if (basicState.customFont !== defaultBasicState.customFont) {
            if (basicState.customFont) {
                basicCss += `@font-face { font-family: 'CustomBubbleFont'; src: url('${basicState.customFont}'); }\n`;
                basicCss += `.message-bubble, .narration-bubble, .voice-bubble, .transfer-card, .quoted-message { font-family: 'CustomBubbleFont' !important; }\n`;
            }
            hasChanges = true;
        }

        // ============ 顶栏 ============
        // 选择器统一钉在 #chat-room-header-default 上，不用裸 .app-header ——
        // 聊天室里有**两个** .app-header，另一个是多选态的 #chat-room-header-select
        // （只有「取消 / 选择消息 / 显示隐藏」三件套）。把昵称位置顺手改到它身上，
        // 等于用户进多选时标题莫名其妙挪了个位置。
        const hdr = basicState.header || defaultBasicState.header;
        const hdrDef = defaultBasicState.header;
        if (hdr.namePos !== hdrDef.namePos) {
            // ★ 聊天室顶栏的默认**不是**居中。components.css 那套 absolute 居中被
            //   chat_room.css 的 `#chat-room-header-default .title-container`
            //   （static + flex-start + flex-grow:1）整个顶掉了 —— 所以默认档是「靠左」，
            //   那一档一个字节都不生成。照 components.css 去写「复位到流里」只会是空操作。
            // 实测（无头 Chrome 量 Range 的 getBoundingClientRect，470px 宽顶栏）：
            //   默认/靠左  文字 42~76   中心 59   ← 顶栏中心是 235
            //   居中       文字 218~252 中心 235  ← 和顶栏中心重合
            //   靠右       文字 372~406          ← 紧贴按钮组左边缘 406
            if (hdr.namePos === 'center') {
                // 居中要把 absolute 那套请回来：容器本身是 flex-grow:1 占满
                // 「返回键右边 ~ 按钮组左边」这一段，在里面 align-items:center 只能居中于
                // 这一段（偏左约 22px，两侧按钮宽度不等），看着像没对齐。
                basicCss += `#chat-room-header-default .title-container {`
                    + ` position: absolute !important;`
                    + ` left: 50% !important;`
                    + ` transform: translateX(-50%) !important;`
                    + ` align-items: center !important;`
                    + ` text-align: center !important;`
                    + ` flex-grow: 0 !important; }\n`;
            } else if (hdr.namePos === 'right') {
                // 容器已经是 flex-grow:1 了，只要把里面的内容推到容器右边缘即可，
                // 不用动 position/margin —— 动了反而要再把 flex 那套重新拼回来。
                basicCss += `#chat-room-header-default .title-container {`
                    + ` align-items: flex-end !important;`
                    + ` text-align: right !important; }\n`;
            }
            hasChanges = true;
        }
        if (hdr.hideStatus !== hdrDef.hideStatus) {
            // ★ !important 是必须的：chat_room.js 进私聊时写的是 inline 的
            //   subtitle.style.display='flex'，内联样式只有 !important 压得住。
            //   群聊那边本来就被置成 none，这条叠上去无害。
            if (hdr.hideStatus) basicCss += `#chat-room-subtitle { display: none !important; }\n`;
            hasChanges = true;
        }

        // ============ 底栏 ============
        const ftr = basicState.footer || defaultBasicState.footer;
        const ftrDef = defaultBasicState.footer;
        if (ftr.hideSend !== ftrDef.hideSend) {
            // 藏了照样能发：回车走的是 chat_room.js 里 #message-input 的 keydown 分支，
            // 和这颗按钮的 click/touchend 是三条各自独立的通道。
            if (ftr.hideSend) basicCss += `#send-message-btn { display: none !important; }\n`;
            hasChanges = true;
        }
        for (const key of Object.keys(FOOTER_SELECTORS)) {
            const conf = ftr[key] || ftrDef[key];
            const def = ftrDef[key];
            const sel = FOOTER_SELECTORS[key];

            // 底色单独一条、挂 :not(:disabled)。两颗按钮在「正在生成」期间是 disabled 的
            // （chat_ai_service.js 给 #get-reply-btn 置的），chat_room.css 那条
            // `.message-input-area .icon-btn:disabled { background-color:#cccccc }`
            // 权重远低于这里 scope 过的选择器 —— 不加 :not(:disabled) 就等于
            // 把「生成中变灰」这个唯一的进度反馈抹掉了。
            if ((conf.bg || '').toUpperCase() !== def.bg.toUpperCase()) {
                // .message-input-area .icon-btn 用的是 background 简写，这里只改 background-color；
                // 简写剩下的部分（没有渐变/图片）不受影响。
                basicCss += `${sel}:not(:disabled) { background-color: ${conf.bg} !important; }\n`;
                hasChanges = true;
            }

            // 弧度和描边反过来，连 disabled 态一起改 —— 变灰只该换颜色，不该把形状也变回去。
            let shapeCss = '';
            if (conf.radius !== def.radius) {
                shapeCss += ` border-radius: ${conf.radius}px !important;`;
            }
            if (conf.strokeW !== def.strokeW || (conf.strokeC || '').toUpperCase() !== def.strokeC.toUpperCase()) {
                shapeCss += (conf.strokeW > 0)
                    ? ` border: ${conf.strokeW}px solid ${conf.strokeC} !important;`
                    : ` border: none !important;`;
            }
            if (shapeCss) {
                basicCss += `${sel} {${shapeCss} }\n`;
                hasChanges = true;
            }
        }

        // 遍历所有气泡类型，仅当属性与默认值不同时才生成代码
        for (const [typeKey, conf] of Object.entries(basicState.styles)) {
            if (typeKey.startsWith('voice_')) continue;

            const isNarration = typeKey.startsWith('narration');
            const baseType = isNarration ? 'narration' : typeKey.split('_')[0];
            const sel = classSelectorsMap[baseType];
            if(!sel) continue;

            // 旁白的「我方」是用户自己在"+"面板发的剧情旁白（.narration-mine），
            // 「对方」是 AI 在线下模式/通话里写的（:not(.narration-mine)）。
            // 下面主规则、圆角拼接、描边去内侧边三处都拿这一个 nwSelf 拼选择器 ——
            // 分头硬写过一次，结果是调我方圆角会把对方的拼接规则一起盖掉。
            const nwSelf = !isNarration ? ''
                : (typeKey === 'narration_sent'
                    ? '.message-wrapper.narration-wrapper.narration-mine'
                    : '.message-wrapper.narration-wrapper:not(.narration-mine)');

            let ruleSel = '';
            if (isNarration) {
                ruleSel = `${nwSelf} ${sel}`;
            } else {
                const sideClass = typeKey.split('_')[1] === 'recv' ? 'received' : typeKey.split('_')[1];
                ruleSel = sel.split(',').map(s => {
                    const sTrim = s.trim();
                    return `.message-wrapper.${sideClass} ${sTrim}, ${sTrim}.${sideClass}`;
                }).join(', ');
            }

            const defaultConf = defaultBasicState.styles[typeKey];
            let typeCss = '';
            let isTypeChanged = false;

            // 1. 颜色与透明度对比
            if (conf.bg.toUpperCase() !== defaultConf.bg.toUpperCase() || conf.opacity !== defaultConf.opacity) {
                const bg = hexToRgba(conf.bg, conf.opacity);
                typeCss += ` background-color: ${bg} !important;`;
                isTypeChanged = true;
                hasChanges = true;
                
                // 伪元素智能染色
                if (baseType === 'normal' && cssInput && cssInput.value) {
                    const customCss = cssInput.value;
                    const sideClass = typeKey.split('_')[1] === 'recv' ? 'received' : typeKey.split('_')[1];
                    const pseudoRegex = new RegExp(`(?:message-bubble[^:{]*${sideClass}|${sideClass}[^:{]*message-bubble)::(after|before)[^:{]*\\{([^}]+)\\}`, 'ig');
                    
                    let pseudoMatch;
                    while ((pseudoMatch = pseudoRegex.exec(customCss)) !== null) {
                        const pseudoType = pseudoMatch[1];
                        const pseudoRules = pseudoMatch[2];
                        const normalBubbleSel = `.message-wrapper.${sideClass} .message-bubble, .message-bubble.${sideClass}`;
                        const pseudoSelectors = normalBubbleSel.split(',').map(s => `#chat-room-screen ${s.trim()}::${pseudoType}`).join(', ');

                        const borderRegex = /border-(left|right|top|bottom)(?:-color)?\s*:\s*([^;!]+)/ig;
                        let borderMatch;
                        while ((borderMatch = borderRegex.exec(pseudoRules)) !== null) {
                            if (!borderMatch[2].includes('transparent')) basicCss += `${pseudoSelectors} { border-${borderMatch[1]}-color: ${bg} !important; }\n`;
                        }

                        const bgRegex = /(?:^|[^\w-])background(?:-color)?\s*:\s*([^;!]+)/ig;
                        let bgMatch;
                        while ((bgMatch = bgRegex.exec(pseudoRules)) !== null) {
                            if (!bgMatch[1].includes('transparent') && !bgMatch[1].includes('url')) basicCss += `${pseudoSelectors} { background-color: ${bg} !important; }\n`;
                        }
                    }
                }
            }

            // 2. 毛玻璃对比
            if (conf.blur !== defaultConf.blur) {
                const blur = conf.blur > 0 ? `blur(${conf.blur}px)` : 'none';
                typeCss += ` backdrop-filter: ${blur} !important; -webkit-backdrop-filter: ${blur} !important;`;
                isTypeChanged = true;
                hasChanges = true;
            }

            // 3. 圆角对比
            if (conf.radius !== defaultConf.radius) {
                typeCss += ` border-radius: ${conf.radius}px !important;`;
                isTypeChanged = true;
                hasChanges = true;

                // 旁白是「连续多条拼成一张大卡片」的：chat_room.css 用 :has(+...) / +
                // 把相邻两条之间的圆角和边框压平。上面这句 border-radius 带 !important
                // 且生成得更晚，会把那几条压平规则全部盖掉 —— 表现就是用户一调圆角，
                // 大卡片碎成一堆各自带圆角的小气泡。
                // 所以这里必须把拼接规则按用户的新半径重新生成一遍：
                // 首条只圆上两角、末条只圆下两角、中间四角全平。
                if (isNarration) {
                    // ★ 只和**同类**拼接：AI 旁白是 :not(.narration-mine)，用户自己发的
                    //   剧情旁白是 .narration-mine。分组方式必须和 chat_room.css 那几条
                    //   一模一样，否则"默认样式下谁跟谁连"和"自定义之后谁跟谁连"会分叉。
                    //   两类各有自己的圆角，所以这里只生成 nwSelf 这一类 —— 早先是一次把
                    //   两类都按同一个 conf.radius 生成，拆开之后那样会让后遍历到的那类
                    //   把前一类刚生成的拼接规则按错误半径重写一遍。
                    const r = `${conf.radius}px`;
                    const nw = nwSelf;
                    // 后面还有同类旁白 → 我不是最后一条 → 底部两角压平
                    basicCss += `${nw}:has(+ ${nw}) ${sel} {`
                        + ` border-bottom-left-radius: 0 !important;`
                        + ` border-bottom-right-radius: 0 !important;`
                        + ` border-top-left-radius: ${r} !important;`
                        + ` border-top-right-radius: ${r} !important; }\n`;
                    // 前面还有同类旁白 → 我不是第一条 → 顶部两角压平
                    basicCss += `${nw} + ${nw} ${sel} {`
                        + ` border-top-left-radius: 0 !important;`
                        + ` border-top-right-radius: 0 !important; }\n`;
                    // 既有前也有后 → 中间条 → 四角全平
                    // （上面两条已经能推出这个结果，但显式写一遍防止将来谁改动其中一条时破功）
                    basicCss += `${nw} + ${nw}:has(+ ${nw}) ${sel} {`
                        + ` border-radius: 0 !important; }\n`;
                }
            }

            // 4. 字号对比
            if (conf.fontSize !== defaultConf.fontSize) {
                typeCss += ` font-size: ${conf.fontSize}px !important;`;
                isTypeChanged = true;
                hasChanges = true;
            }

            // 5. 字体颜色对比
            if (conf.fontColor.toUpperCase() !== defaultConf.fontColor.toUpperCase()) {
                typeCss += ` color: ${conf.fontColor} !important;`;
                isTypeChanged = true;
                hasChanges = true;
            }

            // 6. 描边设置对比
            if (conf.strokeW !== defaultConf.strokeW || conf.strokeC.toUpperCase() !== defaultConf.strokeC.toUpperCase() || JSON.stringify(conf.strokeSides) !== JSON.stringify(defaultConf.strokeSides)) {
                isTypeChanged = true;
                hasChanges = true;
                const sides = conf.strokeSides ||[];
                if (conf.strokeW > 0) {
                    if (sides.length === 4) {
                        typeCss += ` border: ${conf.strokeW}px solid ${conf.strokeC} !important;`;
                    } else if (sides.length > 0) {['top', 'right', 'bottom', 'left'].forEach(side => {
                            if (sides.includes(side)) {
                                typeCss += ` border-${side}: ${conf.strokeW}px solid ${conf.strokeC} !important;`;
                            } else {
                                typeCss += ` border-${side}: none !important;`;
                            }
                        });
                    } else {
                        typeCss += ` border: none !important;`;
                    }
                } else {
                    typeCss += ` border: none !important;`;
                }

                // ★ 这里曾经硬写一条「我方旁白一律 border: none」—— 那是两类共用一套设置
                //   时用来区分谁写的。现在我方是独立的一类（narration_sent，默认 strokeW:0），
                //   描边归用户自己调，硬写会让他刚调好的我方描边当场消失。
                //   "默认不画描边"这件事由默认值 + chat_room.css 那条静态规则负责。

                // 旁白的上下描边要「只描整组的外沿」，理由和圆角那条一样：
                // 选了上+下的话，每条旁白都会各自画一条上边和一条下边，
                // 相邻两条的接缝处就叠出两条横线，横穿本该是一整张的大卡片。
                // 所以把内侧那条边去掉：不是最后一条就没有下边，不是第一条就没有上边。
                // 左右边不用管 —— 它们沿着卡片侧面连成一条，本来就是想要的效果。
                // ★ 只处理 nwSelf 这一类：两类的描边各调各的，跨类去边会误伤。
                if (isNarration && conf.strokeW > 0) {
                    const nw = nwSelf;
                    if (sides.length === 4 || sides.includes('bottom')) {
                        // 后面还有旁白 → 我不是最后一条 → 去掉下边
                        basicCss += `${nw}:has(+ ${nw}) ${sel} { border-bottom: none !important; }\n`;
                    }
                    if (sides.length === 4 || sides.includes('top')) {
                        // 前面还有旁白 → 我不是第一条 → 去掉上边
                        basicCss += `${nw} + ${nw} ${sel} { border-top: none !important; }\n`;
                    }
                }
            }

            if (isTypeChanged && typeCss) {
                basicCss += `${ruleSel} {${typeCss} }\n`;
            }

            // 7. 特殊子元素颜色同步 (引用与图标)
            if (baseType === 'quote') {
                if (conf.fontColor.toUpperCase() !== defaultConf.fontColor.toUpperCase()) {
                    const innerSel = ruleSel.split(',').map(s => `${s.trim()} .quoted-sender, ${s.trim()} .quoted-text, ${s.trim()} .quoted-content`).join(', ');
                    basicCss += `${innerSel} { color: ${conf.fontColor} !important; }\n`;
                }
                if (conf.fontSize !== defaultConf.fontSize) {
                    const senderSel = ruleSel.split(',').map(s => `${s.trim()} .quoted-sender`).join(', ');
                    const textSel = ruleSel.split(',').map(s => `${s.trim()} .quoted-text, ${s.trim()} .quoted-content`).join(', ');
                    basicCss += `${senderSel} { font-size: ${conf.fontSize + 1}px !important; }\n`;
                    basicCss += `${textSel} { font-size: ${conf.fontSize}px !important; }\n`;
                }
            }

            if (baseType === 'normal' && conf.fontColor.toUpperCase() !== defaultConf.fontColor.toUpperCase()) {
                const svgSel = ruleSel.split(',').map(s => `${s.trim()} svg`).join(', ');
                basicCss += `${svgSel} { color: ${conf.fontColor} !important; fill: ${conf.fontColor} !important; }\n`;
            }
        }

        basicCss += `${END_MARKER}`;
        
        if (cssInput) {
            let currentCss = cssInput.value;
            const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`${escapeRegExp(START_MARKER)}[\\s\\S]*?${escapeRegExp(END_MARKER)}\\n?`);

            if (!hasChanges) {
                // 【核心逻辑】：如果没有任何改动，彻底删掉整个基础生成区块！不留一丝痕迹！
                if (regex.test(currentCss)) {
                    cssInput.value = currentCss.replace(regex, '').trim() + (currentCss.replace(regex, '').trim() ? '\n' : '');
                }
            } else {
                if (regex.test(currentCss)) {
                    cssInput.value = currentCss.replace(regex, basicCss + '\n');
                } else {
                    if (currentCss.trim() !== '' && !currentCss.endsWith('\n')) currentCss += '\n\n';
                    else if (currentCss.trim() !== '') currentCss += '\n';
                    cssInput.value = currentCss + basicCss + '\n';
                }
            }
            updatePreview();
        }
    }

    // 两个条件行：头像弧度只在「显示头像」时有意义，时间格式只在时间真的显示时有意义。
    // 收行用 display:'none' / 复原用 ''（让 CSS 里的 flex 生效），别写死 'flex' ——
    // .row 和 .col 两种行的 flex-direction 不一样，写死会把竖排的滑块行压成横排。
    function syncConditionalRows() {
        const radiusRow = document.getElementById('avatar-radius-row');
        if (radiusRow) radiusRow.style.display = basicState.hideAvatar ? 'none' : '';
        const fmtRow = document.getElementById('time-format-row');
        if (fmtRow) fmtRow.style.display = (basicState.timePos === 'none') ? 'none' : '';

        // 头像藏了就不该还能选「头像下方」：那一档生成的是「把头像列翻成 flex 列」，
        // 头像本身 display:none 之后列里只剩一个时间，宽度由时间文字决定，
        // 气泡左边缘会随每条消息的时间长短参差不齐。选中时强制退回「气泡上方」。
        const posSelect = document.getElementById('setting-time-pos');
        if (posSelect) {
            const avatarOpt = posSelect.querySelector('option[value="avatar"]');
            if (avatarOpt) avatarOpt.disabled = basicState.hideAvatar;
        }

        // 同理，发送按钮藏了就不该还能给它调色 —— 调了也看不见，只会让人以为没生效。
        // 正停在这一项上的话把「修改对象」顶到 AI 回复按钮。
        const ftrSelect = document.getElementById('setting-footer-target');
        if (ftrSelect) {
            const hideSend = !!(basicState.footer && basicState.footer.hideSend);
            const sendOpt = ftrSelect.querySelector('option[value="send"]');
            if (sendOpt) sendOpt.disabled = hideSend;
            if (hideSend && currentFooterTarget === 'send') {
                currentFooterTarget = 'reply';
                ftrSelect.value = 'reply';
            }
        }
    }

    function updateUIFromState() {
        document.getElementById('setting-hide-avatar').checked = basicState.hideAvatar;
        document.getElementById('setting-time-pos').value = basicState.timePos;
        document.getElementById('setting-time-format').value = basicState.timeFormat;
        document.getElementById('setting-avatar-radius').value = basicState.avatarRadius;
        document.getElementById('val-avatar-radius').textContent =
            basicState.avatarRadius >= 19 ? '正圆' : `${basicState.avatarRadius}px`;
        document.getElementById('setting-custom-font').value = basicState.customFont;
        syncConditionalRows();
        const typeConf = basicState.styles[currentSelectType];
        
        // 色值同步
        document.getElementById('setting-bg').value = typeConf.bg;
        document.getElementById('setting-bg-text').value = typeConf.bg.toUpperCase();
        document.getElementById('setting-fontcolor').value = typeConf.fontColor;
        document.getElementById('setting-fontcolor-text').value = typeConf.fontColor.toUpperCase();
        document.getElementById('setting-stroke-c').value = typeConf.strokeC;
        document.getElementById('setting-stroke-c-text').value = typeConf.strokeC.toUpperCase();

        // 局部滑块数值与文本显示同步
        const props =['fontsize', 'opacity', 'blur', 'stroke-w', 'radius'];
        const stateKeys =['fontSize', 'opacity', 'blur', 'strokeW', 'radius'];
        
        props.forEach((prop, index) => {
            const inputEl = document.getElementById(`setting-${prop}`);
            const textEl = document.getElementById(`val-${prop}`);
            if (inputEl && textEl) {
                inputEl.value = typeConf[stateKeys[index]];
                textEl.textContent = typeConf[stateKeys[index]];
            }
        });
        const sides = typeConf.strokeSides ||[];
        document.querySelectorAll('.stroke-side-cb').forEach(cb => {
            cb.checked = sides.includes(cb.value);
        });

        // ---- 顶栏那块面板 ----
        const namePosEl = document.getElementById('setting-header-name-pos');
        if (namePosEl) namePosEl.value = (basicState.header || defaultBasicState.header).namePos;
        const hideStatusEl = document.getElementById('setting-header-hide-status');
        if (hideStatusEl) hideStatusEl.checked = !!(basicState.header || {}).hideStatus;

        // ---- 底栏那块面板 ----
        const hideSendEl = document.getElementById('setting-footer-hide-send');
        if (hideSendEl) hideSendEl.checked = !!(basicState.footer || {}).hideSend;
        const ftrSelectEl = document.getElementById('setting-footer-target');
        if (ftrSelectEl) ftrSelectEl.value = currentFooterTarget;
        const ftrLabelEl = document.getElementById('current-footer-label');
        if (ftrLabelEl && ftrSelectEl && ftrSelectEl.selectedIndex >= 0) {
            ftrLabelEl.textContent = ftrSelectEl.options[ftrSelectEl.selectedIndex].text;
        }
        const ftrConf = (basicState.footer || {})[currentFooterTarget]
            || defaultBasicState.footer[currentFooterTarget];
        const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
        const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        setVal('setting-footer-bg', ftrConf.bg);
        setVal('setting-footer-bg-text', String(ftrConf.bg).toUpperCase());
        setVal('setting-footer-stroke-c', ftrConf.strokeC);
        setVal('setting-footer-stroke-c-text', String(ftrConf.strokeC).toUpperCase());
        setVal('setting-footer-stroke-w', ftrConf.strokeW);
        setTxt('val-footer-stroke-w', ftrConf.strokeW);
        setVal('setting-footer-radius', ftrConf.radius);
        setTxt('val-footer-radius', ftrConf.radius);
    }

function syncBasicUiFromCss(css) {
        if (!css) { basicState = JSON.parse(JSON.stringify(defaultBasicState)); } 
        else {
            const metaMatch = css.match(/\/\* META:(.+?) \*\//);
            let parsedFromMeta = false;
            if (metaMatch && metaMatch[1]) {
                try {
                    const parsed = JSON.parse(metaMatch[1]);
                    // 兼容迁移：旁白曾经是**一个** `narration` 键（两侧共用一套设置，
                    // 我方靠生成端硬写 border:none 区分）。现在拆成 narration_sent /
                    // narration_received 两键，所以把老值往两边各复制一份。
                    // ★ 我方那份必须把描边清零 —— 老版本我方**实际渲染出来**就是没描边的，
                    //   原样复制过去会让老预设一加载就凭空长出一圈描边（用户看到的是
                    //   "我啥也没动，我方旁白怎么多了条线"）。
                    // ★ 比这更老的预设里也出现过 narration_sent/narration_received 这两个键名
                    //   （那时候还没有"我方旁白"这个概念，是另一套语义）。它们键名正好对得上，
                    //   原样放行即可，不值得为那批数据再猜一层。
                    if (parsed.styles && parsed.styles.narration) {
                        const legacy = parsed.styles.narration;
                        if (!parsed.styles.narration_received) {
                            parsed.styles.narration_received = { ...legacy };
                        }
                        if (!parsed.styles.narration_sent) {
                            parsed.styles.narration_sent = { ...legacy, strokeW: 0, strokeSides: [] };
                        }
                        delete parsed.styles.narration;
                    }

                    // 【核心修复】使用深度合并，坚决防止 defaultBasicState 里的默认属性被意外覆盖为 undefined
                    basicState = JSON.parse(JSON.stringify(defaultBasicState));
                    if (parsed.hideAvatar !== undefined) basicState.hideAvatar = parsed.hideAvatar;
                    // 时间位置：老预设存的是布尔 showTime（那时候只有"气泡上方"一个位置），
                    // 迁移成 timePos。两个都在时以新的为准 —— 生成端已经不写 showTime 了，
                    // 还留着的一定是更老的那份。
                    if (parsed.timePos !== undefined) {
                        basicState.timePos = parsed.timePos;
                    } else if (parsed.showTime !== undefined) {
                        basicState.timePos = parsed.showTime ? 'above' : 'none';
                    }
                    if (parsed.timeFormat !== undefined) basicState.timeFormat = parsed.timeFormat;
                    if (parsed.avatarRadius !== undefined) basicState.avatarRadius = parsed.avatarRadius;
                    if (parsed.customFont !== undefined) basicState.customFont = parsed.customFont;
                    if (parsed.marginY !== undefined) basicState.marginY = parsed.marginY;
                    if (parsed.marginX !== undefined) basicState.marginX = parsed.marginX;

                    // 顶栏/底栏是后加的，比它早的预设里这两个键根本不存在 ——
                    // 一律浅合并到默认值上，缺的字段就按默认走。
                    if (parsed.header) {
                        basicState.header = { ...defaultBasicState.header, ...parsed.header };
                    }
                    if (parsed.footer) {
                        basicState.footer = { ...defaultBasicState.footer, ...parsed.footer };
                        // footer 里还嵌着三个对象。上面那层浅合并会把 parsed 里存在的那个键
                        // **整块**顶掉，所以每个对象得再单独合一次，底板必须取
                        // defaultBasicState（basicState.footer[k] 此刻已经是 parsed 的版本了）。
                        ['send', 'reply', 'input'].forEach(k => {
                            if (parsed.footer[k]) {
                                basicState.footer[k] = { ...defaultBasicState.footer[k], ...parsed.footer[k] };
                            }
                        });
                    }
                    
                    if (parsed.styles) {
                        for (const key in parsed.styles) {
                            if (basicState.styles[key]) {
                                basicState.styles[key] = { ...basicState.styles[key], ...parsed.styles[key] };
                            }
                        }
                    }
                    parsedFromMeta = true;
                } catch(e) { console.error('解析META配置失败', e); }
            }
            
            // ======== 终极进阶版：支持基类提取、分段合并读取与子元素防误伤 ========
            if (!parsedFromMeta) {
                basicState = JSON.parse(JSON.stringify(defaultBasicState));
                
                function extractColorToHexAndAlpha(colorStr) {
                    colorStr = colorStr.trim().toLowerCase();
                    if (colorStr.startsWith('rgba')) {
                        let m = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
                        if (m) {
                            let r = parseInt(m[1]).toString(16).padStart(2, '0');
                            let g = parseInt(m[2]).toString(16).padStart(2, '0');
                            let b = parseInt(m[3]).toString(16).padStart(2, '0');
                            let a = m[4] !== undefined ? parseFloat(m[4]) : 1;
                            return { hex: `#${r}${g}${b}`.toUpperCase(), alpha: a };
                        }
                    } else if (colorStr.startsWith('rgb')) {
                        let m = colorStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
                        if (m) {
                            let r = parseInt(m[1]).toString(16).padStart(2, '0');
                            let g = parseInt(m[2]).toString(16).padStart(2, '0');
                            let b = parseInt(m[3]).toString(16).padStart(2, '0');
                            return { hex: `#${r}${g}${b}`.toUpperCase(), alpha: 1 };
                        }
                    } else if (colorStr.startsWith('#')) {
                        if (colorStr.length === 4) {
                            let r = colorStr[1], g = colorStr[2], b = colorStr[3];
                            return { hex: `#${r}${r}${g}${g}${b}${b}`.toUpperCase(), alpha: 1 };
                        } else if (colorStr.length === 9) {
                            let alpha = parseInt(colorStr.substring(7, 9), 16) / 255;
                            return { hex: colorStr.substring(0, 7).toUpperCase(), alpha: parseFloat(alpha.toFixed(2)) };
                        } else {
                            return { hex: colorStr.substring(0, 7).toUpperCase(), alpha: 1 };
                        }
                    }
                    return null;
                }

                function parseRulesToState(rules, targetStateObj) {
                    const bgMatch = rules.match(/background-color:\s*([^!;}]+)/i) || rules.match(/(?:^|[^-])background:\s*([^!;}]+)/i);
                    if (bgMatch && !bgMatch[1].includes('url')) {
                        const parsedColor = extractColorToHexAndAlpha(bgMatch[1]);
                        if (parsedColor) {
                            targetStateObj.bg = parsedColor.hex;
                            targetStateObj.opacity = parsedColor.alpha;
                        }
                    }
                    const colorMatch = rules.match(/(?:^|[^a-z-])color:\s*([^!;}]+)/i);
                    if (colorMatch) {
                        const parsedColor = extractColorToHexAndAlpha(colorMatch[1]);
                        if (parsedColor) targetStateObj.fontColor = parsedColor.hex;
                    }
                    const fontMatch = rules.match(/font-size:\s*([\d.]+)px/i);
                    if (fontMatch) targetStateObj.fontSize = parseFloat(fontMatch[1]);

                    const radiusMatch = rules.match(/border-radius:\s*([\d.]+)px/i);
                    if (radiusMatch) targetStateObj.radius = parseFloat(radiusMatch[1]);

                    const blurMatch = rules.match(/blur\(([\d.]+)px\)/i);
                    if (blurMatch) targetStateObj.blur = parseFloat(blurMatch[1]);

                    const borderMatch = rules.match(/(?:^|[^-])border:\s*([\d.]+)px\s+(?:solid\s+)?([^!;}]+)/i);
                    if (borderMatch) {
                        targetStateObj.strokeW = parseFloat(borderMatch[1]);
                        const parsedColor = extractColorToHexAndAlpha(borderMatch[2]);
                        if (parsedColor) targetStateObj.strokeC = parsedColor.hex;
                        targetStateObj.strokeSides =['top', 'right', 'bottom', 'left'];
                    } else {
                        let foundSide = false;
                        let sides =[];['top', 'right', 'bottom', 'left'].forEach(side => {
                            const regex = new RegExp(`border-${side}:\\s*([\\d.]+)px\\s+(?:solid\\s+)?([^!;}]+)`, 'i');
                            const match = rules.match(regex);
                            if (match) {
                                targetStateObj.strokeW = parseFloat(match[1]); 
                                const parsedColor = extractColorToHexAndAlpha(match[2]);
                                if (parsedColor) targetStateObj.strokeC = parsedColor.hex;
                                sides.push(side);
                                foundSide = true;
                            }
                        });
                        if (foundSide) {
                            targetStateObj.strokeSides = sides;
                        }
                    }
                }

                let baseBubbleRules = "";
                const baseRegex = /\.message-bubble(?![^{]*\.(?:sent|received))\s*(?:,[^{]*)?\{([^}]+)\}/ig;
                let baseMatch;
                while ((baseMatch = baseRegex.exec(css)) !== null) { baseBubbleRules += baseMatch[1] + ";"; }

                if (baseBubbleRules) {
                    parseRulesToState(baseBubbleRules, basicState.styles['normal_sent']);
                    parseRulesToState(baseBubbleRules, basicState.styles['normal_received']);
                }

                const classMap = {
                    'normal_sent': /\.message-bubble\.sent\s*(?:,[^{]*)?\{([^}]+)\}/ig,
                    'normal_received': /\.message-bubble\.received\s*(?:,[^{]*)?\{([^}]+)\}/ig,
                    'narration_received': /\.narration-bubble[^{]*\{([^}]+)\}/ig,
                    'narration_sent': /\.narration-bubble[^{]*\{([^}]+)\}/ig,
                    'voice_sent': /\.sent\s+\.voice-bubble\s*(?:,[^{]*)?\{([^}]+)\}/ig,
                    'voice_received': /\.received\s+\.voice-bubble\s*(?:,[^{]*)?\{([^}]+)\}/ig,
                    'transfer_sent': /\.sent(?:-transfer|\s+\.transfer-card)\s*(?:,[^{]*)?\{([^}]+)\}/ig,
                    'transfer_received': /\.received(?:-transfer|\s+\.transfer-card)\s*(?:,[^{]*)?\{([^}]+)\}/ig,
                    'quote_sent': /\.sent\s+\.quoted-message\s*(?:,[^{]*)?\{([^}]+)\}/ig,
                    'quote_received': /\.received\s+\.quoted-message\s*(?:,[^{]*)?\{([^}]+)\}/ig
                };

                for (const[key, regex] of Object.entries(classMap)) {
                    let match; let combinedRules = "";
                    while ((match = regex.exec(css)) !== null) { combinedRules += match[1] + ";"; }
                    if (combinedRules) {
                        parseRulesToState(combinedRules, basicState.styles[key]);
                    }
                }

                // 我方旁白（.narration-mine）的专属规则最后再盖一次：上面两侧都先吃了一遍
                // 通用的 `.narration-bubble`，这一遍把"我方单独改过的那部分"补上。
                // 已知不精确：那条通用正则也会吃到 `.narration-mine … .narration-bubble`，
                // 于是我方的值会渗进对方那份。这条回退路径只在**手写 CSS 且没有 META 注释**时
                // 才跑（生成端一律带 META），不值得为它再写一个选择器解析器。
                const mineNarrationRegex = /\.narration-mine[^{]*\.narration-bubble[^{]*\{([^}]+)\}/ig;
                let mineMatch; let mineRules = "";
                while ((mineMatch = mineNarrationRegex.exec(css)) !== null) { mineRules += mineMatch[1] + ";"; }
                if (mineRules) {
                    parseRulesToState(mineRules, basicState.styles['narration_sent']);
                }

                if (/(?:\.message-avatar|\.avatar|avatar)[^{]*\{[^}]*(?:display:\s*none|opacity:\s*0|visibility:\s*hidden)/i.test(css) ||
                    /\.message-info[^{]*\{[^}]*display:\s*none/i.test(css)) {
                    basicState.hideAvatar = true;
                }

                // 手写 CSS 里把某个时间槽位放出来了就把下拉回显到对应位置，否则用户一碰别的
                // 滑块，生成端会按"当前是不显示"补一段规则，把他自己写的那条顶掉。
                // 顺序即优先级：三个都写了的话按"最靠后的那个位置"算，反正手写成这样本来就没定论。
                if (/\.message-time\b[^{]*\{[^}]*display:\s*(?!none)[a-z-]+/i.test(css)) {
                    basicState.timePos = 'above';
                }
                if (/\.message-time-avatar[^{]*\{[^}]*display:\s*(?!none)[a-z-]+/i.test(css)) {
                    basicState.timePos = 'avatar';
                }
                if (/\.message-time-tail[^{]*\{[^}]*display:\s*(?!none)[a-z-]+/i.test(css)) {
                    basicState.timePos = 'tail';
                }

                // 头像圆角同理。`50%` 和 19px 都算正圆（头像 38px）。
                const avatarRadiusMatch = css.match(/\.message-avatar\s*\{[^}]*border-radius:\s*([\d.]+)(px|%)/i);
                if (avatarRadiusMatch) {
                    const num = parseFloat(avatarRadiusMatch[1]);
                    basicState.avatarRadius = (avatarRadiusMatch[2] === '%')
                        ? 19
                        : Math.max(0, Math.min(19, Math.round(num)));
                }
                
                const fontFaceMatch = css.match(/@font-face\s*\{[^}]*src:\s*url\(['"]([^'"]+)['"]\)/i);
                if (fontFaceMatch) { basicState.customFont = fontFaceMatch[1]; }
            }
        }
        updateUIFromState();
    }

    // ================= 绑定所有的 UI 事件 =================
    const typeSelect = document.getElementById('setting-bubble-type');
    const sideSelect = document.getElementById('setting-bubble-side');

    function updateTypeLabel() {
        const t = typeSelect.value;
        const s = sideSelect.value;
        // 旁白以前是「中立」的一类、side 下拉被禁用；现在和普通气泡一样分两侧：
        // 我方 = 用户自己发的剧情旁白，对方 = AI 写的旁白。
        sideSelect.disabled = false;
        currentSelectType = `${t}_${s}`;
        const tName = typeSelect.options[typeSelect.selectedIndex].text;
        const sName = sideSelect.options[sideSelect.selectedIndex].text;
        document.getElementById('current-type-label').textContent = `${tName} - ${sName}`;
        updateUIFromState();
        // 这两个下拉本来就只在气泡那块面板上，能点到它说明已经停在第 0 页了；
        // 保留这句是为了「换气泡类型一定看得到气泡」，顺带把面板也校准回去。
        setPreviewMode(0);
    }
    typeSelect.addEventListener('change', updateTypeLabel);
    sideSelect.addEventListener('change', updateTypeLabel);['setting-hide-avatar', 'setting-time-pos', 'setting-time-format', 'setting-custom-font'].forEach(id => {
        document.getElementById(id).addEventListener('change', (e) => {
            if(id === 'setting-hide-avatar') {
                basicState.hideAvatar = e.target.checked;
                // 藏头像的同时正停在「头像下方」的话，把位置退回「气泡上方」——
                // 理由见 syncConditionalRows 里那段注释（头像列宽度会随时间文字变化）
                if (basicState.hideAvatar && basicState.timePos === 'avatar') {
                    basicState.timePos = 'above';
                    document.getElementById('setting-time-pos').value = 'above';
                }
            }
            if(id === 'setting-time-pos') basicState.timePos = e.target.value;
            if(id === 'setting-time-format') basicState.timeFormat = e.target.value.trim() || defaultBasicState.timeFormat;
            if(id === 'setting-custom-font') basicState.customFont = e.target.value;
            syncConditionalRows();
            generateCssFromState();
        });
    });

    // 时间格式用 input 而不是 change：边打字边在预览里看效果，不用先失焦
    const timeFormatInput = document.getElementById('setting-time-format');
    if (timeFormatInput) {
        timeFormatInput.addEventListener('input', (e) => {
            basicState.timeFormat = e.target.value.trim() || defaultBasicState.timeFormat;
            generateCssFromState();
        });
    }

    // 头像弧度滑块。到顶显示「正圆」而不是「19px」—— 用户要的是那个语义，
    // 而且头像尺寸一改，19 这个数字就不成立了
    const avatarRadiusInput = document.getElementById('setting-avatar-radius');
    if (avatarRadiusInput) {
        avatarRadiusInput.addEventListener('input', (e) => {
            const v = parseInt(e.target.value, 10) || 0;
            basicState.avatarRadius = v;
            const disp = document.getElementById('val-avatar-radius');
            if (disp) disp.textContent = v >= 19 ? '正圆' : `${v}px`;
            generateCssFromState();
        });
    }

    const inputsMap = {
        'setting-bg':['bg', 'color'], 'setting-bg-text': ['bg', 'text'],
        'setting-fontsize':['fontSize', 'number'],
        'setting-fontcolor':['fontColor', 'color'], 
        'setting-fontcolor-text':['fontColor', 'text'],
        'setting-opacity':['opacity', 'number'], 'setting-blur':['blur', 'number'],
        'setting-stroke-w':['strokeW', 'number'],
        'setting-stroke-c':['strokeC', 'color'],
        'setting-stroke-c-text': ['strokeC', 'text'],
        'setting-radius':['radius', 'number']
    };

    Object.keys(inputsMap).forEach(id => {
        const el = document.getElementById(id);
        if(!el) return;
        el.addEventListener('input', (e) => {
            const[key, type] = inputsMap[id];
            let val = e.target.value;
            
            if (type === 'number') {
                val = parseFloat(val) || 0;
                const valDisplayId = id.replace('setting-', 'val-');
                const displayEl = document.getElementById(valDisplayId);
                if(displayEl) displayEl.textContent = val;
            }
            
            basicState.styles[currentSelectType][key] = val;
            if (key === 'strokeW' && val > 0 && (!basicState.styles[currentSelectType].strokeSides || basicState.styles[currentSelectType].strokeSides.length === 0)) {
                basicState.styles[currentSelectType].strokeSides =['top', 'right', 'bottom', 'left'];
                document.querySelectorAll('.stroke-side-cb').forEach(cb => cb.checked = true);
            }
            if (id === 'setting-bg') document.getElementById('setting-bg-text').value = val.toUpperCase();
            if (id === 'setting-bg-text' && /^#[0-9A-F]{6}$/i.test(val)) document.getElementById('setting-bg').value = val;

            if (id === 'setting-fontcolor') document.getElementById('setting-fontcolor-text').value = val.toUpperCase();
            if (id === 'setting-fontcolor-text' && /^#[0-9A-F]{6}$/i.test(val)) document.getElementById('setting-fontcolor').value = val;

            if (id === 'setting-stroke-c') document.getElementById('setting-stroke-c-text').value = val.toUpperCase();
            if (id === 'setting-stroke-c-text' && /^#[0-9A-F]{6}$/i.test(val)) document.getElementById('setting-stroke-c').value = val;

            generateCssFromState();
        });
    });
    
    document.querySelectorAll('.stroke-side-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            const sides =[];
            document.querySelectorAll('.stroke-side-cb').forEach(box => {
                if (box.checked) sides.push(box.value);
            });
            basicState.styles[currentSelectType].strokeSides = sides;
            generateCssFromState();
        });
    });

    // ================== 顶栏 / 底栏的控件 ==================
    // 两块面板的控件都只改 basicState 再 generateCssFromState()，
    // 和气泡那块完全一个路子 —— 生成端是唯一出口，别在这里自己拼 CSS。
    const bindHeaderInput = (id, apply) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('change', (e) => {
            if (!basicState.header) basicState.header = { ...defaultBasicState.header };
            apply(e.target);
            generateCssFromState();
        });
    };
    bindHeaderInput('setting-header-name-pos', t => { basicState.header.namePos = t.value; });
    bindHeaderInput('setting-header-hide-status', t => { basicState.header.hideStatus = t.checked; });

    const hideSendCb = document.getElementById('setting-footer-hide-send');
    if (hideSendCb) {
        hideSendCb.addEventListener('change', (e) => {
            if (!basicState.footer) basicState.footer = JSON.parse(JSON.stringify(defaultBasicState.footer));
            basicState.footer.hideSend = e.target.checked;
            // 藏发送键会把「修改对象」里那一项禁掉（可能顺带把当前选中项顶走），
            // 所以得重新同步一遍控件，不然下面的色块还停在刚才那个对象上。
            syncConditionalRows();
            updateUIFromState();
            generateCssFromState();
        });
    }

    const footerTargetSel = document.getElementById('setting-footer-target');
    if (footerTargetSel) {
        footerTargetSel.addEventListener('change', (e) => {
            currentFooterTarget = e.target.value;
            updateUIFromState();   // 换对象只是换一组数值进控件，不产生新 CSS
        });
    }

    // 四个控件 → 当前对象的四个字段。'text' 那两个是色值的手输框。
    const footerInputsMap = {
        'setting-footer-bg':         ['bg', 'color'],
        'setting-footer-bg-text':    ['bg', 'text'],
        'setting-footer-stroke-c':   ['strokeC', 'color'],
        'setting-footer-stroke-c-text': ['strokeC', 'text'],
        'setting-footer-stroke-w':   ['strokeW', 'number'],
        'setting-footer-radius':     ['radius', 'number']
    };
    Object.keys(footerInputsMap).forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', (e) => {
            const [key, kind] = footerInputsMap[id];
            let val = e.target.value;
            if (kind === 'number') {
                val = parseFloat(val) || 0;
                const disp = document.getElementById(id.replace('setting-footer-', 'val-footer-'));
                if (disp) disp.textContent = val;
            }
            if (!basicState.footer) basicState.footer = JSON.parse(JSON.stringify(defaultBasicState.footer));
            if (!basicState.footer[currentFooterTarget]) {
                basicState.footer[currentFooterTarget] = { ...defaultBasicState.footer[currentFooterTarget] };
            }
            basicState.footer[currentFooterTarget][key] = val;

            // 取色器 ↔ 手输框互相回填。手输的只在凑够 6 位合法 HEX 时才回填取色器，
            // 否则打字到一半（#0 / #00…）就会把取色器推成黑色。
            if (id === 'setting-footer-bg') {
                const t = document.getElementById('setting-footer-bg-text');
                if (t) t.value = String(val).toUpperCase();
            }
            if (id === 'setting-footer-bg-text' && /^#[0-9A-F]{6}$/i.test(val)) {
                document.getElementById('setting-footer-bg').value = val;
            }
            if (id === 'setting-footer-stroke-c') {
                const t = document.getElementById('setting-footer-stroke-c-text');
                if (t) t.value = String(val).toUpperCase();
            }
            if (id === 'setting-footer-stroke-c-text' && /^#[0-9A-F]{6}$/i.test(val)) {
                document.getElementById('setting-footer-stroke-c').value = val;
            }
            generateCssFromState();
        });
    });

    const resetBasicBtn = document.getElementById('reset-basic-css-btn');
    if (resetBasicBtn) {
        resetBasicBtn.addEventListener('click',async () => {
             if (!await AppUI.confirm('是否确定重置基础设置，默认气泡样式将恢复原始样式。', "系统提示", "确认", "取消")) return; 
            basicState = JSON.parse(JSON.stringify(defaultBasicState));
            updateUIFromState();
            generateCssFromState(); 
            updatePreview();
            if(window.showToast) showToast('已清除基础配置');
        });
    }

    // 翻预览 = 翻下面的编辑栏目（气泡 / 顶栏 / 底栏），所以走 setPreviewMode 而不是直接赋值。
    //
    // ★ 必须先 cloneNode 去掉旧监听：setupBubblePresets 被调**两次**
    //   （main.js 的 init 一次、chat_list.js 的 setupChatListScreen 一次），
    //   不去重就是一次点击挂两个 +1，三页里点一下跳两页 —— 点 ▶ 看起来像在倒着翻。
    //   别的控件多绑一遍只是把同一个值写两遍（浪费但无害），只有这两颗是累加型的，
    //   所以单独处理它们。文件里的 addBtn/saveBtn/delBtn 用的也是这个套路。
    const rebind = (id, handler) => {
        const old = document.getElementById(id);
        if (!old) return;
        const fresh = old.cloneNode(true);
        old.parentNode.replaceChild(fresh, old);
        fresh.addEventListener('click', handler);
    };
    rebind('preview-prev-btn', () => setPreviewMode(currentPreviewMode - 1));
    rebind('preview-next-btn', () => setPreviewMode(currentPreviewMode + 1));

    if(cssInput) {
        cssInput.addEventListener('input', () => {
            syncBasicUiFromCss(cssInput.value); 
            updatePreview();
        });
    }

    // ================== 生成新预设逻辑 ==================
    if (addBtn) {
        const newAddBtn = addBtn.cloneNode(true); addBtn.parentNode.replaceChild(newAddBtn, addBtn);
        newAddBtn.addEventListener('click', () => {
            const presets = _getBubblePresets();
            let newIndex = 1; let newName = `新建外观(${newIndex})`;
            while (presets.some(p => p.name === newName)) { newIndex++; newName = `新建外观(${newIndex})`; }

            basicState = JSON.parse(JSON.stringify(defaultBasicState)); updateUIFromState();
            currentEditingPresetOriginalName = ""; 
            if(nameInput) nameInput.value = newName;
            
            if(cssInput) { cssInput.value = ""; generateCssFromState(); }
            if(delBtn) delBtn.style.display = 'none';
            if(window.showToast) showToast('已准备新建模板，请配置后保存');
        });
    }

    // ================== 保存预设逻辑 ==================
    if (saveBtn) {
        const newSaveBtn = saveBtn.cloneNode(true); saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
        newSaveBtn.addEventListener('click', async () => {
            const newName = nameInput ? nameInput.value.trim() : "";
            const newCss = cssInput ? cssInput.value.trim() : "";
            if (!newName) return (window.showToast && showToast('请输入预设名称'));

            if (currentEditingPresetOriginalName !== '默认' && newName === '默认') {
                return (window.showToast && showToast('系统默认预设名称不可用，请使用其他名称！'));
            }

            let presets = _getBubblePresets();
            if (currentEditingPresetOriginalName && currentEditingPresetOriginalName !== newName && currentEditingPresetOriginalName !== '默认') {
                const idx = presets.findIndex(x => x.name === currentEditingPresetOriginalName);
                if (idx >= 0) { presets[idx].name = newName; presets[idx].css = newCss; }
            } else {
                const idx = presets.findIndex(x => x.name === newName);
                if (idx >= 0) { presets[idx].css = newCss; } else { presets.push({ name: newName, css: newCss }); }
            }

            _saveBubblePresets(presets);
            currentEditingPresetOriginalName = newName; 
            if(delBtn) delBtn.style.display = newName === '默认' ? 'none' : 'block';

            // 【核心修改点：应用保存到实际聊天室的逻辑】
            const updateChats = (list) => {
                let updated = false;
                list.forEach(c => {
                    // 如果正在保存的是“默认”，那么强制为使用默认预设的聊天室注入这段 CSS，使样式生效
                    if (newName === '默认') {
                        if (!c.bubbleThemeName || c.bubbleThemeName === 'default' || c.bubbleThemeName === '默认') {
                            c.customBubbleCss = newCss; 
                            c.useCustomBubbleCss = !!newCss; 
                            c.bubbleThemeName = 'default';
                            updated = true;
                            if (c.id === window.currentChatId && typeof updateCustomBubbleStyle === 'function') {
                                updateCustomBubbleStyle(c.id, newCss, c.useCustomBubbleCss);
                            }
                        }
                    } else if (c.bubbleThemeName === currentEditingPresetOriginalName || c.bubbleThemeName === newName) {
                        c.bubbleThemeName = newName; c.customBubbleCss = newCss; c.useCustomBubbleCss = !!newCss; updated = true;
                        if (c.id === window.currentChatId && typeof updateCustomBubbleStyle === 'function') updateCustomBubbleStyle(c.id, newCss, c.useCustomBubbleCss);
                    }
                });
                return updated;
            };
            let updatedP = updateChats(db.characters ||[]); let updatedG = updateChats(db.groups ||[]);
            if (updatedP || updatedG) { await saveGlobalKeys(['bubbleCssPresets']); await _persistChatsAfterPresetChange(); }

            showToast('外观保存成功！');
            if (typeof window.populateChatThemeSelects === 'function') window.populateChatThemeSelects();
        });
    }

    // ================== 删除当前预设逻辑 ==================
    if (delBtn) {
        const newDelBtn = delBtn.cloneNode(true); delBtn.parentNode.replaceChild(newDelBtn, delBtn);
        newDelBtn.addEventListener('click', async () => {
            const name = currentEditingPresetOriginalName || (nameInput ? nameInput.value : "");
            if (!name || name === '默认') return; 

            if (await AppUI.confirm(`确定删除预设 "${name}" 吗？\n所有使用此预设的聊天将恢复默认。`, '系统提示', '确定', '取消')) {
                let presets = _getBubblePresets();
                presets = presets.filter(x => x.name !== name); _saveBubblePresets(presets);

                const resetChats = (charList) => {
                    let updated = false;
                    charList.forEach(c => {
                        if (c.bubbleThemeName === name) {
                            c.bubbleThemeName = 'default'; 
                            // 【修复】恢复默认时也需要去读取一下我们的“默认”里面是不是已经配了CSS了
                            const defaultPreset = _getBubblePresets().find(x => x.name === '默认');
                            if (defaultPreset && defaultPreset.css) {
                                c.useCustomBubbleCss = true;
                                c.customBubbleCss = defaultPreset.css;
                            } else {
                                c.useCustomBubbleCss = false; 
                                c.customBubbleCss = '';
                            }
                            updated = true;
                            if (c.id === window.currentChatId && typeof updateCustomBubbleStyle === 'function') {
                                updateCustomBubbleStyle(c.id, c.customBubbleCss, c.useCustomBubbleCss);
                            }
                        }
                    });
                    return updated;
                };
                let updatedP = resetChats(db.characters ||[]); let updatedG = resetChats(db.groups ||[]);
                if (updatedP || updatedG) { await saveGlobalKeys(['bubbleCssPresets']); await _persistChatsAfterPresetChange(); }

                if(window.showToast) showToast('预设删除成功');
                if(addBtn) document.getElementById('global-bubble-add-btn').click();
                if (typeof window.populateChatThemeSelects === 'function') window.populateChatThemeSelects();
            }
        });
    }

    // ================== 管理弹窗 (默认预设机制) ==================
    function openManagePresetsModal() {
        const modal = document.getElementById('bubble-presets-modal'); const list = document.getElementById('bubble-presets-list');
        if (!modal || !list) return; list.innerHTML = '';
        
        const defaultPresetObj = { name: '默认', css: _getBubblePresets().find(p => p.name === '默认')?.css || '', isDefault: true };
        const userPresets = _getBubblePresets().filter(p => p.name !== '默认');
        const presets =[defaultPresetObj, ...userPresets];
        
        presets.forEach((p) => {
            const row = document.createElement('div'); row.className = 'list-item';
            const nameDiv = document.createElement('div'); nameDiv.className = 'list-item-title'; nameDiv.textContent = p.name;               
            const btnWrap = document.createElement('div'); btnWrap.className = 'list-item-btn';                

            const editBtn = document.createElement('button'); editBtn.className = 'btn'; editBtn.textContent = '编辑';
            editBtn.onclick = function() {
                currentEditingPresetOriginalName = p.name;
                if(nameInput) nameInput.value = p.name;
                if(cssInput) { cssInput.value = p.css; syncBasicUiFromCss(p.css); }
                if(delBtn) delBtn.style.display = p.isDefault ? 'none' : 'block';
                
                const typeEl = document.getElementById('setting-bubble-type');
                if(typeEl) typeEl.value = 'normal';
                const sideEl = document.getElementById('setting-bubble-side');
                if(sideEl) sideEl.value = 'sent';

                currentSelectType = 'normal_sent';
                const labelEl = document.getElementById('current-type-label');
                if(labelEl) labelEl.textContent = '普通气泡 - 我方';
                updateUIFromState();

                // 换了预设就回到第一页：下面的面板跟着回到「气泡」，
                // 否则上一次停在底栏、换完预设看到的还是底栏那组控件。
                currentFooterTarget = 'send';
                setPreviewMode(0);
                if(window.showToast) showToast(`已加载预设: ${p.name}`);
                modal.style.display = 'none'; modal.classList.remove('visible');
            };
            btnWrap.appendChild(editBtn);

            if (!p.isDefault) {
                const renameBtn = document.createElement('button'); renameBtn.className = 'btn'; renameBtn.textContent = '重命名';               
                renameBtn.onclick = async function () {
                    const newName = await AppUI.prompt('请输入新名称：', p.name, '重命名预设');
                    if (!newName || newName === p.name) return;
                    if (newName === '默认') return showToast('不能使用系统默认名称');
                    
                    const presetsAll = _getBubblePresets();
                    const realIdx = presetsAll.findIndex(x => x.name === p.name);
                    if (realIdx >= 0) { presetsAll[realIdx].name = newName; _saveBubblePresets(presetsAll); }

                    const updateChats = (charList) => {
                        let updated = false;
                        charList.forEach(c => { if (c.bubbleThemeName === p.name) { c.bubbleThemeName = newName; updated = true; } });
                        return updated;
                    };
                    let updatedP = updateChats(db.characters ||[]); let updatedG = updateChats(db.groups ||[]);
                    if (updatedP || updatedG) { await saveGlobalKeys(['bubbleCssPresets']); await _persistChatsAfterPresetChange(); }

                    openManagePresetsModal(); 
                    if (typeof window.populateChatThemeSelects === 'function') window.populateChatThemeSelects();
                    if (currentEditingPresetOriginalName === p.name) { currentEditingPresetOriginalName = newName; if(nameInput) nameInput.value = newName; }
                };

                const delListBtn = document.createElement('button'); delListBtn.className = 'btn btn-danger'; delListBtn.textContent = '删除';
                delListBtn.onclick = async function () {
                    if (!await AppUI.confirm('确定删除预设 "' + p.name + '" ?\n相关聊天将恢复默认。', "系统提示", "确认", "取消")) return;
                    
                    const presetsAll = _getBubblePresets();
                    const realIdx = presetsAll.findIndex(x => x.name === p.name);
                    if (realIdx >= 0) { presetsAll.splice(realIdx, 1); _saveBubblePresets(presetsAll); }

                    const resetChats = (charList) => {
                        let updated = false;
                        charList.forEach(c => {
                            if (c.bubbleThemeName === p.name) {
                                c.bubbleThemeName = 'default'; 
                                const defaultPreset = _getBubblePresets().find(x => x.name === '默认');
                                if (defaultPreset && defaultPreset.css) {
                                    c.useCustomBubbleCss = true;
                                    c.customBubbleCss = defaultPreset.css;
                                } else {
                                    c.useCustomBubbleCss = false; 
                                    c.customBubbleCss = ''; 
                                }
                                updated = true;
                                if (c.id === window.currentChatId && typeof updateCustomBubbleStyle === 'function') updateCustomBubbleStyle(c.id, c.customBubbleCss, c.useCustomBubbleCss);
                            }
                        });
                        return updated;
                    };
                    let updatedP = resetChats(db.characters ||[]); let updatedG = resetChats(db.groups ||[]);
                    if (updatedP || updatedG) { await saveGlobalKeys(['bubbleCssPresets']); await _persistChatsAfterPresetChange(); }

                    openManagePresetsModal(); 
                    if (typeof window.populateChatThemeSelects === 'function') window.populateChatThemeSelects();
                    if (currentEditingPresetOriginalName === p.name) document.getElementById('global-bubble-add-btn').click(); 
                };
                btnWrap.appendChild(renameBtn); btnWrap.appendChild(delListBtn);
            }
            row.appendChild(nameDiv); row.appendChild(btnWrap); list.appendChild(row);
        });
        modal.style.display = 'flex'; modal.classList.add('visible'); 
    }

    const manageBtn = document.getElementById('global-bubble-manage-btn');
    if(manageBtn) {
        const newManageBtn = manageBtn.cloneNode(true); manageBtn.parentNode.replaceChild(newManageBtn, manageBtn);
        newManageBtn.addEventListener('click', openManagePresetsModal);
    }

    const closeManageBtn = document.getElementById('close-presets-modal');
    if(closeManageBtn) closeManageBtn.addEventListener('click', () => {
        const modal = document.getElementById('bubble-presets-modal'); modal.style.display = 'none'; modal.classList.remove('visible');
    });

    const exportBtn = document.getElementById('global-bubble-export-btn');
    if (exportBtn) {
        const newExportBtn = exportBtn.cloneNode(true); exportBtn.parentNode.replaceChild(newExportBtn, exportBtn);
        newExportBtn.addEventListener('click', () => {
            const presets = _getBubblePresets();
            if (!presets || presets.length === 0) return (window.showToast && showToast('没有可导出的预设'));
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(presets, null, 2));
            const downloadAnchorNode = document.createElement('a'); downloadAnchorNode.setAttribute("href", dataStr);
            const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, ""); downloadAnchorNode.setAttribute("download", `qchat_bubbles_${dateStr}.json`);
            document.body.appendChild(downloadAnchorNode); downloadAnchorNode.click(); downloadAnchorNode.remove();
        });
    }

    const importBtn = document.getElementById('global-bubble-import-btn');
    const importInput = document.getElementById('global-bubble-import-input');
    if (importBtn && importInput) {
        const newImportBtn = importBtn.cloneNode(true); importBtn.parentNode.replaceChild(newImportBtn, importBtn);
        newImportBtn.addEventListener('click', () => { importInput.click(); });
        
        const newImportInput = importInput.cloneNode(true); importInput.parentNode.replaceChild(newImportInput, importInput);
        newImportInput.addEventListener('change', (e) => {
            const file = e.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const importedPresets = JSON.parse(event.target.result);
                    if (!Array.isArray(importedPresets)) throw new Error("JSON格式错误");
                    let currentPresets = _getBubblePresets(); let addedCount = 0;
                    importedPresets.forEach(p => {
                        if (p.name === '默认(白/蓝)') p.name = '默认'; // 自动兼容遗留数据
                        if (p.name && p.css) {
                            const idx = currentPresets.findIndex(x => x.name === p.name);
                            if (idx >= 0) { currentPresets[idx].css = p.css; } else { currentPresets.push(p); }
                            addedCount++;
                        }
                    });
                    _saveBubblePresets(currentPresets);
                    if (typeof window.populateChatThemeSelects === 'function') window.populateChatThemeSelects();
                    if(window.showToast) showToast(`成功导入并合并了 ${addedCount} 个预设`);
                } catch (err) {
                    if(window.showToast) showToast('导入失败：文件格式不符合要求');
                } finally { e.target.value = ''; }
            };
            reader.readAsText(file);
        });
    }

    // ================== 初始加载“默认”样式及回显机制 ==================
    const presets = _getBubblePresets();
    const defaultPreset = presets.find(p => p.name === '默认');
    
    currentEditingPresetOriginalName = '默认';
    if(nameInput) nameInput.value = '默认';
    if(delBtn) delBtn.style.display = 'none'; // 默认预设不可删除
    
    if (defaultPreset && defaultPreset.css) {
        if(cssInput) cssInput.value = defaultPreset.css;
        syncBasicUiFromCss(defaultPreset.css); 
    } else {
        if(cssInput) cssInput.value = '';
        syncBasicUiFromCss(''); 
        generateCssFromState(); 
    }
    
    const initTypeEl = document.getElementById('setting-bubble-type');
    if(initTypeEl) initTypeEl.value = 'normal';
    const initSideEl = document.getElementById('setting-bubble-side');
    if(initSideEl) initSideEl.value = 'sent';

    currentSelectType = 'normal_sent';
    const initLabelEl = document.getElementById('current-type-label');
    if(initLabelEl) initLabelEl.textContent = '普通气泡 - 我方';

    updateUIFromState();

    // 初始态：预览停在第一页，下面的面板也就是「基础 → 气泡」。
    currentAppearanceTab = 'basic';
    currentFooterTarget = 'send';
    setPreviewMode(0);
}

// 确保页面加载完成后执行绑定
window.setupBubblePresets = setupBubblePresets;

// ================================================================
// === 「时间格式」那个问号弹窗的文案 ==============================
// ================================================================
// AppHelp 的约定是「谁的功能谁注册自己的文案」（见 js/core/utils.js 的那段说明），
// 所以放在这里而不是 utils 里攒成大字典。HTML 那边是 showHelp('bubble', 'timeFormat')。
// ★ 正文最终走 AppUI.alert，而它用的是 innerText —— 换行写 \n，不要写 <br>。
if (typeof AppHelp !== 'undefined' && typeof AppHelp.register === 'function') {
    AppHelp.register('bubble', {
        timeFormat: {
            title: '时间格式怎么写',
            content:
                '直接写你想看到的样子，字母会被换成对应的时间，其它字符原样保留。\n'
                + '比如 HH:mm 会显示成 13:05，M月D日 HH:mm 会显示成 9月27日 13:05。\n\n'
                + '【可用的字母】\n'
                + 'YYYY 年份四位(2026)　YY 年份两位(26)\n'
                + 'MM 月份两位(09)　　　M 月份(9)\n'
                + 'DD 日期两位(27)　　　D 日期(27)\n'
                + 'HH 小时两位(13)　　　H 小时(13)\n'
                + 'hh 小时两位(13)　　　h 小时(13)\n'
                + 'mm 分钟两位(05)　　　m 分钟(5)\n'
                + 'ss 秒两位(09)　　　　s 秒(9)\n'
                + 'A 上午/下午　　　　　a AM/PM\n'
                + 'ddd 周日　　　　　　 dddd 星期日\n\n'
                + '【关于 12 小时制】\n'
                + '默认一律是 24 小时制，hh 和 HH 一个意思（13 点就显示 13）。\n'
                + '只有当你写了 A 或 a 的时候，小时才会切成 12 小时制 ——\n'
                + '比如 A hh:mm 显示成「下午 01:05」。\n'
                + '（这点和网上常见的写法不同：那边 hh 单独用就是 12 小时制，\n'
                + '于是 13:05 会变成没头没尾的 01:05，看着像出了 bug。）\n\n'
                + '【想原样显示某个字母】\n'
                + '用方括号括起来，比如 [at] HH:mm 会显示成「at 13:05」；\n'
                + '不括的话 a 会被当成 AM/PM 换掉。\n\n'
                + '留空的话按 HH:mm 算。'
        }
    });
}