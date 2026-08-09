// ============================================================
// chat_voice_service.js — 语音消息业务层
// ============================================================
// 只做三件事：这条消息该不该出语音、用谁的声音、字节从哪来。
// 凭据和请求在 js/api/doubao_tts_api.js；仓库读写在 js/api/github_repo_api.js；
// 字节存哪、淘汰谁在 js/chat/chat_voice_store.js。
// 本文件不出现 endpoint、不碰 IndexedDB 表名、不认识 DOM。
//
// 消费方（后续接上）：
//   · chat_ai_service.js       → 回复落库后触发后台合成
//   · chat_voice_player.js     → 播放前拿字节
//   · chat_bubble_factory.js   → 判断一条消息是不是语音
//
// ── 三层存储状态机 ──────────────────────────────────────────
//   本地有字节            → 直接给（唯一的零延迟路径）
//   本地没有 + 云端有      → 下载回填，再给
//   两边都没有            → 合成，写本地，后台上传归档
//
// ★ 云端下载失败要区分原因：**真 404**（云端那份被删了）才重新合成；
//   网络问题一律抛出让上层重试 —— 否则一次断网就白花一次合成的钱。
//
// 对外符号：
//   VOICE_MESSAGE_REGEX / parseVoiceMessage
//   resolveVoicePresetForSender
//   ensureVoiceClip / peekVoiceClip
//   retryVoiceArchive / getVoiceArchiveTarget
// ============================================================

// ============================================================
// 消息识别
// ============================================================
// AI 输出的语音消息长这样：[角色真名的语音：说的话]
//
// ★ 这个正则**只在这里定义一次**。原先 chat_bubble_factory.js 里另有一份，
//   两处各写一份必然漂移 —— 改了一处忘了另一处，就会出现"气泡画成语音条
//   但合成层不认"或者反过来的鬼故事。现在气泡工厂引用这里。
// ★ 不要改这个模式，存量消息全靠它解析。
const VOICE_MESSAGE_REGEX = /\[(?:.+?)的语音[:：]\s*([\s\S]+?)\]/;

/**
 * 把一条消息内容解析成语音消息。
 * @returns {{text: string}|null} null = 这不是语音消息
 */
function parseVoiceMessage(content) {
    const match = String(content || '').match(VOICE_MESSAGE_REGEX);
    if (!match) return null;
    const text = match[1].trim();
    return text ? { text } : null;
}

/**
 * 一条消息该用哪个音色说话。
 *
 * 私聊：直接看角色自己的 voicePresetId。
 * 群聊：senderId → findGroupMemberById → member.originalCharId → 角色的 voicePresetId。
 *       ★ 必须绕这一圈回查角色，不能读 member 上的副本 —— 群成员是建群那一刻的快照，
 *         音色统一存在角色库里，这样同一个角色在私聊和多个群里的声音才是一致的。
 *         只有没关联角色的成员（角色被删了，或直接在群里建的）才退回读成员自己那份。
 *
 * @param {object} chat     角色对象（私聊）或群对象（群聊）
 * @param {string} chatType 'private' | 'group'
 * @param {string} [senderId] 群聊必传，就是消息的 senderId
 * @returns {object|null} 归一化后的音色预设；null = 这条消息不该出语音
 */
function resolveVoicePresetForSender(chat, chatType, senderId) {
    if (!chat || typeof resolveVoicePreset !== 'function') return null;

    if (chatType !== 'group') {
        return resolveVoicePreset(chat.voicePresetId);
    }

    const member = typeof findGroupMemberById === 'function'
        ? findGroupMemberById(chat, senderId)
        : (chat.members || []).find(m => m.id === senderId);
    if (!member) return null;

    if (member.originalCharId) {
        const linked = (db.characters || []).find(c => c.id === member.originalCharId);
        // 角色还在就以角色库为准；角色被删了则退回成员副本
        if (linked) return resolveVoicePreset(linked.voicePresetId);
    }
    return resolveVoicePreset(member.voicePresetId);
}

// ============================================================
// 并发闸门
// ============================================================

// 单飞表：同一个 voiceKey 并发进来只做一次，其余等同一个 Promise。
// ★ 没有这个的话，一次群聊回复里两条相同文本的语音会各自合成一遍 ——
//   花两份钱，而且两个写入互相覆盖。
const _voiceInflight = new Map();

// 合成并发闸门。一次合成 20 秒以上且并发不缩短单次耗时，开大只是一起变慢，
// 所以上限来自常量而不是设置项（见 doubao_tts_api.js 的 DOUBAO_TTS_CONCURRENCY）。
let _voiceActiveSynth = 0;
const _voiceSynthWaiters = [];

