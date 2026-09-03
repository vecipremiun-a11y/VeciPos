// ¿Cuánto pesa lo que sube el navegador en CADA venta?
//
// SOLO LECTURAS. Cada ítem del carrito arrastra `image` (la foto del producto en
// base64, ver addToCart en src/store/useStore.js) y addSale manda los ítems tal
// cual al servidor. Esto mide cuánto pesa esa foto en la base real y cuánto
// tarda en subir por una conexión de local.
//
//   node scripts/optim/medir-payload-venta.mjs [--db=poskem]

import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.databases.local' });
dotenv.config({ path: '.env.local' });
dotenv.config();

const cfg = JSON.parse(readFileSync('databases.json', 'utf8'));
const which = (process.argv.find(a => a.startsWith('--db=')) || '--db=poskem').split('=')[1];
const entry = cfg.databases.find(d => d.name === which);
const db = createClient({ url: entry.url, authToken: process.env[entry.tokenEnv] });

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

console.log(`\n=== Peso de las fotos de producto en "${which}" ===\n`);

const r = await db.execute(`
    SELECT
      COUNT(*)                                          AS total,
      SUM(CASE WHEN image IS NOT NULL AND image <> '' THEN 1 ELSE 0 END) AS con_foto,
      AVG(CASE WHEN image IS NOT NULL AND image <> '' THEN LENGTH(image) END) AS promedio,
      MAX(LENGTH(image))                                AS maximo
    FROM products
`);
const s = r.rows[0];
console.log(`  Productos:            ${s.total}`);
console.log(`  Con foto:             ${s.con_foto} (${((s.con_foto / s.total) * 100).toFixed(0)}%)`);
console.log(`  Peso promedio foto:   ${kb(Number(s.promedio || 0))}`);
console.log(`  Peso de la más pesada: ${kb(Number(s.maximo || 0))}`);

// Los más vendidos son los que más veces viajan en un carrito.
console.log('\n--- Los 10 productos más vendidos y el peso de su foto ---');
const top = await db.execute(`
    SELECT p.name, LENGTH(p.image) AS bytes, COUNT(si.id) AS veces_vendido
    FROM sale_items si
    JOIN products p ON p.id = si.product_id
    GROUP BY si.product_id
    ORDER BY veces_vendido DESC
    LIMIT 10
`);
let sumaTop = 0;
for (const row of top.rows) {
    const b = Number(row.bytes || 0);
    sumaTop += b;
    console.log(`  ${String(row.veces_vendido).padStart(6)} ventas   ${kb(b).padStart(10)}   ${row.name}`);
}
const promedioTop = sumaTop / (top.rows.length || 1);

// ── Cuánto pesa una venta típica ────────────────────────────────────────
console.log('\n--- Cuánto sube el navegador en una venta ---');
const itemsPorVenta = await db.execute(`
    SELECT AVG(n) AS promedio, MAX(n) AS maximo FROM (
      SELECT sale_id, COUNT(*) AS n FROM sale_items GROUP BY sale_id
    )
`);
const prom = Number(itemsPorVenta.rows[0].promedio || 0);
const max = Number(itemsPorVenta.rows[0].maximo || 0);
console.log(`  Ítems por venta: ${prom.toFixed(1)} en promedio, ${max} el máximo`);

// base64 viaja dentro de JSON: se escapa poco, pero se suma el resto del ítem.
const porItem = promedioTop;
for (const [etiqueta, n] of [['venta promedio', Math.round(prom)], ['venta grande', Math.min(max, 30)]]) {
    const bytes = n * porItem;
    console.log(`\n  ${etiqueta} (${n} ítems): ${kb(bytes)} de subida`);
    for (const [red, mbps] of [['fibra local 20 Mbps subida', 20], ['4G decente 5 Mbps', 5], ['4G malo 1 Mbps', 1]]) {
        const seg = (bytes * 8) / (mbps * 1_000_000);
        console.log(`     ${red.padEnd(28)} ${seg.toFixed(2)} s solo en subir`);
    }
}

console.log('\n(Subida, no bajada: es lo que el navegador MANDA al servidor en cada venta.)\n');
