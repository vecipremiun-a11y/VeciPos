// Caja registradora server-side (Fase 1 · Paso 12) — mutaciones del ciclo
// de caja: abrir, cerrar, movimientos de efectivo. Lógica portada tal cual
// de useStore (dup-check de caja abierta incluido). Las horas llegan del
// cliente ya calculadas en la zona horaria de la empresa.

import { verifyPassword } from './auth.js';

async function registerCheck(turso, companyId, session, { userId }) {
    const r = await turso.execute({
        sql: "SELECT * FROM cash_registers WHERE user_id = ? AND company_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1",
        args: [userId, companyId],
    });
    return { success: true, register: r.rows[0] || null };
}

async function registerOpen(turso, companyId, session, { userId, amount }) {
    if (!userId) return { success: false, error: 'Falta userId' };

    // Validación crítica: no permitir 2 cajas abiertas del mismo usuario
    const existing = await turso.execute({
        sql: "SELECT * FROM cash_registers WHERE user_id = ? AND company_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1",
        args: [userId, companyId],
    });
    if (existing.rows.length > 0) {
        return {
            success: false,
            error: 'Ya tienes una caja abierta. Debes cerrarla antes de abrir una nueva.',
            existingRegister: existing.rows[0],
        };
    }

    // La hora de apertura la pone el SERVIDOR, no el dispositivo. Antes llegaba del
    // cliente convertida a la zona de la empresa: si la zona horaria del equipo no
    // coincidía con la del local, la apertura quedaba corrida y, si quedaba en el
    // futuro, NINGUNA venta entraba a la caja. `openingTime` se ignora a propósito.
    const result = await turso.execute({
        sql: "INSERT INTO cash_registers (user_id, opening_amount, opening_time, status, company_id) VALUES (?, ?, ?, 'open', ?) RETURNING *",
        args: [userId, amount, new Date().toISOString(), companyId],
    });
    return { success: true, register: result.rows[0] };
}

/** Roles que pueden autorizar un cierre con ventas offline sin subir. */
const ROLES_QUE_AUTORIZAN = new Set(['owner', 'super_admin', 'admin', 'Administrador', 'Supervisor', 'supervisor']);

/**
 * Verifica la clave del supervisor que autoriza un cierre forzado.
 *
 * Se hace ACÁ y no en el navegador por dos razones: el hash de la contraseña no
 * sale del servidor (no está en el listado de usuarios desde el paso de
 * seguridad), y una comprobación en el cliente la saltea cualquiera con la
 * consola abierta. Acá no hay forma de esquivarla.
 *
 * Solo se aceptan usuarios de ESTA empresa: el supervisor de otro local no
 * autoriza cierres ajenos.
 */
async function verificarSupervisor(turso, companyId, { username, password }) {
    const u = String(username || '').trim();
    const p = String(password || '');
    if (!u || !p) return { ok: false, error: 'Falta el usuario o la contraseña del supervisor.' };

    const r = await turso.execute({
        sql: `SELECT u.id, u.name, u.username, u.password, u.role, uc.role AS company_role
              FROM users u
              LEFT JOIN user_companies uc ON uc.user_id = u.id AND uc.company_id = ?
              WHERE u.username = ? AND (u.company_id = ? OR uc.company_id = ?)`,
        args: [companyId, u, companyId, companyId],
    });

    // Igual que el login: el username es único por empresa, no global, así que
    // se desambigua por contraseña.
    let usuario = null;
    for (const cand of r.rows) {
        if (await verifyPassword(p, cand.password)) { usuario = cand; break; }
    }
    // Mensaje genérico a propósito: no se revela si el usuario existe.
    if (!usuario) return { ok: false, error: 'Usuario o contraseña incorrectos.' };

    const rol = usuario.company_role || usuario.role;
    if (!ROLES_QUE_AUTORIZAN.has(rol)) {
        return { ok: false, error: `${usuario.name || usuario.username} no tiene permiso para autorizar un cierre forzado.` };
    }
    return { ok: true, usuario: { id: usuario.id, name: usuario.name || usuario.username, rol } };
}

