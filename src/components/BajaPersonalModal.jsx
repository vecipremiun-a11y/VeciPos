// Dar de baja a alguien que dejó de trabajar.
//
// Por qué existe: hasta ahora, cuando una persona se iba, había dos caminos y
// los dos estaban mal. Borrarla no se puede —la base protege sus registros
// laborales, y su nombre en 20.000 ventas sale de esa ficha—. Y reusar su
// usuario renombrándolo deja el historial contando dos versiones: pasó con
// "Katy" → "Chelo", donde las mismas 115 ventas del 1-ago-2026 figuran con un
// nombre en un reporte y con otro en el historial, y las marcas de asistencia
// de la que se fue quedaron a nombre de la que entró.
//
// Acá se cierra el legajo: cuándo terminó, por qué, y se le quita el acceso.
// La persona sale de Usuarios y pasa a "Ex personal", con todo lo suyo intacto.

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, UserMinus, AlertTriangle } from 'lucide-react';

const MOTIVOS = ['Renuncia', 'Despido', 'Fin de contrato', 'Fin de temporada', 'Otro'];

export default function BajaPersonalModal({ usuario, onCancel, onConfirm }) {
    const hoy = new Date().toISOString().slice(0, 10);
    const [fecha, setFecha] = useState(hoy);
    const [motivo, setMotivo] = useState('');
    const [detalle, setDetalle] = useState('');
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState(null);

    if (!usuario) return null;

    const confirmar = async (e) => {
        e.preventDefault();
        if (enviando) return;
        if (!motivo) { setError('Elegí el motivo de la salida.'); return; }
        setEnviando(true);
        setError(null);
        try {
            const texto = motivo === 'Otro' ? (detalle.trim() || 'Otro') : (detalle.trim() ? `${motivo}: ${detalle.trim()}` : motivo);
            const r = await onConfirm({ endDate: fecha, reason: texto });
            if (r !== true) setError(r?.error || 'No se pudo dar de baja.');
        } catch (err) {
            setError(err?.message || 'No se pudo dar de baja.');
        } finally {
            setEnviando(false);
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/70 p-4">
            <div className="glass-card modal-solido w-full max-w-md relative p-5">
                <button
                    onClick={onCancel}
                    className="absolute top-4 right-4 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                    aria-label="Cerrar"
                >
                    <X size={18} />
                </button>

                <h2 className="text-lg font-bold flex items-center gap-2 text-[var(--color-text)]">
                    <UserMinus className="text-amber-400" size={20} />
                    Eliminar a {usuario.name}
                </h2>

                <div className="mt-3 rounded-lg border border-[var(--glass-border)] bg-[var(--color-surface-hover)] p-3 text-xs text-[var(--color-text-muted)]">
                    No va a poder entrar más al sistema, desde ningún equipo, y sale de la
                    lista de usuarios.
                    <br />
                    <span className="text-[var(--color-text)] font-semibold">
                        Todo su historial se conserva
                    </span>{' '}
                    —ventas, cierres de caja, asistencia y pagos— y queda a su nombre en
                    la lista de “Eliminados”.
                </div>

                <form onSubmit={confirmar} className="mt-4 space-y-3">
                    <div>
                        <label className="block text-xs text-[var(--color-text-muted)] mb-1">Último día de trabajo</label>
                        <input
                            type="date"
                            className="glass-input w-full"
                            value={fecha}
                            max={hoy}
                            onChange={(e) => setFecha(e.target.value)}
                        />
                    </div>

                    <div>
                        <label className="block text-xs text-[var(--color-text-muted)] mb-1">Motivo</label>
                        <div className="flex flex-wrap gap-1.5">
                            {MOTIVOS.map(m => (
                                <button
                                    type="button"
                                    key={m}
                                    onClick={() => setMotivo(m)}
                                    className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                                        motivo === m
                                            ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
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
                            Detalle <span className="opacity-70">(opcional, queda en el legajo)</span>
                        </label>
                        <input
                            className="glass-input w-full"
                            value={detalle}
                            onChange={(e) => setDetalle(e.target.value)}
                            maxLength={250}
                            placeholder="Ej: renunció avisando con 15 días"
                        />
                    </div>

                    {error && (
                        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded p-2 flex items-start gap-2">
                            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                            {error}
                        </div>
                    )}

                    <div className="flex gap-2 pt-1">
                        <button
                            type="button"
                            onClick={onCancel}
                            disabled={enviando}
                            className="flex-1 py-2.5 rounded-lg border border-[var(--glass-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-sm font-semibold disabled:opacity-50"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={enviando}
                            className="flex-1 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold disabled:opacity-50"
                        >
                            {enviando ? 'Eliminando…' : 'Eliminar usuario'}
                        </button>
                    </div>
                </form>
            </div>
        </div>,
        document.body
    );
}
