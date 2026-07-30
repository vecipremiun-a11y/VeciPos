// App Delivery: repartidores, envíos, rastreo y liquidación (migración 0013).
//
// Un ENVÍO es la unidad de trabajo, venga de tienda web, encargo o venta del POS.
// Todas las acciones reciben el companyId ya validado por api/data/actions.js
// (sesión firmada + membresía), así que aquí solo se filtra por company_id.
//
// REGLA DE DINERO: el efectivo que cobra el repartidor entra a la caja por UNA
// SOLA VÍA — la liquidación (settlementCreate). Nunca desde la venta, o el arqueo
// se infla (mismo bug que tuvieron los encargos).

const nowIso = () => new Date().toISOString();

// Estados válidos y su orden natural.
const FLOW = ['pending', 'assigned', 'accepted', 'picked_up', 'on_route', 'delivered'];
const TERMINAL = ['delivered', 'failed', 'canceled'];
// Envíos que el repartidor ya tomó y están en curso.
const EN_CURSO = ['accepted', 'picked_up', 'on_route'];

// Máquina de estados: a qué se puede pasar DESDE cada estado. Se valida en el
// servidor porque es lo único que no se puede saltar desde el cliente: sin esto
// un repartidor marcaba "entregado" sin haber retirado ni salir a reparto.
const NEXT = {
    pending: ['canceled'],                            // se asigna con deliveryAssign
    assigned: ['accepted', 'failed', 'canceled'],     // el repartidor lo acepta
    accepted: ['picked_up', 'failed', 'canceled'],
    picked_up: ['on_route', 'failed', 'canceled'],
    on_route: ['delivered', 'failed', 'canceled'],
};
const STATUS_LABEL = {
    pending: 'Pendiente', assigned: 'Asignado', accepted: 'Aceptado', picked_up: 'Retirado',
    on_route: 'En ruta', delivered: 'Entregado', failed: 'No entregado', canceled: 'Cancelado',
};

let _colsEnsured = false;
async function ensureColumns(turso) {
    if (_colsEnsured) return;
    try { await turso.execute("ALTER TABLE companies ADD COLUMN delivery_assign_mode TEXT DEFAULT 'manual'"); } catch { /* ya existe */ }
    _colsEnsured = true;
}

/**
 * Cuánto DEBE todavía el pedido/venta de origen. Devuelve null si el origen es
 * manual (ahí manda el monto que se puso al crear el envío).
 *   · preorder → remaining_amount
 *   · sale     → solo las de Crédito deben algo (total - amount_paid)
 */
async function pendingOfSource(turso, companyId, sourceType, sourceId) {
    if (!sourceId) return null;
    if (sourceType === 'preorder') {
        const r = await turso.execute({
            sql: 'SELECT COALESCE(remaining_amount, 0) AS pendiente FROM preorders WHERE id = ? AND company_id = ? LIMIT 1',
            args: [sourceId, companyId],
        });
        return r.rows.length ? (Number(r.rows[0].pendiente) || 0) : null;
    }
    if (sourceType === 'sale') {
        const r = await turso.execute({
            sql: `SELECT payment_method, status, total, COALESCE(amount_paid, 0) AS pagado
                  FROM sales WHERE id = ? AND company_id = ? LIMIT 1`,
            args: [sourceId, companyId],
        });
        if (!r.rows.length) return null;
        const s = r.rows[0];
        // Una venta ya cobrada (efectivo/tarjeta) no deja nada por cobrar.
        if (s.payment_method !== 'Crédito' || s.status === 'paid') return 0;
        return Math.max(0, (Number(s.total) || 0) - (Number(s.pagado) || 0));
    }
    return null;
}

