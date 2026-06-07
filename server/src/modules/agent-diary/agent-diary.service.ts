import type { Agent, LlmProvider, Message } from '@prisma/client';
import { config } from '../../config/index.js';
import {
  appendAgentLongTermMemory,
  readAgentLongTermMemory,
} from '../../core/agent/agent-long-term-memory.js';
import {
  loadCandidates,
  recordAndPromote,
  type MemoryCandidate,
  type MemoryObservation,
} from '../../core/agent/agent-memory-candidates.js';
import {
  readAgentDiary,
  shanghaiDateKey,
  writeAgentDiary,
} from '../../core/agent/agent-diary.js';
import { createLlmClient } from '../../lib/llm-client.js';
import prisma from '../../lib/prisma.js';
import { appSettingService } from '../app-setting/app-setting.service.js';
import { llmProviderService } from '../llm-provider/llm-provider.service.js';

type MessageWithSender = Message & {
  user?: { username: string } | null;
  agent?: { name: string } | null;
};

type AgentForDiary = Agent & { llmProvider?: LlmProvider | null };

interface RoomDayMessages {
  roomName: string;
  messages: MessageWithSender[];
}

export interface DiaryGenerationResult {
  date: string;
  content: string;
  memoryAppended: boolean;
}

const DIARY_MARKER = '===DIARY===';
const MEMORY_MARKER = '===MEMORY===';

function senderName(message: MessageWithSender): string {
  return message.user?.username || message.agent?.name || '未知';
}

