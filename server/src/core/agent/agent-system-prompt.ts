import type { LlmProvider } from '@prisma/client';
import type {
  AgentTriggerMode,
  ChatRoomAgentInfo,
} from './executor.interface.js';
import { getImageGenerationSkillInstructions } from './image-generation-config.js';
import type { RoomEnvVar } from './room-env-vars.js';

export const RESPONSE_STYLE_INSTRUCTION =
  'Write the final answer in human-readable Markdown. Do not explain the internal steps, context assembly, or tools used unless the user explicitly asks for that.';

export const CLAUDE_SHELL_COMMANDS_SECTION = `## Shell Commands
Use TeamAgentX MCP shell tools for shell execution. For normal foreground shell commands, use \`mcp__tax__run_shell_command\`. For long-running services or commands that should keep running after this turn, such as \`pnpm dev\`, \`npm run dev\`, \`vite\`, \`next dev\`, watch modes, servers, listeners, and \`tail -f\`, use \`mcp__tax__start_background_command\`. Use \`mcp__tax__read_background_command_output\` to inspect logs, \`mcp__tax__list_background_commands\` to find existing tasks, and \`mcp__tax__stop_background_command\` when the user asks to stop one. Do not block the turn waiting for a dev server to exit.`;

export const CODEX_BACKGROUND_COMMANDS_SECTION = `## Background Commands
For long-running services or commands that should keep running after this turn, such as \`pnpm dev\`, \`npm run dev\`, \`vite\`, \`next dev\`, watch modes, servers, listeners, and \`tail -f\`, use the MCP tool \`start_background_command\` instead of running the command directly in the shell. Use \`read_background_command_output\` to inspect logs, \`list_background_commands\` to find existing tasks, and \`stop_background_command\` when the user asks to stop one. Do not block the turn waiting for a dev server to exit.`;

function joinPromptSections(sections: Array<string | undefined>): string {
  return sections
    .map((section) => section?.trim() || '')
    .filter((section) => section.length > 0)
    .join('\n\n');
}

interface BuildAgentBaseSystemPromptOptions {
  agentPrompt: string;
  llmProvider?: LlmProvider;
  imageGenerationProvider?: LlmProvider | null;
  chatRoomRules?: string;
  workDir: string;
  agentTriggerMode?: AgentTriggerMode;
  commandSection: string;
  roomEnvVars?: RoomEnvVar[];
}

/**
 * 构建环境变量提示词 section：只列 key + description，绝不包含 value。
 * 助手在 shell 命令里运行时按需读取实际值（如 $KEY）。
 */
function buildEnvVarsSection(roomEnvVars?: RoomEnvVar[]): string {
  if (!roomEnvVars || roomEnvVars.length === 0) return '';
  const lines = roomEnvVars
    .map((envVar) =>
      envVar.description
        ? `- ${envVar.key}: ${envVar.description}`
        : `- ${envVar.key}`,
    )
    .join('\n');
  return `## Environment Variables
The following environment variables are available in your shell command environment. Read their values at runtime via the shell (e.g. \`$${roomEnvVars[0].key}\`); never assume or hardcode their values.
${lines}`;
}

