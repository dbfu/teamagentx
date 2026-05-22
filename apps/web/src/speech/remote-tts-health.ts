export type RemoteTtsHealthProfile = {
  provider?: string | null
  model?: string | null
  vendorOptions?: Record<string, unknown> | null
}

type RemoteTtsFailure = {
  status?: number | null
}

const unhealthyUntilByKey = new Map<string, number>()

const DEFAULT_COOLDOWN_MS = 60_000
const AUTH_COOLDOWN_MS = 5 * 60_000

function getProviderId(vendorOptions?: Record<string, unknown> | null): string | null {
  const rawProviderId = vendorOptions?.llmProviderId
  return typeof rawProviderId === 'string' && rawProviderId.trim() ? rawProviderId.trim() : null
}

function buildHealthKey(profile: RemoteTtsHealthProfile): string {
  return [
    profile.provider ?? 'openai-compatible-tts',
    profile.model ?? '',
    getProviderId(profile.vendorOptions) ?? '',
  ].join('|')
}

function getCooldownMs(failure?: RemoteTtsFailure): number {
  if (failure?.status === 401 || failure?.status === 403) {
    return AUTH_COOLDOWN_MS
  }
  return DEFAULT_COOLDOWN_MS
}

export function isRemoteTtsTemporarilyUnavailable(profile?: RemoteTtsHealthProfile | null, now = Date.now()): boolean {
  if (!profile) return false
  const key = buildHealthKey(profile)
  const unhealthyUntil = unhealthyUntilByKey.get(key)
  if (!unhealthyUntil) return false
  if (unhealthyUntil <= now) {
    unhealthyUntilByKey.delete(key)
    return false
  }
  return true
}

export function markRemoteTtsUnavailable(profile?: RemoteTtsHealthProfile | null, failure?: RemoteTtsFailure, now = Date.now()): void {
  if (!profile) return
  unhealthyUntilByKey.set(buildHealthKey(profile), now + getCooldownMs(failure))
}

export function clearRemoteTtsUnavailable(profile?: RemoteTtsHealthProfile | null): void {
  if (!profile) return
  unhealthyUntilByKey.delete(buildHealthKey(profile))
}

export function resetRemoteTtsHealth(): void {
  unhealthyUntilByKey.clear()
}
