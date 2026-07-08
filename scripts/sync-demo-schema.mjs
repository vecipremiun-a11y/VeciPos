// scripts/sync-demo-schema.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Espeja el ESQUEMA de PROD (poskem-db) sobre el DEMO (posveci-official-demo).
//   Fase 1 (aditivo, idempotente): CREATE TABLE / ADD COLUMN / CREATE INDEX
//   Fase 2 (limpieza, demo-only)  : DROP COLUMN de 3 sobrantes validados seguros
//   Fase 3 (versión)              : schema_version del demo = el de prod
//
// SEGURIDAD:
//   • PROD se usa SOLO LECTURA (jamás se le hace execute de escritura).
//   • Por defecto corre en DRY-RUN: imprime cada sentencia, no escribe nada.
//   • Con --apply ejecuta, y SOLO contra el cliente `demo`.
//   • Guarda contra apuntar el destino a prod por error.
//
// Uso:
//   node scripts/sync-demo-schema.mjs            # dry-run
//   node scripts/sync-demo-schema.mjs --apply    # aplica en DEMO
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@libsql/client';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.demo.local' }); // DEMO_TURSO_*
dotenv.config({ path: '.env.local' });      // VITE_TURSO_* (prod)
dotenv.config();

const APPLY = process.argv.includes('--apply');

const PROD_URL = process.env.VITE_TURSO_DATABASE_URL;
const PROD_TOKEN = process.env.VITE_TURSO_AUTH_TOKEN;
const DEMO_URL = process.env.DEMO_TURSO_DATABASE_URL;
const DEMO_TOKEN = process.env.DEMO_TURSO_AUTH_TOKEN;

if (!PROD_URL || !PROD_TOKEN) { console.error('Faltan credenciales de PROD (VITE_TURSO_*).'); process.exit(1); }
if (!DEMO_URL || !DEMO_TOKEN) { console.error('Faltan credenciales de DEMO (.env.demo.local).'); process.exit(1); }

// Guardas: el destino debe ser el demo, nunca prod.
if (DEMO_URL === PROD_URL) { console.error('ABORT: DEMO_URL es igual a PROD_URL.'); process.exit(1); }
if (!/posveci-official-demo/.test(DEMO_URL)) {
  console.error('ABORT: DEMO_URL no parece la base demo esperada:', DEMO_URL); process.exit(1);
}

const prod = createClient({ url: PROD_URL, authToken: PROD_TOKEN });
const demo = createClient({ url: DEMO_URL, authToken: DEMO_TOKEN });

const log = (...a) => console.log(...a);
const q = (name) => '"' + String(name).replace(/"/g, '""') + '"';

let queued = 0, ok = 0, failed = 0;

// run() SOLO escribe en demo. En dry-run no toca nada.
async function run(sql, label) {
  if (!APPLY) { queued++; log('  [dry] ' + sql.replace(/\s+/g, ' ').trim()); return; }
  try {
    await demo.execute(sql);
    ok++;
    log('  ✓ ' + (label || sql.slice(0, 80)));
  } catch (e) {
    failed++;
    log('  ✗ ' + (label || sql.slice(0, 80)) + '  ::  ' + e.message);
  }
}

async function introspect(db) {
  const master = (await db.execute(
    "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'"
  )).rows;
  const tables = master.filter(r => r.type === 'table');
  const indexes = master.filter(r => r.type === 'index' && r.sql); // omitir autoindex (sql NULL)
  const cols = {};      // tabla -> [nombres]
  const colInfo = {};   // tabla -> [{name,type,notnull,dflt_value,pk}]
  for (const t of tables) {
    const info = (await db.execute(`PRAGMA table_info(${q(t.name)})`)).rows;
    cols[t.name] = info.map(r => r.name);
    colInfo[t.name] = info;
  }
  return { tables, indexes, cols, colInfo, names: new Set(tables.map(t => t.name)) };
}

// SQLite solo permite DEFAULT constante en ADD COLUMN (no CURRENT_*, no expresiones).
function isConstantDefault(v) {
  if (v === null || v === undefined) return false;
  const s = String(v).trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return true;        // número
  if (/^'(?:[^']|'')*'$/.test(s)) return true;        // literal string
  if (/^(NULL|TRUE|FALSE)$/i.test(s)) return true;     // keywords
  return false;                                        // datetime('now'), CURRENT_TIMESTAMP, etc.
}

