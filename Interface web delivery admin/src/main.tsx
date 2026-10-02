import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import './index.css';
import App from './App';
import { API_BASE_URL } from './services/api';
import { initTheme } from './lib/theme';

// Aplica el tema guardado antes de pintar (evita el destello de tema claro).
initTheme();

const API_URL = API_BASE_URL;

// Título de la pestaña: "<nombre de tienda> delivery admin | DSI".
function setAppTitle(appLabel: string) {
  fetch(`${API_URL}/admin/settings/public-info`)
    .then((r) => (r.ok ? r.json() : {}))
    .then((d: { tradeName?: string }) => {
      const storeName = (d?.tradeName || 'Mercaldas').trim();
      document.title = `${storeName} ${appLabel} | DSI`;
    })
    .catch(() => {
      document.title = `Mercaldas ${appLabel} | DSI`;
    });
}
setAppTitle('delivery admin');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
