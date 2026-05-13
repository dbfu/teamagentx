/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_VERSION: string
  readonly VITE_DOWNLOAD_URL_MAC: string
  readonly VITE_DOWNLOAD_URL_WIN: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
