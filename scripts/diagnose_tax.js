import { createClient } from "@libsql/client";
import dotenv from 'dotenv';
dotenv.config();

const turso = createClient({
    url: process.env.VITE_TURSO_DATABASE_URL,
    authToken: process.env.VITE_TURSO_AUTH_TOKEN,
});

async function diagnoseTax() {
    // 1. Verificar si items de ventas tienen tax_rate > 0
    console.log("=== Analizando items de últimas 100 ventas ===");
    const sales = await turso.execute("SELECT id, items FROM sales WHERE company_id = 'default' ORDER BY id DESC LIMIT 100");
    let withTax = 0, noTax = 0;
    for (const s of sales.rows) {
        const items = JSON.parse(s.items);
        for (const i of items) {
            if (i.tax_rate && i.tax_rate > 0) withTax++;
            else noTax++;
        }
    }
    console.log(`Items CON tax_rate > 0: ${withTax}`);
    console.log(`Items SIN tax_rate (0/null): ${noTax}`);

    // 2. Buscar un producto que tiene tax_rate=19 en BD y ver si en ventas se guardó
    const prod = await turso.execute("SELECT id, name, tax_rate FROM products WHERE company_id = 'default' AND tax_rate = 19 LIMIT 1");
    if (prod.rows.length > 0) {
        const pid = prod.rows[0].id;
        const pname = prod.rows[0].name;
        console.log(`\n=== Producto ${pid} (${pname}) tiene tax_rate=19 en BD ===`);

        // Buscar ventas que incluyen ese producto
        const salesWithProd = await turso.execute({
            sql: "SELECT id, items FROM sales WHERE company_id = 'default' AND items LIKE ? ORDER BY id DESC LIMIT 5",
            args: [`%"id":${pid},%`]
        });
        console.log(`Ventas con este producto: ${salesWithProd.rows.length}`);
        for (const s of salesWithProd.rows) {
            const items = JSON.parse(s.items);
            const match = items.find(i => i.id === pid);
            if (match) {
                console.log(`  Venta #${s.id}: tax_rate=${match.tax_rate}`);
            }
        }
    }

    // 3. Valores distintos de tax_rate en productos (completo)
    console.log("\n=== TODOS los valores distintos de tax_rate en products ===");
    const taxRates = await turso.execute("SELECT tax_rate, COUNT(*) as c FROM products WHERE company_id = 'default' GROUP BY tax_rate ORDER BY tax_rate");
    taxRates.rows.forEach(x => console.log(`  tax_rate=${x.tax_rate}: ${x.c} productos`));
}

diagnoseTax();
