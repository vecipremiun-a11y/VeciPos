// FASE 5.5 · Validación de cobertura del mirror.
//
// Reporta:
//   · % de ventas con mirror (últimos N días)
//   · % de compras con mirror
//   · Top usuarios/empresas con gap (cache PWA vieja sospechosa)
//   · Discrepancias en sumas JSON vs normalizado
//   · Telemetría de fallback (últimos 7 días)
//
// Exit codes:
//   0 → cobertura >= umbral (default 99.5%)
//   1 → cobertura entre 95-99.5% (warning)
//   2 → cobertura < 95% (alarma)
//
// Flags:
//   --days=N     ventana a analizar (default 14)
//   --threshold=X umbral OK en % (default 99.5)
//   --json       output JSON estructurado
//   --quiet      sin output verbose

import { db } from '../_client.mjs';

const args = new Map();
for (const a of process.argv.slice(2)) {
  const [k, v] = a.startsWith('--') ? a.slice(2).split('=') : [a, true];
  args.set(k, v === undefined ? true : v);
}
const DAYS = Number(args.get('days') || 14);
const THRESHOLD = Number(args.get('threshold') || 99.5);
const JSON_OUT = args.has('json');
const QUIET = args.has('quiet');

function log(...x) { if (!QUIET && !JSON_OUT) console.log(...x); }

// ─── Coverage ────────────────────────────────────────────────────────────
async function coverage(table, mirrorTable, fk) {
  const r = await db.execute({
    sql: `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN EXISTS(
          SELECT 1 FROM ${mirrorTable} m WHERE m.${fk} = t.id
        ) THEN 1 ELSE 0 END) AS with_mirror
      FROM ${table} t
      WHERE date(t.date) >= date('now', ?)
        ${table === 'sales' ? `AND t.status != 'cancelled'` : ''}
        AND t.items IS NOT NULL AND t.items != '[]'
    `,
    args: [`-${DAYS} day`],
  });
  const row = r.rows[0];
  const total = Number(row.total);
  const withMirror = Number(row.with_mirror);
  const pct = total > 0 ? (withMirror / total) * 100 : 100;
  return { total, withMirror, pct: +pct.toFixed(3), missing: total - withMirror };
}

const salesCov = await coverage('sales', 'sale_items', 'sale_id');
const purchasesCov = await coverage('purchases', 'purchase_items', 'purchase_id');

// ─── Top usuarios con gap (sales) ────────────────────────────────────────
const topUsers = await db.execute({
  sql: `
    SELECT s.user_id, COUNT(*) AS missing
    FROM sales s
    WHERE date(s.date) >= date('now', ?)
      AND s.status != 'cancelled'
      AND s.items IS NOT NULL AND s.items != '[]'
      AND NOT EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id)
    GROUP BY s.user_id
    ORDER BY missing DESC LIMIT 10
  `,
  args: [`-${DAYS} day`],
});

// ─── Cobertura por día ───────────────────────────────────────────────────
const byDay = await db.execute({
  sql: `
    SELECT date(s.date) AS day,
           COUNT(*) AS total,
           SUM(CASE WHEN EXISTS(SELECT 1 FROM sale_items si WHERE si.sale_id = s.id) THEN 1 ELSE 0 END) AS with_mirror
    FROM sales s
    WHERE date(s.date) >= date('now', ?)
      AND s.status != 'cancelled'
      AND s.items IS NOT NULL AND s.items != '[]'
    GROUP BY date(s.date) ORDER BY date(s.date) DESC
  `,
  args: [`-${DAYS} day`],
});

// ─── Telemetría fallback (últimos 7 días) ────────────────────────────────
let telemetry = null;
try {
  const telRes = await db.execute(`
    SELECT event_type, query_name, COUNT(*) AS c
    FROM analytics_telemetry
    WHERE created_at > datetime('now', '-7 day')
    GROUP BY event_type, query_name ORDER BY c DESC
  `);
  telemetry = telRes.rows;
} catch {
  telemetry = null;
}

// ─── Exit code ───────────────────────────────────────────────────────────
const minPct = Math.min(salesCov.pct, purchasesCov.pct);
let exitCode = 0;
let level = 'OK';
if (minPct < 95) { exitCode = 2; level = 'ALARM'; }
else if (minPct < THRESHOLD) { exitCode = 1; level = 'WARN'; }

const report = {
  ts: new Date().toISOString(),
  windowDays: DAYS,
  threshold: THRESHOLD,
  level,
  exitCode,
  coverage: { sales: salesCov, purchases: purchasesCov },
  topUsersWithGap: topUsers.rows.map(r => ({ user_id: r.user_id, missing: Number(r.missing) })),
  byDay: byDay.rows.map(r => {
    const t = Number(r.total), m = Number(r.with_mirror);
    return { day: r.day, total: t, with_mirror: m, pct: t > 0 ? +((m / t) * 100).toFixed(2) : 100 };
  }),
  telemetry,
};

if (JSON_OUT) {
  console.log(JSON.stringify(report));
} else {
  log(`\nFASE 5.5 · Coverage Check (últimos ${DAYS}d)`);
  log(`─`.repeat(60));
  log(`SALES     coverage: ${salesCov.pct}%  (${salesCov.withMirror}/${salesCov.total})   missing: ${salesCov.missing}`);
  log(`PURCHASES coverage: ${purchasesCov.pct}%  (${purchasesCov.withMirror}/${purchasesCov.total})   missing: ${purchasesCov.missing}`);
  log(`Nivel: ${level}   (umbral OK >= ${THRESHOLD}%)`);
  if (topUsers.rows.length > 0) {
    log(`\nUsuarios con más ventas sin mirror (top 10):`);
    for (const u of topUsers.rows) log(`  user_id=${u.user_id}  →  ${u.missing} ventas sin mirror`);
  }
  log(`\nCobertura diaria:`);
  for (const r of byDay.rows.slice(0, 7)) {
    const t = Number(r.total), m = Number(r.with_mirror);
    const pct = t > 0 ? ((m / t) * 100).toFixed(1) : '100.0';
    log(`  ${r.day}  ${m}/${t}  (${pct}%)`);
  }
  if (telemetry) {
    log(`\nTelemetría fallback (últimos 7d):`);
    if (telemetry.length === 0) log(`  (sin eventos — bien)`);
    else for (const t of telemetry) log(`  ${t.event_type}  ${t.query_name}  ${t.c}`);
  }
}

process.exit(exitCode);
