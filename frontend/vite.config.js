import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxy ecom management API to ecom-backend
      '/api/ecom': {
        target: 'http://localhost:5005',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/ecom/, '/api'),
      },
    },
  },
})
