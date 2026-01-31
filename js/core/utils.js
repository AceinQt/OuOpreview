 // js/core/utils.js 追加内容：

function switchScreen(targetId) {
    // 获取所有屏幕元素
    const screens = document.querySelectorAll('.screen');
    screens.forEach(screen => screen.classList.remove('active'));
    
    const targetScreen = document.getElementById(targetId);
    if (targetScreen) {
        targetScreen.classList.add('active');
        
        // 处理不同页面的状态栏颜色 (根据你 index.html 里的逻辑)
        if (typeof setAndroidThemeColor === 'function') {
            switch (targetId) {
                case 'chat-room-screen':
                    setAndroidThemeColor('rgba(243,242,247,0.85)');
                    break;
                case 'forum-screen':
                case 'forum-post-detail-screen':
                case 'favorites-screen':
                case 'peek-screen': // 假设偷看页面也是白色
                    setAndroidThemeColor('#FFFFFF');
                    break;
                case 'journal-detail-screen':
                    setAndroidThemeColor('#F5F2EF');
                    break;
                case 'home-screen':
                    // 如果 db 对象在全局可用
                    if (typeof db !== 'undefined') {
                        setAndroidThemeColor(db.homeStatusBarColor || '#FFFFFF');
                    }
                    break;
                default:
                    setAndroidThemeColor('#FFFFFF');
            }
        }
        
        // 更新底部导航栏高亮
        document.querySelectorAll('.bottom-tab-bar .tab-item').forEach(t => {
            if (t.dataset.target === targetId) {
                t.classList.add('active');
            } else {
                t.classList.remove('active');
            }
        });
    }

    // 关闭所有的遮罩层和侧边栏
    const overlays = document.querySelectorAll('.modal-overlay, .action-sheet-overlay, .settings-sidebar');
    overlays.forEach(o => o.classList.remove('visible', 'open'));
}
            
                       
                                  
                                                        function processToastQueue() {
                if (isToastVisible || notificationQueue.length === 0) {
                    return;
                }

                isToastVisible = true;
                const notification = notificationQueue.shift(); // 取出队列中的第一个通知

                const toastElement = document.getElementById('toast-notification');
                const avatarEl = toastElement.querySelector('.toast-avatar');
                const nameEl = toastElement.querySelector('.toast-name');
                const messageEl = toastElement.querySelector('.toast-message');

                const isRichNotification = typeof notification === 'object' && notification !== null && notification.name;

                if (isRichNotification) {
                    toastElement.classList.remove('simple');
                    avatarEl.style.display = 'block';
                    nameEl.style.display = 'block';
                    messageEl.style.textAlign = 'left';
                    avatarEl.src = notification.avatar || 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg';
                    nameEl.textContent = notification.name;
                    messageEl.textContent = notification.message;
                } else {
                    toastElement.classList.add('simple');
                    avatarEl.style.display = 'none';
                    nameEl.style.display = 'none';
                    messageEl.style.textAlign = 'center';
                    messageEl.textContent = notification;
                }

                toastElement.classList.add('show');

                // 设置定时器，在通知显示一段时间后将其隐藏
                setTimeout(() => {
                    toastElement.classList.remove('show');

                    // 等待隐藏动画（0.5秒）结束后，处理下一个通知
                    setTimeout(() => {
                        isToastVisible = false;
                        processToastQueue(); // 尝试处理队列中的下一个通知
                    }, 500);

                }, 1500); // 通知显示时间（1.5秒）
            }
            const showToast = (notification) => {
                notificationQueue.push(notification); // 将通知加入队列
                processToastQueue(); // 尝试处理队列
            };
            

           // 显示持久化的加载提示 (居中 + showToast风格)
            function showLoadingToast(message) {
                // 1. 创建元素
                const toast = document.createElement('div');
                toast.className = 'toast loading'; // 应用我们刚才写的 CSS 类

                // 2. 填充内容 (Spinner + 文字)
                toast.innerHTML = `
        <div class="toast-spinner"></div>
        <div style="font-size: 15px; font-weight: 500; color: #333;">${message}</div>
    `;

                // 3. 添加到页面
                document.body.appendChild(toast);

                // 4. 触发显示动画 (微小延迟确保 CSS transition 生效)
                requestAnimationFrame(() => {
                    toast.classList.add('show');
                });

                // 5. 返回一个“关闭函数”，供外部调用以关闭这个提示
                return function hide() {
                    toast.classList.remove('show'); // 淡出
                    // 等待淡出动画结束后从 DOM 移除
                    setTimeout(() => {
                        if (toast.parentNode) toast.parentNode.removeChild(toast);
                    }, 300);
                };
            }

            
         // 动态修改安卓状态栏颜色
