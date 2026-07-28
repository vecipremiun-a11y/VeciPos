import React, { useEffect, useState } from 'react';
import { Printer, Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import { toast } from '../../lib/toast';
import {
    isThermalAvailable, getSavedPrinter, savePrinter, clearSavedPrinter,
    printTestTicket, listPairedPrinters,
} from '../../lib/thermalPrint';

// Configuración de la impresora térmica Bluetooth. Solo aparece en la APP
// nativa: en el navegador la impresión sigue siendo la de siempre (window.print).
export default function ThermalPrinterSettings() {
    const [saved, setSaved] = useState(() => getSavedPrinter());
    const [paired, setPaired] = useState([]);
    const [loadingPaired, setLoadingPaired] = useState(false);
    const [pairedError, setPairedError] = useState('');
    const [testing, setTesting] = useState(false);
    const [paperWidth, setPaperWidth] = useState(() => getSavedPrinter()?.paperWidth || 58);

    // Al abrir: cargar las impresoras ya emparejadas (el caso normal).
    const loadPaired = React.useCallback(async () => {
        setLoadingPaired(true);
        setPairedError('');
        const { devices: list, error } = await listPairedPrinters();
        setPaired(list);
        if (error) setPairedError(error);
        setLoadingPaired(false);
    }, []);

    useEffect(() => {
        if (isThermalAvailable()) loadPaired();
    }, [loadPaired]);

    // En la web no se muestra nada: no hay Bluetooth y la impresión no cambia.
    if (!isThermalAvailable()) return null;

    const choose = (d) => {
        const entry = { name: d.name || 'Impresora', address: d.address, paperWidth };
        savePrinter(entry);
        setSaved(entry);
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
                Empareja la impresora una vez desde los <strong>ajustes de Bluetooth</strong> del teléfono y luego
                elígela de la lista de abajo. ("Buscar nuevas" solo sirve para impresoras que aún no has emparejado
                y están en modo de emparejamiento.)
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

            {/* Impresoras emparejadas — el camino normal */}
            <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                        Impresoras emparejadas en el teléfono
                    </p>
                    <button onClick={loadPaired} disabled={loadingPaired}
                        className="text-xs font-bold text-[var(--color-primary)] disabled:opacity-50">
                        {loadingPaired ? 'Leyendo…' : 'Actualizar'}
                    </button>
                </div>

                {pairedError && (
                    <p className="text-xs text-red-400 mb-2">{pairedError}</p>
                )}

                {!loadingPaired && paired.length === 0 && !pairedError && (
                    <p className="text-xs text-[var(--color-text-muted)]">
                        No hay dispositivos emparejados. Empareja la impresora desde los ajustes de
                        Bluetooth del teléfono y toca "Actualizar".
                    </p>
                )}

                {paired.length > 0 && (
                    <div className="border border-[var(--glass-border)] rounded-lg divide-y divide-[var(--glass-border)] overflow-hidden">
                        {paired.map((d) => (
                            <button key={d.address} onClick={() => choose(d)}
                                className="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-[var(--glass-bg)]">
                                <div className="min-w-0">
                                    <p className="text-sm text-[var(--color-text)] truncate flex items-center gap-2">
                                        <Printer size={13} className={d.isPrinter ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)]'} />
                                        {d.name}
                                    </p>
                                    <p className="text-[10px] text-[var(--color-text-muted)] font-mono">{d.address}</p>
                                </div>
                                <span className="text-xs font-bold text-[var(--color-primary)] shrink-0">
                                    {saved?.address === d.address ? 'Elegida' : 'Elegir'}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Acciones */}
            {saved && (
                <div className="flex flex-wrap gap-2 mb-3">
                    <button onClick={test} disabled={testing}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--color-primary)]/40 text-[var(--color-primary)] font-bold text-sm disabled:opacity-60">
                        <Printer size={15} /> {testing ? 'Imprimiendo…' : 'Imprimir prueba'}
                    </button>
                </div>
            )}
        </div>
    );
}
