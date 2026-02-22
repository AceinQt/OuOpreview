            // ==================================================================================================================
            // =================================== 2. 气泡CSS自定义预设管理 (BUBBLE CSS PRESET MANAGEMENT) ===================================
            // ==================================================================================================================
              const colorThemes = {
                'white_blue': {
                    name: '白/蓝',
                    received: { bg: '#FFFFFF', text: '#1D1F21' },
                    sent: { bg: '#0099FF', text: '#FFFFFF' }
                },
                'white_pink': {
                    name: '白/粉',
                    received: { bg: 'rgba(255,255,255,1)', text: '#1D1F21' },
                    sent: { bg: '#E69695', text: '#FFFFFF' }
                },

                'white_yellow': {
                    name: '白/橙',
                    received: { bg: 'rgba(255,255,255,1)', text: '#1D1F21' },
                    sent: { bg: '#F6C777', text: '#FFFFFF' }
                },
                'white_green': {
                    name: '白/绿',
                    received: { bg: 'rgba(255,255,255,1)', text: '#1D1F21' },
                    sent: { bg: '#8FB598', text: '#FFFFFF' }
                },
                'white_purple': {
                    name: '白/紫',
                    received: { bg: 'rgba(255,255,255,1)', text: '#1D1F21' },
                    sent: { bg: '#C3A7BE', text: '#FFFFFF' }
                },
            };
            



 function updateBubbleCssPreview(previewContainer, css, useDefault, theme) {
                previewContainer.innerHTML = '';

                const sentBubble = document.createElement('div');
                sentBubble.className = 'message-bubble sent';
                sentBubble.textContent = '这是我方气泡。';
                sentBubble.style.alignSelf = 'flex-end';
                sentBubble.style.borderRadius = '8px';

                const receivedBubble = document.createElement('div');
                receivedBubble.className = 'message-bubble received';
                receivedBubble.textContent = '这是对方气泡。';
                receivedBubble.style.alignSelf = 'flex-start';
                receivedBubble.style.borderRadius = '8px';

                [sentBubble, receivedBubble].forEach(bubble => {
                    bubble.style.maxWidth = '70%';
                    bubble.style.padding = '8px 12px';
                    bubble.style.wordWrap = 'break-word';
                    bubble.style.lineHeight = '1.4';
                });

                if (useDefault || !css) {
                    sentBubble.style.backgroundColor = theme.sent.bg;
                    sentBubble.style.color = theme.sent.text;
                    sentBubble.style.borderRadius = '8px';
                    receivedBubble.style.backgroundColor = theme.received.bg;
                    receivedBubble.style.color = theme.received.text;
                    receivedBubble.style.borderRadius = '8px';
                } else {
                    const styleTag = document.createElement('style');
                    const scopedCss = css.replace(/(\.message-bubble(?:\.sent|\.received)?)/g, `#${previewContainer.id} $1`);
                    styleTag.textContent = scopedCss;
                    previewContainer.appendChild(styleTag);
                }
                previewContainer.appendChild(receivedBubble);
                previewContainer.appendChild(sentBubble);
            }
            
            
            function _getBubblePresets() {
                return db.bubbleCssPresets || [];
            }
            function _saveBubblePresets(arr) {
                db.bubbleCssPresets = arr || [];
                saveData();
            }

            function populateBubblePresetSelect(selectId) { // 增加了参数
                const sel = document.getElementById(selectId); // 使用参数
                if (!sel) return;
                const presets = _getBubblePresets();
                sel.innerHTML = '<option value="">— 选择预设 —</option>';
                presets.forEach((p) => {
                    const opt = document.createElement('option');
                    opt.value = p.name;
                    opt.textContent = p.name;
                    sel.appendChild(opt);
                });
            }

            async function applyPresetToCurrentChat(presetName) {
                const presets = _getBubblePresets();
                const preset = presets.find(p => p.name === presetName);
                if (!preset) { (window.showToast && showToast('未找到该预设')) || await AppUI.alert('未找到该预设'); return; }

                const textarea = document.getElementById('setting-custom-bubble-css') || document.getElementById('setting-group-custom-bubble-css');
                if (textarea) textarea.value = preset.css;

                try {
                    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
                    if (chat) {
                        chat.customBubbleCss = preset.css;
                        chat.useCustomBubbleCss = true;
                        if (currentChatType === 'private') {
                            document.getElementById('setting-use-custom-css').checked = true;
                            document.getElementById('setting-custom-bubble-css').disabled = false;
                        } else {
                            document.getElementById('setting-group-use-custom-css').checked = true;
                            document.getElementById('setting-group-custom-bubble-css').disabled = false;
                        }
                    }
                } catch (e) {
                    console.warn('applyPresetToCurrentChat: cannot write to db object', e);
                }

                try {
                    updateCustomBubbleStyle(window.currentChatId || null, preset.css, true);
                    const previewBox = document.getElementById('private-bubble-css-preview') || document.getElementById('group-bubble-css-preview');
                    if (previewBox) {
                        const themeKey = (currentChatType === 'private' ? db.characters.find(c => c.id === currentChatId).theme : db.groups.find(g => g.id === currentChatId).theme) || 'white_blue';
                        updateBubbleCssPreview(previewBox, preset.css, false, colorThemes[themeKey]);
                    }
                    (window.showToast && showToast('预设已应用到当前聊天并保存')) || await AppUI.alert('预设已应用（若页面支持）');
                    await saveData();
                } catch (e) {
                    console.error('applyPresetToCurrentChat error', e);
                }
            }

           async function saveCurrentTextareaAsPreset() {
                const textarea = document.getElementById('setting-custom-bubble-css') || document.getElementById('setting-group-custom-bubble-css');
                if (!textarea) return (window.showToast && showToast('找不到自定义 CSS 文本框')) || await AppUI.alert('找不到自定义 CSS 文本框');
                const css = textarea.value.trim();
                if (!css) return (window.showToast && showToast('当前 CSS 为空，无法保存')) || await AppUI.alert('当前 CSS 为空，无法保存');
                let name = await AppUI.prompt("请输入预设名称:", "将覆盖同名预设", "另存为");
                if (!name) return;
                const presets = _getBubblePresets();
                const idx = presets.findIndex(p => p.name === name);
                if (idx >= 0) presets[idx].css = css;
                else presets.push({ name, css });
                _saveBubblePresets(presets);
                populateBubblePresetSelect('bubble-preset-select'); populateBubblePresetSelect('group-bubble-preset-select');
                (window.showToast && showToast('预设已保存')) || await AppUI.alert('预设已保存');
            }

            function openManagePresetsModal() {
                const modal = document.getElementById('bubble-presets-modal');
                const list = document.getElementById('bubble-presets-list');
                if (!modal || !list) return;
                list.innerHTML = '';
                const presets = _getBubblePresets();
                if (!presets.length) list.innerHTML = '<p style="color:#888;margin:6px 0;">暂无预设</p>';
                presets.forEach((p, idx) => {
                    const row = document.createElement('div');
                    row.className = 'list-item';
                    const nameDiv = document.createElement('div');
                    nameDiv.className = 'list-item-title';
                    nameDiv.textContent = p.name;
                    row.appendChild(nameDiv);

                    const btnWrap = document.createElement('div');
                    btnWrap.className = 'list-item-btn';

                    const applyBtn = document.createElement('button');
                    applyBtn.className = 'btn btn-primary';
                    applyBtn.textContent = '应用';
                    applyBtn.onclick = function () { applyPresetToCurrentChat(p.name); modal.style.display = 'none'; };

                    const renameBtn = document.createElement('button');
                    renameBtn.className = 'btn btn-primary';
                    renameBtn.textContent = '重命名';
                    renameBtn.onclick = async function () {
                        const newName = await AppUI.prompt('请输入新名称：', p.name, '重命名预设');
                        if (!newName) return;
                        const presetsAll = _getBubblePresets();
                        presetsAll[idx].name = newName;
                        _saveBubblePresets(presetsAll);
                        openManagePresetsModal(); // refresh
                        populateBubblePresetSelect('bubble-preset-select'); populateBubblePresetSelect('group-bubble-preset-select');
                    };

                    const delBtn = document.createElement('button');
                    delBtn.className = 'btn btn-danger';
                    delBtn.textContent = '删除';
                    delBtn.onclick = async function () {
                        if (!await AppUI.confirm('确定删除预设 \"' + p.name + '\" ?', "系统提示", "确认", "取消")) return;
                        const presetsAll = _getBubblePresets();
                        presetsAll.splice(idx, 1);
                        _saveBubblePresets(presetsAll);
                        openManagePresetsModal();
                        populateBubblePresetSelect('bubble-preset-select'); populateBubblePresetSelect('group-bubble-preset-select');
                    };

                    btnWrap.appendChild(applyBtn);
                    btnWrap.appendChild(renameBtn);
                    btnWrap.appendChild(delBtn);
                    row.appendChild(btnWrap);
                    list.appendChild(row);
                });
                modal.style.display = 'flex';
            }
            
            
 // js/chat/bubble_css_preset.js

