# SyrogoConsole

SyrogoConsole 是 Syrogo Core/API 的独立 React 管理控制台，基于 React、TypeScript、Vite、Arco Design 和 TanStack Query 构建。

## 本地开发

要求 Node.js 22 和 npm。

```bash
npm ci
SYROGO_DEV_API_TARGET=http://127.0.0.1:23235 npm run dev -- --host 0.0.0.0
```

开发服务器会将 `/admin` 请求代理到 `SYROGO_DEV_API_TARGET`，未设置时默认使用 `http://127.0.0.1:23235`。

生产构建可通过 `VITE_SYROGO_API_BASE` 指定 Syrogo API 地址；留空时使用与 Console 页面相同的 origin：

```bash
VITE_SYROGO_API_BASE=https://syrogo.example.com npm run build
```

## 质量检查

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

`.github/workflows/ci.yml` 会在 pull request 和 `main` push 时运行以上检查，并将 `dist/` 作为保留 7 天的 Actions artifact 上传。它不会创建 tag 或 GitHub Release。

## 发布流程

发布工作流 `.github/workflows/release.yml` 只能通过 GitHub Actions 的 `workflow_dispatch` 手动运行，需要填写：

- `version`：与 `package.json.version` 完全一致的 Console SemVer，不带 `v` 前缀。
- `syrogo_version_range`：该 Console 版本支持的 Syrogo Core SemVer 范围，例如 `>=0.15.0 <0.16.0`。
- `dry_run`：默认 `true`，只构建并上传 Actions artifact。
- `publish_confirmation`：关闭 dry-run 后必须输入 `PUBLISH SYROGO CONSOLE`。

在 `dry_run=true` 时，工作流只会执行完整检查、生成发布包和 checksum，不会创建 tag 或 Release。正式发布还要求从 `main` 运行、目标 tag 不存在，并通过 GitHub `release` environment；建议在仓库设置中为该 environment 配置 required reviewer。

正式发布前应先通过普通 pull request 更新 `package.json` 和 `package-lock.json` 中的版本。发布工作流不会临时修改仓库源码。

## Syrogo 兼容范围

每个发布包包含 `syrogo-console-release.json`：

```json
{
  "console_version": "0.1.0",
  "syrogo_version_range": ">=0.15.0 <0.16.0",
  "git_commit": "...",
  "built_at": "2026-07-23T10:00:00.000Z"
}
```

`syrogo_version_range` 使用标准 npm SemVer range。Syrogo 仍处于 `0.x` 阶段时，建议默认把 Core minor 版本作为兼容边界，但每次发布都必须根据实际 API 依赖显式填写范围。

当前兼容声明属于发布元数据，Console 尚不会在运行时阻止连接不兼容的 Core。若未来需要页面告警或阻断，应先为 Syrogo Admin API 增加可靠的版本端点。

## Clients 与 usage 语义

Console 遵循 Core Admin API 的以下契约：

- Client `name` 是稳定的 quota/accounting identity；轮换 token 时保持 name 不变。已有 Client 的 token 留空或填 `<redacted>` 表示保留，CRUD 会原子保存并热应用。
- Client quota 会完整 round-trip。每个 window 只能使用一个 `type`（`requests`、`tokens`、`cost`）及对应 limit；canonical 示例：

  ```yaml
  quota:
    enabled: true
    windows:
      - {name: hourly-requests, type: requests, duration: 1h, max_requests: 1000}
      - {name: daily-tokens, type: tokens, duration: 24h, max_tokens: 1000000}
      - {name: monthly-cost, type: cost, duration: 720h, max_cost_usd: 25}
  ```

  旧 window 省略 `type` 但包含 `max_requests` 时按 `requests` 兼容。Requests 在入口准入时计数；Tokens/Cost 仅在成功 terminal response 后计入，因此并发成功可能 overshoot，下一次请求才返回 429。Cost 来自 Core pricing 而非 Provider 账单；unpriced model 按 `$0` 并显示 warning。Provider quota 不支持 Cost。
- 变更或删除 binding 不能让 `routing.rules[].from_tags` 引用的 tag 失去最后一个 Client 来源。结构化错误会列出 route；解除方式有两种：先新增/更新另一条 binding 提供同一 tag，或从全部列出的 route `from_tags` 删除/修改该 tag，然后重试。
- Clients 列表的 **Usage** 是 all-time，**Frequency** 是所选最近 7/30/90 个 UTC 自然日；metrics 请求失败不应阻断 CRUD。
- Client detail 使用 UTC 前闭后开范围。当前 UTC 日是 `partial`，旧数据 coverage 不可确认时是 `unknown`，不能显示为确定的零值。
- 原始记录按 `retention_days` 保留，每日聚合按独立的 `snapshot_retention_days` 保留；“Daily records”是每日聚合，不是逐请求审计日志。