async function registerClose(turso, companyId, session, { registerId, finalAmount, observations, difference, override }) {
    if (!registerId) return { success: false, error: 'Falta registerId' };

    // ── Cierre forzado con ventas offline sin subir ──────────────────
    //
    // Normalmente el POS no deja cerrar con ventas del cajero todavía en el
    // equipo: esa plata está en el cajón pero el sistema no la registró, así que
    // el cuadre saldría mal. Pero puede haber ventas que no entran por causas
    // ajenas al cajero —sin stock con el modo ajuste apagado, sin folios CAF— y
    // el turno igual tiene que terminar. Para eso está esta llave.
    //
    // Queda constancia de quién autorizó, cuántas ventas quedaban afuera y por
    // qué, tanto en el cierre como en la auditoría. Una caja forzada tiene que
    // poder explicarse después.
    let notaAutorizacion = null;
    if (override) {
        const v = await verificarSupervisor(turso, companyId, override);
        if (!v.ok) return { success: false, error: v.error, _authFailed: true };

        const pendientes = Number(override.pendientes) || 0;
        const motivo = String(override.reason || '').trim().slice(0, 300);
        notaAutorizacion = `[CIERRE AUTORIZADO por ${v.usuario.name} (${v.usuario.rol}) con ${pendientes} venta(s) sin subir` +
            `${motivo ? `. Motivo: ${motivo}` : ''}]`;

        try {
            await turso.execute({
                sql: 'INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                args: [
                    companyId, session?.uid ?? null, 'FORCED_CLOSE', 'CASH_REGISTER',
                    JSON.stringify({
                        registerId,
                        cerradaPor: session?.uid ?? null,
                        autorizadaPor: v.usuario.id,
                        autorizadaPorNombre: v.usuario.name,
                        rol: v.usuario.rol,
                        ventasSinSubir: pendientes,
                        motivo: motivo || null,
                        finalAmount, difference,
                    }),
                    new Date().toISOString(),
                ],
            });
        } catch (e) {
            // La auditoría no puede impedir que el cajero termine su turno,
            // pero sí tiene que dejar rastro de que falló.
            console.error('[caja] No se pudo auditar el cierre forzado:', e?.message || e);
        }
    }

    const obsFinal = [observations, notaAutorizacion].filter(Boolean).join(' ') || null;

    // Igual que la apertura: la hora la pone el servidor, no el reloj del dispositivo.
    await turso.execute({
        sql: "UPDATE cash_registers SET status = 'closed', closing_time = ?, final_amount = ?, observations = ?, difference = ? WHERE id = ? AND company_id = ?",
        args: [new Date().toISOString(), finalAmount, obsFinal, difference ?? null, registerId, companyId],
    });
    return { success: true, forzado: !!override };
}

async function cashMovementAdd(turso, companyId, session, { registerId, type, amount, reason, date }) {
    if (!registerId || !type) return { success: false, error: 'Faltan datos' };
    const amt = Number(amount) || 0;
    if (amt <= 0) return { success: false, error: 'Monto inválido' };
    await turso.execute({
        sql: 'INSERT INTO cash_movements (register_id, type, amount, reason, date, company_id) VALUES (?, ?, ?, ?, ?, ?)',
        args: [registerId, type, amt, reason ?? '', date || new Date().toISOString(), companyId],
    });
    return { success: true };
}

// ─────────────────────────────────────────────────────────────────
// Lecturas / estadísticas de caja + conciliación (Fase 1 · Paso 13).
// Lógica portada tal cual del navegador; fechas UTC llegan del cliente
// ya convertidas desde la zona horaria de la empresa.
// ─────────────────────────────────────────────────────────────────

// Suma la porción de un método dentro de una venta 'Mixto'
function mixedPortions(paymentDetails) {
    try {
        const d = JSON.parse(paymentDetails || '{}');
        return d.mixedPayments || d.methods || [];
    } catch { return []; }
}

async function registerActiveList(turso, companyId) {
    const result = await turso.execute({
        sql: `SELECT cr.*, u.name as user_name
              FROM cash_registers cr
              LEFT JOIN users u ON cr.user_id = u.id
              INNER JOIN user_companies uc ON cr.user_id = uc.user_id
                                            AND cr.company_id = uc.company_id
              WHERE cr.status = 'open'
              AND cr.company_id = ?`,
        args: [companyId],
    });
    const registers = result.rows;
    if (registers.length === 0) return { success: true, registers: [] };

    const queries = [];
    registers.forEach(reg => {
        // Mismo criterio de pertenencia que registerStats, para que el balance que ve
        // el dueño en "otras cajas abiertas" coincida con el que ve cada cajero.
        // Incluye status != 'cancelled', que antes faltaba aquí.
        const owns = saleBelongsToRegister(reg.id);
        queries.push({
            sql: `SELECT total, payment_method, payment_details FROM sales
                  WHERE company_id = ? AND status != 'cancelled' AND ${owns.sql}`,
            args: [companyId, ...owns.args],
        });
        queries.push({
            sql: 'SELECT type, amount FROM cash_movements WHERE register_id = ? AND company_id = ?',
            args: [reg.id, companyId],
        });
        // Nota: el efectivo de encargos NO se lee aquí; ya está incluido en
        // cash_movements (movimiento "Abono/Cobro/Pago encargo…"). Leerlo también de
        // preorder_payments lo duplicaba en el saldo.
    });
    const results = await turso.batch(queries, 'read');

    const out = [];
    registers.forEach((reg, index) => {
        const salesRes = results[index * 2];
        const movRes = results[index * 2 + 1];

        let cashSales = 0;
        salesRes.rows.forEach(sale => {
            const total = parseFloat(sale.total);
            if (sale.payment_method === 'Efectivo') cashSales += total;
            else if (sale.payment_method === 'Mixto' && sale.payment_details) {
                mixedPortions(sale.payment_details).forEach(m => {
                    if (m.method === 'Efectivo') cashSales += parseFloat(m.amount || 0);
                });
            }
        });

        let movesIn = 0, movesOut = 0;
        movRes.rows.forEach(m => {
            const amount = parseFloat(m.amount);
            if (m.type === 'IN') movesIn += amount;
            else movesOut += amount;
        });

        out.push({ ...reg, currentBalance: reg.opening_amount + cashSales + movesIn - movesOut });
    });
    return { success: true, registers: out };
}

