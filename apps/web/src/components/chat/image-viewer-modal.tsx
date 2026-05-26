import { cn } from '@/lib/utils'
import { X, Download, Copy, Check } from 'lucide-react'
import { useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'

interface ImageViewerModalProps {
  isOpen: boolean
  imageUrl: string
  imageName?: string
  onClose: () => void
}

/**
 * 图片查看器弹窗
 * 点击消息中的图片时打开，支持全屏查看和下载
 */
export function ImageViewerModal({
  isOpen,
  imageUrl,
  imageName = 'image',
  onClose,
}: ImageViewerModalProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!isOpen) return

    setIsLoading(true)
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [isOpen, imageUrl])

  const handleDownload = () => {
    const link = document.createElement('a')
    link.href = imageUrl
    link.download = imageName
    link.target = '_blank'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleCopy = useCallback(async () => {
    try {
      const response = await fetch(imageUrl)
      const blob = await response.blob()
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ])
      setCopied(true)
      toast.success('图片已复制到剪贴板')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('复制失败')
    }
  }, [imageUrl])

  if (!isOpen) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* 背景 */}
      <div className="absolute inset-0 bg-black/80" />

      {/* 内容 */}
      <div
        className="relative max-w-[90vw] max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 工具栏 */}
        <div className="mb-2 flex items-center justify-between px-2">
          <span className="text-white text-sm truncate max-w-[200px]" title={imageName}>
            {imageName}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
              title="下载图片"
            >
              <Download className="size-5 text-white" />
            </button>
            <button
              onClick={handleCopy}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
              title="复制图片"
            >
              {copied ? (
                <Check className="size-5 text-green-400" />
              ) : (
                <Copy className="size-5 text-white" />
              )}
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
              title="关闭"
            >
              <X className="size-5 text-white" />
            </button>
          </div>
        </div>

        {/* 图片 */}
        <div className={cn(
          "relative rounded-lg overflow-hidden bg-black",
          isLoading && "flex items-center justify-center min-w-[200px] min-h-[200px]"
        )}>
          {isLoading && (
            <div className="text-muted-foreground text-sm">加载中...</div>
          )}
          <img
            src={imageUrl}
            alt={imageName}
            className={cn(
              "max-w-[90vw] max-h-[85vh] object-contain",
              isLoading && "hidden"
            )}
            onLoad={() => setIsLoading(false)}
            onError={() => setIsLoading(false)}
          />
        </div>
      </div>
    </div>,
    document.body,
  )
}
