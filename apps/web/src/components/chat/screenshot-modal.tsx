import { useState, useEffect, useCallback, useRef } from 'react'
import { Message } from '@/lib/agent-api'
import { Button } from '@/components/ui/button'
import { Download, Copy, Check, ImageDown, AlertCircle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ScreenshotRenderer } from './screenshot-renderer'
import {
  elementToImage,
  downloadImage,
  copyImageToClipboard,
  generateScreenshotFilename,
} from '@/lib/screenshot-utils'

interface MentionAgent {
  id: string
  name: string
  avatar?: string | null
  avatarColor?: string | null
  description?: string | null
}

interface CurrentUser {
  username: string
  avatar?: string | null
  avatarColor?: string | null
}

interface ScreenshotModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  messages: Message[]
  roomName: string
  roomAvatar?: string | null
  isQuickChatRoom?: boolean
  mentionAgents: MentionAgent[]
  currentUser: CurrentUser
}

export function ScreenshotModal({
  open,
  onOpenChange,
  messages,
  roomName,
  roomAvatar,
  isQuickChatRoom,
  mentionAgents,
  currentUser,
}: ScreenshotModalProps) {
  const [generating, setGenerating] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const renderElementRef = useRef<HTMLElement | null>(null)

  // 处理渲染器准备好
  const handleRendererReady = useCallback((element: HTMLElement) => {
    renderElementRef.current = element
  }, [])

  // 生成截图
  const generateScreenshot = useCallback(async () => {
    if (!renderElementRef.current) return

    setGenerating(true)
    setError(null)
    setPreviewUrl(null)

    try {
      const dataUrl = await elementToImage(renderElementRef.current, {
        quality: 0.95,
        backgroundColor: '#ffffff',
        pixelRatio: 2,
      })
      setPreviewUrl(dataUrl)
    } catch (err) {
      const message = err instanceof Error ? err.message : '截图生成失败'
      setError(message)
      toast.error('截图生成失败')
    } finally {
      setGenerating(false)
    }
  }, [])

  // 弹窗打开后自动生成截图
  useEffect(() => {
    if (open && messages.length > 0) {
      // 延迟一下等待渲染器准备好
      const timer = setTimeout(() => {
        if (renderElementRef.current) {
          generateScreenshot()
        }
      }, 200)
      return () => clearTimeout(timer)
    }
  }, [open, messages.length, generateScreenshot])

  // 弹窗关闭时清理状态
  useEffect(() => {
    if (!open) {
      setPreviewUrl(null)
      setError(null)
      setCopied(false)
      renderElementRef.current = null
    }
  }, [open])

  // 下载图片
  const handleDownload = useCallback(() => {
    if (!previewUrl) return
    const filename = generateScreenshotFilename(roomName)
    downloadImage(previewUrl, filename)
    toast.success('截图已下载')
    onOpenChange(false)
  }, [previewUrl, roomName, onOpenChange])

  // 复制图片到剪贴板
  const handleCopy = useCallback(async () => {
    if (!previewUrl) return
    const success = await copyImageToClipboard(previewUrl)
    if (success) {
      setCopied(true)
      toast.success('已复制到剪贴板')
      setTimeout(() => setCopied(false), 2000)
    } else {
      toast.error('复制失败')
    }
  }, [previewUrl])

  // 空消息提示
  if (messages.length === 0) {
    return (
      <div
        className={`fixed inset-0 z-50 ${open ? 'visible' : 'invisible'}`}
        onClick={() => onOpenChange(false)}
      >
        <div className="fixed inset-0 bg-black/50" />
        <div
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background rounded-lg shadow-lg p-6 max-w-md w-full border"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-center">
            <AlertCircle className="size-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">没有消息可截图</h3>
            <p className="text-muted-foreground mb-4">当前群聊没有消息记录</p>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* 弹窗 */}
      <div
        className={`fixed inset-0 z-50 ${open ? 'visible' : 'invisible'}`}
        onClick={() => onOpenChange(false)}
      >
        <div className="fixed inset-0 bg-black/50" />
        <div
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background rounded-lg shadow-lg max-w-3xl w-[90vw] max-h-[90vh] overflow-hidden border"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b">
            <div className="flex items-center gap-2">
              <ImageDown className="size-5 text-primary" />
              <h3 className="text-lg font-semibold">聊天记录截图</h3>
            </div>
            <button
              className="rounded-lg p-2 text-muted-foreground hover:bg-accent"
              onClick={() => onOpenChange(false)}
            >
              <svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="p-6">
            <p className="text-sm text-muted-foreground mb-4">
              将聊天记录导出为图片，可下载或复制到剪贴板
            </p>

            {/* 预览区域 */}
            <div className="border rounded-lg bg-muted/30 p-4 min-h-[200px] max-h-[400px] overflow-auto">
              {generating && (
                <div className="flex items-center justify-center h-[200px]">
                  <Loader2 className="size-6 animate-spin text-primary" />
                  <span className="ml-2 text-muted-foreground">正在生成截图...</span>
                </div>
              )}

              {error && !generating && (
                <div className="flex items-center justify-center h-[200px] text-destructive">
                  <AlertCircle className="size-5 mr-2" />
                  <span>{error}</span>
                </div>
              )}

              {!generating && !error && previewUrl && (
                <img
                  src={previewUrl}
                  alt="截图预览"
                  className="max-w-full mx-auto rounded shadow"
                />
              )}

              {!generating && !error && !previewUrl && (
                <div className="flex items-center justify-center h-[200px] text-muted-foreground">
                  等待生成截图...
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button
              variant="outline"
              onClick={handleCopy}
              disabled={!previewUrl || generating}
            >
              {copied ? (
                <><Check className="size-4 mr-1" /> 已复制</>
              ) : (
                <><Copy className="size-4 mr-1" /> 复制</>
              )}
            </Button>
            <Button
              onClick={handleDownload}
              disabled={!previewUrl || generating}
            >
              <Download className="size-4 mr-1" />
              下载图片
            </Button>
          </div>
        </div>
      </div>

      {/* 渲染器放在弹窗外部，不受弹窗宽度限制 */}
      {open && messages.length > 0 && (
        <ScreenshotRenderer
          messages={messages}
          roomName={roomName}
          roomAvatar={roomAvatar}
          isQuickChatRoom={isQuickChatRoom}
          mentionAgents={mentionAgents}
          currentUser={currentUser}
          onReady={handleRendererReady}
        />
      )}
    </>
  )
}
