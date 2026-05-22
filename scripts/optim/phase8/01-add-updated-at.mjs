// FASE 8.2 · Añadir columnas updated_at + triggers + índices para sync incremental.
//
// Tablas tocadas (las que faltaban después de Fase 2.5):
//   · clients         — ADD COLUMN updated_at + trigger + idx
//   · categories      — ADD COLUMN updated_at + trigger + idx
//   · product_lots    — ADD COLUMN updated_at + trigger + idx
//   · tax_rates       — solo trigger + idx (la columna updated_at ya existía
//                       con DEFAULT CURRENT_TIMESTAMP pero sin trigger ni idx)
//
// Compatibilidad:
//   · ALTER TABLE ADD COLUMN es additive: no rompe queries existentes.
//   · La nueva columna es nullable; el backfill la rellena con created_at
//     si existe, sino con CURRENT_TIMESTAMP.
//   · Los triggers solo disparan en UPDATEs posteriores (las filas existentes
//     ya tienen updated_at backfilled).
//   · WHEN guard del trigger evita recursión infinita (mismo patrón que
//     Fase 2.5 para products).
//
// Idempotente: detecta si columna/trigger/índice ya existen y skipea.
//
// Cómo correrlo:
//   node scripts/optim/phase8/01-add-updated-at.mjs
//
// Después de correr esto, está habilitada Fase 8.3 (extender incremental a
// las 3 tablas).

import { db } from '../_client.mjs';

async function colExists(table, col) {
  const r = await db.execute(`PRAGMA table_info("${table}")`);
  return r.rows.some((x) => x.name === col);
}

async function triggerExists(name) {
  const r = await db.execute({
    sql: `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?`,
    args: [name],
  });
  return r.rows.length > 0;
}

async function indexExists(name) {
  const r = await db.execute({
    sql: `SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`,
    args: [name],
  });
  return r.rows.length > 0;
}

async function addUpdatedAtWithTrigger({ table, hasCreatedAt }) {
  console.log(`\n— ${table} —`);

  // 1) ALTER TABLE ADD COLUMN updated_at TEXT
  if (await colExists(table, 'updated_at')) {
    console.log(`  ${table}.updated_at ya existe — skip ALTER`);
  } else {
    const t0 = Date.now();
    await db.execute(`ALTER TABLE ${table} ADD COLUMN updated_at TEXT`);
    console.log(`  OK  ALTER ${table} ADD updated_at  (${Date.now() - t0} ms)`);
  }

  // 2) Backfill: created_at si existe, sino CURRENT_TIMESTAMP
  const backfillSql = hasCreatedAt
    ? `UPDATE ${table} SET updated_at = COALESCE(created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE updated_at IS NULL`
    : `UPDATE ${table} SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE updated_at IS NULL`;

  const bf = await db.execute(backfillSql);
  if (bf.rowsAffected > 0) {
    console.log(`      backfill: ${bf.rowsAffected} filas`);
  } else {
    console.log(`      backfill: 0 filas (ya estaba poblado)`);
  }

  // 3) Trigger AFTER UPDATE para auto-mantener updated_at
  const triggerName = `trg_${table}_updated_at`;
  if (await triggerExists(triggerName)) {
    console.log(`  ${triggerName} ya existe — skip`);
  } else {
    await db.execute(`
      CREATE TRIGGER ${triggerName}
      AFTER UPDATE ON ${table}
      FOR EACH ROW
      WHEN COALESCE(NEW.updated_at, '') = COALESCE(OLD.updated_at, '')
      BEGIN
        UPDATE ${table}
        SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = NEW.id;
      END;
    `);
    console.log(`  OK  trigger ${triggerName} creado`);
  }

  // 4) Índice (company_id, updated_at, id) para sync incremental
  const indexName = `idx_${table}_company_updated_id`;
  if (await indexExists(indexName)) {
    console.log(`  ${indexName} ya existe — skip`);
  } else {
    const t0 = Date.now();
    await db.execute(`
      CREATE INDEX IF NOT EXISTS ${indexName}
      ON ${table}(company_id, updated_at, id)
    `);
    console.log(`  OK  ${indexName}  (${Date.now() - t0} ms)`);
  }
}

console.log('Fase 8.2 · Añadir updated_at + triggers + índices');
console.log('='.repeat(60));

// Estas 3 no tienen updated_at todavía (verificado en snapshot 2026-05-12).
// Todas tienen created_at, así que el backfill usa ese valor.
await addUpdatedAtWithTrigger({ table: 'clients', hasCreatedAt: true });
await addUpdatedAtWithTrigger({ table: 'categories', hasCreatedAt: true });
await addUpdatedAtWithTrigger({ table: 'product_lots', hasCreatedAt: true });

// tax_rates ya tiene updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, pero le
// falta el trigger (para que UPDATEs lo actualicen) y el índice.
await addUpdatedAtWithTrigger({ table: 'tax_rates', hasCreatedAt: true });

console.log('\n' + '='.repeat(60));
console.log('Listo. Verificar con: node scripts/optim/phase8/02-verify-triggers.mjs');
process.exit(0);
