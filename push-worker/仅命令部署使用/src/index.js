// ── OuO 推送中转 Worker（带诊断日志版）──────────────────────────────
// 职责极简：它只是个「无情的到点发送器」。
//   · 前端把算好的 { 发送时刻, 通知文案, 订阅凭证 } POST 过来存进 KV；
//   · 每分钟 cron 扫一遍，到点的就用 Web Push 推给手机，然后删掉；
//   · 前端要撤销时调 /cancel；用户回到前台时调 /cancel-all 清空。
// 所有业务逻辑（要不要发、什么时候发、发什么）都在前端算好，Worker 不懂也不关心。
//
// 诊断：运行 `wrangler tail` 可实时看到 [push] 日志，包括 FCM 返回的状态码。
//   201 = 成功；403 = VAPID 密钥不匹配；404/410 = 订阅失效。
// ───────────────────────────────────────────────────────────────────────

import { buildPushPayload } from '@block65/webcrypto-web-push';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-client-token',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  });
}

function authorized(request, env) {
  if (!env.CLIENT_TOKEN) return true;
  return request.headers.get('x-client-token') === env.CLIENT_TOKEN;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/' || path === '/health') {
      // 顺带自检：三个 VAPID 环境变量设了没
      return json({
        ok: true,
        service: 'ouo-push-worker',
        ts: Date.now(),
        vapidPublicSet: !!env.VAPID_PUBLIC_KEY,
        vapidPrivateSet: !!env.VAPID_PRIVATE_KEY,
        vapidSubjectSet: !!env.VAPID_SUBJECT,
        vapidPublicKey: env.VAPID_PUBLIC_KEY || null, // 方便和 App 里的公钥比对
      });
    }

    // 诊断：列出当前 KV 里所有待发任务（浏览器直接 GET 打开即可查看）
    if (path === '/list') {
      const now = Date.now();
      const listed = await env.PUSH_TASKS.list({ prefix: 'task:' });
      const tasks = [];
      for (const k of listed.keys) {
        const raw = await env.PUSH_TASKS.get(k.name);
        if (!raw) continue;
        let t; try { t = JSON.parse(raw); } catch { continue; }
        tasks.push({
          taskId: t.taskId,
          groupId: t.groupId || null,
          deliverAt: t.deliverAt,
          deliverAtLocal: t.deliverAt ? new Date(t.deliverAt).toISOString() : null,
          dueInSec: t.deliverAt ? Math.round((t.deliverAt - now) / 1000) : null,
          title: t.payload && t.payload.title,
          body: t.payload && t.payload.body,
          chatId: t.payload && t.payload.chatId,
        });
      }
      tasks.sort((a, b) => (a.deliverAt || 0) - (b.deliverAt || 0));
      return json({ ok: true, now, nowLocal: new Date(now).toISOString(), count: tasks.length, tasks });
    }

    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (!authorized(request, env)) return json({ error: 'unauthorized' }, 401);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }

    // 新增定时任务；支持 ?now=1 立即发送用于测试（不进 KV，直接推，并把结果原样返回）
    if (path === '/add-task') {
      const { taskId, deliverAt, subscription, payload, groupId } = body || {};
      if (!taskId || !subscription || !payload) return json({ error: 'missing_fields' }, 400);

      if (url.searchParams.get('now') === '1') {
        const result = await sendOne(env, { taskId, subscription, payload });
        return json({ ok: result.ok, immediate: true, status: result.status, error: result.error });
      }

      if (!deliverAt) return json({ error: 'missing_deliverAt' }, 400);
      const task = { taskId, deliverAt, subscription, payload, groupId: groupId || null };
      const ttl = Math.max(60, Math.floor((deliverAt - Date.now()) / 1000) + 86400);
      await env.PUSH_TASKS.put('task:' + taskId, JSON.stringify(task), { expirationTtl: ttl });
      return json({ ok: true, taskId });
    }

    if (path === '/cancel') {
      const ids = Array.isArray(body.taskIds) ? body.taskIds : [];
      for (const id of ids) await env.PUSH_TASKS.delete('task:' + id);
      let groupN = 0;
      if (body.groupId) groupN = await cancelGroup(env, body.groupId);
      return json({ ok: true, cancelled: ids.length + groupN });
    }

    if (path === '/cancel-all') {
      const n = await purgeEndpoint(env, body.endpoint || null);
      return json({ ok: true, cancelled: n });
    }

    // 按 chatId(+设备端点)撤销该会话的待发任务。可选 kind='si'|'peek' 只撤某一类。
    // 前端刷新后会丢失内存里的 taskId，这个接口让撤销不依赖前端记忆，最健壮。
    if (path === '/cancel-chat') {
      const chatId = body.chatId || null;
      const endpoint = body.endpoint || null;
      const kind = body.kind || null; // null=全部
      if (!chatId) return json({ error: 'missing_chatId' }, 400);
      const n = await cancelByChat(env, chatId, endpoint, kind);
      return json({ ok: true, cancelled: n });
    }

    return json({ error: 'not_found' }, 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(deliverDue(env));
  },
};

