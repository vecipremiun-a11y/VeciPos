// Agrega columna preorders.delivered_at + índice + backfill.
//
// Propósito: el reporte de ventas por encargo debe filtrar por fecha de
// ENTREGA real, no de creación. delivered_at se setea en deliverPreorder
// de aquí en adelante; para los entregados históricos se backfillea con
// updated_at (mejor aproximación de cuándo se marcó delivered).
//
// Idempotente: chequea existencia antes de crear.
//
// Uso:
//   node scripts/add_preorder_delivered_at.mjs

import { db } from './optim/_client.mjs';

async function colExists(table, col) {
  const r = await db.execute(`PRAGMA table_info("${table}")`);
  return r.rows.some((x) => x.name === col);
}

async function indexExists(name) {
  const r = await db.execute({
    sql: `SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`,
    args: [name],
  });
  return r.rows.length > 0;
}

console.log('Migration · preorders.delivered_at');
console.log('='.repeat(60));

// 1) ALTER TABLE ADD COLUMN delivered_at TEXT
if (await colExists('preorders', 'delivered_at')) {
  console.log('  preorders.delivered_at ya existe — skip ALTER');
} else {
  const t0 = Date.now();
  await db.execute(`ALTER TABLE preorders ADD COLUMN delivered_at TEXT`);
  console.log(`  OK  ALTER preorders ADD delivered_at  (${Date.now() - t0} ms)`);
}

// 2) Backfill: para entregados sin delivered_at, usar updated_at (o created_at
//    como último recurso). Solo afecta status = 'delivered'.
const bf = await db.execute(`
  UPDATE preorders
  SET delivered_at = COALESCE(updated_at, created_at)
  WHERE status = 'delivered' AND delivered_at IS NULL
`);
console.log(`  backfill: ${bf.rowsAffected} entregados con delivered_at`);

// 3) Índice para el filtro del reporte: (company_id, delivered_at)
//    Parcial sobre delivered para mantenerlo chico.
if (await indexExists('idx_preorders_company_delivered')) {
  console.log('  idx_preorders_company_delivered ya existe — skip');
} else {
  const t0 = Date.now();
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_preorders_company_delivered
    ON preorders(company_id, delivered_at)
    WHERE status = 'delivered'
  `);
  console.log(`  OK  idx_preorders_company_delivered  (${Date.now() - t0} ms)`);
}

// 4) Verificación: cuántos entregados quedaron con delivered_at poblado
const check = await db.execute(`
  SELECT
    COUNT(*) as total_delivered,
    SUM(CASE WHEN delivered_at IS NOT NULL THEN 1 ELSE 0 END) as with_delivered_at
  FROM preorders
  WHERE status = 'delivered'
`);
const row = check.rows[0];
console.log(`\n  Entregados: ${row.total_delivered} · con delivered_at: ${row.with_delivered_at}`);

console.log('\n' + '='.repeat(60));
console.log('Listo.');
process.exit(0);
