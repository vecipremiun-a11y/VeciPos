import { createClient } from '@libsql/client';
import bcrypt from 'bcryptjs';
import { getSession } from '../_lib/auth.js';
import { seedRolePermissions } from '../_lib/permissions.js';

// Endpoint admin autenticado (Fase 1 · Paso 2).
// Las mutaciones sensibles (aprobar pagos, cambiar estado/plan/acceso de empresas)
// se ejecutan AQUÍ, en el servidor, exigiendo una sesión FIRMADA de super_admin.
// Ya no se pueden disparar desde la consola del navegador ni falsificando el rol.

let _turso = null;
function getTurso() {
    if (_turso) return _turso;
    const url = process.env.VITE_TURSO_DATABASE_URL;
    const authToken = process.env.VITE_TURSO_AUTH_TOKEN;
    if (!url || !authToken) throw new Error('Faltan variables Turso');
    _turso = createClient({ url, authToken });
    return _turso;
}

const VALID_STATUS = ['trial', 'active', 'past_due', 'blocked', 'suspended', 'cancelled', 'pending_payment'];
const VALID_PLAN = ['standard', 'professional'];
// Normaliza planes legacy (pre-migración) a los 2 planes actuales.
const normalizePlan = (p) => {
    const k = (p || '').toString().trim().toLowerCase();
    if (k === 'standard' || k === 'basico' || k === 'basic') return 'standard';
    if (k === 'professional' || k === 'medium' || k === 'medio' || k === 'pro') return 'professional';
    return null;
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    // 🔒 Autorización server-side: la sesión firmada debe ser super_admin.
    const session = getSession(req);
    if (!session || session.role !== 'super_admin') {
        return res.status(403).json({ success: false, error: 'Requiere sesión de super administrador.' });
    }

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        const { action } = body;
        const turso = getTurso();

        switch (action) {
            case 'approvePayment':
                return res.status(200).json(await approvePayment(turso, body.paymentId));
            case 'rejectPayment':
                return res.status(200).json(await rejectPayment(turso, body.paymentId));
            case 'setCompanyStatus':
                return res.status(200).json(await setCompanyStatus(turso, body.companyId, body.status));
            case 'setCompanyAccess':
                return res.status(200).json(await setCompanyAccess(turso, body.companyId, body.status, body.accessUntil));
            case 'setCompanyPlan':
                return res.status(200).json(await setCompanyPlan(turso, body.companyId, body.plan));
            case 'createCompany':
                return res.status(200).json(await createCompany(turso, body.companyData, session));
            case 'createManualSubscription':
                return res.status(200).json(await createManualSubscription(turso, body.companyId, body.planId, body.amount));
            case 'deleteCompany':
                return res.status(200).json(await deleteCompany(turso, body.companyId));
            case 'resetUserPassword':
                return res.status(200).json(await resetUserPassword(turso, body.userId, body.newPassword, session));
            // Lecturas del panel admin (también exigen super_admin)
            case 'listSubscriptions':
                return res.status(200).json({ success: true, data: await listSubscriptions(turso) });
            case 'listPayments':
                return res.status(200).json({ success: true, data: await listPayments(turso) });
            case 'getPaymentReceipt':
                return res.status(200).json({ success: true, data: await getPaymentReceipt(turso, body.paymentId) });
            case 'listClients':
                return res.status(200).json({ success: true, data: await listClients(turso) });
            case 'listOwners':
                return res.status(200).json({ success: true, data: await listOwners(turso) });
            case 'adminStats':
                return res.status(200).json({ success: true, data: await adminStats(turso) });
            case 'listAllCompanies':
                return res.status(200).json({ success: true, data: await listAllCompanies(turso) });
            // Soporte (admin, super_admin — Fase 1 · Paso 28)
            case 'supportListAll':
                return res.status(200).json(await supportListAll(turso, body.filters));
            case 'supportReply':
                return res.status(200).json(await supportReply(turso, session, body.ticketId, body.message));
            case 'supportSetStatus':
                return res.status(200).json(await supportSetStatus(turso, body.ticketId, body.status));
            case 'supportSetPriority':
                return res.status(200).json(await supportSetPriority(turso, body.ticketId, body.priority));
            case 'supportAssign':
                return res.status(200).json(await supportAssign(turso, body.ticketId, body.adminId));
            case 'supportMarkReadByAdmin':
                return res.status(200).json(await supportMarkReadByAdmin(turso, body.ticketId));
            case 'supportCompanyContext':
                return res.status(200).json(await supportCompanyContext(turso, body.companyId));
            case 'savePaymentSettings':
                return res.status(200).json(await savePaymentSettingsAdmin(turso, body.config));
            default:
                return res.status(400).json({ success: false, error: 'Acción no válida' });
        }
    } catch (e) {
        console.error('❌ /api/admin/actions error:', e);
        return res.status(500).json({ success: false, error: e.message });
    }
}

