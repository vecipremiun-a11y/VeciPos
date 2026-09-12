// El desplegable de categorías: jerarquía a la vista y cuántos productos hay.
//
// Por qué existe: las categorías tienen padres desde la migración 0024
// —categoría → subcategoría → sub-subcategoría— pero el desplegable del
// inventario las listaba planas y en orden alfabético. Así "Granel" aparecía
// suelta entre medio, sin que se viera que cuelga de Mascota, y no había forma
// de saber cuántos productos tiene cada una sin entrar a filtrar una por una.
//
// Medido contra la base real el 11-sep-2026: 43 categorías, 6 colgando de otra,
// hasta 3 niveles de profundidad.
//
// EL CONTEO VA POR NOMBRE, NO POR ID, y no es un descuido. El filtro del
// inventario compara `products.category` (el texto), así que el número tiene
// que salir de la misma comparación: si contáramos por `category_id`, el
// desplegable diría "Frios 244" y al elegirlo aparecerían 257. Medido: en 7 de
// las 43 categorías los dos conteos NO coinciden, porque 23 productos quedaron
// sin `category_id` y otros tienen el nombre desincronizado del id.
//
// El número que se muestra es el que se va a ver al elegir esa opción. Nada más.

/** Espacio duro: dentro de un <option> los espacios normales se colapsan. */
const SANGRIA = '   ';

/**
 * Arma la lista de opciones del desplegable, en orden de árbol.
 *
 * Las de primer nivel van alfabéticas, y debajo de cada una sus hijas, también
 * alfabéticas, recursivamente.
 *
 * @param {Array<{id:number,name:string,parent_id?:number|null}>} categorias
 * @param {Record<string,number>} conteos  {nombre: cuántos productos}. Si no
 *        llegó todavía, las opciones salen sin número en vez de con un "0"
 *        que sería mentira.
 * @returns {Array<{id,value,etiqueta,nivel,cantidad}>}
 */
export function opcionesCategorias(categorias, conteos = null) {
    const lista = Array.isArray(categorias) ? categorias.filter(Boolean) : [];
    if (!lista.length) return [];

    // Un padre que no está en la lista (borrado, o de otra empresa) dejaría a
    // sus hijas invisibles. Se las trata como de primer nivel.
    const ids = new Set(lista.map(c => Number(c.id)));
    const hijasDe = new Map();
    for (const c of lista) {
        const padre = c.parent_id != null && ids.has(Number(c.parent_id)) ? Number(c.parent_id) : null;
        if (!hijasDe.has(padre)) hijasDe.set(padre, []);
        hijasDe.get(padre).push(c);
    }
    for (const arr of hijasDe.values()) {
        arr.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'));
    }

    const salida = [];
    const vistas = new Set(); // corta un ciclo padre→hija→padre si lo hubiera
    const recorrer = (padre, nivel) => {
        for (const c of hijasDe.get(padre) || []) {
            const id = Number(c.id);
            if (vistas.has(id)) continue;
            vistas.add(id);

            const nombre = String(c.name || '');
            const cantidad = conteos ? (conteos[nombre] ?? 0) : null;
            salida.push({
                id: c.id,
                value: nombre,
                nivel,
                cantidad,
                etiqueta: SANGRIA.repeat(nivel)
                    + (nivel > 0 ? '└ ' : '')
                    + nombre
                    + (cantidad === null ? '' : `  (${cantidad})`),
            });
            recorrer(id, nivel + 1);
        }
    };
    recorrer(null, 0);
    return salida;
}

/** Pasa las filas del servidor a {nombre: cantidad}. */
export function mapaDeConteos(filas) {
    const mapa = {};
    for (const f of filas || []) {
        const nombre = f?.nombre ?? f?.category ?? '';
        if (nombre) mapa[nombre] = Number(f.n) || 0;
    }
    return mapa;
}
