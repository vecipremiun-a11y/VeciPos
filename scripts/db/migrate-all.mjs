// scripts/db/migrate-all.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Aplica las migraciones de migrations/*.sql a TODAS las bases de databases.json,
// llevando la cuenta por base en system_settings.db_migration_version.
//
// SEGURIDAD: dry-run por defecto (no escribe). Con --apply ejecuta.
//
// Uso:
//   npm run migrate-all                       # dry-run, todas las bases
//   npm run migrate-all -- --apply            # aplica en todas
//   npm run migrate-all -- --only=poskem --apply   # solo una base (probar en dev)
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

dotenv.config({ path: '.env.databases.local' });
dotenv.config({ path: '.env.local' });
dotenv.config();

const APPLY = process.argv.includes('--apply');
const onlyArg = process.argv.find(a => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.split('=')[1] : null;

const ROOT = process.cwd();
const VERSION_KEY = 'db_migration_version';
const MIGRATIONS_DIR = path.join(ROOT, 'migrations');

const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'databases.json'), 'utf8'));

function loadMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => /^\d+.*\.sql$/i.test(f))
    .map(f => ({
      file: f,
      version: parseInt(f.match(/^(\d+)/)[1], 10),
      sql: fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'),
    }))
    .sort((a, b) => a.version - b.version);
}

async function getVersion(db) {
  await db.execute("CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT)");
  const r = await db.execute({ sql: "SELECT value FROM system_settings WHERE key = ?", args: [VERSION_KEY] });
  return r.rows.length ? (parseInt(r.rows[0].value, 10) || 0) : 0;
}

async function setVersion(db, v) {
  await db.execute({
    sql: "INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?",
    args: [VERSION_KEY, String(v), String(v)],
  });
}

const migrations = loadMigrations();
const top = migrations.length ? migrations[migrations.length - 1].version : 0;

console.log(`=== migrate-all · ${APPLY ? 'APPLY' : 'DRY-RUN'} ===`);
console.log(`Migraciones en repo: ${migrations.length}${top ? ` (hasta v${top})` : ''}`);

let dbs = registry.databases;
if (ONLY) {
  dbs = dbs.filter(d => d.name === ONLY);
  if (!dbs.length) { console.error(`No existe la base "${ONLY}" en databases.json`); process.exit(1); }
}

let totalApplied = 0, totalFailed = 0;

for (const d of dbs) {
  console.log(`\n── ${d.name} [${d.role}] ──`);
  const token = process.env[d.tokenEnv];
  if (!token) { console.log(`  ⚠️  sin token (${d.tokenEnv} no está en .env.databases.local) — SALTADA`); continue; }

  const db = createClient({ url: d.url, authToken: token });
  let current;
  try { current = await getVersion(db); }
  catch (e) { console.log('  ✗ no se pudo conectar/leer versión: ' + e.message); totalFailed++; continue; }

  const pending = migrations.filter(m => m.version > current);
  console.log(`  versión actual: v${current} · pendientes: ${pending.length}`);

  for (const m of pending) {
    if (!APPLY) { console.log(`  [dry] aplicaría ${m.file}`); continue; }
    try {
      await db.executeMultiple(m.sql);
      await setVersion(db, m.version);
      totalApplied++;
      console.log(`  ✓ ${m.file}  (→ v${m.version})`);
    } catch (e) {
      totalFailed++;
      console.log(`  ✗ ${m.file} FALLÓ: ${e.message}`);
      console.log('  → detengo esta base para no dejarla a medias (corrige y re-ejecuta).');
      break;
    }
  }
}

console.log('\n=== Resumen ===');
if (APPLY) console.log(`Migraciones aplicadas: ${totalApplied} · errores: ${totalFailed}`);
else console.log('DRY-RUN: nada aplicado. Re-ejecuta con --apply.');
process.exit(totalFailed > 0 ? 1 : 0);
