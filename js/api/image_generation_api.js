// ============================================================
// image_generation_api.js — 图像生成 API 层（凭据 / 请求 / 响应归一化）
// ============================================================
// 这一层只管"怎么跟生图服务商说话"，不认识任何页面，也不认识聊天。
// 消费方：
//   · js/settings/api_settings.js  → 图像设置 tab（填 Key、测试生成）
//   · js/chat/...                 → 未来可能加入的聊天侧调用
//
// 对外符号：
//   IMAGE_PROVIDERS / imageProviderLabel / IMAGE_PRESET_OFF
//   _normalizeImageSettings / _normalizeImagePreset / _newImagePresetId
//   getImagePreset / getImagePresetOptions / resolveImagePreset / resolveImagePresetForChat
//   imageMimeExtension / imageAspectRatioText / composeImagePrompt
//   generateImage
// ============================================================

const IMAGE_GENERATION_SLOW_WARNING_MS = 120000;

// 预留了服务商体系，将来加 NAI、NanoBanana 直接往这里加枚举
const IMAGE_PROVIDERS = [
    { value: 'openai', label: 'OpenAI 兼容' }
];

function imageProviderLabel(value) {
    const hit = IMAGE_PROVIDERS.find(p => p.value === value);
    return hit ? hit.label : (value || '未知');
}

// 聊天身上 imageApiPresetId 表示"不开启生图"的值。
// ★ 与音色的 VOICE_PRESET_OFF 同一套路：用显式哨兵而不是空串，因为 <select> 拿到的
//   空值和"字段压根没写过"在 JS 里几乎分不开，混起来必然出 bug。
//   预设 id 形如 img-<时间戳>-<随机>，不会撞。
// ★ 这也是**默认值** —— 没设过的聊天一律不生图。生图是要花钱的调用，
//   绝不能因为"全局配了个默认预设"就替用户默默付费。
const IMAGE_PRESET_OFF = 'off';

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
    const legacy = legacyConfig || {};

    return {
        id: String(p.id || _newImagePresetId()).trim(),
        name: String(p.name || '未命名生图预设').trim() || '未命名生图预设',
        provider: provider,
        // 只有旧数据缺字段时才继承旧全局值；显式空字符串不会借用别的凭据。
        apiUrl: p.apiUrl !== undefined ? String(p.apiUrl).trim() : String(legacy.apiUrl || '').trim(),
        apiKey: p.apiKey !== undefined ? String(p.apiKey).trim() : String(legacy.apiKey || '').trim(),
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
    const legacyConfig = {
        apiUrl: String(source.apiUrl || '').trim(),
        apiKey: String(source.apiKey || '').trim()
    };
    const usedIds = new Set();
    const presets = [];

    if (Array.isArray(source.imagePresets)) {
        source.imagePresets.filter(p => p && typeof p === 'object').forEach(rawPreset => {
            const preset = _normalizeImagePreset(rawPreset, legacyConfig);
            if (!preset.id || usedIds.has(preset.id)) preset.id = _newImagePresetId();
            usedIds.add(preset.id);
            presets.push(preset);
        });
    }

    // 兼容只有旧全局 URL/Key、还没有预设数组的用户。
    if (!presets.length && (legacyConfig.apiUrl || legacyConfig.apiKey)) {
        const legacyPreset = _normalizeImagePreset({ name: '用户默认' }, legacyConfig);
        usedIds.add(legacyPreset.id);
        presets.push(legacyPreset);
    }

    const requestedDefaultId = String(source.defaultPresetId || '').trim();
    const defaultPresetId = presets.some(p => p.id === requestedDefaultId)
        ? requestedDefaultId
        : ((!Array.isArray(source.imagePresets) || source.imagePresets.length === 0) && presets.length === 1
            ? presets[0].id
            : '');

    const rawCacheLimit = Number(source.localCacheLimitMB);
    const localCacheLimitMB = Number.isFinite(rawCacheLimit) && rawCacheLimit >= 0
        ? rawCacheLimit
        : 10;

    return {
        // 旧字段仅供迁移；新调用必须使用预设自己的 URL/Key。
        apiUrl: legacyConfig.apiUrl,
        apiKey: legacyConfig.apiKey,
        imagePresets: presets,
        defaultPresetId: defaultPresetId,
        // 0 明确表示关闭浏览器本地图片缓存；旧数据缺字段时默认 10 MB。
        localCacheLimitMB
    };
}

