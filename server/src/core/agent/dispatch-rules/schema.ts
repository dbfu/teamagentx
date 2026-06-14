/**
 * 群调度规则（工作流）schema。
 *
 * 统一定义群调度规则的结构化格式，供以下用途共用：
 * - 群助手 generate_dispatch_rules 工具生成 / 校验
 * - chatroom.update 保存时校验（拒绝非法 YAML）
 * - 协调器注入前的解析（可选）
 *
 * 存储形态：YAML 文本（人类可读、可手改）。运行时按本 schema parse + 校验成对象。
 * 前端使用同构的一份 schema（apps/web/src/lib/dispatch-rules/schema.ts）做渲染与保存校验。
 */
import { z } from 'zod';
import { parse, stringify } from 'yaml';

// 单个步骤的公共字段
const stepCommon = {
  task: z.string().min(1, 'task 不能为空'),
  when: z.string().optional(),
  on_pass: z.string().optional(),
  on_fail: z.string().optional(),
};

// 普通步骤：指定单个助手
const agentStepSchema = z.object({
  agent: z.string().min(1),
  ...stepCommon,
});

// 并行步骤：parallel 内多个助手同时执行
const parallelBranchSchema = z.object({
  agent: z.string().min(1),
  ...stepCommon,
});
const parallelStepSchema = z.object({
  parallel: z.array(parallelBranchSchema).min(1, 'parallel 至少一个分支'),
});

// 二选一步骤：由上一步分配其中一个助手执行（如修 bug 给前端或后端）
const oneOfStepSchema = z.object({
  oneOf: z.array(z.string().min(1)).min(2, 'oneOf 至少两个候选助手'),
  ...stepCommon,
});

const stepSchema = z.union([parallelStepSchema, oneOfStepSchema, agentStepSchema]);

const workflowSchema = z.object({
  name: z.string().min(1),
  steps: z.array(stepSchema).min(1, '工作流至少一个步骤'),
});

export const dispatchRulesSchema = z.object({
  version: z.literal(1),
  agents: z
    .array(
      z.object({
        name: z.string().min(1),
        role: z.string().min(1),
      }),
    )
    .min(1, '至少配置一个助手'),
  routing: z
    .array(
      z.object({
        when: z.string().min(1),
        workflow: z.string().min(1),
      }),
    )
    .optional(),
  workflows: z
    .array(workflowSchema)
    .min(1, '至少配置一条工作流'),
  constraints: z.array(z.string().min(1)).optional(),
});

export type DispatchRules = z.infer<typeof dispatchRulesSchema>;
export type DispatchRulesAgent = DispatchRules['agents'][number];
export type DispatchRulesStep = z.infer<typeof stepSchema>;

export interface DispatchRulesParseResult {
  ok: boolean;
  data?: DispatchRules;
  /** 人类可读的错误信息（解析失败或校验失败） */
  error?: string;
}

/** 把 YAML 文本解析并按 schema 校验为结构化对象。 */
export function parseDispatchRulesYaml(yamlText: string): DispatchRulesParseResult {
  const trimmed = (yamlText ?? '').trim();
  if (!trimmed) {
    return { ok: false, error: '内容为空' };
  }

  let raw: unknown;
  try {
    raw = parse(trimmed);
  } catch (error) {
    return {
      ok: false,
      error: `YAML 解析失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const result = dispatchRulesSchema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path?.join('.') || '(根)';
    return { ok: false, error: `格式校验失败：${path} ${first?.message ?? '不符合规范'}` };
  }
  return { ok: true, data: result.data };
}

/** 把结构化对象按固定字段顺序序列化为 YAML 文本。 */
export function stringifyDispatchRules(data: DispatchRules): string {
  return stringify(data, { lineWidth: 0 });
}

/** 收集调度规则里引用到的所有助手名称（agents / steps / oneOf / routing 无需）。 */
export function collectReferencedAgentNames(data: DispatchRules): string[] {
  const names = new Set<string>();
  for (const a of data.agents) names.add(a.name);
  for (const wf of data.workflows) {
    for (const step of wf.steps) {
      if ('agent' in step) names.add(step.agent);
      else if ('parallel' in step) step.parallel.forEach((b) => names.add(b.agent));
      else if ('oneOf' in step) step.oneOf.forEach((n) => names.add(n));
    }
  }
  return [...names];
}
