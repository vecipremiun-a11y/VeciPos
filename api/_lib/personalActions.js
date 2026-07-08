// Dominio Personal/Nómina server-side (Fase 1 · Paso 9).
// Todas las acciones llegan vía /api/data/actions con sesión + membresía ya
// validadas. Aquí se fuerza company_id en CADA query (varias versiones del
// navegador no lo filtraban: perfiles, turnos, adelantos, liquidaciones,
// vacaciones — huecos cross-tenant cerrados en esta migración) y los updates
// dinámicos usan whitelist de columnas.

// Columnas de users que el módulo Personal puede tocar (ficha laboral + pago).
const LABOR_FIELDS = new Set([
    'has_labor_profile', 'labor_position', 'labor_branch', 'labor_start_date',
    'labor_status', 'labor_pin',
    'pay_type', 'pay_method', 'pay_day', 'pay_base_amount',
    'pay_fixed_bonus', 'pay_fixed_discount',
    'pay_bank_name', 'pay_bank_account', 'pay_bank_account_type', 'pay_bank_owner',
]);

// Columnas visibles de un empleado (NUNCA password)
const STAFF_COLS = `id, username, name, role, company_id, has_labor_profile, labor_position,
    labor_branch, labor_start_date, labor_status, labor_pin, pay_type, pay_method, pay_day,
    pay_base_amount, pay_fixed_bonus, pay_fixed_discount,
    pay_bank_name, pay_bank_account, pay_bank_account_type, pay_bank_owner`;

const CONFIG_FIELDS = new Set([
    'late_tolerance_minutes', 'kiosk_device_label',
    'late_discount_enabled', 'late_discount_per_minute',
    'absence_discount_enabled', 'vacation_paid', 'medical_paid', 'permission_paid',
    'bonus_punctuality_enabled', 'bonus_punctuality_amount',
    'bonus_attendance_enabled', 'bonus_attendance_amount',
    'working_days_per_month', 'working_hours_per_day',
]);

const PERIOD_FIELDS = new Set([
    'period_label', 'period_start', 'period_end', 'hours_worked', 'days_absent',
    'late_count', 'late_minutes', 'extra_hours', 'manual_bonus', 'manual_discount',
    'advances_discounted', 'base_amount', 'total_to_pay', 'notes',
]);

const BALANCE_FIELDS = new Set(['initial_balance', 'accrued_days', 'used_days']);

const nowIso = () => new Date().toISOString();

function pickWhitelisted(data, whitelist) {
    const sets = [];
    const args = [];
    for (const [k, v] of Object.entries(data || {})) {
        if (whitelist.has(k) && v !== undefined) {
            sets.push(`${k} = ?`);
            args.push(v);
        }
    }
    return { sets, args };
}

// ── Staff / Perfiles ─────────────────────────────────────────────

async function staffList(turso, companyId) {
    const r = await turso.execute({
        sql: `SELECT ${STAFF_COLS} FROM users WHERE company_id = ? AND has_labor_profile = 1 ORDER BY labor_status ASC, username ASC`,
        args: [companyId],
    });
    return { success: true, rows: r.rows };
}

async function laborProfileUpdate(turso, companyId, session, { userId, data }) {
    if (!userId) return { success: false, error: 'Falta userId' };
    const { sets, args } = pickWhitelisted(data, LABOR_FIELDS);
    if (!sets.length) return { success: true };
    await turso.execute({
        sql: `UPDATE users SET ${sets.join(', ')} WHERE id = ? AND company_id = ?`,
        args: [...args, userId, companyId],
    });
    return { success: true };
}

async function laborProfileToggle(turso, companyId, session, { userId, enable }) {
    if (!userId) return { success: false, error: 'Falta userId' };
    await turso.execute({
        sql: 'UPDATE users SET has_labor_profile = ? WHERE id = ? AND company_id = ?',
        args: [enable ? 1 : 0, userId, companyId],
    });
    return { success: true };
}

