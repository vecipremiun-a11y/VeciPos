// La MISMA regla de búsqueda en TODOS los buscadores de productos (10-sep-2026).
//
// Kevin: "esas reglas que yo implementé solo están para algunos buscadores y no
// para todo el sistema POS; quiero que en todos los buscadores se emplee esa
// regla — realizar pedido, perfil de producto, FEFO, inventario, reportes".
//
// Tenía razón. La regla (sin mayúsculas / sin tildes / sin importar el orden)
// vivía escrita adentro de `reportActions.js` y solo la usaban tres consultas.
// Todo lo demás buscaba con un `name LIKE ?` pelado, que falla en las tres
// cosas — y encima `lower()` de SQLite no baja Á É Í Ó Ú Ü Ñ, así que un
// producto escrito en mayúscula con tilde no aparecía ni buscándolo bien.
//
// Esta prueba recorre CADA buscador con los mismos tres casos y exige que los
// tres encuentren el producto. Si mañana alguien agrega un buscador con un LIKE
// crudo, acá se cae.
//
//   node scripts/optim/test-buscadores-todos.mjs

import { createClient } from '@libsql/client';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reportRun } from '../../api/_lib/reportActions.js';
import { inventoryActions } from '../../api/_lib/inventoryActions.js';
import { comboActions } from '../../api/_lib/comboActions.js';
import { filtroDe, normalizar } from '../../src/lib/busquedaProductos.js';

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

const dir = mkdtempSync(join(tmpdir(), 'buscadores-'));
const db = createClient({ url: `file:${join(dir, 't.db').split(String.fromCharCode(92)).join('/')}` });
const CO = 'acme';
const SES = { uid: 1, username: 'jefe', role: 'Administrador' };

// El producto trampa: mayúsculas, tilde y dos palabras que se recuerdan al
// revés. Es el caso real que reportó Kevin ("Carozzi Cabello Ángel Corto").
const TRAMPA = 'Carozzi Cabello ÁNGEL Corto 400g';

// Las tres facilidades, una por caso. Los tres tienen que encontrar TRAMPA.
const CASOS = [
    ['minúscula sin tilde', 'angel'],
    ['MAYÚSCULA con tilde', 'ÁNGEL'],
    ['palabras al revés', 'angel cabello'],
];

// Corre los tres casos contra un buscador y reporta cada uno.
async function probar(nombre, buscar) {
    console.log(`\n${nombre}`);
    for (const [etiqueta, termino] of CASOS) {
        let encontrado = false, detalle = '';
        try {
            const r = await buscar(termino);
            encontrado = r.some(t => String(t).toLowerCase().includes('ngel'));
            detalle = r.length ? r.slice(0, 2).join(' | ') : '(nada)';
        } catch (e) {
            detalle = 'ERROR: ' + (e?.message || e).slice(0, 90);
        }
        check(`  ${etiqueta}: "${termino}"`, encontrado, detalle);
    }
}

