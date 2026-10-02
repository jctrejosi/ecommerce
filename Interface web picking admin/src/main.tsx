import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { API_BASE_URL } from './services/api'
import { initTheme } from './theme'
import './index.css'

// Aplica el tema guardado antes de montar, para evitar el destello del tema
// por defecto en el primer render.
initTheme()

// Título de la pestaña: "<nombre de tienda> picking admin | DSI".
// Usa la misma base del API que el resto del panel, así funciona igual en
// localhost o abierto desde el celular con la IP del equipo.
function setAppTitle(appLabel: string) {
  fetch(`${API_BASE_URL}/admin/settings/public-info`)
    .then((r) => (r.ok ? r.json() : {}))
    .then((d: { tradeName?: string }) => {
      const storeName = (d?.tradeName || 'Mercaldas').trim()
      document.title = `${storeName} ${appLabel} | DSI`
    })
    .catch(() => {
      document.title = `Mercaldas ${appLabel} | DSI`
    })
}
setAppTitle('picking admin')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
