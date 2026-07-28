// Etiquetas de producto para impresora térmica (die-cut) — nombre + código de
// barra (del SKU) + precio. Pensado para etiquetar productos y luego escanearlos
// en el POS (el POS ya busca por SKU, así que el código de la etiqueta = el SKU).
//
// App nativa  → impresión térmica Bluetooth (ESC/POS, código de barra NATIVO).
// Navegador   → ventana de impresión con @page del tamaño de la etiqueta.
//
// Soporta IMPRESIÓN POR LOTE: se le pasa una lista de ítems { name, code,
// symbology, priceText, copies } y arma un solo trabajo con todas las etiquetas.

import bwipjs from 'bwip-js';
import { isThermalAvailable, getSavedPrinter, printRawEscPos } from './thermalPrint';

const DOTS_PER_MM = 8;   // 203 dpi
const FONT_A_W = 12;     // ancho de la fuente A en puntos

// Plantillas = tamaño FÍSICO del die-cut (mm). widthChars/barHeight se calculan
// según el tamaño y el ancho del papel de la impresora.
export const LABEL_TEMPLATES = {
    '30x20': { id: '30x20', name: '30 × 20 mm', widthMm: 30, heightMm: 20 },
    '40x30': { id: '40x30', name: '40 × 30 mm', widthMm: 40, heightMm: 30 },
    '50x30': { id: '50x30', name: '50 × 30 mm', widthMm: 50, heightMm: 30 },
    '50x40': { id: '50x40', name: '50 × 40 mm', widthMm: 50, heightMm: 40 },
    // Rollo CONTINUO (sin troquel/gap): no se puede usar TSPL porque no hay
    // separación que detectar. Se imprime con ESC/POS avanzando el largo exacto.
    '50x120': { id: '50x120', name: '50 × 120 mm (continuo)', widthMm: 50, heightMm: 120, continuous: true },
};
export const DEFAULT_TEMPLATE = '50x30';

// EAN-13 si son 13 dígitos numéricos; si no, Code128 (soporta letras y números).
export function pickSymbology(code) {
    return /^\d{13}$/.test(String(code || '').trim()) ? 'ean13' : 'code128';
}

// Caracteres que caben en el ancho de la etiqueta, sin pasar el ancho útil del
// cabezal (≈48mm en 58mm, ≈72mm en 80mm).
function widthCharsFor(tpl, paperWidth = 58) {
    const printableMm = paperWidth >= 80 ? 72 : 48;
    const usableMm = Math.min(tpl.widthMm - 2, printableMm); // -2mm de margen
    return Math.max(8, Math.floor((usableMm * DOTS_PER_MM) / FONT_A_W));
}
// Ancho físico del cabezal en bytes/puntos (para centrar la imagen del código).
const FULL_BYTES = { 58: 48, 80: 72 };
const MAX_DOTS = { 58: 360, 80: 560 };

// ── Texto ────────────────────────────────────────────────────────────────────
function toLatin1(s) {
    const o = [];
    for (const ch of String(s ?? '')) { const c = ch.codePointAt(0); o.push(c <= 0xff ? c : 0x3f); }
    return o;
}
function wrap(text, width) {
    const words = String(text ?? '').trim().split(/\s+/);
    const lines = []; let cur = '';
    for (const w of words) {
        if (w.length > width) { if (cur) { lines.push(cur); cur = ''; } let r = w; while (r.length > width) { lines.push(r.slice(0, width)); r = r.slice(width); } cur = r; continue; }
        if (!cur) cur = w; else if ((cur + ' ' + w).length <= width) cur += ' ' + w; else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
}
// Centrado por software (varias térmicas no centran texto por hardware con ESC a 1).
function center(text, width) {
    const t = String(text ?? '');
    if (t.length >= width) return t;
    return ' '.repeat(Math.floor((width - t.length) / 2)) + t;
}

// ── Código de barra como IMAGEN (raster) ─────────────────────────────────────
// Usamos imagen (no el comando nativo GS k) porque es el camino PROBADO en estas
// impresoras: el timbre PDF417 se imprime así. bwip-js dibuja el código + el texto
// legible (SKU) y lo convertimos a bitmap centrado a lo ancho del cabezal.
async function barcodeToRaster(code, symbology, paperWidth) {
    const maxDots = MAX_DOTS[paperWidth] || MAX_DOTS[58];
    const canvas = document.createElement('canvas');
    bwipjs.toCanvas(canvas, {
        bcid: symbology === 'ean13' ? 'ean13' : 'code128',
        text: String(code), scale: 3, height: 14, includetext: true, textxalign: 'center',
    });

    let w = canvas.width, h = canvas.height, src = canvas;
    if (w > maxDots) {
        const nw = maxDots, nh = Math.max(1, Math.round(h * (maxDots / w)));
        const c2 = document.createElement('canvas'); c2.width = nw; c2.height = nh;
        const ctx = c2.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, nw, nh);
        ctx.drawImage(canvas, 0, 0, nw, nh);
        src = c2; w = nw; h = nh;
    }
    const px = src.getContext('2d').getImageData(0, 0, w, h).data;
    const fullBytes = FULL_BYTES[paperWidth] || FULL_BYTES[58];
    const barBytes = Math.ceil(w / 8);
    const bytesPerRow = Math.max(fullBytes, barBytes);
    const offset = Math.max(0, Math.floor((bytesPerRow - barBytes) / 2)) * 8;
    const data = new Uint8Array(bytesPerRow * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const dark = px[i + 3] > 128 && (px[i] + px[i + 1] + px[i + 2]) / 3 < 128;
            if (dark) { const bx = offset + x; data[y * bytesPerRow + (bx >> 3)] |= (0x80 >> (bx & 7)); }
        }
    }
    return { bytesPerRow, height: h, data };
}

