import { getTiendaConfig, logSync, turso } from './_db.js';

function sanitizeBaseUrl(url) {
    if (!url) return null;
    return url.endsWith('/') ? url.slice(0, -1) : url;
}

function shouldQueueRetry(status) {
    return status === 429 || status >= 500;
}

function buildAuthHeaders(config) {
    return {
        'Content-Type': 'application/json',
        'x-api-consumer-key': config.api_key,
        'x-api-consumer-secret': config.api_secret,
        'x-api-key': config.api_key,
        'x-api-secret': config.api_secret,
    };
}

function normalizeSku(value) {
    if (value === undefined || value === null) return '';
    return String(value).trim().toUpperCase();
}

function normalizeStockForStore(stock, unit) {
    const raw = Number(stock || 0);
    const clamped = raw < 0 ? 0 : raw;
    const u = (unit || 'un').toLowerCase();
    // Kg/Lt: 3 decimales, Und: entero
    return (u === 'kg' || u === 'lt')
        ? Math.round(clamped * 1000) / 1000
        : Math.round(clamped);
}

/**
 * Convierte price_ranges del POS [{min, max, margin, price}]
 * al formato de la tienda [{minQty, maxQty, price}].
 * - Si es undefined → devuelve undefined (no tocar las escalas existentes en tienda).
 * - Si es [] → devuelve [] (eliminar escalas en tienda).
 */
function normalizePriceTiers(priceRanges) {
    if (priceRanges === undefined || priceRanges === null) return undefined;
    if (!Array.isArray(priceRanges)) {
        try { priceRanges = JSON.parse(priceRanges); } catch { return undefined; }
    }
    return priceRanges.map(tier => ({
        minQty: Number(tier.min || 0),
        maxQty: tier.max === '' || tier.max === null || tier.max === undefined ? null : Number(tier.max),
        price: Number(tier.price || 0),
    }));
}

/**
 * Id de la categoría del producto en POSVECI, para que la tienda lo cuelgue de
 * la rama correcta del árbol que manda syncCategoriesToStore.
 *
 * Sale del NOMBRE que tiene el producto, que es lo que el inventario muestra y
 * filtra. `products.category_id` se usa solo si coincide con ese nombre: medido
 * el 12-sep-2026 en `default`, 23 productos tienen el id en NULL y 1 tiene el id
 * de "Snack" con el nombre "Dulces". Mandar el id a ciegas los dejaría en la
 * tienda en otra categoría que la que se ve en el POS.
 *
 * Si falla la consulta se sigue sin el id: la tienda cae al nombre, como antes.
 */
async function resolverCategoriaPos(companyId, product) {
    const nombre = product.category ? String(product.category) : '';
    if (!nombre) return null;
    const productId = product.id ?? null;
    try {
        const r = await turso.execute({
            sql: `SELECT COALESCE(
                    (SELECT c.id FROM products p
                       JOIN categories c ON c.id = p.category_id AND c.company_id = p.company_id
                      WHERE p.id = ? AND p.company_id = ? AND c.name = ?),
                    (SELECT id FROM categories WHERE company_id = ? AND name = ? ORDER BY id LIMIT 1)
                  ) AS id`,
            args: [productId, companyId, nombre, companyId, nombre],
        });
        const id = r.rows?.[0]?.id;
        return id === null || id === undefined ? null : Number(id);
    } catch (error) {
        console.warn('No se pudo resolver la categoría del producto para la tienda:', error.message);
        return null;
    }
}

// Reglas de la oferta para la tienda: hasta cuándo, y cuántas unidades quedan a
// precio de oferta (null = sin límite). Se leen de la base, que ya tiene lo
// recién guardado. Sin la migración 0033: oferta sin reglas, como antes.
async function reglaDeOferta(companyId, product) {
    if (product.id === undefined || product.id === null) return { hasta: null, quedan: null };
    try {
        const r = await turso.execute({
            sql: 'SELECT offer_until, offer_units_limit, offer_units_sold FROM products WHERE id = ? AND company_id = ? LIMIT 1',
            args: [product.id, companyId],
        });
        const f = r.rows[0] || {};
        const limite = Number(f.offer_units_limit) || 0;
        return {
            hasta: f.offer_until || null,
            quedan: limite > 0 ? Math.max(0, limite - (Number(f.offer_units_sold) || 0)) : null,
        };
    } catch {
        return { hasta: null, quedan: null };
    }
}

