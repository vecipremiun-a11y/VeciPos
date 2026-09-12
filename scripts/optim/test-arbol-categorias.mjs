// El desplegable de categorías del inventario (11-sep-2026).
//
// Kevin: "al desplegar la categoría en el inventario no se muestra la jerarquía
// que debería tener entre categorías y subcategorías y categorías hija, y al
// lado la cantidad de productos que tiene cada categoría… mídelo; si atrasa la
// carga de los productos, hacelo al desplegar".
//
// LO QUE SE MIDIÓ contra la base real (parte 3 de esta prueba, contra la copia
// local; los números de producción están en los comentarios):
//
//     categorías (ya venían del arranque)      146 ms   43 filas   8,9 KB
//     conteo de productos por categoría        133 ms   41 filas   1,2 KB
//     arranque parcial SIN el conteo           262 ms
//     arranque parcial CON el conteo           231 ms   ← dentro del ruido
//
// O sea: NO atrasa. Igual se pide al desplegar, por otra razón que el arranque
// no puede dar — que el número esté al día. Lo del arranque es de cuando se
// entró a la sesión, y los productos se crean y se borran durante el turno.
//
// EL CONTEO VA POR NOMBRE. El filtro del inventario compara `products.category`
// (texto), así que el número tiene que salir de esa misma comparación. Contando
// por `category_id` el desplegable diría "Frios 244" y al elegirlo saldrían 257.
//
//   node scripts/optim/test-arbol-categorias.mjs

import { createClient } from '@libsql/client';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { opcionesCategorias, mapaDeConteos } from '../../src/lib/arbolCategorias.js';
import { reportRun } from '../../api/_lib/reportActions.js';

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

// La forma real de la empresa: 3 niveles, como en producción.
const CATS = [
    { id: 1, name: 'Mascota', parent_id: null },
    { id: 2, name: 'Granel', parent_id: 1 },
    { id: 3, name: 'Mascotas Sobres', parent_id: 1 },
    { id: 4, name: 'Abarrotes', parent_id: null },
    { id: 5, name: 'Fideos', parent_id: 4 },
    { id: 6, name: 'Fideos Largos', parent_id: 5 },   // tercer nivel
    { id: 7, name: 'Verduras y Frutas', parent_id: null },
];

console.log('1. El orden: cada categoría con sus hijas debajo');
let o = opcionesCategorias(CATS, null);
check('salen las 7', o.length === 7, String(o.length));
check('el orden es de árbol, no alfabético plano',
    o.map(x => x.value).join(' > ') === 'Abarrotes > Fideos > Fideos Largos > Mascota > Granel > Mascotas Sobres > Verduras y Frutas',
    o.map(x => x.value).join(' > '));

console.log('\n2. Los niveles');
const nivel = (n) => o.find(x => x.value === n)?.nivel;
check('Abarrotes es de primer nivel', nivel('Abarrotes') === 0);
check('Fideos cuelga de Abarrotes', nivel('Fideos') === 1);
check('Fideos Largos cuelga de Fideos', nivel('Fideos Largos') === 2);
// La sangría se compara por estructura y no contra un literal: son espacios
// duros (U+00A0), porque dentro de un <option> los espacios normales se
// colapsan y las hijas quedarían pegadas al margen.
const sangriaDe = (v) => o.find(x => x.value === v).etiqueta.match(/^[\s ]*/)[0].length;
check('cada nivel sangra más que el anterior',
    sangriaDe('Abarrotes') < sangriaDe('Fideos') && sangriaDe('Fideos') < sangriaDe('Fideos Largos'),
    `${sangriaDe('Abarrotes')} < ${sangriaDe('Fideos')} < ${sangriaDe('Fideos Largos')}`);
check('las hijas llevan "└"', o.find(x => x.value === 'Fideos Largos').etiqueta.includes('└'));
check('la sangría usa espacio duro, no se colapsa en el <option>',
    o.find(x => x.value === 'Fideos').etiqueta.includes(' '));

