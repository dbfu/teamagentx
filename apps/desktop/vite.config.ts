import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import electron from 'vite-plugin-electron/simple';

const desktopRoot = __dirname;
const webRoot = path.resolve(desktopRoot, '../web');

export default defineConfig(({ mode }) => {
  // 从 apps/desktop/.env 加载桌面端专属环境变量（构建时注入）
  const desktopEnv = loadEnv(mode, desktopRoot, 'VITE_');

  return {
  root: webRoot,
  base: './',
  plugins: [
    react(),
    electron({
      main: {
        entry: path.resolve(desktopRoot, 'electron/main.ts'),
        onstart({ startup }) {
          // Spawn Electron with the correct cwd (desktop dir), not the Vite root (web dir)
          startup([desktopRoot, '--no-sandbox'], { cwd: desktopRoot });
        },
        vite: {
          build: {
            outDir: path.resolve(desktopRoot, 'dist-electron'),
            emptyOutDir: true,
            rollupOptions: {
              external: ['electron', 'child_process', 'fs', 'path', 'url'],
            },
          },
          // 将 .env 中的变量烧入 main 进程产物，避免依赖运行时 process.env
          define: {
            __UPDATE_CHECK_URL__: JSON.stringify(desktopEnv.VITE_UPDATE_CHECK_URL || ''),
          },
        },
      },
      preload: {
        input: path.resolve(desktopRoot, 'electron/preload.ts'),
        vite: {
          build: {
            outDir: path.resolve(desktopRoot, 'dist-electron'),
            emptyOutDir: false,
            rollupOptions: {
              output: {
                entryFileNames: 'preload.js',
              },
            },
          },
        },
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(webRoot, './src'),
    },
  },
  build: {
    outDir: path.resolve(desktopRoot, 'dist'),
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    strictPort: true,
    proxy: {
      '/uploads': {
        target: 'http://localhost:11053',
        changeOrigin: true,
      },
    },
  },
  };
});
