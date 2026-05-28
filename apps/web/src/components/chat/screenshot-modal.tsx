import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Message } from '@/lib/agent-api'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, Download, Copy, Check, ImageDown, AlertCircle, Loader2, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { ScreenshotRenderer } from './screenshot-renderer'
import {
  SCREENSHOT_IMAGE_PAGE_THRESHOLD,
  SCREENSHOT_PIXEL_RATIO,
  elementToImage,
  elementToImageSegments,
  estimateScreenshotImagePageCount,
  printElementAsPdf,
  shouldMergeScreenshotOnServer,
  downloadImage,
  copyImageToClipboard,
  generateScreenshotFilename,
} from '@/lib/screenshot-utils'

interface ScreenshotPage {
  url: string
  filename: string
}

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
  const [pages, setPages] = useState<ScreenshotPage[]>([])
  const [currentPageIndex, setCurrentPageIndex] = useState(0)
  const [pdfOnlyMode, setPdfOnlyMode] = useState(false)
  const [estimatedImagePageCount, setEstimatedImagePageCount] = useState(0)
  const [printingPdf, setPrintingPdf] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const renderElementRef = useRef<HTMLElement | null>(null)
  const previewObjectUrlsRef = useRef<string[]>([])

  const clearPreviewObjectUrls = useCallback(() => {
    for (const objectUrl of previewObjectUrlsRef.current) {
      URL.revokeObjectURL(objectUrl)
    }
    previewObjectUrlsRef.current = []
  }, [])

  const currentPage = pages[currentPageIndex] ?? null
  const pageCount = pages.length
  const hasMultiplePages = pageCount > 1

  const buildPageFilename = useCallback((pageNumber: number, totalPages: number) => {
    const filename = generateScreenshotFilename(roomName)
    if (totalPages <= 1) {
      return filename
    }

    return filename.replace(/\.png$/i, `_第${String(pageNumber).padStart(2, '0')}页.png`)
  }, [roomName])

  // 处理渲染器准备好
  const handleRendererReady = useCallback((element: HTMLElement) => {
    renderElementRef.current = element
  }, [])

  // 生成截图
  const generateScreenshot = useCallback(async () => {
    if (!renderElementRef.current) return

    setGenerating(true)
    setError(null)
    setPages([])
    setCurrentPageIndex(0)
    setPdfOnlyMode(false)
    setEstimatedImagePageCount(0)
    clearPreviewObjectUrls()

    try {
      if (shouldMergeScreenshotOnServer(renderElementRef.current, SCREENSHOT_PIXEL_RATIO)) {
        const pageCount = estimateScreenshotImagePageCount(renderElementRef.current, SCREENSHOT_PIXEL_RATIO)
        if (pageCount > SCREENSHOT_IMAGE_PAGE_THRESHOLD) {
          setPdfOnlyMode(true)
          setEstimatedImagePageCount(pageCount)
          return
        }

        const files = await elementToImageSegments(renderElementRef.current, {
          quality: 0.95,
          backgroundColor: '#ffffff',
          pixelRatio: SCREENSHOT_PIXEL_RATIO,
        })

        const objectUrls = files.map(file => URL.createObjectURL(file))
        previewObjectUrlsRef.current = objectUrls
        setPages(objectUrls.map((url, index) => ({
          url,
          filename: buildPageFilename(index + 1, objectUrls.length),
        })))
      } else {
        const dataUrl = await elementToImage(renderElementRef.current, {
          quality: 0.95,
          backgroundColor: '#ffffff',
          pixelRatio: SCREENSHOT_PIXEL_RATIO,
        })
        setPages([{
          url: dataUrl,
          filename: buildPageFilename(1, 1),
        }])
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '截图生成失败'
      setError(message)
      toast.error('截图生成失败')
    } finally {
      setGenerating(false)
    }
  }, [buildPageFilename, clearPreviewObjectUrls])

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
      setPages([])
      setCurrentPageIndex(0)
      setPdfOnlyMode(false)
      setEstimatedImagePageCount(0)
      setError(null)
      setCopied(false)
      setPrintingPdf(false)
      renderElementRef.current = null
      clearPreviewObjectUrls()
    }
  }, [open, clearPreviewObjectUrls])

  useEffect(() => () => clearPreviewObjectUrls(), [clearPreviewObjectUrls])

  const pageStatusText = useMemo(() => {
    if (!hasMultiplePages) {
      return ''
    }
    return `第 ${currentPageIndex + 1} / ${pageCount} 页`
  }, [currentPageIndex, hasMultiplePages, pageCount])

  const handlePrevPage = useCallback(() => {
    setCurrentPageIndex(index => Math.max(0, index - 1))
    setCopied(false)
  }, [])

  const handleNextPage = useCallback(() => {
    setCurrentPageIndex(index => Math.min(pageCount - 1, index + 1))
    setCopied(false)
  }, [pageCount])

  // 下载图片
  const handleDownload = useCallback(async () => {
    if (!currentPage) return
    try {
      await downloadImage(currentPage.url, currentPage.filename)
      toast.success(hasMultiplePages ? `第 ${currentPageIndex + 1} 页已下载` : '截图已下载')
      if (!hasMultiplePages) {
        onOpenChange(false)
      }
    } catch {
      toast.error('下载失败')
    }
  }, [currentPage, currentPageIndex, hasMultiplePages, onOpenChange])

  // 复制图片到剪贴板
  const handleCopy = useCallback(async () => {
    if (!currentPage) return
    const success = await copyImageToClipboard(currentPage.url)
    if (success) {
      setCopied(true)
      toast.success(hasMultiplePages ? `第 ${currentPageIndex + 1} 页已复制到剪贴板` : '已复制到剪贴板')
      setTimeout(() => setCopied(false), 2000)
    } else {
      toast.error('复制失败')
    }
  }, [currentPage, currentPageIndex, hasMultiplePages])

  const handleExportPdf = useCallback(async () => {
    if (!renderElementRef.current) return

    setPrintingPdf(true)
    try {
      const filename = generateScreenshotFilename(roomName).replace(/\.png$/i, '.pdf')
      const result = await printElementAsPdf(renderElementRef.current, filename)
      if (result.canceled) {
        return
      }
      toast.success(result.method === 'electron' ? 'PDF 已导出' : '已打开 PDF 打印窗口')
    } catch (err) {
      console.error('导出 PDF 失败:', err)
      toast.error('导出 PDF 失败')
    } finally {
      setPrintingPdf(false)
    }
  }, [roomName])

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
              将聊天记录导出为图片，内容较长时会自动分页
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

              {!generating && !error && pdfOnlyMode && (
                <div className="flex h-[200px] flex-col items-center justify-center rounded-lg border border-blue-100 bg-blue-50 px-4 text-center text-blue-700">
                  <FileText className="mb-3 size-8" />
                  <div className="text-sm font-medium">内容较长，建议导出 PDF</div>
                  <div className="mt-1 text-xs">
                    预计会生成 {estimatedImagePageCount} 张图片，已跳过图片预览以避免等待过久。
                  </div>
                </div>
              )}

              {!generating && !error && currentPage && (
                <div className="space-y-3">
                  {hasMultiplePages && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                      <span>内容较长，已拆分为 {pageCount} 张图片。</span>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 border-blue-200 bg-white px-2 text-blue-700 hover:bg-blue-100"
                          onClick={handlePrevPage}
                          disabled={currentPageIndex === 0}
                        >
                          <ChevronLeft className="size-3.5" />
                        </Button>
                        <span className="min-w-16 text-center">{pageStatusText}</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 border-blue-200 bg-white px-2 text-blue-700 hover:bg-blue-100"
                          onClick={handleNextPage}
                          disabled={currentPageIndex >= pageCount - 1}
                        >
                          <ChevronRight className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}
                  <img
                    src={currentPage.url}
                    alt={hasMultiplePages ? `截图预览第 ${currentPageIndex + 1} 页` : '截图预览'}
                    className="max-w-full mx-auto rounded shadow"
                  />
                </div>
              )}

              {!generating && !error && !currentPage && !pdfOnlyMode && (
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
              variant={pdfOnlyMode ? undefined : 'outline'}
              onClick={handleExportPdf}
              disabled={generating || printingPdf}
            >
              {printingPdf ? (
                <><Loader2 className="size-4 mr-1 animate-spin" /> 生成中</>
              ) : (
                <><FileText className="size-4 mr-1" /> 导出 PDF</>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={handleCopy}
              disabled={!currentPage || generating}
            >
              {copied ? (
                <><Check className="size-4 mr-1" /> 已复制</>
              ) : (
                <><Copy className="size-4 mr-1" /> {hasMultiplePages ? '复制当前页' : '复制'}</>
              )}
            </Button>
            <Button
              onClick={handleDownload}
              disabled={!currentPage || generating}
            >
              <Download className="size-4 mr-1" />
              {hasMultiplePages ? '下载当前页' : '下载图片'}
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
