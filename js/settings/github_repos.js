// ============================================================
// github_repos.js — 云端仓库设置页（GitHub / VPS WebDAV）
// ============================================================
// 凭据归一化、请求、错误转人话、连通性检查都在 js/api/github_repo_api.js，
// 本文件只管这个 screen 的表单读写。
//
// 页面分「仓库配置」和「用途配置」两段，对应两层数据：
//   db.githubRepos    —— 仓库定义（含令牌或密码）。同一个仓库能被多个用途共用
//   db.githubBindings —— 用途绑定（哪个功能用哪个仓库、存哪个目录）
// 拆开的理由见 github_repo_api.js 顶部：仓库是共享资源，凭据不该跟着用途复制好几份。
//
// ★ 用途行是按 GITHUB_PURPOSES 动态渲染的，加一个用途不用改这个文件。
//
// ★ 版式和说明文字：版式沿用 notification-settings-screen 的
//   settings-group-title + settings-card（类在 css/pages/settings/settings_screen.css），
//   说明一律不铺在页面上，注册到 AppHelp（js/core/utils.js）后由问号弹出。
//
// 对外符号：
//   openGithubReposScreen（main.js 的 pageActions 调用）
//   refreshGithubReposSummary（设置页那一行的状态文案）
// ============================================================

// 页面上的编辑草稿。点保存前所有改动只在这里，不碰 db。
let _ghDraft = null;
let _ghLoadedRepoId = '';

