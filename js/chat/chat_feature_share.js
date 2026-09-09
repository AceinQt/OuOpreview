// chat_feature_share.js — 万能分享卡片：格式定义 / 发送弹窗 / 详情弹窗
//
// 一条分享消息长这样（方括号包到底，和语音/位置/礼物那些消息一个形状 ——
// 形状不一致，Gemini 照抄上下文时会自己发明格式）：
//
//   [小明的分享：
//   标题：煲仔饭
//   类别：美团外卖链接
//   内容：腊味双拼煲仔饭 ¥38，30分钟送达
//   附加信息：想着你昨天说想吃]
//
// 为什么不用分号分隔四个字段：正文里出现分号就切错了（转账那条正则至今还在
// 跟中英文分号搏斗）。这里按**行首关键字**定边界，所以正文里的分号、冒号、
// 方括号全都无所谓，唯一的约束是别在行首顶格写「类别：」这种字样。
//
// 三个来源共用这一份格式：用户从 + 号面板手动发、AI 角色自己发（提示词里
// 教了）、喵坛帖子分享过来（forum_share.js）。渲染和详情弹窗因此也只有一套。

// 用户填的类别是自由文本，这几个只是弹窗里的快捷标签。
// 「来自喵坛的分享」不在这里：那是论坛分享按钮的专用类别，手填没意义。
const SHARE_CATEGORY_PRESETS = ['网站链接', '文件', '快递物流'];

// 喵坛分享固定用这个类别，卡片顶部就显示它（和旧版 [喵坛分享] 的页头文案一致）
const SHARE_FORUM_CATEGORY = '来自喵坛的分享';

// 整体先抓出 [xxx的分享：...] 的 body，字段再交给 parseShareMessage 按行拆。
// 发送者名里禁掉方括号和冒号，免得正文里提到「的分享：」的普通消息被抢走。
// 锚在开头和结尾：一条分享消息整条就是这张卡片，不会前面还有别的话。
// 不锚的话，正文里引用了别人的分享就会把整条消息劫持成卡片。
//
// body 用懒惰量词 + 结尾锚，把**最后**那个 ] 留给格式收尾、其余全归正文 ——
// 所以正文自己可以以 ] 结尾（"原价[59元]"）。别在事后 replace(/\]$/) 去括号，
// 那样会把正文的括号一起削掉。
const SHARE_MESSAGE_REGEX = /^\s*\[([^\[\]：:\n]+?)的分享[:：]\s*([\s\S]+?)\][ \t]*$/;

/**
 * 把四个字段拼成消息正文。附加信息可留空 —— 留空时整行不写，
 * 免得 AI 学到「附加信息：」后面可以什么都没有。
 */
function buildShareMessageContent(senderName, share) {
    const title = (share.title || '').trim();
    const category = (share.category || '').trim();
    const body = (share.body || '').trim();
    const extra = (share.extra || '').trim();

    let content = `[${senderName}的分享：\n标题：${title}\n类别：${category}\n内容：${body}`;
    if (extra) content += `\n附加信息：${extra}`;
    content += ']';
    return content;
}

/**
 * 解析一条分享消息。认不出来返回 null（调用方据此回退到别的气泡分支）。
 * 返回 { senderName, title, category, body, extra }，extra 可能是空串。
 */
function parseShareMessage(content) {
    if (typeof content !== 'string') return null;
    const match = content.match(SHARE_MESSAGE_REGEX);
    if (!match) return null;

    const senderName = match[1].trim();
    // 收尾的 ] 由正则本身排除（见 SHARE_MESSAGE_REGEX），不能在这里用
    // replace(/\]$/) 去掉 —— 正文自己以 ] 结尾时（"原价[59元]"）会被削掉一个。
    let body = match[2];

    // 行首关键字定边界：先记下每个字段起始行，再按行区间取值。
    // 这样最后一个字段（通常是内容或附加信息）可以随便换行。
    const FIELD_KEYS = [
        { key: 'title', label: '标题' },
        { key: 'category', label: '类别' },
        { key: 'body', label: '内容' },
        { key: 'extra', label: '附加信息' },
    ];

    const lines = body.split('\n');
    const marks = [];
    lines.forEach((line, index) => {
        for (const field of FIELD_KEYS) {
            // 顶格（允许前导空格）写「标题：」才算字段头
            const re = new RegExp(`^\\s*${field.label}[:：]\\s*`);
            const m = line.match(re);
            if (m) {
                marks.push({ key: field.key, line: index, valueStart: m[0].length });
                break;
            }
        }
    });

    if (!marks.length) return null;

    const result = { senderName, title: '', category: '', body: '', extra: '' };
    marks.forEach((mark, i) => {
        const endLine = i + 1 < marks.length ? marks[i + 1].line : lines.length;
        const chunk = [];
        for (let ln = mark.line; ln < endLine; ln++) {
            chunk.push(ln === mark.line ? lines[ln].slice(mark.valueStart) : lines[ln]);
        }
        result[mark.key] = chunk.join('\n').trim();
    });

    // 标题和内容全空的，当不是分享（比如正文里恰好写了「附加信息：」）
    if (!result.title && !result.body) return null;
    return result;
}

