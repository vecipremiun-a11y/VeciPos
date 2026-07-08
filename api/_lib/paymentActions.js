// Medios de pago server-side (Fase 1 · Paso 25): config + datáfonos + cuentas.
// FIX cross-tenant: los UPDATE de terminal/banco ahora filtran company_id
// (antes iban solo por id).

const TOGGLE_FIELDS = {
    cash: 'cash_enabled', card: 'card_enabled', transfer: 'transfer_enabled',
    credit: 'credit_enabled', mixed: 'mixed_enabled',
};

let _termColorEnsured = false;
async function ensureTerminalColor(turso) {
    if (_termColorEnsured) return;
    try {
        const info = await turso.execute('PRAGMA table_info(payment_terminals)');
        if (!info.rows.some(c => c.name === 'color')) {
            await turso.execute("ALTER TABLE payment_terminals ADD COLUMN color TEXT DEFAULT '#3B82F6'");
        }
    } catch { /* best-effort */ }
    _termColorEnsured = true;
}

async function paymentSettingsLoad(turso, companyId) {
    const configRes = await turso.execute({
        sql: 'SELECT * FROM payment_methods_config WHERE company_id = ?',
        args: [companyId],
    });
    let config = configRes.rows[0];
    if (!config) {
        await turso.execute({
            sql: 'INSERT INTO payment_methods_config (company_id) VALUES (?)',
            args: [companyId],
        });
        config = { company_id: companyId, cash_enabled: 1, card_enabled: 1, transfer_enabled: 1, credit_enabled: 1, mixed_enabled: 1 };
    }
    const [terminalsRes, accountsRes] = await turso.batch([
        { sql: 'SELECT * FROM payment_terminals WHERE company_id = ? AND is_active = 1', args: [companyId] },
        { sql: 'SELECT * FROM bank_accounts WHERE company_id = ? AND is_active = 1', args: [companyId] },
    ], 'read');
    return { success: true, config, terminals: terminalsRes.rows, accounts: accountsRes.rows };
}

async function paymentMethodToggle(turso, companyId, session, { method, isEnabled }) {
    const field = TOGGLE_FIELDS[method];
    if (!field) return { success: false, error: 'Método inválido' };
    await turso.execute({
        sql: `UPDATE payment_methods_config SET ${field} = ? WHERE company_id = ?`,
        args: [isEnabled ? 1 : 0, companyId],
    });
    return { success: true, field };
}

async function terminalCreate(turso, companyId, session, { terminal }) {
    await ensureTerminalColor(turso);
    const res = await turso.execute({
        sql: 'INSERT INTO payment_terminals (company_id, name, color, commission_rate, fixed_fee, commission_includes_iva, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *',
        args: [companyId, terminal.name, terminal.color || '#3B82F6',
            Number(terminal.commission_rate) || 0, Number(terminal.fixed_fee) || 0,
            terminal.commission_includes_iva ? 1 : 0, new Date().toISOString()],
    });
    return { success: true, terminal: res.rows[0] };
}

async function terminalUpdate(turso, companyId, session, { id, terminal }) {
    await turso.execute({
        sql: 'UPDATE payment_terminals SET name = ?, color = ?, commission_rate = ?, fixed_fee = ?, commission_includes_iva = ? WHERE id = ? AND company_id = ?',
        args: [terminal.name, terminal.color || '#3B82F6', Number(terminal.commission_rate) || 0,
            Number(terminal.fixed_fee) || 0, terminal.commission_includes_iva ? 1 : 0, id, companyId],
    });
    return { success: true };
}

async function terminalDelete(turso, companyId, session, { id }) {
    await turso.execute({
        sql: 'UPDATE payment_terminals SET is_active = 0 WHERE id = ? AND company_id = ?',
        args: [id, companyId],
    });
    return { success: true };
}

async function bankAccountCreate(turso, companyId, session, { account }) {
    const res = await turso.execute({
        sql: `INSERT INTO bank_accounts (company_id, bank_name, account_number, account_type, owner_name, rut, email, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
        args: [companyId, account.bank_name, account.account_number, account.account_type,
            account.owner_name, account.rut, account.email, new Date().toISOString()],
    });
    return { success: true, account: res.rows[0] };
}

async function bankAccountUpdate(turso, companyId, session, { id, account }) {
    await turso.execute({
        sql: 'UPDATE bank_accounts SET bank_name = ?, account_number = ?, account_type = ?, owner_name = ?, rut = ?, email = ? WHERE id = ? AND company_id = ?',
        args: [account.bank_name, account.account_number, account.account_type,
            account.owner_name, account.rut, account.email, id, companyId],
    });
    return { success: true };
}

async function bankAccountDelete(turso, companyId, session, { id }) {
    await turso.execute({
        sql: 'UPDATE bank_accounts SET is_active = 0 WHERE id = ? AND company_id = ?',
        args: [id, companyId],
    });
    return { success: true };
}

// Cliente registra una transferencia → pago 'pending' para aprobación manual del
// admin. company_id se fuerza desde la sesión (no lo decide el cuerpo del request).
async function transferIntentCreate(turso, companyId, session, body) {
    const { planId, billingCycle, amount, currency, planName, receiptData } = body;
    const paymentId = `payment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await turso.execute({
        sql: `INSERT INTO payments (id, company_id, amount, currency, status, payment_method, description, plan_id, billing_cycle, receipt_url, created_at)
              VALUES (?, ?, ?, ?, 'pending', 'transfer', ?, ?, ?, ?, ?)`,
        args: [paymentId, companyId, amount, currency, `Transferencia: ${planName}`, planId, billingCycle, receiptData || null, new Date().toISOString()],
    });
    return { success: true };
}

export const paymentActions = {
    paymentSettingsLoad, paymentMethodToggle,
    terminalCreate, terminalUpdate, terminalDelete,
    bankAccountCreate, bankAccountUpdate, bankAccountDelete,
    transferIntentCreate,
};