// Pertenencia de una venta a una caja.
//
// Desde la migración 0012 la venta guarda su `register_id`, así que la relación es
// exacta. Las ventas anteriores tienen NULL y se resuelven con la heurística vieja
// (mismo usuario + posterior a la apertura), que es frágil: depende de quién tenía la
// sesión del navegador y de la hora que puso el dispositivo al abrir la caja.
//
// Devuelve el trozo de WHERE y sus argumentos, para que todas las lecturas de caja
// usen exactamente el mismo criterio.
// OJO con el rendimiento: NO usar un OR entre `register_id` y la heurística vieja.
// SQLite no puede indexar `(register_id = ? OR (register_id IS NULL AND ...))` y
// termina escaneando todas las ventas de la empresa. Medido el 23-jul-2026 sobre
// 68.193 ventas: registerStats pasó de 0,7 s a 8,7 s y registerActiveList a 32,9 s,
// por encima del límite de 10 s de Vercel → 504 en TODO el endpoint, incluida la
// carga de productos.
//
// Para una caja ABIERTA el fallback no hace falta: la migración 0012 rellenó el
// `register_id` de todas sus ventas y las nuevas ya lo traen. Basta el índice
// idx_sales_register. La heurística vieja solo se usa en registerReport, que mira
// cajas ya cerradas de antes de la migración y se pide bajo demanda, no en bucle.
function saleBelongsToRegister(registerId) {
    return { sql: 'register_id = ?', args: [registerId] };
}

