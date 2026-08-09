import { init } from 'pptx-preview'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { base64ToArrayBuffer } from './workspace-document-utils'

export default function WorkspacePptxPreview({ path, content }: { path: string; content: string }) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    container.replaceChildren()
    let disposed = false
    let viewer: ReturnType<typeof init> | null = null
    let renderedWidth = 0
    let rendering = false
    let renderRequested = false
    let renderFrame: number | null = null
    const data = base64ToArrayBuffer(content)

    const renderAtCurrentWidth = async () => {
      if (rendering || disposed) return
      rendering = true

      try {
        while (renderRequested && !disposed) {
          renderRequested = false
          const width = Math.max(320, Math.floor(container.clientWidth))
          if (width <= 0 || width === renderedWidth) continue

          renderedWidth = width
          viewer?.destroy()
          container.replaceChildren()
          setError(null)
          viewer = init(container, { width, mode: 'list' })
          await viewer.preview(data)
        }
      } catch (renderError) {
        if (!disposed) setError(renderError instanceof Error ? renderError.message : String(renderError))
      } finally {
        rendering = false
        if (renderRequested && !disposed) void renderAtCurrentWidth()
      }
    }

    const requestRender = () => {
      renderRequested = true
      if (renderFrame !== null) return
      renderFrame = requestAnimationFrame(() => {
        renderFrame = null
        void renderAtCurrentWidth()
      })
    }

    const resizeObserver = new ResizeObserver(requestRender)
    resizeObserver.observe(container)
    requestRender()

    return () => {
      disposed = true
      resizeObserver.disconnect()
      if (renderFrame !== null) cancelAnimationFrame(renderFrame)
      viewer?.destroy()
      container.replaceChildren()
    }
  }, [content])

  return (
    <div className="h-full overflow-x-hidden overflow-y-auto bg-muted/20 p-4" aria-label={`PowerPoint 预览：${path}`}>
      {error ? (
        <div className="grid h-full place-items-center px-6 text-center text-xs text-destructive">{t('chat.workspaceDocumentParseFailed')}</div>
      ) : (
        <div ref={containerRef} className="mx-auto min-h-full w-full max-w-full" />
      )}
    </div>
  )
}
