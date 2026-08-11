// ============================================================
// image_generation_api.js — 图像生成 API 层（凭据 / 请求 / 响应归一化）
// ============================================================
// 这一层只管"怎么跟生图服务商说话"，不认识任何页面，也不认识聊天。
// 消费方：
//   · js/settings/api_settings.js  → 图像设置 tab（填 Key、测试生成）
//   · js/chat/...                 → 未来可能加入的聊天侧调用
//
// 对外符号：
//   IMAGE_PROVIDERS / imageProviderLabel
//   _normalizeImageSettings / _normalizeImagePreset / _newImagePresetId
//   generateImage
// ============================================================

// 预留了服务商体系，将来加 NAI、NanoBanana 直接往这里加枚举
const IMAGE_PROVIDERS = [
    { value: 'openai', label: 'OpenAI 兼容' }
];

function imageProviderLabel(value) {
    const hit = IMAGE_PROVIDERS.find(p => p.value === value);
    return hit ? hit.label : (value || '未知');
}

// ============================================================
// 配置归一化
// ============================================================

function _newImagePresetId() {
    return `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 归一化单条生图预设（支持从老版本全局配置继承 url/key） */
function _normalizeImagePreset(raw, legacyConfig) {
    const p = raw || {};
    const provider = IMAGE_PROVIDERS.some(x => x.value === p.provider) ? p.provider : 'openai';
    
    return {
        id: p.id || _newImagePresetId(),
        name: p.name || '未命名生图预设',
        provider: provider,
        // API 地址和 Key 现已绑定至预设
        apiUrl: p.apiUrl !== undefined ? String(p.apiUrl).trim() : (legacyConfig ? legacyConfig.apiUrl : ''),
        apiKey: p.apiKey !== undefined ? String(p.apiKey).trim() : (legacyConfig ? legacyConfig.apiKey : ''),
        // 下面是 OpenAI 体系常用参数
        model: String(p.model || 'dall-e-3').trim(),
        size: String(p.size || '1024x1024').trim(),
        quality: String(p.quality || 'standard').trim(),
        style: String(p.style || 'vivid').trim(),
        // 预留给未来其他服务商的扩展参数可继续在此添加
    };
}

/** 归一化全局生图配置 */
function _normalizeImageSettings(raw) {
    const source = raw || {};
    // 供老用户首次迁移时使用
    const legacyConfig = { apiUrl: source.apiUrl || '', apiKey: source.apiKey || '' };

    const presets = Array.isArray(source.imagePresets)
        ? source.imagePresets.filter(p => p && p.id).map(p => _normalizeImagePreset(p, legacyConfig))
        : [];
        
    return {
        // 全局的 url 和 key 作为备用/兜底保留
        apiUrl: String(source.apiUrl || '').trim(),
        apiKey: String(source.apiKey || '').trim(),
        imagePresets: presets,
        defaultPresetId: source.defaultPresetId || (presets[0] ? presets[0].id : '')
    };
}

// ============================================================
// 具体服务商的请求实现
// ============================================================

/**
 * OpenAI 格式图像生成请求
 * 支持 DALL-E 2, DALL-E 3，以及部分中转站封装的 Midjourney 等。
 */

async function _generateOpenAIImage(apiUrl, apiKey, preset, prompt) {
    let endpoint = (apiUrl || 'https://api.openai.com').trim().replace(/\/+$/, '');
    
    // ★ 智能 URL 拼接逻辑
    if (!endpoint.endsWith('/images/generations')) {
        // 如果用户填了带版本号的后缀（如 /v1, /v2, /api/v3 等），直接补具体的接口路径
        if (/\/v\d+$/.test(endpoint)) {
            endpoint = `${endpoint}/images/generations`;
        } else {
            // 否则默认当作裸域名，补全标准的 /v1/images/generations
            endpoint = `${endpoint}/v1/images/generations`;
        }
    }
    
    const payload = {
        model: preset.model,
        prompt: prompt,
        n: 1,
        size: preset.size
    };
    
    // DALL-E 3 专属参数 (仅当模型名字包含 dall-e-3 时才传，防止其它模型报错)
    if (preset.model.toLowerCase().includes('dall-e-3')) {
        if (preset.quality) payload.quality = preset.quality;
        if (preset.style) payload.style = preset.style;
    }

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        let detail = '';
        try {
            const errData = await response.json();
            if (errData.error && errData.error.message) {
                detail = errData.error.message;
            }
        } catch (_) {}
        throw new Error(`HTTP ${response.status}${detail ? `：${detail}` : ''}`);
    }

    const payloadData = await response.json();
    if (!payloadData.data || !payloadData.data[0] || (!payloadData.data[0].url && !payloadData.data[0].b64_json)) {
        throw new Error('接口返回格式异常，未找到图片数据');
    }
    
    // 返回标准化的图片 URL（或者是 base64 data URI）
    return payloadData.data[0].url || `data:image/png;base64,${payloadData.data[0].b64_json}`;
}

// ============================================================
// 主入口
// ============================================================

/**
 * 统一生图入口，根据预设的 provider 路由到不同的请求函数。
 * 
 * @param {object} args
 * @param {string} args.prompt    用户输入的提示词
 * @param {object} args.preset    当前选中的生图预设
 * @param {object} [args.settings] 覆盖 db.imageSettings (给设置页试听用)
 * @returns {Promise<string>} 图片的 URL 或 Base64 字符串
 */
async function generateImage({ prompt, preset, settings }) {
    const config = _normalizeImageSettings(settings || window.db.imageSettings);
    const imagePreset = _normalizeImagePreset(preset, config);
    const provider = imagePreset.provider;

    // 优先使用当前预设的凭据，如果没有再使用全局兜底
    const activeUrl = imagePreset.apiUrl || config.apiUrl;
    const activeKey = imagePreset.apiKey || config.apiKey;

    if (!activeKey) throw new Error('尚未配置生图 API Key');
    if (!prompt) throw new Error('提示词不能为空');

    // ★ 路由分发区：未来添加 NAI 等平台，只需在这里增加 case 即可
    switch (provider) {
        case 'openai':
            return await _generateOpenAIImage(activeUrl, activeKey, imagePreset, prompt);
            
        // case 'nai':
        //     return await _generateNovelAIImage(activeUrl, activeKey, imagePreset, prompt);
            
        default:
            throw new Error(`暂不支持的生图服务商: ${provider}`);
    }
}