async function laborProfileByPin(turso, companyId, session, { pin }) {
    if (!pin) return { success: true, user: null };
    const r = await turso.execute({
        sql: `SELECT ${STAFF_COLS} FROM users
              WHERE (company_id = ? OR company_id = 'default')
              AND has_labor_profile = 1 AND labor_pin = ? AND labor_status = 'active'`,
        args: [companyId, pin],
    });
    return { success: true, user: r.rows[0] || null };
}

// Datos de un empleado para el cálculo de liquidación (sin password)
async function staffUser(turso, companyId, session, { userId }) {
    const r = await turso.execute({
        sql: `SELECT ${STAFF_COLS} FROM users WHERE id = ? AND company_id = ?`,
        args: [userId, companyId],
    });
    return { success: true, user: r.rows[0] || null };
}

// ── Asistencia ───────────────────────────────────────────────────

async function attendanceToday(turso, companyId, session, { today }) {
    const r = await turso.execute({
        sql: `SELECT ar.*, u.username, u.name FROM attendance_records ar
              JOIN users u ON ar.user_id = u.id
              WHERE ar.company_id = ? AND ar.date = ? ORDER BY ar.recorded_at ASC`,
        args: [companyId, today],
    });
    return { success: true, rows: r.rows };
}

async function attendanceRange(turso, companyId, session, { startDate, endDate, userId }) {
    let sql = `SELECT ar.*, u.username, u.name FROM attendance_records ar
               JOIN users u ON ar.user_id = u.id
               WHERE ar.company_id = ? AND ar.date BETWEEN ? AND ?`;
    const args = [companyId, startDate, endDate];
    if (userId) { sql += ' AND ar.user_id = ?'; args.push(userId); }
    sql += ' ORDER BY ar.date DESC, ar.recorded_at DESC';
    const r = await turso.execute({ sql, args });
    return { success: true, rows: r.rows };
}

async function attendanceMark(turso, companyId, session, { userId, type, deviceLabel, branch, date }) {
    if (!userId || !date) return { success: false, error: 'Faltan datos' };
    const recordedAt = nowIso();

    const lastRes = await turso.execute({
        sql: `SELECT * FROM attendance_records WHERE company_id = ? AND user_id = ? AND date = ?
              ORDER BY recorded_at DESC LIMIT 1`,
        args: [companyId, userId, date],
    });
    const lastRecord = lastRes.rows[0];
    let finalType = type;

    if (type === 'auto') {
        if (!lastRecord) finalType = 'entry';
        else if (lastRecord.type === 'entry') finalType = 'exit';
        else finalType = 'entry'; // reingreso (turno partido)
    } else {
        if (type === 'entry' && lastRecord?.type === 'entry') {
            return { success: false, error: 'Ya tienes una entrada registrada sin salida.' };
        }
        if (type === 'exit' && (!lastRecord || lastRecord.type === 'exit')) {
            return { success: false, error: 'No tienes una entrada registrada para salir.' };
        }
    }

    await turso.execute({
        sql: `INSERT INTO attendance_records (company_id, user_id, type, recorded_at, date, source, device_label, branch)
              VALUES (?, ?, ?, ?, ?, 'kiosk', ?, ?)`,
        args: [companyId, userId, finalType, recordedAt, date, deviceLabel ?? null, branch ?? null],
    });
    return { success: true, type: finalType, recordedAt };
}

async function attendanceManual(turso, companyId, session, { userId, type, datetime, date, notes, recordedBy }) {
    if (!userId || !datetime || !date) return { success: false, error: 'Faltan datos' };
    await turso.execute({
        sql: `INSERT INTO attendance_records (company_id, user_id, type, recorded_at, date, source, notes, recorded_by)
              VALUES (?, ?, ?, ?, ?, 'manual', ?, ?)`,
        args: [companyId, userId, type, datetime, date, notes ?? null, recordedBy ?? session?.uid ?? null],
    });
    return { success: true };
}