function _acquireSynthSlot() {
    const limit = typeof DOUBAO_TTS_CONCURRENCY === 'number' ? DOUBAO_TTS_CONCURRENCY : 2;
    if (_voiceActiveSynth < limit) {
        _voiceActiveSynth++;
        return Promise.resolve();
    }
    return new Promise(resolve => _voiceSynthWaiters.push(resolve));
}

function _releaseSynthSlot() {
    const next = _voiceSynthWaiters.shift();
    // 有人在等就直接把名额交给他，不要先减再加 —— 中间那一瞬会让第三个人插队进来
    if (next) next();
    else _voiceActiveSynth = Math.max(0, _voiceActiveSynth - 1);
}

// ============================================================
// 归档
// ============================================================

/**
 * 当前语音归档该往哪写。null = 没开归档，或绑的仓库已被删。
 * ★ 这只回答"新内容往哪写"。读旧内容要用 clip 自己记的 cloudRepoId。
 */
function getVoiceArchiveTarget() {
    return typeof getGithubBinding === 'function' ? getGithubBinding('voice') : null;
}

/**
 * 归档路径。按 voiceKey 前两位分片，避免所有音频堆在一个目录里 ——
 * GitHub 的目录列表在几千个文件时会明显变慢。
 */
function _voiceArchivePath(pathPrefix, voiceKey) {
    const shard = String(voiceKey).replace(/^v\d+_/, '').slice(0, 2) || '00';
    const dir = pathPrefix ? `${pathPrefix}/` : '';
    return `${dir}${shard}/${voiceKey}.mp3`;
}

/**
 * 后台上传归档。不抛异常 —— 归档失败绝不能影响播放，本地字节已经在了。
 * @returns {Promise<boolean>} 是否上传成功
 */
async function _archiveVoiceClip(voiceKey, bytes) {
    const target = getVoiceArchiveTarget();
    if (!target) return false;
    const path = _voiceArchivePath(target.pathPrefix, voiceKey);
    try {
        await uploadGithubFile(target.repo, path, bytes, { message: `voice: ${voiceKey}` });
        await markVoiceClipArchived(voiceKey, { repo: target.repo, path });
        return true;
    } catch (error) {
        console.warn('[语音] 归档上传失败：', error.message);
        await markVoiceClipCloudFailed(voiceKey);
        return false;
    }
}

/**
 * 补一次归档。给"本地有字节但还没传上去"的片段用 —— 上传失败或当时没开归档。
 * ★ 由播放行为自然驱动：每次本地命中都顺手看一眼要不要补传，
 *   这样不需要额外维护一条重试队列。不 await。
 */
async function retryVoiceArchive(voiceKey) {
    if (!getVoiceArchiveTarget()) return false;
    const meta = await getVoiceClip(voiceKey);
    if (!meta || (meta.cloudState === 'uploaded' && meta.cloudPath)) return false;
    const bytes = await getVoiceClipBytes(voiceKey);
    if (!bytes) return false;
    return await _archiveVoiceClip(voiceKey, bytes);
}

// ============================================================
// 主入口
// ============================================================

/**
 * 只查不合成：本地或云端已经有就返回，没有返回 null。
 * 给渲染气泡时判断"要不要显示成已就绪"用，绝不会花钱。
 *
 * ★ 刻意**不返回字节**。渲染一页消息会对每条语音各调一次，
 *   如果为了判断存在就把音频读出来，50 条消息就是几兆无用的 IndexedDB 读取。
 *   hasVoiceClipBytes 只在主键上 count，不碰 blob。
 */
async function peekVoiceClip(text, profile) {
    if (!profile || !profile.speakerId) return null;
    const line = String(text || '').trim();
    if (!line) return null;
    const voiceKey = computeVoiceKey(line, profile);

    const cached = await hasVoiceClipBytes(voiceKey);
    const meta = await getVoiceClip(voiceKey);
    if (cached) {
        return { voiceKey, cached: true, source: 'local',
                 duration: (meta && meta.duration) || 0 };
    }
    if (meta && meta.cloudPath && meta.cloudRepoId) {
        return { voiceKey, cached: false, source: 'cloud',
                 duration: meta.duration || 0 };
    }
    return null;
}

