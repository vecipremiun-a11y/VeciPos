// Reglas de la oferta: vence por fecha/hora y/o por unidades vendidas (migración 0033).
//
// La oferta se apaga sola cuando se cumple la primera de sus reglas:
//   · offer_until        llegó la fecha y hora
//   · offer_units_limit  se vendieron esas unidades a precio de oferta
//
// El POS ya deja de aplicarla por su cuenta (src/lib/ofertas.js) y miniveci.cl
// recibe la misma fecha y hora para apagarla allá a la misma hora. Lo que se
// hace acá es dejar la BASE al día: apagar las que se cumplieron, guardar
// cuántas unidades se llevan vendidas, y avisarle a la tienda las que se apagaron
// por unidades (esas no tienen hora: la tienda no puede saberlo sola).
//
// Las unidades se cuentan en los renglones de venta (sale_items), no en la venta:
// así no se toca el registro de la venta. Cuentan las vendidas a precio de oferta
// (o menos) desde que se prendió, sin las ventas anuladas. Y los pedidos de la
// tienda web (sin los cancelados): el cupo es UNO para el local y la web
// (decidido con Kevin el 7-oct-2026).

import { syncProductToStore } from '../integration/client.js';

const nowIso = () => new Date().toISOString();

// Lo que la tienda necesita del producto (sin la foto, que no cambia acá).
const COLS_TIENDA = `id, sku, name, category, stock, price, cost, unit, tax_rate, is_offer, offer_price,
    price_ranges, sale_mode, preorder_unit, preorder_billing_unit, preorder_price_per_kg,
    preorder_gram_per_unit, preorder_use_base_price, units_per_box, offer_until`;

const instante = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const t = new Date(v);
    return Number.isFinite(t.getTime()) ? t.toISOString() : null;
};

/**
 * Guarda las reglas de la oferta de un producto, después del guardado normal.
 * `prevOferta` = si el producto ya estaba en oferta antes de guardar: al
 * prenderla de nuevo, la cuenta de unidades empieza de cero.
 *
 * Si el cliente no mandó reglas (pantallas viejas), no toca nada. Sin la
 * migración 0033 tampoco: el producto se guardó igual.
 */
export async function guardarReglasOferta(turso, companyId, id, product, prevOferta) {
    if (!product || (!('offer_until' in product) && !('offer_units_limit' in product))) return;
    const activa = !!product.is_offer && Number(product.offer_price) > 0;
    const hasta = activa ? instante(product.offer_until) : null;
    const limite = activa && Number(product.offer_units_limit) > 0 ? Number(product.offer_units_limit) : null;
    // La cuenta de unidades arranca de cero CUANDO SE GUARDA la regla: al prender
    // la oferta, y también al activar "Por cantidad" o cambiar la cantidad con la
    // oferta ya prendida. Lo vendido antes no cuenta (pedido por Kevin el
    // 7-oct-2026: "se vendieron 120 huevos en el día, activo 80 en oferta y desde
    // ahí empieza a contar"). Guardar el producto por otra cosa no la reinicia.
    let limiteAnterior = null;
    if (activa && prevOferta) {
        try {
            const r = await turso.execute({ sql: 'SELECT offer_units_limit FROM products WHERE id = ? AND company_id = ?', args: [id, companyId] });
            limiteAnterior = Number(r.rows[0]?.offer_units_limit) > 0 ? Number(r.rows[0].offer_units_limit) : null;
        } catch { /* sin la migración 0033 */ }
    }
    // `offer_reiniciar`: la pantalla avisa que se tocó el número de unidades
    // (aunque quede igual al de antes: "quedan 80" desde ahora).
    const reinicia = activa && (!prevOferta || limite !== limiteAnterior || !!product.offer_reiniciar);
    const iso = nowIso();
    try {
        await turso.execute({
            sql: `UPDATE products SET offer_until = ?, offer_units_limit = ?,
                    offer_started_at = CASE WHEN ? THEN ? ELSE COALESCE(offer_started_at, ?) END,
                    offer_units_sold = CASE WHEN ? THEN 0 ELSE offer_units_sold END,
                    updated_at = ?
                  WHERE id = ? AND company_id = ?`,
            args: [hasta, limite, reinicia ? 1 : 0, iso, iso, reinicia ? 1 : 0, iso, id, companyId],
        });
    } catch (err) {
        if (!/no such column/i.test(String(err?.message))) throw err;
    }
}

