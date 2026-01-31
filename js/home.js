// --- js/home.js ---
const homeScreen = document.getElementById('home-screen');
// 辅助工具：获取图标
const getIcon = (id) => db.customIcons[id] || defaultIcons[id].url;

// 辅助工具：渲染图标 HTML
function renderAppIcon(key) {
    const item = defaultIcons[key];
    if (!item) return '';
    if (item.svgCode) {
        return item.svgCode;
    }
    const src = typeof getIcon === 'function' ? getIcon(key) : item.url;
    return `<img src="${src}" alt="${item.name}" class="icon-img">`;
}

// 核心函数：渲染主屏幕
function setupHomeScreen() {
    // 确保小组件数据存在
    if (!db.insWidgetSettings) {
        db.insWidgetSettings = {
            avatar1: 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg',
            bubble1: '„- ω -„',
            avatar2: 'https://i.postimg.cc/GtbTnxhP/o-o-1.jpg',
            bubble2: 'ｷ...✩'
        };
    }
    const insWidget = db.insWidgetSettings;

    // 巨大的 HTML 字符串
    const homeScreenHTML = `
    <div class="home-screen-swiper">
        <div class="home-screen-page">
            <div class="home-widget-container">
                <div class="central-circle" style="background-image: url('${db.homeWidgetSettings.centralCircleImage}');"></div>
                <div class="widget-time" id="time-display"></div>
                <div class="widget-date" id="date-display"></div>
                <div contenteditable="true" class="widget-signature" id="widget-signature" placeholder="编辑个性签名..."></div>
                <div class="widget-battery">
                    <svg width="32" height="23" viewBox="0 0 24 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M1 2.5C1 1.94772 1.44772 1.5 2 1.5H20C20.5523 1.5 21 1.94772 21 2.5V9.5C21 10.0523 20.5523 10.5 20 10.5H2C1.44772 10.5 1 10.0523 1 9.5V2.5Z" stroke="currentColor" stroke-opacity="1" stroke-width="1"/>
                        <path d="M22.5 4V8" stroke="currentColor" stroke-opacity="1" stroke-width="1.5" stroke-linecap="round"/>
                        <rect id="battery-fill-rect" x="2" y="2.5" width="18" height="7" rx="0.5" fill="currentColor" fill-opacity="1"/>
                    </svg>
                    <span id="battery-level">--%</span>
                </div>
            </div>
            <div class="app-grid">
                <div class="app-grid-widget-container">
                   <div class="app-grid-widget">
                        <div class="ins-widget">
                            <div class="ins-widget-row user">
                                <img src="${insWidget.avatar1}" alt="Character Avatar" class="ins-widget-avatar" id="ins-widget-avatar-1">
                                <div class="ins-widget-bubble" id="ins-widget-bubble-1" contenteditable="true">${insWidget.bubble1}</div>
                            </div>
                            <div class="ins-widget-divider"><span>୨୧</span></div>
                            <div class="ins-widget-row character">
                                <div class="ins-widget-bubble" id="ins-widget-bubble-2" contenteditable="true">${insWidget.bubble2}</div>
                                <img src="${insWidget.avatar2}" alt="User Avatar" class="ins-widget-avatar" id="ins-widget-avatar-2">
                            </div>
                        </div>
                   </div>
                </div>
                 <a href="#" class="app-icon" data-target="chat-list-screen">
                    ${renderAppIcon('chat-list-screen')}
                    <span class="app-name">${defaultIcons['chat-list-screen'].name}</span>
                </a>
                <a href="#" class="app-icon" data-target="pomodoro-screen">
                   ${renderAppIcon('pomodoro-screen')}
                   <span class="app-name">${defaultIcons['pomodoro-screen'].name}</span>
                </a>
                <a href="#" class="app-icon" data-target="forum-screen">
                    ${renderAppIcon('forum-screen')}
                    <span class="app-name">${defaultIcons['forum-screen'].name}</span>
                </a>                         
                <a href="#" class="app-icon" data-target="rpg-title-screen">
                    ${renderAppIcon('rpg-title-screen')}
                    <span class="app-name">${defaultIcons['rpg-title-screen'].name}</span>
                </a>                         
            </div>
        </div>
        <div class="app-grid"></div>
    </div>
    <div class="dock">
        <a href="#" class="app-icon" data-target="settings-screen">
          ${renderAppIcon('settings-screen')}
        </a>
        <a href="#" class="app-icon" data-target="world-book-screen">
            ${renderAppIcon('world-book-screen')}
        </a>
    </div>`;
    
    document.getElementById('home-screen').innerHTML = homeScreenHTML;

    // 应用拍立得照片
    const polaroidImage = db.homeWidgetSettings?.polaroidImage;
    if (polaroidImage) {
        updatePolaroidImage(polaroidImage);
    }

    // 更新时间、壁纸、模式、电量
    if(typeof updateClock === 'function') updateClock();
    applyWallpaper(db.wallpaper);
    applyHomeScreenMode(db.homeScreenMode);
    updateBatteryStatus();

    // 绑定交互事件
    bindHomeScreenEvents();
}

