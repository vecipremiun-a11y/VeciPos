// Reconstruye las tablas de resumen del día para una empresa, a partir de la
// verdad (`sales` + `sale_items`), porque las llamadas de agregación en segundo
// plano (updateAllAggregations -> saleAggregations) fallaron en silencio para
// una parte de las ventas de hoy — sin retry, sin cola, sin aviso. Ver el
// diagnóstico completo en la conversación del 3-sep-2026.
//
// Alcance A PROPÓSITO: solo tablas cuyo dato vive DENTRO de un día
// (sales_daily_summary, product_daily_profit, vendor_daily_performance,
// hourly_sales_stats). `product_movement_stats` queda AFUERA: es un contador
// histórico acumulado (total_sold_all_time, últimos 7/30 días) y reconstruirlo
// bien exige recorrer TODO el historial, no solo hoy — es una decisión aparte.
//
// Estrategia: para cada tabla, BORRAR las filas de hoy de esta empresa y
// volver a insertarlas calculadas de cero desde `sales`/`sale_items`. No se
// "suma el faltante": se recalcula entero, así no importa si el número viejo
// estaba mal por partida doble o simple.
//
// Antes de escribir nada, imprime ANTES/DESPUÉS y guarda el valor viejo en un
// archivo JSON para poder revertir a mano si hiciera falta.
//
//   node scripts/optim/backfill-agregaciones-hoy.mjs --db=poskem --company=default --day=2026-09-03 [--apply]
//
// Sin --apply: solo muestra qué haría (dry-run). Con --apply: escribe.

import { createClient } from '@libsql/client';
import { readFileSync, writeFileSync } from 'node:fs';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.databases.local' });
dotenv.config({ path: '.env.local' });
dotenv.config();