function setupBubblePresets() {
    // --- 私聊气泡预设 ---
    const bubbleApplyBtn = document.getElementById('apply-preset-btn');
    const bubbleSaveBtn = document.getElementById('save-preset-btn');
    const bubbleManageBtn = document.getElementById('manage-presets-btn');
    const bubbleModalClose = document.getElementById('close-presets-modal');

    if (bubbleApplyBtn) bubbleApplyBtn.addEventListener('click', async () => {
        const selVal = document.getElementById('bubble-preset-select').value;
        if (!selVal) return (window.showToast && showToast('请选择要应用的预设')) || await AppUI.alert('请选择要应用的预设');
        // 注意：applyPresetToCurrentChat 函数也应该在这个文件里定义
        applyPresetToCurrentChat(selVal);
    });
    if (bubbleSaveBtn) bubbleSaveBtn.addEventListener('click', saveCurrentTextareaAsPreset);
    if (bubbleManageBtn) bubbleManageBtn.addEventListener('click', openManagePresetsModal);
    if (bubbleModalClose) bubbleModalClose.addEventListener('click', () => {
        document.getElementById('bubble-presets-modal').style.display = 'none';
    });

    // --- 群聊气泡预设 ---
    const groupBubbleApplyBtn = document.getElementById('group-apply-preset-btn');
    const groupBubbleSaveBtn = document.getElementById('group-save-preset-btn');
    const groupBubbleManageBtn = document.getElementById('group-manage-presets-btn');

    if (groupBubbleApplyBtn) groupBubbleApplyBtn.addEventListener('click', async () => {
        const selVal = document.getElementById('group-bubble-preset-select').value;
        if (!selVal) return (window.showToast && showToast('请选择要应用的预设')) || await AppUI.alert('请选择要应用的预设');
        applyPresetToCurrentChat(selVal);
    });
    if (groupBubbleSaveBtn) groupBubbleSaveBtn.addEventListener('click', saveCurrentTextareaAsPreset);
    if (groupBubbleManageBtn) groupBubbleManageBtn.addEventListener('click', openManagePresetsModal);
}

window.setupBubblePresets = setupBubblePresets;