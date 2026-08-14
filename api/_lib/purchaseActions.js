// Compras y proveedores server-side (Fase 1 · Paso 14).
// Lógica portada tal cual de useStore: compra = INSERT + stock/lotes + audit
// + espejo purchase_items (mismo módulo compartido) + resumen por proveedor.

import { mirrorPurchaseItems } from '../../src/lib/itemNormalization.js';

const nowIso = () => new Date().toISOString();

async function auditLog(turso, companyId, session, action, entity, details) {
    await turso.execute({
        sql: 'INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        args: [companyId, session?.uid ?? null, action, entity, JSON.stringify(details), nowIso()],
    });
}

// ── Proveedores ──────────────────────────────────────────────────

async function supplierCreate(turso, companyId, session, { supplier }) {
    if (!supplier?.name) return { success: false, error: 'Falta el nombre del proveedor' };
    const result = await turso.execute({
        sql: `INSERT INTO suppliers (name, phone, email, seller_name, order_days, delivery_days, status, company_id, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
        args: [supplier.name, supplier.phone || '', supplier.email || '', supplier.seller_name || '',
            supplier.order_days || '', supplier.delivery_days || '', supplier.status || 'active',
            companyId, nowIso()],
    });
    await auditLog(turso, companyId, session, 'CREATE', 'SUPPLIER', { name: supplier.name });
    return { success: true, supplier: result.rows[0] };
}

async function supplierUpdate(turso, companyId, session, { id, supplier }) {
    if (!id || !supplier) return { success: false, error: 'Faltan datos' };

    const prev = await turso.execute({
        sql: 'SELECT name FROM suppliers WHERE id = ? AND company_id = ?',
        args: [id, companyId],
    });
    if (prev.rows.length === 0) return { success: false, error: 'Supplier not found' };
    const oldName = prev.rows[0].name;
    const nameChanged = oldName !== supplier.name;

    const queries = [{
        sql: 'UPDATE suppliers SET name = ?, phone = ?, email = ?, seller_name = ?, order_days = ?, delivery_days = ?, status = ? WHERE id = ? AND company_id = ?',
        args: [supplier.name, supplier.phone || '', supplier.email || '', supplier.seller_name || '',
            supplier.order_days || '', supplier.delivery_days || '', supplier.status || 'active', id, companyId],
    }];
    if (nameChanged) {
        queries.push({
            sql: 'UPDATE products SET supplier = ? WHERE supplier = ? AND company_id = ?',
            args: [supplier.name, oldName, companyId],
        });
    }
    queries.push({
        sql: 'INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        args: [companyId, session?.uid ?? null, 'UPDATE', 'SUPPLIER', JSON.stringify({ id, name: supplier.name }), nowIso()],
    });
    await turso.batch(queries);
    return { success: true, nameChanged, oldName };
}

async function supplierDelete(turso, companyId, session, { id }) {
    if (!id) return { success: false, error: 'Falta id' };
    await turso.execute({
        sql: 'DELETE FROM suppliers WHERE id = ? AND company_id = ?',
        args: [id, companyId],
    });
    await auditLog(turso, companyId, session, 'DELETE', 'SUPPLIER', { id });
    return { success: true };
}

// ── Órdenes a proveedor ──────────────────────────────────────────

async function supplierOrdersFetch(turso, companyId, session, { filters = {} }) {
    let sql = 'SELECT * FROM supplier_orders WHERE company_id = ?';
    const args = [companyId];
    if (filters.supplier_id) { sql += ' AND supplier_id = ?'; args.push(filters.supplier_id); }
    if (filters.status) { sql += ' AND status = ?'; args.push(filters.status); }
    sql += ' ORDER BY created_at DESC';
    const result = await turso.execute({ sql, args });
    return { success: true, rows: result.rows };
}

async function supplierOrderCreate(turso, companyId, session, { orderData }) {
    const result = await turso.execute({
        sql: `INSERT INTO supplier_orders (
                company_id, user_id, supplier_id, supplier_name, seller_name,
                total_amount, items, status, created_at, expected_delivery_date
              ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?) RETURNING *`,
        args: [companyId, session?.uid ?? null, orderData.supplier_id, orderData.supplier_name,
            orderData.seller_name || null, orderData.total_amount, JSON.stringify(orderData.items),
            nowIso(), orderData.expected_delivery_date || null],
    });
    return { success: true, order: result.rows[0] };
}

// Cambia el estado de un pedido a proveedor. Lo usa "Pasar a Compra": una vez
// guardada la compra, el pedido queda 'received' y deja de figurar como
// pendiente —si no, seguía apareciendo por cobrar y se corría el riesgo de
// cargarlo dos veces—.
async function supplierOrderSetStatus(turso, companyId, session, { id, status }) {
    if (!id || !status) return { success: false, error: 'Faltan datos' };
    if (!['pending', 'received', 'cancelled'].includes(status)) {
        return { success: false, error: 'Estado inválido' };
    }
    const r = await turso.execute({
        sql: 'UPDATE supplier_orders SET status = ? WHERE id = ? AND company_id = ?',
        args: [status, id, companyId],
    });
    if (!r.rowsAffected) return { success: false, error: 'Pedido no encontrado' };
    return { success: true };
}

// Agrega productos a un pedido YA creado (se olvidó alguno al armarlo).
//
// La fusión se hace acá y no en el navegador: los items viven en una columna
// JSON, así que leer-modificar-escribir desde el cliente pisaría lo que otro
// haya agregado mientras tanto. El total se recalcula del lado del servidor por
// lo mismo.
async function supplierOrderAddItems(turso, companyId, session, { id, items }) {
    if (!id || !Array.isArray(items) || !items.length) return { success: false, error: 'Faltan datos' };

    const r = await turso.execute({
        sql: 'SELECT items, status FROM supplier_orders WHERE id = ? AND company_id = ?',
        args: [id, companyId],
    });
    const row = r.rows[0];
    if (!row) return { success: false, error: 'Pedido no encontrado' };
    // Un pedido recibido ya tiene su compra cargada: sumarle productos ahora
    // dejaría el pedido y la compra diciendo cosas distintas.
    if (row.status === 'received') return { success: false, error: 'El pedido ya fue recibido' };

    let actuales = [];
    try { actuales = JSON.parse(row.items) || []; } catch { actuales = []; }
    if (!Array.isArray(actuales)) actuales = [];

    const fusionados = [...actuales];
    for (const nuevo of items) {
        const bruto = Number(nuevo.costWithTax) || Number(nuevo.cost) || 0;
        const linea = {
            id: nuevo.id,
            name: nuevo.name,
            sku: nuevo.sku || '',
            cost: Number(nuevo.cost) || 0,
            costWithTax: bruto,
            quantity: Number(nuevo.quantity) || 0,
            taxRate: Number(nuevo.taxRate) || 0,
        };
        linea.total = bruto * linea.quantity;

        // Si el producto ya estaba en el pedido se suma la cantidad, en vez de
        // dejar dos líneas del mismo producto.
        const idx = fusionados.findIndex(i => String(i.id) === String(linea.id));
        if (idx >= 0) {
            const cantidad = (Number(fusionados[idx].quantity) || 0) + linea.quantity;
            fusionados[idx] = { ...linea, quantity: cantidad, total: bruto * cantidad };
        } else {
            fusionados.push(linea);
        }
    }

    const total = fusionados.reduce((s, i) => s + (Number(i.total) || 0), 0);
    await turso.execute({
        sql: 'UPDATE supplier_orders SET items = ?, total_amount = ? WHERE id = ? AND company_id = ?',
        args: [JSON.stringify(fusionados), total, id, companyId],
    });
    return { success: true, items: fusionados, total_amount: total };
}

async function supplierOrderDelete(turso, companyId, session, { id }) {
    if (!id) return { success: false, error: 'Falta id' };
    await turso.execute({
        sql: 'DELETE FROM supplier_orders WHERE id = ? AND company_id = ?',
        args: [id, companyId],
    });
    await auditLog(turso, companyId, session, 'DELETE', 'SUPPLIER_ORDER', { id });
    return { success: true };
}

// ── Compras ──────────────────────────────────────────────────────

async function purchaseCreate(turso, companyId, session, { purchase }) {
    if (!purchase?.items?.length) return { success: false, error: 'Compra sin items' };

    // 1. Insert compra (primero, para enlazar lotes por purchase_id)
    const purchaseResult = await turso.execute({
        sql: `INSERT INTO purchases (supplier_id, supplier_name, invoice_number, date, total, items, status, user_id,
                is_credit, credit_days, expiry_date, deposit, payment_method, company_id, payment_observation, payment_document)
              VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        args: [
            purchase.supplierId, purchase.supplierName, purchase.invoiceNumber || '', purchase.date,
            purchase.total, JSON.stringify(purchase.items), session?.uid ?? null,
            purchase.isCredit ? 1 : 0, purchase.creditDays || null, purchase.expiryDate || null,
            purchase.deposit || 0, purchase.paymentMethod || 'Efectivo', companyId,
            purchase.observation || null, purchase.document || null,
        ],
    });
    const rawId = purchaseResult.rows[0]?.id || purchaseResult.lastInsertRowid;
    const purchaseId = typeof rawId === 'bigint' ? Number(rawId) : rawId;

    // 2. Batch: stock/costo/precio + lote por item + audit
    const queries = [];
    purchase.items.forEach(item => {
        queries.push({
            sql: 'UPDATE products SET stock = ROUND(stock + ?, 3), cost = ?, price = ?, sku = ?, tax_rate = ?, supplier = ? WHERE id = ? AND company_id = ?',
            args: [item.quantity, item.cost, item.price, item.sku, item.tax || 0, purchase.supplierName, item.id, companyId],
        });
        queries.push({
            sql: `INSERT INTO product_lots (product_id, batch_number, expiry_date, quantity, initial_quantity, cost,
                    supplier_name, created_at, status, company_id, purchase_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
            args: [item.id, item.batchNumber || '', item.expiryDate || null, item.quantity, item.quantity,
                item.cost, purchase.supplierName, nowIso(), companyId, purchaseId],
        });
    });
    queries.push({
        sql: 'INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        args: [companyId, session?.uid ?? null, 'CREATE', 'PURCHASE', JSON.stringify({ total: purchase.total }), nowIso()],
    });
    await turso.batch(queries);

    // 3. Espejo purchase_items (post-commit; nunca hace fallar la compra)
    try {
        await mirrorPurchaseItems(turso, {
            purchaseId, companyId, purchaseDate: purchase.date, items: purchase.items, source: 'live',
        });
    } catch (err) {
        console.error('[fase4] mirrorPurchaseItems:', err?.message || err);
    }

    // 4. Resumen por proveedor (portado de updateSupplierPurchaseSummary)
    try {
        const purchaseDate = new Date(purchase.date || nowIso());
        const dateStr = purchaseDate.toLocaleDateString('en-CA');
        const supplierId = purchase.supplierId;
        const summaryId = `supp_buy_${companyId}_${supplierId}_${dateStr}`;
        const totalItems = purchase.items.reduce((sum, item) => sum + Number(item.quantity), 0);

        const existing = await turso.execute({
            sql: 'SELECT * FROM supplier_purchase_summary WHERE company_id = ? AND supplier_id = ? AND date = ?',
            args: [companyId, supplierId, dateStr],
        });
        if (existing.rows.length === 0) {
            await turso.execute({
                sql: `INSERT INTO supplier_purchase_summary
                      (id, company_id, supplier_id, supplier_name, date, total_purchases, total_amount, total_items, created_at, updated_at)
                      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
                args: [summaryId, companyId, supplierId, purchase.supplierName, dateStr, purchase.total, totalItems, nowIso(), nowIso()],
            });
        } else {
            await turso.execute({
                sql: `UPDATE supplier_purchase_summary SET
                        total_purchases = total_purchases + 1,
                        total_amount = total_amount + ?,
                        total_items = total_items + ?,
                        updated_at = ?
                      WHERE id = ?`,
                args: [purchase.total, totalItems, nowIso(), summaryId],
            });
        }
    } catch (e) {
        console.error('Error updating supplier summary:', e);
    }

    return { success: true, purchaseId };
}

