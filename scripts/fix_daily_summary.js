import { createClient } from "@libsql/client";
import dotenv from 'dotenv';
dotenv.config();

const turso = createClient({
    url: process.env.VITE_TURSO_DATABASE_URL,
    authToken: process.env.VITE_TURSO_AUTH_TOKEN,
});

async function fixDailySummary() {
    try {
        // 1. Recalcular total REAL del 3 de marzo desde las ventas que quedan
        const realTotal = await turso.execute(
            "SELECT SUM(total) as real_total, COUNT(*) as real_count FROM sales WHERE company_id = 'default' AND date >= '2026-03-03T00:00:00' AND date < '2026-03-04T00:00:00' AND status = 'completed'"
        );
        const newTotal = realTotal.rows[0].real_total;
        const newCount = realTotal.rows[0].real_count;
        console.log(`Total real día 3 marzo: $${Number(newTotal).toLocaleString()} (${newCount} ventas)`);

        // 2. Actualizar sales_daily_summary
        console.log("\n=== Actualizando sales_daily_summary ===");
        const updateSummary = await turso.execute({
            sql: "UPDATE sales_daily_summary SET total_sales = ?, total_orders = ?, updated_at = datetime('now') WHERE day = '2026-03-03' AND company_id = 'default'",
            args: [newTotal, newCount]
        });
        console.log(`✅ sales_daily_summary actualizado. Filas afectadas: ${updateSummary.rowsAffected}`);

        // 3. Recalcular product_daily_profit para producto 4480 del 3 marzo
        // Sumar los items de todas las ventas que quedan para ese producto
        console.log("\n=== Recalculando product_daily_profit para producto 4480 ===");
        const sales4480 = await turso.execute(
            "SELECT items FROM sales WHERE company_id = 'default' AND date >= '2026-03-03T00:00:00' AND date < '2026-03-04T00:00:00' AND status = 'completed'"
        );
        
        let totalQty = 0, totalRevenue = 0, totalCost = 0, totalTax = 0;
        for (const row of sales4480.rows) {
            const items = JSON.parse(row.items || '[]');
            for (const item of items) {
                if (item.id === 4480) {
                    const qty = Number(item.quantity) || 0;
                    const price = Number(item.price) || 0;
                    const cost = Number(item.cost) || 0;
                    const taxRate = Number(item.tax_rate) || 0;
                    totalQty += qty;
                    totalRevenue += qty * price;
                    totalCost += qty * cost;
                    totalTax += qty * price * taxRate;
                }
            }
        }
        totalRevenue = Math.round(totalRevenue * 100) / 100;
        totalCost = Math.round(totalCost * 100) / 100;
        const totalProfit = Math.round((totalRevenue - totalCost) * 100) / 100;
        
        console.log(`  Producto 4480 real: qty=${totalQty}, revenue=$${totalRevenue.toLocaleString()}, cost=$${totalCost.toLocaleString()}, profit=$${totalProfit.toLocaleString()}`);

        if (totalQty > 0) {
            const updateProfit = await turso.execute({
                sql: "UPDATE product_daily_profit SET total_quantity = ?, total_revenue = ?, total_cost = ?, total_tax = ?, total_profit = ?, updated_at = datetime('now') WHERE day = '2026-03-03' AND company_id = 'default' AND product_id = 4480",
                args: [totalQty, totalRevenue, totalCost, totalTax, totalProfit]
            });
            console.log(`✅ product_daily_profit actualizado. Filas afectadas: ${updateProfit.rowsAffected}`);
        } else {
            // Si no hay ventas reales de ese producto, eliminar el registro
            const deleteProfit = await turso.execute(
                "DELETE FROM product_daily_profit WHERE day = '2026-03-03' AND company_id = 'default' AND product_id = 4480"
            );
            console.log(`✅ product_daily_profit eliminado (sin ventas reales). Filas afectadas: ${deleteProfit.rowsAffected}`);
        }

        // 4. Verificar resultados
        console.log("\n=== Verificación final ===");
        const verify = await turso.execute(
            "SELECT * FROM sales_daily_summary WHERE day = '2026-03-03' AND company_id = 'default'"
        );
        console.log("sales_daily_summary:", JSON.stringify(verify.rows[0]));

        const verifyProfit = await turso.execute(
            "SELECT * FROM product_daily_profit WHERE day = '2026-03-03' AND company_id = 'default' AND product_id = 4480"
        );
        if (verifyProfit.rows.length > 0) {
            console.log("product_daily_profit (4480):", JSON.stringify(verifyProfit.rows[0]));
        } else {
            console.log("product_daily_profit (4480): eliminado");
        }

    } catch (e) {
        console.error("Error:", e);
    }
}

fixDailySummary();
