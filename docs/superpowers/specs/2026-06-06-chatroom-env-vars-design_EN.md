# ChatRoom Environment Variables Design

[English](2026-06-06-chatroom-env-vars-design_EN.md) | [中文](2026-06-06-chatroom-env-vars-design.md)

- Date: 2026-06-06
- Status: Reviewed, pending implementation

## 1. Background and Goals

ChatRoom needs to support defining a set of environment variables (`key` / `value` / `description`). When an assistant in the room starts executing:

1. Inject these environment variables into the shell command environment where the assistant execution script runs, enabling subsequent scripts to retrieve values from environment variables;
2. Inject the `key` and `description` of environment variables into the assistant system prompt (**excluding value**), letting the assistant know which variables are available and their purposes, so they can be correctly referenced in scripts.

Typical scenario: Configure `GITHUB_TOKEN`, `DEPLOY_HOST`, etc. in the room, and the assistant retrieves values via `$GITHUB_TOKEN` in `run_shell_command` to call external services.

## 2. Key Decisions (Confirmed with User)

- **Value handling**: Store in plaintext in the database; frontend UI masks by default (`••••`), click "Show" to reveal; do not write to logs.
- **Storage method**: Add a JSON field on `ChatRoom` (`envVars String?`), save as a whole, no separate table.
- **Injection boundary**: Environment variables are **only injected into the shell command execution environment** (`run_shell_command` / `start_background_command` and Codex shell spawn), **not injected into the executor main process env**.
  - Rationale: The only path for scripts to retrieve values is the shell command environment; injecting into the main process env has no additional benefit and may override `ANTHROPIC_*` / `OPENAI_*` auth keys, causing requests to hit wrong endpoints (already handled in `buildEnv()` with `keysToClear`).
- **Reserved key guardrail**: Skip a set of reserved keys during injection to prevent room config from hijacking executor behavior; skipped keys are indicated in the save response to the frontend.

## 3. Data Model

### 3.1 Schema Change

Add to `ChatRoom` model in `server/prisma/schema.prisma`:

```prisma
envVars String? // Room environment variables, JSON array: [{ key, value, description }]
```

Include a Prisma migration (`server/prisma/migrations/`) and run `prisma generate` as needed. Follow project "migration as truth" rules, do not use `db push` / manual `ALTER TABLE` as long-term solutions.

### 3.2 Storage Format

```json
[
  { "key": "GITHUB_TOKEN", "value": "ghp_xxx", "description": "Token for calling GitHub API" },
  { "key": "DEPLOY_HOST", "value": "10.0.0.1", "description": "Deployment target host address" }
]
```

Field semantics:
- `key`: Environment variable name, required.
- `value`: Value, can be empty string.
- `description`: Purpose description, injected into prompt, can be empty.

## 4. Backend Implementation

### 4.1 Parsing and Validation Utilities

Add utility functions (suggested location: `server/src/core/agent/`, e.g., `room-env-vars.ts`):

```ts
interface RoomEnvVar { key: string; value: string; description?: string }

// Parse ChatRoom.envVars (JSON string) into valid array
function parseRoomEnvVars(raw: string | null | undefined): RoomEnvVar[]
```

