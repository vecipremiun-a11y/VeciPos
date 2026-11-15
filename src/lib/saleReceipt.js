// Boleta de venta unificada — un solo modelo/formato para TODOS los dispositivos.
//
// Objetivo (pedido por Kevin): "esa misma forma o característica de la boleta
// debe regir para todos los dispositivos". Aquí se arma UNA sola vez el modelo
// de la boleta a partir de una venta, y se imprime:
//   · en la app nativa  → impresora térmica Bluetooth (ESC/POS)
//   · en el navegador    → ventana de impresión (window.print), como siempre
//
// Lo usan tanto la venta recién hecha (SaleSuccessModal) como la reimpresión
// desde el Historial, para que el ticket sea idéntico en ambos casos.

import { formatCurrency } from '../utils/formatCurrency';
import { isThermalAvailable, getSavedPrinter, printThermalReceipt, buildTimbreRaster } from './thermalPrint';
import { boletaA4Html, timbreComoImagen, datosDelDte, emisorParaImprimir } from './boletaA4';

/**
 * Cómo se lee la cantidad de un renglón en el ticket.
 *
 * Un renglón vendido por caja (unidades de medida, migración 0030) viaja en
 * unidades —30 × $253,33— para que la venta, el stock y la boleta del SII no
 * cambien. Pero en el ticket "30 × $253" confunde: a ojo da $7.590 y no los
 * $7.600 que se cobraron. Acá se muestra como lo vio el cliente:
 * "1 Caja (30 und) × $7.600". El total del renglón es el mismo en los dos casos.
 */
export function cantidadTicket(item) {
    const p = item?.presentacion;
    if (p && Number(p.unidades) > 0 && Number(p.cantidad) > 0) {
        return { cantidad: `${p.cantidad} ${p.nombre} (${p.unidades} und)`, precio: Number(p.precio) };
    }
    return { cantidad: item?.quantity, precio: item?.price };
}

// Un "Mostrar" de la config de la boleta: 1/true = sí, 0/false = no. Sin dato
// (columna que todavía no existe, o config de antes) = el valor por defecto.
const mostrarSi = (v, porDefecto) => (v == null ? porDefecto : (v === true || Number(v) === 1));

/**
 * Normaliza una venta al modelo de boleta que consumen el generador térmico y el
 * HTML web. `receiptConfig` es la config editable de la boleta (nombre, RUT, pie…).
 */