function _getImageSettingsSource(settings) {
    if (settings) return settings;
    if (typeof db !== 'undefined' && db && db.imageSettings) return db.imageSettings;
    return {};
}

/** 按 id 精确取预设；空值或找不到时返回 null，不自动回退。 */
function getImagePreset(presetId, settings) {
    const wanted = String(presetId || '').trim();
    if (!wanted) return null;
    const config = _normalizeImageSettings(_getImageSettingsSource(settings));
    return config.imagePresets.find(p => p.id === wanted) || null;
}

/**
 * 私聊/群聊共用的选项数据，只提供数据，不操作 DOM。
 * 第一项固定是"不开启"，它同时是默认选中项。
 * ★ 刻意不提供"全局默认"这一档：见 IMAGE_PRESET_OFF 的注释，
 *   没设过的聊天必须是不生图，而不是悄悄借用全局默认去花钱。
 */
function getImagePresetOptions(settings) {
    const config = _normalizeImageSettings(_getImageSettingsSource(settings));
    return [
        { value: IMAGE_PRESET_OFF, label: '不开启' },
        ...config.imagePresets.map(p => ({
            value: p.id,
            label: `${p.name} · ${imageProviderLabel(p.provider)}`
        }))
    ];
}

/**
 * 指定预设有效就使用，否则回退到明确设置的全局默认；仍无可用项则返回 null。
 * 只服务于设置页（试生成、默认预设标注）；聊天侧一律走 resolveImagePresetForChat。
 */
function resolveImagePreset(presetId, settings) {
    const config = _normalizeImageSettings(_getImageSettingsSource(settings));
    const wanted = String(presetId || '').trim();
    if (wanted) {
        const selected = config.imagePresets.find(p => p.id === wanted);
        if (selected) return selected;
    }
    return config.imagePresets.find(p => p.id === config.defaultPresetId) || null;
}

/**
 * 私聊角色和群聊对象都使用同一个 imageApiPresetId 字段。
 * 'off'、空值、以及指向已删预设的悬空 id 一律视为不开启，**不回退全局默认**。
 */
function resolveImagePresetForChat(chat, settings) {
    const wanted = String((chat && chat.imageApiPresetId) || '').trim();
    if (!wanted || wanted === IMAGE_PRESET_OFF) return null;
    return getImagePreset(wanted, settings);
}

/** 由 size 反推画面比例文本（1024x1024 → 1:1，1792x1024 → 7:4）。 */
function imageAspectRatioText(size) {
    const match = String(size || '').match(/^(\d+)\s*[x×]\s*(\d+)$/i);
    if (!match) return '';
    const w = parseInt(match[1], 10);
    const h = parseInt(match[2], 10);
    if (!w || !h) return '';
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    const divisor = gcd(w, h) || 1;
    return `${w / divisor}:${h / divisor}`;
}

/**
 * 拼最终提示词：画面描述 + 风格 + 画面比例。
 * ★ 比例既写进 prompt 又保留 size 参数，是刻意的双保险：有些模型（如 Gemini 系）
 *   会忽略 size 固定输出 16:9，只有把比例写进提示词才拗得回来；
 *   而老实听 size 的模型多这一句也不会被带偏。
 */
function composeImagePrompt(description, { stylePrompt = '', size = '' } = {}) {
    const parts = [String(description || '').trim()];
    const style = String(stylePrompt || '').trim();
    if (style) parts.push(style);
    const ratio = imageAspectRatioText(size);
    if (ratio) parts.push(`画面比例 ${ratio}`);
    return parts.filter(Boolean).join('，');
}

// ============================================================
// 具体服务商的请求实现
// ============================================================

function imageMimeExtension(mime) {
    const normalized = String(mime || '').toLowerCase().split(';')[0].trim();
    const extensions = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/webp': 'webp',
        'image/gif': 'gif',
        'image/avif': 'avif',
        'image/bmp': 'bmp'
    };
    return extensions[normalized] || 'img';
}

function _normalizeImageMime(mime) {
    const normalized = String(mime || '').toLowerCase().split(';')[0].trim();
    return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
}

function _detectImageMime(bytes, declaredMime) {
    if (bytes.length >= 8 &&
        bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
        bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
        return 'image/png';
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return 'image/jpeg';
    }
    if (bytes.length >= 6) {
        const gif = String.fromCharCode(...bytes.slice(0, 6));
        if (gif === 'GIF87a' || gif === 'GIF89a') return 'image/gif';
    }
    if (bytes.length >= 12) {
        const riff = String.fromCharCode(...bytes.slice(0, 4));
        const webp = String.fromCharCode(...bytes.slice(8, 12));
        if (riff === 'RIFF' && webp === 'WEBP') return 'image/webp';
    }
    if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';

    const normalizedDeclared = _normalizeImageMime(declaredMime);
    return normalizedDeclared.startsWith('image/') ? normalizedDeclared : '';
}

