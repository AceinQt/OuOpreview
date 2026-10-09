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

// ============ 「高级」Tab 那两个框 ============
// 以前是**一个** textarea，自动生成的区块直接追加在用户手写内容的后面。问题是
// 用户想改自己那几行时，很容易连带把生成区块也改了（标记里写着"请勿在此区块内手写"
// 也挡不住手滑），而删掉它又等于没了参考。现在拆成两个：
//   · #global-bubble-custom-css  可编辑，**只装用户手写的那半边**
//   · #bubble-generated-css      只读，装自动生成的区块，默认折叠起来
// ★ 落盘仍然是**一个字段**（preset.css），格式一字不改 —— 用户那半边在前、
//   生成块追加在后。所以老预设、导出的 json、备份全部照旧能用，
//   scopeBubbleCss 和 chat.customBubbleCss 那条链路一无所知。
// ★ 要完整串的地方（存盘 / 预览 / 反解 META）一律走 composeBubbleCss()，
//   别直接读那个 textarea —— 读到的只有一半，预览会突然变回默认样式。
const START_MARKER = "/* --- 自动生成：基础外观开始 (请勿在此区块内手写) --- */";
const END_MARKER = "/* --- 自动生成：基础外观结束 --- */";

function _genBlockRegex() {
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`${esc(START_MARKER)}[\\s\\S]*?${esc(END_MARKER)}\\n?`);
}

// 把一段完整 CSS 拆成「用户手写」和「自动生成区块」两半
function splitBubbleCss(css) {
    const full = css || '';
    const m = full.match(_genBlockRegex());
    if (!m) return { user: full.trim(), gen: '' };
    return { user: full.replace(_genBlockRegex(), '').trim(), gen: m[0].trim() };
}

// 两半拼回完整串。顺序和分隔必须和拆分前一致（用户那半在前、生成块在后），
// 否则同一个预设存一次就变一次样。
// ★ 和拆分前有一处行为差异：生成块以前是**原地**替换的，所以用户如果在它后面
//   又写了几行，那几行会留在生成块之后；现在生成块一律落到末尾。这是故意的
//   （位置统一了才好折叠），而且和标记里那句"请勿在此区块内手写"的约定一致。
function joinBubbleCss(user, gen) {
    const u = (user || '').trim();
    const g = (gen || '').trim();
    if (!g) return u ? u + '\n' : '';
    return (u ? u + '\n\n' : '') + g + '\n';
}

function _userCssEl() { return document.getElementById('global-bubble-custom-css'); }
function _genCssEl() { return document.getElementById('bubble-generated-css'); }

// 当前编辑器里那份完整 CSS（两个框拼起来）
function composeBubbleCss() {
    const u = _userCssEl();
    const g = _genCssEl();
    return joinBubbleCss(u ? u.value : '', g ? g.textContent : '');
}

// 把一段完整 CSS 摊到两个框里。顺手更新折叠区的标题（让用户知道里面有没有东西）。
function spreadBubbleCss(css) {
    const { user, gen } = splitBubbleCss(css);
    const u = _userCssEl();
    const g = _genCssEl();
    if (u) u.value = user;
    if (g) g.textContent = gen;
    const hint = document.getElementById('bubble-generated-css-hint');
    if (hint) {
        const lines = gen ? gen.split('\n').length : 0;
        hint.textContent = gen ? `${lines} 行` : '暂无（没改过基础设置）';
    }
}

// 重画预览。setupBubblePresets 里原本自己闭包了一份，但「切预设」「换预览页」这些
// 入口散在闭包内外，所以提到模块级来，让所有人调同一个。
function refreshBubbleCssPreview() {
    const box = document.getElementById('global-bubble-css-preview');
    if (!box || !_userCssEl()) return;
    // ★ 必须喂**完整**串：只喂用户那半边的话，基础设置调出来的东西预览里全看不见
    updateBubbleCssPreview(box, composeBubbleCss(), false, colorThemes['white_blue']);
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

// 预设名直接当文件名用会踩两个坑：`\ / : * ? " < > |` 这些字符安卓会静默换掉、
// Chrome 还会把 `/` 当成路径分隔符（下载直接失败），而空格在某些文件管理器里
// 长按选中都费劲。统一替成下划线；整个名字全被替掉（比如只打了几个空格）才退回「外观」。
function _presetFileSafeName(name) {
    const safe = String(name || '').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '');
    return safe || '外观';
}

// 「复制」出来的新名字：`同名(1)`，占了就往后数。
// 口径和「新建预设」按钮的 `新建外观(n)` 一致（都从 1 开始找第一个空位），
// 别换成「最大序号 +1」—— 删掉中间一个以后两处的行为就不一样了。
function _nextCopyPresetName(baseName, presets) {
    let n = 1, name = `${baseName}(${n})`;
    while ((presets ||[]).some(p => p.name === name)) { n++; name = `${baseName}(${n})`; }
    return name;
}

// 管理弹窗里每行的操作按钮。原先是「编辑/重命名/删除」三颗**文字**按钮，加上「复制」
// 第四颗之后在窄屏（实测 390px 宽的手机）上会折行、把列表行撑成两层，所以整排换成
// 36×36 的方形图标按钮 —— 样式直接复用 api 设置页那 5 颗的 `.api-icon-btn`
// （api.css 在 main.css 里是全局 import 的，不用再抄一份；它的 `svg{width/height:18px}`
// 也顺带避开了「iOS 上 viewBox 没宽高的 svg 看不见」那个坑）。
//
// 图标一律 `fill="none" stroke="currentColor"` 的线型写法，和项目里别处同族图标一致。
const PRESET_ROW_ICONS = {
    // 铅笔 = 进编辑器调样式
    edit: '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
    // 和 api 设置「复制当前预设」同一个图标，保持两处语义一致
    copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    // 大写 T = 只改名字，和铅笔区分开（两颗都用笔形的话没人分得清）
    rename: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>',
    del: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
};

// title 之外必须再给一个 aria-label：图标按钮没有文字，title 在触屏上也摸不出来。
function mkPresetRowBtn(kind, label, extraClass) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'api-icon-btn' + (extraClass ? ' ' + extraClass : '');
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
        + 'stroke-linecap="round" stroke-linejoin="round">' + PRESET_ROW_ICONS[kind] + '</svg>';
    return b;
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