export function buildSaleReceiptModel(sale, { sellerName, receiptConfig = {}, currency = 'CLP', dteInfo = null, xml = null } = {}) {
    const isCash = ['cash', 'efectivo', 'Efectivo'].includes(sale.paymentMethod);
    const paymentLabel = isCash ? 'Efectivo' : (sale.paymentMethod || 'Efectivo');
    const amountPaid = sale.paymentDetails?.amount ?? sale.total;
    const changeAmt = sale.paymentDetails?.change ?? 0;
    const money = (n) => formatCurrency(n, currency);

    const ticketId = sale?.id ? String(sale.id) : String(Date.now()).slice(-6);
    // Pedido a domicilio cobrado al entregar (9-oct-2026): el delivery viaja en
    // paymentDetails, fuera de los productos, y se muestra debajo del subtotal.
    const deliveryFee = Math.round(Number(sale.paymentDetails?.deliveryFee) || 0);
    const folio = dteInfo?.folio ?? sale.dte_folio ?? null;
    const tipoDte = sale.tipoDte ?? sale.tipo_dte ?? null;
    const docLabel = folio ? (tipoDte === 33 ? 'FACTURA ELECTRONICA' : 'BOLETA ELECTRONICA') : null;

    // Boleta o factura electrónica: lo que pide el SII impreso sale del DTE
    // firmado, no de esta configuración, para que el papel diga lo mismo que
    // recibió el SII. Formato Boletas Electrónicas v4.2 (8-sep-2025): el RUT del
    // emisor y el IVA van impresos sí o sí. Antes el RUT salía solo si estaba
    // escrito y marcado en Configuración → Boleta, y el IVA no salía nunca.
    // Sin DTE (nota de venta) todo queda como estaba.
    const dte = folio ? datosDelDte(xml || dteInfo?.xml_firmado || null) : null;
    const nombreNegocio = receiptConfig.business_name || 'POSVECI';
    // Razón social, giro y dirección son opcionales en la boleta: salen según los
    // "Mostrar" de Configuración → Boleta (migración 0040). Por defecto (13-nov-2026):
    // nombre de fantasía, RUT y dirección; razón social y giro, solo si se marcan.
    // En la factura emisorParaImprimir los imprime igual (ahí son obligatorios).
    const mostrar = {
        razonSocial: mostrarSi(receiptConfig.show_razon_social, false),
        giro: mostrarSi(receiptConfig.show_giro, false),
        direccion: mostrarSi(receiptConfig.show_address, true),
    };
    // La dirección escrita en Configuración → Boleta manda; si está vacía, en la
    // boleta electrónica va la del DTE.
    const direccionConfig = mostrar.direccion ? (receiptConfig.address || null) : null;
    const emisor = emisorParaImprimir(dte, nombreNegocio, mostrar);
    const esFactura = dte ? (dte.tipo === 33 || dte.tipo === 34) : false;
    const rutConfig = receiptConfig.show_tax_id && receiptConfig.tax_id ? `RUT: ${receiptConfig.tax_id}` : null;

    const lines = [];
    if (emisor) {
        if (emisor.razonSocial) lines.push(emisor.razonSocial);
        if (emisor.rut) lines.push(`RUT: ${emisor.rut}`);
        else if (rutConfig) lines.push(rutConfig);
        if (emisor.giro) lines.push(`Giro: ${emisor.giro}`);
        const dir = direccionConfig || emisor.direccion;
        if (dir) lines.push(dir);
    } else {
        if (direccionConfig) lines.push(direccionConfig);
        if (rutConfig) lines.push(rutConfig);
    }
    const emisorLineas = emisor ? lines.slice() : null;
    if (receiptConfig.show_phone && receiptConfig.phone) lines.push(`Tel: ${receiptConfig.phone}`);
    if (receiptConfig.show_email && receiptConfig.email) lines.push(receiptConfig.email);
    // Lo mismo sin el mensaje de cabecera, para el PDF del Historial, que lo dibuja aparte.
    const datosLineas = lines.slice();
    if (receiptConfig.header_message) lines.push(receiptConfig.header_message);

    // Cliente identificado en el DTE. El SII pide imprimir su RUT si no es el
    // genérico 66.666.666-6 (datosDelDte ya lo descarta); en la factura, además,
    // su razón social, giro y dirección.
    const rec = dte?.receptor || null;
    const clienteVenta = sale.clientName || sale.client_name || null;
    const recNombre = rec?.razonSocial && rec.razonSocial !== 'CLIENTE' ? rec.razonSocial : null;
    const clientLineas = rec ? [
        rec.giro ? `Giro: ${rec.giro}` : null,
        [rec.direccion, rec.comuna].filter(Boolean).join(', ') || null,
    ].filter(Boolean) : [];

    // IVA: obligatorio impreso en la boleta afecta. La boleta lleva el precio con
    // IVA, así que va debajo del total como "IVA incluido". La factura, como
    // siempre: neto, exento e IVA antes del total.
    const desglose = !dte ? [] : esFactura
        ? [
            dte.neto != null ? ['Neto', dte.neto] : null,
            dte.exento ? ['Exento', dte.exento] : null,
            dte.iva != null ? [`IVA ${dte.tasaIva ?? 19}%`, dte.iva] : null,
        ].filter(Boolean)
        : (dte.iva != null ? [['IVA incluido', dte.iva]] : []);

    return {
        companyName: nombreNegocio,
        companyLines: lines,
        // Los datos del emisor sacados del DTE (o null si no es electrónica), por
        // separado para la boleta HTML de SaleSuccessModal, que arma su propio encabezado.
        emisorLineas,
        datosLineas,
        clientRut: rec?.rut || null,
        clientLineas,
        desglose,
        desgloseAntesDelTotal: esFactura,
        // Por separado, para la hoja A4 (boletaA4.js), que los ubica cada uno en su lugar.
        empresa: {
            nombre: receiptConfig.business_name || 'POSVECI',
            direccion: direccionConfig,
            mostrar,
            rut: receiptConfig.tax_id || null,
            mostrarRut: !!(receiptConfig.show_tax_id && receiptConfig.tax_id),
            telefono: receiptConfig.show_phone ? (receiptConfig.phone || null) : null,
            email: receiptConfig.show_email ? (receiptConfig.email || null) : null,
            mensaje: receiptConfig.header_message || null,
        },
        folio,
        tipoDte,
        docLabel,
        code: folio ? undefined : ticketId,
        docLine: folio ? `Folio: ${folio}` : null,
        datetime: new Date(sale.date || Date.now()).toLocaleString('es-CL'),
        seller: sellerName || 'Vendedor',
        // En la factura manda la razón social del receptor; en la boleta, el cliente de la venta.
        clientName: (esFactura ? (recNombre || clienteVenta) : (clienteVenta || recNombre)) || null,
        items: (sale.items || []).map(it => {
            const c = cantidadTicket(it);
            return {
                name: it.name, qty: c.cantidad, unit: it.unit || 'Und',
                unitPrice: c.precio, lineTotal: it.price * it.quantity,
            };
        }),
        subtotal: deliveryFee > 0 ? Number(sale.total) - deliveryFee : null,
        deliveryFee: deliveryFee > 0 ? deliveryFee : null,
        deliveryLabel: 'Delivery',
        total: sale.total,
        paymentMethod: paymentLabel,
        paidLabel: isCash ? `Pagó con: ${money(amountPaid)}` : null,
        remainingLabel: (isCash && changeAmt > 0) ? `Vuelto: ${money(changeAmt)}` : null,
        footer: receiptConfig.footer_message || 'GRACIAS POR SU COMPRA',
    };
}