function _validateImageBytes(bytes, declaredMime) {
    const normalizedBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
    if (!normalizedBytes.byteLength) throw new Error('接口返回了空图片');

    const mime = _detectImageMime(normalizedBytes, declaredMime);
    if (!mime) throw new Error('接口返回的内容不是可识别的图片');
    if (mime === 'image/svg+xml') throw new Error('暂不接受 SVG 生图结果，请让接口返回 PNG、JPEG 或 WebP');
    return { bytes: normalizedBytes, mime };
}

function _decodeBase64Image(rawBase64, fallbackMime = 'image/png') {
    let encoded = String(rawBase64 || '').trim();
    let declaredMime = fallbackMime;
    const dataUriMatch = encoded.match(/^data:([^;,]+);base64,([\s\S]+)$/i);
    if (dataUriMatch) {
        declaredMime = dataUriMatch[1];
        encoded = dataUriMatch[2];
    }

    encoded = encoded.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
    if (!encoded) throw new Error('接口返回了空的 Base64 图片');
    const padding = encoded.length % 4;
    if (padding) encoded += '='.repeat(4 - padding);

    let binary;
    try {
        binary = atob(encoded);
    } catch (_) {
        throw new Error('接口返回的 Base64 图片无法解析');
    }

    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return _validateImageBytes(bytes, declaredMime);
}

async function _downloadGeneratedImage(url, signal) {
    const targetUrl = String(url || '').trim();
    if (!targetUrl) throw new Error('接口没有返回可下载的图片地址');
    if (targetUrl.startsWith('data:')) {
        const decoded = _decodeBase64Image(targetUrl);
        return { ...decoded, source: 'url' };
    }

    let response;
    try {
        response = await fetch(targetUrl, { signal });
    } catch (error) {
        if (error && error.name === 'AbortError') throw error;
        throw new Error('图片已经生成，但浏览器无法下载中转站返回的临时链接。请检查该中转站是否允许跨域下载（CORS）');
    }

    if (!response.ok) {
        throw new Error(`图片已经生成，但下载临时链接失败（HTTP ${response.status}）`);
    }

    let buffer;
    try {
        buffer = await response.arrayBuffer();
    } catch (error) {
        if (error && error.name === 'AbortError') throw error;
        throw new Error(`读取生成图片失败：${error.message || '未知错误'}`);
    }

    const validated = _validateImageBytes(new Uint8Array(buffer), response.headers.get('content-type'));
    return { ...validated, source: 'url' };
}

async function _readImageApiError(response) {
    let text = '';
    try { text = await response.text(); } catch (_) {}
    if (!text) return '';
    try {
        const data = JSON.parse(text);
        return String(data?.error?.message || data?.message || data?.detail || '').trim();
    } catch (_) {
        return text.trim().slice(0, 300);
    }
}

function _buildOpenAIImageEndpoint(apiUrl) {
    let endpoint = String(apiUrl || 'https://api.openai.com').trim().replace(/\/+$/, '');
    if (!endpoint) endpoint = 'https://api.openai.com';
    if (endpoint.endsWith('/images/generations')) return endpoint;
    return /\/v\d+$/.test(endpoint)
        ? `${endpoint}/images/generations`
        : `${endpoint}/v1/images/generations`;
}

/**
 * OpenAI 格式图像生成请求
 * 支持 DALL-E 2, DALL-E 3，以及部分中转站封装的 Midjourney 等。
 */
async function _generateOpenAIImage(apiUrl, apiKey, preset, prompt, signal) {
    const endpoint = _buildOpenAIImageEndpoint(apiUrl);
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

    let response;
    try {
        response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(payload),
            signal
        });
    } catch (error) {
        if (error && error.name === 'AbortError') throw error;
        throw new Error(`连接生图接口失败：${error.message || '网络错误'}`);
    }

    if (!response.ok) {
        const detail = await _readImageApiError(response);
        throw new Error(`HTTP ${response.status}${detail ? `：${detail}` : ''}`);
    }

    let payloadData;
    try {
        payloadData = await response.json();
    } catch (_) {
        throw new Error('接口返回格式异常：响应不是有效 JSON');
    }

    const firstImage = payloadData && Array.isArray(payloadData.data) ? payloadData.data[0] : null;
    if (!firstImage || (!firstImage.url && !firstImage.b64_json)) {
        throw new Error('接口返回格式异常，未找到图片数据');
    }

    if (firstImage.b64_json) {
        const decoded = _decodeBase64Image(firstImage.b64_json, 'image/png');
        return { ...decoded, source: 'b64_json' };
    }
    return _downloadGeneratedImage(firstImage.url, signal);
}