async function purchasesFetch(turso, companyId, session, { offset = 0, limit = 50 }) {
    const result = await turso.execute({
        sql: 'SELECT * FROM purchases WHERE company_id = ? ORDER BY date DESC LIMIT ? OFFSET ?',
        args: [companyId, limit, offset],
    });
    return { success: true, rows: result.rows };
}

async function purchaseDetails(turso, companyId, session, { id }) {
    const result = await turso.execute({
        sql: 'SELECT * FROM purchases WHERE id = ? AND company_id = ?',
        args: [id, companyId],
    });
    return { success: true, purchase: result.rows[0] || null };
}

async function purchaseDelete(turso, companyId, session, { id }) {
    if (!id) return { success: false, error: 'Falta id' };
    await turso.execute({
        sql: 'DELETE FROM purchases WHERE id = ? AND company_id = ?',
        args: [id, companyId],
    });
    await auditLog(turso, companyId, session, 'DELETE', 'PURCHASE', { id });
    return { success: true };
}

async function supplierPurchaseSummaryGet(turso, companyId, session, { startDate, endDate }) {
    const result = await turso.execute({
        sql: `SELECT supplier_id, supplier_name,
                SUM(total_purchases) as total_purchases,
                SUM(total_amount) as total_amount,
                SUM(total_items) as total_items
              FROM supplier_purchase_summary
              WHERE company_id = ? AND date BETWEEN ? AND ?
              GROUP BY supplier_id, supplier_name
              ORDER BY total_amount DESC`,
        args: [companyId, startDate, endDate],
    });
    return { success: true, suppliers: result.rows };
}