const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/**
 * HTML de la boleta para imprimir en el navegador (mismo orden/etiquetas que la térmica).
 * `timbreImg`: el timbre del SII como imagen, si la venta es boleta o factura
 * electrónica (antes la reimpresión del Historial en 58/80 mm salía sin timbre).
 * `imprimir`: abre el diálogo de impresión al cargar (false en la vista previa).
 */
export function receiptModelToHtml(model, { currency = 'CLP', formato = null, timbreImg = null, imprimir = true } = {}) {
    const money = (n) => formatCurrency(n, currency);
    // Ancho del papel: el del formato elegido (58mm / 80mm), como la boleta de la
    // venta recién hecha. Sin formato, el ancho fijo de antes (280px).
    const papel = formato === '58mm' || formato === '80mm' ? formato : null;
    const pagina = papel ? `@page { size: ${papel} auto; margin: 0; }` : '@page { margin: 0; }';
    const ancho = papel ? `width: ${papel}; box-sizing: border-box; margin: 0;` : 'width: 280px; margin: 0 auto;';
    const itemsHtml = (model.items || []).map(it => `
        <div style="margin:4px 0;">
            <div>${esc(it.name)}</div>
            <div style="display:flex;justify-content:space-between;">
                <span>${it.qty} x ${money(it.unitPrice)}</span>
                <span>${money(it.lineTotal)}</span>
            </div>
        </div>`).join('');

    // Neto/IVA del DTE (vacío si no es electrónica).
    const desgloseHtml = (model.desglose || []).map(([k, v]) => `<div class="row"><span>${esc(k)}</span><span>${money(v)}</span></div>`).join('');

    const docHeader = model.docLabel
        ? `<div style="text-align:center;font-weight:bold;">${esc(model.docLabel)}</div>
           ${model.docLine ? `<div style="text-align:center;">${esc(model.docLine)}</div>` : ''}`
        : (model.code ? `<div>Boleta: ${esc(model.code)}</div>` : '');

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Boleta</title>
        <style>
            ${pagina}
            /* Gruesa y en negrita, como la boleta del POS: Courier New salía finita en la térmica. */
            body { font-family: Arial, Helvetica, sans-serif; font-weight: bold; font-size: 12px; color:#000; ${ancho} padding: 8px;
                   -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .sep { border-top: 1px dashed #000; margin: 6px 0; }
            .row { display:flex; justify-content:space-between; }
            .b { font-weight: bold; }
            .c { text-align:center; }
        </style></head><body${imprimir ? ' onload="window.print(); setTimeout(function(){window.close();}, 300);"' : ''}>
        <div class="c b" style="font-size:15px;">${esc(model.companyName)}</div>
        ${(model.companyLines || []).map(l => `<div class="c">${esc(l)}</div>`).join('')}
        <div class="sep"></div>
        ${docHeader}
        <div>Fecha: ${esc(model.datetime)}</div>
        <div>Vend: ${esc(model.seller)}</div>
        ${model.clientName ? `<div>Cliente: ${esc(model.clientName)}</div>` : ''}
        ${model.clientRut ? `<div>RUT: ${esc(model.clientRut)}</div>` : ''}
        ${(model.clientLineas || []).map(l => `<div>${esc(l)}</div>`).join('')}
        <div class="sep"></div>
        <div class="row b"><span>DESCRIPCIÓN</span><span>TOTAL</span></div>
        <div class="sep"></div>
        ${itemsHtml}
        <div class="sep"></div>
        ${model.deliveryFee ? `<div class="row"><span>Subtotal</span><span>${money(model.subtotal)}</span></div>
        <div class="row"><span>${esc(model.deliveryLabel || 'Delivery')}</span><span>${money(model.deliveryFee)}</span></div>` : ''}
        ${model.desgloseAntesDelTotal ? desgloseHtml : ''}
        <div class="row b"><span>TOTAL</span><span>${money(model.total)}</span></div>
        ${model.desgloseAntesDelTotal ? '' : desgloseHtml}
        <div style="margin-top:6px;">Medio Pago: ${esc(model.paymentMethod)}</div>
        ${model.paidLabel ? `<div>${esc(model.paidLabel)}</div>` : ''}
        ${model.remainingLabel ? `<div>${esc(model.remainingLabel)}</div>` : ''}
        ${timbreImg ? `<div class="sep"></div>
        <div class="c" style="font-size:10px;">Timbre Electrónico SII</div>
        <img src="${timbreImg}" alt="" style="display:block;width:100%;margin:4px 0;" />
        <div class="c" style="font-size:10px;">Verifique documento: www.sii.cl</div>` : ''}
        <div class="sep"></div>
        <div class="c">${esc(model.footer).replace(/\n/g, '<br/>')}</div>
        </body></html>`;
}

/**
 * Imprime la boleta de una venta. En la app nativa va a la térmica Bluetooth;
 * en el navegador abre la ventana de impresión de siempre.
 * Devuelve { ok, error }. error === 'NO_PRINTER' si falta configurar la impresora.
 */
// `formato`: '58mm' | '80mm' | 'a4' — el que eligió el usuario en el POS
// (formatoAImprimir). Sin él, el de Configuración → Boleta.
export async function printSaleReceipt(sale, { sellerName, receiptConfig, currency = 'CLP', dteInfo = null, tedXml = null, formato = null } = {}) {
    // `tedXml` es el DTE firmado entero (no solo el TED): de ahí salen RUT, giro e IVA.
    const model = buildSaleReceiptModel(sale, { sellerName, receiptConfig, currency, dteInfo, xml: tedXml });

    if (isThermalAvailable()) {
        const saved = getSavedPrinter();
        if (!saved) return { ok: false, error: 'NO_PRINTER' };
        // Timbre electrónico SII (PDF417) si el documento es DTE.
        if (tedXml) model.timbre = await buildTimbreRaster(tedXml, saved.paperWidth || 58);
        return printThermalReceipt(model, { money: (n) => formatCurrency(n, currency) });
    }

    // Web: ventana de impresión del navegador. En A4, la hoja completa (con su
    // timbre); si no, el ticket del ancho elegido.
    const fmt = formato || receiptConfig?.format || null;
    const html = fmt === 'a4'
        ? boletaA4Html(model, { currency, xml: tedXml, timbreImg: timbreComoImagen(tedXml) })
        : receiptModelToHtml(model, { currency, formato: fmt, timbreImg: timbreComoImagen(tedXml) });
    const w = window.open('', '', fmt === 'a4' ? 'width=900,height=1000' : 'width=400,height=700');
    if (!w) return { ok: false, error: 'POPUP_BLOCKED' };
    w.document.write(html);
    w.document.close();
    return { ok: true };
}
