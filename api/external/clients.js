// Endpoint serverless: miniveci empuja altas/ediciones de clientes a POSVECI.
// Lo llama miniveci (best-effort) cuando:
//   - un cliente se registra (web / mobile / Google)
//   - un cliente edita su perfil (RUT, correo, teléfono, nombre, dirección)
//
// Identidad por ID permanente: una vez que un cliente de POSVECI tiene
// external_id (el ID de la cuenta de miniveci), ese vínculo manda. Este
// endpoint:
//   1. Busca al cliente por external_id → RUT → email (en ese orden).
//   2. Si lo encuentra, le sincroniza los datos y backfillea el external_id
//      (enlaza cuentas legacy creadas presencialmente sin duplicar).
//   3. Si no existe, lo crea con el external_id.
//
// Auth: mismo Bearer (EXTERNAL_API_KEY) que el resto de /api/external/*.
// Empresa: parseCompanyId() (variable de entorno, igual que preorders).

import {
    authenticateRequest,
    ensureClientsSyncColumns,
    normalizeRutForLookup,
    parseCompanyId,
    parseJsonBody,
    setCorsHeaders,
    turso,
} from './_common.js';

async function upsertClient(req, res) {
    const companyId = parseCompanyId();
    const body = parseJsonBody(req);

    const externalId = (body.external_id ?? '').toString().trim() || null;
    const name = (body.name ?? '').toString().trim();
    const rut = (body.rut ?? '').toString().trim() || null;
    const phone = (body.phone ?? '').toString().trim() || null;
    const email = (body.email ?? '').toString().trim() || null;
    const address = (body.address ?? '').toString().trim() || null;

    if (!externalId) {
        return res.status(400).json({ success: false, error: 'Missing external_id' });
    }
    if (!name) {
        return res.status(400).json({ success: false, error: 'Missing name' });
    }

    await ensureClientsSyncColumns();

    const rutNorm = normalizeRutForLookup(rut);
    const emailNorm = email ? email.toLowerCase() : null;

    // 1. Buscar cliente existente: external_id → RUT → email.
    let existingId = null;
    let linkedBy = null;

    const byExt = await turso.execute({
        sql: 'SELECT id FROM clients WHERE company_id = ? AND external_id = ? LIMIT 1',
        args: [companyId, externalId],
    });
    if (byExt.rows?.[0]) {
        existingId = byExt.rows[0].id;
        linkedBy = 'external_id';
    }

    if (!existingId && rutNorm) {
        const byRut = await turso.execute({
            sql: `SELECT id FROM clients
                  WHERE company_id = ?
                    AND rut IS NOT NULL AND rut != ''
                    AND lower(replace(replace(replace(rut, '.', ''), '-', ''), ' ', '')) = ?
                  LIMIT 1`,
            args: [companyId, rutNorm],
        });
        if (byRut.rows?.[0]) {
            existingId = byRut.rows[0].id;
            linkedBy = 'rut';
        }
    }

    if (!existingId && emailNorm) {
        const byEmail = await turso.execute({
            sql: `SELECT id FROM clients
                  WHERE company_id = ?
                    AND email IS NOT NULL AND email != ''
                    AND lower(trim(email)) = ?
                  LIMIT 1`,
            args: [companyId, emailNorm],
        });
        if (byEmail.rows?.[0]) {
            existingId = byEmail.rows[0].id;
            linkedBy = 'email';
        }
    }

    // 2. Ya existe → sincronizar datos + amarrar external_id si aún no lo tenía.
    //    COALESCE(NULLIF(incoming,''), col): solo pisa campos que miniveci mandó;
    //    no borra datos existentes cuando llega null. El external_id no se pisa
    //    si ya había uno (gana el vínculo establecido).
    if (existingId) {
        await turso.execute({
            sql: `UPDATE clients
                  SET name = COALESCE(NULLIF(?, ''), name),
                      rut = COALESCE(NULLIF(?, ''), rut),
                      phone = COALESCE(NULLIF(?, ''), phone),
                      email = COALESCE(NULLIF(?, ''), email),
                      address = COALESCE(NULLIF(?, ''), address),
                      external_id = COALESCE(NULLIF(external_id, ''), ?),
                      external_source = COALESCE(NULLIF(external_source, ''), ?)
                  WHERE id = ? AND company_id = ?`,
            args: [name, rut, phone, email, address, externalId, 'miniveci', existingId, companyId],
        });
        console.log(`🔗 [clients] Cliente #${existingId} sincronizado desde miniveci (match por ${linkedBy})`);
        return res.status(200).json({
            success: true,
            client_id: existingId,
            external_id: externalId,
            created: false,
            linked_by: linkedBy,
        });
    }

    // 3. No existe → crear.
    const insertRes = await turso.execute({
        sql: `INSERT INTO clients
              (name, rut, phone, email, address, created_at, company_id, external_id, external_source)
              VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?, ?)
              RETURNING id`,
        args: [name, rut, phone, email, address, companyId, externalId, 'miniveci'],
    });
    const newId = insertRes.rows?.[0]?.id;
    console.log(`✅ [clients] Cliente nuevo #${newId} creado desde miniveci (${name})`);
    return res.status(201).json({
        success: true,
        client_id: newId,
        external_id: externalId,
        created: true,
        linked_by: null,
    });
}

export default async function handler(req, res) {
    setCorsHeaders(req, res, 'POST, OPTIONS');

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!authenticateRequest(req)) {
        console.warn(`⚠️  [clients] ${req.method} rechazado: Bearer inválido o ausente`);
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    console.log('📥 [clients] POST recibido');
    try {
        return await upsertClient(req, res);
    } catch (error) {
        console.error('❌ External clients API error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
        });
    }
}
