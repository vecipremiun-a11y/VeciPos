// Comprobante del paquete de un envío a domicilio, y la boleta en PDF.
//
// El comprobante es INFORMATIVO: se pega en el paquete para que quien arma y
// quien reparte sepan de quién es, a dónde va, cuándo y qué lleva. No es boleta
// (la boleta se emite al entregar, cuando el repartidor cobra). Lleva nombre,
// teléfono, dirección, fecha y hora de entrega, productos con su precio, costo
// de envío y total a cobrar.
//
// Mismo criterio que la boleta (saleReceipt.js): en la app va directo a la
// térmica Bluetooth; en el navegador abre la ventana de impresión. Formato 58mm
// (pedido por Kevin el 6-oct-2026). Además se puede descargar en PDF.
//
// No toca la impresión existente: usa printThermalReceipt tal cual, que ya
// acepta cliente, teléfono, dirección, subtotal y despacho.

import jsPDF from 'jspdf';
import bwipjs from 'bwip-js';
import { formatCurrency } from '../utils/formatCurrency';
import { isThermalAvailable, getSavedPrinter, printThermalReceipt } from './thermalPrint';
import { buildSaleReceiptModel } from './saleReceipt';
import { reportCall } from './dataApi';

const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/**
 * "Hoy 12:00", "Mañana", "mié 08 oct 18:30"… o null si no tiene fecha.
 * `absoluto`: siempre con día y fecha — para lo IMPRESO: un papel que dice
 * "Mañana" y se lee al día siguiente ya miente.
 */
export function textoEntrega(fecha, hora, { absoluto = false } = {}) {
    if (!fecha && !hora) return null;
    let dia = '';
    if (fecha) {
        const [a, m, d] = String(fecha).split('-').map(Number);
        const f = new Date(a, (m || 1) - 1, d || 1);
        const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
        const diff = Math.round((f - hoy) / 86400000);
        const largo = f.toLocaleDateString('es-CL', { weekday: 'short', day: '2-digit', month: 'short' });
        dia = absoluto ? largo
            : diff === 0 ? 'Hoy'
            : diff === 1 ? 'Mañana'
                : diff === -1 ? 'Ayer'
                    : largo;
    }
    return [dia, hora || ''].filter(Boolean).join(' ');
}

/** Config de la boleta (nombre, dirección, teléfono, pie) para encabezar los documentos. */
export async function configBoleta(companyId) {
    try {
        const rows = await reportCall(companyId, 'receiptConfig', {});
        const r = rows?.[0] || {};
        return {
            ...r,
            show_tax_id: r.show_tax_id === 1,
            show_phone: r.show_phone === 1,
            show_email: r.show_email === 1,
        };
    } catch {
        return {};
    }
}

/** Pedido guardado en el envío: { items, client, total } o null (envío de una venta ya cobrada). */
function pedidoDe(envio) {
    if (!envio?.order_data) return null;
    if (typeof envio.order_data === 'object') return envio.order_data;
    try { return JSON.parse(envio.order_data); } catch { return null; }
}

