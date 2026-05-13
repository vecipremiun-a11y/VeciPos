// FASE 4 · Reporte de queries analíticas — comparativa
// JSON (estado actual con json_extract) vs sale_items normalizado.
//
// Esto es solo INFORMATIVO. NO se cambia la app aún. El objetivo es mostrar
// el potencial de speedup cuando, en una fase futura, decidamos migrar
// consultas de reporting a las tablas normalizadas.

import fs from 'node:fs';
import path from 'node:path';
import { db, nowStamp, REPORTS_DIR } from '../_client.mjs';

fs.mkdirSync(REPORTS_DIR, { recursive: true });
const stamp = nowStamp();
const reportPath = path.join(REPORTS_DIR, `phase4_explain_${stamp}.md`);

const lines = [];
lines.push(`# Fase 4 · Comparativa JSON vs Normalizado`);
lines.push(`*Generado: ${new Date().toISOString()}*`);
lines.push('');
lines.push('> Solo informativo — la app aún NO lee desde sale_items / purchase_items.');
lines.push('> Esto muestra el potencial de speedup futuro.');
lines.push('');

// 1) Necesito una compañía con datos para usar como ejemplo
const sampleCo = await db.execute(`
  SELECT company_id, COUNT(*) AS c FROM sale_items
  GROUP BY company_id ORDER BY c DESC LIMIT 1
`);
const companyId = sampleCo.rows[0]?.company_id;
if (!companyId) {
  lines.push('⚠️ No hay datos en sale_items aún. Ejecuta el backfill primero.');
  fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');
  console.log(`Reporte: ${reportPath}`);
  process.exit(0);
}
lines.push(`**Empresa de muestra:** \`${companyId}\``);
lines.push('');

const queries = [
  {
    label: 'Top-10 productos más vendidos último mes',
    json: {
      sql: `EXPLAIN QUERY PLAN
            SELECT s.id, s.items FROM sales s
            WHERE s.company_id = ?
              AND s.date >= datetime('now', '-30 days')
              AND s.status = 'completed'`,
      args: [companyId],
    },
    normalized: {
      sql: `EXPLAIN QUERY PLAN
            SELECT product_id, SUM(quantity) AS qty
            FROM sale_items
            WHERE company_id = ?
              AND sale_date >= datetime('now', '-30 days')
              AND product_id IS NOT NULL
            GROUP BY product_id
            ORDER BY qty DESC LIMIT 10`,
      args: [companyId],
    },
  },
  {
    label: 'Histórico ventas de un producto (90 días)',
    json: {
      sql: `EXPLAIN QUERY PLAN
            SELECT id, items FROM sales
            WHERE company_id = ?
              AND date >= datetime('now', '-90 days')`,
      args: [companyId],
    },
    normalized: {
      sql: `EXPLAIN QUERY PLAN
            SELECT sale_date, quantity, price
            FROM sale_items
            WHERE company_id = ? AND product_id = ?
              AND sale_date >= datetime('now', '-90 days')
            ORDER BY sale_date DESC`,
      args: [companyId, 1],
    },
  },
  {
    label: 'Ingresos por producto último mes',
    json: {
      sql: `EXPLAIN QUERY PLAN
            SELECT s.items FROM sales s
            WHERE s.company_id = ?
              AND s.date >= datetime('now', '-30 days')`,
      args: [companyId],
    },
    normalized: {
      sql: `EXPLAIN QUERY PLAN
            SELECT product_id, SUM(quantity * price * (1 - discount_pct/100.0)) AS revenue
            FROM sale_items
            WHERE company_id = ?
              AND sale_date >= datetime('now', '-30 days')
              AND product_id IS NOT NULL
            GROUP BY product_id
            ORDER BY revenue DESC`,
      args: [companyId],
    },
  },
];

async function timed(label, q) {
  const t0 = Date.now();
  const r = await db.execute(q);
  return { rows: r.rows.map(row => row.detail), ms: Date.now() - t0, label };
}

async function timedFetch(q) {
  const sql = q.sql.replace(/^\s*EXPLAIN QUERY PLAN\s+/i, '');
  const t0 = Date.now();
  const r = await db.execute({ sql, args: q.args });
  return { count: r.rows.length, ms: Date.now() - t0 };
}

for (const qq of queries) {
  lines.push(`## ${qq.label}`);
  lines.push('');
  lines.push('### Plan — vía JSON (actual)');
  lines.push('```sql');
  lines.push(qq.json.sql.replace(/\n\s+/g, '\n').trim());
  lines.push('```');
  const planJson = await timed('json', qq.json);
  for (const ln of planJson.rows) lines.push(`- ${ln}`);

  lines.push('');
  lines.push('### Plan — vía sale_items (normalizado)');
  lines.push('```sql');
  lines.push(qq.normalized.sql.replace(/\n\s+/g, '\n').trim());
  lines.push('```');
  const planNorm = await timed('norm', qq.normalized);
  for (const ln of planNorm.rows) lines.push(`- ${ln}`);

  // Tiempo real (no EXPLAIN), aproximado
  try {
    const realJson = await timedFetch(qq.json);
    const realNorm = await timedFetch(qq.normalized);
    lines.push('');
    lines.push(`### Tiempo real (ejecución, no solo EXPLAIN)`);
    lines.push(`- vía JSON:        ${realJson.ms} ms (${realJson.count} filas)`);
    lines.push(`- vía normalizado: ${realNorm.ms} ms (${realNorm.count} filas)`);
    if (realJson.ms > 0 && realNorm.ms > 0) {
      lines.push(`- speedup: **${(realJson.ms / realNorm.ms).toFixed(2)}×**`);
    }
  } catch (e) {
    lines.push('');
    lines.push(`(no se pudo medir tiempo real: ${e.message})`);
  }
  lines.push('');
}

fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');
console.log(`Reporte: ${reportPath}`);
process.exit(0);