// 辅助函数：绑定主页的点击和编辑事件（从 setupHomeScreen 中拆分出来更清晰）
function bindHomeScreenEvents() {
    const homeScreen = document.getElementById('home-screen');
    const homeWidgetContainer = homeScreen.querySelector('.home-widget-container');

    // 1. 中央圆圈点击事件
    const centralCircle = homeWidgetContainer.querySelector('.central-circle');
    if (centralCircle) {
        centralCircle.addEventListener('click', () => {
            const modal = document.getElementById('ins-widget-avatar-modal');
            const preview = document.getElementById('ins-widget-avatar-preview');
            const urlInput = document.getElementById('ins-widget-avatar-url-input');
            const fileUpload = document.getElementById('ins-widget-avatar-file-upload');
            const targetInput = document.getElementById('ins-widget-avatar-target');

            targetInput.value = 'centralCircle'; 
            preview.style.backgroundImage = `url("${db.homeWidgetSettings.centralCircleImage}")`;
            preview.innerHTML = '';
            urlInput.value = '';
            fileUpload.value = null;
            modal.classList.add('visible');
        });
    }

    // 2. 签名和气泡的自动保存（失焦保存）
    homeScreen.addEventListener('blur', async (e) => {
        const target = e.target;
        if (target.hasAttribute('contenteditable')) {
            if (target.id === 'widget-signature') { 
                const newSignature = target.textContent.trim();
                if (db.homeSignature !== newSignature) {
                    db.homeSignature = newSignature;
                    await saveData();
                    showToast('签名已保存');
                }
            } else if (target.id === 'ins-widget-bubble-1' || target.id === 'ins-widget-bubble-2') { 
                const bubbleId = target.id === 'ins-widget-bubble-1' ? 'bubble1' : 'bubble2';
                const newText = target.textContent.trim();
                if (db.insWidgetSettings[bubbleId] !== newText) {
                    db.insWidgetSettings[bubbleId] = newText;
                    await saveData();
                    showToast('小组件文字已保存');
                }
            }
        }
    }, true);

    // 3. 回填签名
    const signatureWidget = document.getElementById('widget-signature');
    if (signatureWidget) {
        signatureWidget.textContent = db.homeSignature || '';
    }

    // 4. 滑动屏幕逻辑 (Swipe)
    const swiper = homeScreen.querySelector('.home-screen-swiper');
    let touchStartX = 0;
    let touchEndX = 0;
    const totalPages = 1;
    const swipeThreshold = 50;
    let isDragging = false;
    let currentPageIndex = 0; // 局部变量即可，除非全局需要

    swiper.style.transform = `translateX(-${currentPageIndex * 100 / totalPages}%)`;

    swiper.addEventListener('touchstart', (e) => {
        if (e.target.closest('[contenteditable]')) return;
        isDragging = true;
        touchStartX = e.changedTouches[0].screenX;
        touchEndX = e.changedTouches[0].screenX; 
    }, { passive: true });

    swiper.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        touchEndX = e.changedTouches[0].screenX;
    }, { passive: true });

    swiper.addEventListener('touchend', (e) => {
        if (!isDragging) return;
        isDragging = false;
        const deltaX = touchEndX - touchStartX;
        if (Math.abs(deltaX) > swipeThreshold) {
            if (deltaX < 0 && currentPageIndex < totalPages - 1) currentPageIndex++;
            else if (deltaX > 0 && currentPageIndex > 0) currentPageIndex--;
        }
        swiper.style.transform = `translateX(-${currentPageIndex * 100 / totalPages}%)`;
    });

    // 5. 点击空白失焦
    homeScreen.addEventListener('click', (e) => {
        const activeEl = document.activeElement;
        if (activeEl && activeEl.hasAttribute('contenteditable') && e.target !== activeEl) {
            activeEl.blur();
        }
    });
}

function applyWallpaper(url) {
    document.getElementById('home-screen').style.backgroundImage = `url(${url})`;
}

async function applyHomeScreenMode(mode) {
    const toggle = document.getElementById('dark-mode-toggle');
    const homeScreen = document.getElementById('home-screen');
    if (!mode) mode = 'day';

    if (mode === 'day') {
        homeScreen.classList.add('day-mode');
        if (toggle) toggle.checked = true;
    } else {
        homeScreen.classList.remove('day-mode');
        if (toggle) toggle.checked = false;
    }
    db.homeScreenMode = mode;
    await saveData();
}

