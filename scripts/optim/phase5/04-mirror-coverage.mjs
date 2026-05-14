// Análisis temporal del mirror: ¿se ha caído desde algún punto, o falla
// intermitentemente? Si es intermitente, probablemente sea cache PWA en
// clientes individuales (sirven código viejo sin el mirror).
import { db } from '../_client.mjs';

const cos = await db.execute(`SELECT company_id FROM sale_items GROUP BY company_id ORDER BY COUNT(*) DESC LIMIT 1`);
const companyId = cos.rows[0].company_id;

// Últimas 200 ventas por sale_id, con bandera mirror_present
const res = await db.execute({
  sql: `
    SELECT s.id, s.date, s.user_id,
           (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS mirror_count
    FROM sales s
    WHERE s.company_id = ? AND s.status != 'cancelled'
    ORDER BY s.id DESC LIMIT 200
  `,
  args: [companyId],
});

let withMirror = 0;
let withoutMirror = 0;
const byUser = new Map(); // user_id → { ok, miss }
const noMirrorRange = { firstId: null, lastId: null };

for (const r of res.rows) {
  const ok = r.mirror_count > 0;
  if (ok) withMirror++; else withoutMirror++;
  const stats = byUser.get(r.user_id) || { ok: 0, miss: 0 };
  if (ok) stats.ok++; else {
    stats.miss++;
    if (noMirrorRange.firstId === null || r.id < noMirrorRange.firstId) noMirrorRange.firstId = r.id;
    if (noMirrorRange.lastId === null || r.id > noMirrorRange.lastId) noMirrorRange.lastId = r.id;
  }
  byUser.set(r.user_id, stats);
}

console.log(`Ventas analizadas (últimas 200): ${res.rows.length}`);
console.log(`  Con mirror:   ${withMirror}  (${(withMirror/res.rows.length*100).toFixed(1)}%)`);
console.log(`  Sin mirror:   ${withoutMirror}  (${(withoutMirror/res.rows.length*100).toFixed(1)}%)`);
console.log(`  Rango sin mirror: sale_id ${noMirrorRange.firstId} → ${noMirrorRange.lastId}`);
console.log(`\nPor usuario (ok/miss):`);
for (const [uid, s] of byUser) {
  const pct = s.miss > 0 ? `${(s.miss/(s.ok+s.miss)*100).toFixed(0)}% sin mirror` : '100% ok';
  console.log(`  user_id=${uid}:  ok=${s.ok}  miss=${s.miss}  → ${pct}`);
}

// Histograma temporal de los últimos días
const days = await db.execute({
  sql: `
    SELECT date(s.date) AS day,
           COUNT(*) AS total,
           SUM(CASE WHEN EXISTS(SELECT 1 FROM sale_items si WHERE si.sale_id = s.id) THEN 1 ELSE 0 END) AS with_mirror
    FROM sales s
    WHERE s.company_id = ? AND s.status != 'cancelled'
      AND date(s.date) >= date('now', '-14 day')
    GROUP BY date(s.date) ORDER BY date(s.date) DESC
  `,
  args: [companyId],
});
console.log(`\nCobertura mirror por día (últimos 14 días):`);
for (const r of days.rows) {
  const pct = r.total > 0 ? ((r.with_mirror / r.total) * 100).toFixed(1) : '0.0';
  console.log(`  ${r.day}:  ${r.with_mirror}/${r.total}  (${pct}%)`);
}