// ============================================================
// 问号说明
// ============================================================
// 这页原本把注意事项全铺在页面上，结果说明比设置项还长。现在一律收进问号：
//   header 右上角 → page（整页）
//   「仓库配置」旁 → repo
//   「用途配置」旁 → purpose
// 弹窗机制是公共的，在 js/core/utils.js 的 AppHelp 里；这里只放文案。
//
// ★ 正文经 AppUI.alert → innerText 输出，换行只能用 \n，写 <br> 会原样显示。
// ★ purpose 那条用函数而不是字符串：各用途的说明来自 GITHUB_PURPOSES，
//   点开时才拼，这样加/改用途不用回来同步文案。
AppHelp.register('github', {
    page: {
        title: '关于云端仓库（GitHub / VPS）',
        content:
            '仓库配置保存存储位置和凭据，用途配置选择要使用的仓库。'
            + 'GitHub 和 VPS 上的 WebDAV 都支持数据备份、语音归档、图片归档，'
            + '同一个仓库可以被多个用途共用。\n\n'
            + '【凭据与备份】\n'
            + 'API Key、仓库令牌/密码、推送私钥明文保存在本机浏览器里。'
            + '云端备份会剔除这些敏感凭据，本地导出仍含凭据，请勿随手分享本地备份。'
            + '新设备从云端恢复后需要重新填写；未绑定用途的仓库可以暂留空凭据，启用前再补齐。'
            + '原设备恢复时，仅同服务、同 ID 的配置可保留本机凭据，'
            + '服务地址或仓库定位不一致时不会沿用。旧归档需要对应仓库凭据才能读取。\n\n'
            + '【切换仓库与旧内容】\n'
            + '历史语音和图片记着归档时的仓库 ID，换用途绑定不会迁移或删除旧文件。'
            + '请保留旧仓库定义与凭据；需要更换服务、账号、仓库、分支或 WebDAV 目录时，'
            + '新增仓库再切换绑定，不要直接改旧仓库定位。已有历史引用的仓库会禁止这样修改，'
            + '但仍可更新令牌或密码。删除仓库后，即使再新增同地址仓库，ID 不同也不能自动恢复旧引用；'
            + '需要恢复含原仓库 ID 的配置/备份，并补齐对应凭据。\n\n'
            + '【GitHub → VPS 迁移】\n'
            + '先分别保存 GitHub 和 WebDAV 仓库，再用下方入口盘点并迁移。本机仍引用的文件按原路径复制、读回校验后更新引用；'
            + '完成后将来源用途切向 VPS，并生成新的无密钥完整备份。旧备份、无引用文件和 Git 历史不会搬运，GitHub 原件保留。'
            + '目标请用独立目录，已有其他完整备份或同名不同内容不会覆盖；取消/失败会保留已校验部分，重试接续。\n\n'
            + '【语音备份范围】\n'
            + '全量备份包含已归档语音的定位索引，不包含音频字节。新设备补齐仓库凭据后从云端下载；'
            + '尚未归档的语音不能靠这份备份换设备，但原设备恢复时会保留本机索引和音频。不要用清空本地媒体来验证迁移。\n\n'
            + '改完记得点「保存仓库配置」。'
    },
    repo: {
        title: '仓库配置说明',
        content:
            '这一段定义存储位置和凭据，下面的用途只是引用它。\n\n'
            + '【选择仓库】\n'
            + '备注名旁的三个按钮依次是：新增空仓库、复制当前仓库、删除当前仓库。'
            + '备注名只给你自己区分仓库用。切换仓库会保留草稿，保存前不会落库。\n\n'
            + '【存储类型】\n'
            + '可选 GitHub 或 VPS / WebDAV。切换类型会清空用户名和令牌/密码，必须重新填写，'
            + '避免把 GitHub 令牌发往 VPS。已有仓库更换定位请新增仓库再切换绑定。\n\n'
            + '【GitHub】\n'
            + '填写 GitHub 用户名、仓库名和分支（一般为 main）。建议新建专用私有仓库，'
            + '用细粒度 PAT（Fine-grained token），仅授权该仓库的 Contents 读写。\n\n'
            + '【VPS / WebDAV】\n'
            + '需先在 VPS 配置启用 HTTPS 和鉴权的 WebDAV 服务，再填写完整目录地址，'
            + '例如 https://dav.example.com/ouo/，以及 WebDAV 用户名和密码。密码首尾空格会原样保留。'
            + '目标目录需提前建立，并给此账号读写权限。即使在同一端点，只换目录也会改变文件位置，'
            + '不要随意修改已有仓库的目录。\n\n'
            + '跨域时服务器的 CORS 必须允许实际打开本页面的 Origin（协议、域名、端口），'
            + '允许请求头 Authorization、Content-Type、Depth、If-None-Match，'
            + '允许方法 GET、PUT、DELETE、MKCOL、PROPFIND、OPTIONS；预检 OPTIONS 也必须正常响应。\n\n'
            + '【测试连接】\n'
            + 'GitHub 会检查仓库、分支和令牌权限。WebDAV 仅检查连接、鉴权与目录读取，'
            + '连接成功不代表已验证上传、建目录或删除权限，请确保服务端配置了写权限。'
    },
    purpose: {
        title: '用途配置说明',
        content: () => {
            const items = (typeof GITHUB_PURPOSES !== 'undefined' ? GITHUB_PURPOSES : [])
                .map(p => `【${p.label}】\n${p.hint || '（暂无说明）'}`)
                .join('\n\n');
            return '每项用途都能选择 GitHub 或 VPS / WebDAV 仓库。选「不使用」只停止该用途的新上传，'
                + '不会删除已有云端文件；只存在本机的内容请另行导出备份。\n\n'
                + '用途的相对目录固定：备份放仓库根目录，语音放 voice，图片放 image。'
                + 'WebDAV 以配置的目录地址为根目录，不是整个服务器根目录。\n\n'
                + '云端备份不含 API Key、仓库令牌/密码和推送私钥。'
                + '新设备恢复后，要先重新填写对应服务凭据，才能继续读取旧归档或使用相关功能。\n\n'
                + items;
        }
    }
});

function _ghVal(id) { const el = document.getElementById(id); return el ? el.value : ''; }
function _ghSetVal(id, v) { const el = document.getElementById(id); if (el) el.value = v == null ? '' : v; }

function _ghSetButtonLoading(id, loading) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.toggle('loading', !!loading);
    btn.disabled = !!loading;
}

/** 测试结果块。state: 'ok' | 'error' | 'info' */
function _ghSetTestResult(message, state = 'info') {
    const el = document.getElementById('gh-test-result');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('is-error', state === 'error');
    el.classList.toggle('is-ok', state === 'ok');
    el.hidden = !message;
}

// ============================================================
// 仓库定义段
// ============================================================

