// Compras y proveedores server-side (Fase 1 · Paso 14).
// Lógica portada tal cual de useStore: compra = INSERT + stock/lotes + audit
// + espejo purchase_items (mismo módulo compartido) + resumen por proveedor.

import { mirrorPurchaseItems } from '../../src/lib/itemNormalization.js';
import { presentationActions } from './presentationActions.js';

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
/**
 * "Este renglón no era 1 caja, eran 12 paquetes": convierte una línea del pedido.
 *
 * La plata del renglón NO cambia —se reparte—: la cantidad se multiplica y el
 * costo se divide por la misma cantidad de unidades. Lo confirma la persona
 * desde el resumen de la factura cuando el sistema no pudo estar seguro solo
 * (ver detectarBulto), y queda guardado en la ficha del producto para que la
 * próxima factura del mismo proveedor entre sola.
 */
async function supplierOrderSetItemPack(turso, companyId, session, { id, productId, unidades }) {
    const porCaja = Math.round(Number(unidades) || 0);
    if (!id || !productId || porCaja < 2) return { success: false, error: 'Faltan datos' };

    const r = await turso.execute({
        sql: 'SELECT items, status FROM supplier_orders WHERE id = ? AND company_id = ?',
        args: [id, companyId],
    });
    const row = r.rows[0];
    if (!row) return { success: false, error: 'Pedido no encontrado' };
    if (row.status === 'received') return { success: false, error: 'El pedido ya fue recibido' };

    let actuales = [];
    try { actuales = JSON.parse(row.items) || []; } catch { actuales = []; }
    const idx = actuales.findIndex(i => String(i.id) === String(productId));
    if (idx < 0) return { success: false, error: 'Ese producto no está en el pedido' };

    const linea = actuales[idx];
    const cantidad = Math.round((Number(linea.quantity) || 0) * porCaja * 1000) / 1000;
    const costo = Math.round(((Number(linea.cost) || 0) / porCaja) * 100) / 100;
    const tasa = Number(linea.taxRate) || 0;
    const costoConIva = Math.round(costo * (1 + tasa / 100));
    actuales[idx] = { ...linea, quantity: cantidad, cost: costo, costWithTax: costoConIva, total: costoConIva * cantidad };

    const total = actuales.reduce((s, i) => s + (Number(i.total) || 0), 0);
    await turso.execute({
        sql: 'UPDATE supplier_orders SET items = ?, total_amount = ? WHERE id = ? AND company_id = ?',
        args: [JSON.stringify(actuales), total, id, companyId],
    });
    try {
        await turso.execute({
            sql: 'UPDATE products SET units_per_box = ? WHERE id = ? AND company_id = ?',
            args: [porCaja, productId, companyId],
        });
    } catch { /* el pedido ya quedó bien; la memoria es un extra */ }

    return { success: true, items: actuales, total, cantidad, costo };
}

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
        // Un renglón de factura enganchado a mano trae su número de renglón y
        // cómo venía escrito: con eso vuelve a su lugar y se ve de dónde salió.
        if (Number(nuevo.renglon) > 0) linea.renglon = Number(nuevo.renglon);
        if (nuevo.desdeFactura) linea.desdeFactura = String(nuevo.desdeFactura);
        if (nuevo.codigoProveedor) linea.codigoProveedor = String(nuevo.codigoProveedor).trim();
        linea.total = bruto * linea.quantity;

        // Si el producto ya estaba en el pedido se suma la cantidad, en vez de
        // dejar dos líneas del mismo producto. Se conserva lo que ya tenía (de
        // qué renglón de la factura vino, su código): antes se pisaba.
        const idx = fusionados.findIndex(i => String(i.id) === String(linea.id));
        if (idx >= 0) {
            const previa = fusionados[idx];
            const cantidad = (Number(previa.quantity) || 0) + linea.quantity;
            const renglones = [previa.renglon, linea.renglon].filter(n => Number(n) > 0);
            fusionados[idx] = {
                ...previa, ...linea,
                desdeFactura: previa.desdeFactura || linea.desdeFactura,
                codigoProveedor: previa.codigoProveedor || linea.codigoProveedor,
                ...(renglones.length ? { renglon: Math.min(...renglones) } : {}),
                quantity: cantidad, total: bruto * cantidad,
            };
        } else {
            fusionados.push(linea);
        }
    }

    // Mismo orden que la factura. Lo que no viene de un renglón (agregado con
    // "Agregar productos") queda al final, en el orden en que se agregó.
    // Pedidos que no nacieron de una factura no tienen renglón: quedan igual.
    if (fusionados.some(i => Number(i.renglon) > 0)) {
        fusionados.sort((a, b) => (Number(a.renglon) || Infinity) - (Number(b.renglon) || Infinity));
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

    // ── Antes de tocar nada: ¿qué productos de la factura existen? ───
    //
    // El `UPDATE products … WHERE id = ? AND company_id = ?` no afecta ninguna
    // fila si ese producto no existe, y nadie miraba el resultado. La compra
    // contestaba "listo", creaba un lote colgado de un producto inexistente, y
    // esa mercadería no llegaba a ningún inventario. Sin un solo aviso.
    //
    // Es por donde se pierde mercadería en silencio: alcanza con que el
    // emparejamiento de un renglón de la factura falle.
    //
    // Se comprueba ANTES para no dejar el lote huérfano —después del batch ya
    // estaría creado— y para poder decir exactamente qué renglón quedó afuera.
    const idsPedidos = [...new Set(
        purchase.items.map(i => i?.id).filter(v => v !== undefined && v !== null && v !== '')
    )];
    const existentes = new Set();
    if (idsPedidos.length) {
        const q = await turso.execute({
            sql: `SELECT id FROM products WHERE company_id = ? AND id IN (${idsPedidos.map(() => '?').join(',')})`,
            args: [companyId, ...idsPedidos],
        });
        for (const f of q.rows) existentes.add(String(f.id));
    }
    const seAplican = purchase.items.filter(i => existentes.has(String(i?.id)));
    const sinAplicar = purchase.items
        .filter(i => !existentes.has(String(i?.id)))
        .map(i => ({
            id: i?.id ?? null,
            name: i?.name || i?.description || 'Producto sin nombre',
            sku: i?.sku || null,
            quantity: i?.quantity ?? null,
            motivo: (i?.id === undefined || i?.id === null || i?.id === '')
                ? 'El renglón no quedó asociado a ningún producto'
                : 'Ese producto ya no existe en el inventario',
        }));

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

    // ── Precios revisados en la compra (escala de mayoreo y cajas) ──────
    //
    // Al cambiar el costo, la escala de mayoreo y el precio de las cajas quedan
    // descuadrados. Antes había que ir producto por producto a corregirlos
    // después de guardar. Ahora se revisan en la misma pantalla de Compras y
    // viajan con la compra: se aplican ACÁ, en el mismo batch, así que no cambia
    // nada hasta que la compra se guarda — y si la compra falla, tampoco.
    //
    // El precio de una caja tiene que dividirse exacto por sus unidades (ver
    // presentationActions): lo que no cumple no se aplica y vuelve avisado.
    const presentacionesPorId = new Map();
    const idsPresentaciones = seAplican.flatMap(i => (i?.cambiosPrecios?.presentaciones || []).map(p => Number(p.id)))
        .filter(Number.isFinite);
    if (idsPresentaciones.length) {
        try {
            const pr = await turso.execute({
                sql: `SELECT id, product_id, name, units FROM product_presentations
                      WHERE company_id = ? AND id IN (${idsPresentaciones.map(() => '?').join(',')})`,
                args: [companyId, ...idsPresentaciones],
            });
            for (const f of pr.rows) presentacionesPorId.set(Number(f.id), f);
        } catch { /* sin la tabla (migración 0030) no hay cajas que actualizar */ }
    }
    const preciosNoAplicados = [];

    // 2. Batch: stock/costo/precio + lote por item + audit.
    //    Solo los renglones que sí tienen su producto: los otros ya se
    //    apartaron arriba y viajan de vuelta al navegador para que avise.
    const queries = [];
    seAplican.forEach(item => {
        queries.push({
            sql: 'UPDATE products SET stock = ROUND(stock + ?, 3), cost = ?, price = ?, sku = ?, tax_rate = ?, supplier = ? WHERE id = ? AND company_id = ?',
            args: [item.quantity, item.cost, item.price, item.sku, item.tax || 0, purchase.supplierName, item.id, companyId],
        });
        const cambios = item.cambiosPrecios;
        if (cambios && Array.isArray(cambios.priceRanges)) {
            const escala = cambios.priceRanges
                .map(r => ({
                    min: Number(r.min) || 0,
                    // "Hasta" vacío o 0 = sin tope. Un 0 la tienda lo rechaza (exige >= 1) y
                    // rechazaría el producto entero, stock incluido.
                    max: Number(r.max) > 0 ? Number(r.max) : '',
                    margin: Number(r.margin) || 0,
                    price: Math.round(Number(r.price) || 0),
                }))
                .filter(r => r.min > 0 && r.price > 0);
            queries.push({
                sql: 'UPDATE products SET price_ranges = ?, updated_at = ? WHERE id = ? AND company_id = ?',
                args: [JSON.stringify(escala), nowIso(), item.id, companyId],
            });
        }
        for (const cp of (cambios?.presentaciones || [])) {
            const pres = presentacionesPorId.get(Number(cp.id));
            const precio = Math.round(Number(cp.price) || 0);
            if (!pres || String(pres.product_id) !== String(item.id)) continue;
            if (!(precio > 0) || !Number.isInteger(precio / Number(pres.units))) {
                preciosNoAplicados.push({ producto: item.name, presentacion: pres.name, precio, motivo: 'no se divide exacto por sus unidades' });
                continue;
            }
            queries.push({
                sql: `UPDATE product_presentations SET price = ?, updated_at = datetime('now')
                      WHERE id = ? AND company_id = ? AND product_id = ?`,
                args: [precio, pres.id, companyId, item.id],
            });
        }
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

    // ── Aprender el código del proveedor de cada renglón ────────────────
    //
    // Quien guarda la compra revisó los renglones con la factura en la mano:
    // que "1012990" de Agrosuper es la Pechuga Deshuesada queda confirmado. Se
    // guarda como equivalencia, y la próxima factura con ese código se
    // empareja sola. Medido el 3-oct-2026: el pedido #51 tenía 6 productos
    // emparejados de una foto y ninguno con su código guardado.
    //
    // Solo se agregan códigos NUEVOS. Si ese código ya apunta a OTRO producto
    // no se pisa: puede ser un error de tipeo, y moverlo en silencio rompería
    // la próxima factura. Para corregirlo está la ficha del producto.
    // Best-effort: la compra ya quedó guardada pase lo que pase acá.
    const codigosAprendidos = [];
    const codigosEnConflicto = [];
    for (const item of seAplican) {
        const codigo = item?.codigoProveedor ? String(item.codigoProveedor).trim().slice(0, 64) : '';
        if (!codigo) continue;
        try {
            const previo = await turso.execute({
                sql: `SELECT a.product_id, p.name FROM product_supplier_aliases a
                      LEFT JOIN products p ON p.id = a.product_id AND p.company_id = a.company_id
                      WHERE a.company_id = ? AND a.alias_code = ? LIMIT 1`,
                args: [companyId, codigo],
            });
            const ya = previo.rows[0];
            if (ya && String(ya.product_id) === String(item.id)) continue;
            if (ya) { codigosEnConflicto.push({ codigo, producto: item.name, yaEsDe: ya.name }); continue; }
            await turso.execute({
                sql: `INSERT INTO product_supplier_aliases
                        (company_id, product_id, supplier_id, alias_code, source, created_at, created_by)
                      VALUES (?, ?, ?, ?, 'aprendido', ?, ?)`,
                args: [companyId, item.id, purchase.supplierId || null, codigo, nowIso(), session?.uid ?? null],
            });
            codigosAprendidos.push({ codigo, producto: item.name });
        } catch (err) {
            console.warn('[compra] no se pudo aprender el código', codigo, err?.message);
        }
    }

    // ── Cajas/bandejas creadas desde la compra ──────────────────────────
    //
    // Un producto que se vendía solo por unidad puede estrenar su caja acá
    // mismo, sin ir a la ficha. Se crean con presentationSave para que valgan
    // exactamente las mismas reglas (precio que divide exacto, código de
    // barras que no choque con nada). Lo que no pasa vuelve avisado.
    // Best-effort: la compra ya quedó guardada pase lo que pase acá.
    const presentacionesCreadas = [];
    for (const item of seAplican) {
        for (const n of (item?.cambiosPrecios?.nuevas || [])) {
            try {
                const res = await presentationActions.presentationSave(turso, companyId, session, {
                    presentation: { product_id: item.id, name: n.name, units: n.units, barcode: n.barcode, price: n.price },
                });
                if (res.success) presentacionesCreadas.push(res.presentation);
                else preciosNoAplicados.push({ producto: item.name, presentacion: n.name || 'Caja', precio: Number(n.price) || 0, motivo: res.error });
            } catch (err) {
                console.warn('[compra] no se pudo crear la caja', n?.name, err?.message);
                preciosNoAplicados.push({ producto: item.name, presentacion: n?.name || 'Caja', precio: Number(n?.price) || 0, motivo: 'no se pudo crear' });
            }
        }
    }

    // 3. Espejo purchase_items (post-commit; nunca hace fallar la compra).
    //    Va con TODOS los renglones a propósito, incluidos los que no llegaron
    //    al inventario: esto es el espejo de la FACTURA, no del efecto en el
    //    stock. La factura dice lo que dice, y el aviso de lo que no se aplicó
    //    viaja aparte en `itemsSinAplicar`.
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

    if (sinAplicar.length) {
        console.warn(`[compras] Compra #${purchaseId}: ${sinAplicar.length} renglón(es) no llegaron al inventario:`,
            sinAplicar.map(i => `${i.name} (${i.motivo})`).join(' · '));
    }

    // `itemsSinAplicar` viaja siempre, aunque venga vacío: así la pantalla
    // puede confiar en el campo en vez de adivinar.
    return { success: true, purchaseId, itemsSinAplicar: sinAplicar, preciosNoAplicados, codigosAprendidos, codigosEnConflicto, presentacionesCreadas };
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

// El texto reducido a lo que de verdad identifica: minúsculas, sin tildes, sin
// espacios ni signos. "DETODITO II 64G" y "Detodito II 64g" dan lo mismo, y
// "LAYS ORE 45G" da lo mismo que "LAYSORE45G" —que es como venía en la factura
// antes de que el lector le metiera un espacio—.
//
// Es lo que permite resolver el caso más frecuente sin preguntar nada: el
// proveedor escribe el mismo nombre en mayúscula y el emparejador por palabras
// lo daba por empatado, porque descarta los tokens de menos de tres letras y
// justo ahí estaba la diferencia ("II" contra "I").
const compacto = (s) => String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');

// Los nombres del catálogo llevan tildes y los de las facturas no. Sin esta
// normalización, "instantanea" no encontraba "Instantánea" — y ese punto perdido
// alcanzó para que "SOPA BOWL POLLO" terminara emparejado con el producto de
// CARNE. Se normaliza la columna en la consulta, porque SQLite compara LIKE sin
// distinguir mayúsculas pero sí distinguiendo tildes.
//
// Van las MAYÚSCULAS acentuadas y la ñ/ü, y hace falta: `LOWER()` de SQLite
// solo baja el alfabeto inglés. Comprobado contra la base real el 8-sep-2026,
// `lower('PIÑA')` devuelve `'piÑa'`. Y una factura viene JUSTAMENTE EN
// MAYÚSCULAS, que es el caso peor: "PIÑA EN CONSERVA" no emparejaba con "Piña
// en Conserva" del catálogo.
const SIN_TILDES = (col) => {
    let e = `LOWER(${col})`;
    const pares = [
        ['á', 'a'], ['Á', 'a'], ['à', 'a'], ['À', 'a'],
        ['é', 'e'], ['É', 'e'], ['è', 'e'], ['È', 'e'],
        ['í', 'i'], ['Í', 'i'], ['ì', 'i'], ['Ì', 'i'],
        ['ó', 'o'], ['Ó', 'o'], ['ò', 'o'], ['Ò', 'o'],
        ['ú', 'u'], ['Ú', 'u'], ['ù', 'u'], ['Ù', 'u'],
        ['ü', 'u'], ['Ü', 'u'],
        ['ñ', 'n'], ['Ñ', 'n'],
    ];
    for (const [de, a] of pares) e = `REPLACE(${e},'${de}','${a}')`;
    return e;
};

const quitarTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

// Busca el producto de un renglón de factura, de lo más confiable a lo más
// difuso. Cada escalón que resuelve evita una pregunta a la persona.
//
//   1. El código que el proveedor imprime, si ya se aprendió. Es la llave
//      fuerte: no cambia aunque cambien el nombre o la abreviatura.
//   2. El texto de la factura, si ya se aprendió. Acá viven las abreviaturas
//      que ninguna comparación podría adivinar ("DINAMITA FH 100").
//   3. El nombre igual, ignorando mayúsculas, tildes y espacios.
//   4. Puntaje por palabras (lo de siempre).
async function buscarProducto(turso, companyId, descripcion, codigo = null) {
    // ── 1 y 2: lo aprendido ──────────────────────────────────────────────
    const codigoLimpio = codigo ? String(codigo).trim() : null;
    const textoCompacto = compacto(descripcion);
    if (codigoLimpio || textoCompacto) {
        const a = await turso.execute({
            sql: `SELECT p.id, p.name, p.sku, p.cost, p.tax_rate, p.units_per_box,
                         a.alias_code IS NOT NULL AND a.alias_code = ? AS por_codigo
                  FROM product_supplier_aliases a
                  JOIN products p ON p.id = a.product_id AND p.company_id = a.company_id
                  WHERE a.company_id = ?
                    AND ((? IS NOT NULL AND a.alias_code = ?) OR (? <> '' AND a.alias_text = ?))
                  ORDER BY por_codigo DESC LIMIT 1`,
            args: [codigoLimpio, companyId, codigoLimpio, codigoLimpio, textoCompacto, textoCompacto],
        });
        if (a.rows[0]) {
            return {
                ...a.rows[0],
                aprendido: Number(a.rows[0].por_codigo) === 1 ? 'código' : 'nombre',
                alternativas: [],
            };
        }
    }

    const palabras = palabrasDe(quitarTildes(descripcion));
    if (!palabras.length) return null;
    const campo = SIN_TILDES('name');
    const puntaje = palabras.map(() => `(CASE WHEN ${campo} LIKE ? THEN 1 ELSE 0 END)`).join(' + ');
    const alguna = palabras.map(() => `${campo} LIKE ?`).join(' OR ');
    const comodines = palabras.map(p => `%${p}%`);
    const r = await turso.execute({
        // Se traen más filas que las 4 que se muestran: el nombre exacto puede
        // no quedar primero por puntaje —le pasó a "Detodito II 64g", que
        // empataba con "Detodito I 64g"— y hay que poder encontrarlo abajo.
        sql: `SELECT id, name, sku, cost, tax_rate, units_per_box, ${puntaje} AS coincidencias
              FROM products
              WHERE company_id = ? AND (${alguna})
              ORDER BY coincidencias DESC, LENGTH(name) ASC LIMIT 10`,
        args: [...comodines, companyId, ...comodines],
    });
    const mejor = r.rows[0];
    if (!mejor) return null;

    // ── 3: el nombre igual, sin importar cómo esté escrito ───────────────
    //
    // Antes esto no se miraba y era el error más molesto: la factura decía
    // exactamente el nombre del producto, en mayúscula, y el sistema pedía
    // elegir entre dos porque los tokens cortos que los diferencian ("II"
    // contra "I") se descartan por ser de menos de tres letras.
    const iguales = r.rows.filter(x => compacto(x.name) === textoCompacto);
    if (iguales.length === 1) {
        return { ...iguales[0], exacto: true, alternativas: [] };
    }

    // ── 3b: el nombre completo más el formato de la caja ─────────────────
    //
    // "DORITOS QUESO 240GX14" es el producto "Doritos Queso 240g" vendido en
    // caja de 14. El nombre entero está ahí, con una cola corta pegada atrás.
    // Sin esto quedaba empatado con los Doritos Queso de 54, 72, 100 y 172
    // gramos, que comparten todas las palabras salvo el gramaje.
    //
    // Las tres condiciones son el freno: el nombre del catálogo tiene que estar
    // completo desde el principio, medir al menos ocho caracteres (para que un
    // producto de nombre corto no prefije media factura) y lo que sobra tiene
    // que ser una cola de formato, no otro producto. Y tiene que calzar UNO
    // solo: si calzan dos, sigue siendo una pregunta para la persona.
    const conFormato = r.rows.filter(x => {
        const c = compacto(x.name);
        return c.length >= 8 && textoCompacto.startsWith(c) && textoCompacto.length - c.length <= 6;
    });
    if (conFormato.length === 1) {
        return { ...conFormato[0], exacto: true, alternativas: [] };
    }

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
                // Seis botones ya es una pantalla incómoda; más que eso no ayuda
                // a decidir, marea. Los que sobran se resuelven por el catálogo,
                // no por esta lista.
                .slice(0, 6)
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

/**
 * Cuántas unidades vendibles trae un bulto, según cómo está escrito el renglón.
 *
 * "Salchicha Sureña Refrigerado Vacio 12x5u" → {12, 5, 60}: puede ser una caja
 * de 12 paquetes, de 5, o de 60 salchichas sueltas. Cuál de las tres es depende
 * de qué vende el local, y eso lo dice el costo guardado del producto, no el
 * papel. Acá solo se juntan los candidatos.
 */
function candidatosDeEmpaque(texto) {
    if (!texto) return [];
    // 12x5u · 20x3 · 1*6*5 · 10 UND · x56
    const numeros = String(texto).match(/\d+(?:[.,]\d+)?/g) || [];
    const factores = numeros.map(n => Math.round(Number(String(n).replace(',', '.')))).filter(n => n >= 2 && n <= 1000);
    const candidatos = new Set(factores);
    for (let i = 0; i < factores.length; i++) {
        for (let j = i + 1; j < factores.length; j++) candidatos.add(factores[i] * factores[j]);
    }
    return [...candidatos].filter(n => n >= 2 && n <= 10000);
}

/**
 * ¿Este renglón viene por caja?
 *
 * La factura de Agrosuper trae "Salchicha Sureña ... 12x5u · UNI 1 · VALOR
 * 7.710". Entró como 1 unidad de $7.710, pero lo que llegó son 12 paquetes de
 * $642,5 — que es EXACTAMENTE el costo que ese producto tiene en el catálogo.
 *
 * Dos pistas independientes, y se exige que coincidan para tocar la cantidad:
 *   · el costo guardado del producto: 7.710 ÷ 642,5 = 12 justo;
 *   · el armado escrito en el renglón o lo que el producto ya tenga en
 *     `units_per_box`.
 * Si solo una de las dos aparece, no se cambia nada: se sugiere y decide la
 * persona, que es la que tiene el papel en la mano.
 */
function detectarBulto({ costoLinea, costoCatalogo, unitsPerBox, empaque }) {
    const candidatos = candidatosDeEmpaque(empaque);
    const guardado = Number(unitsPerBox) || 0;
    const base = Number(costoCatalogo) || 0;
    if (!(costoLinea > 0)) return null;

    let porCosto = null;
    if (base > 0) {
        const razon = costoLinea / base;
        // El costo del renglón es el que ya tiene el producto: viene por unidad y
        // no hay nada que repartir. Sin esto, un renglón que dice "(56 unid)" en
        // el nombre se proponía como caja de 56 estando perfecto.
        if (razon <= 1.1) return null;
        const entero = Math.round(razon);
        // 2% de tolerancia: el costo del catálogo puede venir de una compra con
        // otro redondeo, no tiene que dar exacto al peso.
        if (entero >= 2 && Math.abs(razon - entero) <= entero * 0.02) porCosto = entero;
    }

    const porNombre = porCosto && (candidatos.includes(porCosto) || guardado === porCosto)
        ? porCosto
        : (guardado >= 2 ? guardado : null);

    if (porCosto && porNombre === porCosto) return { unidades: porCosto, seguro: true };
    if (porCosto) return { unidades: porCosto, seguro: false, motivo: 'el costo guardado del producto da ese factor, pero el renglón no lo dice' };
    // Por el nombre solo se sugiere cuando NO hay costo guardado con qué
    // comparar: si lo hay y no dio factor, el renglón no es una caja.
    if (base <= 0 && candidatos.length === 1 && candidatos[0] >= 2) {
        return { unidades: candidatos[0], seguro: false, motivo: 'lo dice el nombre del renglón, pero el producto no tiene costo guardado para confirmarlo' };
    }
    return null;
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
    const corregidas = [];
    // Renglones que vinieron por caja: convertidos (porCaja) o a confirmar (sugerencias).
    const porCaja = [];
    const sugerencias = [];
    for (const [k, l] of lineas.entries()) {
        // Número de renglón en la factura (1, 2, 3…). Con él, el pedido se lee en
        // el mismo orden que el papel, y un renglón que se engancha a mano después
        // vuelve a su lugar en vez de irse al final (ver supplierOrderAddItems).
        const renglon = k + 1;
        const costo = Number(l.costo) || 0;
        // La cantidad se verifica contra el TOTAL impreso del renglón, que es el
        // único dato que no depende de interpretar columnas.
        //
        // Por qué: hay facturas con dos columnas de cantidad —unidades y kilos— y
        // el precio puede ser por kilo o por unidad en el mismo documento. En la
        // factura de Agrosuper del 2-oct-2026, "Pechuga de pollo deshuesada" venía
        // como UNI 2 · KILOS 20,290 · PRECIO 3.451 · VALOR 70.021: se leyó
        // cantidad 2 y el renglón entró por $6.902 en vez de $70.021, porque ahí
        // el precio es por kilo. Dos líneas más abajo, en cambio, el mismo
        // formato se cobra por unidad.
        //
        // Con el total impreso la duda se resuelve sola: la cantidad correcta es
        // la que, multiplicada por el costo, da ese total.
        let cantidad = Number(l.cantidad) || 0;
        const totalImpreso = Number(l.totalLinea) || 0;
        if (totalImpreso > 0 && costo > 0) {
            const calculado = cantidad * costo;
            // 2% de tolerancia: los redondeos del papel (centavos por kilo) no
            // son un error de lectura.
            if (Math.abs(calculado - totalImpreso) > totalImpreso * 0.02) {
                const corregida = Math.round((totalImpreso / costo) * 1000) / 1000;
                if (corregida > 0) {
                    corregidas.push({ descripcion: l.descripcion, leida: cantidad, usada: corregida, totalImpreso });
                    cantidad = corregida;
                }
            }
        }
        if (cantidad <= 0 || costo <= 0) {
            sinEmparejar.push({ renglon, descripcion: l.descripcion, motivo: 'sin cantidad o sin costo' });
            continue;
        }
        const p = await buscarProducto(turso, companyId, l.descripcion, l.codigo);
        if (!p) {
            sinEmparejar.push({
                renglon, descripcion: l.descripcion, cantidad, costo,
                codigo: l.codigo || null,
                iva: l.iva != null ? Number(l.iva) : null,
                motivo: 'no está en el catálogo',
            });
            continue;
        }
        if (p.ambiguo) {
            sinEmparejar.push({
                renglon, descripcion: l.descripcion, cantidad, costo,
                codigo: l.codigo || null,
                // El IVA del renglón viaja con él: si después se engancha a mano
                // desde la pantalla, el costo con impuesto tiene que salir del
                // que traía la factura, no del que el producto tenga en su ficha.
                iva: l.iva != null ? Number(l.iva) : null,
                motivo: 'hay varios productos que le calzan igual; elegí vos cuál',
                candidatos: p.candidatos,
            });
            continue;
        }
        // ── ¿Vino por caja? ──────────────────────────────────────────────
        // La factura cuenta bultos y el local vende paquetes. Ver detectarBulto.
        let cantidadFinal = cantidad;
        let costoFinal = costo;
        const bulto = detectarBulto({
            costoLinea: costo,
            costoCatalogo: p.cost,
            unitsPerBox: p.units_per_box,
            empaque: l.empaque || l.descripcion,
        });
        if (bulto?.seguro) {
            cantidadFinal = Math.round(cantidad * bulto.unidades * 1000) / 1000;
            costoFinal = Math.round((costo / bulto.unidades) * 100) / 100;
            porCaja.push({
                descripcion: l.descripcion, producto: p.name,
                unidades: bulto.unidades, cantidad: cantidadFinal, costo: costoFinal,
            });
            // Se guarda en la ficha para que la próxima factura entre sola.
            if (Number(p.units_per_box) !== bulto.unidades) {
                try {
                    await turso.execute({
                        sql: 'UPDATE products SET units_per_box = ? WHERE id = ? AND company_id = ?',
                        args: [bulto.unidades, p.id, companyId],
                    });
                } catch { /* que no se caiga la carga de la factura por esto */ }
            }
        } else if (bulto) {
            sugerencias.push({
                productId: p.id, producto: p.name, descripcion: l.descripcion,
                unidades: bulto.unidades, motivo: bulto.motivo,
                cantidadActual: cantidad, costoActual: costo,
                cantidadPropuesta: Math.round(cantidad * bulto.unidades * 1000) / 1000,
                costoPropuesto: Math.round((costo / bulto.unidades) * 100) / 100,
            });
        }

        const cantidad2 = cantidadFinal;
        const costo2 = costoFinal;
        const tasa = l.iva != null ? Number(l.iva) : Number(p.tax_rate) || 0;
        const costoConIva = Math.round(costo2 * (1 + tasa / 100));
        items.push({
            id: p.id,
            name: p.name,
            sku: p.sku || '',
            renglon,
            cost: costo2,
            costWithTax: costoConIva,
            quantity: cantidad2,
            taxRate: tasa,
            // Con IVA, igual que en "Realizar Pedido" (Orders.jsx). Antes acá se
            // guardaba el neto y el pedido nacido de una foto mostraba un total
            // 19% más bajo que el mismo pedido cargado a mano — y ese número es
            // el que después viaja a Compras.
            total: costoConIva * cantidad2,
            // Se guarda cómo venía en la factura: al revisar en Compras, es lo
            // único que permite darse cuenta de un emparejamiento equivocado.
            desdeFactura: l.descripcion,
            // El código que el proveedor imprime en el renglón. Viaja hasta la
            // compra, que lo muestra y lo aprende al guardarse: así la próxima
            // factura de ese proveedor se empareja por código, sin adivinar.
            codigoProveedor: l.codigo ? String(l.codigo).trim() : null,
            alternativas: p.alternativas,
            // Cómo se resolvió: por lo aprendido, por nombre igual, o por
            // puntaje. Se muestra en el resumen para que se note cuándo la
            // memoria empezó a trabajar sola.
            comoSeEmparejo: p.aprendido ? `aprendido por ${p.aprendido}` : (p.exacto ? 'nombre igual' : 'parecido'),
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
        // Se devuelve para poder anotar de qué proveedor viene cada equivalencia
        // que la persona corrija en la pantalla.
        supplierId: supplierId || null,
        numeroFactura: folio,
        emparejados: items.length,
        total,
        totalNeto,
        items: items.map(i => ({
            renglon: i.renglon, producto: i.name, desdeFactura: i.desdeFactura,
            cantidad: i.quantity, costo: i.cost, comoSeEmparejo: i.comoSeEmparejo,
        })),
        // Renglones donde la cantidad leída no daba el total impreso y se usó la
        // que sí lo da. Se devuelven para poder mostrarlos: es un renglón que
        // conviene mirar en el papel.
        corregidas,
        porCaja,
        sugerencias,
        sinEmparejar,
    };
}

// Se acuerda de cómo escribe el proveedor un producto.
//
// Se llama cuando la persona corrige un renglón que quedó ambiguo: ella ya
// resolvió la duda, y esa respuesta es información que no se puede deducir de
// ningún lado. Guardarla es la diferencia entre volver a preguntar lo mismo
// todos los meses y que la próxima factura entre sola.
//
// Se guardan las dos llaves cuando están: el código del proveedor (la fuerte,
// no cambia aunque cambien el nombre) y el texto compactado. Si la equivalencia
// ya existía apuntando a otro producto, se pisa — corregir de nuevo tiene que
// poder arreglar una corrección equivocada.
async function productAliasLearn(turso, companyId, session, { productId, codigo, texto, supplierId }) {
    if (!productId) return { success: false, error: 'Falta el producto' };

    const codigoLimpio = codigo ? String(codigo).trim().slice(0, 64) : null;
    const textoCompacto = compacto(texto).slice(0, 120) || null;
    if (!codigoLimpio && !textoCompacto) {
        return { success: false, error: 'No hay nada que recordar de ese renglón' };
    }

    const p = await turso.execute({
        sql: 'SELECT id FROM products WHERE id = ? AND company_id = ?',
        args: [productId, companyId],
    });
    if (!p.rows[0]) return { success: false, error: 'Ese producto no es de esta empresa' };

    const ahora = nowIso();
    const guardar = async (campo, valor) => {
        if (!valor) return;
        await turso.execute({
            sql: `INSERT INTO product_supplier_aliases
                    (company_id, product_id, supplier_id, ${campo}, source, created_at, created_by)
                  VALUES (?, ?, ?, ?, 'aprendido', ?, ?)
                  -- El índice es parcial, así que el ON CONFLICT tiene que
                  -- repetir su condición: sin el WHERE, SQLite no lo reconoce
                  -- como el índice en conflicto y tira error.
                  ON CONFLICT(company_id, ${campo}) WHERE ${campo} IS NOT NULL DO UPDATE SET
                    product_id = excluded.product_id,
                    supplier_id = excluded.supplier_id,
                    created_at = excluded.created_at,
                    created_by = excluded.created_by`,
            args: [companyId, productId, supplierId || null, valor, ahora, session?.uid ?? null],
        });
    };

    await guardar('alias_code', codigoLimpio);
    await guardar('alias_text', textoCompacto);

    return { success: true, recordado: { codigo: codigoLimpio, texto: textoCompacto } };
}

// ─────────────────────────────────────────────────────────────────
// Códigos de proveedor escritos A MANO desde la ficha del producto.
//
// Van a la misma tabla que los que el sistema aprende solo al corregir una
// factura, y por eso funcionan igual de bien: escribir acá el código que el
// proveedor imprime hace que la próxima factura de ese proveedor entre sola.
// La tabla ya tenía previsto este caso con `source = 'manual'`; lo único que
// faltaba era la pantalla.
// ─────────────────────────────────────────────────────────────────

/** Los códigos y textos que tiene atados un producto. */
async function productAliasesList(turso, companyId, session, { productId }) {
    if (!productId) return { success: false, error: 'Falta el producto' };
    const r = await turso.execute({
        sql: `SELECT a.id, a.alias_code, a.alias_text, a.source, a.supplier_id, a.created_at,
                     s.name AS supplier_name
              FROM product_supplier_aliases a
              LEFT JOIN suppliers s ON s.id = a.supplier_id AND s.company_id = a.company_id
              WHERE a.company_id = ? AND a.product_id = ?
              ORDER BY a.alias_code IS NULL, a.created_at DESC`,
        args: [companyId, productId],
    });
    return { success: true, rows: r.rows };
}

/**
 * Agrega un código a mano.
 *
 * Un mismo código no puede apuntar a dos productos: el índice de la tabla lo
 * impide, y tiene sentido —si la factura dice 390065281, es UN producto—. Si el
 * código ya estaba en otro, se MUEVE (igual que cuando alguien corrige dos veces
 * un renglón mal emparejado) pero se avisa de dónde vino, para que nadie se
 * entere por casualidad de que se lo sacó a otro producto.
 */
async function productAliasAdd(turso, companyId, session, { productId, codigo, supplierId }) {
    if (!productId) return { success: false, error: 'Falta el producto' };

    const limpio = codigo ? String(codigo).trim().slice(0, 64) : '';
    if (!limpio) return { success: false, error: 'Escribí el código del proveedor' };

    const p = await turso.execute({
        sql: 'SELECT id FROM products WHERE id = ? AND company_id = ?',
        args: [productId, companyId],
    });
    if (!p.rows[0]) return { success: false, error: 'Ese producto no es de esta empresa' };

    // ¿A quién apuntaba antes?
    const previo = await turso.execute({
        sql: `SELECT a.product_id, p.name
              FROM product_supplier_aliases a
              JOIN products p ON p.id = a.product_id AND p.company_id = a.company_id
              WHERE a.company_id = ? AND a.alias_code = ?`,
        args: [companyId, limpio],
    });
    const anterior = previo.rows[0];
    if (anterior && Number(anterior.product_id) === Number(productId)) {
        return { success: false, error: 'Ese producto ya tiene ese código' };
    }

    await turso.execute({
        sql: `INSERT INTO product_supplier_aliases
                (company_id, product_id, supplier_id, alias_code, source, created_at, created_by)
              VALUES (?, ?, ?, ?, 'manual', ?, ?)
              -- El índice es parcial: el ON CONFLICT tiene que repetir su WHERE
              -- o SQLite no lo reconoce como el índice en conflicto.
              ON CONFLICT(company_id, alias_code) WHERE alias_code IS NOT NULL DO UPDATE SET
                product_id = excluded.product_id,
                supplier_id = excluded.supplier_id,
                source = 'manual',
                created_at = excluded.created_at,
                created_by = excluded.created_by`,
        args: [companyId, productId, supplierId || null, limpio, nowIso(), session?.uid ?? null],
    });

    return { success: true, codigo: limpio, movidoDe: anterior ? anterior.name : null };
}

/** Saca un código (o un texto aprendido) de un producto. */
async function productAliasDelete(turso, companyId, session, { id }) {
    if (!id) return { success: false, error: 'Falta el código a borrar' };
    await turso.execute({
        sql: 'DELETE FROM product_supplier_aliases WHERE id = ? AND company_id = ?',
        args: [id, companyId],
    });
    return { success: true };
}

// `buscarProducto` se exporta para poder medirlo contra el catálogo real sin
// crear pedidos de prueba: es la pieza que decide si un renglón entra solo, si
// hay que preguntar o si no está, y equivocarse ahí desajusta el stock.
export { supplierOrderFromInvoice, buscarProducto };

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
    supplierOrderSetItemPack,
    supplierOrderDelete,
    purchaseCreate,
    purchasesFetch,
    purchaseDetails,
    purchaseDelete,
    supplierPurchaseSummaryGet,
    productAliasLearn,
    productAliasesList,
    productAliasAdd,
    productAliasDelete,
};
