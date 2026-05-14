// Lista los últimos productos creados y verifica si hubo sync por cada uno.
import { db } from '../optim/_client.mjs';

const r = await db.execute(`
  SELECT id, company_id, name, sku, sale_mode, stock, price
  FROM products
  ORDER BY id DESC
  LIMIT 20
`);

console.log(`Últimos 20 productos creados:\n`);
for (const p of r.rows) {
  console.log(`  id=${p.id}  co=${p.company_id}  sale_mode=${p.sale_mode}  sku=${p.sku || '(sin sku)'}  stock=${p.stock} price=${p.price}  "${p.name}"`);

  // Buscar logs para este producto
  if (p.sku) {
    const logs = await db.execute({
      sql: `SELECT id, event, status, substr(response, 1, 120) AS rsp_preview, created_at
            FROM integration_sync_logs
            WHERE payload LIKE ?
            ORDER BY id DESC LIMIT 3`,
      args: [`%"sku":"${p.sku}"%`],
    });
    if (logs.rows.length === 0) {
      console.log(`        ⚠ NO HAY LOGS de sync para este SKU`);
    } else {
      for (const log of logs.rows) {
        console.log(`        [${log.id}] ${log.event} ${log.status} ${log.created_at}`);
      }
    }
  } else {
    console.log(`        ⚠ Sin SKU → no se sincroniza con tienda`);
  }
  console.log('');
}