// Arma el trabajo con TODAS las etiquetas (lote). ASÍNCRONO porque genera imágenes.
async function buildLabelJob(items, tpl, paperWidth) {
    const W = widthCharsFor(tpl, paperWidth);
    const b = [];
    const push = (...xs) => { for (const x of xs) b.push(x & 0xff); };
    const text = (s) => { for (const c of toLatin1(s)) push(c); };
    const line = (s = '') => { text(s); push(0x0A); };

    // "Despertar" + init + codepage — igual que la boleta (sin esto la impresora
    // descarta los primeros bytes y sale la etiqueta EN BLANCO).
    push(0x00, 0x00, 0x0A, 0x0A);
    push(0x1B, 0x40);
    push(0x1B, 0x74, 16);

    for (const it of items) {
        const rast = it.code ? await barcodeToRaster(it.code, it.symbology, paperWidth) : null;
        const copies = Math.max(1, it.copies || 1);
        for (let i = 0; i < copies; i++) {
            // Nombre — negrita, centrado a mano, máx 2 líneas.
            push(0x1B, 0x61, 0); push(0x1B, 0x45, 1);
            for (const ln of wrap(it.name, W).slice(0, 2)) line(center(ln, W));
            push(0x1B, 0x45, 0);
            // Código de barra (imagen) — GS v 0.
            if (rast) {
                push(0x1D, 0x76, 0x30, 0x00);
                push(rast.bytesPerRow & 0xff, (rast.bytesPerRow >> 8) & 0xff);
                push(rast.height & 0xff, (rast.height >> 8) & 0xff);
                for (let k = 0; k < rast.data.length; k++) b.push(rast.data[k] & 0xff);
            }
            push(0x0A);
            // Precio — negrita, doble alto, centrado a mano.
            push(0x1B, 0x45, 1); push(0x1D, 0x21, 0x01);
            line(center(it.priceText, W));
            push(0x1D, 0x21, 0x00); push(0x1B, 0x45, 0);
            // Avance a la siguiente etiqueta (die-cut): FF → siguiente gap.
            push(0x0C);
        }
    }
    return b;
}

