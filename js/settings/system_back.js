// --- js/settings/system_back.js ---
// 系统返回键接管：利用 History API 压入哨兵记录，
// 安卓返回键触发 popstate 时按 弹窗 → 侧边栏 → 页面 的顺序逐层返回，
// 主屏上两秒内连按两次才真正退出应用。

(function () {
    let armed = false;          // 哨兵记录是否已压入历史栈
    let ignoreNextPop = false;  // 主动撤销哨兵时跳过一次 popstate 处理
    let lastExitAttempt = 0;

    function arm() {
        if (armed) return;
        history.pushState({ sysBack: true }, '');
        armed = true;
    }

    function disarm() {
        if (!armed) return;
        armed = false;
        ignoreNextPop = true;
        history.back();
    }

    // 关闭最上层的弹窗 / 动作面板 / 侧边栏，成功关闭返回 true
    function closeTopOverlay() {
        const sidebar = document.querySelector('.settings-sidebar.open');
        if (sidebar) {
            sidebar.classList.remove('open');
            return true;
        }
        const overlays = document.querySelectorAll('.modal-overlay.visible, .action-sheet-overlay.visible');
        if (overlays.length > 0) {
            overlays[overlays.length - 1].classList.remove('visible');
            return true;
        }
        return false;
    }

    // 执行一次"返回"，处理了任何东西就返回 true；主屏且无弹窗返回 false
    function handleBack() {
        if (closeTopOverlay()) return true;

        const activeScreen = document.querySelector('.screen.active');
        if (activeScreen && activeScreen.id !== 'home-screen') {
            const backBtn = activeScreen.querySelector('.back-btn');
            if (backBtn) {
                // 走 .back-btn 的点击逻辑，Peek 多选模式等拦截依然生效
                backBtn.click();
                return true;
            }
            // 没有返回按钮的页面（如带底部导航的论坛页）回主屏
            if (typeof navigateTo === 'function') {
                navigateTo('home-screen');
                return true;
            }
        }
        return false;
    }

    window.addEventListener('popstate', () => {
        if (ignoreNextPop) { ignoreNextPop = false; return; }
        if (!armed) return;
        armed = false;

        if (!(window.db && window.db.enableSystemBack === true)) return;

        if (handleBack()) {
            arm(); // 重新压入哨兵，继续拦截下一次返回键
            return;
        }

        // 已在主屏且无弹窗：两秒内再按一次才真正退出
        const now = Date.now();
        if (now - lastExitAttempt < 2000) {
            history.back();
            return;
        }
        lastExitAttempt = now;
        if (window.showToast) showToast('再按一次返回键退出');
        arm();
    });

    // ── 开关 UI ──────────────────────────────────────────────
    window.setupSystemBackToggle = function () {
        const toggle = document.getElementById('system-back-toggle');
        if (toggle) {
            toggle.checked = !!(window.db && window.db.enableSystemBack === true);
            toggle.addEventListener('change', function () {
                if (window.db) window.db.enableSystemBack = this.checked;
                saveGlobalKeys(['enableSystemBack']);
                if (this.checked) arm(); else disarm();
            });
        }
        if (window.db && window.db.enableSystemBack === true) arm();
    };
})();
