const RESOLVER_BASE_PATH = '/download-resolver'

export function getResolvedDownloadHref(originalUrl: string): string {
  if (!originalUrl) {
    return '#download'
  }

  const endpoint = new URL(`${RESOLVER_BASE_PATH}/download`, window.location.origin)
  endpoint.searchParams.set('url', originalUrl)
  return `${endpoint.pathname}${endpoint.search}`
}