async function registerStats(turso, companyId, session, { registerId }) {
    const regRes = await turso.execute({
        sql: 'SELECT * FROM cash_registers WHERE id = ? AND company_id = ?',
        args: [registerId, companyId],
    });
    if (regRes.rows.length === 0) return { success: true, stats: null };
    const register = regRes.rows[0];
    const owns = saleBelongsToRegister(registerId);

    const [salesStatsRes, movementsRes, recentSalesRes, preorderPaymentsRes, mixedSalesRes] = await turso.batch([
        {
            sql: `SELECT
                    COUNT(*) as total_sales,
                    SUM(CASE WHEN payment_method = 'Efectivo' THEN total ELSE 0 END) as cash_total,
                    SUM(CASE WHEN payment_method = 'Tarjeta' THEN total ELSE 0 END) as card_total,
                    SUM(CASE WHEN payment_method = 'Transferencia' THEN total ELSE 0 END) as transfer_total,
                    SUM(CASE WHEN payment_method = 'Crédito' THEN total ELSE 0 END) as credit_total,
                    SUM(total) as total_sales_amount
                  FROM sales
                  WHERE company_id = ? AND status != 'cancelled' AND ${owns.sql}`,
            args: [companyId, ...owns.args],
        },
        {
            sql: 'SELECT * FROM cash_movements WHERE register_id = ? AND company_id = ?',
            args: [registerId, companyId],
        },
        {
            // SIN "ORDER BY date DESC LIMIT 20": con él, SQLite prefiere el índice de
            // fecha para evitar el ordenamiento y recorre las 68.193 ventas de la
            // empresa para encontrar las 6 de esta caja (4,2 s medidos el 23-jul-2026).
            // Filtrando solo por register_id usa idx_sales_register y devuelve las
            // ventas del turno, que son pocas; se ordenan y recortan en memoria.
            sql: `SELECT id, date, total, payment_method FROM sales
                  WHERE company_id = ? AND status != 'cancelled' AND ${owns.sql}
                    AND (payment_method = 'Efectivo' OR payment_method = 'Mixto')`,
            args: [companyId, ...owns.args],
        },
        {
            // SOLO Tarjeta/Transferencia. Esos abonos/pagos de encargo NO generan un
            // movimiento de caja, así que se leen aquí para sumarlos a sus totales.
            // El EFECTIVO de encargo se EXCLUYE a propósito: ya se registra como
            // movimiento de caja ("Abono/Cobro/Pago encargo…", tipo Ingreso) al momento
            // de cobrarlo (ver _registerPreorderCash en el cliente). Contarlo también
            // aquí lo DUPLICABA en el arqueo (aparecía como Venta y como Ingreso).
            sql: `SELECT pp.id, pp.method, pp.amount, pp.created_at, pp.preorder_id, po.client_name
                  FROM preorder_payments pp
                  JOIN preorders po ON pp.preorder_id = po.id
                  WHERE pp.register_id = ? AND pp.method IN ('Tarjeta', 'Transferencia')
                    AND po.status != 'canceled'
                  ORDER BY pp.created_at DESC LIMIT 200`,
            args: [registerId],
        },
        {
            sql: `SELECT total, payment_details FROM sales
                  WHERE company_id = ? AND status != 'cancelled'
                    AND payment_method = 'Mixto' AND ${owns.sql}`,
            args: [companyId, ...owns.args],
        },
    ], 'read');

    const salesStats = salesStatsRes.rows[0] || {};
    let cashSalesTotal = parseFloat(salesStats.cash_total) || 0;
    const salesBreakdown = {
        cash: cashSalesTotal,
        card: parseFloat(salesStats.card_total) || 0,
        transfer: parseFloat(salesStats.transfer_total) || 0,
        credit: parseFloat(salesStats.credit_total) || 0,
        total: parseFloat(salesStats.total_sales_amount) || 0,
    };

    mixedSalesRes.rows.forEach(sale => {
        mixedPortions(sale.payment_details).forEach(m => {
            const amount = parseFloat(m.amount || 0);
            if (m.method === 'Efectivo') { cashSalesTotal += amount; salesBreakdown.cash += amount; }
            if (m.method === 'Tarjeta') salesBreakdown.card += amount;
            if (m.method === 'Transferencia') salesBreakdown.transfer += amount;
        });
    });

    // Encargos en Tarjeta/Transferencia → a sus totales. El EFECTIVO de encargo NO se
    // suma aquí: ya está contado como movimiento de caja (Ingreso). Evita el doble
    // conteo que inflaba el saldo esperado y generaba "falta de dinero" falsa.
    const preorderCashTransactions = [];
    (preorderPaymentsRes.rows || []).forEach(r => {
        const amt = parseFloat(r.amount) || 0;
        if (r.method === 'Tarjeta') salesBreakdown.card += amt;
        else if (r.method === 'Transferencia') salesBreakdown.transfer += amt;
    });

    // El orden y el recorte a 20 se hacen aquí (ver la consulta: hacerlo en SQL
    // disparaba un recorrido completo de la tabla).
    const salesTransactions = recentSalesRes.rows
        .map(sale => ({
            type: 'VENTA', amount: parseFloat(sale.total), total: parseFloat(sale.total), date: sale.date, id: sale.id,
        }))
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 20);

    // Un abono o pago de encargo es una VENTA, no una inyección de efectivo al
    // cajón: el encargo es un producto con su costo y su utilidad, igual que
    // cualquier otro. Los que se pagan con tarjeta o transferencia ya se suman a
    // su método (más arriba); el efectivo se anota como movimiento de caja
    // —porque así es como entra al cajón— y por eso quedaba disfrazado de Ingreso.
    // Aquí se reclasifica: la MISMA fila pasa de "Ingresos" a "Ventas en efectivo".
    // El saldo no cambia, porque los dos términos suman igual en el balance.
    const ES_ENCARGO = /encargo/i;

    let movementsIn = 0, movementsOut = 0, preorderCash = 0;
    const movementTransactions = [];
    movementsRes.rows.forEach(mov => {
        const amount = parseFloat(mov.amount);
        const reason = mov.reason || '';
        const date = mov.date || mov.created_at;
        // El id lleva prefijo: un movimiento reclasificado a VENTA compartiría
        // tipo con las ventas reales y sus id chocarían en el listado.
        if (mov.type === 'IN') {
            if (ES_ENCARGO.test(reason)) {
                preorderCash += amount;
                movementTransactions.push({ type: 'VENTA', amount, reason, date, id: `mov${mov.id}` });
            } else {
                movementsIn += amount;
                movementTransactions.push({ type: 'INGRESO', amount, reason, date, id: `mov${mov.id}` });
            }
        } else {
            // Las salidas se dejan como retiro, incluida la "Devolución abono
            // encargo": es plata saliendo del cajón, y así el arqueo la ve donde
            // el cajero la espera.
            movementsOut += amount;
            movementTransactions.push({ type: 'RETIRO', amount, reason, date, id: `mov${mov.id}` });
        }
    });

    cashSalesTotal += preorderCash;
    salesBreakdown.cash += preorderCash;

    const allTransactions = [...salesTransactions, ...preorderCashTransactions, ...movementTransactions]
        .sort((a, b) => new Date(b.date) - new Date(a.date));

    return {
        success: true,
        stats: {
            balance: register.opening_amount + cashSalesTotal + movementsIn - movementsOut,
            sales: cashSalesTotal,
            salesBreakdown,
            movements_in: movementsIn,
            movements_out: movementsOut,
            initial: register.opening_amount,
            transactions: allTransactions,
        },
    };
}

