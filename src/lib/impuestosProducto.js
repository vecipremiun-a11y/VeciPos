// Las cuentas de costo, impuestos y utilidad de un producto.
//
// `tax_rate` es SOLO el IVA: es lo que leen el SII, el POS y las boletas. Los otros
// impuestos (`extra_taxes`, migración 0037) son los que el proveedor cobra además
// del IVA, como el 5% del cerdo. No aparecen al vender: se pagan al comprar, así
// que cuentan como parte del costo.
//
//   costo base        = costo × (1 + otros impuestos)
//   precio neto       = costo base × (1 + utilidad)
//   precio final      = precio neto × (1 + IVA)
//   costo c/impuestos = costo × (1 + IVA + otros impuestos)   → lo que dice la factura
//
// Los impuestos se suman entre sí porque en la factura cada uno sale del neto; no
// se cobra impuesto sobre impuesto. Sin otros impuestos, todo da igual que antes.

const num = (v) => {
    const n = parseFloat(String(v ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
};

/** La lista limpia, venga como venga: JSON de la base, array del formulario o nada. */
export function impuestosExtra(valor) {
    let lista = valor;
    if (typeof valor === 'string') {
        try { lista = JSON.parse(valor); } catch { return []; }
    }
    if (!Array.isArray(lista)) return [];
    return lista
        .map((i) => ({ name: String(i?.name ?? '').trim(), rate: num(i?.rate) }))
        .filter((i) => i.name && i.rate > 0);
}

export const tasaExtra = (extras) => impuestosExtra(extras).reduce((suma, i) => suma + i.rate, 0);

export const costoBase = (costo, extras) => num(costo) * (1 + tasaExtra(extras) / 100);

export const costoConImpuestos = (costo, iva, extras) => num(costo) * (1 + (num(iva) + tasaExtra(extras)) / 100);

export const precioDesdeMargen = (costo, margen, iva, extras) =>
    costoBase(costo, extras) * (1 + num(margen) / 100) * (1 + num(iva) / 100);

/** La ganancia por unidad, sin IVA y descontando los otros impuestos. */
export const utilidadPorUnidad = (precio, costo, iva, extras) =>
    num(precio) / (1 + num(iva) / 100) - costoBase(costo, extras);

/** La utilidad en %. null si todavía no hay costo contra el cual calcularla. */
export function margenDesdePrecio(precio, costo, iva, extras) {
    const base = costoBase(costo, extras);
    if (!(base > 0)) return null;
    return (utilidadPorUnidad(precio, costo, iva, extras) / base) * 100;
}