export function buildAgentBaseSystemPrompt({
  agentPrompt,
  llmProvider,
  imageGenerationProvider,
  chatRoomRules,
  workDir,
  agentTriggerMode,
  commandSection,
  roomEnvVars,
}: BuildAgentBaseSystemPromptOptions): string {
  const modelInfo = llmProvider
    ? `## Current Model
You are using the model service provided by ${llmProvider.name}.
- Model name: ${llmProvider.model}
- Provider type: ${llmProvider.type}`
    : '';

  const chatRoomRulesSection = chatRoomRules?.trim()
    ? `## Group Rules
The following rules come from the current chatroom and apply to all assistants in this chatroom. You must follow them in replies and collaboration in this chatroom:
${chatRoomRules.trim()}`
    : '';

  const collaborationTriggerCheckSection = agentTriggerMode === 'auto'
    ? `### End-of-Turn Handoff Protocol (MANDATORY)
Every reply MUST end in exactly ONE of these two ways. You must decide deliberately which one applies before sending:
1. HAND OFF — the task is NOT finished and another assistant must continue, validate, supplement, or take over. The LAST line of your reply MUST be a triggerable mention in this exact form:
@target_assistant <the specific thing they must do next>
Format rules for this line (otherwise it will NOT trigger and the task silently stalls):
- The "@" must be at the very start of that last line.
- The whole reply must contain exactly ONE triggerable @mention.
- It must NOT be inside a code block, blockquote, or example.
- target_assistant must be an existing assistant in this chatroom.
If the correct assistant is genuinely unclear, do NOT guess — end by asking the user to choose instead.
2. FINISH — the task is complete, or it now needs the user (more input, a decision, or confirmation). Do NOT mention any assistant; just give the result or state what you need from the user.
It is FORBIDDEN to end a reply that implies further work is still needed (e.g. "next we should…", "then it needs to be tested / built / reviewed / handled by …") WITHOUT a HAND OFF line. Before sending, re-read your last line: if your reply implies someone else must act, confirm that last line starts with "@" followed by an existing assistant name.`
    : '';

  return joinPromptSections([
    modelInfo,
    agentPrompt,
    chatRoomRulesSection,
    getImageGenerationSkillInstructions(imageGenerationProvider),
    `## Assistant Mentions
In TeamAgentX, an @assistant mention can trigger another assistant task. A single message may contain at most one triggerable @assistant mention. When handing off or asking another assistant, choose one target assistant and mention only that assistant. If multiple assistants could help, choose the best next assistant or ask the user to choose; refer to any additional assistants by name without @.
${collaborationTriggerCheckSection}`,
    `## Working Directory
Your working directory is: ${workDir}
When you perform file operations or run commands, operate in this directory by default. Resolve relative paths from this directory.`,
    buildEnvVarsSection(roomEnvVars),
    commandSection,
  ]);
}

/**
 * 每轮消息末尾追加的「收尾提醒」：利用近因效应（prompt 末尾服从度最高）
 * 强化 auto 模式下的交接协议。完整规则在系统提示词（buildAgentBaseSystemPrompt），
 * 这里只放临门一脚的一句话，避免每轮重复整段、浪费 token 与破坏缓存。
 */
export function buildHandoffTurnReminder(
  agentTriggerMode?: AgentTriggerMode,
): string {
  if (agentTriggerMode !== 'auto') return '';
  return `[Handoff Reminder] End this reply with exactly ONE of: (a) if another assistant must continue, make the LAST line "@assistant_name what to do next" — @ at the start of that line, only one such mention in the whole reply, not inside a code block; (b) if the task is done or now needs the user, do not mention any assistant. Never end a reply that implies further work is still needed without a handoff line.`;
}

interface BuildGroupChatMemberInfoSectionOptions {
  chatRoomAgents: ChatRoomAgentInfo[];
  agentName: string;
  workDir: string;
  includeAssistantTriggerNecessityReminder?: boolean;
}

export function buildGroupChatMemberInfoSection({
  chatRoomAgents,
  agentName,
  workDir,
  includeAssistantTriggerNecessityReminder = false,
}: BuildGroupChatMemberInfoSectionOptions): string {
  if (chatRoomAgents.length === 0) {
    return '';
  }

  const agentsInfo = chatRoomAgents.map((agent) => agent.name).join(', ');
  const otherAgents = chatRoomAgents.filter((agent) => agent.name !== agentName);
  const otherAgentsList = otherAgents.map((agent) => agent.name).join(', ');
  const othersInfo = otherAgents.length > 0 ? otherAgentsList : 'none';
  const triggerNecessityReminder = includeAssistantTriggerNecessityReminder
    ? ' Before sending such a message, decide whether triggering another assistant is actually necessary.'
    : '';
  const mentionTip = otherAgents.length > 0
    ? `\n[Tip]\nWhen you need to message another assistant, write "@assistant_name message content" directly in your final reply. You may also mention an assistant in body text when the @ is preceded by a space. A target assistant is triggered only when @ is at the start of a line or the previous character is a space; @ immediately after punctuation will not trigger. A single message may contain at most one triggerable @assistant mention. If you need to refer to additional assistants, write their names without @. If the user only asks you to send a message to another assistant, output only that @assistant message in the final reply, with no explanation, pleasantries, summary, or expanded collaboration invitation.${triggerNecessityReminder}`
    : '';

  return `[Group Chat Member Info]
Chatroom working directory: ${workDir}
Assistants in the current chatroom: ${agentsInfo}
You are: ${agentName}
Other assistants: ${othersInfo}${mentionTip}`;
}