async function registerMethodTransactions(turso, companyId, session, { registerId, method }) {
    if (!registerId || !method) return { success: false, transactions: [] };

    const regRes = await turso.execute({
        sql: 'SELECT user_id, opening_time FROM cash_registers WHERE id = ? AND company_id = ?',
        args: [registerId, companyId],
    });
    if (regRes.rows.length === 0) return { success: false, transactions: [] };
    const owns = saleBelongsToRegister(registerId);

    // Sin ORDER BY/LIMIT en SQL, por el mismo motivo que en registerStats: forzaría
    // el índice de fecha y el recorrido completo de la tabla. Se ordena más abajo.
    const [salesRes, mixedRes, preorderRes] = await turso.batch([
        {
            sql: `SELECT id, date, total, payment_method, payment_details FROM sales
                  WHERE company_id = ? AND status != 'cancelled' AND payment_method = ?
                    AND ${owns.sql}`,
            args: [companyId, method, ...owns.args],
        },
        {
            sql: `SELECT id, date, total, payment_details FROM sales
                  WHERE company_id = ? AND status != 'cancelled' AND payment_method = 'Mixto'
                    AND ${owns.sql}`,
            args: [companyId, ...owns.args],
        },
        {
            sql: `SELECT pp.id, pp.amount, pp.created_at, pp.type, po.id as preorder_id,
                    po.client_name,
                    pt.name as terminal_name,
                    ba.bank_name as bank_name, ba.account_number as bank_account_number
                  FROM preorder_payments pp
                  JOIN preorders po ON pp.preorder_id = po.id
                  LEFT JOIN payment_terminals pt ON pp.terminal_id = pt.id
                  LEFT JOIN bank_accounts ba ON pp.bank_account_id = ba.id
                  WHERE pp.register_id = ? AND pp.method = ?
                    AND po.status != 'canceled'
                  ORDER BY pp.created_at DESC LIMIT 100`,
            args: [registerId, method],
        },
    ], 'read');

    const detailKey = method === 'Tarjeta' ? 'terminal' : 'account';
    const sourceLabel = method === 'Tarjeta' ? 'Datáfono' : 'Cuenta';
    const transactions = [];

    for (const s of salesRes.rows) {
        let detail = null;
        try { detail = JSON.parse(s.payment_details || '{}')[detailKey] || null; } catch { /* noop */ }
        transactions.push({ id: `s_${s.id}`, source: 'POS', reference: `Venta #${s.id}`, amount: parseFloat(s.total) || 0, date: s.date, detail });
    }
    for (const s of mixedRes.rows) {
        mixedPortions(s.payment_details).forEach((m, idx) => {
            if (m.method === method && Number(m.amount) > 0) {
                transactions.push({ id: `m_${s.id}_${idx}`, source: 'POS', reference: `Venta mixta #${s.id}`, amount: parseFloat(m.amount) || 0, date: s.date, detail: m[detailKey] || null });
            }
        });
    }
    // El EFECTIVO de encargo no se lista aquí: se muestra como movimiento de caja
    // (Ingreso), no dentro del método Efectivo, para que el detalle cuadre con el total.
    if (method !== 'Efectivo') {
        for (const p of preorderRes.rows) {
            let detail = null;
            if (method === 'Tarjeta') detail = p.terminal_name || null;
            else if (method === 'Transferencia') detail = p.bank_name ? `${p.bank_name}${p.bank_account_number ? ' · ' + p.bank_account_number : ''}` : null;
            transactions.push({
                id: `p_${p.id}`, source: 'Encargo',
                reference: `Encargo #${p.preorder_id}${p.client_name ? ' · ' + p.client_name : ''}`,
                amount: parseFloat(p.amount) || 0, date: p.created_at, detail,
            });
        }
    }

    transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
    return { success: true, transactions, detailLabel: sourceLabel };
}

