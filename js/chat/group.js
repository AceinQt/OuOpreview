            const createGroupBtn = document.getElementById('create-group-btn'),
                createGroupModal = document.getElementById('create-group-modal'),
                createGroupForm = document.getElementById('create-group-form'),
                memberSelectionList = document.getElementById('member-selection-list'),
                groupNameInput = document.getElementById('group-name-input'),
                groupSettingsSidebar = document.getElementById('group-settings-sidebar'),
                groupSettingsForm = document.getElementById('group-settings-form'),
                groupMembersListContainer = document.getElementById('group-members-list-container'),
                editGroupMemberModal = document.getElementById('edit-group-member-modal'),
                editGroupMemberForm = document.getElementById('edit-group-member-form');
            const addMemberActionSheet = document.getElementById('add-member-actionsheet'),
                inviteExistingMemberBtn = document.getElementById('invite-existing-member-btn'),
                createNewMemberBtn = document.getElementById('create-new-member-btn'),
                inviteMemberModal = document.getElementById('invite-member-modal'),
                inviteMemberSelectionList = document.getElementById('invite-member-selection-list'),
                confirmInviteBtn = document.getElementById('confirm-invite-btn'),
                createMemberForGroupModal = document.getElementById('create-member-for-group-modal'),
                createMemberForGroupForm = document.getElementById('create-member-for-group-form');
            
   const groupRecipientSelectionModal = document.getElementById('group-recipient-selection-modal'),
                groupRecipientSelectionList = document.getElementById('group-recipient-selection-list'),
                confirmGroupRecipientBtn = document.getElementById('confirm-group-recipient-btn'),
                groupRecipientSelectionTitle = document.getElementById('group-recipient-selection-title');
            const linkGroupWorldBookBtn = document.getElementById('link-group-world-book-btn');                     
                                                // --- GROUP CHAT FUNCTIONS ---
            function setupGroupChatSystem() {
                createGroupBtn.addEventListener('click', () => {
                    renderMemberSelectionList();
                    createGroupModal.classList.add('visible');
                });
                createGroupForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const selectedMemberIds = Array.from(memberSelectionList.querySelectorAll('input:checked')).map(input => input.value);
                    const groupName = groupNameInput.value.trim();
                    if (selectedMemberIds.length < 1) return showToast('请至少选择一个群成员。');
                    if (!groupName) return showToast('请输入群聊名称。');
                    const firstChar = db.characters.length > 0 ? db.characters[0] : null;
                    const newGroup = {
                        id: `group_${Date.now()}`,
                        name: groupName,
                        avatar: 'https://i.postimg.cc/fTLCngk1/image.jpg',
                        me: {
                            nickname: firstChar ? firstChar.myName : '我',
                            persona: firstChar ? firstChar.myPersona : '',
                            avatar: firstChar ? firstChar.myAvatar : 'https://i.postimg.cc/GtbTnxhP/o-o-1.jpg'
                        },
                        members: selectedMemberIds.map(charId => {
                            const char = db.characters.find(c => c.id === charId);
                            return {
                                id: `member_${char.id}`,
                                originalCharId: char.id,
                                realName: char.realName,
                                groupNickname: char.remarkName,
                                persona: char.persona,
                                avatar: char.avatar
                            };
                        }),
                        theme: 'white_blue',
                        maxMemory: 10,
                        chatBg: '',
                        history: [],
                        isPinned: false,
                        unreadCount: 0,
                        useCustomBubbleCss: false,
                        customBubbleCss: '',
                        worldBookIds: []
                    };
                    db.groups.push(newGroup);
                    await saveData();
                    renderChatList();
                    createGroupModal.classList.remove('visible');
                    showToast(`群聊“${groupName}”创建成功！`);
                });
                groupSettingsForm.addEventListener('submit', e => {
                    e.preventDefault();
                    saveGroupSettingsFromSidebar();
                    groupSettingsSidebar.classList.remove('open');
                });
                const useGroupCustomCssCheckbox = document.getElementById('setting-group-use-custom-css'),
                    groupCustomCssTextarea = document.getElementById('setting-group-custom-bubble-css'),
                    resetGroupCustomCssBtn = document.getElementById('reset-group-custom-bubble-css-btn'),
                    groupPreviewBox = document.getElementById('group-bubble-css-preview');
                useGroupCustomCssCheckbox.addEventListener('change', (e) => {
                    groupCustomCssTextarea.disabled = !e.target.checked;
                    const group = db.groups.find(g => g.id === currentChatId);
                    if (group) {
                        const theme = colorThemes[group.theme || 'white_blue'];
                        updateBubbleCssPreview(groupPreviewBox, groupCustomCssTextarea.value, !e.target.checked, theme);
                    }
                });
                groupCustomCssTextarea.addEventListener('input', (e) => {
                    const group = db.groups.find(g => g.id === currentChatId);
                    if (group && useGroupCustomCssCheckbox.checked) {
                        const theme = colorThemes[group.theme || 'white_blue'];
                        updateBubbleCssPreview(groupPreviewBox, e.target.value, false, theme);
                    }
                });
                resetGroupCustomCssBtn.addEventListener('click', () => {
                    const group = db.groups.find(g => g.id === currentChatId);
                    if (group) {
                        groupCustomCssTextarea.value = '';
                        useGroupCustomCssCheckbox.checked = false;
                        groupCustomCssTextarea.disabled = true;
                        const theme = colorThemes[group.theme || 'white_blue'];
                        updateBubbleCssPreview(groupPreviewBox, '', true, theme);
                        showToast('样式已重置为默认');
                    }
                });
                document.getElementById('setting-group-avatar-upload').addEventListener('change', async (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        try {
                            const compressedUrl = await compressImage(file, { quality: 0.8, maxWidth: 400, maxHeight: 400 });
                            const group = db.groups.find(g => g.id === currentChatId);
                            if (group) {
                                group.avatar = compressedUrl;
                                document.getElementById('setting-group-avatar-preview').src = compressedUrl;
                            }
                        } catch (error) {
                            showToast('群头像压缩失败，请重试');
                        }
                    }
                });
                document.getElementById('setting-group-chat-bg-upload').addEventListener('change', async (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        try {
                            const compressedUrl = await compressImage(file, {
                                quality: 0.85,
                                maxWidth: 1080,
                                maxHeight: 1920
                            });
                            const group = db.groups.find(g => g.id === currentChatId);
                            if (group) {
                                group.chatBg = compressedUrl;
                                chatRoomScreen.style.backgroundImage = `url(${compressedUrl})`;
                                await saveData();
                                showToast('聊天背景已更换');
                            }
                        } catch (error) {
                            showToast('群聊背景压缩失败，请重试');
                        }
                    }
                });
                document.getElementById('clear-group-chat-history-btn').addEventListener('click', async () => {
                    const group = db.groups.find(g => g.id === currentChatId);
                    if (!group) return;
                    if (confirm(`你确定要清空群聊“${group.name}”的所有聊天记录吗？这个操作是不可恢复的！`)) {
                        group.history = [];
                        await saveData();
                        renderMessages(false, true);
                        renderChatList();
                        groupSettingsSidebar.classList.remove('open');
                        showToast('聊天记录已清空');
                    }
                });
                groupMembersListContainer.addEventListener('click', e => {
                    const memberDiv = e.target.closest('.group-member');
                    const addBtn = e.target.closest('.add-member-btn');
                    if (memberDiv) {
                        openGroupMemberEditModal(memberDiv.dataset.id);
                    } else if (addBtn) {
                        addMemberActionSheet.classList.add('visible');
                    }
                });
                document.getElementById('edit-member-avatar-preview').addEventListener('click', () => {
                    document.getElementById('edit-member-avatar-upload').click();
                });
                document.getElementById('edit-member-avatar-upload').addEventListener('change', async (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        try {
                            const compressedUrl = await compressImage(file, { quality: 0.8, maxWidth: 400, maxHeight: 400 });
                            document.getElementById('edit-member-avatar-preview').src = compressedUrl;
                        } catch (error) {
                            showToast('成员头像压缩失败，请重试');
                        }
                    }
                });
                editGroupMemberForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const memberId = document.getElementById('editing-member-id').value;
                    const group = db.groups.find(g => g.id === currentChatId);
                    const member = group.members.find(m => m.id === memberId);
                    if (member) {
                        member.avatar = document.getElementById('edit-member-avatar-preview').src;
                        member.groupNickname = document.getElementById('edit-member-group-nickname').value;
                        member.realName = document.getElementById('edit-member-real-name').value;
                        member.persona = document.getElementById('edit-member-persona').value;
                        await saveData();
                        renderGroupMembersInSettings(group);
                        document.querySelectorAll(`.message-wrapper[data-sender-id="${member.id}"] .group-nickname`).forEach(el => {
                            el.textContent = member.groupNickname;
                        });
                        showToast('成员信息已更新');
                    }
                    editGroupMemberModal.classList.remove('visible');
                });
                inviteExistingMemberBtn.addEventListener('click', () => {
                    renderInviteSelectionList();
                    inviteMemberModal.classList.add('visible');
                    addMemberActionSheet.classList.remove('visible');
                });
                createNewMemberBtn.addEventListener('click', () => {
                    createMemberForGroupForm.reset();
                    document.getElementById('create-group-member-avatar-preview').src = 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg';
                    createMemberForGroupModal.classList.add('visible');
                    addMemberActionSheet.classList.remove('visible');
                });
                document.getElementById('create-group-member-avatar-preview').addEventListener('click', () => {
                    document.getElementById('create-group-member-avatar-upload').click();
                });
                document.getElementById('create-group-member-avatar-upload').addEventListener('change', async (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        try {
                            const compressedUrl = await compressImage(file, { quality: 0.8, maxWidth: 400, maxHeight: 400 });
                            document.getElementById('create-group-member-avatar-preview').src = compressedUrl;
                        } catch (error) {
                            showToast('新成员头像压缩失败，请重试');
                        }
                    }
                });
                confirmInviteBtn.addEventListener('click', async () => {
                    const group = db.groups.find(g => g.id === currentChatId);
                    if (!group) return;
                    const selectedCharIds = Array.from(inviteMemberSelectionList.querySelectorAll('input:checked')).map(input => input.value);
                    selectedCharIds.forEach(charId => {
                        const char = db.characters.find(c => c.id === charId);
                        if (char) {
                            const newMember = {
                                id: `member_${char.id}`,
                                originalCharId: char.id,
                                realName: char.realName,
                                groupNickname: char.remarkName,
                                persona: char.persona,
                                avatar: char.avatar
                            };
                            group.members.push(newMember);
                            sendInviteNotification(group, newMember.realName);
                        }
                    });
                    if (selectedCharIds.length > 0) {
                        await saveData();
                        renderGroupMembersInSettings(group);
                        renderMessages(false, true);
                        showToast('已邀请新成员');
                    }
                    inviteMemberModal.classList.remove('visible');
                });
                createMemberForGroupForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const group = db.groups.find(g => g.id === currentChatId);
                    if (!group) return;
                    const newMember = {
                        id: `member_group_only_${Date.now()}`,
                        originalCharId: null,
                        realName: document.getElementById('create-group-member-realname').value,
                        groupNickname: document.getElementById('create-group-member-nickname').value,
                        persona: document.getElementById('create-group-member-persona').value,
                        avatar: document.getElementById('create-group-member-avatar-preview').src,
                    };
                    group.members.push(newMember);
                    sendInviteNotification(group, newMember.realName);
                    await saveData();
                    renderGroupMembersInSettings(group);
                    renderMessages(false, true);
                    showToast(`新成员 ${newMember.groupNickname} 已加入`);
                    createMemberForGroupModal.classList.remove('visible');
                });
                document.getElementById('setting-group-my-avatar-upload').addEventListener('change', async (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        try {
                            const compressedUrl = await compressImage(file, { quality: 0.8, maxWidth: 400, maxHeight: 400 });
                            document.getElementById('setting-group-my-avatar-preview').src = compressedUrl;
                        } catch (error) {
                            showToast('头像压缩失败')
                        }
                    }
                });
                confirmGroupRecipientBtn.addEventListener('click', () => {
                    const selectedRecipientIds = Array.from(groupRecipientSelectionList.querySelectorAll('input:checked')).map(input => input.value);
                    if (selectedRecipientIds.length === 0) {
                        return showToast('请至少选择一个收件人。');
                    }
                    currentGroupAction.recipients = selectedRecipientIds;
                    groupRecipientSelectionModal.classList.remove('visible');

                    if (currentGroupAction.type === 'transfer') {
                        sendTransferForm.reset();
                        sendTransferModal.classList.add('visible');
                    } else if (currentGroupAction.type === 'gift') {
                        sendGiftForm.reset();
                        sendGiftModal.classList.add('visible');
                    }
                });
                linkGroupWorldBookBtn.addEventListener('click', () => {
                    const group = db.groups.find(g => g.id === currentChatId);
                    if (!group) return;
                    renderCategorizedWorldBookList(worldBookSelectionList, db.worldBooks, group.worldBookIds || [], 'wb-select-group');
                    worldBookSelectionModal.classList.add('visible');
                });
            }

            function renderMemberSelectionList() {
                memberSelectionList.innerHTML = '';
                if (db.characters.length === 0) {
                    memberSelectionList.innerHTML = '<li style="color:#aaa; text-align:center; padding: 10px 0;">没有可选择的人设。</li>';
                    return;
                }
                db.characters.forEach(char => {
                    const li = document.createElement('li');
                    li.className = 'member-selection-item';
                    li.innerHTML = `<input type="checkbox" id="select-${char.id}" value="${char.id}"><img src="${char.avatar}" alt="${char.remarkName}"><label for="select-${char.id}">${char.remarkName}</label>`;
                    memberSelectionList.appendChild(li);
                });
            }

            function loadGroupSettingsToSidebar() {
                const group = db.groups.find(g => g.id === currentChatId);
                if (!group) return;
                const themeSelect = document.getElementById('setting-group-theme-color');
                if (themeSelect.options.length === 0) {
                    Object.keys(colorThemes).forEach(key => {
                        const option = document.createElement('option');
                        option.value = key;
                        option.textContent = colorThemes[key].name;
                        themeSelect.appendChild(option);
                    });
                }
                document.getElementById('setting-group-avatar-preview').src = group.avatar;
                document.getElementById('setting-group-name').value = group.name;
                document.getElementById('setting-group-my-avatar-preview').src = group.me.avatar;
                document.getElementById('setting-group-my-nickname').value = group.me.nickname;
                document.getElementById('setting-group-my-persona').value = group.me.persona;
                themeSelect.value = group.theme || 'white_blue';
                document.getElementById('setting-group-max-memory').value = group.maxMemory;
                renderGroupMembersInSettings(group);
                const useGroupCustomCssCheckbox = document.getElementById('setting-group-use-custom-css'),
                    groupCustomCssTextarea = document.getElementById('setting-group-custom-bubble-css'),
                    groupPreviewBox = document.getElementById('group-bubble-css-preview');
                useGroupCustomCssCheckbox.checked = group.useCustomBubbleCss || false;
                groupCustomCssTextarea.value = group.customBubbleCss || '';
                groupCustomCssTextarea.disabled = !useGroupCustomCssCheckbox.checked;
                const theme = colorThemes[group.theme || 'white_blue'];
                updateBubbleCssPreview(groupPreviewBox, group.customBubbleCss, !group.useCustomBubbleCss, theme);
                populateBubblePresetSelect('group-bubble-preset-select');
            }

            function renderGroupMembersInSettings(group) {
                groupMembersListContainer.innerHTML = '';
                group.members.forEach(member => {
                    const memberDiv = document.createElement('div');
                    memberDiv.className = 'group-member';
                    memberDiv.dataset.id = member.id;
                    memberDiv.innerHTML = `<img src="${member.avatar}" alt="${member.groupNickname}"><span>${member.groupNickname}</span>`;
                    groupMembersListContainer.appendChild(memberDiv);
                });
                const addBtn = document.createElement('div');
                addBtn.className = 'add-member-btn';
                addBtn.innerHTML = `<div class="add-icon">+</div><span>添加</span>`;
                groupMembersListContainer.appendChild(addBtn);
            }

            function renderGroupRecipientSelectionList(actionText) {
                const group = db.groups.find(g => g.id === currentChatId);
                if (!group) return;
                groupRecipientSelectionTitle.textContent = actionText;
                groupRecipientSelectionList.innerHTML = '';
                group.members.forEach(member => {
                    const li = document.createElement('li');
                    li.className = 'group-recipient-select-item';
                    li.innerHTML = `
                        <input type="checkbox" id="recipient-select-${member.id}" value="${member.id}">
                        <label for="recipient-select-${member.id}">
                            <img src="${member.avatar}" alt="${member.groupNickname}">
                            <span>${member.groupNickname}</span>
                        </label>`;
                    groupRecipientSelectionList.appendChild(li);
                });
            }

            async function saveGroupSettingsFromSidebar() {
                const group = db.groups.find(g => g.id === currentChatId);
                if (!group) return;
                const oldName = group.name;
                const newName = document.getElementById('setting-group-name').value;
                if (oldName !== newName) {
                    group.name = newName;
                    sendRenameNotification(group, newName);
                }
                group.avatar = document.getElementById('setting-group-avatar-preview').src;
                group.me.avatar = document.getElementById('setting-group-my-avatar-preview').src;
                group.me.nickname = document.getElementById('setting-group-my-nickname').value;
                group.me.persona = document.getElementById('setting-group-my-persona').value;
                group.theme = document.getElementById('setting-group-theme-color').value;
                group.maxMemory = document.getElementById('setting-group-max-memory').value;
                group.useCustomBubbleCss = document.getElementById('setting-group-use-custom-css').checked;
                group.customBubbleCss = document.getElementById('setting-group-custom-bubble-css').value;
                updateCustomBubbleStyle(currentChatId, group.customBubbleCss, group.useCustomBubbleCss);
                await saveData();
                showToast('群聊设置已保存！');
                chatRoomTitle.textContent = group.name;
                renderChatList();
                renderMessages(false, true);
            }

            function openGroupMemberEditModal(memberId) {
                const group = db.groups.find(g => g.id === currentChatId);
                const member = group.members.find(m => m.id === memberId);
                if (!member) return;
                document.getElementById('edit-group-member-title').textContent = `编辑 ${member.groupNickname}`;
                document.getElementById('editing-member-id').value = member.id;
                document.getElementById('edit-member-avatar-preview').src = member.avatar;
                document.getElementById('edit-member-group-nickname').value = member.groupNickname;
                document.getElementById('edit-member-real-name').value = member.realName;
                document.getElementById('edit-member-persona').value = member.persona;
                editGroupMemberModal.classList.add('visible');
            }

            function renderInviteSelectionList() {
                inviteMemberSelectionList.innerHTML = '';
                const group = db.groups.find(g => g.id === currentChatId);
                if (!group) return;
                const currentMemberCharIds = new Set(group.members.map(m => m.originalCharId));
                const availableChars = db.characters.filter(c => !currentMemberCharIds.has(c.id));
                if (availableChars.length === 0) {
                    inviteMemberSelectionList.innerHTML = '<li style="color:#aaa; text-align:center; padding: 10px 0;">没有可邀请的新成员了。</li>';
                    confirmInviteBtn.disabled = true;
                    return;
                }
                confirmInviteBtn.disabled = false;
                availableChars.forEach(char => {
                    const li = document.createElement('li');
                    li.className = 'invite-member-select-item';
                    li.innerHTML = `<input type="checkbox" id="invite-select-${char.id}" value="${char.id}"><label for="invite-select-${char.id}"><img src="${char.avatar}" alt="${char.remarkName}"><span>${char.remarkName}</span></label>`;
                    inviteMemberSelectionList.appendChild(li);
                });
            }

            function sendInviteNotification(group, newMemberRealName) {
                const messageContent = `[${group.me.nickname}邀请${newMemberRealName}加入了群聊]`;
                const message = {
                    id: `msg_${Date.now()}`,
                    role: 'user',
                    content: messageContent,
                    parts: [{ type: 'text', text: messageContent }],
                    timestamp: Date.now(),
                    senderId: 'user_me'
                };
                group.history.push(message);
            }

            function sendRenameNotification(group, newName) {
                const myName = group.me.nickname;
                const messageContent = `[${myName}修改群名为：${newName}]`;
                const message = {
                    id: `msg_${Date.now()}`,
                    role: 'user',
                    content: messageContent,
                    parts: [{ type: 'text', text: messageContent }],
                    timestamp: Date.now()
                };
                group.history.push(message);
            }