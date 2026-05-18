export async function resolveDownloadUrl(
  originalUrl: string,
  resolverBaseUrl: string,
): Promise<string> {
  if (!resolverBaseUrl) {
    return originalUrl
  }

  const endpoint = new URL('/resolve', resolverBaseUrl)
  endpoint.searchParams.set('url', originalUrl)

  const response = await fetch(endpoint.toString(), {
    method: 'GET',
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`resolver request failed: HTTP ${response.status}`)
  }

  const payload = await response.json() as { success?: boolean; resolvedUrl?: string }
  if (!payload.success || !payload.resolvedUrl) {
    throw new Error('resolver did not return a direct URL')
  }

  return payload.resolvedUrl
}

export function triggerDownload(url: string) {
  const link = document.createElement('a')
  link.href = url
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

export async function startResolvedDownload(
  originalUrl: string,
  resolverBaseUrl: string,
): Promise<void> {
  try {
    const resolvedUrl = await resolveDownloadUrl(originalUrl, resolverBaseUrl)
    triggerDownload(resolvedUrl)
  } catch {
    triggerDownload(originalUrl)
  }
}
