// ============================================================
// api.js  —  API 设置页逻辑（v1.6 重构版）
// ============================================================

// ── 服务商 URL 映射 ──────────────────────────────────────────
const CHAT_PROVIDER_URLS = {
    newapi:   '',
    deepseek: 'https://api.deepseek.com',
    claude:   'https://api.anthropic.com',
    gemini:   'https://generativelanguage.googleapis.com'
};
const EMB_PROVIDER_URLS = {
    newapi: '',
    openai:  'https://api.openai.com',
    gemini:  'https://generativelanguage.googleapis.com'
};
const QWEATHER_API_HOST_PATTERN = /^https:\/\/(?:[a-z0-9-]+\.)+qweatherapi\.com$/i;

// ── 当前激活的 tab ────────────────────────────────────────────
let _currentApiTab = 'chat';

// ── 脏数据状态（有未保存的更改） ──────────────────────────────
let _chatDirty    = false;
let _embDirty     = false;
let _weatherDirty = false;

// ── 暂存预设（新增/复制后尚未写入 db 的预设） ─────────────────
let _stagedPresets = { chat: null, embedding: null };

// ── 当前已加载的预设原始名（用于保存时重命名检测） ─────────────
let _loadedPresetName = { chat: null, embedding: null };

// ============================================================
// 预设 CRUD  （统一存储在 db.apiPresets，用 type 区分）
// ============================================================

/** 获取指定类型的预设列表（旧预设无 type 字段视为 chat） */
function _getPresets(type) {
    return (db.apiPresets || []).filter(p =>
        type === 'chat'
            ? (!p.type || p.type === 'chat')
            : p.type === type
    );
}

/** 读取全部预设（跨类型操作用） */
function _getAllPresets() {
    return db.apiPresets || [];
}

/** 持久化全部预设 */
function _saveAllPresets(arr) {
    db.apiPresets = arr || [];
    saveGlobalKeys(['apiPresets']);
}

// ── 脏数据辅助 ───────────────────────────────────────────────
function _markDirty(type) {
    if (type === 'chat') _chatDirty = true;
    else if (type === 'embedding') _embDirty = true;
    else if (type === 'weather') _weatherDirty = true;
}
function _clearDirty(type) {
    if (type === 'chat') _chatDirty = false;
    else if (type === 'embedding') _embDirty = false;
    else if (type === 'weather') _weatherDirty = false;
}
function _isDirtyType(type) {
    if (type === 'chat') return _chatDirty;
    if (type === 'embedding') return _embDirty;
    return _weatherDirty;
}

/** 监听表单字段变化 → 标记脏数据（programmatic _setVal 不触发事件，安全） */
function _watchDirty(type, ids) {
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const evt = (el.type === 'checkbox' || el.tagName === 'SELECT') ? 'change' : 'input';
        el.addEventListener(evt, () => _markDirty(type));
    });
}

// ── 全局默认开关状态管理 ──────────────────────────────────────
/**
 * 当同类型预设列表为空时（即将保存的是第一个预设），
 * 强制勾选"全局默认"并禁用开关；否则恢复可交互。
 */
function _updateDefaultToggleState(type) {
    const checkId = type === 'chat' ? 'api-chat-set-default' : 'api-emb-set-default';
    const el = document.getElementById(checkId);
    if (!el) return;
    if (_getPresets(type).length === 0) {
        el.disabled = true;
        el.checked  = true;
    } else {
        el.disabled = false;
    }
}

// ── 生成唯一预设名称 ──────────────────────────────────────────
function _genName(type, base) {
    const taken = _getPresets(type).map(p => p.name);
    let n = 1;
    while (taken.includes(base + n)) n++;
    return base + n;
}

function _genCopyName(type, srcName) {
    const taken = _getPresets(type).map(p => p.name);
    let n = 2;
    while (taken.includes(srcName + n)) n++;
    return srcName + n;
}

// ── 预设名称 input 辅助 ───────────────────────────────────────
function _setPresetNameInput(type, name) {
    const id = type === 'chat' ? 'api-chat-preset-name' : 'api-emb-preset-name';
    _setVal(id, name || '');
}

// ── 填充 Select ──────────────────────────────────────────────
function populateApiSelect(type) {
    const selId = type === 'chat' ? 'api-chat-preset-select' : 'api-emb-preset-select';
    const sel = document.getElementById(selId);
    if (!sel) return;
    const presets = _getPresets(type);
    sel.innerHTML = '<option value="">— 选择预设 —</option>';
    presets.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        sel.appendChild(opt);
    });
    // 回显当前 activePreset
    const activeName = type === 'chat'
        ? (db.apiSettings && db.apiSettings.activePreset)
        : (db.embeddingSettings && db.embeddingSettings.activePreset);
    if (activeName) sel.value = activeName;
}

// ── 将预设 data 写入表单字段（纯数据，不改 select/name input） ─
function _applyDataToForm(type, d) {
    if (!d) return;
    if (type === 'chat') {
        _setVal('api-chat-provider', d.provider || 'newapi');
        _setVal('api-chat-url',      d.url || d.apiUrl || '');
        _setVal('api-chat-key',      d.key || d.apiKey || '');
        if (d.model) {
            const m = document.getElementById('api-chat-model');
            if (m) { m.innerHTML = `<option value="${d.model}">${d.model}</option>`; m.value = d.model; }
        }
        _setChecked('api-chat-stream', d.streamEnabled !== false);
        _setChecked('api-chat-compat', !!d.compatibilityModeEnabled);
        _setVal('api-chat-temp', d.temperature !== undefined ? d.temperature : 0.8);
    } else {
        _setVal('api-emb-provider', d.provider || 'newapi');
        _setVal('api-emb-url',      d.url || d.apiUrl || '');
        _setVal('api-emb-key',      d.key || d.apiKey || '');
        if (d.model) {
            const m = document.getElementById('api-emb-model');
            if (m) { m.innerHTML = `<option value="${d.model}">${d.model}</option>`; m.value = d.model; }
        }
    }
}

/** 清空表单字段 */
function _clearFormFields(type) {
    if (type === 'chat') {
        _setVal('api-chat-provider', 'newapi');
        _setVal('api-chat-url',  '');
        _setVal('api-chat-key',  '');
        const m = document.getElementById('api-chat-model');
        if (m) m.innerHTML = '<option value="">请先拉取模型列表</option>';
        _setChecked('api-chat-stream', false);
        _setChecked('api-chat-compat', false);
        _setVal('api-chat-temp', 0.8);
    } else {
        _setVal('api-emb-provider', 'newapi');
        _setVal('api-emb-url',  '');
        _setVal('api-emb-key',  '');
        const m = document.getElementById('api-emb-model');
        if (m) m.innerHTML = '<option value="">请先拉取模型列表</option>';
    }
}

// ── 应用预设到表单（对外接口，含 name input + 默认开关同步） ──
function applyPresetToForm(type, name) {
    const preset = _getPresets(type).find(p => p.name === name);
    if (!preset) return;
    if (preset.data) _applyDataToForm(type, preset.data);
    _setPresetNameInput(type, name);
    // 同步"是否默认"开关
    const activeName = type === 'chat'
        ? (db.apiSettings && db.apiSettings.activePreset)
        : (db.embeddingSettings && db.embeddingSettings.activePreset);
    _setChecked(
        type === 'chat' ? 'api-chat-set-default' : 'api-emb-set-default',
        activeName === name
    );
    // 记录当前加载的原始预设名（用于保存时重命名检测）
    _loadedPresetName[type] = name;
}

// ── 暂存选项（新增/复制后在 Select 中显示，但未写入 db） ───────
function _addStagedOption(type, name) {
    const selId = type === 'chat' ? 'api-chat-preset-select' : 'api-emb-preset-select';
    const sel = document.getElementById(selId);
    if (!sel) return;
    // 先移除旧的暂存项
    Array.from(sel.options).forEach(o => { if (o.dataset.staged) sel.removeChild(o); });
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name + '（未保存）';
    opt.dataset.staged = 'true';
    sel.appendChild(opt);
    sel.value = name;
}

function _removeStagedOption(type) {
    const selId = type === 'chat' ? 'api-chat-preset-select' : 'api-emb-preset-select';
    const sel = document.getElementById(selId);
    if (!sel) return;
    Array.from(sel.options).forEach(o => { if (o.dataset.staged) sel.removeChild(o); });
}

// ============================================================
// 新增 / 复制 / 保存 / 删除
// ============================================================

/** ① 新增空白预设（暂存，需点保存生效） */
async function _addNewPreset(type) {
    if (_isDirtyType(type)) {
        const go = await AppUI.confirm('您还未保存，是否离开页面？', '提示', '离开', '取消');
        if (!go) return;
    }
    const base = type === 'chat' ? 'api预设' : '向量预设';
    const name = _genName(type, base);
    _stagedPresets[type] = { name, type, isNew: true };
    _loadedPresetName[type] = null;         // 新预设无原始名
    _addStagedOption(type, name);
    _clearFormFields(type);
    _setPresetNameInput(type, name);
    _updateDefaultToggleState(type);        // 若是第一个预设则强制锁定为默认
    _markDirty(type);
}

