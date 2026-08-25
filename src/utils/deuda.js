// Cuánto se le debe todavía a una venta a crédito.
//
// El detalle que parece menor y no lo es: los productos por peso dejan totales con
// decimales ($30.271,5), pero el abono se escribe en pesos enteros. Al repartir un
// pago entero entre boletas con decimales, a la última siempre le queda un resto de
// centavos — y como el sistema exigía resto EXACTAMENTE cero para dar la venta por
// pagada, esa boleta se quedaba en "Movimientos Pendientes" para siempre, mostrando
// "ABONO PARCIAL: $6.082 / $6.082 · Resta: $0".
//
// Pasó de verdad con la venta 1016838: total 6082, abonado 6081,80000000000³. Nadie
// puede pagar esos 20 centavos: no existe con qué.
//
// Por eso el criterio es "¿queda algo que se pueda cobrar?" y no "¿quedó en cero?".
// El redondeo además se come los residuos de coma flotante (esos 0,000000003 que
// salen de sumar decimales en JavaScript), que si no también dejarían boletas
// colgadas.

/** Lo que falta pagar de una venta, en crudo (puede traer decimales). */
export function restoDeVenta(venta) {
    const total = parseFloat(venta?.total || 0);
    const abonado = parseFloat(venta?.amount_paid || 0);
    return total - abonado;
}

// Menos de un peso no es deuda: la moneda chilena no tiene con qué pagarlo. El
// tope está en la unidad de la moneda a propósito — si algún día se opera en una
// moneda con centavos, esto hay que revisarlo.
const RESTO_NO_COBRABLE = 1;

/** ¿Queda algo cobrable? */
export function estaSaldada(venta) {
    return restoDeVenta(venta) < RESTO_NO_COBRABLE;
}

/**
 * ¿Esta venta sigue debiendo plata?
 * Anuladas y ya marcadas como pagadas quedan afuera; las demás, según el resto.
 */
export function tieneDeuda(venta) {
    if (!venta) return false;
    if (venta.payment_method !== 'Crédito') return false;
    if (venta.status === 'paid' || venta.status === 'cancelled') return false;
    return !estaSaldada(venta);
}