async function approvePayment(turso, paymentId) {
    if (!paymentId) return { success: false, error: 'Falta paymentId' };
    const res = await turso.execute({ sql: 'SELECT * FROM payments WHERE id = ?', args: [paymentId] });
    if (res.rows.length === 0) return { success: false, error: 'Pago no encontrado' };
    const p = res.rows[0];

    const billingCycle = p.billing_cycle === 'annual' ? 'annual' : 'monthly';
    const planId = p.plan_id || 'professional';
    // Plan efectivo de la empresa (una sucursal adicional es Profesional).
    const companyPlan = normalizePlan(planId) || 'professional';
    const now = new Date();
    const periodEnd = new Date(now);
    if (billingCycle === 'annual') periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    else periodEnd.setMonth(periodEnd.getMonth() + 1);

    const subId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await turso.execute({
        sql: `INSERT INTO subscriptions (id, company_id, plan_id, status, amount, currency, current_period_start, current_period_end, created_at, updated_at)
              VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
        args: [
            subId, p.company_id, planId, p.amount, p.currency || 'CLP',
            now.toISOString().split('T')[0],
            periodEnd.toISOString().split('T')[0],
            now.toISOString(), now.toISOString(),
        ],
    });
    await turso.execute({
        sql: "UPDATE companies SET status = 'active', plan = ?, subscription_id = ?, access_until = ? WHERE id = ?",
        args: [companyPlan, subId, periodEnd.toISOString(), p.company_id],
    });
    await turso.execute({
        sql: "UPDATE payments SET status = 'approved', subscription_id = ?, updated_at = ? WHERE id = ?",
        args: [subId, now.toISOString(), paymentId],
    });
    return { success: true };
}

async function rejectPayment(turso, paymentId) {
    if (!paymentId) return { success: false, error: 'Falta paymentId' };
    await turso.execute({
        sql: "UPDATE payments SET status = 'rejected', updated_at = ? WHERE id = ?",
        args: [new Date().toISOString(), paymentId],
    });
    return { success: true };
}

async function setCompanyStatus(turso, companyId, status) {
    if (!companyId || !VALID_STATUS.includes(status)) return { success: false, error: 'Datos inválidos' };
    await turso.execute({ sql: 'UPDATE companies SET status = ? WHERE id = ?', args: [status, companyId] });
    return { success: true };
}

async function setCompanyAccess(turso, companyId, status, accessUntil) {
    if (!companyId) return { success: false, error: 'Falta companyId' };
    const sets = [];
    const args = [];
    if (status !== undefined) {
        if (!VALID_STATUS.includes(status)) return { success: false, error: 'Estado inválido' };
        sets.push('status = ?'); args.push(status);
    }
    if (accessUntil !== undefined) { sets.push('access_until = ?'); args.push(accessUntil); }
    if (sets.length === 0) return { success: true };
    args.push(companyId);
    await turso.execute({ sql: `UPDATE companies SET ${sets.join(', ')} WHERE id = ?`, args });
    return { success: true };
}

async function setCompanyPlan(turso, companyId, plan) {
    const norm = normalizePlan(plan);
    if (!companyId || !norm) return { success: false, error: 'Datos inválidos' };
    await turso.execute({ sql: 'UPDATE companies SET plan = ? WHERE id = ?', args: [norm, companyId] });
    return { success: true };
}

async function createCompany(turso, companyData, session) {
    const { id, name, country, plan, newUser, parentId, ownerUserId, status } = companyData || {};
    if (!id || !name) return { success: false, error: 'Faltan id o nombre' };

    // El enlace se deduce del dueño: si se asigna a un cliente existente, se cuelga de su raíz.
    let resolvedParentId = parentId || null;
    if (ownerUserId) {
        const owned = (await turso.execute({
            sql: `SELECT c.id, c.parent_company_id FROM user_companies uc
                  JOIN companies c ON uc.company_id = c.id
                  WHERE uc.user_id = ? AND uc.role = 'owner' ORDER BY c.created_at ASC`,
            args: [ownerUserId],
        })).rows;
        if (owned.length) {
            const root = owned.find(c => !c.parent_company_id) || owned[0];
            resolvedParentId = root.parent_company_id || root.id;
        }
    }

    let timezone = 'America/Santiago', currency = 'CLP', countryCode = country || 'CL';
    if (resolvedParentId) {
        const p = (await turso.execute({ sql: 'SELECT timezone, currency, country_code FROM companies WHERE id = ?', args: [resolvedParentId] })).rows[0];
        if (p) { timezone = p.timezone || timezone; currency = p.currency || currency; countryCode = p.country_code || countryCode; }
    }

    const stt = VALID_STATUS.includes(status) ? status : 'active';
    const nowIso = new Date().toISOString();
    let trialEnds = null, accessUntil = null;
    if (stt === 'trial') { const d = new Date(); d.setDate(d.getDate() + 30); trialEnds = d.toISOString(); accessUntil = d.toISOString(); }
    else if (stt === 'active') { const d = new Date(); d.setMonth(d.getMonth() + 1); accessUntil = d.toISOString(); }

    await turso.execute({
        sql: `INSERT INTO companies (id, name, status, created_at, timezone, currency, country_code, plan, parent_company_id, trial_ends_at, access_until)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [id, name, stt, nowIso, timezone, currency, countryCode, normalizePlan(plan) || 'standard', resolvedParentId, trialEnds, accessUntil],
    });

    // Asignar dueño: usuario existente, usuario nuevo, o (fallback) el super admin de la sesión.
    let ownerLinked = false;
    if (ownerUserId) {
        await turso.execute({ sql: "INSERT INTO user_companies (user_id, company_id, role) VALUES (?, ?, 'owner')", args: [ownerUserId, id] });
        ownerLinked = true;
    }
    if (newUser && newUser.username && newUser.password) {
        const exists = await turso.execute({ sql: 'SELECT id FROM users WHERE username = ?', args: [newUser.username] });
        if (exists.rows.length === 0) {
            const hashedPw = await bcrypt.hash(String(newUser.password), 10);
            const ins = await turso.execute({
                sql: "INSERT INTO users (username, password, name, role, company_id) VALUES (?, ?, ?, 'Administrador', ?) RETURNING id",
                args: [newUser.username, hashedPw, newUser.name || newUser.username, id],
            });
            const uid = ins.rows[0]?.id;
            if (uid) {
                await turso.execute({ sql: "INSERT INTO user_companies (user_id, company_id, role) VALUES (?, ?, 'owner')", args: [uid, id] });
                ownerLinked = true;
            }
        }
    }
    if (!ownerLinked && session?.uid) {
        await turso.execute({ sql: "INSERT INTO user_companies (user_id, company_id, role) VALUES (?, ?, 'owner')", args: [session.uid, id] });
    }

    await turso.execute({
        sql: 'INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        args: ['system', session?.uid ?? null, 'CREATE', 'COMPANY', JSON.stringify({ id, name, plan }), nowIso],
    });

    try { await seedRolePermissions(turso, id); } catch (e) { console.warn('seed permisos:', e.message); }

    return { success: true };
}

