// GitHub → VPS 只迁移本机仍引用的归档文件；旧备份不原样搬运，避免把历史密钥再传一遍。
// 每个文件读回逐字节校验后才改引用，已完成部分可重试；失败不回滚远端文件，也不删除 GitHub 原件。
const CloudRepoMigration = (() => {
    let busy = false;
    let controller = null;
    const clone = value => JSON.parse(JSON.stringify(value));
    const sameBytes = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);
    const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    async function switchBindings(bindings) {
        const previous = db.githubBindings;
        db.githubBindings = bindings;
        try { await saveGlobalKeys(['githubBindings']); }
        catch (error) { db.githubBindings = previous; throw error; }
    }
    function migratedBindings(sourceId, targetId) {
        const bindings = _normalizeGithubBindings(db.githubBindings);
        for (const binding of Object.values(bindings)) {
            if (binding.repoId === sourceId) { binding.repoId = targetId; binding.enabled = true; }
        }
        return bindings;
    }
    const checkAbort = signal => { if (signal.aborted) throw new Error('迁移已取消；已校验的部分保留，可再次迁移'); };
    const isSource = (ref, id, path) => ref?.cloudRepoId === id && (!path || ref.cloudPath === path);
    const moved = (ref, target) => ({ ...ref, cloudRepoId: target.id, cloudOwner: target.username, cloudRepo: '', cloudState: 'uploaded' });

    function configs(sourceId, targetId) {
        const source = getGithubRepo(sourceId);
        const target = getGithubRepo(targetId);
        if (!source || source.provider === 'webdav' || !target || target.provider !== 'webdav' || sourceId === targetId) {
            throw new Error('请选择已保存的 GitHub 来源和不同的 VPS / WebDAV 目标');
        }
        if (!isGithubRepoConfigured(source) || !isGithubRepoConfigured(target)) throw new Error('请先补齐两个仓库的账号凭据并保存');
        return { source: clone(source), target: clone(target) };
    }

    // 只留去重路径和计数，不把聊天记录或所有音频同时装进内存。
    async function inventory(sourceId) {
        const paths = new Map();
        let voice = 0, image = 0;
        const add = (ref, kind, key) => {
            if (typeof ref.cloudPath !== 'string' || !ref.cloudPath) throw new Error('存在缺少云端路径的归档记录，请先检查数据');
            _githubSafeSegments(ref.cloudPath);
            if (!paths.has(ref.cloudPath)) paths.set(ref.cloudPath, { voice: [], image: [] });
            paths.get(ref.cloudPath)[kind].push(key);
        };
        await dexieDB.voiceClips.where('cloudRepoId').equals(sourceId).each(clip => {
            add(clip, 'voice', clip.voiceKey); voice++;
        });
        await dexieDB.messages.each(message => {
            if (isSource(message.media, sourceId)) { add(message.media, 'image', message.id); image++; }
        });
        return { paths: [...paths.keys()].sort(), refs: paths, voice, image };
    }

    async function inspect(sourceId, targetId) {
        configs(sourceId, targetId);
        return inventory(sourceId);
    }

    // 事务内重新匹配当前记录，而不是回写盘点时的旧消息副本，避免覆盖正文或删除状态。
    async function commitPath(sourceId, target, path, refs) {
        await dexieDB.transaction('rw', dexieDB.voiceClips, dexieDB.messages, async () => {
            for (const key of refs.voice) {
                const clip = await dexieDB.voiceClips.get(key);
                if (isSource(clip, sourceId, path)) await dexieDB.voiceClips.put(moved(clip, target));
            }
            for (const key of refs.image) {
                const message = await dexieDB.messages.get(key);
                if (isSource(message?.media, sourceId, path)) {
                    message.media = moved(message.media, target);
                    await dexieDB.messages.put(message);
                }
            }
        });
        // 热历史会在下次发消息时写回；必须同步，否则已迁移的指针会被旧内存覆盖。
        for (const chat of [...(db.characters || []), ...(db.groups || [])]) {
            for (const message of chat.history || []) {
                if (isSource(message.media, sourceId, path)) Object.assign(message.media, moved(message.media, target));
            }
        }
    }

    async function copyVerified(source, target, path, signal) {
        checkAbort(signal);
        // 单文件顺序处理，使用真实鉴权下载而非本机缓存；路径保留 v1 语音历史命名。
        const bytes = await downloadGithubFile(source, path, { signal });
        if (!bytes) throw new Error(`GitHub 文件不存在：${path}`);
        let remote = await downloadGithubFile(target, path, { signal });
        if (!remote) {
            try {
                await uploadGithubFile(target, path, bytes, { signal, migration: true, ifAbsent: true });
            } catch (error) {
                // 同路径被另一个请求抢先创建时，仍读回验证；绝不改成覆盖重试。
                if (error.status !== 412) throw error;
            }
            remote = await downloadGithubFile(target, path, { signal });
        }
        if (!sameBytes(bytes, remote)) throw new Error(`目标文件内容冲突或校验失败：${path}。请使用空的独立目录，不会覆盖现有文件。`);
        checkAbort(signal);
    }

    async function run(sourceId, targetId, onProgress = () => {}) {
        if (busy) throw new Error('已有迁移正在进行');
        if (typeof _ghSaving !== 'undefined' && _ghSaving) throw new Error('正在保存仓库配置，请稍后再试');
        if (window.isBackupLoading || window.isUiBusy?.() || window.isCloudMediaWorkBusy?.()) throw new Error('还有备份、回复或媒体任务正在进行，请完成后再迁移');
        const { source, target } = configs(sourceId, targetId);
        busy = true;
        controller = new AbortController();
        const signal = controller.signal;
        const report = { files: 0, total: 0, voice: 0, image: 0, backup: false, switched: false };
        const progress = text => { try { onProgress(text, { ...report }); } catch (_) {} };
        let releaseUi;
        try {
            releaseUi = window.beginUiBusy?.('github-repos-screen');
            if (typeof closeImageViewer === 'function') closeImageViewer();
            const journalKey = `cloudMigration:${sourceId}:${targetId}`;
            const location = JSON.stringify([source.provider, source.username, source.repo, source.branch, target.baseUrl, target.username]);
            const journal = await dexieDB.globalSettings.get(journalKey);
            // 最后一次 PUT 成功但断网/关页时，凭本机落盘的摘要认领自己的快照，不能覆盖别人的备份。
            const existing = await downloadGithubResponse(target, 'qchat_backup_v5.ee', { signal });
            if (existing) {
                if (journal?.value?.location === location && journal.value.hash) {
                    const bytes = new Uint8Array(await existing.arrayBuffer());
                    if (await digest(bytes) === journal.value.hash && !(await inventory(sourceId)).paths.length) {
                        checkAbort(signal);
                        // 只切当前仍绑定来源的用途，不用旧日志覆盖用户后来改过的其他用途。
                        await switchBindings(migratedBindings(sourceId, targetId));
                        report.backup = true; report.switched = true;
                        progress('已校验上次迁移留下的新备份并完成用途切换。GitHub 原件保留。');
                        return report;
                    }
                } else await existing.body?.cancel();
                throw new Error('目标目录已有其他完整备份，或上次备份后来源又有新内容。请使用新的独立 WebDAV 目录；原备份不会覆盖。');
            }
            const plan = await inventory(sourceId);
            Object.assign(report, { total: plan.paths.length, voice: plan.voice, image: plan.image });
            progress(`准备迁移 ${report.total} 个文件（${report.voice} 条语音、${report.image} 张图片引用）`);
            for (const path of plan.paths) {
                progress(`正在复制并读回校验 ${report.files + 1}/${report.total}：${path}`);
                await copyVerified(source, target, path, signal);
                await commitPath(sourceId, target, path, plan.refs.get(path));
                report.files++;
            }
            checkAbort(signal);
            // 再盘点一次，不能把漏下的新引用假称为迁移完成。
            if ((await inventory(sourceId)).paths.length) throw new Error('迁移期间出现新的来源引用，请等生成完成后再次迁移');
            const bindings = migratedBindings(sourceId, targetId);
            progress('归档文件已校验，正在生成不含密钥的新备份（包含语音归档索引）');
            // 仅投影备份首行，不在上传成功前改变当前用途；新快照不能还指向旧用途。
            async function* projectedBackup() {
                let first = true;
                for await (const line of createFullBackupStream({ excludeCredentials: true })) {
                    checkAbort(signal);
                    if (first) {
                        const meta = JSON.parse(line);
                        meta.githubBindings = bindings;
                        yield JSON.stringify(meta) + '\n';
                        first = false;
                    } else yield line;
                }
            }
            const blob = await compressStreamToEeBlob(projectedBackup());
            const bytes = new Uint8Array(await blob.arrayBuffer());
            checkAbort(signal);
            // 先记预期摘要再 PUT，断电重开仍能核验并接续；这里只存定位和摘要，不存任何凭据。
            await dexieDB.globalSettings.put({ key: journalKey, value: { location, hash: await digest(bytes), bindings } });
            await uploadGithubFile(target, 'qchat_backup_v5.ee', bytes, { signal, migration: true, ifAbsent: true });
            const saved = await downloadGithubFile(target, 'qchat_backup_v5.ee', { signal });
            if (!sameBytes(bytes, saved)) throw new Error('新备份读回校验失败；媒体迁移已保留，用途尚未切换');
            checkAbort(signal);
            report.backup = true;
            await switchBindings(bindings);
            report.switched = true;
            progress(`迁移完成：${report.files} 个文件已校验，新备份已保存，来源用途已切换。GitHub 原件保留。`);
            return report;
        } catch (error) {
            error.migrationReport = { ...report };
            progress(`${error.message}\n已完成 ${report.files}/${report.total} 个文件；已校验引用保留，未完成的仍在 GitHub。不要删除旧仓库。`);
            throw error;
        } finally {
            busy = false;
            controller = null;
            releaseUi?.();
        }
    }
    return { isBusy: () => busy, inspect, run, cancel: () => controller?.abort() };
})();
window.CloudRepoMigration = CloudRepoMigration;

