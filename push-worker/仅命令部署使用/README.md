# ouo-push-worker

OuO 的「进阶推送中转站」。它跑在 Cloudflare Workers 上（免费额度足够个人用），
负责把 App 提前算好的定时消息**准点推送**到你的手机，彻底解决安卓杀后台收不到消息的问题。

> 它只是个到点发送器，不碰你的聊天数据、不调用任何 AI、不知道你的业务逻辑。
> 所有内容都是你自己的 App 提前算好后发过来的。

**支持 iOS 吗？** 支持。iOS 16.4 及以上可以收，但**必须先把网页「添加到主屏幕」，再从主屏幕图标打开使用**（这是苹果的硬性规定，普通 Safari 标签页收不到推送）。安卓则没有这个限制。详见文末《关于 iOS》。

---

# 部署方式二选一

- **方式一：网页部署（推荐）** —— 全程在 Cloudflare 网页上点鼠标，**不用装任何软件、不碰命令行**。适合绝大多数人。
- **方式二：命令行部署（进阶）** —— 用 `wrangler` 工具部署，适合熟悉命令行的人。

下面**方式一**是主线，照着做即可。方式二在最后附录。

---

# 方式一：网页部署（推荐，零命令行）

全程只需要一个 **Cloudflare 账号**（免费注册：https://dash.cloudflare.com/sign-up ）。

> 提示：Cloudflare 后台菜单名称偶尔会改版，位置可能和截图/文字略有出入，但功能都在，按「找什么」去找即可。

## 第 1 步：创建“数据库”（KV 命名空间）

Worker 用它临时存放「待发送的定时任务」。

1. 登录 Cloudflare 后台。
2. 左侧菜单找到 **Storage & Databases（存储和数据库）→ KV**。
3. 点 **Create a namespace（创建命名空间）**，名字填 `PUSH_TASKS`，创建。

（创建好放着即可，下一步会把它绑定给 Worker。）

## 第 2 步：创建 Worker 并粘贴代码

1. 左侧菜单 **Workers & Pages（有的版本叫 Compute / Workers）→ Create（创建）→ Create Worker（创建 Worker）**。
2. 给它起个名字，比如 `ouo-push-worker`（这个名字会成为你的网址的一部分），点 **Deploy（部署）**。此时它是个默认的“Hello World”。
3. 部署完点 **Edit code（编辑代码 / Quick edit）**，进入网页代码编辑器。
4. **把编辑器里原有内容全部删掉**，然后打开本项目里的 **`worker.single.js`** 文件，把它的**全部内容**复制粘贴进去。
   > `worker.single.js` 是已经打包好的「单文件版」，专门给网页部署用，自带全部依赖，粘进去就能跑。
5. 点右上角 **Deploy（部署）**。

## 第 3 步：把 KV 绑定给 Worker

1. 进入这个 Worker 的 **Settings（设置）→ Bindings（绑定）**（旧版可能在 Settings → Variables 里的 “KV Namespace Bindings”）。
2. **Add binding（添加绑定）→ 选 KV namespace**。
3. **Variable name（变量名）** 一定要填 `PUSH_TASKS`（大小写不能错，代码里就是这么用的）。
4. **KV namespace** 选第 1 步创建的那个 `PUSH_TASKS`。
5. 保存 / Deploy。

## 第 4 步：设置密钥（VAPID 三件套）

VAPID 是一对公钥 / 私钥，用来向手机证明「推送确实是你发的」。

**先拿到密钥**（二选一）：
- **推荐：在 App 里生成。** 打开 OuO →「消息通知」设置页 →「进阶：自定义推送节点」→ 点「生成 VAPID 密钥对」。App 会显示**公钥**和**私钥**两串字符（公钥 App 自己存好，私钥你复制下来）。
- 备选：如果你会命令行，也可运行 `npx web-push generate-vapid-keys`，格式一致、可互换。

**再填进 Worker**：
1. Worker 的 **Settings（设置）→ Variables and Secrets（变量与密钥）**。
2. 逐条 **Add（添加）** 下面几项（`VAPID_PRIVATE_KEY` 建议选类型 **Secret（加密）**，其余普通文本即可）：

   | 名称（Name） | 值（Value） |
   |---|---|
   | `VAPID_PUBLIC_KEY` | 你的公钥 |
   | `VAPID_PRIVATE_KEY` | 你的私钥 |
   | `VAPID_SUBJECT` | `mailto:你的邮箱`（随便一个能联系到你的邮箱） |

3. **（可选但推荐）** 再加一条 `CLIENT_TOKEN`，值随便设一串密码（如 `my-secret-123`）。设了它，别人即使知道你的 Worker 地址也没法乱发推送。记住这串，等下要填进 App。
4. 保存 / Deploy。

> 改完变量后如果 Worker 没自动重新部署，手动点一次 **Deploy** 让它生效。

## 第 5 步：设置定时触发（Cron）——**别漏这步**

Worker 靠每分钟被叫醒一次去检查「有没有到点该发的任务」。不设这步，任务永远发不出去。

