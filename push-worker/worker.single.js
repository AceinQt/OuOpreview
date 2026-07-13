// 自动生成，请勿手改；改逻辑请改 src/index.js 后重新 npm run build

// node_modules/base64-arraybuffer/dist/base64-arraybuffer.es5.js
var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var lookup = typeof Uint8Array === "undefined" ? [] : new Uint8Array(256);
for (i = 0; i < chars.length; i++) {
  lookup[chars.charCodeAt(i)] = i;
}
var i;
var encode = function(arraybuffer) {
  var bytes = new Uint8Array(arraybuffer), i, len = bytes.length, base64 = "";
  for (i = 0; i < len; i += 3) {
    base64 += chars[bytes[i] >> 2];
    base64 += chars[(bytes[i] & 3) << 4 | bytes[i + 1] >> 4];
    base64 += chars[(bytes[i + 1] & 15) << 2 | bytes[i + 2] >> 6];
    base64 += chars[bytes[i + 2] & 63];
  }
  if (len % 3 === 2) {
    base64 = base64.substring(0, base64.length - 1) + "=";
  } else if (len % 3 === 1) {
    base64 = base64.substring(0, base64.length - 2) + "==";
  }
  return base64;
};
var decode = function(base64) {
  var bufferLength = base64.length * 0.75, len = base64.length, i, p = 0, encoded1, encoded2, encoded3, encoded4;
  if (base64[base64.length - 1] === "=") {
    bufferLength--;
    if (base64[base64.length - 2] === "=") {
      bufferLength--;
    }
  }
  var arraybuffer = new ArrayBuffer(bufferLength), bytes = new Uint8Array(arraybuffer);
  for (i = 0; i < len; i += 4) {
    encoded1 = lookup[base64.charCodeAt(i)];
    encoded2 = lookup[base64.charCodeAt(i + 1)];
    encoded3 = lookup[base64.charCodeAt(i + 2)];
    encoded4 = lookup[base64.charCodeAt(i + 3)];
    bytes[p++] = encoded1 << 2 | encoded2 >> 4;
    bytes[p++] = (encoded2 & 15) << 4 | encoded3 >> 2;
    bytes[p++] = (encoded3 & 3) << 6 | encoded4 & 63;
  }
  return arraybuffer;
};

// node_modules/@block65/webcrypto-web-push/dist/lib/cf-jwt/base64.js
function decodeBase64Url(str) {
  return decode(str.replace(/-/g, "+").replace(/_/g, "/"));
}
function encodeBase64Url(arr) {
  return encode(arr).replace(/\//g, "_").replace(/\+/g, "-").replace(/=+$/, "");
}
function objectToBase64Url(obj) {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(obj)));
}

// node_modules/@block65/webcrypto-web-push/dist/lib/isomorphic-crypto.js
var impl = globalThis.crypto ? globalThis.crypto : await import("node:crypto");
var crypto2 = {
  getRandomValues: (array) => "webcrypto" in impl ? impl.webcrypto.getRandomValues(array) : impl.getRandomValues(array),
  subtle: "webcrypto" in impl ? impl.webcrypto.subtle : impl.subtle
};
var CryptoKey2 = "webcrypto" in impl ? impl.webcrypto.CryptoKey : globalThis.CryptoKey;

// node_modules/@block65/webcrypto-web-push/dist/lib/client-keys.js
async function deriveClientKeys(sub) {
  const publicBytes = decodeBase64Url(sub.keys.p256dh);
  const publicJwk = {
    kty: "EC",
    crv: "P-256",
    x: encodeBase64Url(publicBytes.slice(1, 33)),
    y: encodeBase64Url(publicBytes.slice(33, 65)),
    ext: true
  };
  return {
    publicBytes: new Uint8Array(publicBytes),
    publicKey: await crypto2.subtle.importKey("jwk", publicJwk, {
      name: "ECDH",
      namedCurve: "P-256"
    }, true, []),
    authSecretBytes: decodeBase64Url(sub.keys.auth)
  };
}

