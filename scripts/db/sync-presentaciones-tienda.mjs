// scripts/db/sync-presentaciones-tienda.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Carga inicial de las unidades de medida (Caja, Bandeja, Pack…) en miniveci.cl.
//
// Desde el 17-oct-2026 cada cambio de una unidad de medida se manda solo (ver
// syncPresentationsToStore). Las que ya existían antes nunca viajaron: este
// script manda, producto por producto, la lista completa de cada uno. Es
// idempotente: correrlo dos veces no cambia nada allá (la segunda dice
// "unchanged").
//
// Correrlo DESPUÉS de que miniveci despliegue su lado (antes lo ignora sin
// error, así que no rompe, pero no sirve).
//
// SEGURIDAD: dry-run por defecto (solo lista). Con --apply manda a la tienda.
// Usa la base de .env.local (VITE_TURSO_DATABASE_URL), que es poskem-db: la de
// los clientes reales y la que está conectada a miniveci.cl.
//
// Uso:
//   node scripts/db/sync-presentaciones-tienda.mjs                     # lista, empresa default
//   node scripts/db/sync-presentaciones-tienda.mjs --apply             # manda
//   node scripts/db/sync-presentaciones-tienda.mjs --company=xxx --apply
// ─────────────────────────────────────────────────────────────────────────────

import dotenv from 'dotenv';

dotenv.config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const companyArg = process.argv.find(a => a.startsWith('--company='));
const COMPANY = companyArg ? companyArg.split('=')[1] : 'default';
const PAUSA_MS = 300;   // de a uno y con pausa: el endpoint de la tienda es por producto

const { turso } = await import('../../api/integration/_db.js');
const { syncPresentationsToStore } = await import('../../api/integration/client.js');

const r = await turso.execute({
    sql: `SELECT p.id, p.name, p.sku, p.unit, COUNT(pp.id) AS n
          FROM product_presentations pp
          JOIN products p ON p.id = pp.product_id AND p.company_id = pp.company_id
          WHERE pp.company_id = ?
          GROUP BY p.id ORDER BY p.name`,
    args: [COMPANY],
});
const productos = r.rows;
const porUnidad = productos.filter(p => (p.unit || 'Und') === 'Und');
console.log(`=== Unidades de medida → tienda · ${APPLY ? 'APPLY' : 'DRY-RUN'} · empresa ${COMPANY} ===`);
console.log(`${productos.length} productos con unidades de medida (${porUnidad.length} por unidad; los de peso no se mandan).`);

const totales = { ok: 0, error: 0, upserted: 0, unchanged: 0, deleted: 0, skipped: 0 };
for (const p of porUnidad) {
    if (!APPLY) { console.log(`  [dry] #${p.id} ${p.name} · ${p.n} unidad(es)`); continue; }
    const res = await syncPresentationsToStore({ companyId: COMPANY, productId: p.id });
    let resumen = '';
    try {
        const pr = JSON.parse(res?.body || '{}')?.presentations;
        if (pr && typeof pr === 'object') {
            for (const k of ['upserted', 'unchanged', 'deleted']) totales[k] += Number(pr[k]) || 0;
            totales.skipped += Array.isArray(pr.skipped) ? pr.skipped.length : 0;
            resumen = `upserted ${pr.upserted ?? 0} · unchanged ${pr.unchanged ?? 0} · deleted ${pr.deleted ?? 0}`
                + (pr.skipped?.length ? ` · SALTADAS ${JSON.stringify(pr.skipped)}` : '');
        } else {
            resumen = 'la tienda no devolvió "presentations" (¿todavía no desplegó su lado?)';
        }
    } catch { resumen = String(res?.body || res?.error || '').slice(0, 120); }
    if (res?.success) totales.ok++; else totales.error++;
    console.log(`  ${res?.success ? 'ok   ' : 'ERROR'} #${p.id} ${p.name} · ${resumen}`);
    await new Promise(resolve => setTimeout(resolve, PAUSA_MS));
}

if (APPLY) console.log('\nResumen:', totales);
else console.log('\nDRY-RUN: no se mandó nada. Re-ejecuta con --apply.');
process.exit(0);