// ── TSPL (impresoras de ETIQUETA en modo label) ──────────────────────────────
// Las impresoras de etiqueta (XP-P323B, etc.) en "modo label" hablan TSPL, no
// ESC/POS. TSPL es el lenguaje correcto para die-cut: SIZE/GAP alinean solos al
// gap y el código de barra es nativo (nítido y escaneable).
const CRLF = '\r\n';
const tesc = (s) => String(s ?? '').replace(/["\\]/g, '\\$&');

// Fuentes internas TSPL: id → [ancho, alto] en dots (con multiplicador 1).
const TSPL_FONTS = { '1': [8, 12], '2': [12, 20], '3': [16, 24], '4': [24, 32], '5': [32, 48] };
// Combinaciones fuente/multiplicador de mayor a menor, para ajustar el texto solo.
const FIT_STEPS = [['5', 3], ['5', 2], ['4', 2], ['5', 1], ['3', 2], ['4', 1], ['3', 1], ['2', 1], ['1', 1]];

/** Elige la fuente más grande que quepa en (maxW × maxH). */
export function fitFont(content, maxW, maxH) {
    const len = Math.max(1, String(content ?? '').length);
    for (const [f, m] of FIT_STEPS) {
        const [cw, ch] = TSPL_FONTS[f];
        if (len * cw * m <= maxW && ch * m <= maxH) return { font: f, mult: m, w: len * cw * m, h: ch * m };
    }
    const [cw, ch] = TSPL_FONTS['1'];
    return { font: '1', mult: 1, w: len * cw, h: ch };
}

// ── Catálogo de DISEÑOS (todos pensados para 50×30 mm = 400×240 dots) ────────
// Cada diseño es una lista de elementos con su posición/alto en dots. El mismo
// descriptor lo usan el generador TSPL y la vista previa, así nunca difieren.
//   kind: name | price | barcode | line | dashed | label
//   invert: pinta una banda negra detrás y el texto en blanco (TSPL REVERSE)
const W0 = 400, H0 = 240;

// Cada caja (y,h) se centra sola en vertical (ver layoutText), así que los valores
// definen la REGIÓN, no la posición exacta del texto. Los márgenes superior e
// inferior están balanceados para que el conjunto quede centrado en la etiqueta.
export const LABEL_STYLES = {
    nombre_precio: {
        id: 'nombre_precio', name: '1 · Nombre + Precio', needsBarcode: false,
        elements: [
            { kind: 'name', y: 40, h: 46 },
            { kind: 'price', y: 92, h: 112 },
        ],
    },
    nombre_precio_codigo: {
        id: 'nombre_precio_codigo', name: '2 · Nombre + Precio grande + Código', needsBarcode: true,
        // 14 arriba · nombre 24 · precio 64 · código 72+28 · 14 abajo = 240
        elements: [
            { kind: 'name', y: 10, h: 32 },
            { kind: 'price', y: 44, h: 76 },
            { kind: 'barcode', y: 126, h: 72 },
        ],
    },
    solo_precio: {
        id: 'solo_precio', name: '3 · Solo Precio', needsBarcode: false,
        // Caja = etiqueta completa: el precio queda perfectamente centrado.
        elements: [{ kind: 'price', y: 0, h: 240 }],
    },
    solo_codigo: {
        id: 'solo_codigo', name: '4 · Solo Código de barras', needsBarcode: true,
        // 46 + (120 + 28 HRI) = 194 → margen 46 arriba y 46 abajo.
        elements: [{ kind: 'barcode', y: 46, h: 120 }],
    },
    codigo_precio: {
        id: 'codigo_precio', name: '5 · Código + Precio', needsBarcode: true,
        elements: [
            { kind: 'barcode', y: 14, h: 64 },
            { kind: 'line', y: 118 },
            { kind: 'price', y: 130, h: 98 },
        ],
    },
    nombre_codigo_precio: {
        id: 'nombre_codigo_precio', name: '6 · Nombre + Código + Precio', needsBarcode: true,
        // 14 arriba · nombre 24 · código 72+28 · precio 64 · 14 abajo = 240
        elements: [
            { kind: 'name', y: 10, h: 32 },
            { kind: 'barcode', y: 50, h: 72 },
            { kind: 'price', y: 156, h: 76 },
        ],
    },
    nombre_destacado: {
        id: 'nombre_destacado', name: '7 · Nombre destacado + Precio', needsBarcode: false,
        elements: [
            { kind: 'name', y: 0, h: 40, invert: true, bandX: 16, bandY: 8, bandW: 368, bandH: 56 },
            { kind: 'dashed', y: 74 },
            // Región = todo lo que queda bajo la línea → el precio se centra ahí.
            { kind: 'price', y: 82, h: 158 },
        ],
    },
    minimalista: {
        id: 'minimalista', name: '8 · Minimalista', needsBarcode: false,
        elements: [
            { kind: 'name', y: 38, h: 40 },
            { kind: 'line', y: 88 },
            { kind: 'price', y: 100, h: 110 },
        ],
    },
    precio_destacado_codigo: {
        id: 'precio_destacado_codigo', name: '9 · Precio destacado + Código pequeño', needsBarcode: true,
        elements: [
            { kind: 'price', y: 0, h: 64, invert: true, bandX: 0, bandY: 6, bandW: 400, bandH: 88 },
            { kind: 'dashed', y: 102 },
            { kind: 'barcode', y: 118, h: 58 },
        ],
    },
    compacto: {
        id: 'compacto', name: '10 · Nombre + Precio (compacto)', needsBarcode: false,
        elements: [
            { kind: 'name', y: 32, h: 44 },
            { kind: 'price', y: 0, h: 72, invert: true, bandX: 56, bandY: 100, bandW: 288, bandH: 96 },
        ],
    },
    solo_precio_borde: {
        id: 'solo_precio_borde', name: '12 · Solo Precio con borde', needsBarcode: false,
        border: { x: 16, y: 28, x2: 384, y2: 212, t: 4 },
        // Caja = interior del borde (x/w incluidos) → el precio se centra DENTRO
        // del recuadro y nunca se sale por los lados.
        elements: [{ kind: 'price', x: 16, w: 368, y: 28, h: 184 }],
    },
    codigo_borde: {
        id: 'codigo_borde', name: '13 · Código con borde', needsBarcode: true,
        border: { x: 14, y: 36, x2: 386, y2: 204, t: 3 },
        // 60 + (92 + 28 HRI) = 180 → centro 120 = centro del recuadro.
        elements: [{ kind: 'barcode', x: 14, w: 372, y: 60, h: 92 }],
    },
    nombre_codigo: {
        id: 'nombre_codigo', name: '14 · Nombre + Código', needsBarcode: true,
        elements: [
            { kind: 'name', y: 30, h: 40 },
            { kind: 'barcode', y: 76, h: 100 },
        ],
    },
    banda_superior: {
        id: 'banda_superior', name: '15 · Nombre con banda superior', needsBarcode: false,
        elements: [
            { kind: 'name', y: 0, h: 40, invert: true, bandX: 0, bandY: 0, bandW: 400, bandH: 64 },
            // Caja = todo lo que queda bajo la banda → precio centrado ahí.
            { kind: 'price', y: 64, h: 176 },
        ],
    },

    // ── OFERTAS ─────────────────────────────────────────────────────────────
    // Solo las que la impresora puede dibujar con exactitud (bandas, recuadros,
    // líneas y punteados). Las que necesitan formas irregulares —diagonales,
    // estrellas, círculos, flechas, tijeras, forma de etiqueta— no se incluyen.
    oferta_banda: {
        id: 'oferta_banda', name: 'Oferta 1 · Banda OFERTA + Nombre + Precio', needsBarcode: true,
        elements: [
            { kind: 'label', text: 'OFERTA', y: 0, h: 30, invert: true, bandX: 40, bandY: 6, bandW: 320, bandH: 42 },
            { kind: 'name', y: 52, h: 30 },
            { kind: 'price', y: 84, h: 72 },
            { kind: 'barcode', y: 158, h: 40 },
        ],
    },
    oferta_punteado: {
        id: 'oferta_punteado', name: 'Oferta 4 · Borde punteado + OFERTA', needsBarcode: true,
        elements: [
            { kind: 'dashedBox', x: 10, w: 380, y: 8, h: 224 },
            { kind: 'label', text: 'OFERTA', y: 0, h: 26, invert: true, bandX: 130, bandY: 18, bandW: 140, bandH: 36 },
            { kind: 'name', y: 58, h: 28 },
            { kind: 'price', y: 88, h: 64 },
            { kind: 'barcode', y: 156, h: 38 },
        ],
    },
    oferta_especial: {
        id: 'oferta_especial', name: 'Oferta 5 · OFERTA ESPECIAL (banda completa)', needsBarcode: true,
        elements: [
            { kind: 'label', text: 'OFERTA ESPECIAL', y: 0, h: 30, invert: true, bandX: 0, bandY: 0, bandW: 400, bandH: 46 },
            { kind: 'name', y: 50, h: 30 },
            { kind: 'price', y: 82, h: 72 },
            { kind: 'barcode', y: 158, h: 42 },
        ],
    },
    promocion: {
        id: 'promocion', name: 'Oferta 7 · PROMOCIÓN con líneas', needsBarcode: true,
        elements: [
            { kind: 'line', x: 24, w: 86, y: 26, full: true },
            { kind: 'label', text: 'PROMOCION', x: 118, w: 164, y: 10, h: 28 },
            { kind: 'line', x: 290, w: 86, y: 26, full: true },
            { kind: 'name', y: 48, h: 30 },
            { kind: 'price', y: 80, h: 74 },
            { kind: 'barcode', y: 158, h: 42 },
        ],
    },
    tiempo_limitado: {
        id: 'tiempo_limitado', name: 'Oferta 14 · POR TIEMPO LIMITADO', needsBarcode: true,
        elements: [
            { kind: 'label', text: 'POR TIEMPO LIMITADO', y: 0, h: 26, invert: true, bandX: 18, bandY: 8, bandW: 364, bandH: 40 },
            { kind: 'name', y: 54, h: 28 },
            { kind: 'price', y: 86, h: 70 },
            { kind: 'barcode', y: 160, h: 40 },
        ],
    },
    oferta_tachado: {
        id: 'oferta_tachado', name: 'Oferta · Precio normal tachado + Precio oferta', needsBarcode: false, needsOldPrice: true,
        elements: [
            { kind: 'name', y: 16, h: 44 },
            // Precio normal, más chico y TACHADO con una línea encima.
            { kind: 'oldPrice', y: 64, h: 44, strike: true },
            // Precio de oferta, bien grande.
            { kind: 'price', y: 112, h: 112 },
        ],
    },
    // ── Rollo CONTINUO 50×120, contenido ACOSTADO ───────────────────────────
    // Lienzo 960×384 dots = 120×48 mm en horizontal (384 = todo el ancho útil del
    // cabezal, así el número sale lo más grande posible). Se dibujan en un canvas
    // y se imprimen como imagen rotada 90° (`rotated`), porque ESC/POS no rota
    // texto con precisión. Márgenes mínimos: el PRECIO se lleva el mayor alto.
    continuo_nombre_precio: {
        id: 'continuo_nombre_precio', name: 'Acostado · Nombre + Precio', needsBarcode: false,
        canvasW: 960, canvasH: 384, continuousOnly: true, rotated: true,
        // Solo 2 datos → el precio se lleva MUCHO más alto (no reparte con un 3º).
        // La letra llena casi toda su caja, así que la separación entre cajas ES
        // la separación visual: se dejan ~26 puntos (3 mm) para que no se toquen.
        elements: [
            { kind: 'name', y: 4, h: 100 },
            { kind: 'price', y: 130, h: 248 },
        ],
    },
    continuo_oferta: {
        id: 'continuo_oferta', name: 'Acostado · OFERTA + Nombre + Precio', needsBarcode: false,
        canvasW: 960, canvasH: 384, continuousOnly: true, rotated: true,
        elements: [
            { kind: 'label', text: 'OFERTA', y: 0, h: 52, invert: true, bandX: 270, bandY: 0, bandW: 420, bandH: 68 },
            { kind: 'name', y: 82, h: 78 },
            { kind: 'price', y: 186, h: 194 },
        ],
    },
    continuo_oferta_especial: {
        id: 'continuo_oferta_especial', name: 'Acostado · OFERTA ESPECIAL (banda)', needsBarcode: false,
        canvasW: 960, canvasH: 384, continuousOnly: true, rotated: true,
        elements: [
            { kind: 'label', text: 'OFERTA ESPECIAL', y: 0, h: 54, invert: true, bandX: 0, bandY: 0, bandW: 960, bandH: 70 },
            { kind: 'name', y: 84, h: 76 },
            { kind: 'price', y: 186, h: 194 },
        ],
    },
    continuo_tachado: {
        id: 'continuo_tachado', name: 'Acostado · Precio tachado + Precio oferta', needsBarcode: false,
        canvasW: 960, canvasH: 384, continuousOnly: true, rotated: true, needsOldPrice: true,
        // 3 datos: se reparten el alto, por eso el precio es algo menor que arriba.
        elements: [
            { kind: 'name', y: 2, h: 70 },
            { kind: 'oldPrice', y: 92, h: 60, strike: true },
            { kind: 'price', y: 172, h: 208 },
        ],
    },
    con_fecha: {
        id: 'con_fecha', name: 'Nombre + Precio + Código + Fecha', needsBarcode: true,
        elements: [
            { kind: 'name', y: 8, h: 30 },
            { kind: 'price', y: 38, h: 64 },
            { kind: 'barcode', y: 108, h: 58 },
            { kind: 'date', y: 198, h: 26 },
        ],
    },
    oferta_cuadro: {
        id: 'oferta_cuadro', name: 'Oferta 15 · OFERTA (cuadro) + Nombre', needsBarcode: true,
        elements: [
            { kind: 'label', text: 'OFERTA', x: 16, w: 110, y: 0, h: 22, invert: true, bandX: 16, bandY: 20, bandW: 110, bandH: 74 },
            // Nombre y precio SOLO a la derecha del cuadro (x=134) para que un
            // nombre largo no se meta por debajo de la caja negra.
            { kind: 'name', x: 134, w: 258, y: 12, h: 36 },
            { kind: 'price', x: 134, w: 258, y: 52, h: 52 },
            { kind: 'barcode', y: 148, h: 44 },
        ],
    },
};
export const DEFAULT_STYLE = 'nombre_codigo_precio';

/** Ancho estimado del código de barras (para centrarlo). */
export function barcodeWidth(code, symbology, narrow) {
    return symbology === 'ean13' ? (95 * narrow + 24) : ((String(code).length + 5) * 11 * narrow);
}

/** Alto que ocupa el texto legible (HRI) bajo el código de barras. */
export const HRI_H = 28;

/** Fecha de hoy en dd/mm/aaaa (la que se estampa al imprimir la etiqueta). */
export function todayText(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Texto que corresponde a cada tipo de elemento, según los datos del producto. */
export function elContent(el, it) {
    switch (el.kind) {
        case 'name': return it?.name;
        case 'price': return it?.priceText;
        case 'oldPrice': return it?.oldPriceText;
        case 'date': return it?.dateText || todayText();
        default: return el.text || '';
    }
}

/**
 * Calcula la posición FINAL de un texto: elige fuente, centra en horizontal y
 * TAMBIÉN en vertical dentro de su caja (o dentro de la banda negra si es
 * invertido). La usan el generador TSPL y la vista previa, así lo que se ve es
 * exactamente lo que se imprime.
 * Devuelve [{ text, font, mult, w, h, x, y }]
 */
export function layoutText(el, content, W) {
    const rx = el.x ?? 0;
    const rw = el.w ?? W;
    // La caja de referencia para centrar: la banda si es invertido, si no su caja.
    const boxY = el.invert ? (el.bandY ?? el.y) : el.y;
    const boxH = el.invert ? (el.bandH ?? el.h) : el.h;
    const budget = el.h;                          // alto disponible para la letra
    const maxW = Math.max(8, rw - 8);             // ancho útil (con margen)
    const maxLines = el.maxLines ?? (el.kind === 'name' ? 2 : 1);
    const text = String(content ?? '').trim();

    // Busca la combinación (nº de líneas × fuente) que dé la letra MÁS GRANDE
    // cabiendo en la caja. Un nombre largo pasa solo a 2 líneas en vez de salirse.
    let best = null;
    for (let n = 1; n <= maxLines; n++) {
        const perH = Math.floor((budget - (n - 1) * 2) / n);
        if (perH < TSPL_FONTS['1'][1]) continue;  // no cabe ni la fuente más chica
        for (const [f, m] of FIT_STEPS) {         // ordenadas de mayor a menor
            const [cw, ch] = TSPL_FONTS[f];
            if (ch * m > perH) continue;
            const cpl = Math.floor(maxW / (cw * m));
            if (cpl < 1) continue;
            const lines = wrap(text, cpl);
            if (lines.length > n) continue;       // no cabe a lo ancho con esta fuente
            const cand = { font: f, mult: m, cw: cw * m, ch: ch * m, lines };
            if (!best || cand.ch > best.ch) best = cand;
            break;                                // la primera que cabe ya es la mayor
        }
    }

    // Si ni con la fuente más chica cabe: recortar y marcar con ".." que sigue.
    if (!best) {
        const [cw, ch] = TSPL_FONTS['1'];
        const cpl = Math.max(1, Math.floor(maxW / cw));
        const all = wrap(text, cpl);
        const lines = all.slice(0, maxLines);
        if (all.length > maxLines && lines.length) {
            const last = lines[lines.length - 1];
            lines[lines.length - 1] = last.slice(0, Math.max(1, cpl - 2)) + '..';
        }
        best = { font: '1', mult: 1, cw, ch, lines };
    }

    // Red de seguridad: ninguna línea puede exceder el ancho de su caja.
    const cpl = Math.max(1, Math.floor(maxW / best.cw));
    const lines = best.lines.map(l => l.length > cpl ? l.slice(0, Math.max(1, cpl - 2)) + '..' : l);

    const totalH = lines.length * best.ch + (lines.length - 1) * 2;
    let y = Math.round(boxY + (boxH - totalH) / 2);   // ← centrado VERTICAL
    return lines.map(ln => {
        const w = ln.length * best.cw;
        const out = {
            text: ln, font: best.font, mult: best.mult, w, h: best.ch,
            x: Math.max(0, Math.round(rx + (rw - w) / 2)),  // ← centrado HORIZONTAL
            y,
        };
        y += best.ch + 2;
        return out;
    });
}

// Escala los elementos si la etiqueta no es 50×30 (el catálogo está en 400×240).
function scaleEl(el, sx, sy) {
    const o = { ...el };
    for (const k of ['y', 'h', 'bandY', 'bandH']) if (o[k] != null) o[k] = Math.round(o[k] * sy);
    for (const k of ['x', 'w', 'bandX', 'bandW']) if (o[k] != null) o[k] = Math.round(o[k] * sx);
    return o;
}

/** Alto del lienzo de diseño (240 normal · otro valor en formatos especiales). */
export const canvasH = (style) => style?.canvasH ?? H0;
/** Ancho del lienzo de diseño (400 normal · 800 en los diseños acostados). */
export const canvasW = (style) => style?.canvasW ?? W0;

function buildTspl(items, tpl, style, gapMm = 2) {
    const Wd = Math.round(tpl.widthMm * DOTS_PER_MM);
    const Hd = Math.round(tpl.heightMm * DOTS_PER_MM);
    const sx = Wd / W0, sy = Hd / canvasH(style);

    let s = '';
    s += `SIZE ${tpl.widthMm} mm,${tpl.heightMm} mm${CRLF}`;
    s += `GAP ${gapMm} mm,0 mm${CRLF}`;
    s += `DIRECTION 1${CRLF}`;
    s += `CODEPAGE 1252${CRLF}`;
    s += `CLS${CRLF}`;

    for (const it of items) {
        const copies = Math.max(1, it.copies || 1);
        s += `CLS${CRLF}`;

        if (style.border) {
            const b = style.border;
            s += `BOX ${Math.round(b.x * sx)},${Math.round(b.y * sy)},${Math.round(b.x2 * sx)},${Math.round(b.y2 * sy)},${b.t}${CRLF}`;
        }

        for (const raw of style.elements) {
            const el = scaleEl(raw, sx, sy);
            const rx = el.x ?? 0;
            const rw = el.w ?? Wd;

            if (el.kind === 'line') {
                // `full: true` usa todo el ancho de la región (para líneas laterales).
                const lx = el.full ? rx : Math.round(rx + rw * 0.08);
                const lw = el.full ? rw : Math.round(rw * 0.84);
                s += `BAR ${lx},${el.y},${lw},3${CRLF}`;
                continue;
            }
            if (el.kind === 'dashed') {
                // TSPL no tiene línea punteada: se dibuja con trazos cortos.
                const step = Math.round(14 * sx), dash = Math.round(8 * sx);
                for (let x = Math.round(rx + 12 * sx); x < rx + rw - 12 * sx; x += step) s += `BAR ${x},${el.y},${dash},2${CRLF}`;
                continue;
            }
            if (el.kind === 'dashedBox') {
                // Recuadro punteado = trazos cortos en los 4 lados.
                const x1 = rx, y1 = el.y, x2 = rx + rw, y2 = el.y + el.h;
                const step = Math.round(14 * sx), dash = Math.round(8 * sx), th = 2;
                for (let x = x1; x < x2 - dash; x += step) {
                    s += `BAR ${x},${y1},${dash},${th}${CRLF}`;
                    s += `BAR ${x},${y2},${dash},${th}${CRLF}`;
                }
                for (let y = y1; y < y2 - dash; y += step) {
                    s += `BAR ${x1},${y},${th},${dash}${CRLF}`;
                    s += `BAR ${x2},${y},${th},${dash}${CRLF}`;
                }
                continue;
            }
            if (el.kind === 'barcode') {
                if (!it.code) continue;
                let narrow = 2;
                if (barcodeWidth(it.code, it.symbology, narrow) > rw) narrow = 1;
                const bx = Math.max(0, Math.round(rx + (rw - barcodeWidth(it.code, it.symbology, narrow)) / 2));
                const type = it.symbology === 'ean13' ? 'EAN13' : '128';
                s += `BARCODE ${bx},${el.y},"${type}",${el.h},1,0,${narrow},${narrow * 2},"${tesc(it.code)}"${CRLF}`;
                continue;
            }

            // Texto (nombre / precio / precio anterior / fecha / fijo) — centrado.
            const content = elContent(el, it);
            if (!content) continue;

            for (const t of layoutText(el, content, Wd)) {
                s += `TEXT ${t.x},${t.y},"${t.font}",0,${t.mult},${t.mult},"${tesc(t.text)}"${CRLF}`;
                // Tachado: línea horizontal sobre el texto (precio anterior).
                if (el.strike) {
                    s += `BAR ${t.x},${Math.round(t.y + t.h / 2)},${t.w},3${CRLF}`;
                }
            }

            // Banda negra con texto en blanco (si el firmware no soporta REVERSE,
            // el texto igual sale en negro sobre blanco: degrada bien).
            if (el.invert) {
                s += `REVERSE ${el.bandX ?? 0},${el.bandY ?? el.y},${el.bandW ?? Wd},${el.bandH ?? el.h}${CRLF}`;
            }
        }

        s += `PRINT 1,${copies}${CRLF}`;
    }
    return s;
}

function tsplToBytes(str) {
    const b = [];
    for (const ch of str) { const c = ch.codePointAt(0); b.push(c <= 0xff ? c : 0x3f); }
    return b;
}

// ── Impresión térmica (app) ──────────────────────────────────────────────────
/**
 * Imprime un lote de etiquetas. items = [{name, code, symbology, priceText, copies}].
 * lang: 'tspl' (impresoras de etiqueta en modo label) · 'escpos' (impresoras de recibo).
 */
export async function printThermalLabels(items, { template = DEFAULT_TEMPLATE, lang = 'tspl', style = DEFAULT_STYLE } = {}) {
    if (!isThermalAvailable()) return { ok: false, error: 'La impresión Bluetooth solo está disponible en la app.' };
    const saved = getSavedPrinter();
    if (!saved) return { ok: false, error: 'NO_PRINTER' };
    if (!items?.length) return { ok: false, error: 'No hay etiquetas para imprimir.' };
    const tpl = LABEL_TEMPLATES[template] || LABEL_TEMPLATES[DEFAULT_TEMPLATE];
    const stl = LABEL_STYLES[style] || LABEL_STYLES[DEFAULT_STYLE];

    let bytes;
    if (stl.rotated) {
        // Diseño acostado: se dibuja y se imprime como imagen girada 90°.
        bytes = buildRotatedEscpos(items, tpl, stl, saved.paperWidth || 58);
    } else if (tpl.continuous) {
        // Rollo continuo: sin gap que detectar → ESC/POS con avance exacto.
        bytes = buildContinuousEscpos(items, tpl, stl, saved.paperWidth || 58);
    } else if (lang === 'escpos') {
        bytes = await buildLabelJob(items, tpl, saved.paperWidth || 58);
    } else {
        bytes = tsplToBytes(buildTspl(items, tpl, stl, tpl.gapMm || 2));
    }
    return printRawEscPos(bytes);
}

// ── Diseños ACOSTADOS: se dibujan en canvas y se imprimen como imagen ────────
// ESC/POS no rota texto con precisión, así que el diseño se pinta horizontal en
// un canvas y luego se gira 90° para que salga a lo largo del rollo.
/**
 * Dibuja una línea centrada. En los precios achica el signo de moneda al alto de
 * los dígitos: en Arial el "$" sube y baja más que los números, y se veía
 * desalineado y más alto. Devuelve el ancho ocupado.
 */
function drawTextLine(ctx, text, cx, cy, fs, isMoney) {
    const FONT = (n) => `bold ${n}px Arial, Helvetica, sans-serif`;
    ctx.font = FONT(fs);
    const m = isMoney ? /^([^0-9]+)([0-9].*)$/.exec(String(text)) : null;
    if (!m) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, cx, cy);
        return ctx.measureText(text).width || 1;
    }
    const sym = m[1], rest = m[2];
    const dm = ctx.measureText('0');
    const digAsc = dm.actualBoundingBoxAscent || fs * 0.716;   // alto de los dígitos
    const sm = ctx.measureText(sym);
    const symAsc = sm.actualBoundingBoxAscent || fs * 0.75;
    const symDesc = sm.actualBoundingBoxDescent || fs * 0.09;
    const k = Math.min(1, digAsc / ((symAsc + symDesc) || 1));  // factor para igualar alturas

    const restW = ctx.measureText(rest).width;
    ctx.font = FONT(Math.max(6, fs * k));
    const symW = ctx.measureText(sym).width;
    const total = symW + restW;
    const x0 = cx - total / 2;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(sym, x0, cy + digAsc / 2 - symDesc * k);       // símbolo, alineado a los dígitos
    ctx.font = FONT(fs);
    ctx.fillText(rest, x0 + symW, cy + digAsc / 2);             // números
    return total;
}

function drawStyleToCanvas(style, it) {
    const W = canvasW(style), H = canvasH(style);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);

    if (style.border) {
        const b = style.border;
        ctx.strokeStyle = '#000'; ctx.lineWidth = b.t;
        ctx.strokeRect(b.x, b.y, b.x2 - b.x, b.y2 - b.y);
    }

    for (const el of style.elements) {
        const rx = el.x ?? 0, rw = el.w ?? W;
        ctx.fillStyle = '#000';

        if (el.kind === 'line') {
            const lx = el.full ? rx : rx + rw * 0.08;
            const lw = el.full ? rw : rw * 0.84;
            ctx.fillRect(lx, el.y, lw, 3);
            continue;
        }
        if (el.kind === 'dashed') {
            for (let x = rx + 12; x < rx + rw - 12; x += 14) ctx.fillRect(x, el.y, 8, 2);
            continue;
        }
        if (el.kind === 'dashedBox') {
            const x2 = rx + rw, y2 = el.y + el.h;
            for (let x = rx; x < x2 - 8; x += 14) { ctx.fillRect(x, el.y, 8, 2); ctx.fillRect(x, y2, 8, 2); }
            for (let y = el.y; y < y2 - 8; y += 14) { ctx.fillRect(rx, y, 2, 8); ctx.fillRect(x2, y, 2, 8); }
            continue;
        }
        if (el.kind === 'barcode') continue;   // los acostados no llevan código

        const content = elContent(el, it);
        if (!content) continue;

        if (el.invert) {
            ctx.fillRect(el.bandX ?? 0, el.bandY ?? el.y, el.bandW ?? W, el.bandH ?? el.h);
        }

        // De layoutText solo se aprovecha el CORTE EN LÍNEAS. El tamaño se calcula
        // aparte: al dibujar en canvas la letra puede crecer sin el tope de las
        // fuentes internas de la impresora (que se quedaban en 144 puntos y hacían
        // que agrandar la caja no cambiara nada).
        const lines = layoutText(el, content, W).map(t => t.text);
        const n = Math.max(1, lines.length);
        const gap = n > 1 ? Math.round(el.h * 0.06) : 0;
        const perH = (el.h - gap * (n - 1)) / n;
        const boxY = el.invert ? (el.bandY ?? el.y) : el.y;
        const boxH = el.invert ? (el.bandH ?? el.h) : el.h;
        const avail = rw - 12;

        // Tamaño por ALTO; si la línea más ancha no cabe, se REDUCE la letra
        // (no se comprime) para que no se vea achatada.
        let fs = Math.max(8, Math.round(perH / 0.72));
        ctx.font = `bold ${fs}px Arial, Helvetica, sans-serif`;
        let widest = 0;
        for (const ln of lines) widest = Math.max(widest, ctx.measureText(ln).width || 1);
        if (widest > avail) {
            fs = Math.max(8, Math.floor(fs * (avail / widest)));
            ctx.font = `bold ${fs}px Arial, Helvetica, sans-serif`;
        }

        const lineH = fs * 0.72;
        const totalH = lineH * n + gap * (n - 1);
        ctx.fillStyle = el.invert ? '#fff' : '#000';
        const isMoney = el.kind === 'price' || el.kind === 'oldPrice';
        let ty = boxY + (boxH - totalH) / 2 + lineH / 2;
        for (const ln of lines) {
            const drawnW = drawTextLine(ctx, ln, rx + rw / 2, ty, fs, isMoney);
            if (el.strike) {
                ctx.fillRect(rx + (rw - drawnW) / 2, ty - 2, drawnW, Math.max(3, Math.round(fs * 0.06)));
            }
            ty += lineH + gap;
        }
    }
    return cv;
}

