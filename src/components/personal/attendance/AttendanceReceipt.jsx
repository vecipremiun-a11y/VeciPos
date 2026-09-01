import React, { useMemo } from 'react';
import { X, Printer, ShieldCheck } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { formatRut } from '../../../utils/rutValidation';

/**
 * Comprobante de marcación.
 *
 * La Resolución Exenta N°38 exige que el trabajador pueda quedarse con
 * constancia de su marca y acceder después a sus registros. Esto es esa
 * constancia: folio, identidad, hora exacta y el hash que la ata a la cadena.
 *
 * Imprime en su propia ventana a propósito: NO pasa por el circuito de
 * impresión de boletas, que es otro asunto y no se toca.
 */

const TYPE_LABEL = { entry: 'ENTRADA', exit: 'SALIDA' };

const SOURCE_LABEL = {
    kiosk: 'Kiosco (marcada por el trabajador)',
    manual: 'Manual (registrada por un supervisor)',
    correction: 'Corrección aprobada',
};

function buildReceiptHtml(receipt, companyName) {
    const dt = new Date(receipt.recordedAt || receipt.recorded_at);
    const rut = receipt.rut || receipt.user_rut;
    const folio = receipt.folio ?? receipt.seq;
    const rows = [
        ['Folio', 'N° ' + String(folio ?? '—').padStart(6, '0')],
        ['Trabajador', receipt.name || receipt.user_name || '—'],
        ['RUT', rut ? formatRut(rut) : 'sin RUT registrado'],
        ['Movimiento', TYPE_LABEL[receipt.type] || receipt.type],
        ['Fecha', format(dt, "EEEE d 'de' MMMM 'de' yyyy", { locale: es })],
        ['Hora', format(dt, 'HH:mm:ss')],
        ['Sucursal', receipt.branch || '—'],
        ['Origen', SOURCE_LABEL[receipt.source] || SOURCE_LABEL.kiosk],
        ['Dispositivo', receipt.deviceLabel || receipt.device_label || '—'],
    ];

    const styles = [
        '@page { margin: 12mm; }',
        'body { font: 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; }',
        'h1 { font-size: 15px; margin: 0 0 2px; letter-spacing: .02em; }',
        '.sub { font-size: 11px; color: #555; margin-bottom: 14px; }',
        'table { border-collapse: collapse; width: 100%; max-width: 460px; }',
        'th, td { text-align: left; padding: 5px 0; border-bottom: 1px solid #e5e5e5; vertical-align: top; }',
        'th { width: 38%; font-weight: 600; color: #444; font-size: 12px; }',
        '.hash { font-family: ui-monospace, Consolas, monospace; font-size: 10px; color: #555; word-break: break-all; margin-top: 12px; max-width: 460px; }',
        '.foot { margin-top: 18px; font-size: 10px; color: #666; max-width: 460px; }',
        '.sign { margin-top: 34px; border-top: 1px solid #999; width: 240px; padding-top: 4px; font-size: 11px; }',
    ].join('\n');

    const body = rows.map(([k, v]) => '<tr><th>' + k + '</th><td>' + v + '</td></tr>').join('');

    return [
        '<!doctype html><html lang="es"><head><meta charset="utf-8">',
        '<title>Comprobante de marcacion ' + (folio ?? '') + '</title>',
        '<style>' + styles + '</style></head><body>',
        '<h1>COMPROBANTE DE MARCACIÓN</h1>',
        '<div class="sub">' + (companyName || '') + '</div>',
        '<table>' + body + '</table>',
        '<div class="hash"><strong>Código de verificación:</strong><br>' + (receipt.hash || '—') + '</div>',
        '<div class="foot">Este comprobante acredita la marca registrada en el sistema de control de',
        'asistencia del empleador. El código de verificación permite comprobar que el registro no fue',
        'alterado con posterioridad. Emitido el ' + format(new Date(), "dd-MM-yyyy 'a las' HH:mm") + '.</div>',
        '<div class="sign">Firma del trabajador</div>',
        '</body></html>',
    ].join('\n');
}

const Row = ({ label, value, muted }) => (
    <div className="flex justify-between gap-4">
        <span className="text-[var(--color-text-muted)]">{label}</span>
        <span className={muted ? 'text-amber-400 text-right' : 'text-[var(--color-text)] text-right'}>{value}</span>
    </div>
);

const AttendanceReceipt = ({ receipt, companyName, onClose }) => {
    const dt = useMemo(
        () => new Date(receipt?.recordedAt || receipt?.recorded_at || Date.now()),
        [receipt],
    );

    if (!receipt) return null;

    const folio = receipt.folio ?? receipt.seq;
    const rut = receipt.rut || receipt.user_rut;

    const handlePrint = () => {
        const w = window.open('', '_blank', 'width=520,height=680');
        if (!w) return;
        w.document.write(buildReceiptHtml(receipt, companyName));
        w.document.close();
        w.focus();
        w.print();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="glass-card w-full max-w-md p-0 flex flex-col">
                <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--glass-border)]">
                    <div>
                        <h3 className="font-semibold text-[var(--color-text)]">Comprobante de marcación</h3>
                        <p className="text-xs text-[var(--color-text-muted)]">
                            Folio N° {String(folio ?? '—').padStart(6, '0')}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-5 space-y-3 text-sm">
                    <Row label="Trabajador" value={receipt.name || receipt.user_name || '—'} />
                    <Row label="RUT" value={rut ? formatRut(rut) : 'sin RUT registrado'} muted={!rut} />
                    <Row
                        label="Movimiento"
                        value={
                            <span className={receipt.type === 'entry' ? 'text-green-400 font-semibold' : 'text-amber-400 font-semibold'}>
                                {TYPE_LABEL[receipt.type] || receipt.type}
                            </span>
                        }
                    />
                    <Row label="Fecha y hora" value={format(dt, "dd-MM-yyyy 'a las' HH:mm:ss")} />
                    <Row label="Sucursal" value={receipt.branch || '—'} />
                    <Row label="Origen" value={SOURCE_LABEL[receipt.source] || SOURCE_LABEL.kiosk} />

                    <div className="pt-2 border-t border-[var(--glass-border)]">
                        <div className="flex items-start gap-2">
                            <ShieldCheck size={16} className="text-[var(--color-primary)] mt-0.5 shrink-0" />
                            <div className="min-w-0">
                                <p className="text-xs text-[var(--color-text-muted)] mb-1">Código de verificación</p>
                                <p className="font-mono text-[10px] break-all text-[var(--color-text-muted)]">
                                    {receipt.hash || '—'}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex gap-2 px-5 py-4 border-t border-[var(--glass-border)]">
                    <button onClick={handlePrint} className="btn-primary flex-1 flex items-center justify-center gap-2">
                        <Printer size={16} />
                        Imprimir comprobante
                    </button>
                    <button onClick={onClose} className="btn-secondary">Cerrar</button>
                </div>
            </div>
        </div>
    );
};

export default AttendanceReceipt;
