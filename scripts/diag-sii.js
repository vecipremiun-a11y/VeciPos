// Diagnóstico SII - solo lectura
import { createClient } from '@libsql/client';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
const url = env.match(/VITE_TURSO_DATABASE_URL=(.+)/)[1].trim();
const authToken = env.match(/VITE_TURSO_AUTH_TOKEN=(.+)/)[1].trim();
const db = createClient({ url, authToken });

const SALE_ID = Number(process.argv[2] || 40978);

console.log('=== Sale', SALE_ID, '===');
const sale = await db.execute({
  sql: `SELECT id, company_id, total, payment_method, document_type, sii_dte_id, sii_folio, sii_tipo_dte, sii_estado, created_at FROM sales WHERE id = ?`,
  args: [SALE_ID],
}).catch(async (e) => {
  console.log('intento simple por columnas faltantes:', e.message);
  return db.execute({ sql: `SELECT * FROM sales WHERE id = ?`, args: [SALE_ID] });
});
console.table(sale.rows);

const companyId = sale.rows[0]?.company_id;
console.log('\ncompany_id:', companyId);

console.log('\n=== sii_dtes para sale', SALE_ID, '===');
const dtes = await db.execute({
  sql: `SELECT id, company_id, sale_id, tipo_dte, folio, estado, track_id, monto_total, created_at, updated_at FROM sii_dtes WHERE sale_id = ? ORDER BY id DESC`,
  args: [SALE_ID],
});
console.table(dtes.rows);

if (companyId) {
  console.log('\n=== sii_dtes recientes empresa ===');
  const recent = await db.execute({
    sql: `SELECT id, sale_id, tipo_dte, folio, estado, created_at FROM sii_dtes WHERE company_id = ? ORDER BY id DESC LIMIT 10`,
    args: [companyId],
  });
  console.table(recent.rows);

  console.log('\n=== sii_cafs por estado/tipo ===');
  const cafs = await db.execute({
    sql: `SELECT id, tipo_dte, folio_desde, folio_hasta, folio_actual, estado, created_at, updated_at,
                 (folio_hasta - folio_actual + 1) AS disponibles
          FROM sii_cafs WHERE company_id = ? ORDER BY tipo_dte, id DESC`,
    args: [companyId],
  });
  console.table(cafs.rows);

  console.log('\n=== Resumen folios disponibles por tipo (estado=active) ===');
  const summary = await db.execute({
    sql: `SELECT tipo_dte, COUNT(*) AS cafs_activos,
                 SUM(CASE WHEN folio_hasta >= folio_actual THEN folio_hasta - folio_actual + 1 ELSE 0 END) AS disponibles
          FROM sii_cafs WHERE company_id = ? AND estado = 'active' GROUP BY tipo_dte`,
    args: [companyId],
  });
  console.table(summary.rows);

  console.log('\n=== Folios pre-reservados (si existe la tabla) ===');
  try {
    const reserved = await db.execute({
      sql: `SELECT tipo_dte, estado, COUNT(*) AS qty, MIN(folio) AS min_folio, MAX(folio) AS max_folio
            FROM sii_reserved_folios WHERE company_id = ? GROUP BY tipo_dte, estado`,
      args: [companyId],
    });
    console.table(reserved.rows);
  } catch (e) {
    console.log('sii_reserved_folios no disponible:', e.message);
  }
}

process.exit(0);