/** Gira el canvas 90° y lo convierte a bitmap ESC/POS (1 bit por punto). */
function canvasToRotatedRaster(cv, paperWidth) {
    const maxDots = paperWidth >= 80 ? 576 : 384;
    // Al girar, el ALTO del diseño pasa a ser el ancho impreso.
    const scale = Math.min(1, maxDots / cv.height);
    const rw = Math.max(1, Math.round(cv.height * scale));   // ancho impreso
    const rh = Math.max(1, Math.round(cv.width * scale));    // largo impreso
    const out = document.createElement('canvas');
    out.width = rw; out.height = rh;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, rw, rh);
    ctx.translate(rw, 0);
    ctx.rotate(Math.PI / 2);          // 90° horario
    ctx.scale(scale, scale);
    ctx.drawImage(cv, 0, 0);

    const px = ctx.getImageData(0, 0, rw, rh).data;
    const bytesPerRow = Math.ceil(rw / 8);
    const data = new Uint8Array(bytesPerRow * rh);
    for (let y = 0; y < rh; y++) {
        for (let x = 0; x < rw; x++) {
            const i = (y * rw + x) * 4;
            const dark = px[i + 3] > 128 && (px[i] + px[i + 1] + px[i + 2]) / 3 < 128;
            if (dark) data[y * bytesPerRow + (x >> 3)] |= (0x80 >> (x & 7));
        }
    }
    return { bytesPerRow, height: rh, data };
}

