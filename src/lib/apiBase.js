// Base de la API para builds nativos (Capacitor).
//
// En web la app se sirve desde el mismo origen que la API, así que las rutas
// relativas `/api/...` funcionan solas. En un build NATIVO (Capacitor) la app
// se sirve desde `capacitor://localhost` / `https://localhost`, donde `/api` no
// resuelve a ningún servidor. Con `VITE_API_BASE_URL` seteado en el build nativo
// (p. ej. https://app.posveci.com), este shim reescribe cualquier `fetch('/api…')`
// hacia esa API absoluta. En web la variable está vacía → NO-OP (la web queda
// idéntica, sin ningún cambio de comportamiento).
//
// Se combina con CapacitorHttp (networking nativo): las cookies de sesión se
// manejan en el jar nativo, sin las restricciones de cookies de terceros del
// WebView. Instalar ANTES de que la app haga cualquier request.

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export function installApiBase() {
    if (!API_BASE || typeof window === 'undefined' || typeof window.fetch !== 'function') return;

    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
        try {
            if (typeof input === 'string' && input.startsWith('/api')) {
                return originalFetch(API_BASE + input, init);
            }
            if (input instanceof Request) {
                const path = input.url.replace(/^[a-z]+:\/\/[^/]+/i, '');
                if (path.startsWith('/api')) {
                    return originalFetch(new Request(API_BASE + path, input), init);
                }
            }
        } catch {
            // Ante cualquier problema, se usa el request original sin tocar.
        }
        return originalFetch(input, init);
    };
}

export { API_BASE };
