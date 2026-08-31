// Lecturas del catálogo que el POS tiene guardado en IndexedDB.
//
// Por qué existe: el POS resuelve las lecturas de catálogo con lo que ya tiene
// guardado ANTES de preguntarle al servidor. Así la grilla y el buscador
// responden siempre —haya internet, no haya, o esté a medias— y la respuesta
// del servidor, cuando llega, solo corrige lo que cambió.
//
// El problema que resuelve: con el WiFi del local prendido pero el internet
// caído, `navigator.onLine` contesta que sí hay conexión. La búsqueda salía al
// servidor, esperaba los 12 segundos del tiempo límite y volvía vacía. El
// cajero veía "cargando" y ningún producto, con el catálogo completo guardado
// a un centímetro de distancia y nadie mirándolo.
//
// Las consultas de acá replican a propósito las del servidor (ver
// `productsSearch`, `categoryProducts` y `productByBarcode` en
// api/_lib/reportActions.js), incluido el ORDEN: si las dos listas salen igual
// ordenadas, cuando llega la respuesta de la red la pantalla no se reordena
// sola delante del cajero.

import { localDb } from './localdb';
import { imagenesGuardadas } from './imagenesLocal';

/** Sin tildes y en minúsculas: "Ñoquis" y "noquis" tienen que encontrar lo mismo. */
export function normalizar(txt) {
    return String(txt ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

// Campos que se calculan UNA vez al cargar la copia en memoria, en vez de
// recalcularlos en cada tecla. Van con guión bajo porque no vienen del servidor:
// son derivados nuestros y se descartan antes de entregarle el producto a la UI.
//
//   _nombre, _sku → sin tildes y en minúsculas, para buscar.
//   _orden        → solo en minúsculas, para ordenar igual que el servidor, que
//                   usa `name COLLATE NOCASE`: baja mayúsculas pero NO saca
//                   tildes. Si acá las sacáramos, la lista se reordenaría sola
//                   al llegar la respuesta de la red.
//
// Medido sobre las 4.370 filas de la empresa más grande: buscar pasa de 3,7 ms a
// 0,5 ms por tecla, y ordenar una categoría de 35 ms a 1,7 ms. Calcularlos cuesta
// 3,5 ms una sola vez cada 30 s. En una tablet de caja esos 35 ms se sienten en
// cada cambio de categoría.
function derivados(p) {
    p._nombre = normalizar(p.name);
    p._sku = normalizar(p.sku);
    p._orden = String(p.name ?? '').toLowerCase();
    return p;
}

// `price_ranges` viaja como texto JSON desde el servidor y así queda guardado.
// De paso se sacan los campos derivados: la UI recibe el producto tal como
// vendría de la red, sin agregados nuestros.
function paraLaUI(p) {
    const { _nombre, _sku, _orden, ...producto } = p;
    return {
        ...producto,
        price_ranges: typeof producto.price_ranges === 'string'
            ? (() => { try { return JSON.parse(producto.price_ranges); } catch { return []; } })()
            : (producto.price_ranges || []),
    };
}

// Le pega a cada producto la foto que haya quedado guardada de cuando sí había
// internet. El catálogo se sincroniza SIN las fotos (pesan 40 veces más que todo
// el resto junto), así que sin esto la grilla sin conexión sale toda gris.
async function conFotosGuardadas(productos) {
    if (!productos.length) return productos;
    try {
        const fotos = await imagenesGuardadas(productos.map((p) => p.id));
        if (!Object.keys(fotos).length) return productos;
        return productos.map((p) => (fotos[p.id] ? { ...p, image: fotos[p.id] } : p));
    } catch (e) {
        // Sin fotos se sigue vendiendo igual: no vale trabar la grilla por esto.
        console.warn('No se pudieron leer las fotos guardadas:', e);
        return productos;
    }
}

// Copia en memoria del catálogo local.
//
// Sin esto, cada tecla del buscador vuelve a leer y deserializar las miles de
// filas de IndexedDB (4.367 en la empresa más grande hoy). Antes eso pasaba
// solo cuando no había internet; ahora pasa SIEMPRE, así que el costo importa.
// Se guarda por empresa y se descarta a los 30 s, o antes si el sync escribe
// algo nuevo (ver `olvidarCatalogoLocal`).
const memoria = new Map();
const VIDA_MS = 30_000;

async function filasDe(companyId) {
    const guardado = memoria.get(companyId);
    if (guardado && Date.now() - guardado.ts < VIDA_MS) return guardado.filas;
    const filas = await localDb.products.where('companyId').equals(companyId).toArray();
    filas.forEach(derivados);
    memoria.set(companyId, { filas, ts: Date.now() });
    return filas;
}

/** El sync acaba de escribir productos: la copia en memoria ya no sirve. */
export function olvidarCatalogoLocal(companyId = null) {
    if (companyId) memoria.delete(companyId);
    else memoria.clear();
}

/**
 * Busca por nombre o SKU, igual que `productsSearch` del servidor
 * (LIKE sobre name y sku, tope 50).
 *
 * El orden es por id, que es el que devuelve SQLite al recorrer la tabla sin
 * ORDER BY — o sea, el mismo que ve el cajero cuando hay internet.
 *
 * OJO: la tabla `products` NO tiene columna `barcode`; el código de barras se
 * guarda en `sku`. La versión anterior de esta búsqueda filtraba también por
 * `p.barcode`, que siempre venía undefined.
 */
export async function buscarProductosLocal(companyId, term, limite = 50, { conFotos = true } = {}) {
    if (!companyId || !term) return [];

    // Cada palabra por separado, y todas tienen que aparecer. Así "entera leche"
    // encuentra "Leche Entera Soprole": uno no siempre recuerda en qué orden
    // quedó escrito el producto y empieza por la palabra que sí recuerda.
    // Mismo criterio que el servidor (ver filtroBusquedaProducto en
    // api/_lib/reportActions.js), para que con y sin internet se busque igual.
    const palabras = normalizar(term).split(/\s+/).filter(Boolean).slice(0, 6);
    if (!palabras.length) return [];

    const filas = await filasDe(companyId);
    const encontrados = filas.filter((p) =>
        palabras.every((w) => p._nombre.includes(w) || p._sku.includes(w))
    );
    encontrados.sort((a, b) => Number(a.id) - Number(b.id));
    const pagina = encontrados.slice(0, limite).map(paraLaUI);
    return conFotos ? conFotosGuardadas(pagina) : pagina;
}

/**
 * Los nombres e ids de una categoría y de TODO lo que cuelga de ella.
 *
 * Sin esto, sin internet tocar "Mascota" mostraría solo lo suyo y no lo de sus
 * subcategorías — al revés de lo que hace el servidor cuando hay conexión. El POS
 * resuelve las lecturas con lo guardado antes de preguntar, así que si acá la
 * jerarquía no existiera, la primera pantalla siempre saldría incompleta.
 */
async function ramaDe(companyId, nombre) {
    const cats = await localDb.categories.where('companyId').equals(companyId).toArray();
    const raiz = cats.find((c) => c.name === nombre);
    if (!raiz) return { ids: new Set(), nombres: new Set([nombre]) };

    const ids = new Set([Number(raiz.id)]);
    const nombres = new Set([raiz.name]);
    // Se recorre hacia abajo hasta que no aparezcan hijas nuevas. El tope de
    // vueltas es la red de seguridad por si quedara un ciclo en los datos.
    for (let vuelta = 0; vuelta < 10; vuelta++) {
        const antes = ids.size;
        for (const c of cats) {
            if (c.parent_id != null && ids.has(Number(c.parent_id))) {
                ids.add(Number(c.id));
                nombres.add(c.name);
            }
        }
        if (ids.size === antes) break;
    }
    return { ids, nombres };
}

/**
 * Una página de una categoría Y DE SU RAMA, con el mismo orden que
 * `categoryProducts` del servidor: ofertas primero y después por nombre, sin
 * distinguir mayúsculas.
 */
export async function productosPorCategoriaLocal(companyId, category, offset = 0, limite = 30) {
    if (!companyId) return [];
    const filas = await filasDe(companyId);

    let dela;
    if (category && category !== 'Todos') {
        // Por id y por nombre, igual que el servidor: si un producto quedó sin
        // category_id, igual aparece bajo su categoría.
        const { ids, nombres } = await ramaDe(companyId, category);
        dela = filas.filter((p) => ids.has(Number(p.category_id)) || nombres.has(p.category));
    } else {
        dela = filas.slice();
    }

    dela.sort((a, b) => {
        const oa = a.is_offer ? 1 : 0;
        const ob = b.is_offer ? 1 : 0;
        if (oa !== ob) return ob - oa;
        if (a._orden < b._orden) return -1;
        if (a._orden > b._orden) return 1;
        return 0;
    });

    return conFotosGuardadas(dela.slice(offset, offset + limite).map(paraLaUI));
}

/**
 * Un producto por código escaneado. El servidor (`productByBarcode`) busca por
 * `sku` o por `name` exactos; acá se hace lo mismo.
 */
export async function productoPorCodigoLocal(companyId, codigo) {
    if (!companyId || !codigo) return null;
    const filas = await filasDe(companyId);
    const c = String(codigo);
    const p = filas.find((x) => String(x.sku) === c || String(x.name) === c);
    if (!p) return null;
    const [conFoto] = await conFotosGuardadas([paraLaUI(p)]);
    return conFoto;
}

/** Cuántos productos hay guardados para esta empresa. */
export async function cuantosProductosLocales(companyId) {
    if (!companyId) return 0;
    const filas = await filasDe(companyId);
    return filas.length;
}

/**
 * Resumen de lo que hay guardado para trabajar sin internet.
 *
 * Lo usa el aviso de "sin conexión": no es lo mismo quedarse sin internet con el
 * catálogo al día que quedarse sin internet y sin catálogo, y el cajero necesita
 * saber en cuál de las dos está antes de que se le forme la fila.
 */
export async function estadoCatalogoLocal(companyId) {
    if (!companyId) return { productos: 0, ultimoSync: null };
    const [productos, meta] = await Promise.all([
        cuantosProductosLocales(companyId),
        localDb.meta.get(`lastSync:${companyId}`),
    ]);
    return { productos, ultimoSync: meta?.value || null };
}
