// Venta server-side (Fase 1 · Paso 10) — CORAZÓN del POS.
//
// saleCommit ejecuta la fase crítica que antes corría en el navegador con el
// token de Turso: validación de crédito, lecturas frescas de productos/lotes,
// pre-cálculo FEFO y la transacción (INSERT venta + UPDATEs con guardas de
// concurrencia + audit). La lógica se portó TAL CUAL de useStore.addSale —
// mismas reglas, mismos mensajes de error, mismas guardas `stock >= ?`.
//
// El cliente conserva: rama offline (Dexie), estado local optimista, sync
// WooCommerce, impresión, cola failsafe y el trigger de emisión SII.
// Para eso, esta acción DEVUELVE los pre-cálculos (itemsToProcess,
// productsToUpdate, lotsToUpdate, productsInfo) y los flags de sii_config.

import { mirrorSaleItems } from '../../src/lib/itemNormalization.js';
import { PRODUCT_COLS_SIN_IMAGEN } from './reportActions.js';

export async function saleCommit(turso, companyId, session, body) {
    const { sale } = body;

    // ── FASE 1: Validación rápida ────────────────────────────────
    if (!sale?.items?.length || !sale.total || sale.total < 0) {
        return { success: false, error: 'Datos de venta inválidos' };
    }
    const saleTotal = parseFloat(sale.total);

    // ── Antes que nada: ¿esta venta ya entró? ────────────────────
    //
    // El navegador manda un identificador propio de la venta, el mismo en cada
    // reintento. Si ya está en la base, esta llamada es un reintento de algo que
    // salió bien —la venta se registró pero la respuesta no llegó a tiempo— y
    // hay que devolver la venta existente, NO crear otra.
    //
    // Sin esto, una respuesta lenta se cobraba dos veces: el 12-ago-2026 una
    // venta quedó cargada tres veces en trece segundos. Ver migración 0021.
    const clientSaleId = typeof sale.clientSaleId === 'string' && sale.clientSaleId.length <= 64
        ? sale.clientSaleId
        : null;

    if (clientSaleId) {
        const yaEsta = await turso.execute({
            sql: 'SELECT id, total, status FROM sales WHERE company_id = ? AND client_sale_id = ? LIMIT 1',
            args: [companyId, clientSaleId],
        });
        const previa = yaEsta.rows[0];
        if (previa) {
            // Se responde como éxito a propósito: para quien vendió, la venta SÍ
            // quedó registrada. Devolver un error acá haría que el POS la
            // encolara otra vez y el ciclo no terminaría nunca.
            return {
                success: true,
                saleId: Number(previa.id),
                duplicada: true,
                message: 'Esta venta ya estaba registrada.',
            };
        }
    }

    // Flags de la empresa leídos de la BD (fuente de verdad, no del cliente)
    const coRes = await turso.execute({
        sql: 'SELECT inventory_adjustment_mode, credit_block_mode FROM companies WHERE id = ?',
        args: [companyId],
    });
    const co = coRes.rows[0] || {};
    const inventoryAdjustmentMode = Number(co.inventory_adjustment_mode) === 1;
    const creditBlockMode = co.credit_block_mode || 'warn';

    // ── Validación de crédito (contra la BD, no el estado del navegador) ──
    let creditWarning = null;
    let clientRow = null;
    if (sale.client?.id) {
        const cRes = await turso.execute({
            sql: 'SELECT id, client_status, credit_enabled, credit_limit, credit_period_days FROM clients WHERE id = ? AND company_id = ?',
            args: [sale.client.id, companyId],
        });
        clientRow = cRes.rows[0] || null;
        if (clientRow) {
            if (clientRow.client_status === 'blocked') {
                return { success: false, error: 'CLIENT_BLOCKED', message: 'Este cliente está bloqueado y no puede realizar compras.' };
            }
            if (sale.paymentMethod === 'Crédito') {
                if (clientRow.client_status === 'credit_blocked' || Number(clientRow.credit_enabled) === 0) {
                    return { success: false, error: 'CREDIT_NOT_ALLOWED', message: 'Este cliente no tiene habilitado el crédito.' };
                }
                if (clientRow.credit_limit > 0) {
                    const debtRes = await turso.execute({
                        sql: `SELECT COALESCE(SUM(total), 0) as total_debt FROM sales
                              WHERE client_id = ? AND company_id = ? AND payment_method = 'Crédito'
                              AND status NOT IN ('paid', 'cancelled')`,
                        args: [sale.client.id, companyId],
                    });
                    const currentDebt = parseFloat(debtRes.rows[0]?.total_debt || 0);
                    if (currentDebt + saleTotal > clientRow.credit_limit) {
                        if (creditBlockMode === 'block') {
                            return { success: false, error: 'CREDIT_LIMIT_EXCEEDED', message: `Límite de crédito excedido. Límite: $${Number(clientRow.credit_limit).toLocaleString()}, Deuda actual: $${currentDebt.toLocaleString()}` };
                        }
                        creditWarning = `Crédito excedido. Límite: $${Number(clientRow.credit_limit).toLocaleString()}, Deuda: $${currentDebt.toLocaleString()}, Nueva deuda: $${(currentDebt + saleTotal).toLocaleString()}`;
                    }
                }
            }
        }
    }

    // ── FASE 2: Pre-cálculos (lecturas frescas) ──────────────────
    const regularItems = sale.items.filter(i => !i.is_combo);
    const comboItems = sale.items.filter(i => i.is_combo);
    const regularIds = regularItems.map(i => i.id);
    const comboComponentIds = comboItems.flatMap(c => (c.combo_items || []).map(ci => ci.product_id));
    const allProductIds = [...new Set([...regularIds, ...comboComponentIds])];

    const itemIds = allProductIds.length > 0 ? allProductIds : [0];
    const placeholders = itemIds.map(() => '?').join(',');

    // Un solo round-trip para productos, lotes y la caja abierta (antes eran dos).
    const [dbProductsRes, dbLotsRes, openRegRes] = await turso.batch([
        {
            // Sin la foto en base64. Medido el 9-ago-2026: una venta de 8 productos
            // con imagen bajaba 0,619 MB y tardaba 252 ms; sin la columna son
            // 0,004 MB y 149 ms (la latencia base hasta Turso es 134 ms).
            //
            // Es seguro y se verificó antes de tocar acá: `image` no aparece en
            // ninguna parte de este archivo, estas filas solo alimentan búsquedas
            // internas (stock, costo, impuesto) y lo que vuelve al navegador es
            // `productsInfo`, que mapea seis campos explícitos sin la foto.
            sql: `SELECT ${PRODUCT_COLS_SIN_IMAGEN} FROM products WHERE id IN (${placeholders}) AND company_id = ?`,
            args: [...itemIds, companyId],
        },
        {
            sql: `SELECT * FROM product_lots WHERE product_id IN (${placeholders}) AND company_id = ? AND quantity > 0`,
            args: [...itemIds, companyId],
        },
        {
            // La caja la resuelve el SERVIDOR desde la sesión, no la manda el cliente:
            // una pestaña desactualizada podría mandar la caja de otro turno. Si el
            // usuario no tiene caja abierta queda NULL y la venta no entra a ninguna.
            sql: "SELECT id FROM cash_registers WHERE user_id = ? AND company_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1",
            args: [session?.uid ?? null, companyId],
        },
    ], 'read');
    const dbProducts = dbProductsRes.rows;
    const freshLots = dbLotsRes.rows;
    const registerId = openRegRes.rows[0]?.id ?? null;

    const itemsToProcess = [];
    const productsToUpdate = [];
    const lotsToUpdate = [];
    const productsToMarkPending = [];

    const productsMap = new Map(dbProducts.map(p => [String(p.id), p]));
    const lotsByProduct = new Map();
    freshLots.forEach(lot => {
        const pId = String(lot.product_id);
        if (!lotsByProduct.has(pId)) lotsByProduct.set(pId, []);
        lotsByProduct.get(pId).push(lot);
    });

    const today = new Date().toISOString().split('T')[0];
    const fefoSort = (a, b) => {
        const aExpired = a.expiry_date && a.expiry_date < today;
        const bExpired = b.expiry_date && b.expiry_date < today;
        if (aExpired !== bExpired) return aExpired ? 1 : -1;
        if (!a.expiry_date) return 1;
        if (!b.expiry_date) return -1;
        return new Date(a.expiry_date) - new Date(b.expiry_date);
    };

    for (const item of sale.items) {
        if (item.is_combo) {
            const quantity = parseFloat(item.quantity);
            itemsToProcess.push({
                id: item.id,
                name: item.name,
                quantity,
                price: parseFloat(item.price),
                cost: parseFloat(item.cost) || 0,
                tax_rate: parseFloat(item.tax_rate) || 0,
                is_combo: true,
            });

            for (const comp of (item.combo_items || [])) {
                const compIdStr = String(comp.product_id);
                const compProduct = productsMap.get(compIdStr);
                if (!compProduct) {
                    return {
                        success: false,
                        error: `Combo "${item.name}": componente faltante (id ${comp.product_id}). No se puede procesar la venta.`,
                    };
                }
                const compDeduct = (parseFloat(comp.quantity) || 1) * quantity;
                const existing = productsToUpdate.find(p => String(p.id) === compIdStr);
                if (existing) existing.quantityToDeduct += compDeduct;
                else productsToUpdate.push({ id: comp.product_id, quantityToDeduct: compDeduct, markPending: false });

                const compLots = (lotsByProduct.get(compIdStr) || []).filter(l => l.quantity > 0).sort(fefoSort);
                let compRemaining = compDeduct;
                for (const lot of compLots) {
                    if (compRemaining <= 0) break;
                    const deduct = Math.min(lot.quantity, compRemaining);
                    lotsToUpdate.push({ id: Number(lot.id), deduct });
                    compRemaining -= deduct;
                }
            }
            continue;
        }

        const itemIdStr = String(item.id);
        const product = productsMap.get(itemIdStr);
        if (!product) {
            console.error(`❌ ITEM SKIPPED (Not found in DB): Item ID ${item.id} (${item.name}).`);
            continue;
        }

        const quantity = parseFloat(item.quantity);
        if (quantity <= 0) {
            return { success: false, error: `Cantidad inválida para ${item.name}` };
        }

        const itemLots = lotsByProduct.get(itemIdStr) || [];
        const totalLotQty = itemLots.reduce((sum, l) => sum + (l.quantity || 0), 0);
        const legacyStock = Math.max(0, product.stock - totalLotQty);
        const validLotStock = itemLots
            .filter(l => l.quantity > 0 && (!l.expiry_date || l.expiry_date >= today))
            .reduce((sum, l) => sum + l.quantity, 0);
        const totalSellable = legacyStock + validLotStock;

        if (!inventoryAdjustmentMode && quantity > totalSellable) {
            return { success: false, error: `Stock insuficiente para: ${product.name}` };
        }
        if (quantity > totalSellable) productsToMarkPending.push(item.id);

        itemsToProcess.push({
            id: item.id,
            name: item.name,
            quantity,
            price: parseFloat(item.price),
            cost: parseFloat(item.cost) || 0,
            tax_rate: parseFloat(item.tax_rate) || 0,
            discountPercent: parseFloat(item.discountPercent) || 0,
        });
        productsToUpdate.push({
            id: item.id,
            quantityToDeduct: quantity,
            markPending: productsToMarkPending.includes(item.id),
        });

        const validLots = itemLots.filter(l => l.quantity > 0).sort(fefoSort);
        let remainingQty = quantity;
        for (const lot of validLots) {
            if (remainingQty <= 0) break;
            const deduct = Math.min(lot.quantity, remainingQty);
            lotsToUpdate.push({ id: Number(lot.id), deduct });
            remainingQty -= deduct;
        }
    }

    // ── FASE 3: Transacción con guardas de concurrencia ──────────
    const tx = await turso.transaction();
    let saleId;
    const now = new Date().toISOString();

    try {
        const itemsJson = JSON.stringify(itemsToProcess);
        const detailsJson = JSON.stringify(sale.paymentDetails);

        let paymentDueDate = null;
        if (sale.paymentMethod === 'Crédito' && clientRow) {
            const periodDays = clientRow.credit_period_days || 30;
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + periodDays);
            paymentDueDate = dueDate.toISOString();
        }

        const saleResult = await tx.execute({
            sql: `INSERT INTO sales
                  (company_id, user_id, date, items, total, summary, payment_method, payment_details, status, client_id, client_name, payment_due_date, register_id, client_sale_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?)`,
            args: [
                companyId, session?.uid ?? null, now, itemsJson, saleTotal,
                sale.summary ?? null, sale.paymentMethod ?? null, detailsJson,
                sale.client?.id || null, sale.client?.name || null, paymentDueDate,
                registerId, clientSaleId,
            ],
        });
        const rawSaleId = saleResult.lastInsertRowid || Date.now();
        saleId = typeof rawSaleId === 'bigint' ? Number(rawSaleId) : rawSaleId;

        const productUpdatePromises = productsToUpdate.map(p => {
            if (inventoryAdjustmentMode) {
                return tx.execute({
                    sql: `UPDATE products
                          SET stock = ROUND(stock - ?, 3),
                              pending_adjustment = CASE WHEN ? THEN 1 ELSE pending_adjustment END
                          WHERE id = ? AND company_id = ?`,
                    args: [p.quantityToDeduct, p.markPending ? 1 : 0, p.id, companyId],
                }).then(r => ({ kind: 'product', p, res: r }));
            }
            return tx.execute({
                sql: `UPDATE products
                      SET stock = ROUND(stock - ?, 3),
                          pending_adjustment = CASE WHEN ? THEN 1 ELSE pending_adjustment END
                      WHERE id = ? AND company_id = ? AND stock >= ?`,
                args: [p.quantityToDeduct, p.markPending ? 1 : 0, p.id, companyId, p.quantityToDeduct],
            }).then(r => ({ kind: 'product', p, res: r }));
        });

        const lotUpdatePromises = lotsToUpdate.map(l => {
            if (inventoryAdjustmentMode) {
                return tx.execute({
                    sql: 'UPDATE product_lots SET quantity = ROUND(quantity - ?, 3) WHERE id = ?',
                    args: [l.deduct, l.id],
                }).then(r => ({ kind: 'lot', l, res: r }));
            }
            return tx.execute({
                sql: 'UPDATE product_lots SET quantity = ROUND(quantity - ?, 3) WHERE id = ? AND quantity >= ?',
                args: [l.deduct, l.id, l.deduct],
            }).then(r => ({ kind: 'lot', l, res: r }));
        });

        const auditPromise = tx.execute({
            sql: `INSERT INTO audit_logs
                  (company_id, user_id, action, entity, details, created_at)
                  VALUES (?, ?, 'CREATE', 'SALE', ?, ?)`,
            args: [companyId, session?.uid ?? null, JSON.stringify({ total: saleTotal, itemsCount: itemsToProcess.length }), now],
        });

        const updateResults = await Promise.all([...productUpdatePromises, ...lotUpdatePromises]);
        await auditPromise;

        if (!inventoryAdjustmentMode) {
            const failed = updateResults.filter(r => Number(r.res?.rowsAffected ?? 0) === 0);
            if (failed.length > 0) {
                const failedProducts = failed
                    .filter(f => f.kind === 'product')
                    .map(f => productsMap.get(String(f.p.id))?.name || `product#${f.p.id}`);
                const failedLots = failed.filter(f => f.kind === 'lot').map(f => `lot#${f.l.id}`);
                await tx.rollback();
                const detail = [...failedProducts, ...failedLots].join(', ');
                return {
                    success: false,
                    error: 'CONCURRENT_STOCK',
                    message: `Stock insuficiente (otra caja vendió primero): ${detail}`,
                };
            }
        }

        await tx.commit();
    } catch (error) {
        try { await tx.rollback(); } catch { /* tx ya pudo cerrarse */ }
        console.error('❌ saleCommit failed, rolled back:', error);
        // 500 → el cliente encola la venta en su cola failsafe (mismo comportamiento de antes)
        throw error;
    }

    // Espejo sale_items (post-commit; nunca hace fallar la venta)
    try {
        await mirrorSaleItems(turso, {
            saleId,
            companyId,
            saleDate: now,
            items: itemsToProcess,
            source: 'live',
        });
    } catch (err) {
        console.error('[fase4] mirrorSaleItems:', err?.message || err);
    }

    // Flags SII para que el cliente decida la auto-emisión sin tocar la BD
    let sii = null;
    try {
        const siiRes = await turso.execute({
            sql: 'SELECT auto_emit, is_active FROM sii_config WHERE company_id = ?',
            args: [companyId],
        });
        if (siiRes.rows[0]) {
            sii = { auto_emit: Number(siiRes.rows[0].auto_emit), is_active: Number(siiRes.rows[0].is_active) };
        }
    } catch { /* sin config SII */ }

    // Info mínima de productos para el estado local optimista + sync tienda
    const productsInfo = dbProducts.map(p => ({
        id: p.id, name: p.name, sku: p.sku, stock: p.stock, unit: p.unit,
        pending_adjustment: p.pending_adjustment,
    }));

    return {
        success: true,
        saleId,
        date: now,
        creditWarning,
        itemsToProcess,
        productsToUpdate,
        lotsToUpdate,
        productsInfo,
        sii,
    };
}