try {
    await db.executeMultiple(readFileSync('migrations/0000_base_schema.sql', 'utf8'));
    await db.execute("INSERT INTO companies (id, name) VALUES ('acme', 'Acme')");
    await db.execute("INSERT INTO users (id, username, password, name, role, company_id) VALUES (1,'jefe','x','Jefe','Administrador','acme')");

    // El snapshot 0000 quedó atrás respecto de producción en la tabla
    // `products`: allá existen `created_at` e `is_active` (comprobado contra la
    // base real) y en el .sql no. La pantalla de Inventario los pide, así que
    // sin esto la prueba fallaría por el esquema y no por la búsqueda.
    await db.execute('ALTER TABLE products ADD COLUMN created_at TEXT');
    await db.execute('ALTER TABLE products ADD COLUMN is_active INTEGER DEFAULT 1');

    const productos = [TRAMPA, 'Leche Entera Soprole 1L', 'PIÑA EN CONSERVA 500g'];
    for (let i = 0; i < productos.length; i++) {
        await db.execute({
            sql: `INSERT INTO products (id, company_id, name, sku, price, cost, stock, tax_rate, unit, category, supplier, sale_mode)
                  VALUES (?, 'acme', ?, ?, 1000, 600, 10, 19, 'Und', 'General', 'Carozzi', 'both')`,
            args: [i + 1, productos[i], `SKU${i + 1}`],
        });
    }

    // Un lote con vencimiento para que FEFO tenga qué mostrar.
    await db.execute(`INSERT INTO product_lots (company_id, product_id, quantity, expiry_date)
                      VALUES ('acme', 1, 5, '2026-12-01')`);

    // Un combo que se llama igual, para el buscador de combos.
    await db.execute(`INSERT INTO product_combos (company_id, name, sku, price, is_active)
                      VALUES ('acme', ?, 'COMBO1', 2000, 1)`.replace('?', `'Pack ${TRAMPA}'`));

    // Un renglón de factura, para el detalle de compras del asistente.
    await db.execute(`INSERT INTO purchases (id, company_id, supplier_name, invoice_number, date, total)
                      VALUES (1, 'acme', 'Carozzi SA', 'F-1', '2026-09-01', 5000)`);
    await db.execute({
        sql: `INSERT INTO purchase_items (company_id, purchase_id, name, quantity, cost, line_total, tax_rate, purchase_date, created_at)
              VALUES ('acme', 1, ?, 10, 500, 5000, 19, '2026-09-01', '2026-09-01T12:00:00Z')`,
        args: [TRAMPA],
    });

    const nombres = (rows) => (rows || []).map(r => r.name ?? r.product_name ?? r.producto ?? '');

    // ── 1. Buscador del POS (el que ya estaba bien) ──────────────────────
    await probar('1. Ventas (POS) — productsSearch', async (t) => {
        const r = await reportRun(db, CO, SES, { name: 'productsSearch', params: { term: t, limit: 50 } });
        return nombres(r.rows[0]);
    });

    // ── 2. Inventario ────────────────────────────────────────────────────
    await probar('2. Inventario — inventoryProducts', async (t) => {
        const r = await reportRun(db, CO, SES, { name: 'inventoryProducts', params: { searchTerm: t } });
        return nombres(r.rows[0]);
    });

    // ── 3. Realizar pedido ───────────────────────────────────────────────
    await probar('3. Pedidos (realizar pedido) — productsForOrder', async (t) => {
        const r = await reportRun(db, CO, SES, { name: 'productsForOrder', params: { search: t } });
        return nombres(r.rows[0]);
    });

    // ── 4. FEFO / vencimientos ───────────────────────────────────────────
    await probar('4. FEFO (productos por vencer) — lotsReport', async (t) => {
        const r = await inventoryActions.lotsReport(db, CO, SES, { searchTerm: t });
        return nombres(r.products || r.rows || []);
    });

    // ── 5. Control de inventario ─────────────────────────────────────────
    await probar('5. Control de Inventario — controlProducts', async (t) => {
        const r = await inventoryActions.controlProducts(db, CO, SES, { controlId: 1, search: t });
        return nombres(r.rows || r.products || []);
    });

    // ── 6. Conciliación ──────────────────────────────────────────────────
    await probar('6. Conciliación — reconciliationData', async (t) => {
        const r = await inventoryActions.reconciliationData(db, CO, SES, { search: t });
        return nombres(r.rows || r.products || []);
    });

    // ── 7. Combos / packs ────────────────────────────────────────────────
    await probar('7. Combos / Packs — combosFetch', async (t) => {
        const r = await comboActions.combosFetch(db, CO, SES, { search: t });
        return nombres(r.combos || r.rows || []);
    });

    // ── 8. Detalle de compras (asistente) ────────────────────────────────
    await probar('8. Detalle de compras — comprasDetalle', async (t) => {
        const r = await reportRun(db, CO, SES, { name: 'comprasDetalle', params: { from: '2026-01-01', to: '2026-12-31', buscar: t } });
        return nombres(r.rows[0]);
    });

    // ── 9. Los buscadores que filtran en memoria ─────────────────────────
    // Productos por vencer y armar un encargo filtran la lista que ya tienen,
    // sin volver al servidor. Usan `filtroDe`, que es el gemelo de la regla SQL.
    console.log('\n9. Buscadores en memoria (FEFO en pantalla, armar encargo)');
    for (const [etiqueta, termino] of CASOS) {
        const pasa = filtroDe(termino);
        check(`  ${etiqueta}: "${termino}"`, pasa(TRAMPA, 'SKU1'), TRAMPA);
    }
    check('  un producto que NO es sigue sin aparecer', !filtroDe('angel')('Leche Entera Soprole', 'SKU2'));
    check('  término vacío no filtra nada', filtroDe('')('lo que sea'));
    check('  "entera leche" encuentra "Leche Entera"', filtroDe('entera leche')('Leche Entera Soprole 1L', 'SKU2'));
    check('  "pina" encuentra "PIÑA"', filtroDe('pina')('PIÑA EN CONSERVA 500g', 'SKU3'));
    check('  normalizar baja mayúsculas Y tildes', normalizar('MARAÑÓN') === 'maranon', normalizar('MARAÑÓN'));

    // ── 10. Que un SKU vacío no esconda al producto ──────────────────────
    console.log('\n10. Un producto sin SKU se encuentra igual por su nombre');
    await db.execute(`INSERT INTO products (id, company_id, name, sku, price, cost, stock, tax_rate, unit, category)
                      VALUES (99, 'acme', 'Ñoquis Ricos 500g', '', 900, 500, 3, 19, 'Und', 'General')`);
    const sinSku = await reportRun(db, CO, SES, { name: 'productsSearch', params: { term: 'noquis', limit: 50 } });
    check('  "noquis" encuentra "Ñoquis Ricos"', nombres(sinSku.rows[0]).some(n => n.includes('Ñoquis')),
        nombres(sinSku.rows[0]).join(' | ') || '(nada)');

} finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows */ }
}

console.log(fallas === 0 ? '\nTODO OK\n' : `\n${fallas} PRUEBAS FALLARON\n`);
process.exitCode = fallas === 0 ? 0 : 1;
