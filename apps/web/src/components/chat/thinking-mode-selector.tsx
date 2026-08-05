import { useEffect, useMemo, useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  type AcpLocalModel,
  type AgentThinkingMode,
  getThinkingModeOptions,
  THINKING_MODE_I18N_KEY,
} from '@/lib/agent-api'
import { llmProviderApi } from '@/lib/llm-provider-api'
import { useTranslation } from 'react-i18next'

interface ThinkingModeSelectorProps {
  acpTool: string
  providerId?: string | null
  providerModel?: string | null
  modelName?: string | null
  localDefaultModel?: string | null
  localModels?: readonly AcpLocalModel[] | null
  value: AgentThinkingMode
  onChange: (value: AgentThinkingMode) => void
  placeholder: string
}

/**
 * Select a thinking mode using the selected model's Codex metadata when it is
 * available. Providers exposing only the standard OpenAI model list continue
 * to use the fixed SDK-compatible fallback options.
 */
export function ThinkingModeSelector({
  acpTool,
  providerId,
  providerModel,
  modelName,
  localDefaultModel,
  localModels,
  value,
  onChange,
  placeholder,
}: ThinkingModeSelectorProps) {
  const { t } = useTranslation()
  const [supportedReasoningEfforts, setSupportedReasoningEfforts] = useState<string[] | null>(null)
  const [defaultReasoningEffort, setDefaultReasoningEffort] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setSupportedReasoningEfforts(null)
    setDefaultReasoningEffort(null)

    if (acpTool !== 'codex' || !providerId) {
      return () => {
        cancelled = true
      }
    }

    void llmProviderApi.fetchModelsForProvider(providerId).then((response) => {
      if (cancelled || !response.success || !response.data) return
      const selectedModel = response.data.find((model) => (
        model.id.trim().toLowerCase() === providerModel?.trim().toLowerCase()
      ))
      setSupportedReasoningEfforts(selectedModel?.supportedReasoningEfforts ?? null)
      setDefaultReasoningEffort(selectedModel?.defaultReasoningEffort ?? null)
    }).catch(() => {
      // Model discovery is optional; the fixed Codex list remains usable.
    })

    return () => {
      cancelled = true
    }
  }, [acpTool, providerId, providerModel])

  const selectedModelName = providerId
    ? providerModel
    : modelName || localDefaultModel
  const localModel = acpTool === 'codex'
    ? localModels?.find((model) => model.name.trim().toLowerCase() === selectedModelName?.trim().toLowerCase())
    : undefined
  const localReasoningEfforts = localModel?.supportedReasoningEfforts ?? null
  const localDefaultReasoningEffort = localModel?.defaultReasoningEffort ?? null
  const effectiveSupportedReasoningEfforts = providerId
    ? supportedReasoningEfforts
    : localReasoningEfforts
  const effectiveDefaultReasoningEffort = providerId
    ? defaultReasoningEffort
    : localDefaultReasoningEffort

  const options = useMemo(
    () => getThinkingModeOptions(acpTool, effectiveSupportedReasoningEfforts),
    [acpTool, effectiveSupportedReasoningEfforts],
  )

  useEffect(() => {
    if (!options.includes(value)) {
      const preferred = effectiveDefaultReasoningEffort?.trim().toLowerCase() as AgentThinkingMode | undefined
      onChange(preferred && options.includes(preferred) ? preferred : options[0] ?? value)
    }
  }, [effectiveDefaultReasoningEffort, onChange, options, value])

  return (
    <Select value={value} onValueChange={(next) => onChange(next as AgentThinkingMode)}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((mode) => (
          <SelectItem key={mode} value={mode}>
            {t(`${THINKING_MODE_I18N_KEY[mode]}Short`)}({mode})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