// node_modules/@block65/webcrypto-web-push/dist/lib/hkdf.js
function createHMAC(data) {
  if (data.byteLength === 0) {
    return {
      hash: () => Promise.resolve(new ArrayBuffer(32))
    };
  }
  const keyPromise = crypto2.subtle.importKey("raw", data, {
    name: "HMAC",
    hash: "SHA-256"
  }, true, ["sign"]);
  return {
    hash: async (input) => {
      const k = await keyPromise;
      return crypto2.subtle.sign("HMAC", k, input);
    }
  };
}
async function hkdf(salt, ikm) {
  const prkhPromise = createHMAC(salt).hash(ikm).then((prk) => createHMAC(prk));
  return {
    extract: async (info, len) => {
      const input = new Uint8Array([
        ...new Uint8Array(info),
        ...new Uint8Array([1])
      ]);
      const prkh = await prkhPromise;
      const hash = await prkh.hash(input);
      return hash.slice(0, len);
    }
  };
}

// node_modules/@block65/webcrypto-web-push/dist/lib/utils.js
function flattenUint8Array(arrays) {
  const flatNumberArray = arrays.reduce((accum, arr) => {
    accum.push(...arr);
    return accum;
  }, []);
  return new Uint8Array(flatNumberArray);
}
function be16(val) {
  return (val & 255) << 8 | val >> 8 & 255;
}
function arrayChunk(arr, chunkSize) {
  const chunks = [];
  const arrayLength = arr.length;
  let i = 0;
  while (i < arrayLength) {
    chunks.push(arr.slice(i, i += chunkSize));
  }
  return chunks;
}
function generateNonce(base, index) {
  const nonce = base.slice(0, 12);
  for (let i = 0; i < 6; ++i) {
    nonce[nonce.length - 1 - i] ^= index / 256 ** i & 255;
  }
  return nonce;
}
function encodeLength(int) {
  return new Uint8Array([0, int]);
}
function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// node_modules/@block65/webcrypto-web-push/dist/lib/info.js
function createInfo(clientPublic, serverPublic, type) {
  return new Uint8Array([
    ...new TextEncoder().encode(`Content-Encoding: ${type}\0`),
    ...new TextEncoder().encode("P-256\0"),
    ...encodeLength(clientPublic.byteLength),
    ...clientPublic,
    ...encodeLength(serverPublic.byteLength),
    ...serverPublic
  ]);
}
function createInfo2(type) {
  return new Uint8Array([
    ...new TextEncoder().encode(`Content-Encoding: ${type}\0`)
    // ...new TextEncoder().encode('P-256\0'),
    // ...encodeInt(clientPublic.byteLength),
    // ...clientPublic,
    // ...encodeInt(serverPublic.byteLength),
    // ...serverPublic,
  ]);
}

// node_modules/@block65/webcrypto-web-push/dist/lib/jwk-to-bytes.js
function ecJwkToBytes(jwk) {
  invariant(jwk.x, "jwk.x is missing");
  invariant(jwk.y, "jwk.y is missing");
  const xBytes = new Uint8Array(decodeBase64Url(jwk.x));
  const yBytes = new Uint8Array(decodeBase64Url(jwk.y));
  const raw = [4, ...xBytes, ...yBytes];
  return new Uint8Array(raw);
}

// node_modules/@block65/webcrypto-web-push/dist/lib/local-keys.js
async function generateLocalKeys() {
  const keyPair = await crypto2.subtle.generateKey({
    name: "ECDH",
    namedCurve: "P-256"
  }, true, ["deriveBits"]);
  const publicJwk = await crypto2.subtle.exportKey("jwk", keyPair.publicKey);
  const privateJwk = await crypto2.subtle.exportKey("jwk", keyPair.privateKey);
  return {
    publicKey: await crypto2.subtle.importKey("jwk", publicJwk, { name: "ECDH", namedCurve: "P-256" }, true, []),
    privateKey: keyPair.privateKey,
    publicJwk,
    privateJwk
  };
}

// node_modules/@block65/webcrypto-web-push/dist/lib/salt.js
async function getSalt() {
  return crypto2.getRandomValues(new Uint8Array(16));
}

