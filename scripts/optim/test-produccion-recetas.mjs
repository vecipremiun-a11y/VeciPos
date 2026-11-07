// Producción, Fase 1 (Kevin, 6-nov-2026): insumos con contenido, recetas y el
// costo de fabricación. La receta usa el Costo + IVA de cada insumo; "Usar como
// costo" le saca el IVA del producto fabricado para que no se cuente dos veces.
//
// Las cuentas se prueban sueltas; lo del servidor, contra una base local. No toca
// ninguna base real.
//
//   node scripts/optim/test-produccion-recetas.mjs

import { createClient } from '@libsql/client';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    medidaInsumo, costoPorBase, calcularReceta, costoNetoParaFicha, sugerirContenido,
    normalizarProduccion, plataFina, unidadSugerida,
} from '../../src/lib/produccion.js';
import { precioDesdeMargen, costoConImpuestos } from '../../src/lib/impuestosProducto.js';
import { productCreate, productUpdate, productDelete } from '../../api/data/actions.js';
import { productionActions, limpiarProduccion } from '../../api/_lib/productionActions.js';

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};
const cerca = (a, b, tol = 0.005) => Math.abs(a - b) <= tol;

// ── 1. Las cuentas ──────────────────────────────────────────────────────────
console.log('1. El insumo: cuánto cuesta un gramo');
{
    // La captura de Kevin: costo $14.600 + IVA 19% = $17.374. Saco de 25 kg.
    const harina = { id: 1, name: 'Harina Morro 25 kg', unit: 'Und', cost: 14600, tax_rate: 19 };
    const pp = { is_input: true, input_content: 25, input_unit: 'kg' };
    check('costo + IVA del saco: $17.374', cerca(costoConImpuestos(14600, 19), 17374));
    check('un gramo: $0,69496', cerca(costoPorBase(harina, pp), 0.69496, 1e-6), String(costoPorBase(harina, pp)));
    const r = calcularReceta({ yield: 100, items: [{ product_id: 1, qty: 5, unit: 'kg' }] }, { 1: { producto: harina, produccion: pp } });
    check('5 kg en la tanda: $3.474,80', cerca(r.lineas[0].costo, 3474.8), String(r.lineas[0].costo));
    check('lo mismo en gramos (5.000 g)', cerca(calcularReceta({ yield: 1, items: [{ product_id: 1, qty: 5000, unit: 'g' }] }, { 1: { producto: harina, produccion: pp } }).total, 3474.8));
    check('se propone usarlo en kg', unidadSugerida(harina, pp) === 'kg');

    const sinContenido = medidaInsumo(harina, null);
    check('sin contenido se cuenta por unidad, y queda marcado', sinContenido.familia === 'unidad' && sinContenido.sinContenido);
    const porKilo = medidaInsumo({ unit: 'Kg' }, null);
    check('un producto por Kg no necesita contenido (1 kg = 1.000 g)', porKilo.familia === 'peso' && porKilo.porUnidad === 1000 && !porKilo.sinContenido);
    const porLitro = medidaInsumo({ unit: 'Lt' }, null);
    check('uno por Lt tampoco (1 L = 1.000 ml)', porLitro.familia === 'volumen' && porLitro.porUnidad === 1000);

    // Merma: carne con hueso, se aprovecha el 85%.
    const carne = { unit: 'Kg', cost: 5000, tax_rate: 19 };
    check('con 15% de merma el gramo útil sale más caro', cerca(costoPorBase(carne, { input_waste: 15 }), 5950 / 850, 1e-9));
    // Otros impuestos del insumo (el 5% del cerdo): también son costo.
    const cerdo = { unit: 'Kg', cost: 4000, tax_rate: 19, extra_taxes: '[{"name":"Imp. cerdo","rate":5}]' };
    check('el cerdo cuenta 19% + 5%', cerca(costoPorBase(cerdo, null), 4000 * 1.24 / 1000, 1e-9));
}

