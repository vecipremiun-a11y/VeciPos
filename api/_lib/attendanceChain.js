// Cadena de integridad de las marcas de asistencia (Fase 1 del plan legal).
//
// Cada marca guarda el hash de la anterior de la MISMA empresa. Editar, borrar
// o intercalar una fila directamente en la base rompe el eslabón y
// `verifyChain` lo detecta y dice exactamente en qué folio se cortó.
//
// Lo que NO hace: impedir el cambio. Nadie puede impedirlo con acceso a la
// base. Lo que da es lo que pide un registro laboral: que una alteración no
// pueda pasar desapercibida.

import { createHash } from 'node:crypto';

// Campos que quedan firmados. `is_corrected`, `voided_at` y compañía quedan
// FUERA a propósito: anular una marca es un acto legítimo y posterior, y no
// debe romper la cadena. Lo que no puede cambiar nunca es quién marcó, qué
// marcó y cuándo.
export function chainHash(prevHash, rec) {
    const payload = [
        prevHash || 'GENESIS',
        rec.company_id,
        rec.user_id,
        rec.user_rut || '',
        rec.type,
        rec.recorded_at,
        rec.date,
        rec.source,
        rec.device_id || '',
        rec.created_at,
    ].join('|');
    return createHash('sha256').update(payload).digest('hex');
}

const isUniqueViolation = (e) =>
    /UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(String(e?.message || e));

// Último eslabón de la empresa. Las filas anteriores a la migración 0025 tienen
// seq NULL y quedan fuera: la cadena empieza donde empezó a existir.
async function lastLink(turso, companyId) {
    const r = await turso.execute({
        sql: `SELECT seq, hash FROM attendance_records
              WHERE company_id = ? AND seq IS NOT NULL
              ORDER BY seq DESC LIMIT 1`,
        args: [companyId],
    });
    const row = r.rows[0];
    return { seq: Number(row?.seq ?? 0), hash: row?.hash ?? null };
}

/**
 * Inserta una marca encadenada. Devuelve { id, seq, hash, recordedAt }.
 *
 * Si dos marcas simultáneas leen el mismo último seq, el índice único
 * (company_id, seq) hace fallar a la segunda y se reintenta con el seq nuevo.
 */
export async function appendAttendanceRecord(turso, companyId, fields, attempt = 0) {
    const { seq: lastSeq, hash: prevHash } = await lastLink(turso, companyId);

    const rec = {
        company_id: companyId,
        user_id: fields.userId,
        user_rut: fields.userRut || null,
        user_name: fields.userName || null,
        type: fields.type,
        recorded_at: fields.recordedAt,
        date: fields.date,
        source: fields.source || 'kiosk',
        device_id: fields.deviceId || null,
        created_at: fields.createdAt || new Date().toISOString(),
    };
    const seq = lastSeq + 1;
    const hash = chainHash(prevHash, rec);

    try {
        const res = await turso.execute({
            sql: `INSERT INTO attendance_records
                  (company_id, user_id, type, recorded_at, date, source, device_label, branch,
                   recorded_by, notes, seq, hash, prev_hash, user_rut, user_name,
                   device_id, origin_ip, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
                companyId, rec.user_id, rec.type, rec.recorded_at, rec.date, rec.source,
                fields.deviceLabel ?? null, fields.branch ?? null,
                fields.recordedBy ?? null, fields.notes ?? null,
                seq, hash, prevHash, rec.user_rut, rec.user_name,
                rec.device_id, fields.originIp ?? null, rec.created_at,
            ],
        });
        return { id: Number(res.lastInsertRowid), seq, hash, recordedAt: rec.recorded_at };
    } catch (e) {
        if (isUniqueViolation(e) && attempt < 4) {
            return appendAttendanceRecord(turso, companyId, fields, attempt + 1);
        }
        throw e;
    }
}

/**
 * Recalcula la cadena completa de una empresa y devuelve los eslabones rotos.
 *
 * `from` acota desde qué seq revisar (la verificación completa de años de
 * marcas no cabe en una request), pero necesita el eslabón inmediatamente
 * anterior para poder empezar: por eso se lee uno antes.
 */
export async function verifyChain(turso, companyId, { fromSeq = 1, limit = 5000 } = {}) {
    const start = Math.max(1, Number(fromSeq) || 1);

    const anchorRes = await turso.execute({
        sql: `SELECT hash FROM attendance_records
              WHERE company_id = ? AND seq IS NOT NULL AND seq < ?
              ORDER BY seq DESC LIMIT 1`,
        args: [companyId, start],
    });
    let prevHash = anchorRes.rows[0]?.hash ?? null;

    const r = await turso.execute({
        sql: `SELECT id, seq, hash, prev_hash, company_id, user_id, user_rut, type,
                     recorded_at, date, source, device_id, created_at
              FROM attendance_records
              WHERE company_id = ? AND seq IS NOT NULL AND seq >= ?
              ORDER BY seq ASC LIMIT ?`,
        args: [companyId, start, limit],
    });

    const problems = [];
    let expectedSeq = start;

    for (const row of r.rows) {
        const seq = Number(row.seq);

        // Un salto de correlativo = una marca borrada (o una que nunca cerró).
        if (seq !== expectedSeq) {
            problems.push({ seq, kind: 'gap', detail: `Falta el folio ${expectedSeq}` });
            expectedSeq = seq;
        }
        if ((row.prev_hash ?? null) !== prevHash) {
            problems.push({ seq, kind: 'broken_link', detail: 'El eslabón anterior no coincide' });
        }
        const recomputed = chainHash(row.prev_hash, {
            company_id: row.company_id,
            user_id: row.user_id,
            user_rut: row.user_rut,
            type: row.type,
            recorded_at: row.recorded_at,
            date: row.date,
            source: row.source,
            device_id: row.device_id,
            created_at: row.created_at,
        });
        if (recomputed !== row.hash) {
            problems.push({ seq, kind: 'tampered', detail: 'La marca fue modificada después de guardarse' });
        }

        prevHash = row.hash;
        expectedSeq = seq + 1;
    }

    return { checked: r.rows.length, fromSeq: start, problems };
}