/** Modelo del comprobante del paquete, con la forma que imprime la térmica. */
export function modeloComprobanteEnvio(envio, receiptConfig = {}) {
    const pedido = pedidoDe(envio);
    const fee = Number(envio.delivery_fee) || 0;
    const subtotal = pedido ? Number(pedido.total) || 0 : null;
    const aCobrar = Number(envio.pendiente_real ?? envio.amount_to_collect) || 0;
    const entrega = textoEntrega(envio.scheduled_date, envio.scheduled_time, { absoluto: true });
    const lineas = [];
    if (receiptConfig.address) lineas.push(receiptConfig.address);
    if (receiptConfig.phone) lineas.push(`Tel: ${receiptConfig.phone}`);
    return {
        companyName: receiptConfig.business_name || 'POSVECI',
        companyLines: lineas,
        docLabel: `ENVÍO #${envio.id}`,
        docLine: entrega ? `Entrega: ${entrega}` : 'Entrega: sin fecha',
        datetime: new Date(envio.created_at || Date.now()).toLocaleString('es-CL'),
        clientName: envio.client_name || null,
        clientPhone: envio.client_phone || null,
        address: envio.address || null,
        items: (pedido?.items || []).map(it => ({
            name: it.name,
            qty: it.presentacion?.cantidad ? `${it.presentacion.cantidad} ${it.presentacion.nombre}` : it.quantity,
            unitPrice: it.presentacion?.cantidad ? Number(it.presentacion.precio) : Number(it.price) || 0,
            lineTotal: (Number(it.price) || 0) * (Number(it.quantity) || 0),
        })),
        subtotal: subtotal ?? undefined,
        deliveryFee: fee || undefined,
        total: pedido ? subtotal + fee : aCobrar,
        paymentMethod: aCobrar > 0 ? 'COBRAR AL RECIBIR' : 'PAGADO',
        notes: envio.address_notes ? `Ref: ${envio.address_notes}` : null,
        footer: 'Documento informativo: no es boleta.',
        // Solo para el PDF / HTML: cuánto cobra el repartidor.
        _aCobrar: aCobrar,
    };
}