// Pagos de facturas de compra (Paso 21) — FIX cross-tenant: antes el UPDATE
// iba solo por id; ahora siempre filtra por company_id.
async function invoicePayFull(turso, companyId, session, { ids, paymentDate }) {
    const list = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isFinite);
    if (!list.length) return { success: false, error: 'Sin facturas' };
    const ph = list.map(() => '?').join(',');
    await turso.execute({
        sql: `UPDATE purchases SET amount_paid = total, status = 'paid', payment_date = ? WHERE id IN (${ph}) AND company_id = ?`,
        args: [paymentDate, ...list, companyId],
    });
    await auditLog(turso, companyId, session, 'UPDATE', 'INVOICE_PAY', { ids: list, full: true });
    return { success: true };
}

async function invoicePayPartial(turso, companyId, session, { id, newPaid, isPaidFull, paymentDate }) {
    if (!id) return { success: false, error: 'Falta id' };
    await turso.execute({
        sql: 'UPDATE purchases SET amount_paid = ?, status = ?, payment_date = ? WHERE id = ? AND company_id = ?',
        args: [newPaid, isPaidFull ? 'paid' : 'partial', paymentDate, id, companyId],
    });
    await auditLog(turso, companyId, session, 'UPDATE', 'INVOICE_PAY', { id, newPaid });
    return { success: true };
}

