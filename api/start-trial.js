import { createClient } from '@libsql/client';
import { hashPassword } from './_lib/auth.js';

// Turso lazy: las env se leen en tiempo de request (server.js carga dotenv
// DESPUÉS de los imports, así que crear el cliente a nivel de módulo rompería).
let _turso = null;
function getTurso() {
    if (_turso) return _turso;
    const url = process.env.VITE_TURSO_DATABASE_URL;
    const authToken = process.env.VITE_TURSO_AUTH_TOKEN;
    if (!url || !authToken) {
        throw new Error('Faltan variables Turso: VITE_TURSO_DATABASE_URL o VITE_TURSO_AUTH_TOKEN');
    }
    _turso = createClient({ url, authToken });
    return _turso;
}

// Días de prueba gratuita (sin pago)
const TRIAL_DAYS = 30;

// Permisos por defecto por rol (idéntico a createCompany en useStore.js)
const DEFAULT_PERMS = {
    'Caja': [
        'dashboard.view', 'dashboard.view_sales',
        'pos.access', 'pos.sell', 'pos.discount', 'pos.open_register', 'pos.close_register', 'pos.cash_in', 'pos.cash_out', 'pos.suspend_sale', 'pos.recover_sale', 'pos.preventa',
        'sales.view', 'sales.view_details',
        'clients.view', 'clients.create', 'clients.view_account',
        'preorders.view', 'preorders.create', 'preorders.edit', 'preorders.complete',
        'personal.view', 'personal.attendance', 'personal.corrections',
        'alerts.view'
    ],
    'Vendedor': [
        'dashboard.view',
        'pos.access', 'pos.preventa',
        'clients.view', 'clients.create',
        'personal.view', 'personal.attendance',
        'alerts.view'
    ],
    'Bodeguero': [
        'dashboard.view',
        'products.view', 'products.create', 'products.edit', 'products.adjust_stock', 'products.import', 'products.export',
        'categories.view', 'categories.create', 'categories.edit',
        'suppliers.view', 'suppliers.create', 'suppliers.edit',
        'invoices.view', 'invoices.create',
        'purchases.view', 'purchases.create', 'purchases.edit',
        'product_profile.view',
        'supplier_orders.view', 'supplier_orders.create', 'supplier_orders.edit', 'supplier_orders.receive',
        'reports.expiring',
        'combos.view', 'combos.create', 'combos.edit', 'combos.delete',
        'inventory_control.view', 'inventory_control.create', 'inventory_control.manage',
        'alerts.view', 'alerts.manage'
    ],
    'Supervisor': [
        'dashboard.view', 'dashboard.view_sales', 'dashboard.view_profits',
        'sales.view', 'sales.view_details', 'sales.export',
        'clients.view', 'clients.view_account',
        'reports.sales', 'reports.expiring', 'reports.closures', 'reports.movements', 'reports.invoice_payments', 'reports.profit', 'reports.sales_analytics', 'reports.export',
        'products.view', 'products.view_cost',
        'taxes.view',
        'personal.view', 'personal.attendance', 'personal.corrections', 'personal.shifts', 'personal.absences', 'personal.reports',
        'combos.view',
        'inventory_control.view',
        'alerts.view',
        'sii.view', 'sii.folios'
    ]
};

