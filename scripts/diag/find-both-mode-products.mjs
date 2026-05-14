// Busca productos en modo "both" (Ambos) ordenados por id desc.
// También productos sin SKU recientes (no se sincronizan).
import { db } from '../optim/_client.mjs';

console.log('Productos en modo "both" (Ambos) — top 20 más recientes:\n');
const r = await db.execute(`
  SELECT id, company_id, name, sku, sale_mode, stock, price
  FROM products
  WHERE sale_mode = 'both'
  ORDER BY id DESC LIMIT 20
`);
for (const p of r.rows) {
  console.log(`  id=${p.id} co=${p.company_id} sku=${p.sku || '(SIN SKU)'} stock=${p.stock} price=${p.price}  "${p.name}"`);
}

console.log('\n\nProductos con sale_mode = NULL o vacío (top 20):');
const r2 = await db.execute(`
  SELECT id, company_id, name, sku, sale_mode, stock, price
  FROM products
  WHERE sale_mode IS NULL OR sale_mode = ''
  ORDER BY id DESC LIMIT 20
`);
for (const p of r2.rows) {
  console.log(`  id=${p.id} co=${p.company_id} sku=${p.sku || '(SIN SKU)'} sale_mode=${p.sale_mode}  "${p.name}"`);
}

console.log('\n\nProductos sin SKU (top 20, no se sincronizan con tienda):');
const r3 = await db.execute(`
  SELECT id, company_id, name, sku, sale_mode
  FROM products
  WHERE sku IS NULL OR sku = '' OR TRIM(sku) = ''
  ORDER BY id DESC LIMIT 20
`);
for (const p of r3.rows) {
  console.log(`  id=${p.id} co=${p.company_id} sale_mode=${p.sale_mode}  "${p.name}"`);
}

console.log('\n\nAuditoría CREATE PRODUCT (últimos 20):');
const r4 = await db.execute(`
  SELECT id, company_id, user_id, details, created_at
  FROM audit_logs
  WHERE action = 'CREATE' AND entity = 'PRODUCT'
  ORDER BY id DESC LIMIT 20
`);
for (const a of r4.rows) {
  try {
    const d = JSON.parse(a.details);
    console.log(`  [${a.id}] co=${a.company_id} usr=${a.user_id} ${a.created_at}  name="${d.name}" sku=${d.sku || '(SIN SKU)'}`);
  } catch {
    console.log(`  [${a.id}] co=${a.company_id} usr=${a.user_id} ${a.created_at}  details=${a.details?.slice(0, 100)}`);
  }
}