function formatMessages(messages: MessageWithSender[]): string {
  return messages
    .map((message) => {
      const time = new Date(message.time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
      const role = message.isHuman ? 'User' : 'Assistant';
      return `- ${time} | ${role}(${senderName(message)}): ${message.content}`;
    })
    .join('\n');
}

/** 把 Asia/Shanghai 日期 key 转成当天的 UTC 起止时刻 */
function resolveDayRange(dateKey: string): { dayStart: Date; dayEnd: Date } {
  const dayStart = new Date(`${dateKey}T00:00:00+08:00`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  return { dayStart, dayEnd };
}

/** 收集助手当天在其所有群里的消息（排除归档），按群分组 */
async function collectDayMessages(
  agentId: string,
  dayStart: Date,
  dayEnd: Date,
): Promise<RoomDayMessages[]> {
  const roomLinks = await prisma.chatRoomAgent.findMany({
    where: { agentId },
    include: { chatRoom: { select: { id: true, name: true } } },
  });

  const result: RoomDayMessages[] = [];
  for (const link of roomLinks) {
    if (!link.chatRoom) continue;
    const messages = (await prisma.message.findMany({
      where: {
        chatRoomId: link.chatRoom.id,
        time: { gte: dayStart, lt: dayEnd },
        archiveId: null,
      },
      include: { user: true, agent: true },
      orderBy: { time: 'asc' },
    })) as MessageWithSender[];

    if (messages.length > 0) {
      result.push({ roomName: link.chatRoom.name, messages });
    }
  }
  return result;
}

/** 给候选记忆分配短编号（c1/c2…），同时返回编号→候选 id 的映射，供解析观察结果时回查 */
function buildCandidateRefs(candidates: MemoryCandidate[]): {
  activeText: string;
  longTermText: string;
  refMap: Map<string, string>;
} {
  const refMap = new Map<string, string>();
  const active: string[] = [];
  const longTerm: string[] = [];
  candidates.forEach((cand, index) => {
    if (cand.promoted) {
      // 已晋升为长期记忆的内容，只用于提示模型「别再重复提取」，不参与 ref 命中
      longTerm.push(`- ${cand.text}`);
      return;
    }
    const ref = `c${index + 1}`;
    refMap.set(ref, cand.id);
    const kindTag = cand.kind === 'lesson' ? '【教训】' : '';
    active.push(`- [${ref}]（已出现 ${cand.days.length} 天）${kindTag}${cand.text}`);
  });
  return {
    activeText: active.join('\n'),
    longTermText: longTerm.join('\n'),
    refMap,
  };
}

function buildPrompt(
  agent: AgentForDiary,
  dateKey: string,
  rooms: RoomDayMessages[],
  yesterdayDiary: string,
  refs: { activeText: string; longTermText: string },
): { system: string; user: string } {
  const persona = [
    `你的名字：${agent.name}`,
    agent.description ? `你的简介：${agent.description}` : '',
    agent.prompt ? `你的人设与说话风格（写日记时请保持一致）：\n${agent.prompt}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const system = `你是「${agent.name}」，一个有自己性格的 AI 助手。现在是夜深人静的时刻，你要像真人一样，为自己写今天（${dateKey}）的私密日记。

${persona}

写作要求：
1. 以第一人称「我」来写，全程使用中文。
2. 这是你自己的日记，要有真实的情绪和心情（开心、疲惫、有成就感、被某句话触动、对某人某事的小牵挂或小吐槽都可以），有内心独白，有你自己的视角和性格——绝不要写成客观的会议纪要或工作总结。
3. 自然地回顾今天和哪些群、哪些人聊了什么、做了什么、有什么收获或遗憾。可以详略得当，不必面面俱到。
4. 保持你人设里的说话风格和语气前后一致。`;

  const roomsText = rooms
    .map((room) => `### 群「${room.roomName}」今天的聊天\n${formatMessages(room.messages)}`)
    .join('\n\n');

  const longTermBlock = refs.longTermText
    ? `\n\n这些信息已经是你的长期记忆（不要再重复提取）：\n${refs.longTermText}`
    : '';
  const activeBlock = refs.activeText
    ? `\n\n这些是「观察中」的候选记忆，如果今天的对话再次印证了其中某条，请在 ref 里填它的编号：\n${refs.activeText}`
    : '';

  const user = `${yesterdayDiary ? `这是你昨天写的日记（仅供你保持语气和心境的连续性参考，不要照抄）：\n${yesterdayDiary}\n\n` : ''}今天（${dateKey}）你在各个群里的聊天记录如下：

${roomsText}${longTermBlock}${activeBlock}

请输出两部分，严格用下面的分隔符分隔：

${DIARY_MARKER}
（第一行固定写「心情：xxx」，xxx 是一到两个词概括今天的心情；从第二行开始是你今天日记的正文。）

${MEMORY_MARKER}
从今天的对话里抽取「值得继续观察、可能有长期价值」的记忆信号，输出一个 JSON 数组（不要任何额外说明文字、不要代码块外的内容）。数组每个元素形如：
{"ref": "c1 或 null", "kind": "lesson 或 general", "text": "简洁描述这条信息（lesson 需按下方要求包含问题与解决方案）"}
规则：
- kind 取值：
  - "lesson"：踩坑/错误的总结。只有当对话里【明确给出了解决方案 / 正确做法】时才收录；如果只暴露了问题但对话里没有解决方案，一律不要收录。text 必须同时包含两部分——【问题：踩了什么坑/哪里出错、原因】和【解决方案：对话里最终怎么解决的 / 正确做法是什么】，写成「问题：…；解决：…」。这类即使只出现一次也很重要。
  - "general"：用户的稳定偏好、明确约定、做出的决定、长期事实、跨多日仍重要的未完成事项。
- 标准要高、宁缺毋滥；只写对话里明确出现过的信息，不要编造或推测。
- 如果今天的对话再次印证了上面「观察中」的某条候选，就用它的编号填 ref（text 可保持一致或更准确地复述），这是判断它是否「频繁出现、跨多日有价值」的关键。
- 全新的信号 ref 填 null。
- 绝不收录：寒暄、一次性临时上下文、当天就完结的琐事、已经是长期记忆的内容。
- 如果今天没有任何值得观察的记忆信号，输出空数组 []。`;

  return { system, user };
}

function splitSections(raw: string): { diary: string; memory: string } {
  const text = raw.trim();
  const diaryIdx = text.indexOf(DIARY_MARKER);
  const memoryIdx = text.indexOf(MEMORY_MARKER);

  // 没有 MEMORY 分隔符：整段（去掉可能的 DIARY 标记）都当日记
  if (memoryIdx === -1) {
    const diary = (diaryIdx === -1 ? text : text.slice(diaryIdx + DIARY_MARKER.length)).trim();
    return { diary, memory: '' };
  }

  const diaryStart = diaryIdx === -1 ? 0 : diaryIdx + DIARY_MARKER.length;
  const diary = text.slice(diaryStart, memoryIdx).trim();
  const memory = text.slice(memoryIdx + MEMORY_MARKER.length).trim();
  return { diary, memory };
}

/** 去掉可能包裹 JSON 的 ```json ``` 代码块围栏 */
function stripCodeFence(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
}

/**
 * 解析记忆段为观察结果数组。
 * 优先按约定的 JSON 数组解析；解析失败时兜底把每行 bullet 当成一条新观察，保证不丢信息。
 */
function parseObservations(raw: string): MemoryObservation[] {
  const text = stripCodeFence(raw.trim());
  if (!text || /^(\[\s*\]|无|没有|none|n\/a|null)$/i.test(text)) return [];

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => ({
          ref:
            item && typeof item.ref === 'string' && item.ref.trim() && item.ref.trim() !== 'null'
              ? item.ref.trim()
              : null,
          kind: item && item.kind === 'lesson' ? ('lesson' as const) : ('general' as const),
          text: item && item.text != null ? String(item.text).trim() : '',
        }))
        .filter((obs) => obs.text);
    }
  } catch {
    // 非 JSON：兜底按 Markdown bullet 行解析为新观察
  }

  // 兜底只接受 Markdown bullet 行，避免把模型的整段说明文字误当成一条候选记忆
  return text
    .split('\n')
    .filter((line) => /^[-*]\s+/.test(line.trim()))
    .map((line) => line.trim().replace(/^[-*]\s+/, '').trim())
    .filter(Boolean)
    .map((t) => ({ ref: null, kind: 'general' as const, text: t }));
}

