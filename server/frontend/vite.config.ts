import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/health': 'http://localhost:8000',
      '/state': 'http://localhost:8000',
      '/history': 'http://localhost:8000',
      '/history_all': 'http://localhost:8000',
      '/infer': 'http://localhost:8000',
      '/set_instruction': 'http://localhost:8000',
      '/pause': 'http://localhost:8000',
      '/resume': 'http://localhost:8000',
    },
  },
})
