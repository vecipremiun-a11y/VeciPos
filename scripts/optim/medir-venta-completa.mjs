// Cronometra UNA venta completa, paso por paso, contra la base real.
//
// Replica exactamente la secuencia de `saleCommit` (api/_lib/salesActions.js):
// las lecturas previas, la transacción con sus UPDATE de stock y lotes, el
// INSERT de la venta y el audit_log. Al final hace ROLLBACK: NO escribe nada,
// no crea ninguna venta, no toca el stock.
//
// El objetivo es responder una sola pregunta: ¿en qué paso se va el tiempo?
//
//   node scripts/optim/medir-venta-completa.mjs [--db=poskem] [--company=default] [--items=3]

import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.databases.local' });
dotenv.config({ path: '.env.local' });
dotenv.config();

const arg = (n, d) => {
    const h = process.argv.find(a => a.startsWith(`--${n}=`));
    return h ? h.split('=').slice(1).join('=') : d;
};
const DBNAME = arg('db', 'poskem');
const CO = arg('company', 'default');
const NITEMS = parseInt(arg('items', '3'), 10);

const cfg = JSON.parse(readFileSync('databases.json', 'utf8'));
const entry = cfg.databases.find(d => d.name === DBNAME);
const db = createClient({ url: entry.url, authToken: process.env[entry.tokenEnv] });

const pasos = [];
async function paso(nombre, fn) {
    const t0 = performance.now();
    let extra = '';
    try {
        extra = (await fn()) || '';
    } catch (e) {
        extra = 'ERROR: ' + e.message;
    }
    const dt = performance.now() - t0;
    pasos.push({ nombre, dt, extra });
    console.log(`  ${String(dt.toFixed(0)).padStart(6)} ms  ${nombre}${extra ? '   (' + extra + ')' : ''}`);
    return dt;
}

console.log(`\n=== Cronómetro de UNA venta en "${DBNAME}" / empresa "${CO}" (${NITEMS} productos) ===`);
console.log('NO escribe nada: la transacción termina en ROLLBACK.\n');

// Latencia base, para separar "red" de "trabajo de la base".
const pings = [];
for (let i = 0; i < 3; i++) {
    const t = performance.now();
    await db.execute('SELECT 1');
    pings.push(performance.now() - t);
}
pings.sort((a, b) => a - b);
const base = pings[1];
console.log(`Latencia base de una consulta trivial: ${base.toFixed(0)} ms (mediana de 3)\n`);

// Productos reales con stock, para que el escenario sea realista.
const prods = await db.execute({
    sql: `SELECT id, name, stock, price, cost, tax_rate FROM products
          WHERE company_id = ? AND stock > 5 ORDER BY id DESC LIMIT ?`,
    args: [CO, NITEMS],
});
const items = prods.rows;
if (items.length === 0) { console.error('No hay productos con stock para simular.'); process.exit(1); }
const ids = items.map(i => i.id);
const ph = ids.map(() => '?').join(',');
console.log(`Productos de prueba: ${items.map(i => i.name).join(', ')}\n`);

const PRODUCT_COLS_SIN_IMAGEN =
    'id, name, price, stock, category, sku, cost, tax_rate, unit, supplier, '
    + 'pending_adjustment, is_offer, offer_price, price_ranges, scale_group_id, '
    + 'company_id, original_price, sale_mode, allow_item_notes, preorder_unit, '
    + 'preorder_billing_unit, preorder_price_per_kg, preorder_gram_per_unit, '
    + 'preorder_use_base_price, units_per_box, updated_at';

