import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  server: {
    host: '0.0.0.0',
    port: parseInt(process.env.PORT || '8447'),
    strictPort: true,
    proxy: {
      // OpenFreeMap (tiles vectoriales del mapa móvil) servido same-origin
      // para saltar bloqueos de red/adblock hacia tiles.openfreemap.org.
      '/ofm': {
        target: 'https://tiles.openfreemap.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ofm/, ''),
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: parseInt(process.env.PORT || '8447'),
  },
})
