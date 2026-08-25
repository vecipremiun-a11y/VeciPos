// Helper compartido para páginas que consultan el endpoint de datos autenticado
// (/api/data/actions — sesión + membresía validadas server-side). Mismo contrato
// que userApiCall del store. Fase 1 · Paso 19.
import { getTabUserId } from './sessionGuard';
import { sinDobleEnvio } from './inFlight';
import { fetchConLimite } from './conectividad';
import { esSesionExpirada, sesionExpirada } from './sesion';

// Mismo blindaje que userApiCall: un doble clic no manda la operación dos veces.
export function dataApiCall(action, payload = {}) {
    return sinDobleEnvio(action, payload, () => _dataApiCall(action, payload));
}

// Mismo tiempo límite que userApiCall: sin él, una conexión caída deja la
// pantalla esperando para siempre en vez de avisar. Ver el porqué en useStore.js.
const API_TIMEOUT_MS = 12000;

async function _dataApiCall(action, payload = {}) {
    try {
        const r = await fetchConLimite('/api/data/actions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            // Identifica a nombre de quién cree actuar esta pestaña; el servidor corta
            // si la cookie ya es de otro usuario (ver src/lib/sessionGuard.js).
            body: JSON.stringify({ action, ...payload, expectedUserId: getTabUserId() }),
        });
        const data = await r.json().catch(() => ({ success: false, error: 'Respuesta inválida del servidor' }));
        if (data && typeof data === 'object') data._status = r.status;
        if (esSesionExpirada(data)) sesionExpirada();
        return data;
    } catch (e) {
        const seCorto = e?.name === 'AbortError' || e?.name === 'TimeoutError';
        return {
            success: false,
            error: seCorto ? 'Sin respuesta del servidor' : 'Error de red: ' + e.message,
            _network: true,
        };
    }
}

// Atajo para el catálogo de reportes: devuelve el array de filas de la query N
export async function reportCall(companyId, name, params = {}, queryIndex = 0) {
    const r = await dataApiCall('report', { companyId, name, params });
    if (!r?.success) throw new Error(r?.error || 'Error en reporte');
    return r.rows[queryIndex] || [];
}
