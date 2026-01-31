// --- START OF FILE js/settings/backup_data.js ---

// 全局变量防止重复点击
window.isBackupLoading = false;

// --- 核心功能：初始化按钮事件 (被 data_storage.js 调用) ---
window.setupBackupButtons = function() {
    const backupBtn = document.getElementById('btn-backup-full');
    const importInput = document.getElementById('import-data-input');

    // 1. 绑定全量备份按钮 (使用 onclick 强制覆盖，确保手机端响应)
    if (backupBtn) {
        backupBtn.onclick = handleFullBackup; 
    }

    // 2. 绑定导入按钮
    if (importInput) {
        // 先移除旧的监听器防止重复触发
        const newImportInput = importInput.cloneNode(true);
        importInput.parentNode.replaceChild(newImportInput, importInput);
        newImportInput.addEventListener('change', handleImport);
    }
};

// --- 动作：处理全量备份 ---
async function handleFullBackup(e) {
    if (e) e.preventDefault();
    if (window.isBackupLoading) return;

    window.isBackupLoading = true;
    const btn = document.getElementById('btn-backup-full');
    const originalText = btn ? btn.innerHTML : '备份全部数据';
    
    if (btn) {
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 打包中...';
        btn.style.opacity = '0.7';
    }

    try {
        showToast('正在准备导出全部数据...');
        
        // 延时一小会儿让UI刷新
        await new Promise(r => setTimeout(r, 50));

        // 调用核心数据生成函数
        const fullBackupData = await createFullBackupData();
        await downloadData(fullBackupData, '全量备份');
        
        showToast('备份导出成功');
    } catch (err) {
        console.error(err);
        showToast(`导出失败: ${err.message}`);
    } finally {
        window.isBackupLoading = false;
        if (btn) {
            btn.innerHTML = originalText;
            btn.style.opacity = '1';
        }
    }
}

// --- 动作：处理单项导出 (被 data_storage.js 中的列表按钮调用) ---
window.exportPartialData = async function(categoryKey) {
    if (window.isBackupLoading) return;
    window.isBackupLoading = true;

    try {
        showToast(`正在导出: ${categoryKey}...`);

        // 构造基础数据
        const partialData = {
            _exportVersion: '3.0',
            _exportTimestamp: Date.now(),
            _partialType: categoryKey // 标记类型
        };

        // 确保数据库已加载
        if (!window.db) throw new Error("数据库未就绪");

        // 填充数据
        switch (categoryKey) {
            case 'worldBooks':
                partialData.worldBooks = db.worldBooks || [];
                break;
            case 'rpg':
                partialData.rpgProfiles = db.rpgProfiles || [];
                break;
            case 'forum':
                partialData.forumPosts = db.forumPosts || [];
                partialData.forumBindings = db.forumBindings || {};
                partialData.forumUserIdentity = db.forumUserIdentity || {};
                partialData.watchingPostIds = db.watchingPostIds || [];
                partialData.favoritePostIds = db.favoritePostIds || [];
                break;
            case 'personalization':
                partialData.myStickers = db.myStickers || [];
                partialData.wallpaper = db.wallpaper;
                partialData.customIcons = db.customIcons;
                partialData.bubbleCssPresets = db.bubbleCssPresets;
                partialData.globalCss = db.globalCss;
                partialData.globalCssPresets = db.globalCssPresets;
                partialData.homeSignature = db.homeSignature;
                break;
            case 'settings':
                partialData.apiSettings = db.apiSettings;
                partialData.apiPresets = db.apiPresets;
                partialData.pomodoroSettings = db.pomodoroSettings;
                partialData.pomodoroTasks = db.pomodoroTasks;
                partialData.homeScreenMode = db.homeScreenMode;
                partialData.fontUrl = db.fontUrl;
                break;
            case 'characters':
                // --- 修改点：合并导出 ---
                // 导出完整的角色和群组数据，包含 history
                partialData.characters = db.characters || [];
                partialData.groups = db.groups || [];
                break;
            default:
                throw new Error("未知分类");
        }

        await downloadData(partialData, categoryKey);
        showToast(`${categoryKey} 导出完成`);

    } catch (err) {
        console.error(err);
        showToast(`导出错误: ${err.message}`);
    } finally {
        window.isBackupLoading = false;
    }
};