async function attendanceStatus(turso, companyId, session, { userId, today }) {
    const r = await turso.execute({
        sql: `SELECT type FROM attendance_records WHERE company_id = ? AND user_id = ? AND date = ?
              ORDER BY recorded_at DESC LIMIT 1`,
        args: [companyId, userId, today],
    });
    if (r.rows.length === 0) return { success: true, status: 'not_marked' };
    return { success: true, status: r.rows[0].type === 'entry' ? 'inside' : 'outside' };
}

// ── Correcciones de asistencia ───────────────────────────────────

async function correctionsPending(turso, companyId) {
    const r = await turso.execute({
        sql: `SELECT ac.*, u.username, u.name FROM attendance_corrections ac
              JOIN users u ON ac.user_id = u.id
              WHERE ac.company_id = ? AND ac.status = 'pending' ORDER BY ac.created_at DESC`,
        args: [companyId],
    });
    return { success: true, rows: r.rows };
}

async function correctionsByStatus(turso, companyId, session, { status }) {
    const r = await turso.execute({
        sql: `SELECT ac.*, u.username, u.name, r.username as reviewer_name
              FROM attendance_corrections ac
              JOIN users u ON ac.user_id = u.id
              LEFT JOIN users r ON ac.reviewed_by = r.id
              WHERE ac.company_id = ? AND ac.status = ? ORDER BY ac.created_at DESC`,
        args: [companyId, status],
    });
    return { success: true, rows: r.rows };
}

