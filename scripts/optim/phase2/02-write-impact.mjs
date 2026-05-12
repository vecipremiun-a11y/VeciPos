// FASE 2 · Paso 2 (validación de impacto en writes)
// Ejecuta UPDATEs idempotentes (no cambian datos) para estimar el costo extra
// de mantener los nuevos índices. NO inserta ni elimina filas.
//
// Estrategia: tomar 20 filas reales y hacer UPDATE x SET col = col WHERE id = id.
// Esto fuerza recálculo de índices manteniendo los valores intactos.

import { db } from '../_client.mjs';

async function bench(label, fn) {
  const t0 = Date.now();
  await fn();
  console.log(`  ${label}: ${Date.now() - t0} ms`);
}

console.log('Write impact (UPDATE idempotente x 20 filas reales)');
console.log('='.repeat(60));

// SALES
const sales = await db.execute(`SELECT id FROM sales ORDER BY id DESC LIMIT 20`);
if (sales.rows.length) {
  await bench(`sales UPDATE x ${sales.rows.length}`, async () => {
    for (const r of sales.rows) {
      await db.execute({ sql: `UPDATE sales SET status = status WHERE id = ?`, args: [r.id] });
    }
  });
} else {
  console.log('  sales: sin filas');
}

// PRODUCTS
const products = await db.execute(`SELECT id FROM products ORDER BY id DESC LIMIT 20`);
if (products.rows.length) {
  await bench(`products UPDATE x ${products.rows.length}`, async () => {
    for (const r of products.rows) {
      await db.execute({ sql: `UPDATE products SET name = name WHERE id = ?`, args: [r.id] });
    }
  });
} else {
  console.log('  products: sin filas');
}

// PRODUCT_LOTS
const lots = await db.execute(`SELECT id FROM product_lots ORDER BY id DESC LIMIT 20`);
if (lots.rows.length) {
  await bench(`product_lots UPDATE x ${lots.rows.length}`, async () => {
    for (const r of lots.rows) {
      await db.execute({ sql: `UPDATE product_lots SET status = status WHERE id = ?`, args: [r.id] });
    }
  });
} else {
  console.log('  product_lots: sin filas');
}

process.exit(0);
