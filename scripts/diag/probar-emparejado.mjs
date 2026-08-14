// Mide el emparejador contra el catálogo real, con los renglones de la factura
// de Evercrisp que quedaron afuera.
//
// Lee siempre; solo escribe si se le pasa --aprender, y en ese caso borra los
// alias que creó al terminar.

import dotenv from 'dotenv';
import { createClient } from '@libsql/client';
import { buscarProducto, purchaseActions } from '../../api/_lib/purchaseActions.js';
dotenv.config({ path: '.env.local' });

const turso = createClient({
    url: process.env.VITE_TURSO_DATABASE_URL,
    authToken: process.env.VITE_TURSO_AUTH_TOKEN,
});

const EMPRESA = 'default';
const APRENDER = process.argv.includes('--aprender');

const CASOS = [
    { codigo: '300065901', desc: 'DETODITO II 64G' },
    { codigo: '300065523', desc: 'LAYS 45G' },
    { codigo: '300061077', desc: 'DINAMITA FH 100' },
    { codigo: '300054969', desc: 'CHISPCP 200GX12' },
    { codigo: '300066281', desc: 'CHEEZELS 38G' },
    { codigo: '300064408', desc: 'DORITOS QUESO 240GX14' },
];

const ver = async (c) => {
    const p = await buscarProducto(turso, EMPRESA, c.desc, c.codigo);
    if (!p) return `NO ESTÁ`;
    if (p.ambiguo) return `AMBIGUO (${p.candidatos.length}): ${p.candidatos.map(x => x.name).join(' · ')}`;
    const via = p.aprendido ? `aprendido por ${p.aprendido}` : (p.exacto ? 'nombre igual' : 'parecido');
    return `→ ${p.name}  [${via}]`;
};

console.log('\n══ Antes de enseñarle nada ══');
for (const c of CASOS) console.log(`  ${c.desc.padEnd(24)} ${await ver(c)}`);

if (!APRENDER) {
    console.log('\n(agregá --aprender para probar la memoria)');
    process.exit(0);
}

console.log('\n══ Se corrige un renglón, como haría la persona ══');
// Se elige el caso de Dinamita FH: es el que ninguna comparación puede resolver.
const caso = CASOS[2];
const cand = await turso.execute({
    sql: `SELECT id, name FROM products WHERE company_id = ? AND LOWER(name) LIKE '%flamin%' LIMIT 1`,
    args: [EMPRESA],
});
const elegido = cand.rows[0];
if (!elegido) { console.log('  no encontré un Flamin Hot en el catálogo'); process.exit(0); }
console.log(`  la persona elige: ${elegido.name} (#${elegido.id})`);

const r = await purchaseActions.productAliasLearn(turso, EMPRESA, { uid: null }, {
    productId: Number(elegido.id),
    codigo: caso.codigo,
    texto: caso.desc,
    supplierId: null,
});
console.log('  guardado:', JSON.stringify(r));

console.log('\n══ La misma factura, otra vez ══');
console.log(`  ${caso.desc.padEnd(24)} ${await ver(caso)}`);

console.log('\n══ El proveedor lo escribe distinto pero el código es el mismo ══');
console.log(`  ${'DINAMITA FLAM HOT'.padEnd(24)} ${await ver({ codigo: caso.codigo, desc: 'DINAMITA FLAM HOT' })}`);

console.log('\n══ Se corrige de nuevo, apuntando a otro producto ══');
const otro = await turso.execute({
    sql: `SELECT id, name FROM products WHERE company_id = ? AND LOWER(name) LIKE '%dinamita%' AND id <> ? LIMIT 1`,
    args: [EMPRESA, elegido.id],
});
if (otro.rows[0]) {
    await purchaseActions.productAliasLearn(turso, EMPRESA, { uid: null }, {
        productId: Number(otro.rows[0].id), codigo: caso.codigo, texto: caso.desc, supplierId: null,
    });
    console.log(`  ahora apunta a: ${otro.rows[0].name}`);
    console.log(`  ${caso.desc.padEnd(24)} ${await ver(caso)}`);
}

console.log('\n══ Limpieza ══');
const del = await turso.execute({
    sql: `DELETE FROM product_supplier_aliases WHERE company_id = ? AND (alias_code = ? OR alias_text = ?)`,
    args: [EMPRESA, caso.codigo, 'dinamitafh100'],
});
console.log(`  alias de prueba borrados: ${del.rowsAffected}`);
console.log(`  ${caso.desc.padEnd(24)} ${await ver(caso)}`);
