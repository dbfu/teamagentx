import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: true,
    port: 5184,
  },
  preview: {
    host: true,
    port: 4184,
  },
})
