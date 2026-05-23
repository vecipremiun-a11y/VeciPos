// Agrega companies.kds_token (código secreto por empresa para la pantalla
// KDS de cocina) y genera uno random para cada empresa que no tenga.
//
// La URL del KDS pasa a usar ?token=XXXX (imposible de adivinar) en vez del
// company_id pelado → seguridad multiempresa real.
//
// Idempotente: solo genera token para empresas con kds_token NULL.
//
// Uso: node scripts/add_company_kds_token.mjs

import crypto from 'node:crypto';
import { db } from './optim/_client.mjs';

async function colExists(table, col) {
  const r = await db.execute(`PRAGMA table_info("${table}")`);
  return r.rows.some((x) => x.name === col);
}

function genToken() {
  // 24 hex chars (~96 bits) — imposible de adivinar, URL-safe.
  return 'kds_' + crypto.randomBytes(12).toString('hex');
}

console.log('Migration · companies.kds_token');
console.log('='.repeat(60));

if (await colExists('companies', 'kds_token')) {
  console.log('  companies.kds_token ya existe — skip ALTER');
} else {
  await db.execute(`ALTER TABLE companies ADD COLUMN kds_token TEXT`);
  console.log('  OK  ALTER companies ADD kds_token');
}

// Generar token para empresas que no tengan
const pend = await db.execute(`SELECT id, name FROM companies WHERE kds_token IS NULL OR kds_token = ''`);
console.log(`\n  Empresas sin token: ${pend.rows.length}`);
for (const c of pend.rows) {
  const token = genToken();
  await db.execute({ sql: `UPDATE companies SET kds_token = ? WHERE id = ?`, args: [token, c.id] });
  console.log(`    ${c.name} (${c.id}) → ${token}`);
}

// Imprimir todas las URLs (referencia para configurar cada TV)
console.log('\n' + '='.repeat(60));
console.log('URLs KDS por empresa (reemplazar TU-DOMINIO):');
const all = await db.execute(`SELECT id, name, kds_token FROM companies ORDER BY created_at`);
all.rows.forEach(c => {
  console.log(`  ${c.name}:`);
  console.log(`    https://TU-DOMINIO/kds.html?token=${c.kds_token}`);
});

console.log('\nListo.');
process.exit(0);