function _ghPopulateRepoSelect(selectedId) {
    const select = document.getElementById('gh-repo-select');
    if (!select || !_ghDraft) return;
    select.innerHTML = '';
    if (!_ghDraft.repos.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = '— 还没有仓库，点 + 新增 —';
        select.appendChild(option);
    }
    _ghDraft.repos.forEach(repo => {
        const option = document.createElement('option');
        option.value = repo.id;
        const where = describeGithubRepo(repo);
        option.textContent = where ? `${repo.name}（${where}）` : repo.name;
        select.appendChild(option);
    });
    select.value = selectedId || _ghLoadedRepoId || (_ghDraft.repos[0] || {}).id || '';
}

/** 按类型切换字段；设置项有 display:flex，不能只靠 hidden 隐藏。 */
function _ghUpdateProviderFields() {
    const isWebdav = _ghVal('gh-repo-provider') === 'webdav';
    [['gh-repo-base-url-row', isWebdav], ['gh-repo-repo-row', !isWebdav],
        ['gh-repo-branch-row', !isWebdav]].forEach(([id, visible]) => {
        const row = document.getElementById(id);
        if (row) row.style.display = visible ? 'flex' : 'none';
    });
    const tokenLabel = document.getElementById('gh-repo-token-label');
    const usernameLabel = document.getElementById('gh-repo-username-label');
    if (tokenLabel) tokenLabel.textContent = isWebdav ? 'WebDAV 密码' : 'GitHub 访问令牌';
    if (usernameLabel) usernameLabel.textContent = isWebdav ? 'WebDAV 用户名' : 'GitHub 用户名';
    const token = document.getElementById('gh-repo-token');
    const username = document.getElementById('gh-repo-username');
    if (token) token.placeholder = isWebdav ? 'WebDAV 密码（保留首尾空格）' : 'github_pat_...';
    if (username) username.placeholder = isWebdav ? 'WebDAV 鉴权用户名' : '你的 GitHub 用户名';
}

/** 从表单读出当前正在编辑的那个仓库（不落库，只取值） */
function _ghReadRepoFromForm() {
    const provider = _ghVal('gh-repo-provider') === 'webdav' ? 'webdav' : 'github';
    return _normalizeGithubRepo({
        id: _ghLoadedRepoId,
        name: _ghVal('gh-repo-name').trim(),
        provider,
        baseUrl: provider === 'webdav' ? _ghVal('gh-repo-base-url').trim() : '',
        // WebDAV 密码里的首尾空格可能有效，不能像 GitHub 令牌一样主动裁剪。
        token: provider === 'webdav' ? _ghVal('gh-repo-token') : _ghVal('gh-repo-token').trim(),
        username: _ghVal('gh-repo-username').trim(),
        repo: provider === 'github' ? _ghVal('gh-repo-repo').trim() : '',
        branch: provider === 'github' ? _ghVal('gh-repo-branch').trim() : ''
    });
}

function _ghApplyRepoToForm(repoId) {
    const repo = _ghDraft && _ghDraft.repos.find(r => r.id === repoId);
    _ghLoadedRepoId = repo ? repo.id : '';
    _ghSetVal('gh-repo-name', repo ? repo.name : '');
    _ghSetVal('gh-repo-provider', repo && repo.provider === 'webdav' ? 'webdav' : 'github');
    _ghSetVal('gh-repo-base-url', repo ? repo.baseUrl : '');
    _ghSetVal('gh-repo-token', repo ? repo.token : '');
    _ghSetVal('gh-repo-username', repo ? repo.username : '');
    _ghSetVal('gh-repo-repo', repo ? repo.repo : '');
    _ghSetVal('gh-repo-branch', repo ? repo.branch : GITHUB_BRANCH_DEFAULT);
    _ghUpdateProviderFields();
    _ghPopulateRepoSelect(_ghLoadedRepoId);
    _ghSetTestResult('');
}

/**
 * 把表单上的编辑写回草稿。切仓库、新增、删除、保存前都要先调，
 * 否则用户改完某个仓库直接切走，改动就丢了。
 */
function _ghSyncRepoFromForm() {
    if (!_ghDraft || !_ghLoadedRepoId) return;
    const index = _ghDraft.repos.findIndex(r => r.id === _ghLoadedRepoId);
    if (index < 0) return;
    const edited = _ghReadRepoFromForm();
    const old = _ghDraft.repos[index];
    _ghDraft.repos[index] = { ...edited, name: edited.name || old.name };
}

