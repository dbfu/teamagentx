import type { LlmProvider } from '@/lib/llm-provider-api'

export type RemoteCatalogEntryLite = {
  llmProviderId: string
}

export function filterRemoteTtsProviders(
  audioProviders: LlmProvider[],
  remoteCatalog: RemoteCatalogEntryLite[],
): LlmProvider[] {
  const fallbackProviders = audioProviders.filter((provider) =>
    (provider.audioUsage === 'tts' || provider.audioUsage === 'both') && provider.apiProtocol === 'openai',
  )

  const remoteCatalogProviderIds = new Set(remoteCatalog.map((item) => item.llmProviderId))
  if (remoteCatalogProviderIds.size === 0) return fallbackProviders

  return fallbackProviders.filter((provider) => remoteCatalogProviderIds.has(provider.id))
}
