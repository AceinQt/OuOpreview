            // ==================================================================================================================
            // ======================================= 3. 人设预设管理 (USER PERSONA PRESET MANAGEMENT) =======================================
            // ==================================================================================================================
            function _getMyPersonaPresets() {
                return db.myPersonaPresets || [];
            }
            function _saveMyPersonaPresets(arr) {
                db.myPersonaPresets = arr || [];
                saveData();
            }

            function populateMyPersonaSelect() {
                const sel = document.getElementById('mypersona-preset-select');
                if (!sel) return;
                const presets = _getMyPersonaPresets();
                sel.innerHTML = '<option value="">— 选择预设 —</option>';
                presets.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.name;
                    opt.textContent = p.name;
                    sel.appendChild(opt);
                });
            }

            function saveCurrentMyPersonaAsPreset() {
                const personaEl = document.getElementById('setting-my-persona');
                const avatarEl = document.getElementById('setting-my-avatar-preview');
                if (!personaEl || !avatarEl) return (window.showToast && showToast('找不到我的人设或头像控件')) || alert('找不到我的人设或头像控件');
                const persona = personaEl.value.trim();
                const avatar = avatarEl.src || '';
                if (!persona && !avatar) return (window.showToast && showToast('人设和头像都为空，无法保存')) || alert('人设和头像都为空，无法保存');
                const name = prompt('请输入预设名称（将覆盖同名预设）：');
                if (!name) return;
                const presets = _getMyPersonaPresets();
                const idx = presets.findIndex(p => p.name === name);
                const preset = { name, persona, avatar };
                if (idx >= 0) presets[idx] = preset; else presets.push(preset);
                _saveMyPersonaPresets(presets);
                populateMyPersonaSelect();
                (window.showToast && showToast('我的人设预设已保存')) || console.log('我的人设预设已保存');
            }

            async function applyMyPersonaPresetToCurrentChat(presetName) {
                const presets = _getMyPersonaPresets();
                const p = presets.find(x => x.name === presetName);
                if (!p) { (window.showToast && showToast('未找到该预设')) || alert('未找到该预设'); return; }

                const personaEl = document.getElementById('setting-my-persona');
                const avatarEl = document.getElementById('setting-my-avatar-preview');
                if (personaEl) personaEl.value = p.persona || '';
                if (avatarEl) avatarEl.src = p.avatar || '';

                try {
                    if (currentChatType === 'private') {
                        const e = db.characters.find(c => c.id === currentChatId);
                        if (e) {
                            e.myPersona = p.persona || '';
                            e.myAvatar = p.avatar || '';
                            await saveData();
                            (window.showToast && showToast('预设已应用并保存到当前聊天')) || console.log('预设已应用');
                            if (typeof loadSettingsToSidebar === 'function') try { loadSettingsToSidebar(); } catch (e) { }
                            if (typeof renderChatList === 'function') try { renderChatList(); } catch (e) { }
                        }
                    } else {
                        (window.showToast && showToast('预设已应用到界面（未检测到当前聊天保存入口）')) || console.log('预设已应用到界面');
                    }
                } catch (err) {
                    console.error('applyMyPersonaPresetToCurrentChat error', err);
                }
            }

            function openManageMyPersonaModal() {
                const modal = document.getElementById('mypersona-presets-modal');
                const list = document.getElementById('mypersona-presets-list');
                if (!modal || !list) return;
                list.innerHTML = '';
                const presets = _getMyPersonaPresets();
                if (!presets.length) list.innerHTML = '<p style="color:#888;margin:6px 0;">暂无预设</p>';
                presets.forEach((p, idx) => {
                    const row = document.createElement('div');
                    row.style.display = 'flex';
                    row.style.justifyContent = 'space-between';
                    row.style.alignItems = 'center';
                    row.style.padding = '8px 0';
                    row.style.borderBottom = '1px solid #f0f0f0';

                    const nameDiv = document.createElement('div');
                    nameDiv.style.flex = '1';
                    nameDiv.style.whiteSpace = 'nowrap';
                    nameDiv.style.overflow = 'hidden';
                    nameDiv.style.textOverflow = 'ellipsis';
                    nameDiv.textContent = p.name;
                    row.appendChild(nameDiv);

                    const btnWrap = document.createElement('div');
                    btnWrap.style.display = 'flex';
                    btnWrap.style.gap = '6px';

                    const applyBtn = document.createElement('button');
                    applyBtn.className = 'btn btn-primary';
                    applyBtn.style.padding = '6px 8px;border-radius:8px';
                    applyBtn.textContent = '应用';
                    applyBtn.onclick = function () { applyMyPersonaPresetToCurrentChat(p.name); modal.style.display = 'none'; };

                    const renameBtn = document.createElement('button');
                    renameBtn.className = 'btn';
                    renameBtn.style.padding = '6px 8px;border-radius:8px';
                    renameBtn.textContent = '重命名';
                    renameBtn.onclick = function () {
                        const newName = prompt('输入新名称：', p.name);
                        if (!newName) return;
                        const all = _getMyPersonaPresets();
                        all[idx].name = newName;
                        _saveMyPersonaPresets(all);
                        openManageMyPersonaModal();
                        populateMyPersonaSelect();
                    };

                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'btn';
                    deleteBtn.style.padding = '6px 8px;border-radius:8px;color:#e53935';
                    deleteBtn.textContent = '删除';
                    deleteBtn.onclick = function () {
                        if (!confirm('确认删除该预设？')) return;
                        const all = _getMyPersonaPresets();
                        all.splice(idx, 1);
                        _saveMyPersonaPresets(all);
                        openManageMyPersonaModal();
                        populateMyPersonaSelect();
                    };

                    btnWrap.appendChild(applyBtn);
                    btnWrap.appendChild(renameBtn);
                    btnWrap.appendChild(deleteBtn);
                    row.appendChild(btnWrap);

                    list.appendChild(row);
                });

                modal.style.display = 'flex';
            }
            
            
 // js/chat/user_preset.js

function setupPersonaPresets() {
    const personaSaveBtn = document.getElementById('mypersona-save-btn');
    const personaManageBtn = document.getElementById('mypersona-manage-btn');
    const personaApplyBtn = document.getElementById('mypersona-apply-btn');
    const personaSelect = document.getElementById('mypersona-preset-select');
    const personaModalClose = document.getElementById('mypersona-close-modal');

    if (personaSaveBtn) personaSaveBtn.addEventListener('click', saveCurrentMyPersonaAsPreset);
    if (personaManageBtn) personaManageBtn.addEventListener('click', openManageMyPersonaModal);
    if (personaApplyBtn) personaApplyBtn.addEventListener('click', function () { 
        const v = personaSelect.value; 
        if (!v) return (window.showToast && showToast('请选择要应用的预设')) || alert('请选择要应用的预设'); 
        applyMyPersonaPresetToCurrentChat(v); 
    });
    if (personaModalClose) personaModalClose.addEventListener('click', function () { 
        document.getElementById('mypersona-presets-modal').style.display = 'none'; 
    });
}

window.setupPersonaPresets = setupPersonaPresets;