/** ② 复制当前选中预设（暂存，需点保存生效） */
async function _copyPreset(type) {
    if (_isDirtyType(type)) {
        const go = await AppUI.confirm('您还未保存，是否离开页面？', '提示', '离开', '取消');
        if (!go) return;
    }
    const selId = type === 'chat' ? 'api-chat-preset-select' : 'api-emb-preset-select';
    const currentName = _getVal(selId);
    if (!currentName || currentName === '') return showToast('请先选择要复制的预设');
    const src = _getPresets(type).find(p => p.name === currentName);
    if (!src) return showToast('找不到该预设');
    const newName = _genCopyName(type, currentName);
    _stagedPresets[type] = { name: newName, type };
    _addStagedOption(type, newName);
    if (src.data) _applyDataToForm(type, src.data);
    _setPresetNameInput(type, newName);
    _setChecked(type === 'chat' ? 'api-chat-set-default' : 'api-emb-set-default', false);
    
    _loadedPresetName[type] = null; 

    _markDirty(type);
}

/** ③ 保存当前表单到预设（底部保存按钮也委托此函数） */
async function _savePreset(type) {
    const isChat = type === 'chat';
    const nameInputId    = isChat ? 'api-chat-preset-name' : 'api-emb-preset-name';
    const defaultCheckId = isChat ? 'api-chat-set-default' : 'api-emb-set-default';

    const newName = (_getVal(nameInputId) || '').trim();
    if (!newName) return showToast('请填写预设名称后再保存');

    const data = isChat ? _readChatForm() : _readEmbForm();
    if (!data.model) return showToast(isChat ? '请选择模型后保存！' : '请选择向量模型后保存！');

    const setDefault   = _getChecked(defaultCheckId);
    const originalName = _loadedPresetName[type]; // 当前已加载预设的原始名
    const presets      = _getPresets(type);

    // ── 需求2：重命名检测 ─────────────────────────────────────
    const isRename = !!originalName && newName !== originalName;
    if (isRename) {
        // 检查新名是否与其他已有预设重名
        if (presets.some(p => p.name === newName)) {
            await AppUI.alert(`已存在重名预设「${newName}」，请修改名字`);
            return;
        }
    }

    // ── 需求3：全局默认唯一性确认 ────────────────────────────
    const prevActive = isChat
        ? (db.apiSettings && db.apiSettings.activePreset)
        : (db.embeddingSettings && db.embeddingSettings.activePreset);

    // 只在"想设为默认 且 原来已有其他预设是默认 且 当前预设本身不是全局默认"时才 confirm
    const willReplaceDefault = setDefault && prevActive && prevActive !== originalName;
    if (willReplaceDefault) {
        const ok = await AppUI.confirm(
            `已设置全局默认预设为「${prevActive}」，是否替换为「${newName}」？`,
            '替换全局默认', '替换', '取消'
        );
        if (!ok) return;
    }

    // 提交暂存状态：移除"未保存"临时 option
    if (_stagedPresets[type]) {
        _removeStagedOption(type);
        _stagedPresets[type] = null;
    }

    // ── 写入 db.apiPresets ───────────────────────────────────
    const all = _getAllPresets();
    if (isRename) {
        // 删除原条目，追加新名条目
        const oldIdx = all.findIndex(p =>
            p.name === originalName && (p.type === type || (!p.type && type === 'chat'))
        );
        if (oldIdx >= 0) all.splice(oldIdx, 1);
        all.push({ name: newName, type, data });
    } else {
        // 同名覆盖或新增
        const idx = all.findIndex(p =>
            p.name === newName && (p.type === type || (!p.type && type === 'chat'))
        );
        const preset = { name: newName, type, data };
        if (idx >= 0) all[idx] = preset; else all.push(preset);
    }
    _saveAllPresets(all);

    // ── 计算最终 activePreset ────────────────────────────────

    let activePreset;
    if (setDefault) {
        activePreset = newName;                          // 明确设为默认
    } else if (isRename && prevActive === originalName) {
        activePreset = newName;                          // 重命名了当前全局默认，自动跟随
    } else {
        activePreset = prevActive;                       // 不变
    }

    if (isChat) {
      if (setDefault) {
        // 设为默认：用当前数据更新
        window.db.apiSettings = { ...data, activePreset };
      } else {
        // 未设为默认：从 activePreset 预设里读数据，保证 db.apiSettings 内容和 activePreset 一致
          const activeData = activePreset
            ? (_getPresets('chat').find(p => p.name === activePreset)?.data || {})
            : {};
          window.db.apiSettings = { ...activeData, activePreset };
      }
      await saveGlobalKeys(['apiSettings']);
    } else {
      if (setDefault) {
        window.db.embeddingSettings = { ...data, activePreset };
      } else {
        // 未设为默认：从 activePreset 预设里读数据，保证 db.apiSettings 内容和 activePreset 一致
          const activeData = activePreset
            ? (_getPresets('embedding').find(p => p.name === activePreset)?.data || {})
            : {};
          // ★★★ 核心修复：原来这里漏写了对 window.db.embeddingSettings 的赋值，导致存库前内存未更新
          window.db.embeddingSettings = { ...activeData, activePreset };
      }
      await saveGlobalKeys(['embeddingSettings']);
    }


    // 更新已加载名、刷新 Select、同步开关状态
    _loadedPresetName[type] = newName;
    populateApiSelect(type);
    const sel = document.getElementById(isChat ? 'api-chat-preset-select' : 'api-emb-preset-select');
    if (sel) sel.value = newName;
    _setChecked(defaultCheckId, activePreset === newName);
    _updateDefaultToggleState(type);

    _clearDirty(type);
    showToast('预设已保存：' + newName);
}

/** ④ 删除当前选中预设 */
async function _deletePreset(type) {
    const isChat = type === 'chat';

    // 如果有暂存预设，取消暂存即可（未写入 db，无需删除确认）
    if (_stagedPresets[type]) {
        _removeStagedOption(type);
        _stagedPresets[type] = null;
        _setPresetNameInput(type, '');
        const sel = document.getElementById(isChat ? 'api-chat-preset-select' : 'api-emb-preset-select');
        if (sel) sel.value = '';
        _clearDirty(type);
        showToast('已取消新增');
        return;
    }

    const nameInputId = isChat ? 'api-chat-preset-name' : 'api-emb-preset-name';
    const selId       = isChat ? 'api-chat-preset-select' : 'api-emb-preset-select';
    const name = (_getVal(nameInputId) || _getVal(selId)).trim();
    if (!name) return showToast('请先选择要删除的预设');

    const ok = await AppUI.confirm(`确定删除预设「${name}」？`, '删除预设', '删除', '取消');
    if (!ok) return;

    const all = _getAllPresets();
    const idx = all.findIndex(p =>
        p.name === name && (p.type === type || (!p.type && type === 'chat'))
    );
    if (idx >= 0) all.splice(idx, 1);
    _saveAllPresets(all);

    // 若删的是默认预设，清除 activePreset
    if (isChat) {
        if (db.apiSettings && db.apiSettings.activePreset === name) {
            db.apiSettings.activePreset = undefined;
            saveGlobalKeys(['apiSettings']);
        }
    } else {
        if (db.embeddingSettings && db.embeddingSettings.activePreset === name) {
            db.embeddingSettings.activePreset = undefined;
            saveGlobalKeys(['embeddingSettings']);
        }
    }

    populateApiSelect(type);
    _setPresetNameInput(type, '');
    const sel = document.getElementById(isChat ? 'api-chat-preset-select' : 'api-emb-preset-select');
    if (sel) sel.value = '';
    _loadedPresetName[type] = null;
    _updateDefaultToggleState(type);
    _clearDirty(type);
    showToast('预设已删除');
}

// ============================================================
// 数据迁移（旧用户：将裸数据迁移为「用户默认」预设）
// ============================================================
function _migrateOldSettings() {
    let changed = false;
    const all = _getAllPresets();

    // 文字迁移
    const chatPresets = all.filter(p => !p.type || p.type === 'chat');
    if (chatPresets.length === 0 && db.apiSettings &&
        (db.apiSettings.key || db.apiSettings.apiKey || db.apiSettings.url)) {
        const s = db.apiSettings;
        all.push({
            name: '用户默认',
            type: 'chat',
            data: {
                provider:                 s.provider || 'newapi',
                url:                      s.url || s.apiUrl || '',
                key:                      s.key || s.apiKey || '',
                model:                    s.model || '',
                streamEnabled:            s.streamEnabled !== false,
                compatibilityModeEnabled: !!s.compatibilityModeEnabled,
                temperature:              s.temperature !== undefined ? s.temperature : 0.8
            }
        });
        db.apiSettings.activePreset = '用户默认';
        changed = true;
    }

    // 向量迁移
    const embPresets = all.filter(p => p.type === 'embedding');
    if (embPresets.length === 0 && db.embeddingSettings &&
        (db.embeddingSettings.key || db.embeddingSettings.apiKey || db.embeddingSettings.url)) {
        const s = db.embeddingSettings;
        all.push({
            name: '用户默认',
            type: 'embedding',
            data: {
                provider: s.provider || 'newapi',
                url:      s.url || s.apiUrl || '',
                key:      s.key || s.apiKey || '',
                model:    s.model || ''
            }
        });
        db.embeddingSettings.activePreset = '用户默认';
        changed = true;
    }

    if (changed) {
        _saveAllPresets(all);
        saveGlobalKeys(['apiSettings', 'embeddingSettings']);
    }
}