console.log('\n3. Los conteos al lado');
const conteos = { 'Mascota': 12, 'Mascotas Sobres': 48, 'Abarrotes': 519, 'Granel': 0, 'Fideos': 7, 'Fideos Largos': 3, 'Verduras y Frutas': 48 };
o = opcionesCategorias(CATS, conteos);
check('"Abarrotes  (519)"', o.find(x => x.value === 'Abarrotes').etiqueta.endsWith('Abarrotes  (519)'),
    o.find(x => x.value === 'Abarrotes').etiqueta);
check('una categoría vacía muestra (0)', o.find(x => x.value === 'Granel').etiqueta.endsWith('(0)'),
    o.find(x => x.value === 'Granel').etiqueta);
check('el valor que se filtra sigue siendo el nombre pelado',
    o.every(x => !x.value.includes('(') && !x.value.includes('└')));

console.log('\n4. Sin los conteos todavía, no se inventa un cero');
o = opcionesCategorias(CATS, null);
check('sin conteo no se agrega número', !o.find(x => x.value === 'Abarrotes').etiqueta.includes('('),
    o.find(x => x.value === 'Abarrotes').etiqueta);
check('la jerarquía se ve igual', o.length === 7);

console.log('\n5. Datos torcidos no rompen el desplegable');
check('lista vacía', opcionesCategorias([], {}).length === 0);
check('null', opcionesCategorias(null, {}).length === 0);
const huerfana = opcionesCategorias([{ id: 9, name: 'Perdida', parent_id: 999 }], {});
check('una hija cuyo padre no existe igual aparece', huerfana.length === 1 && huerfana[0].nivel === 0,
    JSON.stringify(huerfana[0]?.value));
const ciclo = opcionesCategorias([{ id: 1, name: 'A', parent_id: 2 }, { id: 2, name: 'B', parent_id: 1 }], {});
check('un ciclo padre→hija→padre no cuelga el navegador', ciclo.length <= 2, `${ciclo.length} opciones`);

