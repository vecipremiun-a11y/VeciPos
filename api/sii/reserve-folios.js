// POST /api/sii/reserve-folios
// Reserva un bloque de folios contiguos del CAF activo para uso offline.
// Avanza folio_actual en sii_cafs y registra cada folio en sii_offline_folios
// con status='reserved'. El cliente los consume offline; al sincronizar la
// venta se llamará /api/sii/emit con `folio` para emitir el DTE real.
//
// Body: { tipo_dte: 39, count: 100, user_id?: string }

import { turso } from './_db.js';
import { requireCompanySession } from '../_lib/guard.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Sesión firmada + membresía a la empresa (Fase 1 · Paso 6 — blindaje SII)
    const companyId = await requireCompanySession(turso, req, res);
    if (!companyId) return;

    try {
        const { tipo_dte, count, user_id, force } = req.body || {};
        const tipoDte = Number(tipo_dte) || 39;
        const want = Math.min(Math.max(Number(count) || 50, 1), 500);

        // SEGURIDAD: La pre-reserva automática consumía CAFs enteros sin emitir DTEs reales.
        // Solo se permite si el llamador explícitamente envía force=true (uso manual desde
        // pantalla de Sincronización Offline). Llamadas automáticas reciben skipped.
        if (!force) {
            return res.status(200).json({
                ok: false,
                skipped: true,
                reason: 'auto_reserve_disabled',
                message: 'Pre-reserva automática deshabilitada. Use force=true desde la pantalla de Sincronización Offline.',
                available: 0,
            });
        }

        if (![39].includes(tipoDte)) {
            return res.status(400).json({ error: 'Solo se soportan folios offline para boleta (39) por ahora' });
        }

        // 1) CAF activo con folios disponibles
        const cafRes = await turso.execute({
            sql: `SELECT * FROM sii_cafs
                  WHERE company_id = ? AND tipo_dte = ? AND estado = 'active' AND folio_actual <= folio_hasta
                  ORDER BY folio_desde ASC LIMIT 1`,
            args: [companyId, tipoDte]
        });

        if (cafRes.rows.length === 0) {
            return res.status(200).json({
                ok: false,
                skipped: true,
                reason: 'no_active_caf',
                message: `No hay folios disponibles para tipo ${tipoDte}. Solicite nuevos CAF al SII.`,
                available: 0
            });
        }

        const caf = cafRes.rows[0];
        const folioFrom = caf.folio_actual;
        const remaining = caf.folio_hasta - folioFrom + 1;
        const reserveCount = Math.min(want, remaining);
        const folioTo = folioFrom + reserveCount - 1;
        const newFolioActual = folioTo + 1;
        const now = new Date().toISOString();

        // 2) Avance atómico de folio_actual (compare-and-swap)
        const updateRes = await turso.execute({
            sql: `UPDATE sii_cafs
                  SET folio_actual = ?,
                      estado = CASE WHEN ? > folio_hasta THEN 'exhausted' ELSE 'active' END,
                      updated_at = ?
                  WHERE id = ? AND folio_actual = ?`,
            args: [newFolioActual, newFolioActual, now, caf.id, folioFrom]
        });

        if (updateRes.rowsAffected === 0) {
            return res.status(409).json({ error: 'Conflicto reservando folios, reintente' });
        }

        // 3) Insertar cada folio en sii_offline_folios (batch)
        const inserts = [];
        for (let f = folioFrom; f <= folioTo; f++) {
            inserts.push({
                sql: `INSERT INTO sii_offline_folios
                      (company_id, tipo_dte, folio, caf_id, reserved_for_user_id, status, reserved_at)
                      VALUES (?, ?, ?, ?, ?, 'reserved', ?)`,
                args: [companyId, tipoDte, f, caf.id, user_id || null, now]
            });
        }
        if (inserts.length > 0) {
            await turso.batch(inserts, 'write');
        }

        return res.status(200).json({
            ok: true,
            tipo_dte: tipoDte,
            reserved: reserveCount,
            folio_from: folioFrom,
            folio_to: folioTo,
            caf_id: caf.id,
            caf_remaining: caf.folio_hasta - newFolioActual + 1,
        });
    } catch (e) {
        console.error('Error reserve-folios:', e);
        return res.status(500).json({ error: e.message });
    }
}