// ============================================================
// 返回按钮未保存守卫
// ============================================================
function _setupBackGuard() {
    const backBtn = document.querySelector('#api-settings-screen .back-btn');
    if (!backBtn) return;
    // 在捕获阶段拦截，确保先于 body 委托代理执行
    backBtn.addEventListener('click', async (e) => {
        const dirty = _chatDirty || _embDirty || _weatherDirty;
        if (!dirty) return; // 无脏数据，正常冒泡给全局代理
        e.stopPropagation();
        e.preventDefault();
        const leave = await AppUI.confirm('您还未保存，是否离开页面？', '提示', '离开', '取消');
        if (leave) {
            _clearDirty('chat');
            _clearDirty('embedding');
            _clearDirty('weather');
            if (typeof navigateTo === 'function') navigateTo('settings-screen');
        }
    });
}

// ============================================================
// 读取表单
// ============================================================

function _readChatForm() {
    const tempVal = parseFloat(_getVal('api-chat-temp'));
    return {
        provider:                 _getVal('api-chat-provider'),
        url:                      _getVal('api-chat-url'),
        key:                      _getVal('api-chat-key'),
        model:                    _getVal('api-chat-model'),
        streamEnabled:            _getChecked('api-chat-stream'),
        compatibilityModeEnabled: _getChecked('api-chat-compat'),
        // 修复 0 || 0.8 会变成 0.8 的 Bug
        temperature:              isNaN(tempVal) ? 0.8 : tempVal
    };
}

function _readEmbForm() {
    return {
        provider: _getVal('api-emb-provider'),
        url:      _getVal('api-emb-url'),
        key:      _getVal('api-emb-key'),
        model:    _getVal('api-emb-model')
    };
}

// 底部保存按钮对外接口（委托给 _savePreset）
async function saveChatApiSettings() { await _savePreset('chat'); }
async function saveEmbApiSettings()  { await _savePreset('embedding'); }

