import { cn } from '@/lib/utils'
import { X, Loader2, AlertCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * 待上传图片状态
 */
export interface PendingImage {
  id: string
  file: File
  preview: string  // 本地预览 URL (blob URL)
  uploading: boolean
  uploadedData?: {
    url: string
    filename: string
    mimeType: string
    size: number
    width: number
    height: number
    base64: string
  }
  error?: string
}

interface ImagePreviewListProps {
  images: PendingImage[]
  onRemove?: (id: string) => void
}

/**
 * 图片预览列表组件
 * 显示待上传/已上传的图片，支持删除和状态显示
 */
export function ImagePreviewList({ images, onRemove }: ImagePreviewListProps) {
  const { t } = useTranslation()
  if (images.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 mb-3 p-2 bg-muted rounded-lg">
      {images.map((image) => (
        <div
          key={image.id}
          className="relative group"
        >
          {/* 预览图片 */}
          <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-border bg-card">
            <img
              src={image.preview}
              alt={image.file.name}
              className="w-full h-full object-cover"
            />

            {/* 上传中遮罩 */}
            {image.uploading && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <Loader2 className="size-5 text-white animate-spin" />
              </div>
            )}

            {/* 错误状态 */}
            {image.error && (
              <div className="absolute inset-0 bg-red-500/80 flex flex-col items-center justify-center">
                <AlertCircle className="size-4 text-white mb-1" />
                <span className="text-xs text-white px-1 text-center truncate max-w-full">
                  {image.error}
                </span>
              </div>
            )}
          </div>

          {/* 删除按钮 */}
          {onRemove && !image.uploading && (
            <button
              onClick={() => onRemove(image.id)}
              className={cn(
                "absolute -top-1.5 -right-1.5 size-5 rounded-full",
                "bg-muted-foreground text-white flex items-center justify-center",
                "opacity-0 group-hover:opacity-100 transition-opacity",
                "hover:bg-muted-foreground/80 shadow-sm"
              )}
              title={t('chat.deleteImage')}
            >
              <X className="size-3" />
            </button>
          )}

          {/* 文件名提示 */}
          <p className="text-xs text-muted-foreground mt-1 truncate w-20" title={image.file.name}>
            {image.file.name.length > 12
              ? `${image.file.name.slice(0, 8)}...${image.file.name.slice(-4)}`
              : image.file.name}
          </p>
        </div>
      ))}
    </div>
  )
}