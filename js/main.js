// --- js/main.js ---

// 1. 全局 DOM 缓存
const screens = document.querySelectorAll('.screen'),
    settingsScreen = document.getElementById('settings-screen'),
    toastElement = document.getElementById('toast-notification'),
    darkModeToggle = document.getElementById('dark-mode-toggle'),
    customizeForm = document.getElementById('customize-form');

// 2. 辅助函数：补零 (用于时钟)
const pad = (num) => num.toString().padStart(2, '0');

// 3. 全局时钟函数
function updateClock() {
    const now = new Date();
    const timeString = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const dateString = `${pad(now.getMonth() + 1)}月${pad(now.getDate())}日 ✧ 星期${['日', '一', '二', '三', '四', '五', '六'][now.getDay()]}`;

    const homeTime = document.getElementById('time-display');
    const homeDate = document.getElementById('date-display');
    if (homeTime) homeTime.textContent = timeString;
    if (homeDate) homeDate.textContent = dateString;

    const peekTime = document.getElementById('peek-time-display');
    const peekDate = document.getElementById('peek-date-display');
    if (peekTime) peekTime.textContent = timeString;
    if (peekDate) peekDate.textContent = dateString;
}

// 4. 路由表 (Router)
const pageActions = {
    'world-book-screen': typeof renderWorldBookList !== 'undefined' ? renderWorldBookList : null,
    'customize-screen': typeof renderCustomizeForm !== 'undefined' ? renderCustomizeForm : null,
    'tutorial-screen': typeof renderTutorialContent !== 'undefined' ? renderTutorialContent : null,
    'storage-analysis-screen': window.refreshStorageScreen
};

// 5. 统一跳转函数
function navigateTo(targetId) {
    if (!targetId) return;

    // 开发中的页面提示
    if (['screen', 'diary-screen', 'piggy-bank-screen'].includes(targetId)) {
        showToast('该应用正在开发中，敬请期待！');
        return;
    }

    // 调用 utils.js 里的切换函数
    if (typeof switchScreen === 'function') {
        switchScreen(targetId);
    }

    // 如果路由表里有动作，则执行
    if (pageActions[targetId]) {
        pageActions[targetId]();
    }
}

// 6. 程序入口 init
window.init = async () => {
    console.log("正在初始化...");

    try {
        // 加载数据库
        if (typeof loadData === 'function') {
            await loadData();
        } else {
            console.error("Critical: loadData function not found!");
        }

        // 设置状态栏颜色
        if (typeof setAndroidThemeColor === 'function') {
            setAndroidThemeColor(db.homeStatusBarColor || '#FFFFFF');
        }

        // 确保默认配置存在 (依赖 globals.js 中的 defaultWidgetSettings)
        if ((!db.homeWidgetSettings || !db.homeWidgetSettings.topLeft) && typeof defaultWidgetSettings !== 'undefined') {
            db.homeWidgetSettings = JSON.parse(JSON.stringify(defaultWidgetSettings));
        }

        // --- 核心：全局点击事件代理 ---
        document.body.addEventListener('click', (e) => {
            // A. 处理右键菜单的关闭
            if (e.target.closest('.context-menu')) {
                e.stopPropagation();
                return;
            }
            if (typeof removeContextMenu === 'function') removeContextMenu();

            // B. 处理导航点击
            const navTarget = e.target.closest('[data-target]');
            if (navTarget) {
                e.preventDefault();
                const targetId = navTarget.getAttribute('data-target');
                navigateTo(targetId);
            }

            // C. 关闭弹窗逻辑
            const openOverlay = document.querySelector('.modal-overlay.visible, .action-sheet-overlay.visible');
            if (openOverlay && e.target === openOverlay) {
                openOverlay.classList.remove('visible');
            }
        });

        // 绑定夜间模式开关
        if (darkModeToggle) {
            darkModeToggle.addEventListener('change', function () {
                if (typeof applyHomeScreenMode === 'function') {
                    applyHomeScreenMode(this.checked ? 'day' : 'night');
                }
            });
        }

        // 启动定时器
        updateClock();
        setInterval(updateClock, 30000);

        // 应用全局设置
        if (typeof applyGlobalFont === 'function') applyGlobalFont(db.fontUrl);
        if (typeof applyGlobalCss === 'function') applyGlobalCss(db.globalCss);
        if (typeof applyPomodoroBackgrounds === 'function') applyPomodoroBackgrounds();

        // 初始化各个模块
        if (typeof setupHomeScreen === 'function') setupHomeScreen();
        if (typeof setupChatListScreen === 'function') setupChatListScreen();
        if (typeof setupAddCharModal === 'function') setupAddCharModal();
        if (typeof setupChatRoom === 'function') setupChatRoom();
        if (typeof setupChatSettings === 'function') setupChatSettings();
        if (typeof setupApiSettingsApp === 'function') setupApiSettingsApp();
        if (typeof setupWallpaperApp === 'function') setupWallpaperApp();
        if (typeof setupStickerSystem === 'function') await setupStickerSystem();
        if (typeof setupCustomizeApp === 'function') setupCustomizeApp();
        if (typeof setupTutorialApp === 'function') setupTutorialApp();

        // 预设相关
        if (typeof window.setupApiPresets === 'function') setupApiPresets();
        if (typeof window.setupBubblePresets === 'function') setupBubblePresets();
        if (typeof window.setupPersonaPresets === 'function') setupPersonaPresets();

        // 其他功能
        if (typeof setupGlobalCssPresetsListeners === 'function') setupGlobalCssPresetsListeners();
        if (typeof setupVoiceMessageSystem === 'function') setupVoiceMessageSystem();
        if (typeof setupPhotoVideoSystem === 'function') setupPhotoVideoSystem();
        if (typeof setupImageRecognition === 'function') setupImageRecognition();
        if (typeof setupWalletSystem === 'function') setupWalletSystem();
        if (typeof setupGiftSystem === 'function') setupGiftSystem();
        if (typeof setupTimeSkipSystem === 'function') setupTimeSkipSystem();
        if (typeof setupWorldBookApp === 'function') setupWorldBookApp();
        if (typeof setupFontSettingsApp === 'function') setupFontSettingsApp();
        if (typeof setupGroupChatSystem === 'function') setupGroupChatSystem();

        // 独立功能页
        if (typeof checkForUpdates === 'function') checkForUpdates();
        if (typeof setupPeekFeature === 'function') setupPeekFeature();
        if (typeof setupOfflineModeLogic === 'function') setupOfflineModeLogic();
        if (typeof setupChatExpansionPanel === 'function') setupChatExpansionPanel();
        if (typeof setupMemoryJournalScreen === 'function') setupMemoryJournalScreen();
        if (typeof setupDeleteHistoryChunk === 'function') setupDeleteHistoryChunk();
        if (typeof setupForumBindingFeature === 'function') setupForumBindingFeature();
        if (typeof setupForumFeature === 'function') setupForumFeature();
        if (typeof setupShareModal === 'function') setupShareModal();
        if (typeof setupStorageAnalysisScreen === 'function') setupStorageAnalysisScreen();
        if (typeof setupPomodoroApp === 'function') setupPomodoroApp();
        if (typeof setupPomodoroSettings === 'function') setupPomodoroSettings();
        if (typeof setupPomodoroGlobalSettings === 'function') setupPomodoroGlobalSettings();
        if (typeof setupInsWidgetAvatarModal === 'function') setupInsWidgetAvatarModal();
        if (typeof setupRpgGame === 'function') setupRpgGame();

        // 绑定特殊按钮
        const delWbBtn = document.getElementById('delete-selected-world-books-btn');
        if (delWbBtn) delWbBtn.addEventListener('click', deleteSelectedWorldBooks);

        const cancelWbBtn = document.getElementById('cancel-wb-multi-select-btn');
        if (cancelWbBtn) cancelWbBtn.addEventListener('click', exitWorldBookMultiSelectMode);

        // 申请持久化存储权限 (防止手机空间不足时删数据)
        if (navigator.storage && navigator.storage.persist) {
            navigator.storage.persist().then(granted => {
                if (granted) {
                    console.log("✅ 已获得持久化存储权限");
                }
            });
        }

        console.log("✅ 初始化流程执行完毕");

    } catch (err) {
        console.error("❌ 初始化过程发生致命错误:", err);
        if (typeof showToast === 'function') showToast("初始化失败，请查看控制台");
    }
};