// 一条方括号消息的开头，形如 [小猫的消息： / [小猫的语音： / [小猫的分享：
// 用来判断"下一条消息开始了"，从而给多行分享卡片定尾。
const SHARE_NEXT_MESSAGE_HEAD = /^\s*\[[^\[\]\n：:]{1,24}(?:的|发|已|接收|退回|引用|更新|撤回)[^\[\]\n]{0,12}[:：]/;

/**
 * 从 AI 回复里把多行分享卡片整块抠出来。
 *
 * 为什么不能用一条正则：卡片的「内容」是大段自由文本，里面很可能出现 ]
 * （"第[三]章"、"价格[特价]39元"）。非贪婪 [\s\S]*?\] 会停在**第一个**
 * 行尾 ]，把卡片截半截；贪婪又会一路吞掉后面别的消息。
 *
 * 所以按行扫：从卡片头那行开始，一直吃到"下一条方括号消息"或文本结束，
 * 期间记住**最后一个**以 ] 收尾的行 —— 那才是卡片真正的收尾。
 *
 * 返回 [{ start, end, text }]（end 为不含端点的下标，按 lines 索引）。
 */
function extractShareBlocks(text) {
    if (typeof text !== 'string') return [];
    const lines = text.split('\n');
    const blocks = [];
    let i = 0;

    while (i < lines.length) {
        const head = lines[i].match(/^\s*\[[^\[\]：:\n]+?的分享[:：]/);
        if (!head) { i++; continue; }

        // 卡片头这行本身就以 ] 收尾（单行写法）也算合法
        let lastCloser = /\][ \t]*$/.test(lines[i]) ? i : -1;
        let j = i + 1;
        for (; j < lines.length; j++) {
            // 下一条消息开始了 —— 卡片到此为止（不含这行）
            if (SHARE_NEXT_MESSAGE_HEAD.test(lines[j])) break;
            if (/\][ \t]*$/.test(lines[j])) lastCloser = j;
        }

        if (lastCloser >= i) {
            blocks.push({
                start: i,
                end: lastCloser + 1,
                text: lines.slice(i, lastCloser + 1).join('\n'),
            });
            i = lastCloser + 1;
        } else {
            // 没有收尾的 ]（AI 写漏了），别吞掉后面的内容
            i++;
        }
    }
    return blocks;
}

// 占位符的前后缀。写成两个显式常量而不是模板字符串里打空格：
// 那两个"空格"曾经被误写成 NUL 字节，肉眼和 grep 都看不出来，restore 时
// split 匹配不上，整张卡片会塌成一条 [unknown的消息：SHARE0 …] 气泡。
// 用 @@ 这种不会出现在正文里的记号，比空格更不容易被"顺手 trim 掉"。
const SHARE_PH_OPEN = '@@SHARE';
const SHARE_PH_CLOSE = '@@';

/**
 * 把回复里的分享卡片换成占位符，交出 { masked, blocks }。
 * 调用方跑完"见括号就断行"那几条规则后，用 restoreShareBlocks 填回去。
 */
function maskShareBlocks(text) {
    const blocks = extractShareBlocks(text);
    if (!blocks.length) return { masked: text, blocks: [] };

    const lines = text.split('\n');
    const out = [];
    let cursor = 0;
    blocks.forEach((block, n) => {
        out.push(...lines.slice(cursor, block.start));
        out.push(SHARE_PH_OPEN + n + SHARE_PH_CLOSE);
        cursor = block.end;
    });
    out.push(...lines.slice(cursor));
    return { masked: out.join('\n'), blocks: blocks.map(b => b.text) };
}

/** 与 maskShareBlocks 配对：把占位符换回卡片原文，并让每张卡独占一行。 */
function restoreShareBlocks(text, blocks) {
    let result = text;
    blocks.forEach((block, n) => {
        result = result.split(SHARE_PH_OPEN + n + SHARE_PH_CLOSE).join(`\n${block}\n`);
    });
    return result;
}

/**
 * 兼容旧格式：[喵坛分享]标题：X\n内容：Y<span style="display:none;">富上下文</span>
 * 旧消息已经在用户库里了，得继续认。正文当年被截成 50 字存下来了，拿不回全文，
 * 富上下文里那段散文塞进「附加信息」聊胜于无。
 */
function parseLegacyForumShare(content) {
    if (typeof content !== 'string' || !content.startsWith('[喵坛分享]')) return null;
    const match = content.match(/\[喵坛分享\]标题：([\s\S]+?)\n内容：([\s\S]+)/);
    if (!match) return null;

    const title = match[1].trim();
    let rest = match[2];
    let extra = '';
    // 富上下文藏在 display:none 的 span 里
    const hiddenMatch = rest.match(/<span style="display:none;">([\s\S]*?)<\/span>/);
    if (hiddenMatch) {
        extra = hiddenMatch[1].trim();
        rest = rest.replace(hiddenMatch[0], '');
    }
    return {
        senderName: '',
        title,
        category: SHARE_FORUM_CATEGORY,
        body: rest.trim(),
        extra,
    };
}

