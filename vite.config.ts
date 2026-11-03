import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5175,
    strictPort: true,
    watch: { ignored: ['**/release/**', '**/artifacts/**', '**/dist/**'] },
  },
  build: { target: 'es2022', sourcemap: false },
})
