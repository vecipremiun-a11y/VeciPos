// Mide dónde se va el tiempo al registrar una venta.
//
// SOLO LECTURAS. No escribe, no crea, no borra nada: ejecuta las mismas
// consultas que hace `saleCommit` (api/_lib/salesActions.js) y las cronometra
// contra la base real, más el plan de ejecución de cada una para ver cuáles
// recorren la tabla entera.
//
//   node scripts/optim/medir-venta.mjs [--db=poskem|demon-oficial]

import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.databases.local' });
dotenv.config({ path: '.env.local' });
dotenv.config();

const cfg = JSON.parse(readFileSync('databases.json', 'utf8'));
const which = (process.argv.find(a => a.startsWith('--db=')) || '--db=poskem').split('=')[1];
const entry = cfg.databases.find(d => d.name === which);
if (!entry) { console.error('Base no encontrada:', which); process.exit(1); }

const token = process.env[entry.tokenEnv];
if (!token) { console.error('Falta el token', entry.tokenEnv, '(¿cargaste .env.databases.local?)'); process.exit(1); }

const db = createClient({ url: entry.url, authToken: token });

const ms = (n) => `${n.toFixed(1)} ms`;

async function time(label, sql, args = []) {
    const t0 = performance.now();
    const r = await db.execute({ sql, args });
    const dt = performance.now() - t0;
    return { label, dt, rows: r.rows.length, first: r.rows[0] };
}

async function plan(sql, args = []) {
    try {
        const r = await db.execute({ sql: 'EXPLAIN QUERY PLAN ' + sql, args });
        return r.rows.map(x => x.detail).join(' | ');
    } catch (e) {
        return 'no se pudo obtener el plan: ' + (e.message || e);
    }
}

console.log(`\n=== Midiendo "${which}" (${entry.url}) ===\n`);

// ── 0) Latencia base de ida y vuelta ─────────────────────────────────────
const pings = [];
for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    await db.execute('SELECT 1');
    pings.push(performance.now() - t0);
}
pings.sort((a, b) => a - b);
const base = pings[Math.floor(pings.length / 2)];
console.log(`Latencia de una consulta trivial (mediana de 5): ${ms(base)}`);
console.log(`  todas: ${pings.map(p => p.toFixed(0)).join(', ')} ms\n`);

// ── 1) Tamaño de las tablas que participan ───────────────────────────────
console.log('--- Tamaño de las tablas ---');
for (const t of ['sales', 'sale_items', 'products', 'product_lots', 'audit_logs', 'clients']) {
    try {
        const r = await time(t, `SELECT COUNT(*) c FROM ${t}`);
        console.log(`  ${t.padEnd(14)} ${String(r.first.c).padStart(9)} filas   (contarlas: ${ms(r.dt)})`);
    } catch (e) {
        console.log(`  ${t.padEnd(14)} error: ${e.message}`);
    }
}

// Una empresa real para usar de muestra: la que más ventas tiene.
const topCo = await db.execute(
    'SELECT company_id, COUNT(*) c FROM sales GROUP BY company_id ORDER BY c DESC LIMIT 1',
);
const CO = topCo.rows[0]?.company_id;
console.log(`\nEmpresa de muestra: ${CO} (${topCo.rows[0]?.c} ventas)\n`);

// ── 2) Las consultas de saleCommit, en orden ─────────────────────────────
console.log('--- Consultas de saleCommit (en el orden en que corren) ---');

const pruebas = [
    {
        n: '1. anti-duplicado (client_sale_id)',
        sql: 'SELECT id, total, status FROM sales WHERE company_id = ? AND client_sale_id = ? LIMIT 1',
        args: [CO, '00000000-medicion-inexistente'],
    },
    {
        n: '2. config de la empresa',
        sql: 'SELECT inventory_adjustment_mode, credit_block_mode FROM companies WHERE id = ?',
        args: [CO],
    },
    {
        n: '3. productos de la venta (3 items)',
        sql: 'SELECT id, name, sku, stock, unit, price, cost, tax_rate FROM products WHERE id IN (?, ?, ?) AND company_id = ?',
        args: [1, 2, 3, CO],
    },
    {
        n: '4. lotes de esos productos',
        sql: 'SELECT * FROM product_lots WHERE product_id IN (?, ?, ?) AND company_id = ? AND quantity > 0',
        args: [1, 2, 3, CO],
    },
    {
        n: '5. caja abierta del cajero',
        sql: "SELECT id FROM cash_registers WHERE user_id = ? AND company_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1",
        args: [1, CO],
    },
    {
        n: '6. config SII',
        sql: 'SELECT auto_emit, is_active FROM sii_config WHERE company_id = ?',
        args: [CO],
    },
    {
        n: '7. deuda del cliente (solo ventas a crédito)',
        sql: `SELECT COALESCE(SUM(total), 0) as total_debt FROM sales
              WHERE client_id = ? AND company_id = ? AND payment_method = 'Crédito'
              AND status NOT IN ('paid', 'cancelled')`,
        args: [1, CO],
    },
];

let total = 0;
for (const p of pruebas) {
    // Tres corridas, se queda con la mediana: la primera suele traer ruido de red.
    const tiempos = [];
    for (let i = 0; i < 3; i++) {
        const r = await time(p.n, p.sql, p.args);
        tiempos.push(r.dt);
    }
    tiempos.sort((a, b) => a - b);
    const t = tiempos[1];
    total += t;
    const pl = await plan(p.sql, p.args);
    const escanea = /SCAN/.test(pl) && !/USING (COVERING )?INDEX/.test(pl);
    console.log(`\n  ${p.n}`);
    console.log(`     tiempo: ${ms(t)}${escanea ? '   ⚠ RECORRE LA TABLA ENTERA' : ''}`);
    console.log(`     plan:   ${pl}`);
}

console.log(`\n  ──────────────────────────────────────────`);
console.log(`  Suma de las lecturas: ${ms(total)}`);
console.log(`  De eso, latencia de red pura: ~${ms(base * pruebas.length)} (${pruebas.length} idas y vueltas)`);

// ── 3) Índices existentes en las tablas del camino de venta ──────────────
console.log('\n--- Índices en las tablas del camino de venta ---');
for (const t of ['sales', 'sale_items', 'products', 'product_lots', 'cash_registers']) {
    const r = await db.execute({
        sql: "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name = ? ORDER BY name",
        args: [t],
    });
    console.log(`\n  ${t}:`);
    for (const row of r.rows) {
        const cols = String(row.sql || '(automático)').replace(/^.*\(/, '(').replace(/\s+/g, ' ');
        console.log(`    ${row.name}  ${cols}`);
    }
}

console.log('');
