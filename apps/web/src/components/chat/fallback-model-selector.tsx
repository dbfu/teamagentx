import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { LlmProvider } from '@/lib/llm-provider-api'
import { cn } from '@/lib/utils'
import { GripVertical, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface FallbackModelSelectorProps {
  providers: LlmProvider[]
  primaryProviderId: string
  selectedIds: string[]
  onChange: (ids: string[]) => void
}

interface SortableFallbackModelProps {
  provider: LlmProvider
  onRemove: (providerId: string) => void
}

function SortableFallbackModel({ provider, onRemove }: SortableFallbackModelProps) {
  const { t } = useTranslation()
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: provider.id })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        'flex items-center gap-2 border-b border-border bg-background px-2 py-2 last:border-b-0',
        isDragging && 'relative z-10 opacity-70 shadow-md',
      )}
    >
      <button
        type="button"
        className="cursor-grab rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
        title={t('assistant.dragFallbackModel')}
        aria-label={t('assistant.dragFallbackModel')}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-foreground">{provider.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{provider.model}</span>
      </span>
      <button
        type="button"
        onClick={() => onRemove(provider.id)}
        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        title={t('assistant.removeFallbackModel')}
        aria-label={t('assistant.removeFallbackModel')}
      >
        <X className="size-4" />
      </button>
    </div>
  )
}

export function FallbackModelSelector({
  providers,
  primaryProviderId,
  selectedIds,
  onChange,
}: FallbackModelSelectorProps) {
  const { t } = useTranslation()
  const [isSelectorOpen, setIsSelectorOpen] = useState(false)
  const [draftSelectedIds, setDraftSelectedIds] = useState<string[]>([])
  const fallbackProviders = providers.filter((provider) => provider.id !== primaryProviderId)
  const providerById = new Map(fallbackProviders.map((provider) => [provider.id, provider]))
  const selectedProviders = selectedIds
    .map((id) => providerById.get(id))
    .filter((provider): provider is LlmProvider => Boolean(provider))
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const openSelector = () => {
    setDraftSelectedIds(selectedProviders.map((provider) => provider.id))
    setIsSelectorOpen(true)
  }

  const toggleDraftProvider = (providerId: string) => {
    setDraftSelectedIds((currentIds) => (
      currentIds.includes(providerId)
        ? currentIds.filter((id) => id !== providerId)
        : [...currentIds, providerId]
    ))
  }

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return

    const oldIndex = selectedIds.indexOf(String(active.id))
    const newIndex = selectedIds.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return

    onChange(arrayMove(selectedIds, oldIndex, newIndex))
  }

  const removeProvider = (providerId: string) => {
    onChange(selectedIds.filter((id) => id !== providerId))
  }

  const confirmSelection = () => {
    onChange(draftSelectedIds.filter((id) => providerById.has(id)))
    setIsSelectorOpen(false)
  }

  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <label className="block text-sm font-medium text-foreground">
          {t('assistant.fallbackModels')}
        </label>
        <button
          type="button"
          onClick={openSelector}
          disabled={fallbackProviders.length === 0}
          className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="size-3.5" />
          {t('assistant.selectFallbackModels')}
        </button>
      </div>

      {selectedProviders.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">
          {fallbackProviders.length === 0
            ? t('assistant.noFallbackModels')
            : t('assistant.noSelectedFallbackModels')}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={selectedProviders.map((provider) => provider.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="overflow-hidden rounded-lg border border-border">
              {selectedProviders.map((provider) => (
                <SortableFallbackModel
                  key={provider.id}
                  provider={provider}
                  onRemove={removeProvider}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <p className="mt-1.5 text-xs text-muted-foreground">
        {t('assistant.fallbackModelsHint')}
      </p>

      <Dialog open={isSelectorOpen} onOpenChange={setIsSelectorOpen}>
        <DialogContent className="z-[70] gap-0 p-0 sm:max-w-md">
          <DialogHeader className="border-b border-border px-6 py-4">
            <DialogTitle>{t('assistant.selectFallbackModelsTitle')}</DialogTitle>
            <DialogDescription>
              {t('assistant.selectFallbackModelsDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[50vh] overflow-y-auto p-4">
            {fallbackProviders.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {t('assistant.noFallbackModels')}
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                {fallbackProviders.map((provider) => {
                  const checked = draftSelectedIds.includes(provider.id)
                  return (
                    <label
                      key={provider.id}
                      className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0 hover:bg-accent/60"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleDraftProvider(provider.id)}
                        className="shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-foreground">{provider.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{provider.model}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          <DialogFooter className="border-t border-border px-6 py-4">
            <button
              type="button"
              onClick={() => setIsSelectorOpen(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={confirmSelection}
              className="rounded-lg bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600"
            >
              {t('common.confirm')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