1. Worker 的 **Settings（设置）→ Triggers（触发器）→ Cron Triggers（定时触发器）**。
2. **Add Cron Trigger（添加）**，表达式填：
   ```
   * * * * *
   ```
   （意思是「每分钟」。）保存。

## 第 6 步：确认活了 + 拿到网址

1. 回到 Worker 概览页，能看到它的网址，形如：
   ```
   https://ouo-push-worker.你的名字.workers.dev
   ```
   **把这个网址复制下来。**
2. 用浏览器打开它（或它的 `/health`）。看到 `{"ok":true,...}` 就说明活了。
   - 如果你设了 `CLIENT_TOKEN`，直接访问可能显示 `401 unauthorized`，这是正常的——访问 `网址/health` 看到 `{"ok":true}` 即可。

## 第 7 步：填回 App

打开 OuO →「消息通知」→「进阶：自定义推送节点」，填：

- **Worker 地址**：第 6 步那个 `https://...workers.dev` 网址
- **VAPID 公钥**：在 App 里生成的会自动填好；命令行生成的手动粘贴公钥
- **客户端令牌**：第 4 步设了 `CLIENT_TOKEN` 就填一样的，没设就留空

然后打开开关，点「发送测试任务（1 分钟后）」。
把 App 切到后台（甚至划掉杀掉），等 1 分钟——手机弹出通知，就全部打通了 🎉

---

# 关于 iOS

- iOS **16.4 及以上**支持网页推送，但**必须**：在 **Safari** 里打开 OuO → 点底部「分享」→「添加到主屏幕」→ 之后**从主屏幕那个图标打开**使用。只有这样才能收到推送。
- 从普通 Safari 标签页使用，或用非 Safari 内核的浏览器，都收不到——这是苹果的限制，不是 Worker 的问题。
- Worker 端**不用为 iOS 做任何特殊设置**：它只是往手机浏览器给出的推送地址（endpoint）发送，安卓给的是 Google 的地址、iOS 给的是苹果的地址，Worker 一视同仁。所以只要 App 那边订阅成功了，安卓和 iOS 用的是同一套。

---

# 常见问题

- **打开 Worker 网址显示 401 / unauthorized**：正常，因为带了令牌校验。访问 `网址/health` 看到 `{ok:true}` 即可。
- **测试通知没弹**：
  1. 先确认 App「允许系统通知」已开、手机系统层面也允许了该应用的通知权限；
  2. iOS 必须先「添加到主屏幕」并从主屏幕打开（见上）；
  3. 确认第 5 步的 **Cron 触发器**设好了（漏了它任务发不出去）；
  4. 打开 `网址/list` 看任务有没有进去、`dueInSec` 是否在倒数。
- **状态码 403**：VAPID 公钥/私钥不是同一对。确认 App 公钥、Worker 的 `VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY` 来自同一次生成；改完在 App 里关开关重开以重新订阅。
- **免费额度够吗**：够。个人使用远低于 Cloudflare 免费额度（KV 每天 1000 次写、Workers 每天 10 万次请求）。

---

# 它提供的接口（给 App 调，你不用管）

| 路径 | 作用 |
|---|---|
| `POST /add-task` | 新增一个定时任务 `{taskId, deliverAt, subscription, payload, groupId?}`；`?now=1` 立即发（测试用） |
| `POST /cancel` | 撤销 `{taskIds:[...]}` 或整组 `{groupId}` |
| `POST /cancel-all` | 清空某端点所有任务 `{endpoint}`（回前台时用） |
| `POST /cancel-chat` | 按会话撤销 `{chatId, endpoint?, kind?}` |
| `GET /health` | 健康检查（顺带显示 VAPID 是否配好） |
| `GET /list` | 列出当前待发任务（排查用，浏览器直接打开） |

---

# 附录 · 方式二：命令行部署（进阶，wrangler）

熟悉命令行、或想用 `wrangler tail` 看实时日志的人可以走这条。需要电脑装好 **Node.js**（https://nodejs.org 下载 LTS 版）。

```bash
npm install -g wrangler          # 安装部署工具
wrangler login                   # 登录（浏览器授权）

npm install                      # 在本文件夹里装依赖

wrangler kv namespace create PUSH_TASKS
# 把它打印的 id 填进 wrangler.toml 的 id = "..."

# 设置密钥（每条会让你粘贴对应值）
wrangler secret put VAPID_PUBLIC_KEY
wrangler secret put VAPID_PRIVATE_KEY
wrangler secret put VAPID_SUBJECT
wrangler secret put CLIENT_TOKEN     # 可选

wrangler deploy                  # 部署，打印出 workers.dev 网址
wrangler tail                    # （可选）看实时推送日志
```

`wrangler.toml` 里已配好每分钟的 Cron 触发器，命令行部署无需手动加。

## 改了逻辑后重新生成「单文件版」

网页部署用的 `worker.single.js` 是从 `src/index.js` 打包来的。如果你改了 `src/index.js`，运行：

```bash
npm install      # 首次需要
npm run build    # 重新生成 worker.single.js
```

然后把新的 `worker.single.js` 内容重新粘进 Cloudflare 网页编辑器再 Deploy 即可。