async function registersClosed(turso, companyId, session, { limit = 20, offset = 0, utcStart, utcEnd }) {
    let sql = `SELECT cr.*, u.name as user_name
              FROM cash_registers cr
              LEFT JOIN users u ON cr.user_id = u.id
              WHERE cr.status = 'closed' AND cr.company_id = ?`;
    const args = [companyId];
    if (utcStart) { sql += ' AND cr.closing_time >= ?'; args.push(utcStart); }
    if (utcEnd) { sql += ' AND cr.closing_time <= ?'; args.push(utcEnd); }
    sql += ' ORDER BY cr.closing_time DESC LIMIT ? OFFSET ?';
    args.push(limit, offset);
    const result = await turso.execute({ sql, args });
    return { success: true, rows: result.rows };
}

async function cashMovementsList(turso, companyId, session, { limit = 20, offset = 0, utcStart, utcEnd }) {
    let regSql = `SELECT cr.*, u.name as user_name
              FROM cash_registers cr
              LEFT JOIN users u ON cr.user_id = u.id
              WHERE cr.company_id = ?`;
    const regArgs = [companyId];
    if (utcStart) { regSql += ' AND cr.opening_time >= ?'; regArgs.push(utcStart); }
    if (utcEnd) { regSql += ' AND cr.opening_time <= ?'; regArgs.push(utcEnd); }
    regSql += ' ORDER BY cr.opening_time DESC LIMIT ? OFFSET ?';
    regArgs.push(limit, offset);
    const registersRes = await turso.execute({ sql: regSql, args: regArgs });
    const registers = registersRes.rows;
    if (registers.length === 0) return { success: true, rows: [] };

    const registerIds = registers.map(r => r.id);
    const placeholders = registerIds.map(() => '?').join(',');
    const movementsRes = await turso.execute({
        sql: `SELECT cm.* FROM cash_movements cm WHERE cm.company_id = ? AND cm.register_id IN (${placeholders})`,
        args: [companyId, ...registerIds],
    });

    const openingsNode = registers.map(reg => ({
        id: `opening-${reg.id}`, register_id: reg.id, created_at: reg.opening_time,
        type: 'in', amount: reg.opening_amount, reason: 'Apertura de Caja',
        user_name: reg.user_name || 'Desconocido', source: 'opening',
    }));

    const regUserMap = registers.reduce((acc, r) => { acc[r.id] = r.user_name || 'Desconocido'; return acc; }, {});
    const movementsNode = movementsRes.rows.map(mov => {
        const regId = mov.register_id || mov.cash_register_id;
        return {
            id: mov.id, register_id: regId, created_at: mov.date || mov.created_at,
            type: String(mov.type).toLowerCase() === 'in' ? 'in' : 'out',
            amount: mov.amount, reason: mov.reason,
            user_name: regUserMap[regId] || 'Desconocido', source: 'movement',
        };
    });

    return { success: true, rows: [...openingsNode, ...movementsNode] };
}

