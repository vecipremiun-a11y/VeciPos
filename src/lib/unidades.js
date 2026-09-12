// Qué productos se compran por peso y cómo se los nombra.
//
// Por qué existe: al proveedor se le compra "a $2.000 el kilo" y se paga un
// total, así que la cantidad de un renglón puede ser 5,6 — no siempre un
// entero. La unidad sale de la ficha del producto (`products.unit`).
//
// Vivía suelto dentro de Orders.jsx. Se sacó acá cuando apareció que la lista
// del pedido no dejaba corregir los kilos de un renglón ya cargado: el
// formulario de arriba sí aceptaba decimales y la lista de abajo no, porque
// cada uno decidía por su cuenta. Con una sola definición no pueden volver a
// contradecirse, y se puede probar sin levantar la pantalla.

/** ¿Este producto se compra fraccionado (kilos, litros) o de a unidades? */
export const esFraccionable = (unit) =>
    /^(kg|kgs|kilo|kilos|gr|grs|gramo|gramos|g|lt|lts|litro|litros|l|ml)$/i
        .test(String(unit || '').trim());

/**
 * Cómo se escribe la unidad en pantalla.
 *
 * "Costo por kg" / "Costo por unidad": mostrarla evita el malentendido de leer
 * "Costo Unitario" en algo que se vende por kilo.
 */
export const etiquetaUnidad = (unit) => {
    const u = String(unit || 'Und').trim();
    return /^und$/i.test(u) ? 'unidad' : u.toLowerCase();
};

/**
 * Lee una cantidad escrita a mano.
 *
 * Acepta la coma además del punto: el teclado numérico del teléfono en Chile
 * ofrece las dos y escribir "5,6" es lo natural acá. Devuelve NaN si no es un
 * número, para que quien llama decida qué hacer.
 */
export const aCantidad = (valor) => Number(String(valor ?? '').trim().replace(',', '.'));

/** Lo que se puede ir escribiendo sin que el campo se trabe: "5", "5.", "5,6". */
export const CANTIDAD_TECLEABLE = /^\d*[.,]?\d*$/;

/**
 * La cantidad final de un renglón, según su unidad.
 *
 * Por peso se guarda tal cual (0,5 kg es medio kilo). Por unidad se redondea a
 * un entero de al menos 1: pedir 2,5 paquetes no significa nada.
 * Devuelve null si lo escrito no sirve.
 */
export function cantidadValida(valor, unit) {
    const n = aCantidad(valor);
    if (!Number.isFinite(n) || n <= 0) return null;
    return esFraccionable(unit) ? n : Math.max(1, Math.round(n));
}
