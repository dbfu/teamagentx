# Fix: Local Default Claude CLI Assistant Reports "Not logged in · Please run /login"

[English](fix-claude-local-default-not-logged-in_EN.md) | [中文](fix-claude-local-default-not-logged-in.md)

## Background

When creating an assistant with "Model Provider = Not bound, use local Agent config" + "Claude Model = Use local default model", the execution fails with:

```
claude 执行出错: Claude Code returned an error result: Not logged in · Please run /login
```

The host machine's Claude Code CLI is properly logged in and works from the command line, but the assistant within TeamAgentX never gets authenticated.

## Symptoms and Investigation

### 1. Assistant Type and Configuration

- `Agent.type = 'acp'`, `acpTool = 'claude'`, `llmProviderId = null` (i.e., "no provider bound")
- Routed to `ClaudeAgentSdkExecutor` by [`server/src/core/agent/executor.factory.ts`](../server/src/core/agent/executor.factory.ts)
- Since `llmProvider` is null, [`buildEnv`](../server/src/core/agent/claude-sdk.executor.ts) takes the "no provider" branch:
  - Clears all `ANTHROPIC_*` env vars from the process
  - Sets `CLAUDE_CONFIG_DIR = ~/.teamagentx/acp-config/<agentId>`
  - Calls `syncGlobalClaudeLocalConfig(claudeConfigDir)` to mirror the host Claude config

### 2. First Root Cause (Stale Token)

Inspecting the per-agent config directory:

```
~/.teamagentx/acp-config/<agentId>/settings.json
```

It contains `env` with **residual third-party ACP proxy credentials from a previous sync** (Tencent lkeap endpoint + third-party token). However, the host's `~/.claude/settings.json` has been changed by the user to `env: {}` (switched back to OAuth subscription).

Located in [`claude-local-config.ts`](../server/src/core/agent/claude-local-config.ts) at `syncGlobalClaudeSettingsToConfigDir`:

```ts
const globalSettings = readJsonFile(sourcePath);
if (!hasClaudeAuthEnv(globalSettings)) {
  return { copied: false, ..., reason: 'source_without_auth_env' };
}
```

When the host env is empty, it returns immediately, **never updating the per-agent settings.json**. Result:

- Global env empty → sync skipped → per-agent retains stale ANTHROPIC_AUTH_TOKEN + ANTHROPIC_BASE_URL
- Claude CLI starts, reads stale token + Tencent URL from `CLAUDE_CONFIG_DIR/settings.json`, calls and fails

### 3. Second Root Cause (True Root Cause): Missing credentials.json Sync

After clearing the stale env, the error persisted. Continued investigating where OAuth tokens are actually stored:

- Checked `~/.claude.json` `oauthAccount` field: **Only account metadata** (accountUuid, organizationUuid, emailAddress, subscription type, etc.), **no accessToken / refreshToken**
- Checked Windows Credential Manager (`cmdkey /list`): **No Claude entries**
- Finally located: **OAuth tokens are in `~/.claude/.credentials.json`** (a separate file), with content like:
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

`syncGlobalClaudeLocalConfig` only synced `settings.json` and `~/.claude.json`, **completely missing `.credentials.json`**. So the per-agent `CLAUDE_CONFIG_DIR` never had OAuth tokens, and Claude CLI naturally reports "Not logged in".

> On Windows, Claude Code doesn't use system keychain; tokens are files. On macOS, files exist + Keychain mirror. On Linux, libsecret is used but file fallback exists. So **syncing this file** covers all three platforms.

## Fix Strategy

Make host `~/.claude/` the **single source of truth** for "use local default model" mode, mirroring all three file types to per-agent `CLAUDE_CONFIG_DIR`:

