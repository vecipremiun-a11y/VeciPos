// Impresión térmica Bluetooth (ESC/POS) para la app nativa.
//
// IMPORTANTE: esto NO reemplaza la impresión web. En el navegador se sigue
// usando window.print() tal cual (src/utils/print*.js). Este módulo solo agrega
// una rama para cuando la app corre como app nativa (Capacitor) y el usuario
// tiene configurada una impresora térmica Bluetooth.
//
// Usa Bluetooth CLASSIC (SPP), que es lo que hablan la gran mayoría de las
// térmicas de 58mm y 80mm del mercado (Xprinter, Goojprt, etc.).

import { Capacitor } from '@capacitor/core';
import bwipjs from 'bwip-js';

const STORAGE_KEY = 'posveci_thermal_printer';

// Caracteres por línea según el ancho del papel (fuente A, ~12x24).
const WIDTH_CHARS = { 58: 32, 80: 48 };
// Puntos (dots) útiles del cabezal según ancho de papel (con pequeño margen).
const WIDTH_DOTS = { 58: 360, 80: 560 };
// Ancho FÍSICO del cabezal en bytes (58mm=384 puntos=48 bytes · 80mm=576=72 bytes).
// Se usa para centrar el timbre rellenando con blanco a la izquierda.
const FULL_BYTES = { 58: 48, 80: 72 };

/** ¿Se puede imprimir por Bluetooth? Solo en la app nativa. */
export const isThermalAvailable = () => Capacitor.isNativePlatform();

// ─── Timbre electrónico SII (PDF417) para térmica ────────────────────────────
function extractTED(xml) {
    if (!xml) return null;
    const m = String(xml).match(/<TED[\s\S]*?<\/TED>/);
    return m ? m[0] : null;
}

/**
 * Genera el timbre PDF417 (a partir del XML firmado o del TED) como imagen raster
 * ESC/POS lista para imprimir en la térmica. Devuelve {bytesPerRow,height,data} o
 * null si no hay TED. `paperWidth` es 58 u 80.
 */
export async function buildTimbreRaster(xmlOrTed, paperWidth = 58) {
    try {
        const ted = extractTED(xmlOrTed) || (String(xmlOrTed || '').includes('<TED') ? xmlOrTed : null);
        if (!ted) return null;
        const maxDots = WIDTH_DOTS[paperWidth] || WIDTH_DOTS[58];

        // Render PDF417 en un canvas (mismos parámetros que la boleta web).
        const canvas = document.createElement('canvas');
        bwipjs.toCanvas(canvas, { bcid: 'pdf417', text: ted, scale: 2, columns: 7, rowmult: 2, eclevel: 5 });

        // Escalar para que quepa en el ancho del papel (sin difuminar).
        let w = canvas.width, h = canvas.height, src = canvas;
        if (w > maxDots) {
            const nw = maxDots, nh = Math.max(1, Math.round(h * (maxDots / w)));
            const c2 = document.createElement('canvas'); c2.width = nw; c2.height = nh;
            const ctx2 = c2.getContext('2d');
            ctx2.imageSmoothingEnabled = false;
            ctx2.fillStyle = '#fff'; ctx2.fillRect(0, 0, nw, nh);
            ctx2.drawImage(canvas, 0, 0, nw, nh);
            src = c2; w = nw; h = nh;
        }

        const px = src.getContext('2d').getImageData(0, 0, w, h).data;
        // Centrado: se imprime a lo ANCHO completo del papel y se rellena con blanco
        // a la izquierda (la impresora no centra por hardware). Padding por bytes.
        const fullBytes = FULL_BYTES[paperWidth] || FULL_BYTES[58];
        const barBytes = Math.ceil(w / 8);
        const bytesPerRow = Math.max(fullBytes, barBytes);
        const offset = Math.max(0, Math.floor((bytesPerRow - barBytes) / 2)) * 8;
        const data = new Uint8Array(bytesPerRow * h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                const dark = px[i + 3] > 128 && (px[i] + px[i + 1] + px[i + 2]) / 3 < 128;
                if (dark) {
                    const bx = offset + x;
                    data[y * bytesPerRow + (bx >> 3)] |= (0x80 >> (bx & 7));
                }
            }
        }
        return { bytesPerRow, height: h, data };
    } catch (e) {
        console.warn('[thermal] no se pudo generar el timbre:', e?.message || e);
        return null;
    }
}

// ─── Impresora guardada ──────────────────────────────────────────────────────
export function getSavedPrinter() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

export function savePrinter({ name, address, paperWidth = 58 }) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ name, address, paperWidth }));
}

export function clearSavedPrinter() {
    localStorage.removeItem(STORAGE_KEY);
}

