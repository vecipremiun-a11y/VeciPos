import { createClient } from "@libsql/client";
import dotenv from 'dotenv';
dotenv.config();

const turso = createClient({
    url: process.env.VITE_TURSO_DATABASE_URL,
    authToken: process.env.VITE_TURSO_AUTH_TOKEN,
});

async function recalcProfits() {
    const companyId = 'default';
    const BATCH_SIZE = 200;
    const dailyData = {};
    let offset = 0;
    let hasMore = true;
    let totalSales = 0;

    console.log("Recalculando product_daily_profit...");

    while (hasMore) {
        const res = await turso.execute({
            sql: "SELECT id, date, items FROM sales WHERE company_id = ? AND status != 'cancelled' LIMIT ? OFFSET ?",
            args: [companyId, BATCH_SIZE, offset]
        });

        if (res.rows.length < BATCH_SIZE) hasMore = false;
        else offset += BATCH_SIZE;
        totalSales += res.rows.length;

        for (const sale of res.rows) {
            if (!sale.items) continue;
            const saleDate = new Date(sale.date);
            const dayStr = saleDate.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });

            let items;
            try { items = JSON.parse(sale.items); } catch { continue; }

            for (const item of items) {
                const key = `${dayStr}_${item.id}`;

                if (!dailyData[key]) {
                    dailyData[key] = { cid: companyId, pid: item.id, day: dayStr, qty: 0, rev: 0, cost: 0, tax: 0, profit: 0 };
                }

                const qty = parseFloat(item.quantity) || 0;
                const price = parseFloat(item.price) || 0;
                const cost = parseFloat(item.cost) || 0;
                const taxRate = parseFloat(item.tax_rate) || 0;
                const netPrice = taxRate > 0 ? price / (1 + taxRate / 100) : price;

                dailyData[key].qty += qty;
                dailyData[key].rev += price * qty;
                dailyData[key].cost += cost * qty;
                dailyData[key].tax += (price * qty) - (netPrice * qty);
                dailyData[key].profit += (netPrice - cost) * qty;
            }
        }

        if (totalSales % 2000 === 0) console.log(`  ${totalSales} ventas...`);
    }

    const entries = Object.values(dailyData);
    console.log(`Total: ${totalSales} ventas -> ${entries.length} registros`);

    // Borrar
    await turso.execute({ sql: "DELETE FROM product_daily_profit WHERE company_id = ?", args: [companyId] });
    console.log("Datos anteriores borrados. Insertando...");

    // Insertar
    let ok = 0;
    for (let i = 0; i < entries.length; i += 20) {
        const batch = entries.slice(i, i + 20).map(e => ({
            sql: "INSERT INTO product_daily_profit (company_id,product_id,day,total_quantity,total_revenue,total_cost,total_tax,total_profit,updated_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'))",
            args: [e.cid, e.pid, e.day, e.qty, e.rev, e.cost, e.tax, e.profit]
        }));
        await turso.batch(batch);
        ok += batch.length;
        if (ok % 2000 === 0) console.log(`  ${ok}/${entries.length}`);
    }

    console.log(`Insertados: ${ok}`);

    // Verificar
    const v = await turso.execute("SELECT day, ROUND(SUM(total_tax)) as tax, ROUND(SUM(total_revenue)) as rev FROM product_daily_profit WHERE company_id='default' GROUP BY day ORDER BY day DESC LIMIT 5");
    v.rows.forEach(x => console.log(`  ${x.day}: tax=$${x.tax} rev=$${x.rev}`));
    console.log("DONE");
}

recalcProfits().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