function buildAddColumn(table, ci) {
  let def = `ALTER TABLE ${q(table)} ADD COLUMN ${q(ci.name)} ${ci.type || ''}`.trim();
  const constDefault = isConstantDefault(ci.dflt_value);
  if (constDefault) def += ` DEFAULT ${ci.dflt_value}`;
  // NOT NULL solo si hay default constante (SQLite lo exige para ADD COLUMN)
  if (ci.notnull && constDefault) def += ' NOT NULL';
  return def;
}

(async () => {
  log(`=== sync-demo-schema · ${APPLY ? 'APPLY' : 'DRY-RUN'} ===`);
  log('PROD (solo lectura):', PROD_URL);
  log('DEMO (destino)     :', DEMO_URL);

  const P = await introspect(prod);
  const D = await introspect(demo);

  // ── Fase 1.1 · Tablas faltantes ───────────────────────────────────────────
  const missingTables = P.tables.filter(t => !D.names.has(t.name));
  log(`\n## Fase 1.1 · Tablas faltantes en demo: ${missingTables.length}`);
  for (const t of missingTables) {
    const sql = t.sql.replace(/^CREATE\s+TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS ');
    await run(sql, 'CREATE TABLE ' + t.name);
  }
  if (!missingTables.length) log('  (ninguna)');

  // ── Fase 1.2 · Columnas faltantes en tablas compartidas ───────────────────
  const shared = P.tables.filter(t => D.names.has(t.name)).map(t => t.name);
  log(`\n## Fase 1.2 · Columnas faltantes en tablas compartidas`);
  let addCount = 0;
  for (const t of shared) {
    const demoCols = new Set(D.cols[t]);
    for (const ci of P.colInfo[t]) {
      if (demoCols.has(ci.name)) continue;
      addCount++;
      await run(buildAddColumn(t, ci), `ADD COLUMN ${t}.${ci.name}`);
    }
  }
  if (!addCount) log('  (ninguna)');

  // ── Fase 1.3 · Índices faltantes ──────────────────────────────────────────
  const demoIdx = new Set(D.indexes.map(i => i.name));
  const missingIdx = P.indexes.filter(i => !demoIdx.has(i.name));
  log(`\n## Fase 1.3 · Índices faltantes: ${missingIdx.length}`);
  for (const i of missingIdx) {
    const sql = i.sql.replace(/^CREATE\s+(UNIQUE\s+)?INDEX\s+/i, (m) => m + 'IF NOT EXISTS ');
    await run(sql, 'CREATE INDEX ' + i.name);
  }
  if (!missingIdx.length) log('  (ninguno)');

  // ── Fase 2 · Limpieza de columnas sobrantes (demo-only, validadas seguras) ─
  log(`\n## Fase 2 · Limpieza de columnas sobrantes en demo`);
  const cleanup = [
    ['suspended_sales', 'co_id'],
    ['system_settings', 'company_id'],
    ['subscription_plans', 'interval'],
  ];
  for (const [t, c] of cleanup) {
    const info = D.colInfo[t];
    if (!info) { log(`  - ${t}: no existe en demo, skip`); continue; }
    const ci = info.find(x => x.name === c);
    if (!ci) { log(`  - ${t}.${c}: ya no existe, skip`); continue; }
    if (ci.pk) { log(`  - ${t}.${c}: es PK, NO se borra`); continue; }
    if (new Set(P.cols[t] || []).has(c)) { log(`  - ${t}.${c}: prod también la tiene, NO se borra`); continue; }
    await run(`ALTER TABLE ${q(t)} DROP COLUMN ${q(c)}`, `DROP COLUMN ${t}.${c}`);
  }

  // ── Fase 3 · Alinear schema_version con prod ──────────────────────────────
  const prodVer = (await prod.execute("SELECT value FROM system_settings WHERE key='schema_version'")).rows[0]?.value ?? '8';
  log(`\n## Fase 3 · schema_version del demo -> ${prodVer} (igualar a prod)`);
  await run(
    `INSERT INTO system_settings (key, value) VALUES ('schema_version', '${prodVer}') ` +
    `ON CONFLICT(key) DO UPDATE SET value = '${prodVer}'`,
    'SET schema_version=' + prodVer
  );

  // ── Resumen ───────────────────────────────────────────────────────────────
  log('\n=== Resumen ===');
  if (APPLY) log(`OK: ${ok}  ·  Errores: ${failed}`);
  else log(`Sentencias en cola (dry-run): ${queued}\nRe-ejecuta con --apply para aplicar en DEMO.`);

  process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('FALLO:', e); process.exit(1); });