async function correctionRequest(turso, companyId, session, { data }) {
    await turso.execute({
        sql: `INSERT INTO attendance_corrections
              (company_id, user_id, original_record_id, correction_type, original_at, requested_at, requested_date, reason, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [companyId, data.user_id || session?.uid, data.original_record_id ?? null, data.correction_type,
            data.original_at ?? null, data.requested_at ?? null, data.requested_date ?? null, data.reason ?? '', nowIso()],
    });
    return { success: true };
}

async function correctionApprove(turso, companyId, session, { correctionId, reviewerNotes, reviewedBy }) {
    const corrRes = await turso.execute({
        sql: 'SELECT * FROM attendance_corrections WHERE id = ? AND company_id = ?',
        args: [correctionId, companyId],
    });
    const correction = corrRes.rows[0];
    if (!correction) return { success: false, error: 'Corrección no encontrada' };

    if (correction.correction_type === 'edit_time') {
        if (correction.original_record_id) {
            await turso.execute({
                sql: 'UPDATE attendance_records SET is_corrected = 1 WHERE id = ? AND company_id = ?',
                args: [correction.original_record_id, companyId],
            });
            const origRes = await turso.execute({
                sql: 'SELECT * FROM attendance_records WHERE id = ? AND company_id = ?',
                args: [correction.original_record_id, companyId],
            });
            const orig = origRes.rows[0];
            if (orig) {
                await turso.execute({
                    sql: `INSERT INTO attendance_records
                          (company_id, user_id, type, recorded_at, date, source, notes, is_corrected, recorded_by)
                          VALUES (?, ?, ?, ?, ?, 'manual', ?, 0, ?)`,
                    args: [companyId, correction.user_id, orig.type, correction.requested_at, orig.date,
                        `Corrección aprobada: ${correction.reason}`, reviewedBy],
                });
            }
        }
    } else if (correction.correction_type === 'add_entry' || correction.correction_type === 'add_exit') {
        const type = correction.correction_type === 'add_entry' ? 'entry' : 'exit';
        await turso.execute({
            sql: `INSERT INTO attendance_records
                  (company_id, user_id, type, recorded_at, date, source, notes, recorded_by)
                  VALUES (?, ?, ?, ?, ?, 'manual', ?, ?)`,
            args: [companyId, correction.user_id, type, correction.requested_at, correction.requested_date,
                `Corrección (Agregar): ${correction.reason}`, reviewedBy],
        });
    } else if (correction.correction_type === 'delete') {
        if (correction.original_record_id) {
            await turso.execute({
                sql: 'UPDATE attendance_records SET is_corrected = 1 WHERE id = ? AND company_id = ?',
                args: [correction.original_record_id, companyId],
            });
        }
    }

    await turso.execute({
        sql: `UPDATE attendance_corrections SET status = 'approved', reviewed_by = ?, reviewed_at = ?, reviewer_notes = ?
              WHERE id = ? AND company_id = ?`,
        args: [reviewedBy, nowIso(), reviewerNotes ?? null, correctionId, companyId],
    });
    return { success: true };
}

async function correctionReject(turso, companyId, session, { correctionId, reviewerNotes, reviewedBy }) {
    await turso.execute({
        sql: `UPDATE attendance_corrections SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, reviewer_notes = ?
              WHERE id = ? AND company_id = ?`,
        args: [reviewedBy, nowIso(), reviewerNotes ?? null, correctionId, companyId],
    });
    return { success: true };
}

// ── Turnos ───────────────────────────────────────────────────────

async function shiftsFetch(turso, companyId, session, { startDate, endDate, userId }) {
    let sql = `SELECT ws.*, u.username, u.name FROM work_shifts ws
               JOIN users u ON ws.user_id = u.id
               WHERE ws.company_id = ? AND ws.shift_date BETWEEN ? AND ?`;
    const args = [companyId, startDate, endDate];
    if (userId) { sql += ' AND ws.user_id = ?'; args.push(userId); }
    const r = await turso.execute({ sql, args });
    return { success: true, rows: r.rows };
}

async function shiftCreate(turso, companyId, session, { data }) {
    const shiftDate = data.shift_date || String(data.start_time).split('T')[0];
    await turso.execute({
        sql: `INSERT OR REPLACE INTO work_shifts
              (company_id, user_id, shift_date, start_time, end_time, branch, notes, created_by, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [companyId, data.user_id, shiftDate, data.start_time, data.end_time,
            data.branch || 'Principal', data.notes || '', session?.username || 'System', nowIso()],
    });
    return { success: true };
}

async function shiftDelete(turso, companyId, session, { id }) {
    await turso.execute({
        sql: 'DELETE FROM work_shifts WHERE id = ? AND company_id = ?',
        args: [id, companyId],
    });
    return { success: true };
}

async function shiftDeleteByDate(turso, companyId, session, { userId, shiftDate }) {
    await turso.execute({
        sql: 'DELETE FROM work_shifts WHERE user_id = ? AND shift_date = ? AND company_id = ?',
        args: [userId, shiftDate, companyId],
    });
    return { success: true };
}

// ── Ausencias ────────────────────────────────────────────────────

async function absencesFetch(turso, companyId, session, { startDate, endDate, userId }) {
    let sql = `SELECT la.*, la.absence_date as start_date, la.absence_date as end_date, u.username, u.name
               FROM labor_absences la JOIN users u ON la.user_id = u.id
               WHERE la.company_id = ? AND la.absence_date BETWEEN ? AND ?`;
    const args = [companyId, startDate, endDate];
    if (userId) { sql += ' AND la.user_id = ?'; args.push(userId); }
    sql += ' ORDER BY la.absence_date DESC';
    const r = await turso.execute({ sql, args });
    return { success: true, rows: r.rows };
}

async function absenceCreate(turso, companyId, session, { data }) {
    const startDate = data.start_date || data.absence_date || nowIso().split('T')[0];
    const endDate = data.end_date || startDate;
    const notes = data.notes || data.reason || '';
    const halfDay = data.half_day ? 1 : 0;
    const halfDayPeriod = data.half_day ? (data.half_day_period || 'morning') : null;
    const hours = data.hours || null;
    const groupId = `abs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const dates = [];
    let current = new Date(`${startDate}T12:00:00`);
    const end = new Date(`${endDate}T12:00:00`);
    while (current <= end) {
        dates.push(current.toISOString().split('T')[0]);
        current.setDate(current.getDate() + 1);
    }
    if (!dates.length) return { success: false, error: 'Rango de fechas inválido' };

    const existing = await turso.execute({
        sql: `SELECT absence_date FROM labor_absences WHERE company_id = ? AND user_id = ? AND absence_date IN (${dates.map(() => '?').join(',')})`,
        args: [companyId, data.user_id, ...dates],
    });
    if (existing.rows.length > 0) {
        return { success: false, error: `Ya existe ausencia en: ${existing.rows.map(r => r.absence_date).join(', ')}` };
    }

    if (!halfDay) {
        const att = await turso.execute({
            sql: `SELECT DISTINCT date FROM attendance_records
                  WHERE company_id = ? AND user_id = ? AND type = 'entry' AND date BETWEEN ? AND ?`,
            args: [companyId, data.user_id, startDate, endDate],
        });
        if (att.rows.length > 0) {
            return { success: false, error: `No se puede registrar ausencia completa en días con asistencia: ${att.rows.map(r => r.date).join(', ')}` };
        }
    }

    const queries = dates.map(d => ({
        sql: `INSERT INTO labor_absences
              (company_id, user_id, absence_date, type, status, notes, approved_by, created_at, half_day, half_day_period, hours, group_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [companyId, data.user_id, d, data.type, data.status || 'approved', notes,
            session?.username || 'System', nowIso(), halfDay, halfDayPeriod, hours, groupId],
    }));
    const CHUNK = 50;
    for (let i = 0; i < queries.length; i += CHUNK) {
        await turso.batch(queries.slice(i, i + CHUNK));
    }
    return { success: true, count: dates.length, groupId };
}

