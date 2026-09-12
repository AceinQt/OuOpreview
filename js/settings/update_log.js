const appVersion = "Q.2.0"; // Current app version
            const updateLog = [
            {
                    version: "Q.2.0",
                    date: "2026-08-23",
                    notes: [
                        "✨ 新功能",
                        "1.天气地点",
                        "(1)目前只做了和风天气的接口，需要自己去和风天气注册获取 api。免费额度大概是一天 1000 次，注意地点查询、实时天气、24 小时预报是分开计算的；",
                        "(2)「API 设置 > 天气」里有「每日请求上限」，默认 800 次，到了上限当天就不再发请求。和风超额不报错、直接发账单，所以这个计数器是唯一防线，别把它调太高；",
                        "(3)天气 api 界面的「预设名称」请输入【地点】的名称，注入给角色的是这个名称而不是真实城市名，用来适配一些虚拟的地区。举例：预设名称输入了“魔都”，地点选了上海，如果上海下雨，给角色的提示就是魔都下雨；",
                        "(4)配置好天气 api 后，在聊天室右上角侧边栏的「天气地点」里选择地点，并决定是否「加入 24 小时预报」（开启预报就是每次调用 2 次天气 api）。",
                        "2.虚拟定位功能",
                        "(1)聊天室「+」面板新增「发送位置」，输入地点名称和详细地址就能发给 char，很简单的一个功能（因为 char 总是让发定位才增加的……）。",
                        "3.语音功能",
                        "(1)目前仅支持火山引擎（豆包）格式。因为火山方舟送的免费额度快过期了才增加的功能，实际做了才发现火山方舟和豆包语音不是一个接口——方舟走 openai，火山引擎的语音功能是单独的；",
                        "(2)相关音色 id 和复刻音色、设计音色功能请到豆包语音官网查询或设计，拿到 id 以后填入「API 设置 > 语音」的音色预设就可以。免费额度是 60 分钟，音色复刻 40000 字符，免费槽位是 10 个。音色设计可以反复 roll 到想要的，确认前不消耗额度；",
                        "(3)目前只限聊天内的语音消息。在聊天室右上角侧边栏的「音色」里给角色绑定音色后，默认需要点击播放键才生成。如果需要收到消息的时候就立刻生成语音，请在聊天列表右上角设置栏的「语音消息」里打开「收到后自动合成」；",
                        "(4)语音占用的本地空间可在「API 设置 > 语音 > 本地缓存上限」调整。",
                        "4.生图功能",
                        "(1)目前仅支持 openai 兼容，同上理由，用了一下火山方舟的 seedream 免费额度是成功的，4.0 和 4.5 是 200 张，5.0 是 50 张；",
                        "(2)目前只限在聊天内发图片消息。入口在聊天室右上角侧边栏的「图像生成」，先选好生图预设；如果需要出消息的时候就立刻生成图片，在同一个弹窗里打开「自动生成」，但是这样出消息会比较慢；",
                        "(3)「内容约束」是传给语言模型的，可以要求不要出现人之类的；「画面风格」是告诉生图模型的；「参考图」用 vertex 逆向的香蕉试了下是可以读到的，其他渠道不清楚可不可以使用，如果不上传那就只按照文字内容来生图。对生图了解不多，图像内容和质量可能不会那么好|･ω･｀)；",
                        "(4)图片占用的本地空间可在「API 设置 > 图像 > 本地图片缓存上限」调整。",
                        "5.github 仓库功能",
                        "(1)入口在「设置 > GitHub 仓库」，配置后支持语音消息、图片消息在对应 github 仓库同步，不占用本地存储，想听语音或者看历史生图的时候会从 github 下载调用；",
                        "(2)没有开启该功能时，本地只保存最近生成的音频和图片，占用空间在 api 设置界面调整（见上面语音、生图两项）；",
                        "(3)github 受网络影响比较大，所以不能确保每次都能上传成功，特别喜欢的、想要永久保存的音频和图片请及时【下载】。",
                        "🌱 功能优化",
                        "1.聊天室",
                        "(1)支持文字图片和文字语音气泡内容编辑；",
                        "(2)配合语音功能修改了语音气泡样式；",
                        "(3)在线下模式禁用「赠送礼物」「发送位置」功能。",
                        "2.论坛评论优化",
                        "(1)用 js 控制了“哈”的个数，连续超过 10 个会压回 10 个，避免生成大量哈哈哈哈刷屏。",
                        "🔧 问题修复",
                        "1.修复后台消息主动模式无法在聊天界面开启保活的问题；",
                        "2.修复 ios 端桌面图标黑底问题，需重新添加到桌面生效；",
                        "3.修复普通消息偶发丢失问题；",
                        "4.修复聊天搜索按关键词跳转时，跳转位置有误或消息不连续问题；",
                        "5.修复主动模式下收到的转账无法接收的问题；",
                        "6.修复未关闭底部面板就切换到其他聊天窗口时，状态错乱问题；",
                        "7.修复存储备份页面部分数据未统计的问题；",
                        "8.修复转账备注太长时显示不全的问题。"
                    ]
            }
            ];
