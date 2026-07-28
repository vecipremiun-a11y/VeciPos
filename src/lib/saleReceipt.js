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

/**
 * Normaliza una venta al modelo de boleta que consumen el generador térmico y el
 * HTML web. `receiptConfig` es la config editable de la boleta (nombre, RUT, pie…).
 */
export function buildSaleReceiptModel(sale, { sellerName, receiptConfig = {}, currency = 'CLP', dteInfo = null } = {}) {
    const isCash = ['cash', 'efectivo', 'Efectivo'].includes(sale.paymentMethod);
    const paymentLabel = isCash ? 'Efectivo' : (sale.paymentMethod || 'Efectivo');
    const amountPaid = sale.paymentDetails?.amount ?? sale.total;
    const changeAmt = sale.paymentDetails?.change ?? 0;
    const money = (n) => formatCurrency(n, currency);

    const ticketId = sale?.id ? String(sale.id) : String(Date.now()).slice(-6);
    const folio = dteInfo?.folio ?? sale.dte_folio ?? null;
    const tipoDte = sale.tipoDte ?? sale.tipo_dte ?? null;
    const docLabel = folio ? (tipoDte === 33 ? 'FACTURA ELECTRONICA' : 'BOLETA ELECTRONICA') : null;

    const lines = [];
    if (receiptConfig.address) lines.push(receiptConfig.address);
    if (receiptConfig.show_tax_id && receiptConfig.tax_id) lines.push(`RUT: ${receiptConfig.tax_id}`);
    if (receiptConfig.show_phone && receiptConfig.phone) lines.push(`Tel: ${receiptConfig.phone}`);
    if (receiptConfig.show_email && receiptConfig.email) lines.push(receiptConfig.email);
    if (receiptConfig.header_message) lines.push(receiptConfig.header_message);

    return {
        companyName: receiptConfig.business_name || 'POSVECI',
        companyLines: lines,
        docLabel,
        code: folio ? undefined : ticketId,
        docLine: folio ? `Folio: ${folio}` : null,
        datetime: new Date(sale.date || Date.now()).toLocaleString('es-CL'),
        seller: sellerName || 'Vendedor',
        clientName: sale.clientName || sale.client_name || null,
        items: (sale.items || []).map(it => ({
            name: it.name, qty: it.quantity, unit: it.unit || 'Und',
            unitPrice: it.price, lineTotal: it.price * it.quantity,
        })),
        total: sale.total,
        paymentMethod: paymentLabel,
        paidLabel: isCash ? `Pagó con: ${money(amountPaid)}` : null,
        remainingLabel: (isCash && changeAmt > 0) ? `Vuelto: ${money(changeAmt)}` : null,
        footer: receiptConfig.footer_message || 'GRACIAS POR SU COMPRA',
    };
}

const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/** HTML de la boleta para imprimir en el navegador (mismo orden/etiquetas que la térmica). */
export function receiptModelToHtml(model, { currency = 'CLP' } = {}) {
    const money = (n) => formatCurrency(n, currency);
    const itemsHtml = (model.items || []).map(it => `
        <div style="margin:4px 0;">
            <div>${esc(it.name)}</div>
            <div style="display:flex;justify-content:space-between;">
                <span>${it.qty} x ${money(it.unitPrice)}</span>
                <span>${money(it.lineTotal)}</span>
            </div>
        </div>`).join('');

    const docHeader = model.docLabel
        ? `<div style="text-align:center;font-weight:bold;">${esc(model.docLabel)}</div>
           ${model.docLine ? `<div style="text-align:center;">${esc(model.docLine)}</div>` : ''}`
        : (model.code ? `<div>Boleta: ${esc(model.code)}</div>` : '');

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Boleta</title>
        <style>
            @page { margin: 0; }
            body { font-family: 'Courier New', monospace; font-size: 12px; color:#000; width: 280px; margin: 0 auto; padding: 8px; }
            .sep { border-top: 1px dashed #000; margin: 6px 0; }
            .row { display:flex; justify-content:space-between; }
            .b { font-weight: bold; }
            .c { text-align:center; }
        </style></head><body onload="window.print(); setTimeout(function(){window.close();}, 300);">
        <div class="c b" style="font-size:15px;">${esc(model.companyName)}</div>
        ${(model.companyLines || []).map(l => `<div class="c">${esc(l)}</div>`).join('')}
        <div class="sep"></div>
        ${docHeader}
        <div>Fecha: ${esc(model.datetime)}</div>
        <div>Vend: ${esc(model.seller)}</div>
        ${model.clientName ? `<div>Cliente: ${esc(model.clientName)}</div>` : ''}
        <div class="sep"></div>
        <div class="row b"><span>DESCRIPCIÓN</span><span>TOTAL</span></div>
        <div class="sep"></div>
        ${itemsHtml}
        <div class="sep"></div>
        <div class="row b"><span>TOTAL</span><span>${money(model.total)}</span></div>
        <div style="margin-top:6px;">Medio Pago: ${esc(model.paymentMethod)}</div>
        ${model.paidLabel ? `<div>${esc(model.paidLabel)}</div>` : ''}
        ${model.remainingLabel ? `<div>${esc(model.remainingLabel)}</div>` : ''}
        <div class="sep"></div>
        <div class="c">${esc(model.footer).replace(/\n/g, '<br/>')}</div>
        </body></html>`;
}

/**
 * Imprime la boleta de una venta. En la app nativa va a la térmica Bluetooth;
 * en el navegador abre la ventana de impresión de siempre.
 * Devuelve { ok, error }. error === 'NO_PRINTER' si falta configurar la impresora.
 */
export async function printSaleReceipt(sale, { sellerName, receiptConfig, currency = 'CLP', dteInfo = null, tedXml = null } = {}) {
    const model = buildSaleReceiptModel(sale, { sellerName, receiptConfig, currency, dteInfo });

    if (isThermalAvailable()) {
        const saved = getSavedPrinter();
        if (!saved) return { ok: false, error: 'NO_PRINTER' };
        // Timbre electrónico SII (PDF417) si el documento es DTE.
        if (tedXml) model.timbre = await buildTimbreRaster(tedXml, saved.paperWidth || 58);
        return printThermalReceipt(model, { money: (n) => formatCurrency(n, currency) });
    }

    // Web: comportamiento de siempre (ventana de impresión del navegador).
    const html = receiptModelToHtml(model, { currency });
    const w = window.open('', '', 'width=400,height=700');
    if (!w) return { ok: false, error: 'POPUP_BLOCKED' };
    w.document.write(html);
    w.document.close();
    return { ok: true };
}
