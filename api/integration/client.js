import { getTiendaConfig, logSync } from './_db.js';

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
    const payload = { sku: product.sku || null };

    if (product.name) payload.name = product.name;
    if (product.category) payload.category = product.category;
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