/** Recalcula la deuda del cliente (espejo de clientSyncDebt, sin efectos en caja). */
async function recalcClientDebt(turso, companyId, clientId) {
    if (!clientId) return;
    const r = await turso.execute({
        sql: `SELECT COALESCE(SUM(total - COALESCE(amount_paid, 0)), 0) AS deuda,
                     COUNT(*) AS pendientes,
                     COUNT(CASE WHEN payment_due_date IS NOT NULL AND payment_due_date < datetime('now') THEN 1 END) AS vencidas
              FROM sales
              WHERE client_id = ? AND company_id = ? AND payment_method = 'Crédito'
                AND status NOT IN ('paid', 'cancelled')`,
        args: [clientId, companyId],
    });
    const x = r.rows[0] || {};
    await turso.execute({
        sql: 'UPDATE clients SET total_debt = ?, pending_sales_count = ?, overdue_count = ? WHERE id = ? AND company_id = ?',
        args: [Number(x.deuda) || 0, Number(x.pendientes) || 0, Number(x.vencidas) || 0, clientId, companyId],
    });
}

// Guard: el envío debe ser de la empresa. Devuelve la fila o null.
async function ownDelivery(turso, companyId, id, cols = '*') {
    if (!id) return null;
    const r = await turso.execute({
        sql: `SELECT ${cols} FROM deliveries WHERE id = ? AND company_id = ? LIMIT 1`,
        args: [id, companyId],
    });
    return r.rows[0] || null;
}

async function logEvent(turso, companyId, deliveryId, status, session, note = null) {
    await turso.execute({
        sql: 'INSERT INTO delivery_events (company_id, delivery_id, status, by_user_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        args: [companyId, deliveryId, status, session?.uid ?? null, note, nowIso()],
    });
}

// ── Repartidores ─────────────────────────────────────────────────
async function courierList(turso, companyId) {
    const [couriers, load] = await turso.batch([
        {
            sql: `SELECT c.*, u.name AS user_name, u.username
                  FROM couriers c LEFT JOIN users u ON u.id = c.user_id
                  WHERE c.company_id = ? ORDER BY c.active DESC, c.name`,
            args: [companyId],
        },
        {
            // Pedidos activos y recaudación pendiente de rendir por repartidor.
            sql: `SELECT courier_id,
                    SUM(CASE WHEN status IN ('assigned','accepted','picked_up','on_route') THEN 1 ELSE 0 END) AS active_count,
                    SUM(CASE WHEN status = 'delivered' AND settlement_id IS NULL THEN collected_amount ELSE 0 END) AS pending_cash,
                    SUM(CASE WHEN status = 'delivered' AND settlement_id IS NULL THEN 1 ELSE 0 END) AS pending_count
                  FROM deliveries WHERE company_id = ? AND courier_id IS NOT NULL
                  GROUP BY courier_id`,
            args: [companyId],
        },
    ], 'read');

    const byId = new Map((load.rows || []).map(r => [r.courier_id, r]));
    return {
        success: true,
        couriers: (couriers.rows || []).map(c => ({
            ...c,
            active_count: Number(byId.get(c.id)?.active_count) || 0,
            pending_cash: Number(byId.get(c.id)?.pending_cash) || 0,
            pending_count: Number(byId.get(c.id)?.pending_count) || 0,
        })),
    };
}

async function courierSave(turso, companyId, session, { id, name, phone, vehicle, userId, active, status } = {}) {
    if (!name || !String(name).trim()) return { success: false, error: 'Falta el nombre' };
    const iso = nowIso();
    if (id) {
        const own = await turso.execute({ sql: 'SELECT id FROM couriers WHERE id = ? AND company_id = ?', args: [id, companyId] });
        if (!own.rows.length) return { success: false, error: 'Repartidor no encontrado' };
        await turso.execute({
            sql: `UPDATE couriers SET name = ?, phone = ?, vehicle = ?, user_id = ?, active = ?, status = ?, updated_at = ?
                  WHERE id = ? AND company_id = ?`,
            args: [name.trim(), phone || null, vehicle || 'moto', userId || null,
                active === false ? 0 : 1, status || 'off', iso, id, companyId],
        });
        return { success: true, id };
    }
    const r = await turso.execute({
        sql: `INSERT INTO couriers (company_id, user_id, name, phone, vehicle, status, active, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, 'off', 1, ?, ?) RETURNING id`,
        args: [companyId, userId || null, name.trim(), phone || null, vehicle || 'moto', iso, iso],
    });
    return { success: true, id: r.rows[0]?.id };
}