function _createImageRequestScope(parentSignal, slowAfterMs, onSlow) {
    const controller = new AbortController();
    const slowWarningDelay = Number(slowAfterMs) > 0 ? Number(slowAfterMs) : IMAGE_GENERATION_SLOW_WARNING_MS;
    let parentAborted = false;

    const abortFromParent = () => {
        parentAborted = true;
        controller.abort();
    };
    if (parentSignal) {
        if (parentSignal.aborted) abortFromParent();
        else parentSignal.addEventListener('abort', abortFromParent, { once: true });
    }

    const timer = setTimeout(() => {
        if (controller.signal.aborted || typeof onSlow !== 'function') return;
        try {
            const callbackResult = onSlow({ elapsedMs: slowWarningDelay });
            if (callbackResult && typeof callbackResult.catch === 'function') callbackResult.catch(() => {});
        } catch (_) {}
    }, slowWarningDelay);

    return {
        signal: controller.signal,
        slowWarningDelay,
        wasParentAborted: () => parentAborted,
        cleanup: () => {
            clearTimeout(timer);
            if (parentSignal) parentSignal.removeEventListener('abort', abortFromParent);
        }
    };
}

// ============================================================
// 主入口
// ============================================================

/**
 * 统一生图入口，根据预设的 provider 路由到不同的请求函数。
 * 
 * @param {object} args
 * @param {string} args.prompt    画面描述（文字模型写出来的那段）
 * @param {object} [args.preset]  当前选中的生图预设；省略时解析全局默认
 * @param {string} [args.stylePrompt] 该聊天的风格文本（如"写实风格"），拼进 prompt
 * @param {object} [args.settings] 覆盖 db.imageSettings (给设置页试听用)
 * @param {AbortSignal} [args.signal] 外部取消信号
 * @param {number} [args.slowAfterMs] 慢请求提醒阈值，默认 120 秒；提醒后请求继续运行
 * @param {(info: {elapsedMs: number}) => void|Promise<void>} [args.onSlow] 超过提醒阈值时调用
 * @returns {Promise<{bytes: Uint8Array, mime: string, source: 'b64_json'|'url'}>}
 */
async function generateImage({ prompt, preset, stylePrompt, settings, signal, slowAfterMs, onSlow } = {}) {
    const promptText = String(prompt || '').trim();
    if (!promptText) throw new Error('提示词不能为空');

    const config = _normalizeImageSettings(_getImageSettingsSource(settings));
    const imagePreset = preset
        ? _normalizeImagePreset(preset, config)
        : (config.imagePresets.find(p => p.id === config.defaultPresetId) || null);

    if (!imagePreset) throw new Error('尚未设置全局默认生图预设');
    if (!imagePreset.apiKey) throw new Error(`生图预设「${imagePreset.name}」尚未配置 API Key`);
    if (!imagePreset.model) throw new Error(`生图预设「${imagePreset.name}」尚未配置模型`);

    // 风格与比例在这里并入提示词；size 参数照旧发送，双保险见 composeImagePrompt
    const finalPrompt = composeImagePrompt(promptText, {
        stylePrompt,
        size: imagePreset.size
    });

    const requestScope = _createImageRequestScope(signal, slowAfterMs, onSlow);
    try {
        switch (imagePreset.provider) {
            case 'openai':
                return await _generateOpenAIImage(
                    imagePreset.apiUrl,
                    imagePreset.apiKey,
                    imagePreset,
                    finalPrompt,
                    requestScope.signal
                );

            default:
                throw new Error(`暂不支持的生图服务商: ${imagePreset.provider}`);
        }
    } catch (error) {
        if (requestScope.wasParentAborted() || (signal && signal.aborted)) {
            const aborted = new Error('生图请求已取消');
            aborted.name = 'AbortError';
            throw aborted;
        }
        throw error;
    } finally {
        requestScope.cleanup();
    }
}