// node_modules/@block65/webcrypto-web-push/dist/lib/encrypt.js
async function encryptNotification(subscription, plaintext) {
  const clientKeys = await deriveClientKeys(subscription);
  const salt = await getSalt();
  const localKeys = await generateLocalKeys();
  const localPublicKeyBytes = ecJwkToBytes(localKeys.publicJwk);
  const sharedSecret = await crypto2.subtle.deriveBits({
    name: "ECDH",
    // namedCurve: 'P-256',
    public: clientKeys.publicKey
  }, localKeys.privateKey, 256);
  const cekInfo = createInfo(clientKeys.publicBytes, localPublicKeyBytes, "aesgcm");
  const nonceInfo = createInfo(clientKeys.publicBytes, localPublicKeyBytes, "nonce");
  const keyInfo = createInfo2("auth");
  const ikmHkdf = await hkdf(clientKeys.authSecretBytes, sharedSecret);
  const ikm = await ikmHkdf.extract(keyInfo, 32);
  const messageHkdf = await hkdf(salt, ikm);
  const cekBytes = await messageHkdf.extract(cekInfo, 16);
  const nonceBytes = await messageHkdf.extract(nonceInfo, 12);
  const cekCryptoKey = await crypto2.subtle.importKey("raw", cekBytes, {
    name: "AES-GCM",
    length: 128
  }, false, ["encrypt"]);
  const cipherChunks = await Promise.all(arrayChunk(plaintext, 4095).map(async (chunk, idx) => {
    const padSize = 0;
    const x = new Uint16Array([be16(padSize)]);
    const padded = new Uint8Array([
      ...new Uint8Array(x.buffer, x.byteOffset, x.byteLength),
      ...chunk
    ]);
    const encrypted = await crypto2.subtle.encrypt({
      name: "AES-GCM",
      iv: generateNonce(new Uint8Array(nonceBytes), idx)
    }, cekCryptoKey, padded);
    return new Uint8Array(encrypted);
  }));
  return {
    ciphertext: flattenUint8Array(cipherChunks),
    salt,
    localPublicKeyBytes
  };
}

// node_modules/@block65/webcrypto-web-push/dist/lib/cf-jwt/jwt-algorithms.js
var algorithms = {
  ES256: { name: "ECDSA", namedCurve: "P-256", hash: { name: "SHA-256" } },
  ES384: { name: "ECDSA", namedCurve: "P-384", hash: { name: "SHA-384" } },
  ES512: { name: "ECDSA", namedCurve: "P-521", hash: { name: "SHA-512" } },
  HS256: { name: "HMAC", hash: { name: "SHA-256" } },
  HS384: { name: "HMAC", hash: { name: "SHA-384" } },
  HS512: { name: "HMAC", hash: { name: "SHA-512" } },
  RS256: { name: "RSASSA-PKCS1-v1_5", hash: { name: "SHA-256" } },
  RS384: { name: "RSASSA-PKCS1-v1_5", hash: { name: "SHA-384" } },
  RS512: { name: "RSASSA-PKCS1-v1_5", hash: { name: "SHA-512" } }
};

// node_modules/@block65/webcrypto-web-push/dist/lib/cf-jwt/sign.js
async function sign(payload, key, options) {
  if (payload === null || typeof payload !== "object") {
    throw new Error("payload must be an object");
  }
  if (!(key instanceof CryptoKey2)) {
    throw new Error("key must be a CryptoKey");
  }
  if (typeof options.algorithm !== "string") {
    throw new Error("options.algorithm must be a string");
  }
  const headerStr = objectToBase64Url({
    typ: "JWT",
    alg: options.algorithm,
    ...options.kid && { kid: options.kid }
  });
  const payloadStr = objectToBase64Url({
    iat: Math.floor(Date.now() / 1e3),
    ...payload
  });
  const dataStr = `${headerStr}.${payloadStr}`;
  const signature = await crypto2.subtle.sign(algorithms[options.algorithm], key, new TextEncoder().encode(dataStr));
  return `${dataStr}.${encodeBase64Url(signature)}`;
}

