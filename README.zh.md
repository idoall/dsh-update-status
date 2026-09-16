<h1 align="center">DSH Update Status</h1>

<p align="center">DeepSeek Harness Web 侧栏中的只读版本状态 Badge 与发布通道指南。</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-update-status"><img src="https://img.shields.io/npm/v/dsh-update-status?label=npm&color=CB3837" alt="npm 版本"></a>
  <a href="https://github.com/idoall/dsh-update-status/actions/workflows/ci.yml"><img src="https://github.com/idoall/dsh-update-status/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0F172A" alt="MIT"></a>
</p>

<p align="center"><a href="README.md">English</a> | 中文</p>

<p align="center">
  <a href="#功能">功能</a> ·
  <a href="#安装">安装</a> ·
  <a href="#使用">使用</a> ·
  <a href="#安全边界">安全边界</a> ·
  <a href="#卸载">卸载</a> ·
  <a href="docs/RELEASING.md">发布指南</a>
</p>

> DSH Update Status 是 DeepSeek Harness 社区插件。它不修改 DSH 核心，也绝不会安装、重启、回滚、下载或替换 DSH 文件。

插件只把展开侧栏中的品牌名称换成适配 24px 品牌行的 `DeepSeek + 版本芯片`，官方鱼标保持不变。点击芯片可查看 npm 发布通道、兼容性状态，以及与所选通道对应的“仅复制”命令。

<p align="center">
  <img src="./assets/update-panel.png" width="500" alt="DSH Update Status 面板：当前稳定版、alpha 预览版、兼容性标签和仅复制的升级命令">
</p>

## 功能

- **侧栏版本状态**：展开侧栏显示当前 DSH 版本，收起轨道提供状态入口。
- **稳定版与预览版发现**：一次 registry 请求读取 npm dist-tags `latest`、`next`、`alpha`，默认选择 `latest`。
- **只展示有意义的选择**：非当前候选与运行版本相同时隐藏；多个通道指向同一版本时优先保留 `latest`。
- **弹窗内直接选择通道**：可直接选择有价值的稳定版、候选版或预览版；偏好由 DSH Host 持久化。
- **兼容性标识**：明确验证过的版本显示“已验证兼容”；未知预览版显示“尚未验证兼容”，不冒充安全升级。
- **仅复制命令**：根据安装来源和通道生成 `@latest`、`@next` 或 `@alpha` 命令，但从不执行。
- **缓存但不轮询**：Host 挂载时检查一次，缓存可设为 30–1,440 分钟并合并并发请求；前端没有轮询，只有“检查更新”按钮绕过缓存。
- **移动端可靠**：详情使用浏览器 modal top layer；底部 sheet 可滚动、适配 safe area，并保持在 DSH 抽屉上方。

## 安装

要求：

- 带 Web profile 的 DeepSeek Harness
- Node.js 20 或更新版本
- 已验证的 DSH 版本：`0.1.6-alpha.1`（同时验证了 `0.1.5-rc.1`）

已经安装 `dsh` 命令：

```sh
dsh plugin --profile web add dsh-update-status@latest
```

直接使用 DeepSeek Harness 源码：

```sh
corepack enable
pnpm install
pnpm dsh plugin --profile web add dsh-update-status@latest
```

安装后重启原有 DSH 进程，再刷新 Web GUI。不要为本插件启动第二个 Web server。

本地开发 link：

```sh
pnpm install --frozen-lockfile
pnpm run build
dsh plugin --profile web add "link:$(pwd)"
```

## 使用

1. 打开 DSH 左侧抽屉。官方鱼标仍在；名称行显示 `DeepSeek + 当前版本 Badge`。
2. 点击 Badge。面板打开时不会触发外层“新建会话”按钮。
3. 查看有意义的通道。如果 `next` 与当前运行版/稳定版相同，它会被主动隐藏。
4. 想体验预览版时，在面板中选择 `alpha`。未验证兼容的版本仍会明确警告。
5. 复制生成的命令，在**运行 DSH 的那台电脑**的终端中自行执行。
6. 包管理器命令完成后，由你自行重启 DSH。

全局安装时可能生成：

```sh
npm install -g @deepseek-ai/dsh@latest
npm install -g @deepseek-ai/dsh@next
npm install -g @deepseek-ai/dsh@alpha
```

插件只显示与检测到的安装方式和所选通道匹配的一条命令，不会运行这些命令。

## 发布通道

| 通道 | 用途 | 兼容性处理 |
| --- | --- | --- |
| `latest` | DSH npm 包推荐的默认稳定/候选版本 | 只有本插件明确声明过才显示已验证 |
| `next` | 与当前运行版/稳定版确实不同时的候选版本 | 可能尚未验证 |
| `alpha` | 用户主动选择的早期预览版 | 除非明确声明，否则显示尚未验证 |

