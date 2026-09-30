import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Served from https://whiteshadow98.github.io/health-scribe/
  base: '/health-scribe/',
  plugins: [react(), tailwindcss()],
})
