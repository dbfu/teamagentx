import * as fs from 'fs';
import * as path from 'path';

/**
 * TeamAgentX 内建 MCP 工具服务器脚本。
 *
 * 供各 ACP 执行器（Codex / Opencode 等）复用：以 stdio MCP server 方式启动，
 * 通过环境变量拿到 TeamAgentX 内部接口端点，向助手暴露 generate_image、
 * 系统工具、后台命令、群历史检索与 mention_agents 交接工具。
 * 脚本内容对执行器无依赖（纯读取环境变量），因此可被任意执行器写入其
 * 私有配置目录后启动。
 */

export const TEAMAGENTX_MCP_SERVER_FILE_NAME = 'teamagentx-agent-tools-mcp.mjs';

export function writeTeamAgentXMcpServerFile(serverPath: string): string {
  const script = `#!/usr/bin/env node
const generateImageEndpoint = process.env.TEAMAGENTX_GENERATE_IMAGE_ENDPOINT;
const systemToolsListEndpoint = process.env.TEAMAGENTX_SYSTEM_TOOLS_LIST_ENDPOINT;
const systemToolsCallEndpoint = process.env.TEAMAGENTX_SYSTEM_TOOLS_CALL_ENDPOINT;
const backgroundCommandStartEndpoint = process.env.TEAMAGENTX_BACKGROUND_COMMAND_START_ENDPOINT;
const backgroundCommandReadEndpoint = process.env.TEAMAGENTX_BACKGROUND_COMMAND_READ_ENDPOINT;
const backgroundCommandStopEndpoint = process.env.TEAMAGENTX_BACKGROUND_COMMAND_STOP_ENDPOINT;
const backgroundCommandListEndpoint = process.env.TEAMAGENTX_BACKGROUND_COMMAND_LIST_ENDPOINT;
const token = process.env.TEAMAGENTX_INTERNAL_TOOL_TOKEN;
const sourceAgentId = process.env.TEAMAGENTX_SOURCE_AGENT_ID;
const chatRoomId = process.env.TEAMAGENTX_CHAT_ROOM_ID;
const workDir = process.env.TEAMAGENTX_WORK_DIR;
const roomHistoryToolsEnabled = process.env.TEAMAGENTX_ROOM_HISTORY_TOOLS_ENABLED === "1";
const mentionAgentsFallbackEnabled = process.env.TEAMAGENTX_MENTION_AGENTS_FALLBACK_ENABLED === "1";
const fetchTimeoutMs = Number.parseInt(process.env.TEAMAGENTX_TOOL_FETCH_TIMEOUT_MS || "5000", 10);

function write(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

function warn(message, detail) {
  const suffix = detail === undefined ? "" : " " + stringifyPayload(detail);
  process.stderr.write("[TeamAgentX MCP] " + message + suffix + "\\n");
}

function toolResult(text, structuredContent, isError = false) {
  return {
    content: [{ type: "text", text }],
    structuredContent,
    isError,
  };
}

function stringifyPayload(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function postJson(endpoint, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number.isFinite(fetchTimeoutMs) ? fetchTimeoutMs : 5000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + token,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  } finally {
    clearTimeout(timeout);
  }
}

async function callGenerateImage(args) {
  if (!generateImageEndpoint || !token || !sourceAgentId) {
    return toolResult("The current assistant does not have image generation enabled.", {}, true);
  }

  const prompt = typeof args?.prompt === "string" ? args.prompt.trim() : "";
  const n = Number.isInteger(args?.n) ? args.n : undefined;
  if (!prompt) {
    return toolResult("Parameter error: prompt is required.", {}, true);
  }
  if (n !== undefined && (n < 1 || n > 4)) {
    return toolResult("Parameter error: n must be between 1 and 4.", {}, true);
  }

  try {
    const { response, payload } = await postJson(generateImageEndpoint, {
      sourceAgentId,
      prompt,
      size: typeof args?.size === "string" ? args.size : undefined,
      n,
      filename: typeof args?.filename === "string" ? args.filename : undefined,
      extraJson: args?.extraJson && typeof args.extraJson === "object" ? args.extraJson : undefined,
    });
    if (!response.ok || payload.success === false) {
      return toolResult(payload.error || "Image generation failed.", payload, true);
    }
    const result = payload.data || payload;
    const urls = Array.isArray(result.urls) ? result.urls : [];
    const files = Array.isArray(result.files) ? result.files : [];
    return toolResult("Image generation succeeded: " + (urls.join(", ") || files.join(", ")), result, false);
  } catch (error) {
    return toolResult(error instanceof Error ? error.message : "Image generation failed.", {}, true);
  }
}

async function listSystemTools() {
  if (!systemToolsListEndpoint || !token || !sourceAgentId || !chatRoomId) {
    warn("system tools list skipped: missing endpoint, token, sourceAgentId, or chatRoomId");
    return [];
  }

  try {
    const { response, payload } = await postJson(systemToolsListEndpoint, { sourceAgentId, chatRoomId });
    if (!response.ok || payload.success === false) {
      warn("system tools list failed", { status: response.status, error: payload.error });
      return [];
    }
    return Array.isArray(payload.data?.tools) ? payload.data.tools : [];
  } catch (error) {
    warn("system tools list request failed", error instanceof Error ? error.message : String(error));
    return [];
  }
}

async function callSystemTool(name, args) {
  if (!systemToolsCallEndpoint || !token || !sourceAgentId || !chatRoomId) {
    return toolResult("The current assistant has no available system tools.", {}, true);
  }

  try {
    const { response, payload } = await postJson(systemToolsCallEndpoint, { sourceAgentId, chatRoomId, name, args });
    if (!response.ok || payload.success === false) {
      return toolResult(payload.error || "Tool execution failed.", payload, true);
    }
    const result = payload.data ?? payload;
    return toolResult(stringifyPayload(result), result, false);
  } catch (error) {
    return toolResult(error instanceof Error ? error.message : "Tool execution failed.", {}, true);
  }
}

function buildMentionAgentsFallbackTool() {
  if (!mentionAgentsFallbackEnabled) return null;

  return {
    name: "mention_agents",
    description: "Hand off the conversation to one or more other assistants in this chatroom. Call this only when you actually want those assistants to act; dispatch happens after your turn ends. Use mode=parallel for independent targets and mode=serial for ordered handoff.",
    inputSchema: {
      type: "object",
      properties: {
        mentions: {
          type: "array",
          minItems: 1,
          description: "Assistants to hand off to in this call.",
          items: {
            type: "object",
            properties: {
              agent: {
                type: "string",
                minLength: 1,
                description: "Visible assistant name in this chatroom, without @ or internal IDs.",
              },
              task: {
                type: "string",
                default: "",
                description: "Concrete task or remaining work for this assistant.",
              },
            },
            required: ["agent"],
            additionalProperties: false,
          },
        },
        mode: {
          type: "string",
          enum: ["serial", "parallel"],
          default: "parallel",
          description: "parallel runs targets together; serial runs them in order.",
        },
        intent: {
          type: "string",
          description: "Optional overall handoff intent for audit and result collection.",
        },
      },
      required: ["mentions"],
      additionalProperties: false,
    },
  };
}

function buildRoomHistoryTools() {
  if (!roomHistoryToolsEnabled || !systemToolsCallEndpoint) return [];

  return [
    {
      name: "get_room_message_detail",
      description: "Get detailed content for one message in the current chatroom. Provide messageId when known, or provide keyword plus offset to open the Nth recent matching message. Use contentOffset/contentLimit to page through long message content. The chatroom is fixed to the current execution context; do not provide a chatRoomId.",
      inputSchema: {
        type: "object",
        properties: {
          messageId: { type: "string", description: "Message ID to inspect. The ID must belong to the current chatroom." },
          keyword: { type: "string", minLength: 1, maxLength: 120, description: "Keyword used to find a message when messageId is not provided, and to return matching snippets inside the message. Literal substring search; regex is not supported." },
          offset: { type: "number", minimum: 0, maximum: 500, description: "When using keyword without messageId, skip this many recent matching messages. Default 0 returns the most recent matching message." },
          contentOffset: { type: "number", minimum: 0, description: "Character offset into the selected message content. Default 0." },
          contentLimit: { type: "number", minimum: 1, maximum: 12000, description: "Maximum characters of message content to return. Default 4000, maximum 12000." },
          contextMessages: { type: "number", minimum: 0, maximum: 3, description: "Number of neighboring chat messages before and after the selected message. Default 0, maximum 3." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "get_recent_room_messages",
      description: "Get message indexes in the current chatroom. The chatroom is fixed to the current execution context; do not provide a chatRoomId. Return at most 50 message indexes per call with short previews only; use skip for offset pagination and order asc/desc for chronological direction. Use get_room_message_detail with messageId to inspect full content. Prefer search_room_messages when you know a keyword.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", minimum: 1, maximum: 50, description: "Maximum recent message indexes to return. Default 5, maximum 50." },
          skip: { type: "number", minimum: 0, maximum: 1000, description: "Number of matching message indexes to skip before returning results. Default 0, maximum 1000." },
          order: { type: "string", enum: ["asc", "desc"], description: "Sort order by message time and id. Use asc for oldest first, desc for newest first. Default desc." },
          beforeMessageId: { type: "string", description: "Only return messages before this message ID. The ID must belong to the current chatroom." },
          afterMessageId: { type: "string", description: "Only return messages after this message ID. The ID must belong to the current chatroom." },
          senderType: { type: "string", enum: ["user", "agent"], description: "Optional sender type filter." },
          senderName: { type: "string", maxLength: 80, description: "Optional partial sender name filter, such as a human username or assistant name." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "search_room_messages",
      description: "Search message indexes in the current chatroom by keyword. The chatroom is fixed to the current execution context; do not provide a chatRoomId. Return at most 50 matching message indexes per call. It behaves like grep -n -C: returns matching message snippets, line numbers, and optional nearby message indexes instead of dumping full history. Use get_room_message_detail with messageId to inspect full content.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", minLength: 1, maxLength: 120, description: "Keyword to search for in the current chatroom. Literal substring search; regex is not supported." },
          limit: { type: "number", minimum: 1, maximum: 50, description: "Maximum matching message indexes to return. Default 5, maximum 50." },
          beforeMessageId: { type: "string", description: "Only search messages before this message ID. The ID must belong to the current chatroom." },
          afterMessageId: { type: "string", description: "Only search messages after this message ID. The ID must belong to the current chatroom." },
          senderType: { type: "string", enum: ["user", "agent"], description: "Optional sender type filter." },
          senderName: { type: "string", maxLength: 80, description: "Optional partial sender name filter, such as a human username or assistant name." },
          contextMessages: { type: "number", minimum: 0, maximum: 3, description: "Number of neighboring chat messages before and after each match. Default 0, maximum 3." },
          contextLines: { type: "number", minimum: 0, maximum: 5, description: "Number of lines before and after a matching line inside a long message. Default 2, maximum 5." },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  ];
}

async function callBackgroundCommand(endpoint, args) {
  if (!endpoint || !token || !sourceAgentId || !chatRoomId) {
    return toolResult("Background command tools are not available.", {}, true);
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + token,
      },
      body: JSON.stringify({
        sourceAgentId,
        chatRoomId,
        workDir,
        ...args,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
      return toolResult(payload.error || "Background command operation failed.", payload, true);
    }
    const result = payload.data ?? payload;
    return toolResult(stringifyPayload(result), result, false);
  } catch (error) {
    return toolResult(error instanceof Error ? error.message : "Background command operation failed.", {}, true);
  }
}

async function handle(request) {
  const { id, method, params } = request;
  if (!method) return;

  if (method === "notifications/initialized") {
    return;
  }

  if (method === "initialize") {
    write({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "tax", version: "1.0.0" },
      },
    });
    return;
  }

  if (method === "resources/list") {
    write({
      jsonrpc: "2.0",
      id,
      result: { resources: [] },
    });
    return;
  }

  if (method === "tools/list") {
    const tools = buildRoomHistoryTools();
    if (generateImageEndpoint) {
      tools.push({
        name: "generate_image",
        description: "Generate images through the TeamAgentX server-controlled image model. API keys are used only on the server.",
        inputSchema: {
          type: "object",
          properties: {
            prompt: { type: "string", description: "Detailed image prompt. Include subject, style, composition, colors, intended use, and other relevant details." },
            size: { type: "string", description: "Image size or aspect ratio, for example 1024x1024, 1024x1792, or 1:1." },
            n: { type: "number", description: "Number of images to generate. Default 1, maximum 4." },
            filename: { type: "string", description: "Optional filename. Do not include a path." },
            extraJson: { type: "object", description: "Provider-specific extra parameters." },
          },
          required: ["prompt"],
          additionalProperties: false,
        },
      });
    }
    if (backgroundCommandStartEndpoint) {
      tools.push({
        name: "start_background_command",
        description: "Start a long-running shell command in the TeamAgentX background task manager. Use this for dev servers, watch commands, tail -f, and services that should keep running after this turn.",
        inputSchema: {
          type: "object",
          properties: {
            command: { type: "string", description: "Shell command to run in the current working directory." },
          },
          required: ["command"],
          additionalProperties: false,
        },
      });
      tools.push({
        name: "read_background_command_output",
        description: "Read the latest stdout and stderr from a background command started with start_background_command.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: { type: "string", description: "Background task ID returned by start_background_command." },
            tailBytes: { type: "number", description: "Maximum bytes to read from the end of each output stream. Default 12288." },
          },
          required: ["taskId"],
          additionalProperties: false,
        },
      });
      tools.push({
        name: "stop_background_command",
        description: "Stop a running background command by task ID.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: { type: "string", description: "Background task ID returned by start_background_command." },
          },
          required: ["taskId"],
          additionalProperties: false,
        },
      });
      tools.push({
        name: "list_background_commands",
        description: "List recent background commands started by this assistant in this chatroom.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      });
    }
    const systemTools = await listSystemTools();
    for (const systemTool of systemTools) {
      if (!systemTool?.name || tools.some((tool) => tool.name === systemTool.name)) continue;
      tools.push({
        name: systemTool.name,
        description: systemTool.description || systemTool.name,
        inputSchema: systemTool.inputSchema || { type: "object", additionalProperties: true },
      });
    }
    const mentionFallbackTool = buildMentionAgentsFallbackTool();
    if (mentionFallbackTool && !tools.some((tool) => tool.name === mentionFallbackTool.name)) {
      tools.push(mentionFallbackTool);
    }
    write({
      jsonrpc: "2.0",
      id,
      result: {
        tools,
      },
    });
    return;
  }

  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    if (name === "generate_image") {
      const result = await callGenerateImage(args);
      write({ jsonrpc: "2.0", id, result });
      return;
    }
    if (name === "start_background_command") {
      const result = await callBackgroundCommand(backgroundCommandStartEndpoint, args);
      write({ jsonrpc: "2.0", id, result });
      return;
    }
    if (name === "read_background_command_output") {
      const result = await callBackgroundCommand(backgroundCommandReadEndpoint, args);
      write({ jsonrpc: "2.0", id, result });
      return;
    }
    if (name === "stop_background_command") {
      const result = await callBackgroundCommand(backgroundCommandStopEndpoint, args);
      write({ jsonrpc: "2.0", id, result });
      return;
    }
    if (name === "list_background_commands") {
      const result = await callBackgroundCommand(backgroundCommandListEndpoint, args);
      write({ jsonrpc: "2.0", id, result });
      return;
    }
    const result = await callSystemTool(name, args);
    write({ jsonrpc: "2.0", id, result });
    return;
  }

  if (id !== undefined) {
    write({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "Method not found: " + method },
    });
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    Promise.resolve()
      .then(() => handle(JSON.parse(line)))
      .catch((error) => {
        write({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
        });
      });
  }
});
`;
  fs.mkdirSync(path.dirname(serverPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(serverPath, script, { mode: 0o700 });
  return serverPath;
}