async function absenceDelete(turso, companyId, session, { id }) {
    await turso.execute({
        sql: 'DELETE FROM labor_absences WHERE id = ? AND company_id = ?',
        args: [id, companyId],
    });
    return { success: true };
}

async function absenceDeleteGroup(turso, companyId, session, { groupId }) {
    if (!groupId) return { success: false, error: 'No group_id' };
    await turso.execute({
        sql: 'DELETE FROM labor_absences WHERE group_id = ? AND company_id = ?',
        args: [groupId, companyId],
    });
    return { success: true };
}

// ── Configuración de Personal ────────────────────────────────────

async function configFetch(turso, companyId) {
    let r = await turso.execute({ sql: 'SELECT * FROM personal_config WHERE company_id = ?', args: [companyId] });
    if (r.rows.length === 0) {
        await turso.execute({
            sql: 'INSERT INTO personal_config (company_id, late_tolerance_minutes, created_at) VALUES (?, ?, ?)',
            args: [companyId, 10, nowIso()],
        });
        r = await turso.execute({ sql: 'SELECT * FROM personal_config WHERE company_id = ?', args: [companyId] });
    }
    return { success: true, config: r.rows[0] || null };
}

async function configUpdate(turso, companyId, session, { data }) {
    const { sets, args } = pickWhitelisted(data, CONFIG_FIELDS);
    if (!sets.length) return { success: true };
    sets.push('updated_at = ?');
    args.push(nowIso(), companyId);
    await turso.execute({ sql: `UPDATE personal_config SET ${sets.join(', ')} WHERE company_id = ?`, args });
    return { success: true };
}

// ── Adelantos ────────────────────────────────────────────────────

async function advancesFetch(turso, companyId, session, { userId, startDate, endDate }) {
    let sql = `SELECT sa.*, u.username, u.name FROM salary_advances sa
               JOIN users u ON sa.user_id = u.id WHERE sa.company_id = ?`;
    const args = [companyId];
    if (userId) { sql += ' AND sa.user_id = ?'; args.push(userId); }
    if (startDate && endDate) { sql += ' AND sa.advance_date BETWEEN ? AND ?'; args.push(startDate, endDate); }
    sql += ' ORDER BY sa.advance_date DESC';
    const r = await turso.execute({ sql, args });
    return { success: true, rows: r.rows };
}

