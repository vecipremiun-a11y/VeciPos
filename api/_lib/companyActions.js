// Configuración de empresa / folios / DTEs server-side (Fase 1 · Paso 23).
// Los UPDATE a `companies` usan whitelist de columnas — el cliente nunca
// decide qué columna se escribe.

import crypto from 'crypto';

// Columnas de companies que el usuario puede editar desde Configuración
const COMPANY_FIELDS = new Set([
    'legal_name', 'full_address', 'tax_id_legal', 'phone_main', 'email_main',
    'city', 'country', 'postal_code', 'website', 'business_type', 'currency',
    'timezone', 'kds_sound', 'credit_block_mode', 'inventory_adjustment_mode',
]);

async function companyFieldsUpdate(turso, companyId, session, { fields }) {
    const sets = [];
    const args = [];
    for (const [k, v] of Object.entries(fields || {})) {
        if (COMPANY_FIELDS.has(k) && v !== undefined) { sets.push(`${k} = ?`); args.push(v); }
    }
    if (!sets.length) return { success: true };
    args.push(companyId);
    await turso.execute({
        sql: `UPDATE companies SET ${sets.join(', ')} WHERE id = ?`,
        args,
    });
    return { success: true };
}

// ── Folios / SII config (FolioSettings) ──────────────────────────

let _folioColsEnsured = false;
async function ensureFolioColumns(turso) {
    if (_folioColsEnsured) return;
    try { await turso.execute("ALTER TABLE sii_config ADD COLUMN enabled_dtes TEXT DEFAULT '[]'"); } catch { /* existe */ }
    try { await turso.execute('ALTER TABLE sii_config ADD COLUMN default_dte INTEGER DEFAULT 39'); } catch { /* existe */ }
    _folioColsEnsured = true;
}

async function folioSettingsLoad(turso, companyId) {
    await ensureFolioColumns(turso);
    const [configRes, cafsRes] = await turso.batch([
        { sql: 'SELECT enabled_dtes, default_dte FROM sii_config WHERE company_id = ?', args: [companyId] },
        {
            sql: `SELECT tipo_dte, folio_desde, folio_hasta, folio_actual, estado
                  FROM sii_cafs WHERE company_id = ? AND estado = 'active' ORDER BY tipo_dte`,
            args: [companyId],
        },
    ], 'read');
    return { success: true, config: configRes.rows[0] || null, cafs: cafsRes.rows };
}

async function folioSettingsSave(turso, companyId, session, { enabledDtes, defaultDte }) {
    await ensureFolioColumns(turso);
    await turso.execute({
        sql: `INSERT INTO sii_config (company_id, enabled_dtes, default_dte, created_at, updated_at)
              VALUES (?, ?, ?, datetime('now'), datetime('now'))
              ON CONFLICT(company_id) DO UPDATE SET
                enabled_dtes = excluded.enabled_dtes, default_dte = excluded.default_dte, updated_at = excluded.updated_at`,
        args: [companyId, JSON.stringify(enabledDtes || [0]), Number(defaultDte) || 0],
    });
    return { success: true };
}

// ── DTEs (DocumentosSII) ─────────────────────────────────────────

async function dteRetryDelete(turso, companyId, session, { dteId }) {
    if (!dteId) return { success: false, error: 'Falta dteId' };
    // Solo borra DTEs en error de la propia empresa (para reemitir)
    await turso.execute({
        sql: "DELETE FROM sii_dtes WHERE id = ? AND company_id = ? AND estado = 'error'",
        args: [dteId, companyId],
    });
    return { success: true };
}

// Módulo de empresa: prender/apagar un feature flag (Paso 31)
async function companyModuleUpdate(turso, companyId, session, { moduleKey, enabled }) {
    if (!moduleKey) return { success: false, error: 'Falta moduleKey' };
    const now = new Date().toISOString();
    await turso.execute({
        sql: `INSERT INTO company_modules (company_id, module_key, enabled, updated_at)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(company_id, module_key) DO UPDATE SET enabled = ?, updated_at = ?`,
        args: [companyId, moduleKey, enabled ? 1 : 0, now, enabled ? 1 : 0, now],
    });
    return { success: true };
}

