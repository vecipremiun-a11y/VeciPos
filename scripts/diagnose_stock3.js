import { createClient } from "@libsql/client";
import dotenv from 'dotenv';
dotenv.config();

const turso = createClient({
    url: process.env.VITE_TURSO_DATABASE_URL,
    authToken: process.env.VITE_TURSO_AUTH_TOKEN,
});

async function run() {
    const PID = 4032;
    
    // 1. Stock y lotes
    const prod = await turso.execute({ sql: 'SELECT stock FROM products WHERE id = ?', args: [PID] });
    const lots = await turso.execute({ sql: 'SELECT SUM(quantity) as total, SUM(initial_quantity) as initial FROM product_lots WHERE product_id = ?', args: [PID] });
    console.log(`Stock: ${prod.rows[0].stock}`);
    console.log(`Lotes qty: ${lots.rows[0].total} (initial: ${lots.rows[0].initial})`);
    console.log(`Legacy (stock-lotes): ${prod.rows[0].stock - lots.rows[0].total}`);
    
    // 2. Total vendido - contar en BD sin descargar items
    // El ID puede estar como numero o string en el JSON
    const sales1 = await turso.execute({ 
        sql: `SELECT id, items FROM sales WHERE company_id = 'default' AND status = 'completed' AND (items LIKE ? OR items LIKE ?)`,
        args: [`%"id":${PID},%`, `%"id":"${PID}"%`] 
    });
    let totalVendido = 0;
    let salesCount = 0;
    let beforePurchase = 0; // ventas antes del 01/04 15:21
    let afterPurchase = 0;
    
    // Also try broader search
    const sales2 = await turso.execute({
        sql: `SELECT id, date, items FROM sales WHERE company_id = 'default' AND status = 'completed' AND items LIKE ?`,
        args: [`%${PID}%`]
    });
    
    const seen = new Set();
    for (const s of sales2.rows) {
        if (seen.has(s.id)) continue;
        seen.add(s.id);
        try {
            const items = JSON.parse(s.items);
            const item = items.find(i => String(i.id) === String(PID));
            if (item) {
                const qty = parseFloat(item.quantity) || 0;
                totalVendido += qty;
                salesCount++;
                if (s.date < '2026-04-01T15:21:00') {
                    beforePurchase += qty;
                } else {
                    afterPurchase += qty;
                }
            }
        } catch(e) {}
    }
    
    console.log(`\nVentas totales: ${salesCount}`);
    console.log(`Total vendido ALL TIME: ${totalVendido}`);
    console.log(`  Antes compra (pre 01/04 15:21): ${beforePurchase}`);
    console.log(`  Después compra: ${afterPurchase}`);
    
    // 3. Compras
    const purchases = await turso.execute({ 
        sql: `SELECT id, items FROM purchases WHERE company_id = 'default' AND items LIKE ?`, 
        args: [`%${PID}%`] 
    });
    let totalComprado = 0;
    for (const p of purchases.rows) {
        try {
            const items = JSON.parse(p.items);
            const item = items.find(i => String(i.id) === String(PID));
            if (item) totalComprado += parseFloat(item.quantity) || 0;
        } catch(e) {}
    }
    console.log(`\nTotal comprado ALL TIME: ${totalComprado}`);
    
    // 4. Losses
    try {
        const l = await turso.execute({ sql: 'SELECT COALESCE(SUM(quantity),0) as total FROM inventory_losses WHERE product_id = ?', args: [PID] });
        console.log(`Total perdido/merma: ${l.rows[0].total}`);
    } catch(e) { console.log('Sin tabla losses'); }
    
    // 5. Returns
    try {
        const ret = await turso.execute({ sql: `SELECT id, items FROM returns WHERE company_id = 'default' AND items LIKE ?`, args: [`%${PID}%`] });
        let totalReturned = 0;
        for (const r of ret.rows) {
            try {
                const items = JSON.parse(r.items);
                const item = items.find(i => String(i.id) === String(PID));
                if (item) totalReturned += parseFloat(item.quantity) || 0;
            } catch(e) {}
        }
        console.log(`Total devuelto: ${totalReturned}`);
    } catch(e) { console.log('Sin tabla returns'); }
    
    // Resumen
    const expected = totalComprado - totalVendido;
    console.log('\n====== RESUMEN ======');
    console.log(`Comprado: +${totalComprado}`);
    console.log(`Vendido:  -${totalVendido}`);
    console.log(`Esperado: ${expected}`);
    console.log(`Real:     ${prod.rows[0].stock}`);
    console.log(`Desviación: ${parseFloat(prod.rows[0].stock) - expected}`);
    
    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
