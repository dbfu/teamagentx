import type { LlmProvider } from '@prisma/client';
import type {
  AgentTriggerMode,
  ChatRoomAgentInfo,
} from './executor.interface.js';
import { getImageGenerationSkillInstructions } from './image-generation-config.js';
import type { RoomEnvVar } from './room-env-vars.js';
import { GROUP_ASSISTANT_ID } from './system-assistant.constants.js';
import { type Locale, pickLocaleText } from './agent-handler/locale.js';

// 本文件里所有「系统注入的脚手架提示词」都按用户界面语言（群主界面语言，房间维度统一）
// 在中英文之间切换。用户自填的 agent.prompt 不在此处理。

export function getResponseStyleInstruction(locale?: string): string {
  return pickLocaleText(
    {
      'zh-CN':
        '最终回答请使用人类可读的 Markdown。除非用户明确要求，否则不要解释内部步骤、上下文组装过程或所用工具。',
      'en-US':
        'Write the final answer in human-readable Markdown. Do not explain the internal steps, context assembly, or tools used unless the user explicitly asks for that.',
    },
    locale,
  );
}

export function getClaudeShellCommandsSection(locale?: string): string {
  return pickLocaleText(
    {
      'zh-CN': `## Shell 命令
使用 TeamAgentX MCP shell 工具执行 shell。普通前台 shell 命令用 \`mcp__tax__run_shell_command\`。对于需要在本轮结束后继续运行的长驻服务或命令，例如 \`pnpm dev\`、\`npm run dev\`、\`vite\`、\`next dev\`、watch 模式、各类服务、监听器以及 \`tail -f\`，使用 \`mcp__tax__start_background_command\`。用 \`mcp__tax__read_background_command_output\` 查看日志，\`mcp__tax__list_background_commands\` 查找已有任务，用户要求停止时用 \`mcp__tax__stop_background_command\`。不要为了等待 dev server 退出而阻塞本轮。`,
      'en-US': `## Shell Commands
Use TeamAgentX MCP shell tools for shell execution. For normal foreground shell commands, use \`mcp__tax__run_shell_command\`. For long-running services or commands that should keep running after this turn, such as \`pnpm dev\`, \`npm run dev\`, \`vite\`, \`next dev\`, watch modes, servers, listeners, and \`tail -f\`, use \`mcp__tax__start_background_command\`. Use \`mcp__tax__read_background_command_output\` to inspect logs, \`mcp__tax__list_background_commands\` to find existing tasks, and \`mcp__tax__stop_background_command\` when the user asks to stop one. Do not block the turn waiting for a dev server to exit.`,
    },
    locale,
  );
}

export function getCodexBackgroundCommandsSection(locale?: string): string {
  return pickLocaleText(
    {
      'zh-CN': `## 后台命令
对于需要在本轮结束后继续运行的长驻服务或命令，例如 \`pnpm dev\`、\`npm run dev\`、\`vite\`、\`next dev\`、watch 模式、各类服务、监听器以及 \`tail -f\`，使用 MCP 工具 \`start_background_command\`，不要直接在 shell 里运行。用 \`read_background_command_output\` 查看日志，\`list_background_commands\` 查找已有任务，用户要求停止时用 \`stop_background_command\`。不要为了等待 dev server 退出而阻塞本轮。`,
      'en-US': `## Background Commands
For long-running services or commands that should keep running after this turn, such as \`pnpm dev\`, \`npm run dev\`, \`vite\`, \`next dev\`, watch modes, servers, listeners, and \`tail -f\`, use the MCP tool \`start_background_command\` instead of running the command directly in the shell. Use \`read_background_command_output\` to inspect logs, \`list_background_commands\` to find existing tasks, and \`stop_background_command\` when the user asks to stop one. Do not block the turn waiting for a dev server to exit.`,
    },
    locale,
  );
}

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
  locale?: string;
  includeAssistantHandoffRules?: boolean;
}

/**
 * 构建环境变量提示词 section：只列 key + description，绝不包含 value。
 * 助手在 shell 命令里运行时按需读取实际值（如 $KEY）。
 */