// Crea una empresa ADICIONAL enlazada a la cuenta del usuario (multi-empresa).
// SEGURIDAD: el actor debe ser 'owner' de la empresa actual; el owner de la nueva
// empresa se fuerza a session.uid (el cliente ya no decide a quién enlazar).
async function companyLinkedCreate(turso, companyId, session, { name, plan = 'professional' }) {
    // El actor debe ser dueño de la empresa desde la que crea la nueva.
    const own = await turso.execute({
        sql: "SELECT role FROM user_companies WHERE user_id = ? AND company_id = ? LIMIT 1",
        args: [session?.uid ?? null, companyId],
    });
    const isOwner = own.rows[0]?.role === 'owner' || session?.role === 'super_admin';
    if (!isOwner) return { success: false, error: 'Solo el dueño puede crear empresas adicionales.' };

    // Heredar lo mínimo de la empresa actual y enlazar SIEMPRE a la principal (raíz).
    const cur = (await turso.execute({
        sql: "SELECT timezone, currency, country_code, parent_company_id FROM companies WHERE id = ?",
        args: [companyId],
    })).rows[0] || {};
    const rootId = cur.parent_company_id || companyId;
    const timezone = cur.timezone || 'America/Santiago';
    const currency = cur.currency || 'CLP';
    const countryCode = cur.country_code || 'CL';

    const id = `company_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await turso.execute({
        sql: `INSERT INTO companies (id, name, status, created_at, timezone, currency, country_code, plan, parent_company_id)
              VALUES (?, ?, 'pending_payment', ?, ?, ?, ?, ?, ?)`,
        args: [id, (name && name.trim()) || 'Empresa nueva', new Date().toISOString(), timezone, currency, countryCode, plan, rootId],
    });

    // El dueño de la nueva empresa se fuerza al usuario de la sesión.
    await turso.execute({
        sql: "INSERT INTO user_companies (user_id, company_id, role) VALUES (?, ?, 'owner')",
        args: [session?.uid ?? null, id],
    });

    // Copiar las plantillas de permisos por rol desde la empresa principal.
    await turso.execute({
        sql: `INSERT INTO role_permissions (company_id, role, permission, granted)
              SELECT ?, role, permission, granted FROM role_permissions WHERE company_id = ?`,
        args: [id, rootId],
    });

    return { success: true, companyId: id };
}

// Devuelve el token del KDS (Pantalla de Cocina) de la empresa, generándolo si
// falta. Antes solo lo tenía la empresa que corrió un script manual → las nuevas
// se quedaban con la Pantalla de Cocina "Cargando…" para siempre.
async function kdsTokenEnsure(turso, companyId) {
    const r = await turso.execute({ sql: 'SELECT kds_token FROM companies WHERE id = ? LIMIT 1', args: [companyId] });
    let token = r.rows[0]?.kds_token;
    if (!token) {
        token = 'kds_' + crypto.randomBytes(12).toString('hex');
        await turso.execute({ sql: 'UPDATE companies SET kds_token = ? WHERE id = ?', args: [token, companyId] });
    }
    return { success: true, kds_token: token };
}

// Lista todas las sucursales de la cuenta (raíz + enlazadas) de las que el
// usuario de la sesión es miembro, con su plan/estado/vencimiento. Para el
// panel "Mi Plan" (Fase B). No expone empresas de otros dueños.
async function companyBranches(turso, companyId, session) {
    const cur = (await turso.execute({
        sql: 'SELECT id, parent_company_id FROM companies WHERE id = ?',
        args: [companyId],
    })).rows[0];
    if (!cur) return { success: true, branches: [] };
    const rootId = cur.parent_company_id || cur.id;

    const r = await turso.execute({
        sql: `SELECT c.id, c.name, c.plan, c.status, c.access_until, c.trial_ends_at, c.parent_company_id, c.created_at
              FROM companies c
              INNER JOIN user_companies uc ON uc.company_id = c.id AND uc.user_id = ?
              WHERE c.id = ? OR c.parent_company_id = ?
              ORDER BY (c.parent_company_id IS NOT NULL), c.created_at`,
        args: [session?.uid ?? null, rootId, rootId],
    });
    return { success: true, branches: r.rows, rootId };
}

// ── Config de boleta / preventa (ReceiptSettings, SaleSuccessModal) ──
// receipt_format y las columnas preventa_* son drift de esquema (faltan en
// algunas BD). Se aseguran best-effort (idempotente) antes de leer/escribir.
let _receiptColsEnsured = false;
async function ensureReceiptColumns(turso) {
    if (_receiptColsEnsured) return;
    const alters = [
        "ALTER TABLE companies ADD COLUMN receipt_format TEXT DEFAULT '58mm'",
        'ALTER TABLE companies ADD COLUMN preventa_business_name TEXT',
        'ALTER TABLE companies ADD COLUMN preventa_address TEXT',
        'ALTER TABLE companies ADD COLUMN preventa_phone TEXT',
        'ALTER TABLE companies ADD COLUMN preventa_header_message TEXT',
        'ALTER TABLE companies ADD COLUMN preventa_footer_message TEXT',
        'ALTER TABLE companies ADD COLUMN preventa_show_phone INTEGER DEFAULT 1',
        'ALTER TABLE companies ADD COLUMN preventa_show_address INTEGER DEFAULT 1',
        "ALTER TABLE companies ADD COLUMN preventa_format TEXT DEFAULT '80mm'",
    ];
    for (const sql of alters) { try { await turso.execute(sql); } catch { /* ya existe */ } }
    _receiptColsEnsured = true;
}

async function receiptSettingsLoad(turso, companyId) {
    await ensureReceiptColumns(turso);
    const r = await turso.execute({
        sql: `SELECT receipt_business_name as business_name, receipt_address as address, receipt_tax_id as tax_id,
                receipt_phone as phone, receipt_email as email, receipt_header_message as header_message,
                receipt_footer_message as footer_message, receipt_show_tax_id as show_tax_id,
                receipt_show_phone as show_phone, receipt_show_email as show_email, receipt_format as format
              FROM companies WHERE id = ?`,
        args: [companyId],
    });
    return { success: true, config: r.rows[0] || null };
}

async function preventaSettingsLoad(turso, companyId) {
    await ensureReceiptColumns(turso);
    const r = await turso.execute({
        sql: `SELECT preventa_business_name as business_name, preventa_address as address, preventa_phone as phone,
                preventa_header_message as header_message, preventa_footer_message as footer_message,
                preventa_show_phone as show_phone, preventa_show_address as show_address, preventa_format as format
              FROM companies WHERE id = ?`,
        args: [companyId],
    });
    return { success: true, config: r.rows[0] || null };
}

// Guardar config de boleta (columnas receipt_* explícitas — el cliente no elige columna)
async function receiptSettingsSave(turso, companyId, session, { config }) {
    await ensureReceiptColumns(turso);
    const c = config || {};
    await turso.execute({
        sql: `UPDATE companies SET
                receipt_business_name = ?, receipt_address = ?, receipt_tax_id = ?, receipt_phone = ?,
                receipt_email = ?, receipt_header_message = ?, receipt_footer_message = ?,
                receipt_show_tax_id = ?, receipt_show_phone = ?, receipt_show_email = ?, receipt_format = ?
              WHERE id = ?`,
        args: [
            c.business_name ?? '', c.address ?? '', c.tax_id ?? '', c.phone ?? '', c.email ?? '',
            c.header_message ?? '', c.footer_message ?? '',
            c.show_tax_id ? 1 : 0, c.show_phone ? 1 : 0, c.show_email ? 1 : 0, c.format || '58mm',
            companyId,
        ],
    });
    return { success: true };
}

// Guardar config de preventa (columnas preventa_* explícitas)
async function preventaSettingsSave(turso, companyId, session, { config }) {
    await ensureReceiptColumns(turso);
    const c = config || {};
    await turso.execute({
        sql: `UPDATE companies SET
                preventa_business_name = ?, preventa_address = ?, preventa_phone = ?,
                preventa_header_message = ?, preventa_footer_message = ?,
                preventa_show_phone = ?, preventa_show_address = ?, preventa_format = ?
              WHERE id = ?`,
        args: [
            c.business_name ?? '', c.address ?? '', c.phone ?? '',
            c.header_message ?? '', c.footer_message ?? '',
            c.show_phone ? 1 : 0, c.show_address ? 1 : 0, c.format || '80mm',
            companyId,
        ],
    });
    return { success: true };
}

// Config global de medios de pago de suscripción — LECTURA (cualquier usuario
// autenticado: son instrucciones de pago). La ESCRITURA vive en /api/admin/actions.
async function paymentSettingsGet(turso) {
    const r = await turso.execute("SELECT value FROM system_settings WHERE key = 'subscription_payment_config'");
    if (r.rows.length === 0) return { success: true, config: null };
    try { return { success: true, config: JSON.parse(r.rows[0].value) }; }
    catch { return { success: true, config: null }; }
}

export const companyActions = {
    companyFieldsUpdate,
    folioSettingsLoad,
    folioSettingsSave,
    dteRetryDelete,
    companyModuleUpdate,
    companyLinkedCreate,
    companyBranches,
    kdsTokenEnsure,
    receiptSettingsLoad,
    preventaSettingsLoad,
    receiptSettingsSave,
    preventaSettingsSave,
    paymentSettingsGet,
};
