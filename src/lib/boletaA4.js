// Boleta / factura en hoja A4 (formato "A4 · Carta / Hoja completa" de
// Configuración → Boleta).
//
// Antes el formato A4 imprimía el mismo ticket angosto, solo más ancho y con letra
// más grande (y se pasaba del margen de la hoja). Kevin pidió el 23-oct-2026 poder
// imprimir un documento A4 de verdad: datos del negocio a la izquierda, recuadro
// con el RUT, el tipo de documento y el número a la derecha, tabla de productos,
// totales y el timbre del SII abajo.
//
// Sale del MISMO modelo que el ticket (buildSaleReceiptModel): los productos, el
// total y el medio de pago son exactamente los de la boleta térmica. Del XML del
// DTE solo se LEEN datos para mostrarlos (RUT del emisor, receptor de la factura,
// neto e IVA); la emisión ante el SII no se toca.

import bwipjs from 'bwip-js';
import { formatCurrency } from '../utils/formatCurrency';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// RUT con puntos, como se escribe en Chile: 76123456-7 → 76.123.456-7.
const conPuntos = (rut) => {
    const m = String(rut || '').replace(/\./g, '').match(/^(\d+)-([\dkK])$/);
    return m ? `${m[1].replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${m[2].toUpperCase()}` : rut;
};

// Texto de una etiqueta del XML (la primera que aparezca), con las entidades básicas.
function etiqueta(xml, nombre) {
    const m = String(xml || '').match(new RegExp(`<${nombre}>([^<]*)</${nombre}>`));
    if (!m) return null;
    const v = m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
    return v || null;
}

/**
 * Lo que el documento impreso muestra del DTE firmado. null si no hay XML.
 * Boleta (39) y factura (33) nombran distinto algunas etiquetas del emisor.
 */
export function datosDelDte(xml) {
    if (!xml) return null;
    const num = (n) => (etiqueta(xml, n) != null ? Number(etiqueta(xml, n)) : null);
    const rutRecep = etiqueta(xml, 'RUTRecep');
    return {
        tipo: num('TipoDTE'),
        folio: etiqueta(xml, 'Folio'),
        rutEmisor: conPuntos(etiqueta(xml, 'RUTEmisor')),
        // Boleta 66666666-6 = "sin receptor": no se muestra.
        receptor: rutRecep && rutRecep !== '66666666-6' ? {
            rut: conPuntos(rutRecep),
            razonSocial: etiqueta(xml, 'RznSocRecep'),
            giro: etiqueta(xml, 'GiroRecep'),
            direccion: etiqueta(xml, 'DirRecep'),
            comuna: etiqueta(xml, 'CmnaRecep'),
        } : null,
        neto: num('MntNeto'),
        exento: num('MntExe'),
        iva: num('IVA'),
        tasaIva: num('TasaIVA'),
        total: num('MntTotal'),
    };
}

/** Timbre electrónico (PDF417 del TED) como imagen, o null. Mismo dibujo que el ticket. */
export function timbreComoImagen(xml) {
    const ted = String(xml || '').match(/<TED[\s\S]*?<\/TED>/)?.[0];
    if (!ted || typeof document === 'undefined') return null;
    try {
        const canvas = document.createElement('canvas');
        bwipjs.toCanvas(canvas, { bcid: 'pdf417', text: ted, scale: 2, columns: 7, rowmult: 2, eclevel: 5 });
        return canvas.toDataURL('image/png');
    } catch (e) {
        console.error('Timbre PDF417:', e);
        return null;
    }
}

/**
 * HTML de la hoja A4. `model` = buildSaleReceiptModel(...). `xml` = DTE firmado
 * (si la venta tiene boleta o factura electrónica). `imprimir` = abre el diálogo
 * de impresión al cargar (false para la vista previa de Configuración).
 */
