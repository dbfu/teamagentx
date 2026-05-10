import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron/simple';

const desktopRoot = __dirname;
const webRoot = path.resolve(desktopRoot, '../web');

export default defineConfig({
  root: webRoot,
  base: './',
  plugins: [
    react({
      babel: {
        plugins: [
          [
            '@locator/babel-jsx/dist',
            {
              env: 'development',
            },
          ],
        ],
      },
    }),
    electron({
      main: {
        entry: path.resolve(desktopRoot, 'electron/main.ts'),
        vite: {
          build: {
            outDir: path.resolve(desktopRoot, 'dist-electron'),
            emptyOutDir: true,
            rollupOptions: {
              external: ['electron', 'child_process', 'fs', 'path', 'url'],
            },
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
    proxy: {
      '/uploads': {
        target: 'http://localhost:11053',
        changeOrigin: true,
      },
    },
  },
});
