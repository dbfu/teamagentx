const RESOLVER_BASE_PATH = '/website-server'

export type DownloadPlatform = 'macos-arm64' | 'macos-x64' | 'windows' | 'android'

interface DownloadHrefOptions {
  platform?: DownloadPlatform
  version?: string
}

export function trackBaiduDownload(platform: string) {
  window._hmt?.push(['_trackEvent', 'download', 'click', platform])
}

export function getResolvedDownloadHref(originalUrl: string, options: DownloadHrefOptions = {}): string {
  if (!originalUrl) {
    return '#download'
  }

  const endpoint = new URL(`${RESOLVER_BASE_PATH}/download`, window.location.origin)
  endpoint.searchParams.set('url', originalUrl)
  if (options.platform) {
    endpoint.searchParams.set('platform', options.platform)
  }
  if (options.version) {
    endpoint.searchParams.set('version', options.version)
  }
  return `${endpoint.pathname}${endpoint.search}`
}