export function boletaA4Html(model, { currency = 'CLP', xml = null, timbreImg = null, imprimir = true } = {}) {
    const money = (n) => formatCurrency(n, currency);
    const emp = model.empresa || {};
    const dte = datosDelDte(xml);

    const esFactura = (dte?.tipo ?? model.tipoDte) === 33;
    const titulo = model.docLabel
        ? (esFactura ? 'FACTURA ELECTRÓNICA' : 'BOLETA ELECTRÓNICA')
        : 'BOLETA';
    const numero = dte?.folio || model.folio || model.code || '';
    const rutCaja = dte?.rutEmisor || (emp.mostrarRut ? emp.rut : null);

    const filas = (model.items || []).map(it => {
        const cant = typeof it.qty === 'number' && it.unit && it.unit !== 'Und' ? `${it.qty} ${it.unit}` : it.qty;
        return `<tr><td class="cant">${esc(cant)}</td><td>${esc(it.name)}</td>
            <td class="num">${money(it.unitPrice)}</td><td class="num">${money(it.lineTotal)}</td></tr>`;
    }).join('');

    const rec = dte?.receptor;
    const meta = [
        ['Fecha', model.datetime],
        ['Vendedor', model.seller],
        rec ? ['Señor(es)', rec.razonSocial] : (model.clientName ? ['Cliente', model.clientName] : null),
        rec ? ['RUT', rec.rut] : null,
        rec?.giro ? ['Giro', rec.giro] : null,
        rec?.direccion ? ['Dirección', [rec.direccion, rec.comuna].filter(Boolean).join(', ')] : null,
        ['Medio de pago', model.paymentMethod],
    ].filter(Boolean);

    // Neto e IVA solo si el DTE los trae (la factura los exige). Si no, el total.
    const totales = [];
    if (dte?.neto != null) {
        totales.push(['Neto', money(dte.neto)]);
        if (dte.exento) totales.push(['Exento', money(dte.exento)]);
        totales.push([`IVA ${dte.tasaIva ?? 19}%`, money(dte.iva || 0)]);
    } else if (model.deliveryFee) {
        totales.push(['Subtotal', money(model.subtotal)]);
        totales.push([model.deliveryLabel || 'Delivery', money(model.deliveryFee)]);
    }
    // "Pagó con: $20.000" → etiqueta a la izquierda, monto a la derecha.
    const pago = [model.paidLabel, model.remainingLabel].filter(Boolean).map(t => {
        const i = String(t).indexOf(':');
        return i > 0 ? [t.slice(0, i), t.slice(i + 1).trim()] : [t, ''];
    });
    // Con boleta o factura electrónica, el total es el del documento timbrado.
    const total = dte?.total ?? model.total;

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(titulo)} ${esc(numero)}</title>
<style>
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    html, body { background: #fff; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #000; margin: 0;
           -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .hoja { width: 100%; max-width: 186mm; margin: 0 auto; }
    .cab { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .emp h1 { font-size: 20px; margin: 0 0 6px; }
    .emp div { margin: 2px 0; }
    .emp .msg { font-style: italic; margin-top: 6px; }
    .caja { border: 2px solid #000; padding: 10px 14px; text-align: center; font-weight: bold; min-width: 64mm; }
    .caja .tipo { font-size: 16px; margin: 6px 0; }
    .caja .nro { font-size: 15px; }
    .meta { display: grid; grid-template-columns: max-content 1fr max-content 1fr; gap: 4px 10px;
            margin: 14px 0 10px; padding: 8px 10px; border: 1px solid #000; }
    .meta .k { font-weight: bold; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; border-bottom: 2px solid #000; padding: 6px 4px; }
    td { padding: 5px 4px; border-bottom: 1px solid #999; vertical-align: top; }
    .cant { white-space: nowrap; width: 1%; padding-right: 12px; }
    .num { text-align: right; white-space: nowrap; }
    .pie { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-top: 14px; }
    .timbre { width: 64mm; text-align: center; font-size: 10px; }
    .timbre img { width: 100%; display: block; margin-bottom: 4px; }
    .totales { min-width: 72mm; margin-left: auto; }
    .totales .f { display: flex; justify-content: space-between; gap: 16px; padding: 3px 0; }
    .totales .total { font-size: 17px; font-weight: bold; border-top: 2px solid #000; margin-top: 4px; padding-top: 6px; }
    .totales .pago { margin-top: 6px; }
    .gracias { text-align: center; margin-top: 22px; font-weight: bold; }
</style></head><body${imprimir ? ' onload="setTimeout(function(){window.print(); setTimeout(function(){window.close();}, 400);}, 150);"' : ''}>
<div class="hoja">
    <div class="cab">
        <div class="emp">
            <h1>${esc(emp.nombre || model.companyName)}</h1>
            ${emp.direccion ? `<div>${esc(emp.direccion)}</div>` : ''}
            ${emp.telefono ? `<div>Tel: ${esc(emp.telefono)}</div>` : ''}
            ${emp.email ? `<div>${esc(emp.email)}</div>` : ''}
            ${emp.mensaje ? `<div class="msg">${esc(emp.mensaje)}</div>` : ''}
        </div>
        <div class="caja">
            ${rutCaja ? `<div>R.U.T.: ${esc(rutCaja)}</div>` : ''}
            <div class="tipo">${esc(titulo)}</div>
            ${numero ? `<div class="nro">N° ${esc(numero)}</div>` : ''}
        </div>
    </div>

    <div class="meta">
        ${meta.map(([k, v]) => `<div class="k">${esc(k)}:</div><div>${esc(v)}</div>`).join('')}
    </div>

    <table>
        <thead><tr><th>Cant.</th><th>Descripción</th><th class="num">Precio unit.</th><th class="num">Total</th></tr></thead>
        <tbody>${filas}</tbody>
    </table>

    <div class="pie">
        ${timbreImg ? `<div class="timbre"><img src="${timbreImg}" alt="Timbre electrónico SII"/>
            <div><b>Timbre Electrónico SII</b></div><div>Verifique documento en www.sii.cl</div></div>` : '<div></div>'}
        <div class="totales">
            ${totales.map(([k, v]) => `<div class="f"><span>${esc(k)}</span><span>${v}</span></div>`).join('')}
            <div class="f total"><span>TOTAL</span><span>${money(total)}</span></div>
            ${pago.map(([k, v]) => `<div class="f pago"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}
        </div>
    </div>

    ${model.footer ? `<div class="gracias">${esc(model.footer).replace(/\n/g, '<br/>')}</div>` : ''}
</div>
</body></html>`;
}
