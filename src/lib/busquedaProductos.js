// Cómo se busca un producto, del lado del navegador.
//
// Gemelo de `api/_lib/busquedaProductos.js`: mismas tres facilidades, para que
// una búsqueda encuentre lo mismo la resuelva el servidor o la resuelva la
// pantalla con lo que ya tiene en memoria.
//
//   1. No importa la MAYÚSCULA   → "PIÑA" y "piña" encuentran lo mismo.
//   2. No importa la TILDE       → "angel" encuentra "Cabello Ángel".
//   3. No importa el ORDEN       → "entera leche" encuentra "Leche Entera".
//
// Por qué existe: varias pantallas filtran la lista que ya tienen cargada, sin
// volver a preguntarle al servidor —los productos por vencer, los productos de
// un encargo—. Esas hacían `name.toLowerCase().includes(termino)`, que falla en
// las tres cosas: no saca tildes, y `includes` exige la frase entera y en orden.
// Así el mismo producto aparecía en un buscador y no en otro, y la diferencia
// no la explicaba nada más que en qué pantalla estabas parado.

/** Sin tildes y en minúsculas: "Ñoquis" y "noquis" son lo mismo para buscar. */
export function normalizar(txt) {
    return String(txt ?? '')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase();
}

/**
 * Parte el término en palabras ya normalizadas.
 *
 * El tope de 6 es el mismo del servidor: pegar un párrafo en el buscador no
 * tiene que convertirse en decenas de comparaciones por fila.
 */
export function palabrasDe(termino) {
    return normalizar(termino).split(/\s+/).filter(Boolean).slice(0, 6);
}

/**
 * ¿Este producto coincide con lo que se escribió?
 *
 * Cada palabra tiene que aparecer en ALGUNO de los campos, en cualquier orden.
 * Un término vacío coincide con todo (la pantalla no filtra nada).
 *
 *   coincide('entera leche', p.name, p.sku)   → true para "Leche Entera Soprole"
 *   coincide('angel', 'Cabello Ángel 400g')   → true
 *
 * @param {string} termino Lo que escribió la persona.
 * @param {...any} campos  Nombre, SKU, lo que la pantalla quiera mirar.
 */
export function coincide(termino, ...campos) {
    const palabras = palabrasDe(termino);
    if (!palabras.length) return true;
    const texto = campos.map(normalizar).join(' ');
    return palabras.every((w) => texto.includes(w));
}

/**
 * Versión para filtrar listas largas sin recalcular el término en cada fila.
 * Devuelve una función lista para pasarle a `.filter()`.
 *
 *   const pasa = filtroDe(searchTerm);
 *   productos.filter(p => pasa(p.name, p.sku))
 */
export function filtroDe(termino) {
    const palabras = palabrasDe(termino);
    if (!palabras.length) return () => true;
    return (...campos) => {
        const texto = campos.map(normalizar).join(' ');
        return palabras.every((w) => texto.includes(w));
    };
}
