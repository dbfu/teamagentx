import { renderAsync } from 'docx-preview'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { base64ToArrayBuffer } from './workspace-document-utils'

export default function WorkspaceDocxPreview({ path, content }: { path: string; content: string }) {
  const { t } = useTranslation()
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const styleRef = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const body = bodyRef.current
    const style = styleRef.current
    if (!body || !style) return

    body.replaceChildren()
    style.replaceChildren()
    setError(null)
    let disposed = false

    renderAsync(base64ToArrayBuffer(content), body, style, {
      className: 'workspace-docx',
      inWrapper: false,
      breakPages: true,
      useBase64URL: true,
    }).catch((renderError) => {
      if (!disposed) setError(renderError instanceof Error ? renderError.message : String(renderError))
    })

    return () => {
      disposed = true
      body.replaceChildren()
      style.replaceChildren()
    }
  }, [content])

  return (
    <div className="h-full overflow-auto bg-muted/20 px-4 py-0" aria-label={`Word 预览：${path}`}>
      {error ? (
        <div className="grid h-full place-items-center px-6 text-center text-xs text-destructive">{t('chat.workspaceDocumentParseFailed')}</div>
      ) : (
        <div className="mx-auto w-full max-w-[960px]">
          <div ref={styleRef} className="contents" />
          <div
            ref={bodyRef}
            className="flex min-h-full flex-col items-center gap-[30px] [&>section.workspace-docx]:bg-white [&>section.workspace-docx]:shadow-[0_0_10px_rgba(0,0,0,0.5)]"
          />
        </div>
      )}
    </div>
  )
}
