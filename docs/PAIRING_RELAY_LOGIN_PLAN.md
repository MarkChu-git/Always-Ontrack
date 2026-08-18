# Pairing Relay 云端免凭证登录（E2E 加密配对 + bookmarklet 抓取）

## 目标

在无显示器的云端/SSH/CI 环境里，`ontrack login` 打印一个短链接；用户在**自己的浏览器**里走原生 Monash SSO 页面登录（密码/MFA 全程不离开本机、不经过云端实例运营者），登录落地后**点一下书签栏上的配对按钮**（首次使用拖拽一次），token 经 E2E 加密由盲中继传回云端 CLI。token 全程不经过终端、history、聊天窗口，中继只见密文。

移动端书签按钮不可用，退回"把落地 URL 粘进配对页"的备用路径（同一加密与投递通道）。

## 协议设计（单方案）

**角色**：CLI（云端）、配对页（静态页，用户浏览器）、bookmarklet（在 OnTrack 源内执行）、中继（Cloudflare Worker，盲信箱）。

1. CLI 生成 P-256 临时密钥对（ECDH）+ 80-bit 随机配对码 `code`（base32、去歧义字符、16 字符，显示为 `XXXX-XXXX-XXXX-XXXX`）。
   > 实现记录：初稿写 128-bit；落地时定为 80-bit——一次性、5 分钟 TTL、盲中继只存密文的场景下 80-bit 已足够，16 字符的配对码也更适合人工核对。
2. `mailboxId = SHA-256(code)`（hex）。中继只见 mailboxId，永远见不到 code 本身。
3. CLI 打印：`https://pair.<domain>/#c=<code>&k=<base64url(spki pubkey)>` —— code 和公钥都在 URL **fragment** 里，HTTP 请求不会携带，中继/日志/CDN 均不可见。
4. CLI 每 2s 轮询 `GET <relay>/m/<mailboxId>`，默认超时 5 分钟，显示倒计时。
5. 配对页（纯静态 JS）从 `location.hash` 读出 code + CLI 公钥，**动态生成一个内嵌该会话 code + CLI 公钥的 bookmarklet**（`javascript:` 链接，~1-2KB minified WebCrypto 代码），引导用户：
   - 首次：把按钮拖进书签栏（一次性）。
   - 每次登录：点"打开 OnTrack 登录"→ 在原生 SSO 页面完成登录 → 落地 OnTrack 后点书签栏按钮。
6. bookmarklet 在 OnTrack 源内执行：依次尝试从 URL query（`sign_in?authToken=...&username=...`）、localStorage（`doubtfire_credentials_token` / `doubtfire_user`）提取凭证 → 生成自己的临时 P-256 密钥对，与内嵌的 CLI 公钥做 ECDH → HKDF-SHA256 → AES-256-GCM 加密 JSON `{authToken, username, expiresAt?}` → 投递：
   - 首选 `fetch PUT <relay>/m/<mailboxId>`（中继 CORS 放开）；
   - 若被 OnTrack 页面 CSP `connect-src` 拦截，降级为 `location.href = <pairing-page>#d=<envelope>&m=<mailboxId>` 跳转，配对页检测 `#d=` 后代为 PUT（fragment 不过网络，安全属性不变；`m` 不可缺——仅凭信封无法知道投到哪个信箱）。
   - 页面内提示"已发送，可关闭本标签页"。
7. CLI 轮询拿到密文（中继一次性读取，读后即删）→ 私钥解密 → 走现有 `finalizeCapturedLogin`（`src/lib/login-finalize.ts`）持久化 session 和 refresh cookie。

**移动端/拖拽失败备用路径**：配对页同时保留"粘贴落地 URL"输入框，走第 6 步同一套加密与投递（加密在配对页执行，不在 OnTrack 源内）。

**加密一律用 WebCrypto API**（`globalThis.crypto.subtle`）：浏览器和 Node ≥20 都原生支持，CLI 侧零新依赖，且同一代码路径可在 Node 单测里做完整往返测试，不需要起真浏览器。

**安全属性**：中继只见 mailbox 哈希 + 密文 + IP/时序元数据；配对码一次性、5 分钟过期；AES-GCM 认证错误即丢弃继续等待（垃圾注入只会让 CLI 继续等，不会崩溃或误登录）；bookmarklet 由配对页按会话动态生成，内嵌的是 CLI 公钥，无私密材料泄露面；密码/MFA 全程只在用户自己浏览器的原生 SSO 页面里。

## 改动清单

### A. 本仓库（ontrack-cli）

1. **`src/lib/pair-login.ts`（新建）**
   - `generatePairingSession()`: 密钥对、code、mailboxId、配对 URL 组装。
   - `encryptForCli` / `decryptFromBrowser`: ECIES（ECDH P-256 + HKDF + AES-256-GCM），WebCrypto 实现；`encryptForCli` 导出供测试和配对页参考实现复用。
   - `waitForPairedCredentials(options)`: 轮询循环（interval 2s、timeout 默认 300s、可注入 `fetch` 便于测试）、解密、返回 `CapturedLoginMaterial` 形状（`source: 'pair-relay'`）。
   - `DEFAULT_RELAY_URL` 常量（占位域名，部署后替换；`ONTRACK_RELAY_URL` env 与 `--relay-url` flag 可覆盖，置空即禁用配对）。
   - `CredentialSource` 类型在 `src/lib/types.ts` 增加 `'pair-relay'`。

