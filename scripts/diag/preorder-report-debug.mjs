// Diagnóstico SOLO LECTURA del estado de preorders para entender por qué
// el reporte no muestra algunos.
//
// Uso:
//   node scripts/diag/preorder-report-debug.mjs

import { db } from '../optim/_client.mjs';

console.log('Diagnóstico de preorders');
console.log('='.repeat(70));

// Lista todas las empresas para que el usuario sepa cuál es la activa
const companies = await db.execute(`
  SELECT DISTINCT company_id FROM preorders
`);
console.log('\nempresas con preorders:', companies.rows.map(r => r.company_id));

// Resumen por empresa
for (const c of companies.rows) {
  const cid = c.company_id;
  console.log(`\n${'='.repeat(70)}`);
  console.log(`COMPANY: ${cid}`);
  console.log('='.repeat(70));

  // Conteo por status
  const byStatus = await db.execute({
    sql: `SELECT status, COUNT(*) as count
          FROM preorders
          WHERE company_id = ?
          GROUP BY status
          ORDER BY count DESC`,
    args: [cid]
  });
  console.log('\nConteo por status:');
  byStatus.rows.forEach(r => console.log(`  ${r.status}: ${r.count}`));

  // Últimos 10 preorders con todas las columnas relevantes
  const recent = await db.execute({
    sql: `SELECT id, status, client_name, total_amount, estimated_total, real_total,
                 deposit_amount, remaining_amount, created_at, updated_at, due_date
          FROM preorders
          WHERE company_id = ?
          ORDER BY created_at DESC
          LIMIT 15`,
    args: [cid]
  });

  console.log('\nÚltimos 15 preorders (más recientes):');
  console.log('-'.repeat(70));
  recent.rows.forEach(r => {
    console.log(`#${r.id} [${r.status}] ${r.client_name || '(sin cliente)'}`);
    console.log(`  created_at  : ${r.created_at}`);
    console.log(`  updated_at  : ${r.updated_at || '(null)'}`);
    console.log(`  due_date    : ${r.due_date}`);
    console.log(`  total_amount     : ${r.total_amount}`);
    console.log(`  estimated_total  : ${r.estimated_total}`);
    console.log(`  real_total       : ${r.real_total}`);
    console.log(`  deposit_amount   : ${r.deposit_amount}`);
    console.log(`  remaining_amount : ${r.remaining_amount}`);
    console.log('');
  });

  // Formato del created_at (chequear si es ISO con 'T' o con espacio)
  const formats = await db.execute({
    sql: `SELECT
            SUBSTR(created_at, 1, 19) as sample,
            CASE WHEN created_at LIKE '%T%' THEN 'ISO_T' ELSE 'SPACE' END as fmt,
            COUNT(*) as count
          FROM preorders
          WHERE company_id = ?
          GROUP BY fmt
          ORDER BY count DESC`,
    args: [cid]
  });
  console.log('Formatos de created_at:');
  formats.rows.forEach(r => console.log(`  ${r.fmt} (ej: ${r.sample}): ${r.count}`));

  // Probar la query EXACTA del reporte para "ayer" y "hoy"
  // Suponiendo zona Chile (UTC-3 o UTC-4 según DST)
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10);

  for (const day of [yesterday, today]) {
    const start = `${day} 00:00:00`;
    const end = `${day} 23:59:59`;
    const r = await db.execute({
      sql: `SELECT COUNT(*) as c FROM preorders
            WHERE created_at >= ? AND created_at <= ? AND company_id = ?`,
      args: [start, end, cid]
    });
    console.log(`Query reporte ${day} (${start} a ${end}): ${r.rows[0].c} preorders`);
  }

  // Mismo rango pero buscando con LIKE para confirmar discrepancia
  for (const day of [yesterday, today]) {
    const r = await db.execute({
      sql: `SELECT COUNT(*) as c FROM preorders
            WHERE created_at LIKE ? AND company_id = ?`,
      args: [`${day}%`, cid]
    });
    console.log(`Query LIKE '${day}%': ${r.rows[0].c} preorders`);
  }
}

process.exit(0);