// Restablece la contraseña de un usuario (recuperación de cuenta de cliente).
// Si no llega newPassword, genera una temporal legible y la devuelve para que
// el admin se la envíe al cliente. Nunca permite tocar a otro super_admin.
async function resetUserPassword(turso, userId, newPassword, session) {
    if (!userId) return { success: false, error: 'Falta userId' };

    const r = await turso.execute({ sql: 'SELECT id, username, role FROM users WHERE id = ?', args: [userId] });
    if (r.rows.length === 0) return { success: false, error: 'Usuario no encontrado' };
    const target = r.rows[0];
    if (target.role === 'super_admin' && String(target.id) !== String(session?.uid)) {
        return { success: false, error: 'No se puede restablecer la contraseña de otro super admin' };
    }

    let tempPassword = null;
    if (newPassword !== undefined && newPassword !== null && newPassword !== '') {
        if (String(newPassword).length < 6) return { success: false, error: 'La contraseña debe tener al menos 6 caracteres' };
    } else {
        // Temporal legible: sin caracteres ambiguos (0/O, 1/l/I)
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let rand = '';
        for (let i = 0; i < 8; i++) rand += chars[Math.floor(Math.random() * chars.length)];
        tempPassword = `Veci-${rand}`;
        newPassword = tempPassword;
    }

    const hashed = await bcrypt.hash(String(newPassword), 10);
    await turso.execute({ sql: 'UPDATE users SET password = ? WHERE id = ?', args: [hashed, userId] });

    await turso.execute({
        sql: 'INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        args: ['system', session?.uid ?? null, 'RESET_PASSWORD', 'USER', JSON.stringify({ targetUserId: userId, username: target.username }), new Date().toISOString()],
    });

    return { success: true, tempPassword, username: target.username };
}