async function courierDelete(turso, companyId, session, { id } = {}) {
    if (!id) return { success: false, error: 'Falta id' };
    // No se borra si tiene envíos activos: se desactiva.
    const busy = await turso.execute({
        sql: `SELECT COUNT(*) AS n FROM deliveries WHERE courier_id = ? AND company_id = ? AND status NOT IN ('delivered','failed','canceled')`,
        args: [id, companyId],
    });
    if (Number(busy.rows[0]?.n) > 0) {
        await turso.execute({ sql: 'UPDATE couriers SET active = 0, updated_at = ? WHERE id = ? AND company_id = ?', args: [nowIso(), id, companyId] });
        return { success: true, deactivated: true };
    }
    await turso.execute({ sql: 'DELETE FROM couriers WHERE id = ? AND company_id = ?', args: [id, companyId] });
    return { success: true };
}

// ── Envíos ───────────────────────────────────────────────────────
async function deliveryBoard(turso, companyId, session, { includeDelivered = true } = {}) {
    await ensureColumns(turso);
    const [rows, counts, mode] = await turso.batch([
        {
            // `pendiente_real` = lo que el pedido/venta debe AHORA. Si ya se cobró
            // en el local llega en 0 y la pantalla avisa que el repartidor no cobra.
            sql: `SELECT d.*, c.name AS courier_name, c.phone AS courier_phone, c.vehicle,
                         CASE
                           WHEN d.source_type = 'preorder'
                             THEN (SELECT COALESCE(p.remaining_amount, 0) FROM preorders p
                                   WHERE p.id = d.source_id AND p.company_id = d.company_id)
                           WHEN d.source_type = 'sale'
                             THEN (SELECT CASE WHEN s.payment_method != 'Crédito' OR s.status = 'paid' THEN 0
                                               ELSE MAX(0, s.total - COALESCE(s.amount_paid, 0)) END
                                   FROM sales s WHERE s.id = d.source_id AND s.company_id = d.company_id)
                           ELSE NULL END AS pendiente_real
                  FROM deliveries d LEFT JOIN couriers c ON c.id = d.courier_id
                  WHERE d.company_id = ?
                    AND (d.status NOT IN ('delivered','failed','canceled')
                         OR date(d.created_at) = date('now'))
                  ORDER BY
                    CASE d.status WHEN 'pending' THEN 0 WHEN 'assigned' THEN 1
                         WHEN 'picked_up' THEN 2 WHEN 'on_route' THEN 3 ELSE 4 END,
                    d.created_at DESC
                  LIMIT 200`,
            args: [companyId],
        },
        {
            sql: `SELECT status, COUNT(*) AS n FROM deliveries
                  WHERE company_id = ? AND (status NOT IN ('delivered','failed','canceled') OR date(created_at) = date('now'))
                  GROUP BY status`,
            args: [companyId],
        },
        { sql: 'SELECT delivery_assign_mode FROM companies WHERE id = ? LIMIT 1', args: [companyId] },
    ], 'read');

    const byStatus = {};
    for (const r of (counts.rows || [])) byStatus[r.status] = Number(r.n) || 0;
    return {
        success: true,
        deliveries: rows.rows || [],
        counts: byStatus,
        assignMode: mode.rows[0]?.delivery_assign_mode || 'manual',
    };
}

/**
 * Crea un envío. `source_type` = 'preorder' | 'sale' | 'manual'.
 * Si el pedido ya viene pagado, amountToCollect = 0 y el repartidor no cobra.
 */
