// Migración aditiva e idempotente para la función "Conciliación de Datáfonos":
//   - payment_terminals.commission_rate (%) y .fixed_fee  → comisión por venta
//   - payment_reconciliations            → historial de abonos conciliados
//
// Uso: node scripts/add_reconciliation_tables.mjs

import { db } from './optim/_client.mjs';

async function colExists(table, col) {
  const r = await db.execute(`PRAGMA table_info("${table}")`);
  return r.rows.some((x) => x.name === col);
}

async function tableExists(name) {
  const r = await db.execute(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [name]);
  return r.rows.length > 0;
}

console.log('Migration · payment_terminals.commission + payment_reconciliations');
console.log('='.repeat(70));

// 1. payment_terminals.commission_rate
if (await colExists('payment_terminals', 'commission_rate')) {
  console.log('  payment_terminals.commission_rate ya existe — skip');
} else {
  const t0 = Date.now();
  await db.execute(`ALTER TABLE payment_terminals ADD COLUMN commission_rate REAL DEFAULT 0`);
  console.log(`  OK  ALTER payment_terminals ADD commission_rate  (${Date.now() - t0} ms)`);
}

// 2. payment_terminals.fixed_fee
if (await colExists('payment_terminals', 'fixed_fee')) {
  console.log('  payment_terminals.fixed_fee ya existe — skip');
} else {
  const t0 = Date.now();
  await db.execute(`ALTER TABLE payment_terminals ADD COLUMN fixed_fee REAL DEFAULT 0`);
  console.log(`  OK  ALTER payment_terminals ADD fixed_fee  (${Date.now() - t0} ms)`);
}

// 3. payment_reconciliations
if (await tableExists('payment_reconciliations')) {
  console.log('  payment_reconciliations ya existe — skip');
} else {
  const t0 = Date.now();
  await db.execute(`
    CREATE TABLE payment_reconciliations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id TEXT NOT NULL,
      terminal_id INTEGER,
      deposit_date TEXT NOT NULL,
      deposit_amount REAL NOT NULL,
      expected_amount REAL NOT NULL,
      difference REAL NOT NULL,
      sale_ids TEXT,
      sales_from TEXT,
      sales_to TEXT,
      notes TEXT,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_payment_reconciliations_company_date ON payment_reconciliations(company_id, deposit_date DESC)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_payment_reconciliations_terminal ON payment_reconciliations(terminal_id)`);
  console.log(`  OK  CREATE payment_reconciliations + indexes  (${Date.now() - t0} ms)`);
}

console.log('\n' + '='.repeat(70));
console.log('Listo.');
process.exit(0);
