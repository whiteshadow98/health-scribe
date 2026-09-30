import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const base = '/health-scribe/'

// https://vite.dev/config/
export default defineConfig({
  // Served from https://whiteshadow98.github.io/health-scribe/
  base,
  plugins: [
    react(),
    tailwindcss(),
    // Service worker + manifest: the app installs to the home screen and opens with no connection.
    // The AI models are cached separately by WebLLM and transformers.js in the Cache API.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Health Scribe',
        short_name: 'Health Scribe',
        description: 'Private, on-device health logging by voice.',
        theme_color: '#0f766e',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // The AI engine bundle is large.
        maximumFileSizeToCacheInBytes: 15 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
        // The speech engine (27 MB) is only fetched the first time voice is used, then kept.
        runtimeCaching: [
          {
            urlPattern: /\.wasm$/,
            handler: 'CacheFirst',
            options: { cacheName: 'speech-engine', expiration: { maxEntries: 4 } },
          },
        ],
      },
    }),
  ],
  worker: {
    format: 'es',
  },
})