// Unidades de medida del producto (Caja, Bandeja…, migración 0030) como las pide
// la tienda: la lista COMPLETA, inactivas incluidas (omitir una = borrarla allá).
// Contrato: POSVECI-UNIDADES.md del repo de miniveci. Solo productos por unidad:
// para los de peso no se manda nada (undefined = la tienda no toca las suyas).
async function presentacionesParaTienda(companyId, productId, unit) {
    if (unit && unit !== 'Und') return undefined;
    try {
        const r = await turso.execute({
            sql: `SELECT id, name, units, price, barcode, is_active FROM product_presentations
                  WHERE company_id = ? AND product_id = ? ORDER BY units, id`,
            args: [companyId, productId],
        });
        return r.rows.map(p => ({
            pos_presentation_id: String(p.id),
            name: p.name,
            units: Number(p.units),
            price: Number(p.price),
            barcode: p.barcode || null,
            is_active: Number(p.is_active) !== 0,
        }));
    } catch {
        // Sin la tabla (migración 0030) no hay unidades de medida que mandar.
        return undefined;
    }
}

/**
 * Manda a la tienda las unidades de medida de UN producto, después de crear,
 * editar o borrar una (o de que una compra le cambie el precio).
 *
 * Va con nombre, categoría, precio y unidad leídos de la base, no solo con la
 * lista: si el producto todavía no existiera en la tienda, ella lo crearía con
 * lo que llegue, y sin nombre ni precio quedaría "Producto 123" a $0. El stock no
 * va: tiene su propio camino y su protección de pedidos en vuelo.
 */
export async function syncPresentationsToStore({ companyId, productId }) {
    let p;
    try {
        p = (await turso.execute({
            sql: 'SELECT id, sku, name, category, price, unit FROM products WHERE id = ? AND company_id = ? LIMIT 1',
            args: [productId, companyId],
        })).rows[0];
    } catch (error) {
        return { success: false, error: error.message };
    }
    if (!p || !normalizeSku(p.sku)) return { success: false, skipped: true, error: 'Producto sin SKU' };
    if ((p.unit || 'Und') !== 'Und') return { success: true, skipped: true };
    const result = await syncProductToStore({
        companyId,
        product: { id: p.id, sku: p.sku, name: p.name, category: p.category, price: p.price, unit: p.unit || 'Und', conPresentaciones: true },
    });
    // La tienda salta (y borra allá) las que no cumplen sus reglas. Con las
    // validaciones del POS no debería pasar nunca: si pasa, que quede a la vista.
    try {
        const saltadas = JSON.parse(result?.body || '{}')?.presentations?.skipped;
        if (Array.isArray(saltadas) && saltadas.length) {
            await logSync({
                company_id: companyId,
                direction: 'pos_to_store',
                event: 'product.presentations_skipped',
                status: 'error',
                message: `La tienda no aceptó ${saltadas.length} unidad(es) de medida de "${p.name}"`,
                payload: { pos_product_id: p.id, sku: p.sku },
                response: { skipped: saltadas },
            });
        }
    } catch { /* respuesta sin JSON: ya quedó en el log del envío */ }
    return result;
}

/**
 * Lo mismo, sin hacer esperar más de `ms` a quien guardó. Si la tienda tarda,
 * el envío sigue solo y queda en el log; el guardado ya está hecho.
 */
export async function syncPresentationsToStoreSinEsperar({ companyId, productId, ms = 6000 }) {
    let timer;
    const tope = new Promise(resolve => { timer = setTimeout(() => resolve({ success: false, timeout: true }), ms); });
    try {
        return await Promise.race([
            syncPresentationsToStore({ companyId, productId }).catch(error => ({ success: false, error: error.message })),
            tope,
        ]);
    } finally {
        clearTimeout(timer);
    }
}

export async function syncPriceToStore({ companyId, product }) {
    const config = await getTiendaConfig(companyId);

    if (!config || config.is_active === 0) {
        return { success: false, error: 'Integración no configurada o inactiva' };
    }

    const baseUrl = sanitizeBaseUrl(config.tienda_url);
    if (!baseUrl) {
        return { success: false, error: 'tienda_url no configurada' };
    }

    const endpoint = `${baseUrl}/api/pos/products/price`;
    const payload = {
        product_id: product.id,
        sku: product.sku || null,
        sale_price: Number(product.price || 0),
        offer_price: Number(product.offer_price || 0),
        is_offer: Boolean(product.is_offer),
    };

    const tiers = normalizePriceTiers(product.price_ranges);
    if (tiers !== undefined) payload.priceTiers = tiers;

    try {
        const response = await fetch(endpoint, {
            method: 'PUT',
            headers: buildAuthHeaders(config),
            body: JSON.stringify(payload),
        });

        const text = await response.text();
        const result = {
            success: response.ok,
            status: response.status,
            body: text.slice(0, 1000),
        };

        await logSync({
            company_id: companyId,
            direction: 'pos_to_store',
            event: 'product.price_updated',
            status: response.ok ? 'ok' : 'error',
            message: response.ok ? 'Precio sincronizado con tienda' : 'Falló sincronización de precio',
            payload,
            response: result,
        });

        return result;
    } catch (error) {
        await logSync({
            company_id: companyId,
            direction: 'pos_to_store',
            event: 'product.price_updated',
            status: 'error',
            message: 'Error de red al sincronizar precio',
            payload,
            error: error.message,
        });

        return { success: false, error: error.message };
    }
}

