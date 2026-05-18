import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mode = process.env.MODE || process.env.NODE_ENV || 'production'

// process.env 优先级高于 .env 文件，容器运行时注入的环境变量会覆盖 .env 中的值
const env = {
  ...loadEnv(mode, rootDir, 'VITE_'),
  ...process.env,
}

const version = env.VITE_APP_VERSION || 'v1.2.0'
const macUrlArm64 = env.VITE_DOWNLOAD_URL_MAC_ARM64 || env.VITE_DOWNLOAD_URL_MAC || ''
const macUrlX64 = env.VITE_DOWNLOAD_URL_MAC_X64 || env.VITE_DOWNLOAD_URL_MAC || ''
const winUrl = env.VITE_DOWNLOAD_URL_WIN || ''
const iosUrl = env.VITE_DOWNLOAD_URL_IOS || ''
const androidUrl = env.VITE_DOWNLOAD_URL_ANDROID || ''
const downloadResolverUrl = env.VITE_DOWNLOAD_RESOLVER_URL || ''

const updateInfo = {
  version,
  // Backward compatible field for existing desktop clients.
  url: macUrlArm64 || macUrlX64 || winUrl,
  macUrlArm64,
  macUrlX64,
  macUrl: macUrlArm64,
  winUrl,
  iosUrl,
  androidUrl,
  downloads: {
    macArm64: macUrlArm64,
    macX64: macUrlX64,
    mac: macUrlArm64,
    win: winUrl,
    ios: iosUrl,
    android: androidUrl,
  },
  downloadResolverUrl,
  notes: env.VITE_UPDATE_NOTES || env.VITE_APP_VERSION_NOTE || '',
}

// 始终写入 public/update.json（dev 和 build 阶段的数据源）。
// 容器场景由 docker-entrypoint.sh 直接覆写 dist/update.json，不走这里。
const outputPath = path.join(rootDir, 'public', 'update.json')
fs.writeFileSync(outputPath, `${JSON.stringify(updateInfo, null, 2)}\n`, 'utf8')
console.log(`[generate-update-json] 已写入 ${outputPath}`)
console.log(`[generate-update-json] version=${version}, macArm64=${macUrlArm64 || '(未配置)'}, macX64=${macUrlX64 || '(未配置)'}, winUrl=${winUrl || '(未配置)'}`)