// ★ 更新日志只保留最新一版，发正式版时**替换**这一条，不要往下堆历史。
// 以前这里堆了 14 个版本（Q.2.0 → 1.1.0）。两个问题：旧条目描述的操作方式早就跟着改版失效
// 了（比如「长按菜单转文字」），留着反而误导人；而且全量渲染出来一万多 px，被折叠条的
// max-height 砍掉一半，后面的版本根本看不见。
// 功能怎么用以教程页（js/settings/tutorial.js 的 usageModules）为准 —— 那边随时更新，
// 改了功能就同步改对应模块，不用等发版。
              
                                          // --- NEW: Update Log Functions ---
                function renderUpdateLog() {
                    const tutorialContent = document.getElementById('tutorial-content-area');
                    if (!tutorialContent) return;

                    const updateSection = document.createElement('div');
                    updateSection.className = 'tutorial-item'; // Use tutorial-item class, default open

                    let notesHtml = '';
                    updateLog.forEach((log, index) => {
                        const isLast = index === updateLog.length - 1;
                        // 版本之间留间距 + 分隔线，最后一版两样都不要 —— 收起时 .tutorial-content
                        // 是 max-height:0 + overflow:hidden，但末尾这 15px margin 在展开时会顶出
                        // 一块比别的条目厚的空白。
                        const sep = isLast ? '' : 'margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #f0f0f0;';
                        notesHtml += `
                        <div style="${sep}">
                            <h4 style="font-size: 15px; color: #333; margin: 0 0 5px 0;">版本 ${log.version} (${log.date})</h4>
                            <ul style="padding-left: 20px; margin: 0; list-style-type: '› ';">
                                ${log.notes.map(note => `<li style="margin-bottom: 5px; color: #666;">${note}</li>`).join('')}
                            </ul>
                        </div>
                    `;
                    });

                    // ★ 这里的 .tutorial-content 不能带 inline style。
                    // 原先写了 style="padding-top: 15px;"，inline 优先级高于 tutorial.css 里
                    // 收起态的 `.tutorial-content { padding: 0 10px }`，于是「更新日志」这一条
                    // 收起时也顶着 15px 的 padding —— 表现就是它比别的条目高一截、底下空一块。
                    // 展开态的内边距交给 `.tutorial-item.open .tutorial-content` 统一管。
                    updateSection.innerHTML = `
                    <div class="tutorial-header">版本更新内容</div>
                    <div class="tutorial-content">
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
                    <p style="font-size: 12px; color: #888; text-align: center; margin-top: 15px; border-top: 1px solid #eee; padding-top: 10px;">完整使用说明可在“教程与更新”内查看。</p>
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