2. **`src/cli.ts`（修改 `handleLogin`，约 line 1741 起）**
   - 新 flag：`--pair` / `--no-pair`、`--relay-url URL`、`--pair-timeout-sec N`（默认 300，下限 60）。
   - 分支位置：在现有 browser-session 复用 fast-path 之后、guided SSO 之前。当无直接凭证、未指定 `--auto/--sso`、`isHeadlessServerEnvironment()`（`src/lib/utils.ts:573`）为 true 且配对未禁用时，进入配对模式：打印链接与 code，调 `waitForPairedCredentials`，成功后 `finalizeCapturedLogin`。
   - 配对失败/超时/中继不可达：打印警告并回落到现有 `manualRedirectCapture`（粘 URL）路径，行为不劣化。
   - 非 headless 环境行为不变（本次不动本地默认模式）。
   - 更新 `--help` 文案（line 273-312 附近）说明配对模式与相关 flag/env。

3. **测试**
   - `test/pair-login.test.ts`（新建）：crypto 往返（用同一 WebCrypto 实现模拟浏览器侧）、mailboxId 派生、配对 URL 组装、轮询成功/超时/坏密文/中继 404-继续等待 等分支（注入 mock fetch）。
   - 扩展现有 login CLI 测试（`test/` 下 login 相关用例）：headless 环境默认进入配对、`--no-pair` 回落、`--relay-url` 覆盖生效。
   - 运行 `bun run test`（至少跑 login/pair 相关文件）与 `bun run typecheck`。

4. **文档**
   - README 的 login 章节补一段云端配对流程（含 bookmarklet 一次性拖拽说明）。
   - `AGENTS.md`：无需改动（不涉 TUI/构建流程）；如 help 文案约定有变再同步。

### B. 新仓库 `ontrack-pair-relay`（独立仓库，本地脚手架建在 `/Users/mark/ontrack-pair-relay`，即本仓库的**同级目录**——在工作目录之外，执行时需用户确认）

1. **Cloudflare Worker**（`src/worker.ts`，Hono 或原生 fetch handler，保持极简）：
   - `PUT /m/:id`：body ≤ 8KB，写 KV（`expirationTtl: 300`），已存在则 409（防覆盖劫持）。
   - `GET /m/:id`：读出即删（一次性投递），无则 404。
   - id 校验为 64 位 hex；按 IP 的简单限流（KV 计数器，best-effort）。
   - CORS `*`（bookmarklet 从 `ontrack.infotech.monash.edu` 源发 fetch）；不记录 body 日志。
2. **静态配对页**（`public/index.html`，无构建、无依赖）：
   - 从 fragment 读 code+pubkey；三步引导：拖拽 bookmarklet（首次）→ 打开 OnTrack 登录 → 落地后点书签按钮。
   - **bookmarklet 生成器**：把会话 code、CLI 公钥、relay URL 和内联的提取+ECIES+投递代码拼成 `javascript:` href；附带"复制 bookmarklet"备用（拖拽不可用时手动建书签）与"粘贴 URL"移动端备用路径。
   - `#d=` 降级接收端：检测 fragment 中的密文载荷后代为 PUT 并显示结果。
   - 页面内嵌的 crypto 实现与本仓库 `pair-login.ts` 保持算法一致（P-256/HKDF-SHA256/AES-256-GCM 参数写在两边注释里互相对照）。
   - 凭证提取逻辑与本仓库 `extractCredentialsFromUrl` / `extractCredentialsFromStorageEntries`（`src/lib/auto-login.ts`）同源对齐。
3. **部署**：`wrangler.toml`（KV namespace 绑定）、`README.md` 写明 `wrangler deploy` 步骤与自定义域名绑定；部署后把真实域名回填到 CLI 的 `DEFAULT_RELAY_URL`。
4. Worker 冒烟脚本（`scripts/smoke.mjs`）：PUT→GET→再 GET 404、TTL、大小上限、错误 id。

### 明确不做（本次范围外）

- 本机默认改弹可见浏览器（之前讨论的另一项，后续单独做）。
- TUI 配对登录向导（`src/tui/login.tsx`）。
- 远程浏览器投屏（用户密码会经过实例运营者，公共托管场景不可接受，已否决）。
- 给上游 doubtfire 提 device-code/同源配对页 PR（长期最优解，属上游仓库，可日后并行推进；协议不变，只替换抓取环节）。

## 验证

- `bun run test`（pair-login + login 相关）全绿；`bun run typecheck` 通过。
- 手工链路：本地 `wrangler dev` 起中继 → 无头环境模拟（`ONTRACK_HEADLESS=1`）跑 `ontrack login` → 浏览器打开配对链接、拖 bookmarklet、走真实 OnTrack SSO、点按钮 → CLI 提示登录成功且后续命令可用。
- bookmarklet 降级路径：模拟 CSP 拦截 fetch → 跳转 `#d=` 由配对页代为投递成功。
- 故障路径：停掉中继 → CLI 警告并回落到手动粘贴 URL。
