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
