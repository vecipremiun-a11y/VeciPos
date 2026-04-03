import { createClient } from "@libsql/client";
import dotenv from 'dotenv';
dotenv.config();

const turso = createClient({
    url: process.env.VITE_TURSO_DATABASE_URL,
    authToken: process.env.VITE_TURSO_AUTH_TOKEN,
});

const PID = '4032';

async function run() {
    // Ventas
    const r = await turso.execute({
        sql: `SELECT s.id, s.date, s.items, u.name as user_name FROM sales s LEFT JOIN users u ON s.user_id = u.id WHERE s.company_id = 'default' AND s.status = 'completed' AND s.items LIKE ? ORDER BY s.date DESC LIMIT 100`,
        args: [`%"id":${PID},%`]
    });
    
    let total = 0;
    console.log('=== VENTAS ===');
    for (const s of r.rows) {
        const items = JSON.parse(s.items);
        const item = items.find(i => String(i.id) === PID);
        if (item) {
            const qty = parseFloat(item.quantity) || 0;
            total += qty;
            console.log(`Venta #${s.id} | ${s.date} | Cant: ${qty} | ${s.user_name || '?'}`);
        }
    }
    
    // Fallback search with string id
    const r2 = await turso.execute({
        sql: `SELECT s.id, s.date, s.items, u.name as user_name FROM sales s LEFT JOIN users u ON s.user_id = u.id WHERE s.company_id = 'default' AND s.status = 'completed' AND s.items LIKE ? ORDER BY s.date DESC LIMIT 100`,
        args: [`%"id":"${PID}"%`]
    });
    
    for (const s of r2.rows) {
        if (r.rows.find(x => x.id === s.id)) continue; // skip dup
        const items = JSON.parse(s.items);
        const item = items.find(i => String(i.id) === PID);
        if (item) {
            const qty = parseFloat(item.quantity) || 0;
            total += qty;
            console.log(`Venta #${s.id} | ${s.date} | Cant: ${qty} | ${s.user_name || '?'} (str)`);
        }
    }
    
    console.log(`\nTOTAL VENDIDO: ${total}`);
    
    // Losses
    try {
        const l = await turso.execute({ sql: 'SELECT * FROM inventory_losses WHERE product_id = ?', args: [PID] });
        console.log(`\n=== PÉRDIDAS: ${l.rows.length} ===`);
        l.rows.forEach(x => console.log(`  #${x.id} qty:${x.quantity} reason:${x.reason} date:${x.created_at}`));
    } catch(e) { console.log('No losses table:', e.message); }
    
    // Returns
    try {
        const ret = await turso.execute({ sql: `SELECT id, items, type, created_at FROM returns WHERE company_id = 'default' AND items LIKE ?`, args: [`%${PID}%`] });
        console.log(`\n=== DEVOLUCIONES: ${ret.rows.length} ===`);
        for (const r of ret.rows) {
            const items = JSON.parse(r.items || '[]');
            const item = items.find(i => String(i.id) === PID);
            if (item) console.log(`  #${r.id} qty:${item.quantity} type:${r.type} date:${r.created_at}`);
        }
    } catch(e) { console.log('No returns table:', e.message); }
    
    // Summary
    console.log('\n=== RESUMEN ===');
    console.log(`Stock actual (products.stock): 30`);
    console.log(`Lotes (product_lots.quantity): 1`);
    console.log(`Comprado total: 180`);
    console.log(`Vendido total: ${total}`);
    console.log(`Esperado (180 - ${total}): ${180 - total}`);
    console.log(`Desviación: ${30 - (180 - total)}`);
}

run().catch(e => { console.error(e.message); process.exit(1); });
