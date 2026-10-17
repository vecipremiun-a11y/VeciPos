// Delivery en la boleta (definido con Kevin el 9-oct-2026).
//
// Un pedido a domicilio que se cobra al entregar (del POS o de la tienda web)
// registra la venta con los productos y, aparte, el valor del delivery en
// payment_details.deliveryFee; el total de la venta es productos + delivery.
// El ticket lo muestra como "Subtotal / Delivery / Total". Al SII va como una
// línea más del detalle —el formato del DTE no tiene un casillero para el
// despacho—, así la boleta suma lo mismo que pagó el cliente.
//
// Las ventas sin delivery salen exactamente igual que antes.

export function itemsConDelivery(items, paymentDetails) {
    let det = paymentDetails;
    if (typeof det === 'string') {
        try { det = JSON.parse(det); } catch { det = null; }
    }
    const fee = Math.round(Number(det?.deliveryFee) || 0);
    if (!(fee > 0)) return items;
    return [...(items || []), { name: 'Delivery', quantity: 1, price: fee, tax_rate: 19 }];
}