// ─────────────────────────────────────────────────────────────────
// Anulación de venta (Fase 1 · Paso 12) — lógica portada tal cual de
// cancelSale: marcar cancelada + restaurar stock y lotes + audit REFUND.
// Devuelve la venta, sus items y el stock fresco para el sync a tienda.
// ─────────────────────────────────────────────────────────────────

export async function saleCancel(turso, companyId, session, { saleId, observation = '', hasOpenRegister = false }) {
    if (!saleId) return { success: false, error: 'Falta saleId' };

    const saleRes = await turso.execute({
        sql: 'SELECT * FROM sales WHERE id = ? AND company_id = ?',
        args: [saleId, companyId],
    });
    if (saleRes.rows.length === 0) return { success: false, error: 'Venta no encontrada' };
    const sale = saleRes.rows[0];

    let items = [];
    try { items = typeof sale.items === 'string' ? JSON.parse(sale.items || '[]') : (sale.items || []); } catch { items = []; }

    const queries = [{
        sql: "UPDATE sales SET status = 'cancelled', observation = ? WHERE id = ? AND company_id = ?",
        args: [observation, saleId, companyId],
    }];

    for (const item of items) {
        queries.push({
            sql: 'UPDATE products SET stock = ROUND(stock + ?, 3) WHERE id = ? AND company_id = ?',
            args: [item.quantity, item.id, companyId],
        });
        // Restaurar al lote más reciente (mismo criterio que antes)
        queries.push({
            sql: `UPDATE product_lots
                   SET quantity = quantity + ?
                   WHERE id = (
                       SELECT id FROM product_lots
                       WHERE product_id = ? AND company_id = ?
                       ORDER BY created_at DESC LIMIT 1
                   )`,
            args: [item.quantity, item.id, companyId],
        });
    }

    if (hasOpenRegister) {
        queries.push({
            sql: 'INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            args: [companyId, session?.uid ?? null, 'REFUND', 'SALE',
                JSON.stringify({ saleId, total: sale.total, reason: observation }), new Date().toISOString()],
        });
    }

    await turso.batch(queries);

    // Stock fresco post-restauración para el sync a la tienda online
    let products = [];
    const productIds = items.map(i => i.id).filter(Boolean);
    if (productIds.length > 0) {
        const placeholders = productIds.map(() => '?').join(',');
        const pRes = await turso.execute({
            sql: `SELECT id, sku, stock, unit FROM products WHERE id IN (${placeholders}) AND company_id = ?`,
            args: [...productIds, companyId],
        });
        products = pRes.rows;
    }

    return {
        success: true,
        sale: {
            id: sale.id, total: sale.total, date: sale.date, user_id: sale.user_id,
            payment_method: sale.payment_method, client_id: sale.client_id, client_name: sale.client_name,
        },
        items,
        products,
    };
}