async function advanceCreate(turso, companyId, session, { data }) {
    await turso.execute({
        sql: `INSERT INTO salary_advances
              (company_id, user_id, amount, advance_date, reason, pay_method, status, created_by, created_at)
              VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        args: [companyId, data.user_id, data.amount,
            data.advance_date || data.date || nowIso().split('T')[0],
            data.reason || data.notes || '', data.pay_method || 'transfer',
            session?.username || 'System', nowIso()],
    });
    return { success: true };
}

async function advanceMarkDiscounted(turso, companyId, session, { id, periodId }) {
    await turso.execute({
        sql: "UPDATE salary_advances SET status = 'discounted', period_id = ? WHERE id = ? AND company_id = ?",
        args: [periodId, id, companyId],
    });
    return { success: true };
}

async function advanceDelete(turso, companyId, session, { id }) {
    await turso.execute({
        sql: 'DELETE FROM salary_advances WHERE id = ? AND company_id = ?',
        args: [id, companyId],
    });
    return { success: true };
}

async function advancesPendingSum(turso, companyId, session, { userId, until }) {
    const r = await turso.execute({
        sql: `SELECT SUM(amount) as total FROM salary_advances
              WHERE company_id = ? AND user_id = ? AND status = 'pending' AND advance_date <= ?`,
        args: [companyId, userId, until],
    });
    return { success: true, total: r.rows[0]?.total || 0 };
}

// ── Liquidaciones ────────────────────────────────────────────────

async function payrollPeriodsFetch(turso, companyId, session, { userId }) {
    let sql = `SELECT pp.*, u.username, u.name FROM payroll_periods pp
               JOIN users u ON pp.user_id = u.id WHERE pp.company_id = ?`;
    const args = [companyId];
    if (userId) { sql += ' AND pp.user_id = ?'; args.push(userId); }
    sql += ' ORDER BY pp.period_end DESC, pp.created_at DESC';
    const r = await turso.execute({ sql, args });
    return { success: true, rows: r.rows };
}

async function payrollPeriodCreate(turso, companyId, session, { data, createdBy }) {
    const res = await turso.execute({
        sql: `INSERT INTO payroll_periods
              (company_id, user_id, period_label, period_start, period_end,
               hours_worked, days_absent, late_count, late_minutes, extra_hours,
               manual_bonus, manual_discount, advances_discounted, base_amount,
               total_to_pay, created_by, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        args: [companyId, data.user_id, data.period_label, data.period_start, data.period_end,
            data.hours_worked ?? 0, data.days_absent ?? 0, data.late_count ?? 0, data.late_minutes ?? 0,
            data.extra_hours ?? 0, data.manual_bonus ?? 0, data.manual_discount ?? 0,
            data.advances_discounted ?? 0, data.base_amount ?? 0, data.total_to_pay ?? 0,
            createdBy ?? session?.uid ?? null, nowIso()],
    });
    const newId = res.rows[0].id;
    if ((data.advances_discounted ?? 0) > 0) {
        await turso.execute({
            sql: `UPDATE salary_advances SET status = 'discounted', period_id = ?
                  WHERE company_id = ? AND user_id = ? AND status = 'pending' AND advance_date <= ?`,
            args: [newId, companyId, data.user_id, data.period_end],
        });
    }
    return { success: true, id: newId };
}

async function payrollPeriodClose(turso, companyId, session, { periodId }) {
    await turso.execute({
        sql: 'UPDATE payroll_periods SET is_closed = 1, closed_at = ? WHERE id = ? AND company_id = ?',
        args: [nowIso(), periodId, companyId],
    });
    return { success: true };
}

async function payrollPeriodUpdate(turso, companyId, session, { id, data }) {
    const cur = await turso.execute({
        sql: 'SELECT is_closed FROM payroll_periods WHERE id = ? AND company_id = ?',
        args: [id, companyId],
    });
    if (!cur.rows.length) return { success: false, error: 'Período no encontrado' };
    if (cur.rows[0].is_closed) return { success: false, error: 'Period is closed' };

    const { sets, args } = pickWhitelisted(data, PERIOD_FIELDS);
    if (!sets.length) return { success: true };
    await turso.execute({
        sql: `UPDATE payroll_periods SET ${sets.join(', ')} WHERE id = ? AND company_id = ?`,
        args: [...args, id, companyId],
    });
    return { success: true };
}

// ── Pagos de nómina ──────────────────────────────────────────────

async function payrollPaymentsFetch(turso, companyId, session, { userId, startDate, endDate }) {
    let sql = `SELECT pp.*, u.username, u.name, per.period_label
               FROM payroll_payments pp
               JOIN users u ON pp.user_id = u.id
               LEFT JOIN payroll_periods per ON pp.period_id = per.id
               WHERE pp.company_id = ?`;
    const args = [companyId];
    if (userId) { sql += ' AND pp.user_id = ?'; args.push(userId); }
    if (startDate && endDate) { sql += ' AND pp.payment_date BETWEEN ? AND ?'; args.push(startDate, endDate); }
    sql += ' ORDER BY pp.payment_date DESC';
    const r = await turso.execute({ sql, args });
    return { success: true, rows: r.rows };
}

async function payrollPaymentCreate(turso, companyId, session, { data, createdBy }) {
    await turso.execute({
        sql: `INSERT INTO payroll_payments
              (company_id, user_id, period_id, amount_paid, payment_date, pay_method, status, notes, created_by, created_at)
              VALUES (?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?)`,
        args: [companyId, data.user_id, data.period_id ?? null, data.amount_paid, data.payment_date,
            data.pay_method ?? null, data.notes ?? null, createdBy ?? session?.uid ?? null, nowIso()],
    });
    return { success: true };
}

async function paymentsPending(turso, companyId) {
    const r = await turso.execute({
        sql: `SELECT u.id, u.name,
                (SELECT COALESCE(SUM(total_to_pay),0) FROM payroll_periods WHERE user_id = u.id AND company_id = ? AND is_closed = 1) as total_owed,
                (SELECT COALESCE(SUM(amount_paid),0) FROM payroll_payments WHERE user_id = u.id AND company_id = ?) as total_paid
              FROM users u
              WHERE u.company_id = ? AND u.has_labor_profile = 1`,
        args: [companyId, companyId, companyId],
    });
    return { success: true, rows: r.rows };
}

// ── Vacaciones ───────────────────────────────────────────────────

async function vacationRequestsFetch(turso, companyId, session, { status }) {
    let sql = `SELECT vr.*, u.username, u.name FROM vacation_requests vr
               JOIN users u ON vr.user_id = u.id WHERE vr.company_id = ?`;
    const args = [companyId];
    if (status) { sql += ' AND vr.status = ?'; args.push(status); }
    sql += ' ORDER BY vr.start_date DESC';
    const r = await turso.execute({ sql, args });
    return { success: true, rows: r.rows };
}

async function vacationBalancesFetch(turso, companyId) {
    const r = await turso.execute({
        sql: `SELECT vb.*, u.username, u.name FROM vacation_balances vb
              JOIN users u ON vb.user_id = u.id WHERE vb.company_id = ?`,
        args: [companyId],
    });
    return { success: true, rows: r.rows };
}

async function vacationRequestCreate(turso, companyId, session, { data }) {
    await turso.execute({
        sql: `INSERT INTO vacation_requests
              (company_id, user_id, start_date, end_date, total_days, notes, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [companyId, data.user_id, data.start_date, data.end_date, data.total_days, data.notes ?? null, nowIso()],
    });
    return { success: true };
}

async function vacationApprove(turso, companyId, session, { requestId, reviewedBy }) {
    const reqRes = await turso.execute({
        sql: 'SELECT * FROM vacation_requests WHERE id = ? AND company_id = ?',
        args: [requestId, companyId],
    });
    const request = reqRes.rows[0];
    if (!request) return { success: false, error: 'Solicitud no encontrada' };

    await turso.execute({
        sql: "UPDATE vacation_requests SET status = 'approved', reviewed_by = ?, reviewed_at = ? WHERE id = ? AND company_id = ?",
        args: [reviewedBy, nowIso(), requestId, companyId],
    });

    // Crear una ausencia 'vacation' por cada día (misma lógica que antes:
    // los días que fallen por duplicado se ignoran, no cortan la aprobación)
    const start = new Date(request.start_date);
    const end = new Date(request.end_date);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        await absenceCreate(turso, companyId, session, {
            data: {
                user_id: request.user_id,
                absence_date: d.toISOString().split('T')[0],
                type: 'vacation',
                notes: `Vacaciones aprobadas (Req #${requestId})`,
            },
        }).catch(() => {});
    }

    const bal = await turso.execute({
        sql: 'SELECT * FROM vacation_balances WHERE user_id = ? AND company_id = ?',
        args: [request.user_id, companyId],
    });
    if (bal.rows.length === 0) {
        await turso.execute({
            sql: 'INSERT INTO vacation_balances (company_id, user_id, used_days) VALUES (?, ?, ?)',
            args: [companyId, request.user_id, request.total_days],
        });
    } else {
        await turso.execute({
            sql: 'UPDATE vacation_balances SET used_days = used_days + ? WHERE user_id = ? AND company_id = ?',
            args: [request.total_days, request.user_id, companyId],
        });
    }
    return { success: true };
}