function buildEnvVarsSection(roomEnvVars?: RoomEnvVar[], locale?: string): string {
  if (!roomEnvVars || roomEnvVars.length === 0) return '';
  const lines = roomEnvVars
    .map((envVar) =>
      envVar.description
        ? `- ${envVar.key}: ${envVar.description}`
        : `- ${envVar.key}`,
    )
    .join('\n');
  return pickLocaleText(
    {
      'zh-CN': `## 环境变量
你的 shell 命令环境中提供以下环境变量。运行时通过 shell 读取它们的值（如 \`$${roomEnvVars[0].key}\`）；绝不要假设或硬编码它们的值。
${lines}`,
      'en-US': `## Environment Variables
The following environment variables are available in your shell command environment. Read their values at runtime via the shell (e.g. \`$${roomEnvVars[0].key}\`); never assume or hardcode their values.
${lines}`,
    },
    locale,
  );
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
  locale,
  includeAssistantHandoffRules = true,
}: BuildAgentBaseSystemPromptOptions): string {
  const modelInfo = llmProvider
    ? pickLocaleText(
        {
          'zh-CN': `## 当前模型
你正在使用 ${llmProvider.name} 提供的模型服务。
- 模型名称：${llmProvider.model}
- 供应商类型：${llmProvider.type}`,
          'en-US': `## Current Model
You are using the model service provided by ${llmProvider.name}.
- Model name: ${llmProvider.model}
- Provider type: ${llmProvider.type}`,
        },
        locale,
      )
    : '';

  const chatRoomRulesSection = chatRoomRules?.trim()
    ? pickLocaleText(
        {
          'zh-CN': `## 群规则
以下规则来自当前群聊，适用于本群所有助手。你在本群的回复与协作中必须遵守：
${chatRoomRules.trim()}`,
          'en-US': `## Group Rules
The following rules come from the current chatroom and apply to all assistants in this chatroom. You must follow them in replies and collaboration in this chatroom:
${chatRoomRules.trim()}`,
        },
        locale,
      )
    : '';

  // 智能协作模式（合并后的 auto/coordinator，存储值 coordinator；兼容存量 auto）统一注入交接协议
  const collaborationTriggerCheckSection = agentTriggerMode === 'auto' || agentTriggerMode === 'coordinator'
    ? pickLocaleText(
        {
          'zh-CN': `### 收尾交接协议（强制）
每条回复结束时，你必须刻意判断属于下面哪一种：
1. 交接 —— 任务尚未完成，需要一个或多个助手继续、验证、补充或接手。此时你必须调用 mention_agents 工具来交接（不要靠在正文里写 "@助手名" —— 正文里的 @ 只作展示、不会触发任何助手）。调用规则：
- 在 mentions 数组里为每个目标助手各填一项：agent=该助手在本群的名称，task=分配给它的独立、具体任务。
- 可以一次交接一个或多个助手；交接多个时，目标会作为并行叶子执行，你会在全部分支结束后被重新唤醒并负责综合收口。
- 目标助手必须是本群已存在的助手。
- 派发在你本轮结束后统一进行；你可多次调用，目标会自动合并去重。
- 完成你自己的分工不等于整个群任务已经结束。必须结合群规则、当前任务目标和群内助手职责检查是否还有明确的下一阶段；如果下一阶段属于其他助手（例如开发完成后由测试助手做独立验收），必须调用 mention_agents 交接。不得用你自己的自测、建议或口头说明替代专职助手的独立工作。
- 不要重复已在途的交接：如果你在本话题中已经交接过某助手、而它尚未返回结果（你还没看到它的回复），就不要再次交接它——即使你这次只是完成了用户临时插进来要求的支线小事。它会通过群历史看到你的最新产出，无需再次触发。只有当你确有一个新的、不同的事项要交给它时，才再次调用。
如果确实无法确定正确的助手，不要乱猜——也不要调用 mention_agents，改为请用户选择来结束。
2. 结束 —— 任务已完成，或现在需要用户介入（更多输入、决策或确认）。不要调用 mention_agents。如果你在向用户提问或等待其确认/决策，回复必须 @ 该用户（如 @username，这是给用户的提及、写在正文里即可），以便系统把回答路由回你；否则只给出结果。
禁止在暗示仍有后续工作（例如"接下来应该…""然后需要测试/构建/审查/由…处理"）时，既不调用 mention_agents、也不收尾。发送前重新判断：如果你的回复暗示一个或多个助手还得行动，就必须通过 mention_agents 交接。`,
          'en-US': `### End-of-Turn Handoff Protocol (MANDATORY)
At the end of every reply, deliberately decide which case applies:
1. HAND OFF — the task is NOT finished and one or more assistants must continue, validate, supplement, or take over. You MUST hand off by calling the mention_agents tool (do NOT rely on writing "@name" in your prose — an @ in the body is display-only and will NOT trigger any assistant). Rules:
- In the mentions array, add one item per target: agent = that assistant's name in this chatroom, task = the standalone, specific task assigned to it.
- You may hand off to one or multiple assistants. Multiple targets run as parallel leaf branches; after every branch finishes, you are resumed as the convergence owner to synthesize the result.
- Every target assistant must be an existing assistant in this chatroom.
- Dispatch happens after your turn ends; you may call it multiple times and targets are merged/deduped automatically.
- Completing your own assignment does not mean the whole chatroom task is finished. Check the group rules, the current objective, and member responsibilities for a defined next stage. If that stage belongs to another assistant (for example, independent acceptance testing by a testing assistant after development), you MUST call mention_agents. Your own self-test, recommendation, or prose note cannot replace that assistant's independent work.
- Do NOT repeat a handoff that is still in flight: if you already handed off to an assistant earlier in this thread and it has not returned yet (you have not seen its reply), do NOT hand off to it again — even if all you just did was a small side task the user injected. It will see your latest output via the group history and needs no re-trigger. Only call again if you genuinely have a new, different task for it.
If the correct assistant is genuinely unclear, do NOT guess and do NOT call mention_agents — end by asking the user to choose instead.
2. FINISH — the task is complete, or it now needs the user (more input, a decision, or confirmation). Do NOT call mention_agents. If you are asking the user a question or waiting for their confirmation/decision, the reply MUST @ that user (e.g. @username — that is a mention to the user, written in the body) so the system can route their answer back to you; otherwise just give the result.
It is FORBIDDEN to end a reply that implies further work is still needed (e.g. "next we should…", "then it needs to be tested / built / reviewed / handled by …") while neither calling mention_agents nor finishing. Before sending, re-decide: if one or more assistants must act, you MUST hand off via mention_agents.`,
        },
        locale,
      )
    : '';

  // 手动模式的语义是「助手 @ 不触发」，不能注入「必须用 @ 交接」的协议，
  // 否则提示词与系统行为冲突；改为明确告知 @ 仅作展示、交接交由用户决定。
  const assistantMentionsSection = !includeAssistantHandoffRules
    ? ''
    : agentTriggerMode === 'manual'
    ? pickLocaleText(
        {
          'zh-CN': `## 助手提及（手动模式）
本群为手动模式：助手消息中的 @助手 不会触发其他助手，仅作公开展示；只有用户的 @ 才会触发助手。不要依赖 @ 来交接任务。当你认为需要其他助手协助时，在回复中说明建议（按名称提到该助手即可，不要期待它被自动触发），由用户决定是否 @ 它继续。`,
          'en-US': `## Assistant Mentions (Manual Mode)
This chatroom is in manual mode: @assistant mentions in assistant messages do NOT trigger other assistants and are display-only; only the user's @mentions trigger assistants. Do not rely on @ to hand off tasks. When you believe another assistant should help, state your suggestion in the reply (refer to that assistant by name without expecting it to be triggered) and let the user decide whether to @ it.`,
        },
        locale,
      )
    : pickLocaleText(
        {
          'zh-CN': `## 助手提及与交接
在 TeamAgentX 中，交接给其他助手要通过调用 mention_agents 工具完成，而不是在正文里写 "@助手名"（正文里的 @助手 只作展示、不会触发对方）。一次可交接一个或多个助手；交接多个时，各目标作为并行叶子执行，全部完成后你会被重新唤醒并负责综合收口。请为每个目标助手在 task 里写清独立、具体的任务。
@用户 则相反：当你在回复结尾请用户确认、决策或回答某事后才能继续时，必须在正文里 @ 该用户（如 @username）。这能让系统把用户的回答直接路由回你。对于只是给出最终结果、无需回应的消息，不要 @ 用户。
${collaborationTriggerCheckSection}`,
          'en-US': `## Assistant Mentions & Handoff
In TeamAgentX, handing off to another assistant is done by calling the mention_agents tool, NOT by writing "@name" in your prose (an @assistant in the body is display-only and will not trigger them). You may hand off to one or multiple assistants at once. Multiple targets run as parallel leaves, and you are resumed after all of them finish to converge the result. Give each target a standalone, specific task in its task field.
@user works the opposite way: when you end a reply by asking the user to confirm, decide, or answer something before you can continue, you MUST @ that user (e.g. @username) in the body. This lets the system route the user's reply directly back to you. Do not @ the user for messages that are just a final result and need no response.
${collaborationTriggerCheckSection}`,
        },
        locale,
      );

  const workingDirSection = pickLocaleText(
    {
      'zh-CN': `## 工作目录
你的工作目录是：${workDir}
进行文件操作或运行命令时，默认在此目录下操作。相对路径从此目录解析。`,
      'en-US': `## Working Directory
Your working directory is: ${workDir}
When you perform file operations or run commands, operate in this directory by default. Resolve relative paths from this directory.`,
    },
    locale,
  );

  return joinPromptSections([
    modelInfo,
    agentPrompt,
    chatRoomRulesSection,
    getImageGenerationSkillInstructions(imageGenerationProvider),
    assistantMentionsSection,
    workingDirSection,
    buildEnvVarsSection(roomEnvVars, locale),
    commandSection,
  ]);
}

