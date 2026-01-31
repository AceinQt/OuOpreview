const chatListContainer = document.getElementById('chat-list-container'),
                noChatsPlaceholder = document.getElementById('no-chats-placeholder'),
                addChatBtn = document.getElementById('add-chat-btn'),
                addCharModal = document.getElementById('add-char-modal'),
                addCharForm = document.getElementById('add-char-form');
            
                                    function setupChatListScreen() {
                renderChatList();
                addChatBtn.addEventListener('click', () => {
                    addCharModal.classList.add('visible');
                    addCharForm.reset();
                });


                chatListContainer.addEventListener('click', (e) => {
                    const chatItem = e.target.closest('.chat-item');
                    if (chatItem) {
                        currentChatId = chatItem.dataset.id;
                        currentChatType = chatItem.dataset.type;
                        openChatRoom(currentChatId, currentChatType);
                    }
                });
                chatListContainer.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    const chatItem = e.target.closest('.chat-item');
                    if (!chatItem) return;
                    handleChatListLongPress(chatItem.dataset.id, chatItem.dataset.type, e.clientX, e.clientY);
                });
                chatListContainer.addEventListener('touchstart', (e) => {
                    const chatItem = e.target.closest('.chat-item');
                    if (!chatItem) return;
                    longPressTimer = setTimeout(() => {
                        const touch = e.touches[0];
                        handleChatListLongPress(chatItem.dataset.id, chatItem.dataset.type, touch.clientX, touch.clientY);
                    }, 400);
                });
                chatListContainer.addEventListener('touchend', () => clearTimeout(longPressTimer));
                chatListContainer.addEventListener('touchmove', () => clearTimeout(longPressTimer));
            }

            function handleChatListLongPress(chatId, chatType, x, y) {
                clearTimeout(longPressTimer);
                const chatItem = (chatType === 'private') ? db.characters.find(c => c.id === chatId) : db.groups.find(g => g.id === chatId);
                if (!chatItem) return;
                const itemName = chatType === 'private' ? chatItem.remarkName : chatItem.name;
                const menuItems = [{
                    label: chatItem.isPinned ? '取消置顶' : '置顶聊天',
                    action: async () => {
                        chatItem.isPinned = !chatItem.isPinned;
                        await saveData();
                        renderChatList();
                    }
                }, {
                    label: '删除聊天',
                    danger: true,
                    action: async () => {
                        if (confirm(`确定要删除与“${itemName}”的聊天记录吗？此操作不可恢复。`)) {
                            if (chatType === 'private') {
                                await dexieDB.characters.delete(chatId);
                                db.characters = db.characters.filter(c => c.id !== chatId);
                            } else {
                                await dexieDB.groups.delete(chatId);
                                db.groups = db.groups.filter(g => g.id !== chatId);
                            }
                            // No need to call saveData() as we've directly manipulated the DB and in-memory object.
                            renderChatList();
                            showToast('聊天已删除');
                        }
                    }
                }];
                createContextMenu(menuItems, x, y);
            }

            function renderChatList() {
                chatListContainer.innerHTML = '';
                const allChats = [...db.characters.map(c => ({ ...c, type: 'private' })), ...db.groups.map(g => ({
                    ...g,
                    type: 'group'
                }))];
                noChatsPlaceholder.style.display = (db.characters.length + db.groups.length) === 0 ? 'block' : 'none';
                const sortedChats = allChats.sort((a, b) => {
                    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
                    const lastMsgTimeA = a.history && a.history.length > 0 ? a.history[a.history.length - 1].timestamp : 0;
                    const lastMsgTimeB = b.history && b.history.length > 0 ? b.history[b.history.length - 1].timestamp : 0;
                    return lastMsgTimeB - lastMsgTimeA;
                });
                sortedChats.forEach(chat => {
                    let lastMessageText = '开始聊天吧...';
                    if (chat.history && chat.history.length > 0) {
                        const invisibleRegex = /\[.*?(?:接收|退回).*?的转账\]|\[.*?更新状态为：.*?\]|\[.*?已接收礼物\]|\[system:.*?\]|\[.*?邀请.*?加入了群聊\]|\[.*?修改群名为：.*?\]|\[system-display:.*?\]/;
                        const visibleHistory = chat.history.filter(msg => !invisibleRegex.test(msg.content));
                        if (visibleHistory.length > 0) {
                            const lastMsg = visibleHistory[visibleHistory.length - 1];
                            const urlRegex = /^(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|bmp|svg)|data:image\/[a-z]+;base64,)/i;
                            const imageRecogRegex = /\[.*?发来了一张图片：\]/
                            const voiceRegex = /\[.*?的语音：.*?\]/;
                            const photoVideoRegex = /\[.*?发来的照片\/视频：.*?\]/;
                            const transferRegex = /\[.*?的转账：.*?元.*?\]|\[.*?给你转账：.*?元.*?\]|\[.*?向.*?转账：.*?元.*?\]/;
                            const stickerRegex = /\[.*?的表情包：.*?\]|\[.*?发送的表情包：.*?\]/;
                            const giftRegex = /\[.*?送来的礼物：.*?\]|\[.*?向.*?送来了礼物：.*?\]/;



                            if (giftRegex.test(lastMsg.content)) {
                                lastMessageText = '[礼物]';
                            } else if (stickerRegex.test(lastMsg.content)) {
                                lastMessageText = '[表情包]';
                            } else if (voiceRegex.test(lastMsg.content)) {
                                lastMessageText = '[语音]';
                            } else if (photoVideoRegex.test(lastMsg.content)) {
                                lastMessageText = '[照片/视频]';
                            } else if (transferRegex.test(lastMsg.content)) {
                                lastMessageText = '[转账]';
                            } else if (imageRecogRegex.test(lastMsg.content) || (lastMsg.parts && lastMsg.parts.some(p => p.type === 'image'))) {
                                lastMessageText = '[图片]';
                            } else if ((lastMsg.parts && lastMsg.parts.some(p => p.type === 'html'))) {
                                lastMessageText = '[互动]';
                            } else {
                                    let text = lastMsg.content.trim();
                                    
// 1. 尝试匹配中文冒号的标准格式 [名字：内容]
                                    const plainTextMatch = text.match(/^\[.*?：([\s\S]*)\]$/);
                                    
                                    // 2. 尝试匹配英文冒号的旁白格式 [system-narration:内容]
                                    const narrationMatch = text.match(/^\[system-narration:([\s\S]+?)\]$/);

                                    // 3. 【新增】尝试匹配剧情旁白格式 (兼容中英文冒号)
                                    const contextMatch = text.match(/^\[剧情旁白[:：]([\s\S]+?)\]$/);

                                    if (narrationMatch) {
                                        // 如果是系统旁白，提取内容
                                        text = narrationMatch[1].trim();
                                    } else if (contextMatch) {
                                        // 【新增】如果是剧情旁白，提取内容
                                        text = contextMatch[1].trim();
                                    } else if (plainTextMatch && plainTextMatch[1]) {
                                        // 如果是普通消息，提取内容
                                        text = plainTextMatch[1].trim();
                                    }

                                    // 3. 清理末尾可能的时间戳
                                    text = text.replace(/\[发送时间:.*?\]$/, '').trim(); 
                                    
                                    const htmlRegex = /<[a-z][\s\S]*>/i;
                                    if (htmlRegex.test(text)) {
                                        lastMessageText = '[互动]';
                                    } else {
                                        lastMessageText = urlRegex.test(text) ? '[图片]' : text;
                                    }
                                }
                        } else {
                            const lastEverMsg = chat.history[chat.history.length - 1];
                            const inviteRegex = /\[(.*?)邀请(.*?)加入了群聊\]/;
                            const renameRegex = /\[.*?修改群名为：.*?\]/;
                            const timeSkipRegex = /\[system-display:([\s\S]+?)\]/;
                            const timeSkipMatch = lastEverMsg.content.match(timeSkipRegex);

                            if (timeSkipMatch) {
                                lastMessageText = timeSkipMatch[1];
                            } else if (inviteRegex.test(lastEverMsg.content)) {
                                lastMessageText = '新成员加入了群聊';
                            } else if (renameRegex.test(lastEverMsg.content)) {
                                lastMessageText = '群聊名称已修改';
                            } else {
                                lastMessageText = 'ta正在等你';
                            }

                        }
                    }
                    const li = document.createElement('li');
                    li.className = 'list-item chat-item';
                    if (chat.isPinned) li.classList.add('pinned');
                    li.dataset.id = chat.id;
                    li.dataset.type = chat.type;
                    const avatarClass = chat.type === 'group' ? 'group-avatar' : '';
                    const itemName = chat.type === 'private' ? chat.remarkName : chat.name;
                    const pinBadgeHTML = chat.isPinned ? '<span class="pin-badge">置顶</span>' : '';
                    let timeString = '';
                    const lastMessage = chat.history && chat.history.length > 0 ? chat.history[chat.history.length - 1] : null;
                    if (lastMessage) {
                        const date = new Date(lastMessage.timestamp);
                        const now = new Date();
                        if (date.toDateString() === now.toDateString()) {
                            timeString = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
                        } else {
                            timeString = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
                        }
                    }

                    const unreadCount = chat.unreadCount || 0;
                    const unreadBadgeHTML = unreadCount > 0
                        ? `<span class="unread-badge visible">${unreadCount > 99 ? '99+' : unreadCount}</span>`
                        : `<span class="unread-badge"></span>`;

                    li.innerHTML = `
<img src="${chat.avatar}" alt="${itemName}" class="chat-avatar ${avatarClass}">
<div class="item-details">
    <div class="item-details-row">
        <div class="item-name">${itemName}</div>
        <div class="item-meta">
            <span class="item-time">${timeString}</span>
        </div>
    </div>
    <div class="item-preview-wrapper">
        <div class="item-preview">${lastMessageText}</div>
        ${pinBadgeHTML}
    </div>
</div>
${unreadBadgeHTML}`; /* <-- 将红点元素移动到这里 */


                    chatListContainer.appendChild(li);
                });
            }