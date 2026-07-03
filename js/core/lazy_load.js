// ==========================================
// lazy_load.js — 懒加载改造专用文件（Step 0 + 1 + 2）
// ------------------------------------------
// Step 2 起，loadData 会读取下面的开关。开关默认【关】，应用行为与改造前完全一致。
// 要启用懒加载：控制台跑 window.LAZY_LOAD = true 然后刷新；或在下面这行直接改成 true。
// 要回滚：改回 false 刷新即可，数据无损。
// ==========================================

// ★★★ 总开关 + 窗口大小。窗口必须 > maxMemory 上限（已定 maxMemory 上限 1000、窗口 1500）。
//   开关从 localStorage 读，方便控制台切换：
//     开启：localStorage.setItem('LAZY_LOAD','1')   然后刷新
//     关闭：localStorage.setItem('LAZY_LOAD','0')   然后刷新
window.LAZY_LOAD = localStorage.getItem('LAZY_LOAD') === '1';
window.LAZY_LOAD_LIMIT = 1500;

// ★★★ 铁律：本文件内任何从 DB 取消息的函数，排序只能用下面这一行（原样抄自 database.js:235），
//          绝不"改进"、绝不按 role/type/id 排序。上次崩盘就是有人改了排序。
//          （a.timestamp || 0） - （b.timestamp || 0）  ← 升序，缺失 timestamp 视为 0
function _sortByTimestampExact(a, b) {
    return (a.timestamp || 0) - (b.timestamp || 0);
}

// ──────────────────────────────────────────
// Step 1：新加载路径（未接入）
//   用 chatId 索引 + timestamp 反向，取最近 limit 条；
//   返回前用铁律那一行排序，保证与 loadData 现有顺序一致。
// ──────────────────────────────────────────
window.loadRecentMessages = async function (chatId, limit = 1500) {
    if (!window.dexieDB) throw new Error('dexieDB 未就绪');
    // ★ 用复合索引 [chatId+timestamp] 直接按时间倒序取最近 limit 条
    //   between([chatId, -Inf], [chatId, +Inf]) 圈定该 chat 的全部条目，
    //   .reverse() 变降序（最新在前），.limit() 只读 limit 条（不全量读盘）。
    //   ★ 只读 limit 条进内存，这是省内存的关键。
    const rows = await window.dexieDB.messages
        .where('[chatId+timestamp]')
        .between([chatId, Number.NEGATIVE_INFINITY], [chatId, Number.POSITIVE_INFINITY], true, true)
        .reverse()
        .limit(limit)
        .toArray();
    // 结果是降序（最新在前），翻回升序；再用铁律排序兜底（与现有 loadData 完全一致）
    rows.reverse();
    rows.sort(_sortByTimestampExact);
    return rows;
};

// ──────────────────────────────────────────
// Step 3：取"比当前内存窗口更旧"的一页（供往上翻历史调用）
//   oldestTimestamp = 当前 chat.history[0].timestamp
//   inMemoryIds     = 当前内存里所有消息 id 的 Set（dedup 用，防边界缝隙/重复）
//   返回：紧邻窗口、更旧的最多 limit 条，升序，timestamp 全部 <= oldestTimestamp
// ──────────────────────────────────────────
window.fetchOlderMessages = async function (chatId, oldestTimestamp, inMemoryIds, limit) {
    if (!window.dexieDB) throw new Error('dexieDB 未就绪');
    // between([chatId,-Inf],[chatId,oldestTs], 含下, 含上) → timestamp <= oldestTs
    // .reverse().limit(limit+200) → 从最接近 oldestTs 的开始取一批（含等时间戳边界）
    const buf = await window.dexieDB.messages
        .where('[chatId+timestamp]')
        .between([chatId, Number.NEGATIVE_INFINITY], [chatId, oldestTimestamp], true, true)
        .reverse()
        .limit(limit + 200)
        .toArray();
    const fresh = buf.filter(r => !inMemoryIds.has(r.id)); // 去掉已在内存的
    fresh.sort(_sortByTimestampExact);
    return fresh.slice(-limit); // 取最接近窗口的那一页（升序）
};

