// 角色卡导入：PNG / JSON 共用转换与落盘，角色、世界书和正则必须整批成功。
const importBtn = document.getElementById('import-character-card-btn');
const cardInput = document.getElementById('character-card-input');
importBtn.addEventListener('click', () => cardInput.click());
cardInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleCharacterImport(file);
    // 重置输入框，以便可以再次选择相同的文件。
    e.target.value = null;
});

/** 处理用户选择的角色卡文件，解析和业务落盘的错误统一反馈。 */
async function handleCharacterImport(file) {
    if (!file) return;
    try {
        const name = file.name.toLowerCase();
        if (name.endsWith('.png')) await parseCharPng(file);
        else if (name.endsWith('.json')) await parseCharJson(file);
        else throw new Error('不支持的文件格式。请选择 .png 或 .json 文件。');
    } catch (error) {
        console.error('角色卡导入失败:', error);
        showToast(`导入失败: ${error.message}`);
    }
}

// 先注册回调再开始读取；解析器要返回创建角色的 Promise，不能读完文件就提前报成功。
function readCharacterCardFile(file, method, encoding) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = () => reject(new Error('读取角色卡文件失败。'));
        reader.onabort = () => reject(new Error('读取角色卡已取消。'));
        reader[method](file, encoding);
    });
}

/** 解析 PNG 文本块里的 Base64 角色数据，并以原图作为头像。 */
async function parseCharPng(file) {
    const buffer = await readCharacterCardFile(file, 'readAsArrayBuffer');
    const view = new DataView(buffer);
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (view.byteLength < 8 || signature.some((byte, index) => view.getUint8(index) !== byte)) {
        throw new Error('文件不是一个有效的PNG。');
    }

    let offset = 8; // 跳过签名，后续每块由长度、类型、内容、CRC 校验组成。
    let charaData = null;
    while (offset + 12 <= view.byteLength) {
        const length = view.getUint32(offset);
        if (length > view.byteLength - offset - 12) throw new Error('PNG数据块不完整。');
        const type = new TextDecoder().decode(new Uint8Array(buffer, offset + 4, 4));
        if (type === 'tEXt') {
            const chunk = new Uint8Array(buffer, offset + 8, length);
            const separator = chunk.indexOf(0);
            if (separator !== -1) {
                const keyword = new TextDecoder().decode(chunk.slice(0, separator));
                // V3 卡可能同时携带 chara / ccv3；只选一份，不能把同一组正则导入两遍。
                if (keyword === 'chara' || keyword === 'ccv3') {
                    try {
                        const decoded = atob(new TextDecoder().decode(chunk.slice(separator + 1)));
                        const bytes = Uint8Array.from(decoded, char => char.charCodeAt(0));
                        charaData = JSON.parse(new TextDecoder('utf-8').decode(bytes));
                        break;
                    } catch (error) {
                        throw new Error(`解析角色数据失败: ${error.message}`);
                    }
                }
            }
        }
        offset += 12 + length;
    }
    if (!charaData) throw new Error('在PNG中未找到有效的角色数据。');
    let avatar = './png/avatar_default.jpg';
    try {
        avatar = await readCharacterCardFile(file, 'readAsDataURL');
    } catch (_) {
        // 即使头像转换失败，也用默认头像创建角色；业务落盘失败不能走这个兜底重复导入。
    }
    return createCharacterFromData(charaData, avatar);
}

/** JSON 卡强制使用 UTF-8 解码，没有内置头像时使用默认头像。 */
async function parseCharJson(file) {
    const text = await readCharacterCardFile(file, 'readAsText', 'UTF-8');
    let data;
    try {
        data = JSON.parse(text);
    } catch (error) {
        throw new Error(`解析JSON失败: ${error.message}`);
    }
    return createCharacterFromData(data, './png/avatar_default.jpg');
}

