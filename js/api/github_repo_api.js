// ============================================================
// github_repo_api.js — GitHub 仓库 API 层（凭据 / 归一化 / 带超时重试的请求）
// ============================================================
// 这一层只管"怎么跟 GitHub 说话"，不认识任何页面，也不认识语音/图片。
// 消费方：
//   · js/settings/github_repos.js  → 仓库设置 screen（增删改、测试连接）
//   · js/chat/chat_voice_service.js → 语音归档读写（Phase 6）
//
// ★ 为什么不复用 backup_data.js 里的 GitHubService：
//   1. 那套整个文件零重试零超时 —— 移动网络下一个挂起的 fetch 能永远卡死队列
//   2. 它把 getFileInfo 的**所有**异常都吞掉当"新建文件"，401/断网会让 PUT 丢 sha，
//      结果报出误导性的 409/422。本模块里只有**真 404** 才等于"文件不存在"
//   3. 它在 settings 层，js/api/ 依赖它会形成反向依赖
//   备份链路迁过来是独立的一步，不进语音功能的关键路径。
//
// ★ 仓库是一种可被多个用途共享的资源，不是某个功能的私有字段。所以数据分两层：
//   db.githubRepos    —— 仓库定义（凭据在这儿，改一次全用途生效）
//   db.githubBindings —— 用途绑定（哪个功能用哪个仓库、存在哪个目录下）
//   语音归档时每条音频还会记下自己当时用的 repoId，所以换绑定不影响旧音频。
//
// 对外符号：
//   GITHUB_PURPOSES / GITHUB_BRANCH_DEFAULT
//   _newGithubRepoId / _normalizeGithubRepo / _normalizeGithubRepos / _normalizeGithubBindings
//   getGithubRepo / getGithubBinding / describeGithubRepo
//   _ghFetch / checkGithubRepo
// ============================================================

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_BRANCH_DEFAULT = 'main';

// 单次请求超时。GitHub Contents API 一般一两秒返回，20 秒已经很宽松；
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
const GITHUB_PURPOSES = [
    { key: 'backup', label: '数据备份', pathPrefix: '',
      hint: '全量备份文件传到仓库根目录。每日自动备份的开关在「存储备份 > 云端同步」里' },
    { key: 'voice', label: '语音归档', pathPrefix: 'voice',
      hint: '合成好的语音上传到这里，换设备也能听回来' },
    { key: 'image', label: '图片归档', pathPrefix: 'image',
      hint: '暂未接入，先留位置' }
];

// ============================================================
// 归一化
// ============================================================

function _newGithubRepoId() {
    return `gh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function _normalizeGithubRepo(raw) {
    const r = raw || {};
    return {
        id: r.id || _newGithubRepoId(),
        name: String(r.name || '').trim() || '未命名仓库',
        token: String(r.token || '').trim(),
        username: String(r.username || '').trim(),
        repo: String(r.repo || '').trim(),
        branch: String(r.branch || '').trim() || GITHUB_BRANCH_DEFAULT
    };
}

function _normalizeGithubRepos(raw) {
    return Array.isArray(raw)
        ? raw.filter(r => r && (r.id || r.repo)).map(_normalizeGithubRepo)
        : [];
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
    if (!repo || !repo.token || !repo.username || !repo.repo) return null;
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
    const already = repos.find(r =>
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
 * 打一次 GitHub API。带超时和重试，错误一律转成人话后抛出。
 *
 * ★ 只有真 404 会把 notFound 标成 true 并正常返回 null，其他异常一律抛出。
 *   这是和 GitHubService 最重要的区别：把网络故障当成"文件不存在"会导致
 *   上传时丢 sha，进而覆盖或报出莫名其妙的 409。
 *
 * @param {string} path      /repos/... 开头的路径
 * @param {object} opts      { token, method, body, signal, allow404, retry }
 * @returns {Promise<object|null>} 解析后的 JSON；allow404 且确实 404 时返回 null
 * @throws {Error} message 已是可直接展示的文案；retryable 标记是否值得重试
 */
async function _ghFetch(path, { token, method = 'GET', body, signal,
                                allow404 = false, retry = GITHUB_RETRY_TIMES } = {}) {
    if (!token) throw _githubError('还没填这个仓库的访问令牌');

    let lastError = null;
    for (let attempt = 0; attempt <= retry; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), GITHUB_TIMEOUT_MS);
        const onAbort = () => controller.abort();
        if (signal) {
            if (signal.aborted) controller.abort();
            else signal.addEventListener('abort', onAbort, { once: true });
        }

        let response;
        try {
            response = await fetch(`${GITHUB_API_BASE}${path}`, {
                method,
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28',
                    ...(body ? { 'Content-Type': 'application/json' } : {})
                },
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal
            });
        } catch (error) {
            if (signal && signal.aborted) throw _githubError('操作已取消', { aborted: true });
            lastError = error.name === 'AbortError'
                ? _githubError(`连接 GitHub 超时（超过 ${GITHUB_TIMEOUT_MS / 1000} 秒）`,
                    { retryable: true })
                : _githubError(`连接 GitHub 失败：${error.message}`, { retryable: true });
            continue;   // 网络层失败值得重试
        } finally {
            clearTimeout(timer);
            if (signal) signal.removeEventListener('abort', onAbort);
        }

        if (response.status === 404 && allow404) return null;

        if (!response.ok) {
            const detail = await _readGithubMessage(response);
            // 5xx 和 429 是服务端/限流问题，重试有意义；4xx 是我们自己的问题，重试只是浪费
            const worthRetry = response.status >= 500 || response.status === 429;
            const error = _githubError(_describeGithubStatus(response.status, detail), {
                status: response.status,
                retryable: worthRetry,
                notFound: response.status === 404
            });
            if (!worthRetry || attempt === retry) throw error;
            lastError = error;
            continue;
        }

        // 204 No Content 没有响应体
        if (response.status === 204) return {};
        try {
            return await response.json();
        } catch (_) {
            return {};
        }
    }
    throw lastError || _githubError('连接 GitHub 失败');
}

/**
 * 测试一个仓库配置能不能用。分两步查，好让错误能精确指到是仓库还是分支的问题。
 * @returns {Promise<{ok: boolean, message: string, canWrite: boolean}>}
 *          不抛异常 —— 这个函数的用途就是把失败原因说清楚
 */
async function checkGithubRepo(rawRepo) {
    const cfg = _normalizeGithubRepo(rawRepo);
    if (!cfg.token) return { ok: false, message: '还没填访问令牌', canWrite: false };
    if (!cfg.username) return { ok: false, message: '还没填用户名', canWrite: false };
    if (!cfg.repo) return { ok: false, message: '还没填仓库名', canWrite: false };

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