function buildRotatedEscpos(items, tpl, style, paperWidth) {
    const Hd = Math.round(tpl.heightMm * DOTS_PER_MM);   // largo de la etiqueta
    const b = [];
    const push = (...xs) => { for (const x of xs) b.push(x & 0xff); };
    const feed = (dots) => { let n = Math.max(0, Math.round(dots)); while (n > 0) { const k = Math.min(255, n); push(0x1B, 0x4A, k); n -= k; } };

    // "Despertar" con NULs (la impresora descarta los primeros bytes). Se usan
    // NUL y no saltos de línea: los saltos avanzaban papel y dejaban un margen
    // grande antes de la primera etiqueta.
    push(0x00, 0x00, 0x00, 0x00);
    push(0x1B, 0x40);               // init
    push(0x1B, 0x33, 0);            // interlineado 0: sin avances implícitos
    push(0x1B, 0x61, 0);            // alinear izquierda

    for (const it of items) {
        const rast = canvasToRotatedRaster(drawStyleToCanvas(style, it), paperWidth);
        for (let c = 0; c < Math.max(1, it.copies || 1); c++) {
            push(0x1D, 0x76, 0x30, 0x00);
            push(rast.bytesPerRow & 0xff, (rast.bytesPerRow >> 8) & 0xff);
            push(rast.height & 0xff, (rast.height >> 8) & 0xff);
            for (let k = 0; k < rast.data.length; k++) b.push(rast.data[k] & 0xff);
            feed(Hd - rast.height);   // completar el largo exacto de la etiqueta
        }
    }
    return b;
}