function _ghAddRepo(copyCurrent = false) {
    _ghSyncRepoFromForm();
    const source = copyCurrent && _ghDraft.repos.find(r => r.id === _ghLoadedRepoId);
    const baseName = source ? source.name : '仓库';
    const taken = _ghDraft.repos.map(r => r.name);
    let suffix = source ? 2 : 1;
    let name = `${baseName}${suffix}`;
    while (taken.includes(name)) name = `${baseName}${++suffix}`;
    const repo = source
        ? { ...source, id: _newGithubRepoId(), name }
        : _normalizeGithubRepo({ id: _newGithubRepoId(), name });
    _ghDraft.repos.push(repo);
    _ghApplyRepoToForm(repo.id);
    _ghRenderPurposes();
}

async function _ghDeleteRepo() {
    if (!_ghLoadedRepoId) return showToast('还没有可删除的仓库');
    const repo = _ghDraft.repos.find(r => r.id === _ghLoadedRepoId);
    if (!repo) return;

    // 删掉仓库定义 = 连凭据一起没，引用它的已归档内容会读不回来。先说清楚代价。
    const usedBy = GITHUB_PURPOSES
        .filter(p => _ghDraft.bindings[p.key] && _ghDraft.bindings[p.key].repoId === repo.id)
        .map(p => p.label);
    let archived;
    try {
        archived = await _ghCountArchivedIn(repo.id);
    } catch (_) {
        return showToast('无法检查历史语音和图片引用，暂不删除仓库，请稍后重试');
    }

    let warn = '';
    if (usedBy.length) warn += `\n\n「${usedBy.join('、')}」正在用它，删除后会变成未绑定。`;
    if (archived.total > 0) {
        const details = [];
        if (archived.voice > 0) details.push(`${archived.voice} 条语音`);
        if (archived.image > 0) details.push(`${archived.image} 张图片`);
        warn += `\n\n已经有 ${details.join('、')}归档在这个仓库里，`
            + '删掉仓库定义和凭据后这些内容就读不回来了。云端文件仍在，但重新新增同地址仓库的 ID 不同，'
            + '不能自动恢复旧引用。需要恢复含原仓库 ID 的配置/备份并补齐凭据；'
            + '建议保留旧仓库，仅为新内容切换用途绑定。';
    }

    const ok = await AppUI.confirm(
        `确定删除仓库「${repo.name}」？${warn}`, '删除仓库', '删除', '取消');
    if (!ok) return;

    _ghDraft.repos = _ghDraft.repos.filter(r => r.id !== repo.id);
    // 引用它的绑定一起清掉，避免留下指向不存在仓库的悬空 id
    // （enabled 是从 repoId 派生的，清了 repoId 它自然就是 false）
    GITHUB_PURPOSES.forEach(p => {
        if (_ghDraft.bindings[p.key] && _ghDraft.bindings[p.key].repoId === repo.id) {
            _ghDraft.bindings[p.key].repoId = '';
            _ghDraft.bindings[p.key].enabled = false;
        }
    });
    _ghApplyRepoToForm((_ghDraft.repos[0] || {}).id);
    _ghRenderPurposes();
}

/** 删除或改定位前检查两类历史引用；读取失败不能被当成「没有引用」。 */
async function _ghCountArchivedIn(repoId) {
    if (typeof dexieDB === 'undefined' || !dexieDB.voiceClips || !dexieDB.messages) {
        throw new Error('本地数据库尚未就绪');
    }
    // 存储层的展示用统计会吞错返回 0，这里必须直接读表，让失败阻止破坏性改动。
    let image = 0;
    const [voice] = await Promise.all([
        dexieDB.voiceClips.where('cloudRepoId').equals(repoId).count(),
        dexieDB.messages.each(message => {
            const media = message && message.media;
            if (media && media.kind === 'image'
                && String(media.cloudRepoId || '').trim() === repoId
                && String(media.cloudPath || '').trim()) image++;
        })
    ]);
    return { voice, image, total: voice + image };
}

/** 备注名和令牌/密码可以更新；这些字段决定历史 cloudPath 实际指向哪里。 */
function _ghRepoLocationChanged(before, after) {
    return ['provider', 'baseUrl', 'username', 'repo', 'branch']
        .some(key => (before[key] || '') !== (after[key] || ''));
}

