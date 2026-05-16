const PACKAGED_SERVER_ORIGIN = 'http://localhost:11053'

export function resolveAssetUrl(url?: string | null): string | undefined {
  if (!url) return undefined

  if (!url.startsWith('/uploads/')) {
    return url
  }

  if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
    return `${PACKAGED_SERVER_ORIGIN}${url}`
  }

  return url
}