// Detalle completo de una venta (+ folio DTE si existe)
export async function saleDetails(turso, companyId, session, { saleId }) {
    if (!saleId) return { success: false, error: 'Falta saleId' };
    const result = await turso.execute({
        sql: 'SELECT * FROM sales WHERE id = ? AND company_id = ?',
        args: [saleId, companyId],
    });
    if (result.rows.length === 0) return { success: true, sale: null };

    let dte_folio = null, dte_tipo = null;
    try {
        const dteResult = await turso.execute({
            sql: "SELECT folio, tipo_dte FROM sii_dtes WHERE sale_id = ? AND company_id = ? AND estado IN ('sent', 'accepted') LIMIT 1",
            args: [saleId, companyId],
        });
        if (dteResult.rows.length > 0) {
            dte_folio = dteResult.rows[0].folio;
            dte_tipo = dteResult.rows[0].tipo_dte;
        }
    } catch { /* sii_dtes puede no existir aún */ }

    return { success: true, sale: result.rows[0], dte_folio, dte_tipo };
}

// ─────────────────────────────────────────────────────────────────
// Agregaciones de venta (Fase 1 · Paso 11) — mismos UPSERTs que corrían
// en el navegador (FASE 7.x), ahora en UN solo batch atómico server-side.
// dateStr y hour llegan del cliente ya calculados en su zona horaria.
// ─────────────────────────────────────────────────────────────────