function _ghRequiredFieldsMessage(repo) {
    return repo.provider === 'webdav'
        ? '请填写有效的 HTTPS WebDAV 目录地址、用户名和密码'
        : '请填全 GitHub 访问令牌、用户名、仓库名和分支';
}

async function testGithubRepoConnection() {
    const cfg = _ghReadRepoFromForm();
    if (!isGithubRepoConfigured(cfg)) {
        return showToast(_ghRequiredFieldsMessage(cfg));
    }
    _ghSetButtonLoading('gh-test-btn', true);
    _ghSetTestResult(cfg.provider === 'webdav' ? '正在连接 WebDAV 目录…' : '正在连接 GitHub…', 'info');
    try {
        const result = await checkGithubRepo(cfg);
        // 测试期间可能切过仓库或改过配置，旧响应不应覆盖新表单的状态。
        if (JSON.stringify(cfg) !== JSON.stringify(_ghReadRepoFromForm())) return;
        const note = cfg.provider === 'webdav' && result.ok
            ? '\n这里只验证连接与目录读取，未验证上传、建目录或删除权限。' : '';
        _ghSetTestResult(result.message + note, result.ok ? 'ok' : 'error');
    } catch (error) {
        // checkGithubRepo 自己不抛，走到这儿说明是意料外的错。
        if (JSON.stringify(cfg) === JSON.stringify(_ghReadRepoFromForm())) {
            _ghSetTestResult(`测试失败：${error.message}`, 'error');
        }
    } finally {
        _ghSetButtonLoading('gh-test-btn', false);
    }
}

// ============================================================
// 用途绑定段
// ============================================================

// 用途行左边的小图标。纯装饰，按 key 取，取不到就落回默认那个 ——
// 所以往 GITHUB_PURPOSES 加新用途依然不用回来改这个文件。
// 图标放在页面层而不是 GITHUB_PURPOSES 里，是因为 js/api/ 那层不该认识长什么样。
const _GH_PURPOSE_ICONS = {
    backup: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line>',
    voice: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>'
};
const _GH_PURPOSE_ICON_FALLBACK = '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>';

/**
 * 按 GITHUB_PURPOSES 渲染用途行。每行就是「用途名 + 一个仓库下拉」，没别的。
 *
 * ★ 刻意只有一个 select：
 *   · 没有启用开关 —— 下拉里的「不使用」就是关闭状态。两个控件表达同一件事
 *     就会有互相矛盾的可能（绑了仓库但开关是关的）
 *   · 没有目录输入框 —— 目录在 GITHUB_PURPOSES 里定死了
 *   · 没有「每日自动备份」—— 那个归「存储备份 > 云端同步」弹框管，
 *     两个地方都能改同一个开关就是重复
 *   这样"一个用途只对应一个仓库"这件事，看一眼就能确认，不需要猜。
 *
 * ★ 行内不再写 hint —— 各用途的说明搬进了「用途配置」旁边的问号（见文件顶部
 *   AppHelp.register）。文案还是从 GITHUB_PURPOSES 来，只是换了个地方显示。
 *
 * 每次仓库列表变动都要重渲染，否则下拉里还留着已删掉的仓库。
 */
function _ghRenderPurposes() {
    const host = document.getElementById('gh-purpose-list');
    if (!host || !_ghDraft) return;
    host.innerHTML = '';

    GITHUB_PURPOSES.forEach(p => {
        const binding = _ghDraft.bindings[p.key] || {};

        // 版式跟消息通知页的"带输入框的设置项"一致：标题一行，控件占满下一行。
        // 下拉里的文案可能是「语音仓库（user/repo）」这种长串，塞不进右侧窄栏。
        const row = document.createElement('div');
        row.className = 'settings-item column-layout';

        const header = document.createElement('div');
        header.className = 'item-header';

        const iconBox = document.createElement('div');
        iconBox.className = 'setting-icon-box';
        iconBox.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"'
            + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
            + (_GH_PURPOSE_ICONS[p.key] || _GH_PURPOSE_ICON_FALLBACK)
            + '</svg>';
        header.appendChild(iconBox);

        const nameEl = document.createElement('span');
        nameEl.className = 'item-name';
        nameEl.textContent = p.label;
        header.appendChild(nameEl);

        row.appendChild(header);

        const repoSel = document.createElement('select');
        repoSel.className = 'form-control settings-input-text';
        const emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = '不使用';
        repoSel.appendChild(emptyOpt);
        _ghDraft.repos.forEach(r => {
            const opt = document.createElement('option');
            opt.value = r.id;
            const where = describeGithubRepo(r);
            opt.textContent = where ? `${r.name}（${where}）` : r.name;
            repoSel.appendChild(opt);
        });
        // 绑定的仓库可能刚被删了 —— 那就落回"不使用"，不留悬空 id
        repoSel.value = _ghDraft.repos.some(r => r.id === binding.repoId) ? binding.repoId : '';
        row.appendChild(repoSel);
        host.appendChild(row);

        // 就地写回草稿，不用等保存时再回来扫 DOM。
        // autoBackup 原样带过去 —— 它不在这个页面编辑，但也不能被这里抹掉。
        repoSel.addEventListener('change', () => {
            _ghDraft.bindings[p.key] = {
                ...binding,
                repoId: repoSel.value,
                enabled: !!repoSel.value
            };
        });
    });
}

