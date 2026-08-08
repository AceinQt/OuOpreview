// ============================================================
// github_repos.js — GitHub 仓库设置页
// ============================================================
// 凭据归一化、请求、错误转人话、连通性检查都在 js/api/github_repo_api.js，
// 本文件只管这个 screen 的表单读写。
//
// 页面分两段，对应两层数据：
//   db.githubRepos    —— 仓库定义（含令牌）。同一个仓库能被多个用途共用
//   db.githubBindings —— 用途绑定（哪个功能用哪个仓库、存哪个目录）
// 拆开的理由见 github_repo_api.js 顶部：仓库是共享资源，凭据不该跟着用途复制好几份。
//
// ★ 用途行是按 GITHUB_PURPOSES 动态渲染的，加一个用途不用改这个文件。
//
// 对外符号：
//   openGithubReposScreen（main.js 的 pageActions 调用）
//   refreshGithubReposSummary（设置页那一行的状态文案）
// ============================================================

// 页面上的编辑草稿。点保存前所有改动只在这里，不碰 db。
let _ghDraft = null;
let _ghLoadedRepoId = '';

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

/** 从表单读出当前正在编辑的那个仓库（不落库，只取值） */
function _ghReadRepoFromForm() {
    return _normalizeGithubRepo({
        id: _ghLoadedRepoId,
        name: _ghVal('gh-repo-name').trim(),
        token: _ghVal('gh-repo-token').trim(),
        username: _ghVal('gh-repo-username').trim(),
        repo: _ghVal('gh-repo-repo').trim(),
        branch: _ghVal('gh-repo-branch').trim()
    });
}