// ── ESC/POS para rollo CONTINUO ──────────────────────────────────────────────
// Usa el MISMO descriptor y el mismo layoutText que el resto, así la vista previa
// coincide. Posiciona con ESC $ (X exacto) y ESC J (avance en puntos), y al final
// completa el largo de la etiqueta para que la siguiente empiece derecha.
function buildContinuousEscpos(items, tpl, style, paperWidth) {
    const Wd = Math.round(tpl.widthMm * DOTS_PER_MM);
    const Hd = Math.round(tpl.heightMm * DOTS_PER_MM);
    const sx = Wd / W0, sy = Hd / canvasH(style);
    const maxDots = paperWidth >= 80 ? 576 : 384;   // ancho útil del cabezal

    const b = [];
    const push = (...xs) => { for (const x of xs) b.push(x & 0xff); };
    const text = (s) => { for (const c of toLatin1(s)) push(c); };
    const feed = (dots) => { let n = Math.max(0, Math.round(dots)); while (n > 0) { const k = Math.min(255, n); push(0x1B, 0x4A, k); n -= k; } };
    const setX = (x) => { const v = Math.max(0, Math.min(maxDots - 1, Math.round(x))); push(0x1B, 0x24, v & 0xff, (v >> 8) & 0xff); };
    // Tamaño ESC/POS (GS ! n): el carácter base es 12×24, así que el multiplicador
    // se deduce del alto que calculó layoutText.
    const setSize = (m) => { const v = Math.max(1, Math.min(8, m)) - 1; push(0x1D, 0x21, (v << 4) | v); };
    const escMult = (h) => Math.max(1, Math.min(8, Math.round(h / 24)));

    push(0x00, 0x00, 0x0A, 0x0A);     // despertar
    push(0x1B, 0x40);                 // init
    push(0x1B, 0x74, 16);             // codepage WPC1252
    push(0x1B, 0x61, 0);              // alinear izquierda (centramos con ESC $)

    for (const it of items) {
        for (let c = 0; c < Math.max(1, it.copies || 1); c++) {
            let y = 0;
            // Elementos de texto, en orden vertical.
            const els = style.elements
                .filter(e => ['name', 'price', 'oldPrice', 'date', 'label'].includes(e.kind))
                .map(e => scaleEl(e, sx, sy))
                .sort((a, b2) => a.y - b2.y);

            for (const el of els) {
                const content = elContent(el, it);
                if (!content) continue;
                for (const t of layoutText(el, content, Wd)) {
                    feed(t.y - y);
                    const m = escMult(t.h);
                    setSize(m);
                    setX(t.x);
                    text(t.text);
                    push(0x1B, 0x4A, Math.min(255, Math.max(1, t.h)));  // imprime y avanza
                    y = t.y + t.h;
                    setSize(1);
                }
            }
            feed(Hd - y);             // completar el largo exacto de la etiqueta
        }
    }
    return b;
}