export async function syncProductToStore({ companyId, product }) {
    const config = await getTiendaConfig(companyId);

    if (!config || config.is_active === 0) {
        return { success: false, error: 'Integración no configurada o inactiva' };
    }

    const baseUrl = sanitizeBaseUrl(config.tienda_url);
    if (!baseUrl) {
        return { success: false, error: 'tienda_url no configurada' };
    }

    const endpoint = `${baseUrl}/api/pos/products/sync`;
    // ID maestro del producto en POSVECI: llave PERMANENTE para que miniveci
    // matchee por id (no por SKU, que es editable). Evita duplicados cuando se
    // cambia el código de barras. miniveci debe priorizar pos_product_id sobre
    // el SKU (con fallback a SKU solo para productos legacy sin id guardado).
    const payload = { sku: product.sku || null };
    if (product.id !== undefined && product.id !== null) {
        payload.pos_product_id = product.id;
    }

    if (product.name) payload.name = product.name;
    if (product.category) {
        payload.category = product.category;
        // El nombre sigue viajando (respaldo para una tienda que no conozca el id).
        // Una tienda vieja ignora el campo: su schema descarta lo que no conoce.
        const posCategoryId = await resolverCategoriaPos(companyId, product);
        if (posCategoryId !== null) payload.posCategoryId = posCategoryId;
    }
    if (product.stock !== undefined) payload.stock = normalizeStockForStore(product.stock, product.unit);
    if (product.price) payload.price = Number(product.price);
    if (product.unit) payload.unit = product.unit;

    // Costo del producto
    if (product.cost !== undefined) payload.cost_price = Number(product.cost || 0);

    // Oferta, impuesto: solo si vienen. Al editar un producto se manda SOLO lo
    // que cambió (7-oct-2026); antes estos dos se mandaban siempre, y un envío
    // sin ellos habría apagado la oferta y dejado el IVA en 0 en la tienda. La
    // tienda deja igual lo que no llega.
    if (product.is_offer !== undefined) {
        payload.is_offer = product.is_offer ? true : false;
        payload.offer_price = product.is_offer ? Number(product.offer_price || 0) : 0;
        // Reglas de la oferta (migración 0033), leídas de la base porque el
        // producto ya se guardó: hasta cuándo, y cuántas unidades QUEDAN a precio
        // de oferta (la tienda descuenta de ahí sus ventas y no deja pedir más).
        const regla = payload.is_offer ? await reglaDeOferta(companyId, product) : { hasta: null, quedan: null };
        payload.offer_ends_at = regla.hasta;
        payload.offer_stock = regla.quedan;
    }
    if (product.tax_rate !== undefined) payload.tax_rate = Number(product.tax_rate || 0);

    // Escalas de precio (mayoreo)
    const tiers = normalizePriceTiers(product.price_ranges);
    if (tiers !== undefined) payload.priceTiers = tiers;

    // Modo del producto (sale_only / preorder_only / both) y configuración
    // de encargo. La tienda puede usarlos para decidir visibilidad y formato.
    // Si los ignora, no afecta — sigue funcionando como antes.
    if (product.sale_mode !== undefined) payload.sale_mode = product.sale_mode;
    if (product.preorder_unit !== undefined) payload.preorder_unit = product.preorder_unit;
    if (product.preorder_billing_unit !== undefined) payload.preorder_billing_unit = product.preorder_billing_unit;
    if (product.preorder_price_per_kg !== undefined) payload.preorder_price_per_kg = Number(product.preorder_price_per_kg || 0);
    if (product.preorder_gram_per_unit !== undefined) payload.preorder_gram_per_unit = Number(product.preorder_gram_per_unit || 0);
    if (product.preorder_use_base_price !== undefined) payload.preorder_use_base_price = Boolean(product.preorder_use_base_price);
    if (product.units_per_box !== undefined) payload.units_per_box = Number(product.units_per_box || 0);

    // Grupo de escala (los productos del mismo grupo suman para el mayoreo). Solo
    // si viene: hoy lo manda la ficha cuando se cambia. Vacío = sin grupo. En la
    // tienda pueden tener grupos puestos a mano: un producto que no lo trae no los toca.
    if (product.scale_group_id !== undefined) {
        payload.tier_group = product.scale_group_id ? String(product.scale_group_id).trim() || null : null;
    }

    // Unidades de medida: la lista completa leída de la base, solo cuando se pide
    // (al crear, editar o borrar una, o cuando una compra les cambia el precio).
    if (product.conPresentaciones && product.id !== undefined && product.id !== null) {
        const lista = await presentacionesParaTienda(companyId, product.id, product.unit || 'Und');
        if (lista !== undefined) payload.presentations = lista;
    }

    if (product.image && typeof product.image === 'string') {
        if (product.image.startsWith('http')) {
            payload.image_url = product.image;
        } else {
            payload.image_base64 = product.image;
        }
    }

    try {
        let response = await fetch(endpoint, {
            method: 'PUT',
            headers: buildAuthHeaders(config),
            body: JSON.stringify(payload),
        });

        // Si falla con 400 y tenía imagen, reintentar sin imagen
        if (response.status === 400 && (payload.image_base64 || payload.image_url)) {
            const retryPayload = { ...payload };
            delete retryPayload.image_base64;
            delete retryPayload.image_url;
            response = await fetch(endpoint, {
                method: 'PUT',
                headers: buildAuthHeaders(config),
                body: JSON.stringify(retryPayload),
            });
        }

        const text = await response.text();
        const result = {
            success: response.ok,
            status: response.status,
            body: text.slice(0, 1000),
        };

        await logSync({
            company_id: companyId,
            direction: 'pos_to_store',
            event: 'product.synced',
            status: response.ok ? 'ok' : 'error',
            message: response.ok ? 'Producto sincronizado con tienda' : 'Falló sincronización de producto',
            payload: { ...payload, image_base64: payload.image_base64 ? '(omitted)' : undefined },
            response: result,
        });

        return result;
    } catch (error) {
        await logSync({
            company_id: companyId,
            direction: 'pos_to_store',
            event: 'product.synced',
            status: 'error',
            message: 'Error de red al sincronizar producto',
            payload: { ...payload, image_base64: payload.image_base64 ? '(omitted)' : undefined },
            error: error.message,
        });

        return { success: false, error: error.message };
    }
}