// Activa/crea manualmente una suscripción para una empresa (acción admin).
async function createManualSubscription(turso, companyId, planId = 'monthly', amount = 30000) {
    if (!companyId) return { success: false, error: 'Falta companyId' };
    const now = new Date();
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);

    const existing = await turso.execute({ sql: 'SELECT id FROM subscriptions WHERE company_id = ? LIMIT 1', args: [companyId] });
    if (existing.rows.length > 0) {
        await turso.execute({
            sql: `UPDATE subscriptions SET plan_id = ?, status = 'active', amount = ?,
                    current_period_start = ?, current_period_end = ?, updated_at = ? WHERE id = ?`,
            args: [planId, amount, now.toISOString(), nextMonth.toISOString(), now.toISOString(), existing.rows[0].id],
        });
    } else {
        const subId = `sub_manual_${Date.now()}`;
        await turso.execute({
            sql: `INSERT INTO subscriptions (id, company_id, plan_id, status, amount, currency, current_period_start, current_period_end, created_at, updated_at)
                  VALUES (?, ?, ?, 'active', ?, 'CLP', ?, ?, ?, ?)`,
            args: [subId, companyId, planId, amount, now.toISOString(), nextMonth.toISOString(), now.toISOString(), now.toISOString()],
        });
    }
    return { success: true };
}

async function deleteCompany(turso, companyId) {
    if (!companyId) return { success: false, error: 'Falta companyId' };
    await turso.batch([
        { sql: 'DELETE FROM supplier_orders WHERE company_id = ?', args: [companyId] },
        { sql: 'DELETE FROM payments WHERE company_id = ?', args: [companyId] },
        { sql: 'DELETE FROM audit_logs WHERE company_id = ?', args: [companyId] },
        { sql: 'DELETE FROM payment_terminals WHERE company_id = ?', args: [companyId] },
        { sql: 'DELETE FROM bank_accounts WHERE company_id = ?', args: [companyId] },
        { sql: 'DELETE FROM payment_methods_config WHERE company_id = ?', args: [companyId] },
        { sql: 'DELETE FROM subscriptions WHERE company_id = ?', args: [companyId] },
        { sql: 'DELETE FROM user_companies WHERE company_id = ?', args: [companyId] },
        { sql: 'DELETE FROM users WHERE company_id = ?', args: [companyId] },
        { sql: 'DELETE FROM companies WHERE id = ?', args: [companyId] },
    ]);
    return { success: true };
}

async function listSubscriptions(turso) {
    const r = await turso.execute(`
        SELECT c.id as company_id, c.name as company_name, c.status as company_status,
               c.plan as company_plan, c.trial_ends_at, c.access_until, c.parent_company_id,
               s.id as subscription_id, s.plan_id, s.status as subscription_status,
               s.amount, s.currency, s.current_period_start, s.current_period_end
        FROM companies c
        LEFT JOIN subscriptions s ON c.id = s.company_id
        ORDER BY c.created_at DESC`);
    return r.rows;
}

