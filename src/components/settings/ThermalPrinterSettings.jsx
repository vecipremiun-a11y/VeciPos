import React, { useEffect, useState } from 'react';
import { Printer, Bluetooth, Check, X, Loader2, Search } from 'lucide-react';
import { cn } from '../../lib/utils';
import { toast } from '../../lib/toast';
import {
    isThermalAvailable, getSavedPrinter, savePrinter, clearSavedPrinter,
    scanPrinters, printTestTicket,
} from '../../lib/thermalPrint';

// Configuración de la impresora térmica Bluetooth. Solo aparece en la APP
// nativa: en el navegador la impresión sigue siendo la de siempre (window.print).
export default function ThermalPrinterSettings() {
    const [saved, setSaved] = useState(() => getSavedPrinter());
    const [devices, setDevices] = useState([]);
    const [scanning, setScanning] = useState(false);
    const [testing, setTesting] = useState(false);
    const [paperWidth, setPaperWidth] = useState(() => getSavedPrinter()?.paperWidth || 58);
    const stopRef = React.useRef(null);

    useEffect(() => () => { stopRef.current?.(); }, []);

    // En la web no se muestra nada: no hay Bluetooth y la impresión no cambia.
    if (!isThermalAvailable()) return null;

    const startScan = async () => {
        setDevices([]);
        setScanning(true);
        try {
            stopRef.current = await scanPrinters((list) => setDevices(list || []));
            // La búsqueda se detiene sola a los 15s para no gastar batería.
            setTimeout(async () => { await stopRef.current?.(); setScanning(false); }, 15000);
        } catch (e) {
            setScanning(false);
            toast('No se pudo buscar impresoras: ' + (e?.message || ''), 'error');
        }
    };

    const stopScan = async () => { await stopRef.current?.(); setScanning(false); };

    const choose = (d) => {
        const entry = { name: d.name || 'Impresora', address: d.address, paperWidth };
        savePrinter(entry);
        setSaved(entry);
        stopScan();
        toast(`Impresora "${entry.name}" guardada`, 'success');
    };

    const forget = () => { clearSavedPrinter(); setSaved(null); toast('Impresora quitada', 'info'); };

    const changeWidth = (w) => {
        setPaperWidth(w);
        if (saved) { const e = { ...saved, paperWidth: w }; savePrinter(e); setSaved(e); }
    };

    const test = async () => {
        setTesting(true);
        const r = await printTestTicket();
        setTesting(false);
        if (r.ok) toast('Ticket de prueba enviado', 'success');
        else toast(r.error || 'No se pudo imprimir', 'error');
    };

    return (
        <div className="glass-card">
            <h3 className="text-lg font-bold text-[var(--color-text)] mb-1 flex items-center gap-2">
                <Printer size={18} className="text-[var(--color-primary)]" /> Impresora térmica (Bluetooth)
            </h3>
            <p className="text-sm text-[var(--color-text-muted)] mb-4">
                Conecta tu impresora de tickets. Primero <strong>emparéjala desde los ajustes de Bluetooth</strong> del
                teléfono, y luego búscala aquí.
            </p>

            {/* Impresora actual */}
            {saved ? (
                <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 mb-4">
                    <div className="min-w-0">
                        <p className="font-bold text-[var(--color-text)] flex items-center gap-2">
                            <Check size={14} className="text-emerald-400" /> {saved.name}
                        </p>
                        <p className="text-xs text-[var(--color-text-muted)] font-mono">{saved.address}</p>
                    </div>
                    <button onClick={forget} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-[var(--glass-border)] text-[var(--color-text-muted)] hover:text-red-400 hover:border-red-500/40">
                        Quitar
                    </button>
                </div>
            ) : (
                <p className="text-sm text-amber-400 mb-4">Aún no has elegido una impresora.</p>
            )}

            {/* Ancho de papel */}
            <div className="mb-4">
                <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">Ancho del papel</p>
                <div className="flex gap-2">
                    {[58, 80].map(w => (
                        <button key={w} onClick={() => changeWidth(w)}
                            className={cn('px-4 py-2 rounded-lg text-sm font-bold border transition-all',
                                paperWidth === w
                                    ? 'bg-[var(--color-primary)] text-black border-[var(--color-primary)]'
                                    : 'bg-[var(--glass-bg)] text-[var(--color-text-muted)] border-[var(--glass-border)]')}>
                            {w} mm
                        </button>
                    ))}
                </div>
            </div>

            {/* Acciones */}
            <div className="flex flex-wrap gap-2 mb-3">
                {!scanning ? (
                    <button onClick={startScan}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-primary)] text-black font-bold text-sm">
                        <Search size={15} /> Buscar impresoras
                    </button>
                ) : (
                    <button onClick={stopScan}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--glass-border)] text-[var(--color-text)] font-bold text-sm">
                        <Loader2 size={15} className="animate-spin" /> Buscando… (tocar para detener)
                    </button>
                )}
                {saved && (
                    <button onClick={test} disabled={testing}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--color-primary)]/40 text-[var(--color-primary)] font-bold text-sm disabled:opacity-60">
                        <Printer size={15} /> {testing ? 'Imprimiendo…' : 'Imprimir prueba'}
                    </button>
                )}
            </div>

            {/* Dispositivos encontrados */}
            {devices.length > 0 && (
                <div className="border border-[var(--glass-border)] rounded-lg divide-y divide-[var(--glass-border)] overflow-hidden">
                    {devices.map((d) => (
                        <button key={d.address} onClick={() => choose(d)}
                            className="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-[var(--glass-bg)]">
                            <div className="min-w-0">
                                <p className="text-sm text-[var(--color-text)] truncate flex items-center gap-2">
                                    <Bluetooth size={13} className="text-sky-400" /> {d.name || 'Dispositivo'}
                                </p>
                                <p className="text-[10px] text-[var(--color-text-muted)] font-mono">{d.address}</p>
                            </div>
                            <span className="text-xs font-bold text-[var(--color-primary)] shrink-0">Elegir</span>
                        </button>
                    ))}
                </div>
            )}
            {scanning && devices.length === 0 && (
                <p className="text-xs text-[var(--color-text-muted)]">Buscando dispositivos emparejados…</p>
            )}
        </div>
    );
}
