// Agrega payment_terminals.commission_includes_iva: si la tasa que el usuario
// configuró YA incluye el IVA (1) o si POSVECI debe sumarle 19% (0, default).
//
// Casi todos los datáfonos chilenos cobran "X% + IVA" → default 0 es el caso
// común. El usuario puede marcar el toggle si su datáfono ya le pasa la tasa
// con IVA incluido.
//
// Uso: node scripts/add_terminal_iva_flag.mjs

import { db } from './optim/_client.mjs';

async function colExists(table, col) {
  const r = await db.execute(`PRAGMA table_info("${table}")`);
  return r.rows.some((x) => x.name === col);
}

console.log('Migration · payment_terminals.commission_includes_iva');
console.log('='.repeat(70));

if (await colExists('payment_terminals', 'commission_includes_iva')) {
  console.log('  ya existe — skip');
} else {
  const t0 = Date.now();
  await db.execute(`ALTER TABLE payment_terminals ADD COLUMN commission_includes_iva INTEGER DEFAULT 0`);
  console.log(`  OK  ALTER payment_terminals ADD commission_includes_iva  (${Date.now() - t0} ms)`);
}

console.log('\n' + '='.repeat(70));
console.log('Listo.');
process.exit(0);