// ── Vista previa y navegador ──────────────────────────────────────────────────
/** Genera el código de barra como imagen (PNG dataURL) para la vista previa y el PDF/web. */
export function renderBarcodeDataUrl(code, symbology) {
    try {
        const canvas = document.createElement('canvas');
        bwipjs.toCanvas(canvas, {
            bcid: symbology === 'ean13' ? 'ean13' : 'code128',
            text: String(code),
            scale: 3, height: 12, includetext: true, textxalign: 'center',
        });
        return canvas.toDataURL('image/png');
    } catch (e) {
        console.warn('barcode render failed', e?.message);
        return null;
    }
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/**
 * Imprime un LOTE en el navegador: una hoja por etiqueta, con @page del tamaño
 * exacto. items = [{name, code, priceText, copies, barcodeDataUrl}].
 */
export function printWebLabels(items, { template = DEFAULT_TEMPLATE, style = DEFAULT_STYLE } = {}) {
    if (!items?.length) return { ok: false, error: 'No hay etiquetas para imprimir.' };
    const tpl = LABEL_TEMPLATES[template] || LABEL_TEMPLATES[DEFAULT_TEMPLATE];
    const stl = LABEL_STYLES[style] || LABEL_STYLES[DEFAULT_STYLE];

    // Mismo descriptor que TSPL, posicionado en % sobre el lienzo del diseño.
    const HC = canvasH(stl);
    const pctX = (v) => `${(v / W0) * 100}%`;
    const pctY = (v) => `${(v / HC) * 100}%`;

    const renderEl = (el, it) => {
        const rx = el.x ?? 0, rw = el.w ?? W0;
        if (el.kind === 'line') {
            const lx = el.full ? rx : rx + rw * 0.08;
            const lw = el.full ? rw : rw * 0.84;
            return `<div style="position:absolute;left:${pctX(lx)};top:${pctY(el.y)};width:${pctX(lw)};height:2px;background:#000"></div>`;
        }
        if (el.kind === 'dashed') return `<div style="position:absolute;left:${pctX(rx + 12)};top:${pctY(el.y)};width:${pctX(rw - 24)};border-top:1.5px dashed #000"></div>`;
        if (el.kind === 'dashedBox') return `<div style="position:absolute;left:${pctX(rx)};top:${pctY(el.y)};width:${pctX(rw)};height:${pctY(el.h)};border:2px dashed #000"></div>`;
        if (el.kind === 'barcode') {
            if (!it.barcodeDataUrl) return '';
            return `<img src="${it.barcodeDataUrl}" style="position:absolute;left:${pctX(rx)};top:${pctY(el.y)};width:${pctX(rw)};height:${pctY(el.h + HRI_H)};object-fit:contain"/>`;
        }
        const content = elContent(el, it);
        if (!content) return '';
        const band = el.invert
            ? `<div style="position:absolute;left:${pctX(el.bandX ?? 0)};top:${pctY(el.bandY ?? el.y)};width:${pctX(el.bandW ?? W0)};height:${pctY(el.bandH ?? el.h)};background:#000"></div>`
            : '';
        // Mismo cálculo de fuente y centrado (H y V) que el TSPL. Monoespaciada
        // porque las fuentes internas de la impresora son de ancho fijo.
        const parts = layoutText(el, content, W0).map(t => {
            const charW = t.w / Math.max(1, t.text.length);
            const fs = ((charW / 0.6) / HC) * tpl.heightMm;
            const strike = el.strike
                ? `<div style="position:absolute;left:${pctX(t.x)};top:${pctY(t.y + t.h / 2)};width:${pctX(t.w)};height:2px;background:#000"></div>`
                : '';
            return `<div style="position:absolute;left:${pctX(t.x)};top:${pctY(t.y)};width:${pctX(t.w)};height:${pctY(t.h)};
                line-height:${(t.h / HC) * tpl.heightMm}mm;font-family:'Courier New',monospace;font-weight:700;
                text-align:center;white-space:nowrap;font-size:${fs}mm;color:${el.invert ? '#fff' : '#000'}">${escapeHtml(t.text)}</div>${strike}`;
        }).join('');
        return band + parts;
    };

    const oneLabel = (it) => `
        <div class="lbl">
            ${stl.border ? `<div style="position:absolute;left:${pctX(stl.border.x)};top:${pctY(stl.border.y)};width:${pctX(stl.border.x2 - stl.border.x)};height:${pctY(stl.border.y2 - stl.border.y)};border:${stl.border.t}px solid #000;border-radius:2px"></div>` : ''}
            ${stl.elements.map(el => renderEl(el, it)).join('')}
        </div>`;

    const html = items
        .flatMap(it => Array.from({ length: Math.max(1, it.copies || 1) }).map(() => oneLabel(it)))
        .join('');
    const w = window.open('', '', 'width=460,height=560');
    if (!w) return { ok: false, error: 'POPUP_BLOCKED' };
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Etiquetas</title><style>
        @page { size: ${tpl.widthMm}mm ${tpl.heightMm}mm; margin: 0; }
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .lbl { position: relative; width: ${tpl.widthMm}mm; height: ${tpl.heightMm}mm; page-break-after: always; overflow: hidden; }
    </style></head><body onload="window.print(); setTimeout(function(){ window.close(); }, 400);">${html}</body></html>`);
    w.document.close();
    return { ok: true };
}
