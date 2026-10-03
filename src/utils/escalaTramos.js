// Reglas de los tramos de la escala de mayoreo. Las usan la ficha del producto
// (ProductModal) y la revisión de precios en Compras (EscalaCompraEditor).
//
// - La venta normal es el tramo 1: el primer tramo de la escala arranca en 2.
// - Cada tramo sigue al anterior: si el anterior va "hasta 5", este va "desde 6".
//   Uno que empezara en 4 pisaría al anterior, y la misma cantidad tendría dos
//   precios.
// - "Hasta" vacío (o 0) es sin tope. Solo el último tramo puede no tenerlo.
//
// Medido el 3-oct-2026 en producción: 8 de 1.724 escalas rompían esto
// ("3 a 8" seguido de "desde 8", filas vacías con desde 1).
//
// Las filas sin precio no cuentan: no se guardan (ver normalizarEscala y
// handleSubmit de la ficha).

const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
const hastaDe = (t) => (num(t?.max) > 0 ? num(t.max) : null);
const tienePrecio = (t) => Number(t?.price) > 0;

/** "Desde" que le corresponde a un tramo nuevo: 2 si es el primero, o el "hasta" anterior + 1. */
export function desdeSiguiente(tramos = []) {
    const ultimo = tramos[tramos.length - 1];
    if (!ultimo) return 2;
    const h = hastaDe(ultimo);
    return h ? h + 1 : '';
}

/** Se puede agregar otro tramo si el último ya tiene "hasta" (si no, el último es sin tope). */
export function puedeAgregarTramo(tramos = []) {
    return !tramos.length || hastaDe(tramos[tramos.length - 1]) !== null;
}

/** Cambia el "hasta" del tramo i y corre el "desde" del siguiente para que lo siga. */
export function encadenarHasta(tramos, i, valor) {
    const n = tramos.map((t, k) => (k === i ? { ...t, max: valor } : t));
    const h = Number(valor);
    if (n[i + 1] && h > 0) n[i + 1] = { ...n[i + 1], min: h + 1 };
    return n;
}

/** Un mensaje por tramo (o null). Solo se revisan los tramos con precio. */
export function erroresEscala(tramos = []) {
    const errores = tramos.map(() => null);
    const marcar = (i, msg) => { if (!errores[i]) errores[i] = msg; };
    let previo = -1;
    tramos.forEach((t, i) => {
        if (!tienePrecio(t)) return;
        const desde = num(t.min);
        const hasta = hastaDe(t);
        if (!(desde > 0)) marcar(i, 'Falta el "desde"');
        else if (previo < 0 && desde <= 1) marcar(i, 'Desde 2 o más: 1 es la venta normal');
        if (desde > 0 && hasta !== null && hasta < desde) marcar(i, '"Hasta" es menor que "desde"');
        if (previo >= 0) {
            const hastaPrevio = hastaDe(tramos[previo]);
            if (hastaPrevio === null) marcar(previo, 'Poné "hasta": después viene otro tramo');
            else if (desde > 0 && desde <= hastaPrevio) marcar(i, `Desde ${hastaPrevio + 1} o más: hasta ${hastaPrevio} es del tramo anterior`);
        }
        previo = i;
    });
    return errores;
}

/** El primer error, listo para mostrar ("Tramo 2: …"), o null si la escala está bien. */
export function primerErrorEscala(tramos = []) {
    const errores = erroresEscala(tramos);
    const i = errores.findIndex(Boolean);
    return i < 0 ? null : `Escala, tramo ${i + 1}: ${errores[i]}`;
}