/**
 * 转换酒馆扩展里的整组正则，保持条目顺序，不复用外部 ID（重复导入不能合并旧条目）。
 * 本应用按类别关联，没有酒馆的单条 disabled / 作用位置 / 深度语义，所以只导入、不自动关联。
 * ST 附带规则统一默认勾选 HTML 卡片、仅显示替换；不再猜测模板内容，也不使用原卡的存储模式。
 * HTML 交互仍走现有沙盒，类别关联规则不变。
 */
function convertCharacterRegexScripts(data, charData) {
    const scripts = charData.extensions?.regex_scripts ?? data.extensions?.regex_scripts;
    const rules = [], warnings = [];
    if (scripts == null) return { rules, warnings };
    if (!Array.isArray(scripts)) return { rules, warnings: ['正则扩展不是有效的条目数组，已跳过。'] };
    scripts.forEach((script, index) => {
        if (!script || typeof script !== 'object' || typeof script.findRegex !== 'string') {
            warnings.push(`第 ${index + 1} 条正则缺少匹配表达式，已跳过。`);
            return;
        }
        const name = typeof script.scriptName === 'string' && script.scriptName.trim() ? script.scriptName.trim() : `正则 ${index + 1}`;
        // /表达式/gi 要拆开；没有斜杠包裹或没有标志时保留空 flags，不擅自补 g。
        const literal = script.findRegex.match(/^\/([\s\S]*)\/([a-z]*)$/i);
        const replacement = typeof script.replaceString === 'string' ? script.replaceString.replace(/\{\{match\}\}/gi, () => '$&') : '';
        const rule = {
            id: `regex_rule_${crypto.randomUUID()}`, name,
            pattern: literal ? literal[1] : script.findRegex,
            flags: literal ? literal[2] : '', replacement,
            mode: 'display', html: true, order: index
        };
        // 无效规则也留在目录供修正，不因一条不兼容的表达式丢掉整张卡。
        try { compileRegexDraft(rule); }
        catch (_) { warnings.push(`「${name}」表达式无效，使用前需要修正。`); }
        if (script.disabled === true) warnings.push(`「${name}」在原卡中已关闭；本应用关联类别会使用整类，请先移出或删除不想启用的条目。`);
        if (script.promptOnly === true) warnings.push(`「${name}」的“仅提示词”选项不支持，已按本应用的正文替换导入。`);
        if (Array.isArray(script.placement) && (script.placement.length !== 1 || script.placement[0] !== 2)) {
            warnings.push(`「${name}」的作用位置不能照搬，本应用正则只处理 AI 正文。`);
        }
        if (script.trimStrings?.length || script.minDepth != null || script.maxDepth != null || Number(script.substituteRegex) > 0) {
            warnings.push(`「${name}」含裁剪、深度或表达式宏设置，需手动适配。`);
        }
        if (/\{\{[^{}]+\}\}/.test(rule.pattern + replacement)) warnings.push(`「${name}」含酒馆宏，除替换内容中的 {{match}} 外不会自动展开。`);
        rules.push(rule);
    });
    return { rules, warnings };
}

