import { db } from '../_client.mjs';

const r1 = await db.execute(`SELECT source, COUNT(*) AS c FROM sale_items GROUP BY source`);
console.log('sale_items por source:');
for (const r of r1.rows) console.log(`  ${r.source.padEnd(10)} ${r.c}`);

const r2 = await db.execute(`SELECT MIN(created_at) AS mn, MAX(created_at) AS mx FROM sale_items WHERE source = 'live'`);
console.log(`  live    range: ${r2.rows[0].mn} → ${r2.rows[0].mx}`);

const r3 = await db.execute(`SELECT MIN(created_at) AS mn, MAX(created_at) AS mx FROM sale_items WHERE source = 'backfill'`);
console.log(`  backfill range: ${r3.rows[0].mn} → ${r3.rows[0].mx}`);

const r4 = await db.execute(`SELECT source, COUNT(*) AS c FROM purchase_items GROUP BY source`);
console.log('\npurchase_items por source:');
for (const r of r4.rows) console.log(`  ${r.source.padEnd(10)} ${r.c}`);
