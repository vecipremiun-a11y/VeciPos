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

/** "Videla 1430, La Cisterna" — lo que se ve en el despacho y en la impresión. */
function lineaDireccion(fila) {
    return [fila.address, fila.comuna].map(v => (v || '').trim()).filter(Boolean).join(', ');
}

/**
 * Espeja en POSVECI la libreta de direcciones que manda la tienda.
 *
 * La tienda manda SIEMPRE la libreta completa del cliente, y la llave es el id
 * que la dirección tiene allá (`external_address_id`): con eso, corregir el
 * texto de una dirección la actualiza en vez de duplicarla.
 *
 * Solo toca las filas de origen 'miniveci'. Las cargadas en el POS (clientes sin
 * cuenta en la tienda) no se tocan nunca: nadie más puede mantenerlas.
 *
 * Campo ausente = "no toques la libreta". Lista vacía = "no tiene ninguna": se
 * vacía la libreta, pero `clients.address` conserva la última conocida para no
 * dejar el despacho en blanco. Es idempotente: mandar dos veces lo mismo no
 * cambia nada.
 */
async function syncAddressBook(companyId, clientId, addresses) {
    const entrantes = addresses
        .map(a => ({
            externalId: (a.external_address_id ?? a.externalAddressId ?? a.id ?? '').toString().trim(),
            label: (a.label ?? '').toString().trim() || null,
            address: (a.address ?? '').toString().trim(),
            comuna: (a.comuna ?? '').toString().trim() || null,
            ciudad: (a.ciudad ?? a.city ?? '').toString().trim() || null,
            notes: (a.notes ?? a.address_notes ?? a.addressNotes ?? '').toString().trim() || null,
            isDefault: a.is_default === true || a.isDefault === true,
        }))
        // Sin id de la tienda no hay forma de emparejarla en el próximo envío, y
        // sin dirección no hay nada que mostrar.
        .filter(a => a.externalId && a.address);

    const previas = await turso.execute({
        sql: `SELECT id, external_id FROM client_addresses
               WHERE company_id = ? AND client_id = ? AND origin = 'miniveci'`,
        args: [companyId, clientId],
    });

    const idsQueVienen = new Set(entrantes.map(a => a.externalId));
    for (const fila of previas.rows || []) {
        if (!idsQueVienen.has(String(fila.external_id))) {
            await turso.execute({
                sql: 'DELETE FROM client_addresses WHERE id = ? AND company_id = ?',
                args: [fila.id, companyId],
            });
        }
    }

    for (const a of entrantes) {
        const existente = (previas.rows || []).find(f => String(f.external_id) === a.externalId);
        if (existente) {
            await turso.execute({
                sql: `UPDATE client_addresses
                         SET label = ?, address = ?, comuna = ?, ciudad = ?, notes = ?,
                             is_default = ?, client_id = ?, updated_at = datetime('now')
                       WHERE id = ? AND company_id = ?`,
                args: [a.label, a.address, a.comuna, a.ciudad, a.notes, a.isDefault ? 1 : 0, clientId, existente.id, companyId],
            });
        } else {
            await turso.execute({
                sql: `INSERT INTO client_addresses
                        (company_id, client_id, external_id, origin, label, address, comuna, ciudad, notes, is_default)
                      VALUES (?, ?, ?, 'miniveci', ?, ?, ?, ?, ?, ?)`,
                args: [companyId, clientId, a.externalId, a.label, a.address, a.comuna, a.ciudad, a.notes, a.isDefault ? 1 : 0],
            });
        }
    }

    // La principal es UNA. Si la tienda marcó una, las demás del cliente dejan de
    // serlo —incluidas las cargadas en el POS—, y esa pasa al campo `address` de
    // la ficha, que es de donde leen el despacho, los encargos y la impresión.
    const principal = entrantes.find(a => a.isDefault) || entrantes[0];
    if (principal) {
        await turso.execute({
            sql: `UPDATE client_addresses SET is_default = 0
                   WHERE company_id = ? AND client_id = ? AND external_id IS NOT ?`,
            args: [companyId, clientId, principal.externalId],
        });
        await turso.execute({
            sql: `UPDATE client_addresses SET is_default = 1, updated_at = datetime('now')
                   WHERE company_id = ? AND client_id = ? AND external_id = ?`,
            args: [companyId, clientId, principal.externalId],
        });
        await turso.execute({
            sql: 'UPDATE clients SET address = ? WHERE id = ? AND company_id = ?',
            args: [lineaDireccion(principal), clientId, companyId],
        });
    }

    return { recibidas: entrantes.length, principal: principal ? lineaDireccion(principal) : null };
}

/**
 * Aplica la libreta si vino, sin poner en riesgo el alta del cliente: que falle
 * el espejo de direcciones no puede hacer que la tienda reintente el registro
 * entero. Si la tabla todavía no existe (código desplegado antes que la
 * migración), se avisa y se sigue.
 */
async function aplicarLibreta(companyId, clientId, body) {
    if (!Array.isArray(body.addresses)) return {};
    try {
        const r = await syncAddressBook(companyId, clientId, body.addresses);
        console.log(`📍 [clients] Cliente #${clientId}: ${r.recibidas} dirección(es) de la tienda`);
        return { addresses_synced: r.recibidas };
    } catch (error) {
        console.error(`⚠️  [clients] No se pudo espejar la libreta de #${clientId}:`, error.message);
        return { addresses_synced: 0, addresses_error: error.message };
    }
}

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
        const libreta = await aplicarLibreta(companyId, existingId, body);
        return res.status(200).json({
            success: true,
            client_id: existingId,
            external_id: externalId,
            created: false,
            linked_by: linkedBy,
            ...libreta,
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
    const libreta = await aplicarLibreta(companyId, newId, body);
    return res.status(201).json({
        success: true,
        client_id: newId,
        external_id: externalId,
        created: true,
        linked_by: null,
        ...libreta,
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
