// FASE 4 · Limpieza final consolidadora.
//
// Hipótesis: durante la fase de validación post-dedupe, una transacción
// residual del cliente libsql reaplicó algunos batches del backfill (sin
// la columna seq populada porque el script viejo no la tenía). Esas filas
// están "huérfanas" (no validan, no idempotentes, no protegidas por UNIQUE).
//
// Plan:
//   1) Para cada sale_id que tiene filas con seq IS NULL Y filas con seq IS NOT NULL,
//      borrar las que tienen seq IS NULL (son duplicados claros).
//   2) Para sale_ids que SOLO tienen seq IS NULL, numerar su seq (re-uso lógica
//      del script 08).
//   3) Re-aplicar para purchases.
//   4) Verificar 0 filas con seq=NULL.

import { db } from '../_client.mjs';

async function cleanup(table, fkCol) {
  console.log(`\n=== ${table} ===`);

  // 1) Para cada FK con filas de ambos tipos: borrar seq IS NULL
  const dupRes = await db.execute(`
    SELECT ${fkCol} AS fk
    FROM (SELECT ${fkCol}, COUNT(*) AS cnull FROM ${table} WHERE seq IS NULL GROUP BY ${fkCol}) a
    WHERE EXISTS (
      SELECT 1 FROM ${table} b WHERE b.${fkCol} = a.${fkCol} AND b.seq IS NOT NULL
    )
  `);
  const dupFks = dupRes.rows.map(r => Number(r.fk));
  console.log(`  ${fkCol}s con filas duplicadas (con+sin seq): ${dupFks.length}`);

  if (dupFks.length > 0) {
    const CHUNK = 200;
    for (let i = 0; i < dupFks.length; i += CHUNK) {
      const block = dupFks.slice(i, i + CHUNK);
      const placeholders = block.map(() => '?').join(',');
      await db.execute({
        sql: `DELETE FROM ${table} WHERE seq IS NULL AND ${fkCol} IN (${placeholders})`,
        args: block,
      });
    }
    console.log(`  → DELETE de duplicados sin seq completado.`);
  }

  // 2) Para FKs que SÓLO tienen seq NULL: numerar
  const onlyNullRes = await db.execute(`
    SELECT DISTINCT ${fkCol} AS fk FROM ${table} WHERE seq IS NULL
  `);
  const onlyNullFks = onlyNullRes.rows.map(r => Number(r.fk));
  console.log(`  ${fkCol}s con sólo seq NULL: ${onlyNullFks.length}`);

  const CHUNK = 200;
  let done = 0;
  for (let i = 0; i < onlyNullFks.length; i += CHUNK) {
    const block = onlyNullFks.slice(i, i + CHUNK);
    const queries = block.map(fk => ({
      sql: `WITH ordered AS (
              SELECT id, ROW_NUMBER() OVER (ORDER BY id) - 1 AS rn
              FROM ${table} WHERE ${fkCol} = ?
            )
            UPDATE ${table} SET seq = (SELECT rn FROM ordered WHERE ordered.id = ${table}.id)
            WHERE ${fkCol} = ? AND seq IS NULL`,
      args: [fk, fk],
    }));
    if (queries.length) await db.batch(queries);
    done += block.length;
    if (done % 1000 === 0 || done === onlyNullFks.length) {
      console.log(`    ${done}/${onlyNullFks.length}`);
    }
  }

  const remaining = await db.execute(`SELECT COUNT(*) AS c FROM ${table} WHERE seq IS NULL`);
  console.log(`  Filas seq=NULL finales: ${remaining.rows[0].c}`);

  const totalFinal = await db.execute(`SELECT COUNT(*) AS c, COUNT(DISTINCT ${fkCol}) AS d FROM ${table}`);
  console.log(`  Final: rows=${totalFinal.rows[0].c}  distinct ${fkCol}=${totalFinal.rows[0].d}`);
}

await cleanup('sale_items', 'sale_id');
await cleanup('purchase_items', 'purchase_id');
