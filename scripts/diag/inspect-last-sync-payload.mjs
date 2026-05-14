// Inspecciona el payload completo de la última sincronización de un SKU.
import { db } from '../optim/_client.mjs';

const sku = process.argv[2];
if (!sku) {
  console.log('Uso: node scripts/diag/inspect-last-sync-payload.mjs <sku>');
  process.exit(1);
}

const r = await db.execute({
  sql: `
    SELECT id, company_id, direction, event, status, message, payload, response, error, created_at
    FROM integration_sync_logs
    WHERE event = 'product.synced' AND payload LIKE ?
    ORDER BY id DESC LIMIT 1
  `,
  args: [`%"sku":"${sku}"%`],
});

if (r.rows.length === 0) {
  console.log(`No hay logs de product.synced para SKU=${sku}`);
  process.exit(0);
}

const row = r.rows[0];
console.log(`Log id=${row.id}  ${row.created_at}  status=${row.status}`);
console.log('\n── PAYLOAD enviado al POS → Tienda ──');
try {
  console.log(JSON.stringify(JSON.parse(row.payload), null, 2));
} catch {
  console.log(row.payload);
}
console.log('\n── RESPUESTA de la Tienda ──');
try {
  const r2 = JSON.parse(row.response);
  if (r2.body) {
    try { r2.body = JSON.parse(r2.body); } catch {}
  }
  console.log(JSON.stringify(r2, null, 2));
} catch {
  console.log(row.response);
}
