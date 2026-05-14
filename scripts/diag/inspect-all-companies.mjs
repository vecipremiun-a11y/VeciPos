// Audit logs CREATE PRODUCT en TODAS las empresas, últimas 48 h
import { db } from '../optim/_client.mjs';

console.log('CREATE PRODUCT en TODAS las empresas, últimas 48h:\n');
const r = await db.execute(`
  SELECT id, company_id, user_id, details, created_at
  FROM audit_logs
  WHERE action = 'CREATE' AND entity = 'PRODUCT'
    AND created_at >= datetime('now', '-48 hours')
  ORDER BY id DESC LIMIT 50
`);
console.log(`Encontrados: ${r.rows.length}\n`);
for (const a of r.rows) {
  let d = {};
  try { d = JSON.parse(a.details); } catch {}
  console.log(`  [${a.id}] co=${a.company_id} usr=${a.user_id}  ${a.created_at}`);
  console.log(`    "${d.name}"  sku=${d.sku || '(SIN)'}`);
}

// Ver también UPDATE recientes (por si el "creado" del usuario es realmente un UPDATE)
console.log('\n\nUPDATE PRODUCT en TODAS las empresas, últimas 6h (top 30):');
const r2 = await db.execute(`
  SELECT id, company_id, user_id, details, created_at
  FROM audit_logs
  WHERE action = 'UPDATE' AND entity = 'PRODUCT'
    AND created_at >= datetime('now', '-6 hours')
  ORDER BY id DESC LIMIT 30
`);
console.log(`Encontrados: ${r2.rows.length}\n`);
for (const a of r2.rows) {
  let d = {};
  try { d = JSON.parse(a.details); } catch {}
  const u = d.updates || {};
  console.log(`  [${a.id}] co=${a.company_id} usr=${a.user_id}  ${a.created_at}`);
  console.log(`    id=${d.id}  name="${u.name}"  sku=${u.sku || '(SIN)'} sale_mode=${u.sale_mode}`);
}

// Empresas
console.log('\n\nEmpresas en la BD:');
const co = await db.execute(`SELECT id, name FROM companies ORDER BY id`);
for (const c of co.rows) console.log(`  ${c.id}  →  ${c.name}`);
