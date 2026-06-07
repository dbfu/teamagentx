import { cn } from '@/lib/utils'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface MermaidDiagramProps {
  chart: string
  className?: string
}

// mermaid 体积较大，懒加载并只初始化一次
let mermaidInitialized = false
let mermaidPromise: Promise<typeof import('mermaid').default> | null = null

async function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => {
      const mermaid = mod.default
      if (!mermaidInitialized) {
        mermaid.initialize({
          startOnLoad: false,
          theme: 'default',
          // 消息内容来自用户/agent，属不可信输入，禁用脚本渲染
          securityLevel: 'strict',
        })
        mermaidInitialized = true
      }
      return mermaid
    })
  }
  return mermaidPromise
}

let renderSeq = 0

// 模块级缓存：相同源码直接复用已渲染的 SVG。
// 收起/展开会让组件重新挂载，缓存命中后可同步拿到 SVG，避免「先显示源码再显示流程图」的闪烁。
const svgCache = new Map<string, string>()

export function MermaidDiagram({ chart, className }: MermaidDiagramProps) {
  const { t } = useTranslation()
  const source = chart.trim()
  // 初始 state 直接读缓存：重新挂载（如收起/展开）时若命中则首帧即为流程图，无闪烁
  const [svg, setSvg] = useState<string | null>(() => svgCache.get(source) ?? null)
  // 仅在确实渲染失败后才回退展示源码；加载中显示占位，不闪源码
  const [errored, setErrored] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const src = chart.trim()
    if (!src) {
      setSvg(null)
      setErrored(false)
      return
    }

    const cached = svgCache.get(src)
    if (cached) {
      setSvg(cached)
      setErrored(false)
      return
    }

    let cancelled = false
    setErrored(false)
    // 流式输出期间语法可能不完整，防抖减少无效渲染
    const timer = window.setTimeout(async () => {
      try {
        const mermaid = await loadMermaid()
        if (cancelled) return
        // 先校验语法，避免流式不完整时抛错污染 DOM
        await mermaid.parse(src)
        if (cancelled) return
        renderSeq += 1
        const { svg: rendered } = await mermaid.render(`mermaid-${renderSeq}`, src)
        if (cancelled) return
        svgCache.set(src, rendered)
        setSvg(rendered)
        setErrored(false)
      } catch {
        if (cancelled) return
        // 语法不完整或非法：保留上一次成功的图；若从未成功过则回退为源码
        if (!svgCache.has(src)) setErrored(true)
      }
    }, 200)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [chart])

  if (svg) {
    return (
      <div
        ref={containerRef}
        className={cn('my-2 max-w-full overflow-x-auto', className)}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    )
  }

  // 确认渲染失败：回退展示原始代码
  if (errored) {
    return (
      <pre className="max-w-full overflow-x-auto whitespace-pre-wrap">
        <code>{chart}</code>
      </pre>
    )
  }

  // 加载/渲染中：轻量占位，避免先闪源码
  return (
    <div className="my-2 flex items-center gap-2 text-xs text-muted-foreground">
      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
      <span>{t('chat.roomActions.renderingDiagram')}</span>
    </div>
  )
}