function setAndroidThemeColor(color) {
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
        meta = document.createElement('meta');
        meta.name = "theme-color";
        document.head.appendChild(meta);
    }
    meta.content = color;
}

// 压缩图片

            async function compressImage(file, options = {}) {
                const {
                    quality = 0.8, maxWidth = 800, maxHeight = 800
                } = options;

                // --- 新增：处理GIF动图 ---
                // 如果文件是GIF，则不经过canvas压缩，直接返回原始文件数据以保留动画
                if (file.type === 'image/gif') {
                    return new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.readAsDataURL(file);
                        reader.onload = () => resolve(reader.result);
                        reader.onerror = error => reject(error);
                    });
                }

                // --- 对其他静态图片（如PNG, JPG）进行压缩 ---
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.readAsDataURL(file);
                    reader.onerror = reject;
                    reader.onload = (event) => {
                        const img = new Image();
                        img.src = event.target.result;
                        img.onerror = reject;
                        img.onload = () => {
                            let width = img.width;
                            let height = img.height;

                            if (width > height) {
                                if (width > maxWidth) {
                                    height = Math.round(height * (maxWidth / width));
                                    width = maxWidth;
                                }
                            } else {
                                if (height > maxHeight) {
                                    width = Math.round(width * (maxHeight / height));
                                    height = maxHeight;
                                }
                            }

                            const canvas = document.createElement('canvas');
                            canvas.width = width;
                            canvas.height = height;
                            const ctx = canvas.getContext('2d');

                            // 对于有透明背景的PNG图片，先填充一个白色背景
                            // 这样可以防止透明区域在转换成JPEG时变黑
                            if (file.type === 'image/png') {
                                ctx.fillStyle = '#FFFFFF'; // 白色背景
                                ctx.fillRect(0, 0, width, height);
                            }

                            ctx.drawImage(img, 0, 0, width, height);

                            // --- 关键修正：将输出格式改为 'image/jpeg' ---
                            // JPEG格式可以显著减小文件大小，避免浏览器处理超大Base64字符串时崩溃
                            const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
                            resolve(compressedDataUrl);
                        };
                    };
                });
            }
            
 // --- 通用复制函数 (兼容所有环境) ---
        async function copyTextToClipboard(text) {
            if (!text) return Promise.reject('没有内容可复制');

            // 优先尝试标准 API (需要 HTTPS 或 localhost)
            if (navigator.clipboard && window.isSecureContext) {
                try {
                    await navigator.clipboard.writeText(text);
                    return Promise.resolve();
                } catch (err) {
                    console.warn('Clipboard API failed, trying fallback...', err);
                }
            }

            // 回退方案：使用传统的 textarea + execCommand
            // 这种方法在绝大多数 Webview 和 HTTP 环境下都能工作
            return new Promise((resolve, reject) => {
                try {
                    const textArea = document.createElement("textarea");
                    textArea.value = text;
                    
                    // 防止在移动端拉起键盘或造成页面滚动
                    textArea.style.position = "fixed";
                    textArea.style.left = "-9999px";
                    textArea.style.top = "0";
                    textArea.setAttribute("readonly", "");
                    
                    document.body.appendChild(textArea);
                    textArea.focus();
                    textArea.select();
                    
                    const successful = document.execCommand('copy');
                    document.body.removeChild(textArea);
                    
                    if (successful) {
                        resolve();
                    } else {
                        reject(new Error('execCommand returned false'));
                    }
                } catch (err) {
                    reject(err);
                }
            });
        }
        
 