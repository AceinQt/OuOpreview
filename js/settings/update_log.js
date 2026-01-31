            const appVersion = "1.3.0"; // Current app version
            const updateLog = [
                {
                    version: "1.3.0",
                    date: "2025-11-11",
                    notes: [
                        "务必仔细观看！重复观看指路→主屏幕的教程app→更新说明！",
                        "新增：双语模式，位于聊天界面的侧边栏内，当char为外国人而你想要更沉浸式的对话时，可按需开启，开启后会将“外文（中文）”的消息识别成双语消息气泡，注意！中文翻译必须在括号内，点击气泡后展开翻译。",
                        "↑补充：如果掉格式如何修改？编辑窗口将翻译括号内的其他括号删掉，比如带括号的颜文字、(笑)等。如果还有bug就先别开这个吧！",
                        "新增：流式传输开关，位于api设置界面，开跟不开不知道有什么区别，总之做了嗯嗯。没改之前默认是流式传输，如果非流出不来就开流式，流式出不来就关流式，都出不来我也没招了！",
                        "新增：拓展css美化代码，指路→主屏幕的自定义app→全局美化css中，下滑。有隐藏头像、底部变简洁、隐藏表情包背景之类的，可自行复制需要的部分放到全局美化中。",
                        "补充教学：发现有些宝宝还有地方不太清楚怎么使用，补充一下",
                        "1. 偷看手机：存储为临时存储，离开char手机页面后，偷看的相关内容将会清空，有喜欢的内容请及时截图",
                        "2. 回忆日记：生成日记后，需点亮该篇日记右上角的☆按钮收藏，收藏后该篇日记才会作为char的回忆加入聊天上下文中",
                        "3. 日记使用拓展方法：日记内容可编辑，当日记篇数过多/char被日记内的主观形容影响性格较大时，可以将你需要保留的日记内容复制给某个ai（豆包、deepseek、哈吉米都行）进行大总结，指令参考：以全客观的、不参杂任何主观情绪，以第三人称视角按照时间顺序总结发生过的事件和关键语句。然后将返回的总结塞进日记收藏加入上下文即可。",
                    ]
                },
                {
                    version: "1.2.0",
                    date: "2025-10-15",
                    notes: [
                        "新增：猫箱图床 (Catbox) 渲染机制，在当前绑定的表情包世界书中包含 'catbox' 关键词即可切换到猫箱模式，注意！iposting图床表情包和猫箱表情包不可同时渲染，只能选择一方。如：绑定了猫箱表情包世界书，就无法渲染过往iposting图床的表情包，不绑定则反之。",
                        "新增：世界书批量删除功能，长按条目即可进入多选删除模式，支持分类全选。",
                    ]
                },
                {
                    version: "1.1.0",
                    date: "2025-10-13",
                    notes: [
                        "重要！！已更换存储方式，请尽快导出原网址的备份并清理浏览器内该网址的数据，并重新在此网址导入备份",
                        "新增：番茄钟，可以创建专注任务并绑定char和自己的人设预设（仅可从预设中选择），在列表中左滑删除任务。专注期间想摸鱼了可以戳一戳头像，ta会对你做出回复。每个专注界面的设置键可以自定义鼓励频率和限制自己戳一戳的次数，超过次数则ta不会再理你，请补药偷懒，努力专注吧！",
                        "新增：两个桌面小组件，现所有小组件都可以通过点击来自定义图片和文字",
                        "优化：修复了存储膨胀的问题，现为测试阶段不确定是否有bug，请勤备份！唯有备份才是安全的！",
                        "优化：修复了一些使用体验上的小问题",
                        "画饼（未来可能会做的）：1.第二页的布局美化 2.日记本、存钱罐、音乐",
                    ]
                }
            ];
              
                                          // --- NEW: Update Log Functions ---
                function renderUpdateLog() {
                    const tutorialContent = document.getElementById('tutorial-content-area');
                    if (!tutorialContent) return;

                    const updateSection = document.createElement('div');
                    updateSection.className = 'tutorial-item'; // Use tutorial-item class, default open

                    let notesHtml = '';
                    updateLog.forEach((log, index) => {
                        notesHtml += `
                        <div style="margin-bottom: 15px; ${index < updateLog.length - 1 ? 'padding-bottom: 10px; border-bottom: 1px solid #f0f0f0;' : ''}">
                            <h4 style="font-size: 15px; color: #333; margin: 0 0 5px 0;">版本 ${log.version} (${log.date})</h4>
                            <ul style="padding-left: 20px; margin: 0; list-style-type: '› ';">
                                ${log.notes.map(note => `<li style="margin-bottom: 5px; color: #666;">${note}</li>`).join('')}
                            </ul>
                        </div>
                    `;
                    });

                    updateSection.innerHTML = `
                    <div class="tutorial-header">更新日志</div>
                    <div class="tutorial-content" style="padding-top: 15px;">
                        ${notesHtml}
                    </div>
                `;

                    tutorialContent.appendChild(updateSection);
                }

                function showUpdateModal() {
                    const modal = document.getElementById('update-log-modal');
                    const contentEl = document.getElementById('update-log-modal-content');
                    const closeBtn = document.getElementById('close-update-log-modal');

                    const latestLog = updateLog[0];
                    if (!latestLog) return;

                    contentEl.innerHTML = `
                    <h4>版本 ${latestLog.version} (${latestLog.date})</h4>
                    <ul>
                        ${latestLog.notes.map(note => `<li>${note}</li>`).join('')}
                    </ul>
                    <p style="font-size: 12px; color: #888; text-align: center; margin-top: 15px; border-top: 1px solid #eee; padding-top: 10px;">过往更新说明可在“教程”应用内查看。</p>
                `;

                    modal.classList.add('visible');

                    closeBtn.onclick = () => {
                        modal.classList.remove('visible');
                        localStorage.setItem('lastSeenVersion', appVersion);
                    };
                }

                function checkForUpdates() {
                    const lastSeenVersion = localStorage.getItem('lastSeenVersion');
                    if (lastSeenVersion !== appVersion) {
                        // Use a small delay to ensure the main UI has rendered
                        setTimeout(showUpdateModal, 500);
                    }
                }
                
  let loadingBtn = false;