console.log('\n2. La receta del ejemplo (solo la harina es de Kevin)');
{
    // Precios que paga Kevin, con IVA: la ficha guarda el neto.
    const neto = (conIva) => conIva / 1.19;
    const insumos = {
        1: { producto: { id: 1, name: 'Harina Morro 25 kg', unit: 'Und', cost: neto(13400), tax_rate: 19 }, produccion: { input_content: 25, input_unit: 'kg' } },
        2: { producto: { id: 2, name: 'Levadura 500 g', unit: 'Und', cost: neto(3000), tax_rate: 19 }, produccion: { input_content: 500, input_unit: 'g' } },
        3: { producto: { id: 3, name: 'Sal', unit: 'Kg', cost: neto(500), tax_rate: 19 }, produccion: null },
        4: { producto: { id: 4, name: 'Manteca 1 kg', unit: 'Und', cost: neto(3500), tax_rate: 19 }, produccion: { input_content: 1, input_unit: 'kg' } },
    };
    const receta = {
        yield: 100,
        items: [
            { product_id: 1, qty: 5, unit: 'kg' },
            { product_id: 2, qty: 100, unit: 'g' },
            { product_id: 3, qty: 100, unit: 'g' },
            { product_id: 4, qty: 250, unit: 'g' },
        ],
        others: [{ name: 'Agua', amount: 0 }, { name: 'Gas y luz', amount: 500 }],
    };
    const r = calcularReceta(receta, insumos);
    check('harina $2.680, levadura $600, sal $50, manteca $875',
        [2680, 600, 50, 875].every((v, i) => cerca(r.lineas[i].costo, v)), r.lineas.map(l => l.costo.toFixed(2)).join(' / '));
    check('tanda: $4.705', cerca(r.total, 4705), String(r.total));
    check('por pan: $47,05', cerca(r.porUnidad, 47.05), String(r.porUnidad));
    const costo = Math.round(costoNetoParaFicha(r.porUnidad, 19) * 100) / 100;
    check('"Usar como costo" pone $39,54 (sin IVA)', costo === 39.54, String(costo));
    check('y su Costo + IVA vuelve a dar $47,05', cerca(costoConImpuestos(costo, 19), 47.05, 0.01));
    const precio = precioDesdeMargen(costo, 100, 19);
    check('con 100% de utilidad el pan sale a $94 (el IVA no se cuenta dos veces)', Math.round(precio) === 94, precio.toFixed(2));
    check('producto sin IVA: el costo pasa igual', cerca(costoNetoParaFicha(47.05, 0), 47.05));
}

console.log('\n3. Lo que no se suma, se avisa');
{
    const ins = {
        1: { producto: { id: 1, name: 'Harina', unit: 'Und', cost: 10000, tax_rate: 19 }, produccion: { input_content: 25, input_unit: 'kg' } },
        2: { producto: { id: 2, name: 'Huevo', unit: 'Und', cost: 0, tax_rate: 19 }, produccion: null },
        3: { producto: { id: 3, name: 'Saco sin contenido', unit: 'Und', cost: 9000, tax_rate: 19 }, produccion: null },
    };
    const r = calcularReceta({
        yield: 10,
        items: [
            { product_id: 1, qty: 2, unit: 'L' },   // harina en litros: no
            { product_id: 99, qty: 1, unit: 'kg' }, // borrado
            { product_id: 2, qty: 3, unit: 'und' }, // sin costo
            { product_id: 3, qty: 1, unit: 'und' }, // por unidad entera
            { product_id: 1, qty: '', unit: 'kg' }, // sin cantidad
        ],
    }, ins);
    check('harina en litros: unidad que no corresponde', r.lineas[0].error === 'unidad');
    check('producto borrado', r.lineas[1].error === 'eliminado');
    check('insumo sin costo: avisa', r.lineas[2].aviso === 'sinCosto' && !r.lineas[2].error);
    check('saco sin contenido: avisa que se cuenta por unidad', r.lineas[3].aviso === 'sinContenido' && cerca(r.lineas[3].costo, 10710));
    check('sin cantidad', r.lineas[4].error === 'cantidad');
    check('los errores no se suman al total', cerca(r.total, 10710), String(r.total));
    check('sin rendimiento no hay costo por unidad', calcularReceta({ items: [] }, {}).porUnidad === null);
}

