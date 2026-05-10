// Verifica si CAFs 8, 9, 10 (tipo 39) tienen DTEs emitidos en sus rangos.
// Si no, propone (NO ejecuta) el UPDATE de recuperación.
import { createClient } from '@libsql/client';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
const url = env.match(/VITE_TURSO_DATABASE_URL=(.+)/)[1].trim();
const authToken = env.match(/VITE_TURSO_AUTH_TOKEN=(.+)/)[1].trim();
const db = createClient({ url, authToken });

const cafIds = [8, 9, 10];
const cafs = await db.execute({
  sql: `SELECT id, company_id, tipo_dte, folio_desde, folio_hasta, folio_actual, estado FROM sii_cafs WHERE id IN (${cafIds.join(',')})`,
});
console.log('=== CAFs a revisar ===');
console.table(cafs.rows);

for (const c of cafs.rows) {
  const dtes = await db.execute({
    sql: `SELECT COUNT(*) AS cnt, MIN(folio) AS min_f, MAX(folio) AS max_f
          FROM sii_dtes WHERE company_id = ? AND tipo_dte = ? AND folio BETWEEN ? AND ?`,
    args: [c.company_id, c.tipo_dte, c.folio_desde, c.folio_hasta],
  });
  const r = dtes.rows[0];
  console.log(`\nCAF id=${c.id}  rango ${c.folio_desde}-${c.folio_hasta}  →  DTEs emitidos en ese rango:`, r.cnt);
  if (Number(r.cnt) > 0) {
    console.log('  ⚠️ Tiene DTEs reales, NO se puede revertir libremente.');
  } else {
    console.log('  ✅ Sin DTEs en ese rango. Recuperable.');
  }
}

console.log('\n=== Folios reservados en sii_offline_folios para esos CAFs ===');
try {
  const off = await db.execute({
    sql: `SELECT caf_id, status, COUNT(*) AS qty, MIN(folio) AS min_f, MAX(folio) AS max_f
          FROM sii_offline_folios WHERE caf_id IN (${cafIds.join(',')}) GROUP BY caf_id, status`,
  });
  console.table(off.rows);
} catch (e) {
  console.log('sii_offline_folios:', e.message);
}

process.exit(0);
