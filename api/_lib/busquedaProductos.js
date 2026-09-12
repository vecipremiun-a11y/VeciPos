// Cómo se busca un producto. UNA sola regla, para todo el sistema.
//
// Las tres facilidades que tiene que dar cualquier buscador de productos:
//
//   1. No importa la MAYÚSCULA        → "PIÑA" y "piña" encuentran lo mismo.
//   2. No importa la TILDE            → "angel" encuentra "Cabello Ángel".
//   3. No importa el ORDEN            → "leche entera" y "entera leche" también.
//
// Por qué existe este archivo: la regla estaba escrita adentro de
// `reportActions.js` y solo la usaban tres consultas. El resto del sistema
// —FEFO, control de inventario, conciliación, combos, la búsqueda para armar
// un pedido— seguía con un `name LIKE ?` pelado, que no baja mayúsculas
// acentuadas, no saca tildes y exige que las palabras vayan en orden. Así que
// el mismo producto aparecía en un buscador y no en otro, y la explicación no
// era ninguna: era en qué pantalla estabas parado.
//
// Ahora la regla vive acá y todos la importan. Si mañana hay que afinarla
// —agregar la "ç", partir por guiones— se cambia en un lugar y vale para todos.
//
// El lado del cliente (búsquedas en memoria, catálogo offline) tiene su gemelo
// en `src/lib/busquedaProductos.js`, con el mismo comportamiento.
//
// Lo que el LIKE crudo NO hacía, medido contra la base real:
//
//   · TILDES. Los productos están cargados sin tilde ("Aji Amarillo") pero el
//     autocorrector del teléfono escribe "ají". Buscar "aji" traía 40
//     productos y "ají" solo 3: la misma persona, con y sin corrector, veía
//     catálogos distintos.
//   · ORDEN. "entera leche" traía CERO resultados, porque LIKE busca la frase
//     entera y en ese orden. Uno no recuerda cómo quedó escrito el producto y
//     empieza por la palabra que sí recuerda.
//
// SQLite no trae función para sacar tildes, así que se arma con REPLACE.
// Parece caro y no lo es: la consulta ya recorría toda la tabla (un LIKE que
// empieza con % no puede usar índice). Medido: 133 ms antes, 139 ms después.

// SQLite baja a minúsculas SOLO el alfabeto inglés. Comprobado contra la base
// real de producción:
//
//     lower('PIÑA')    → 'piÑa'
//     lower('CAFÉ')    → 'cafÉ'
//     lower('MARAÑÓN') → 'maraÑÓn'
//
// Por eso hay que reemplazar también las versiones MAYÚSCULAS de cada letra
// acentuada: si solo se reemplazaran las minúsculas, esas letras pasarían de
// largo. Efecto real en el catálogo: "Carozzi Cabello Ángel Corto 400g" no
// aparecía al escribir "angel", por esa sola letra.
//
// Del lado del término escrito nunca hubo problema: JavaScript sí baja letras
// acentuadas, y además se les sacan las tildes antes de comparar. El desnivel
// estaba solo en la columna.
export const SIN_TILDES = (col) => {
    let e = `lower(${col})`;
    const pares = [
        ['á', 'a'], ['Á', 'a'], ['à', 'a'], ['À', 'a'],
        ['é', 'e'], ['É', 'e'], ['è', 'e'], ['È', 'e'],
        ['í', 'i'], ['Í', 'i'], ['ì', 'i'], ['Ì', 'i'],
        ['ó', 'o'], ['Ó', 'o'], ['ò', 'o'], ['Ò', 'o'],
        ['ú', 'u'], ['Ú', 'u'], ['ù', 'u'], ['Ù', 'u'],
        ['ü', 'u'], ['Ü', 'u'],
        ['ñ', 'n'], ['Ñ', 'n'],
    ];
    for (const [de, a] of pares) {
        e = `REPLACE(${e},'${de}','${a}')`;
    }
    return e;
};

/** Le saca las tildes al texto que escribió la persona, para comparar parejo. */
export const sinTildes = (txt) =>
    String(txt ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/**
 * Arma el filtro de búsqueda de productos: cada palabra del término tiene que
 * aparecer en alguna de las columnas, sin importar el orden ni las tildes.
 *
 * @param {string} termino    Lo que escribió la persona.
 * @param {string[]} columnas Columnas donde buscar. Por defecto nombre y SKU;
 *                            con alias cuando la consulta los usa ('p.name').
 * @returns {{ sql: string, args: string[] }|null} null si no hay nada que buscar.
 */
export function filtroBusquedaProducto(termino, columnas = ['name', 'sku']) {
    const limpio = String(termino ?? '').trim();
    if (!limpio) return null;

    // Tope de palabras: sin él, pegar un párrafo en el buscador arma una
    // consulta con decenas de condiciones sobre toda la tabla.
    const palabras = limpio.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
    if (!palabras.length) return null;

    const cols = (Array.isArray(columnas) && columnas.length ? columnas : ['name'])
        // COALESCE porque un SKU vacío es NULL, y NULL LIKE lo que sea es NULL:
        // sin esto, un producto sin SKU no se encontraba ni por su nombre.
        .map(c => SIN_TILDES(`COALESCE(${c},'')`));

    const unaPalabra = `(${cols.map(c => `${c} LIKE ?`).join(' OR ')})`;
    const partes = palabras.map(() => unaPalabra);

    const args = [];
    for (const w of palabras) {
        // Las tildes del término también se sacan, para comparar manzanas con
        // manzanas: "ají" y "aji" quedan iguales de los dos lados.
        const like = `%${sinTildes(w)}%`;
        for (let i = 0; i < cols.length; i++) args.push(like);
    }
    return { sql: partes.join(' AND '), args };
}
