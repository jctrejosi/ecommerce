import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'

/**
 * En dev, un archivo que falte bajo `/map/` (estilos, sprite, glifos, tilejson)
 * debe responder 404, NUNCA el index.html del SPA. Si devuelve HTML, MapLibre
 * intenta parsearlo como PBF, lanza "Unimplemented type" en el worker y deja el
 * mapa en blanco.
 */
function mapStatic404(): Plugin {
  return {
    name: 'map-static-404',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0]
        if (!url || !url.startsWith('/map/')) return next()
        const file = path.join(server.config.publicDir, decodeURIComponent(url))
        if (fs.existsSync(file)) return next()
        res.statusCode = 404
        res.setHeader('content-type', 'text/plain; charset=utf-8')
        res.end('Not found')
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), mapStatic404()],
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
        secure: false,
        // Sin reutilizar sockets (keep-alive): el upstream los cierra en reposo
        // y el proxy reusaba conexiones muertas → 502 intermitentes.
        agent: false,
        rewrite: (path) => path.replace(/^\/ofm/, ''),
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: parseInt(process.env.PORT || '8447'),
  },
})
