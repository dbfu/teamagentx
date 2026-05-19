/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_VERSION: string
  readonly VITE_DOWNLOAD_URL_MAC_ARM64: string
  readonly VITE_DOWNLOAD_URL_MAC_X64: string
  readonly VITE_DOWNLOAD_URL_WIN: string
  readonly VITE_DOWNLOAD_URL_IOS: string
  readonly VITE_DOWNLOAD_URL_ANDROID: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
