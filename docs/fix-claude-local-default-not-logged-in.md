# Fix: 本地默认 Claude CLI 助手报 "Not logged in · Please run /login"

## 背景

创建助手时，选择「模型供应商 = 不绑定，使用本地 Agent 配置」+「Claude 模型 = 使用本地默认模型」时，执行报错：

```
claude 执行出错: Claude Code returned an error result: Not logged in · Please run /login
```

宿主机的 Claude Code CLI 已正常登录，能在命令行直接使用，但 TeamAgentX 内的助手始终拿不到鉴权。

## 现象与排查

### 1. 助手类型与配置

- `Agent.type = 'acp'`，`acpTool = 'claude'`，`llmProviderId = null`（即「不绑定供应商」）
- 由 [`server/src/core/agent/executor.factory.ts`](../server/src/core/agent/executor.factory.ts) 路由到 `ClaudeAgentSdkExecutor`
- 因为 `llmProvider` 为空，[`buildEnv`](../server/src/core/agent/claude-sdk.executor.ts) 走「无供应商」分支：
  - 把进程内所有 `ANTHROPIC_*` env 清空
  - 设置 `CLAUDE_CONFIG_DIR = ~/.teamagentx/acp-config/<agentId>`
  - 调用 `syncGlobalClaudeLocalConfig(claudeConfigDir)` 把宿主 Claude 配置镜像过来

### 2. 第一层根因（stale token）

抽查 per-agent 配置目录：

```
~/.teamagentx/acp-config/<agentId>/settings.json
```

里面 `env` 里残留着 **过去某次同步进来的第三方 ACP 代理凭证**（腾讯 lkeap 端点 + 第三方 token）。但宿主 `~/.claude/settings.json` 已被用户改成 `env: {}`（切回了 OAuth 订阅）。

定位到 [`claude-local-config.ts`](../server/src/core/agent/claude-local-config.ts) 的 `syncGlobalClaudeSettingsToConfigDir`：

```ts
const globalSettings = readJsonFile(sourcePath);
if (!hasClaudeAuthEnv(globalSettings)) {
  return { copied: false, ..., reason: 'source_without_auth_env' };
}
```

宿主 env 为空时直接 return，**不会更新 per-agent settings.json**。结果：

- 全局 env 为空 → 同步跳过 → per-agent 保留旧的 ANTHROPIC_AUTH_TOKEN + ANTHROPIC_BASE_URL
- Claude CLI 启动后从 `CLAUDE_CONFIG_DIR/settings.json` 读出陈旧 token + 腾讯 URL，调过去失败

### 3. 第二层根因（真正的 root cause）：缺 credentials.json 同步

清完 stale env 后仍然报错。继续核实 OAuth token 的实际存储位置：

- 检查 `~/.claude.json.oauthAccount` 的字段：**只有账户元数据**（accountUuid、organizationUuid、emailAddress、订阅类型等），**没有 accessToken / refreshToken**
- 检查 Windows 凭据管理器 (`cmdkey /list`)：**没有任何 Claude 条目**
- 最终定位：**OAuth 真正的 token 在 `~/.claude/.credentials.json`**（一个独立的文件），内容形如：
  ```json
  {
    "claudeAiOauth": {
      "accessToken": "sk-ant-oat01-...",
      "refreshToken": "sk-ant-ort01-...",
      "expiresAt": ...,
      "scopes": ["user:inference"]
    }
  }
  ```

`syncGlobalClaudeLocalConfig` 只同步了 `settings.json` 和 `~/.claude.json`，**完全没有同步 `.credentials.json`**。所以 per-agent 的 `CLAUDE_CONFIG_DIR` 里永远没有 OAuth token，Claude CLI 自然报 "Not logged in"。

> Windows 上 Claude Code 没有用系统 keychain，token 就是文件。macOS 上文件存在 + Keychain 镜像。Linux 走 libsecret 但同样有文件 fallback。所以**同步这个文件**就能覆盖三个平台。

## 修复思路

让宿主 `~/.claude/` 成为「使用本地默认模型」模式下的 **唯一 source of truth**，三类文件全部镜像到 per-agent 的 `CLAUDE_CONFIG_DIR`：

| 宿主文件 | per-agent 目标 | 内容 | 修复前 | 修复后 |
|---|---|---|---|---|
| `~/.claude/settings.json` | `<configDir>/settings.json` | env、hooks、model、plugins | ❌ 源头无 auth 就跳过，stale 残留 | ✅ 始终同步，强制清掉 auth 类 env |
| `~/.claude.json` | `<configDir>/.claude.json` | userID、oauthAccount 元数据、安装信息 | ✅ 已同步 | ✅ 保留 |
| `~/.claude/.credentials.json` | `<configDir>/.credentials.json` | accessToken、refreshToken | ❌ **完全没同步** | ✅ **新增同步** |

核心原则：

1. **全局是 auth 类 env 的权威**——全局有就推，全局没有就强制清掉 per-agent 残留（不再允许 stale token 把 OAuth 顶掉）
2. **同步用「内容比对」而不是「mtime 比对」**——避免因 mtime 抖动反复写，也避免「源头没 auth env 就跳过」的漏洞
3. **token refresh 自动跟进**——宿主刷 token 后内容变化，下次同步检测到 `content_changed` 自动更新

## 改动清单

### 1. `server/src/core/agent/claude-local-config.ts`