// node_modules/@block65/custom-error/dist/lib/custom-error.js
var Status;
(function(Status2) {
  Status2[Status2["OK"] = 0] = "OK";
  Status2[Status2["CANCELLED"] = 1] = "CANCELLED";
  Status2[Status2["UNKNOWN"] = 2] = "UNKNOWN";
  Status2[Status2["INVALID_ARGUMENT"] = 3] = "INVALID_ARGUMENT";
  Status2[Status2["DEADLINE_EXCEEDED"] = 4] = "DEADLINE_EXCEEDED";
  Status2[Status2["NOT_FOUND"] = 5] = "NOT_FOUND";
  Status2[Status2["ALREADY_EXISTS"] = 6] = "ALREADY_EXISTS";
  Status2[Status2["PERMISSION_DENIED"] = 7] = "PERMISSION_DENIED";
  Status2[Status2["RESOURCE_EXHAUSTED"] = 8] = "RESOURCE_EXHAUSTED";
  Status2[Status2["FAILED_PRECONDITION"] = 9] = "FAILED_PRECONDITION";
  Status2[Status2["ABORTED"] = 10] = "ABORTED";
  Status2[Status2["OUT_OF_RANGE"] = 11] = "OUT_OF_RANGE";
  Status2[Status2["UNIMPLEMENTED"] = 12] = "UNIMPLEMENTED";
  Status2[Status2["INTERNAL"] = 13] = "INTERNAL";
  Status2[Status2["UNAVAILABLE"] = 14] = "UNAVAILABLE";
  Status2[Status2["DATA_LOSS"] = 15] = "DATA_LOSS";
  Status2[Status2["UNAUTHENTICATED"] = 16] = "UNAUTHENTICATED";
})(Status || (Status = {}));
var CUSTOM_ERROR_SYM = Symbol.for("CustomError");
var defaultHttpMapping = /* @__PURE__ */ new Map([
  [Status.OK, 200],
  [Status.INVALID_ARGUMENT, 400],
  [Status.FAILED_PRECONDITION, 400],
  [Status.OUT_OF_RANGE, 400],
  [Status.UNAUTHENTICATED, 401],
  [Status.PERMISSION_DENIED, 403],
  [Status.NOT_FOUND, 404],
  [Status.ABORTED, 409],
  [Status.ALREADY_EXISTS, 409],
  [Status.RESOURCE_EXHAUSTED, 403],
  [Status.CANCELLED, 499],
  [Status.DATA_LOSS, 500],
  [Status.UNKNOWN, 500],
  [Status.INTERNAL, 500],
  [Status.UNIMPLEMENTED, 501],
  // [Code.LOCAL_OUTAGE,  502],
  [Status.UNAVAILABLE, 503],
  [Status.DEADLINE_EXCEEDED, 504]
]);
function withNullProto(obj) {
  return Object.assign(/* @__PURE__ */ Object.create(null), obj);
}
var CustomError = class extends Error {
  /**
   * The previous error that occurred, useful if "wrapping" an error to hide
   * sensitive details
   * @type {Error | CustomError | unknown}
   */
  cause;
  /**
   * Further error details suitable for end user consumption
   * @type {ErrorDetail[]}
   */
  details;
  /**
   * Status code suitable to coarsely determine the reason for error
   * @type {Status}
   */
  code = Status.UNKNOWN;
  /**
   * Contains arbitrary debug data for developer troubleshooting
   * @type {DebugData}
   * @private
   */
  debugData;
  /**
   *
   * @param {string} message Developer facing message, in English.
   * @param {Error | CustomError | unknown} cause
   */
  constructor(message, cause) {
    super(message, { cause });
    this.cause = cause;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
  static isCustomError(value) {
    return !!value && typeof value === "object" && CUSTOM_ERROR_SYM in value;
  }
  debug(data) {
    if (arguments.length > 0) {
      this.debugData = withNullProto({
        ...this.debugData,
        ...data
      });
      return this;
    }
    return this.debugData;
  }
  /**
   * Human readable representation of the error code
   * @return {keyof typeof Status}
   */
  get status() {
    return Status[this.code];
  }
  /**
   * Adds further error details suitable for end user consumption
   * @param {ErrorDetail} details
   * @return {this}
   */
  addDetail(...details) {
    this.details = (this.details || []).concat(details);
    return this;
  }
  /**
   * A "safe" serialised version of the error designed for end user consumption
   * @return {CustomErrorSerialized}
   */
  serialize() {
    const localised = this.details?.find((detail) => "locale" in detail);
    return withNullProto({
      message: this.message,
      ...localised?.message && {
        message: localised.message
      },
      code: this.code,
      status: this.status,
      ...this.details && { details: this.details }
    });
  }
  /**
   * JSON representation of the error object.
   *
   * Use {serialize} instead if you need to send this error over the wire
   *
   * @return {object}
   */
  toJSON() {
    const debug = this.debug();
    return withNullProto({
      name: this.name,
      message: this.message,
      code: this.code,
      status: this.status,
      ...this.details && { details: this.details },
      ...this.cause instanceof Error && {
        cause: "toJSON" in this.cause && typeof this.cause.toJSON === "function" ? this.cause.toJSON() : {
          message: this.cause.message,
          name: "Error"
        }
      },
      ...this.stack && { stack: this.stack },
      ...debug && { debug }
    });
  }
  /**
   * "Hydrates" a previously serialised error object
   * @param {CustomErrorSerialized} params
   * @return {CustomError}
   */
  static fromJSON(params) {
    const { code = Status.UNKNOWN, message, details = [] } = params;
    const err = new CustomError(message || (Status[params.code] || params.code || "Error").toString()).debug({ params });
    err.code = code;
    if (details) {
      err.addDetail(...details);
    }
    return err;
  }
  /**
   * An automatically determined HTTP status code
   * @return {number}
   */
  static suggestHttpResponseCode(err) {
    const code = CustomError.isCustomError(err) ? err.code : Status.UNKNOWN;
    return defaultHttpMapping.get(code) || 500;
  }
};
Object.defineProperty(CustomError.prototype, CUSTOM_ERROR_SYM, {
  value: true,
  enumerable: false,
  writable: false
});
Object.defineProperty(CustomError.prototype, "status", {
  enumerable: true
});

// node_modules/@block65/webcrypto-web-push/dist/lib/vapid.js
async function vapidHeaders(subscription, vapid) {
  invariant(vapid.subject, "Vapid subject is empty");
  invariant(vapid.privateKey, "Vapid private key is empty");
  invariant(vapid.publicKey, "Vapid public key is empty");
  const vapidPublicKeyBytes = decodeBase64Url(vapid.publicKey);
  const publicKey = await crypto2.subtle.importKey("jwk", {
    kty: "EC",
    crv: "P-256",
    x: encodeBase64Url(vapidPublicKeyBytes.slice(1, 33)),
    y: encodeBase64Url(vapidPublicKeyBytes.slice(33, 65)),
    d: vapid.privateKey
  }, {
    name: "ECDSA",
    namedCurve: "P-256"
  }, false, ["sign"]);
  const jwt = await sign({
    aud: new URL(subscription.endpoint).origin,
    exp: Math.floor(Date.now() / 1e3) + 12 * 60 * 60,
    sub: vapid.subject
  }, publicKey, {
    algorithm: "ES256"
  });
  return {
    headers: {
      authorization: `WebPush ${jwt}`,
      "crypto-key": `p256ecdsa=${vapid.publicKey}`
    }
    // publicJwk,
  };
}

// node_modules/@block65/webcrypto-web-push/dist/lib/payload.js
async function buildPushPayload(message, subscription, vapid) {
  const { headers } = await vapidHeaders(subscription, vapid);
  const encrypted = await encryptNotification(subscription, new TextEncoder().encode(
    // if its a primitive, convert to string, otherwise stringify
    typeof message.data === "string" || typeof message.data === "number" ? message.data.toString() : JSON.stringify(message.data)
  ));
  return {
    headers: {
      ...headers,
      "crypto-key": `dh=${encodeBase64Url(encrypted.localPublicKeyBytes)};${headers["crypto-key"]}`,
      encryption: `salt=${encodeBase64Url(encrypted.salt)}`,
      ttl: (message.options?.ttl || 60).toString(),
      ...message.options?.urgency && {
        urgency: message.options.urgency
      },
      ...message.options?.topic && {
        topic: message.options.topic
      },
      "content-encoding": "aesgcm",
      "content-length": encrypted.ciphertext.byteLength.toString(),
      "content-type": "application/octet-stream"
    },
    method: "post",
    body: encrypted.ciphertext
  };
}

// src/index.js
var CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-client-token"
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...CORS }
  });
}
function authorized(request, env) {
  if (!env.CLIENT_TOKEN)
    return true;
  return request.headers.get("x-client-token") === env.CLIENT_TOKEN;
}
var src_default = {
  async fetch(request, env) {
    if (request.method === "OPTIONS")
      return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/" || path === "/health") {
      return json({
        ok: true,
        service: "ouo-push-worker",
        ts: Date.now(),
        vapidPublicSet: !!env.VAPID_PUBLIC_KEY,
        vapidPrivateSet: !!env.VAPID_PRIVATE_KEY,
        vapidSubjectSet: !!env.VAPID_SUBJECT,
        vapidPublicKey: env.VAPID_PUBLIC_KEY || null
        // 方便和 App 里的公钥比对
      });
    }
    if (path === "/list") {
      const now = Date.now();
      const listed = await env.PUSH_TASKS.list({ prefix: "task:" });
      const tasks = [];
      for (const k of listed.keys) {
        const raw = await env.PUSH_TASKS.get(k.name);
        if (!raw)
          continue;
        let t;
        try {
          t = JSON.parse(raw);
        } catch {
          continue;
        }
        tasks.push({
          taskId: t.taskId,
          groupId: t.groupId || null,
          deliverAt: t.deliverAt,
          deliverAtLocal: t.deliverAt ? new Date(t.deliverAt).toISOString() : null,
          dueInSec: t.deliverAt ? Math.round((t.deliverAt - now) / 1e3) : null,
          title: t.payload && t.payload.title,
          body: t.payload && t.payload.body,
          chatId: t.payload && t.payload.chatId
        });
      }
      tasks.sort((a, b) => (a.deliverAt || 0) - (b.deliverAt || 0));
      return json({ ok: true, now, nowLocal: new Date(now).toISOString(), count: tasks.length, tasks });
    }
    if (request.method !== "POST")
      return json({ error: "method_not_allowed" }, 405);
    if (!authorized(request, env))
      return json({ error: "unauthorized" }, 401);
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "bad_json" }, 400);
    }
    if (path === "/add-task") {
      const { taskId, deliverAt, subscription, payload, groupId } = body || {};
      if (!taskId || !subscription || !payload)
        return json({ error: "missing_fields" }, 400);
      if (url.searchParams.get("now") === "1") {
        const result = await sendOne(env, { taskId, subscription, payload });
        return json({ ok: result.ok, immediate: true, status: result.status, error: result.error });
      }
      if (!deliverAt)
        return json({ error: "missing_deliverAt" }, 400);
      const task = { taskId, deliverAt, subscription, payload, groupId: groupId || null };
      const ttl = Math.max(60, Math.floor((deliverAt - Date.now()) / 1e3) + 86400);
      await env.PUSH_TASKS.put("task:" + taskId, JSON.stringify(task), { expirationTtl: ttl });
      return json({ ok: true, taskId });
    }
    if (path === "/cancel") {
      const ids = Array.isArray(body.taskIds) ? body.taskIds : [];
      for (const id of ids)
        await env.PUSH_TASKS.delete("task:" + id);
      let groupN = 0;
      if (body.groupId)
        groupN = await cancelGroup(env, body.groupId);
      return json({ ok: true, cancelled: ids.length + groupN });
    }
    if (path === "/cancel-all") {
      const n = await purgeEndpoint(env, body.endpoint || null);
      return json({ ok: true, cancelled: n });
    }
    if (path === "/cancel-chat") {
      const chatId = body.chatId || null;
      const endpoint = body.endpoint || null;
      const kind = body.kind || null;
      if (!chatId)
        return json({ error: "missing_chatId" }, 400);
      const n = await cancelByChat(env, chatId, endpoint, kind);
      return json({ ok: true, cancelled: n });
    }
    return json({ error: "not_found" }, 404);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(deliverDue(env));
  }
};
async function deliverDue(env) {
  const now = Date.now();
  const list = await env.PUSH_TASKS.list({ prefix: "task:" });
  console.log(`[cron] \u626B\u63CF ${list.keys.length} \u4E2A\u4EFB\u52A1 @ ${new Date(now).toISOString()}`);
  for (const k of list.keys) {
    const raw = await env.PUSH_TASKS.get(k.name);
    if (!raw)
      continue;
    let t;
    try {
      t = JSON.parse(raw);
    } catch {
      await env.PUSH_TASKS.delete(k.name);
      continue;
    }
    if (!t.deliverAt || t.deliverAt > now)
      continue;
    await sendOne(env, t);
    await env.PUSH_TASKS.delete(k.name);
    if (t.groupId)
      await cancelGroup(env, t.groupId, t.taskId);
  }
}
async function sendOne(env, task) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    console.log("[push] \u274C \u672A\u8BBE\u7F6E VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY");
    return { ok: false, status: 0, error: "vapid_not_set" };
  }
  const vapid = {
    subject: env.VAPID_SUBJECT || "mailto:admin@example.com",
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY
  };
  const message = {
    data: JSON.stringify(task.payload),
    options: { ttl: 3600 }
  };
  try {
    const req = await buildPushPayload(message, task.subscription, vapid);
    const res = await fetch(task.subscription.endpoint, req);
    console.log(`[push] taskId=${task.taskId} \u2192 FCM \u72B6\u6001 ${res.status}` + (res.status === 403 ? "\uFF08403 = VAPID \u5BC6\u94A5\u4E0D\u5339\u914D\uFF0C\u68C0\u67E5\u4E09\u5904\u516C\u79C1\u94A5\u662F\u5426\u540C\u4E00\u5BF9\uFF09" : res.status === 404 || res.status === 410 ? "\uFF08\u8BA2\u9605\u5931\u6548\uFF0C\u5DF2\u6E05\u7406\uFF09" : res.status === 201 ? "\uFF08\u6210\u529F\uFF09" : ""));
    if (res.status === 404 || res.status === 410) {
      await purgeEndpoint(env, task.subscription.endpoint);
    }
    return { ok: res.status >= 200 && res.status < 300, status: res.status };
  } catch (e) {
    console.log("[push] \u274C \u53D1\u9001\u5F02\u5E38:", e && e.message ? e.message : String(e));
    return { ok: false, status: 0, error: String(e && e.message ? e.message : e) };
  }
}
async function cancelByChat(env, chatId, endpoint, kind) {
  const list = await env.PUSH_TASKS.list({ prefix: "task:" });
  let n = 0;
  for (const k of list.keys) {
    const raw = await env.PUSH_TASKS.get(k.name);
    if (!raw)
      continue;
    let t;
    try {
      t = JSON.parse(raw);
    } catch {
      continue;
    }
    const p = t.payload || {};
    if (p.chatId !== chatId)
      continue;
    if (endpoint && t.subscription && t.subscription.endpoint !== endpoint)
      continue;
    if (kind && p.kind !== kind)
      continue;
    await env.PUSH_TASKS.delete(k.name);
    n++;
  }
  return n;
}
async function cancelGroup(env, groupId, exceptTaskId) {
  const list = await env.PUSH_TASKS.list({ prefix: "task:" });
  let n = 0;
  for (const k of list.keys) {
    const raw = await env.PUSH_TASKS.get(k.name);
    if (!raw)
      continue;
    let t;
    try {
      t = JSON.parse(raw);
    } catch {
      continue;
    }
    if (t.groupId === groupId && t.taskId !== exceptTaskId) {
      await env.PUSH_TASKS.delete(k.name);
      n++;
    }
  }
  return n;
}
async function purgeEndpoint(env, endpoint) {
  const list = await env.PUSH_TASKS.list({ prefix: "task:" });
  let n = 0;
  for (const k of list.keys) {
    const raw = await env.PUSH_TASKS.get(k.name);
    if (!raw)
      continue;
    let t;
    try {
      t = JSON.parse(raw);
    } catch {
      await env.PUSH_TASKS.delete(k.name);
      n++;
      continue;
    }
    if (!endpoint || t.subscription && t.subscription.endpoint === endpoint) {
      await env.PUSH_TASKS.delete(k.name);
      n++;
    }
  }
  return n;
}
export {
  src_default as default
};