console.log('\n4. Contenido sacado del nombre');
for (const [nombre, esperado] of [
    ['Harina Morro 25 kg', '25 kg'], ['HARINA MORRO 25KG', '25 kg'], ['Levadura 500 g', '500 g'],
    ['Mantequilla 250 grs.', '250 g'], ['Aceite 1,5 L', '1.5 L'], ['Leche 1 lt', '1 L'], ['Crema 200cc', '200 ml'],
    ['Azúcar 1 kilo', '1 kg'], ['Huevos x30', '30 und'], ['Vienesas 20 unidades', '20 und'],
    ['Pan de completo', null], ['5 gaseosas', null], ['Huevo 1 un', null],
]) {
    const s = sugerirContenido(nombre);
    const texto = s ? `${s.content} ${s.unit}` : null;
    check(`"${nombre}" → ${esperado ?? 'nada'}`, texto === esperado, String(texto));
}

console.log('\n5. Lo que se guarda');
{
    check('nada marcado = no se guarda', normalizarProduccion({ is_input: false, recipe: null }) === null);
    check('receta vacía = sin receta', normalizarProduccion({ is_input: false, recipe: { yield: '', items: [], others: [] } }) === null);
    const n = normalizarProduccion({ is_input: true, input_content: '25', input_unit: 'kg', input_waste: '', recipe: { yield: '100', items: [{ product_id: '3', qty: '5', unit: 'kg' }, { product_id: 4, qty: '', unit: 'g' }], others: [{ name: ' Gas ', amount: '500' }] } });
    check('números como números y sin líneas a medio llenar',
        JSON.stringify(n) === JSON.stringify({ is_input: true, input_content: 25, input_unit: 'kg', input_waste: 0, recipe: { yield: 100, items: [{ product_id: 3, qty: 5, unit: 'kg' }], others: [{ name: 'Gas', amount: 500 }] } }),
        JSON.stringify(n));
    const s = limpiarProduccion({ is_input: true, input_content: -3, input_unit: 'kg', input_waste: 120, recipe: { items: [{ product_id: 7, qty: 2, unit: 'kg' }, { product_id: 8, qty: 1, unit: 'tazas' }] } }, 7);
    check('servidor: contenido negativo fuera, merma tope 95%, la receta no se usa a sí misma, unidad inventada fuera',
        s.input_content === null && s.input_waste === 95 && s.recipe === null, JSON.stringify(s));
    check('plata con los decimales que hacen falta', plataFina(0.69496) === '$0,69' && plataFina(47.05) === '$47,05' && plataFina(17374) === '$17.374',
        [plataFina(0.69496), plataFina(47.05), plataFina(17374)].join(' '));
}

// ── 2. El servidor ──────────────────────────────────────────────────────────
console.log('\n6. Contra una base local');
const dir = mkdtempSync(join(tmpdir(), 'produccion-'));
const db = createClient({ url: `file:${join(dir, 't.db').split(String.fromCharCode(92)).join('/')}` });
const CO = 'acme';
const session = { uid: 7, username: 'jefe' };
const fila = async (id) => (await db.execute({ sql: 'SELECT * FROM product_production WHERE product_id = ?', args: [id] })).rows[0];
const base = { category: 'Panadería', stock: 0, price: 0, tax_rate: 19, unit: 'Und' };

