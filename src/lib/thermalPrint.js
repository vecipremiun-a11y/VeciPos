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

const STORAGE_KEY = 'posveci_thermal_printer';

// Caracteres por línea según el ancho del papel (fuente A, ~12x24).
const WIDTH_CHARS = { 58: 32, 80: 48 };

let _plugin = null;
async function getPrinter() {
    if (!Capacitor.isNativePlatform()) return null;
    if (_plugin) return _plugin;
    const mod = await import('capacitor-thermal-printer');
    _plugin = mod.CapacitorThermalPrinter;
    return _plugin;
}

/** ¿Se puede imprimir por Bluetooth? Solo en la app nativa. */
export const isThermalAvailable = () => Capacitor.isNativePlatform();

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

// ─── Descubrimiento y conexión ───────────────────────────────────────────────
/**
 * Busca impresoras cercanas. `onDevices` recibe la lista cada vez que cambia.
 * Devuelve una función para detener la búsqueda.
 */
export async function scanPrinters(onDevices) {
    const printer = await getPrinter();
    if (!printer) return () => {};
    const handle = await printer.addListener('discoverDevices', (result) => {
        onDevices(result?.devices || result || []);
    });
    await printer.startScan();
    return async () => {
        try { await printer.stopScan(); } catch { /* noop */ }
        try { await handle.remove(); } catch { /* noop */ }
    };
}

/** Conecta con la impresora indicada (o la guardada). Devuelve el dispositivo o null. */
export async function connectPrinter(address) {
    const printer = await getPrinter();
    if (!printer) return null;
    const target = address || getSavedPrinter()?.address;
    if (!target) return null;
    try {
        if (await printer.isConnected()) return { address: target, already: true };
    } catch { /* seguimos e intentamos conectar */ }
    try {
        return await printer.connect({ address: target });
    } catch (e) {
        console.warn('[thermal] no se pudo conectar:', e?.message || e);
        return null;
    }
}

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
 * Imprime un recibo normalizado en la térmica Bluetooth.
 *
 * receipt = {
 *   companyName, companyLines: [],
 *   title, code, datetime,
 *   clientName, clientPhone, address,
 *   items: [{ name, qty, unit, unitPrice, lineTotal }],
 *   subtotal, deliveryFee, total,
 *   paidLabel, remainingLabel, paymentMethod,
 *   notes, footer
 * }
 *
 * Devuelve { ok: true } o { ok: false, error }.
 */
export async function printThermalReceipt(receipt, { money = (n) => String(n) } = {}) {
    const printer = await getPrinter();
    if (!printer) return { ok: false, error: 'La impresión Bluetooth solo está disponible en la app.' };

    const saved = getSavedPrinter();
    if (!saved?.address) return { ok: false, error: 'No hay impresora configurada. Ve a Configuración → Impresora.' };

    const connected = await connectPrinter(saved.address);
    if (!connected) return { ok: false, error: `No se pudo conectar con "${saved.name || saved.address}". Verifica que esté encendida y emparejada.` };

    const width = WIDTH_CHARS[saved.paperWidth] || WIDTH_CHARS[58];

    try {
        let b = printer.begin().align('center');

        // Encabezado
        b = b.bold().doubleWidth().text(`${receipt.companyName || 'POSVECI'}\n`).clearFormatting().align('center');
        for (const line of (receipt.companyLines || [])) {
            if (line) b = b.text(`${line}\n`);
        }

        b = b.text(divider(width));

        // Tipo de documento y folio
        if (receipt.title) b = b.bold().text(`${receipt.title}\n`).clearFormatting();
        if (receipt.code) b = b.text(`N° ${receipt.code}\n`);
        if (receipt.datetime) b = b.text(`${receipt.datetime}\n`);

        // Cliente
        b = b.align('left');
        if (receipt.clientName) b = b.text(`Cliente: ${receipt.clientName}\n`);
        if (receipt.clientPhone) b = b.text(`Fono: ${receipt.clientPhone}\n`);
        if (receipt.address) b = b.text(`Dir: ${receipt.address}\n`);

        b = b.text(divider(width));

        // Ítems: nombre en una línea, cantidad x precio y total en la siguiente.
        for (const it of (receipt.items || [])) {
            b = b.text(`${it.name}\n`);
            const detail = `  ${it.qty} ${it.unit || 'Und'} x ${money(it.unitPrice)}`;
            b = b.text(row(detail, money(it.lineTotal), width));
        }

        b = b.text(divider(width));

        // Totales
        if (receipt.subtotal != null && receipt.deliveryFee) {
            b = b.text(row('Subtotal', money(receipt.subtotal), width));
            b = b.text(row('Despacho', money(receipt.deliveryFee), width));
        }
        b = b.bold().doubleHeight().text(row('TOTAL', money(receipt.total), width)).clearFormatting();

        if (receipt.paidLabel) b = b.text(`${receipt.paidLabel}\n`);
        if (receipt.remainingLabel) b = b.text(`${receipt.remainingLabel}\n`);
        if (receipt.paymentMethod) b = b.text(row('Pago', receipt.paymentMethod, width));

        if (receipt.notes) b = b.text(`\n${receipt.notes}\n`);

        // Pie
        b = b.align('center').text('\n');
        if (receipt.footer) b = b.text(`${receipt.footer}\n`);
        b = b.text('\n\n').cutPaper();

        await b.write();
        return { ok: true };
    } catch (e) {
        console.error('[thermal] error imprimiendo:', e);
        return { ok: false, error: e?.message || 'Error al imprimir' };
    }
}

/** Ticket de prueba, para validar la impresora desde Configuración. */
export async function printTestTicket() {
    return printThermalReceipt({
        companyName: 'POSVECI',
        companyLines: ['Prueba de impresora'],
        title: 'TICKET DE PRUEBA',
        datetime: new Date().toLocaleString('es-CL'),
        items: [{ name: 'Producto de prueba', qty: 1, unit: 'Und', unitPrice: 1000, lineTotal: 1000 }],
        total: 1000,
        footer: 'Si lees esto, la impresora quedó lista.',
    }, { money: (n) => `$${Number(n || 0).toLocaleString('es-CL')}` });
}
