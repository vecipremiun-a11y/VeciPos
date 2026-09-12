// Cancelar un encargo: siempre con motivo, y siempre a nombre de alguien.
//
// Por qué existe: hasta ahora cancelar era una X roja que actuaba al toque.
// Sin confirmación, sin motivo, y sin dejar rastro de quién lo hizo. El
// 8-sep-2026 el encargo #690 (Maritza, Pan Hamburguesa x15, $4.125) se canceló
// 2 minutos y 15 segundos después de crearse, y no hubo forma de saber quién
// fue: los cambios de estado de un encargo no se guardaban en ninguna parte.
// El pedido no se rehízo ni se vendió — se perdió, y la clienta es habitual.
//
// Ahora el motivo es obligatorio (lo exige también el servidor, no solo esta
// pantalla) y queda en el historial junto con el usuario y la hora. La misma
// ventana se usa en Encargos, en Producción y en Tienda, para que cancelar sea
// una sola cosa en todo el sistema.

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertTriangle, Ban, Loader2 } from 'lucide-react';

// Los de siempre, para no tener que escribir a mano en el mostrador. El texto
// que se guarda es el mismo que se ve.
const MOTIVOS = [
    'El cliente se arrepintió',
    'Error al cargar el pedido',
    'No se puede preparar',
    'Pedido duplicado',
    'El cliente no lo retiró',
];

export default function CancelarEncargoModal({ encargo, onCancel, onConfirm }) {
    const [motivo, setMotivo] = useState('');
    const [detalle, setDetalle] = useState('');
    const [error, setError] = useState(null);
    const [enviando, setEnviando] = useState(false);

    if (!encargo) return null;

    // El motivo final: el elegido, el escrito, o los dos juntos.
    const textoFinal = () => {
        const d = detalle.trim();
        if (motivo && d) return `${motivo}: ${d}`;
        return motivo || d;
    };

    const confirmar = async (e) => {
        e.preventDefault();
        if (enviando) return;
        const texto = textoFinal();
        if (!texto) {
            setError('Elegí un motivo o escribilo, no puede quedar en blanco.');
            return;
        }
        setEnviando(true);
        setError(null);
        try {
            const r = await onConfirm(texto);
            if (r !== true) setError(r?.error || 'No se pudo cancelar el encargo.');
        } catch (err) {
            setError(err?.message || 'No se pudo cancelar el encargo.');
        } finally {
            setEnviando(false);
        }
    };

    const conAbono = Number(encargo.deposit_amount) > 0;

    return createPortal(
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/70 p-4">
            {/* max-h + scroll: en un teléfono acostado el formulario no entra y
                los botones quedaban fuera de la pantalla. */}
            <div className="glass-card modal-solido w-full max-w-md relative p-5 max-h-[90vh] overflow-y-auto">
                <button
                    onClick={onCancel}
                    className="absolute top-4 right-4 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                    aria-label="Cerrar"
                >
                    <X size={18} />
                </button>

                <h2 className="text-lg font-bold flex items-center gap-2 text-[var(--color-text)] pr-8">
                    <Ban className="text-red-400 shrink-0" size={20} />
                    Cancelar encargo #{encargo.id}
                </h2>

                <div className="mt-3 rounded-lg border border-[var(--glass-border)] bg-[var(--color-surface-hover)] p-3 text-xs">
                    <p className="font-bold text-[var(--color-text)]">
                        {encargo.client_name || 'Sin nombre'}
                    </p>
                    <p className="text-[var(--color-text-muted)] mt-0.5">
                        {encargo.due_date} · {encargo.due_time}
                        {encargo.items_summary ? ` · ${encargo.items_summary}` : ''}
                    </p>
                </div>

                {conAbono && (
                    <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                        <div className="flex items-center gap-2 font-bold text-amber-400">
                            <AlertTriangle size={14} className="shrink-0" />
                            Este encargo tiene un abono
                        </div>
                        <p className="mt-1 text-[var(--color-text-muted)]">
                            Si el abono fue en efectivo, la devolución sale de tu caja abierta.
                        </p>
                    </div>
                )}

                <form onSubmit={confirmar} className="mt-4 space-y-3">
                    <div>
                        <label className="block text-xs text-[var(--color-text-muted)] mb-1.5">
                            Motivo <span className="text-red-400">(obligatorio)</span>
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                            {MOTIVOS.map(m => (
                                <button
                                    type="button"
                                    key={m}
                                    onClick={() => setMotivo(motivo === m ? '' : m)}
                                    className={`px-2.5 py-2 rounded-lg border text-xs font-semibold transition-colors ${motivo === m
                                        ? 'bg-red-500/20 border-red-500/50 text-red-400'
                                        : 'border-[var(--glass-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                                        }`}
                                >
                                    {m}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs text-[var(--color-text-muted)] mb-1">
                            Detalle <span className="opacity-70">(opcional)</span>
                        </label>
                        <input
                            className="glass-input w-full"
                            value={detalle}
                            onChange={(e) => { setDetalle(e.target.value); if (error) setError(null); }}
                            maxLength={250}
                            placeholder={motivo ? 'Algo más que aclare la cancelación' : 'O escribí el motivo acá'}
                            autoFocus
                        />
                    </div>

                    {error && (
                        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded p-2 flex items-start gap-2">
                            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                            {error}
                        </div>
                    )}

                    <p className="text-[11px] text-[var(--color-text-muted)]">
                        Queda registrado con tu usuario y la hora, y se puede ver
                        después en el detalle del encargo.
                    </p>

                    <div className="flex gap-2 pt-1">
                        <button
                            type="button"
                            onClick={onCancel}
                            disabled={enviando}
                            className="flex-1 py-2.5 rounded-lg border border-[var(--glass-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-sm font-semibold disabled:opacity-50"
                        >
                            Volver
                        </button>
                        <button
                            type="submit"
                            disabled={enviando}
                            className="flex-1 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {enviando && <Loader2 size={14} className="animate-spin" />}
                            Cancelar encargo
                        </button>
                    </div>
                </form>
            </div>
        </div>,
        document.body
    );
}