// ── Pedido armado desde una factura leída por el Asistente ───────────────
//
// Es la ÚNICA escritura que puede hacer la IA, y el objeto se eligió a
// propósito: un pedido a proveedor no mueve stock, no mueve plata y se borra
// con un clic. Lo que sí mueve —la compra— sigue necesitando que una persona
// la revise y apriete Guardar, con el mismo flujo de "Pasar a Compra" de
// siempre.
//
// El emparejamiento de productos es la parte delicada. La factura dice "TOALLA
// FEM KOTEX COM&PROT NOCT C/A 24X8" y en el catálogo puede estar como "Kotex
// Nocturna 8und": nunca coinciden literal. Se busca por palabras y se puntúa,
// igual que en costoHistorico.
//
// Lo que NO se pudo emparejar no se inventa ni se descarta en silencio: vuelve
// en `sinEmparejar` para que el asistente lo diga y la persona decida.
function palabrasDe(texto) {
    return String(texto || '')
        .toLowerCase()
        .replace(/[^a-z0-9áéíóúñ\s]/gi, ' ')
        .split(/\s+/)
        .filter(p => p.length >= 3)
        .slice(0, 8);
}

// Los nombres del catálogo llevan tildes y los de las facturas no. Sin esta
// normalización, "instantanea" no encontraba "Instantánea" — y ese punto perdido
// alcanzó para que "SOPA BOWL POLLO" terminara emparejado con el producto de
// CARNE. Se normaliza la columna en la consulta, porque SQLite compara LIKE sin
// distinguir mayúsculas pero sí distinguiendo tildes.
const SIN_TILDES = (col) =>
    `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(${col}),'á','a'),'é','e'),'í','i'),'ó','o'),'ú','u')`;

const quitarTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

async function buscarProducto(turso, companyId, descripcion) {
    const palabras = palabrasDe(quitarTildes(descripcion));
    if (!palabras.length) return null;
    const campo = SIN_TILDES('name');
    const puntaje = palabras.map(() => `(CASE WHEN ${campo} LIKE ? THEN 1 ELSE 0 END)`).join(' + ');
    const alguna = palabras.map(() => `${campo} LIKE ?`).join(' OR ');
    const comodines = palabras.map(p => `%${p}%`);
    const r = await turso.execute({
        sql: `SELECT id, name, sku, cost, tax_rate, ${puntaje} AS coincidencias
              FROM products
              WHERE company_id = ? AND (${alguna})
              ORDER BY coincidencias DESC, LENGTH(name) ASC LIMIT 4`,
        args: [...comodines, companyId, ...comodines],
    });
    const mejor = r.rows[0];
    if (!mejor) return null;

    // Con una sola palabra en común el riesgo de emparejar mal es alto ("huevo"
    // matchea con el chocolate). Se exige la mitad de las palabras, y al menos
    // dos cuando la descripción da para eso.
    const minimo = Math.max(palabras.length >= 4 ? 2 : 1, Math.ceil(palabras.length / 2));
    if (Number(mejor.coincidencias) < minimo) return null;

    // EMPATE = NO EMPAREJAR. Si dos productos puntúan igual, la diferencia entre
    // ellos está justo en la palabra que importa —el sabor, el tamaño, la
    // variante— y elegir uno "porque el nombre es más corto" es exactamente cómo
    // el pollo terminó cargado como carne. Un renglón sin emparejar se ve y se
    // corrige; uno emparejado mal se guarda y desajusta el stock en silencio.
    const segundo = r.rows[1];
    if (segundo && Number(segundo.coincidencias) === Number(mejor.coincidencias)) {
        return {
            ambiguo: true,
            // Van con id y con su impuesto, no solo el nombre: la pantalla los
            // muestra como botones para que la persona elija cuál era, y con el
            // nombre suelto habría que volver a buscarlo para engancharlo.
            candidatos: r.rows
                .filter(x => Number(x.coincidencias) === Number(mejor.coincidencias))
                .map(x => ({
                    id: Number(x.id),
                    name: x.name,
                    sku: x.sku || '',
                    taxRate: Number(x.tax_rate) || 0,
                })),
        };
    }

    return { ...mejor, alternativas: r.rows.slice(1).map(x => x.name) };
}

