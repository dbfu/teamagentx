import { cn } from '@/lib/utils'
import { X, Download, ExternalLink } from 'lucide-react'
import { useState } from 'react'

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

  if (!isOpen) return null

  const handleDownload = () => {
    const link = document.createElement('a')
    link.href = imageUrl
    link.download = imageName
    link.target = '_blank'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleOpenExternal = () => {
    window.open(imageUrl, '_blank')
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
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
        <div className="flex items-center justify-between mb-2 px-2">
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
              onClick={handleOpenExternal}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
              title="在新窗口打开"
            >
              <ExternalLink className="size-5 text-white" />
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
    </div>
  )
}