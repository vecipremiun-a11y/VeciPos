import { createClient } from "@libsql/client";
import dotenv from 'dotenv';
dotenv.config();

const turso = createClient({
    url: process.env.VITE_TURSO_DATABASE_URL,
    authToken: process.env.VITE_TURSO_AUTH_TOKEN,
});

async function deleteSale() {
    const SALE_ID = 15489;
    
    try {
        // 1. Buscar la venta
        console.log(`\n=== Buscando Venta #${SALE_ID} ===\n`);
        const sale = await turso.execute({
            sql: "SELECT id, date, total, status, payment_method, observation, items, company_id FROM sales WHERE id = ?",
            args: [SALE_ID]
        });

        if (sale.rows.length === 0) {
            console.log("❌ Venta NO encontrada.");
            return;
        }

        const row = sale.rows[0];
        console.log("✅ Venta encontrada:");
        console.log(`   ID: ${row.id}`);
        console.log(`   Fecha: ${row.date}`);
        console.log(`   Total: $${Number(row.total).toLocaleString()}`);
        console.log(`   Estado: ${row.status}`);
        console.log(`   Método de pago: ${row.payment_method}`);
        console.log(`   Motivo anulación: ${row.observation}`);
        console.log(`   Company ID: ${row.company_id}`);
        
        const items = JSON.parse(row.items || '[]');
        console.log(`   Productos:`);
        items.forEach(item => {
            console.log(`     - ${item.name}: ${item.quantity} x $${Number(item.price).toLocaleString()}`);
        });

        // 2. Verificar que coincide con los datos esperados (total ~7208000, fecha 2026-03-03)
        const total = Number(row.total);
        if (total !== 7208000) {
            console.log(`\n⚠️  ADVERTENCIA: El total es $${total.toLocaleString()}, se esperaba $7.208.000`);
        }

        // 3. Eliminar la venta
        console.log(`\n=== Eliminando Venta #${SALE_ID} ===\n`);
        
        const deleteResult = await turso.execute({
            sql: "DELETE FROM sales WHERE id = ?",
            args: [SALE_ID]
        });
        
        console.log(`✅ Venta #${SALE_ID} eliminada. Filas afectadas: ${deleteResult.rowsAffected}`);

        // 4. Verificar que se eliminó
        const verify = await turso.execute({
            sql: "SELECT id FROM sales WHERE id = ?",
            args: [SALE_ID]
        });
        
        if (verify.rows.length === 0) {
            console.log(`✅ Confirmado: Venta #${SALE_ID} ya no existe en la base de datos.`);
        } else {
            console.log(`❌ ERROR: La venta aún existe después de intentar eliminarla.`);
        }

    } catch (e) {
        console.error("❌ Error:", e);
    }
}

deleteSale();