console.log('\n6. El conteo sale por NOMBRE, que es como filtra la pantalla');
const dir = mkdtempSync(join(tmpdir(), 'cats-'));
const db = createClient({ url: `file:${join(dir, 't.db').split(String.fromCharCode(92)).join('/')}` });
try {
    await db.executeMultiple(readFileSync('migrations/0000_base_schema.sql', 'utf8'));
    await db.execute("INSERT INTO companies (id, name) VALUES ('acme','Acme')");
    await db.executeMultiple(readFileSync('migrations/0024_categorias_jerarquia.sql', 'utf8'));
    // El snapshot 0000 quedó atrás respecto de producción: allá `products` tiene
    // `created_at` e `is_active` y en el .sql no. La pantalla de Inventario los
    // pide, así que sin esto fallaría por el esquema y no por lo que se prueba.
    await db.execute('ALTER TABLE products ADD COLUMN created_at TEXT');
    await db.execute('ALTER TABLE products ADD COLUMN is_active INTEGER DEFAULT 1');

    // Un producto con el nombre puesto pero SIN category_id: es el caso que hace
    // que los dos conteos no coincidan (23 productos así en producción).
    const alta = (id, nombre, categoria, catId) => db.execute({
        sql: `INSERT INTO products (id, company_id, name, sku, price, cost, stock, tax_rate, unit, category, category_id)
              VALUES (?, 'acme', ?, ?, 100, 50, 1, 0, 'Und', ?, ?)`,
        args: [id, nombre, `SKU${id}`, categoria, catId],
    });
    await db.execute("INSERT INTO categories (id, name, company_id, status) VALUES (77,'Frios','acme','active')");
    await alta(1, 'Queso', 'Frios', 77);
    await alta(2, 'Jamón', 'Frios', 77);
    await alta(3, 'Manteca', 'Frios', null);   // sin id, pero con el nombre

    const r = await reportRun(db, 'acme', null, { name: 'categoryCountsByName', params: {} });
    const mapa = mapaDeConteos(r.rows[0]);
    check('cuenta los 3, incluido el que no tiene category_id', mapa['Frios'] === 3, JSON.stringify(mapa));

    const porId = await db.execute("SELECT COUNT(*) n FROM products WHERE company_id='acme' AND category_id=77");
    check('   (por category_id habrían sido 2: por eso va por nombre)', Number(porId.rows[0].n) === 2,
        String(porId.rows[0].n));

    // Y que el número prometido sea el que el filtro devuelve de verdad.
    const filtrados = await reportRun(db, 'acme', null, { name: 'inventoryProducts', params: { category: 'Frios' } });
    check('el número del desplegable coincide con lo que muestra el filtro',
        filtrados.rows[0].length === mapa['Frios'], `filtro=${filtrados.rows[0].length} desplegable=${mapa['Frios']}`);

    // ── 7. Elegir una categoría trae TODA su rama ────────────────────────
    //
    // Kevin: "al poner la categoría tiene que traer todo lo que contiene la
    // categoría más la subcategoría más la categoría hija". Era el caso de
    // "Amasanderia": 1 producto propio, 15 contando Panes y Empanadas, y el
    // filtro mostraba uno solo. El POS ya resolvía la rama desde la 0024.
    console.log('\n7. Elegir una categoría trae toda su rama');
    await db.execute("INSERT INTO categories (id, name, company_id, status) VALUES (10,'Amasanderia','acme','active')");
    await db.execute("INSERT INTO categories (id, name, parent_id, company_id, status) VALUES (11,'Panes',10,'acme','active')");
    await db.execute("INSERT INTO categories (id, name, parent_id, company_id, status) VALUES (12,'Empanadas',10,'acme','active')");
    await db.execute("INSERT INTO categories (id, name, parent_id, company_id, status) VALUES (13,'Integrales',11,'acme','active')");
    await alta(10, 'Harina 25kg', 'Amasanderia', 10);
    await alta(11, 'Marraqueta', 'Panes', 11);
    await alta(12, 'Hallulla', 'Panes', 11);
    await alta(13, 'Empanada de pino', 'Empanadas', 12);
    await alta(14, 'Pan integral', 'Integrales', 13);   // tercer nivel

    const rama = async (cat) =>
        (await reportRun(db, 'acme', null, { name: 'inventoryProducts', params: { category: cat, limit: 200 } })).rows[0];

    let x = await rama('Amasanderia');
    check('"Amasanderia" trae los 5 (propio + hijas + nieta)', x.length === 5,
        x.map(p => p.name).join(', '));
    x = await rama('Panes');
    check('"Panes" trae 3 (los suyos + la hija Integrales)', x.length === 3, x.map(p => p.name).join(', '));
    x = await rama('Integrales');
    check('la hoja trae solo el suyo', x.length === 1, x.map(p => p.name).join(', '));
    x = await rama('Empanadas');
    check('una rama sin hijas no arrastra de más', x.length === 1, x.map(p => p.name).join(', '));

    console.log('\n8. El conteo del desplegable también es por rama');
    const r2 = await reportRun(db, 'acme', null, { name: 'categoryCountsByName', params: {} });
    const m2 = mapaDeConteos(r2.rows[0]);
    check('Amasanderia dice 5, no 1', m2['Amasanderia'] === 5, String(m2['Amasanderia']));
    check('Panes dice 3', m2['Panes'] === 3, String(m2['Panes']));
    check('el número del desplegable = lo que muestra el filtro',
        m2['Amasanderia'] === (await rama('Amasanderia')).length);

    console.log('\n9. Lo que ya andaba sigue andando');
    x = await rama('Frios');
    check('una categoría sin hijas no cambió', x.length === 3, String(x.length));
    x = (await reportRun(db, 'acme', null, { name: 'inventoryProducts', params: { limit: 200 } })).rows[0];
    check('sin categoría salen todos', x.length === 8, String(x.length));
    x = (await reportRun(db, 'acme', null, { name: 'inventoryProducts', params: { category: 'Panes', searchTerm: 'hallulla' } })).rows[0];
    check('la búsqueda se combina con la rama', x.length === 1 && x[0].name === 'Hallulla', x.map(p => p.name).join(', '));
    x = (await reportRun(db, 'acme', null, { name: 'inventoryProducts', params: { category: 'No Existe' } })).rows[0];
    check('una categoría inexistente no rompe', x.length === 0, String(x.length));
} finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows */ }
}

console.log(fallas === 0 ? '\nTODO OK\n' : `\n${fallas} PRUEBAS FALLARON\n`);
process.exitCode = fallas === 0 ? 0 : 1;