function aggregationTotals(saleData) {
    const items = Array.isArray(saleData.items) ? saleData.items : [];
    const itemsSold = items.reduce((sum, item) => sum + (parseFloat(item.quantity) || 0), 0);
    const cost = items.reduce((sum, item) => sum + ((parseFloat(item.cost) || 0) * (parseFloat(item.quantity) || 0)), 0);
    return { items, itemsSold, cost, profit: saleData.total - cost };
}

function profitParts(item) {
    const price = parseFloat(item.price) || 0;
    const qty = parseFloat(item.quantity) || 0;
    const costUnit = parseFloat(item.cost) || 0;
    const taxRate = parseFloat(item.tax_rate) || 0;
    const netPrice = taxRate > 0 ? price / (1 + taxRate / 100) : price;
    return {
        revenue: price * qty,
        cost: costUnit * qty,
        tax: (price * qty) - (netPrice * qty),
        profit: (netPrice - costUnit) * qty,
    };
}

export async function saleAggregations(turso, companyId, session, body) {
    const { saleData, userId, userName, dateStr, hour } = body;
    if (!saleData || !dateStr) return { success: false, error: 'Faltan datos de agregación' };

    const { items, itemsSold, profit } = aggregationTotals(saleData);
    const now = new Date().toISOString();
    const saleTime = new Date(saleData.date).toISOString();
    const hr = parseInt(hour, 10) || 0;

    const queries = [
        {
            sql: `INSERT INTO sales_daily_summary
                    (company_id, day, total_sales, total_orders, updated_at)
                  VALUES (?, ?, ?, 1, datetime('now'))
                  ON CONFLICT(company_id, day) DO UPDATE SET
                    total_sales = total_sales + excluded.total_sales,
                    total_orders = total_orders + 1,
                    updated_at = datetime('now')`,
            args: [companyId, dateStr, saleData.total],
        },
        {
            sql: `INSERT INTO vendor_daily_performance
                    (id, company_id, user_id, user_name, date, total_sales, total_amount, total_profit,
                     avg_ticket, total_items_sold, first_sale_time, last_sale_time, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(company_id, user_id, date) DO UPDATE SET
                    total_sales = total_sales + 1,
                    total_amount = total_amount + excluded.total_amount,
                    total_profit = total_profit + excluded.total_profit,
                    avg_ticket = (total_amount + excluded.total_amount) / (total_sales + 1),
                    total_items_sold = total_items_sold + excluded.total_items_sold,
                    last_sale_time = excluded.last_sale_time,
                    updated_at = excluded.updated_at`,
            args: [`perf_${companyId}_${userId}_${dateStr}`, companyId, userId, userName, dateStr,
                saleData.total, profit, saleData.total, itemsSold, saleTime, saleTime, now, now],
        },
        {
            sql: `INSERT INTO hourly_sales_stats
                    (id, company_id, date, hour, total_sales, total_amount, created_at, updated_at)
                  VALUES (?, ?, ?, ?, 1, ?, ?, ?)
                  ON CONFLICT(company_id, date, hour) DO UPDATE SET
                    total_sales = total_sales + 1,
                    total_amount = total_amount + excluded.total_amount,
                    updated_at = excluded.updated_at`,
            args: [`hourly_${companyId}_${dateStr}_${hr}`, companyId, dateStr, hr, saleData.total, now, now],
        },
        ...items.map(item => {
            const p = profitParts(item);
            return {
                sql: `INSERT INTO product_daily_profit
                        (company_id, product_id, day, total_quantity, total_revenue,
                         total_cost, total_tax, total_profit, updated_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                      ON CONFLICT(company_id, product_id, day) DO UPDATE SET
                        total_quantity = total_quantity + excluded.total_quantity,
                        total_revenue = total_revenue + excluded.total_revenue,
                        total_cost = total_cost + excluded.total_cost,
                        total_tax = total_tax + excluded.total_tax,
                        total_profit = total_profit + excluded.total_profit,
                        updated_at = CURRENT_TIMESTAMP`,
                args: [companyId, item.id, dateStr, item.quantity, p.revenue, p.cost, p.tax, p.profit],
            };
        }),
        ...items.map(item => {
            const revenue = item.price * item.quantity;
            return {
                sql: `INSERT INTO product_movement_stats
                        (id, company_id, product_id, product_name, total_sold_all_time,
                         total_revenue_all_time, sold_last_7_days, revenue_last_7_days,
                         sold_last_30_days, revenue_last_30_days, last_sale_date, updated_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                      ON CONFLICT(company_id, product_id) DO UPDATE SET
                        total_sold_all_time = total_sold_all_time + excluded.total_sold_all_time,
                        total_revenue_all_time = total_revenue_all_time + excluded.total_revenue_all_time,
                        sold_last_7_days = sold_last_7_days + excluded.sold_last_7_days,
                        revenue_last_7_days = revenue_last_7_days + excluded.revenue_last_7_days,
                        sold_last_30_days = sold_last_30_days + excluded.sold_last_30_days,
                        revenue_last_30_days = revenue_last_30_days + excluded.revenue_last_30_days,
                        last_sale_date = excluded.last_sale_date,
                        updated_at = excluded.updated_at`,
                args: [`stats_${companyId}_${item.id}`, companyId, item.id, item.name, item.quantity, revenue,
                    item.quantity, revenue, item.quantity, revenue, now, now],
            };
        }),
    ];

    await turso.batch(queries);
    return { success: true };
}

