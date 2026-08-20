// Fotos de productos guardadas para verlas sin internet.
//
// Por qué no se bajan todas: en la empresa más grande son 1.734 fotos que suman
// 161 MB de base64 (~93 KB cada una, medido el 19-ago-2026). Descargar eso al
// entrar sería peor que no tener fotos.
//
// Lo que se hace en cambio: guardar las que la app YA descargó igual. Cada vez
// que el POS pide las fotos de una página (`loadProductImages`), esas quedan
// acá. O sea que los productos que el local usa todos los días terminan
// disponibles sin conexión solos, sin descargas de más y sin que nadie tenga
// que configurar nada.
//
// Dos topes para que esto no crezca sin control:
//   · No se guarda ninguna foto suelta de más de ~220 KB. Las que pesan eso son
//     justamente las que habría que recomprimir (ver la pantalla de
//     recompresión de imágenes), no las que conviene multiplicar en cada caja.
//   · Máximo TOPE_POR_EMPRESA fotos; al pasarse se borran las más viejas.
//     Con el promedio de hoy son unos 37 MB por empresa.

import Dexie from 'dexie';
import { localDb } from './localdb';

const MAX_LARGO_IMAGEN = 220_000;
const TOPE_POR_EMPRESA = 400;

/**
 * Guarda las fotos que la app acaba de bajar del servidor.
 *
 * @param {string} companyId
 * @param {Record<string|number, string|null>} mapa id → base64 (o null si no tiene)
 * @returns {Promise<number>} cuántas se guardaron
 */
export async function guardarImagenes(companyId, mapa) {
    if (!companyId || !mapa) return 0;

    const candidatos = Object.entries(mapa)
        .filter(([, img]) => typeof img === 'string' && img.length > 0 && img.length <= MAX_LARGO_IMAGEN)
        .map(([id, img]) => ({ id: Number(id), companyId, image: img, ts: Date.now() }))
        .filter((c) => Number.isFinite(c.id));
    if (!candidatos.length) return 0;

    // Solo se escriben las que faltan. Volver a grabar una foto que ya está
    // costaría reescribir ~93 KB por producto en cada búsqueda, para nada.
    // `primaryKeys()` responde sin traerse las fotos.
    const yaEstan = new Set(
        await localDb.productImages.where('id').anyOf(candidatos.map((c) => c.id)).primaryKeys()
    );
    const nuevas = candidatos.filter((c) => !yaEstan.has(c.id));
    if (!nuevas.length) return 0;

    await localDb.productImages.bulkPut(nuevas);
    await recortar(companyId);
    return nuevas.length;
}

/** Deja como mucho TOPE_POR_EMPRESA fotos, borrando primero las más viejas. */
async function recortar(companyId) {
    const total = await localDb.productImages.where('companyId').equals(companyId).count();
    if (total <= TOPE_POR_EMPRESA) return;

    // El índice [companyId+ts] devuelve las claves ordenadas por antigüedad sin
    // cargar las fotos, que es justo lo que hace falta para elegir qué borrar.
    const sobran = await localDb.productImages
        .where('[companyId+ts]')
        .between([companyId, Dexie.minKey], [companyId, Dexie.maxKey])
        .limit(total - TOPE_POR_EMPRESA)
        .primaryKeys();

    if (sobran.length) await localDb.productImages.bulkDelete(sobran);
}

/**
 * Fotos guardadas de una lista de productos.
 * @returns {Promise<Record<number, string>>} id → base64 (solo las que hay)
 */
export async function imagenesGuardadas(ids) {
    if (!ids?.length) return {};
    const filas = await localDb.productImages.bulkGet(ids.map(Number));
    const mapa = {};
    for (const f of filas) if (f?.image) mapa[f.id] = f.image;
    return mapa;
}

/** Cuántas fotos hay guardadas para esta empresa. */
export async function cuantasImagenesLocales(companyId) {
    if (!companyId) return 0;
    return localDb.productImages.where('companyId').equals(companyId).count();
}