async function vacationReject(turso, companyId, session, { requestId, reviewedBy }) {
    await turso.execute({
        sql: "UPDATE vacation_requests SET status = 'rejected', reviewed_by = ?, reviewed_at = ? WHERE id = ? AND company_id = ?",
        args: [reviewedBy, nowIso(), requestId, companyId],
    });
    return { success: true };
}

async function vacationBalanceUpdate(turso, companyId, session, { userId, data }) {
    const check = await turso.execute({
        sql: 'SELECT id FROM vacation_balances WHERE user_id = ? AND company_id = ?',
        args: [userId, companyId],
    });
    if (check.rows.length === 0) {
        await turso.execute({
            sql: 'INSERT INTO vacation_balances (company_id, user_id, initial_balance, accrued_days, used_days) VALUES (?, ?, ?, ?, ?)',
            args: [companyId, userId, data.initial_balance || 0, data.accrued_days || 0, data.used_days || 0],
        });
    } else {
        const { sets, args } = pickWhitelisted(data, BALANCE_FIELDS);
        if (sets.length) {
            await turso.execute({
                sql: `UPDATE vacation_balances SET ${sets.join(', ')} WHERE user_id = ? AND company_id = ?`,
                args: [...args, userId, companyId],
            });
        }
    }
    return { success: true };
}

// Despacho: claves = sufijo de la acción 'personal.<clave>'
export const personalActions = {
    staffList,
    laborProfileUpdate,
    laborProfileToggle,
    laborProfileByPin,
    staffUser,
    attendanceToday,
    attendanceRange,
    attendanceMark,
    attendanceManual,
    attendanceStatus,
    correctionsPending,
    correctionsByStatus,
    correctionRequest,
    correctionApprove,
    correctionReject,
    shiftsFetch,
    shiftCreate,
    shiftDelete,
    shiftDeleteByDate,
    absencesFetch,
    absenceCreate,
    absenceDelete,
    absenceDeleteGroup,
    configFetch,
    configUpdate,
    advancesFetch,
    advanceCreate,
    advanceMarkDiscounted,
    advanceDelete,
    advancesPendingSum,
    payrollPeriodsFetch,
    payrollPeriodCreate,
    payrollPeriodClose,
    payrollPeriodUpdate,
    payrollPaymentsFetch,
    payrollPaymentCreate,
    paymentsPending,
    vacationRequestsFetch,
    vacationBalancesFetch,
    vacationRequestCreate,
    vacationApprove,
    vacationReject,
    vacationBalanceUpdate,
};
