import { AlertTriangle, Check, GitBranch, X } from 'lucide-react'
import { getAgentColor } from './agent-color'

interface StepCardProps {
  agentName: string
  task: string
  when?: string
  onPass?: string
  onFail?: string
  /** 是否为不存在的助手（标红警示） */
  unknown?: boolean
  /** 二选一标记文案，例如「二选一（上一步分配）」 */
  oneOfLabel?: string
}

/** 单个助手步骤卡片（普通 / 并行分支 / 二选一共用） */
export function StepCard({ agentName, task, when, onPass, onFail, unknown, oneOfLabel }: StepCardProps) {
  const color = getAgentColor(agentName)
  return (
    <div
      className={`w-full rounded-xl border px-3 py-2.5 text-left shadow-sm ${
        unknown ? 'border-red-300 bg-red-50' : `${color.border} ${color.bg}`
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span className={`size-2 rounded-full ${unknown ? 'bg-red-500' : color.dot}`} />
        <span className={`text-sm font-semibold ${unknown ? 'text-red-700' : color.text}`}>
          {agentName}
        </span>
        {oneOfLabel && (
          <span className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] text-gray-500">
            <GitBranch className="size-2.5" />
            {oneOfLabel}
          </span>
        )}
        {unknown && (
          <span className="ml-auto inline-flex items-center gap-0.5 text-[10px] text-red-600">
            <AlertTriangle className="size-3" />
            助手不存在
          </span>
        )}
      </div>

      {when && (
        <div className="mt-1 inline-block rounded bg-white/60 px-1.5 py-0.5 text-[11px] text-gray-500">
          条件：{when}
        </div>
      )}

      <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-gray-600">{task}</p>

      {(onPass || onFail) && (
        <div className="mt-2 space-y-1 border-t border-black/5 pt-2">
          {onPass && (
            <div className="flex items-start gap-1 text-[11px] text-emerald-700">
              <Check className="mt-0.5 size-3 shrink-0" />
              <span>通过：{onPass}</span>
            </div>
          )}
          {onFail && (
            <div className="flex items-start gap-1 text-[11px] text-red-600">
              <X className="mt-0.5 size-3 shrink-0" />
              <span>不通过：{onFail}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