const arg = (name, fallback) => {
    const hit = process.argv.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const DBNAME = arg('db', 'poskem');
const CO = arg('company');
const DAY = arg('day');
const APPLY = process.argv.includes('--apply');

if (!CO || !DAY) {
    console.error('Uso: node backfill-agregaciones-hoy.mjs --db=poskem --company=<id> --day=YYYY-MM-DD [--apply]');
    process.exit(1);
}

const cfg = JSON.parse(readFileSync('databases.json', 'utf8'));
const entry = cfg.databases.find(d => d.name === DBNAME);
const db = createClient({ url: entry.url, authToken: process.env[entry.tokenEnv] });

const money = (n) => Number(n || 0).toLocaleString('es-CL', { maximumFractionDigits: 2 });

// ── El día es el día DE LA EMPRESA, no el del meridiano de Greenwich ──────
//
// `sales.date` se guarda en UTC. Chile va 4 horas atrás, así que el día UTC
// arranca a las 20:00 del día anterior en Chile. Filtrar por día UTC mete la
// venta de anoche adentro del total de hoy.
//
// Pasó de verdad el 3-sep-2026: se reparó el contador del día sumando por día
// UTC y quedó en $436.884 / 148 ventas cuando lo real eran $89.966 / 41. Las
// otras 107 eran del 2-sep chileno. El dueño lo cachó al toque porque el número
// no se parecía a su día.
//
// El resto del sistema ya lo hace bien: `updateAllAggregations` arma el día con
// `formatInCompanyTime(..., tz)`. Esta herramienta era la que estaba fuera de
// línea con eso.

/** Minutos de desfase de `tz` respecto de UTC en ese instante (maneja horario de verano). */
function desfaseMinutos(tz, fecha) {
    const partes = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(fecha);
    const p = {};
    for (const x of partes) p[x.type] = x.value;
    const comoSiFueraUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
    return (comoSiFueraUTC - fecha.getTime()) / 60000;
}

/** Instante UTC de la medianoche local de `dia` (YYYY-MM-DD) en `tz`. */
function medianocheLocalEnUTC(dia, tz) {
    const aproximado = new Date(`${dia}T00:00:00Z`);
    // Dos pasadas: la primera con el desfase aproximado, la segunda ya sobre el
    // instante correcto (importa en los días que cambia el horario de verano).
    let inicio = new Date(aproximado.getTime() - desfaseMinutos(tz, aproximado) * 60000);
    inicio = new Date(aproximado.getTime() - desfaseMinutos(tz, inicio) * 60000);
    return inicio;
}

// La primera corrida de este script se colgó en una llamada individual sin
// límite de tiempo (@libsql/client no trae uno por sí solo, a diferencia del
// navegador que sí lo tiene — ver fetchConLimite). Esto evita que vuelva a
// pasar: cualquier llamada que no conteste en 20s se da por perdida en vez de
// bloquear el script para siempre.
function conLimite(promesa, ms = 20000, etiqueta = '') {
    return Promise.race([
        promesa,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Tiempo agotado (${ms}ms) en: ${etiqueta}`)), ms)),
    ]);
}

console.log(`\n=== Reconstruir agregaciones de ${DAY} para "${CO}" en "${DBNAME}" ===`);
console.log(APPLY ? '>>> MODO APLICAR: va a escribir en la base <<<\n' : '(dry-run: no escribe nada — pasá --apply para escribir)\n');

// Zona horaria de la empresa: la fuente de verdad para saber qué es "hoy".
const tzRes = await conLimite(db.execute({
    sql: 'SELECT timezone FROM companies WHERE id = ?',
    args: [CO],
}), 15000, 'zona horaria');
const TZ = tzRes.rows[0]?.timezone || 'America/Santiago';

const DESDE = medianocheLocalEnUTC(DAY, TZ).toISOString();
const HASTA = medianocheLocalEnUTC(
    new Date(new Date(`${DAY}T12:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10),
    TZ,
).toISOString();

console.log(`Zona horaria de la empresa: ${TZ}`);
console.log(`El día ${DAY} va, en UTC, de ${DESDE} a ${HASTA}\n`);

const backup = { db: DBNAME, company: CO, day: DAY, tz: TZ, desde: DESDE, hasta: HASTA, timestamp: new Date().toISOString(), antes: {} };

// ── 1) sales_daily_summary ────────────────────────────────────────────────
const real = await conLimite(db.execute({
    sql: `SELECT COUNT(*) n, COALESCE(SUM(total), 0) suma FROM sales
          WHERE company_id = ? AND date >= ? AND date < ?`,
    args: [CO, DESDE, HASTA],
}), 15000, 'consulta #1');
const { n: ventasReales, suma: sumaReal } = real.rows[0];

const viejoResumen = await conLimite(db.execute({
    sql: 'SELECT * FROM sales_daily_summary WHERE company_id = ? AND day = ?',
    args: [CO, DAY],
}), 15000, 'consulta #2');
backup.antes.sales_daily_summary = viejoResumen.rows[0] || null;

console.log('1. sales_daily_summary');
console.log(`   antes:   total_sales=${money(viejoResumen.rows[0]?.total_sales)}  total_orders=${viejoResumen.rows[0]?.total_orders ?? 0}`);
console.log(`   real:    total_sales=${money(sumaReal)}  total_orders=${ventasReales}`);

if (APPLY) {
    await conLimite(db.execute({
        sql: `INSERT INTO sales_daily_summary (company_id, day, total_sales, total_orders, updated_at)
              VALUES (?, ?, ?, ?, datetime('now'))
              ON CONFLICT(company_id, day) DO UPDATE SET
                total_sales = excluded.total_sales,
                total_orders = excluded.total_orders,
                updated_at = excluded.updated_at`,
        args: [CO, DAY, sumaReal, ventasReales],
    }), 15000, 'consulta #3');
    console.log('   ✅ escrito');
}

// ── 2) vendor_daily_performance (por cajera) ────────────────────────────────
const porUsuario = await conLimite(db.execute({
    sql: `SELECT s.user_id, u.name AS user_name,
                 COUNT(*) n, SUM(s.total) suma,
                 MIN(s.date) primera, MAX(s.date) ultima
          FROM sales s LEFT JOIN users u ON u.id = s.user_id
          WHERE s.company_id = ? AND s.date >= ? AND s.date < ?
          GROUP BY s.user_id`,
    args: [CO, DESDE, HASTA],
}), 15000, 'consulta #4');

// Costo/ganancia por vendedor: hay que ir a sale_items (guardan cost/price/qty/tax_rate).
const itemsPorVendedor = await conLimite(db.execute({
    sql: `SELECT s.user_id, si.price, si.quantity, si.cost, si.tax_rate
          FROM sales s JOIN sale_items si ON si.sale_id = s.id
          WHERE s.company_id = ? AND s.date >= ? AND s.date < ?`,
    args: [CO, DESDE, HASTA],
}), 15000, 'consulta #5');
const gananciaPorUsuario = new Map();
const itemsVendidosPorUsuario = new Map();
for (const it of itemsPorVendedor.rows) {
    const price = Number(it.price) || 0;
    const qty = Number(it.quantity) || 0;
    const cost = Number(it.cost) || 0;
    const taxRate = Number(it.tax_rate) || 0;
    const netPrice = taxRate > 0 ? price / (1 + taxRate / 100) : price;
    const profit = (netPrice - cost) * qty;
    gananciaPorUsuario.set(it.user_id, (gananciaPorUsuario.get(it.user_id) || 0) + profit);
    itemsVendidosPorUsuario.set(it.user_id, (itemsVendidosPorUsuario.get(it.user_id) || 0) + qty);
}

console.log('\n2. vendor_daily_performance (por cajera)');
const viejoVdp = await conLimite(db.execute({
    sql: 'SELECT * FROM vendor_daily_performance WHERE company_id = ? AND date = ?',
    args: [CO, DAY],
}), 15000, 'consulta #6');
backup.antes.vendor_daily_performance = viejoVdp.rows;
const viejoPorUsuario = new Map(viejoVdp.rows.map(r => [r.user_id, r]));

for (const r of porUsuario.rows) {
    const viejo = viejoPorUsuario.get(r.user_id);
    console.log(`   user_id=${r.user_id} (${r.user_name || '?'})  antes: ${viejo?.total_sales ?? 0} ventas / $${money(viejo?.total_amount)}   real: ${r.n} ventas / $${money(r.suma)}`);
}

if (APPLY) {
    // DELETE + todos los INSERT en UN solo viaje (turso.batch), no uno por
    // cajera: es lo que colgó la corrida anterior — 200+ llamadas sueltas,
    // cada una esperando su propia ida y vuelta, sin límite de tiempo.
    const writes = [
        { sql: 'DELETE FROM vendor_daily_performance WHERE company_id = ? AND date = ?', args: [CO, DAY] },
    ];
    for (const r of porUsuario.rows) {
        const profit = gananciaPorUsuario.get(r.user_id) || 0;
        const itemsSold = itemsVendidosPorUsuario.get(r.user_id) || 0;
        const avgTicket = r.n > 0 ? Number(r.suma) / Number(r.n) : 0;
        writes.push({
            sql: `INSERT INTO vendor_daily_performance
                    (id, company_id, user_id, user_name, date, total_sales, total_amount, total_profit,
                     avg_ticket, total_items_sold, first_sale_time, last_sale_time, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
            args: [`perf_${CO}_${r.user_id}_${DAY}`, CO, r.user_id, r.user_name, DAY,
                r.n, r.suma, profit, avgTicket, itemsSold, r.primera, r.ultima],
        });
    }
    await conLimite(db.batch(writes, 'write'), 20000, 'vendor_daily_performance batch');
    console.log('   ✅ escrito');
}

// ── 3) product_daily_profit ─────────────────────────────────────────────────
const porProducto = await conLimite(db.execute({
    sql: `SELECT si.product_id, SUM(si.quantity) qty, si.price, si.cost, si.tax_rate
          FROM sales s JOIN sale_items si ON si.sale_id = s.id
          WHERE s.company_id = ? AND s.date >= ? AND s.date < ? AND si.is_combo = 0
          GROUP BY si.product_id, si.price, si.cost, si.tax_rate`,
    args: [CO, DESDE, HASTA],
}), 15000, 'consulta #7');
// Un mismo producto puede haberse vendido a precios distintos en el día (oferta,
// tramo por cantidad); se agrupa por producto sumando cada combinación precio/costo.
const totalesPorProducto = new Map();
for (const r of porProducto.rows) {
    const price = Number(r.price) || 0;
    const qty = Number(r.qty) || 0;
    const cost = Number(r.cost) || 0;
    const taxRate = Number(r.tax_rate) || 0;
    const netPrice = taxRate > 0 ? price / (1 + taxRate / 100) : price;
    const revenue = price * qty;
    const costTotal = cost * qty;
    const tax = (price * qty) - (netPrice * qty);
    const profit = (netPrice - cost) * qty;

    const acc = totalesPorProducto.get(r.product_id) || { qty: 0, revenue: 0, cost: 0, tax: 0, profit: 0 };
    acc.qty += qty; acc.revenue += revenue; acc.cost += costTotal; acc.tax += tax; acc.profit += profit;
    totalesPorProducto.set(r.product_id, acc);
}

console.log(`\n3. product_daily_profit -> ${totalesPorProducto.size} productos vendidos hoy`);
const viejoPdp = await conLimite(db.execute({
    sql: 'SELECT COUNT(*) n, COALESCE(SUM(total_profit),0) ganancia FROM product_daily_profit WHERE company_id = ? AND day = ?',
    args: [CO, DAY],
}), 15000, 'consulta #8');
const gananciaReal = [...totalesPorProducto.values()].reduce((a, x) => a + x.profit, 0);
console.log(`   antes: ${viejoPdp.rows[0].n} filas, ganancia=$${money(viejoPdp.rows[0].ganancia)}`);
console.log(`   real:  ${totalesPorProducto.size} filas, ganancia=$${money(gananciaReal)}`);

if (APPLY) {
    // 227 productos: en batch va todo en un viaje. Uno por uno fue lo que
    // colgó la corrida anterior.
    const writes = [
        { sql: 'DELETE FROM product_daily_profit WHERE company_id = ? AND day = ?', args: [CO, DAY] },
    ];
    for (const [productId, acc] of totalesPorProducto) {
        writes.push({
            sql: `INSERT INTO product_daily_profit
                    (company_id, product_id, day, total_quantity, total_revenue, total_cost, total_tax, total_profit, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            args: [CO, productId, DAY, acc.qty, acc.revenue, acc.cost, acc.tax, acc.profit],
        });
    }
    await conLimite(db.batch(writes, 'write'), 30000, 'product_daily_profit batch');
    console.log('   ✅ escrito');
}

// ── 4) hourly_sales_stats ───────────────────────────────────────────────────
// La hora también tiene que ser la LOCAL: si se agrupa por hora UTC, la venta
// de las 10 de la mañana en Chile queda anotada como si fueran las 14.
const desfaseHoras = desfaseMinutos(TZ, new Date(DESDE)) / 60;
const modificadorHora = `${desfaseHoras >= 0 ? '+' : ''}${desfaseHoras} hours`;

const porHora = await conLimite(db.execute({
    sql: `SELECT CAST(strftime('%H', datetime(date, ?)) AS INTEGER) hora, COUNT(*) n, SUM(total) suma
          FROM sales WHERE company_id = ? AND date >= ? AND date < ?
          GROUP BY hora`,
    args: [modificadorHora, CO, DESDE, HASTA],
}), 15000, 'consulta #9');
console.log(`\n4. hourly_sales_stats -> ${porHora.rows.length} horas con ventas`);
if (APPLY) {
    const writes = [
        { sql: 'DELETE FROM hourly_sales_stats WHERE company_id = ? AND date = ?', args: [CO, DAY] },
    ];
    for (const r of porHora.rows) {
        writes.push({
            sql: `INSERT INTO hourly_sales_stats (id, company_id, date, hour, total_sales, total_amount, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
            args: [`hourly_${CO}_${DAY}_${r.hora}`, CO, DAY, r.hora, r.n, r.suma],
        });
    }
    await conLimite(db.batch(writes, 'write'), 20000, 'hourly_sales_stats batch');
    console.log('   ✅ escrito');
}

// ── Verificación final + respaldo ───────────────────────────────────────────
if (APPLY) {
    const chequeo = await conLimite(db.execute({
        sql: 'SELECT total_sales, total_orders FROM sales_daily_summary WHERE company_id = ? AND day = ?',
        args: [CO, DAY],
    }), 15000, 'consulta #10');
    const ok = Number(chequeo.rows[0]?.total_sales) === Number(sumaReal)
        && Number(chequeo.rows[0]?.total_orders) === Number(ventasReales);
    console.log(`\n=== Verificación final: ${ok ? 'OK, coincide con la realidad' : 'ALGO NO CUADRA'} ===`);

    const archivo = `scripts/optim/backfill-respaldo-${CO}-${DAY}-${Date.now()}.json`;
    writeFileSync(archivo, JSON.stringify(backup, null, 2));
    console.log(`Respaldo del valor anterior guardado en: ${archivo}`);
} else {
    console.log('\n(dry-run: no se escribió nada. Revisá los números de arriba y corré de nuevo con --apply)');
}
