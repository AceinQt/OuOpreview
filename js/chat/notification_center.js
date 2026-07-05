// --- notification_center.js ---
// 系统消息通知中枢（Step 1：总开关 + 权限 + 全局保活时长 + 测试通知）
// 说明：本应用无推送服务器，通知只能在 JS 存活时弹出（前台，或后台保活窗口内）。
//       因此通知与 chat_feature_proactive.js 的"静音音频保活"是配套的。

(function () {
    'use strict';

    const APP_ICON = './icon/icon_cat.png';
    const KEEPALIVE_MIN = 1;
    const KEEPALIVE_MAX = 1440;

    // 读取全局通知设置（带默认值兜底，兼容旧库）
    function getSettings() {
        if (!window.db) return { enabled: false, keepAliveMinutes: 30 };
        if (!db.globalNotifySettings || typeof db.globalNotifySettings !== 'object') {
            db.globalNotifySettings = { enabled: false, keepAliveMinutes: 30 };
        }
        return db.globalNotifySettings;
    }

    function isSupported() {
        return typeof window !== 'undefined'
            && 'Notification' in window
            && 'serviceWorker' in navigator;
    }

    function permissionState() {
        if (!('Notification' in window)) return 'unsupported';
        return Notification.permission; // 'default' | 'granted' | 'denied'
    }

    // 核心：弹一条系统通知（经 Service Worker，移动端唯一可靠路径）
    // opts: { tag, renotify, data, silent, force }
    //   force=true 时忽略"仅后台"限制（测试按钮用）
    async function fire(title, body, opts = {}) {
        const s = getSettings();
        if (!opts.force) {
            if (!s.enabled) return false;
            // 仅在后台时弹，避免前台看着页面还弹通知
            if (document.visibilityState !== 'hidden') return false;
        }
        if (!isSupported() || Notification.permission !== 'granted') return false;

        try {
            const reg = await navigator.serviceWorker.ready;
            await reg.showNotification(title || '新消息', {
                body: body || '',
                icon: APP_ICON,
                badge: APP_ICON,
                tag: opts.tag || undefined,
                renotify: opts.renotify || false,
                silent: opts.silent || false,
                data: opts.data || {}
            });
            return true;
        } catch (e) {
            console.warn('[通知] 弹出失败:', e);
            return false;
        }
    }

    // 请求通知权限（必须在用户手势内调用，例如点击开关）
    async function requestPermission() {
        if (!('Notification' in window)) return 'unsupported';
        if (Notification.permission === 'granted') return 'granted';
        if (Notification.permission === 'denied') return 'denied';
        try {
            const result = await Notification.requestPermission();
            return result;
        } catch (e) {
            console.warn('[通知] 权限请求异常:', e);
            return 'denied';
        }
    }

    // ── 设置页 UI ──────────────────────────────────────────────

    function updateHint() {
        const hint = document.getElementById('notify-permission-hint');
        if (!hint) return;
        if (!isSupported()) {
            hint.textContent = '当前环境不支持系统通知（需在支持的浏览器 / 已添加到主屏幕的 PWA 中使用）。';
            return;
        }
        const p = permissionState();
        if (p === 'denied') {
            hint.textContent = '通知权限已被拒绝。请到系统 / 浏览器设置里手动允许本应用的通知后再试。';
        } else if (p === 'granted') {
            hint.textContent = '通知已授权。切到后台时若有新消息会弹出系统通知。iOS 需先"添加到主屏幕"。';
        } else {
            hint.textContent = '开启后，切到后台时若有新消息会弹出系统通知。iOS 需先"添加到主屏幕"。';
        }
    }

    async function onToggleChange(e) {
        const toggle = e.target;
        const s = getSettings();

        if (toggle.checked) {
            if (!isSupported()) {
                toggle.checked = false;
                updateHint();
                await uiAlert('当前环境不支持系统通知。');
                return;
            }
            // ★ 必须在 await 权限弹窗之前预热保活音频——此刻用户手势激活还在，
            //   等权限弹窗结束后激活会被消耗，audio.play() 就会被拦截。
            if (typeof window.ensureBgAudioUnlocked === 'function') {
                window.ensureBgAudioUnlocked();
            }
            const result = await requestPermission();
            if (result !== 'granted') {
                toggle.checked = false;
                s.enabled = false;
                updateHint();
                await uiAlert(result === 'denied'
                    ? '通知权限被拒绝，请到系统设置里手动开启后再试。'
                    : '未获得通知权限。');
                await persist();
                return;
            }
            s.enabled = true;
            updateHint();
            await persist();
        } else {
            s.enabled = false;
            updateHint();
            try { if (navigator.clearAppBadge) await navigator.clearAppBadge(); } catch (_) {}
            await persist();
        }
    }

    async function onKeepAliveChange(e) {
        const s = getSettings();
        let v = parseInt(e.target.value, 10);
        if (isNaN(v)) v = 30;
        v = Math.max(KEEPALIVE_MIN, Math.min(KEEPALIVE_MAX, v));
        e.target.value = v;
        s.keepAliveMinutes = v;
        await persist();
    }

    async function onTestClick() {
        if (!isSupported()) {
            await uiAlert('当前环境不支持系统通知。');
            return;
        }
        if (Notification.permission !== 'granted') {
            const r = await requestPermission();
            updateHint();
            if (r !== 'granted') {
                await uiAlert('请先在上方打开"允许系统通知"。');
                return;
            }
        }
        const ok = await fire('测试通知', '如果你看到这条通知，说明通知功能正常 🎉', {
            tag: 'notify-test',
            renotify: true,
            force: true
        });
        uiToast(ok ? '测试通知已发送' : '通知发送失败，请检查权限。');
    }

    async function persist() {
        try {
            if (typeof window.saveData === 'function') await window.saveData();
        } catch (e) {
            console.warn('[通知] 保存设置失败:', e);
        }
    }

    // UI 提示小工具（AppUI 是裸全局 const，不挂在 window 上）
    function uiAlert(msg) {
        if (typeof AppUI !== 'undefined' && AppUI.alert) return AppUI.alert(msg);
        return Promise.resolve();
    }
    function uiToast(msg) {
        if (window.showToast) window.showToast(msg);
    }

    // 打开"消息通知"页时初始化控件（由 main.js pageActions 调用）
    function initSettingsUI() {
        const s = getSettings();

        const toggle = document.getElementById('system-notification-toggle');
        if (toggle) {
            // 复选框反映"已开启且已授权"
            toggle.checked = !!(s.enabled && permissionState() === 'granted');
            // 若之前开着但权限被系统撤销，纠正状态
            if (s.enabled && permissionState() !== 'granted') {
                s.enabled = false;
                persist();
            }
            toggle.onchange = onToggleChange;
        }

        const keepInput = document.getElementById('notify-keepalive-input');
        if (keepInput) {
            keepInput.value = s.keepAliveMinutes || 30;
            keepInput.onchange = onKeepAliveChange;
        }

        const testBtn = document.getElementById('notify-test-btn');
        if (testBtn) testBtn.onclick = onTestClick;

        updateHint();
    }

    window.NotifyCenter = {
        getSettings,
        isSupported,
        permissionState,
        fire,
        requestPermission,
        initSettingsUI
    };
})();
