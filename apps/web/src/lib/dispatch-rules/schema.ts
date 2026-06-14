/**
 * 群调度规则（工作流）schema —— 前端同构版本。
 *
 * 与 server/src/core/agent/dispatch-rules/schema.ts 保持结构一致：
 * - 流程图渲染：parse YAML → 结构化对象 → 可视化
 * - 保存校验：保存前校验，不符合格式不允许保存
 */
import { z } from 'zod'
import { parse, stringify } from 'yaml'

const stepCommon = {
  task: z.string().min(1),
  when: z.string().optional(),
  on_pass: z.string().optional(),
  on_fail: z.string().optional(),
}

const agentStepSchema = z.object({
  agent: z.string().min(1),
  ...stepCommon,
})

const parallelStepSchema = z.object({
  parallel: z
    .array(
      z.object({
        agent: z.string().min(1),
        ...stepCommon,
      }),
    )
    .min(1),
})

const oneOfStepSchema = z.object({
  oneOf: z.array(z.string().min(1)).min(2),
  ...stepCommon,
})

const stepSchema = z.union([parallelStepSchema, oneOfStepSchema, agentStepSchema])

const workflowSchema = z.object({
  name: z.string().min(1),
  steps: z.array(stepSchema).min(1),
})

export const dispatchRulesSchema = z.object({
  version: z.literal(1),
  agents: z
    .array(z.object({ name: z.string().min(1), role: z.string().min(1) }))
    .min(1),
  routing: z
    .array(z.object({ when: z.string().min(1), workflow: z.string().min(1) }))
    .optional(),
  workflows: z.array(workflowSchema).min(1),
  constraints: z.array(z.string().min(1)).optional(),
})

export type DispatchRules = z.infer<typeof dispatchRulesSchema>
export type DispatchRulesStep = z.infer<typeof stepSchema>
export type DispatchRulesWorkflow = z.infer<typeof workflowSchema>

export interface DispatchRulesParseResult {
  ok: boolean
  data?: DispatchRules
  error?: string
}

/** 解析 + 校验 YAML 文本。失败返回可读错误，用于阻止保存或降级展示。 */
export function parseDispatchRulesYaml(yamlText: string): DispatchRulesParseResult {
  const trimmed = (yamlText ?? '').trim()
  if (!trimmed) return { ok: false, error: '内容为空' }

  let raw: unknown
  try {
    raw = parse(trimmed)
  } catch (error) {
    return {
      ok: false,
      error: `YAML 解析失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }

  const result = dispatchRulesSchema.safeParse(raw)
  if (!result.success) {
    const first = result.error.issues[0]
    const path = first?.path?.join('.') || '(根)'
    return { ok: false, error: `格式校验失败：${path} ${first?.message ?? '不符合规范'}` }
  }
  return { ok: true, data: result.data }
}

export function stringifyDispatchRules(data: DispatchRules): string {
  return stringify(data, { lineWidth: 0 })
}

/** 步骤类型判别工具，供渲染使用 */
export function isParallelStep(
  step: DispatchRulesStep,
): step is Extract<DispatchRulesStep, { parallel: unknown }> {
  return 'parallel' in step
}

export function isOneOfStep(
  step: DispatchRulesStep,
): step is Extract<DispatchRulesStep, { oneOf: unknown }> {
  return 'oneOf' in step
}
