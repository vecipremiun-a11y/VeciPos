import { createClient } from "@libsql/client";
import dotenv from 'dotenv';
dotenv.config();

const turso = createClient({
    url: process.env.VITE_TURSO_DATABASE_URL,
    authToken: process.env.VITE_TURSO_AUTH_TOKEN,
});

async function explore() {
    // 1. Listar TODAS las tablas
    console.log("=== TODAS LAS TABLAS ===");
    const tables = await turso.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    tables.rows.forEach(t => console.log(`  ${t.name}`));

    // 2. Buscar tablas relacionadas con items/desglose de ventas
    const itemTables = tables.rows.filter(t => 
        t.name.includes('item') || t.name.includes('detail') || t.name.includes('line') || t.name.includes('tax')
    );
    
    for (const t of itemTables) {
        console.log(`\n=== ESQUEMA: ${t.name} ===`);
        const schema = await turso.execute(`PRAGMA table_info(${t.name})`);
        schema.rows.forEach(c => console.log(`  ${c.name} (${c.type})`));
        
        const count = await turso.execute(`SELECT COUNT(*) as c FROM ${t.name}`);
        console.log(`  Total registros: ${count.rows[0].c}`);
        
        const sample = await turso.execute(`SELECT * FROM ${t.name} LIMIT 2`);
        if (sample.rows.length > 0) {
            console.log("  Muestra:");
            sample.rows.forEach(r => console.log(`    ${JSON.stringify(r)}`));
        }
    }

    // 3. Buscar también sale_items, sale_details, venta_items, etc
    const saleTables = tables.rows.filter(t => 
        t.name.includes('sale') || t.name.includes('venta') || t.name.includes('invoice')
    );
    
    console.log("\n=== TABLAS CON 'sale/venta/invoice' ===");
    for (const t of saleTables) {
        if (itemTables.find(it => it.name === t.name)) continue; // ya listada
        console.log(`\n--- ${t.name} ---`);
        const schema = await turso.execute(`PRAGMA table_info(${t.name})`);
        schema.rows.forEach(c => console.log(`  ${c.name} (${c.type})`));
    }
}

explore();