function _ghApplyRepoToForm(repoId) {
    const repo = _ghDraft && _ghDraft.repos.find(r => r.id === repoId);
    _ghLoadedRepoId = repo ? repo.id : '';
    _ghSetVal('gh-repo-name', repo ? repo.name : '');
    _ghSetVal('gh-repo-token', repo ? repo.token : '');
    _ghSetVal('gh-repo-username', repo ? repo.username : '');
    _ghSetVal('gh-repo-repo', repo ? repo.repo : '');
    _ghSetVal('gh-repo-branch', repo ? repo.branch : GITHUB_BRANCH_DEFAULT);
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

    // 删掉仓库定义 = 连令牌一起没，引用它的已归档内容会读不回来。先说清楚代价。
    const usedBy = GITHUB_PURPOSES
        .filter(p => _ghDraft.bindings[p.key] && _ghDraft.bindings[p.key].repoId === repo.id)
        .map(p => p.label);
    const archived = await _ghCountArchivedIn(repo.id);

    let warn = '';
    if (usedBy.length) warn += `\n\n「${usedBy.join('、')}」正在用它，删除后会变成未绑定。`;
    if (archived > 0) {
        warn += `\n\n已经有 ${archived} 条内容归档在这个仓库里，`
            + '删掉它的令牌之后这些内容就读不回来了（GitHub 上的文件还在，重新添加同一个仓库即可恢复访问）。';
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

/**
 * 数一下有多少条已归档内容指向这个仓库。
 * voiceClips 表要到存储层那一步才建，所以这里对"表还不存在"是容错的 ——
 * 现在返回 0，等表建好之后同一段代码自动就有数了。
 */
async function _ghCountArchivedIn(repoId) {
    try {
        if (typeof dexieDB === 'undefined' || !dexieDB.voiceClips) return 0;
        return await dexieDB.voiceClips.where('cloudRepoId').equals(repoId).count();
    } catch (_) {
        return 0;
    }
}

async function testGithubRepoConnection() {
    const cfg = _ghReadRepoFromForm();
    if (!cfg.token || !cfg.username || !cfg.repo) {
        return showToast('请先填全令牌、用户名和仓库名');
    }
    _ghSetButtonLoading('gh-test-btn', true);
    _ghSetTestResult('正在连接 GitHub…', 'info');
    try {
        const result = await checkGithubRepo(cfg);
        _ghSetTestResult(result.message, result.ok ? 'ok' : 'error');
    } catch (error) {
        // checkGithubRepo 自己不抛，走到这儿说明是意料外的错
        _ghSetTestResult(`测试失败：${error.message}`, 'error');
    } finally {
        _ghSetButtonLoading('gh-test-btn', false);
    }
}

// ============================================================
// 用途绑定段
// ============================================================

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
 * 每次仓库列表变动都要重渲染，否则下拉里还留着已删掉的仓库。
 */
function _ghRenderPurposes() {
    const host = document.getElementById('gh-purpose-list');
    if (!host || !_ghDraft) return;
    host.innerHTML = '';

    GITHUB_PURPOSES.forEach(p => {
        const binding = _ghDraft.bindings[p.key] || {};

        const row = document.createElement('div');
        row.className = 'gh-purpose';

        const nameEl = document.createElement('div');
        nameEl.className = 'gh-purpose-name';
        nameEl.textContent = p.label;
        row.appendChild(nameEl);

        if (p.hint) {
            const hint = document.createElement('p');
            hint.className = 'gh-purpose-hint';
            hint.textContent = p.hint;
            row.appendChild(hint);
        }

        const group = document.createElement('div');
        group.className = 'form-group gh-purpose-select';
        const repoSel = document.createElement('select');
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
        group.appendChild(repoSel);
        row.appendChild(group);
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

/** 设置页「GitHub 仓库」那一行右侧的状态文案 */
function refreshGithubReposSummary() {
    const el = document.getElementById('github-repos-summary');
    if (!el || typeof _normalizeGithubRepos !== 'function') return;
    const repos = _normalizeGithubRepos(db.githubRepos);
    const bindings = _normalizeGithubBindings(db.githubBindings);
    const active = GITHUB_PURPOSES.filter(p => {
        const b = bindings[p.key];
        return b && b.enabled && repos.some(r => r.id === b.repoId);
    });
    if (!repos.length) el.textContent = '未配置';
    else if (!active.length) el.textContent = `${repos.length} 个仓库 · 未启用`;
    else el.textContent = active.map(p => p.label).join('、');
}

async function saveGithubRepos() {
    _ghSyncRepoFromForm();

    // 填了一半的仓库存下来只会在归档时安静地失败，现在就拦住
    const broken = _ghDraft.repos.filter(r => !r.token || !r.username || !r.repo);
    if (broken.length) {
        return showToast(`仓库「${broken[0].name}」还没填全令牌、用户名和仓库名`);
    }
    // 注：不用再校验"开了但没选仓库" —— enabled 是从 repoId 派生的，
    //     没选仓库就等于没开，构造不出这种半开状态。

    db.githubRepos = _normalizeGithubRepos(_ghDraft.repos);
    db.githubBindings = _normalizeGithubBindings(_ghDraft.bindings);
    await saveGlobalKeys(['githubRepos', 'githubBindings']);
    _ghDraft = {
        repos: _normalizeGithubRepos(db.githubRepos),
        bindings: _normalizeGithubBindings(db.githubBindings)
    };
    refreshGithubReposSummary();
    showToast('仓库配置已保存');
}

// 事件只绑一次；每次进页面只刷新数据
let _ghBound = false;

/** 每次打开这个 screen 时调用（由 main.js 的 pageActions 触发） */
function openGithubReposScreen() {
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

    // 切仓库前先把当前编辑写回草稿，否则改完直接切走改动就丢了
    const select = document.getElementById('gh-repo-select');
    if (select) select.addEventListener('change', () => {
        _ghSyncRepoFromForm();
        _ghApplyRepoToForm(select.value);
        _ghRenderPurposes();   // 备注名可能改了，用途里的下拉文案要跟着变
    });

    // 仓库的名字/地址变了，用途下拉里的显示文案也该跟着变
    ['gh-repo-name', 'gh-repo-username', 'gh-repo-repo', 'gh-repo-branch'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => {
            _ghSyncRepoFromForm();
            _ghPopulateRepoSelect(_ghLoadedRepoId);
            _ghRenderPurposes();
        });
    });
}