/**
 * Manda a la tienda el árbol COMPLETO de categorías (categoría → subcategoría →
 * sub-subcategoría), para que las muestre y ordene igual que el POS.
 *
 * Antes la tienda solo recibía el nombre de la categoría de cada producto, y con
 * un nombre no hay forma de saber de quién cuelga: por eso las mostraba planas.
 *
 * Contrato: POSVECI-CATEGORIAS.md del repo de miniveci. La llave es el id de
 * POSVECI, así un renombre no duplica nada. Va siempre el árbol entero —la tienda
 * ata los padres en una segunda pasada y necesita tenerlos en el mismo envío—, y
 * por eso `deactivateMissing: true`: una categoría borrada acá se apaga allá.
 * Solo toca categorías que la tienda ya tiene atadas a un id de POSVECI.
 *
 * No manda orden: la tienda ordena por sortOrder y después por nombre, y como
 * el POS ordena por nombre, mandar nada deja el mismo orden sin pisar uno que se
 * haya puesto a mano en la tienda.
 */
export async function syncCategoriesToStore({ companyId }) {
    const config = await getTiendaConfig(companyId);

    // Sin tienda configurada no es un error: la mayoría de las empresas no tiene.
    if (!config || config.is_active === 0) {
        return { success: false, skipped: true, error: 'Integración no configurada o inactiva' };
    }

    const baseUrl = sanitizeBaseUrl(config.tienda_url);
    if (!baseUrl) {
        return { success: false, skipped: true, error: 'tienda_url no configurada' };
    }

    const rows = (await turso.execute({
        sql: 'SELECT id, name, parent_id, status FROM categories WHERE company_id = ? ORDER BY id',
        args: [companyId],
    })).rows || [];

    const categories = rows
        .filter(c => String(c.name || '').trim())
        .map(c => ({
            posCategoryId: Number(c.id),
            name: String(c.name).trim(),
            parentPosCategoryId: c.parent_id === null || c.parent_id === undefined ? null : Number(c.parent_id),
            active: c.status !== 'inactive',
        }));

    // Un envío vacío con deactivateMissing apagaría todo lo de la tienda.
    if (categories.length === 0) {
        return { success: true, skipped: true, message: 'La empresa no tiene categorías' };
    }

    const endpoint = `${baseUrl}/api/pos/categories/sync`;
    const payload = { categories, deactivateMissing: true };

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: buildAuthHeaders(config),
            body: JSON.stringify(payload),
        });

        const text = await response.text();
        let body = null;
        try { body = JSON.parse(text); } catch { /* respuesta no JSON */ }

        const result = {
            success: response.ok,
            status: response.status,
            sent: categories.length,
            // created / updated / adopted / parentsLinked / deactivated
            ...(body && typeof body === 'object' ? { store: body } : { body: text.slice(0, 1000) }),
        };

        await logSync({
            company_id: companyId,
            direction: 'pos_to_store',
            event: 'categories.synced',
            status: response.ok ? 'ok' : 'error',
            message: response.ok
                ? `Árbol de categorías sincronizado (${categories.length})`
                : 'Falló sincronización del árbol de categorías',
            payload,
            response: result,
        });

        return result;
    } catch (error) {
        await logSync({
            company_id: companyId,
            direction: 'pos_to_store',
            event: 'categories.synced',
            status: 'error',
            message: 'Error de red al sincronizar el árbol de categorías',
            payload,
            error: error.message,
        });

        return { success: false, error: error.message };
    }
}