// 从一段预设 CSS 的 META 注释里取出三个「收纳」开关（第三个是「AI 回复键搬进输入框」）。
// 和 timeFormat 同一个处境：它们生成不出 CSS —— 要动的是「通话按钮在不在顶栏」
// 「工具栏整条在不在」这类结构，而结构上的例外（群聊没有通话）得由别的规则压回去，
// 生成出来的 scoped 选择器是 `#chat-room-screen.chat-active-xx.chat-active-xx …`
// （1 id + 3 class），权重比任何一条手写规则都高，压不住。所以改成在
// #chat-room-screen 上挂 class，真正的藏/放写死在 css/pages/chat/chat_room.css
// 那一段「顶栏/底栏的收纳态」里。
//
// 实际聊天室走 chat_settings.js 的 updateCustomBubbleStyle（所有换预设/进聊天室的
// 唯一汇合点），预览走 buildPreviewShellHtml，两边都调这一个函数 —— 和 timeFormat
// 一样，免得"预览里收起来了、聊天室里没有"。
function getBarCollapseFromCss(css) {
    const off = { call: false, toolbar: false, reply: false };
    if (!css) return off;
    const m = String(css).match(/\/\* META:(.+?) \*\//);
    if (!m) return off;
    try {
        const parsed = JSON.parse(m[1]);
        return {
            call: !!(parsed.header && parsed.header.collapseCall),
            toolbar: !!(parsed.footer && parsed.footer.collapseToolbar),
            reply: !!(parsed.footer && parsed.footer.collapseReply)
        };
    } catch (e) {
        return off;
    }
}

// 把两个收纳 class 同步到一个元素上（真实的 #chat-room-screen，或预览里 clone 的那份）。
// ★ 必须**每个都写**（该关的显式移除）：从"收纳"的预设切到"不收纳"的预设时，
//   只加不减会让上一个预设的 class 永远留在屏幕上。
function applyBarCollapseClasses(el, flags) {
    if (!el) return;
    el.classList.toggle('bar-collapse-call', !!(flags && flags.call));
    el.classList.toggle('bar-collapse-toolbar', !!(flags && flags.toolbar));
    el.classList.toggle('bar-collapse-reply', !!(flags && flags.reply));
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

    // 时间分割线上的文字走的是另一套（formatSmartTime，「昨天 / 星期几 / 月日」那种），
    // **不跟** timeFormat 走 —— 所以这里写死一个样例，别拿 sampleTime 顶替，
    // 否则用户会以为改时间格式能改到分割线。
    const sampleDivider = '昨天 22:30';

    // getRow 里的三个时间槽位必须和 chat_bubble_factory.js 真实那份结构一致
    // （头像列里一个、meta 行里一个、气泡后一个），否则「消息时间」的位置在预览里
    // 拨了没反应 —— 生成的规则正是冲着这三个 class 去的，缺哪个哪个位置就是空的。
    // metaExtra：往 meta 行里额外塞东西（群聊的身份徽章 + 群昵称）。给了它就**不能**再挂
    // `meta-time-only` —— 那个 class 的语义是"这行除了时间空无一物，整行收掉"
    // （chat_room.css 里它就是 display:none），挂上去群昵称会跟着一起消失。
    // 真实的气泡工厂也是这么分的：群聊走 roleBadge+groupNickname，私聊才加 meta-time-only。
    const getRow = (isSent, innerHtml, metaExtra) => `
        <div class="message-wrapper ${isSent ? 'sent' : 'received'}">
            <div class="message-bubble-row" ${isSent ? 'style="flex-direction: row-reverse;"' : ''}>
                <div class="message-avatar-col">
                    <img src="${isSent ? './png/avatar_default_me.jpg' : './png/avatar_default.jpg'}" class="message-avatar avatar">
                    <span class="message-time-avatar">${sampleTime}</span>
                </div>
                <div class="message-content-col" ${isSent ? 'style="align-items: flex-end;"' : ''}>
                    <div class="message-meta-info${metaExtra ? '' : ' meta-time-only'}">${metaExtra || ''}<span class="message-time">${sampleTime}</span></div>
                    ${innerHtml}
                </div>
                <span class="message-time-tail">${sampleTime}</span>
            </div>
        </div>
    `;

    let html = "";

    // 0. 不属于任何气泡的那几类小字。摆在最前面是因为真实聊天里它们也多在一段的开头，
    //    而且这三样全是居中的独立一行，夹在气泡中间会把全家福切得很碎。
    //    结构照抄 chat_bubble_factory.js：
    //      时间分割线  → .message-wrapper.time-divider-wrapper > .chat-time-divider
    //      系统提示    → .message-wrapper.system-notification > .system-notification-bubble
    //      撤回提示    → 同上，但 class 是 .withdrawn-message（和系统提示同一组设置，
    //                    出厂长得一模一样，所以两个都画出来让用户看清改的是哪些）
    html += `
        <div class="message-wrapper time-divider-wrapper">
            <div class="chat-time-divider">${sampleDivider}</div>
        </div>
        <div class="message-wrapper system-notification">
            <div class="system-notification-bubble">这是系统提示（入群、改群名这类）</div>
        </div>
        <div class="message-wrapper system-notification">
            <div class="withdrawn-message">撤回提示也归「系统提示」这一组</div>
        </div>
    `;

    // 1. 普通气泡
    html += getRow(false, `<div class="message-bubble received">这是一条对方发来的普通消息。</div>`);
    html += getRow(true, `<div class="message-bubble sent">这是我方回复的普通消息。</div>`);

    // 1b. 群聊里的那一行：身份徽章 + 群昵称。私聊没有这一行（见 getRow 的 metaExtra 注释），
    //     所以单独画一条，否则选了「群昵称」在预览里根本找不到东西在变。
    html += getRow(false,
        `<div class="message-bubble received">群聊里气泡上方会多一行昵称。</div>`,
        `<span class="role-badge member">群成员</span><span class="group-nickname">群里的某人</span>`);

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
// collapseFlags 同理，是那段 CSS 里的两个收纳开关。
function buildPreviewShellHtml(timeFormat, collapseFlags) {
    const real = document.getElementById('chat-room-screen');
    if (!real) return '';

    const clone = real.cloneNode(true);
    // scopeBubbleCss 生成的选择器是 #chat-room-screen.chat-active-preview.chat-active-preview，
    // 这里必须挂上同名 class，否则预览里什么都不生效。
    clone.classList.add('screen', 'active', `chat-active-${PREVIEW_CHAT_ID}`);
    // ★ clone 来源是**正开着的那个聊天**的屏幕，身上带着它自己的收纳 class。
    //   必须按正在编辑的这段 CSS 重新写一遍，否则预览显示的是"当前聊天收没收纳"，
    //   而不是"这段 CSS 存下去会长什么样" —— 顶栏的通话键、底栏的整条工具栏都会骗人。
    if (typeof applyBarCollapseClasses === 'function') {
        applyBarCollapseClasses(clone, collapseFlags);
    }

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
        /* 「收纳 AI 回复」那一档：真机上那颗按钮只在输入框有焦点时才浮出来，
           而预览是张静态图（iframe 里连 click 都被 preventDefault 吃掉了）——
           不特殊照顾的话，用户一拨开关只看见按钮消失，看不见它搬去了哪。
           取景框里一律按"已聚焦"画。 */
        #chat-room-screen.preview-root.bar-collapse-reply #get-reply-btn {
            opacity: 1 !important;
        }
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
    // 预览的口径始终是"这段 CSS 存下去会长什么样"，和位置/颜色那些保持一致。
    // 两个收纳开关走同一条路（它们也生成不出 CSS，只能从 META 捞）。
    const shellHtml = buildPreviewShellHtml(
        getMessageTimeFormatFromCss(rawUserCss),
        getBarCollapseFromCss(rawUserCss)
    );
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

// ★★ 只许初始化一次。★★
// `setupBubblePresets` 有**两个**调用点（`main.js` 的 init 直接调一次、它上一行的
// `setupChatListScreen` 里又调一次），而下面整个函数体是个**闭包** —— `basicState`、
// `currentSelectType`、`currentFooterTarget`、`currentHeaderTarget` 全是 `let`，
// 调两次就是**两份互不相干的状态，绑在同一批控件上**。后果不是"把同一个值写两遍"：
//
//   · 「管理」「新建」「保存」「删除」这几颗按钮是 cloneNode 去重绑定的，所以**只有
//     第二个闭包**收得到"换预设"这件事；第一个闭包的状态从此冻结在启动时那一份。
//   · 可是滑块/取色器/下拉/开关**没有**去重，两个闭包都在听，而且第一个先触发。
//   · 于是：在 A 预设里勾了「收纳发送按钮」→ 两个闭包都记下 hideSend=true（开关是共听的）；
//     切到没收纳的 B 预设 → 只有第二个闭包把状态换成了 B，第一个还停在 hideSend=true。
//     这时去点「修改对象 → 发送按钮」，第一个闭包的 change 先跑，它的 syncConditionalRows
//     按自己那份陈旧状态把这个 option 重新 disabled、并把下拉顶回「AI 回复按钮」；
//     第二个闭包紧接着读 `e.target.value`，读到的已经是被顶回去的 'reply'。
//     症状就是用户报的「从 A 切到 B 以后，B 的发送按钮点不中、改色没反应」。
//
// 修法是守卫掉第二次调用，不是去把两份状态同步 —— 同一套控件只该有一个状态源。
// 两个调用点都保留（`tests/appearance_bars.test.cjs` 明写了两处都要在，那是故意的：
// 哪条路径先走到都能完成初始化），谁先到谁生效。
// 下面那些 cloneNode 去重因此降级成第二道保险，留着不碍事。
let _bubblePresetsInited = false;

function setupBubblePresets() {
    if (_bubblePresetsInited) return;
    _bubblePresetsInited = true;

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
    //   · header/footer 的 bg+opacity+blur 是「栏本体」的底：两条栏在 chat_room.css 里
    //     恰好是同一组值 —— `#chat-room-header-default` 和 `.chat-input-wrapper` 都写着
    //     `background-color: rgba(243,242,247,0.85)` + `backdrop-filter: blur(8px)`。
    //     ★ 顶栏别照 components.css 的 `.app-header`（rgba(255,255,255,.5) + blur 5）抄，
    //       那条被 chat_room.css 顶掉了，抄错就是「没改过也生成 CSS」。
    //   · header.btnC 是顶栏那几个**图标**本身的颜色，默认 var(--btn-color) = #2F3034
    //     （variables.css）。它和下面三块的 bg 是两码事：btnC 管 svg，bg 管托着 svg 的那块。
    //   · header.back / header.title / header.group 是顶栏的**三块元素**：
    //     返回键 `.back-btn` / 昵称+状态 `.title-container` / 右侧按钮组 `.action-btn-group`。
    //     ★ 以前这三颗按钮共用**一组** strokeC/strokeW/radius，而且画在**每颗按钮**身上
    //       （`.back-btn, .action-btn-group .action-btn`），所以通话和菜单会各得一个框。
    //       用户要的是"底透明、要素成块"，于是改成按块走：按钮组整体一个框，不是两个。
    //       老预设里那三个平铺字段的迁移在 syncBasicUiFromCss 里。
    //     ★ 三块出厂都是**全透明**的，所以默认 opacity 取 0（bg 填什么都看不见，
    //       填 #FFFFFF 只是给取色器一个初值）；radius/strokeW/pad 的默认也都是 0 ——
    //       静态 CSS 里 `.back-btn` / `.title-container` / `.action-btn-group`
    //       三者都没写 border-radius 也没写 border（radius:8 是写在**里面**那颗
    //       `.action-btn` 上的，不是组上）。全 0 = 没改过就一个字节都不生成。
    //     ★ title.widthPct：昵称栏在 chat_room.css 里是 `flex-grow:1`，占满「返回键右边 ~
    //       按钮组左边」的整段空档（也就是 100%），一上底色就是横贯顶栏的一长条。
    //       这个百分比就是"占那段空档的几成"，默认 100（照抄静态 CSS，不改一字节不生成）。
    //       余下的 (100-P)% 由 `.app-header` 的 `justify-content:space-between` 均分到两侧，
    //       所以块看着是在中间、左右各留一道空隙。
    //       ★ 它和 namePos 是**两件事**：namePos 管"文字在块里靠哪边"，widthPct 管"块多宽"。
    //         曾经这里是个布尔 `fit`（贴合文字 = flex-grow:0），用户反馈"一开就变居中、
    //         不开又离左右太近"，没有中间档 —— 所以换成百分比。老预设里的 fit 不迁移
    //         （贴合文字没有对应的百分比），直接丢掉。
    //   · header.divW/divC 和 footer.divW/divC 是两条栏的**分割线**：顶栏画在下沿
    //     （border-bottom），底栏画在上沿（border-top）。默认照抄静态 CSS —— 顶栏
    //     `#chat-room-header-default` 明写着 `border-bottom: none`，所以 divW 默认 0；
    //     底栏 `.chat-input-wrapper` 是 `1px solid rgba(255,255,255,0.3)`，所以 divW 默认 1。
    //     ★ 底栏那条出厂线带着 0.3 的 alpha，而取色器给不出 alpha。所以 divC 默认记作
    //       #FFFFFF，用户一旦动了这两个旋钮，生成的就是**实心**线 —— 不动则一个字节不生成，
    //       维持出厂的半透明。这点在面板「背景与分割线」那个小标题的问号里对用户讲明了
    //       （文案见本文件底部 AppHelp.register 的 footerBg）。
    //   · header.collapseCall / footer.collapseToolbar 是两个「收纳」开关，
    //     **生成不出 CSS**，只负责让 hasChanges 为真把 META 留住；真正干活的是
    //     getBarCollapseFromCss → #chat-room-screen 上的 class（见本文件上方那个函数）。
    //   · footer.send/reply/input 分别是 #send-message-btn / #get-reply-btn / #message-input，
    //     默认值来自 chat_room.css：两颗按钮 var(--primary-color)=#0099FF + radius 5 + border:none，
    //     输入框 #ffffff + radius 5 + border:none。
    //   · footer.btnC 是**工具栏那排图标**的颜色。和顶栏那个要列一长串选择器的
    //     header.btnC 实现完全不同：`chat_room.css` 开头（`#chat-room-screen` 那个块）
    //     早就把它抽成了 CSS 变量 `--bar-icon-color`，面型图标靠它上 `fill`、
    //     线型（`.ic-line`）靠它上 `stroke`，所以这里只要把变量重新声明一遍，
    //     就一次覆盖工具栏 6 颗 + 输入栏那颗 "+"，不用点名 —— 这也是加这项特别便宜的原因。
    //     默认值照抄那边的 #555。
    //     ★ 旁边那个 `--bar-icon-stroke`（线宽）**故意没有做成旋钮**：工具栏 6 颗里
    //       只有语音和钱包是线型，另外 4 颗是面型、粗细画死在路径里调不动。
    //       做成旋钮的结果是「2 颗变粗、6 颗粗细不一致」，越调越难看（用户实测后要求删掉）。
    //       想整体换粗细只能换素材。**别再把它加回来。**
    //     ★ 别把 #get-reply-btn 算进来：那颗是实心蓝底按钮，图标走 `fill: currentColor`，
    //       归下面 reply.color 管。
    //   · footer.send/reply/input 的 color 是**文字/图标色**，默认照抄静态 CSS：
    //     两颗按钮来自 `.message-input-area .icon-btn { color: white }`（发送键是"发送"二字，
    //     AI 回复那颗是 svg 走 currentColor，所以同一个 color 两边都管得到）；
    //     输入框没写过 color、继承 variables.css 的 --text-color: #444，故记作 #444444。
    //     ★ 输入框这一项**连 ::placeholder 一起发**（同色 + opacity 0.55）——
    //       用户把输入框调成深色时，浏览器默认那个灰 placeholder 会当场看不见，
    //       而这正是加这组旋钮要解决的问题，只改 color 等于只修了一半。
    const defaultBasicState = {
        hideAvatar: false, timePos: 'none', timeFormat: 'HH:mm', avatarRadius: 19, customFont: '',
        header: {
            namePos: 'left', hideStatus: false, collapseCall: false,
            bg: '#F3F2F7', opacity: 0.85, blur: 8,
            divW: 0, divC: '#000000',
            btnC: '#2F3034',
            back:  { bg:'#FFFFFF', opacity:0, pad:0, radius:0, strokeW:0, strokeC:'#000000' },
            title: { bg:'#FFFFFF', opacity:0, pad:0, radius:0, strokeW:0, strokeC:'#000000', widthPct:100 },
            group: { bg:'#FFFFFF', opacity:0, pad:0, radius:0, strokeW:0, strokeC:'#000000' }
        },
        footer: {
            hideSend: false, collapseToolbar: false, collapseReply: false,
            bg: '#F3F2F7', opacity: 0.85, blur: 8,
            divW: 1, divC: '#FFFFFF',
            btnC: '#555555',
            send:  { bg:'#0099FF', color:'#FFFFFF', strokeW:0, strokeC:'#000000', radius:5 },
            reply: { bg:'#0099FF', color:'#FFFFFF', strokeW:0, strokeC:'#000000', radius:5 },
            input: { bg:'#FFFFFF', color:'#444444', strokeW:0, strokeC:'#000000', radius:5 }
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
            quote_received:    { bg:'#000000', fontSize:13, fontColor:'#555555', opacity:0.04, blur:0, strokeW:3, strokeC:'#0099FF', radius:8, strokeSides:['left'] },

            // ===== 下面四类**不是气泡**，是聊天里那些零散的小字 =====
            // 它们在 chat_room.css 里各自写死一个灰，换成深色背景后就全看不见了
            // （用户原话：「换了深色背景就看不清」）。以前外观系统完全没管到这几类。
            // ★ 这四类**没有我方/对方之分**（见 NEUTRAL_TYPES），所以键名不带 _sent/_received
            //   后缀，选中它们时「我方/对方」那个下拉会禁掉。
            // ★ 默认值一律照抄静态 CSS，否则"什么都没改"也会生成 CSS。其中三类
            //   **从来没写过 background**，所以底色默认记作不透明度 0（取色器要个初值，
            //   填 #FFFFFF 只是占位）—— 要是给个看得见的默认值，一打开面板就凭空多出一块底。
            //   radius 同理：没写过 border-radius 的就是 0，别图好看填个 4。
            msgtime:   { bg:'#FFFFFF', fontSize:10, fontColor:'#AAAAAA', opacity:0,   blur:0, strokeW:0, strokeC:'#000000', radius:0,  strokeSides:[] },
            timediv:   { bg:'#FFFFFF', fontSize:12, fontColor:'#999999', opacity:0,   blur:0, strokeW:0, strokeC:'#000000', radius:6,  strokeSides:[] },
            systip:    { bg:'#C8C8C8', fontSize:12, fontColor:'#666666', opacity:0.5, blur:0, strokeW:0, strokeC:'#000000', radius:12, strokeSides:[] },
            groupname: { bg:'#FFFFFF', fontSize:13, fontColor:'#888888', opacity:0,   blur:0, strokeW:0, strokeC:'#000000', radius:0,  strokeSides:[] }
        }
    };

    let basicState = JSON.parse(JSON.stringify(defaultBasicState));
    let currentSelectType = 'normal_sent';
    // 底栏那块面板上「修改对象」下拉选的是谁。三个对象共用同一组控件（和气泡那块同一套路）。
    let currentFooterTarget = 'send';
    // 顶栏同理：返回键 / 昵称栏 / 右侧按钮组。
    let currentHeaderTarget = 'back';

    // 底栏三个对象 → 真实 DOM 选择器。改 index.html 的底栏时这里要跟着动。
    const FOOTER_SELECTORS = {
        send:  '#send-message-btn',
        reply: '#get-reply-btn',
        input: '#message-input'
    };

    // 「栏本体」的底色 —— 改背景/透明度/模糊时要刷的选择器。
    // ★ 两条栏各自都有一个**多选态的替身**，必须一起改：
    //   顶栏进多选会换成 #chat-room-header-select（取消/选择消息/显示隐藏），
    //   底栏进多选会被 #multi-select-bar 盖住（删除已选/转发）。
    //   只改常态那条的话，用户把栏调成深色后一进多选就闪回浅灰，看着像 bug。
    //   （昵称位置、按钮样式那些**不能**这么干：多选态顶栏里是两颗文字按钮，
    //     把 40px 宽度和弧度套上去会把"显示隐藏"四个字挤出来 —— 见 chat_room.css 那条注释。）
    const HEADER_BAR_SELECTOR = '#chat-room-header-default, #chat-room-header-select';
    const FOOTER_BAR_SELECTOR = '.chat-input-wrapper, #multi-select-bar';

    // 顶栏那几个图标：返回 / 通话 / 菜单。这条只管**图标本身**的颜色（btnC）。
    // 图标里 fill 走 currentColor（跟着 color），stroke 却被 chat_room.css 硬写成
    // var(--btn-color) —— 只改 color 的话描线不跟着变，半边新半边旧，所以两条都得发。
    const HEADER_BTN_SELECTOR =
        '#chat-room-header-default .back-btn, #chat-room-header-default .action-btn-group .action-btn';

    // 顶栏三块元素 → 真实 DOM 选择器。改 index.html 的顶栏时这里要跟着动。
    // ★ 一律钉在 #chat-room-header-default 上，不碰多选态那个 #chat-room-header-select：
    //   那边是两颗**文字**按钮（取消 / 显示隐藏），把块样式套上去会把字挤出来。
    const HEADER_BLOCK_SELECTORS = {
        back:  '#chat-room-header-default .back-btn',
        title: '#chat-room-header-default .title-container',
        group: '#chat-room-header-default .action-btn-group'
    };

    // 三块元素在静态 CSS 里都带着「为裸图标准备」的几何：
    //   .back-btn           40×40 固定 + margin-left:-8px（把图标顶到屏幕最左边）
    //   .action-btn-group   width:54px 固定（正好等于 24+6+24，一点余量都没有）
    // 这些值一旦被当成**色块**看就全是毛病：负外边距让左边那块比右边多探出 8px，
    // 固定宽高遇上 padding 会反过来把里面的 svg 压小（reset.css 给 * 置了 border-box）。
    // 所以一旦这块真的长出了底色/描边/内边距（见下面的 boxed），就把这些几何归零，
    // 让块自己按内容撑开。★ 只在 boxed 时发：光改个弧度（透明底下根本看不见）
    // 就把按钮挪 8px，用户会以为自己碰坏了什么。
    const HEADER_BLOCK_NORMALIZE = {
        back:  ' width: auto !important; height: auto !important; margin-left: 0 !important;',
        group: ' width: auto !important;',
        title: ''
    };
    
    // 把 .voice-bubble 并入 normal，让它们共享同一套样式！
    const classSelectorsMap = {
        'normal': '.message-bubble, .voice-bubble',
        'narration': '.narration-bubble',
        'transfer': '.transfer-card',
        'quote': '.quoted-message',

        // 下面四类不是气泡，是聊天里那些零散小字（默认全是写死的灰，深色背景下看不见）。
        // ★ msgtime 的三个 class 是**同一个时间**的三个槽位（气泡上方 / 头像下方 / 气泡后），
        //   每条消息三个都画出来、由 timePos 放开其中一个，所以三个必须一起染色 ——
        //   只染一个的话，用户换个时间位置颜色就白调了。
        // ★ systip 把「系统提示」和「撤回提示」并成一组：这两个 class 在 chat_room.css 里
        //   的 color / background / font-size / radius / padding 逐字节相同，出厂就是一个样子，
        //   分成两项只是让用户多调一遍。
        //   ⚠ chat_room.css 末尾（折叠通话那段）给这两个 class 和 .chat-time-divider
        //   在 `.expanded-call-session-container` 里另染了一遍灰蓝 #7A869A，用来和通话外的
        //   消息做区分。这里生成的规则带 !important 又被 scope 抬到 1 id + 2 class，
        //   会把那份区分盖掉 —— **这是故意的**：用户把整体调成深色时，通话里那几行
        //   要是还钉在浅色主题的灰蓝上，才是真的看不清。别为了"保住区分"去加排除。
        'msgtime': '.message-time, .message-time-avatar, .message-time-tail',
        'timediv': '.chat-time-divider',
        'systip': '.system-notification-bubble, .withdrawn-message',
        'groupname': '.group-nickname'
    };

    // 这几类没有「我方 / 对方」之分，选中时把那个下拉禁掉，键名也不带 _sent/_received 后缀。
    // （时间分割线和系统提示本来就是居中的独立一行；时间戳和群昵称两侧共用一条静态规则，
    //   拆成两套只是让用户多调一遍。）
    const NEUTRAL_TYPES = new Set(['msgtime', 'timediv', 'systip', 'groupname']);

    // msgtime 和 groupname 出厂是**裸文字** —— 既没有 background 也没有 padding，
    // 一上底色就紧贴着字，难看。照 HEADER_BLOCK_NORMALIZE 的路子：只在"真长出块"
    // （底色能看见、或者描了边）时才补一点内边距，光改个字色不会动几何。
    // 另两类（timediv / systip）静态 CSS 里本来就有 padding，不用管。
    const BARE_TEXT_PAD = { msgtime: '2px 6px', groupname: '1px 6px' };

    // START_MARKER / END_MARKER 已提到模块级（和 splitBubbleCss / joinBubbleCss 放一起），
    // 因为拆两个框之后「哪段是生成的」这件事在闭包外面也要用。

    function hexToRgba(hex, alpha) {
        if (!hex) return 'transparent';
        if (hex.startsWith('rgb')) return hex;
        let r = 0, g = 0, b = 0;
        if (hex.length === 7) { r = parseInt(hex.substring(1,3), 16); g = parseInt(hex.substring(3,5), 16); b = parseInt(hex.substring(5,7), 16); }
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function generateCssFromState() {
        // ★ META 那条注释**放在块尾**（见下面 END_MARKER 那行），不放块首 ——
        //   它是面板状态的序列化，有一两千字符长，而这个块现在是摊在「自动生成的样式」
        //   那个只读框里给用户当参考用的（照着里面的选择器抄，是查"某个东西叫什么 class"
        //   最快的办法）。META 摆第一行会把真正有用的规则整个顶出可视区。
        //   三个读 META 的地方（getMessageTimeFormatFromCss / getBarCollapseFromCss /
        //   syncBasicUiFromCss）都是 `match(/\/\* META:(.+?) \*\//)`，**与位置无关**，
        //   所以搬家是安全的；但 START_MARKER 必须仍是块的第一行，splitBubbleCss 靠它定界。
        let basicCss = `${START_MARKER}\n`;
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
        if (hdr.collapseCall !== hdrDef.collapseCall) {
            // 这一项**生成不出 CSS**。真正干活的是 #chat-room-screen 上的
            // bar-collapse-call（getBarCollapseFromCss → applyBarCollapseClasses，
            // 藏/放的规则在 chat_room.css）。这里只负责让 hasChanges 为真，
            // 把存着这个开关的 META 注释留住 —— 不然下面「没改动就整块删掉」的逻辑
            // 会连 META 一起端走，用户拨的开关存不下来。和 timeFormat 同一个处境。
            hasChanges = true;
        }

        // 栏本体的底：底色和不透明度合成一条 rgba，模糊单独一条。
        // 顶栏底栏逻辑一模一样，抽成一个闭包，省得两边各写一遍再漂。
        const barSurfaceCss = (conf, def, sel) => {
            let out = '';
            if ((conf.bg || '').toUpperCase() !== def.bg.toUpperCase() || conf.opacity !== def.opacity) {
                out += `${sel} { background-color: ${hexToRgba(conf.bg, conf.opacity)} !important; }\n`;
                hasChanges = true;
            }
            if (conf.blur !== def.blur) {
                // 0 发 none，不发 blur(0px)：后者一样会让浏览器去抠一张背景快照，
                // 还会给 position:fixed 的后代造出一个新的包含块 —— 白花钱又改语义。
                const v = conf.blur > 0 ? `blur(${conf.blur}px)` : 'none';
                out += `${sel} { backdrop-filter: ${v} !important; -webkit-backdrop-filter: ${v} !important; }\n`;
                hasChanges = true;
            }
            return out;
        };
        basicCss += barSurfaceCss(hdr, hdrDef, HEADER_BAR_SELECTOR);

        // 两条栏的分割线。顶栏画下沿、底栏画上沿，别的完全一样，所以也抽一个闭包。
        // 0 发 none（而不是 0px solid）：语义更直白，也省得和别处的 border 简写打架。
        const barDividerCss = (conf, def, sel, side) => {
            if (conf.divW === def.divW
                && (conf.divC || '').toUpperCase() === def.divC.toUpperCase()) return '';
            hasChanges = true;
            return (conf.divW > 0)
                ? `${sel} { border-${side}: ${conf.divW}px solid ${conf.divC} !important; }\n`
                : `${sel} { border-${side}: none !important; }\n`;
        };
        basicCss += barDividerCss(hdr, hdrDef, HEADER_BAR_SELECTOR, 'bottom');

        // 顶栏那几个图标的颜色。这一条只管 svg，不管托着它的块（块在下面那段）。
        if ((hdr.btnC || '').toUpperCase() !== hdrDef.btnC.toUpperCase()) {
            basicCss += `${HEADER_BTN_SELECTOR} { color: ${hdr.btnC} !important; }\n`;
            // ★ 第二条不能省：返回键的 svg 是 stroke="currentColor"（跟着 color 走），
            //   但通话/菜单那两颗的描线被 chat_room.css 的
            //   `#chat-room-header-default .action-btn-group .action-btn svg { stroke: var(--btn-color) }`
            //   硬写死了，只发 color 的话是"图标填充变了、描线还是老颜色"的半吊子。
            basicCss += `#chat-room-header-default .action-btn-group .action-btn svg { stroke: ${hdr.btnC} !important; }\n`;
            hasChanges = true;
        }

        // 顶栏三块元素（返回键 / 昵称栏 / 右侧按钮组）各自一套底色+描边+弧度+内边距。
        // 和底栏那三个对象同一个路子，区别是这边多一层「块化归零」（HEADER_BLOCK_NORMALIZE）。
        for (const key of Object.keys(HEADER_BLOCK_SELECTORS)) {
            const conf = hdr[key] || hdrDef[key];
            const def = hdrDef[key];
            const sel = HEADER_BLOCK_SELECTORS[key];

            let blockCss = '';
            if ((conf.bg || '').toUpperCase() !== def.bg.toUpperCase() || conf.opacity !== def.opacity) {
                // 出厂 opacity 是 0，所以这条在用户拉起不透明度之前发出来也是全透明的，
                // 和"没改"看着一样 —— 面板的 hint 里把这事讲明了（不透明度就是总开关）。
                blockCss += ` background-color: ${hexToRgba(conf.bg, conf.opacity)} !important;`;
            }
            if (conf.radius !== def.radius) {
                blockCss += ` border-radius: ${conf.radius}px !important;`;
            }
            if (conf.strokeW !== def.strokeW || (conf.strokeC || '').toUpperCase() !== def.strokeC.toUpperCase()) {
                blockCss += (conf.strokeW > 0)
                    ? ` border: ${conf.strokeW}px solid ${conf.strokeC} !important;`
                    : ` border: none !important;`;
            }
            if (conf.pad !== def.pad) {
                blockCss += ` padding: ${conf.pad}px !important;`;
            }
            // 昵称栏专属：块占「返回键右边 ~ 按钮组左边」那段空档的几成。
            // ★ flex-basis 必须压成 0：留着 auto 的话基准是文字自身宽度、grow 分的是
            //   "文字之外剩下的"，百分比就不成百分比了（短昵称和长昵称算出的块宽不一样）。
            // ★ 居中档不发这条：那一档走的是 absolute（见上面 namePos 那段），
            //   flex-grow 对 absolute 的元素没有意义，发出来是条死规则。面板上那一行
            //   也会在居中档收起来（syncConditionalRows）。
            if (key === 'title' && hdr.namePos !== 'center' && conf.widthPct !== def.widthPct) {
                blockCss += ` flex-basis: 0 !important; flex-grow: ${conf.widthPct / 100} !important;`;
            }
            if (!blockCss) continue;

            // 真的长出块了才归零那套"为裸图标准备"的几何，理由见 HEADER_BLOCK_NORMALIZE。
            const boxed = conf.opacity > def.opacity || conf.strokeW > 0 || conf.pad > 0;
            const norm = boxed ? (HEADER_BLOCK_NORMALIZE[key] || '') : '';
            basicCss += `${sel} {${norm}${blockCss} }\n`;

            // 按钮组成块之后，把里面那颗按钮摆成正方形。
            // ★ 它在 chat_room.css 里是 24×30 的**长方形**，所以「收纳通话」只剩一颗按钮时，
            //   组的盒子是 (24+2p)×(30+2p)，弧度拉满也只能是个胶囊，拼不出正圆 ——
            //   用户就是撞上了这个。取两边的大值 30 摆成 30×30：收纳后组是正方形（弧度到顶
            //   即正圆），两颗都在时是规整的胶囊。取大值而不是取小值，是为了让热区变大不变小。
            if (key === 'group' && boxed) {
                basicCss += `#chat-room-header-default .action-btn-group .action-btn`
                    + ` { width: 30px !important; height: 30px !important; }\n`;
            }
            hasChanges = true;
        }

        // ============ 底栏 ============
        const ftr = basicState.footer || defaultBasicState.footer;
        const ftrDef = defaultBasicState.footer;
        basicCss += barSurfaceCss(ftr, ftrDef, FOOTER_BAR_SELECTOR);
        basicCss += barDividerCss(ftr, ftrDef, FOOTER_BAR_SELECTOR, 'top');
        if (ftr.collapseToolbar !== ftrDef.collapseToolbar) {
            // 同 collapseCall：生成不出 CSS，只把 META 留住，干活的是 bar-collapse-toolbar。
            hasChanges = true;
        }
        if (ftr.collapseReply !== ftrDef.collapseReply) {
            // 同上，干活的是 bar-collapse-reply（把 #get-reply-btn 搬进输入框内部右侧，
            // 只在输入框有焦点时露出来）。几何写死在 chat_room.css 的收纳段。
            hasChanges = true;
        }
        if (ftr.hideSend !== ftrDef.hideSend) {
            // 藏了照样能发：回车走的是 chat_room.js 里 #message-input 的 keydown 分支，
            // 和这颗按钮的 click/touchend 是三条各自独立的通道。
            if (ftr.hideSend) basicCss += `#send-message-btn { display: none !important; }\n`;
            hasChanges = true;
        }
        // 工具栏那排图标的颜色。只要重声明 chat_room.css 开头那个 `--bar-icon-color`，
        // 6 颗工具栏按钮 + 输入栏那颗 "+" 一次全覆盖，不用逐个点名（顶栏的 btnC 做不到
        // 这点，所以那边是一长串选择器）。
        // ★ **不要**顺手把 `--bar-icon-stroke`（线宽）也做成旋钮：6 颗里只有语音和钱包
        //   是线型，另外 4 颗面型的粗细画死在路径里 —— 调了就是 2 颗变粗、整排粗细不一致。
        //   曾经做过，用户实测后要求删掉。
        // ★ 选择器写 `#chat-room-screen`，scopeBubbleCss 会把它**整体替换**成
        //   `#chat-room-screen.chat-active-xx.chat-active-xx`（不是加前缀，见 bubble_css_scope.js
        //   的 scopeSelector），所以变量正好落在声明它的那个元素上、后代全能读到。
        if ((ftr.btnC || '').toUpperCase() !== ftrDef.btnC.toUpperCase()) {
            basicCss += `#chat-room-screen { --bar-icon-color: ${ftr.btnC} !important; }\n`;
            hasChanges = true;
        }
        for (const key of Object.keys(FOOTER_SELECTORS)) {
            const conf = ftr[key] || ftrDef[key];
            const def = ftrDef[key];
            const sel = FOOTER_SELECTORS[key];

            // 底色单独一条。★ 这里曾经挂 `:not(:disabled)`，为的是给 chat_room.css 那条
            // `.message-input-area .icon-btn:disabled { background-color:#cccccc }` 让路
            // ——「正在生成」时按钮变灰是唯一的进度反馈，当时不躲开就等于把它抹掉。
            // 现在 disabled 改成了**整颗变淡**（那边是 `filter: opacity(.45)`，压根不碰底色），
            // 所以这里必须**不挂**：继续躲着的话，生成那几秒按钮会掉回
            // var(--primary-color) 的默认蓝，用户自定义的颜色当场失效几秒再跳回来 ——
            // 而「禁用时固定是灰的、跟自定义样式不搭」正是用户要求改掉的。
            if ((conf.bg || '').toUpperCase() !== def.bg.toUpperCase()) {
                // .message-input-area .icon-btn 用的是 background 简写，这里只改 background-color；
                // 简写剩下的部分（没有渐变/图片）不受影响。
                basicCss += `${sel} { background-color: ${conf.bg} !important; }\n`;
                hasChanges = true;
            }

            // 文字/图标色。三个对象各有各的落点：
            //   send  → "发送"二字
            //   reply → 那颗 svg（chat_room.css 给它 `fill: currentColor`，所以改 color 就够）
            //   input → 用户打进去的字
            // 同样不挂 :not(:disabled) —— 变淡是整颗一起淡（filter），没人需要让路。
            if ((conf.color || '').toUpperCase() !== (def.color || '').toUpperCase()) {
                basicCss += `${sel} { color: ${conf.color} !important; }\n`;
                // 输入框额外补 placeholder：浏览器给的默认灰在深色输入框上直接看不见，
                // 而「深色底看不清」正是这组旋钮要解决的问题。opacity 压到 0.55 是为了
                // 跟用户真打进去的字拉开层次，不然提示文字和正文一个样。
                if (key === 'input') {
                    basicCss += `${sel}::placeholder { color: ${conf.color} !important; opacity: 0.55 !important; }\n`;
                }
                hasChanges = true;
            }

            // 弧度和描边反过来，连 disabled 态一起改 —— 变淡只该整颗压低不透明度，
            // 不该把形状也变回去。
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
            // 中立那四类的键名本来就不带后缀，split('_')[0] 原样返回，所以这里不用特判
            const isNeutral = NEUTRAL_TYPES.has(typeKey);
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

            // 我方 / 对方那半边的 class。★ 中立那四类切出来是 undefined ——
            // 所以凡是用到它的地方都必须先排除 isNeutral（和 isNarration），
            // 否则会生成 `.message-wrapper.undefined …` 这种永不命中的选择器，
            // 症状是面板上调得动、预览和聊天里都没反应。
            // 下面三处用它：主规则的 ruleSel、伪元素智能染色、描边补偿。
            const sideClass = typeKey.split('_')[1] === 'recv' ? 'received' : typeKey.split('_')[1];

            let ruleSel = '';
            if (isNeutral) {
                // 没有我方/对方之分，直接用 class 本身。
                // ★ 不能走下面那条分支：那里要拼 sideClass，中立键是 undefined（见上）。
                ruleSel = sel;
            } else if (isNarration) {
                ruleSel = `${nwSelf} ${sel}`;
            } else {
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
                
                // 伪元素智能染色：用户自己手写的尖角 / 小三角（::before / ::after）
                // 跟着气泡底色一起染，不然调完底色尖角还是旧的。
                // ★ 这里读的是**用户那半边**（拆两个框之后 cssInput 里只剩手写内容）——
                //   正好是想要的：以前连自动生成的区块一起扫，纯属浪费（生成块里
                //   从来不写伪元素），还得指望正则别误伤自己刚生成的东西。
                if (baseType === 'normal' && cssInput && cssInput.value) {
                    const customCss = cssInput.value;
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

                // 描边补偿：reset.css 给 * 置了 border-box，所以描边是**从正文可用宽里扣的**
                // —— 实测 375px 宽的屏上 1px 描边就让每行少一个字（14 → 13），右边空出一截
                // （用户原话「每行就少了一个字，导致右边很空」）。把水平方向实际占掉的
                // 像素数写进 --bub-stroke-x，chat_room.css 里 .message-content-col 的 70%
                // 和 .message-bubble 的 260px 两处 max-width 都加它，于是不管哪条在夹人，
                // 正文宽都和「没描边」时逐像素相同。
                // ★ 只有普通气泡那一族吃这碗饭：旁白是全宽卡片（压根不在 .message-content-col
                //   里，自己 max-width:none），引用画在气泡**内部**，转账/图片各有更小的上限
                //   —— 给它们补也补不到正文宽上去。
                // ★ 变量设在**内容列**（气泡的祖先，靠继承传给气泡），并用 :has() 限定
                //   「这条消息的气泡正是这一类」。一条消息只有一颗气泡，所以不会串到
                //   别的类型/另一侧去；没描边的消息列宽一个像素都不动。
                //   :has() 里那些逗号是安全的 —— scopeBubbleCss 的 splitSelectorList
                //   只按**顶层**逗号切选择器组（bubble_css_scope.js 里有 depth 计数）。
                //   ⚠️ .forum-share-card 也得算进来：它自己没有描边设置，是**刻意跟普通气泡
                //      等宽**的（chat_room.css 那段注释写了，share_card.test.cjs 也在守
                //      「两边 max-width 逐字节一致」）。漏了它，用户给气泡加描边之后
                //      卡片就比上下的气泡窄 2×描边宽、右边缘对不齐。
                // ★ 按勾选方向逐边算，不是一律 2×：只描左边就只补一边，补多了气泡会凭空变宽。
                if (baseType === 'normal') {
                    const edge = (side) => (sides.length === 4 || sides.includes(side)) ? conf.strokeW : 0;
                    const padX = (conf.strokeW > 0 && sides.length > 0) ? edge('left') + edge('right') : 0;
                    basicCss += `.message-wrapper.${sideClass} .message-content-col`
                        + `:has(.message-bubble, .voice-bubble, .forum-share-card)`
                        + ` { --bub-stroke-x: ${padX}px; }\n`;
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

            // 裸文字那两类（消息时间 / 群昵称）一旦真长出了块，补一点内边距，
            // 否则底色紧贴着字，边角弧度也拉不出形状。判据和 HEADER_BLOCK_NORMALIZE 一样：
            // 只在"看得见的块"出现时才发，光改字色不动几何（不然用户只是想把灰字调亮一点，
            // 时间戳的位置却整体挪了，会以为自己碰坏了什么）。
            // ★ 这里**绝对不能**顺手发 display —— timePos 的反解正则（见 syncBasicUiFromCss）
            //   是靠「`.message-time` 后面的花括号里有没有 display」来读回时间位置的，
            //   发了就会把「不显示」误读成「气泡上方」，一存一读位置自己就跳了。
            if (BARE_TEXT_PAD[typeKey]) {
                const boxed = conf.opacity > 0 || conf.strokeW > 0;
                if (boxed) {
                    basicCss += `${ruleSel} { padding: ${BARE_TEXT_PAD[typeKey]} !important; }\n`;
                    hasChanges = true;
                }
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

            // 气泡里那些图标跟着字体颜色走（语音的播放三角、转账卡的图标、折叠通话的
            // 话筒/摄像头、图片气泡的放大和识图按钮…）。
            // ★ 以前这里锁死 `baseType === 'normal'`，所以调了转账气泡的字体颜色，
            //   卡片上的图标还是旧色，半边新半边旧。现在所有类型都发。
            // ★ `fill` 必须挂 `:not([fill="none"])`：这个项目里的线型图标是
            //   `fill="none" stroke="currentColor"` 的写法，而 CSS 的优先级高过
            //   presentation attribute —— 无条件发 fill 会把空心图标**灌成一个实心色块**
            //   （原先只对普通气泡生效，所以一直没被发现）。
            //   线型图标靠下面那条 color 走 currentColor 就够了。
            // ★ 反过来**绝不能**无条件发 stroke：路径没写 stroke 时默认是 none，
            //   硬发会给实心图标（语音那个播放三角）描上一圈外框。
            // ★ 中立那四类跳过：它们是纯文字（时间 / 分割线 / 系统提示 / 群昵称），
            //   里面不可能有图标，发了就是给生成块添三行永不命中的死规则。
            if (!isNeutral && conf.fontColor.toUpperCase() !== defaultConf.fontColor.toUpperCase()) {
                const parts = ruleSel.split(',').map(s => s.trim());
                const svgSel = parts.map(s => `${s} svg`).join(', ');
                basicCss += `${svgSel} { color: ${conf.fontColor} !important; }\n`;
                const fillSel = parts.map(s => `${s} svg:not([fill="none"])`).join(', ');
                basicCss += `${fillSel} { fill: ${conf.fontColor} !important; }\n`;
            }
        }

        basicCss += `/* META:${JSON.stringify(basicState)} */\n${END_MARKER}`;

        // 生成块直接写进那个只读框，不再去用户的 textarea 里做正则手术 ——
        // 两个框一分，「哪段是生成的」就不用从文本里猜了，原先那套
        // 「有标记就原地替换、没标记就追加」的分支整段消失。
        // hasChanges 为假时清空它（出厂设置就不该留痕迹，这样
        // joinBubbleCss 拼出来的也一个字节都没有）。
        const genEl = _genCssEl();
        if (genEl) {
            genEl.textContent = hasChanges ? basicCss : '';
            const hint = document.getElementById('bubble-generated-css-hint');
            if (hint) {
                hint.textContent = hasChanges
                    ? `${basicCss.split('\n').length} 行`
                    : '暂无（没改过基础设置）';
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

        // 时间设成「不显示」时，「消息时间」那一组同样调了看不见 —— 照上面发送按钮
        // 那条的路子把选项禁掉，正停在它上面就顶回普通气泡。
        // ★ 不这么做的话症状很隐蔽：面板上色块、滑块全能拨，CSS 也确实生成了，
        //   但预览和聊天里都是空的（三个槽位全 display:none），像是功能坏了。
        const typeSel = document.getElementById('setting-bubble-type');
        if (typeSel) {
            const noTime = basicState.timePos === 'none';
            const timeOpt = typeSel.querySelector('option[value="msgtime"]');
            if (timeOpt) timeOpt.disabled = noTime;
            if (noTime && currentSelectType === 'msgtime') {
                currentSelectType = 'normal_sent';
                typeSel.value = 'normal';
                const sideSel = document.getElementById('setting-bubble-side');
                if (sideSel) { sideSel.disabled = false; sideSel.value = 'sent'; }
                const lbl = document.getElementById('current-type-label');
                if (lbl) lbl.textContent = '普通气泡 - 我方';
            }
        }

        // 「宽度占比」只对昵称栏有意义（返回键和按钮组本来就是按内容宽的）——
        // 停在别的对象上就整行收掉。
        // ★ 居中档也要收起来：那一档走的是 absolute（块贴着文字居中），
        //   flex-grow 对 absolute 的元素没有意义，生成端同样不会发那条规则。
        // 说明文字不用单独管显隐 —— 它已经是这一行 label 里的一个问号图标，
        // 整行 display:none 的时候跟着一起走（以前那条独立的 #hdrblk-width-hint
        // 要在这里多收一次，漏了就会出现「滑块没了、说明还孤零零留在页面上」）。
        const hdrNow = basicState.header || defaultBasicState.header;
        const showWidth = currentHeaderTarget === 'title' && hdrNow.namePos !== 'center';
        const widthRow = document.getElementById('hdrblk-width-row');
        if (widthRow) widthRow.style.display = showWidth ? '' : 'none';
    }

    // 把三个「修改对象」下拉归位到第一项。换预设 / 新建 / 重置基础设置时必须跑一遍。
    //
    // ★★ 必须在 `updateUIFromState()` **之前**调，绝不能在之后。★★
    // `updateUIFromState` 会把 `currentXxxTarget` 写进下拉（`select.value = currentFooterTarget`），
    // 而它顺带跑的 `syncConditionalRows` 还可能**反过来改** `currentFooterTarget`
    // （新预设藏了发送键 → 把选中项顶到「AI 回复按钮」）。所以顺序只能是
    // 「先归位 → 再回显」；写在后面就是让状态和下拉当场对不上：
    // 下拉显示「AI 回复按钮」而 `currentFooterTarget` 是 `'send'`，用户调出来的颜色
    // 全落到那颗藏起来的发送键上 —— 症状是「色块能拨、预览里什么都没变」。
    // 这个坑原先在换预设和启动兜底两处各踩了一次（两处都把 `currentFooterTarget = 'send'`
    // 写在了 `updateUIFromState()` 后面），所以收口成一个函数、由
    // `syncBasicUiFromCss` 在开头统一调用，别再在调用点手写这三行。
    //
    // ★ 顺手把「我方/对方」那个下拉的 disabled 解掉：中立类（msgtime/timediv/systip/
    //   groupname）选中时会把它禁掉（见 updateTypeLabel），不解就会出现「换了预设还是
    //   灰的、切不回对方气泡」。
    function resetEditTargets() {
        currentSelectType = 'normal_sent';
        currentHeaderTarget = 'back';
        currentFooterTarget = 'send';

        // 气泡那组的三个控件不在 updateUIFromState 的管辖范围内（它只认 currentSelectType
        // 算出来的那份数值），所以在这里一起摆正。
        const typeEl = document.getElementById('setting-bubble-type');
        if (typeEl) typeEl.value = 'normal';
        const sideEl = document.getElementById('setting-bubble-side');
        if (sideEl) { sideEl.value = 'sent'; sideEl.disabled = false; }
        const labelEl = document.getElementById('current-type-label');
        if (labelEl) labelEl.textContent = '普通气泡 - 我方';
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
        // ★ 这两个小工具必须定义在顶栏这一段**之前**：它们是 const，
        //   在声明之前用会撞上暂时性死区直接抛 ReferenceError，而这个函数
        //   每次切预设/切对象都要跑，一抛就是整页控件全不同步。
        const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
        const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

        const hdrConf = basicState.header || defaultBasicState.header;
        const namePosEl = document.getElementById('setting-header-name-pos');
        if (namePosEl) namePosEl.value = hdrConf.namePos;
        const hideStatusEl = document.getElementById('setting-header-hide-status');
        if (hideStatusEl) hideStatusEl.checked = !!hdrConf.hideStatus;
        const collapseCallEl = document.getElementById('setting-header-collapse-call');
        if (collapseCallEl) collapseCallEl.checked = !!hdrConf.collapseCall;
        setVal('setting-header-bg', hdrConf.bg);
        setVal('setting-header-bg-text', String(hdrConf.bg).toUpperCase());
        setVal('setting-header-opacity', hdrConf.opacity);
        setTxt('val-header-opacity', hdrConf.opacity);
        setVal('setting-header-blur', hdrConf.blur);
        setTxt('val-header-blur', hdrConf.blur);
        setVal('setting-header-div-w', hdrConf.divW);
        setTxt('val-header-div-w', hdrConf.divW);
        setVal('setting-header-div-c', hdrConf.divC);
        setVal('setting-header-div-c-text', String(hdrConf.divC).toUpperCase());
        setVal('setting-header-btn-c', hdrConf.btnC);
        setVal('setting-header-btn-c-text', String(hdrConf.btnC).toUpperCase());

        // 顶栏三块元素共用下面这一组控件，靠「修改对象」下拉切换（同底栏那套路）。
        const hdrSelectEl = document.getElementById('setting-header-target');
        if (hdrSelectEl) hdrSelectEl.value = currentHeaderTarget;
        const hdrLabelEl = document.getElementById('current-header-label');
        if (hdrLabelEl && hdrSelectEl && hdrSelectEl.selectedIndex >= 0) {
            hdrLabelEl.textContent = hdrSelectEl.options[hdrSelectEl.selectedIndex].text;
        }
        const blkConf = hdrConf[currentHeaderTarget] || defaultBasicState.header[currentHeaderTarget];
        setVal('setting-hdrblk-bg', blkConf.bg);
        setVal('setting-hdrblk-bg-text', String(blkConf.bg).toUpperCase());
        setVal('setting-hdrblk-opacity', blkConf.opacity);
        setTxt('val-hdrblk-opacity', blkConf.opacity);
        setVal('setting-hdrblk-pad', blkConf.pad);
        setTxt('val-hdrblk-pad', blkConf.pad);
        setVal('setting-hdrblk-radius', blkConf.radius);
        setTxt('val-hdrblk-radius', blkConf.radius);
        setVal('setting-hdrblk-stroke-c', blkConf.strokeC);
        setVal('setting-hdrblk-stroke-c-text', String(blkConf.strokeC).toUpperCase());
        setVal('setting-hdrblk-stroke-w', blkConf.strokeW);
        setTxt('val-hdrblk-stroke-w', blkConf.strokeW);
        // 宽度占比只有昵称栏这一块有（别的两块读不到就按默认 100 回显，那一行反正是收着的）
        setVal('setting-hdrblk-width', blkConf.widthPct !== undefined ? blkConf.widthPct : 100);
        setTxt('val-hdrblk-width', blkConf.widthPct !== undefined ? blkConf.widthPct : 100);

        // ---- 底栏那块面板 ----
        const ftrBar = basicState.footer || defaultBasicState.footer;
        const hideSendEl = document.getElementById('setting-footer-hide-send');
        if (hideSendEl) hideSendEl.checked = !!ftrBar.hideSend;
        const collapseToolbarEl = document.getElementById('setting-footer-collapse-toolbar');
        if (collapseToolbarEl) collapseToolbarEl.checked = !!ftrBar.collapseToolbar;
        const collapseReplyEl = document.getElementById('setting-footer-collapse-reply');
        if (collapseReplyEl) collapseReplyEl.checked = !!ftrBar.collapseReply;
        setVal('setting-footer-bar-bg', ftrBar.bg);
        setVal('setting-footer-bar-bg-text', String(ftrBar.bg).toUpperCase());
        setVal('setting-footer-bar-opacity', ftrBar.opacity);
        setTxt('val-footer-bar-opacity', ftrBar.opacity);
        setVal('setting-footer-bar-blur', ftrBar.blur);
        setTxt('val-footer-bar-blur', ftrBar.blur);
        setVal('setting-footer-div-w', ftrBar.divW);
        setTxt('val-footer-div-w', ftrBar.divW);
        setVal('setting-footer-div-c', ftrBar.divC);
        setVal('setting-footer-div-c-text', String(ftrBar.divC).toUpperCase());
        // 工具栏图标颜色（靠一个 CSS 变量一次覆盖全部，见生成端那段注释）
        setVal('setting-footer-btn-c', ftrBar.btnC);
        setVal('setting-footer-btn-c-text', String(ftrBar.btnC).toUpperCase());
        const ftrSelectEl = document.getElementById('setting-footer-target');
        if (ftrSelectEl) ftrSelectEl.value = currentFooterTarget;
        const ftrLabelEl = document.getElementById('current-footer-label');
        if (ftrLabelEl && ftrSelectEl && ftrSelectEl.selectedIndex >= 0) {
            ftrLabelEl.textContent = ftrSelectEl.options[ftrSelectEl.selectedIndex].text;
        }
        const ftrConf = (basicState.footer || {})[currentFooterTarget]
            || defaultBasicState.footer[currentFooterTarget];
        setVal('setting-footer-bg', ftrConf.bg);
        setVal('setting-footer-bg-text', String(ftrConf.bg).toUpperCase());
        setVal('setting-footer-color', ftrConf.color);
        setVal('setting-footer-color-text', String(ftrConf.color).toUpperCase());
        setVal('setting-footer-stroke-c', ftrConf.strokeC);
        setVal('setting-footer-stroke-c-text', String(ftrConf.strokeC).toUpperCase());
        setVal('setting-footer-stroke-w', ftrConf.strokeW);
        setTxt('val-footer-stroke-w', ftrConf.strokeW);
        setVal('setting-footer-radius', ftrConf.radius);
        setTxt('val-footer-radius', ftrConf.radius);
    }

function syncBasicUiFromCss(css) {
        // 这个函数是「把一份 CSS 装进面板」的唯一入口（换预设、启动兜底、粘贴别人分享的
        // 完整外观都走它），所以三个「修改对象」下拉就在这里统一归位 —— 放在调用点手写
        // 容易漏，漏掉的那一处就是用户报的「切完预设选不中发送按钮」。
        // 末尾那句 updateUIFromState() 会把归位后的值回显出去，顺序已经是对的。
        resetEditTargets();
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
                        // header 底下也嵌着三个对象（返回键 / 昵称栏 / 按钮组），同 footer：
                        // 外层那次浅合并会把 parsed 里存在的那个键**整块**顶掉，所以每个
                        // 再单独合一次，底板必须取 defaultBasicState。
                        ['back', 'title', 'group'].forEach(k => {
                            if (parsed.header[k]) {
                                basicState.header[k] = { ...defaultBasicState.header[k], ...parsed.header[k] };
                            }
                        });
                        // 兼容迁移：顶栏按钮曾经只有**一组**平铺的 radius/strokeW/strokeC，
                        // 而且画在**每颗按钮**身上（返回 + 通话 + 菜单各得一个框）。
                        // 现在按块走，所以把老值搬到返回键和按钮组上
                        // （昵称栏那时候压根没有样式可言，不搬）。
                        // ★ 只搬**真被用户改过**的：老默认是 radius 8 / strokeW 0 / strokeC #000000，
                        //   原样搬过去会让"从没动过顶栏"的老预设凭空生成 border-radius:8px。
                        // ★ 判定为改过就三项一起搬：radius 8 是配着描边看的，
                        //   只搬描边会把圆角框变成直角框。
                        const legacyHdr = parsed.header;
                        const legacyTouched =
                            (legacyHdr.radius !== undefined && legacyHdr.radius !== 8)
                            || (legacyHdr.strokeW !== undefined && legacyHdr.strokeW !== 0)
                            || (legacyHdr.strokeC !== undefined
                                && String(legacyHdr.strokeC).toUpperCase() !== '#000000');
                        if (legacyTouched) {
                            ['back', 'group'].forEach(k => {
                                if (parsed.header[k]) return;   // 已经是新结构了，别回头覆盖
                                const blk = basicState.header[k];
                                if (legacyHdr.radius !== undefined) blk.radius = legacyHdr.radius;
                                if (legacyHdr.strokeW !== undefined) blk.strokeW = legacyHdr.strokeW;
                                if (legacyHdr.strokeC !== undefined) blk.strokeC = legacyHdr.strokeC;
                            });
                        }
                        // 平铺的老字段不留在 state 里 —— 留着会被下一次保存原样写回 META，
                        // 下次加载又触发一遍上面这段迁移（而那时三块可能已经被用户改过了）。
                        delete basicState.header.radius;
                        delete basicState.header.strokeW;
                        delete basicState.header.strokeC;
                        // 昵称栏的「贴合文字」(fit, 布尔) 已被「宽度占比」(widthPct) 顶替。
                        // 不迁移 —— "贴着文字"没有对应的百分比，硬折算成某个数反而更难解释；
                        // 丢掉等于退回 100%（占满空档），用户照自己的眼睛重新拨一个数就行。
                        if (basicState.header.title) delete basicState.header.title.fit;
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
                        // 工具栏图标的「线条粗细」(btnW → --bar-icon-stroke) 短命地存在过一版，
                        // 发现 6 颗里只有 2 颗是线型、调了反而粗细不一，当天就删了。
                        // 上面那层浅合并会把 parsed 里的 btnW 原样带进来、再写回 META 一直传下去，
                        // 所以显式丢掉（同 header.title.fit 那条的处理）。不迁移：没有等价的新字段。
                        delete basicState.footer.btnW;
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
        const tName = typeSelect.options[typeSelect.selectedIndex].text;
        // 旁白以前是「中立」的一类、side 下拉被禁用；现在和普通气泡一样分两侧：
        // 我方 = 用户自己发的剧情旁白，对方 = AI 写的旁白。
        // 真正中立的是后面补的那四类小字（时间 / 分割线 / 系统提示 / 群昵称）——
        // 它们在静态 CSS 里两侧共用一条规则，拆成两套只是让用户多调一遍。
        if (NEUTRAL_TYPES.has(t)) {
            sideSelect.disabled = true;
            currentSelectType = t;
            document.getElementById('current-type-label').textContent = tName;
        } else {
            sideSelect.disabled = false;
            currentSelectType = `${t}_${s}`;
            const sName = sideSelect.options[sideSelect.selectedIndex].text;
            document.getElementById('current-type-label').textContent = `${tName} - ${sName}`;
        }
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
            // 时间位置拨到「不显示」会把「消息时间」那个选项禁掉、可能顺带把当前选中的
            // 修改对象顶回普通气泡（见 syncConditionalRows），所以得重新同步一遍控件 ——
            // 不同步的话色块里还显示着时间那组的数值，而再拨一下写进去的是普通气泡，
            // 用户会看到"我调的是时间，普通气泡却变色了"。同底栏藏发送键那条处理。
            if(id === 'setting-time-pos') updateUIFromState();
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
            // 「昵称位置」切到/离开居中档时，下面那条「宽度占比」要跟着收起/露出
            // （居中走 absolute，flex-grow 对它没意义）。顺手都过一遍，便宜。
            syncConditionalRows();
            generateCssFromState();
        });
    };
    bindHeaderInput('setting-header-name-pos', t => { basicState.header.namePos = t.value; });
    bindHeaderInput('setting-header-hide-status', t => { basicState.header.hideStatus = t.checked; });
    bindHeaderInput('setting-header-collapse-call', t => { basicState.header.collapseCall = t.checked; });

    const collapseToolbarCb = document.getElementById('setting-footer-collapse-toolbar');
    if (collapseToolbarCb) {
        collapseToolbarCb.addEventListener('change', (e) => {
            if (!basicState.footer) basicState.footer = JSON.parse(JSON.stringify(defaultBasicState.footer));
            basicState.footer.collapseToolbar = e.target.checked;
            generateCssFromState();
        });
    }

    const collapseReplyCb = document.getElementById('setting-footer-collapse-reply');
    if (collapseReplyCb) {
        collapseReplyCb.addEventListener('change', (e) => {
            if (!basicState.footer) basicState.footer = JSON.parse(JSON.stringify(defaultBasicState.footer));
            basicState.footer.collapseReply = e.target.checked;
            generateCssFromState();
        });
    }

    // 顶栏/底栏「栏本体 + 顶栏按钮」那几组控件。和下面 footerInputsMap 同一个路子，
    // 区别只在写进 basicState.header / basicState.footer 的**顶层**
    // （footerInputsMap 写的是 footer 底下 send/reply/input 三个对象之一）。
    // peer 一栏：'number' 填数值回显的 span id，色值两项互填对方的 id。
    const BAR_INPUTS = [
        ['setting-header-bg',            'header', 'bg',      'color',  'setting-header-bg-text'],
        ['setting-header-bg-text',       'header', 'bg',      'text',   'setting-header-bg'],
        ['setting-header-opacity',       'header', 'opacity', 'number', 'val-header-opacity'],
        ['setting-header-blur',          'header', 'blur',    'number', 'val-header-blur'],
        ['setting-header-btn-c',         'header', 'btnC',    'color',  'setting-header-btn-c-text'],
        ['setting-header-btn-c-text',    'header', 'btnC',    'text',   'setting-header-btn-c'],
        ['setting-header-div-w',         'header', 'divW',    'number', 'val-header-div-w'],
        ['setting-header-div-c',         'header', 'divC',    'color',  'setting-header-div-c-text'],
        ['setting-header-div-c-text',    'header', 'divC',    'text',   'setting-header-div-c'],
        ['setting-footer-bar-bg',        'footer', 'bg',      'color',  'setting-footer-bar-bg-text'],
        ['setting-footer-bar-bg-text',   'footer', 'bg',      'text',   'setting-footer-bar-bg'],
        ['setting-footer-bar-opacity',   'footer', 'opacity', 'number', 'val-footer-bar-opacity'],
        ['setting-footer-bar-blur',      'footer', 'blur',    'number', 'val-footer-bar-blur'],
        ['setting-footer-btn-c',         'footer', 'btnC',    'color',  'setting-footer-btn-c-text'],
        ['setting-footer-btn-c-text',    'footer', 'btnC',    'text',   'setting-footer-btn-c'],
        ['setting-footer-div-w',         'footer', 'divW',    'number', 'val-footer-div-w'],
        ['setting-footer-div-c',         'footer', 'divC',    'color',  'setting-footer-div-c-text'],
        ['setting-footer-div-c-text',    'footer', 'divC',    'text',   'setting-footer-div-c']
    ];
    BAR_INPUTS.forEach(([id, section, key, kind, peerId]) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', (e) => {
            let val = e.target.value;
            if (kind === 'number') {
                val = parseFloat(val) || 0;
                const disp = document.getElementById(peerId);
                if (disp) disp.textContent = val;
            }
            if (!basicState[section]) {
                basicState[section] = JSON.parse(JSON.stringify(defaultBasicState[section]));
            }
            basicState[section][key] = val;

            // 取色器 ↔ 手输框互相回填。手输的只在凑够 6 位合法 HEX 时才回填取色器，
            // 否则打字到一半（#0 / #00…）就会把取色器推成黑色。
            if (kind === 'color') {
                const t = document.getElementById(peerId);
                if (t) t.value = String(val).toUpperCase();
            }
            if (kind === 'text' && /^#[0-9A-F]{6}$/i.test(val)) {
                const c = document.getElementById(peerId);
                if (c) c.value = val;
            }
            generateCssFromState();
        });
    });

    // ---- 顶栏三块元素：「修改对象」下拉 + 共用的那一组控件 ----
    // 和下面底栏的 footerInputsMap 同一个路子，区别只在写进的是 basicState.header
    // 底下 back/title/group 三个对象之一。
    //
    // 往当前对象上写一个字段。老预设里 header 可能整块缺失、或缺这三个子对象，
    // 所以每次都以默认值为底板补齐再写（和底栏那边同一套防御）。
    const writeHeaderBlock = (key, val) => {
        if (!basicState.header) {
            basicState.header = JSON.parse(JSON.stringify(defaultBasicState.header));
        }
        if (!basicState.header[currentHeaderTarget]) {
            basicState.header[currentHeaderTarget] =
                { ...defaultBasicState.header[currentHeaderTarget] };
        }
        basicState.header[currentHeaderTarget][key] = val;
    };

    const headerTargetSel = document.getElementById('setting-header-target');
    if (headerTargetSel) {
        headerTargetSel.addEventListener('change', (e) => {
            currentHeaderTarget = e.target.value;
            // 换对象只是换一组数值进控件，不产生新 CSS。但「贴合文字」那行只属于昵称栏，
            // 得跟着藏/放 —— 所以这里要多走一趟 syncConditionalRows。
            syncConditionalRows();
            updateUIFromState();
        });
    }

    // 控件 id → [字段, 类型, 伙伴 id]。'number' 的伙伴是数值回显的 span，
    // 色值两项互填对方的 id（取色器 ↔ 手输框）。
    const HDR_BLOCK_INPUTS = {
        'setting-hdrblk-bg':            ['bg',      'color',  'setting-hdrblk-bg-text'],
        'setting-hdrblk-bg-text':       ['bg',      'text',   'setting-hdrblk-bg'],
        'setting-hdrblk-opacity':       ['opacity', 'number', 'val-hdrblk-opacity'],
        'setting-hdrblk-pad':           ['pad',     'number', 'val-hdrblk-pad'],
        'setting-hdrblk-radius':        ['radius',  'number', 'val-hdrblk-radius'],
        'setting-hdrblk-stroke-c':      ['strokeC', 'color',  'setting-hdrblk-stroke-c-text'],
        'setting-hdrblk-stroke-c-text': ['strokeC', 'text',   'setting-hdrblk-stroke-c'],
        'setting-hdrblk-stroke-w':      ['strokeW', 'number', 'val-hdrblk-stroke-w'],
        'setting-hdrblk-width':         ['widthPct', 'number', 'val-hdrblk-width']
    };
    Object.keys(HDR_BLOCK_INPUTS).forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', (e) => {
            const [key, kind, peerId] = HDR_BLOCK_INPUTS[id];
            let val = e.target.value;
            if (kind === 'number') {
                val = parseFloat(val) || 0;
                const disp = document.getElementById(peerId);
                if (disp) disp.textContent = val;
            }
            writeHeaderBlock(key, val);

            // 取色器 ↔ 手输框互相回填。手输的只在凑够 6 位合法 HEX 时才回填取色器，
            // 否则打字到一半（#0 / #00…）就会把取色器推成黑色。
            if (kind === 'color') {
                const t = document.getElementById(peerId);
                if (t) t.value = String(val).toUpperCase();
            }
            if (kind === 'text' && /^#[0-9A-F]{6}$/i.test(val)) {
                const c = document.getElementById(peerId);
                if (c) c.value = val;
            }
            generateCssFromState();
        });
    });

    const hideSendCb = document.getElementById('setting-footer-hide-send');    if (hideSendCb) {
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

    // 控件 → 当前对象的字段。'text' 那两对是色值的手输框。
    const footerInputsMap = {
        'setting-footer-bg':         ['bg', 'color'],
        'setting-footer-bg-text':    ['bg', 'text'],
        'setting-footer-color':      ['color', 'color'],
        'setting-footer-color-text': ['color', 'text'],
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
            // ★ 这里按「手输框 id = 取色器 id + '-text'」的命名约定推出对方，
            //   不要再逐个 id 硬写 —— 原先 bg / strokeC 各抄了一份四行的 if，
            //   加第三对（color）时很容易只抄一半，症状是"取色器调了手输框不跟着变"。
            if (kind === 'color') {
                const t = document.getElementById(`${id}-text`);
                if (t) t.value = String(val).toUpperCase();
            }
            if (kind === 'text' && /^#[0-9A-F]{6}$/i.test(val)) {
                const c = document.getElementById(id.replace(/-text$/, ''));
                if (c) c.value = val;
            }
            generateCssFromState();
        });
    });

    const resetBasicBtn = document.getElementById('reset-basic-css-btn');
    if (resetBasicBtn) {
        resetBasicBtn.addEventListener('click',async () => {
             if (!await AppUI.confirm('是否确定重置基础设置，默认气泡样式将恢复原始样式。', "系统提示", "确认", "取消")) return; 
            basicState = JSON.parse(JSON.stringify(defaultBasicState));
            resetEditTargets();   // 同新建：归位要排在回显前面
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

    // 「自动生成的样式」那个折叠框。用的是全项目共用的 .collapsible-section
    // （components.css），toggle 写法照抄 customize.js。
    // ★ 必须像 addBtn/saveBtn/翻页键那样 cloneNode 去重绑定：setupBubblePresets 会被
    //   调两次（main.js 的 init + chat_list.js 的 setupChatListScreen），绑两遍的话
    //   点一下 toggle 两次 = 原地不动，症状是「点了没反应」。
    const genHeader = document.querySelector('#bubble-generated-css-section .collapsible-header');
    if (genHeader) {
        const freshHeader = genHeader.cloneNode(true);
        genHeader.parentNode.replaceChild(freshHeader, genHeader);
        freshHeader.addEventListener('click', () => {
            freshHeader.parentElement.classList.toggle('open');
        });
    }

    if(cssInput) {
        cssInput.addEventListener('input', () => {
            // ★ 这里**不能**再无脑 syncBasicUiFromCss(cssInput.value)。
            //   拆两个框之后这个 textarea 里只有用户手写的那半边、不含 META 注释，
            //   反解会把整块基础设置重置成默认值 —— 症状是"在高级框里随便敲个字，
            //   上面调好的气泡全变回出厂样子"。面板状态的权威来源是 basicState，
            //   它已经镜像在只读框的 META 里了，用户打字不该动它。
            // 唯一要反解的情况：用户整段粘进来一份别人分享的完整 CSS（里面带生成块）。
            //   这时把它摊回两个框，再按 META 还原面板 —— 比拆之前更顺手。
            if (cssInput.value.includes(START_MARKER)) {
                const full = cssInput.value;
                spreadBubbleCss(full);
                syncBasicUiFromCss(full);
            }
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

            // 新建 = 一份出厂状态，三个「修改对象」下拉也得跟着回到第一项
            // （归位必须排在 updateUIFromState 前面，理由见 resetEditTargets 的注释）。
            basicState = JSON.parse(JSON.stringify(defaultBasicState));
            resetEditTargets();
            updateUIFromState();
            currentEditingPresetOriginalName = ""; 
            if(nameInput) nameInput.value = newName;
            
            // 两个框一起清空。生成块那半边交给 generateCssFromState ——
            // basicState 刚重置成默认，hasChanges 为假，它会把只读框清掉。
            spreadBubbleCss('');
            generateCssFromState();
            if(delBtn) delBtn.style.display = 'none';
            if(window.showToast) showToast('已准备新建模板，请配置后保存');
        });
    }

    // ================== 保存预设逻辑 ==================
    if (saveBtn) {
        const newSaveBtn = saveBtn.cloneNode(true); saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
        newSaveBtn.addEventListener('click', async () => {
            const newName = nameInput ? nameInput.value.trim() : "";
            const newCss = composeBubbleCss().trim();
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

            const editBtn = mkPresetRowBtn('edit', '编辑');
            editBtn.onclick = function() {
                currentEditingPresetOriginalName = p.name;
                if(nameInput) nameInput.value = p.name;
                if(cssInput) { spreadBubbleCss(p.css); syncBasicUiFromCss(p.css); }
                if(delBtn) delBtn.style.display = p.isDefault ? 'none' : 'block';

                // 三个「修改对象」下拉的归位 + 控件回显都在 syncBasicUiFromCss 里做完了
                // （它开头 resetEditTargets()、结尾 updateUIFromState()）。
                // 这里原先手抄了一遍那几行，而且把 `currentFooterTarget = 'send'` 落在了
                // updateUIFromState **后面** —— 新预设要是藏了发送键，syncConditionalRows
                // 刚把选中项顶到「AI 回复按钮」，这一行又偷偷把状态改回 'send'，
                // 于是下拉显示的和实际在改的不是同一个按钮。别再往这里加归位代码。

                // 换了预设就回到第一页：下面的面板跟着回到「气泡」，
                // 否则上一次停在底栏、换完预设看到的还是底栏那组控件。
                setPreviewMode(0);
                if(window.showToast) showToast(`已加载预设: ${p.name}`);
                modal.style.display = 'none'; modal.classList.remove('visible');
            };
            btnWrap.appendChild(editBtn);

            // ★ 复制（= 另存为）。用户的真实处境：手滑把「默认」改了并保存，而「默认」
            //   会强制注入到所有还没单独指定外观的聊天，于是一改就是全局生效、想单独
            //   留一份都没地方留。复制一份出来就能把改好的样子落成独立预设，
            //   然后把「默认」改回去。所以**「默认」这行也要有这颗按钮**。
            // ★ 只复制**存盘的那份 css**，不碰编辑器里的未保存改动 —— 行上的按钮应该
            //   对应行上的那个预设，顺手把编辑器状态塞进来会变成「复制出来的东西和
            //   我点的那行不一样」。（想另存编辑器里的未保存改动：在名称框里换个名字
            //   直接点保存就是新建，保存逻辑的 else 分支已经是这个行为。）
            // ★ 新预设不需要动任何聊天：还没有聊天指向它。
            const copyBtn = mkPresetRowBtn('copy', '复制为新预设');
            copyBtn.onclick = async function () {
                const presetsAll = _getBubblePresets();
                const newName = _nextCopyPresetName(p.name, presetsAll);
                presetsAll.push({ name: newName, css: p.css || '' });
                _saveBubblePresets(presetsAll);
                await saveGlobalKeys(['bubbleCssPresets']);

                openManagePresetsModal();
                if (typeof window.populateChatThemeSelects === 'function') window.populateChatThemeSelects();
                if (window.showToast) showToast(`已复制为「${newName}」`);
            };
            btnWrap.appendChild(copyBtn);

            if (!p.isDefault) {
                const renameBtn = mkPresetRowBtn('rename', '重命名');
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

                const delListBtn = mkPresetRowBtn('del', '删除', 'del-btn');
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

    // ================== 导出：只导「当前这一套」 ==================
    // ★ 导的是**编辑器里现在这一份**（名字取名称框、CSS 取 composeBubbleCss()），
    //   不是整个预设库 —— 用户要的是单独分享一套外观，以前一点就把全部预设打包出去。
    //   取 composeBubbleCss() 而不是读那个 textarea：高级 Tab 已经拆成两个框，
    //   直接读只拿到用户手写的那半边，生成块会整段丢掉。
    // ★ 格式仍是**数组**（只装一个元素）：导入端按数组解析，老版本导出的多预设文件、
    //   别人分享的文件都还能照常导进来，别图省事换成裸对象。
    // ★ 必须走 Blob + `application/json`，**不能用 `data:text/json;charset=utf-8,...`**
    //   那套老写法（2026-10-08 之前就是）：安卓下载管理器把 `text/json` 原样记进
    //   MediaStore，而系统文件选择器是按 MIME 过滤的（accept 里的 `.json` 被 Chrome
    //   翻成 `application/json`），两边对不上 —— 文件明明躺在下载目录里，导入列表里
    //   却根本看不见，症状是「别的 json 都在，就我导的这个没有」。项目里别处的导出
    //   （api_settings.js 那几个预设）一直用的就是 Blob + application/json，照抄它。
    const exportBtn = document.getElementById('global-bubble-export-btn');
    if (exportBtn) {
        const newExportBtn = exportBtn.cloneNode(true); exportBtn.parentNode.replaceChild(newExportBtn, exportBtn);
        newExportBtn.addEventListener('click', () => {
            const name = (nameInput ? nameInput.value.trim() : '') || currentEditingPresetOriginalName;
            if (!name) return (window.showToast && showToast('请先给这套外观起个名字'));

            const one = { name, css: composeBubbleCss().trim() };
            const blob = new Blob([JSON.stringify([one], null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${_presetFileSafeName(name)}_ouobubblepreset.json`;
            document.body.appendChild(a); a.click();
            setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 100);
            if (window.showToast) showToast(`已导出外观：${name}`);
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
        spreadBubbleCss(defaultPreset.css);
        syncBasicUiFromCss(defaultPreset.css);
    } else {
        spreadBubbleCss('');
        syncBasicUiFromCss('');
        generateCssFromState();
    }

    // 「修改对象」的归位 + 控件回显同样由 syncBasicUiFromCss 一手做完
    // （开头 resetEditTargets()、结尾 updateUIFromState()）。这里原先手抄了一遍，
    // 并且把 `currentFooterTarget = 'send'` 写在了 updateUIFromState 后面 ——
    // 「默认」预设本身就藏了发送键的话，刚启动就是「下拉显示 AI 回复按钮、
    // 实际在改发送键」，不换预设也能复现「改了色没反应」。详见 resetEditTargets。

    // 初始态：预览停在第一页，下面的面板也就是「基础 → 气泡」。
    currentAppearanceTab = 'basic';
    setPreviewMode(0);
}

// 确保页面加载完成后执行绑定
window.setupBubblePresets = setupBubblePresets;

// ================================================================
// === 外观页那些问号弹窗的文案 ====================================
// ================================================================
// AppHelp 的约定是「谁的功能谁注册自己的文案」（见 js/core/utils.js 的那段说明），
// 所以放在这里而不是 utils 里攒成大字典。HTML 那边是 showHelp('bubble', '<key>')，
// 问号图标挂在每个小标题右边（.settings-group-title > .settings-group-info-icon）。
//
// ★ 这些话原先是直接摊在面板上的 `.setting-hint` —— 顶栏那块 5 条、底栏 3 条，
//   加起来比设置项本身还高，一屏装不下两个开关。收进问号之后：要看的人点一下，
//   不看的人眼里是一列干净的设置项。改功能时记得连文案一起改，别让它过期。
//
// ★ 正文最终走 AppUI.alert，而它用的是 innerText —— 换行写 \n，不要写 <br>。
if (typeof AppHelp !== 'undefined' && typeof AppHelp.register === 'function') {
    AppHelp.register('bubble', {

        // ---------------- 气泡 ----------------
        bubbleAvatarTime: {
            title: '头像与时间',
            content:
                '【隐藏头像】\n'
                + '两边的头像一起藏，气泡直接贴边。藏了之后「消息时间」里的\n'
                + '「头像下方」那一档会一并变灰 —— 头像没了，那一档会让气泡的左边缘\n'
                + '随每条消息的时间长短参差不齐。\n\n'
                + '【头像弧度】\n'
                + '拉到最右是正圆（默认），往左越来越方。\n\n'
                + '【消息时间】\n'
                + '四个位置：不显示 / 头像下方 / 气泡上方 / 气泡后。\n'
                + '换位置是纯样式，已经画出来的气泡会立刻跟着动，不用重进聊天。'
        },
        bubbleFont: {
            title: '自定义字体',
            content:
                '填一个字体文件的网址（.ttf / .otf / .woff2），聊天里的文字就用它来显示。\n'
                + '留空＝用系统默认字体。\n\n'
                + '注意这是从网上现取的，断网时会退回默认字体；文件大的话第一次进聊天\n'
                + '会有一下白字。想稳一点就挑小一些的字体文件。'
        },
        bubbleTypes: {
            title: '分类改气泡',
            content:
                '上面两个下拉选「改哪一种」，下面虚线框里那组控件就作用在它身上。\n'
                + '前四种分我方 / 对方，各自独立；后四种两侧共用一套，\n'
                + '选中它们时「我方 / 对方」那个下拉会自己变灰。\n\n'
                + '【四种气泡】\n'
                + '普通气泡：平时说话的那种。\n'
                + '旁白气泡：AI 在「线下模式」和「通话」里描述动作的那种；\n'
                + '　　　　　你自己在"+"面板发的「剧情旁白」算我方。\n'
                + '转账气泡：转账 / 收款的卡片。\n'
                + '引用气泡：带引用上一条的那种。\n\n'
                + '【另外四种小字】\n'
                + '这几样原本是写死的灰色，换成深色背景就看不清了，所以也放进来一起调：\n'
                + '消息时间：每条消息旁边那个时间（三个位置共用一套颜色）。\n'
                + '　　　　　时间设成「不显示」时这一项是灰的 —— 调了也看不见。\n'
                + '时间分割线：隔开两段对话的那行「昨天 22:30」。\n'
                + '系统提示：入群 / 改群名那种居中小条，撤回提示也算这一组。\n'
                + '群昵称：群聊里气泡上方那个名字。\n\n'
                + '【给小字加底色】\n'
                + '消息时间和群昵称出厂是光秃秃的文字、没有底。\n'
                + '把不透明度从 0 拉起来它们才会长出底色块，这时候会自动留一点内边距，\n'
                + '再配上「边角弧度」就是个小胶囊。只改文字颜色的话位置一点都不会动。\n\n'
                + '【不透明度 / 模糊度】\n'
                + '想要毛玻璃效果就把不透明度调低一点、再把模糊度拉起来 ——\n'
                + '不透明度 1 的时候背景全被挡住，模糊度拉满也看不出来。'
        },

        // ---------------- 顶栏 ----------------
        headerLayout: {
            title: '顶栏布局',
            content:
                '【昵称位置】\n'
                + '昵称和状态那两行字在中间那块里靠哪边 —— 不是「把中间那块挪到哪边」。\n'
                + '想改块本身的宽度，看下面「图标与部件」里的「宽度占比」。\n\n'
                + '【隐藏状态】\n'
                + '「状态」是昵称下面那行小字（绿点 + 在线/自定义状态）。\n'
                + '群聊本来就不显示，这个开关只对私聊有效。\n\n'
                + '【收纳通话】\n'
                + '收起来之后，通话按钮从顶栏挪进"+"面板，排在「批量删除」前面那一格。\n'
                + '群聊本来就没有通话，这个开关对群聊无效。'
        },
        headerBg: {
            title: '顶栏背景与分割线',
            content:
                '【背景颜色 / 不透明度 / 模糊度】\n'
                + '改的是整条顶栏的底。想要毛玻璃就把不透明度调低、模糊度拉起来。\n\n'
                + '【分割线】\n'
                + '顶栏下沿那条横线。出厂是没有的（粗细 0），拉起来才画。'
        },
        headerBlocks: {
            title: '顶栏图标与部件',
            content:
                '【图标颜色】\n'
                + '返回、通话、菜单这三个图标本身的颜色。下面的「底色」改的是\n'
                + '托着图标的那块方块，两件事。\n\n'
                + '【修改对象】\n'
                + '顶栏是三块各自独立的元素：返回键 / 昵称栏 / 右侧按钮组。\n'
                + '下拉选一块，虚线框里那组控件就作用在它身上。\n\n'
                + '【怎么让一块显出来】\n'
                + '三块出厂都是全透明的，所以「不透明度」就是色块的总开关 ——\n'
                + '停在 0 等于维持现状，拉起来才会出现块。\n'
                + '底色、描边、内边距只要有一项不为零，这一块就会从「贴边的裸图标」\n'
                + '规整成一个块（它原先为了裸图标准备的固定宽高和负外边距会一起归零，\n'
                + '所以位置会动一下，这是正常的）。'
        },
        headerWidth: {
            title: '昵称栏宽度占比',
            content:
                '昵称栏默认把返回键和按钮组之间的空档全占了（100%），给它上底色\n'
                + '就是长长一条。调到 80% 就只占其中八成，左右各留一道空隙。\n\n'
                + '★ 这跟「昵称位置」是两件事：那个管文字在块里靠哪边，\n'
                + '　 这个管块本身多宽。\n\n'
                + '「昵称位置」选了「居中」时这一行会收起来 —— 居中档走的是另一套\n'
                + '定位方式（块贴着文字居中），宽度占比对它没有意义。'
        },

        // ---------------- 底栏 ----------------
        footerLayout: {
            title: '底栏布局',
            content:
                '【隐藏发送按钮】\n'
                + '藏起来之后用键盘自带的发送键（回车）照样能发出去。\n'
                + '藏了之后「修改对象」里的「发送按钮」会一并变灰（调了也看不见）。\n\n'
                + '【收纳工具栏】\n'
                + '收起来之后，输入框上面那排按钮整条收进"+"面板，\n'
                + '"+"本身挪到输入框右边、发送键左边。\n\n'
                + '【收纳 AI 回复】\n'
                + '把「AI 回复」那颗圆按钮从输入框外面搬进输入框**里面**的右侧，\n'
                + '点一下输入框它才浮出来 —— 不打字的时候底栏就只剩输入框和发送键。\n'
                + '它不像另外两个「收纳」那样收进"+"面板：按钮还在原地，只是换了个住处，\n'
                + '所以等 AI 回话时它照样会变灰（那几秒不收，免得没有进度反馈）。'
        },
        footerBg: {
            title: '底栏背景与分割线',
            content:
                '【背景颜色 / 不透明度 / 模糊度】\n'
                + '改的是整条底栏的底。想要毛玻璃就把不透明度调低、模糊度拉起来。\n\n'
                + '【分割线】\n'
                + '底栏上沿那条横线。出厂是 1px 的淡白线（三成不透明度，几乎看不见）\n'
                + '—— 这两个旋钮一旦动过，它就变成所选颜色的实线；\n'
                + '想彻底去掉把粗细拉到 0。'
        },
        footerIcon: {
            title: '工具栏图标',
            content:
                '【图标颜色】\n'
                + '底栏工具栏那排图标（语音/识图/相机/钱包/表情/加号）的颜色，一改全改。\n'
                + '收纳工具栏之后，输入栏里那颗"+"也跟着这里走。\n\n'
                + '【为什么没有「粗细」】\n'
                + '这 6 颗里只有语音和钱包是空心线条画的，另外 4 颗是实心图形、\n'
                + '粗细是画死在图里的。所以真给个粗细滑块，结果是 2 颗变粗、\n'
                + '整排看着粗细不一 —— 不如不给。想整体换粗细得换图标素材。\n\n'
                + '【不包括 AI 回复按钮】\n'
                + '那颗是实心蓝底的，它的图标颜色在下面「部件」里选「AI 回复按钮」改文字颜色。'
        },
        footerBlocks: {
            title: '底栏部件',
            content:
                '底栏有三个能单独改的东西：发送按钮 / AI 回复按钮 / 输入栏。\n'
                + '下拉选一个，虚线框里那组控件就作用在它身上。\n\n'
                + '【文字颜色】\n'
                + '发送按钮改的是"发送"两个字，AI 回复按钮改的是上面那个图标，\n'
                + '输入栏改的是你打进去的字 —— 输入栏这一项会连灰色提示文字\n'
                + '（「输入消息...」）一起改成同色的淡化版，所以底色调深了也看得见。\n\n'
                + '【关于 AI 回复按钮】\n'
                + '它在等 AI 回话的那几秒会自己变灰 —— 那是"正在生成"的进度反馈，\n'
                + '你改的底色只作用在它能点的时候，变灰那一下仍然是灰的；\n'
                + '文字颜色不受影响（否则变灰时按钮上的图标会一起消失）。'
        },

        // ---------------- 高级 ----------------
        customCss: {
            title: '自己写 CSS',
            content:
                '这一栏分上下两块。\n\n'
                + '【我的 CSS】\n'
                + '你自己写的放这儿，想写什么写什么，随便改 —— 这块只有你会动。\n\n'
                + '【自动生成的样式】\n'
                + '上面「基础」里拨的每一个旋钮，都会在这里变成一段 CSS。\n'
                + '它是**只读**的，平时折叠着，想参考写法就点开看 ——\n'
                + '照着里面的选择器抄，是找"某个东西到底叫什么 class"最快的办法。\n'
                + '以前这两块挤在同一个输入框里，改自己那几行很容易把生成的部分一起改坏，\n'
                + '所以分开了。保存的时候还是合成一份，导出的预设和以前完全通用。\n\n'
                + '【想盖掉生成的样式怎么办】\n'
                + '生成的那些规则都带 !important，所以你要盖它，自己那条也得带 !important。\n\n'
                + '【粘贴别人分享的外观】\n'
                + '整段粘进「我的 CSS」就行 —— 认出里面带生成区块的话，\n'
                + '会自动拆成两块、并把上面的旋钮一起还原成那份外观的设置。'
        },

        // ---------------- 单行的问号（不属于任何小标题） ----------------
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