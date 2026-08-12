// Los tres candados de la App de IA, antes de gastar un peso en OpenAI.
//
// Por qué viven acá y no en el cliente: todas las demás Apps se controlan con
// hasApp() en el navegador, y está bien — si alguien lo saltea, lo peor que
// pasa es que vea una pantalla que no compró. Esta App es distinta: controla
// GASTO REAL. Con el gate solo en el cliente, cualquiera con la sesión abierta
// puede golpear el endpoint y generarle a POSVECI una factura que nadie pidió.
//
// El orden importa: primero lo barato (ritmo), después lo que consulta la base
// (licencia y cupo). Un bucle descontrolado se corta en el primer candado sin
// llegar a tocar la base, que es justo cuando la base está bajo presión.

// ── Parámetros del producto ──────────────────────────────────────────────
export const CUPO_MENSUAL = 2000;   // lo que se promete y se cobra
export const AVISO_DESDE  = 0.8;    // avisar al 80% (1.600)
export const TOPE_POR_MIN = 10;     // nadie escribe 10 preguntas en un minuto

// Una foto de factura consume bastante más que una pregunta de texto. Si ambas
// contaran 1, el cupo mediría clics en vez de gasto, que es lo que hay que
// limitar. Se revisa con datos reales cuando la Fase 2 esté andando.
export const CREDITOS = { consulta: 1, foto: 3 };

/**
 * El mes en horario chileno, como 'YYYY-MM'.
 *
 * El servidor corre en UTC: una consulta de las 22:00 del 31 de agosto en Chile
 * ya es 1 de septiembre en UTC. Contar por la fecha cruda le regalaría al
 * cliente consultas del mes siguiente —o se las cobraría dos veces— justo en el
 * corte, que es cuando más se nota. Mismo problema que tuvimos con los reportes
 * de ventas por día.
 */
export function periodoActual(fecha = new Date()) {
    const partes = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Santiago',
        year: 'numeric',
        month: '2-digit',
    }).formatToParts(fecha);
    const y = partes.find(p => p.type === 'year').value;
    const m = partes.find(p => p.type === 'month').value;
    return `${y}-${m}`;
}

/**
 * Candado 1 — ritmo. Es el único que protege de verdad el bolsillo.
 *
 * El cupo mensual defiende el modelo de negocio, pero llega tarde: para cuando
 * avisa, el gasto ya ocurrió. Un bucle mal escrito a una consulta por segundo
 * son 2,6 millones al mes; con este tope se topa a los pocos segundos.
 */
export async function ritmoExcedido(turso, companyId) {
    const desde = new Date(Date.now() - 60_000).toISOString();
    const r = await turso.execute({
        sql: 'SELECT COUNT(*) AS n FROM ai_usage WHERE company_id = ? AND created_at >= ?',
        args: [companyId, desde],
    });
    return Number(r.rows[0]?.n || 0) >= TOPE_POR_MIN;
}

/**
 * Candado 2 — licencia. La App tiene que estar activa o en prueba para ESTA
 * sucursal. Se consulta la misma tabla que usa el Marketplace, así que cancelar
 * la App corta el acceso sin ningún paso extra.
 */
export async function tieneAppIA(turso, companyId) {
    const r = await turso.execute({
        sql: `SELECT status, trial_ends_at FROM company_apps
              WHERE company_id = ? AND app_key = 'ia' LIMIT 1`,
        args: [companyId],
    });
    const fila = r.rows[0];
    if (!fila) return false;
    if (fila.status === 'active') return true;
    // En prueba: vale hasta que se venza. Sin fecha se trata como vencida, no
    // como infinita — ante la duda, no gastar.
    if (fila.status === 'trial' && fila.trial_ends_at) {
        return new Date(fila.trial_ends_at) > new Date();
    }
    return false;
}

/**
 * Candado 3 — cupo del mes. Devuelve el estado completo para que la pantalla
 * pueda avisar al 80% sin tener que preguntar de nuevo.
 */
export async function estadoCupo(turso, companyId) {
    const period = periodoActual();
    const r = await turso.execute({
        sql: 'SELECT COALESCE(SUM(credits), 0) AS usados FROM ai_usage WHERE company_id = ? AND period = ?',
        args: [companyId, period],
    });
    const usados = Number(r.rows[0]?.usados || 0);
    const restantes = Math.max(0, CUPO_MENSUAL - usados);
    return {
        period,
        usados,
        cupo: CUPO_MENSUAL,
        restantes,
        agotado: usados >= CUPO_MENSUAL,
        avisar: usados >= CUPO_MENSUAL * AVISO_DESDE && usados < CUPO_MENSUAL,
    };
}

/**
 * Registra lo consumido. Guarda tokens y costo además de los créditos: la tabla
 * de márgenes del plan es una estimación, esto va a ser el dato real con el que
 * revisar si los US$ 10 y las 2.000 consultas siguen dando.
 */
export async function registrarConsumo(turso, { companyId, userId, kind = 'consulta', uso = {} }) {
    const creditos = CREDITOS[kind] ?? 1;
    // Precios oficiales de gpt-5.6-luna por millón de tokens.
    const costo = ((uso.cached || 0) * 0.02 + (uso.input || 0) * 0.20 + (uso.output || 0) * 1.20) / 1e6;
    await turso.execute({
        sql: `INSERT INTO ai_usage
                (company_id, user_id, kind, credits, period,
                 input_tokens, cached_tokens, output_tokens, cost_usd, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
            companyId, userId ?? null, kind, creditos, periodoActual(),
            uso.input || 0, uso.cached || 0, uso.output || 0,
            costo, new Date().toISOString(),
        ],
    });
    return { creditos, costo };
}
