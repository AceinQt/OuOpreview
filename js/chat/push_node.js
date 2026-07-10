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

    function ensureCfTasks(chat) {
        if (!chat._cfTasks || typeof chat._cfTasks !== 'object') chat._cfTasks = { taskIds: [], groupIds: [] };
        if (!Array.isArray(chat._cfTasks.taskIds)) chat._cfTasks.taskIds = [];
        if (!Array.isArray(chat._cfTasks.groupIds)) chat._cfTasks.groupIds = [];
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

    // 撤销某会话在 CF 上的所有待发任务（用户操作即时调用）
    async function cancelChat(chat) {
        if (!chat) return;
        clearPeekHandoff(chat);
        const t = chat._cfTasks;
        chat._cfTasks = { taskIds: [], groupIds: [] };
        if (!t) return;
        const hasAny = (t.taskIds && t.taskIds.length) || (t.groupIds && t.groupIds.length);
        if (!hasAny || !getSettings().workerUrl) return;
        try {
            if (t.taskIds && t.taskIds.length) await cancelTasks(t.taskIds, null);
            for (const gid of (t.groupIds || [])) await cancelTasks([], gid);
        } catch (_) {}
    }

    // 清空本设备所有会话的 CF 任务（关通知总开关时用）
    async function cancelAllDevice() {
        const all = [...((window.db && db.characters) || []), ...((window.db && db.groups) || [])];
        all.forEach(c => { c._cfTasks = { taskIds: [], groupIds: [] }; clearPeekHandoff(c); });
        return await cancelAll();
    }

    // reconcile 单个会话：先撤旧任务，再(若符合条件)预掷 summary/idle 并移交
    async function reconcileChat(chat, type) {
        await cancelChat(chat);
        if (!chatEligible(chat)) return;
        const q = chat.proactiveMessageQueue;
        if (!Array.isArray(q) || !q.length) return;

        const draft = q.find(m => m.type === 'time_window_summary') || q.find(m => m.type === 'time_window_idle');
        if (!draft) return; // Wave B 会在此后追加 peek 处理

        const decision = preRollDraft(chat, type, draft);
        if (decision) {
            const taskId = 'cf_' + chat.id + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
            const ok = await addTask({ taskId, deliverAt: decision.deliverAt, payload: decision.payload });
            if (ok) ensureCfTasks(chat).taskIds.push(taskId);
        }
        // draft 已被预掷改写，落库保证本地投递与 CF 一致
        if (typeof saveSingleChat === 'function') { try { await saveSingleChat(chat.id, type); } catch (_) {} }
    }

    // reconcile 全部会话（进入后台时触发）
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
        cancelChat,
        cancelAllDevice
    };
})();