const ALL_PERMS = [
    'dashboard.view', 'dashboard.view_sales', 'dashboard.view_profits',
    'pos.access', 'pos.sell', 'pos.discount', 'pos.open_register', 'pos.close_register', 'pos.cash_in', 'pos.cash_out', 'pos.suspend_sale', 'pos.recover_sale', 'pos.preventa',
    'sales.view', 'sales.cancel', 'sales.export', 'sales.view_details',
    'products.view', 'products.create', 'products.edit', 'products.delete', 'products.adjust_stock', 'products.import', 'products.export', 'products.view_cost',
    'categories.view', 'categories.create', 'categories.edit', 'categories.delete',
    'suppliers.view', 'suppliers.create', 'suppliers.edit', 'suppliers.delete',
    'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.delete', 'invoices.pay',
    'purchases.view', 'purchases.create', 'purchases.edit', 'purchases.delete',
    'product_profile.view',
    'clients.view', 'clients.create', 'clients.edit', 'clients.delete', 'clients.view_account', 'clients.manage_payments',
    'preorders.view', 'preorders.create', 'preorders.edit', 'preorders.delete', 'preorders.complete',
    'production.view', 'production.manage',
    'supplier_orders.view', 'supplier_orders.create', 'supplier_orders.edit', 'supplier_orders.receive', 'supplier_orders.delete',
    'reports.sales', 'reports.expiring', 'reports.closures', 'reports.movements', 'reports.invoice_payments', 'reports.profit', 'reports.sales_analytics', 'reports.export',
    'users.view', 'users.create', 'users.edit', 'users.delete', 'users.manage',
    'settings.view', 'settings.company', 'settings.receipts', 'settings.payments', 'settings.system', 'settings.manage_permissions',
    'taxes.view', 'taxes.create', 'taxes.edit', 'taxes.delete',
    'personal.view', 'personal.manage', 'personal.attendance', 'personal.corrections', 'personal.shifts', 'personal.edit_past_shifts', 'personal.absences', 'personal.payroll', 'personal.vacations', 'personal.reports',
    'combos.view', 'combos.create', 'combos.edit', 'combos.delete',
    'inventory_control.view', 'inventory_control.create', 'inventory_control.manage',
    'alerts.view', 'alerts.manage',
    'sii.view', 'sii.folios'
];

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const turso = getTurso();
        const { company, admin } = req.body || {};

        // 1. Validaciones básicas
        if (!company?.name?.trim() || !admin?.name?.trim() || !admin?.email?.trim() || !admin?.username?.trim() || !admin?.password) {
            return res.status(400).json({ success: false, error: 'Faltan datos obligatorios' });
        }
        if (!admin.email.includes('@')) {
            return res.status(400).json({ success: false, error: 'El email no es válido' });
        }
        if (admin.password.length < 6) {
            return res.status(400).json({ success: false, error: 'La contraseña debe tener al menos 6 caracteres' });
        }

        const username = admin.username.trim().toLowerCase();
        const email = admin.email.trim().toLowerCase();

        // 2. Unicidad de usuario (users.username es UNIQUE; el login busca por username global)
        const userCheck = await turso.execute({
            sql: 'SELECT id FROM users WHERE username = ?',
            args: [username]
        });
        if (userCheck.rows.length > 0) {
            return res.status(409).json({ success: false, error: 'Ese usuario ya está en uso. Elige otro.' });
        }

        // 3. Anti-abuso simple: rechazar email ya registrado en otra empresa
        const emailCheck = await turso.execute({
            sql: 'SELECT id FROM companies WHERE email_main = ?',
            args: [email]
        });
        if (emailCheck.rows.length > 0) {
            return res.status(409).json({ success: false, error: 'Ya existe una cuenta registrada con ese email.' });
        }

        const companyId = `company_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const now = new Date();
        const trialEnd = new Date(now);
        trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS);

        // 4. Crear empresa + usuario + vínculo de forma atómica (rollback si algo falla)
        let userId;
        const tx = await turso.transaction('write');
        try {
            // Empresa en 'trial' sobre el plan Básico (30 días). access_until = fin de
            // la prueba. Al vencer sin pago, el login/cron la bloquea (pasa a 'past_due').
            await tx.execute({
                sql: `INSERT INTO companies
                        (id, name, status, created_at, timezone, country_code, plan, trial_ends_at, access_until, email_main, business_type)
                      VALUES (?, ?, 'trial', ?, 'America/Santiago', 'CL', 'basico', ?, ?, ?, ?)`,
                args: [companyId, company.name.trim(), now.toISOString(), trialEnd.toISOString(), trialEnd.toISOString(), email, company.type || null]
            });

            // Usuario admin (id autoincrement, igual que createCompany) — contraseña hasheada
            const hashedPassword = await hashPassword(admin.password);
            const userRes = await tx.execute({
                sql: `INSERT INTO users (username, password, name, role, company_id)
                      VALUES (?, ?, ?, 'Administrador', ?) RETURNING id`,
                args: [username, hashedPassword, admin.name.trim(), companyId]
            });
            userId = userRes.rows[0]?.id;

            // Vínculo usuario-empresa como owner
            await tx.execute({
                sql: "INSERT INTO user_companies (user_id, company_id, role) VALUES (?, ?, 'owner')",
                args: [userId, companyId]
            });

            await tx.commit();
        } catch (txErr) {
            try { await tx.rollback(); } catch (_) { /* noop */ }
            throw txErr;
        }

        // 5. Sembrar permisos por defecto de los roles del sistema (no crítico)
        try {
            const queries = [];
            const ROLES = ['Caja', 'Vendedor', 'Bodeguero', 'Supervisor'];
            for (const role of ROLES) {
                const allowed = DEFAULT_PERMS[role] || [];
                for (const p of ALL_PERMS) {
                    queries.push({
                        sql: 'INSERT OR IGNORE INTO role_permissions (company_id, role, permission, granted) VALUES (?, ?, ?, ?)',
                        args: [companyId, role, p, allowed.includes(p) ? 1 : 0]
                    });
                }
            }
            for (const p of ALL_PERMS) {
                queries.push({
                    sql: 'INSERT OR IGNORE INTO role_permissions (company_id, role, permission, granted) VALUES (?, ?, ?, ?)',
                    args: [companyId, 'Administrador', p, 1]
                });
            }
            const CHUNK_SIZE = 50;
            for (let i = 0; i < queries.length; i += CHUNK_SIZE) {
                await turso.batch(queries.slice(i, i + CHUNK_SIZE));
            }
        } catch (permErr) {
            console.warn('start-trial: no se pudieron sembrar permisos:', permErr.message);
        }

        console.log('🎁 Trial creado:', { companyId, username, trialEnd: trialEnd.toISOString() });

        return res.status(200).json({
            success: true,
            username,
            company_id: companyId,
            trial_ends_at: trialEnd.toISOString(),
            trial_days: TRIAL_DAYS
        });

    } catch (error) {
        console.error('❌ start-trial error:', error);
        return res.status(500).json({
            success: false,
            error: 'No se pudo crear la cuenta de prueba. Intenta nuevamente.',
            details: error.message
        });
    }
}