// ─── Impresoras YA EMPAREJADAS (el camino normal) ────────────────────────────
/**
 * Lista las impresoras que ya están emparejadas en los ajustes Bluetooth del
 * teléfono. Es el camino principal: una impresora emparejada normalmente NO se
 * anuncia, así que el "descubrimiento" no la encuentra. Devuelve [] si no se
 * puede (sin permiso, Bluetooth apagado, etc.) junto con el motivo.
 */
export async function listPairedPrinters() {
    if (!Capacitor.isNativePlatform()) return { devices: [], error: 'Solo disponible en la app.' };
    try {
        const { registerPlugin } = await import('@capacitor/core');
        const PairedPrinters = registerPlugin('PairedPrinters');
        const res = await PairedPrinters.list();
        const all = res?.devices || [];
        // Las que el sistema marca como impresora van primero.
        all.sort((a, b) => (b.isPrinter ? 1 : 0) - (a.isPrinter ? 1 : 0));
        return { devices: all, error: null };
    } catch (e) {
        return { devices: [], error: e?.message || 'No se pudieron leer los dispositivos emparejados.' };
    }
}

// Nota: el descubrimiento activo (startScan) se eliminó. Dependía de un plugin
// externo solo-Android y nunca encontraba impresoras ya emparejadas, que es el
// caso real. El flujo es: emparejar desde los ajustes Bluetooth del teléfono y
// elegirla en listPairedPrinters(). Así la web tampoco arrastra ese plugin.

// ─── Formato de texto para el ticket ─────────────────────────────────────────
/** Línea con texto a la izquierda y monto a la derecha, ajustada al ancho. */
function row(left, right, width) {
    const l = String(left ?? '');
    const r = String(right ?? '');
    const space = Math.max(1, width - l.length - r.length);
    if (l.length + r.length + 1 > width) {
        // No cabe: el texto va arriba y el monto alineado abajo.
        return `${l}\n${' '.repeat(Math.max(0, width - r.length))}${r}\n`;
    }
    return `${l}${' '.repeat(space)}${r}\n`;
}

const divider = (width) => '-'.repeat(width) + '\n';

/**
 * Parte un texto en varias líneas que quepan en `width` caracteres, cortando por
 * palabras. Evita que los nombres largos (p. ej. "Atun Chanavayita Lomito En
 * Aceite 170g") se impriman incompletos: la térmica trunca lo que no cabe.
 */
function wrapText(text, width) {
    const words = String(text ?? '').trim().split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w of words) {
        // Palabra sola más larga que el ancho: se corta a la fuerza.
        if (w.length > width) {
            if (cur) { lines.push(cur); cur = ''; }
            let rest = w;
            while (rest.length > width) { lines.push(rest.slice(0, width)); rest = rest.slice(width); }
            cur = rest;
            continue;
        }
        if (!cur) cur = w;
        else if ((cur + ' ' + w).length <= width) cur += ' ' + w;
        else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
}

/**
 * Centra una línea rellenando con espacios a la izquierda. Lo hacemos por software
 * (no con ESC a 1) porque varias térmicas de 58mm no centran bien por hardware.
 */
function centerLine(text, width) {
    const t = String(text ?? '');
    if (t.length >= width) return t;
    return ' '.repeat(Math.floor((width - t.length) / 2)) + t;
}

// ─── Codificador ESC/POS ─────────────────────────────────────────────────────
// Genera los bytes crudos del ticket y los envía por el socket nativo (SPP).
// Esto reemplaza a la librería del plugin, que no lograba conectar con varias
// impresoras (incluida la Xprinter). ESC/POS es el estándar de las térmicas.
class EscPos {
    constructor() { this.b = []; }
    push(...bytes) { for (const x of bytes) this.b.push(x & 0xff); return this; }
    // Texto en Windows-1252/latin1 (soporta ñ á é í ó ú); lo no representable → '?'.
    text(s) { for (const ch of String(s ?? '')) { const c = ch.codePointAt(0); this.push(c <= 0xff ? c : 0x3f); } return this; }
    line(s = '') { return this.text(s).push(0x0A); }
    // Bytes de "despertar": algunas térmicas descartan lo primero que reciben tras
    // conectar. Mandamos ceros + saltos inofensivos ANTES del init para que lo que
    // se pierda sean estos y no el comando real.
    wake() { return this.push(0x00, 0x00, 0x0A, 0x0A); }
    init() { return this.push(0x1B, 0x40); }        // reset (sin codepage: máxima compatibilidad)
    codepage() { return this.push(0x1B, 0x74, 16); } // WPC1252 (para ñ/acentos)
    align(n) { return this.push(0x1B, 0x61, n); }                  // 0 izq · 1 centro · 2 der
    bold(on) { return this.push(0x1B, 0x45, on ? 1 : 0); }
    size(n) { return this.push(0x1D, 0x21, n); }                   // 0 normal · 0x11 doble
    // Avance + corte. Usamos GS V 0 (corte, función A): el argumento es 0x00 (no
    // imprimible). Antes usábamos GS V 66 (66 = 'B'); las impresoras sin esa función
    // imprimían literalmente una "B" en vez de cortar.
    feedCut() { return this.push(0x0A, 0x0A, 0x0A).push(0x1D, 0x56, 0x00); }
    // Imagen raster (GS v 0): {bytesPerRow, height, data:Uint8Array}. Cada bit = 1 punto
    // (1 = negro). Se usa para imprimir el timbre PDF417 de las boletas/facturas SII.
    raster(rast) {
        if (!rast || !rast.data?.length) return this;
        const { bytesPerRow, height, data } = rast;
        this.push(0x1D, 0x76, 0x30, 0x00);
        this.push(bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff);
        this.push(height & 0xff, (height >> 8) & 0xff);
        for (let i = 0; i < data.length; i++) this.b.push(data[i] & 0xff);
        return this;
    }
    toBase64() {
        let bin = '';
        for (let i = 0; i < this.b.length; i += 1024) {
            bin += String.fromCharCode.apply(null, this.b.slice(i, i + 1024));
        }
        return btoa(bin);
    }
}

