// Agrega preorder_payments.auth_code: código de autorización del datáfono
// (el de 6 dígitos del recibo). Se usa para cruzar contra el XLSX del banco
// con match 100% exacto (más confiable que monto + hora).
//
// Uso: node scripts/add_preorder_payments_auth_code.mjs

import { db } from './optim/_client.mjs';

async function colExists(table, col) {
  const r = await db.execute(`PRAGMA table_info("${table}")`);
  return r.rows.some((x) => x.name === col);
}

console.log('Migration · preorder_payments.auth_code');
console.log('='.repeat(60));

if (await colExists('preorder_payments', 'auth_code')) {
  console.log('  auth_code ya existe — skip');
} else {
  const t0 = Date.now();
  await db.execute(`ALTER TABLE preorder_payments ADD COLUMN auth_code TEXT`);
  console.log(`  OK  ALTER preorder_payments ADD auth_code  (${Date.now() - t0} ms)`);
}

console.log('\n' + '='.repeat(60));
console.log('Listo.');
process.exit(0);