// --- 发送弹窗 ---

function setupShareFeature() {
    const modal = document.getElementById('send-share-modal');
    const form = document.getElementById('send-share-form');
    const tagBar = document.getElementById('share-category-presets');
    const categoryInput = document.getElementById('share-category-input');
    const detailModal = document.getElementById('share-detail-modal');

    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.remove('visible');
        });
    }

    // 类别快捷标签：点一下填进输入框，仍可自由改写
    if (tagBar && categoryInput) {
        tagBar.innerHTML = '';
        SHARE_CATEGORY_PRESETS.forEach(name => {
            const tag = document.createElement('button');
            tag.type = 'button';
            tag.className = 'share-category-tag';
            tag.textContent = name;
            tag.addEventListener('click', () => {
                categoryInput.value = name;
                categoryInput.focus();
            });
            tagBar.appendChild(tag);
        });
    }

    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const title = document.getElementById('share-title-input').value.trim();
            const category = categoryInput.value.trim();
            const body = document.getElementById('share-body-input').value.trim();
            const extra = document.getElementById('share-extra-input').value.trim();

            if (!title || !category || !body) {
                showToast('标题、类别、内容都要填哦。');
                return;
            }
            sendShareMessage({ title, category, body, extra });
        });
    }

    if (detailModal) {
        detailModal.addEventListener('click', (e) => {
            if (e.target === detailModal) detailModal.classList.remove('visible');
        });
        const closeBtn = document.getElementById('share-detail-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => detailModal.classList.remove('visible'));
        }
    }
}

function openShareModal() {
    const modal = document.getElementById('send-share-modal');
    const form = document.getElementById('send-share-form');
    if (!modal) return;
    if (form) form.reset();
    modal.classList.add('visible');
}

/**
 * 发到当前会话。流程照 sendMyLocation 那套：
 * 先关弹窗 → 时间感知 → push history → 立刻上气泡 → 落盘 → 刷列表。
 */
async function sendShareMessage(share) {
    const modal = document.getElementById('send-share-modal');
    if (modal) modal.classList.remove('visible');
    await new Promise(resolve => setTimeout(resolve, 100));

    const chat = (currentChatType === 'private')
        ? db.characters.find(c => c.id === currentChatId)
        : db.groups.find(g => g.id === currentChatId);
    if (!chat) return;

    if (typeof processTimePerception === 'function') {
        await processTimePerception(chat, currentChatId, currentChatType);
    }

    const myName = (currentChatType === 'private') ? chat.myName : chat.me.realName;
    const content = buildShareMessageContent(myName, share);

    const message = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        role: 'user',
        content: content,
        parts: [{ type: 'text', text: content }],
        timestamp: Date.now()
    };
    if (currentChatType === 'group') message.senderId = 'user_me';

    chat.history.push(message);
    addMessageBubble(message, currentChatId, currentChatType);
    await saveMessageToDB(message, currentChatId, currentChatType);
    await saveSingleChat(currentChatId, currentChatType);
    renderChatList();
}

// --- 详情弹窗 ---

/**
 * 点卡片弹出来的完整四项。share 由 parseShareMessage / parseLegacyForumShare 产出。
 */
function openShareDetailModal(share) {
    const modal = document.getElementById('share-detail-modal');
    if (!modal || !share) return;

    const setField = (id, value) => {
        const el = document.getElementById(id);
        if (!el) return;
        // textContent：分享内容是用户/AI 的自由文本，绝不能当 HTML 塞进去
        el.textContent = value || '';
    };

    // 正文/附注按行拆成段落。Gemini 分段没谱：有时单换行有时双换行，
    // pre-wrap 原样显示就忽紧忽松。空行丢掉、每行一个 <p>，
    // 段距交给 CSS，怎么换行渲染都统一。
    const setParagraphs = (id, value) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = '';
        (value || '').replace(/\r\n?/g, '\n').split('\n').forEach(line => {
            const text = line.trim();
            if (!text) return;
            const p = document.createElement('p');
            p.textContent = text;
            el.appendChild(p);
        });
    };

    setField('share-detail-category', share.category);
    setField('share-detail-title', share.title);
    setParagraphs('share-detail-body', share.body);

    // 附加信息可以留空 —— 空的时候整块藏掉，别留个空标题
    const extraBlock = document.getElementById('share-detail-extra-block');
    if (extraBlock) {
        if (share.extra) {
            extraBlock.style.display = '';
            setParagraphs('share-detail-extra', share.extra);
        } else {
            extraBlock.style.display = 'none';
        }
    }

    modal.classList.add('visible');
}

// 供 node 测试 require（浏览器里这行不执行）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        SHARE_MESSAGE_REGEX,
        SHARE_CATEGORY_PRESETS,
        SHARE_FORUM_CATEGORY,
        buildShareMessageContent,
        parseShareMessage,
        parseLegacyForumShare,
        extractShareBlocks,
        maskShareBlocks,
        restoreShareBlocks,
    };
}