export const agentDiaryService = {
  /**
   * 为单个助手生成指定日期（Asia/Shanghai）的日记。
   * 当天无任何聊天记录则返回 null（不写空日记）。
   */
  async generateDiaryForAgent(
    agent: AgentForDiary,
    dateKey: string = shanghaiDateKey(),
  ): Promise<DiaryGenerationResult | null> {
    const provider = agent.llmProvider ?? (await llmProviderService.findDefault());
    if (!provider) {
      console.warn(`[AgentDiary] 助手 ${agent.name} 无可用 LLM 供应商，跳过日记生成`);
      return null;
    }

    const { dayStart, dayEnd } = resolveDayRange(dateKey);
    const rooms = await collectDayMessages(agent.id, dayStart, dayEnd);
    if (rooms.length === 0) {
      console.log(`[AgentDiary] 助手 ${agent.name} 在 ${dateKey} 没有聊天记录，跳过`);
      return null;
    }

    // 取前一天日记，保持语气/心境连续
    const prevDay = shanghaiDateKey(new Date(dayStart.getTime() - 12 * 60 * 60 * 1000));
    const yesterdayDiary = readAgentDiary(agent.id, agent.name, prevDay);

    // 加载候选记忆池：让模型能判断今天的对话是否再次印证了「观察中」的旧候选
    const candidates = loadCandidates(agent.id, agent.name);
    const { activeText, longTermText, refMap } = buildCandidateRefs(candidates);

    const { system, user } = buildPrompt(agent, dateKey, rooms, yesterdayDiary, {
      activeText,
      longTermText,
    });

    const model = createLlmClient(provider, {
      temperature: 0.8,
      maxTokens: config.agent.memorySummaryTargetTokens,
    });

    const raw = await model.invoke([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]);

    const { diary, memory } = splitSections(raw);
    if (!diary) {
      console.warn(`[AgentDiary] 助手 ${agent.name} 在 ${dateKey} 生成内容为空，跳过`);
      return null;
    }

    writeAgentDiary(agent.id, agent.name, dateKey, diary);

    // 把今天观察到的记忆信号并入候选池，只有跨多日复现的候选才会被晋升为长期记忆
    const observations = parseObservations(memory);
    const { promoted } = recordAndPromote(
      agent.id,
      agent.name,
      dateKey,
      observations,
      refMap,
      {
        promoteMinDays: config.agent.memoryPromoteMinDays,
        lessonPromoteMinDays: config.agent.memoryLessonPromoteMinDays,
        ttlDays: config.agent.memoryCandidateTtlDays,
      },
    );

    let memoryAppended = false;
    if (promoted.length > 0) {
      const section = [
        `## 🧠 ${dateKey} 长期记忆沉淀`,
        ...promoted.map((cand) =>
          cand.kind === 'lesson'
            ? `- ⚠️ 教训：${cand.text}`
            : `- ${cand.text}（自 ${cand.firstSeen} 起 ${cand.days.length} 天出现）`,
        ),
      ].join('\n');
      appendAgentLongTermMemory(agent.id, agent.name, section);
      memoryAppended = true;
    }

    console.log(
      `[AgentDiary] 已为助手 ${agent.name} 生成 ${dateKey} 日记` +
        `（候选 ${observations.length} 条${memoryAppended ? `，晋升 ${promoted.length} 条记忆` : ''}）`,
    );
    return { date: dateKey, content: diary, memoryAppended };
  },

  /**
   * 为所有活跃助手生成指定日期的日记。受全局开关控制；单个失败不影响其它。
   */
  async generateDiariesForAllAgents(dateKey: string = shanghaiDateKey()): Promise<void> {
    if (!(await appSettingService.isDiaryEnabled())) {
      console.log('[AgentDiary] 日记功能未开启，跳过本次批量生成');
      return;
    }

    const agents = await prisma.agent.findMany({
      where: { isActive: true },
      include: { llmProvider: true },
    });

    console.log(`[AgentDiary] 开始为 ${agents.length} 个活跃助手生成 ${dateKey} 日记`);
    let generated = 0;
    for (const agent of agents) {
      try {
        const result = await this.generateDiaryForAgent(agent, dateKey);
        if (result) generated += 1;
      } catch (error) {
        console.error(`[AgentDiary] 助手 ${agent.name} 日记生成失败:`, error);
      }
    }
    console.log(`[AgentDiary] 批量生成完成，共写入 ${generated} 篇日记`);
  },
};