// Mismo formato/orden que la boleta de la web (window.print), para que el ticket
// sea idéntico en todos los dispositivos: encabezado de la empresa, meta
// (Boleta/Fecha/Vendedor/Cliente), columnas DESCRIPCION/TOTAL, ítems, TOTAL,
// medio de pago y pie configurable.
function buildReceiptBytes(receipt, width, money) {
    const p = new EscPos().wake().init().codepage();

    // Encabezado (empresa): nombre GRANDE (doble ancho y alto) y CENTRADO. Muchas
    // térmicas de 58mm centran mal el doble ancho con ESC a 1 (lo corren a la
    // derecha), así que alineamos a la izquierda y calculamos el relleno a mano.
    {
        const name = receipt.companyName || 'POSVECI';
        const halfCols = Math.floor(width / 2); // columnas útiles en doble ancho
        if (name.length <= halfCols) {
            const pad = Math.max(0, Math.floor((halfCols - name.length) / 2));
            p.align(0).bold(true).size(0x11).text(' '.repeat(pad) + name).push(0x0A).size(0).bold(false);
        } else {
            // Nombre demasiado largo para doble ancho: doble alto (ancho normal), centrado a mano.
            p.align(0).bold(true).size(0x01).text(centerLine(name, width)).push(0x0A).size(0).bold(false);
        }
    }
    // Dirección / teléfono / mensaje: centrados A MANO (align 0 + relleno), porque
    // varias térmicas no centran bien con ESC a 1.
    p.align(0);
    for (const l of (receipt.companyLines || [])) {
        if (!l) continue;
        for (const ln of wrapText(l, width)) p.line(centerLine(ln, width));
    }
    p.text(divider(width));

    // Meta — alineado a la izquierda, igual que la web
    if (receipt.docLabel) {
        // Documento tributario (DTE): etiqueta y folio centrados a mano.
        p.bold(true).line(centerLine(receipt.docLabel, width)).bold(false);
        if (receipt.docLine) p.line(centerLine(receipt.docLine, width));
    } else if (receipt.code) {
        p.line(`Boleta: ${receipt.code}`);
    }
    if (receipt.datetime) p.line(`Fecha: ${receipt.datetime}`);
    if (receipt.seller) p.line(`Vend: ${receipt.seller}`);
    if (receipt.clientName) p.line(`Cliente: ${receipt.clientName}`);
    if (receipt.clientPhone) p.line(`Fono: ${receipt.clientPhone}`);
    if (receipt.address) p.line(`Dir: ${receipt.address}`);
    p.text(divider(width));

    // Cabecera de columnas
    p.bold(true).text(row('DESCRIPCION', 'TOTAL', width)).bold(false);
    p.text(divider(width));

    // Ítems: nombre (ajustado a varias líneas si es largo); luego "cant x precio"
    // a la izquierda y el total a la derecha.
    for (const it of (receipt.items || [])) {
        for (const ln of wrapText(it.name, width)) p.line(ln);
        p.text(row(`${it.qty} x ${money(it.unitPrice)}`, money(it.lineTotal), width));
    }
    p.text(divider(width));

    // Totales
    if (receipt.subtotal != null && receipt.deliveryFee) {
        p.text(row('Subtotal', money(receipt.subtotal), width));
        p.text(row('Despacho', money(receipt.deliveryFee), width));
    }
    p.bold(true).size(0x01).text(row('TOTAL', money(receipt.total), width)).size(0).bold(false);
    p.push(0x0A);
    if (receipt.paymentMethod) p.line(`Medio Pago: ${receipt.paymentMethod}`);
    if (receipt.paidLabel) p.line(receipt.paidLabel);
    if (receipt.remainingLabel) p.line(receipt.remainingLabel);
    if (receipt.notes) p.push(0x0A).line(receipt.notes);

    // Timbre electrónico SII (PDF417) — obligatorio en boletas/facturas. El raster
    // ya viene centrado (rellenado a lo ancho del papel), así que va con align 0.
    if (receipt.timbre) {
        p.push(0x0A).align(0);
        p.raster(receipt.timbre);
        p.push(0x0A).line(centerLine('Timbre Electronico SII', width));
        p.line(centerLine('Verifique en www.sii.cl', width));
    }

    // Pie — centrado A MANO (align 0 + relleno), respetando saltos de línea.
    p.align(0).push(0x0A);
    if (receipt.footer) {
        for (const part of String(receipt.footer).split('\n')) {
            for (const ln of wrapText(part, width)) p.line(centerLine(ln, width));
        }
    }
    return p.feedCut().toBase64();
}