async function registerReport(turso, companyId, session, { register }) {
    if (!register?.id) return { success: false, error: 'Falta register' };

    // Las ventas de la caja se buscan en DOS pasos, no en uno con OR.
    //
    // La consulta anterior unía ambas condiciones en un solo OR, y esa segunda
    // rama —`register_id IS NULL AND user_id = ? AND date BETWEEN ...`— no puede
    // usar el índice por caja: obliga a recorrer las 76.778 ventas de la empresa.
    // Medido sobre la caja #948: 49,3 segundos para devolver 108 ventas, contra
    // 213 ms buscando solo por register_id. Doscientas treinta veces más lenta
    // para traer exactamente lo mismo — la rama vieja aportaba CERO filas.
    //
    // Cuarenta y nueve segundos no solo hacen esperar: pasan el limite de Vercel
    // y, desde que el POS corta a los 12 segundos, la pantalla se rendia y el
    // sistema se declaraba sin internet teniendo internet.
    //
    // Solo se traen los cuatro campos que se usan más abajo. El SELECT * cargaba
    // además la columna `items` completa de cada venta, sin que nadie la mire.
    const COLS = 'id, total, payment_method, payment_details, status';
    let salesRes = await turso.execute({
        sql: `SELECT ${COLS} FROM sales WHERE company_id = ? AND register_id = ?`,
        args: [companyId, register.id],
    });

    // Respaldo para cajas cerradas ANTES de la migración 0012, que fue la que
    // rellenó `register_id`. Solo corre si la vía rápida no encontró nada, así
    // que el escaneo caro queda reservado para las cajas viejas de verdad, que
    // son pocas y ya no se consultan a diario.
    if (salesRes.rows.length === 0) {
        salesRes = await turso.execute({
            sql: `SELECT ${COLS} FROM sales
                  WHERE company_id = ? AND register_id IS NULL
                    AND user_id = ? AND date >= ? AND date <= ?`,
            args: [companyId, register.user_id, register.opening_time, register.closing_time],
        });
    }

    let cashSalesTotal = 0;
    const salesBreakdown = { cash: 0, card: 0, transfer: 0, credit: 0, total: 0 };
    salesRes.rows.forEach(sale => {
        if (sale.status === 'cancelled') return;
        const total = parseFloat(sale.total);
        salesBreakdown.total += total;
        let cashPart = 0, cardPart = 0, transferPart = 0, creditPart = 0;
        if (sale.payment_method === 'Efectivo') cashPart = total;
        else if (sale.payment_method === 'Tarjeta') cardPart = total;
        else if (sale.payment_method === 'Transferencia') transferPart = total;
        else if (sale.payment_method === 'Crédito') creditPart = total;
        else if (sale.payment_method === 'Mixto' && sale.payment_details) {
            mixedPortions(sale.payment_details).forEach(m => {
                const amount = parseFloat(m.amount || 0);
                if (m.method === 'Efectivo') cashPart += amount;
                if (m.method === 'Tarjeta') cardPart += amount;
                if (m.method === 'Transferencia') transferPart += amount;
            });
        }
        salesBreakdown.cash += cashPart;
        salesBreakdown.card += cardPart;
        salesBreakdown.transfer += transferPart;
        salesBreakdown.credit += creditPart;
        if (cashPart > 0) cashSalesTotal += cashPart;
    });

    const movementsRes = await turso.execute({
        sql: 'SELECT * FROM cash_movements WHERE register_id = ? AND company_id = ?',
        args: [register.id, companyId],
    });
    let movementsIn = 0, movementsOut = 0;
    movementsRes.rows.forEach(mov => {
        const amount = parseFloat(mov.amount);
        if (mov.type === 'IN') movementsIn += amount;
        else movementsOut += amount;
    });

    return {
        success: true,
        report: {
            ...register,
            salesBreakdown,
            movements: { in: movementsIn, out: movementsOut },
            calculatedExpected: register.opening_amount + cashSalesTotal + movementsIn - movementsOut,
        },
    };
}

// ── Conciliación de datáfonos ────────────────────────────────────

async function terminalCardSales(turso, companyId, session, { terminalId, terminalName, utcStart, utcEnd }) {
    if (!terminalId || !utcStart || !utcEnd) return { success: false, sales: [], error: 'Faltan parámetros' };

    const [salesRes, mixedRes, preorderRes] = await turso.batch([
        {
            sql: `SELECT id, date, total, payment_details, client_name, user_id FROM sales
                  WHERE company_id = ? AND date >= ? AND date <= ?
                    AND status != 'cancelled' AND payment_method = 'Tarjeta'
                  ORDER BY date ASC`,
            args: [companyId, utcStart, utcEnd],
        },
        {
            sql: `SELECT id, date, total, payment_details, client_name, user_id FROM sales
                  WHERE company_id = ? AND date >= ? AND date <= ?
                    AND status != 'cancelled' AND payment_method = 'Mixto'
                  ORDER BY date ASC`,
            args: [companyId, utcStart, utcEnd],
        },
        {
            sql: `SELECT pp.id, pp.amount, pp.created_at AS date, pp.type,
                         pp.preorder_id, po.client_name, pp.auth_code
                  FROM preorder_payments pp
                  JOIN preorders po ON pp.preorder_id = po.id
                  WHERE po.company_id = ? AND pp.method = 'Tarjeta'
                    AND pp.terminal_id = ?
                    AND pp.created_at >= ? AND pp.created_at <= ?
                    AND po.status != 'canceled'
                  ORDER BY pp.created_at ASC`,
            args: [companyId, terminalId, utcStart, utcEnd],
        },
    ], 'read');

    const out = [];
    const termIdNum = Number(terminalId);
    const matchesTerminal = (val) => {
        if (val === null || val === undefined || val === '') return false;
        if (typeof val === 'string' && terminalName && val === terminalName) return true;
        const n = Number(val);
        return Number.isFinite(n) && n === termIdNum;
    };

    for (const s of salesRes.rows) {
        try {
            const d = JSON.parse(s.payment_details || '{}');
            if (matchesTerminal(d.terminal)) {
                out.push({
                    id: `s_${s.id}`, source: 'POS', saleId: s.id, date: s.date,
                    total: Number(s.total) || 0, clientName: s.client_name, userId: s.user_id,
                    authCode: (d.authCode || d.auth_code || '').toString().trim(),
                });
            }
        } catch { /* noop */ }
    }
    for (const s of mixedRes.rows) {
        mixedPortions(s.payment_details).forEach((m, idx) => {
            if (m.method === 'Tarjeta' && matchesTerminal(m.terminal) && Number(m.amount) > 0) {
                out.push({
                    id: `m_${s.id}_${idx}`, source: 'POS', saleId: s.id, date: s.date,
                    total: Number(m.amount) || 0, clientName: s.client_name, userId: s.user_id,
                    authCode: (m.authCode || m.auth_code || '').toString().trim(),
                });
            }
        });
    }
    for (const p of preorderRes.rows) {
        out.push({
            id: `p_${p.id}`, source: 'Encargo', preorderId: p.preorder_id, date: p.date,
            total: Number(p.amount) || 0, clientName: p.client_name,
            authCode: (p.auth_code || '').toString().trim(),
        });
    }

    out.sort((a, b) => new Date(a.date) - new Date(b.date));
    return { success: true, sales: out };
}

