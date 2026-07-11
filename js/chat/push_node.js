// --- push_node.js ---
// 「进阶：自定义推送节点」(CF Worker) 前端模块。
// 定位：面向进阶用户的可选功能。配了 Worker 就把提前算好的定时消息移交给它，
//       由 Worker 到点用 Web Push 准点推送，解决安卓杀后台收不到消息的问题。
// 没配置的用户完全不受影响，继续走原来的「音频保活 + 本地投递」老路。
//
// 本模块只负责：保存配置、申请推送订阅、把任务/撤销请求发给 Worker、在 App 内生成 VAPID 密钥。
// 具体「哪条消息该在什么时刻推送」由业务侧(阶段二)算好后调用 PushNode.addTask 移交。

(function () {
    'use strict';

    // ── 配置读写（存在 db.globalPushSettings，带默认值兜底）───────────
    function getSettings() {
        const defaults = {
            enabled: false,        // 推送节点总开关
            workerUrl: '',         // https://xxx.workers.dev
            vapidPublicKey: '',    // 公钥（浏览器订阅要用）
            vapidPrivateKey: '',   // 私钥（仅生成时临时显示给用户复制到 Worker，之后可清空）
            clientToken: '',       // 可选：与 Worker 的 CLIENT_TOKEN 对应
            subscription: null     // pushManager.subscribe() 得到的订阅凭证
        };
        if (!window.db) return defaults;
        if (!db.globalPushSettings || typeof db.globalPushSettings !== 'object') {
            db.globalPushSettings = { ...defaults };
        }
        const s = db.globalPushSettings;
        for (const k in defaults) if (s[k] === undefined) s[k] = defaults[k];
        return s;
    }

    async function persist() {
        try { if (typeof window.saveData === 'function') await window.saveData(); }
        catch (e) { console.warn('[推送节点] 保存设置失败:', e); }
    }

    // ── base64url <-> 字节 工具 ───────────────────────────────────────
    function urlB64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const raw = atob(base64);
        const arr = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
        return arr;
    }
    function bytesToUrlB64(bytes) {
        let s = '';
        for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    // ── 在 App 内生成一对 VAPID 密钥（P-256），格式与 @block65 库、web-push 一致 ──
    async function generateVapidKeys() {
        const kp = await crypto.subtle.generateKey(
            { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']
        );
        const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)); // 65 字节未压缩点
        const jwkPriv = await crypto.subtle.exportKey('jwk', kp.privateKey);
        return {
            publicKey: bytesToUrlB64(rawPub), // base64url(未压缩公钥点)
            privateKey: jwkPriv.d             // base64url(私钥标量)，即 JWK 的 d 字段
        };
    }

    // ── 申请 / 复用 Web Push 订阅 ─────────────────────────────────────
    function getReg() {
        // 优先用启动时存下的 registration（最稳）；根作用域下 ready 也可用作兜底
        return (window.__swRegistration && window.__swRegistration.active) ? window.__swRegistration : null;
    }

    async function subscribe() {
        const s = getSettings();
        if (!s.vapidPublicKey) throw new Error('缺少 VAPID 公钥');
        const reg = getReg();
        if (!reg || !reg.pushManager) throw new Error('Service Worker 未就绪，稍后再试');

        // 已有订阅先复用；若公钥变了则退订重订
        let sub = await reg.pushManager.getSubscription();
        if (sub) {
            const existing = sub.options && sub.options.applicationServerKey;
            // 简单起见：只要已有订阅就复用（换公钥的情况极少，需要时可先在设置里“重新订阅”）
            if (!existing) { try { await sub.unsubscribe(); } catch (_) {} sub = null; }
        }
        if (!sub) {
            sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlB64ToUint8Array(s.vapidPublicKey)
            });
        }
        s.subscription = sub.toJSON(); // { endpoint, expirationTime, keys:{p256dh, auth} }
        await persist();
        return s.subscription;
    }

    async function ensureSubscription() {
        const s = getSettings();
        if (s.subscription && s.subscription.endpoint) return s.subscription;
        return await subscribe();
    }

    // 强制丢弃旧订阅并用当前公钥重新订阅（用于订阅失效 404/410、或换了公钥时自愈）
    async function resubscribe() {
        const reg = getReg();
        if (!reg || !reg.pushManager) throw new Error('Service Worker 未就绪，稍后再试');
        try {
            const old = await reg.pushManager.getSubscription();
            if (old) await old.unsubscribe();
        } catch (_) {}
        getSettings().subscription = null;
        return await subscribe();
    }

    // ── 与 Worker 通信 ────────────────────────────────────────────────
    function apiHeaders() {
        const s = getSettings();
        const h = { 'Content-Type': 'application/json' };
        if (s.clientToken) h['x-client-token'] = s.clientToken;
        return h;
    }
    function apiUrl(path) {
        const s = getSettings();
        return (s.workerUrl || '').replace(/\/+$/, '') + path;
    }

    // 是否已配置好可用（业务侧移交前先判断，没配就走老路）
    function isReady() {
        const s = getSettings();
        return !!(s.enabled && s.workerUrl && s.vapidPublicKey && s.subscription && s.subscription.endpoint);
    }

    // 移交一个定时任务。task = { taskId, deliverAt, payload:{title,body,tag,chatId,chatType,silent,renotify}, groupId? }
    async function addTask(task) {
        if (!isReady()) return false;
        const sub = await ensureSubscription();
        try {
            const res = await fetch(apiUrl('/add-task'), {
                method: 'POST',
                headers: apiHeaders(),
                keepalive: true, // 进入后台 reconcile 时页面可能正被挂起，确保请求发完
                body: JSON.stringify({
                    taskId: task.taskId,
                    deliverAt: task.deliverAt,
                    subscription: sub,
                    payload: task.payload,
                    groupId: task.groupId || null
                })
            });
            return res.ok;
        } catch (e) {
            console.warn('[推送节点] add-task 失败:', e);
            return false;
        }
    }

    // 撤销：按 taskId 数组 和/或 groupId
    async function cancelTasks(taskIds, groupId) {
        const s = getSettings();
        if (!s.workerUrl) return false;
        try {
            const res = await fetch(apiUrl('/cancel'), {
                method: 'POST',
                headers: apiHeaders(),
                keepalive: true,
                body: JSON.stringify({ taskIds: taskIds || [], groupId: groupId || null })
            });
            return res.ok;
        } catch (e) {
            console.warn('[推送节点] cancel 失败:', e);
            return false;
        }
    }

    // 清空本设备所有待发任务（用户回到前台、本地接管投递时调用）
    async function cancelAll() {
        const s = getSettings();
        if (!s.workerUrl || !s.subscription || !s.subscription.endpoint) return false;
        try {
            const res = await fetch(apiUrl('/cancel-all'), {
                method: 'POST',
                headers: apiHeaders(),
                body: JSON.stringify({ endpoint: s.subscription.endpoint })
            });
            return res.ok;
        } catch (e) {
            console.warn('[推送节点] cancel-all 失败:', e);
            return false;
        }
    }

    // ══════════════════════════════════════════════════════════════════
    // 阶段二：真实主动消息的移交(reconcile)与撤销
    //   设计核心见 plans/expressive-noodling-quail.md：
    //   · CF 无状态；所有判定在“进入后台 reconcile”时算好；用户操作时即时撤销。
    //   · 单一真相：summary/idle 预掷后锁定本地(只留赢家、锁100)，保证 CF 通知与本地历史一致。
    //   · 所有逻辑用 isReady() + 通知总开关 守卫；CF 未启用时对现有系统零改动。
    // ══════════════════════════════════════════════════════════════════

    function notifyEnabled() {
        const ns = window.NotifyCenter ? window.NotifyCenter.getSettings() : null;
        return !!(ns && ns.enabled);
    }

    // 会话是否符合移交条件
    function chatEligible(chat) {
        if (!isReady() || !notifyEnabled()) return false;
        if (chat.proactiveMode === 'dnd' || chat.proactiveMode === 'timer') return false;
        return true;
    }

    // 每会话的 CF 任务分两类：
    //   si       —— summary/idle 任务：随上下文，每次 reconcile / 回前台 撤销并重建
    //   peekTasks/peekGroups —— peek 任务：长期(72h)、与上下文无关，跨前后台保留，
    //                            只在用户对该会话发言 / 切离线·dnd / 关总开关 / 到期 时撤销
    function ensureCfTasks(chat) {
        if (!chat._cfTasks || typeof chat._cfTasks !== 'object') chat._cfTasks = { si: [], peekTasks: [], peekGroups: [] };
        if (!Array.isArray(chat._cfTasks.si)) chat._cfTasks.si = [];
        if (!Array.isArray(chat._cfTasks.peekTasks)) chat._cfTasks.peekTasks = [];
        if (!Array.isArray(chat._cfTasks.peekGroups)) chat._cfTasks.peekGroups = [];
        return chat._cfTasks;
    }

    // 清除 peek 池上的 _cfHandedOff 标记（Wave B 用；Wave A 下 peek 池一般没有标记，无副作用）
    function clearPeekHandoff(chat) {
        const q = chat && chat.proactiveMessageQueue;
        if (!Array.isArray(q)) return;
        const peek = q.find(m => m.type === 'time_window_peek');
        if (peek && peek.content) {
            for (const k of Object.keys(peek.content)) {
                if (peek.content[k] && peek.content[k]._cfHandedOff) delete peek.content[k]._cfHandedOff;
            }
        }
    }

    // 把 draft 里的原始主动消息(含 action/text)转成通知能识别的 content 文案，
    // 与 checkAndDeliverProactiveMessages 落地时的 finalContent 保持一致。
    function draftMsgToContent(chat, type, msgInfo) {
        let actionStr = msgInfo.action || '的消息';
        if (['的照片', '发来的照片', '的照片/视频'].includes(actionStr)) actionStr = '发来的照片/视频';
        else if (actionStr === '发来的语音') actionStr = '的语音';
        else if (actionStr === '发来的转账') actionStr = '的转账';
        else if (actionStr === '的礼物') actionStr = '送来的礼物';
        let finalContent = `[${msgInfo.sender}${actionStr}：${msgInfo.text}]`;
        if (type === 'private' && chat.offlineModeEnabled) {
            if (actionStr === '的动作') finalContent = `[system-narration:${msgInfo.text}]`;
            else if (actionStr === '的语言') finalContent = `[${msgInfo.sender}的消息：${msgInfo.text}]`;
            else if (actionStr === '更新状态为') finalContent = `[${msgInfo.sender}更新状态为：${msgInfo.text}]`;
        }
        return finalContent;
    }

    // 预掷 summary/idle 的 draft：按 scheduledAt 升序取“首个抽中”的赢家，
    // 改写 draft(只留赢家、锁 probability=100，其余删掉)。
    // 返回 { deliverAt, payload } 表示需要在未来时刻推送；返回 null 表示无需 CF
    // (无可定点槽 / 睡过头 / 赢家在过去 → 交给本地投递)。
    function preRollDraft(chat, type, draft) {
        if (!draft || !draft.content) return null;
        const now = Date.now();
        const slots = [];
        for (const slotId of Object.keys(draft.content)) {
            const slot = draft.content[slotId];
            if (!slot || !Array.isArray(slot.messages) || !slot.messages.length) continue;
            const times = slot.messages.map(m => m.scheduledAt).filter(t => typeof t === 'number');
            if (!times.length) continue; // 无 scheduledAt 的槽不参与预掷，留给本地兜底
            let prob = slot.probability;
            if (prob === null || prob === undefined || isNaN(prob)) prob = 90;
            slots.push({ slotId, deliverAt: Math.min.apply(null, times), prob, slot });
        }
        if (!slots.length) return null; // 该 draft 没有可定点的槽，完全交给本地

        slots.sort((a, b) => a.deliverAt - b.deliverAt);
        let winner = null;
        for (const s of slots) {
            if (Math.random() * 100 <= s.prob) { winner = s; break; }
        }

        if (winner) {
            // 只留赢家(锁100)，其余所有槽(含无 scheduledAt 的)一律删除 → 本地单一真相
            for (const slotId of Object.keys(draft.content)) {
                if (slotId === winner.slotId) draft.content[slotId].probability = 100;
                else delete draft.content[slotId];
            }
        } else {
            // 睡过头：删掉参与预掷的定时槽（无定时槽保留给本地）
            for (const s of slots) delete draft.content[s.slotId];
            return null;
        }

        if (winner.deliverAt <= now) return null; // 赢家已过点 → 本地迟到补投，无需 CF

        const notifMsgs = winner.slot.messages.map(m => ({ role: 'assistant', content: draftMsgToContent(chat, type, m) }));
        const payload = window.NotifyCenter ? window.NotifyCenter.buildPushPayload(chat, type, notifMsgs) : null;
        if (!payload) return null;
        payload.chatId = chat.id;
        payload.chatType = type;
        return { deliverAt: winner.deliverAt, payload };
    }

    // 只撤 summary/idle 任务（peek 保留）
    async function cancelSiTasks(chat) {
        const t = chat && chat._cfTasks;
        if (!t || !Array.isArray(t.si) || !t.si.length) { if (t) t.si = []; return; }
        const ids = t.si; t.si = [];
        if (getSettings().workerUrl) { try { await cancelTasks(ids, null); } catch (_) {} }
    }

    // 撤 peek 任务，并清掉话题上的 _cfHandedOff 标记（该会话 peek 重新可用）
    async function cancelPeekTasks(chat) {
        clearPeekHandoff(chat);
        const t = chat && chat._cfTasks;
        if (!t) return;
        const ids = Array.isArray(t.peekTasks) ? t.peekTasks : [];
        const gids = Array.isArray(t.peekGroups) ? t.peekGroups : [];
        t.peekTasks = []; t.peekGroups = [];
        if (!getSettings().workerUrl) return;
        try {
            if (ids.length) await cancelTasks(ids, null);
            for (const g of gids) await cancelTasks([], g);
        } catch (_) {}
    }

    // 撤销某会话全部 CF 任务（用户发言 / 切离线 / 切 dnd·timer 时调用，含 peek + 清标记）
    async function cancelChat(chat) {
        if (!chat) return;
        await cancelSiTasks(chat);
        await cancelPeekTasks(chat);
    }

    // 回前台：只撤所有会话的 summary/idle 任务（peek 长期保留，跨前后台不动）
    async function cancelAllSiForeground() {
        const all = [...((window.db && db.characters) || []), ...((window.db && db.groups) || [])];
        for (const c of all) { try { await cancelSiTasks(c); } catch (_) {} }
    }

    // 关通知总开关：彻底清空本设备所有任务(含 peek)与标记
    async function cancelAllDevice() {
        const all = [...((window.db && db.characters) || []), ...((window.db && db.groups) || [])];
        all.forEach(c => { c._cfTasks = { si: [], peekTasks: [], peekGroups: [] }; clearPeekHandoff(c); });
        return await cancelAll();
    }

    // 由钟点(HH:MM)推未来 N 天该时刻的绝对时间戳(升序)，限制在 until 之前
    function futureDailyTimes(timeStr, now, until) {
        const out = [];
        if (!timeStr) return out;
        const parts = String(timeStr).split(':');
        const h = Number(parts[0]), m = Number(parts[1]);
        if (isNaN(h) || isNaN(m)) return out;
        const d = new Date(now);
        d.setHours(h, m, 0, 0);
        if (d.getTime() <= now) d.setDate(d.getDate() + 1); // 今天该点已过 → 从明天起
        for (let i = 0; i < 5; i++) {
            const ts = d.getTime() + i * 86400000;
            if (ts > until) break;
            if (ts > now) out.push(ts);
        }
        return out;
    }

    // 把一个 peek 话题排成未来 N 天的定点推送(同 groupId，首发即撤其余天)。
    // 一次只推一组(该会话已有在飞 peek 则跳过)；离线不推 peek。
    async function schedulePeek(chat, type) {
        if (type === 'private' && chat.offlineModeEnabled) return;
        const q = chat.proactiveMessageQueue;
        if (!Array.isArray(q)) return;
        const peek = q.find(m => m.type === 'time_window_peek');
        if (!peek || !peek.content) return;

        const t = ensureCfTasks(chat);
        if (t.peekTasks.length) return; // 一次只保持一组 peek 在飞

        const entries = Object.keys(peek.content)
            .map(k => ({ k, topic: peek.content[k] }))
            .filter(e => e.topic && !e.topic._cfHandedOff && Array.isArray(e.topic.messages) && e.topic.messages.length);
        if (!entries.length) return;
        entries.sort((a, b) => (b.topic.generatedAt || 0) - (a.topic.generatedAt || 0));
        const pick = entries[0];

        const now = Date.now();
        const until = Math.min(peek.expireAt || (now + 3 * 86400000), now + 3 * 86400000);
        const clock = pick.topic.messages[0] && pick.topic.messages[0].time;
        const times = futureDailyTimes(clock, now, until);
        if (!times.length) return;

        const notifMsgs = pick.topic.messages.map(m => ({ role: 'assistant', content: draftMsgToContent(chat, type, m) }));
        const payload = window.NotifyCenter ? window.NotifyCenter.buildPushPayload(chat, type, notifMsgs) : null;
        if (!payload) return;
        payload.chatId = chat.id;
        payload.chatType = type;

        const groupId = 'peekg_' + chat.id + '_' + now + '_' + Math.random().toString(36).slice(2, 6);
        let added = false;
        for (const ts of times) {
            const taskId = 'cfpeek_' + chat.id + '_' + ts + '_' + Math.random().toString(36).slice(2, 5);
            const ok = await addTask({ taskId, deliverAt: ts, payload, groupId });
            if (ok) { t.peekTasks.push(taskId); added = true; }
        }
        if (added) {
            if (t.peekGroups.indexOf(groupId) === -1) t.peekGroups.push(groupId);
            pick.topic._cfHandedOff = true;
        }
    }

    // reconcile 单个会话：撤旧 summary/idle 任务→预掷移交；无 summary/idle 占位时再排 peek
    async function reconcileChat(chat, type) {
        await cancelSiTasks(chat); // 只撤 si，peek 保留
        if (!chatEligible(chat)) return;
        const q = chat.proactiveMessageQueue;
        if (!Array.isArray(q) || !q.length) return;

        const draft = q.find(m => m.type === 'time_window_summary') || q.find(m => m.type === 'time_window_idle');
        let siActive = false;
        if (draft) {
            const decision = preRollDraft(chat, type, draft);
            if (decision) {
                const taskId = 'cf_' + chat.id + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
                const ok = await addTask({ taskId, deliverAt: decision.deliverAt, payload: decision.payload });
                if (ok) ensureCfTasks(chat).si.push(taskId);
            }
            // draft 预掷后仍有内容(赢家或残留) → 视为 summary/idle 占位，peek 让位(复刻本地优先级)
            siActive = !!(draft.content && Object.keys(draft.content).length > 0);
            if (typeof saveSingleChat === 'function') { try { await saveSingleChat(chat.id, type); } catch (_) {} }
        }

        // peek：仅在没有 summary/idle 占位时移交(与本地"peek 只在无 summary/idle 时轮到"一致)
        if (!siActive) {
            await schedulePeek(chat, type);
            if (typeof saveSingleChat === 'function') { try { await saveSingleChat(chat.id, type); } catch (_) {} }
        }
    }

    // 生成完主动消息后【立即】移交单个会话（主路径：前台、网络稳、时间充裕）。
    // 由 summary / peek / idle 的生成完成点调用。切后台的 reconcile 仅作兜底。
    async function handoffChat(chatId) {
        if (!isReady() || !notifyEnabled()) return;
        if (!window.db) return;
        let chat = (db.characters || []).find(c => c.id === chatId);
        let type = 'private';
        if (!chat) { chat = (db.groups || []).find(g => g.id === chatId); type = 'group'; }
        if (!chat) return;
        try { await reconcileChat(chat, type); }
        catch (e) { console.warn('[推送节点] handoffChat 失败:', chatId, e); }
    }

    // reconcile 全部会话（进入后台时触发，作为生成后立即移交的兜底）
    let _reconciling = false;
    async function reconcile() {
        if (!isReady() || !notifyEnabled()) return;
        if (_reconciling) return; // 防重入
        _reconciling = true;
        try {
            const list = [
                ...(((window.db && db.characters) || []).map(c => ({ chat: c, type: 'private' }))),
                ...(((window.db && db.groups) || []).map(g => ({ chat: g, type: 'group' })))
            ];
            for (const { chat, type } of list) {
                try { await reconcileChat(chat, type); }
                catch (e) { console.warn('[推送节点] reconcile 会话失败:', chat && chat.id, e); }
            }
        } finally {
            _reconciling = false;
        }
    }

    // ── 诊断：强制跑一次移交，并报告“为什么没移交/移交了什么” ────────────
    // 逐会话检查各道门槛，把结论汇总弹出，无需等进后台、无需看 CF。
    async function diagnoseHandoff() {
        const lines = [];
        const s = getSettings();
        lines.push('推送节点开关: ' + (s.enabled ? '开' : '关'));
        lines.push('Worker地址: ' + (s.workerUrl ? '有' : '缺'));
        lines.push('公钥: ' + (s.vapidPublicKey ? '有' : '缺'));
        lines.push('订阅: ' + (s.subscription && s.subscription.endpoint ? '有' : '缺'));
        lines.push('isReady(): ' + (isReady() ? '✅' : '❌'));
        lines.push('通知主开关(必须开): ' + (notifyEnabled() ? '✅ 开' : '❌ 关 ← 真实消息不移交就因为这个'));

        if (!isReady()) { await uiAlert('无法移交：\n' + lines.join('\n')); return; }
        if (!notifyEnabled()) { await uiAlert('无法移交：\n' + lines.join('\n') + '\n\n请到本页最上方打开「允许系统通知」。'); return; }

        const all = [
            ...(((window.db && db.characters) || []).map(c => ({ chat: c, type: 'private' }))),
            ...(((window.db && db.groups) || []).map(g => ({ chat: g, type: 'group' })))
        ];
        let eligible = 0, withDraft = 0, withPeek = 0, handed = 0;
        for (const { chat } of all) {
            if (!chatEligible(chat)) continue;
            eligible++;
            const q = chat.proactiveMessageQueue || [];
            if (q.find(m => m.type === 'time_window_summary' || m.type === 'time_window_idle')) withDraft++;
            if (q.find(m => m.type === 'time_window_peek')) withPeek++;
        }

        // 真正跑一次移交
        await reconcile();

        for (const { chat } of all) {
            const t = chat._cfTasks;
            if (t && ((t.si && t.si.length) || (t.peekTasks && t.peekTasks.length))) handed++;
        }
        lines.push('');
        lines.push('符合条件会话: ' + eligible);
        lines.push('含summary/idle: ' + withDraft + '，含peek池: ' + withPeek);
        lines.push('本次移交出任务的会话: ' + handed);
        lines.push('');
        lines.push('移交完成。可打开 Worker 的 /list 查看具体任务。');
        await uiAlert(lines.join('\n'));
    }

    // ── 测试：立即推送一条，并把 Worker/FCM 的结果直接显示出来 ──────────
    // 走 /add-task?now=1：Worker 当场发送并把 FCM 状态码原样返回，无需等 cron、无需 wrangler tail。
    //   201 = 成功；403 = VAPID 密钥不匹配；404/410 = 订阅失效；0 = 发送异常。
    async function sendTestTask() {
        if (!isReady()) { uiToast('请先填好 Worker 地址和公钥并打开开关'); return; }
        let sub;
        try { sub = await ensureSubscription(); }
        catch (e) { await uiAlert('订阅失败：' + (e && e.message ? e.message : e)); return; }

        try {
            const res = await fetch(apiUrl('/add-task?now=1'), {
                method: 'POST',
                headers: apiHeaders(),
                body: JSON.stringify({
                    taskId: 'test_' + Date.now(),
                    subscription: sub,
                    payload: { title: 'QChat 测试推送', body: '看到这条，说明推送节点打通了 🎉', tag: 'push-test', chatId: null }
                })
            });
            let info;
            try { info = await res.json(); } catch { info = {}; }
            const st = info.status;
            if (info.ok) {
                uiToast('推送已发出（状态 ' + st + '）。切后台看是否弹出。');
            } else if (st === 403) {
                await uiAlert('❌ 状态 403：VAPID 密钥不匹配。请确认 App 公钥、Worker 公钥、私钥是同一对，改完关开关重开以重新订阅。');
            } else if (st === 404 || st === 410) {
                // 订阅失效：自动退订+重订+重发一次，用户无感
                uiToast('订阅已失效，正在自动重新订阅…');
                try {
                    const fresh = await resubscribe();
                    const res2 = await fetch(apiUrl('/add-task?now=1'), {
                        method: 'POST', headers: apiHeaders(),
                        body: JSON.stringify({
                            taskId: 'test_' + Date.now(),
                            subscription: fresh,
                            payload: { title: 'QChat 测试推送', body: '看到这条，说明推送节点打通了 🎉', tag: 'push-test', chatId: null }
                        })
                    });
                    let info2 = {}; try { info2 = await res2.json(); } catch {}
                    uiToast(info2.ok ? '已重新订阅并推送（状态 ' + info2.status + '）。切后台查看。'
                                     : '重新订阅后仍失败（状态 ' + info2.status + '）。');
                } catch (e2) {
                    await uiAlert('自动重新订阅失败：' + (e2 && e2.message ? e2.message : e2));
                }
            } else if (info.error === 'vapid_not_set') {
                await uiAlert('❌ Worker 未设置 VAPID 密钥。请 wrangler secret put 三个 VAPID_* 后重新部署。');
            } else {
                await uiAlert('❌ 发送失败：状态 ' + (st === undefined ? '未知' : st) + (info.error ? '，' + info.error : '') + '。');
            }
        } catch (e) {
            await uiAlert('请求 Worker 失败：' + (e && e.message ? e.message : e) + '\n检查 Worker 地址是否正确、令牌是否匹配。');
        }
    }

    // ── 设置页 UI ─────────────────────────────────────────────────────
    function uiToast(msg) { if (window.showToast) window.showToast(msg); else console.log('[推送节点]', msg); }
    function uiAlert(msg) { if (typeof AppUI !== 'undefined' && AppUI.alert) return AppUI.alert(msg); return Promise.resolve(); }

    function setHint(text) {
        const el = document.getElementById('push-node-hint');
        if (el) el.textContent = text;
    }

    async function onToggleChange(e) {
        const toggle = e.target;
        const s = getSettings();
        if (toggle.checked) {
            if (!s.workerUrl || !s.vapidPublicKey) {
                toggle.checked = false;
                await uiAlert('请先填写 Worker 地址和 VAPID 公钥。');
                return;
            }
            // 推送订阅需要通知权限（复用通知中枢的申请逻辑）
            if (window.NotifyCenter) {
                const perm = await window.NotifyCenter.requestPermission();
                if (perm !== 'granted') {
                    toggle.checked = false;
                    await uiAlert('推送需要通知权限，请先允许系统通知。');
                    return;
                }
            }
            try {
                await subscribe();
                s.enabled = true;
                setHint('已开启。推送订阅成功，可点下方按钮测试。');
            } catch (err) {
                toggle.checked = false;
                s.enabled = false;
                await uiAlert('订阅推送失败：' + (err && err.message ? err.message : err));
            }
            await persist();
        } else {
            s.enabled = false;
            setHint('已关闭。将回退到本地音频保活投递。');
            await persist();
        }
    }

    async function onGenVapid() {
        try {
            const keys = await generateVapidKeys();
            const s = getSettings();
            s.vapidPublicKey = keys.publicKey;
            s.vapidPrivateKey = keys.privateKey; // 仅供本次复制到 Worker
            await persist();

            const pubInput = document.getElementById('push-vapid-public');
            if (pubInput) pubInput.value = keys.publicKey;
            const privBox = document.getElementById('push-vapid-private-display');
            if (privBox) {
                privBox.value = keys.privateKey;
                privBox.parentElement.style.display = 'block';
            }
            await uiAlert('已生成密钥。公钥已自动填好；请把「私钥」复制到 Worker（wrangler secret put VAPID_PRIVATE_KEY），公钥同样也要 put 一份。');
        } catch (e) {
            await uiAlert('生成失败：' + (e && e.message ? e.message : e));
        }
    }

    function initSettingsUI() {
        const s = getSettings();

        const urlInput = document.getElementById('push-worker-url');
        if (urlInput) {
            urlInput.value = s.workerUrl || '';
            urlInput.onchange = async (e) => { getSettings().workerUrl = e.target.value.trim(); await persist(); };
        }
        const pubInput = document.getElementById('push-vapid-public');
        if (pubInput) {
            pubInput.value = s.vapidPublicKey || '';
            pubInput.onchange = async (e) => { getSettings().vapidPublicKey = e.target.value.trim(); await persist(); };
        }
        const tokenInput = document.getElementById('push-client-token');
        if (tokenInput) {
            tokenInput.value = s.clientToken || '';
            tokenInput.onchange = async (e) => { getSettings().clientToken = e.target.value.trim(); await persist(); };
        }
        const privBox = document.getElementById('push-vapid-private-display');
        if (privBox && privBox.parentElement) {
            // 默认隐藏私钥区，生成时才显示
            privBox.value = '';
            privBox.parentElement.style.display = 'none';
        }
        const genBtn = document.getElementById('push-gen-vapid');
        if (genBtn) genBtn.onclick = onGenVapid;

        const toggle = document.getElementById('push-node-toggle');
        if (toggle) {
            toggle.checked = !!s.enabled;
            toggle.onchange = onToggleChange;
        }
        const testBtn = document.getElementById('push-test-task-btn');
        if (testBtn) testBtn.onclick = sendTestTask;
        const diagBtn = document.getElementById('push-diagnose-btn');
        if (diagBtn) diagBtn.onclick = diagnoseHandoff;

        if (!s.workerUrl) setHint('可选功能：部署一个专属 Cloudflare Worker，即可在被杀后台时也准点收到消息。');
        else if (s.enabled) setHint('已开启。');
        else setHint('已填写配置，打开开关即可启用。');
    }

    window.PushNode = {
        getSettings,
        isReady,
        generateVapidKeys,
        subscribe,
        resubscribe,
        addTask,
        cancelTasks,
        cancelAll,
        sendTestTask,
        initSettingsUI,
        // 阶段二：移交与撤销
        reconcile,
        reconcileChat,
        handoffChat,
        cancelChat,
        cancelAllSiForeground,
        cancelAllDevice,
        diagnoseHandoff
    };
})();