- **扩展 `CLAUDE_GLOBAL_AUTH_ENV_KEYS`**：从 3 个扩到 11 个，与 `claude-sdk.executor.ts` 的 `buildEnv` 清除清单对齐
  ```ts
  const CLAUDE_GLOBAL_AUTH_ENV_KEYS = [
    'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_CUSTOM_HEADERS',
    'ANTHROPIC_BASE_URL', 'ANTHROPIC_API_URL',
    'ANTHROPIC_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_REASONING_MODEL',
  ] as const;
  ```

- **重写 `mergeClaudeSettings`**：合并 env 时先把 per-agent 里这 11 个 auth key 全部删掉，再叠加全局 env。非 auth 的自定义 env（如 `MY_CUSTOM_VAR`）保留不动。

- **重写 `syncGlobalClaudeSettingsToConfigDir`**：
  - 删除 `hasClaudeAuthEnv` 判断（源头无 auth 也照样同步）
  - 删除 mtime 比较，改成「算 mergedContent → 与目标现有内容字符串比对 → 不同则写」
  - `reason` 简化为 `source_missing / target_current / target_missing / content_changed`
  - `chmodSync` 裹 try/catch（Windows 兼容）

- **新增 `getGlobalClaudeCredentialsPath()`**：返回 `~/.claude/.credentials.json`

- **新增 `syncGlobalClaudeCredentialsToConfigDir(configDir)`**：
  - 源文件存在 → 读原始字节
  - 与目标已有内容比对，不同则写
  - 透传整个 JSON（不挑字段，因为 token 字段名可能随 Claude Code 版本变化）
  - 同样裹 chmod try/catch

- **`syncGlobalClaudeLocalConfig` 返回类型扩展**：从 `{ settings, state }` 变成 `{ settings, state, credentials }`

### 2. `server/src/core/agent/claude-sdk.executor.ts`

`buildEnv()` 中调用 sync 后的日志记录：

```ts
if (syncResult.settings.copied || syncResult.state.copied || syncResult.credentials.copied) {
  logClaudeSdkDebug('synced global Claude settings', {
    ...,
    credentials: {
      // 只记录路径，不记录 token 内容
      sourcePath: syncResult.credentials.sourcePath,
      targetPath: syncResult.credentials.targetPath,
      copied: syncResult.credentials.copied,
      reason: syncResult.credentials.reason,
    },
  });
}
```

### 3. `server/src/__tests__/core/agent/claude-local-config.test.ts`

#### setup 修复

- 同时设置 `process.env.HOME` 和 `process.env.USERPROFILE`（`os.homedir()` 在 Windows 走 `USERPROFILE`）
- 之前的测试在 Windows 上其实是失败的，只是 CI 没在 Windows 上跑没人发现

#### 测试调整 / 新增

- 改写「源头无 auth env 时跳过」 → 「源头无 auth env 时仍然同步且写一份干净的 settings」
- **新增** `strips stale auth env from per-agent settings when global env clears them` — 回归 OAuth ↔ API Key 切换场景
- **新增** `returns target_current when nothing changes between syncs` — 验证内容比对避免噪音 I/O
- **新增** `syncs ~/.claude/.credentials.json (OAuth tokens) into the isolated config dir` — credentials 首次同步
- **新增** `credentials sync returns source_missing when host has never logged in` — 宿主未登录的兜底
- **新增** `credentials sync updates target when host tokens refresh` — token refresh 跟进

测试结果：9/9 通过，`tsc --noEmit` 通过。

## 不影响的范围

- **自定义供应商模式**（`llmProviderId` 不为 null）：依旧走 `buildAcpProviderEnv`，完全绕过本次修改的同步逻辑
- **指定 Claude 模型**（如 `claude-sonnet-4-6`）：依旧通过 `query({ model })` 参数传入，覆盖宿主默认
- **`workDir`、session 隔离、skills symlink**：均未改动

## 多平台行为

| 平台 | `~/.claude/.credentials.json` 是否存在 | 修复后能否拿到 OAuth |
|---|---|---|
| Windows | ✅ 存在（凭据管理器没有 Claude 条目） | ✅ |
| macOS | ✅ 存在（Keychain 中也有镜像） | ✅ |
| Linux | ✅ 存在（libsecret 是补充而非唯一来源） | ✅ |

## 升级路径

1. 拉取新代码
2. **重启 server**（务必，热加载在 `pnpm start` 模式下不生效）
3. 触发任意「使用本地默认 Claude CLI」的助手回复
4. 既有的 per-agent 目录会自动被新逻辑修正（content_changed → 覆盖）

不需要手动 `rm -rf ~/.teamagentx/acp-config`，但清掉也不会有副作用。

## 验证方法

执行后检查目标目录：

```powershell
# Windows
$dir = "$env:USERPROFILE\.teamagentx\acp-config\<agentId>"
Test-Path "$dir\.credentials.json"           # 应为 True
(Get-Content "$dir\settings.json" | ConvertFrom-Json).env  # 应没有任何 ANTHROPIC_* 残留
```

```bash
# macOS / Linux
ls -la ~/.teamagentx/acp-config/<agentId>/
# 应包含 .claude.json + .credentials.json + settings.json
```

**安全提醒**：`.credentials.json` 内含明文 OAuth token，不要随意分享 / 提 issue 时贴内容。

## 相关文件

- [server/src/core/agent/claude-local-config.ts](../server/src/core/agent/claude-local-config.ts)
- [server/src/core/agent/claude-sdk.executor.ts](../server/src/core/agent/claude-sdk.executor.ts) (仅日志记录处)
- [server/src/__tests__/core/agent/claude-local-config.test.ts](../server/src/__tests__/core/agent/claude-local-config.test.ts)
