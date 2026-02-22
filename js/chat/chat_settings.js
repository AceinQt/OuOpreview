const clearChatHistoryBtn = document.getElementById('clear-chat-history-btn');
            
                                    function setupChatSettings() {
                const themeSelect = document.getElementById('setting-theme-color');
                themeSelect.innerHTML = '';
                Object.keys(colorThemes).forEach(key => {
                    const option = document.createElement('option');
                    option.value = key;
                    option.textContent = colorThemes[key].name;
                    themeSelect.appendChild(option);
                });
                chatSettingsBtn.addEventListener('click', () => {
                    if (currentChatType === 'private') {
                        loadSettingsToSidebar();
                        settingsSidebar.classList.add('open');
                    } else if (currentChatType === 'group') {
                        loadGroupSettingsToSidebar();
                        groupSettingsSidebar.classList.add('open');
                    }
                });
                document.querySelector('.phone-screen').addEventListener('click', e => {
                    const openSidebar = document.querySelector('.settings-sidebar.open');
                    if (openSidebar && !openSidebar.contains(e.target) && !e.target.closest('.action-btn') && !e.target.closest('.modal-overlay') && !e.target.closest('.action-sheet-overlay')) {
                        openSidebar.classList.remove('open');
                    }
                });

                settingsForm.addEventListener('submit', e => {
                    e.preventDefault();
                    saveSettingsFromSidebar();
                    settingsSidebar.classList.remove('open');
                });
                const useCustomCssCheckbox = document.getElementById('setting-use-custom-css'),
                    customCssTextarea = document.getElementById('setting-custom-bubble-css'),
                    resetCustomCssBtn = document.getElementById('reset-custom-bubble-css-btn'),
                    privatePreviewBox = document.getElementById('private-bubble-css-preview');
                useCustomCssCheckbox.addEventListener('change', (e) => {
                    customCssTextarea.disabled = !e.target.checked;
                    const char = db.characters.find(c => c.id === currentChatId);
                    if (char) {
                        const themeKey = char.theme || 'white_blue';
                        const theme = colorThemes[themeKey];
                        updateBubbleCssPreview(privatePreviewBox, customCssTextarea.value, !e.target.checked, theme);
                    }
                });
                customCssTextarea.addEventListener('input', (e) => {
                    const char = db.characters.find(c => c.id === currentChatId);
                    if (char && useCustomCssCheckbox.checked) {
                        const themeKey = char.theme || 'white_blue';
                        const theme = colorThemes[themeKey];
                        updateBubbleCssPreview(privatePreviewBox, e.target.value, false, theme);
                    }
                });
                resetCustomCssBtn.addEventListener('click', () => {
                    const char = db.characters.find(c => c.id === currentChatId);
                    if (char) {
                        customCssTextarea.value = '';
                        useCustomCssCheckbox.checked = false;
                        customCssTextarea.disabled = true;
                        const themeKey = char.theme || 'white_blue';
                        const theme = colorThemes[themeKey];
                        updateBubbleCssPreview(privatePreviewBox, '', true, theme);
                        showToast('样式已重置为默认');
                    }
                });
                document.getElementById('setting-char-avatar-upload').addEventListener('change', async (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        try {
                            const compressedUrl = await compressImage(file, { quality: 0.8, maxWidth: 400, maxHeight: 400 });
                            document.getElementById('setting-char-avatar-preview').src = compressedUrl;
                        } catch (error) {
                            showToast('头像压缩失败，请重试');
                        }
                    }
                });
                // 在 // --- chat_settings.js 中的 setupChatSettings 函数对应部分 ---

// ... (前面的代码保持不变) ...

// 修复：更换我的身份按钮逻辑
const bindBtn = document.getElementById('bind-user-persona-btn');
if(bindBtn) {
    // 移除旧的监听器，防止累积
    const newBindBtn = bindBtn.cloneNode(true);
    bindBtn.parentNode.replaceChild(newBindBtn, bindBtn);
    
    newBindBtn.addEventListener('click', () => {
        console.log("点击了更换身份按钮"); // 调试用
        
        // 检查全局函数是否存在
        if(typeof window.openSelectPersonaModal === 'function') {
            window.openSelectPersonaModal((selectedPersona) => {
                if(selectedPersona) {
                    // 更新 UI 显示
                    const myAvatarPreview = document.getElementById('setting-my-avatar-preview');
                    const myNicknameDisplay = document.getElementById('setting-my-nickname-display');
                    const myRealnameDisplay = document.getElementById('setting-my-realname-display');
                    const myPersonaInput = document.getElementById('setting-my-persona');
                    const form = document.getElementById('chat-settings-form');

                    if(myAvatarPreview) myAvatarPreview.src = selectedPersona.avatar;
                    if(myNicknameDisplay) myNicknameDisplay.textContent = selectedPersona.nickname;
                    if(myRealnameDisplay) myRealnameDisplay.textContent = selectedPersona.realName; // 修正标签
                    if(myPersonaInput) myPersonaInput.value = selectedPersona.persona;
                    
                    // 标记为已绑定，这样点击“保存设置”时会生效
                    if(form) form.dataset.pendingBindId = selectedPersona.id;
                    
                    showToast('已选择新身份，请记得点击下方“保存设置”');
                }
            });
        } else {
            console.error("Window.openSelectPersonaModal not found!");
            showToast("功能未就绪，请刷新页面");
        }
    });
}

