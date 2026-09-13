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

    // Oferta: siempre enviar ambos campos en snake_case
    payload.is_offer = product.is_offer ? true : false;
    payload.offer_price = product.is_offer ? Number(product.offer_price || 0) : 0;

    // Impuesto: siempre enviar en snake_case
    payload.tax_rate = Number(product.tax_rate || 0);

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
