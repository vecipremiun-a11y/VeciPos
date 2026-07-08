// Sorteos server-side (Fase 1 · Paso 22). Lógica portada tal cual de
// src/pages/Sorteos.jsx; el token público se genera ahora en el servidor.
import crypto from 'crypto';

function genToken() {
    return 'srt_' + crypto.randomBytes(12).toString('hex');
}

async function sorteoLoad(turso, companyId) {
    const cr = await turso.execute({
        sql: 'SELECT sorteo_token FROM companies WHERE id = ? LIMIT 1',
        args: [companyId],
    });
    let token = cr.rows[0]?.sorteo_token;
    if (!token) {
        token = genToken();
        await turso.execute({
            sql: 'UPDATE companies SET sorteo_token = ? WHERE id = ?',
            args: [token, companyId],
        });
    }
    const sr = await turso.execute({
        sql: `SELECT name, draw_date, active, bg_image, field_name, field_phone,
                     field_rut, field_email, field_boleta, field_address,
                     boleta_min_amount, boleta_from_date
              FROM sorteos WHERE company_id = ? LIMIT 1`,
        args: [companyId],
    });
    return { success: true, token, config: sr.rows[0] || null };
}

async function sorteoParticipants(turso, companyId) {
    const pr = await turso.execute({
        sql: `SELECT id, ticket_number, name, phone, rut, email, boleta, address, created_at
              FROM sorteo_participants WHERE company_id = ? ORDER BY id DESC`,
        args: [companyId],
    });
    return { success: true, rows: pr.rows };
}

async function sorteoSave(turso, companyId, session, { form }) {
    if (!form?.name) return { success: false, error: 'Falta el nombre del sorteo' };
    const now = new Date().toISOString();
    await turso.execute({
        sql: `INSERT INTO sorteos
                (company_id, name, draw_date, active, bg_image,
                 field_name, field_phone, field_rut, field_email, field_boleta, field_address,
                 boleta_min_amount, boleta_from_date,
                 created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(company_id) DO UPDATE SET
                name=excluded.name, draw_date=excluded.draw_date, active=excluded.active,
                bg_image=excluded.bg_image, field_name=excluded.field_name,
                field_phone=excluded.field_phone, field_rut=excluded.field_rut,
                field_email=excluded.field_email, field_boleta=excluded.field_boleta,
                field_address=excluded.field_address,
                boleta_min_amount=excluded.boleta_min_amount, boleta_from_date=excluded.boleta_from_date,
                updated_at=excluded.updated_at`,
        args: [
            companyId, String(form.name).trim(), form.draw_date || null, form.active, form.bg_image || null,
            form.field_name, form.field_phone, form.field_rut, form.field_email, form.field_boleta, form.field_address,
            Number(form.boleta_min_amount) || 0, form.boleta_from_date || null,
            now, now,
        ],
    });
    return { success: true };
}

async function sorteoClearParticipants(turso, companyId) {
    await turso.execute({
        sql: 'DELETE FROM sorteo_participants WHERE company_id = ?',
        args: [companyId],
    });
    return { success: true };
}

export const sorteoActions = { sorteoLoad, sorteoParticipants, sorteoSave, sorteoClearParticipants };