// ============================================================
// 页面级
// ============================================================

/** 设置页「云端仓库」那一行右侧的状态文案 */
function refreshGithubReposSummary() {
    const el = document.getElementById('github-repos-summary');
    if (!el || typeof _normalizeGithubRepos !== 'function') return;
    const repos = _normalizeGithubRepos(db.githubRepos);
    const bindings = _normalizeGithubBindings(db.githubBindings);
    const active = GITHUB_PURPOSES.filter(p => {
        const b = bindings[p.key];
        return b && b.enabled && repos.some(r => r.id === b.repoId && isGithubRepoConfigured(r));
    });
    if (!repos.length) el.textContent = '未配置';
    else if (!active.length) el.textContent = `${repos.length} 个仓库 · 未启用`;
    // 用 shortLabel（备份/语音/图片）而不是 label —— 三项全开时全称在窄屏上会折行。
    else el.textContent = active.map(p => p.shortLabel || p.label).join('、');
}

let _ghSaving = false;

async function saveGithubRepos() {
    if (!_ghDraft || _ghSaving) return;
    if (typeof window !== 'undefined' && window.CloudRepoMigration?.isBusy()) return showToast('迁移期间不能保存仓库配置');
    _ghSyncRepoFromForm();
    const pending = {
        repos: _normalizeGithubRepos(_ghDraft.repos),
        bindings: _normalizeGithubBindings(_ghDraft.bindings)
    };
    const originalRepos = _normalizeGithubRepos(db.githubRepos);
    _ghSaving = true;
    _ghSetButtonLoading('gh-save-btn', true);
    try {
        // 同 ID 换定位会让历史 cloudPath 指到另一个地方，换绑定则不会。
        // 检查所有草稿仓库，而不是只检查当前表单，避免切到别的仓库后绕过保护。
        for (const edited of pending.repos) {
            const original = originalRepos.find(repo => repo.id === edited.id);
            if (!original || !_ghRepoLocationChanged(original, edited)) continue;
            let archived;
            try {
                archived = await _ghCountArchivedIn(edited.id);
            } catch (_) {
                return showToast('无法检查历史语音和图片引用，暂不修改仓库定位，请稍后重试');
            }
            if (archived.total > 0) {
                await AppUI.alert(
                    `仓库「${original.name}」仍被 ${archived.voice} 条语音、${archived.image} 张图片引用。`
                    + '\n不能修改存储类型、目录地址、用户名、仓库名或分支；请还原旧仓库定位，'
                    + '新增仓库后再切换用途绑定。原仓库的令牌/密码仍可更新。', '请新增仓库');
                return;
            }
        }

        // 两种服务统一用 API 层的配置判定，WebDAV 不要求 GitHub 仓库名和分支。
        // 云备份恢复会清空密码，未绑定的旧仓库不能挡住其他仓库的保存与启用。
        const boundRepoIds = new Set(Object.values(pending.bindings).map(binding => binding.repoId).filter(Boolean));
        const incomplete = pending.repos.filter(repo => !isGithubRepoConfigured(repo));
        const broken = incomplete.find(repo => boundRepoIds.has(repo.id));
        if (broken) return showToast(`仓库「${broken.name}」正在用于归档或备份：${_ghRequiredFieldsMessage(broken)}`);
        // enabled 从 repoId 派生，没选仓库就等于没开，不存在半开状态。

        // 检查引用需要异步读库，期间的编辑不能未经检查就写入，也不能被旧快照覆盖。
        _ghSyncRepoFromForm();
        if (JSON.stringify(pending) !== JSON.stringify(_ghDraft)) {
            return showToast('检查期间配置有变化，请再点一次保存');
        }
        db.githubRepos = pending.repos;
        db.githubBindings = pending.bindings;
        await saveGlobalKeys(['githubRepos', 'githubBindings']);
        refreshGithubReposSummary();
        if (typeof refreshCloudMigrationOptions === 'function') refreshCloudMigrationOptions();
        showToast(incomplete.length
            ? '仓库配置已保存；未绑定仓库仍有信息或凭据待补填，使用前请补齐'
            : '仓库配置已保存');
    } catch (error) {
        showToast(`保存仓库配置失败：${error.message}`);
    } finally {
        // 提示框自身失败时也必须释放保存按钮，不能让页面永远停在加载状态。
        _ghSaving = false;
        _ghSetButtonLoading('gh-save-btn', false);
    }
}

