import { useCallback, useEffect, useId, useMemo, useState, type ChangeEvent } from 'react'
import { Check, ImagePlus, Trash2, Upload, X } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { isCustomAgentAvatarValue } from '@/lib/agent-avatars'
import { toast } from 'sonner'

const CROP_STAGE_SIZE = 320
const CROP_STAGE_PADDING = 28
const MIN_ZOOM = 1
const MAX_ZOOM = 3

type CropRatioOption = {
  id: string
  label: string
  aspect: number
}

const cropRatioOptions: CropRatioOption[] = [
  { id: '1:1', label: '1:1', aspect: 1 },
  { id: '4:3', label: '4:3', aspect: 4 / 3 },
  { id: '3:4', label: '3:4', aspect: 3 / 4 },
]

type CropPosition = {
  x: number
  y: number
}

interface AvatarCropModalProps {
  isOpen: boolean
  imageSrc: string | null
  onClose: () => void
  onConfirm: (avatar: string) => void
}

interface AvatarSelectorProps {
  value: string | number | null | undefined
  onChange: (avatar: string) => void
  options: number[]
  renderAvatar: (avatar: string | number | null | undefined, className?: string) => React.ReactNode
  optionAriaLabel: (index: number) => string
  gridClassName?: string
  itemClassName?: string
  selectedItemClassName?: string
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function getCropFrame(aspect: number) {
  const maxWidth = CROP_STAGE_SIZE - CROP_STAGE_PADDING * 2
  const maxHeight = CROP_STAGE_SIZE - CROP_STAGE_PADDING * 2

  let width = maxWidth
  let height = width / aspect

  if (height > maxHeight) {
    height = maxHeight
    width = height * aspect
  }

  return {
    width,
    height,
    left: (CROP_STAGE_SIZE - width) / 2,
    top: (CROP_STAGE_SIZE - height) / 2,
  }
}

function AvatarCropModal({ isOpen, imageSrc, onClose, onConfirm }: AvatarCropModalProps) {
  const [selectedRatioId, setSelectedRatioId] = useState(cropRatioOptions[0].id)
  const [zoom, setZoom] = useState(MIN_ZOOM)
  const [position, setPosition] = useState<CropPosition>({ x: 0, y: 0 })
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 })
  const [dragState, setDragState] = useState<null | {
    startX: number
    startY: number
    originX: number
    originY: number
  }>(null)

  const selectedRatio = useMemo(
    () => cropRatioOptions.find((option) => option.id === selectedRatioId) ?? cropRatioOptions[0],
    [selectedRatioId],
  )
  const cropFrame = useMemo(() => getCropFrame(selectedRatio.aspect), [selectedRatio.aspect])
  const coverScale = useMemo(() => {
    if (!naturalSize.width || !naturalSize.height) return 1
    return Math.max(cropFrame.width / naturalSize.width, cropFrame.height / naturalSize.height)
  }, [cropFrame.height, cropFrame.width, naturalSize.height, naturalSize.width])
  const displayScale = coverScale * zoom
  const displayWidth = naturalSize.width * displayScale
  const displayHeight = naturalSize.height * displayScale

  const clampPosition = useCallback((nextPosition: CropPosition) => {
    const maxOffsetX = Math.max(0, (displayWidth - cropFrame.width) / 2)
    const maxOffsetY = Math.max(0, (displayHeight - cropFrame.height) / 2)

    return {
      x: clamp(nextPosition.x, -maxOffsetX, maxOffsetX),
      y: clamp(nextPosition.y, -maxOffsetY, maxOffsetY),
    }
  }, [cropFrame.height, cropFrame.width, displayHeight, displayWidth])

  useEffect(() => {
    if (!isOpen) return
    setSelectedRatioId(cropRatioOptions[0].id)
    setZoom(MIN_ZOOM)
    setPosition({ x: 0, y: 0 })
    setNaturalSize({ width: 0, height: 0 })
    setDragState(null)
  }, [imageSrc, isOpen])

  useEffect(() => {
    if (!isOpen) return
    setPosition((currentPosition) => clampPosition(currentPosition))
  }, [cropFrame.height, cropFrame.width, displayHeight, displayWidth, isOpen])

  useEffect(() => {
    if (!dragState) return

    const handlePointerMove = (event: PointerEvent) => {
      setPosition(
        clampPosition({
          x: dragState.originX + event.clientX - dragState.startX,
          y: dragState.originY + event.clientY - dragState.startY,
        }),
      )
    }

    const handlePointerUp = () => {
      setDragState(null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [clampPosition, dragState])

  if (!isOpen || !imageSrc) return null

  const imageLeft = CROP_STAGE_SIZE / 2 - displayWidth / 2 + position.x
  const imageTop = CROP_STAGE_SIZE / 2 - displayHeight / 2 + position.y

  const handleConfirm = () => {
    if (!naturalSize.width || !naturalSize.height || !displayScale) return

    const sourceX = clamp((cropFrame.left - imageLeft) / displayScale, 0, naturalSize.width)
    const sourceY = clamp((cropFrame.top - imageTop) / displayScale, 0, naturalSize.height)
    const sourceWidth = clamp(cropFrame.width / displayScale, 1, naturalSize.width - sourceX)
    const sourceHeight = clamp(cropFrame.height / displayScale, 1, naturalSize.height - sourceY)

    const canvas = document.createElement('canvas')
    const outputWidth = selectedRatio.aspect >= 1 ? 512 : Math.round(512 * selectedRatio.aspect)
    const outputHeight = selectedRatio.aspect >= 1 ? Math.round(512 / selectedRatio.aspect) : 512
    canvas.width = outputWidth
    canvas.height = outputHeight

    const context = canvas.getContext('2d')
    if (!context) return

    const image = new Image()
    image.onload = () => {
      context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        outputWidth,
        outputHeight,
      )
      onConfirm(canvas.toDataURL('image/png'))
    }
    image.src = imageSrc
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-[720px] rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">裁剪头像</h3>
            <p className="text-xs text-gray-500">拖动图片调整位置，使用比例遮罩确认最终范围</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="grid gap-6 p-6 md:grid-cols-[320px_minmax(0,1fr)]">
          <div className="mx-auto">
            <div
              className="relative overflow-hidden rounded-2xl bg-gray-950 touch-none select-none"
              style={{ width: CROP_STAGE_SIZE, height: CROP_STAGE_SIZE }}
            >
              <img
                src={imageSrc}
                alt=""
                draggable={false}
                onLoad={(event) => {
                  setNaturalSize({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                }}
                onPointerDown={(event) => {
                  event.preventDefault()
                  setDragState({
                    startX: event.clientX,
                    startY: event.clientY,
                    originX: position.x,
                    originY: position.y,
                  })
                }}
                className="absolute max-w-none cursor-grab active:cursor-grabbing"
                style={{
                  left: imageLeft,
                  top: imageTop,
                  width: displayWidth,
                  height: displayHeight,
                }}
              />

              <div className="pointer-events-none absolute inset-0">
                <div
                  className="absolute rounded-[28px] border-2 border-white shadow-[0_0_0_9999px_rgba(15,23,42,0.62)]"
                  style={{
                    left: cropFrame.left,
                    top: cropFrame.top,
                    width: cropFrame.width,
                    height: cropFrame.height,
                  }}
                />
              </div>
            </div>
          </div>

          <div className="space-y-5">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">裁剪比例</label>
              <div className="flex flex-wrap gap-2">
                {cropRatioOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setSelectedRatioId(option.id)}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-sm transition-colors',
                      selectedRatioId === option.id
                        ? 'border-blue-500 bg-blue-50 text-blue-600'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <label className="font-medium text-gray-700">缩放</label>
                <span className="text-gray-500">{zoom.toFixed(1)}x</span>
              </div>
              <Slider
                value={[zoom]}
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={0.1}
                onValueChange={(values) => setZoom(values[0] ?? MIN_ZOOM)}
              />
            </div>

            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
              推荐使用清晰的正面头像。导出后会保存为本地裁剪结果，不会保留原图文件路径。
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="rounded-lg bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600"
          >
            确认裁剪
          </button>
        </div>
      </div>
    </div>
  )
}

async function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

export function AvatarSelector({
  value,
  onChange,
  options,
  renderAvatar,
  optionAriaLabel,
  gridClassName,
  itemClassName,
  selectedItemClassName,
}: AvatarSelectorProps) {
  const inputId = useId()
  const [pendingImageSrc, setPendingImageSrc] = useState<string | null>(null)
  const [cropOpen, setCropOpen] = useState(false)
  const currentAvatar = value == null ? '0' : String(value)
  const hasCustomAvatar = isCustomAgentAvatarValue(currentAvatar)

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('请选择图片文件')
      return
    }

    try {
      const dataUrl = await readFileAsDataUrl(file)
      setPendingImageSrc(dataUrl)
      setCropOpen(true)
    } catch {
      toast.error('读取图片失败')
    }
  }

  return (
    <>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <label
            htmlFor={inputId}
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-blue-500 px-3 py-2 text-sm text-white hover:bg-blue-600"
          >
            <Upload className="size-4" />
            {hasCustomAvatar ? '更换本地图片' : '上传本地图片'}
          </label>
          {hasCustomAvatar && (
            <>
              <div className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-blue-600">
                <ImagePlus className="size-4" />
                已选择自定义头像
              </div>
              <button
                type="button"
                onClick={() => onChange('0')}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                <Trash2 className="size-4" />
                移除自定义头像
              </button>
            </>
          )}
          <input
            id={inputId}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        <div className={cn('grid max-h-64 grid-cols-6 gap-2 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2', gridClassName)}>
          {options.map((index) => {
            const optionValue = String(index)
            const isSelected = !hasCustomAvatar && currentAvatar === optionValue

            return (
              <button
                key={index}
                type="button"
                aria-label={optionAriaLabel(index)}
                onClick={() => onChange(optionValue)}
                className={cn(
                  'relative flex items-center justify-center rounded-full transition-all hover:ring-2 hover:ring-blue-200',
                  itemClassName ?? 'size-12',
                  isSelected && 'ring-2 ring-blue-500 ring-offset-2 ring-offset-white',
                  isSelected && selectedItemClassName,
                )}
              >
                {renderAvatar(index, itemClassName ?? 'size-12')}
                {isSelected && (
                  <span className="absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full bg-blue-500 text-white shadow-sm">
                    <Check className="size-3" />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <AvatarCropModal
        isOpen={cropOpen}
        imageSrc={pendingImageSrc}
        onClose={() => {
          setCropOpen(false)
          setPendingImageSrc(null)
        }}
        onConfirm={(avatar) => {
          onChange(avatar)
          setCropOpen(false)
          setPendingImageSrc(null)
        }}
      />
    </>
  )
}
