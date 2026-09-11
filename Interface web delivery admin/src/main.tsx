import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import './index.css';
import App from './App';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

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
