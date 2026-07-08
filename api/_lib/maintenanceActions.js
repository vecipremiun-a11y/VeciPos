// Mantenimiento de tablas de agregación server-side (Fase 1 · Paso 32).
// Utilidades de recálculo/limpieza que antes corrían en el navegador con
// acceso directo a la BD. Todas fuerzan company_id (nunca lo decide el cliente).

// Formatea una fecha ISO a 'YYYY-MM-DD' en la zona horaria de la empresa.
function dayInTz(iso, timeZone) {
    try {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: timeZone || 'America/Santiago',
            year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(new Date(iso));
    } catch {
        return String(iso || '').slice(0, 10);
    }
}

async function companyTimezone(turso, companyId) {
    const r = await turso.execute({ sql: 'SELECT timezone FROM companies WHERE id = ?', args: [companyId] });
    return r.rows[0]?.timezone || 'America/Santiago';
}

// Backfill completo de product_daily_profit a partir de las ventas.
async function recalculateProductProfits(turso, companyId) {
    const tz = await companyTimezone(turso, companyId);
    const BATCH_SIZE = 100;
    const dailyData = {}; // Key: "day_productId"
    let offset = 0;
    let hasMore = true;
    let totalSalesProcessed = 0;

    while (hasMore) {
        const salesRes = await turso.execute({
            sql: "SELECT id, date, items FROM sales WHERE company_id = ? AND status != 'cancelled' LIMIT ? OFFSET ?",
            args: [companyId, BATCH_SIZE, offset],
        });
        const sales = salesRes.rows;
        if (sales.length < BATCH_SIZE) hasMore = false; else offset += BATCH_SIZE;

        if (sales.length > 0) {
            totalSalesProcessed += sales.length;
            for (const sale of sales) {
                if (!sale.items) continue;
                const day = dayInTz(sale.date, tz);
                let items = [];
                try { items = JSON.parse(sale.items); } catch { continue; }

                for (const item of items) {
                    const pid = item.id;
                    const key = `${day}_${pid}`;
                    if (!dailyData[key]) {
                        dailyData[key] = {
                            company_id: companyId, product_id: pid, day,
                            total_quantity: 0, total_revenue: 0, total_cost: 0, total_tax: 0, total_profit: 0,
                        };
                    }
                    const qty = parseFloat(item.quantity) || 0;
                    const price = parseFloat(item.price) || 0;
                    const cost = parseFloat(item.cost) || 0;
                    const taxRate = parseFloat(item.tax_rate) || 0;
                    const netPriceTax = price / (1 + (taxRate / 100));

                    const revenue = price * qty;
                    const costTotal = cost * qty;
                    const taxTotal = revenue - (netPriceTax * qty);
                    const profitTotal = (netPriceTax - cost) * qty;

                    dailyData[key].total_quantity += qty;
                    dailyData[key].total_revenue += revenue;
                    dailyData[key].total_cost += costTotal;
                    dailyData[key].total_tax += taxTotal;
                    dailyData[key].total_profit += profitTotal;
                }
            }
        }
    }

    const entries = Object.values(dailyData);
    if (entries.length === 0) {
        // No borrar si no hay nada que reemplazar (preserva datos existentes).
        return { success: false, count: 0, message: 'No data found to recalculate.' };
    }

    await turso.execute({ sql: 'DELETE FROM product_daily_profit WHERE company_id = ?', args: [companyId] });

    const INSERT_BATCH_SIZE = 50;
    let insertedCount = 0;
    for (let i = 0; i < entries.length; i += INSERT_BATCH_SIZE) {
        const batch = entries.slice(i, i + INSERT_BATCH_SIZE);
        const queries = batch.map((entry) => ({
            sql: `INSERT INTO product_daily_profit
                  (company_id, product_id, day, total_quantity, total_revenue, total_cost, total_tax, total_profit, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
                entry.company_id, entry.product_id, entry.day,
                entry.total_quantity, entry.total_revenue, entry.total_cost,
                entry.total_tax, entry.total_profit, new Date().toISOString(),
            ],
        }));
        if (queries.length > 0) {
            try { await turso.batch(queries); insertedCount += queries.length; }
            catch (e) { console.error('Error inserting batch:', e); }
        }
    }
    return { success: true, count: insertedCount, processed: totalSalesProcessed };
}

// Limpia estadísticas de más de 90 días.
async function cleanOldProductStats(turso, companyId) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffStr = new Intl.DateTimeFormat('en-CA', {
        year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(cutoff);
    // product_daily_profit usa la columna `day`; hourly_sales_stats usa `date`.
    await turso.execute({ sql: 'DELETE FROM product_daily_profit WHERE company_id = ? AND day < ?', args: [companyId, cutoffStr] });
    await turso.execute({ sql: 'DELETE FROM hourly_sales_stats WHERE company_id = ? AND date < ?', args: [companyId, cutoffStr] });
    return { success: true };
}

// Recalcula el promedio de ventas diarias (últimos 30 días) por producto.
async function recalculateProductAverages(turso, companyId) {
    const products = await turso.execute({
        sql: 'SELECT DISTINCT product_id FROM product_movement_stats WHERE company_id = ?',
        args: [companyId],
    });
    for (const p of products.rows) {
        const sales = await turso.execute({
            sql: `SELECT SUM(total_quantity) as total FROM product_daily_profit
                  WHERE company_id = ? AND product_id = ? AND day >= date('now', '-30 days')`,
            args: [companyId, p.product_id],
        });
        const total = sales.rows[0]?.total || 0;
        const avgDaily = total / 30;
        await turso.execute({
            sql: 'UPDATE product_movement_stats SET avg_daily_sales = ? WHERE company_id = ? AND product_id = ?',
            args: [avgDaily, companyId, p.product_id],
        });
    }
    return { success: true };
}

export const maintenanceActions = {
    recalculateProductProfits,
    cleanOldProductStats,
    recalculateProductAverages,
};