// --- 动作：处理导入 ---
async function handleImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (confirm('此操作将覆盖当前数据，且不可撤销。确定要导入吗？')) {
        try {
            showToast('正在解析文件...');
            
            const decompressionStream = new DecompressionStream('gzip');
            const decompressedStream = file.stream().pipeThrough(decompressionStream);
            const jsonString = await new Response(decompressedStream).text();

            let data = JSON.parse(jsonString);
            
            const importResult = await importBackupData(data);

            if (importResult.success) {
                showToast(`导入成功！${importResult.message}`);
                setTimeout(() => window.location.reload(), 1500);
            } else {
                alert(`导入失败: ${importResult.error}`);
            }
        } catch (error) {
            console.error("Import error:", error);
            alert(`文件解析错误: ${error.message}`);
        } finally {
            event.target.value = null; 
        }
    } else {
        event.target.value = null;
    }
}

// --- 逻辑：构造全量数据 ---
async function createFullBackupData() {
    const backupData = JSON.parse(JSON.stringify(db));
    backupData._exportVersion = '3.0';
    backupData._exportTimestamp = Date.now();
    return backupData;
}

// --- 逻辑：执行下载 ---
async function downloadData(dataObj, filenameSuffix) {
    const jsonString = JSON.stringify(dataObj);
    const dataBlob = new Blob([jsonString]);

    const compressionStream = new CompressionStream('gzip');
    const compressedStream = dataBlob.stream().pipeThrough(compressionStream);
    const compressedBlob = await new Response(compressedStream, { headers: { 'Content-Type': 'application/octet-stream' } }).blob();

    const url = URL.createObjectURL(compressedBlob);
    const a = document.createElement('a');
    
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toTimeString().slice(0, 8).replace(/:/g, '');
    
    a.href = url;
    a.download = `QChat_${filenameSuffix}_${date}_${time}.ee`;
    
    document.body.appendChild(a);
    a.click();
    
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
}

