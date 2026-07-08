// Helper compartido para páginas que consultan el endpoint de datos autenticado
// (/api/data/actions — sesión + membresía validadas server-side). Mismo contrato
// que userApiCall del store. Fase 1 · Paso 19.
export async function dataApiCall(action, payload = {}) {
    try {
        const r = await fetch('/api/data/actions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ action, ...payload }),
        });
        const data = await r.json().catch(() => ({ success: false, error: 'Respuesta inválida del servidor' }));
        if (data && typeof data === 'object') data._status = r.status;
        return data;
    } catch (e) {
        return { success: false, error: 'Error de red: ' + e.message, _network: true };
    }
}

// Atajo para el catálogo de reportes: devuelve el array de filas de la query N
export async function reportCall(companyId, name, params = {}, queryIndex = 0) {
    const r = await dataApiCall('report', { companyId, name, params });
    if (!r?.success) throw new Error(r?.error || 'Error en reporte');
    return r.rows[queryIndex] || [];
}
