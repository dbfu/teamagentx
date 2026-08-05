import { Download, Loader2, RefreshCw, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { FetchedModel } from '@/lib/llm-provider-api'

interface ModelSelectorProps {
  id?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  models: FetchedModel[]
  isLoading: boolean
  onFetch: () => void
}

export function ModelSelector({
  id,
  value,
  onChange,
  placeholder,
  models,
  isLoading,
  onFetch,
}: ModelSelectorProps) {
  const { t } = useTranslation()
  const grouped = new Map<string, FetchedModel[]>()

  for (const model of models) {
    const owner = model.ownedBy || t('model.otherModels')
    const current = grouped.get(owner) ?? []
    current.push(model)
    grouped.set(owner, current)
  }

  const owners = [...grouped.keys()].sort((a, b) => a.localeCompare(b))

  return (
    <div className="flex gap-2">
      <input
        id={id}
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="ta-input min-w-0 flex-1 shadow-none"
      />

      {models.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="icon" className="shrink-0" title={t('model.selectFetchedModel')}>
              <ChevronDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="z-[200] max-h-72 max-w-[min(32rem,calc(100vw-2rem))] overflow-y-auto">
            <DropdownMenuLabel>{t('model.availableModels', { count: models.length })}</DropdownMenuLabel>
            {owners.map((owner, ownerIndex) => (
              <div key={owner}>
                {ownerIndex > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="text-xs text-muted-foreground">{owner}</DropdownMenuLabel>
                {grouped.get(owner)?.map(model => (
                  <DropdownMenuItem
                    key={model.id}
                    onSelect={() => onChange(model.id)}
                    className="max-w-full font-mono text-xs"
                    title={model.id}
                  >
                    <span className="truncate">{model.id}</span>
                  </DropdownMenuItem>
                ))}
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0 gap-1.5 whitespace-nowrap"
        onClick={onFetch}
        disabled={isLoading}
        title={models.length > 0 ? t('model.refreshModels') : t('model.fetchModels')}
      >
        {isLoading ? <Loader2 className="size-4 animate-spin" /> : models.length > 0 ? <RefreshCw className="size-4" /> : <Download className="size-4" />}
        <span>{isLoading ? t('common.loading') : models.length > 0 ? t('model.refreshModels') : t('model.fetchModels')}</span>
      </Button>
    </div>
  )
}
