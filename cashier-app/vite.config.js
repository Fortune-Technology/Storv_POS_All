import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',   // ← relative paths so Electron can load via file://
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'StoreVeu POS',
        short_name: 'StoreVeu',
        description: 'StoreVeu Point of Sale Terminal',
        start_url: '/',
        display: 'standalone',
        background_color: '#0f1117',
        theme_color: '#3d56b5',
        orientation: 'landscape',
        icons: [
          { src: 'icon.svg',     sizes: 'any',         type: 'image/svg+xml', purpose: 'any maskable' },
          { src: 'icon-192.png', sizes: '192x192',     type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512',     type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 200, maxAgeSeconds: 86400 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5174,
    proxy: { '/api': { target: 'http://localhost:5000', changeOrigin: true } },
  },
});