// --- 7. 每日自动备份逻辑 ---
async function runDailyBackupCheck() {
    if (typeof GitHubService === 'undefined' || typeof createFullBackupData === 'undefined') return;

    const config = GitHubService.getConfig();
    if (!config || !config.autoBackup) return;

    const LAST_BACKUP_KEY = 'qchat_last_auto_backup_date';
    const lastDate = localStorage.getItem(LAST_BACKUP_KEY);
    const today = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');

    if (lastDate === today) {
        console.log("今日已自动备份过，跳过。");
        return;
    }

    console.log("检测到今日首次启动，准备自动备份...");
    setTimeout(async () => {
        try {
            const data = await createFullBackupData();
            await GitHubService.upload(data);
            localStorage.setItem(LAST_BACKUP_KEY, today);
            if (typeof showToast === 'function') showToast("每日自动备份完成");
            console.log("每日自动备份成功");
        } catch (e) {
            console.error("自动备份失败:", e);
        }
    }, 5000);
}


// ==========================================
// --- 8. 启动与生命周期管理 ---
// ==========================================

// A. Service Worker 注册
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        // 注意：sw.js 路径相对于 index.html
        navigator.serviceWorker.register('./js/sw.js')
            .then(reg => console.log('SW 注册成功:', reg.scope))
            .catch(err => console.log('SW 注册失败:', err));
        
        // 顺便在这里启动备份检查，避免和主线程争抢资源
        setTimeout(runDailyBackupCheck, 2000);
    });
} else {
    // 如果不支持 SW，也在 load 时检查备份
    window.addEventListener('load', () => setTimeout(runDailyBackupCheck, 2000));
}

// B. DOM 准备就绪后启动 init
document.addEventListener('DOMContentLoaded', () => {
    console.log("应用启动...");
    if (typeof window.init === 'function') {
        window.init();
    } else {
        alert("错误：init 函数未定义，请刷新重试。");
    }

    // C. 【核心】防数据丢失逻辑
    // 当切换应用、锁屏时，强制保存
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            console.log("应用进入后台，正在保存...");
            if (typeof saveData === 'function') {
                saveData().catch(e => console.error("后台保存出错:", e));
            }
        }
    });

    // 页面关闭时的最后保险
    window.addEventListener('pagehide', () => {
        if (typeof saveData === 'function') {
            saveData();
        }
    });
});