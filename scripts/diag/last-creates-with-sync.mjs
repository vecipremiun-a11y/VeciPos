// Cruza los últimos CREATE PRODUCT del audit_logs con sus syncs en
// integration_sync_logs. Detecta productos creados pero NO sincronizados.
import { db } from '../optim/_client.mjs';

console.log(`Productos creados HOY 13-may (últimas 24h) cruzado con sync logs:\n`);

const creates = await db.execute(`
  SELECT a.id AS audit_id, a.company_id, a.user_id, a.details, a.created_at AS created_at
  FROM audit_logs a
  WHERE a.action = 'CREATE' AND a.entity = 'PRODUCT'
    AND a.created_at >= datetime('now', '-24 hours')
  ORDER BY a.id DESC
`);

console.log(`Encontrados ${creates.rows.length} CREATEs en últimas 24h\n`);

for (const c of creates.rows) {
  let d = {};
  try { d = JSON.parse(c.details); } catch {}
  const sku = d.sku || '(SIN SKU)';
  console.log(`[audit ${c.audit_id}] co=${c.company_id} usr=${c.user_id} ${c.created_at}`);
  console.log(`  name: "${d.name}"   sku: ${sku}`);

  // Buscar el producto actual en la BD
  if (d.sku) {
    const prod = await db.execute({
      sql: `SELECT id, sale_mode, stock, price FROM products WHERE sku = ? AND company_id = ? LIMIT 1`,
      args: [d.sku, c.company_id],
    });
    if (prod.rows.length === 0) {
      console.log(`  ⚠ Producto YA NO EXISTE en BD (sku=${d.sku})`);
    } else {
      const p = prod.rows[0];
      console.log(`  → producto actual: id=${p.id} sale_mode=${p.sale_mode} stock=${p.stock} price=${p.price}`);
    }

    // Buscar sync para este SKU después del create
    const sync = await db.execute({
      sql: `SELECT id, event, status, substr(message, 1, 60) AS message, substr(response, 1, 100) AS rsp, created_at
            FROM integration_sync_logs
            WHERE payload LIKE ? AND created_at >= ?
            ORDER BY id ASC LIMIT 5`,
      args: [`%"sku":"${d.sku}"%`, c.created_at],
    });
    if (sync.rows.length === 0) {
      console.log(`  ❌ SIN SYNC con la tienda tras el CREATE`);
    } else {
      for (const s of sync.rows) {
        console.log(`     [${s.id}] ${s.event} ${s.status} ${s.created_at}  ${s.message || ''}`);
      }
    }
  } else {
    console.log(`  ⚠ Producto creado SIN SKU → no se sincroniza`);
  }
  console.log('');
}