export async function saleAggregationsReverse(turso, companyId, session, body) {
    const { saleData, userId, dateStr, hour } = body;
    if (!saleData || !Array.isArray(saleData.items) || !dateStr) {
        return { success: false, error: 'Missing sale data' };
    }

    const { items, itemsSold, profit } = aggregationTotals(saleData);
    const now = new Date().toISOString();
    const hr = parseInt(hour, 10) || 0;

    const queries = [
        {
            sql: `UPDATE sales_daily_summary SET
                    total_sales = MAX(0, total_sales - ?),
                    total_orders = MAX(0, total_orders - 1),
                    updated_at = datetime('now')
                  WHERE company_id = ? AND day = ?`,
            args: [saleData.total, companyId, dateStr],
        },
        {
            sql: `UPDATE vendor_daily_performance SET
                    total_sales = MAX(0, total_sales - 1),
                    total_amount = MAX(0, total_amount - ?),
                    total_profit = MAX(0, total_profit - ?),
                    avg_ticket = CASE WHEN (total_sales - 1) > 0 THEN (total_amount - ?) / (total_sales - 1) ELSE 0 END,
                    total_items_sold = MAX(0, total_items_sold - ?),
                    updated_at = datetime('now')
                  WHERE id = ?`,
            args: [saleData.total, profit, saleData.total, itemsSold, `perf_${companyId}_${userId}_${dateStr}`],
        },
        {
            sql: `UPDATE hourly_sales_stats SET
                    total_sales = MAX(0, total_sales - 1),
                    total_amount = MAX(0, total_amount - ?),
                    updated_at = datetime('now')
                  WHERE id = ?`,
            args: [saleData.total, `hourly_${companyId}_${dateStr}_${hr}`],
        },
        ...items.map(item => {
            const p = profitParts(item);
            return {
                sql: `UPDATE product_daily_profit SET
                        total_quantity = MAX(0, total_quantity - ?),
                        total_revenue = MAX(0, total_revenue - ?),
                        total_cost = MAX(0, total_cost - ?),
                        total_tax = MAX(0, total_tax - ?),
                        total_profit = MAX(0, total_profit - ?),
                        updated_at = CURRENT_TIMESTAMP
                      WHERE company_id = ? AND product_id = ? AND day = ?`,
                args: [item.quantity, p.revenue, p.cost, p.tax, p.profit, companyId, item.id, dateStr],
            };
        }),
        ...items.map(item => {
            const revenue = item.price * item.quantity;
            return {
                sql: `UPDATE product_movement_stats SET
                        total_sold_all_time = MAX(0, total_sold_all_time - ?),
                        total_revenue_all_time = MAX(0, total_revenue_all_time - ?),
                        sold_last_7_days = MAX(0, sold_last_7_days - ?),
                        revenue_last_7_days = MAX(0, revenue_last_7_days - ?),
                        sold_last_30_days = MAX(0, sold_last_30_days - ?),
                        revenue_last_30_days = MAX(0, revenue_last_30_days - ?),
                        updated_at = ?
                      WHERE id = ?`,
                args: [item.quantity, revenue, item.quantity, revenue, item.quantity, revenue, now, `stats_${companyId}_${item.id}`],
            };
        }),
    ];

    const results = await turso.batch(queries);
    // Paridad con reverseVendorDailyPerformance: avisar si la fila no existía
    if (Number(results[1]?.rowsAffected ?? 0) === 0) {
        console.warn(`⚠️ saleAggregationsReverse: vendor_daily_performance sin fila (perf_${companyId}_${userId}_${dateStr}). Saltado.`);
    }
    return { success: true };
}