/**
 * 拿到一条消息的语音字节，没有就按需产出。这是整个功能的中心入口。
 *
 * @param {object}  args
 * @param {string}  args.text     要说的那句话
 * @param {object}  args.profile  音色预设（resolveVoicePresetForSender 的返回值）
 * @param {string} [args.chatId]  归属聊天，删聊天时级联清理用
 * @param {string} [args.msgId]   归属消息，删消息时清理用
 * @param {boolean}[args.allowSynthesize=true] false = 只查缓存，绝不发合成请求
 * @param {boolean}[args.quotaOncePerDay=false] 后台自动合成传 true，超额提示当天只弹一次
 * @param {AbortSignal} [args.signal]
 *
 * @returns {Promise<{voiceKey, bytes, mime, duration, source}|null>}
 *          null = 没有音色、文本为空、或不允许合成且缓存里没有
 * @throws {Error} 合成/下载真的失败时抛出，message 已是可展示文案；
 *                 附 quotaBlocked / retryable 供上层决定怎么表现
 */
async function ensureVoiceClip({ text, profile, chatId, msgId,
                                 allowSynthesize = true, quotaOncePerDay = false,
                                 signal } = {}) {
    const line = String(text || '').trim();
    if (!line || !profile || !profile.speakerId) return null;

    const voiceKey = computeVoiceKey(line, profile);

    // ★ 单飞：同一个 key 并发进来复用同一个 Promise。放在最外层，
    //   这样"查缓存"这一步也被去重，不会有两个人同时查完都发现没有然后都去合成。
    if (_voiceInflight.has(voiceKey)) return _voiceInflight.get(voiceKey);

    const task = (async () => {
        // ── 第一层：本地有字节 ────────────────────────────────
        const local = await getVoiceClipBytes(voiceKey);
        if (local) {
            const meta = await getVoiceClip(voiceKey);
            touchVoiceClip(voiceKey);                    // 刷 LRU，不 await
            retryVoiceArchive(voiceKey).catch(() => {}); // 顺手补传，不 await
            return {
                voiceKey, bytes: local,
                mime: (meta && meta.mime) || 'audio/mpeg',
                duration: (meta && meta.duration) || 0,
                source: 'local'
            };
        }

        // ── 第二层：本地没有但云端有 ──────────────────────────
        const meta = await getVoiceClip(voiceKey);
        if (meta && meta.cloudPath && meta.cloudRepoId) {
            const repo = getGithubRepo(meta.cloudRepoId);
            if (!repo) {
                // 仓库定义被删了 —— 冗余存的 owner/repo 就是为了能说清楚该怎么办
                throw Object.assign(new Error(
                    `这条语音归档在 ${meta.cloudOwner || '?'}/${meta.cloudRepo || '?'}，`
                    + '但那个仓库的配置已被删除。到「设置 > GitHub 仓库」重新添加它即可恢复访问。'
                ), { retryable: false });
            }
            const downloaded = await downloadGithubFile(repo, meta.cloudPath, { signal });
            if (downloaded && downloaded.byteLength) {
                await restoreVoiceClipBytes(voiceKey, downloaded);
                enforceVoiceCacheLimit().catch(() => {});
                return {
                    voiceKey, bytes: downloaded,
                    mime: meta.mime || 'audio/mpeg',
                    duration: meta.duration || 0,
                    source: 'cloud'
                };
            }
            // ★ 走到这儿说明是**真 404** —— downloadGithubFile 只在确实不存在时返回 null，
            //   网络问题它会抛。云端那份没了，清掉归档标记，往下重新合成。
            await markVoiceClipCloudFailed(voiceKey);
        }

        // ── 第三层：合成 ─────────────────────────────────────
        if (!allowSynthesize) return null;

        await _acquireSynthSlot();
        let result;
        try {
            result = await synthesizeVoice({
                text: line, profile, quotaOncePerDay, signal
            });
        } finally {
            _releaseSynthSlot();
        }

        await putVoiceClip({
            voiceKey, chatId, msgId, text: line,
            presetId: profile.id || '',
            duration: result.originalDuration || result.duration || 0,
            mime: result.mime
        }, result.bytes);

        // 归档和淘汰都不阻塞返回 —— 字节已经在手上了，先让它能播
        _archiveVoiceClip(voiceKey, result.bytes).catch(() => {});
        enforceVoiceCacheLimit().catch(() => {});

        return {
            voiceKey, bytes: result.bytes, mime: result.mime,
            duration: result.originalDuration || result.duration || 0,
            source: 'synth'
        };
    })();

    _voiceInflight.set(voiceKey, task);
    try {
        return await task;
    } finally {
        // 无论成败都要清掉，否则失败过一次的 key 会永久返回那个被拒的 Promise
        _voiceInflight.delete(voiceKey);
    }
}
