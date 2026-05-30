import type { LlmProvider } from '@prisma/client';
import type {
  AgentTriggerMode,
  ChatRoomAgentInfo,
} from './executor.interface.js';
import { getImageGenerationSkillInstructions } from './image-generation-config.js';

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
}

export function buildAgentBaseSystemPrompt({
  agentPrompt,
  llmProvider,
  imageGenerationProvider,
  chatRoomRules,
  workDir,
  agentTriggerMode,
  commandSection,
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
    ? 'Before final output, run a collaboration trigger check: if your reply asks another assistant to continue, validate, supplement, take over, or perform work, the final reply must explicitly mention exactly one target assistant. Only mention an assistant when the target is unambiguous and action from that assistant is required. If the target assistant is unclear, ask the user to choose instead. Do not create triggerable assistant mentions in code blocks, quoted text, or examples. If no assistant action is needed, do not mention an assistant.'
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
    commandSection,
  ]);
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