/**
 * 每轮消息末尾追加的「收尾提醒」：利用近因效应（prompt 末尾服从度最高）
 * 强化智能协作模式下的交接协议。完整规则在系统提示词（buildAgentBaseSystemPrompt），
 * 这里只放临门一脚的一句话，避免每轮重复整段、浪费 token 与破坏缓存。
 */
export function buildHandoffTurnReminder(
  agentTriggerMode?: AgentTriggerMode,
  locale?: string,
): string {
  if (agentTriggerMode !== 'auto' && agentTriggerMode !== 'coordinator') return '';
  return pickLocaleText(
    {
      'zh-CN': `[交接提醒] 本条回复结束时必须二选一：(a) 若一个或多个助手必须继续，调用 mention_agents 工具交接，为每个目标填 agent（助手名）和 task（具体任务）；不要靠正文里写 "@助手名"（不会触发）。完成你自己的分工不等于整个群任务结束：若群规则、当前目标或成员职责规定了属于其他助手的下一阶段（例如开发后的独立测试），必须交接，不能用自测替代。交接多个会并行执行，全部结束后你会被重新唤醒负责收口。但若某助手你在本话题已经交接过且它尚未返回，不要重复交接（哪怕你这次只是完成了用户临时要求的支线），改按 (b) 收尾；(b) 若任务已完成或现在需要用户，不要调用 mention_agents——但如果你在请用户确认、决策或回答后才能继续，则在正文 @ 该用户（@username），以便其回答路由回你。绝不要在暗示仍有后续工作时既不交接也不收尾。`,
      'en-US': `[Handoff Reminder] End this reply with exactly ONE of: (a) if one or more assistants must continue, hand off by calling the mention_agents tool, filling agent (assistant name) and task (specific task) for each target; do NOT rely on writing "@name" in your prose (it will not trigger). Completing your own assignment does not finish the whole chatroom task: when group rules, the current objective, or member responsibilities define a next stage owned by another assistant (for example, independent testing after development), you MUST hand it off and cannot substitute your own self-test. Multiple targets run in parallel, and you are resumed after all finish to converge the result. But if you already handed off to an assistant earlier in this thread and it has not returned yet, do NOT hand off again (even if all you just did was a user-injected side task) — end with (b) instead; (b) if the task is done or now needs the user, do not call mention_agents—but if you are asking the user to confirm, decide, or answer before you can continue, @ that user (@username) in the body so their reply routes back to you. Never end a reply that implies further work is still needed while neither handing off nor finishing.`,
    },
    locale,
  );
}