/** 根据解析数据创建角色，世界书沿用名称去重，正则按角色名新建独立类别。 */
async function createCharacterFromData(data, avatar) {
    // 优先使用酒馆 V2 / V3 的 data 结构，同时保留根级别数据的兼容。
    const charData = data?.data || data;
    if (!charData || typeof charData.name !== 'string' || !charData.name.trim()) {
        throw new Error('角色卡数据无效，缺少角色名称。');
    }
    const newChar = {
        id: `char_${crypto.randomUUID()}`,
        realName: charData.name, remarkName: charData.name,
        persona: charData.description || charData.persona || '',
        avatar: avatar || './png/avatar_default.jpg',
        myName: '', myNickname: '', myPersona: '', myAvatar: './png/avatar_default_me.jpg',
        boundPersonaId: null, theme: 'white_blue', maxMemory: 10, chatBg: '', history: [],
        isPinned: false, status: '在线', worldBookIds: [],
        regexCategoryIds: [], regexCategoryModes: {},
        useCustomBubbleCss: false, customBubbleCss: '', unreadCount: 0,
        memoryJournals: [], journalWorldBookIds: [],
        peekScreenSettings: { wallpaper: '', customIcons: {}, unlockAvatar: '' },
        lastUserMessageTimestamp: null
    };
    const importedRegex = convertCharacterRegexScripts(data, charData);
    const entries = [];
    // 格式一：内嵌 character_book；保留旧导入按条目名称复用已有世界书的约定。
    if (Array.isArray(charData.character_book?.entries)) {
        const category = data.name || charData.name;
        for (const entry of charData.character_book.entries) {
            if (entry && typeof entry.comment === 'string' && entry.comment && typeof entry.content === 'string' && entry.content) {
                entries.push({ name: entry.comment, content: entry.content, category });
            }
        }
    } else {
        // 格式二：通用 world_info / wi 字符串，空行分条，首行为名称、其余为正文。
        const worldInfo = charData.world_info || charData.wi || '';
        if (typeof worldInfo === 'string' && worldInfo.trim()) {
            for (const entryText of worldInfo.split(/\n\s*\n/).filter(entry => entry.trim())) {
                const lines = entryText.trim().split('\n');
                const name = lines[0].trim(), content = lines.slice(1).join('\n').trim();
                if (name && content) entries.push({ name, content, category: '导入的角色设定' });
            }
        }
    }

    // 共用正则写队列；事务内重读最新目录/世界书，避免重名竞态及旧内存覆盖其他窗口。
    await queueRegexWrite(async () => {
        let categories, worldBooks, worldBookCategories;
        await dexieDB.transaction('rw', dexieDB.characters, dexieDB.worldBooks, dexieDB.globalSettings, async () => {
            if (importedRegex.rules.length) {
                const stored = await dexieDB.globalSettings.get('regexCategories');
                categories = normalizeRegexCategories(stored ? stored.value : []);
                const baseName = charData.name.trim();
                const usedNames = new Set(categories.map(category => category.name));
                let name = baseName, suffix = 1;
                while (usedNames.has(name)) name = `${baseName}（${suffix++}）`;
                categories.push({ id: `regex_category_${crypto.randomUUID()}`, name, rules: importedRegex.rules });
                await dexieDB.globalSettings.put({ key: 'regexCategories', value: categories });
            }
            if (entries.length) {
                worldBooks = await dexieDB.worldBooks.toArray();
                const additions = [];
                for (const entry of entries) {
                    let book = worldBooks.find(item => item.name.toLowerCase() === entry.name.toLowerCase());
                    if (!book) {
                        book = { id: `wb_${crypto.randomUUID()}`, ...entry, position: 'after' };
                        worldBooks.push(book);
                        additions.push(book);
                    }
                    if (!newChar.worldBookIds.includes(book.id)) newChar.worldBookIds.push(book.id);
                }
                const stored = await dexieDB.globalSettings.get('worldBookCategories');
                worldBookCategories = collectWorldBookCategories(stored ? stored.value : [], worldBooks);
                if (additions.length) await dexieDB.worldBooks.bulkPut(additions);
                await dexieDB.globalSettings.put({ key: 'worldBookCategories', value: worldBookCategories });
            }
            await dexieDB.characters.put(newChar);
        });
        // 提交成功才发布内存；任意一步失败都不留下半个角色、空目录或孤立世界书。
        if (categories) db.regexCategories = categories;
        if (worldBooks) {
            db.worldBooks = worldBooks;
            db.worldBookCategories = worldBookCategories;
        }
        db.characters.push(newChar);
    });
    renderChatList();
    // 导入的主角是角色，只给一条数量摘要；兼容诊断留在控制台，不再额外弹窗打断。
    if (importedRegex.warnings.length) console.warn('角色卡正则兼容提示:', importedRegex.warnings);
    showToast(`角色“${newChar.remarkName}”已成功导入，附带 ${newChar.worldBookIds.length} 个世界书、${importedRegex.rules.length} 个正则。`);
    return newChar;
}