async function conciliatedSaleIds(turso, companyId, session, { terminalId }) {
    if (!terminalId) return { success: true, ids: [] };
    const r = await turso.execute({
        sql: `SELECT sale_ids FROM payment_reconciliations
              WHERE company_id = ? AND terminal_id = ?
                AND sale_ids IS NOT NULL AND sale_ids != '[]'`,
        args: [companyId, terminalId],
    });
    const ids = [];
    for (const row of r.rows || []) {
        try { JSON.parse(row.sale_ids || '[]').forEach(id => ids.push(id)); } catch { /* noop */ }
    }
    return { success: true, ids };
}

async function untaggedCardSalesCount(turso, companyId, session, { utcStart, utcEnd }) {
    if (!utcStart || !utcEnd) return { success: true, count: 0, total: 0 };
    const r = await turso.execute({
        sql: `SELECT id, total, payment_details FROM sales
              WHERE company_id = ? AND date >= ? AND date <= ?
                AND status != 'cancelled' AND payment_method = 'Tarjeta'`,
        args: [companyId, utcStart, utcEnd],
    });
    let count = 0, total = 0;
    for (const row of r.rows || []) {
        let hasTerminal = false;
        try { if (JSON.parse(row.payment_details || '{}').terminal) hasTerminal = true; } catch { /* noop */ }
        if (!hasTerminal) { count++; total += Number(row.total) || 0; }
    }
    return { success: true, count, total };
}

async function reconciliationsList(turso, companyId, session, { terminalId = null, limit = 50 }) {
    const args = [companyId];
    let sql = `SELECT pr.*, pt.name AS terminal_name, pt.color AS terminal_color, u.name AS user_name
               FROM payment_reconciliations pr
               LEFT JOIN payment_terminals pt ON pt.id = pr.terminal_id
               LEFT JOIN users u ON u.id = pr.created_by
               WHERE pr.company_id = ?`;
    if (terminalId) { sql += ' AND pr.terminal_id = ?'; args.push(terminalId); }
    sql += ' ORDER BY pr.deposit_date DESC, pr.id DESC LIMIT ?';
    args.push(limit);
    const r = await turso.execute({ sql, args });
    return { success: true, reconciliations: r.rows };
}

async function reconciliationSave(turso, companyId, session, { terminalId, depositDate, depositAmount, expectedAmount, saleIds, salesFrom, salesTo, notes }) {
    const difference = (Number(depositAmount) || 0) - (Number(expectedAmount) || 0);
    const r = await turso.execute({
        sql: `INSERT INTO payment_reconciliations
                (company_id, terminal_id, deposit_date, deposit_amount, expected_amount,
                 difference, sale_ids, sales_from, sales_to, notes, created_by, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
              RETURNING *`,
        args: [
            companyId, terminalId, depositDate,
            Number(depositAmount) || 0, Number(expectedAmount) || 0, difference,
            JSON.stringify(saleIds || []),
            salesFrom || null, salesTo || null,
            notes || null, session?.uid ?? null,
        ],
    });
    return { success: true, reconciliation: r.rows[0] };
}

async function reconciliationDelete(turso, companyId, session, { id }) {
    await turso.execute({
        sql: 'DELETE FROM payment_reconciliations WHERE id = ? AND company_id = ?',
        args: [id, companyId],
    });
    return { success: true };
}

export const registerActions = {
    registerCheck,
    registerOpen,
    registerClose,
    cashMovementAdd,
    registerActiveList,
    registerStats,
    registerMethodTransactions,
    registersClosed,
    cashMovementsList,
    registerReport,
    terminalCardSales,
    conciliatedSaleIds,
    untaggedCardSalesCount,
    reconciliationsList,
    reconciliationSave,
    reconciliationDelete,
};