插件严格遵循 npm dist-tag，不会从 registry 历史版本中自行挑选 SemVer 最大值。

## 局域网（非回环页面）访问

DSH 对来源不是 loopback（`localhost` / `127.0.0.1`）的页面会关闭 Host 设置持久化（官方 `dsh-client-ui-settings` README 原文：*Non-loopback pages get no durable settings*）：`settingsScope` 直接返回 `unavailable`，并且从此不发 `settings.describe`；整页的 `connection.isLoopback` 也都是 false。

从 `0.1.2` 起，本插件在局域网页面同样可用：

- **版本/更新状态**照常读取。早先的版本把整个功能压在 `connection.isLoopback === true` 上，于是经局域网转发（`dsh-bridge`、`dsh-lan-proxy` 等）打开的页面从不发送 `POST /api/dsh-update-status.get-status`、详情面板打不开，还会把本包声明的兼容版本当成"当前运行版本"显示。该判断已移除——Connection RPC 本身是已认证的，Host 路由也是本插件自己的路由。
- **偏好设置**（`sidebarEnabled`、`channel`、`cacheTtlMinutes`）继续读写 Host 上共享的那一份 `dsh-update-status` 命名空间，走的是与官方 settings Client 相同的公开 Remote（`settings.describe` / `settings.mutate`）。写入仍受 revision 栅栏保护，被拒时明确提示冲突而不会静默覆盖。直连通道只在官方 scope 报 `unavailable` 时才打开，所以回环页面仍走官方路径，不会多发一次线上读取。

若你希望保持 DSH 官方策略（非回环页面完全不落地设置），可以让转发侧声明宿主身份：在返回的 HTML 中、`__DSH_BOOT__` 之前注入 `window.__DSH_TRANSPORT__ = { fetch: (input, init) => window.fetch(input, init), ownsHost: true }`。DSH 的 `ctx.connection.isLoopback` 会据此为真，所有依赖设置的界面（含官方「设置」页）一并恢复；`dsh-mobile` 网关正是这么做的。

## 兼容性

当前发布：插件 **`0.1.3`** 已针对 DeepSeek Harness **`0.1.6-alpha.1`** 验证。

| 插件版本 | 已验证的 DeepSeek Harness |
| --- | --- |
| `0.1.0` | `0.1.2-rc.1` |
| `0.1.1` | `0.1.5-rc.1` |
| `0.1.2` | `0.1.5-rc.1` |
| `0.1.3` | `0.1.5-rc.1`、`0.1.6-alpha.1` |

DSH `0.1.6-alpha.1`（或 `0.1.5-rc.1`）请使用 `0.1.3`。仍在 DSH `0.1.2-rc.1` 上时继续使用 `0.1.0`。更高 DSH 版本不会被自动宣称为兼容，需要人工验证。不兼容时请禁用或卸载插件，不要修改 DSH 核心。

## 配置

| 选项 | 默认值 | 范围 / 行为 |
| --- | --- | --- |
| `cacheTtlMinutes` | `360` | 30–1,440 分钟；仅在下一次按需读取时判断是否到期，绝不启动后台定时器 |
| `channel` | `latest` | `latest`、`next` 或 `alpha` |
| `sidebarEnabled` | `true` | 只隐藏本插件自己的侧栏入口 |

**设置 → 版本与更新** 可隐藏本插件侧栏入口和选择发布通道；详情面板中也能直接切换通道和填写缓存时长。修改缓存时长不会请求网络；只在之后普通读取且缓存已到期时更新，“检查更新”始终是立即手动检查。

## 安全边界

- registry 访问只允许 HTTPS `registry.npmjs.org`，并拒绝重定向。
- Host 只通过 DSH 已认证的 Connection RPC 返回普通 JSON。
- 不注册公共 Remote Service，也不注册模型 Tool。
- 插件代码不会启动 npm/pnpm 子进程。
- `canApplyInPlace` 恒为 `false`。
- 没有“立即更新”、自动安装、重启、回滚或 release 文件替换。
- 刷新失败时保留最后一次成功缓存并显示警告；冷启动失败也会保留本地版本信息。

## 卸载

```sh
dsh plugin --profile web remove dsh-update-status
```

重启 DSH 并刷新 Web GUI。如需清除偏好，可在卸载后从 `~/.dsh/settings.yaml` 删除 `dsh-update-status` 命名空间。

## 开发

```sh
pnpm install --frozen-lockfile
pnpm run test
pnpm run build
pnpm pack --dry-run
```

发布 tag 使用 npm Trusted Publishing 与 GitHub OIDC。请按 [docs/RELEASING.md](docs/RELEASING.md) 在 npm 网站一次性绑定 Trusted Publisher，随后推送匹配的 `vX.Y.Z` tag；仓库不保存长期 npm token。

MIT，详见 [LICENSE](LICENSE)。
