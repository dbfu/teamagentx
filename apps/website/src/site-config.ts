import { useEffect, useState } from 'react'

export interface SiteConfig {
  version: string
  macUrl: string
  winUrl: string
}

const BUILD_TIME_CONFIG: SiteConfig = {
  version: import.meta.env.VITE_APP_VERSION || 'v1.2.0',
  macUrl: import.meta.env.VITE_DOWNLOAD_URL_MAC || '#',
  winUrl: import.meta.env.VITE_DOWNLOAD_URL_WIN || '#',
}

export function useSiteConfig(): SiteConfig {
  const [config, setConfig] = useState<SiteConfig>(BUILD_TIME_CONFIG)

  useEffect(() => {
    fetch('/update.json')
      .then((res) => res.json())
      .then((data) => {
        setConfig({
          version: data.version || BUILD_TIME_CONFIG.version,
          macUrl: data.macUrl || data.downloads?.mac || data.url || BUILD_TIME_CONFIG.macUrl,
          winUrl: data.winUrl || data.downloads?.win || data.url || BUILD_TIME_CONFIG.winUrl,
        })
      })
      .catch(() => {
        // 请求失败时保留构建时默认值，不影响页面显示
      })
  }, [])

  return config
}