async function deliveryCreate(turso, companyId, session, data = {}) {
    const {
        sourceType = 'manual', sourceId = null,
        clientName, clientPhone, address, addressNotes,
        amountToCollect = 0, deliveryFee = 0, notes, courierId = null,
    } = data;
    if (!address || !String(address).trim()) return { success: false, error: 'Falta la dirección de entrega' };

    // Evita duplicar el envío de un mismo pedido.
    if (sourceId && sourceType !== 'manual') {
        const dup = await turso.execute({
            sql: `SELECT id FROM deliveries WHERE company_id = ? AND source_type = ? AND source_id = ?
                    AND status NOT IN ('canceled') LIMIT 1`,
            args: [companyId, sourceType, sourceId],
        });
        if (dup.rows.length) return { success: false, error: 'Ese pedido ya tiene un envío', id: dup.rows[0].id };
    }

    // Un pedido pasa a reparto SOLO cuando está LISTO. Antes de eso todavía se
    // está aceptando o preparando, y mandarlo a la calle no tiene sentido.
    if (sourceType === 'preorder' && sourceId) {
        const po = await turso.execute({
            sql: 'SELECT status FROM preorders WHERE id = ? AND company_id = ? LIMIT 1',
            args: [sourceId, companyId],
        });
        if (!po.rows.length) return { success: false, error: 'Pedido no encontrado' };
        if (po.rows[0].status !== 'ready') {
            return { success: false, error: 'El pedido todavía no está LISTO. Confírmalo y prepáralo antes de mandarlo a reparto.' };
        }
    }

    const iso = nowIso();
    const status = courierId ? 'assigned' : 'pending';
    const r = await turso.execute({
        sql: `INSERT INTO deliveries
                (company_id, source_type, source_id, courier_id, status, client_name, client_phone,
                 address, address_notes, amount_to_collect, delivery_fee, notes, created_by,
                 assigned_at, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        args: [companyId, sourceType, sourceId, courierId, status, clientName || null, clientPhone || null,
            String(address).trim(), addressNotes || null, Number(amountToCollect) || 0,
            Number(deliveryFee) || 0, notes || null, session?.uid ?? null,
            courierId ? iso : null, iso, iso],
    });
    const id = r.rows[0]?.id;
    await logEvent(turso, companyId, id, status, session);
    return { success: true, id };
}

async function deliveryAssign(turso, companyId, session, { id, courierId } = {}) {
    const d = await ownDelivery(turso, companyId, id, 'id, status');
    if (!d) return { success: false, error: 'Envío no encontrado' };
    if (TERMINAL.includes(d.status)) return { success: false, error: 'El envío ya está cerrado' };
    // Reasignar solo antes de que el repartidor lo retire.
    if (!['pending', 'assigned'].includes(d.status)) {
        return { success: false, error: `El envío ya está en "${STATUS_LABEL[d.status]}": no se puede reasignar.` };
    }
    if (!courierId) {
        await turso.execute({
            sql: "UPDATE deliveries SET courier_id = NULL, status = 'pending', assigned_at = NULL, updated_at = ? WHERE id = ? AND company_id = ?",
            args: [nowIso(), id, companyId],
        });
        await logEvent(turso, companyId, id, 'pending', session, 'Sin asignar');
        return { success: true };
    }
    const c = await turso.execute({ sql: 'SELECT id FROM couriers WHERE id = ? AND company_id = ? AND active = 1', args: [courierId, companyId] });
    if (!c.rows.length) return { success: false, error: 'Repartidor no válido' };

    const iso = nowIso();
    await turso.batch([
        {
            sql: `UPDATE deliveries SET courier_id = ?, status = 'assigned', assigned_at = ?, updated_at = ?
                  WHERE id = ? AND company_id = ?`,
            args: [courierId, iso, iso, id, companyId],
        },
        { sql: "UPDATE couriers SET status = 'busy', updated_at = ? WHERE id = ? AND company_id = ?", args: [iso, courierId, companyId] },
    ]);
    await logEvent(turso, companyId, id, 'assigned', session);
    return { success: true };
}

/**
 * Avanza el estado del envío. Al entregar registra lo cobrado, que queda
 * PENDIENTE DE RENDIR (settlement_id NULL) — no toca la caja todavía.
 */
async function deliveryStatus(turso, companyId, session, { id, status, collectedAmount, collectedMethod, reason, receivedBy, receivedByKind, proofPhoto } = {}) {
    if (!FLOW.includes(status) && !['failed', 'canceled'].includes(status)) {
        return { success: false, error: 'Estado no válido' };
    }
    const d = await ownDelivery(turso, companyId, id, 'id, status, courier_id, amount_to_collect, source_type, source_id');
    if (!d) return { success: false, error: 'Envío no encontrado' };
    if (TERMINAL.includes(d.status)) return { success: false, error: 'El envío ya está cerrado' };

    // No se pueden saltar etapas: asignado → retirado → en ruta → entregado.
    const allowed = NEXT[d.status] || [];
    if (!allowed.includes(status)) {
        const falta = (NEXT[d.status] || []).filter(s => !['failed', 'canceled'].includes(s))[0];
        return {
            success: false,
            error: falta
                ? `No se puede pasar de "${STATUS_LABEL[d.status]}" a "${STATUS_LABEL[status]}". Primero hay que marcar "${STATUS_LABEL[falta]}".`
                : `El envío está en "${STATUS_LABEL[d.status]}" y no admite ese cambio.`,
        };
    }

    const iso = nowIso();
    const sets = ['status = ?', 'updated_at = ?'];
    const args = [status, iso];
    if (status === 'accepted') { sets.push('accepted_at = ?'); args.push(iso); }
    if (status === 'picked_up') { sets.push('picked_up_at = ?'); args.push(iso); }
    if (status === 'delivered') {
        sets.push('delivered_at = ?'); args.push(iso);
        let collected = collectedAmount != null ? Number(collectedAmount) : Number(d.amount_to_collect) || 0;

        // El repartidor solo tiene por rendir lo que el pedido DEBÍA al momento de
        // entregar. Si mientras tanto se cobró en el local (p. ej. "Cobrar y
        // entregar" en Tienda, o un abono del cliente), el saldo ya bajó: esa plata
        // ya entró a la caja y contarla otra vez la duplicaría.
        const pendiente = await pendingOfSource(turso, companyId, d.source_type, d.source_id);
        if (pendiente != null) collected = Math.min(collected, pendiente);

        sets.push('collected_amount = ?'); args.push(collected > 0 ? collected : 0);
        if (collectedMethod) { sets.push('collected_method = ?'); args.push(collectedMethod); }
        // Constancia de entrega: a quién se le dejó y la foto de respaldo.
        if (receivedByKind) { sets.push('received_by_kind = ?'); args.push(receivedByKind); }
        if (receivedBy) { sets.push('received_by = ?'); args.push(String(receivedBy).slice(0, 120)); }
        if (proofPhoto) { sets.push('proof_photo = ?'); args.push(proofPhoto); }
    }
    if (status === 'failed') { sets.push('failed_reason = ?'); args.push(reason || null); }
    args.push(id, companyId);

    await turso.execute({ sql: `UPDATE deliveries SET ${sets.join(', ')} WHERE id = ? AND company_id = ?`, args });
    await logEvent(turso, companyId, id, status, session, reason || null);

    // Si el repartidor se queda sin envíos activos, vuelve a "disponible".
    if (d.courier_id && TERMINAL.includes(status)) {
        const left = await turso.execute({
            sql: `SELECT COUNT(*) AS n FROM deliveries WHERE courier_id = ? AND company_id = ? AND status IN ('assigned','accepted','picked_up','on_route')`,
            args: [d.courier_id, companyId],
        });
        if (Number(left.rows[0]?.n) === 0) {
            await turso.execute({ sql: "UPDATE couriers SET status = 'available', updated_at = ? WHERE id = ? AND company_id = ?", args: [iso, d.courier_id, companyId] });
        }
    }
    return { success: true };
}

/**
 * Pedidos a domicilio LISTOS que todavía no tienen envío. Solo 'ready': mientras
 * el pedido está pendiente, confirmado o preparándose no debe salir a reparto.
 */
async function deliveryImportable(turso, companyId) {
    const r = await turso.execute({
        sql: `SELECT p.id, p.client_name, p.client_phone, p.delivery_address, p.delivery_fee,
                     COALESCE(p.remaining_amount, 0) AS remaining, p.status,
                     COALESCE(p.order_kind, 'encargo') AS order_kind
              FROM preorders p
              WHERE p.company_id = ?
                AND p.delivery_type = 'delivery'
                AND p.status = 'ready'
                AND NOT EXISTS (
                    SELECT 1 FROM deliveries d
                    WHERE d.company_id = p.company_id AND d.source_type = 'preorder'
                      AND d.source_id = p.id AND d.status != 'canceled')
              ORDER BY p.created_at DESC LIMIT 50`,
        args: [companyId],
    });
    return { success: true, orders: r.rows || [] };
}

// ── Modo Repartidor (app del repartidor) ─────────────────────────
async function courierMe(turso, companyId, session) {
    const r = await turso.execute({
        sql: 'SELECT * FROM couriers WHERE company_id = ? AND user_id = ? AND active = 1 LIMIT 1',
        args: [companyId, session?.uid ?? -1],
    });
    return r.rows[0] || null;
}

/**
 * Todo lo que necesita la app del repartidor en una sola llamada:
 *   · nuevos     → asignados que aún no acepta
 *   · enCurso    → aceptados / retirados / en ruta (los que está repartiendo)
 *   · entregados → entregados HOY
 *   · fallidos   → no entregados HOY
 * Los históricos se limitan al día para que la pantalla no crezca sin control.
 * `pickupAddress` es la dirección del local: es a donde navega antes de retirar.
 */
async function courierMyDeliveries(turso, companyId, session) {
    await ensureColumns(turso);
    const me = await courierMe(turso, companyId, session);
    if (!me) return { success: true, isCourier: false, me: null, nuevos: [], enCurso: [], entregados: [], fallidos: [], available: [] };

    const cfg = await turso.execute({
        sql: 'SELECT delivery_assign_mode, full_address, name FROM companies WHERE id = ? LIMIT 1',
        args: [companyId],
    });
    const mode = cfg.rows[0]?.delivery_assign_mode || 'manual';
    // Historial reciente: últimas 24 h. Cubre un turno completo sin depender de la
    // zona horaria (un reparto a las 21:00 en Chile ya es "mañana" en UTC).
    const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    const [nuevos, enCurso, entregados, fallidos, avail, cash] = await turso.batch([
        {
            sql: `SELECT * FROM deliveries WHERE company_id = ? AND courier_id = ? AND status = 'assigned'
                  ORDER BY assigned_at`,
            args: [companyId, me.id],
        },
        {
            sql: `SELECT * FROM deliveries WHERE company_id = ? AND courier_id = ?
                    AND status IN ('accepted','picked_up','on_route')
                  ORDER BY accepted_at, assigned_at`,
            args: [companyId, me.id],
        },
        // El corte se calcula en JS y se compara ISO contra ISO. Las funciones de
        // fecha de SQLite no interpretan el formato que guarda la app
        // (2026-07-29T14:00:00.000Z), así que date()/datetime() daban vacío.
        {
            sql: `SELECT * FROM deliveries WHERE company_id = ? AND courier_id = ? AND status = 'delivered'
                    AND delivered_at >= ?
                  ORDER BY delivered_at DESC`,
            args: [companyId, me.id, desde],
        },
        {
            sql: `SELECT * FROM deliveries WHERE company_id = ? AND courier_id = ? AND status = 'failed'
                    AND updated_at >= ?
                  ORDER BY updated_at DESC`,
            args: [companyId, me.id, desde],
        },
        {
            sql: mode === 'manual'
                ? 'SELECT * FROM deliveries WHERE 1 = 0'
                : `SELECT * FROM deliveries WHERE company_id = ? AND status = 'pending' AND courier_id IS NULL ORDER BY created_at LIMIT 20`,
            args: mode === 'manual' ? [] : [companyId],
        },
        {
            sql: `SELECT COUNT(*) AS n, COALESCE(SUM(collected_amount),0) AS cash
                  FROM deliveries WHERE company_id = ? AND courier_id = ? AND status = 'delivered'
                    AND settlement_id IS NULL`,
            args: [companyId, me.id],
        },
    ], 'read');

    return {
        success: true,
        isCourier: true,
        me,
        assignMode: mode,
        pickupAddress: cfg.rows[0]?.full_address || '',
        pickupName: cfg.rows[0]?.name || 'el local',
        nuevos: nuevos.rows || [],
        enCurso: enCurso.rows || [],
        entregados: entregados.rows || [],
        fallidos: fallidos.rows || [],
        available: avail.rows || [],
        pendingCash: Number(cash.rows[0]?.cash) || 0,
        pendingCount: Number(cash.rows[0]?.n) || 0,
    };
}

/** El repartidor toma un envío disponible (modos 'request' y 'auto'). */
async function courierTake(turso, companyId, session, { id } = {}) {
    const me = await courierMe(turso, companyId, session);
    if (!me) return { success: false, error: 'No estás registrado como repartidor' };
    const d = await ownDelivery(turso, companyId, id, 'id, status, courier_id');
    if (!d) return { success: false, error: 'Envío no encontrado' };
    if (d.courier_id || d.status !== 'pending') return { success: false, error: 'Ese envío ya fue tomado' };
    return deliveryAssign(turso, companyId, session, { id, courierId: me.id });
}

/** Ubicación del repartidor. Se llama solo mientras está en ruta. */
async function courierPing(turso, companyId, session, { lat, lng } = {}) {
    const la = Number(lat), ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return { success: false, error: 'Coordenadas inválidas' };
    const me = await courierMe(turso, companyId, session);
    if (!me) return { success: false, error: 'No estás registrado como repartidor' };
    const iso = nowIso();
    await turso.batch([
        { sql: 'UPDATE couriers SET last_lat = ?, last_lng = ?, last_seen_at = ? WHERE id = ? AND company_id = ?', args: [la, ln, iso, me.id, companyId] },
        { sql: 'INSERT INTO courier_locations (company_id, courier_id, lat, lng, created_at) VALUES (?, ?, ?, ?, ?)', args: [companyId, me.id, la, ln, iso] },
        // Limpieza: el rastro solo guarda las últimas 6 horas.
        { sql: "DELETE FROM courier_locations WHERE courier_id = ? AND created_at < datetime('now', '-6 hours')", args: [me.id] },
    ]);
    return { success: true };
}

// ── Rastreo ──────────────────────────────────────────────────────
async function deliveryTracking(turso, companyId) {
    const [couriers, active] = await turso.batch([
        {
            sql: `SELECT id, name, phone, vehicle, status, last_lat, last_lng, last_seen_at
                  FROM couriers WHERE company_id = ? AND active = 1`,
            args: [companyId],
        },
        {
            sql: `SELECT id, courier_id, status, client_name, address, lat, lng, assigned_at, picked_up_at
                  FROM deliveries WHERE company_id = ? AND status IN ('assigned','accepted','picked_up','on_route')`,
            args: [companyId],
        },
    ], 'read');
    return { success: true, couriers: couriers.rows || [], deliveries: active.rows || [] };
}

// ── Liquidación ──────────────────────────────────────────────────
/**
 * Cierra la recaudación pendiente de un repartidor y la ingresa a la caja
 * indicada como movimiento IN. Esta es la ÚNICA vía por la que el efectivo del
 * delivery entra a caja (evita el doble conteo).
 */
async function settlementCreate(turso, companyId, session, { courierId, registerId, notes } = {}) {
    if (!courierId) return { success: false, error: 'Falta el repartidor' };
    const c = await turso.execute({ sql: 'SELECT id, name FROM couriers WHERE id = ? AND company_id = ?', args: [courierId, companyId] });
    if (!c.rows.length) return { success: false, error: 'Repartidor no encontrado' };

    const pend = await turso.execute({
        sql: `SELECT COUNT(*) AS n, COALESCE(SUM(collected_amount),0) AS total,
                COALESCE(SUM(CASE WHEN collected_method IS NULL OR collected_method = 'Efectivo' THEN collected_amount ELSE 0 END),0) AS cash
              FROM deliveries
              WHERE company_id = ? AND courier_id = ? AND status = 'delivered' AND settlement_id IS NULL`,
        args: [companyId, courierId],
    });
    const n = Number(pend.rows[0]?.n) || 0;
    if (n === 0) return { success: false, error: 'Ese repartidor no tiene entregas pendientes de rendir' };
    const total = Number(pend.rows[0]?.total) || 0;
    const cash = Number(pend.rows[0]?.cash) || 0;
    const iso = nowIso();

    const ins = await turso.execute({
        sql: `INSERT INTO delivery_settlements
                (company_id, courier_id, register_id, total_collected, cash_amount, deliveries_count, status, notes, settled_by, created_at)
              VALUES (?, ?, ?, ?, ?, ?, 'closed', ?, ?, ?) RETURNING id`,
        args: [companyId, courierId, registerId || null, total, cash, n, notes || null, session?.uid ?? null, iso],
    });
    const settlementId = ins.rows[0]?.id;

    // Ventas a Crédito que el repartidor ya cobró: se dan por pagadas y se
    // recalcula la deuda del cliente. NO se usa clientRegisterPayment aquí a
    // propósito: esa función genera una venta que entra a la caja, y el efectivo
    // ya va a entrar por el movimiento de la liquidación (una sola vía).
    const aSaldar = await turso.execute({
        sql: `SELECT d.source_id, d.collected_amount, s.client_id, s.total
              FROM deliveries d JOIN sales s ON s.id = d.source_id AND s.company_id = d.company_id
              WHERE d.company_id = ? AND d.courier_id = ? AND d.status = 'delivered'
                AND d.settlement_id IS NULL AND d.source_type = 'sale'
                AND s.payment_method = 'Crédito' AND s.status != 'paid'`,
        args: [companyId, courierId],
    });
    const clientesTocados = new Set();
    for (const v of (aSaldar.rows || [])) {
        const pagado = Number(v.collected_amount) || 0;
        if (pagado <= 0) continue;
        await turso.execute({
            sql: `UPDATE sales SET amount_paid = COALESCE(amount_paid, 0) + ?,
                    status = CASE WHEN COALESCE(amount_paid, 0) + ? >= total THEN 'paid' ELSE status END
                  WHERE id = ? AND company_id = ?`,
            args: [pagado, pagado, v.source_id, companyId],
        });
        if (v.client_id) clientesTocados.add(v.client_id);
    }
    for (const cl of clientesTocados) await recalcClientDebt(turso, companyId, cl);

    await turso.execute({
        sql: `UPDATE deliveries SET settlement_id = ?, updated_at = ?
              WHERE company_id = ? AND courier_id = ? AND status = 'delivered' AND settlement_id IS NULL`,
        args: [settlementId, iso, companyId, courierId],
    });

    // El efectivo entra a la caja SOLO aquí.
    if (registerId && cash > 0) {
        await turso.execute({
            sql: 'INSERT INTO cash_movements (register_id, type, amount, reason, date, company_id) VALUES (?, ?, ?, ?, ?, ?)',
            args: [registerId, 'IN', cash, `Rendición delivery · ${c.rows[0].name} (${n} entregas)`, iso, companyId],
        });
    }
    return { success: true, settlementId, total, cash, count: n };
}

async function settlementList(turso, companyId, session, { limit = 30 } = {}) {
    const r = await turso.execute({
        sql: `SELECT s.*, c.name AS courier_name FROM delivery_settlements s
              LEFT JOIN couriers c ON c.id = s.courier_id
              WHERE s.company_id = ? ORDER BY s.created_at DESC LIMIT ?`,
        args: [companyId, Math.min(Number(limit) || 30, 100)],
    });
    return { success: true, settlements: r.rows || [] };
}

// ── Ajustes ──────────────────────────────────────────────────────
async function deliverySettingsSave(turso, companyId, session, { assignMode } = {}) {
    await ensureColumns(turso);
    const mode = ['manual', 'request', 'auto'].includes(assignMode) ? assignMode : 'manual';
    await turso.execute({ sql: 'UPDATE companies SET delivery_assign_mode = ? WHERE id = ?', args: [mode, companyId] });
    return { success: true, assignMode: mode };
}

export const deliveryActions = {
    courierList,
    courierSave,
    courierDelete,
    deliveryBoard,
    deliveryCreate,
    deliveryAssign,
    deliveryStatus,
    deliveryImportable,
    courierMyDeliveries,
    courierTake,
    courierPing,
    deliveryTracking,
    settlementCreate,
    settlementList,
    deliverySettingsSave,
};