| Host File | per-agent Target | Content | Before Fix | After Fix |
|---|---|---|---|---|
| `~/.claude/settings.json` | `<configDir>/settings.json` | env, hooks, model, plugins | ❌ Skipped if source has no auth, stale residue | ✅ Always sync, force-clear auth env keys |
| `~/.claude.json` | `<configDir>/.claude.json` | userID, oauthAccount metadata, install info | ✅ Already synced | ✅ Retained |
| `~/.claude/.credentials.json` | `<configDir>/.credentials.json` | accessToken, refreshToken | ❌ **Never synced** | ✅ **New sync added** |

Core principles:

1. **Global is authoritative for auth env keys** — if global has them, push; if not, force-clear per-agent residue (no longer allow stale tokens to override OAuth)
2. **Sync uses "content comparison" not "mtime comparison"** — avoids repeated writes due to mtime jitter, also avoids the "skip if source has no auth env" vulnerability
3. **Token refresh auto-follows** — host refreshes token, content changes, next sync detects `content_changed` and auto-updates

## Changes List

### 1. `server/src/core/agent/claude-local-config.ts`

- **Extended `CLAUDE_GLOBAL_AUTH_ENV_KEYS`**: from 3 to 11 keys, aligned with `claude-sdk.executor.ts` `buildEnv` clear list
  ```ts
  const CLAUDE_GLOBAL_AUTH_ENV_KEYS = [
    'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_CUSTOM_HEADERS',
    'ANTHROPIC_BASE_URL', 'ANTHROPIC_API_URL',
    'ANTHROPIC_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_REASONING_MODEL',
  ] as const;
  ```

- **Rewrote `mergeClaudeSettings`**: When merging env, first delete all 11 auth keys from per-agent, then overlay global env. Non-auth custom env (like `MY_CUSTOM_VAR`) is preserved.

- **Rewrote `syncGlobalClaudeSettingsToConfigDir`**:
  - Removed `hasClaudeAuthEnv` check (sync even if source has no auth)
  - Removed mtime comparison, changed to "compute mergedContent → compare string with existing target → write if different"
  - Simplified `reason` to `source_missing / target_current / target_missing / content_changed`
  - Wrapped `chmodSync` in try/catch (Windows compatibility)

- **Added `getGlobalClaudeCredentialsPath()`**: Returns `~/.claude/.credentials.json`

- **Added `syncGlobalClaudeCredentialsToConfigDir(configDir)`**:
  - Source file exists → read raw bytes
  - Compare with existing target content, write if different
  - Pass through entire JSON (no field picking, since token field names may vary with Claude Code version)
  - Also wrapped chmod in try/catch

- **Extended `syncGlobalClaudeLocalConfig` return type**: from `{ settings, state }` to `{ settings, state, credentials }`

### 2. `server/src/core/agent/claude-sdk.executor.ts`

Logging after sync in `buildEnv()`:

```ts
if (syncResult.settings.copied || syncResult.state.copied || syncResult.credentials.copied) {
  logClaudeSdkDebug('synced global Claude settings', {
    ...,
    credentials: {
      // Only log paths, not token content
      sourcePath: syncResult.credentials.sourcePath,
      targetPath: syncResult.credentials.targetPath,
      copied: syncResult.credentials.copied,
      reason: syncResult.credentials.reason,
    },
  });
}
```

### 3. `server/src/__tests__/core/agent/claude-local-config.test.ts`

#### Setup Fix

- Set both `process.env.HOME` and `process.env.USERPROFILE` (`os.homedir()` uses `USERPROFILE` on Windows)
- Previous tests were actually failing on Windows, but CI didn't run on Windows so no one noticed

#### Test Adjustments / Additions

- Rewrote "skip when source has no auth env" → "still sync and write clean settings when source has no auth env"
- **Added** `strips stale auth env from per-agent settings when global env clears them` — regression test for OAuth ↔ API Key switching scenario
- **Added** `returns target_current when nothing changes between syncs` — verify content comparison avoids noisy I/O
- **Added** `syncs ~/.claude/.credentials.json (OAuth tokens) into the isolated config dir` — credentials first sync
- **Added** `credentials sync returns source_missing when host has never logged in` — fallback for host not logged in
- **Added** `credentials sync updates target when host tokens refresh` — token refresh follow-up