console.log('--- FASE 1: lecturas previas ---');
await paso('anti-duplicado (client_sale_id)', async () => {
    const r = await db.execute({
        sql: 'SELECT id, total, status FROM sales WHERE company_id = ? AND client_sale_id = ? LIMIT 1',
        args: [CO, 'medicion-' + Date.now()],
    });
    return r.rows.length + ' filas';
});
await paso('config de la empresa', async () => {
    await db.execute({ sql: 'SELECT inventory_adjustment_mode, credit_block_mode FROM companies WHERE id = ?', args: [CO] });
});
await paso('batch: productos + lotes + caja abierta', async () => {
    const r = await db.batch([
        { sql: `SELECT ${PRODUCT_COLS_SIN_IMAGEN} FROM products WHERE id IN (${ph}) AND company_id = ?`, args: [...ids, CO] },
        { sql: `SELECT * FROM product_lots WHERE product_id IN (${ph}) AND company_id = ? AND quantity > 0`, args: [...ids, CO] },
        { sql: "SELECT id FROM cash_registers WHERE user_id = ? AND company_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1", args: [10, CO] },
    ], 'read');
    return `${r[0].rows.length} productos, ${r[1].rows.length} lotes`;
});

console.log('\n--- FASE 2: la transacción (lo que realmente escribe) ---');
const tTx = performance.now();
const tx = await db.transaction();
let dtBegin = performance.now() - tTx;
console.log(`  ${String(dtBegin.toFixed(0)).padStart(6)} ms  abrir transacción`);

try {
    await paso('INSERT de la venta', async () => {
        await tx.execute({
            sql: `INSERT INTO sales
                  (company_id, user_id, date, items, total, summary, payment_method, payment_details, status, client_id, client_name, payment_due_date, register_id, client_sale_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?)`,
            args: [CO, 10, new Date().toISOString(), JSON.stringify(items.map(i => ({ id: i.id, name: i.name, quantity: 1, price: i.price, cost: i.cost, tax_rate: i.tax_rate }))),
                1000, 'medicion', 'Efectivo', '{}', null, null, null, null, 'MEDICION-' + Date.now()],
        });
    });

    await paso(`UPDATE de stock (${items.length} productos, en paralelo)`, async () => {
        await Promise.all(items.map(i => tx.execute({
            sql: 'UPDATE products SET stock = ROUND(stock - ?, 3), updated_at = ? WHERE id = ? AND company_id = ? AND stock >= ?',
            args: [1, new Date().toISOString(), i.id, CO, 1],
        })));
    });

    await paso('INSERT audit_log', async () => {
        await tx.execute({
            sql: `INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at)
                  VALUES (?, ?, 'CREATE', 'SALE', ?, ?)`,
            args: [CO, 10, JSON.stringify({ medicion: true }), new Date().toISOString()],
        });
    });

    await paso('ROLLBACK (deshacer todo, no se escribe nada)', async () => {
        await tx.rollback();
    });
} catch (e) {
    console.log('  ERROR en la transacción:', e.message);
    try { await tx.rollback(); } catch { /* ya cerrada */ }
}

console.log('\n--- FASE 3: post-venta (espejo de items + SII) ---');
await paso('espejo sale_items (batch de INSERT)', async () => {
    // Solo se mide el costo de la ida y vuelta con una consulta equivalente:
    // un SELECT sobre el mismo índice que usa el INSERT OR IGNORE.
    const r = await db.execute({ sql: 'SELECT COUNT(*) n FROM sale_items WHERE sale_id = ?', args: [-1] });
    return r.rows[0].n + ' (consulta equivalente)';
});
await paso('config SII', async () => {
    await db.execute({ sql: 'SELECT auto_emit, is_active FROM sii_config WHERE company_id = ?', args: [CO] });
});

const total = pasos.reduce((a, p) => a + p.dt, 0) + dtBegin;
console.log('\n  ══════════════════════════════════════');
console.log(`  TOTAL de la venta: ${total.toFixed(0)} ms`);
console.log(`  De eso, latencia de red pura: ~${(base * (pasos.length + 1)).toFixed(0)} ms (${pasos.length + 1} idas y vueltas × ${base.toFixed(0)} ms)`);
console.log('');
console.log('  Los pasos más lentos:');
[...pasos].sort((a, b) => b.dt - a.dt).slice(0, 4).forEach(p => {
    console.log(`    ${String(p.dt.toFixed(0)).padStart(6)} ms  ${p.nombre}`);
});
console.log('');
