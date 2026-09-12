// La cuenta de un renglón de pedido: costo × cantidad = total.
//
// Son tres datos atados por una sola multiplicación, así que con dos cualquiera
// sale el tercero. Cada modo de la pantalla despeja uno distinto, según lo que
// la persona tenga a mano cuando está comprando:
//
//   POR UNIDAD   costo + cantidad → TOTAL
//                "el limón va a $2.000 el kilo y llevo 12" → $24.000
//   POR CAJA     total + cantidad → COSTO
//                "pagué $25.000 y me pesaron 12 kg" → $2.083 el kilo
//   POR PAGADO   costo + total → CANTIDAD
//                "el limón va a $2.000 el kilo y pagué $25.000" → 12,5 kg
//
// El tercero lo pidió Kevin el 11-sep-2026: en la feria el proveedor cobra por
// kilo y al final dice el monto, sin decir cuánto pesó. Antes había que sacar la
// división aparte, con la calculadora del teléfono, y escribir el resultado.
//
// Está acá afuera y no adentro de la pantalla para poder probar la cuenta sin
// levantar la interfaz: es plata, y una división mal redondeada se arrastra al
// costo del producto y de ahí al precio de venta.

/** Redondeo a dos decimales, que es como se muestra la plata. */
export const dosDecimales = (n) => Math.round(n * 100) / 100;

/**
 * Los kilos llevan TRES decimales, no dos.
 *
 * 10,417 kg a $2.000 son $20.834. Redondeado a 10,42 darían $20.840: seis pesos
 * de más en un renglón, que en una factura de 40 renglones ya no es nada
 * despreciable — y el costo unitario que queda guardado es el que después fija
 * el precio de venta.
 */
export const tresDecimales = (n) => Math.round(n * 1000) / 1000;

export const MODO_UNIDAD = 'unidad';
export const MODO_TOTAL = 'total';
export const MODO_CANTIDAD = 'cantidad';

/**
 * Despeja el dato que falta.
 *
 * @param {object} p
 * @param {string} p.modo      Cuál de los tres campos calcula el sistema.
 * @param {any} p.bruto        Costo unitario CON impuesto.
 * @param {any} p.cantidad     Cuánto se compra.
 * @param {any} p.total        Lo pagado, CON impuesto.
 * @param {number} p.tasa      Impuesto en % (19, 0, …).
 * @param {boolean} p.porPeso  Si el producto admite decimales (kg, lt).
 * @returns {{campo: string, bruto?: number|'', neto?: number|'', cantidad?: number|'', total?: number|''}}
 *          `campo` dice cuál se calculó. Un valor '' significa "no se puede
 *          calcular todavía": faltan datos o alguno es inválido.
 */
export function resolverLinea({ modo, bruto, cantidad, total, tasa = 0, porPeso = false }) {
    const iva = 1 + (Number(tasa) || 0) / 100;
    const b = parseFloat(bruto);
    const q = parseFloat(cantidad);
    const t = parseFloat(total);

    if (modo === MODO_TOTAL) {
        // El total y la cantidad son datos; el costo se deduce.
        if (isNaN(t) || isNaN(q) || q <= 0) return { campo: 'costo', bruto: '', neto: '' };
        const brutoCalc = dosDecimales(t / q);
        return { campo: 'costo', bruto: brutoCalc, neto: dosDecimales(brutoCalc / iva) };
    }

    if (modo === MODO_CANTIDAD) {
        // El costo y el total son datos; la cantidad se deduce.
        //
        // Se divide por el costo CON impuesto porque el total también lo lleva:
        // es lo que se pagó. Dividir el monto pagado por el costo neto daría de
        // más — con IVA 19% daría un 19% más de kilos de los que hubo.
        if (isNaN(t) || isNaN(b) || b <= 0) return { campo: 'cantidad', cantidad: '' };
        const cant = tresDecimales(t / b);
        // Lo que se compra por unidad no puede dar 12,5 paquetes.
        return { campo: 'cantidad', cantidad: porPeso ? cant : Math.max(1, Math.round(cant)) };
    }

    // MODO_UNIDAD: el costo y la cantidad son datos; el total se deduce.
    if (isNaN(b) || isNaN(q)) return { campo: 'total', total: '' };
    return { campo: 'total', total: dosDecimales(b * q) };
}