// ... (后面的代码保持不变) ...
                document.getElementById('setting-chat-bg-upload').addEventListener('change', async (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        const char = db.characters.find(c => c.id === currentChatId);
                        if (char) {
                            try {
                                const compressedUrl = await compressImage(file, {
                                    quality: 0.85,
                                    maxWidth: 1080,
                                    maxHeight: 1920
                                });
                                char.chatBg = compressedUrl;
                                chatRoomScreen.style.backgroundImage = `url(${compressedUrl})`;
                                await saveData();
                                showToast('聊天背景已更换');
                            } catch (error) {
                                showToast('背景压缩失败，请重试');
                            }
                        }
                    }
                });
                clearChatHistoryBtn.addEventListener('click', async () => {
                    const character = db.characters.find(c => c.id === currentChatId);
                    if (!character) return;
                    if (await AppUI.confirm(`你确定要清空与“${character.remarkName}”的所有聊天记录吗？这个操作是不可恢复的！`, "系统提示", "确认", "取消")) {
                        character.history = [];
                        character.status = '在线'; // 重置状态
                        await saveData();
                        renderMessages(false, true);
                        renderChatList();
                        // 更新聊天室顶部的状态显示
                        if (currentChatId === character.id) {
                            document.getElementById('chat-room-status-text').textContent = '在线';
                        }
                        settingsSidebar.classList.remove('open');
                        showToast('聊天记录已清空');
                    }
                });
                linkWorldBookBtn.addEventListener('click', () => {
                    const character = db.characters.find(c => c.id === currentChatId);
                    if (!character) return;
                    renderCategorizedWorldBookList(worldBookSelectionList, db.worldBooks, character.worldBookIds || [], 'wb-select');
                    worldBookSelectionModal.classList.add('visible');
                });

                saveWorldBookSelectionBtn.addEventListener('click', async () => {
                    const selectedIds = Array.from(worldBookSelectionList.querySelectorAll('.item-checkbox:checked')).map(input => input.value);
                    if (currentChatType === 'private') {
                        const character = db.characters.find(c => c.id === currentChatId);
                        if (character) character.worldBookIds = selectedIds;
                    } else if (currentChatType === 'group') {
                        const group = db.groups.find(g => g.id === currentChatId);
                        if (group) group.worldBookIds = selectedIds;
                    }
                    await saveData();
                    worldBookSelectionModal.classList.remove('visible');
                    showToast('世界书关联已更新');
                });
            }
            
            
             function loadSettingsToSidebar() {
                const e = db.characters.find(e => e.id === currentChatId);
                if (e) {
                    document.getElementById('setting-char-avatar-preview').src = e.avatar;
                    document.getElementById('setting-char-remark').value = e.remarkName;
                    document.getElementById('setting-char-real-name').value = e.realName || '';
                    document.getElementById('setting-char-persona').value = e.persona;
                           // --- 开始替换“我的设置”部分 ---
        let myAvatar = e.myAvatar;
        let myRealName = e.myName;
        let myNickname = e.myNickname || e.myName;
        let myPersona = e.myPersona;

        // 尝试读取绑定的最新数据
        if (e.boundPersonaId) {
            const p = db.userPersonas.find(up => up.id === e.boundPersonaId);
            if (p) {
                myAvatar = p.avatar;
                myRealName = p.realName;
                myNickname = p.nickname;
                myPersona = p.persona;
            }
        }

        document.getElementById('setting-my-avatar-preview').src = myAvatar;
        document.getElementById('setting-my-nickname-display').textContent = myNickname;
        document.getElementById('setting-my-realname-display').textContent = myRealName;
        document.getElementById('setting-my-persona').value = myPersona;
        
        // 记录绑定ID
        document.getElementById('chat-settings-form').dataset.pendingBindId = e.boundPersonaId || '';
                    document.getElementById('setting-theme-color').value = e.theme || 'white_blue';
                    document.getElementById('setting-max-memory').value = e.maxMemory;
                    document.getElementById('setting-bilingual-mode').checked = e.bilingualModeEnabled || false;
                    const useCustomCssCheckbox = document.getElementById('setting-use-custom-css'),
                        customCssTextarea = document.getElementById('setting-custom-bubble-css'),
                        privatePreviewBox = document.getElementById('private-bubble-css-preview');
                    useCustomCssCheckbox.checked = e.useCustomBubbleCss || false;
                    customCssTextarea.value = e.customBubbleCss || '';
                    customCssTextarea.disabled = !useCustomCssCheckbox.checked;
                    const theme = colorThemes[e.theme || 'white_blue'];
                    updateBubbleCssPreview(privatePreviewBox, e.customBubbleCss, !e.useCustomBubbleCss, theme);
                    populateBubblePresetSelect('bubble-preset-select');
                    
                }
            }
            
              async function saveSettingsFromSidebar() {
                const e = db.characters.find(e => e.id === currentChatId);
                if (e) {
                    e.avatar = document.getElementById('setting-char-avatar-preview').src;
                    e.realName = document.getElementById('setting-char-real-name').value;
                    e.remarkName = document.getElementById('setting-char-remark').value;
                    e.persona = document.getElementById('setting-char-persona').value;
                    const pendingBindId = document.getElementById('chat-settings-form').dataset.pendingBindId;
        
        if (pendingBindId) {
            e.boundPersonaId = pendingBindId;
            const p = db.userPersonas.find(up => up.id === pendingBindId);
            if(p) {
                e.myAvatar = p.avatar;
                e.myName = p.realName;
                e.myNickname = p.nickname;
                e.myPersona = p.persona;
            }
        }
                    e.theme = document.getElementById('setting-theme-color').value;
                    e.maxMemory = document.getElementById('setting-max-memory').value;
                    e.useCustomBubbleCss = document.getElementById('setting-use-custom-css').checked;
                    e.customBubbleCss = document.getElementById('setting-custom-bubble-css').value;
                    // 在 e.customBubbleCss = ... 这一行下面添加
                    e.bilingualModeEnabled = document.getElementById('setting-bilingual-mode').checked;

                    await saveData();
                    showToast('设置已保存！');
                    chatRoomTitle.textContent = e.remarkName;
                    renderChatList();
                    updateCustomBubbleStyle(currentChatId, e.customBubbleCss, e.useCustomBubbleCss);
                    currentPage = 1;
                    renderMessages(false, true);
                }
            }
            
 function updateCustomBubbleStyle(chatId, css, enabled) {
                const styleId = `custom-bubble-style-for-${chatId}`;
                let styleElement = document.getElementById(styleId);

                if (enabled && css) {
                    if (!styleElement) {
                        styleElement = document.createElement('style');
                        styleElement.id = styleId;
                        document.head.appendChild(styleElement);
                    }

                    const scope = `#chat-room-screen.chat-active-${chatId}`;
                    let finalCss = '';

                    // 1. Handle :root variables by applying them directly to the scoped element
                    const rootRegex = /:root\s*\{([\s\S]*?)\}/;
                    const rootMatch = css.match(rootRegex);
                    if (rootMatch && rootMatch[1]) {
                        const rootVars = rootMatch[1].trim();
                        if (rootVars) {
                            // This creates a rule that applies the CSS variables to the specific chat screen
                            finalCss += `${scope} { ${rootVars} }\n`;
                        }
                    }

                    // 2. Remove the original :root block and any @-rules that are problematic
                    let remainingCss = css
                        .replace(rootRegex, '')
                        .replace(/@keyframes[\s\S]*?(\}\s*\}|\})/g, '') // Remove @keyframes
                        .replace(/@font-face[\s\S]*?\}/g, ''); // Remove @font-face

                    // 3. Process all other rules with a more intelligent scoping logic
                    const ruleRegex = /([^{}]+?)\s*\{([^{}]+?)\}/g;
                    let match;
                    while ((match = ruleRegex.exec(remainingCss)) !== null) {
                        const selectors = match[1].trim();
                        const properties = match[2].trim();

                        if (selectors && properties) {
                            const scopedSelectors = selectors
                                .split(',')
                                .map(s => s.trim())
                                .filter(s => s && !s.startsWith('@'))
                                .map(s => {
                                    // NEW INTELLIGENT SCOPING:
                                    // If the selector already contains the base screen ID,
                                    // just add the active class to it. Otherwise, prepend the full scope.
                                    if (s.includes('#chat-room-screen')) {
                                        return s.replace('#chat-room-screen', scope);
                                    } else {
                                        return `${scope} ${s}`;
                                    }
                                })
                                .join(', ');

                            if (scopedSelectors) {
                                finalCss += `${scopedSelectors} { ${properties} }\n`;
                            }
                        }
                    }

                    styleElement.innerHTML = finalCss;

                } else {
                    if (styleElement) {
                        styleElement.remove();
                    }
                }
            }