export async function syncStockToStore({ companyId, sale }) {
    const config = await getTiendaConfig(companyId);

    if (!config || config.is_active === 0) {
        return { success: false, error: 'Integración no configurada o inactiva' };
    }

    const baseUrl = sanitizeBaseUrl(config.tienda_url);
    if (!baseUrl) {
        return { success: false, error: 'tienda_url no configurada' };
    }

    const endpoint = `${baseUrl}/api/pos/products/stock`;
    const updates = Array.isArray(sale.items)
        ? sale.items
            .map(item => ({
                sku: normalizeSku(item?.sku),
                stock: normalizeStockForStore(item?.stock, item?.unit),
            }))
            .filter(item => item.sku && Number.isFinite(item.stock))
        : [];

    if (updates.length === 0) {
        return { success: false, error: 'No hay items para sincronizar stock' };
    }

    try {
        const attempts = [];

        for (const update of updates) {
            console.log(`Enviando SKU: [${update.sku}]`);
            const response = await fetch(endpoint, {
                method: 'PUT',
                headers: buildAuthHeaders(config),
                body: JSON.stringify({
                    sku: update.sku,
                    stock: update.stock,
                }),
            });

            const text = await response.text();
            attempts.push({
                sku: update.sku,
                stock: update.stock,
                ok: response.ok,
                status: response.status,
                body: text.slice(0, 1000),
            });
        }

        const allOk = attempts.every(a => a.ok);
        const retryable = attempts.some(a => shouldQueueRetry(a.status));
        const primaryStatus = allOk ? 200 : (attempts.find(a => !a.ok)?.status || 502);
        const payloadForLog = {
            sale_id: sale.sale_id,
            sold_at: sale.sold_at || new Date().toISOString(),
            retry_attempt: Number(sale.retry_attempt || 0),
            updates,
        };

        const result = {
            success: allOk,
            status: primaryStatus,
            retryable,
            attempts,
        };

        await logSync({
            company_id: companyId,
            direction: 'pos_to_store',
            event: 'product.stock_updated',
            status: allOk ? 'ok' : (retryable ? 'pending_retry' : 'error'),
            message: allOk
                ? 'Stock sincronizado con tienda'
                : (retryable ? 'Sincronización en cola para reintento' : 'Falló sincronización de stock'),
            payload: payloadForLog,
            response: result,
        });

        return result;
    } catch (error) {
        const payloadForLog = {
            sale_id: sale.sale_id,
            sold_at: sale.sold_at || new Date().toISOString(),
            retry_attempt: Number(sale.retry_attempt || 0),
            updates,
        };

        await logSync({
            company_id: companyId,
            direction: 'pos_to_store',
            event: 'product.stock_updated',
            status: 'pending_retry',
            message: 'Error de red al sincronizar stock. Queda pendiente para reintento',
            payload: payloadForLog,
            error: error.message,
        });

        return { success: false, retryable: true, error: error.message };
    }
}