async function deliverDue(env) {
  const now = Date.now();
  const list = await env.PUSH_TASKS.list({ prefix: 'task:' });
  console.log(`[cron] 扫描 ${list.keys.length} 个任务 @ ${new Date(now).toISOString()}`);
  for (const k of list.keys) {
    const raw = await env.PUSH_TASKS.get(k.name);
    if (!raw) continue;
    let t;
    try { t = JSON.parse(raw); } catch { await env.PUSH_TASKS.delete(k.name); continue; }
    if (!t.deliverAt || t.deliverAt > now) continue;

    await sendOne(env, t);
    await env.PUSH_TASKS.delete(k.name);
    if (t.groupId) await cancelGroup(env, t.groupId, t.taskId);
  }
}

async function sendOne(env, task) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    console.log('[push] ❌ 未设置 VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY');
    return { ok: false, status: 0, error: 'vapid_not_set' };
  }
  const vapid = {
    subject: env.VAPID_SUBJECT || 'mailto:admin@example.com',
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };
  const message = {
    data: JSON.stringify(task.payload),
    options: { ttl: 3600 },
  };
  try {
    const req = await buildPushPayload(message, task.subscription, vapid);
    const res = await fetch(task.subscription.endpoint, req);
    console.log(`[push] taskId=${task.taskId} → FCM 状态 ${res.status}` +
      (res.status === 403 ? '（403 = VAPID 密钥不匹配，检查三处公私钥是否同一对）' :
       res.status === 404 || res.status === 410 ? '（订阅失效，已清理）' :
       res.status === 201 ? '（成功）' : ''));
    if (res.status === 404 || res.status === 410) {
      await purgeEndpoint(env, task.subscription.endpoint);
    }
    return { ok: res.status >= 200 && res.status < 300, status: res.status };
  } catch (e) {
    console.log('[push] ❌ 发送异常:', e && e.message ? e.message : String(e));
    return { ok: false, status: 0, error: String(e && e.message ? e.message : e) };
  }
}

// 按 chatId(+端点)撤销任务；kind 可选只撤 'si' / 'peek'（据 payload.kind）
async function cancelByChat(env, chatId, endpoint, kind) {
  const list = await env.PUSH_TASKS.list({ prefix: 'task:' });
  let n = 0;
  for (const k of list.keys) {
    const raw = await env.PUSH_TASKS.get(k.name);
    if (!raw) continue;
    let t;
    try { t = JSON.parse(raw); } catch { continue; }
    const p = t.payload || {};
    if (p.chatId !== chatId) continue;
    if (endpoint && t.subscription && t.subscription.endpoint !== endpoint) continue;
    if (kind && p.kind !== kind) continue;
    await env.PUSH_TASKS.delete(k.name);
    n++;
  }
  return n;
}

async function cancelGroup(env, groupId, exceptTaskId) {
  const list = await env.PUSH_TASKS.list({ prefix: 'task:' });
  let n = 0;
  for (const k of list.keys) {
    const raw = await env.PUSH_TASKS.get(k.name);
    if (!raw) continue;
    let t;
    try { t = JSON.parse(raw); } catch { continue; }
    if (t.groupId === groupId && t.taskId !== exceptTaskId) {
      await env.PUSH_TASKS.delete(k.name);
      n++;
    }
  }
  return n;
}

async function purgeEndpoint(env, endpoint) {
  const list = await env.PUSH_TASKS.list({ prefix: 'task:' });
  let n = 0;
  for (const k of list.keys) {
    const raw = await env.PUSH_TASKS.get(k.name);
    if (!raw) continue;
    let t;
    try { t = JSON.parse(raw); } catch { await env.PUSH_TASKS.delete(k.name); n++; continue; }
    if (!endpoint || (t.subscription && t.subscription.endpoint === endpoint)) {
      await env.PUSH_TASKS.delete(k.name);
      n++;
    }
  }
  return n;
}
