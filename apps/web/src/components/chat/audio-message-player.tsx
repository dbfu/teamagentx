import { Play, Volume2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const totalSeconds = Math.floor(seconds)
  const minutes = Math.floor(totalSeconds / 60)
  const remainSeconds = totalSeconds % 60
  return `${minutes}:${String(remainSeconds).padStart(2, '0')}`
}

interface AudioMessagePlayerProps {
  src: string
  mimeType: string
  title?: string
  transcript?: string | null
  durationMs?: number | null
  className?: string
}

export function AudioMessagePlayer({
  src,
  mimeType,
  title,
  transcript,
  durationMs,
  className,
}: AudioMessagePlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [loadedDuration, setLoadedDuration] = useState(0)
  const [hasPlaybackError, setHasPlaybackError] = useState(false)

  const resolvedDuration = useMemo(() => {
    if (loadedDuration > 0) return loadedDuration
    if (durationMs && durationMs > 0) return durationMs / 1000
    return 0
  }, [durationMs, loadedDuration])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleLoadedMetadata = () => {
      setLoadedDuration(audio.duration || 0)
      setHasPlaybackError(false)
    }
    const handleTimeUpdate = () => setCurrentTime(audio.currentTime)
    const handleEnded = () => {
      setIsPlaying(false)
      setCurrentTime(0)
    }
    const handlePause = () => setIsPlaying(false)
    const handlePlay = () => setIsPlaying(true)
    const handleError = () => {
      setIsPlaying(false)
      setHasPlaybackError(true)
    }

    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('play', handlePlay)
    audio.addEventListener('error', handleError)

    return () => {
      audio.pause()
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('pause', handlePause)
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('error', handleError)
    }
  }, [src])

  const handleTogglePlay = async () => {
    const audio = audioRef.current
    if (!audio) return

    if (audio.paused) {
      try {
        setHasPlaybackError(false)
        await audio.play()
      } catch {
        setHasPlaybackError(true)
      }
      return
    }

    audio.pause()
  }

  const handleSeek = (value: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = value
    setCurrentTime(value)
  }

  const normalizedTitle = title?.trim() || ''
  const safeTitle = !normalizedTitle || /^recording-\d+\./.test(normalizedTitle)
    ? '语音消息'
    : normalizedTitle
  const transcriptText = transcript?.trim()

  return (
    <div className={cn('w-full max-w-md rounded-2xl border border-border bg-card p-3 shadow-sm', className)}>
      <audio ref={audioRef} preload="metadata">
        <source src={src} type={mimeType} />
      </audio>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleTogglePlay}
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white transition-colors hover:bg-blue-600"
          title={isPlaying ? '暂停' : '播放'}
          aria-label={isPlaying ? '暂停' : '播放'}
          aria-pressed={isPlaying}
        >
          {isPlaying ? (
            <span className="flex items-end gap-[3px] h-4 text-white" aria-hidden>
              <span className="voice-bar voice-bar-1" />
              <span className="voice-bar voice-bar-2" />
              <span className="voice-bar voice-bar-3" />
            </span>
          ) : (
            <Play className="ml-0.5 size-4" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Volume2 className="size-4 shrink-0 text-blue-500" />
            <span className="truncate text-sm font-medium text-foreground">{safeTitle}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={resolvedDuration || 0}
              step={0.1}
              value={Math.min(currentTime, resolvedDuration || currentTime)}
              onChange={(e) => handleSeek(Number(e.target.value))}
              className="h-1.5 w-full cursor-pointer accent-blue-500"
              aria-label="播放进度"
            />
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatAudioTime(currentTime)} / {formatAudioTime(resolvedDuration)}
            </span>
          </div>
        </div>
      </div>

      {transcriptText ? (
        <div className="mt-3 rounded-xl bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
          {transcriptText}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground/60">未转写</p>
      )}

      {hasPlaybackError && (
        <div role="alert" className="mt-2 text-xs text-red-500">
          语音播放失败，请确认音频文件仍可访问。
        </div>
      )}
    </div>
  )
}
