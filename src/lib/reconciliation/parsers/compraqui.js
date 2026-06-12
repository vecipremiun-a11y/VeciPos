// Parser del XLSX de liquidación de abono de Compraquí (BancoEstado).
//
// El archivo trae:
//   - Cabecera con datos del comercio (RUT, banco, cuenta, período).
//   - Tabla con cada transacción del abono: fecha, hora, monto venta,
//     tipo tarjeta (Débito/Prepago/Crédito), comisión exacta y total
//     que abonan por esa transacción.
//
// Devuelve un objeto estructurado que la pantalla de Conciliación cruza
// contra las ventas de POSVECI.

import * as XLSX from 'xlsx';

const NUM = (v) => {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return v;
    const s = String(v).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
};

const STR = (v) => (v === null || v === undefined ? '' : String(v).trim());

// Normaliza una fecha para output 'yyyy-MM-dd'. Acepta:
//   - 'dd-MM-yyyy' o 'dd/MM/yyyy'
//   - 'yyyy-MM-dd'
//   - Date object (Excel a veces lo decodifica)
const normalizeDate = (v) => {
    if (!v) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s);
    if (m) {
        const dd = m[1].padStart(2, '0');
        const mm = m[2].padStart(2, '0');
        return `${m[3]}-${mm}-${dd}`;
    }
    return s;
};

// Convierte 'HH:MM:SS' o serial de Excel a 'HH:MM:SS'.
const normalizeTime = (v) => {
    if (!v) return '';
    if (typeof v === 'number') {
        // Serial Excel: fracción del día
        const total = Math.round(v * 86400);
        const hh = String(Math.floor(total / 3600)).padStart(2, '0');
        const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
        const ss = String(total % 60).padStart(2, '0');
        return `${hh}:${mm}:${ss}`;
    }
    return String(v).trim();
};

// Convierte fecha + hora normalizadas a un Date local.
export const toDateTime = (fecha, hora) => {
    if (!fecha) return null;
    const iso = `${fecha}T${hora || '00:00:00'}`;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
};

// Encuentra el índice de la fila de encabezados en la grilla `rows`. Busca
// una fila que contenga al menos "Fecha" y "Monto venta" (orden libre).
const findHeaderRow = (rows) => {
    for (let i = 0; i < Math.min(rows.length, 60); i++) {
        const r = rows[i] || [];
        const lc = r.map(c => STR(c).toLowerCase());
        const hasFecha = lc.some(c => c === 'fecha');
        const hasMonto = lc.some(c => c.includes('monto venta'));
        if (hasFecha && hasMonto) return i;
    }
    return -1;
};

// Mapeo flexible de encabezados → claves de salida.
const HEADER_MAP = {
    'fecha': 'fecha',
    'hora': 'hora',
    'n° operación': 'operationNumber',
    'no operación': 'operationNumber',
    'n operación': 'operationNumber',
    'código autorización': 'authCode',
    'codigo autorizacion': 'authCode',
    'tipo transacción': 'type',
    'tipo transaccion': 'type',
    'estado venta': 'state',
    'tipo tarjeta': 'cardType',
    'marca tarjeta': 'cardBrand',
    'cuotas': 'installments',
    'cuota comercio abonó': 'merchantInstallment',
    'número tarjeta': 'lastFour',
    'numero tarjeta': 'lastFour',
    'monto venta': 'saleAmount',
    'comisión variable %': 'commissionPercent',
    'comision variable %': 'commissionPercent',
    'comisión fija': 'commissionFixed',
    'comision fija': 'commissionFixed',
    'monto comisión total': 'commissionTotal',
    'monto comision total': 'commissionTotal',
    'iva comisión': 'iva',
    'iva comision': 'iva',
    'total abono': 'totalAbono',
};

// Extrae los campos del comercio antes de la tabla.
const extractMerchantInfo = (rows, headerIdx) => {
    const info = { merchant: '', rut: '', periodo: '', bank: '', accountNumber: '' };
    for (let i = 0; i < headerIdx; i++) {
        const row = rows[i] || [];
        for (let c = 0; c < row.length - 1; c++) {
            const k = STR(row[c]).toLowerCase();
            const v = STR(row[c + 1]);
            if (!v) continue;
            if (k === 'comercio') info.merchant = v;
            else if (k === 'rut') info.rut = info.rut || v;
            else if (k === 'periodo') info.periodo = normalizeDate(v);
            else if (k === 'banco') info.bank = v;
            else if (k.includes('cuenta')) info.accountNumber = v;
        }
    }
    return info;
};

// Parser principal. Recibe el ArrayBuffer del archivo XLSX y devuelve
// el detalle del abono o un error humano-legible.
export function parseCompraquiXlsx(arrayBuffer) {
    try {
        const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        if (!sheet) return { ok: false, error: 'El archivo no tiene hojas.' };

        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
        const headerIdx = findHeaderRow(rows);
        if (headerIdx < 0) {
            return { ok: false, error: 'No se encontró la tabla de transacciones. ¿Es un archivo de Compraquí?' };
        }

        const headerRow = (rows[headerIdx] || []).map(c => STR(c).toLowerCase());
        const colMap = {}; // outputKey → columnIndex
        headerRow.forEach((h, idx) => {
            const key = HEADER_MAP[h];
            if (key && colMap[key] === undefined) colMap[key] = idx;
        });
        if (colMap.fecha === undefined || colMap.saleAmount === undefined) {
            return { ok: false, error: 'El archivo no tiene las columnas esperadas (Fecha, Monto venta...).' };
        }

        const info = extractMerchantInfo(rows, headerIdx);

        const transactions = [];
        for (let i = headerIdx + 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length === 0) continue;
            const fecha = normalizeDate(row[colMap.fecha]);
            if (!fecha) continue;
            // Si no hay monto, asumimos fila vacía/footer y cortamos.
            const saleAmount = NUM(row[colMap.saleAmount]);
            if (saleAmount <= 0) continue;

            const tx = {
                fecha,
                hora: normalizeTime(row[colMap.hora]),
                operationNumber: STR(row[colMap.operationNumber]),
                authCode: STR(row[colMap.authCode]),
                type: STR(row[colMap.type]),
                state: STR(row[colMap.state]),
                cardType: STR(row[colMap.cardType]),
                cardBrand: STR(row[colMap.cardBrand]),
                installments: NUM(row[colMap.installments]),
                lastFour: STR(row[colMap.lastFour]),
                saleAmount,
                commissionPercent: NUM(row[colMap.commissionPercent]),
                commissionFixed: NUM(row[colMap.commissionFixed]),
                commissionTotal: NUM(row[colMap.commissionTotal]),
                iva: NUM(row[colMap.iva]),
                totalAbono: NUM(row[colMap.totalAbono]),
            };
            tx.datetime = toDateTime(tx.fecha, tx.hora);
            transactions.push(tx);
        }

        if (transactions.length === 0) {
            return { ok: false, error: 'El archivo no tiene transacciones legibles.' };
        }

        const totals = transactions.reduce((acc, t) => ({
            sales: acc.sales + t.saleAmount,
            commission: acc.commission + t.commissionTotal,
            iva: acc.iva + t.iva,
            abono: acc.abono + t.totalAbono,
        }), { sales: 0, commission: 0, iva: 0, abono: 0 });

        return {
            ok: true,
            source: 'compraqui',
            info,
            transactions,
            totals,
        };
    } catch (e) {
        console.error('parseCompraquiXlsx error', e);
        return { ok: false, error: `No se pudo leer el archivo: ${e.message}` };
    }
}