async function supplierOrderFromInvoice(turso, companyId, session, { proveedor, lineas = [], numeroFactura = null }) {
    if (!Array.isArray(lineas) || lineas.length === 0) {
        return { success: false, error: 'La factura no trae renglones' };
    }

    // Proveedor: se busca por nombre; si no está, el pedido se crea igual sin
    // vincularlo, porque perder la factura entera por eso sería peor.
    let supplierId = null, supplierName = proveedor || 'Sin proveedor';
    if (proveedor) {
        const s = await turso.execute({
            sql: 'SELECT id, name FROM suppliers WHERE company_id = ? AND LOWER(name) LIKE ? LIMIT 1',
            args: [companyId, `%${String(proveedor).toLowerCase().split(/\s+/)[0]}%`],
        });
        if (s.rows[0]) { supplierId = s.rows[0].id; supplierName = s.rows[0].name; }
    }

    const items = [];
    const sinEmparejar = [];
    for (const l of lineas) {
        const cantidad = Number(l.cantidad) || 0;
        const costo = Number(l.costo) || 0;
        if (cantidad <= 0 || costo <= 0) {
            sinEmparejar.push({ descripcion: l.descripcion, motivo: 'sin cantidad o sin costo' });
            continue;
        }
        const p = await buscarProducto(turso, companyId, l.descripcion);
        if (!p) {
            sinEmparejar.push({ descripcion: l.descripcion, cantidad, costo, motivo: 'no está en el catálogo' });
            continue;
        }
        if (p.ambiguo) {
            sinEmparejar.push({
                descripcion: l.descripcion, cantidad, costo,
                // El IVA del renglón viaja con él: si después se engancha a mano
                // desde la pantalla, el costo con impuesto tiene que salir del
                // que traía la factura, no del que el producto tenga en su ficha.
                iva: l.iva != null ? Number(l.iva) : null,
                motivo: 'hay varios productos que le calzan igual; elegí vos cuál',
                candidatos: p.candidatos,
            });
            continue;
        }
        const tasa = l.iva != null ? Number(l.iva) : Number(p.tax_rate) || 0;
        const costoConIva = Math.round(costo * (1 + tasa / 100));
        items.push({
            id: p.id,
            name: p.name,
            sku: p.sku || '',
            cost: costo,
            costWithTax: costoConIva,
            quantity: cantidad,
            taxRate: tasa,
            // Con IVA, igual que en "Realizar Pedido" (Orders.jsx). Antes acá se
            // guardaba el neto y el pedido nacido de una foto mostraba un total
            // 19% más bajo que el mismo pedido cargado a mano — y ese número es
            // el que después viaja a Compras.
            total: costoConIva * cantidad,
            // Se guarda cómo venía en la factura: al revisar en Compras, es lo
            // único que permite darse cuenta de un emparejamiento equivocado.
            desdeFactura: l.descripcion,
            alternativas: p.alternativas,
        });
    }

    if (items.length === 0) {
        return { success: false, error: 'Ningún renglón se pudo emparejar con el catálogo', sinEmparejar };
    }

    const total = items.reduce((s, i) => s + i.total, 0);
    // El neto se calcula aparte solo para poder compararlo contra el neto
    // impreso en la factura: es el control de si entró todo o quedó algo afuera.
    const totalNeto = items.reduce((s, i) => s + i.cost * i.quantity, 0);
    // El número de factura queda guardado para poder detectar la misma foto
    // cargada dos veces, y para volver del pedido al papel cuando algo no cuadra.
    const folio = numeroFactura ? String(numeroFactura).trim() : null;
    const result = await turso.execute({
        sql: `INSERT INTO supplier_orders (
                company_id, user_id, supplier_id, supplier_name, seller_name,
                total_amount, items, status, created_at, expected_delivery_date,
                invoice_number
              ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?) RETURNING id`,
        args: [companyId, session?.uid ?? null, supplierId, supplierName, null,
            total, JSON.stringify(items), nowIso(), null, folio || null],
    });

    return {
        success: true,
        pedidoId: Number(result.rows[0].id),
        proveedor: supplierName,
        numeroFactura: folio,
        emparejados: items.length,
        total,
        totalNeto,
        items: items.map(i => ({ producto: i.name, desdeFactura: i.desdeFactura, cantidad: i.quantity, costo: i.cost })),
        sinEmparejar,
    };
}

export { supplierOrderFromInvoice };

export const purchaseActions = {
    invoicePayFull,
    invoicePayPartial,
    supplierCreate,
    supplierUpdate,
    supplierDelete,
    supplierOrdersFetch,
    supplierOrderCreate,
    supplierOrderSetStatus,
    supplierOrderAddItems,
    supplierOrderDelete,
    purchaseCreate,
    purchasesFetch,
    purchaseDetails,
    purchaseDelete,
    supplierPurchaseSummaryGet,
};