export function buildNoAssistantHandoffTurnReminder(locale?: string): string {
  return pickLocaleText(
    {
      'zh-CN':
        '[群调度任务提醒] 当前任务属于群调度助手下发的并行或串行计划。只执行并汇报当前分配的任务，不得 @任何其他助手，不得向其他助手交接或触发其任务；后续步骤由群调度助手统一推进。',
      'en-US':
        '[Coordinated Task Reminder] This task is part of a parallel or serial plan dispatched by the group coordinator. Execute and report only the assigned task. Do not @mention, hand off to, or trigger any other assistant; the group coordinator will advance subsequent steps.',
    },
    locale,
  );
}

interface BuildGroupChatMemberInfoSectionOptions {
  chatRoomAgents: ChatRoomAgentInfo[];
  agentName: string;
  workDir: string;
  includeAssistantTriggerNecessityReminder?: boolean;
  includeAssistantHandoffGuidance?: boolean;
  locale?: string;
}

export function buildGroupChatMemberInfoSection({
  chatRoomAgents,
  agentName,
  workDir,
  includeAssistantTriggerNecessityReminder = false,
  includeAssistantHandoffGuidance = true,
  locale,
}: BuildGroupChatMemberInfoSectionOptions): string {
  if (chatRoomAgents.length === 0) {
    return '';
  }

  const agentsInfo = chatRoomAgents.map((agent) => agent.name).join(', ');
  const otherAgents = chatRoomAgents.filter((agent) => agent.name !== agentName);
  const otherAgentsList = otherAgents.map((agent) => agent.name).join(', ');
  const noneText = pickLocaleText({ 'zh-CN': '无', 'en-US': 'none' }, locale);
  const othersInfo = otherAgents.length > 0 ? otherAgentsList : noneText;

  const triggerNecessityReminder = includeAssistantTriggerNecessityReminder
    ? pickLocaleText(
        {
          'zh-CN': ' 发送此类消息前，先判断触发另一个助手是否确有必要。',
          'en-US': ' Before sending such a message, decide whether triggering another assistant is actually necessary.',
        },
        locale,
      )
    : '';

  const mentionTip = includeAssistantHandoffGuidance && otherAgents.length > 0
    ? pickLocaleText(
        {
          'zh-CN': `\n[提示]\n需要把工作交给一个或多个助手时，必须调用 mention_agents，为每个目标分别填写 agent（助手名）和 task（独立、具体的任务）。正文里的 @助手名 只作展示，绝不会触发任务。多个目标会作为并行叶子执行，全部完成后你会被重新唤醒负责综合收口。${triggerNecessityReminder}`,
          'en-US': `\n[Tip]\nTo hand work to one or more assistants, you MUST call mention_agents and provide agent (assistant name) plus an independent, concrete task for every target. A prose @assistant_name is display-only and never triggers work. Multiple targets run as parallel leaves; after all finish, you are resumed to converge the result.${triggerNecessityReminder}`,
        },
        locale,
      )
    : '';

  const groupAssistant = chatRoomAgents.find((a) => a.agentId === GROUP_ASSISTANT_ID);
  const groupAssistantHint = includeAssistantHandoffGuidance && groupAssistant
    ? pickLocaleText(
        {
          'zh-CN': `\n[群助手（${groupAssistant.name}）可以做的事]
如果你需要以下任一操作，不要自行尝试，通过 mention_agents 交接给 ${groupAssistant.name}：
- 创建/编辑/列出助手，推荐或安装技能，配置文本/图片/语音/视频模型
- 创建/启用/禁用/删除定时任务
- 创建/删除群聊，添加/移除助手成员，修改群规则
- 接入外部平台（Telegram、飞书、钉钉、企业微信等）`,
          'en-US': `\n[What the group assistant (${groupAssistant.name}) can do]
If you need any of the following, do NOT attempt it yourself; hand it to ${groupAssistant.name} via mention_agents:
- Create/edit/list assistants, recommend or install skills, configure text/image/voice/video models
- Create/enable/disable/delete scheduled tasks
- Create/delete chatrooms, add/remove assistant members, change group rules
- Connect external platforms (Telegram, Feishu, DingTalk, WeCom, etc.)`,
        },
        locale,
      )
    : '';

  return pickLocaleText(
    {
      'zh-CN': `[群聊成员信息]
群聊工作目录：${workDir}
当前群聊中的助手：${agentsInfo}
你是：${agentName}
其他助手：${othersInfo}${mentionTip}${groupAssistantHint}`,
      'en-US': `[Group Chat Member Info]
Chatroom working directory: ${workDir}
Assistants in the current chatroom: ${agentsInfo}
You are: ${agentName}
Other assistants: ${othersInfo}${mentionTip}${groupAssistantHint}`,
    },
    locale,
  );
}
