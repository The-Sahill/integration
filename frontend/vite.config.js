import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// أثناء التطوير: نمرر /api و /socket.io للباك إند على 4000
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:4000',
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
})
