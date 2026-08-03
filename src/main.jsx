import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installApiBase } from './lib/apiBase'
import './index.css'
import App from './App.jsx'
import { initPwaUpdate } from './lib/pwaUpdate'

// El bundle cargó: limpiamos la bandera de auto-recuperación del index.html para
// que un deploy futuro pueda volver a recargar si hiciera falta.
try { sessionStorage.removeItem('pv_chunk_reload'); } catch { /* sin sessionStorage */ }

// En build nativo (Capacitor) redirige /api/* a la API absoluta. En web es no-op.
installApiBase();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

initPwaUpdate();
