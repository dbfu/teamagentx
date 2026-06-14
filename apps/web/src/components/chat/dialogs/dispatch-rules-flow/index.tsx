import { ArrowRight, ChevronDown, RefreshCcw } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import {
  type DispatchRules,
  type DispatchRulesStep,
  type DispatchRulesWorkflow,
  isOneOfStep,
  isParallelStep,
} from '@/lib/dispatch-rules/schema'
import { StepCard } from './step-card'

interface DispatchRulesFlowProps {
  data: DispatchRules
  /** 群内真实存在的业务助手名称，用于标红不存在的引用 */
  validAgentNames: string[]
}

// 竖向连接线
function Connector() {
  return <div className="mx-auto h-5 w-px bg-gray-300" />
}

/** 群调度规则只读流程图 */
export function DispatchRulesFlow({ data, validAgentNames }: DispatchRulesFlowProps) {
  const known = new Set(validAgentNames)
  const isUnknown = (name: string) => validAgentNames.length > 0 && !known.has(name)
  const [collapsed, setCollapsed] = useState(false)
  const [activeWf, setActiveWf] = useState(0)
  const wfIndex = Math.min(activeWf, data.workflows.length - 1)
  const activeWorkflow = data.workflows[wfIndex]

  return (
    <div className="space-y-6">
      {/* 入口路由 */}
      {data.routing && data.routing.length > 0 && (
        <section className="rounded-xl border border-gray-200 bg-gray-50 p-3">
          <div className="mb-2 text-xs font-semibold text-gray-500">入口路由</div>
          <div className="space-y-1.5">
            {data.routing.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="rounded-full bg-white px-2 py-0.5 text-gray-600 ring-1 ring-gray-200">
                  {r.when}
                </span>
                <ArrowRight className="size-3 shrink-0 text-gray-400" />
                <span className="font-medium text-primary">{r.workflow}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 工作流：多条用 tab 切换（样式与助手分类一致，更紧凑） */}
      <section>
        {data.workflows.length > 1 && (
          <div className="mb-3 flex flex-wrap gap-1">
            {data.workflows.map((wf, wi) => (
              <button
                key={wi}
                type="button"
                onClick={() => setActiveWf(wi)}
                className={cn(
                  'whitespace-nowrap rounded-lg px-3 py-1 text-xs transition-colors',
                  wi === wfIndex
                    ? 'bg-blue-500/10 font-semibold text-blue-600'
                    : 'font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
              >
                {wf.name}
              </button>
            ))}
          </div>
        )}
        {activeWorkflow && (
          <WorkflowSteps workflow={activeWorkflow} isUnknown={isUnknown} />
        )}
      </section>

      {/* 全局约束 */}
      {data.constraints && data.constraints.length > 0 && (
        <section className="rounded-xl border border-gray-200 bg-gray-50">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-gray-500"
          >
            全局约束（{data.constraints.length}）
            <ChevronDown className={`size-4 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
          </button>
          {!collapsed && (
            <ul className="list-disc space-y-1 px-7 pb-3 text-xs text-gray-600">
              {data.constraints.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

function WorkflowSteps({
  workflow,
  isUnknown,
}: {
  workflow: DispatchRulesWorkflow
  isUnknown: (name: string) => boolean
}) {
  return (
    <div className="rounded-xl border border-gray-200 p-3">
      {workflow.steps.map((step, si) => (
        <div key={si}>
          {si > 0 && <Connector />}
          <StepRow step={step} index={si} isUnknown={isUnknown} />
        </div>
      ))}
    </div>
  )
}

function StepRow({
  step,
  index,
  isUnknown,
}: {
  step: DispatchRulesStep
  index: number
  isUnknown: (name: string) => boolean
}) {
  const stageLabel = (
    <div className="mb-1.5 flex items-center gap-2">
      <span className="flex size-5 items-center justify-center rounded-full bg-gray-200 text-[11px] font-semibold text-gray-600">
        {index + 1}
      </span>
      {isParallelStep(step) && (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
          <RefreshCcw className="size-2.5" />
          并行 · 等全部完成
        </span>
      )}
    </div>
  )

  if (isParallelStep(step)) {
    return (
      <div>
        {stageLabel}
        <div className="grid grid-cols-2 gap-2">
          {step.parallel.map((b, i) => (
            <StepCard
              key={i}
              agentName={b.agent}
              task={b.task}
              when={b.when}
              onPass={b.on_pass}
              onFail={b.on_fail}
              unknown={isUnknown(b.agent)}
            />
          ))}
        </div>
      </div>
    )
  }

  if (isOneOfStep(step)) {
    const primary = step.oneOf[0]
    return (
      <div>
        {stageLabel}
        <StepCard
          agentName={step.oneOf.join(' / ')}
          task={step.task}
          when={step.when}
          onPass={step.on_pass}
          onFail={step.on_fail}
          oneOfLabel="二选一（上一步分配）"
          unknown={step.oneOf.some((n) => isUnknown(n)) ? isUnknown(primary) : false}
        />
      </div>
    )
  }

  return (
    <div>
      {stageLabel}
      <StepCard
        agentName={step.agent}
        task={step.task}
        when={step.when}
        onPass={step.on_pass}
        onFail={step.on_fail}
        unknown={isUnknown(step.agent)}
      />
    </div>
  )
}
