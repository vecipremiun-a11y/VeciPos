// Migración · Módulo Sorteos (multiempresa)
// ─────────────────────────────────────────────────────────────────────────
// Crea la infraestructura para el menú "Sorteos":
//   1. companies.sorteo_token  → link público secreto por empresa
//      (mismo patrón que companies.kds_token: imposible de adivinar,
//       resuelve la empresa sin exponer su id ni el auth token de Turso).
//   2. Tabla sorteos            → 1 configuración activa por empresa.
//   3. Tabla sorteo_participants→ inscritos del sorteo de cada empresa.
//
// Idempotente: se puede correr varias veces sin romper nada.
//
// NO toca ninguna tabla del core (ventas, SII, inventario, sync). Es 100%
// aditiva → cero riesgo para lo existente.
//
// Uso:  node scripts/add_sorteos.mjs

import crypto from 'node:crypto';
import { db } from './optim/_client.mjs';

async function colExists(table, col) {
  const r = await db.execute(`PRAGMA table_info("${table}")`);
  return r.rows.some((x) => x.name === col);
}

function genToken() {
  // 24 hex chars (~96 bits) — imposible de adivinar, URL-safe.
  return 'srt_' + crypto.randomBytes(12).toString('hex');
}

console.log('Migration · Módulo Sorteos');
console.log('='.repeat(60));

// 1) companies.sorteo_token ────────────────────────────────────────────────
if (await colExists('companies', 'sorteo_token')) {
  console.log('  companies.sorteo_token ya existe — skip ALTER');
} else {
  await db.execute(`ALTER TABLE companies ADD COLUMN sorteo_token TEXT`);
  console.log('  OK  ALTER companies ADD sorteo_token');
}

// 2) Tabla sorteos (1 config activa por empresa) ────────────────────────────
await db.execute(`
  CREATE TABLE IF NOT EXISTS sorteos (
    company_id    TEXT PRIMARY KEY,
    name          TEXT NOT NULL DEFAULT 'Sorteo',
    draw_date     TEXT,
    active        INTEGER NOT NULL DEFAULT 1,
    bg_image      TEXT,
    field_name    INTEGER NOT NULL DEFAULT 1,
    field_phone   INTEGER NOT NULL DEFAULT 1,
    field_rut     INTEGER NOT NULL DEFAULT 0,
    field_email   INTEGER NOT NULL DEFAULT 0,
    field_boleta  INTEGER NOT NULL DEFAULT 1,
    field_address INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT,
    updated_at    TEXT
  )
`);
console.log('  OK  CREATE TABLE sorteos');

// 3) Tabla sorteo_participants ──────────────────────────────────────────────
await db.execute(`
  CREATE TABLE IF NOT EXISTS sorteo_participants (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id    TEXT NOT NULL,
    ticket_number INTEGER NOT NULL,
    name          TEXT,
    phone         TEXT,
    rut           TEXT,
    email         TEXT,
    boleta        TEXT,
    address       TEXT,
    created_at    TEXT
  )
`);
console.log('  OK  CREATE TABLE sorteo_participants');

await db.execute(`
  CREATE INDEX IF NOT EXISTS idx_sorteo_participants_company
    ON sorteo_participants(company_id)
`);
// "Una boleta = una inscripción" → unicidad parcial cuando hay boleta.
await db.execute(`
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_sorteo_boleta
    ON sorteo_participants(company_id, boleta)
    WHERE boleta IS NOT NULL AND boleta != ''
`);
console.log('  OK  índices sorteo_participants');

// 4) Generar token para empresas que no tengan ──────────────────────────────
const pend = await db.execute(
  `SELECT id, name FROM companies WHERE sorteo_token IS NULL OR sorteo_token = ''`
);
console.log(`\n  Empresas sin token de sorteo: ${pend.rows.length}`);
for (const c of pend.rows) {
  const token = genToken();
  await db.execute({
    sql: `UPDATE companies SET sorteo_token = ? WHERE id = ?`,
    args: [token, c.id],
  });
  console.log(`    ${c.name} (${c.id}) → ${token}`);
}

// 5) Imprimir todas las URLs (referencia) ───────────────────────────────────
console.log('\n' + '='.repeat(60));
console.log('URLs públicas de inscripción por empresa (reemplazar TU-DOMINIO):');
const all = await db.execute(
  `SELECT id, name, sorteo_token FROM companies ORDER BY created_at`
);
all.rows.forEach((c) => {
  console.log(`  ${c.name}:`);
  console.log(`    https://TU-DOMINIO/sorteo.html?token=${c.sorteo_token}`);
});

console.log('\nListo.');
process.exit(0);
