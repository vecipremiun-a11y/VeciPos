// FASE 5.5 · Tabla liviana para telemetría de fallback de queries analíticas.
//
// Diseño:
//   · Una sola tabla, sin foreign keys (independiente del resto del schema).
//   · Pensada para escribir muy poco (solo cuando hay fallback o error).
//   · Retención corta: borrar registros >30 días con un trigger o cron.
//   · Lectura sólo para diagnóstico — NUNCA usada por POS core.

import { db } from '../_client.mjs';

async function exists(table) {
  const r = await db.execute({
    sql: `SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`,
    args: [table],
  });
  return r.rows.length > 0;
}

async function indexExists(name) {
  const r = await db.execute({
    sql: `SELECT 1 FROM sqlite_master WHERE type='index' AND name=?`,
    args: [name],
  });
  return r.rows.length > 0;
}

console.log('FASE 5.5 · Telemetría — crear tabla analytics_telemetry');

if (await exists('analytics_telemetry')) {
  console.log('  ↪ tabla analytics_telemetry ya existe (skip)');
} else {
  await db.execute(`
    CREATE TABLE analytics_telemetry (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id   TEXT,
      event_type   TEXT NOT NULL,    -- 'fallback' | 'error' | 'gap_detected'
      query_name   TEXT NOT NULL,    -- 'productSalesHistory', etc.
      error_msg    TEXT,
      duration_ms  INTEGER,
      user_agent   TEXT,
      created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )
  `);
  console.log('  ✓ tabla analytics_telemetry creada');
}

const indexes = [
  ['idx_analytics_telemetry_created', 'analytics_telemetry(created_at)'],
  ['idx_analytics_telemetry_event_type', 'analytics_telemetry(event_type, created_at)'],
  ['idx_analytics_telemetry_company', 'analytics_telemetry(company_id, created_at)'],
];
for (const [name, cols] of indexes) {
  if (await indexExists(name)) {
    console.log(`  ↪ index ${name} ya existe (skip)`);
  } else {
    await db.execute(`CREATE INDEX ${name} ON ${cols}`);
    console.log(`  ✓ index ${name} creado`);
  }
}

// Tabla rollback opcional (drop limpia)
console.log('\nListo. Para diagnosticar:');
console.log(`  SELECT event_type, query_name, COUNT(*) c, MAX(created_at) last
            FROM analytics_telemetry
            WHERE created_at > datetime('now','-7 day')
            GROUP BY event_type, query_name ORDER BY c DESC;`);