// ── 导出预设 ─────────────────────────────────────────────────
function exportApiPresets(type) {
    const presets = _getPresets(type);
    if (!presets.length) return showToast('暂无预设可导出');
    const blob = new Blob([JSON.stringify(presets, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `api_${type}_presets.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
}

// ── 导入预设 ─────────────────────────────────────────────────
function importApiPresets(type) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'application/json';
    inp.onchange = function (e) {
        const f = e.target.files[0]; if (!f) return;
        const r = new FileReader();
        r.onload = async function () {
            try {
                const data = JSON.parse(r.result);
                if (!Array.isArray(data)) return await AppUI.alert('文件格式不正确');
                const all = _getAllPresets();
                data.forEach(p => {
                    p.type = p.type || type;
                    const idx = all.findIndex(x =>
                        x.name === p.name && (x.type === p.type || (!x.type && p.type === 'chat'))
                    );
                    if (idx >= 0) all[idx] = p; else all.push(p);
                });
                _saveAllPresets(all);
                populateApiSelect(type);
                showToast(`已导入 ${data.length} 个预设`);
            } catch (ex) { await AppUI.alert('导入失败：' + ex.message); }
        };
        r.readAsText(f);
    };
    inp.click();
}

// ============================================================
// 拉取模型列表 (已适配自定义 AppUI.prompt 手动输入机制)
// ============================================================
async function fetchModels(tabType) {
    const isChat     = tabType === 'chat';
    const urlId      = isChat ? 'api-chat-url'       : 'api-emb-url';
    const keyId      = isChat ? 'api-chat-key'       : 'api-emb-key';
    const modelId    = isChat ? 'api-chat-model'     : 'api-emb-model';
    const btnId      = isChat ? 'api-chat-fetch-btn' : 'api-emb-fetch-btn';
    const providerId = isChat ? 'api-chat-provider'  : 'api-emb-provider';

    let url        = _getVal(urlId).trim();
    const key      = _getVal(keyId).trim();
    const provider = _getVal(providerId);
    const btn      = document.getElementById(btnId);
    const modelSel = document.getElementById(modelId);

    if (!url || !key) return showToast('请先填写 API 地址和密钥！');
    if (url.endsWith('/')) url = url.slice(0, -1);

    let endpoint;
    if (provider === 'gemini') {
        endpoint = `${url}/v1beta/models?key=${getRandomValue(key)}`;
    } else {
        // 智能判断：如果 url 已经以 /v1, /v2, /v3 等结尾，则直接追加 /models
        if (/\/v\d+$/.test(url)) {
            endpoint = `${url}/models`; 
        } else {
            endpoint = `${url}/v1/models`;
        }
    }
    const headers = provider === 'gemini' ? {} : { Authorization: `Bearer ${key}` };

    btn.classList.add('loading'); 
    btn.disabled = true;

    try {
        const res = await fetch(endpoint, { method: 'GET', headers });
        if (!res.ok) {
            const err = new Error(`网络响应错误: ${res.status}`);
            err.response = res; 
            throw err;
        }
        const json = await res.json();
        let models = [];
        // [修复更新] 移除了正则截断逻辑，强制保留厂商前缀的完整模型名
        if (provider !== 'gemini' && json.data) {
            models = json.data.map(e => e.id);
        } else if (provider === 'gemini' && json.models) {
            models = json.models.map(e => e.name.replace('models/', ''));
        }

        modelSel.innerHTML = '';
        if (models.length > 0) {
            models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m; opt.textContent = m;
                modelSel.appendChild(opt);
            });
            showToast('模型列表拉取成功！');
        } else {
            throw new Error('接口未返回任何模型数据');
        }
        
        // 成功时恢复按钮状态
        btn.classList.remove('loading'); 
        btn.disabled = false;

    } catch (ex) {
        // 请求失败，在弹窗前先停止 loading 动画
        btn.classList.remove('loading'); 
        btn.disabled = false;

        // 使用你封装的 AppUI.prompt 组件
        const manualModel = await AppUI.prompt(
            `自动拉取失败: ${ex.message}\n企业级接口通常不支持拉取，请直接手动填写。`, 
            "例如: GLM-5.2", // placeholder
            "手动输入模型", // title
            "确定添加",     // confirmText
            "取消"        // cancelText
        );

        if (manualModel && manualModel.trim() !== '') {
            const m = manualModel.trim();
            // 将输入的模型加入下拉菜单并选中
            modelSel.innerHTML = `<option value="${m}">${m}</option>`;
            modelSel.value = m;
            
            // 重要：因为是通过代码修改的值，必须手动触发 change 事件，
            // 让 _watchDirty 监听到，从而触发保存按钮亮起
            modelSel.dispatchEvent(new Event('change', { bubbles: true }));
            
            showToast('已手动添加模型：' + m);
        } else {
            // 用户点击取消或未输入
            if (typeof showApiError === 'function') {
                showApiError(ex);
            } else {
                showToast('拉取失败，且未输入模型');
            }
            modelSel.innerHTML = '<option value="">拉取失败，请重新获取或手动填写</option>';
        }
    }
}

// ============================================================
// 天气 API 设置与测试（和风天气 API v7 / GeoAPI v2）
// ============================================================

function _normalizeQWeatherHost(value) {
    return String(value || '').trim().replace(/\/+$/, '');
}

function _isValidQWeatherHost(value) {
    return QWEATHER_API_HOST_PATTERN.test(_normalizeQWeatherHost(value));
}

let _weatherDraft = null;
let _weatherLoadedPresetId = '';

function _newWeatherPresetId() {
    return `weather-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function _normalizeWeatherSettings(raw) {
    const source = raw || {};
    const presets = Array.isArray(source.locationPresets) ? source.locationPresets
        .filter(p => p && p.locationId)
        .map(p => ({
            id: p.id || _newWeatherPresetId(),
            name: p.name || p.locationName || p.locationQuery || '未命名地点',
            locationId: String(p.locationId),
            locationName: p.locationName || p.name || p.locationQuery || '',
            locationQuery: p.locationQuery || ''
        })) : [];

    // 兼容单地点旧配置：首次进入并保存时迁移为一个地点预设。
    if (!presets.length && source.locationId) {
        presets.push({
            id: _newWeatherPresetId(),
            name: source.locationName || source.locationQuery || '默认地点',
            locationId: String(source.locationId),
            locationName: source.locationName || source.locationQuery || '',
            locationQuery: source.locationQuery || ''
        });
    }

    const defaultId = presets.some(p => p.id === source.defaultLocationPresetId)
        ? source.defaultLocationPresetId
        : (presets[0] ? presets[0].id : '');
    return {
        enabled: !!source.enabled,
        provider: 'qweather',
        apiHost: source.apiHost || '',
        apiKey: source.apiKey || '',
        // 注：旧配置里的 cacheMinutes 已废弃（实况改成每次都拉），读到也直接忽略，不再写回
        locationPresets: presets,
        defaultLocationPresetId: defaultId,
        dailyLimit: Number(source.dailyLimit) > 0 ? Math.floor(Number(source.dailyLimit)) : 800,
        dailyCount: Number(source.dailyCount) > 0 ? Math.floor(Number(source.dailyCount)) : 0,
        dailyCountDate: source.dailyCountDate || ''
    };
}

// ---- 额度计数器：和风超额不返回 402/429，直接发账单，本地计数器是唯一防线 ----

/** 本地日期 YYYY-MM-DD（不管哪个时区，0 点到 0 点总是 24 小时） */
function _weatherTodayKey() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 当天已经提示过上限的日期，避免每条回复都弹一次
let _weatherLimitToastDate = '';

/** 读当日额度状态；日期对不上视为已归零（真正落库在 _addWeatherUsage） */
function _readWeatherQuota() {
    const settings = _normalizeWeatherSettings(db.weatherSettings);
    const today = _weatherTodayKey();
    return {
        today,
        limit: settings.dailyLimit,
        count: settings.dailyCountDate === today ? settings.dailyCount : 0
    };
}

/** 记账并落库；跨日在这里一并归零 */
async function _addWeatherUsage(times) {
    if (!times) return;
    const { today, count } = _readWeatherQuota();
    db.weatherSettings = { ...(db.weatherSettings || {}), dailyCount: count + times, dailyCountDate: today };
    try {
        await saveGlobalKeys(['weatherSettings']);
    } catch (error) {
        console.warn('天气用量落库失败：', error);
    }
    _refreshWeatherUsageUI();
}

/**
 * 发和风请求前的统一闸门：超额直接拦下，没超就预扣 times 次。
 * ★ 所有真会打到和风的地方都必须走这里（聊天注入、地点查询、实况测试），漏一处计数就不准。
 * @param {number} times 本次准备发几个请求
 * @param {object} opts  oncePerDay=true 时当天只提示一次（给每轮回复都会走的聊天注入用）
 * @returns {Promise<boolean>} false = 已超额，调用方应直接放弃
 */
async function _reserveWeatherQuota(times, { oncePerDay = false } = {}) {
    const quota = _readWeatherQuota();
    if (quota.count + times > quota.limit) {
        if (!oncePerDay || _weatherLimitToastDate !== quota.today) {
            if (oncePerDay) _weatherLimitToastDate = quota.today;
            showToast(`天气请求已达今日上限（${quota.limit} 次），今天不再发请求`);
        }
        return false;
    }
    // 预扣：请求一旦发出就已经计入账单，哪怕它失败了
    await _addWeatherUsage(times);
    return true;
}

/** 天气 Tab 上的"今日已用 N / 上限 M 次" */
function _refreshWeatherUsageUI() {
    const el = document.getElementById('api-weather-usage-display');
    if (!el) return;
    const { limit, count } = _readWeatherQuota();
    el.textContent = `今日已用 ${count} / 上限 ${limit} 次`;
    el.classList.toggle('is-over-limit', count >= limit);
}

// ---- 聊天/群聊侧栏的天气行：数据与文案（侧栏只显示文案，具体设置走 AppUI.form 弹窗）----

/** 弹窗地点下拉的选项数据 */
function getWeatherLocationOptions() {
    const settings = _normalizeWeatherSettings(db.weatherSettings);
    return [
        { value: 'off', label: '不开启' },
        { value: 'inherit', label: '跟随全局默认' },
        ...settings.locationPresets.map(preset => ({ value: `preset:${preset.id}`, label: preset.name }))
    ];
}

/** 聊天字段 → 下拉 value */
function toWeatherSelectValue(mode, presetId = '') {
    const settings = _normalizeWeatherSettings(db.weatherSettings);
    if (mode === 'preset' && settings.locationPresets.some(p => p.id === presetId)) return `preset:${presetId}`;
    return mode === 'inherit' ? 'inherit' : 'off';
}

/** 下拉 value → 聊天字段 */
function parseWeatherSelectValue(value) {
    const raw = value || 'off';
    if (raw.startsWith('preset:')) return { weatherMode: 'preset', weatherLocationPresetId: raw.slice('preset:'.length) };
    if (raw === 'inherit') return { weatherMode: 'inherit', weatherLocationPresetId: '' };
    return { weatherMode: 'off', weatherLocationPresetId: '' };
}

/** 侧栏那一行的显示文案：不开启 / 辉城 / 辉城 · 含预报 */
function formatWeatherSettingLabel(mode, presetId = '', forecastEnabled = false) {
    if (!mode || mode === 'off') return '不开启';
    const settings = _normalizeWeatherSettings(db.weatherSettings);
    let name;
    if (mode === 'preset') {
        const preset = settings.locationPresets.find(p => p.id === presetId);
        name = preset ? preset.name : '地点已删除';
    } else {
        const preset = settings.locationPresets.find(p => p.id === settings.defaultLocationPresetId);
        name = preset ? `跟随全局（${preset.name}）` : '跟随全局默认';
    }
    return forecastEnabled ? `${name} · 含预报` : name;
}

/**
 * 弹出天气设置弹窗（地点 + 是否含 24h 预报）。
 * @param {object} current { weatherMode, weatherLocationPresetId, weatherForecastEnabled }
 * @returns {Promise<object|null>} 同结构的新值；取消返回 null
 */
async function openWeatherSettingDialog(current = {}) {
    const settings = _normalizeWeatherSettings(db.weatherSettings);
    if (!settings.locationPresets.length) {
        await AppUI.alert('还没有可用的天气地点。请先到「API 设置 → 天气」里填好 Host / Key 并添加地点预设。', '天气未配置');
        return null;
    }
    const result = await AppUI.form([
        {
            type: 'select', key: 'location', label: '天气地点',
            options: getWeatherLocationOptions(),
            value: toWeatherSelectValue(current.weatherMode, current.weatherLocationPresetId)
        },
        {
            type: 'switch', key: 'forecast', label: '加入 24 小时预报',
            value: !!current.weatherForecastEnabled
        }
    ], { title: '天气设置', confirmText: '确定' });

    if (!result) return null;
    return {
        ...parseWeatherSelectValue(result.location),
        weatherForecastEnabled: !!result.forecast
    };
}

function _getWeatherCurrentLocation() {
    const locationSelect = document.getElementById('api-weather-location-select');
    const selectedOption = locationSelect && locationSelect.selectedIndex >= 0
        ? locationSelect.options[locationSelect.selectedIndex] : null;
    return {
        locationQuery: _getVal('api-weather-city').trim(),
        locationId: locationSelect ? locationSelect.value : '',
        locationName: selectedOption && selectedOption.value ? selectedOption.textContent : ''
    };
}

function _readWeatherForm() {
    const dailyLimit = parseInt(_getVal('api-weather-daily-limit'), 10);
    // 计数器不是表单字段，从现有配置原样带过去——否则保存天气 Tab 会把当天用量清零
    const quota = _readWeatherQuota();
    return {
        enabled: true,
        provider: 'qweather',
        apiHost: _normalizeQWeatherHost(_getVal('api-weather-host')),
        apiKey: _getVal('api-weather-key').trim(),
        locationPresets: (_weatherDraft && _weatherDraft.locationPresets) || [],
        defaultLocationPresetId: (_weatherDraft && _weatherDraft.defaultLocationPresetId) || '',
        dailyLimit: dailyLimit > 0 ? dailyLimit : 800,
        dailyCount: quota.count,
        dailyCountDate: quota.today
    };
}

function _populateWeatherPresetSelect(selectedId) {
    const select = document.getElementById('api-weather-preset-select');
    if (!select || !_weatherDraft) return;
    select.innerHTML = '<option value="">— 选择地点预设 —</option>';
    _weatherDraft.locationPresets.forEach(preset => {
        const option = document.createElement('option');
        option.value = preset.id;
        option.textContent = preset.name;
        select.appendChild(option);
    });
    select.value = selectedId || _weatherLoadedPresetId || _weatherDraft.defaultLocationPresetId || '';
}

function _setWeatherLocationSelect(location) {
    const select = document.getElementById('api-weather-location-select');
    if (!select) return;
    if (!location || !location.locationId) {
        select.innerHTML = '<option value="">请先查询地点</option>';
        return;
    }
    const label = location.locationName || `${location.locationQuery || '已保存地点'}（${location.locationId}）`;
    select.innerHTML = '';
    const option = document.createElement('option');
    option.value = location.locationId;
    option.textContent = label;
    select.appendChild(option);
}

function _applyWeatherPresetToForm(presetId) {
    const preset = _weatherDraft && _weatherDraft.locationPresets.find(p => p.id === presetId);
    _weatherLoadedPresetId = preset ? preset.id : '';
    _setVal('api-weather-preset-name', preset ? preset.name : '');
    _setChecked('api-weather-set-default', !!preset && preset.id === _weatherDraft.defaultLocationPresetId);
    _setVal('api-weather-city', preset ? (preset.locationQuery || preset.locationName) : '');
    _setWeatherLocationSelect(preset);
    _populateWeatherPresetSelect(_weatherLoadedPresetId);
}

function _syncWeatherPresetFromForm() {
    if (!_weatherDraft) return;
    const location = _getWeatherCurrentLocation();

    // 表单里已选中地点但还没有挂到任何预设：自动创建预设（例如首个地点直接查询后保存）
    if (!_weatherLoadedPresetId && location.locationId) {
        const preset = {
            id: _newWeatherPresetId(),
            name: _getVal('api-weather-preset-name').trim() || location.locationName || location.locationQuery || '默认地点',
            locationId: location.locationId,
            locationName: location.locationName,
            locationQuery: location.locationQuery
        };
        _weatherDraft.locationPresets.push(preset);
        _weatherLoadedPresetId = preset.id;
        if (!_weatherDraft.defaultLocationPresetId || _getChecked('api-weather-set-default')) {
            _weatherDraft.defaultLocationPresetId = preset.id;
        }
        _populateWeatherPresetSelect(preset.id);
        _setVal('api-weather-preset-name', preset.name);
        _setChecked('api-weather-set-default', preset.id === _weatherDraft.defaultLocationPresetId);
        return;
    }

    const preset = _weatherDraft.locationPresets.find(p => p.id === _weatherLoadedPresetId);
    if (!preset) return;
    preset.name = _getVal('api-weather-preset-name').trim() || preset.name;
    preset.locationQuery = location.locationQuery;
    preset.locationId = location.locationId;
    preset.locationName = location.locationName;
    if (_getChecked('api-weather-set-default')) _weatherDraft.defaultLocationPresetId = preset.id;
    else if (_weatherDraft.defaultLocationPresetId === preset.id && _weatherDraft.locationPresets.length > 1) {
        _weatherDraft.defaultLocationPresetId = _weatherDraft.locationPresets.find(p => p.id !== preset.id).id;
    }
}

function _refreshWeatherTabUI() {
    _weatherDraft = _normalizeWeatherSettings(db.weatherSettings);
    _setVal('api-weather-provider', 'qweather');
    _setVal('api-weather-host', _weatherDraft.apiHost);
    _setVal('api-weather-key', _weatherDraft.apiKey);
    _setVal('api-weather-daily-limit', _weatherDraft.dailyLimit);
    _refreshWeatherUsageUI();
    _applyWeatherPresetToForm(_weatherDraft.defaultLocationPresetId || (_weatherDraft.locationPresets[0] || {}).id);
    _setWeatherTestResult('', false, true);
    _clearDirty('weather');
}

function exportWeatherPresets() {
    _syncWeatherPresetFromForm();
    const presets = (_weatherDraft && _weatherDraft.locationPresets) || [];
    if (!presets.length) return showToast('暂无地点预设可导出');
    const blob = new Blob([JSON.stringify(presets, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'api_weather_location_presets.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function importWeatherPresets() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = function (event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async function () {
            try {
                const data = JSON.parse(reader.result);
                if (!Array.isArray(data)) return await AppUI.alert('文件格式不正确');
                _syncWeatherPresetFromForm();
                let count = 0;
                data.forEach(item => {
                    const normalized = _normalizeWeatherSettings({ locationPresets: [item] }).locationPresets[0];
                    if (!normalized || !normalized.locationId) return;
                    normalized.id = _newWeatherPresetId();
                    const taken = _weatherDraft.locationPresets.map(p => p.name);
                    if (taken.includes(normalized.name)) {
                        let suffix = 2;
                        let name = `${normalized.name}${suffix}`;
                        while (taken.includes(name)) name = `${normalized.name}${++suffix}`;
                        normalized.name = name;
                    }
                    _weatherDraft.locationPresets.push(normalized);
                    count++;
                });
                if (!count) return await AppUI.alert('文件中没有可用的地点预设');
                if (!_weatherDraft.defaultLocationPresetId) {
                    _weatherDraft.defaultLocationPresetId = _weatherDraft.locationPresets[0].id;
                }
                _applyWeatherPresetToForm(_weatherDraft.locationPresets[_weatherDraft.locationPresets.length - 1].id);
                _markDirty('weather');
                showToast(`已导入 ${count} 个地点预设，请保存天气配置`);
            } catch (error) {
                await AppUI.alert('导入失败：' + error.message);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

function _addWeatherPreset(copyCurrent = false) {
    _syncWeatherPresetFromForm();
    const source = copyCurrent && _weatherDraft.locationPresets.find(p => p.id === _weatherLoadedPresetId);
    const baseName = source ? source.name : '地点预设';
    const taken = _weatherDraft.locationPresets.map(p => p.name);
    let suffix = source ? 2 : 1;
    let name = `${baseName}${suffix}`;
    while (taken.includes(name)) name = `${baseName}${++suffix}`;
    const preset = source
        ? { ...source, id: _newWeatherPresetId(), name }
        : { id: _newWeatherPresetId(), name, locationId: '', locationName: '', locationQuery: '' };
    _weatherDraft.locationPresets.push(preset);
    if (!_weatherDraft.defaultLocationPresetId) _weatherDraft.defaultLocationPresetId = preset.id;
    _applyWeatherPresetToForm(preset.id);
    _markDirty('weather');
}

async function _deleteWeatherPreset() {
    if (!_weatherLoadedPresetId) return showToast('请先选择要删除的地点预设');
    const preset = _weatherDraft.locationPresets.find(p => p.id === _weatherLoadedPresetId);
    if (!preset) return;
    const ok = await AppUI.confirm(`确定删除地点预设「${preset.name}」？`, '删除地点预设', '删除', '取消');
    if (!ok) return;
    _weatherDraft.locationPresets = _weatherDraft.locationPresets.filter(p => p.id !== preset.id);
    if (_weatherDraft.defaultLocationPresetId === preset.id) {
        _weatherDraft.defaultLocationPresetId = (_weatherDraft.locationPresets[0] || {}).id || '';
    }
    _applyWeatherPresetToForm(_weatherDraft.defaultLocationPresetId || (_weatherDraft.locationPresets[0] || {}).id);
    _markDirty('weather');
}

async function saveWeatherApiSettings() {
    _syncWeatherPresetFromForm();
    const settings = _readWeatherForm();
    if (!_isValidQWeatherHost(settings.apiHost)) return showToast('请填写控制台提供的专属 API Host');
    if (!settings.apiKey) return showToast('请填写 API Key');
    if (!settings.locationPresets.some(p => p.locationId)) return showToast('请至少查询并保存一个地点预设');
    if (!settings.defaultLocationPresetId) return showToast('请设置一个全局默认地点');

    window.db.weatherSettings = settings;
    _weatherDraft = _normalizeWeatherSettings(settings);
    await saveGlobalKeys(['weatherSettings']);
    _clearDirty('weather');
    showToast('和风天气配置已保存');
}

function _setWeatherButtonLoading(id, loading) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.toggle('loading', !!loading);
    btn.disabled = !!loading;
}

function _setWeatherTestResult(message, isError = false, hidden = false) {
    const result = document.getElementById('api-weather-test-result');
    if (!result) return;
    result.textContent = message || '';
    result.hidden = !!hidden;
    result.classList.toggle('is-error', !!isError);
}

async function _readWeatherApiError(response) {
    let detail = '';
    try {
        const text = (await response.text()).trim();
        if (text) {
            try {
                const body = JSON.parse(text);
                detail = body.message || body.code || text;
            } catch (_) {
                detail = text;
            }
        }
    } catch (_) { /* ignore */ }
    return `请求失败（HTTP ${response.status}）${detail ? `：${detail}` : ''}`;
}

function _formatWeatherLocation(item) {
    const parts = [item.name, item.adm2, item.adm1, item.country].filter(Boolean);
    return parts.filter((part, index) => parts.indexOf(part) === index).join(' · ');
}

async function searchWeatherLocations() {
    const apiHost = _normalizeQWeatherHost(_getVal('api-weather-host'));
    const apiKey = _getVal('api-weather-key').trim();
    const query = _getVal('api-weather-city').trim();
    if (!_isValidQWeatherHost(apiHost)) return showToast('请先填写正确的专属 API Host');
    if (!apiKey || !query) return showToast('请先填写 API Key 和城市或地区');
    // GeoAPI 查询同样是一次计费请求
    if (!await _reserveWeatherQuota(1)) return;

    const select = document.getElementById('api-weather-location-select');
    _setWeatherButtonLoading('api-weather-search-btn', true);
    _setWeatherTestResult('', false, true);

    try {
        const params = new URLSearchParams({ location: query, range: 'cn', number: '20', lang: 'zh' });
        const response = await fetch(`${apiHost}/geo/v2/city/lookup?${params.toString()}`, {
            method: 'GET',
            headers: { Accept: 'application/json', 'X-QW-Api-Key': apiKey }
        });
        if (!response.ok) throw new Error(await _readWeatherApiError(response));

        const payload = await response.json();
        if (payload.code !== '200') throw new Error(`和风天气状态码：${payload.code || '未知'}`);
        const locations = Array.isArray(payload.location) ? payload.location : [];
        if (locations.length === 0) throw new Error('未找到匹配地点，请尝试更完整的区县名称');

        select.innerHTML = '<option value="">请选择正确地点</option>';
        locations.forEach(item => {
            const locationId = String(item.id || '').trim();
            if (!locationId) return;
            const option = document.createElement('option');
            option.value = locationId;
            option.textContent = _formatWeatherLocation(item);
            select.appendChild(option);
        });
        if (select.options.length === 1) throw new Error('查询结果缺少可用的 LocationID');

        showToast(`找到 ${select.options.length - 1} 个地点，请选择`);
    } catch (error) {
        if (select) select.innerHTML = '<option value="">地点查询失败</option>';
        _setWeatherTestResult(`地点查询失败：${error.message}`, true);
    } finally {
        _setWeatherButtonLoading('api-weather-search-btn', false);
    }
}

function _applySelectedWeatherLocation() {
    const select = document.getElementById('api-weather-location-select');
    if (!select || !select.value) return;
    _setWeatherTestResult('', false, true);
    _markDirty('weather');
}

// ============================================================
// 聊天运行时天气上下文（按聊天触发，地点级缓存，不写聊天历史）
// ============================================================

// 预报缓存：locationId -> { fetchedAt, payload }。实况不缓存（每次都拉）。
const _weatherForecastCache = new Map();
const WEATHER_FORECAST_TTL_MS = 60 * 60 * 1000; // 1 小时，写死不给 UI

// 条件注入阈值（可按需调整）
const WEATHER_INJECT_RULES = {
    humidityLow: 30,   // 湿度 ≤ 30% 视为干燥才注入
    humidityHigh: 70,  // 湿度 ≥ 70% 视为潮湿才注入
    windScale: 6,      // 风力 ≥ 6 级才注入
    precipMin: 0,      // 降水量 > 0 才注入
    visMax: 5,         // 能见度 ≤ 5km 才注入
    tempDiff: 5,       // 未来 24h 与当前温差 ≥ 5℃ 才提醒
    popMin: 60,        // 降水概率 ≥ 60% 视为可能降雨
    maxAlerts: 3       // 天气提醒最多注入条数
};

/** 解析某个聊天应使用的地点预设；返回 null 表示该聊天不注入天气 */
function _resolveWeatherPresetForChat(chat) {
    if (!chat || !chat.weatherMode || chat.weatherMode === 'off') return null;
    const settings = _normalizeWeatherSettings(db.weatherSettings);
    if (!settings.apiHost || !settings.apiKey) return null;

    let preset = null;
    if (chat.weatherMode === 'preset') {
        preset = settings.locationPresets.find(p => p.id === chat.weatherLocationPresetId);
    } else {
        preset = settings.locationPresets.find(p => p.id === settings.defaultLocationPresetId);
    }
    return (preset && preset.locationId) ? { settings, preset } : null;
}

/** 组装注入文本：城市名用预设名；部分指标仅在达到阈值时出现 */
function _formatWeatherPromptText(now, presetName) {
    const parts = [];
    parts.push(`${presetName}目前的天气是${now.text || '未知'}，温度${now.temp === undefined ? '未知' : `${now.temp}℃`}`);

    const humidity = parseInt(now.humidity, 10);
    if (!isNaN(humidity) && (humidity <= WEATHER_INJECT_RULES.humidityLow || humidity >= WEATHER_INJECT_RULES.humidityHigh)) {
        parts.push(`湿度${humidity}%`);
    }
    const windScale = parseInt(now.windScale, 10);
    if (!isNaN(windScale) && windScale >= WEATHER_INJECT_RULES.windScale) {
        parts.push(`${now.windDir || '未知风向'}${windScale}级风`);
    }
    const precip = parseFloat(now.precip);
    if (!isNaN(precip) && precip > WEATHER_INJECT_RULES.precipMin) {
        parts.push(`降水量${now.precip}mm`);
    }
    const vis = parseFloat(now.vis);
    if (!isNaN(vis) && vis <= WEATHER_INJECT_RULES.visMax) {
        parts.push(`能见度${now.vis}km`);
    }
    return parts.join('，');
}

/** 天气文字归类：同类之间的变化不提醒（如晴转多云），跨类才提醒 */
function _weatherCategory(text) {
    const t = String(text || '');
    if (t.includes('雷')) return '雷';
    if (t.includes('雨') || t.includes('雹')) return '雨';
    if (t.includes('雪')) return '雪';
    if (t.includes('雾') || t.includes('霾')) return '雾';
    if (t.includes('台风') || t.includes('飓风')) return '台风';
    if (t.includes('沙') || t.includes('尘')) return '沙尘';
    return 'normal';
}

/** 风力字段可能是 "6" 或 "3-4"，取最大等级 */
function _parseWindScale(value) {
    const nums = String(value || '').match(/\d+/g);
    return nums ? Math.max(...nums.map(Number)) : NaN;
}

/** 未来小时数（按 fxTime 与当前时间差取整） */
function _hoursAhead(fxTime) {
    const t = Date.parse(String(fxTime || '').replace(' ', 'T'));
    if (isNaN(t)) return null;
    return Math.max(1, Math.round((t - Date.now()) / 3600000));
}

/** 对比实时与 24h 预报，只生成“明显变化”的提醒 */
function _buildWeatherAlerts(now, hourly, presetName) {
    if (!Array.isArray(hourly) || !hourly.length) return [];
    const events = [];

    // 1. 天气转变（跨类别），取最早一次
    const currentCategory = _weatherCategory(now.text);
    const transition = hourly.find(h => _weatherCategory(h.text) !== currentCategory && _weatherCategory(h.text) !== 'normal');
    if (transition) {
        const hours = _hoursAhead(transition.fxTime);
        let text = `约${hours === null ? '数' : hours}小时后${presetName}天气转为${transition.text}`;
        const precip = parseFloat(transition.precip);
        const pop = parseInt(transition.pop, 10);
        if (!isNaN(precip) && precip > 0) text += `，预计降雨量${transition.precip}mm`;
        else if (!isNaN(pop) && pop >= WEATHER_INJECT_RULES.popMin) text += `，降水概率${pop}%`;
        events.push({ hours: hours === null ? 999 : hours, text });
    }

    // 2. 明显升温 / 降温（24h 极值与当前温差 ≥ 阈值）
    const currentTemp = parseFloat(now.temp);
    if (!isNaN(currentTemp)) {
        const temps = hourly.map(h => parseFloat(h.temp)).filter(t => !isNaN(t));
        if (temps.length) {
            const maxTemp = Math.max(...temps);
            const minTemp = Math.min(...temps);
            if (maxTemp - currentTemp >= WEATHER_INJECT_RULES.tempDiff) {
                events.push({ hours: 998, text: `未来24小时内${presetName}将明显升温，最高${maxTemp}℃（当前${currentTemp}℃）` });
            }
            if (currentTemp - minTemp >= WEATHER_INJECT_RULES.tempDiff) {
                events.push({ hours: 998, text: `未来24小时内${presetName}将明显降温，最低${minTemp}℃（当前${currentTemp}℃）` });
            }
        }
    }

    // 3. 大风（当前未达阈值、未来达到阈值），取最早一次
    const currentWind = _parseWindScale(now.windScale);
    if (!(currentWind >= WEATHER_INJECT_RULES.windScale)) {
        const windy = hourly.find(h => _parseWindScale(h.windScale) >= WEATHER_INJECT_RULES.windScale);
        if (windy) {
            const hours = _hoursAhead(windy.fxTime);
            events.push({ hours: hours === null ? 999 : hours, text: `约${hours === null ? '数' : hours}小时后${presetName}将有${windy.windDir || ''}${windy.windScale}级大风` });
        }
    }

    // 4. 无天气转变但降水概率高：可能下雨
    if (!transition && _weatherCategory(now.text) !== '雨') {
        const pops = hourly.map(h => parseInt(h.pop, 10)).filter(p => !isNaN(p));
        if (pops.length && Math.max(...pops) >= WEATHER_INJECT_RULES.popMin) {
            events.push({ hours: 999, text: `未来24小时内${presetName}有降雨可能（降水概率最高${Math.max(...pops)}%）` });
        }
    }

    events.sort((a, b) => a.hours - b.hours);
    return events.slice(0, WEATHER_INJECT_RULES.maxAlerts).map(e => e.text);
}

/**
 * 获取某聊天的天气句子（纯句子，不带方括号块、不带收尾句、不带句号）。
 * 例：「辉城目前的天气是小雨，温度18℃，湿度85%」
 * 排版与"不要主动提及天气"这类约束由 private_prompt.js 那边跟时间一起说。
 * 仅在用户触发该聊天 AI 回复时调用；失败/未配置/关闭时返回空字符串，绝不影响正常回复。
 */
async function getWeatherPromptContext(chat) {
    const resolved = _resolveWeatherPresetForChat(chat);
    if (!resolved) return '';
    const { settings, preset } = resolved;
    // 预报按聊天开关，默认关（undefined 视为 false）：预报会诱导 AI 主动提"看天气预报"
    const forecastEnabled = !!chat.weatherForecastEnabled;

    const apiHost = _normalizeQWeatherHost(settings.apiHost);
    const headers = { Accept: 'application/json', 'X-QW-Api-Key': settings.apiKey };
    const params = new URLSearchParams({ location: preset.locationId, lang: 'zh' });

    // 额度硬刹车：本次要发几个请求先算清楚，超了就一个都不发（和风超额只会给你发账单，不会报错）
    const forecastCached = (() => {
        const cached = _weatherForecastCache.get(preset.locationId);
        return !!(cached && (Date.now() - cached.fetchedAt) < WEATHER_FORECAST_TTL_MS);
    })();
    const plannedRequests = 1 + (forecastEnabled && !forecastCached ? 1 : 0);
    // 每轮回复都会走这里，所以到限的提示当天只弹一次
    if (!await _reserveWeatherQuota(plannedRequests, { oncePerDay: true })) return '';

    // 实况每次都拉：天气只进 systemPrompt 不进 history，模型每轮无状态、看不到上一轮读数，
    // 所以"缓存能保剧情连贯"不成立，缓存只会让角色读到过时天气。
    const fetchNow = (async () => {
        try {
            const response = await fetch(`${apiHost}/v7/weather/now?${params.toString()}`, { method: 'GET', headers });
            if (!response.ok) return null;
            const body = await response.json();
            return (body.code === '200' && body.now) ? body : null;
        } catch (error) {
            console.warn('天气获取失败，本次不注入：', error);
            return null;
        }
    })();

    // 预报走独立缓存，TTL 写死 1 小时：24h 预报本身不按分钟变，反复拉是白发请求（和风按请求计费）
    const fetchForecast = (async () => {
        if (!forecastEnabled) return null;
        const cached = _weatherForecastCache.get(preset.locationId);
        if (cached && (Date.now() - cached.fetchedAt) < WEATHER_FORECAST_TTL_MS) return cached.payload;
        try {
            const response = await fetch(`${apiHost}/v7/weather/24h?${params.toString()}`, { method: 'GET', headers });
            if (!response.ok) return null;
            const body = await response.json();
            if (body.code !== '200' || !Array.isArray(body.hourly)) return null;
            _weatherForecastCache.set(preset.locationId, { fetchedAt: Date.now(), payload: body });
            return body;
        } catch (error) {
            console.warn('天气预报获取失败，本次仅注入实况：', error);
            return null;
        }
    })();

    const [nowPayload, hourlyPayload] = await Promise.all([fetchNow, fetchForecast]);
    if (!nowPayload) return '';

    // 纯句子拼装：不要用方括号块（本项目里 [xxx] 是输出格式保留语法），也不加收尾句
    const parts = [_formatWeatherPromptText(nowPayload.now, preset.name)];
    if (forecastEnabled && hourlyPayload && hourlyPayload.hourly) {
        const alerts = _buildWeatherAlerts(nowPayload.now, hourlyPayload.hourly, preset.name);
        if (alerts.length) parts.push(alerts.join('；'));
    }
    return parts.join('；');
}

function _formatCurrentWeather(payload, configuredName) {
    const now = payload.now || {};
    return [
        `地点：${configuredName || '已配置地点'}`,
        `观测时间：${now.obsTime || '未知'}`,
        `天气：${now.text || '未知'}`,
        `温度：${now.temp === undefined ? '未知' : `${now.temp}℃`}`,
        `体感：${now.feelsLike === undefined ? '未知' : `${now.feelsLike}℃`}`,
        `湿度：${now.humidity === undefined ? '未知' : `${now.humidity}%`}`,
        `风：${now.windDir || '未知'} ${now.windScale === undefined ? '' : `${now.windScale}级`} ${now.windSpeed === undefined ? '' : `${now.windSpeed} km/h`}`.trim(),
        `降水量：${now.precip === undefined ? '未知' : `${now.precip} mm`}`,
        `气压：${now.pressure === undefined ? '未知' : `${now.pressure} hPa`}`,
        `能见度：${now.vis === undefined ? '未知' : `${now.vis} km`}`,
        `云量：${now.cloud === undefined ? '未知' : `${now.cloud}%`}`,
        `露点：${now.dew === undefined ? '未知' : `${now.dew}℃`}`
    ].join('\n');
}

async function testWeatherApi() {
    const settings = _readWeatherForm();
    const location = _getWeatherCurrentLocation();
    if (!_isValidQWeatherHost(settings.apiHost)) return showToast('请先填写正确的专属 API Host');
    if (!settings.apiKey) return showToast('请先填写 API Key');
    if (!location.locationId) return showToast('请先查询并选择本次测试地点');
    // 测试也是一次真实请求，同样计数、同样受上限约束
    if (!await _reserveWeatherQuota(1)) return;

    _setWeatherButtonLoading('api-weather-test-btn', true);
    _setWeatherTestResult('正在获取实况天气…');

    try {
        const params = new URLSearchParams({ location: location.locationId, lang: 'zh' });
        const response = await fetch(`${settings.apiHost}/v7/weather/now?${params.toString()}`, {
            method: 'GET',
            headers: { Accept: 'application/json', 'X-QW-Api-Key': settings.apiKey }
        });
        if (!response.ok) throw new Error(await _readWeatherApiError(response));

        const payload = await response.json();
        if (payload.code !== '200' || !payload.now) throw new Error(`和风天气状态码：${payload.code || '未知'}`);
        _setWeatherTestResult(_formatCurrentWeather(payload, location.locationName || location.locationQuery));
    } catch (error) {
        _setWeatherTestResult(`实况测试失败：${error.message}`, true);
    } finally {
        _setWeatherButtonLoading('api-weather-test-btn', false);
    }
}

function initWeatherApiTab() {
    _refreshWeatherTabUI();
    _on('api-weather-search-btn', searchWeatherLocations);
    _on('api-weather-test-btn', testWeatherApi);
    _on('api-weather-save-btn', saveWeatherApiSettings);
    _on('api-weather-add-preset', () => _addWeatherPreset(false));
    _on('api-weather-copy-preset', () => _addWeatherPreset(true));
    _on('api-weather-del-preset', _deleteWeatherPreset);
    _on('api-weather-import-preset', importWeatherPresets);
    _on('api-weather-export-preset', exportWeatherPresets);

    const presetSelect = document.getElementById('api-weather-preset-select');
    if (presetSelect) presetSelect.addEventListener('change', () => {
        _syncWeatherPresetFromForm();
        _applyWeatherPresetToForm(presetSelect.value);
        _clearDirty('weather');
    });

    const locationSelect = document.getElementById('api-weather-location-select');
    if (locationSelect) locationSelect.addEventListener('change', _applySelectedWeatherLocation);

    const cityInput = document.getElementById('api-weather-city');
    if (cityInput) cityInput.addEventListener('input', () => {
        if (!locationSelect || !locationSelect.value) return;
        locationSelect.innerHTML = '<option value="">城市已修改，请重新查询地点</option>';
        _setWeatherTestResult('', false, true);
    });

    _watchDirty('weather', [
        'api-weather-provider', 'api-weather-host', 'api-weather-key',
        'api-weather-preset-name', 'api-weather-set-default', 'api-weather-city',
        'api-weather-location-select', 'api-weather-daily-limit'
    ]);
}

// ============================================================
// 初始化各 Tab
// ============================================================

/** 刷新文字 Tab 的 UI（每次打开页面时调用，不重复绑定事件） */
function _refreshChatTabUI() {
    const s = db.apiSettings || {};
    const activeName = s.activePreset;
    if (activeName) {
        const preset = _getPresets('chat').find(p => p.name === activeName);
        if (preset && preset.data) {
            _applyDataToForm('chat', preset.data);
            _setPresetNameInput('chat', activeName);
        }
        _loadedPresetName.chat = activeName;
    } else {
        _setVal('api-chat-provider', s.provider || 'newapi');
        _setVal('api-chat-url',      s.url || s.apiUrl || '');
        _setVal('api-chat-key',      s.key || s.apiKey || '');
        if (s.model) {
            const m = document.getElementById('api-chat-model');
            if (m) { m.innerHTML = `<option value="${s.model}">${s.model}</option>`; m.value = s.model; }
        }
        _setChecked('api-chat-stream', s.streamEnabled === true);
        _setChecked('api-chat-compat', !!s.compatibilityModeEnabled);
        _setVal('api-chat-temp', s.temperature !== undefined ? s.temperature : 0.8);
        _setPresetNameInput('chat', '未命名预设');
        _loadedPresetName.chat = null;
    }
    populateApiSelect('chat');
    if (activeName) {
        const sel = document.getElementById('api-chat-preset-select');
        if (sel) sel.value = activeName;
        _setChecked('api-chat-set-default', true);
    }
    _updateDefaultToggleState('chat');
}

/** 绑定文字 Tab 的所有事件（仅 init 时调用一次） */
function initChatApiTab() {
    _refreshChatTabUI();

    // 服务商切换 → 自动填 URL
    const providerEl = document.getElementById('api-chat-provider');
    if (providerEl) providerEl.addEventListener('change', () => {
        const autoUrl = CHAT_PROVIDER_URLS[providerEl.value];
        if (autoUrl !== undefined) _setVal('api-chat-url', autoUrl);
    });

    // 拉取模型
    _on('api-chat-fetch-btn', () => fetchModels('chat'));

    // 选择预设 → 应用到表单
    const presetSel = document.getElementById('api-chat-preset-select');
    if (presetSel) presetSel.addEventListener('change', () => {
        if (presetSel.value) {
            applyPresetToForm('chat', presetSel.value); // 内部已更新 _loadedPresetName
        } else {
            _setChecked('api-chat-set-default', false);
            _setPresetNameInput('chat', '');
            _loadedPresetName.chat = null;
        }
        _clearDirty('chat');
        _updateDefaultToggleState('chat');
    });

    // 四个图标按钮
    _on('api-chat-add-preset',  () => _addNewPreset('chat'));
    _on('api-chat-copy-preset', () => _copyPreset('chat'));
    _on('api-chat-save-preset', () => _savePreset('chat'));
    _on('api-chat-del-preset',  () => _deletePreset('chat'));

    // 导入 / 导出
    _on('api-chat-import-preset', () => importApiPresets('chat'));
    _on('api-chat-export-preset', () => exportApiPresets('chat'));

    // 底部保存按钮
    _on('api-chat-save-btn', saveChatApiSettings);

    // 监听表单变化 → 标记脏数据
    _watchDirty('chat', [
        'api-chat-preset-name',
        'api-chat-provider', 'api-chat-url', 'api-chat-key', 'api-chat-model',
        'api-chat-stream', 'api-chat-compat', 'api-chat-temp'
    ]);
}

/** 刷新向量 Tab 的 UI（每次打开页面时调用，不重复绑定事件） */
function _refreshEmbTabUI() {
    const s = db.embeddingSettings || {};
    const activeName = s.activePreset;
    if (activeName) {
        const preset = _getPresets('embedding').find(p => p.name === activeName);
        if (preset && preset.data) {
            _applyDataToForm('embedding', preset.data);
            _setPresetNameInput('embedding', activeName);
        }
        _loadedPresetName.embedding = activeName;
    } else {
        _setVal('api-emb-provider', s.provider || 'newapi');
        _setVal('api-emb-url',      s.url || s.apiUrl || '');
        _setVal('api-emb-key',      s.key || s.apiKey || '');
        if (s.model) {
            const m = document.getElementById('api-emb-model');
            if (m) { m.innerHTML = `<option value="${s.model}">${s.model}</option>`; m.value = s.model; }
        }
        _setPresetNameInput('embedding', '未命名预设');
        _loadedPresetName.embedding = null;
    }
    populateApiSelect('embedding');
    if (activeName) {
        const sel = document.getElementById('api-emb-preset-select');
        if (sel) sel.value = activeName;
        _setChecked('api-emb-set-default', true);
    }
    _updateDefaultToggleState('embedding');
}

/** 绑定向量 Tab 的所有事件（仅 init 时调用一次） */
function initEmbApiTab() {
    _refreshEmbTabUI();

    const providerEl = document.getElementById('api-emb-provider');
    if (providerEl) providerEl.addEventListener('change', () => {
        const autoUrl = EMB_PROVIDER_URLS[providerEl.value];
        if (autoUrl !== undefined) _setVal('api-emb-url', autoUrl);
    });

    _on('api-emb-fetch-btn', () => fetchModels('embedding'));

    const presetSel = document.getElementById('api-emb-preset-select');
    if (presetSel) presetSel.addEventListener('change', () => {
        if (presetSel.value) {
            applyPresetToForm('embedding', presetSel.value); // 内部已更新 _loadedPresetName
        } else {
            _setChecked('api-emb-set-default', false);
            _setPresetNameInput('embedding', '');
            _loadedPresetName.embedding = null;
        }
        _clearDirty('embedding');
        _updateDefaultToggleState('embedding');
    });

    _on('api-emb-add-preset',  () => _addNewPreset('embedding'));
    _on('api-emb-copy-preset', () => _copyPreset('embedding'));
    _on('api-emb-save-preset', () => _savePreset('embedding'));
    _on('api-emb-del-preset',  () => _deletePreset('embedding'));

    _on('api-emb-import-preset', () => importApiPresets('embedding'));
    _on('api-emb-export-preset', () => exportApiPresets('embedding'));

    _on('api-emb-save-btn', saveEmbApiSettings);

    _watchDirty('embedding', [
        'api-emb-preset-name',
        'api-emb-provider', 'api-emb-url', 'api-emb-key', 'api-emb-model'
    ]);
}

// ============================================================
// 主入口：setupApiSettingsApp
// ============================================================
function setupApiSettingsApp() {
    _currentApiTab    = 'chat';
    _chatDirty        = false;
    _embDirty         = false;
    _weatherDirty     = false;
    _stagedPresets    = { chat: null, embedding: null };
    _loadedPresetName = { chat: null, embedding: null };

    // 数据迁移（旧用户首次进入）
    _migrateOldSettings();

    // 独立且安全的 Tab 切换逻辑
    const apiScreen = document.getElementById('api-settings-screen');
    if (apiScreen) {
        apiScreen.querySelectorAll('[data-api-tab]').forEach(btn => {
            btn.onclick = (e) => {
                _currentApiTab = btn.dataset.apiTab;
                
                // 1. 切换侧边栏按钮的激活状态
                apiScreen.querySelectorAll('[data-api-tab]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                // 2. 隐藏所有的 API pane (改为新的 .api-tab-pane 类名)
                apiScreen.querySelectorAll('.api-tab-pane').forEach(p => p.classList.remove('active'));
                
                // 3. 显示指定的 pane
                const pane = apiScreen.querySelector(`#api-tab-${_currentApiTab}`);
                if (pane) pane.classList.add('active');
            };
        });
    }

    // 返回守卫
    _setupBackGuard();

    initChatApiTab();
    initEmbApiTab();
    initWeatherApiTab();
}

// ============================================================
// 每次打开 API 页面时调用（重置状态 + 回到文字 Tab + 刷新 UI）
// ============================================================
function openApiSettingsScreen() {
    // 重置脏数据和暂存状态
    _chatDirty        = false;
    _embDirty         = false;
    _weatherDirty     = false;
    _stagedPresets    = { chat: null, embedding: null };
    _loadedPresetName = { chat: null, embedding: null };

    // 强制切回文字 Tab
    const apiScreen = document.getElementById('api-settings-screen');
    if (apiScreen) {
        apiScreen.querySelectorAll('[data-api-tab]').forEach(b => b.classList.remove('active'));
        const chatBtn = apiScreen.querySelector('[data-api-tab="chat"]');
        if (chatBtn) chatBtn.classList.add('active');
        apiScreen.querySelectorAll('.api-tab-pane').forEach(p => p.classList.remove('active'));
        const chatPane = apiScreen.querySelector('#api-tab-chat');
        if (chatPane) chatPane.classList.add('active');
        _currentApiTab = 'chat';
    }

    // 各 Tab 都刷新回已保存状态
    _refreshChatTabUI();
    _refreshEmbTabUI();
    _refreshWeatherTabUI();
}

// ============================================================
// 工具函数
// ============================================================

function _getVal(id)        { const el = document.getElementById(id); return el ? el.value : ''; }
function _setVal(id, v) { 
    const el = document.getElementById(id); 
    if (el && v !== undefined) {
        el.value = v; 
        // 专门修复：如果设置的是温度滑块，同步更新旁边的数字显示
        if (id === 'api-chat-temp') {
            const span = document.getElementById('chat-temp-val');
            if (span) span.innerText = v;
        }
    } 
}
function _getChecked(id)    { const el = document.getElementById(id); return el ? el.checked : false; }
function _setChecked(id, v) { const el = document.getElementById(id); if (el) el.checked = !!v; }
function _on(id, fn)        { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); }

/** Gemini 多 Key 随机选取 */
function getRandomValue(str) {
    if (str.includes(',')) {
        const arr = str.split(',').map(s => s.trim());
        return arr[Math.floor(Math.random() * arr.length)];
    }
    return str;
}

// ============================================================
// 向后兼容 & 全局暴露
// ============================================================

/** 已合并入 setupApiSettingsApp，保留空函数防止旧调用报错 */
function setupApiPresets() { /* no-op */ }
window.setupApiPresets = setupApiPresets;

/**
 * 供聊天侧边栏刷新 API 预设下拉框使用
 */
window.populateChatApiPresetSelect = function (selectEl) {
    if (!selectEl) return;
    const presets = (db.apiPresets || []).filter(p => !p.type || p.type === 'chat');
    selectEl.innerHTML = '<option value="">全局默认</option>';
    presets.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name; opt.textContent = p.name;
        selectEl.appendChild(opt);
    });
};