function updatePolaroidImage(imageUrl) {
    const styleId = 'polaroid-image-style';
    let styleElement = document.getElementById(styleId);
    if (!styleElement) {
        styleElement = document.createElement('style');
        styleElement.id = styleId;
        document.head.appendChild(styleElement);
    }
    styleElement.innerHTML = `.heart-photo-widget::after { background-image: url('${imageUrl}'); }`;
}

// 主页上的小组件头像更换弹窗逻辑
function setupInsWidgetAvatarModal() {
    const modal = document.getElementById('ins-widget-avatar-modal');
    const form = document.getElementById('ins-widget-avatar-form');
    const preview = document.getElementById('ins-widget-avatar-preview');
    const urlInput = document.getElementById('ins-widget-avatar-url-input');
    const fileUpload = document.getElementById('ins-widget-avatar-file-upload');
    const targetInput = document.getElementById('ins-widget-avatar-target');

    // 监听主页上的头像点击
    document.getElementById('home-screen').addEventListener('click', (e) => {
        const avatar1 = e.target.closest('#ins-widget-avatar-1');
        const avatar2 = e.target.closest('#ins-widget-avatar-2');
        let targetAvatarId = null;
        let currentSrc = '';

        if (avatar1) {
            targetAvatarId = 'avatar1';
            currentSrc = db.insWidgetSettings.avatar1;
        } else if (avatar2) {
            targetAvatarId = 'avatar2';
            currentSrc = db.insWidgetSettings.avatar2;
        }

        if (targetAvatarId) {
            targetInput.value = targetAvatarId;
            preview.style.backgroundImage = `url("${currentSrc}")`;
            preview.innerHTML = ''; 
            urlInput.value = '';
            fileUpload.value = null;
            modal.classList.add('visible');
        }
    });

    // 弹窗内的逻辑
    urlInput.addEventListener('input', () => {
        const url = urlInput.value.trim();
        if (url) {
            preview.style.backgroundImage = `url("${url}")`;
            preview.innerHTML = '';
            fileUpload.value = null;
        } else {
            preview.style.backgroundImage = 'none';
            preview.innerHTML = '<span>预览</span>';
        }
    });

    fileUpload.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                const compressedUrl = await compressImage(file, { quality: 0.8, maxWidth: 200, maxHeight: 200 });
                preview.style.backgroundImage = `url("${compressedUrl}")`;
                preview.innerHTML = '';
                urlInput.value = ''; 
            } catch (error) {
                showToast('图片压缩失败，请重试');
            }
        }
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const targetAvatar = targetInput.value;
        const bgImage = preview.style.backgroundImage;
        const newSrc = bgImage.slice(5, -2); 

        if (!targetAvatar || !newSrc) {
            showToast('没有要保存的图片');
            return;
        }

        if (targetAvatar === 'centralCircle') {
            db.homeWidgetSettings.centralCircleImage = newSrc;
        } else if (targetAvatar === 'avatar1') {
            db.insWidgetSettings.avatar1 = newSrc;
        } else if (targetAvatar === 'avatar2') {
            db.insWidgetSettings.avatar2 = newSrc;
        }

        await saveData();
        setupHomeScreen(); // 刷新主页显示
        modal.classList.remove('visible');
        showToast('头像已更新');
    });
}

// 电池状态
async function updateBatteryStatus() {
    if ('getBattery' in navigator) {
        try {
            const battery = await navigator.getBattery();
            const batteryLevelText = document.getElementById('battery-level');
            const batteryFillRect = document.getElementById('battery-fill-rect');

            const updateDisplay = () => {
                if (!batteryLevelText || !batteryFillRect) return;
                const level = Math.floor(battery.level * 100);
                batteryLevelText.textContent = `${level}%`;
                batteryFillRect.setAttribute('width', 18 * battery.level);
                let fillColor = "currentColor";
                if (battery.charging) fillColor = "#4CAF50"; 
                else if (level <= 20) fillColor = "#f44336";
                batteryFillRect.setAttribute('fill', fillColor);
            };
            updateDisplay();
            battery.addEventListener('levelchange', updateDisplay);
            battery.addEventListener('chargingchange', updateDisplay);
        } catch (error) {
            const batteryWidget = document.querySelector('.widget-battery');
            if (batteryWidget) batteryWidget.style.display = 'none';
        }
    } else {
        const batteryWidget = document.querySelector('.widget-battery');
        if (batteryWidget) batteryWidget.style.display = 'none';
    }
}