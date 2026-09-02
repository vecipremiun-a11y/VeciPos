import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'

// La versión sale de package.json y se inyecta en el bundle. Es la ÚNICA fuente:
// la pantalla de Ajustes la muestra desde acá en vez de tenerla escrita a mano.
// Durante meses esa pantalla decía "1.2.1" pasara lo que pasara, así que no
// había forma de saber qué versión estaba corriendo un cliente.
// Ver CLAUDE.md, sección "Versiones: una sola, continua, para los tres destinos".
const APP_VERSION = JSON.parse(readFileSync('./package.json', 'utf8')).version

// El build nativo se distingue por VITE_API_BASE_URL (lo inyecta scripts/build-app.mjs).
const ES_APP_NATIVA = !!process.env.VITE_API_BASE_URL

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __APP_ES_NATIVA__: JSON.stringify(ES_APP_NATIVA),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // En build nativo (Capacitor, detectado por VITE_API_BASE_URL) se desactiva
      // el service worker: dentro del WebView causa contenido cacheado/pantalla en
      // blanco y no aporta (los assets ya van empaquetados). La web (sin esa var)
      // conserva la PWA intacta.
      disable: !!process.env.VITE_API_BASE_URL,
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
        // Excluir del SPA-fallback: las APIs y la pantalla KDS (kds.html es una
        // página standalone para TV — NO debe redirigirse a index.html / React).
        navigateFallbackDenylist: [/^\/api\//, /^\/kds/, /kds\.html$/, /^\/sorteo/, /sorteo\.html$/],
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

  // FASE 10 · Frontend perf
  // ─────────────────────────────────────────────────────────────────────────
  // Quita los console.{log,info,debug,warn} en builds de producción.
  // Mantiene console.error / console.assert para visibilidad de problemas reales.
  // No afecta a `npm run dev` (esbuild solo dropea en producción cuando minify=true).
  esbuild: {
    pure: ['console.log', 'console.info', 'console.debug', 'console.warn'],
    legalComments: 'none',
  },

  // Acelera el primer arranque de `npm run dev` pre-bundleando dependencias
  // pesadas con esbuild en vez de transformarlas on-demand.
  // (Era una de las principales razones de la lentitud de dev vs preview.)
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      'zustand',
      'zustand/react/shallow',
      'date-fns',
      'date-fns-tz',
      'recharts',
      'jspdf',
      'jspdf-autotable',
      'html2canvas',
      'xlsx',
      'framer-motion',
      'lucide-react',
      '@libsql/client',
      'dexie',
    ],
  },

  build: {
    // Avisar a 1MB en vez de 500KB (ya estamos en 4MB, queremos foco en el real warning)
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Code-splitting de librerías grandes para que el chunk principal
        // no incluya recharts, jspdf, xlsx, etc. cuando no se necesitan.
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-charts': ['recharts'],
          'vendor-pdf': ['jspdf', 'jspdf-autotable', 'html2canvas'],
          'vendor-xlsx': ['xlsx'],
          'vendor-motion': ['framer-motion'],
          'vendor-dates': ['date-fns', 'date-fns-tz'],
          'vendor-icons': ['lucide-react'],
          'vendor-db': ['@libsql/client', 'dexie'],
        },
      },
    },
  },
})
