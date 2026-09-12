// Traer las fotos de los productos sin ahogar al teléfono.
//
// EL PROBLEMA, medido el 11-sep-2026 contra la base real. La pantalla de
// Realizar Pedido pedía TODAS las fotos de la página en UNA sola consulta.
// Para el proveedor más grande (Carozzi, 98 productos con foto) eso son:
//
//     productImages → 9,93 MB en una sola respuesta
//
// En un escritorio con WiFi llega en un par de segundos y no se nota. En el
// teléfono, a 2 Mbps, son unos 40 segundos — y el cliente corta a los 12. La
// promesa se iba al `.catch()` y la pantalla se quedaba SIN NINGUNA foto, sin
// decir nada. Por eso en la web se veían y en la app no.
//
// LA SALIDA, dos cosas:
//
//   1. Primero se mira lo que el equipo YA tiene guardado. Esas aparecen al
//      instante y no cuestan red. La app viene usando esa caché para la grilla
//      del POS desde agosto; esta pantalla la ignoraba.
//   2. Lo que falte se pide en LOTES chicos, y cada lote se muestra apenas
//      llega. Si el quinto lote falla, los cuatro anteriores ya se vieron: se
//      acabó el todo-o-nada.
//
// Un lote de 8 son ~750 KB (la foto promedio pesa 94 KB), que a 2 Mbps entran
// en unos 3 segundos — bien por debajo del corte de 12.

import { reportCall } from './dataApi';
import { imagenesGuardadas, guardarImagenes } from './db/imagenesLocal';

// Cuántas fotos por consulta. Ver el cálculo de arriba antes de subirlo.
export const FOTOS_POR_LOTE = 8;

/**
 * Trae las fotos de una lista de productos y las va entregando por partes.
 *
 * @param {string} companyId
 * @param {number[]} ids       Productos cuya foto se quiere (los que tienen).
 * @param {(mapa: Record<number,string>) => void} alLlegar
 *        Se llama por cada tanda, con {id: fotoBase64}. Se llama varias veces:
 *        una con lo guardado (si hay) y una por cada lote que baje.
 * @param {{ tamLote?: number, seguirVivo?: () => boolean, soloGuardadas?: boolean }} opciones
 *        `seguirVivo` corta el trabajo si la pantalla ya se cerró o cambió de
 *        búsqueda: sin eso se seguirían bajando megas para una lista que ya
 *        nadie está mirando.
 *        `soloGuardadas` usa nada más lo que hay en el equipo, sin tocar la red.
 *        Es para listas largas y pasajeras —un desplegable de búsqueda— donde
 *        bajar decenas de fotos para algo que se cierra en dos segundos no vale.
 */
export async function traerFotos(companyId, ids, alLlegar, opciones = {}) {
    const { tamLote = FOTOS_POR_LOTE, seguirVivo = () => true, soloGuardadas = false } = opciones;
    const lista = [...new Set((ids || []).map(Number).filter(Number.isFinite))];
    if (!companyId || !lista.length) return;

    // ── 1. Lo que ya está en el equipo ───────────────────────────────────
    let faltan = lista;
    try {
        const guardadas = await imagenesGuardadas(lista);
        const tiene = Object.keys(guardadas).length;
        if (tiene) {
            if (!seguirVivo()) return;
            alLlegar(guardadas);
            const yaEstan = new Set(Object.keys(guardadas).map(Number));
            faltan = lista.filter((id) => !yaEstan.has(id));
        }
    } catch (e) {
        // Sin caché se pide todo a la red, que es lo que pasaba antes.
        console.warn('No se pudieron leer las fotos guardadas:', e);
    }

    if (!faltan.length || soloGuardadas) return;

    // ── 2. El resto, de a poco ───────────────────────────────────────────
    for (let i = 0; i < faltan.length; i += tamLote) {
        if (!seguirVivo()) return;
        const lote = faltan.slice(i, i + tamLote);
        try {
            const filas = await reportCall(companyId, 'productImages', { ids: lote });
            if (!Array.isArray(filas) || !seguirVivo()) continue;

            const mapa = {};
            for (const f of filas) if (f?.image) mapa[f.id] = f.image;
            if (!Object.keys(mapa).length) continue;

            alLlegar(mapa);
            // Para la próxima vez, y para cuando no haya internet.
            guardarImagenes(companyId, mapa).catch(() => { /* la foto ya se ve */ });
        } catch {
            // Un lote que falla no se lleva a los demás: se sigue con el próximo.
        }
    }
}