/**
 * Imprime un recibo normalizado en la térmica Bluetooth vía socket nativo (SPP).
 *
 * receipt = {
 *   companyName, companyLines: [], title, code, datetime,
 *   clientName, clientPhone, address,
 *   items: [{ name, qty, unit, unitPrice, lineTotal }],
 *   subtotal, deliveryFee, total, paidLabel, remainingLabel, paymentMethod,
 *   notes, footer
 * }
 * Devuelve { ok: true } o { ok: false, error }.
 */
export async function printThermalReceipt(receipt, { money = (n) => String(n) } = {}) {
    if (!Capacitor.isNativePlatform()) {
        return { ok: false, error: 'La impresión Bluetooth solo está disponible en la app.' };
    }
    const saved = getSavedPrinter();
    if (!saved?.address) return { ok: false, error: 'No hay impresora configurada. Ve a Configuración → Impresora.' };

    const width = WIDTH_CHARS[saved.paperWidth] || WIDTH_CHARS[58];
    let data;
    try {
        data = buildReceiptBytes(receipt, width, money);
    } catch (e) {
        return { ok: false, error: 'No se pudo generar el ticket: ' + (e?.message || e) };
    }

    return sendToPrinter(saved, data);
}

/**
 * Envía bytes ESC/POS crudos (array de enteros 0..255) a la impresora guardada.
 * Lo usa la etiquetadora (thermalLabel.js), que arma sus propios comandos (código
 * de barra, tamaño de etiqueta, avance al gap).
 */
export async function printRawEscPos(bytes) {
    if (!Capacitor.isNativePlatform()) {
        return { ok: false, error: 'La impresión Bluetooth solo está disponible en la app.' };
    }
    const saved = getSavedPrinter();
    if (!saved?.address) return { ok: false, error: 'NO_PRINTER' };
    let bin = '';
    for (let i = 0; i < bytes.length; i += 1024) {
        const chunk = bytes.slice(i, i + 1024);
        for (let j = 0; j < chunk.length; j++) bin += String.fromCharCode(chunk[j] & 0xff);
    }
    return sendToPrinter(saved, btoa(bin));
}

// Envío común: manda los bytes (base64) por el socket nativo.
async function sendToPrinter(saved, data) {
    try {
        const { registerPlugin } = await import('@capacitor/core');
        const PairedPrinters = registerPlugin('PairedPrinters');
        await PairedPrinters.print({ address: saved.address, data });
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e?.message || `No se pudo imprimir en "${saved.name || saved.address}".` };
    }
}

/**
 * Ticket de prueba MÍNIMO: solo texto plano ASCII (sin codepage, sin tamaños, sin
 * corte). Es lo más compatible posible — si esto no imprime, el problema no está
 * en los comandos ESC/POS sino en la impresora/modo/conexión.
 */
export async function printTestTicket() {
    if (!Capacitor.isNativePlatform()) return { ok: false, error: 'Solo disponible en la app.' };
    const saved = getSavedPrinter();
    if (!saved?.address) return { ok: false, error: 'No hay impresora configurada.' };

    const p = new EscPos().wake().init();
    p.line('POSVECI');
    p.line('TICKET DE PRUEBA');
    p.line(new Date().toLocaleString('es-CL'));
    p.line('--------------------------------');
    p.line('Si lees esto, la impresora');
    p.line('quedo lista.');
    // Avance generoso para empujar todo fuera del cabezal antes de cerrar.
    p.push(0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A);
    p.push(0x1D, 0x56, 0x00); // corte GS V 0 (arg no imprimible; si no hay cortador, se ignora)

    return sendToPrinter(saved, p.toBase64());
}
