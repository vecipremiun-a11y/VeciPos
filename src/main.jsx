import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installApiBase } from './lib/apiBase'
import { iniciarMonitorConexion } from './lib/conectividad'
import './index.css'
import App from './App.jsx'
import { initPwaUpdate } from './lib/pwaUpdate'

// El bundle cargó: limpiamos la bandera de auto-recuperación del index.html para
// que un deploy futuro pueda volver a recargar si hiciera falta.
try { sessionStorage.removeItem('pv_chunk_reload'); } catch { /* sin sessionStorage */ }

// En build nativo (Capacitor) redirige /api/* a la API absoluta. En web es no-op.
installApiBase();

// Monitor de conectividad: detecta la caída de internet por su cuenta, sin
// esperar a que falle una venta. Va DESPUÉS de installApiBase para que el
// latido salga hacia el servidor correcto en la app nativa.
iniciarMonitorConexion();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

initPwaUpdate();
