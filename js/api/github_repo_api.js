// ============================================================
// github_repo_api.js — GitHub / WebDAV 存储 API 层（凭据 / 归一化 / 带超时重试的请求）
// ============================================================
// 这一层只管远端存储协议，不认识任何页面，也不认识语音/图片。
// 历史 github 符号、仓库 ID 和三用途绑定保持不变，provider 缺省仍是 github。
// 消费方：
//   · js/settings/github_repos.js   → 仓库设置页（增删改、测试连接）
//   · js/chat/chat_voice_service.js → 语音归档读写
//   · js/chat/chat_image_store.js   → 图片归档读写
//   · js/settings/backup_data.js    → 全量云备份上传与流式恢复
//
// ★ 备份原先有另一套 GitHubService 传输：没有超时，还把所有查文件错误当成新建。
//   现在三种用途都走本层，只有真 404 才代表不存在，避免出现媒体支持 VPS 而备份不支持。
//   GitHubService 仅保留设置/入口职责；不要再从 API 层反向依赖 settings。
//
// ★ 仓库是一种可被多个用途共享的资源，不是某个功能的私有字段。所以数据分两层：
//   db.githubRepos    —— 仓库定义（凭据在这儿，改一次全用途生效）
//   db.githubBindings —— 用途绑定（哪个功能用哪个仓库、存在哪个目录下）
//   语音归档时每条音频还会记下自己当时用的 repoId，所以换绑定不影响旧音频。
//
// 对外符号：
//   GITHUB_PURPOSES / GITHUB_BRANCH_DEFAULT
//   _newGithubRepoId / _normalizeGithubRepo / _normalizeGithubRepos / _normalizeGithubBindings
//   getGithubRepo / getGithubBinding / describeGithubRepo / isGithubRepoConfigured
//   migrateLegacyGithubConfig
//   _ghFetch / checkGithubRepo
//   uploadGithubFile / downloadGithubFile / downloadGithubResponse / deleteGithubFile
// ============================================================

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_BRANCH_DEFAULT = 'main';

// 单次普通请求超时覆盖响应体；流式大备份则按块续期，只限制无进展的等待。
// 给上限是因为移动网络下 fetch 不会自己失败，会一直挂着。
const GITHUB_TIMEOUT_MS = 20000;
const GITHUB_RETRY_TIMES = 2;

// 用途清单。加一个用途 = 往这里加一条 + screen 里自动多出一个 select。
//
// ★ pathPrefix 定死在这里，不做成设置项。理由和 mp3/24000 那些常量一样：
//   用户判断不了该填什么，填错了内容会散在奇怪的地方。而且备份文件历来在仓库根目录，
//   放开让人改，改完旧备份就找不到了。
// ★ 改这里的默认值**不影响已归档的内容** —— 每条内容记的是自己完整的 cloudPath，
//   改默认目录只影响之后新上传的。所以这个决定将来想反悔也不用迁数据。
// ★ shortLabel 只给设置页「GitHub 仓库」那一行的状态文案用 —— 三个用途全开时
//   全称拼起来会在窄屏上折行。页面里的用途行仍用 label，那里空间够、全称更清楚。
const GITHUB_PURPOSES = [
    { key: 'backup', label: '数据备份', shortLabel: '备份', pathPrefix: '',
      hint: '全量备份文件传到仓库根目录。每日自动备份的开关在「存储备份 > 云端同步」里' },
    { key: 'voice', label: '语音归档', shortLabel: '语音', pathPrefix: 'voice',
      hint: '合成好的语音上传到这里，换设备也能听回来' },
    { key: 'image', label: '图片归档', shortLabel: '图片', pathPrefix: 'image',
      hint: '生成或转换后的图片上传到这里，换设备后仍可恢复真实封面' }
];

// ============================================================
// 归一化
// ============================================================

