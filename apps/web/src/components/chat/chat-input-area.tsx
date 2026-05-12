import { cn } from '@/lib/utils'
import { Image, Send } from 'lucide-react'
import { MentionInput } from './mention-input'
import { ImagePreviewList, PendingImage } from './image-preview-list'
import { useRef, useState, DragEvent, ChangeEvent, ClipboardEvent, memo } from 'react'
import { useChatStore } from '@/stores/chat-store'
import { useIsMobile } from '@/hooks/use-mobile'

interface MentionAgent {
  id: string
  name: string
  avatar?: string | null
  avatarColor?: string | null
  description?: string | null
}

interface ChatInputAreaProps {
  chatRoomName: string
  // inputValue 和 setInputValue 现在从 store 直接获取，避免父组件重渲染导致的问题
  handleKeyDown: (e: React.KeyboardEvent) => void
  handleSend: () => void
  mentionAgents: MentionAgent[]
  onMentionClick?: (agentId: string, agentName: string) => void
  // 图片上传相关
  pendingImages?: PendingImage[]
  onImageSelect?: (files: File[]) => void
  onImageRemove?: (id: string) => void
}

// 使用 memo 包装组件，避免因父组件其他状态更新而重渲染
// 由于 inputValue 和 setInputValue 直接从 store 获取，输入状态不受父组件影响
export const ChatInputArea = memo(function ChatInputArea({
  chatRoomName: _chatRoomName,
  handleKeyDown,
  handleSend,
  mentionAgents,
  onMentionClick,
  pendingImages = [],
  onImageSelect,
  onImageRemove,
}: ChatInputAreaProps) {
  // 直接从 store 获取 inputValue 和 setInputValue，避免因父组件其他状态更新而重渲染
  const inputValue = useChatStore((s) => s.inputValue)
  const setInputValue = useChatStore((s) => s.setInputValue)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const isMobile = useIsMobile()

  // 点击图片按钮
  const handleImageButtonClick = () => {
    fileInputRef.current?.click()
  }

  // 文件选择
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0 && onImageSelect) {
      // 过滤只保留图片文件
      const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'))
      if (imageFiles.length > 0) {
        onImageSelect(imageFiles)
      }
    }
    // 清空 input，允许再次选择相同文件
    e.target.value = ''
  }

  // 拖拽处理
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const files = e.dataTransfer.files
    if (files && files.length > 0 && onImageSelect) {
      const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'))
      if (imageFiles.length > 0) {
        onImageSelect(imageFiles)
      }
    }
  }

  // 粘贴处理
  const handlePaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData.items
    if (!items || !onImageSelect) return

    const imageFiles: File[] = []
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          imageFiles.push(file)
        }
      }
    }

    if (imageFiles.length > 0) {
      onImageSelect(imageFiles)
    }
  }

  // 是否可以发送
  const canSend = inputValue.trim() || pendingImages.some(img => img.uploadedData && !img.error)

  // 是否有正在上传的图片
  const hasUploadingImages = pendingImages.some(img => img.uploading)

  return (
    <div
      className={cn(
        "relative shrink-0 border-t border-border bg-[var(--surface-raised)]",
        isMobile ? "px-2.5 py-2.5" : "px-3.5 py-3",
        isDragging && "bg-primary/5"
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onPaste={handlePaste}
    >
      {/* 拖拽提示 */}
      {isDragging && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-primary/50 bg-primary/5">
          <p className="text-primary font-medium">拖放图片到这里上传</p>
        </div>
      )}

      {/* 图片预览区域 */}
      {pendingImages.length > 0 && (
        <div className="mb-2">
          <ImagePreviewList images={pendingImages} onRemove={onImageRemove} />
        </div>
      )}

      {/* Input area */}
      <div className="flex min-h-11 items-center gap-2 rounded-md border border-border bg-[var(--surface)] px-2.5 py-2 transition-colors focus-within:border-primary focus-within:shadow-[0_0_0_2px_oklch(0.55_0.22_250/0.10)]">
        <MentionInput
          value={inputValue}
          onChange={setInputValue}
          onKeyDown={handleKeyDown}
          placeholder={`发送消息或 @ 助手…`}
          agents={mentionAgents}
          className="flex-1 min-w-0"
          onMentionClick={onMentionClick}
        />

        {/* 工具按钮 */}
        <div className="flex shrink-0 items-center gap-1 self-end">
          {/* 图片上传按钮 */}
          <button
            type="button"
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--surface-subtle)] hover:text-foreground"
            onClick={handleImageButtonClick}
            title="上传图片"
          >
            <Image className="size-4" />
          </button>
          {/* 隐藏的文件输入 */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />

          {/* 发送按钮 */}
          <button
            type="button"
            disabled={!canSend || hasUploadingImages}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors",
              canSend && !hasUploadingImages
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-[var(--surface-subtle)] text-muted-foreground disabled:opacity-50"
            )}
            title="发送"
            onMouseDown={(e) => {
              e.preventDefault()
            }}
            onClick={() => {
              const currentInputValue = useChatStore.getState().inputValue
              const currentPendingImages = useChatStore.getState().pendingImages
              const trimmedInput = currentInputValue.trim()
              const uploadedImages = currentPendingImages.filter(img => img.uploadedData && !img.error)
              const currentHasUploadingImages = currentPendingImages.some(img => img.uploading)

              if ((trimmedInput || uploadedImages.length > 0) && !currentHasUploadingImages) {
                handleSend()
              }
            }}
          >
            <Send className="size-3.5" />
            发送
          </button>
        </div>
      </div>
    </div>
  )
})