try {
    for (const f of ['0000_base_schema.sql', '0020_products_created_at.sql', '0024_categorias_jerarquia.sql',
        '0030_product_presentations.sql', '0033_offer_rules.sql', '0037_product_extra_taxes.sql', '0038_product_production.sql']) {
        await db.executeMultiple(readFileSync(join('migrations', f), 'utf8'));
    }
    await db.executeMultiple(`
        INSERT INTO companies (id, name) VALUES ('acme', 'Acme'), ('otra', 'Otra');
        INSERT INTO users (id, username, password, name, role, company_id) VALUES (7, 'jefe', 'x', 'Jefe', 'Administrador', 'acme');
        INSERT INTO products (id, company_id, name, sku, price, cost, stock, unit, category, tax_rate)
            VALUES (500, 'otra', 'Harina de la otra empresa', 'OTRA-1', 1, 1, 1, 'Und', 'X', 19);
    `);

    let r = await productCreate(db, CO, session, { ...base, name: 'Harina Morro 25 kg', sku: 'HAR-25', cost: 14600,
        _produccion: { is_input: true, input_content: 25, input_unit: 'kg' } });
    check('alta del insumo con su contenido', r.success && !r.avisoProduccion, r.error || r.avisoProduccion || '');
    const harina = r.product.id;
    let f = await fila(harina);
    check('queda marcado como insumo: 25 kg', Number(f?.is_input) === 1 && Number(f.input_content) === 25 && f.input_unit === 'kg', JSON.stringify(f));

    r = await productCreate(db, CO, session, { ...base, name: 'Levadura 500 g', sku: 'LEV-500', cost: 2521 });
    const levadura = r.product.id;
    check('un producto sin _produccion no crea fila', !(await fila(levadura)));

    r = await productCreate(db, CO, session, { ...base, name: 'Pan de completo', sku: 'PAN-C', cost: 0, sale_mode: 'preorder_only',
        _produccion: { is_input: false, recipe: { yield: 100, items: [
            { product_id: harina, qty: 5, unit: 'kg' }, { product_id: 500, qty: 1, unit: 'kg' }, { product_id: levadura, qty: 100, unit: 'g' },
        ], others: [{ name: 'Gas y luz', amount: 500 }] } } });
    const pan = r.product.id;
    f = await fila(pan);
    const receta = JSON.parse(f.recipe);
    check('alta del pan con su receta', r.success && receta.yield === 100 && receta.others[0].amount === 500);
    check('un insumo de OTRA empresa no entra en la receta', receta.items.length === 2 && !receta.items.some(i => i.product_id === 500), JSON.stringify(receta.items));

    console.log('\n7. La ficha lee su receta');
    r = await productionActions.get(db, CO, session, { productId: pan });
    check('trae la receta y sus dos insumos', r.success && r.produccion.recipe.items.length === 2 && r.insumos.length === 2);
    const h = r.insumos.find(x => x.producto.id === harina);
    check('la harina viene con su costo y su contenido', Number(h.producto.cost) === 14600 && h.produccion.input_content === 25 && h.produccion.is_input === true);
    check('la levadura viene sin fila de producción', r.insumos.find(x => x.producto.id === levadura).produccion === null);
    r = await productionActions.get(db, 'otra', session, { productId: pan });
    check('otra empresa no ve la receta', r.success && r.produccion === null);

    console.log('\n8. Editar desde la ficha (solo lo que cambió)');
    r = await productUpdate(db, CO, session, pan, { _parcial: true, price: 120 });
    check('guardar el precio no toca la receta', r.success && (await fila(pan)).recipe === f.recipe);
    r = await productUpdate(db, CO, session, pan, { _parcial: true, _produccion: { is_input: false, recipe: {
        yield: 120, items: [{ product_id: harina, qty: 6, unit: 'kg' }, { product_id: pan, qty: 1, unit: 'und' }], others: [] } } });
    const nueva = JSON.parse((await fila(pan)).recipe);
    check('cambia la receta; el pan no puede ser insumo de sí mismo', r.success && nueva.yield === 120 && nueva.items.length === 1, JSON.stringify(nueva));
    const audit = (await db.execute("SELECT details FROM audit_logs WHERE action = 'UPDATE' ORDER BY id DESC LIMIT 1")).rows[0];
    check('el registro de cambios dice "produccion"', JSON.parse(audit.details).campos.includes('produccion'), audit.details);

    console.log('\n9. Buscar insumos y la pestaña Producción');
    r = await productionActions.search(db, CO, session, { term: 'harina', excludeId: pan });
    check('busca "harina": la de esta empresa, con su contenido', r.success && r.insumos.length === 1 && r.insumos[0].producto.id === harina && r.insumos[0].produccion.input_content === 25,
        JSON.stringify(r.insumos.map(x => x.producto.name)));
    r = await productionActions.search(db, CO, session, { term: 'pan', excludeId: pan });
    check('no se ofrece a sí mismo', r.insumos.every(x => x.producto.id !== pan));
    r = await productionActions.overview(db, CO);
    const panFila = r.productos.find(p => p.id === pan);
    check('Producción trae las dos filas', r.success && r.producciones.length === 2, String(r.producciones.length));
    check('el pan viene entero (para abrir su ficha), sin la foto', panFila && panFila.sku === 'PAN-C' && 'has_image' in panFila && !('image' in panFila));
    check('la harina viene con lo justo para calcular', r.productos.some(p => p.id === harina && Number(p.cost) === 14600));

    console.log('\n10. Ponerle contenido a un insumo desde otra receta');
    r = await productionActions.saveInput(db, CO, session, { productId: levadura, content: 500, unit: 'g' });
    check('la levadura queda como insumo de 500 g', r.success && r.produccion.is_input && r.produccion.input_content === 500 && r.produccion.input_unit === 'g');
    r = await productionActions.saveInput(db, CO, session, { productId: pan, content: 1, unit: 'kg' });
    check('marcar el pan como insumo no le borra la receta', r.success && r.produccion.recipe?.yield === 120, JSON.stringify(r.produccion));
    r = await productionActions.saveInput(db, CO, session, { productId: 500, content: 25, unit: 'kg' });
    check('no se puede tocar un producto de otra empresa', r.success === false && !(await fila(500)));
    r = await productionActions.saveInput(db, CO, session, { productId: levadura, content: '', unit: 'g' });
    check('sin cantidad no se guarda', r.success === false);

    console.log('\n11. Quitar y borrar');
    r = await productUpdate(db, CO, session, levadura, { _parcial: true, _produccion: null });
    check('apagar todo borra la fila', r.success && !(await fila(levadura)));
    await productDelete(db, CO, session, harina);
    check('borrar el producto borra su fila de producción', !(await fila(harina)));
    r = await productionActions.get(db, CO, session, { productId: pan });
    check('la receta que la usaba sigue, y la harina ya no viene (se muestra como borrada)', r.produccion.recipe.items.length === 1 && r.insumos.length === 0);

    console.log('\n12. Si la tabla no existe (migración sin aplicar), el producto igual se guarda');
    await db.execute('DROP TABLE product_production');
    r = await productCreate(db, CO, session, { ...base, name: 'Queque', sku: 'QUE-1', cost: 1000, _produccion: { is_input: true, input_content: 1, input_unit: 'kg' } });
    check('alta OK, con aviso', r.success === true && /receta no/.test(r.avisoProduccion || ''), r.avisoProduccion || '');
    r = await productUpdate(db, CO, session, r.product.id, { _parcial: true, price: 5000 });
    check('editar sin tocar la receta ni se entera', r.success === true && !r.avisoProduccion);
} catch (e) {
    check('el test terminó sin excepciones', false, e.stack || e.message);
} finally {
    db.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows a veces lo retiene */ }
}

console.log(fallas ? `\n${fallas} FALLAS` : '\nTodo OK');
process.exit(fallas ? 1 : 0);