// HTML 58mm para el navegador (la térmica de la app no lo usa).
function comprobanteHtml(m, money) {
    const items = (m.items || []).map(it => `
        <div class="it"><div class="b">${esc(it.name)}</div>
        <div class="row"><span>${esc(it.qty)} x ${money(it.unitPrice)}</span><span>${money(it.lineTotal)}</span></div></div>`).join('');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(m.docLabel)}</title>
        <style>
            @page { size: 58mm auto; margin: 0; }
            * { box-sizing: border-box; }
            body { font-family: Arial, sans-serif; font-size: 11px; color:#000; width: 54mm; margin: 0 auto; padding: 2mm 0; }
            .c { text-align: center; } .b { font-weight: bold; }
            .sep { border-top: 1px dashed #000; margin: 5px 0; }
            .row { display:flex; justify-content:space-between; gap: 4px; }
            .doc { font-size: 15px; font-weight: 900; letter-spacing: 1px; }
            .ent { font-size: 13px; font-weight: 900; background:#000; color:#fff; padding: 2px 4px; display:inline-block; margin-top: 2px; }
            .cli { font-size: 14px; font-weight: 900; }
            .dir { font-size: 12px; font-weight: 700; }
            .it { margin: 3px 0; }
            .tot { font-size: 15px; font-weight: 900; }
        </style></head><body onload="window.print(); setTimeout(function(){window.close();}, 400);">
        <div class="c b" style="font-size:13px;">${esc(m.companyName)}</div>
        ${(m.companyLines || []).map(l => `<div class="c" style="font-size:9px;">${esc(l)}</div>`).join('')}
        <div class="sep"></div>
        <div class="c doc">${esc(m.docLabel)}</div>
        <div class="c"><span class="ent">${esc(m.docLine)}</span></div>
        <div class="sep"></div>
        ${m.clientName ? `<div class="cli">${esc(m.clientName)}</div>` : ''}
        ${m.clientPhone ? `<div>Tel: ${esc(m.clientPhone)}</div>` : ''}
        ${m.address ? `<div class="dir">${esc(m.address)}</div>` : ''}
        ${m.notes ? `<div style="font-style:italic;">${esc(m.notes)}</div>` : ''}
        ${items ? `<div class="sep"></div>${items}` : ''}
        <div class="sep"></div>
        ${m.subtotal != null ? `<div class="row"><span>Productos</span><span>${money(m.subtotal)}</span></div>` : ''}
        ${m.deliveryFee ? `<div class="row"><span>Despacho</span><span>${money(m.deliveryFee)}</span></div>` : ''}
        <div class="row tot"><span>TOTAL</span><span>${money(m.total)}</span></div>
        <div class="c b" style="margin-top:4px;">${esc(m.paymentMethod)}${m._aCobrar > 0 ? ` ${money(m._aCobrar)}` : ''}</div>
        <div class="sep"></div>
        <div class="c" style="font-size:9px;">${esc(m.footer)}</div>
        </body></html>`;
}

/** Imprime el comprobante del paquete. Devuelve { ok, error }. */
export async function imprimirComprobanteEnvio(envio, { companyId, currency = 'CLP' } = {}) {
    const money = (n) => formatCurrency(n, currency);
    const modelo = modeloComprobanteEnvio(envio, await configBoleta(companyId));
    if (isThermalAvailable()) {
        if (!getSavedPrinter()) return { ok: false, error: 'NO_PRINTER' };
        return printThermalReceipt(modelo, { money });
    }
    const w = window.open('', '', 'width=360,height=640');
    if (!w) return { ok: false, error: 'POPUP_BLOCKED' };
    w.document.write(comprobanteHtml(modelo, money));
    w.document.close();
    return { ok: true };
}

// ── PDF de 58mm ────────────────────────────────────────────────────────────
// Se arma en dos pasadas: primero se calcula el alto (el papel es un rollo, el
// largo depende del contenido) y después se dibuja.
function pdf58(dibujar, archivo) {
    const ANCHO = 58;
    const medir = new jsPDF({ unit: 'mm', format: [ANCHO, 1000] });
    const alto = dibujar(medir, false) + 6;
    const doc = new jsPDF({ unit: 'mm', format: [ANCHO, Math.max(alto, 60)] });
    dibujar(doc, true);
    doc.save(archivo);
}

function lineasDe(doc, texto, ancho) {
    return doc.splitTextToSize(String(texto ?? ''), ancho);
}

/** Descarga el comprobante del paquete en PDF (58mm). */
export async function descargarComprobanteEnvio(envio, { companyId, currency = 'CLP' } = {}) {
    const money = (n) => formatCurrency(n, currency);
    const m = modeloComprobanteEnvio(envio, await configBoleta(companyId));
    pdf58((doc, dibuja) => {
        const X = 3, W = 52, C = 29;
        let y = 6;
        const txt = (t, { size = 8, bold = false, align = 'left', gap = 3.6 } = {}) => {
            doc.setFont('helvetica', bold ? 'bold' : 'normal');
            doc.setFontSize(size);
            for (const l of lineasDe(doc, t, W)) {
                if (dibuja) doc.text(l, align === 'center' ? C : X, y, { align });
                y += gap * (size / 8);
            }
        };
        const fila = (a, b, { size = 8, bold = false } = {}) => {
            doc.setFont('helvetica', bold ? 'bold' : 'normal');
            doc.setFontSize(size);
            if (dibuja) { doc.text(String(a), X, y); doc.text(String(b), X + W, y, { align: 'right' }); }
            y += 3.6 * (size / 8);
        };
        const sep = () => { if (dibuja) { doc.setLineDashPattern([0.8, 0.8], 0); doc.line(X, y - 1.5, X + W, y - 1.5); } y += 2; };

        txt(m.companyName, { size: 10, bold: true, align: 'center' });
        for (const l of m.companyLines) txt(l, { size: 6.5, align: 'center' });
        sep();
        txt(m.docLabel, { size: 12, bold: true, align: 'center' });
        txt(m.docLine, { size: 10, bold: true, align: 'center' });
        sep();
        if (m.clientName) txt(m.clientName, { size: 11, bold: true });
        if (m.clientPhone) txt(`Tel: ${m.clientPhone}`);
        if (m.address) txt(m.address, { size: 9, bold: true });
        if (m.notes) txt(m.notes, { size: 7.5 });
        if (m.items.length) {
            sep();
            for (const it of m.items) {
                txt(it.name, { bold: true });
                fila(`${it.qty} x ${money(it.unitPrice)}`, money(it.lineTotal));
            }
        }
        sep();
        if (m.subtotal != null) fila('Productos', money(m.subtotal));
        if (m.deliveryFee) fila('Despacho', money(m.deliveryFee));
        fila('TOTAL', money(m.total), { size: 11, bold: true });
        txt(`${m.paymentMethod}${m._aCobrar > 0 ? ` ${money(m._aCobrar)}` : ''}`, { size: 9, bold: true, align: 'center' });
        sep();
        txt(m.footer, { size: 6.5, align: 'center' });
        return y;
    }, `Envio_${envio.id}.pdf`);
    return { ok: true };
}

/** Descarga la boleta (o nota de venta) de una venta en PDF 58mm, con su timbre si es DTE. */
export async function descargarBoletaPdf(venta, { companyId, currency = 'CLP', sellerName, dteInfo = null, tedXml = null } = {}) {
    const money = (n) => formatCurrency(n, currency);
    const m = buildSaleReceiptModel(venta, { sellerName, receiptConfig: await configBoleta(companyId), currency, dteInfo });
    let timbre = null;
    if (tedXml) {
        try {
            const ted = String(tedXml).match(/<TED[\s\S]*?<\/TED>/)?.[0] || tedXml;
            const canvas = document.createElement('canvas');
            bwipjs.toCanvas(canvas, { bcid: 'pdf417', text: ted, scale: 2, columns: 7, rowmult: 2, eclevel: 5 });
            timbre = canvas.toDataURL('image/png');
        } catch { timbre = null; }
    }
    const nombre = m.docLabel ? `Boleta_${dteInfo?.folio || venta.id}.pdf` : `NotaDeVenta_${venta.id}.pdf`;
    pdf58((doc, dibuja) => {
        const X = 3, W = 52, C = 29;
        let y = 6;
        const txt = (t, { size = 8, bold = false, align = 'left' } = {}) => {
            doc.setFont('courier', bold ? 'bold' : 'normal');
            doc.setFontSize(size);
            for (const l of lineasDe(doc, t, W)) {
                if (dibuja) doc.text(l, align === 'center' ? C : X, y, { align });
                y += 3.5 * (size / 8);
            }
        };
        const fila = (a, b, { size = 8, bold = false } = {}) => {
            doc.setFont('courier', bold ? 'bold' : 'normal');
            doc.setFontSize(size);
            if (dibuja) { doc.text(String(a), X, y); doc.text(String(b), X + W, y, { align: 'right' }); }
            y += 3.5 * (size / 8);
        };
        const sep = () => { if (dibuja) { doc.setLineDashPattern([0.8, 0.8], 0); doc.line(X, y - 1.5, X + W, y - 1.5); } y += 2; };

        txt(m.companyName, { size: 10, bold: true, align: 'center' });
        for (const l of m.companyLines) txt(l, { size: 7, align: 'center' });
        sep();
        if (m.docLabel) { txt(m.docLabel, { bold: true, align: 'center' }); if (m.docLine) txt(m.docLine, { align: 'center' }); }
        else txt(`NOTA DE VENTA N° ${m.code}`, { bold: true, align: 'center' });
        txt(`Fecha: ${m.datetime}`, { size: 7 });
        txt(`Vend: ${m.seller}`, { size: 7 });
        if (m.clientName) txt(`Cliente: ${m.clientName}`, { size: 7 });
        sep();
        for (const it of m.items) {
            txt(it.name, { size: 7.5 });
            fila(`${it.qty} x ${money(it.unitPrice)}`, money(it.lineTotal), { size: 7.5 });
        }
        sep();
        if (m.deliveryFee) {
            fila('Subtotal', money(m.subtotal), { size: 7.5 });
            fila(m.deliveryLabel || 'Delivery', money(m.deliveryFee), { size: 7.5 });
        }
        fila('TOTAL', money(m.total), { size: 10, bold: true });
        txt(`Medio Pago: ${m.paymentMethod}`, { size: 7.5 });
        if (timbre) {
            y += 2;
            if (dibuja) doc.addImage(timbre, 'PNG', X, y, W, 18);
            y += 20;
            txt('Timbre Electrónico SII', { size: 6, align: 'center' });
            txt('Verifique en www.sii.cl', { size: 6, align: 'center' });
        }
        sep();
        txt(m.footer, { size: 7, align: 'center' });
        return y;
    }, nombre);
    return { ok: true };
}
