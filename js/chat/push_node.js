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
                await uiAlert('❌ 状态 ' + st + '：推送订阅已失效。请关掉推送开关、刷新页面、再打开，以重新订阅。');
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
        addTask,
        cancelTasks,
        cancelAll,
        sendTestTask,
        initSettingsUI
    };
})();
