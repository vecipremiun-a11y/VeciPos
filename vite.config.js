import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Sirve el manifest, SW y favicon a todos los dispositivos
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'POSVECI',
        short_name: 'POSVECI',
        description: 'Sistema POS POSVECI — ventas, inventario y reportes en un solo lugar',
        theme_color: '#0b1120',
        background_color: '#0b1120',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        lang: 'es',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        categories: ['business', 'productivity', 'finance'],
      },
      workbox: {
        // Cachea solo el shell estático generado por Vite. NUNCA cachea datos
        // dinámicos (queries Turso ni endpoints /api/*) → cero riesgo de mostrar
        // datos viejos o cuadres incorrectos.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webp,woff,woff2}'],
        // El bundle principal puede pesar >2 MB; subimos el límite a 6 MB
        // para que el precache lo incluya y la app abra completa offline.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // Excluir explícitamente cualquier respuesta de API del cache.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          // Cache de fuentes (Google Fonts, etc.) — opcional pero útil offline
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
        // Si la app se actualiza, recargar service worker automáticamente
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        // Endpoints API y Turso NUNCA se interceptan (ningún runtimeCaching los matchea)
      },
      devOptions: {
        // Habilitar PWA también en `npm run dev` para poder probarlo localmente.
        enabled: false,
      },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3010',
        changeOrigin: true,
      },
    },
  },
})