// 页面只使用已保存配置，防止把草稿密码送到未确认的服务器。
function refreshCloudMigrationOptions() {
    if (CloudRepoMigration.isBusy()) return;
    for (const [id, webdav] of [['gh-migrate-source', false], ['gh-migrate-target', true]]) {
        const select = document.getElementById(id);
        if (!select) continue;
        const previous = select.value;
        select.replaceChildren();
        const placeholder = document.createElement('option');
        placeholder.value = ''; placeholder.textContent = webdav ? '选择已保存的 VPS 仓库' : '选择已保存的 GitHub 仓库';
        select.appendChild(placeholder);
        for (const repo of _normalizeGithubRepos(db.githubRepos)) {
            if ((repo.provider === 'webdav') !== webdav) continue;
            const option = document.createElement('option');
            option.value = repo.id; option.textContent = `${repo.name}（${describeGithubRepo(repo)}）`;
            select.appendChild(option);
        }
        select.value = [...select.options].some(option => option.value === previous) ? previous : '';
    }
}

async function startCloudRepoMigration() {
    if (CloudRepoMigration.isBusy()) return;
    const sourceId = document.getElementById('gh-migrate-source').value;
    const targetId = document.getElementById('gh-migrate-target').value;
    const status = document.getElementById('gh-migrate-status');
    try {
        const plan = await CloudRepoMigration.inspect(sourceId, targetId);
        const accepted = await AppUI.confirm(
            `迁移 ${plan.paths.length} 个归档文件（${plan.voice} 条语音、${plan.image} 张图片引用），并从本机生成新的无密钥完整备份。\n\n`
            + '请先保存仓库配置，关闭其他标签页/设备，等待消息和媒体生成结束；迁移时保持此页打开，不操作聊天或清理数据。\n'
            + '仅迁移本机仍引用的图片和已归档语音；不搬旧备份、无引用文件或 Git 历史，也不包含未归档音频字节。\n'
            + '目标须使用独立目录且不能已有完整备份。同名不同内容不会覆盖，GitHub 原件和旧配置保留。', '迁移到 VPS');
        if (!accepted) return;
        document.getElementById('gh-migrate-start').disabled = true;
        document.getElementById('gh-migrate-cancel').disabled = false;
        await CloudRepoMigration.run(sourceId, targetId, text => { status.textContent = text; });
        openGithubReposScreen();
        refreshGithubReposSummary();
    } catch (error) {
        if (!error.migrationReport) status.textContent = error.message;
    } finally {
        document.getElementById('gh-migrate-start').disabled = false;
        document.getElementById('gh-migrate-cancel').disabled = true;
    }
}
