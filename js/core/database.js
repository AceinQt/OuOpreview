// 数据库配置项
const globalSettingKeys = [
    'apiSettings', 'wallpaper', 'homeScreenMode', 'fontUrl', 'customIcons',
    'apiPresets', 'bubbleCssPresets', 'myPersonaPresets', 'globalCss',
    'globalCssPresets', 'homeSignature', 'forumPosts', 'forumBindings', 
    'pomodoroTasks', 'pomodoroSettings', 'insWidgetSettings', 
    'homeWidgetSettings', 'watchingPostIds', 'favoritePostIds',
    'forumUserIdentity', 'homeStatusBarColor', 'rpgProfiles'
];

// Dexie 实例初始化
           // --- 数据库Dexie DB Setup ---
            const dexieDB = new Dexie('QChatDB_ee');
            dexieDB.version(1).stores({
                storage: 'key, value'
            });
            dexieDB.version(2).stores({
                characters: '&id',
                groups: '&id',
                worldBooks: '&id',
                myStickers: '&id',
                globalSettings: 'key'
            }).upgrade(async tx => {
                console.log("Upgrading database to version 2...");
                const oldData = await tx.table('storage').get('QChat');
                if (oldData && oldData.value) {
                    console.log("Old data found, starting migration.");
                    const data = JSON.parse(oldData.value);
                    if (data.characters) await tx.table('characters').bulkPut(data.characters);
                    if (data.groups) await tx.table('groups').bulkPut(data.groups);
                    if (data.worldBooks) await tx.table('worldBooks').bulkPut(data.worldBooks);
                    if (data.myStickers) await tx.table('myStickers').bulkPut(data.myStickers);

                    const settingsToMigrate = {
                        apiSettings: data.apiSettings || {},
                        wallpaper: data.wallpaper || 'https://i.postimg.cc/W4Z9R9x4/ins-1.jpg',
                        homeScreenMode: data.homeScreenMode || 'night',
                        fontUrl: data.fontUrl || '',
                        customIcons: data.customIcons || {},
                        apiPresets: data.apiPresets || [],
                        bubbleCssPresets: data.bubbleCssPresets || [],
                        myPersonaPresets: data.myPersonaPresets || [],
                        globalCss: data.globalCss || '',
                        globalCssPresets: data.globalCssPresets || [],
                        homeSignature: data.homeSignature || '编辑个性签名...',
                        forumPosts: data.forumPosts || [],
                        forumBindings: data.forumBindings || {
                            worldBookIds: [], charIds: [], userPersonaIds: [], useChatHistory: false,
                            historyLimit: 50
                        },
                        pomodoroTasks: data.pomodoroTasks || [],
                        pomodoroSettings: data.pomodoroSettings || { boundCharId: null, userPersona: '', focusBackground: '', taskCardBackground: '', encouragementMinutes: 25, pokeLimit: 5, globalWorldBookIds: [] },
                        insWidgetSettings: data.insWidgetSettings || { avatar1: 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg', bubble1: 'love u.', avatar2: 'https://i.postimg.cc/GtbTnxhP/o-o-1.jpg', bubble2: 'miss u.' },
                        homeWidgetSettings: data.homeWidgetSettings || defaultWidgetSettings
                    };

                    const settingsPromises = Object.entries(settingsToMigrate).map(([key, value]) =>
                        tx.table('globalSettings').put({ key, value })
                    );
                    await Promise.all(settingsPromises);
                    // 删除记录             
                    await tx.table('storage').delete('QChat');
                    console.log("Migration complete. Old data removed.");
                } else {
                    console.log("No old data found to migrate.");
                }
            });

            window.saveData = async () => {
                try {
                await dexieDB.transaction('rw', dexieDB.tables, async () => {
                    await dexieDB.characters.bulkPut(db.characters);
                    await dexieDB.groups.bulkPut(db.groups);
                    await dexieDB.worldBooks.bulkPut(db.worldBooks);
                    await dexieDB.myStickers.bulkPut(db.myStickers);

                    const settingsPromises = globalSettingKeys.map(key => {
                        if (db[key] !== undefined) {
                            return dexieDB.globalSettings.put({ key: key, value: db[key] });
                        }
                        return null;
                    }).filter(p => p);
                    await Promise.all(settingsPromises);
                });
                } catch (e) {
        console.error("保存数据失败!!!", e);
        // 如果保存失败，尝试弹窗告诉用户
        if(typeof showToast === 'function') showToast("数据保存失败，请勿关闭页面");
    }
};

            window.loadData = async () => {
                const [characters, groups, worldBooks, myStickers, settingsArray] = await Promise.all([
                    dexieDB.characters.toArray(),
                    dexieDB.groups.toArray(),
                    dexieDB.worldBooks.toArray(),
                    dexieDB.myStickers.toArray(),
                    dexieDB.globalSettings.toArray()
                ]);

                db.characters = characters;
                db.groups = groups;
                db.worldBooks = worldBooks;
                db.myStickers = myStickers;

                const settings = settingsArray.reduce((acc, { key, value }) => {
                    acc[key] = value;
                    return acc;
                }, {});

                globalSettingKeys.forEach(key => {
                    const defaultValue = {
                        apiSettings: {},
                        wallpaper: 'https://i.postimg.cc/W4Z9R9x4/ins-1.jpg',
                        homeScreenMode: 'night',
                        fontUrl: '',
                        customIcons: {},
                        apiPresets: [],
                        bubbleCssPresets: [],
                        myPersonaPresets: [],
                        globalCss: '',
                        globalCssPresets: [],
                        homeSignature: '编辑个性签名...',
                        forumPosts: [],
                        // --- 新增：默认身份 ---
                        forumUserIdentity: {
                            nickname: '新用户',
                            avatar: 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg',
                            persona: ''
                        },
                        forumBindings: {
                            worldBookIds: [], charIds: [], userPersonaIds: [], useChatHistory: false,
                            historyLimit: 50
                        },
                        pomodoroTasks: [],
                        pomodoroSettings: { boundCharId: null, userPersona: '', focusBackground: '', taskCardBackground: '', encouragementMinutes: 25, pokeLimit: 5, globalWorldBookIds: [] },
                        insWidgetSettings: { avatar1: 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg', bubble1: 'love u.', avatar2: 'https://i.postimg.cc/GtbTnxhP/o-o-1.jpg', bubble2: 'miss u.' },
                        homeWidgetSettings: defaultWidgetSettings
                    };
                    // 深度合并逻辑，防止新字段丢失
                    if (settings[key] !== undefined) {
                        db[key] = settings[key];
                        // 特殊处理：如果读取到了旧数据，但旧数据里缺了 forumUserIdentity，手动补上
                        if (key === 'forumUserIdentity' && !db[key]) {
                            db[key] = defaultValue.forumUserIdentity;
                        }
                    } else {
                        db[key] = defaultValue[key] !== undefined ? JSON.parse(JSON.stringify(defaultValue[key])) : undefined;
                    }
                });

                // 兜底检查：万一 forumUserIdentity 还是空的
                if (!db.forumUserIdentity) {
                    db.forumUserIdentity = { nickname: '新用户', avatar: 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg', persona: '' };
                }

                // ... (原有的 Data integrity checks 保持不变) ...
                db.characters.forEach(c => {
                    if (c.isPinned === undefined) c.isPinned = false;
                    if (c.status === undefined) c.status = '在线';
                    if (!c.worldBookIds) c.worldBookIds = [];
                    if (c.customBubbleCss === undefined) c.customBubbleCss = '';
                    if (c.useCustomBubbleCss === undefined) c.useCustomBubbleCss = false;
                    // === 新增：日记与总结的兼容性检查 ===
        // 这样写最安全：如果不存在，就给一个空数组
        if (!c.memoryJournals) c.memoryJournals = []; 
        if (!c.memorySummaries) c.memorySummaries = []; // 总结列表
        if (!c.longTermSummaries) c.longTermSummaries = []; // 新增：长期总结数组
        if (!c.journalWorldBookIds) c.journalWorldBookIds = []; // 日记绑定的世界书
        if (!c.summaryWorldBookIds) c.summaryWorldBookIds = []; // 总结绑定的世界书
        if (c.customJournalCss === undefined) c.customJournalCss = '';
                });
                // ... (Groups check 保持不变) ...
                db.groups.forEach(g => {
                    if (g.isPinned === undefined) g.isPinned = false;
                    if (!g.worldBookIds) g.worldBookIds = [];
                    if (g.customBubbleCss === undefined) g.customBubbleCss = '';
                    if (g.useCustomBubbleCss === undefined) g.useCustomBubbleCss = false;
                });

                // Handle old localStorage data if it exists
                const oldLocalStorageData = localStorage.getItem('gemini-chat-app-db');
                if (oldLocalStorageData) {
                    // ... (旧数据迁移逻辑保持不变) ...
                    localStorage.removeItem('gemini-chat-app-db');
                    await loadData();
                }
            };