function _newGithubRepoId() {
    return `gh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function _normalizeGithubRepo(raw) {
    const r = raw || {};
    const provider = r.provider || 'github';
    return {
        id: r.id || _newGithubRepoId(),
        name: String(r.name || '').trim() || '未命名仓库',
        provider,
        baseUrl: String(r.baseUrl || '').trim(),
        // WebDAV 密码可能合法地包含首尾空格，不能照 GitHub Token 的方式 trim。
        token: provider === 'webdav' ? String(r.token || '') : String(r.token || '').trim(),
        username: String(r.username || '').trim(),
        repo: String(r.repo || '').trim(),
        branch: String(r.branch || '').trim() || GITHUB_BRANCH_DEFAULT
    };
}

function _normalizeGithubRepos(raw) {
    return Array.isArray(raw)
        ? raw.filter(r => r && (r.id || r.repo || r.baseUrl)).map(_normalizeGithubRepo)
        : [];
}

/** 统一检查用途绑定与读写配置；未知 provider 不能偷偷退回 GitHub。 */
function isGithubRepoConfigured(repo) {
    try {
        _requireGithubRepo(repo);
        return true;
    } catch (_) { return false; }
}

function _requireGithubRepo(repo) {
    const cfg = _normalizeGithubRepo(repo);
    if (!['github', 'webdav'].includes(cfg.provider)) throw _githubError('不支持的存储服务');
    if (!cfg.token) throw _githubError(cfg.provider === 'webdav' ? '还没填 WebDAV 密码' : '还没填访问令牌');
    if (!cfg.username) throw _githubError('还没填用户名');
    if (cfg.provider === 'webdav') {
        if (cfg.username.includes(':') || /[\x00-\x1f\x7f]/.test(cfg.username + cfg.token)) {
            throw _githubError('WebDAV 用户名不能含冒号，凭据不能含控制字符');
        }
        _webdavBaseUrl(cfg.baseUrl);
    } else if (!cfg.repo) throw _githubError('还没填仓库名');
    return cfg;
}

function _normalizeGithubBindings(raw) {
    const source = raw || {};
    const out = {};
    GITHUB_PURPOSES.forEach(p => {
        const b = source[p.key] || {};
        const repoId = String(b.repoId || '').trim();
        out[p.key] = {
            // ★ enabled 从 repoId 派生，不单独存。select 里的「不使用」就是关闭状态；
            //   两个字段表达同一件事就会有互相矛盾的可能（绑了仓库但 enabled=false）。
            enabled: !!repoId,
            repoId,
            // 目录一律来自用途定义，忽略存进来的任何值
            pathPrefix: p.pathPrefix || '',
            // 每日自动备份。只对 backup 有意义，编辑入口在「存储备份 > 云端同步」弹框
            autoBackup: !!b.autoBackup
        };
    });
    return out;
}

/** 按 id 取仓库定义；找不到返回 null（调用方一律先判空） */
function getGithubRepo(repoId, repos) {
    const id = String(repoId || '').trim();
    if (!id) return null;
    return _normalizeGithubRepos(repos || db.githubRepos).find(r => r.id === id) || null;
}

/**
 * 解析某个用途当前该往哪个仓库写。
 * @returns {{repo: object, pathPrefix: string}|null}
 *          null = 该用途没开、没绑仓库，或绑的仓库已被删掉
 * ★ 这个函数只回答"新内容往哪写"。读旧内容要用那条记录自己存的 repoId
 *   （见 voiceClips.cloudRepoId）—— 否则用户换过绑定之后旧内容就找不着了。
 */
function getGithubBinding(purpose) {
    const bindings = _normalizeGithubBindings(db.githubBindings);
    const binding = bindings[purpose];
    if (!binding || !binding.enabled || !binding.repoId) return null;
    const repo = getGithubRepo(binding.repoId);
    if (!isGithubRepoConfigured(repo)) return null;
    return { repo, pathPrefix: binding.pathPrefix };
}

// 备份功能的老配置存在 localStorage 这个键下（{token, username, repo, autoBackup}）
const GITHUB_LEGACY_BACKUP_KEY = 'qchat_github_config';

/**
 * 把备份功能原先存在 localStorage 的仓库配置迁进 db.githubRepos + githubBindings。
 * 幂等：已经迁过（存在同 username/repo 的仓库）就什么都不做。
 *
 * ★ 迁完**不删** localStorage 里的老配置。它是一份免费的保险 —— 万一这次迁移
 *   或者后续改动出了问题，用户的令牌还在原地，不至于要重新去 GitHub 生成。
 * ★ 老配置没有 branch 字段（上传走仓库默认分支），这里只能默认 main。
 *   如果用户的默认分支是 master，测试连接会报出来并告诉他实际默认分支是什么。
 *
 * @returns {Promise<boolean>} 是否真的迁移了（调用方据此决定要不要落库）
 */
async function migrateLegacyGithubConfig() {
    let legacy = null;
    try {
        legacy = JSON.parse(localStorage.getItem(GITHUB_LEGACY_BACKUP_KEY));
    } catch (_) { /* 坏 JSON 视为没有 */ }
    if (!legacy || !legacy.token || !legacy.username || !legacy.repo) return false;

    const repos = _normalizeGithubRepos(db.githubRepos);
    const already = repos.find(r => r.provider === 'github' &&
        r.username === legacy.username && r.repo === legacy.repo);

    const bindings = _normalizeGithubBindings(db.githubBindings);

    if (already) {
        // 仓库已经在列表里了，只补绑定（用户可能手动建过同一个仓库）
        if (bindings.backup.repoId) return false;
        bindings.backup = {
            ...bindings.backup, repoId: already.id, autoBackup: !!legacy.autoBackup
        };
        db.githubBindings = _normalizeGithubBindings(bindings);
        await saveGlobalKeys(['githubBindings']);
        console.log('[GitHub] 已把备份用途绑到既有仓库', already.name);
        return true;
    }

    const migrated = _normalizeGithubRepo({
        name: '备份仓库',
        token: legacy.token,
        username: legacy.username,
        repo: legacy.repo,
        branch: GITHUB_BRANCH_DEFAULT
    });
    repos.push(migrated);
    bindings.backup = {
        ...bindings.backup, repoId: migrated.id, autoBackup: !!legacy.autoBackup
    };
    db.githubRepos = repos;
    db.githubBindings = _normalizeGithubBindings(bindings);
    await saveGlobalKeys(['githubRepos', 'githubBindings']);
    console.log('[GitHub] 已把 localStorage 里的备份仓库配置迁入 db.githubRepos');
    return true;
}

/** 供下拉/提示显示的人类可读描述 */
function describeGithubRepo(repo) {
    if (!repo) return '';
    if (repo.provider === 'webdav') {
        // 未通过验证的原始 URL 不能直接显示，里面可能误填了密码或 query 密钥。
        try { return `WebDAV · ${_webdavBaseUrl(repo.baseUrl)}`; }
        catch (_) { return 'WebDAV · 未填或无效的目录地址'; }
    }
    const path = repo.username && repo.repo ? `${repo.username}/${repo.repo}` : '未填仓库';
    return `${path}${repo.branch ? ` · ${repo.branch}` : ''}`;
}

// ============================================================
// 请求封装
// ============================================================

function _githubError(message, extra = {}) {
    const error = new Error(message);
    Object.assign(error, { retryable: false, notFound: false }, extra);
    return error;
}

/** GitHub 的错误响应体是 {message, documentation_url}，取出来给用户看 */
async function _readGithubMessage(response) {
    try {
        const text = (await response.text()).trim();
        if (!text) return '';
        try { return JSON.parse(text).message || text; } catch (_) { return text; }
    } catch (_) { return ''; }
}

/** HTTP 状态码 → 人话。这些都是配置错误，重试没意义 */
function _describeGithubStatus(status, detail) {
    const tail = detail ? `：${detail}` : '';
    switch (status) {
        case 401: return '访问令牌无效或已过期';
        case 403: return detail && /rate limit/i.test(detail)
            ? 'GitHub 接口调用频率超限，稍后再试'
            : `令牌权限不足${tail}`;
        case 404: return '仓库或路径不存在（也可能是令牌对这个仓库没有权限）';
        case 409: return `仓库状态冲突${tail}`;
        case 422: return `请求被拒绝${tail}`;
        default: return `GitHub 返回 HTTP ${status}${tail}`;
    }
}

/**
 * 共用请求生命周期。普通请求的超时覆盖响应体；流式响应仅在等待下一块网络数据时计时。
 * 解压/清库/批量写库和背压等待不算网络停滞，避免大备份恢复中途被误判超时。
 * 重试只发生在交还响应之前，绝不把已交给恢复器的半截备份重新从头拼上去。
 */
async function _githubStorageRequest(url, { service = 'GitHub', method = 'GET', headers,
    body, signal, allow404 = false, allowStatuses = [], retry = GITHUB_RETRY_TIMES,
    consume } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= retry; attempt++) {
        const controller = new AbortController();
        let timer;
        let handedOff = false;
        const resetTimer = () => {
            clearTimeout(timer);
            timer = setTimeout(() => controller.abort(_githubError(
                `${service} 请求超时（超过 ${GITHUB_TIMEOUT_MS / 1000} 秒未完成传输）`,
                { retryable: true })), GITHUB_TIMEOUT_MS);
        };
        const onAbort = () => controller.abort(_githubError('操作已取消', { aborted: true }));
        const cleanup = () => {
            clearTimeout(timer);
            if (signal) signal.removeEventListener('abort', onAbort);
        };
        if (signal) {
            if (signal.aborted) onAbort();
            else signal.addEventListener('abort', onAbort, { once: true });
        }
        resetTimer();
        try {
            if (controller.signal.aborted) throw controller.signal.reason;
            const response = await fetch(url, {
                method, headers, body, signal: controller.signal,
                // WebDAV 凭据不得随跳转泄漏；GitHub 仓库重命名也应重新配置，而不是带密钥跟随。
                redirect: 'error', credentials: 'omit', cache: 'no-store'
            });
            if (controller.signal.aborted) throw controller.signal.reason;
            if (response.status === 404 && allow404) {
                if (response.body) await response.body.cancel();
                return null;
            }
            if (!response.ok && !allowStatuses.includes(response.status)) {
                const detail = service === 'GitHub' ? await _readGithubMessage(response) : '';
                if (service !== 'GitHub' && response.body) await response.body.cancel();
                if (controller.signal.aborted) throw controller.signal.reason;
                throw _githubError(service === 'GitHub'
                    ? _describeGithubStatus(response.status, detail)
                    : `WebDAV 返回 HTTP ${response.status}（请检查目录地址、用户名、密码和权限）`, {
                    status: response.status,
                    notFound: response.status === 404,
                    retryable: response.status >= 500 || response.status === 429
                });
            }
            if (consume) {
                const result = await consume(response);
                if (controller.signal.aborted) throw controller.signal.reason;
                return result;
            }
            // 不预读整个文件，也不在下游背压时抢读下一块；完成/取消/失败都会释放资源。
            if (!response.body) return response;
            const reader = response.body.getReader();
            clearTimeout(timer);
            let streamController;
            let finished = false;
            const finish = () => {
                finished = true;
                controller.signal.removeEventListener('abort', abortStream);
                cleanup();
            };
            const abortStream = () => {
                streamController.error(controller.signal.reason);
                reader.cancel(controller.signal.reason).catch(() => {});
                finish();
            };
            const stream = new ReadableStream({
                start(c) {
                    streamController = c;
                    controller.signal.addEventListener('abort', abortStream, { once: true });
                },
                async pull(c) {
                    if (finished) return;
                    try {
                        resetTimer();
                        const { done, value } = await reader.read();
                        clearTimeout(timer);
                        if (finished) return;
                        if (done) { c.close(); finish(); }
                        else c.enqueue(value);
                    } catch (error) {
                        if (!finished) c.error(error);
                        finish();
                    }
                },
                async cancel(reason) {
                    finish();
                    await reader.cancel(reason);
                }
            }, { highWaterMark: 0 });
            const wrapped = new Response(stream, {
                status: response.status, statusText: response.statusText, headers: response.headers
            });
            handedOff = true;
            return wrapped;
        } catch (error) {
            lastError = controller.signal.aborted ? controller.signal.reason
                : error.retryable !== undefined ? error
                : _githubError(`连接 ${service} 失败，请检查网络、跨域设置和目录地址`, { retryable: true });
            if (!lastError.retryable || attempt === retry) throw lastError;
        } finally {
            if (!handedOff) cleanup();
        }
    }
    throw lastError;
}

/** GitHub 的 JSON/原始内容共享鉴权头，不走无鉴权的 download_url。 */
function _githubHeaders(token, raw = false) {
    if (!token) throw _githubError('还没填这个仓库的访问令牌');
    return {
        Authorization: `Bearer ${token}`,
        Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
    };
}

/** 带超时、重试的 GitHub JSON 请求；只有 allow404 且真 404 才返回 null。 */
async function _ghFetch(path, { token, method = 'GET', body, signal,
                                allow404 = false, retry = GITHUB_RETRY_TIMES } = {}) {
    return _githubStorageRequest(`${GITHUB_API_BASE}${path}`, {
        method, signal, allow404, retry,
        headers: { ..._githubHeaders(token), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        consume: async response => {
            if (response.status === 204) return {};
            // 先读完再解析，不能把读 body 时的断网/超时误吞成成功的空对象。
            const text = await response.text();
            if (!text.trim()) return {};
            try { return JSON.parse(text); }
            catch (_) { throw _githubError('GitHub 返回了无效的 JSON'); }
        }
    });
}

/** 保留旧内部符号；原始字节读取的超时同样覆盖完整响应体。 */
async function _ghFetchBytes(path, { token, signal, retry = GITHUB_RETRY_TIMES } = {}) {
    return _githubStorageRequest(`${GITHUB_API_BASE}${path}`, {
        headers: _githubHeaders(token, true), signal, retry, allow404: true,
        consume: async response => new Uint8Array(await response.arrayBuffer())
    });
}

/**
 * 文件名是未编码的相对路径。逐层检查百分号编码，防代理再次解码后出现 dot/separator。
 * 不先交给 URL：URL 会悄悄消掉 a/../b，校验时就已经看不见危险输入了。
 */
function _githubSafeSegments(path, allowEmpty = false) {
    const text = String(path || '');
    const parts = text.split('/');
    if ((!allowEmpty && (!text || parts.some(p => !p))) || /[\\\x00-\x1f\x7f]/.test(text)) {
        throw _githubError('文件路径必须是安全的相对路径');
    }
    return parts.filter(Boolean).map(part => {
        let decoded = part;
        for (;;) {
            if (decoded === '.' || decoded === '..' || /[\\/\x00-\x1f\x7f]/.test(decoded)) {
                throw _githubError('路径不能包含目录穿越或编码分隔符');
            }
            if (!/%[0-9a-f]{2}/i.test(decoded)) break;
            let next;
            try { next = decodeURIComponent(decoded); }
            catch (_) { throw _githubError('路径包含无效的百分号编码'); }
            if (next === decoded) break;
            decoded = next;
        }
        return part;
    });
}

/** 只接受 HTTPS 目录（本机回环调试可用 HTTP），URL 不能藏用户名、密码、query 或 hash。 */
function _webdavBaseUrl(baseUrl) {
    const text = String(baseUrl || '').trim();
    const match = text.match(/^https?:\/\/([^/?#]+)(\/[^?#]*)?$/i);
    if (!match || /[@\\\x00-\x20\x7f]/.test(match[1]) || /[\\\x00-\x1f\x7f]/.test(text)) {
        throw _githubError('WebDAV 地址必须是目录 URL，不能含凭据、查询参数或片段');
    }
    _githubSafeSegments(match[2] || '', true);
    let url;
    try { url = new URL(text); }
    catch (_) { throw _githubError('WebDAV 目录地址无效'); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
        || url.username || url.password || url.search || url.hash) {
        throw _githubError('WebDAV 必须使用 HTTPS（仅 localhost 可用 HTTP），凭据请单独填写');
    }
    // 已编码目录先解一次再逐段编码，既兼容粘贴 URL，又避免中文/空格或 % 被二次编码。
    const path = (match[2] || '').split('/').filter(Boolean).map(part => {
        try { return encodeURIComponent(decodeURIComponent(part)); }
        catch (_) { throw _githubError('WebDAV 目录地址编码无效'); }
    }).join('/');
    return `${url.origin}/${path}${path ? '/' : ''}`;
}

function _webdavFileUrl(repo, filePath) {
    return _webdavBaseUrl(repo.baseUrl) + _githubSafeSegments(filePath).map(encodeURIComponent).join('/');
}

function _webdavRequest(repo, url, options = {}) {
    return _githubStorageRequest(url, {
        ...options, service: 'WebDAV',
        headers: {
            ...options.headers,
            // btoa 不接受中文；沿用项目字节工具，先 UTF-8 编码再生成 Basic 凭据。
            Authorization: `Basic ${bytesToBase64(new TextEncoder().encode(`${repo.username}:${repo.token}`))}`
        }
    });
}

/** 只读验证资源类型；207 内部仍可能是 401/404，不能只看外层 HTTP 成功。 */
function _webdavIsCollection(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) return false;
    const responses = Array.from(doc.getElementsByTagNameNS('DAV:', 'response'));
    // Depth:0 应当仅返回被请求的这个资源，不能借别的目录的成功掩盖本目录失败。
    if (responses.length !== 1) return false;
    return Array.from(responses[0].getElementsByTagNameNS('DAV:', 'propstat')).some(propstat => {
        const status = propstat.getElementsByTagNameNS('DAV:', 'status')[0];
        return status && /^HTTP\/\S+\s+2\d\d(?:\s|$)/.test(status.textContent.trim())
            && Array.from(propstat.getElementsByTagNameNS('DAV:', 'resourcetype'))
                .some(type => type.getElementsByTagNameNS('DAV:', 'collection').length > 0);
    });
}

/**
 * 测试一个仓库配置能不能用。分两步查，好让错误能精确指到是仓库还是分支的问题。
 * @returns {Promise<{ok: boolean, message: string, canWrite: boolean}>}
 *          不抛异常 —— 这个函数的用途就是把失败原因说清楚
 */
async function checkGithubRepo(rawRepo) {
    let cfg;
    try {
        cfg = _requireGithubRepo(rawRepo);
        if (cfg.provider === 'webdav') {
            const collection = await _webdavRequest(cfg, _webdavBaseUrl(cfg.baseUrl), {
                method: 'PROPFIND', headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
                body: '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
                consume: async response => _webdavIsCollection(await response.text())
            });
            if (!collection) throw _githubError('WebDAV 未返回可访问的目录，请检查目录地址和读取权限');
            // PROPFIND 只能确认可读；不写探针，也不把「能读」谎称成「已验证能写」。
            return { ok: true, canWrite: false,
                message: 'WebDAV 目录连接成功；仅验证读取，写入权限将在实际上传时验证' };
        }
    } catch (error) {
        return { ok: false, message: error.message, canWrite: false };
    }

    const base = `/repos/${encodeURIComponent(cfg.username)}/${encodeURIComponent(cfg.repo)}`;
    let info;
    try {
        info = await _ghFetch(base, { token: cfg.token });
    } catch (error) {
        return { ok: false, message: error.message, canWrite: false };
    }

    // 归档要写文件，只读令牌能连上但用不了 —— 现在就说，别等上传时才失败
    const canWrite = !!(info.permissions && (info.permissions.push || info.permissions.admin));

    try {
        await _ghFetch(`${base}/branches/${encodeURIComponent(cfg.branch)}`, { token: cfg.token });
    } catch (error) {
        if (error.notFound) {
            return {
                ok: false, canWrite,
                message: `仓库连上了，但没有分支「${cfg.branch}」。`
                    + `这个仓库的默认分支是「${info.default_branch || '未知'}」`
            };
        }
        return { ok: false, message: error.message, canWrite };
    }

    const visibility = info.private ? '私有' : '公开';
    if (!canWrite) {
        return {
            ok: false, canWrite: false,
            message: `连上了 ${cfg.username}/${cfg.repo}（${visibility}），`
                + '但这个令牌没有写入权限，没法上传。请给它该仓库的 Contents 读写权限'
        };
    }
    return {
        ok: true, canWrite: true,
        message: `连接成功：${cfg.username}/${cfg.repo}（${visibility}）· 分支 ${cfg.branch}`
            + (info.private ? '' : '\n注意这是公开仓库，上传的音频任何人都能访问')
    };
}

// ============================================================
// 文件读写
// ============================================================

/** 拼 Contents API 的路径。路径段要逐段编码，斜杠本身不能编码掉 */
function _ghContentsPath(repo, filePath) {
    const encoded = _githubSafeSegments(filePath).map(encodeURIComponent).join('/');
    return `/repos/${encodeURIComponent(repo.username)}/${encodeURIComponent(repo.repo)}`
         + `/contents/${encoded}`;
}

/**
 * 上传（或覆盖）一个文件。
 *
 * ★ 原备份传输曾把 getFileInfo 的所有异常当成新建，导致 401/断网后缺 sha。
 *   现在备份也共用这里：只有真 404 才等于无需 sha，其他异常直接中止。
 *
 * @param {object} repo     GitHub 或 WebDAV 仓库配置
 * @param {string} filePath 仓库内路径，如 voice/ab/xxx.mp3
 * @param {Uint8Array} bytes
 * @param {object} [opts]   { message, signal, ifAbsent, migration }；仅迁移内部可绕过忙锁
 * @returns {Promise<{path: string, sha: string}>}
 */
async function uploadGithubFile(repo, filePath, bytes, { message, signal, ifAbsent = false, migration = false } = {}) {
    if (!migration && typeof window !== 'undefined' && window.CloudRepoMigration?.isBusy()) {
        throw _githubError('正在迁移云端仓库，暂缓上传，请迁移完成后重试');
    }
    repo = _requireGithubRepo(repo);
    if (!filePath) throw _githubError('没有指定上传路径');
    if (repo.provider === 'webdav') {
        const url = _webdavFileUrl(repo, filePath);
        const parts = _githubSafeSegments(filePath);
        let directory = _webdavBaseUrl(repo.baseUrl);
        for (const part of parts.slice(0, -1)) {
            directory += `${encodeURIComponent(part)}/`;
            await _webdavRequest(repo, directory, {
                method: 'MKCOL', signal, allowStatuses: [405],
                // 405 是「已存在」的常见返回；其他错误绝不能吞掉继续写。
                consume: response => response.text()
            });
        }
        await _webdavRequest(repo, url, {
            method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', ...(ifAbsent ? { 'If-None-Match': '*' } : {}) },
            body: bytes, signal, retry: 0, consume: response => response.text()
        });
        return { path: filePath, sha: '' };
    }

    const apiPath = _ghContentsPath(repo, filePath);

    // 已存在就得带上 sha 才能覆盖。allow404 让"文件不存在"走正常返回 null，
    // 其余异常（401/断网/5xx）会直接抛出来，不会被误当成新文件。
    const existing = await _ghFetch(
        `${apiPath}?ref=${encodeURIComponent(repo.branch || GITHUB_BRANCH_DEFAULT)}`,
        { token: repo.token, allow404: true, signal });
    if (existing && ifAbsent) throw _githubError('目标文件已存在，不能覆盖', { status: 412 });
    if (existing && !existing.sha) throw _githubError('GitHub 未返回文件 sha，无法安全覆盖');

    const body = {
        message: message || `Add ${filePath}`,
        content: bytesToBase64(bytes),
        branch: repo.branch || GITHUB_BRANCH_DEFAULT
    };
    if (existing && existing.sha) body.sha = existing.sha;

    const result = await _ghFetch(apiPath, {
        token: repo.token, method: 'PUT', body, signal,
        // 上传不重试：PUT 不是幂等的（sha 可能已经变了），失败让上层重新走一遍
        // 取 sha 再传，比盲目重试安全
        retry: 0
    });
    return {
        path: filePath,
        sha: (result && result.content && result.content.sha) || ''
    };
}

/**
 * 获取带鉴权的下载响应，供大备份流式恢复使用；真 404 返回 null。
 * GitHub 直接用 raw+json 和 ref，不先把大文件装进 JSON，也不跟随 download_url。
 * 响应头到达前限时 20 秒；交还后仅在等待读取下一块网络数据时计时，下游背压不计时。
 * 调用者必须读完或 cancel 响应体（提前退出的 reader 在 finally 中 cancel），也可传 signal 取消。
 * 不限制整份大备份的总时长；一旦交还流，途中失败不再重试，避免重复导入半截内容。
 */
async function downloadGithubResponse(repo, filePath, { signal } = {}) {
    repo = _requireGithubRepo(repo);
    if (!filePath) throw _githubError('没有指定下载路径');
    if (repo.provider === 'webdav') {
        return _webdavRequest(repo, _webdavFileUrl(repo, filePath), { signal, allow404: true });
    }
    const path = `${_ghContentsPath(repo, filePath)}?ref=${encodeURIComponent(repo.branch)}`;
    return _githubStorageRequest(`${GITHUB_API_BASE}${path}`, {
        headers: _githubHeaders(repo.token, true), signal, allow404: true
    });
}

/**
 * 下载一个文件的字节。
 * @returns {Promise<Uint8Array|null>} null = 文件确实不存在（真 404）
 * @throws {Error} 其他失败原样抛出，附 retryable 标记
 */
async function downloadGithubFile(repo, filePath, { signal } = {}) {
    repo = _requireGithubRepo(repo);
    if (!filePath) throw _githubError('没有指定下载路径');
    if (repo.provider === 'webdav') {
        return _webdavRequest(repo, _webdavFileUrl(repo, filePath), {
            signal, allow404: true,
            consume: async response => new Uint8Array(await response.arrayBuffer())
        });
    }

    const contentPath = `${_ghContentsPath(repo, filePath)}?ref=${encodeURIComponent(repo.branch || GITHUB_BRANCH_DEFAULT)}`;
    const info = await _ghFetch(
        contentPath,
        { token: repo.token, allow404: true, signal });
    if (!info) return null;   // 真 404：云端那份被删了

    // 1MB 以内 Contents API 直接把 base64 塞在 content 里，省一次请求。
    if (info.content && info.encoding === 'base64') {
        return base64ToBytes(String(info.content).replace(/\s/g, ''));
    }

    // 1MB～100MB 的文件不会返回 base64 content。重新请求同一 Contents API，
    // 但使用 raw media type；这样私有仓库下载仍带鉴权，也不依赖临时 download_url。
    return await _ghFetchBytes(contentPath, { token: repo.token, signal });
}

/**
 * 删除一个文件。
 *
 * ★ 和 uploadGithubFile 一样必须先拿 sha 才能删，所以同样只把**真 404**当成
 *   "文件已经不在了"；401 / 断网 / 5xx 一律抛出中止，绝不能误判成"删掉了"——
 *   上层靠这个区分来决定要不要接着删本地数据。
 *
 * @param {object} repo     { username, repo, token, branch }
 * @param {string} filePath 仓库内路径，如 image/ab/xxx.png
 * @param {object} [opts]   { message, signal }
 * @returns {Promise<{path: string, alreadyMissing: boolean}>}
 *          alreadyMissing=true 表示云端本来就没有这个文件（目标状态已达成，视为成功）
 * @throws {Error} 其他失败原样抛出，附 retryable 标记
 */
async function deleteGithubFile(repo, filePath, { message, signal } = {}) {
    repo = _requireGithubRepo(repo);
    if (!filePath) throw _githubError('没有指定删除路径');
    if (repo.provider === 'webdav') {
        const result = await _webdavRequest(repo, _webdavFileUrl(repo, filePath), {
            method: 'DELETE', signal, allow404: true, retry: 0,
            consume: async response => {
                await response.text();
                // 文件 DELETE 不应返回多资源结果；不能把 207 内部失败误当删除成功。
                if (response.status === 207) throw _githubError('WebDAV 删除返回多资源结果，无法确认文件已删除');
                return true;
            }
        });
        return { path: filePath, alreadyMissing: result === null };
    }

    const apiPath = _ghContentsPath(repo, filePath);
    const branch = repo.branch || GITHUB_BRANCH_DEFAULT;

    const existing = await _ghFetch(
        `${apiPath}?ref=${encodeURIComponent(branch)}`,
        { token: repo.token, allow404: true, signal });
    // 真 404：云端那份早就没了，不用再发 DELETE；成功响应缺 sha 不能冒充不存在。
    if (!existing) return { path: filePath, alreadyMissing: true };
    if (!existing.sha) throw _githubError('GitHub 未返回文件 sha，无法安全删除');

    const deleted = await _ghFetch(apiPath, {
        token: repo.token,
        method: 'DELETE',
        body: { message: message || `Delete ${filePath}`, sha: existing.sha, branch },
        signal, allow404: true,
        // 和上传同理：sha 可能已经变了，盲目重试不安全，失败让上层重走一遍
        retry: 0
    });
    return { path: filePath, alreadyMissing: deleted === null };
}
