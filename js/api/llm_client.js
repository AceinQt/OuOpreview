// llm_client.js — 文本 LLM 调用统一适配层
// =====================================================
// 全项目所有文本 API 调用都应经过 callLLM()，不要再各自拼端点/解析 SSE。
//
// 为什么需要这一层：
//   · Gemini 原生格式和 OpenAI 格式的端点、请求体字段、流式协议、响应结构全都不同；
//   · 新版 vertex-proxy 只提供 Gemini 原生端点，没有 /v1/chat/completions；
//   · 原先 9 个模块各写一份 SSE 解析，同一个 bug 要修 9 遍。
//
// 调用方永远只提供 OpenAI 形状的 messages，转换由本文件负责。

// ── Gemini 请求体字段必须是 camelCase ────────────────────────
// 新版代理用 Go 结构体 tag 解析，只认 systemInstruction / inlineData / mimeType。
// 传 snake_case（system_instruction 等）会被当未知字段静默丢弃——
// 表现就是"世界书和人设完全不生效"，且不报任何错。

/** OpenAI 形状的 messages → Gemini 的 { contents, systemInstruction } */
function _toGeminiPayload(messages) {
    const systemTexts = [];
    const contents = [];

    for (const msg of messages || []) {
        if (msg.role === 'system') {
            // Gemini 没有 system 轮次，全部并入 systemInstruction
            if (typeof msg.content === 'string') systemTexts.push(msg.content);
            continue;
        }

        const role = (msg.role === 'assistant' || msg.role === 'model') ? 'model' : 'user';
        let parts;

        if (Array.isArray(msg.content)) {
            // vision 格式：[{type:'text'}, {type:'image_url'}]
            parts = msg.content.map(p => {
                if (p.type === 'text') return { text: p.text };
                if (p.type === 'image_url') {
                    const raw = p.image_url?.url || '';
                    const m = raw.match(/^data:([^;]+);base64,(.*)$/);
                    return m ? { inlineData: { mimeType: m[1], data: m[2] } } : null;
                }
                if (p.inlineData || p.inline_data) {
                    const d = p.inlineData || p.inline_data;
                    return { inlineData: { mimeType: d.mimeType || d.mime_type, data: d.data } };
                }
                if (typeof p.text === 'string') return { text: p.text };
                return null;
            }).filter(Boolean);
        } else {
            parts = [{ text: String(msg.content ?? '') }];
        }

        if (parts.length) contents.push({ role, parts });
    }

    return { contents, systemInstruction: systemTexts.join('\n\n') };
}

// ── 从预设/配置对象里归一化出 url / key / model / provider ──────
// 各模块的取配置逻辑口径不一（url vs apiUrl、key vs apiKey），统一在这里兜。
function normalizeLLMConfig(cfg) {
    cfg = cfg || {};
    let url = (cfg.url || cfg.apiUrl || '').trim();
    if (url.endsWith('/')) url = url.slice(0, -1);
    return {
        url,
        key: (cfg.key || cfg.apiKey || '').trim(),
        model: cfg.model || '',
        provider: cfg.provider || 'newapi',
        temperature: cfg.temperature,
        streamEnabled: cfg.streamEnabled !== false
    };
}

/** 多 key 轮询：utils.js 里的 getRandomValue，缺失时退化为原值 */
function _pickKey(key) {
    return (typeof getRandomValue === 'function') ? getRandomValue(key) : key;
}

// ── SSE 解析 ────────────────────────────────────────────────
// 两家的流式都是 SSE，差别只在每个事件的 JSON 结构。
// 注意：必须按空行切事件、跨 chunk 保留残余，不能按 '\n' 逐行 JSON.parse ——
// 一个 JSON 可能被 TCP 切在中间，逐行解析会静默丢字。
async function _readSSE(response, isGemini, onChunk, meta) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let full = '', buffer = '', raw = '';

    const emit = (delta) => {
        if (!delta) return;
        full += delta;
        if (onChunk) onChunk(delta, full);
    };

    // Gemini：思考是 parts 里带 thought:true 的一项，内容同样在 text 字段，
    // 必须按 part 判断丢弃，否则思考过程会混进正文。
    const collectGemini = (json) => {
        for (const p of json.candidates?.[0]?.content?.parts || []) {
            if (p.thought) continue;
            if (typeof p.text === 'string') emit(p.text);
        }
    };

    const noteFinish = (json) => {
        if (!meta) return;
        const r = _extractFinishReason(json, isGemini);
        if (r) meta.finishReason = r;
    };

    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        raw += chunk;
        buffer += chunk;

        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop();   // 末尾可能是半个事件，留到下一轮
        for (const ev of events) {
            // 一个事件可能有多行 data:，拼起来才是完整 JSON
            const data = ev.split(/\r?\n/)
                .filter(l => l.startsWith('data:'))
                .map(l => l.slice(5).trim())
                .join('');
            if (!data || data === '[DONE]') continue;
            try {
                const json = JSON.parse(data);
                noteFinish(json);
                if (isGemini) collectGemini(json);
                else emit(json.choices?.[0]?.delta?.content || '');
            } catch (e) { /* 半包或非 JSON，忽略 */ }
        }
    }

    // 兜底：旧版代理的 :streamGenerateContent 不发 SSE，返回一个 JSON 数组
    if (isGemini && !full && raw.trim()) {
        try {
            const arr = JSON.parse(raw.trim());
            (Array.isArray(arr) ? arr : [arr]).forEach(j => { noteFinish(j); collectGemini(j); });
        } catch (e) {
            const re = /"text":\s*"((?:[^"\\]|\\.)*)"/g;
            let m;
            while ((m = re.exec(raw)) !== null) {
                try { emit(JSON.parse(`"${m[1]}"`)); } catch (_) { emit(m[1]); }
            }
        }
    }

    return full;
}

