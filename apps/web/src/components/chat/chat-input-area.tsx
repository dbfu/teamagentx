import { cn } from '@/lib/utils'
import { Image, Loader2, Maximize2, Mic, Minimize2, Send, Square } from 'lucide-react'
import { MentionInput, MentionInputRef } from './mention-input'
import { ImagePreviewList, PendingImage } from './image-preview-list'
import { useRef, useState, useEffect, DragEvent, ChangeEvent, ClipboardEvent, memo } from 'react'
import { useChatStore } from '@/stores/chat-store'
import { useIsMobile } from '@/hooks/use-mobile'
import { toast } from 'sonner'
import { getApiBaseUrl } from '@/lib/config'
import { llmProviderApi } from '@/lib/llm-provider-api'
import { isLargeInputContent } from './chat-input-collapse'
import { GitBranchSwitcher } from './git-branch-switcher'

interface MentionAgent {
  id: string
  name: string
  avatar?: string | null
  avatarColor?: string | null
  description?: string | null
}

interface ChatInputAreaProps {
  chatRoomId: string
  chatRoomWorkDir?: string | null
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
  chatRoomId,
  chatRoomWorkDir,
  chatRoomName,
  handleKeyDown,
  handleSend,
  mentionAgents,
  onMentionClick,
  pendingImages = [],
  onImageSelect,
  onImageRemove,
}: ChatInputAreaProps) {
  const inputValue = useChatStore((s) => s.inputDraftsByRoom[chatRoomId] ?? '')
  const setInputValue = useChatStore((s) => s.setInputValue)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mentionInputRef = useRef<MentionInputRef>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [hasSttProvider, setHasSttProvider] = useState<boolean | null>(null)
  const [isInputExpanded, setIsInputExpanded] = useState(false)
  const isMountedRef = useRef(true)   // #31: 组件挂载状态跟踪
  const isMobile = useIsMobile()

  // 切换群聊时自动聚焦输入框
  useEffect(() => {
    // 延迟聚焦，等待 DOM 更新完成
    const timer = setTimeout(() => {
      mentionInputRef.current?.focus()
    }, 100)
    return () => clearTimeout(timer)
  }, [chatRoomId])

  // #30: 组件卸载时清理 MediaRecorder 和媒体流
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try { mediaRecorderRef.current.stop() } catch { /* ignore */ }
      }
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop())
      mediaStreamRef.current = null
    }
  }, [])

  useEffect(() => {
    llmProviderApi.getAll().then((res) => {
      if (res.success && res.data) {
        const has = res.data.some(
          (p) => p.modelType === 'audio' && p.isActive && (p.audioUsage === 'stt' || p.audioUsage === 'both'),
        )
        setHasSttProvider(has)
      }
    }).catch(() => {
      // #37: 检测失败时设为 null（不影响其他功能），后续点击录音时再提示
      setHasSttProvider(null)
    })
  }, [])

  useEffect(() => {
    if (!isRecording) {
      setRecordingSeconds(0)
      return
    }
    const timer = setInterval(() => {
      setRecordingSeconds((s) => {
        // #38: 超过 120 秒自动停止录音
        if (s >= 119) {
          toast.info('录音已达最大时长（2分钟），自动停止')
          mediaRecorderRef.current?.stop()
          setIsRecording(false)
          return 0
        }
        return s + 1
      })
    }, 1000)
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
  const hasLargeInputContent = isLargeInputContent(inputValue)

  useEffect(() => {
    if (!inputValue) {
      setIsInputExpanded(false)
    }
  }, [inputValue])

  const handleAudioButtonClick = async () => {
    // 停止录音
    if (isRecording) {
      mediaRecorderRef.current?.stop()
      setIsRecording(false)
      return
    }

    // 浏览器不支持 MediaRecorder
    if (typeof MediaRecorder === 'undefined') {
      toast.error('当前浏览器不支持录音，请手动输入')
      return
    }

    // 未配置语音识别模型
    if (hasSttProvider === false) {
      toast.error('请先在模型管理中添加语音类型（STT/both）模型', {
        action: { label: '去配置', onClick: () => window.location.hash = '#/models' },
      })
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      toast.error('请允许麦克风权限后重试')
      return
    }

    mediaStreamRef.current = stream
    audioChunksRef.current = []

    const recorder = new MediaRecorder(stream)
    mediaRecorderRef.current = recorder

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data)
    }

    recorder.onstop = async () => {
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop())
      mediaStreamRef.current = null

      const chunks = audioChunksRef.current
      audioChunksRef.current = []

      const recordedMimeType = recorder.mimeType || 'audio/webm'
      const blob = new Blob(chunks, { type: recordedMimeType })

      // #42: blob 太小时 toast 提示
      if (blob.size < 1000) {
        toast.info('录音太短，请重试')
        return
      }

      // #36: 根据 mimeType 动态生成文件名扩展名（Safari 录音为 mp4）
      let fileExt = 'webm'
      if (recordedMimeType.includes('mp4') || recordedMimeType.includes('m4a')) fileExt = 'mp4'
      else if (recordedMimeType.includes('ogg')) fileExt = 'ogg'
      else if (recordedMimeType.includes('wav')) fileExt = 'wav'

      setIsProcessing(true)
      try {
        const baseUrl = await getApiBaseUrl()
        const token = localStorage.getItem('auth_token') ?? ''
        const form = new FormData()
        form.append('file', blob, `recording.${fileExt}`)

        const response = await fetch(`${baseUrl}/speech/stt`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        })

        // #31: 检查组件是否仍挂载
        if (!isMountedRef.current) return

        if (!response.ok) {
          const errJson = await response.json().catch(() => ({})) as { error?: string }
          throw new Error(errJson.error || '语音识别失败')
        }

        const json = await response.json() as { text?: string }
        const text = (json.text ?? '').trim()
        if (text) {
          const current = useChatStore.getState().inputDraftsByRoom[chatRoomId] ?? ''
          setInputValue(current ? `${current} ${text}` : text, chatRoomId)
        } else {
          toast.info('未识别到语音内容，请重试')
        }
      } catch (err) {
        if (!isMountedRef.current) return
        toast.error(err instanceof Error ? err.message : '语音识别失败，请稍后重试')
      } finally {
        if (isMountedRef.current) setIsProcessing(false)
      }
    }

    recorder.start()
    setIsRecording(true)
  }

  const leftInputActions = (
    <div className="flex items-center gap-1 shrink-0">
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

      {hasSttProvider === true && (
        <>
          {isRecording && (
            <span className="min-w-[2.5rem] text-center text-xs font-mono text-red-500">
              {`${Math.floor(recordingSeconds / 60)}:${String(recordingSeconds % 60).padStart(2, '0')}`}
            </span>
          )}
          {isProcessing && (
            <span className="text-xs text-muted-foreground">识别中</span>
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
        </>
      )}
    </div>
  )

  const inputEditor = (
    <MentionInput
      ref={mentionInputRef}
      value={inputValue}
      onChange={(value) => setInputValue(value, chatRoomId)}
      onKeyDown={handleKeyDown}
      placeholder={`发送至${chatRoomName}`}
      agents={mentionAgents}
      className={cn(
        "min-w-0",
        isInputExpanded ? "w-full" : "flex-1",
        isInputExpanded && (
          isMobile
            ? "[&_[contenteditable=true]]:!min-h-32 [&_[contenteditable=true]]:!max-h-[42vh]"
            : "[&_[contenteditable=true]]:!min-h-36 [&_[contenteditable=true]]:!max-h-[48vh]"
        )
      )}
      onMentionClick={onMentionClick}
    />
  )

  const rightInputActions = (
    <div className="flex items-center gap-1 shrink-0">
      <button
        type="button"
        className={cn(
          "rounded transition-colors touch-manipulation",
          isMobile ? "p-2.5" : "p-1.5",
          isInputExpanded
            ? "text-blue-500 hover:bg-blue-500/10 active:bg-blue-500/20"
            : "text-muted-foreground hover:text-foreground hover:bg-accent"
        )}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setIsInputExpanded((expanded) => !expanded)}
        title={isInputExpanded ? '收起输入区' : '展开输入区'}
        aria-label={isInputExpanded ? '收起输入区' : '展开输入区'}
        aria-pressed={isInputExpanded}
      >
        {isInputExpanded ? (
          <Minimize2 className="size-4" />
        ) : (
          <Maximize2 className="size-4" />
        )}
      </button>

      <button
        type="button"
        disabled={!canSend || hasUploadingImages || isRecording}
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
          const currentInputValue = useChatStore.getState().inputDraftsByRoom[chatRoomId] ?? ''
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
  )

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

      <GitBranchSwitcher
        chatRoomId={chatRoomId}
        workDir={chatRoomWorkDir}
        className="mb-1.5 justify-end pr-1"
      />

      <div
        className={cn(
          "rounded-lg border border-border px-3 py-2 transition-shadow",
          isInputExpanded
            ? "flex flex-col items-stretch gap-2"
            : "flex items-center gap-2",
          hasLargeInputContent && !isInputExpanded && "shadow-[inset_0_-10px_14px_-16px_rgba(15,23,42,0.5)]"
        )}
      >
        {isInputExpanded ? (
          <>
            {inputEditor}
            <div className="flex items-center justify-between gap-2">
              {leftInputActions}
              {rightInputActions}
            </div>
          </>
        ) : (
          <>
            {leftInputActions}
            {inputEditor}
            {rightInputActions}
          </>
        )}
      </div>
    </div>
  )
})