// --- 逻辑：执行导入合并 ---
async function importBackupData(data) {
    const startTime = Date.now();
    try {
        const isPartial = !!data._partialType;
        let message = "";

        if (!isPartial) {
            if (typeof dexieDB !== 'undefined') {
                await Promise.all([
                    dexieDB.characters.clear(),
                    dexieDB.groups.clear(),
                    dexieDB.worldBooks.clear(),
                    dexieDB.myStickers.clear(),
                    dexieDB.globalSettings.clear()
                ]);
            }
            message = "全量数据已恢复";
        } else {
            message = `部分数据 (${data._partialType}) 已合并`;
        }

        let convertedData = data;

        // 兼容性检查
        if (data._exportVersion !== '3.0' && !isPartial) {
            const reassembleHistory = (chat, backupData) => {
                if (!chat.history || !Array.isArray(chat.history) || chat.history.length === 0) return [];
                if (typeof chat.history[0] === 'object' && chat.history[0] !== null) return chat.history;
                if (backupData.__chunks__ && typeof chat.history[0] === 'string') {
                    let fullHistory = [];
                    chat.history.forEach(key => {
                        if (backupData.__chunks__[key]) {
                            try {
                                const chunk = JSON.parse(backupData.__chunks__[key]);
                                fullHistory = fullHistory.concat(chunk);
                            } catch (e) {}
                        }
                    });
                    return fullHistory;
                }
                return [];
            };

            const newData = { ...data };
            if (newData.characters) newData.characters = newData.characters.map(c => ({...c, history: reassembleHistory(c, data)}));
            if (newData.groups) newData.groups = newData.groups.map(g => ({...g, history: reassembleHistory(g, data)}));
            convertedData = newData;
        }

        Object.keys(db).forEach(key => {
            if (convertedData[key] !== undefined) {
                // 部分导入且是数组
                if (isPartial && Array.isArray(db[key]) && key !== 'characters' && key !== 'groups') {
                    const existingIds = new Set(db[key].map(i => i.id));
                    convertedData[key].forEach(item => {
                        if (!existingIds.has(item.id)) db[key].push(item);
                        else {
                            const idx = db[key].findIndex(i => i.id === item.id);
                            if (idx !== -1) db[key][idx] = item;
                        }
                    });
                } 
                // 角色/群组部分导入 (现在包含历史了)
                else if (isPartial && (key === 'characters' || key === 'groups')) {
                    convertedData[key].forEach(newItem => {
                        const existingItem = db[key].find(i => i.id === newItem.id);
                        if (existingItem) {
                            // 覆盖更新 (Object.assign 会合并属性，包括 history)
                            Object.assign(existingItem, newItem);
                        } else {
                            db[key].push(newItem);
                        }
                    });
                } 
                else {
                    db[key] = convertedData[key];
                }
            }
        });

        if (!db.pomodoroTasks) db.pomodoroTasks = [];
        if (!db.pomodoroSettings) db.pomodoroSettings = { boundCharId: null, userPersona: '', focusBackground: '', taskCardBackground: '', encouragementMinutes: 25, pokeLimit: 5, globalWorldBookIds: [] };
        if (!db.insWidgetSettings) db.insWidgetSettings = { avatar1: 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg', bubble1: 'love u.', avatar2: 'https://i.postimg.cc/GtbTnxhP/o-o-1.jpg', bubble2: 'miss u.' };
        if (!db.homeWidgetSettings && typeof defaultWidgetSettings !== 'undefined') {
            db.homeWidgetSettings = JSON.parse(JSON.stringify(defaultWidgetSettings));
        }

        if (typeof saveData === 'function') {
            await saveData(db);
        }

        const duration = Date.now() - startTime;
        return { success: true, message: `${message} (耗时${duration}ms)` };

    } catch (error) {
        console.error('导入数据失败:', error);
        return { success: false, error: error.message };
    }
}

// --- GitHub Sync Logic ---

const GH_CONFIG_KEY = 'qchat_github_config';
const BACKUP_FILE_NAME = 'qchat_auto_backup.json';

const GitHubService = {
    // 获取配置
    getConfig: () => {
        try {
            return JSON.parse(localStorage.getItem(GH_CONFIG_KEY));
        } catch (e) { return null; }
    },

    // 保存配置
    saveConfig: (token, username, repo, autoBackup) => {
        const config = { token, username, repo, autoBackup };
        localStorage.setItem(GH_CONFIG_KEY, JSON.stringify(config));
        return config;
    },

    // 解决中文 Base64 编码问题
    utf8_to_b64: (str) => {
        return window.btoa(unescape(encodeURIComponent(str)));
    },

    // 解决中文 Base64 解码问题
    b64_to_utf8: (str) => {
        return decodeURIComponent(escape(window.atob(str)));
    },

    // 获取文件信息 (主要为了拿到 SHA)
    getFileInfo: async (config) => {
        const url = `https://api.github.com/repos/${config.username}/${config.repo}/contents/${BACKUP_FILE_NAME}`;
        const response = await fetch(url, {
            headers: {
                'Authorization': `token ${config.token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        if (response.status === 404) return null; // 文件不存在
        if (!response.ok) throw new Error(`GitHub 连接失败: ${response.status}`);
        return await response.json();
    },

    // 上传文件
    upload: async (dataObj) => {
        const config = GitHubService.getConfig();
        if (!config) throw new Error("请先配置 GitHub 连接");

        // 1. 准备数据
        const contentStr = JSON.stringify(dataObj);
        const contentBase64 = GitHubService.utf8_to_b64(contentStr);

        // 2. 检查文件是否存在以获取 SHA
        let sha = null;
        try {
            const existingFile = await GitHubService.getFileInfo(config);
            if (existingFile) {
                sha = existingFile.sha;
            }
        } catch (e) {
            console.warn("检查文件失败，尝试直接创建", e);
        }

        // 3. 发送 PUT 请求
        const url = `https://api.github.com/repos/${config.username}/${config.repo}/contents/${BACKUP_FILE_NAME}`;
        const body = {
            message: `Auto backup: ${new Date().toLocaleString()}`,
            content: contentBase64
        };
        if (sha) body.sha = sha;

        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${config.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.message || "上传失败");
        }
        
        // 更新最后备份时间 UI
        GitHubService.updateUIState(true, new Date());
        return true;
    },

    // 下载文件
    download: async () => {
        const config = GitHubService.getConfig();
        if (!config) throw new Error("请先配置 GitHub 连接");

        const fileInfo = await GitHubService.getFileInfo(config);
        if (!fileInfo) throw new Error("仓库中没有找到备份文件");

        // GitHub API 有时直接返回 content (小文件)，有时需要从 download_url 下载
        let jsonStr = "";
        if (fileInfo.content) {
            // 注意：API 返回的 base64可能有换行符，需要去除
            const cleanBase64 = fileInfo.content.replace(/\n/g, '');
            jsonStr = GitHubService.b64_to_utf8(cleanBase64);
        } else if (fileInfo.download_url) {
            const res = await fetch(fileInfo.download_url);
            jsonStr = await res.text();
        }

        return JSON.parse(jsonStr);
    },

    // 初始化 UI 逻辑
    initUI: () => {
        const config = GitHubService.getConfig();
        const btnConfig = document.getElementById('btn-gh-config');
        const btnUpload = document.getElementById('btn-gh-upload');
        const btnDownload = document.getElementById('btn-gh-download');
        const statusText = document.getElementById('github-status-text');
        const iconBg = document.getElementById('github-status-icon');
        const modal = document.getElementById('github-settings-modal');
        const lastSync = document.getElementById('github-last-sync');

        // 绑定配置按钮
        btnConfig.onclick = () => {
            modal.classList.add('visible');
            if (config) {
                document.getElementById('gh-token-input').value = config.token;
                document.getElementById('gh-username-input').value = config.username;
                document.getElementById('gh-repo-input').value = config.repo;
                document.getElementById('gh-auto-backup-switch').checked = config.autoBackup;
            }
        };

        // 绑定取消按钮
        document.getElementById('btn-gh-cancel').onclick = () => modal.classList.remove('visible');

        // 绑定保存按钮
        document.getElementById('btn-gh-save').onclick = async () => {
            const token = document.getElementById('gh-token-input').value.trim();
            const username = document.getElementById('gh-username-input').value.trim();
            const repo = document.getElementById('gh-repo-input').value.trim();
            const auto = document.getElementById('gh-auto-backup-switch').checked;

            if (!token || !username || !repo) {
                alert("请填写完整信息");
                return;
            }

            GitHubService.saveConfig(token, username, repo, auto);
            modal.classList.remove('visible');
            GitHubService.updateUIState(true);
            showToast("GitHub 配置已保存");
        };

        // 绑定上传按钮
        btnUpload.onclick = async () => {
            if(confirm("确定要覆盖云端备份吗？")) {
                const btn = btnUpload;
                const oldText = btn.innerText;
                btn.innerText = "上传";
                btn.disabled = true;
                try {
                    const data = await createFullBackupData(); // 使用 backup_data.js 里的函数
                    await GitHubService.upload(data);
                    showToast("云端备份成功");
                } catch (e) {
                    alert("上传失败: " + e.message);
                } finally {
                    btn.innerText = oldText;
                    btn.disabled = false;
                }
            }
        };

        // 绑定下载按钮
        btnDownload.onclick = async () => {
            if(confirm("确定要从云端恢复吗？这将覆盖本地当前数据！")) {
                 const btn = btnDownload;
                 const oldText = btn.innerText;
                 btn.innerText = "下载";
                 btn.disabled = true;
                 try {
                     const data = await GitHubService.download();
                     const result = await importBackupData(data); // 使用 backup_data.js 里的函数
                     if (result.success) {
                         alert("恢复成功，即将刷新页面");
                         window.location.reload();
                     } else {
                         alert("恢复失败: " + result.error);
                     }
                 } catch (e) {
                     alert("下载失败: " + e.message);
                 } finally {
                     btn.innerText = oldText;
                     btn.disabled = false;
                 }
            }
        };

        // 初始化状态显示
        GitHubService.updateUIState(!!config);
        

    },

    updateUIState: (isConnected, lastDate) => {
        const btnConfig = document.getElementById('btn-gh-config');
        const btnUpload = document.getElementById('btn-gh-upload');
        const btnDownload = document.getElementById('btn-gh-download');
        const statusText = document.getElementById('github-status-text');
        const iconBg = document.getElementById('github-status-icon');
        const lastSync = document.getElementById('github-last-sync');

        if (isConnected) {
            statusText.innerText = "已连接 GitHub";
            statusText.style.color = "#3A9EF6";
            iconBg.style.background = "#3A9EF6";
            btnConfig.innerText = "设置";
            btnUpload.style.display = "inline-block";
            btnDownload.style.display = "inline-block";
            if (lastDate) {
                lastSync.style.display = "block";
                lastSync.innerText = "上次: " + lastDate.toLocaleTimeString();
            }
        } else {
            statusText.innerText = "未连接";
            statusText.style.color = "#888";
            iconBg.style.background = "#24292e";
            btnUpload.style.display = "none";
            btnDownload.style.display = "none";
            lastSync.style.display = "none";
        }
    }
};