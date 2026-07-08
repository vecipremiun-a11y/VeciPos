// Telemetría de fallback de queries analíticas server-side (Fase 1 · Paso 33).
// Antes el navegador escribía directo a analytics_telemetry con el token de BD.
// Ahora se envía el buffer y el servidor fuerza company_id (nunca lo decide el
// cliente por fila). Best-effort: nunca es crítico.

async function telemetryFlush(turso, companyId, session, { events }) {
    const list = Array.isArray(events) ? events.slice(0, 100) : [];
    if (list.length === 0) return { success: true, inserted: 0 };
    const queries = list.map((e) => ({
        sql: `INSERT INTO analytics_telemetry
                (company_id, event_type, query_name, error_msg, duration_ms, user_agent, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
            companyId,
            String(e.event_type ?? '').slice(0, 32),
            String(e.query_name ?? '').slice(0, 64),
            e.error_msg != null ? String(e.error_msg).slice(0, 500) : null,
            Number.isFinite(e.duration_ms) ? Math.round(e.duration_ms) : null,
            e.user_agent != null ? String(e.user_agent).slice(0, 200) : null,
            e.created_at || new Date().toISOString(),
        ],
    }));
    await turso.batch(queries);
    return { success: true, inserted: queries.length };
}

export const telemetryActions = { telemetryFlush };