// ──────────────────────────────────────────
// Step 0 + Step 1 验收工具：等价对照（只读，不改任何数据）
//   对同一个 chat：
//     老路径 = 全量 toArray + 铁律排序，取最后 limit 条的 id 序列
//     新路径 = loadRecentMessages 返回的 id 序列
//   两者必须逐条 id 相同、顺序相同，否则报红。
//   现在就能跑（loadData 还没动，老路径仍是全量）。
// ──────────────────────────────────────────
window.verifyLazyLoad = async function (chatId, limit = 1500) {
    if (!window.dexieDB) throw new Error('dexieDB 未就绪');

    // 老路径：全量取，铁律排序
    const all = await window.dexieDB.messages.where('chatId').equals(chatId).toArray();
    all.sort(_sortByTimestampExact);
    const oldTail = all.slice(-limit);
    const oldIds = oldTail.map(m => m.id);

    // 新路径
    const recent = await window.loadRecentMessages(chatId, limit);
    const newIds = recent.map(m => m.id);

    // 逐条比对
    let firstDiff = -1;
    const n = Math.min(oldIds.length, newIds.length);
    for (let i = 0; i < n; i++) {
        if (oldIds[i] !== newIds[i]) { firstDiff = i; break; }
    }

    const lenMatch = oldIds.length === newIds.length;
    const orderMatch = firstDiff === -1 && lenMatch;

    const summary = {
        chatId,
        limit,
        oldCount: all.length,
        oldTailLen: oldIds.length,
        newLen: newIds.length,
        lenMatch,
        firstDiffIndex: firstDiff,
        orderMatch,
    };

    if (orderMatch) {
        console.log(`✅ [verifyLazyLoad] ${chatId} 顺序等价通过。全量 ${all.length} 条，尾部 ${newIds.length} 条逐条一致。`, summary);
    } else {
        console.error(`❌ [verifyLazyLoad] ${chatId} 顺序不一致！lenMatch=${lenMatch} firstDiff=${firstDiff}`, summary);
        if (firstDiff >= 0) {
            console.error('   老路径该位置 id:', oldIds[firstDiff], ' 新路径该位置 id:', newIds[firstDiff]);
            console.error('   老路径前后:', oldIds.slice(Math.max(0, firstDiff - 2), firstDiff + 3));
            console.error('   新路径前后:', newIds.slice(Math.max(0, firstDiff - 2), firstDiff + 3));
        }
    }
    return summary;
};

// ──────────────────────────────────────────
// Step 0：全量顺序体检（只读）
//   对每个 chat，按铁律排序后检查是否有 timestamp 缺失/为 0 的消息，
//   以及排序前后顺序是否一致（一致说明 DB 里本身就是升序，不一致也没关系——loadData 反正会排）。
//   主要用来建立基线认知：你的数据现在长什么样。
// ──────────────────────────────────────────
window.auditMessageOrder = async function () {
    if (!window.dexieDB || !window.db) throw new Error('db 未就绪');
    const chats = [...window.db.characters, ...window.db.groups];
    const report = [];
    for (const chat of chats) {
        const rows = await window.dexieDB.messages.where('chatId').equals(chat.id).toArray();
        const missingTs = rows.filter(m => m.timestamp === undefined || m.timestamp === null).length;
        const zeroTs = rows.filter(m => m.timestamp === 0).length;
        // DB 原始顺序是否已是升序
        let alreadySorted = true;
        for (let i = 1; i < rows.length; i++) {
            if (_sortByTimestampExact(rows[i - 1], rows[i]) > 0) { alreadySorted = false; break; }
        }
        report.push({
            chatId: chat.id,
            name: chat.name || chat.title || chat.myName || '?',
            total: rows.length,
            missingTimestamp: missingTs,
            zeroTimestamp: zeroTs,
            dbAlreadyAscending: alreadySorted,
        });
    }
    console.table(report);
    const total = report.reduce((s, r) => s + r.total, 0);
    const problematic = report.filter(r => r.missingTimestamp > 0 || !r.dbAlreadyAscending);
    console.log(`📊 共 ${chats.length} 个会话，${total} 条消息。`, problematic.length ? `${problematic.length} 个会话有 timestamp 缺失或非升序（不影响加载，loadData 会排序；但记录在案）。` : '全部会话 DB 内已升序且无 timestamp 缺失。');
    return report;
};

console.log('lazy_load.js 已加载（Step 0+1，未接入）。可用：window.auditMessageOrder() / window.loadRecentMessages(chatId,1500) / window.verifyLazyLoad(chatId,1500)');