// 事件只绑一次；每次进页面只刷新数据
let _ghBound = false;

/** 每次打开这个 screen 时调用（由 main.js 的 pageActions 触发） */
function openGithubReposScreen() {
    if (typeof refreshCloudMigrationOptions === 'function') refreshCloudMigrationOptions();
    _ghDraft = {
        repos: _normalizeGithubRepos(db.githubRepos),
        bindings: _normalizeGithubBindings(db.githubBindings)
    };
    _ghLoadedRepoId = '';
    _ghApplyRepoToForm((_ghDraft.repos[0] || {}).id);
    _ghRenderPurposes();
    _ghSetTestResult('');

    if (_ghBound) return;
    _ghBound = true;

    const on = (id, fn) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', fn);
    };
    on('gh-add-repo', () => _ghAddRepo(false));
    on('gh-copy-repo', () => _ghAddRepo(true));
    on('gh-del-repo', _ghDeleteRepo);
    on('gh-test-btn', testGithubRepoConnection);
    on('gh-save-btn', saveGithubRepos);
    // header 右上角的问号 = 整页说明。小标题旁边那两个问号走 HTML 里的 onclick
    on('gh-help-btn', () => AppHelp.show('github', 'page'));

    // 切仓库前先把当前编辑写回草稿，否则改完直接切走改动就丢了
    const select = document.getElementById('gh-repo-select');
    if (select) select.addEventListener('change', () => {
        _ghSyncRepoFromForm();
        _ghApplyRepoToForm(select.value);
        _ghRenderPurposes();   // 备注名可能改了，用途里的下拉文案要跟着变
    });

    // 类型切换必须先清空凭据再同步草稿，不能让旧 GitHub 令牌流入 WebDAV 请求。
    const provider = document.getElementById('gh-repo-provider');
    if (provider) provider.addEventListener('change', () => {
        _ghSetVal('gh-repo-token', '');
        _ghSetVal('gh-repo-username', '');
        _ghUpdateProviderFields();
        _ghSyncRepoFromForm();
        _ghPopulateRepoSelect(_ghLoadedRepoId);
        _ghRenderPurposes();
        _ghSetTestResult('已切换存储类型并清空凭据，请重新填写用户名和令牌/密码。'
            + '若要迁移已有内容，请保留旧仓库，新增仓库再切换用途绑定。', 'info');
    });

    // 仓库的名字/地址变了，用途下拉里的显示文案也该跟着变。
    ['gh-repo-name', 'gh-repo-base-url', 'gh-repo-username', 'gh-repo-repo', 'gh-repo-branch'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => {
            _ghSyncRepoFromForm();
            _ghPopulateRepoSelect(_ghLoadedRepoId);
            _ghRenderPurposes();
            _ghSetTestResult('');
            const original = _normalizeGithubRepos(db.githubRepos).find(r => r.id === _ghLoadedRepoId);
            if (original && _ghRepoLocationChanged(original, _ghReadRepoFromForm())) {
                _ghSetTestResult('更改已有仓库的定位可能使历史内容无法读取。'
                    + '建议新增仓库再切换用途绑定；保存时会检查历史语音和图片引用。', 'info');
            }
        });
    });
}
