// --- js/core/restart_diag.js ---
// 重启原因记录器。
//
// 解决的问题：安卓 Chrome PWA 切后台再切回时偶发「明明看到页面了却重新启动」。
// 这类事件由系统内存压力触发，用户侧无法复现，也无法从控制台看到（页面已经重开，
// 上一条命的日志全没了）。所以把判定结果落到 localStorage，跨会话留痕。
//
// 判定依据（都是浏览器给的事实，不是猜测）：
//   document.wasDiscarded === true  → 系统内存不足丢弃了页面，这次是丢弃后的重载（确诊）
//   navigation.type === 'reload'    → 刷新（用户下拉刷新，或导入/云恢复后的 location.reload）
//   navigation.type === 'navigate' 且上次会话没留下干净退出标记
//                                   → 渲染进程非正常终止（OOM 被杀 / 崩溃）
//   navigation.type === 'navigate' 且有干净退出标记 → 正常冷启动
//
// 干净退出标记由 pagehide / freeze 写入。这两个事件是「页面即将被冻结或卸载」时
// 浏览器保证会给的最后一次机会；如果下次启动发现标记没写上，说明上次是被硬杀的。
(function initRestartDiag() {
    'use strict';

    const LOG_KEY = 'ouo_restart_log';      // 环形日志（最近 N 条会话记录）
    const LIVE_KEY = 'ouo_session_live';    // 本次会话的「进行中」标记
    const MAX_ENTRIES = 30;

    // 必须用本地时间。用 toISOString() 会得到 UTC，而后面 new Date(那个字符串)
    // 又按本地时间解析，两者一减就凭空多出一个时区差（国内 +8 会算出多活 480 分钟）；
    // 而且报告里的时间跟用户看表的时间对不上，没法和"我刚才几点碰到重启"对照。
    const nowIso = () => {
        const d = new Date();
        const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
               `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    };
    const mb = n => (typeof n === 'number' ? +(n / 1048576).toFixed(1) : null);

    function heap() {
        const m = performance.memory;
        if (!m) return null;
        return { usedMB: mb(m.usedJSHeapSize), limitMB: mb(m.jsHeapSizeLimit) };
    }

    function readJSON(key, fallback) {
        try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
        catch (_) { return fallback; }
    }
    function writeJSON(key, val) {
        try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {}
    }

    // ── 1. 判定上一次会话是怎么结束的 ─────────────────────────────
    const nav = performance.getEntriesByType('navigation')[0];
    const navType = nav ? nav.type : 'unknown';
    const prev = readJSON(LIVE_KEY, null);   // 上次会话留下的「进行中」快照

    let reason, detail;
    if (document.wasDiscarded) {
        reason = 'discarded';
        detail = '系统内存不足，Chrome 丢弃了页面（切回时先看到截图快照，随后才真正重载）';
    } else if (navType === 'reload') {
        reason = 'reload';
        detail = '页面被刷新（下拉刷新，或导入数据/云端恢复后的自动刷新）';
    } else if (navType === 'back_forward') {
        reason = 'bfcache';
        detail = '前进/后退恢复';
    } else if (prev && !prev.cleanExit) {
        reason = 'killed';
        detail = '上次会话没能写下退出标记 → 渲染进程被系统硬杀（通常是内存不足 OOM）或崩溃';
    } else {
        reason = 'coldstart';
        detail = '正常冷启动';
    }

    const entry = {
        at: nowIso(),
        reason,
        detail,
        navType,
        // 上次会话的临终快照，用来看被杀之前内存涨到了多少
        prevSession: prev ? {
            startedAt: prev.startedAt,
            lastSeenAt: prev.lastSeenAt,
            aliveMin: prev.startedAt && prev.lastSeenAt
                ? +((new Date(prev.lastSeenAt) - new Date(prev.startedAt)) / 60000).toFixed(1)
                : null,
            peakHeapMB: prev.peakHeapMB,
            lastHeapMB: prev.lastHeapMB,
            domNodes: prev.domNodes,
            logLines: prev.logLines,
            hiddenCount: prev.hiddenCount,
            froze: prev.froze,
            cleanExit: prev.cleanExit,
            activeScreen: prev.activeScreen ?? null,
            screenTrail: prev.screenTrail || []
        } : null,
        device: {
            deviceMemoryGB: navigator.deviceMemory ?? null,
            heapLimitMB: heap()?.limitMB ?? null
        }
    };

    // 冷启动这种没信息量的记录不写，免得把有用的挤出环形缓冲
    if (reason !== 'coldstart') {
        const log = readJSON(LOG_KEY, []);
        log.push(entry);
        while (log.length > MAX_ENTRIES) log.shift();
        writeJSON(LOG_KEY, log);
        // 同时打到控制台，方便接着电脑调试时直接看见
        console.warn('[重启诊断] 上次是异常结束：' + reason + ' — ' + detail);
    }

    // ── 2. 开始记录本次会话 ───────────────────────────────────────
    const live = {
        startedAt: nowIso(),
        lastSeenAt: nowIso(),
        peakHeapMB: heap()?.usedMB ?? null,
        lastHeapMB: heap()?.usedMB ?? null,
        domNodes: null,
        logLines: null,
        hiddenCount: 0,
        froze: false,
        cleanExit: false,
        activeScreen: null,   // 被杀那一刻停留在哪个页面
        screenTrail: []       // 最近的页面切换轨迹（最新在后）
    };
    writeJSON(LIVE_KEY, live);

    function currentScreenId() {
        const el = document.querySelector('.screen.active');
        return el ? el.id : null;
    }

    function sample() {
        const h = heap();
        live.lastSeenAt = nowIso();
        if (h) {
            live.lastHeapMB = h.usedMB;
            if (live.peakHeapMB == null || h.usedMB > live.peakHeapMB) live.peakHeapMB = h.usedMB;
        }
        live.domNodes = document.getElementsByTagName('*').length;
        const out = document.getElementById('dev-console-output');
        live.logLines = out ? out.children.length : null;
        live.activeScreen = currentScreenId();
        writeJSON(LIVE_KEY, live);
    }

    // 页面切换轨迹。用户报告"基本都是返回主屏时重启"，光有"被杀时停在哪一页"不够——
    // 需要知道死之前的几步操作，才能判断是不是某条特定的跳转路径触发的。
    // 用 MutationObserver 监听 .screen 的 class 变化，不依赖 switchScreen
    // （restart_diag 必须最先加载，那时 switchScreen 还没定义，包不了）。
    let lastTrailId = null;
    try {
        const trailMo = new MutationObserver(() => {
            const id = currentScreenId();
            if (!id || id === lastTrailId) return;
            lastTrailId = id;
            live.screenTrail.push(nowIso().slice(11) + ' ' + id);
            while (live.screenTrail.length > 12) live.screenTrail.shift();
            live.activeScreen = id;
            writeJSON(LIVE_KEY, live);
        });
        document.addEventListener('DOMContentLoaded', () => {
            lastTrailId = currentScreenId();
            if (lastTrailId) live.screenTrail.push(nowIso().slice(11) + ' ' + lastTrailId);
            trailMo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
        });
    } catch (_) { /* 观察器不可用时静默降级，诊断其余部分照常工作 */ }

    // 30 秒采样一次，持续更新「还活着 + 当前内存」快照
    setInterval(sample, 30000);

    // 切后台时补一次采样。这一刻的数值最有价值：系统正是在这时决定要不要回收页面
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') { live.hiddenCount++; sample(); }
    });

    // freeze：Chrome 冻结后台页面时触发，是「即将被丢弃」的前兆。
    // 注意这里【不能】标记干净退出——安卓上「冻结 → 系统 OOM 杀掉」这条路径里
    // wasDiscarded 是 false，若冻结就算干净退出，这次被杀就会被误判成正常冷启动而漏记。
    // 冻结只是暂停，不是结束，所以只记 froze 供事后参考。
    document.addEventListener('freeze', () => { live.froze = true; sample(); });
    // pagehide 才是真正的「页面即将卸载」——正常关闭/跳转会给，被硬杀不会给。
    // 所以它是判断上次是否正常收尾的唯一依据。
    window.addEventListener('pagehide', () => { live.cleanExit = true; sample(); });
    // 从冻结中恢复：这条命还在继续，把标记清掉
    document.addEventListener('resume', () => { live.froze = false; live.cleanExit = false; sample(); });

    // ── 3. 查看接口 ───────────────────────────────────────────────
    window.OuODiag = {
        // 控制台里敲 OuODiag.report() 看历史；手机上点「系统日志」页右上角的三角按钮
        report() {
            const log = readJSON(LOG_KEY, []);
            if (!log.length) { console.log('[重启诊断] 暂无异常重启记录'); return log; }
            console.log('[重启诊断] 共 ' + log.length + ' 条异常重启记录（新的在下面）：');
            log.forEach(e => {
                const p = e.prevSession;
                console.log(
                    `${e.at}  ${e.reason}\n  ${e.detail}` +
                    (p ? `\n  上次会话：存活 ${p.aliveMin ?? '?'} 分钟，切后台 ${p.hiddenCount ?? '?'} 次，` +
                         `峰值堆 ${p.peakHeapMB ?? '?'}MB / 上限 ${e.device.heapLimitMB ?? '?'}MB，` +
                         `DOM ${p.domNodes ?? '?'} 节点，日志 ${p.logLines ?? '?'} 行` +
                         `\n  死前停留页面：${p.activeScreen ?? '(未记录)'}` +
                         (p.screenTrail && p.screenTrail.length
                             ? '\n  死前页面轨迹：\n    ' + p.screenTrail.join('\n    ')
                             : '\n  死前页面轨迹：(未记录)')
                       : '')
                );
            });
            return log;
        },
        // 当前实时状态
        now() { sample(); return { ...live, heapLimitMB: heap()?.limitMB ?? null }; },
        // 汇总：各类原因各出现几次
        summary() {
            const log = readJSON(LOG_KEY, []);
            const by = {};
            log.forEach(e => { by[e.reason] = (by[e.reason] || 0) + 1; });
            const peaks = log.map(e => e.prevSession?.peakHeapMB).filter(v => typeof v === 'number');
            return {
                总记录数: log.length,
                各原因次数: by,
                被杀前峰值堆MB: peaks.length ? { 最大: Math.max(...peaks), 最小: Math.min(...peaks) } : null,
                堆上限MB: heap()?.limitMB ?? null,
                设备内存GB: navigator.deviceMemory ?? null
            };
        },
        clear() { try { localStorage.removeItem(LOG_KEY); } catch (_) {} console.log('[重启诊断] 已清空'); }
    };

    // ── 4. 手机上的入口 ──────────────────────────────────────────
    // 手机上没有 devtools，「系统日志」页也只有输出区、没有输入框，
    // 所以 OuODiag.report() 在真机上根本没法调用——加个按钮把报告打到输出区。
    document.addEventListener('DOMContentLoaded', () => {
        const btn = document.getElementById('diag-report-btn');
        if (!btn) return;
        btn.addEventListener('click', () => {
            console.log('──────── 重启诊断报告 ────────');
            const s = window.OuODiag.summary();
            console.log('汇总：' + JSON.stringify(s, null, 2));
            window.OuODiag.report();
            const n = window.OuODiag.now();
            console.log('本次会话（进行中）：\n' +
                `  已存活 ${+((Date.now() - new Date(n.startedAt).getTime()) / 60000).toFixed(1)} 分钟，` +
                `切后台 ${n.hiddenCount} 次\n` +
                `  当前堆 ${n.lastHeapMB ?? '?'}MB / 峰值 ${n.peakHeapMB ?? '?'}MB / 上限 ${n.heapLimitMB ?? '?'}MB\n` +
                `  DOM ${n.domNodes ?? '?'} 节点，日志 ${n.logLines ?? '?'} 行\n` +
                `  当前页面：${n.activeScreen ?? '?'}\n` +
                '  页面轨迹：\n    ' + (n.screenTrail || []).join('\n    '));
            console.log('──────── 报告结束 ────────');
        });
    });
})();
