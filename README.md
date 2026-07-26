# SyrogoConsole

SyrogoConsole 是 Syrogo Core/API 的官方独立管理控制台，提供配置、Provider、Client、Route、Usage、Logs、Debug 和配置历史治理。Syrogo 仍支持直接编辑 YAML，但日常管理更推荐使用 Console。

## 官方部署

Console release 包含零额外运行时依赖的 Go Web Server、静态 SPA、systemd unit 和一体化 installer。默认拓扑：

```text
Browser -> 127.0.0.1:23233 (SyrogoConsole)
                /admin/* -> 127.0.0.1:23234 (Syrogo Core)
```

安装最新稳定版：

```bash
curl -fsSL https://raw.githubusercontent.com/ryanycheng/SyrogoConsole/refs/heads/main/scripts/install.sh | sudo bash
```

固定 Core 与 Console 的相同版本：

```bash
curl -fsSL https://raw.githubusercontent.com/ryanycheng/SyrogoConsole/refs/heads/main/scripts/install.sh \
  | sudo bash -s -- --version v0.16.3
```

安装行为：

- 已有健康 Core：复用，不升级、不重启、不修改配置。
- 完全空主机：默认安装同版本 Core，再安装 Console，并输出首次登录使用的 Admin token。
- `--console-only`：只接受已有健康 Core；Core 缺失时失败。
- 残缺或不健康 Core：停止安装，不猜测、不覆盖。
- `--with-core`：明确允许在空主机安装 Core；不会覆盖已有残缺安装。
- `--uninstall`：只删除 Console，不删除 Core。

已有 Core 需要监听 `127.0.0.1:23234`、通过 `/healthz`，并启用你掌握 token 的 Admin API。Console Server 只代理 `/admin/*`；Admin token 由浏览器发送，Server 不保存或注入 token。

本机访问 `http://127.0.0.1:23233`。远程管理推荐：

```bash
ssh -L 23233:127.0.0.1:23233 user@server
```

公网或跨主机长期访问应在 Console 外层配置 TLS 和访问控制，不要直接公开明文管理面。

完整场景与升级流程见 Syrogo 的 `docs/deploy.md` / `docs/deploy.zh-CN.md`。

## 本地开发

要求 Go、Node.js 22 和 npm。

```bash
npm ci
SYROGO_DEV_API_TARGET=http://127.0.0.1:23235 npm run dev -- --host 0.0.0.0
```

开发服务器会将 `/admin` 请求代理到 `SYROGO_DEV_API_TARGET`，未设置时默认使用 `http://127.0.0.1:23235`。

生产服务由 Go Server 同源托管 SPA 和 `/admin` 代理，不需要通过 `VITE_SYROGO_API_BASE` 把浏览器直接连接到 Core。

## 质量检查

```bash
npm run lint
npm run typecheck
npm run test
npm run build
go test ./...
go vet ./...
bash scripts/install_test.sh
```

`.github/workflows/ci.yml` 会在 pull request 和 `main` push 时运行完整检查。

## 发布流程

向仓库推送稳定版 `vX.Y.Z` tag 会触发 `.github/workflows/release.yml`。发布前必须满足：

- tag、`package.json.version` 与 `package-lock.json` 根版本完全一致。
- 同版本 Syrogo Core GitHub Release 已存在。
- lint、typecheck、前端测试/构建、Go test/vet 和 installer 契约测试全部通过。

工作流为 Linux amd64/arm64 构建 Go Server 和 SPA 套件，附加 installer、release metadata 与 SHA-256 checksums，并在已有 tag 上创建 GitHub Release。`workflow_dispatch` 仅用于 dry-run，不发布 Release，也不要求同版本 Core Release 已存在。

每个发布包包含 `syrogo-console-release.json`：

```json
{
  "console_version": "0.16.3",
  "core_version": "0.16.3",
  "syrogo_version_range": ">=0.16.0 <0.17.0",
  "git_commit": "...",
  "built_at": "2026-07-27T00:00:00.000Z"
}
```

Core 与 Console 联合发布默认使用相同 SemVer；兼容范围按 Core minor 版本声明。

## Clients 与 usage 语义

Console 遵循 Core Admin API 的以下契约：

- Client `name` 是稳定的 quota/accounting identity；轮换 token 时保持 name 不变。已有 Client 的 token 留空或填 `<redacted>` 表示保留，CRUD 会原子保存并热应用。
- Client quota 每个 window 只能使用一个 `type`（`requests`、`tokens`、`cost`）及对应 limit。Requests 在入口准入时计数；Tokens/Cost 仅在成功 terminal response 后计入，因此并发成功可能 overshoot，下一次请求才返回 429。Cost 来自 Core pricing 而非 Provider 账单；unpriced model 按 `$0` 并显示 warning。Provider quota 不支持 Cost。
- 变更或删除 binding 不能让 `routing.rules[].from_tags` 引用的 tag 失去最后一个 Client 来源。应先提供替代 binding，或修改全部相关 route。
- Clients 列表的 **Usage** 是 all-time，**Frequency** 是所选最近 7/30/90 个 UTC 自然日；metrics 请求失败不应阻断 CRUD。
- Client detail 使用 UTC 前闭后开范围。当前 UTC 日是 `partial`，旧数据 coverage 不可确认时是 `unknown`，不能显示为确定的零值。
- 原始记录按 `retention_days` 保留，每日聚合按独立的 `snapshot_retention_days` 保留；“Daily records”是每日聚合，不是逐请求审计日志。