async function listPayments(turso) {
    const r = await turso.execute(`
        SELECT p.id, p.company_id, p.subscription_id, p.amount, p.currency, p.status,
               p.mercadopago_payment_id, p.mercadopago_preference_id, p.payment_method,
               p.payer_email, p.description, p.plan_id, p.billing_cycle, p.created_at, p.updated_at,
               CASE WHEN p.receipt_url IS NOT NULL AND p.receipt_url != '' THEN 1 ELSE 0 END AS has_receipt,
               c.name as company_name
        FROM payments p LEFT JOIN companies c ON p.company_id = c.id
        ORDER BY p.created_at DESC`);
    return r.rows;
}

async function getPaymentReceipt(turso, paymentId) {
    if (!paymentId) return null;
    const r = await turso.execute({ sql: 'SELECT receipt_url FROM payments WHERE id = ?', args: [paymentId] });
    return r.rows[0]?.receipt_url || null;
}

async function listClients(turso) {
    const r = await turso.execute(`
        SELECT u.id AS user_id, u.username, u.name AS user_name, u.role AS user_role,
               c.id AS company_id, c.name AS company_name, c.plan, c.status,
               c.access_until, c.trial_ends_at, c.email_main, c.country_code,
               c.parent_company_id, c.created_at AS company_created,
               (SELECT COUNT(*) FROM user_companies x WHERE x.company_id = c.id) AS members
        FROM users u
        JOIN user_companies uc ON uc.user_id = u.id AND uc.role = 'owner'
        JOIN companies c ON c.id = uc.company_id
        ORDER BY u.username ASC, c.created_at ASC`);
    const map = new Map();
    for (const row of r.rows) {
        if (!map.has(row.user_id)) {
            map.set(row.user_id, { userId: row.user_id, username: row.username, name: row.user_name, role: row.user_role, email: null, companies: [] });
        }
        const client = map.get(row.user_id);
        client.companies.push({
            id: row.company_id, name: row.company_name, plan: row.plan, status: row.status,
            access_until: row.access_until, trial_ends_at: row.trial_ends_at, email_main: row.email_main,
            country_code: row.country_code, parent_company_id: row.parent_company_id,
            created_at: row.company_created, members: Number(row.members) || 0,
        });
        if (!client.email && row.email_main) client.email = row.email_main;
    }
    return Array.from(map.values());
}

// Métricas globales del panel admin (conteo de empresas por estado).
async function adminStats(turso) {
    const [totalRes, activeRes, suspendedRes] = await turso.batch([
        { sql: 'SELECT COUNT(*) as count FROM companies', args: [] },
        { sql: "SELECT COUNT(*) as count FROM companies WHERE status = 'active'", args: [] },
        { sql: "SELECT COUNT(*) as count FROM companies WHERE status = 'suspended'", args: [] },
    ], 'read');
    return {
        totalCompanies: totalRes.rows[0].count,
        activeCompanies: activeRes.rows[0].count,
        suspendedCompanies: suspendedRes.rows[0].count,
    };
}

async function listAllCompanies(turso) {
    const r = await turso.execute('SELECT * FROM companies ORDER BY created_at DESC');
    return r.rows;
}

async function listOwners(turso) {
    const r = await turso.execute(`
        SELECT DISTINCT u.id, u.username, u.name, u.role
        FROM users u JOIN user_companies uc ON uc.user_id = u.id AND uc.role = 'owner'
        ORDER BY u.username ASC`);
    return r.rows;
}

// ── Soporte (admin) ──────────────────────────────────────────────
// Operan sobre TODAS las empresas → sólo super_admin (ya validado arriba).

