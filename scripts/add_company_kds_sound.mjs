// Agrega companies.kds_sound — guarda el id del sonido de aviso de nuevos
// pedidos elegido por la empresa, para que la pantalla KDS (TV) use el mismo
// que la pantalla de Producción.
//
// Valores: 'crystal-ping' | 'zen-chime' | 'soft-pop' | 'cinematic-arrival'
//          | 'double-ding' | 'warm-marimba'  (ver src/utils/productionSounds.js)
// NULL → el KDS usa el default 'crystal-ping'.
//
// Idempotente. Uso: node scripts/add_company_kds_sound.mjs

import { db } from './optim/_client.mjs';

async function colExists(table, col) {
  const r = await db.execute(`PRAGMA table_info("${table}")`);
  return r.rows.some((x) => x.name === col);
}

console.log('Migration · companies.kds_sound');
console.log('='.repeat(60));

if (await colExists('companies', 'kds_sound')) {
  console.log('  companies.kds_sound ya existe — skip ALTER');
} else {
  await db.execute(`ALTER TABLE companies ADD COLUMN kds_sound TEXT`);
  console.log('  OK  ALTER companies ADD kds_sound');
}

console.log('\nListo.');
process.exit(0);
