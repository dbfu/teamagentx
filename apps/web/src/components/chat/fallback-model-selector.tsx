import { Checkbox } from '@/components/ui/checkbox'
import type { LlmProvider } from '@/lib/llm-provider-api'
import { useTranslation } from 'react-i18next'

interface FallbackModelSelectorProps {
  providers: LlmProvider[]
  primaryProviderId: string
  selectedIds: string[]
  onChange: (ids: string[]) => void
}

export function FallbackModelSelector({
  providers,
  primaryProviderId,
  selectedIds,
  onChange,
}: FallbackModelSelectorProps) {
  const { t } = useTranslation()
  const fallbackProviders = providers.filter((provider) => provider.id !== primaryProviderId)

  const toggleProvider = (providerId: string) => {
    if (selectedIds.includes(providerId)) {
      onChange(selectedIds.filter((id) => id !== providerId))
      return
    }
    onChange([...selectedIds, providerId])
  }

  return (
    <div className="mb-4">
      <label className="mb-1.5 block text-sm font-medium text-foreground">
        {t('assistant.fallbackModels')}
      </label>
      {fallbackProviders.length === 0 ? (
        <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
          {t('assistant.noFallbackModels')}
        </div>
      ) : (
        <div className="max-h-40 overflow-y-auto rounded-lg border border-border">
          {fallbackProviders.map((provider) => {
            const checked = selectedIds.includes(provider.id)
            return (
              <label
                key={provider.id}
                className="flex cursor-pointer items-start gap-3 border-b border-border px-3 py-2 last:border-b-0 hover:bg-accent/60"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => toggleProvider(provider.id)}
                  className="mt-0.5"
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
      <p className="mt-1.5 text-xs text-muted-foreground">
        {t('assistant.fallbackModelsHint')}
      </p>
    </div>
  )
}
