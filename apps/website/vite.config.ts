import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const resolverProxyTarget = env.DOWNLOAD_RESOLVER_PROXY_TARGET || 'http://127.0.0.1:3207'

  return {
    base: './',
    plugins: [react()],
    server: {
      host: true,
      port: 5184,
      proxy: {
        '/download-resolver': {
          target: resolverProxyTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/download-resolver/, ''),
        },
      },
    },
    preview: {
      host: true,
      port: 4184,
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  }
})
