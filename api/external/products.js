import { createClient } from '@libsql/client';

// Configurar Turso
const turso = createClient({
    url: process.env.VITE_TURSO_DATABASE_URL,
    authToken: process.env.VITE_TURSO_AUTH_TOKEN,
});

// Dominios permitidos para CORS (separados por coma en env)
const ALLOWED_ORIGINS = (process.env.EXTERNAL_CORS_ORIGINS || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

/**
 * Establece los headers CORS según el origin de la request.
 * Si no hay orígenes configurados, permite cualquier origen.
 */
function setCorsHeaders(req, res) {
    const origin = req.headers.origin || '';

    if (ALLOWED_ORIGINS.length === 0) {
        res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
}

/**
 * Valida el token Bearer contra EXTERNAL_API_KEY.
 * Retorna true si es válido, false si no.
 */
function authenticateRequest(req) {
    const apiKey = process.env.EXTERNAL_API_KEY;
    if (!apiKey) return false;

    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) return false;

    const token = authHeader.slice(7);
    return token === apiKey;
}

/**
 * Calcula el margen de utilidad como porcentaje.
 * Formula: ((sale_price - cost_price) / cost_price) * 100
 * Retorna null si no se puede calcular.
 */
function calculateProfitMargin(salePrice, costPrice) {
    if (!costPrice || costPrice <= 0 || !salePrice) return null;
    return Math.round(((salePrice - costPrice) / costPrice) * 100 * 100) / 100;
}

/**
 * GET /api/external/products
 *
 * Endpoint para sincronización de productos con tienda web (MiniVeci).
 *
 * Query params opcionales:
 *   - category: filtrar por categoría exacta
 *   - limit: número máximo de productos (default: sin límite)
 *   - offset: desplazamiento para paginación (default: 0)
 *   - updated_since: ISO date, filtro por fecha de modificación (requiere columna updated_at)
 */
export default async function handler(req, res) {
    setCorsHeaders(req, res);

    // Preflight CORS
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Autenticación
    if (!authenticateRequest(req)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const companyId = process.env.EXTERNAL_COMPANY_ID || 'default';
        const { category, limit, offset, updated_since } = req.query || {};

        // Construir query
        let sql = 'SELECT * FROM products WHERE company_id = ?';
        const args = [companyId];

        // Filtro por categoría
        if (category) {
            sql += ' AND category = ?';
            args.push(category);
        }

        // Filtro por fecha de modificación (sync incremental)
        // Nota: requiere que la tabla products tenga columna updated_at
        if (updated_since) {
            try {
                const sinceDate = new Date(updated_since);
                if (!isNaN(sinceDate.getTime())) {
                    sql += ' AND updated_at >= ?';
                    args.push(sinceDate.toISOString());
                }
            } catch {
                // Ignorar fecha inválida
            }
        }

        sql += ' ORDER BY name ASC';

        // Paginación
        if (limit) {
            const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 1000, 1), 10000);
            sql += ' LIMIT ?';
            args.push(parsedLimit);

            if (offset) {
                const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);
                sql += ' OFFSET ?';
                args.push(parsedOffset);
            }
        }

        const result = await turso.execute({ sql, args });

        // Mapear productos al formato de respuesta
        const products = result.rows.map(p => {
            // El precio de venta es offer_price si está en oferta, sino price
            const salePrice = (p.is_offer && p.offer_price) ? Math.round(p.offer_price) : Math.round(p.price || 0);
            const costPrice = p.cost ? Math.round(p.cost) : null;

            return {
                sku: p.sku || `PROD-${p.id}`,
                name: p.name,
                sale_price: salePrice,
                cost_price: costPrice,
                stock: typeof p.stock === 'number' ? Math.floor(p.stock) : 0,
                image_url: p.image || null,
                category: p.category || null,
                profit_margin: calculateProfitMargin(salePrice, costPrice),
                barcode: p.sku || null,
                unit: p.unit || 'un',
                is_active: true,
            };
        });

        return res.status(200).json({
            success: true,
            total: products.length,
            synced_at: new Date().toISOString(),
            products,
        });
    } catch (error) {
        console.error('❌ Error fetching products for external sync:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
        });
    }
}
