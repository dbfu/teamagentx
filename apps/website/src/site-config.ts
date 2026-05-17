import { useEffect, useState } from 'react'

export interface SiteConfig {
  version: string
  macUrlArm64: string
  macUrlX64: string
  winUrl: string
}

const BUILD_TIME_CONFIG: SiteConfig = {
  version: import.meta.env.VITE_APP_VERSION || 'v1.2.0',
  macUrlArm64: import.meta.env.VITE_DOWNLOAD_URL_MAC_ARM64 || '#',
  macUrlX64: import.meta.env.VITE_DOWNLOAD_URL_MAC_X64 || '#',
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
          macUrlArm64:
            data.macUrlArm64 ||
            data.downloads?.macArm64 ||
            BUILD_TIME_CONFIG.macUrlArm64,
          macUrlX64:
            data.macUrlX64 ||
            data.downloads?.macX64 ||
            BUILD_TIME_CONFIG.macUrlX64,
          winUrl:
            data.winUrl ||
            data.downloads?.win ||
            data.url ||
            BUILD_TIME_CONFIG.winUrl,
        })
      })
      .catch(() => {
        // 请求失败时保留构建时默认值
      })
  }, [])

  return config
}
