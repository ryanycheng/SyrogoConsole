import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const syrogoApiTarget = process.env.SYROGO_DEV_API_TARGET || 'http://127.0.0.1:23235'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/admin': syrogoApiTarget,
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/testSetup.ts',
  },
})
