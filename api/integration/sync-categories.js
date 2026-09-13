import { requireMemberForIntegration } from './_db.js';
import { syncCategoriesToStore } from './client.js';

// POS -> Tienda: el árbol completo de categorías. Lo dispara el POS al crear,
// editar o borrar una categoría, y "Sincronizar todo" antes de los productos.
// No recibe nada en el body: el árbol se lee de la base, que es la verdad.

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-company-id');
}

export default async function handler(req, res) {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const companyId = await requireMemberForIntegration(req, res);
    if (!companyId) return;

    try {
        const result = await syncCategoriesToStore({ companyId });

        // Sin tienda configurada no es una falla: se responde 200 para no ensuciar
        // la consola de las empresas que no usan tienda.
        if (result.skipped) return res.status(200).json(result);
        if (!result.success) return res.status(502).json(result);
        return res.status(200).json(result);
    } catch (error) {
        console.error('❌ /api/integration/sync-categories error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error', message: error.message });
    }
}
