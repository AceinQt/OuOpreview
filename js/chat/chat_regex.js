// 正则只处理正文：存储型在新消息出场前执行，显示型只处理局部字符串副本。
// 分类、关联与规则本身存于数据库；这里不负责写库，也不能在通用保存时再次执行。
(function () {
    function compileRule(rule) {
        if (!rule || typeof rule.pattern !== 'string' || !rule.pattern.length) throw new Error('匹配表达式不能为空');
        return new RegExp(rule.pattern, typeof rule.flags === 'string' ? rule.flags : 'g');
    }

    function replaceText(source, rules) {
        const original = String(source ?? '');
        let text = original;
        let matched = false;
        const errors = [];
        for (const rule of rules || []) {
            if (!rule) continue;
            try {
                const expression = compileRule(rule);
                // test 会移动全局表达式的游标，replace 前必须归零；每次编译也避免聊天之间串状态。
                const hit = expression.test(text);
                expression.lastIndex = 0;
                if (hit) {
                    matched = true;
                    text = text.replace(expression, String(rule.replacement ?? ''));
                }
            } catch (error) {
                errors.push({ id: rule.id, name: rule.name || '未命名正则', message: error.message });
            }
        }
        return { text, changed: text !== original, matched, errors };
    }

    function getRules(chat, chatType, stage) {
        if (!chat) return [];
        // 整个类别动态生效，新增/移动规则不需要重存聊天；模式与阶段仍分别过滤。
        const binding = getChatRegexBinding(chat, chatType, db.regexCategories);
        const selected = new Set(binding.ids);
        const mode = chatType === 'private' && chat.offlineModeEnabled ? 'offline' : 'online';
        const result = [];
        for (const category of (Array.isArray(db.regexCategories) ? db.regexCategories : [])) {
            if (!selected.has(category.id) || (chatType === 'private' && binding.modes[category.id]?.[mode] !== true)) continue;
            for (const rule of (Array.isArray(category?.rules) ? category.rules : [])) {
                if (!rule || rule.mode !== stage) continue;
                result.push(rule);
            }
        }
        return result.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.id).localeCompare(String(b.id)));
    }

    const reportedErrors = new Set();
    function reportErrors(errors) {
        for (const error of errors) {
            const key = `${error.id}:${error.message}`;
            if (reportedErrors.has(key)) continue;
            reportedErrors.add(key);
            console.warn(`已跳过无效正则「${error.name}」：${error.message}`);
            if (typeof showToast === 'function') showToast(`正则「${error.name}」无效，已跳过`);
        }
    }

    // 对外壳做整条匹配，正文内的 ]、多行 HTML 不会截断，也不碰语音、转账等控制协议。
    function messageBody(message) {
        const content = typeof message?.content === 'string' ? message.content : '';
        if (message?.regexKind === 'html' || message?.parts?.[0]?.type === 'html') {
            return { kind: 'html', text: message.parts?.[0]?.type === 'html' ? String(message.parts[0].text ?? content) : content, prefix: '', suffix: '' };
        }
        const narration = content.match(/^(\[system-narration:)([\s\S]*)(\])$/);
        if (narration) return { kind: 'narration', text: narration[2], prefix: narration[1], suffix: narration[3] };
        const dialogue = content.match(/^(\[[^\[\]\r\n]*?的消息[:：]\s*)([\s\S]*)(\])$/);
        if (dialogue) return { kind: 'text', text: dialogue[2], prefix: dialogue[1], suffix: dialogue[3] };
        if (content && !content.startsWith('[') && !/^(?:data:image\/|https?:\/\/\S+\.(?:png|jpe?g|webp|gif))/i.test(content)) {
            return { kind: 'text', text: content, prefix: '', suffix: '' };
        }
        return null;
    }

    function applyStorage(message, chat, chatType) {
        if (!message || message.role !== 'assistant' || message.isHidden || message.isWithdrawn || message.regexKind
            || message.media || message.stickerData || message.transferStatus || message.giftStatus
            || message.callSessionId || chat?.callMode
            || (Array.isArray(message.parts) && message.parts.some(part => !['text', 'html'].includes(part?.type)))) return message;
        const rules = getRules(chat, chatType, 'storage');
        if (!rules.length) return message;
        const body = messageBody(message);
        if (!body) return message;
        const result = replaceText(body.text, rules);
        reportErrors(result.errors);
        if (!result.changed) return message;
        const content = body.prefix + result.text + body.suffix;
        message.content = content;
        message.parts = (message.parts || []).map(part => ({ ...part, text: part.type === 'html' ? result.text : content }));
        if (!message.parts.length) message.parts = [{ type: body.kind === 'html' ? 'html' : 'text', text: body.kind === 'html' ? result.text : content }];
        // 只记类型，不另存一份原文。替换正文中的 [system:…] 不能反过来执行隐藏/媒体协议。
        message.regexKind = body.kind;
        return message;
    }

    function classificationContent(message) {
        if (message?.regexKind === 'narration') return '[system-narration:正则正文]';
        if (message?.regexKind === 'html') return '<div>正则正文</div>';
        if (message?.regexKind === 'text') return '[正则的消息：正则正文]';
        return message?.content;
    }

    // 一个共享观察器负责回收已移走气泡的高度监听；不能等内页再次 resize 才释放。
    const frameObservers = new Map();
    let frameRemovalObserver;
    function observeFrame(frame, body, resize) {
        if (typeof ResizeObserver !== 'function' || !frame.isConnected) return;
        const observer = new ResizeObserver(resize);
        observer.observe(body);
        frameObservers.set(frame, observer);
        if (!frameRemovalObserver && typeof MutationObserver === 'function') {
            frameRemovalObserver = new MutationObserver(() => {
                for (const [item, watcher] of frameObservers) {
                    if (!item.isConnected) { watcher.disconnect(); frameObservers.delete(item); }
                }
                if (!frameObservers.size) { frameRemovalObserver.disconnect(); frameRemovalObserver = null; }
            });
            frameRemovalObserver.observe(document.documentElement, { childList: true, subtree: true });
        }
    }

    function renderHtmlPreview(container, source) {
        container.replaceChildren();
        container.classList.add('regex-html-bubble');
        const frame = document.createElement('iframe');
        frame.className = 'regex-html-frame';
        frame.title = '正则 HTML 展示';
        // 不开放脚本。同源权限仅用于父页面测量高度、转发长按，绝不能与 allow-scripts 同时开启。
        frame.setAttribute('sandbox', 'allow-same-origin');
        frame.setAttribute('referrerpolicy', 'no-referrer');
        frame.style.cssText = 'display:block;width:100%;min-width:0;height:48px;border:0;background:transparent;';
        // 先包一层正文容器：DOMPurify 对开头单独的 style 会丢弃，放进正文才能保留局部卡片样式。
        const cleaned = DOMPurify.sanitize('<div>' + String(source) + '</div>', {
            ADD_TAGS: ['style'], ADD_ATTR: ['style'],
            FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'meta', 'base', 'link'],
            FORBID_ATTR: ['srcdoc', 'autofocus']
        });
        const computed = typeof getComputedStyle === 'function' ? getComputedStyle(container) : null;
        const color = computed?.color || '#333';
        const fontSize = computed?.fontSize || '14px';
        // CSP 拦住脚本、表单与外部资源；图片允许 HTTPS/data，本页面数据不会成为卡片的脚本上下文。
        frame.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            + '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; script-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; img-src https: data:; font-src data:; form-action &#39;none&#39;; base-uri &#39;none&#39;">'
            + `<style>html,body{margin:0;background:transparent;overflow-wrap:anywhere;color:${color};font-size:${fontSize};font-family:system-ui,sans-serif}body{display:flow-root}*,*::before,*::after{box-sizing:border-box}img{max-width:100%}pre{white-space:pre-wrap}a{color:inherit}</style>`
            + '</head><body>' + cleaned + '</body></html>';
        frame.addEventListener('load', () => {
            const inner = frame.contentDocument;
            if (!inner) return;
            const resize = () => {
                frame.style.height = Math.max(24, Math.ceil(inner.body.getBoundingClientRect().height), inner.body.scrollHeight) + 'px';
            };
            resize();
            // 图片加载后随内容调整高度，历史重绘移走 iframe 时由共享观察器回收。
            observeFrame(frame, inner.body, resize);
            let suppressClick = false;
            inner.addEventListener('click', event => {
                event.preventDefault();
                if (suppressClick) { suppressClick = false; return; }
                frame.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            });
            // 聊天长按使用 touchstart/touchend 而非 pointer：坐标换算后保留 preventDefault 回传，
            // 让长按后的抬手不会再合成 click 把菜单关掉；滑动仍由原聊天委托取消计时。
            for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
                inner.addEventListener(type, event => {
                    if (type === 'touchstart') suppressClick = false;
                    const rect = frame.getBoundingClientRect();
                    const touches = list => Array.from(list || [], touch => ({
                        identifier: touch.identifier, target: frame,
                        clientX: rect.left + touch.clientX, clientY: rect.top + touch.clientY,
                        pageX: rect.left + touch.clientX + window.scrollX, pageY: rect.top + touch.clientY + window.scrollY
                    }));
                    const forwarded = new Event(type === 'touchcancel' ? 'touchend' : type, { bubbles: true, cancelable: true });
                    for (const name of ['touches', 'targetTouches', 'changedTouches']) Object.defineProperty(forwarded, name, { value: touches(event[name]) });
                    if (!frame.dispatchEvent(forwarded)) {
                        if (event.cancelable) event.preventDefault();
                        if (type === 'touchend') suppressClick = true;
                    }
                }, { passive: false });
            }
            // iframe 内右键和指针事件也不冒泡，统一转换为父页面坐标。
            for (const type of ['pointerdown', 'pointerup', 'pointermove', 'pointercancel', 'contextmenu']) {
                inner.addEventListener(type, event => {
                    if (type === 'contextmenu') event.preventDefault();
                    const rect = frame.getBoundingClientRect();
                    const values = { bubbles: true, cancelable: true, button: event.button, buttons: event.buttons, clientX: rect.left + event.clientX, clientY: rect.top + event.clientY, pointerId: event.pointerId, pointerType: event.pointerType, isPrimary: event.isPrimary };
                    frame.dispatchEvent(type === 'contextmenu' ? new MouseEvent(type, values) : new PointerEvent(type, values));
                });
            }
        });
        container.appendChild(frame);
        return frame;
    }

    function renderBody(container, source, message, chat, chatType, options = {}) {
        const storedBody = message?.regexKind && !options.ignoreStoredBody ? messageBody(message)?.text : null;
        const original = storedBody ?? String(source ?? '');
        const result = replaceText(original, message?.role === 'assistant' ? getRules(chat, chatType, 'display') : []);
        reportErrors(result.errors);
        const html = options.markdown && typeof marked !== 'undefined' ? marked.parse(result.text, { breaks: true }) : result.text;
        const isRegexHtml = (result.changed || !!message?.regexKind) && /<\/?[a-z][^>]*>/i.test(html);
        if (isRegexHtml) renderHtmlPreview(container, html);
        else if (options.plainText) container.textContent = result.text;
        else container.innerHTML = options.allowStyle
            ? DOMPurify.sanitize(html, { ADD_TAGS: ['style'], ADD_ATTR: ['style'] }) : DOMPurify.sanitize(html);
        return result;
    }

    window.ChatRegex = { compileRule, replaceText, getRules, reportErrors, messageBody, applyStorage, classificationContent, renderHtmlPreview, renderBody };
})();