const supRid = (p) => `${p}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

async function supportListAll(turso, filters = {}) {
    let sql = `SELECT t.*, u.name as user_name, c.name as company_name,
                 (SELECT COUNT(*) FROM support_messages WHERE ticket_id = t.id AND sender_type = 'client' AND read_by_admin = 0) as unread_count
               FROM support_tickets t
               LEFT JOIN users u ON t.user_id = u.id
               LEFT JOIN companies c ON t.company_id = c.id
               WHERE 1=1`;
    const args = [];
    if (filters.status) { sql += ' AND t.status = ?'; args.push(filters.status); }
    if (filters.assigned_to) { sql += ' AND t.assigned_to = ?'; args.push(filters.assigned_to); }
    if (filters.priority) { sql += ' AND t.priority = ?'; args.push(filters.priority); }
    if (filters.search) { sql += ' AND (t.subject LIKE ? OR c.name LIKE ?)'; const s = `%${filters.search}%`; args.push(s, s); }
    sql += ' ORDER BY t.updated_at DESC LIMIT 100';
    const r = await turso.execute({ sql, args });
    return { success: true, tickets: r.rows || [] };
}

async function supportReply(turso, session, ticketId, message) {
    if (!ticketId) return { success: false, error: 'Falta ticketId' };
    const messageId = supRid('msg');
    const now = new Date().toISOString();
    await turso.execute({
        sql: `INSERT INTO support_messages (id, ticket_id, sender_type, sender_id, sender_name, message, created_at, read_by_client)
              VALUES (?, ?, 'admin', ?, ?, ?, ?, 0)`,
        args: [messageId, ticketId, String(session?.uid ?? ''), session?.username || 'Admin', message, now],
    });
    await turso.execute({
        sql: 'UPDATE support_tickets SET updated_at = ?, last_message_at = ?, unread_by_client = unread_by_client + 1, unread_by_admin = 0 WHERE id = ?',
        args: [now, now, ticketId],
    });
    return { success: true, messageId };
}

async function supportSetStatus(turso, ticketId, status) {
    if (!ticketId) return { success: false, error: 'Falta ticketId' };
    const now = new Date().toISOString();
    await turso.execute({
        sql: 'UPDATE support_tickets SET status = ?, updated_at = ?, resolved_at = ? WHERE id = ?',
        args: [status, now, status === 'resolved' ? now : null, ticketId],
    });
    return { success: true };
}

async function supportSetPriority(turso, ticketId, priority) {
    if (!ticketId) return { success: false, error: 'Falta ticketId' };
    await turso.execute({
        sql: 'UPDATE support_tickets SET priority = ?, updated_at = ? WHERE id = ?',
        args: [priority, new Date().toISOString(), ticketId],
    });
    return { success: true };
}

async function supportAssign(turso, ticketId, adminId) {
    if (!ticketId) return { success: false, error: 'Falta ticketId' };
    await turso.execute({
        sql: 'UPDATE support_tickets SET assigned_to = ?, updated_at = ? WHERE id = ?',
        args: [adminId, new Date().toISOString(), ticketId],
    });
    return { success: true };
}

async function supportMarkReadByAdmin(turso, ticketId) {
    if (!ticketId) return { success: false, error: 'Falta ticketId' };
    await turso.batch([
        { sql: "UPDATE support_messages SET read_by_admin = 1 WHERE ticket_id = ? AND sender_type = 'client' AND read_by_admin = 0", args: [ticketId] },
        { sql: 'UPDATE support_tickets SET unread_by_admin = 0 WHERE id = ?', args: [ticketId] },
    ]);
    return { success: true };
}

async function supportCompanyContext(turso, companyId) {
    if (!companyId) return { success: false, error: 'Falta companyId' };
    const r = await turso.execute({
        sql: `SELECT c.*,
                (SELECT COUNT(*) FROM users WHERE company_id = c.id) as user_count,
                (SELECT MAX(date) FROM sales WHERE company_id = c.id) as last_sale_date
              FROM companies c WHERE c.id = ?`,
        args: [companyId],
    });
    return { success: true, company: r.rows[0] || null };
}

// Config global de medios de pago de suscripción — ESCRITURA (super_admin)
async function savePaymentSettingsAdmin(turso, config) {
    await turso.execute({
        sql: "INSERT OR REPLACE INTO system_settings (key, value) VALUES ('subscription_payment_config', ?)",
        args: [JSON.stringify(config)],
    });
    return { success: true };
}
