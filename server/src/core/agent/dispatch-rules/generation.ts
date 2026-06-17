/**
 * 群调度规则 AI 生成 / 优化的提示词构建。
 *
 * 两种模式共用同一份输出规范：
 * - 有 instructions：按用户要求优化（草稿/补充说明 + 助手名册 → 规范 YAML）
 * - 无 instructions：仅凭助手名册自动推断一份合理工作流
 */
import type { LlmMessage } from '../../../lib/llm-client.js';

export interface DispatchRulesGenAgent {
  name: string;
  description: string;
}

export interface DispatchRulesGenInput {
  roomName: string;
  agents: DispatchRulesGenAgent[];
  /** 群主用户名，用于「需要确认时 @群主」的默认约束 */
  ownerUsername?: string | null;
  /** 用户的优化要求 / 草稿；为空则自动生成 */
  instructions?: string;
  /** 群聊当前已有的调度规则 YAML；优化时在其基础上修改，而非从零重建 */
  existingYaml?: string;
}

// 固定格式说明 + 一个完整示例（few-shot），保证模型严格按 schema 输出。
const SCHEMA_SPEC = `你是群聊调度规则（工作流）生成器。请输出**纯 YAML**（不要 \`\`\` 代码围栏、不要任何额外解释），且严格符合以下结构：

顶层字段：
- version: 固定为 1
- agents: 数组，每项 { name, role }。name 必须与「当前群聊助手」名称逐字一致，禁止编造不存在的助手。
- routing: 可选数组，每项 { when, workflow }，表示什么意图走哪条工作流。
- workflows: 数组，每项 { name, steps }。steps 是有序步骤数组，每个步骤是以下三种之一：
  1) 普通步骤：{ agent, task, when?, on_pass?, on_fail? }
  2) 并行步骤：{ parallel: [ { agent, task, when?, on_pass?, on_fail? }, ... ] }  // 同一步内多个助手并行
  3) 二选一步骤：{ oneOf: [助手名, 助手名], task, when?, on_pass?, on_fail? }  // 由上一步分配其中一个执行
- constraints: 可选字符串数组，全局约束。

字段语义：
- task：该步骤的具体任务说明（中文）。
- when：该步骤的触发条件（可选）。
- on_pass / on_fail：该步骤产生通过/不通过两种结果时分别怎么做（如评审、验证）。

要求：
- 只能使用「当前群聊助手」里列出的助手名称。
- 串行为默认；只有确实可同时进行的步骤才放进 parallel。
- 需要用户确认或回答问题的约束，写进 constraints。`;

const EXAMPLE = `示例（仅供格式参考，实际请根据当前群聊助手生成）：
version: 1
agents:
  - { name: 产品经理, role: 处理与澄清产品需求 }
  - { name: 架构师, role: 架构设计、需求拆分、代码评审 }
  - { name: 测试, role: 测试用例与验证 }
  - { name: 后端, role: 后端开发 }
  - { name: 前端, role: 前端开发 }
  - { name: 运维, role: 部署发布 }
routing:
  - { when: 用户提出新需求, workflow: 需求流程 }
  - { when: 发现 bug, workflow: bug流程 }
workflows:
  - name: 需求流程
    steps:
      - { agent: 产品经理, task: 处理与澄清需求 }
      - parallel:
          - { agent: 架构师, task: "生成架构；完成后 build 检查报错；拆分需求并创建 issue" }
          - { agent: 测试, task: 编写测试用例 }
      - parallel:
          - { agent: 后端, task: "开发后端；完成后保证服务正常启动" }
          - { agent: 前端, task: "根据原型开发并对接接口；完成后保证服务正常启动" }
      - agent: 架构师
        task: 代码 review
        on_pass: 推送代码到 github
        on_fail: 指出问题让对应开发修复
      - { agent: 运维, task: "源码部署，本地先 build 再上传，不用 80 端口，完成后发出 http://ip:port" }
  - name: bug流程
    steps:
      - { agent: 测试, when: bug 由用户发现, task: 先复现并创建 issue }
      - { agent: 架构师, task: 判断前端还是后端 bug 并分配 }
      - oneOf: [前端, 后端]
        task: "建 bugfix 分支、修复、自测、push、提 PR"
      - { agent: 架构师, task: review PR 通过后合并 }
      - agent: 测试
        task: 验证修复
        on_pass: 关闭 issue
        on_fail: 在 issue 下补充问题
constraints:
  - 每个助手只做自己的事，不替其他助手做事
  - 任务一个个串行完成，只有标注 parallel 的步骤才并行`;

export function buildDispatchRulesGenerationMessages(input: DispatchRulesGenInput): LlmMessage[] {
  const agentRoster = input.agents
    .map((a) => `- ${a.name}：${a.description?.trim() || '（无描述）'}`)
    .join('\n');

  const ownerHint = input.ownerUsername
    ? `\n- 当需要用户确认或回答问题时，约束里写明必须 @${input.ownerUsername}。`
    : '';

  const existing = input.existingYaml?.trim();
  const existingBlock = existing
    ? `\n群聊当前已有的调度规则（请在此基础上按要求修改，保留与要求无关的部分，不要从零重建）：\n${existing}\n`
    : '';

  const taskLine = input.instructions?.trim()
    ? `请${existing ? '在「当前已有的调度规则」基础上' : ''}参考用户的要求/草稿，结合助手名册，整理并补全为规范的调度规则 YAML。\n\n用户的要求/草稿：\n${input.instructions.trim()}`
    : existing
      ? `用户未提供具体要求，请在「当前已有的调度规则」基础上结合助手名册做必要的修正与补全（例如移除已不在群里的助手、补齐缺失的验收/选择环节），保持原有结构与意图。`
      : `用户未提供具体要求，请根据各助手的职责描述，自动推断一份合理的协作工作流（典型如「分析 → 设计 → 开发 → 评审 → 发布 → 测试」），并对涉及验收/选择的环节给出合理的 on_pass/on_fail 或 constraints。`;

  return [
    { role: 'system', content: `${SCHEMA_SPEC}\n\n${EXAMPLE}` },
    {
      role: 'user',
      content: `群聊名称：${input.roomName}

当前群聊助手（只能使用这些名称）：
${agentRoster}
${ownerHint}
${existingBlock}
${taskLine}

请直接输出纯 YAML。`,
    },
  ];
}
