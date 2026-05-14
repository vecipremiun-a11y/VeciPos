// Diagnóstico: estado de sincronización POS → Mini Veci para un producto.
// Uso:
//   node scripts/diag/check-sync-status.mjs               (resumen general)
//   node scripts/diag/check-sync-status.mjs 771279405163  (sku específico)

import { db } from '../optim/_client.mjs';

const sku = process.argv[2] || null;
console.log(`Diagnóstico sync POS → Tienda${sku ? `  SKU=${sku}` : ''}`);
console.log('='.repeat(70));

// 1) Config de integración por empresa
console.log('\n── Configuración de integración por empresa ──');
const cfg = await db.execute(`
  SELECT company_id, tienda_url, is_active,
         CASE WHEN api_key IS NOT NULL AND api_key <> '' THEN 'SI' ELSE 'NO' END AS has_key,
         CASE WHEN api_secret IS NOT NULL AND api_secret <> '' THEN 'SI' ELSE 'NO' END AS has_secret,
         updated_at
  FROM tienda_config
`);
for (const r of cfg.rows) {
  console.log(`  company=${r.company_id}  active=${r.is_active}  url=${r.tienda_url}  key=${r.has_key} secret=${r.has_secret}  updated=${r.updated_at}`);
}

// 2) Producto específico
if (sku) {
  console.log(`\n── Producto SKU=${sku} ──`);
  const prod = await db.execute({
    sql: `SELECT id, company_id, name, sku, sale_mode, stock, price, updated_at
          FROM products WHERE sku = ? OR sku = UPPER(?)`,
    args: [sku, sku],
  });
  for (const r of prod.rows) {
    console.log(`  id=${r.id} co=${r.company_id} name="${r.name}" sale_mode=${r.sale_mode} stock=${r.stock} price=${r.price} updated_at=${r.updated_at}`);
  }
}

// 3) Tabla de logs
console.log('\n── Schema integration_sync_logs ──');
try {
  const cols = await db.execute(`PRAGMA table_info(integration_sync_logs)`);
  console.log('  columns:', cols.rows.map(c => c.name).join(', '));
} catch (e) {
  console.log('  (no existe la tabla)', e.message);
  process.exit(0);
}

// 4) Últimos 15 logs (cualquier empresa)
console.log('\n── Últimos 15 syncs (todas las empresas) ──');
const last = await db.execute(`
  SELECT id, company_id, direction, event, status,
         substr(message, 1, 80) AS message,
         substr(payload, 1, 120) AS payload_preview,
         substr(response, 1, 120) AS response_preview,
         created_at
  FROM integration_sync_logs
  ORDER BY id DESC LIMIT 15
`);
for (const r of last.rows) {
  console.log(`  [${r.id}] co=${r.company_id} dir=${r.direction} ev=${r.event} st=${r.status}  ${r.created_at}`);
  if (r.message) console.log(`        msg: ${r.message}`);
  if (r.response_preview) console.log(`        rsp: ${r.response_preview}`);
  if (r.payload_preview && r.payload_preview.length < 100) console.log(`        pld: ${r.payload_preview}`);
}

// 5) Si pasaron SKU, filtra logs por SKU
if (sku) {
  console.log(`\n── Últimos 10 syncs con SKU "${sku}" ──`);
  const filtered = await db.execute({
    sql: `
      SELECT id, company_id, direction, event, status,
             substr(message, 1, 80) AS message,
             substr(response, 1, 150) AS response_preview,
             created_at
      FROM integration_sync_logs
      WHERE payload LIKE ? OR response LIKE ?
      ORDER BY id DESC LIMIT 10
    `,
    args: [`%${sku}%`, `%${sku}%`],
  });
  if (filtered.rows.length === 0) {
    console.log('  → No hay logs para este SKU. Sync NUNCA se disparó.');
  } else {
    for (const r of filtered.rows) {
      console.log(`  [${r.id}] co=${r.company_id} ${r.direction}/${r.event} st=${r.status}  ${r.created_at}`);
      if (r.message) console.log(`        msg: ${r.message}`);
      if (r.response_preview) console.log(`        rsp: ${r.response_preview}`);
    }
  }
}