Parsing rules:
- JSON parse failure → return `[]` (don't throw, to avoid blocking execution).
- `key` must match `^[A-Za-z_][A-Za-z0-9_]*$`, otherwise discard the entry.
- Key deduplication: keep the **first** occurrence, discard subsequent entries with the same name (consistent with UI where upper rows have priority).
- `value` defaults to `''`, `description` defaults to `undefined`.

Reserved key set (skipped during injection, case-insensitive as needed):
- `PATH`, `HOME`, `SHELL`, `PWD`, `USER`, `LOGNAME`, `TMPDIR`
- Prefixes: `ANTHROPIC_`, `OPENAI_`, `ACPX_`, `CLAUDE_`, `CODEX_`, `TEAMAGENTX_`
- `NODE_PATH`, `NODE_OPTIONS`

The utility function also exports:
- `buildShellEnvFromRoomEnvVars(base, roomEnvVars): { env, skippedKeys }` — merge non-reserved keys on top of `base`, return result env and skipped key list (for save API response hints).

### 4.2 Configuration Flow

In `executor-manager.ts`:
- Already has `findById(chatRoomId)` to get `chatRoom`, add `const roomEnvVars = parseRoomEnvVars(chatRoom?.envVars)`.
- Pass new option `roomEnvVars` via `createExecutor`.

In `executor.factory.ts`:
- Add `roomEnvVars?: RoomEnvVar[]` to `CreateExecutorOptions`.
- Pass to `ClaudeAgentSdkExecutor` and `CodexSdkExecutor` constructors (add constructor parameter).

### 4.3 Inject into Shell Command Environment

**Claude** (`claude-sdk.executor.ts`):
- Constructor saves `this.roomEnvVars`.
- In `buildMcpCommandEnv()`, merge `roomEnvVars` on the returned env using `buildShellEnvFromRoomEnvVars`.
- This method is already reused by `run_shell_command` (and `runShellCommandForMcp` actually uses it) and `start_background_command`, so both types of scripts can retrieve values.
  - Note: `runShellCommandForMcp` currently calls `this.buildMcpCommandEnv()` directly, no additional internal changes needed.

**Codex** (`codex-sdk.executor.ts`):
- Constructor saves `this.roomEnvVars`.
- At the shell command spawn env location (where Codex execution shell env comes from), merge `roomEnvVars`, keeping the same reserved key guardrails as Claude.

### 4.4 Inject into System Prompt

In `agent-system-prompt.ts`'s `buildAgentBaseSystemPrompt()`:
- Add `roomEnvVars?: RoomEnvVar[]` to `BuildAgentBaseSystemPromptOptions`.
- Add a new section (same level as `## Group Rules` / `## Working Directory`), **only listing key + description, never including value**:

```
## Environment Variables
The following environment variables are available in your shell command environment. Read their values at runtime via the shell (e.g. `$GITHUB_TOKEN`); never assume or hardcode their values.
- GITHUB_TOKEN: Token for calling GitHub API
- DEPLOY_HOST: Deployment target host address
```

- If no variables or all filtered by reserved keys → don't output this section.
- List uses the same variables after filtering reserved keys, ensuring "keys in prompt" match "keys actually available in shell".
- Where Claude/Codex build system prompts, pass `roomEnvVars` through to `buildAgentBaseSystemPrompt`.

### 4.5 API

`chatroom.gateway.ts`:
- Update body schema (where `PATCH/PUT chatrooms/:id` is handled, same section as rules/workDir) add `envVars: { type: 'string', nullable: true }`.
- Add `envVars?: string | null` to `UpdateChatRoomBody` / `UpdateChatRoomData` types.
- On save, run `parseRoomEnvVars` on `envVars` once before storing (remove illegal keys, unify format), and return `skippedReservedKeys: string[]` in response (list of reserved key hits), for frontend hints.

`chatroom.service.ts`'s `update()` passes through `envVars`.

## 5. Frontend Implementation

### 5.1 API Client

`chatRoomApi.update` is already a generic `updates` pass-through, no signature change needed; caller passes `{ envVars: <json string> }`. If TS type definitions exist, add `envVars?: string | null` synchronously.

### 5.2 UI Component

Add "Environment Variables" section near the "Group Rules" block in `room-settings-panel.tsx`. This file is already large, **extract into independent sub-component** `room-env-vars-editor.tsx` (following single file ≤500 lines rule):

- Props: current `envVars` (parsed array), save callback.
- Each row:
  - `key` input (validate `^[A-Za-z_][A-Za-z0-9_]*$`);
  - `value` input (`type=password`, masked by default, with eye icon to toggle plaintext/mask);
  - `description` input;
  - Delete button.
- "+ Add Variable" button; section-level "Save" button (consistent with existing rules save interaction).
- Frontend validation: key non-empty, format valid, no duplicates; disable save and show hint if invalid.
- Save: serialize to JSON string → `chatRoomApi.update(roomId, { envVars })` → `onChatRoomChange()` on success.
- If response contains `skippedReservedKeys`, toast hint "The following reserved keys were ignored: …".

Style follows project UI conventions (theme blue, input/label/button styles, custom toggle).

## 6. Testing and Verification

- **Backend unit tests** (`server`, node:test):
  - `parseRoomEnvVars`: valid/invalid JSON, illegal key filtering, deduplication, default values.
  - `buildShellEnvFromRoomEnvVars`: reserved keys skipped, `skippedKeys` correct, normal keys correctly merged.
- **End-to-end manual testing**:
  1. Create room → add `TEST_KEY=hello` with description in settings panel → save.
  2. @ assistant to execute `echo $TEST_KEY`, confirm output `hello`.
  3. Confirm assistant system prompt contains `TEST_KEY` and its description, but **no value**.
  4. Add reserved key (e.g., `PATH`) → confirm it's ignored with hint, and `PATH` in shell is not polluted.

## 7. Impact Scope and Risks

- Touches: Prisma schema + migration, `executor-manager.ts`, `executor.factory.ts`, `claude-sdk.executor.ts`, `codex-sdk.executor.ts`, `agent-system-prompt.ts`, `chatroom.gateway.ts`, `chatroom.service.ts`, frontend settings panel + new sub-component.
- Executor instances are cached per chatRoom-agent; after environment variable changes, need to ensure next execution uses new values. Since executor is cached and reused on each `getOrCreateExecutor`, **executor cache for the corresponding room should be cleared after modifying environment variables** (same handling as workDir change), otherwise old instance still holds old env. This must be explicitly addressed in implementation plan.
- Security: Value stored in plaintext, UI can display, this is a confirmed trade-off; reserved key guardrails reduce risk of hijacking executor behavior.

## 8. YAGNI / What We Won't Do

- No encrypted storage / KMS.
- No separate `ChatRoomEnvVar` table.
- No injecting environment variables into executor main process env, no support for changing executor's own behavior.
- No assistant-level / user-level environment variables (room-level only).