// Recupera CAFs 8, 9, 10: revierte folio_actual = folio_desde, estado='active'
// y elimina las reservas en sii_offline_folios. SOLO toca esos 3 CAFs.
import { createClient } from '@libsql/client';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
const url = env.match(/VITE_TURSO_DATABASE_URL=(.+)/)[1].trim();
const authToken = env.match(/VITE_TURSO_AUTH_TOKEN=(.+)/)[1].trim();
const db = createClient({ url, authToken });

const cafIds = [8, 9, 10];
const now = new Date().toISOString();

console.log('Estado ANTES:');
const before = await db.execute(`SELECT id, folio_desde, folio_hasta, folio_actual, estado FROM sii_cafs WHERE id IN (${cafIds.join(',')})`);
console.table(before.rows);

const offBefore = await db.execute(`SELECT caf_id, status, COUNT(*) AS qty FROM sii_offline_folios WHERE caf_id IN (${cafIds.join(',')}) GROUP BY caf_id, status`);
console.table(offBefore.rows);

console.log('\nEjecutando recuperación...');
await db.batch([
  { sql: `UPDATE sii_cafs SET folio_actual = folio_desde, estado = 'active', updated_at = ? WHERE id IN (${cafIds.join(',')}) AND id IN (SELECT id FROM sii_cafs WHERE id IN (${cafIds.join(',')}))`, args: [now] },
  { sql: `DELETE FROM sii_offline_folios WHERE caf_id IN (${cafIds.join(',')}) AND status = 'reserved'`, args: [] },
], 'write');

console.log('\nEstado DESPUÉS:');
const after = await db.execute(`SELECT id, folio_desde, folio_hasta, folio_actual, estado, updated_at FROM sii_cafs WHERE id IN (${cafIds.join(',')})`);
console.table(after.rows);

const offAfter = await db.execute(`SELECT caf_id, status, COUNT(*) AS qty FROM sii_offline_folios WHERE caf_id IN (${cafIds.join(',')}) GROUP BY caf_id, status`);
console.log('Reservas restantes:');
console.table(offAfter.rows);

console.log('\n=== Resumen folios disponibles por tipo (estado=active) ===');
const summary = await db.execute({
  sql: `SELECT tipo_dte, COUNT(*) AS cafs_activos,
               SUM(folio_hasta - folio_actual + 1) AS disponibles
        FROM sii_cafs WHERE company_id = ? AND estado = 'active' GROUP BY tipo_dte`,
  args: ['default'],
});
console.table(summary.rows);

process.exit(0);
