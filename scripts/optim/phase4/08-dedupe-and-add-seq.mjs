// FASE 4 · Hardening — añade columna `seq` + UNIQUE INDEX(sale_id, seq) y
// deduplica filas insertadas múltiples veces por timeouts/retries del cliente.
//
// Diagnóstico (script 07-dup-forensics.mjs):
//   Cada venta migrada en el backfill quedó con 2 grupos de filas (mismos
//   datos, distinto created_at). Probable: libsql client retransmitió un
//   batch al timeout y Turso lo aplicó dos veces.
//
// Solución idempotente:
//   1. ADD COLUMN seq (nullable) si no existe
//   2. Por cada sale_id: conservar el grupo MIN(created_at), eliminar el resto
//   3. Numerar seq = ROW_NUMBER por cada sale_id (orden estable por id ASC)
//   4. Crear UNIQUE INDEX (sale_id, seq) PARTIAL para protección futura
//   5. Idem en purchase_items
//
// El script es seguro de re-correr: cada paso es idempotente.

import { db } from '../_client.mjs';

async function colExists(table, col) {
  const r = await db.execute(`PRAGMA table_info(${table})`);
  return r.rows.some(c => c.name === col);
}

async function indexExists(name) {
  const r = await db.execute(`SELECT name FROM sqlite_master WHERE type='index' AND name='${name}'`);
  return r.rows.length > 0;
}

async function process(table, fkCol) {
  console.log(`\n=== ${table} ===`);

  // 1) ADD COLUMN seq si falta
  if (!(await colExists(table, 'seq'))) {
    console.log(`  + ALTER TABLE ${table} ADD COLUMN seq INTEGER`);
    await db.execute(`ALTER TABLE ${table} ADD COLUMN seq INTEGER`);
  } else {
    console.log(`  · columna seq ya existe`);
  }

  // 2) DEDUP: por cada fkCol, conservar grupo con MIN(created_at)
  console.log(`  · deduplicando ${table}...`);
  // Estrategia segura por chunks: SQLite no permite delete con CTE+JOIN fácilmente.
  // Conservamos las filas cuyo created_at es el MÍNIMO por fkCol, y eliminamos
  // todas las demás de cada grupo.
  const before = await db.execute(`SELECT COUNT(*) AS c FROM ${table}`);
  await db.execute(`
    DELETE FROM ${table}
    WHERE created_at > (
      SELECT MIN(t2.created_at) FROM ${table} t2 WHERE t2.${fkCol} = ${table}.${fkCol}
    )
  `);
  const after = await db.execute(`SELECT COUNT(*) AS c FROM ${table}`);
  console.log(`  · before=${before.rows[0].c}  after=${after.rows[0].c}  removed=${Number(before.rows[0].c) - Number(after.rows[0].c)}`);

  // 3) Numerar seq por fkCol (ROW_NUMBER simulado vía rowid relativo)
  // SQLite no tiene UPDATE...FROM con window funcs portable, así que lo hago
  // a mano en lotes por fkCol.
  console.log(`  · numerando seq...`);
  const fkValues = await db.execute(`
    SELECT DISTINCT ${fkCol} AS fk FROM ${table} WHERE seq IS NULL
  `);
  const fks = fkValues.rows.map(r => Number(r.fk));
  console.log(`  · ${fks.length} ${fkCol} pendientes de seq`);

  const CHUNK = 200;
  let done = 0;
  for (let i = 0; i < fks.length; i += CHUNK) {
    const block = fks.slice(i, i + CHUNK);
    // Para cada fk, hago un solo batch que numera por id ASC
    const queries = [];
    for (const fk of block) {
      // SQLite UPDATE con CASE no funciona limpio; uso una subquery con
      // ROW_NUMBER. En SQLite 3.25+ está soportado.
      queries.push({
        sql: `WITH ordered AS (
                SELECT id, ROW_NUMBER() OVER (ORDER BY id) - 1 AS rn
                FROM ${table} WHERE ${fkCol} = ?
              )
              UPDATE ${table} SET seq = (SELECT rn FROM ordered WHERE ordered.id = ${table}.id)
              WHERE ${fkCol} = ? AND seq IS NULL`,
        args: [fk, fk],
      });
    }
    if (queries.length) await db.batch(queries);
    done += block.length;
    if (done % 1000 === 0 || done === fks.length) {
      console.log(`    ${done}/${fks.length}`);
    }
  }

  // 4) UNIQUE INDEX(fkCol, seq) parcial (solo cuando seq NOT NULL)
  const idxName = `idx_uniq_${table}_${fkCol}_seq`;
  if (!(await indexExists(idxName))) {
    console.log(`  + CREATE UNIQUE INDEX ${idxName}`);
    await db.execute(`CREATE UNIQUE INDEX ${idxName} ON ${table}(${fkCol}, seq) WHERE seq IS NOT NULL`);
  } else {
    console.log(`  · índice ${idxName} ya existe`);
  }
}

await process('sale_items', 'sale_id');
await process('purchase_items', 'purchase_id');

// Verificación final
const sFinal = await db.execute(`SELECT COUNT(*) AS c, COUNT(DISTINCT sale_id) AS d FROM sale_items`);
const pFinal = await db.execute(`SELECT COUNT(*) AS c, COUNT(DISTINCT purchase_id) AS d FROM purchase_items`);
console.log(`\nFinal sale_items     rows=${sFinal.rows[0].c}  distinct sale_id=${sFinal.rows[0].d}`);
console.log(`Final purchase_items rows=${pFinal.rows[0].c}  distinct purchase_id=${pFinal.rows[0].d}`);

process.exit(0);
