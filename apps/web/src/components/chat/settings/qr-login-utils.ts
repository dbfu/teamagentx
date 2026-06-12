// 移动端二维码登录相关的工具函数（从设置页拆分而来）

export function normalizeServerUrl(url: string) {
  const trimmed = url.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
}

export function getBrowserApiServerUrl(webUrl: string) {
  const normalizedWebUrl = normalizeServerUrl(webUrl)
  if (!normalizedWebUrl) return ''

  if (import.meta.env.DEV) {
    const parsedUrl = new URL(normalizedWebUrl)
    return `${parsedUrl.protocol}//${parsedUrl.hostname}:3001`
  }

  return normalizedWebUrl
}

export function isLoopbackHost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

export function replaceUrlHostname(url: string, hostname: string) {
  const parsedUrl = new URL(normalizeServerUrl(url))
  parsedUrl.hostname = hostname
  return parsedUrl.toString().replace(/\/+$/, '')
}

export function getUrlHostname(url: string | null | undefined) {
  if (!url) return null
  try {
    return new URL(normalizeServerUrl(url)).hostname
  } catch {
    return null
  }
}

export async function getLocalNetworkIp() {
  try {
    const apiUrl = getBrowserApiServerUrl(window.location.origin)
    const response = await fetch(`${apiUrl}/network-info`)
    const data = await response.json() as { localIp?: string | null; localIps?: string[] }
    return {
      localIp: data.localIp || data.localIps?.[0] || null,
      localIps: data.localIps || (data.localIp ? [data.localIp] : []),
    }
  } catch {
    return { localIp: null, localIps: [] }
  }
}

export function buildQrLoginUrl(webUrl: string, token: string, username: string, apiServerUrl?: string) {
  const normalizedWebUrl = normalizeServerUrl(webUrl)
  const normalizedApiServerUrl = apiServerUrl ? normalizeServerUrl(apiServerUrl) : normalizedWebUrl
  const qrUrl = new URL('/', normalizedWebUrl)
  qrUrl.searchParams.set('qrLogin', '1')
  qrUrl.searchParams.set('token', token)
  qrUrl.searchParams.set('username', username)
  if (normalizedApiServerUrl !== normalizedWebUrl) {
    qrUrl.searchParams.set('serverUrl', normalizedApiServerUrl)
  }
  return {
    serverUrl: normalizedApiServerUrl,
    qrUrl: qrUrl.toString(),
  }
}
