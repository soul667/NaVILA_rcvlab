import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3001,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      '/inference': {
        target: 'http://10.16.117.238:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/inference/, ''),
      },
    },
  },
})
