// Tasas de impuesto (tax_rates) server-side (Fase 1 · Paso 34).
// Mutaciones con company_id forzado; el "default" se desmarca dentro de la
// misma empresa (nunca toca otras).

async function taxRateCreate(turso, companyId, session, { taxData }) {
    const t = taxData || {};
    if (!t.name) return { success: false, error: 'Falta el nombre' };
    const res = await turso.execute({
        sql: 'INSERT INTO tax_rates (name, rate, is_default, company_id) VALUES (?, ?, ?, ?)',
        args: [t.name, t.rate, t.is_default ? 1 : 0, companyId],
    });
    if (t.is_default) {
        await turso.execute({
            sql: 'UPDATE tax_rates SET is_default = 0 WHERE id != ? AND company_id = ?',
            args: [res.lastInsertRowid, companyId],
        });
    }
    return { success: true };
}

async function taxRateUpdate(turso, companyId, session, { id, taxData }) {
    const t = taxData || {};
    if (!id) return { success: false, error: 'Falta id' };
    await turso.execute({
        sql: 'UPDATE tax_rates SET name = ?, rate = ?, is_default = ? WHERE id = ? AND company_id = ?',
        args: [t.name, t.rate, t.is_default ? 1 : 0, id, companyId],
    });
    if (t.is_default) {
        await turso.execute({
            sql: 'UPDATE tax_rates SET is_default = 0 WHERE id != ? AND company_id = ?',
            args: [id, companyId],
        });
    }
    return { success: true };
}

async function taxRateDelete(turso, companyId, session, { id }) {
    if (!id) return { success: false, error: 'Falta id' };
    await turso.execute({
        sql: 'DELETE FROM tax_rates WHERE id = ? AND company_id = ?',
        args: [id, companyId],
    });
    return { success: true };
}

export const taxActions = { taxRateCreate, taxRateUpdate, taxRateDelete };