/** 非流式响应 → 文本。Gemini 同样要跳过 thought part 并拼接所有 text。 */
function _extractNonStream(json, isGemini) {
    if (isGemini) {
        return (json.candidates?.[0]?.content?.parts || [])
            .filter(p => !p.thought && typeof p.text === 'string')
            .map(p => p.text).join('');
    }
    return json.choices?.[0]?.message?.content || '';
}

/** 两家的"为什么停下来"字段名不同，统一成 OpenAI 的口径供上层判断内容审查 */
function _extractFinishReason(json, isGemini) {
    if (isGemini) {
        const r = json.candidates?.[0]?.finishReason;
        if (!r) return null;
        // SAFETY / BLOCKLIST / PROHIBITED_CONTENT 都是被拦，归一成 content_filter
        if (/SAFETY|BLOCK|PROHIBITED|RECITATION/i.test(r)) return 'content_filter';
        if (r === 'MAX_TOKENS') return 'length';
        if (r === 'STOP') return 'stop';
        return r;
    }
    return json.choices?.[0]?.finish_reason || null;
}

// ── 主入口 ──────────────────────────────────────────────────
/**
 * 调一次文本 LLM，返回完整文本。
 *
 * @param {object}   opts
 * @param {object}   opts.cfg          预设对象（含 url/key/model/provider/temperature/streamEnabled）
 * @param {Array}    opts.messages     OpenAI 形状的 messages，system 轮次会自动转成 systemInstruction
 * @param {number}   [opts.temperature] 覆盖 cfg 里的温度
 * @param {boolean}  [opts.stream]     覆盖 cfg.streamEnabled；有 onChunk 时默认走流式
 * @param {Function} [opts.onChunk]    (delta, accumulated) 实时回调，仅流式有效
 * @param {AbortSignal} [opts.signal]
 * @param {number}   [opts.timeout]    毫秒；未传 signal 时内部建 AbortController
 * @param {object}   [opts.extraBody]  合并进请求体（OpenAI 分支）或 generationConfig（Gemini 分支）
 * @param {object}   [opts.meta]       传一个空对象进来，返回后可读 meta.finishReason
 *                                     （'content_filter' / 'length' / 'stop' / null，两家已归一）
 * @returns {Promise<string>} 完整文本
 */
async function callLLM(opts = {}) {
    const cfg = normalizeLLMConfig(opts.cfg);
    const { url, model } = cfg;
    const key = _pickKey(cfg.key);
    if (!url || !key || !model) throw new Error('API 未配置完整（缺少地址、密钥或模型）');

    const isGemini = cfg.provider === 'gemini';
    const stream = opts.stream !== undefined
        ? !!opts.stream
        : (typeof opts.onChunk === 'function' ? true : cfg.streamEnabled);
    const temperature = opts.temperature !== undefined
        ? opts.temperature
        : (cfg.temperature !== undefined ? cfg.temperature : 0.8);

    // 未传 signal 又给了 timeout 时，自己建一个
    let signal = opts.signal, timer = null;
    if (!signal && opts.timeout) {
        const ac = new AbortController();
        timer = setTimeout(() => ac.abort(), opts.timeout);
        signal = ac.signal;
    }

    let endpoint, headers, body;
    if (isGemini) {
        const { contents, systemInstruction } = _toGeminiPayload(opts.messages);
        const action = stream ? 'streamGenerateContent' : 'generateContent';
        endpoint = `${url}/v1beta/models/${model}:${action}?key=${encodeURIComponent(key)}`
            + (stream ? '&alt=sse' : '');
        headers = { 'Content-Type': 'application/json' };
        body = {
            contents,
            generationConfig: { temperature, ...(opts.extraBody?.generationConfig || {}) }
        };
        if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };
    } else {
        endpoint = `${url}/v1/chat/completions`;
        headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
        body = { model, messages: opts.messages, temperature, stream, ...(opts.extraBody || {}) };
    }

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal
        });

        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            const err = new Error(`API Error: ${response.status}${detail ? ' ' + detail.slice(0, 200) : ''}`);
            err.response = response;
            err.status = response.status;
            throw err;
        }

        if (stream) return await _readSSE(response, isGemini, opts.onChunk, opts.meta);
        const json = await response.json();
        if (opts.meta) opts.meta.finishReason = _extractFinishReason(json, isGemini);
        return _extractNonStream(json, isGemini);
    } finally {
        if (timer) clearTimeout(timer);
    }
}