/** ¿Estaba en oferta? (para saber si al guardar se está prendiendo de nuevo). */
export async function estabaEnOferta(turso, companyId, id) {
    if (!id) return false;
    try {
        const r = await turso.execute({ sql: 'SELECT is_offer FROM products WHERE id = ? AND company_id = ?', args: [id, companyId] });
        return Number(r.rows[0]?.is_offer) === 1;
    } catch {
        return false;
    }
}

/**
 * Revisa las ofertas con reglas de una empresa: apaga las cumplidas y guarda
 * cuántas unidades van vendidas. Devuelve lo que cambió para que el POS lo
 * refleje al instante.
 */
export async function ofertasRevisar(turso, companyId) {
    let filas;
    try {
        filas = (await turso.execute({
            sql: `SELECT ${COLS_TIENDA}, offer_units_limit, offer_units_sold, offer_started_at
                  FROM products
                  WHERE company_id = ? AND is_offer = 1
                    AND (offer_until IS NOT NULL OR offer_units_limit IS NOT NULL)`,
            args: [companyId],
        })).rows;
    } catch (err) {
        if (/no such column/i.test(String(err?.message))) return { success: true, apagadas: [], cuentas: [], reglas: [] };
        throw err;
    }
    if (!filas.length) return { success: true, apagadas: [], cuentas: [], reglas: [] };

    const ahora = Date.now();
    const apagadas = [];
    const cuentas = [];
    for (const p of filas) {
        let vendidas = Number(p.offer_units_sold) || 0;
        const limite = Number(p.offer_units_limit) || 0;
        if (limite > 0) {
            const r = await turso.execute({
                sql: `SELECT COALESCE(SUM(si.quantity), 0) AS n
                      FROM sale_items si
                      JOIN sales s ON s.id = si.sale_id AND s.company_id = si.company_id
                      WHERE si.company_id = ? AND si.product_id = ?
                        AND si.sale_date >= ?
                        AND si.price <= ? + 0.5
                        AND COALESCE(s.status, '') NOT IN ('cancelled', 'canceled')`,
                args: [companyId, p.id, p.offer_started_at || '1970-01-01', Number(p.offer_price) || 0],
            });
            // Pedidos web: el producto viene en external_product_id (el id del
            // POS como texto), y la fecha con otro formato: se comparan con datetime().
            let web = 0;
            // Un pedido que ya se cobró tiene su venta (sale_id, migración 0034):
            // esas unidades ya están en sale_items y no se cuentan dos veces.
            const pedidosWeb = (sinVenta) => turso.execute({
                sql: `SELECT COALESCE(SUM(pi.qty), 0) AS n
                      FROM preorder_items pi
                      JOIN preorders po ON po.id = pi.preorder_id AND po.company_id = ?
                      WHERE po.order_kind = 'store' AND COALESCE(po.status, '') NOT IN ('canceled', 'cancelled')
                        ${sinVenta ? 'AND po.sale_id IS NULL' : ''}
                        AND datetime(po.created_at) >= datetime(?)
                        AND (pi.product_id = ? OR pi.external_product_id = ?)
                        AND pi.unit_price <= ? + 0.5`,
                // El id como TEXTO tal cual ("5840"): un número como parámetro llega como
                // decimal ("5840.0") y no coincide con external_product_id.
                args: [companyId, p.offer_started_at || '1970-01-01', p.id, String(Math.trunc(Number(p.id))), Number(p.offer_price) || 0],
            });
            try {
                let w;
                try { w = await pedidosWeb(true); } catch { w = await pedidosWeb(false); }   // base sin la 0034
                web = Number(w.rows[0]?.n) || 0;
            } catch { /* sin pedidos web: cuenta solo el local */ }
            vendidas = Math.round(((Number(r.rows[0]?.n) || 0) + web) * 1000) / 1000;
        }
        const vencio = p.offer_until && ahora >= new Date(p.offer_until).getTime();
        const agoto = limite > 0 && vendidas >= limite;
        if (vencio || agoto) {
            apagadas.push({ ...p, offer_units_sold: vendidas, motivo: agoto ? 'unidades' : 'fecha' });
        } else if (limite > 0 && vendidas !== (Number(p.offer_units_sold) || 0)) {
            cuentas.push({ id: p.id, vendidas });
        }
    }

    const iso = nowIso();
    const sentencias = [
        ...apagadas.map(p => ({
            sql: 'UPDATE products SET is_offer = 0, offer_units_sold = ?, updated_at = ? WHERE id = ? AND company_id = ?',
            args: [p.offer_units_sold, iso, p.id, companyId],
        })),
        ...cuentas.map(c => ({
            // updated_at cambia a propósito: así los otros equipos traen la cuenta
            // nueva con el próximo sync del catálogo y saben cuántas quedan.
            sql: 'UPDATE products SET offer_units_sold = ?, updated_at = ? WHERE id = ? AND company_id = ?',
            args: [c.vendidas, iso, c.id, companyId],
        })),
        ...apagadas.map(p => ({
            sql: 'INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, NULL, ?, ?, ?, ?)',
            args: [companyId, 'UPDATE', 'PRODUCT_OFFER_END', JSON.stringify({ id: p.id, name: p.name, motivo: p.motivo, vendidas: p.offer_units_sold }), iso],
        })),
    ];
    if (sentencias.length) await turso.batch(sentencias);

    // La tienda: la que se apagó por fecha ya se apagó allá sola (tiene la misma
    // hora), pero se manda igual para dejar todo igual. La que se apagó por
    // unidades, allá no hay forma de saberlo.
    for (const p of apagadas) {
        try {
            await syncProductToStore({ companyId, product: { id: p.id, sku: p.sku, unit: p.unit, is_offer: false, offer_price: 0 } });
        } catch (err) {
            console.warn('[ofertas] no se pudo avisar a la tienda', p.id, err?.message);
        }
    }
    // Cuenta nueva (se vendió en el local): la tienda recibe cuántas quedan, que
    // es lo único que manda (offer_stock). Solo la oferta: nada más del producto.
    const porId = new Map(filas.map(f => [String(f.id), f]));
    for (const c of cuentas) {
        const f = porId.get(String(c.id));
        if (!f?.sku) continue;
        try {
            await syncProductToStore({ companyId, product: { id: f.id, sku: f.sku, unit: f.unit, is_offer: true, offer_price: f.offer_price } });
        } catch (err) {
            console.warn('[ofertas] no se pudo avisar a la tienda cuántas quedan', f.id, err?.message);
        }
    }

    // Las reglas de las ofertas que siguen vivas, para el POS. No viajan en el
    // catálogo a propósito: el catálogo se descarga entero en cada login y
    // contesta desde un índice de cobertura (migración 0026); sumarle columnas lo
    // haría leer cada fila con su foto (9,4 s medidos sin ese índice). Esto son
    // unas pocas filas.
    const idsApagadas = new Set(apagadas.map(p => String(p.id)));
    const vendidasDe = new Map(cuentas.map(c => [String(c.id), c.vendidas]));
    const reglas = filas
        .filter(p => !idsApagadas.has(String(p.id)))
        .map(p => ({
            id: p.id,
            hasta: p.offer_until || null,
            limite: Number(p.offer_units_limit) || null,
            vendidas: vendidasDe.get(String(p.id)) ?? (Number(p.offer_units_sold) || 0),
        }));

    return {
        success: true,
        apagadas: apagadas.map(p => ({ id: p.id, name: p.name, motivo: p.motivo, vendidas: p.offer_units_sold })),
        cuentas,
        reglas,
    };
}

/** Para la tarea diaria: todas las empresas con ofertas con reglas. */
export async function ofertasRevisarTodas(turso) {
    let empresas = [];
    try {
        empresas = (await turso.execute(`SELECT DISTINCT company_id FROM products
            WHERE is_offer = 1 AND (offer_until IS NOT NULL OR offer_units_limit IS NOT NULL)`)).rows.map(r => r.company_id);
    } catch {
        return { empresas: 0, apagadas: 0 };
    }
    let total = 0;
    for (const companyId of empresas) {
        try {
            const r = await ofertasRevisar(turso, companyId);
            total += r.apagadas.length;
        } catch (err) {
            console.warn('[ofertas] revisión falló', companyId, err?.message);
        }
    }
    return { empresas: empresas.length, apagadas: total };
}

export const offerActions = {
    offersSweep: (turso, companyId) => ofertasRevisar(turso, companyId),
};