Test results: 9/9 passed, `tsc --noEmit` passed.

## Unaffected Scope

- **Custom provider mode** (`llmProviderId` not null): Still uses `buildAcpProviderEnv`, completely bypasses this fix's sync logic
- **Specified Claude model** (e.g., `claude-sonnet-4-6`): Still passed via `query({ model })` parameter, overriding host default
- **`workDir`, session isolation, skills symlink**: All unchanged

## Multi-Platform Behavior

### SDK Source Verification

From decompiled `@anthropic-ai/claude-agent-sdk` auth reading flow:

```js
let V = options.env?.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR;
let B = V ?? path.join(os.homedir(), ".claude");
z = await fs.readFile(path.join(B, ".credentials.json"), "utf-8");
// macOS Keychain fallback, but gated by !V — if CLAUDE_CONFIG_DIR is set, won't enter
if (!V && !ANTHROPIC_API_KEY && !CLAUDE_CODE_OAUTH_TOKEN)
  z = await F6$() ?? z;
```

`F6$()` internally uses `security find-generic-password -s <service>` to query Keychain, and the service name is appended with a sha256 hash suffix when `CLAUDE_CONFIG_DIR` is set, inconsistent with the service name stored during host login — so even if we manually call Keychain, we can't read the original token.

### Three-Platform Coverage

Our executor **always sets `CLAUDE_CONFIG_DIR`** (per-agent isolation), so SDK path is "read file only, no Keychain lookup".

| Platform | Primary Token Storage After Host Login | What SDK Actually Reads | Fix Coverage |
|---|---|---|---|
| Windows | `~/.claude/.credentials.json` (Credential Manager has no Claude entry) | File | ✅ |
| Linux | `~/.claude/.credentials.json` (libsecret is auxiliary, can be missing) | File | ✅ |
| macOS | `~/.claude/.credentials.json` + Keychain mirror | File (Keychain skipped due to `!CLAUDE_CONFIG_DIR`) | ✅ |

### Known Edge Cases (Extreme Scenarios)

Host **manually** deleted `~/.claude/.credentials.json` but Keychain still has token:

- Host `claude` CLI works (no `CLAUDE_CONFIG_DIR` → Keychain fallback takes effect, auto-rebuilds file)
- TeamAgentX assistant at that sync moment gets `source_missing`, CLI reports "Not logged in"

**Self-healing method**: User executes `claude` once in terminal, CLI triggers Keychain fallback and writes `.credentials.json` back to host, next assistant execution sync will get it.

This state is not the normal state after `claude /login` — `/login` defaults to persisting the file. Normal usage won't encounter this.

## Upgrade Path

1. Pull new code
2. **Restart server** (required, hot reload doesn't work in `pnpm start` mode)
3. Trigger any "use local default Claude CLI" assistant response
4. Existing per-agent directories will be auto-corrected by new logic (content_changed → overwrite)

No need to manually `rm -rf ~/.teamagentx/acp-config`, but clearing it has no side effects.

## Verification Method

After execution, check target directory:

```powershell
# Windows
$dir = "$env:USERPROFILE\.teamagentx\acp-config\<agentId>"
Test-Path "$dir\.credentials.json"           # Should be True
(Get-Content "$dir\settings.json" | ConvertFrom-Json).env  # Should have no ANTHROPIC_* residue
```

```bash
# macOS / Linux
ls -la ~/.teamagentx/acp-config/<agentId>/
# Should contain .claude.json + .credentials.json + settings.json
```

**Security reminder**: `.credentials.json` contains plaintext OAuth tokens. Do not share it or paste contents when filing issues.

## Related Files

- [server/src/core/agent/claude-local-config.ts](../server/src/core/agent/claude-local-config.ts)
- [server/src/core/agent/claude-sdk.executor.ts](../server/src/core/agent/claude-sdk.executor.ts) (logging only)
- [server/src/__tests__/core/agent/claude-local-config.test.ts](../server/src/__tests__/core/agent/claude-local-config.test.ts)