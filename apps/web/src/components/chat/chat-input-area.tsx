import { cn } from '@/lib/utils'
import { Image, Loader2, Mic, Send, Square } from 'lucide-react'
import { MentionInput } from './mention-input'
import { ImagePreviewList, PendingImage } from './image-preview-list'
import { useRef, useState, useEffect, DragEvent, ChangeEvent, ClipboardEvent, memo } from 'react'
import { useChatStore } from '@/stores/chat-store'
import { useIsMobile } from '@/hooks/use-mobile'
import { toast } from 'sonner'
import { startBrowserSpeechRecognition, supportsBrowserSpeechRecognition } from '@/lib/browser-speech'

interface MentionAgent {
  id: string
  name: string
  avatar?: string | null
  avatarColor?: string | null
  description?: string | null
}

interface ChatInputAreaProps {
  chatRoomName: string
  handleKeyDown: (e: React.KeyboardEvent) => void
  handleSend: () => void
  mentionAgents: MentionAgent[]
  onMentionClick?: (agentId: string, agentName: string) => void
  pendingImages?: PendingImage[]
  onImageSelect?: (files: File[]) => void
  onImageRemove?: (id: string) => void
}

export const ChatInputArea = memo(function ChatInputArea({
  chatRoomName,
  handleKeyDown,
  handleSend,
  mentionAgents,
  onMentionClick,
  pendingImages = [],
  onImageSelect,
  onImageRemove,
}: ChatInputAreaProps) {
  const inputValue = useChatStore((s) => s.inputValue)
  const setInputValue = useChatStore((s) => s.setInputValue)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const speechSessionRef = useRef<ReturnType<typeof startBrowserSpeechRecognition> | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const isMobile = useIsMobile()

  useEffect(() => {
    if (!isRecording) {
      setRecordingSeconds(0)
      return
    }
    const timer = setInterval(() => setRecordingSeconds((s) => s + 1), 1000)
    return () => clearInterval(timer)
  }, [isRecording])

  const handleImageButtonClick = () => fileInputRef.current?.click()

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0 && onImageSelect) {
      const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'))
      if (imageFiles.length > 0) onImageSelect(imageFiles)
    }
    e.target.value = ''
  }

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
      if (imageFiles.length > 0) onImageSelect(imageFiles)
    }
  }

  const handlePaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData.items
    if (!items || !onImageSelect) return
    const imageFiles: File[] = []
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) imageFiles.push(file)
      }
    }
    if (imageFiles.length > 0) onImageSelect(imageFiles)
  }

  const canSend = inputValue.trim() || pendingImages.some(img => img.uploadedData && !img.error)
  const hasUploadingImages = pendingImages.some(img => img.uploading)

  const handleAudioButtonClick = async () => {
    // 停止录音
    if (isRecording) {
      const session = speechSessionRef.current
      if (!session) return
      setIsRecording(false)
      setIsProcessing(true)
      try {
        const transcript = await session.stop()
        speechSessionRef.current = null
        if (transcript.trim()) {
          const current = useChatStore.getState().inputValue
          setInputValue(current ? `${current} ${transcript}` : transcript)
        } else {
          toast.info('未识别到语音内容，请手动输入或重试')
        }
      } catch {
        toast.error('语音识别失败')
      } finally {
        setIsProcessing(false)
      }
      return
    }

    // 启动录音
    if (!supportsBrowserSpeechRecognition()) {
      toast.error('当前浏览器不支持语音输入，请手动输入')
      return
    }

    const session = startBrowserSpeechRecognition()
    if (!session) {
      toast.error('无法启动语音识别')
      return
    }

    speechSessionRef.current = session
    setIsRecording(true)
  }

  return (
    <div
      className={cn(
        "relative shrink-0",
        isMobile ? "px-3 pt-2 pb-6 bg-background border-t border-border" : "px-4 pt-2 pb-5",
        isDragging && "bg-primary/5"
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onPaste={handlePaste}
    >
      {isDragging && (
        <div className="absolute inset-0 flex items-center justify-center bg-primary/5 border-2 border-dashed border-primary/50 rounded-lg z-10">
          <p className="text-primary font-medium">拖放图片到这里上传</p>
        </div>
      )}

      {pendingImages.length > 0 && (
        <div className="mb-2">
          <ImagePreviewList images={pendingImages} onRemove={onImageRemove} />
        </div>
      )}

      <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
        <MentionInput
          value={inputValue}
          onChange={setInputValue}
          onKeyDown={handleKeyDown}
          placeholder={`发送至${chatRoomName}`}
          agents={mentionAgents}
          className="flex-1 min-w-0"
          onMentionClick={onMentionClick}
        />

        <div className="flex items-center gap-1 shrink-0">
          {isRecording && (
            <span className="min-w-[2.5rem] text-center text-xs font-mono text-red-500">
              {`${Math.floor(recordingSeconds / 60)}:${String(recordingSeconds % 60).padStart(2, '0')}`}
            </span>
          )}

          <button
            type="button"
            className={cn(
              "rounded transition-colors touch-manipulation",
              isMobile ? "p-2.5" : "p-1.5",
              isRecording
                ? "bg-red-500/10 text-red-500 hover:bg-red-500/20"
                : "text-muted-foreground hover:text-foreground hover:bg-accent",
              isProcessing && "opacity-70"
            )}
            onClick={handleAudioButtonClick}
            title={isRecording ? '完成录音' : '语音输入'}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : isRecording ? (
              <Square className="size-4 fill-current" />
            ) : (
              <Mic className="size-4" />
            )}
          </button>

          <button
            type="button"
            className={cn(
              "rounded transition-colors touch-manipulation",
              isMobile ? "p-2.5 text-muted-foreground hover:text-foreground hover:bg-accent active:bg-accent" : "p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent"
            )}
            onClick={handleImageButtonClick}
            title="上传图片"
          >
            <Image className="size-4" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />

          <button
            type="button"
            disabled={!canSend || hasUploadingImages}
            className={cn(
              "rounded transition-colors touch-manipulation",
              isMobile ? "p-2.5" : "p-1.5",
              canSend && !hasUploadingImages && !isRecording
                ? "text-blue-500 hover:bg-blue-500/10 active:bg-blue-500/20"
                : "text-muted-foreground hover:bg-accent disabled:opacity-50"
            )}
            title="发送"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const currentInputValue = useChatStore.getState().inputValue
              const currentPendingImages = useChatStore.getState().pendingImages
              const trimmedInput = currentInputValue.trim()
              const uploadedImages = currentPendingImages.filter(img => img.uploadedData && !img.error)
              const currentHasUploadingImages = currentPendingImages.some(img => img.uploading)
              if ((trimmedInput || uploadedImages.length > 0) && !currentHasUploadingImages && !isRecording) {
                handleSend()
              }
            }}
          >
            <Send className="size-4" />
          </button>
        </div>
      </div>
    </div>
  )
})
