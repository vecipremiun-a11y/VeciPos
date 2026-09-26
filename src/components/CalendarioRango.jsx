import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X, Check, CalendarDays } from 'lucide-react';
import { cn } from '../lib/utils';
import { fechaCorta, MESES } from '../utils/fechaCorta';

/**
 * Calendario de rango "desde – hasta", propio.
 *
 * No usa <input type="date"> a propósito: ese abre el calendario del navegador,
 * que cambia de forma en cada equipo (y en el APK es el del sistema Android),
 * no deja elegir un rango y se ve distinto al resto del sistema.
 *
 * Se maneja con dos toques: el primero marca el inicio, el segundo el fin. Si el
 * segundo toque cae antes del primero, se dan vuelta solos en vez de rechazarlo.
 * Un solo día también es un rango válido (desde = hasta).
 *
 * Las fechas se pasan como 'YYYY-MM-DD' —el mismo formato que guarda `due_date`—
 * y se arman en hora LOCAL: `new Date('2026-09-17')` se interpreta como UTC y en
 * Chile eso cae un día antes.
 */

const DIAS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

const aTexto = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const aFecha = (texto) => {
    if (!texto) return null;
    const [a, m, d] = texto.split('-').map(Number);
    return new Date(a, m - 1, d);
};
const mismoDia = (a, b) => a && b && aTexto(a) === aTexto(b);

/** Los días que se dibujan en la grilla del mes, empezando en lunes. */
function diasDelMes(ancla) {
    const primero = new Date(ancla.getFullYear(), ancla.getMonth(), 1);
    const arranque = (primero.getDay() + 6) % 7; // 0 = lunes
    const total = new Date(ancla.getFullYear(), ancla.getMonth() + 1, 0).getDate();
    const celdas = [];
    for (let i = 0; i < arranque; i++) celdas.push(null);
    for (let d = 1; d <= total; d++) celdas.push(new Date(ancla.getFullYear(), ancla.getMonth(), d));
    return celdas;
}

export default function CalendarioRango({ isOpen, onClose, desde, hasta, onAplicar, onVerTodos }) {
    const [inicio, setInicio] = useState(null);
    const [fin, setFin] = useState(null);
    const [mes, setMes] = useState(() => new Date());

    useEffect(() => {
        if (!isOpen) return;
        const i = aFecha(desde);
        const f = aFecha(hasta);
        setInicio(i);
        setFin(f);
        setMes(i || new Date());
    }, [isOpen, desde, hasta]);

    const celdas = useMemo(() => diasDelMes(mes), [mes]);
    const hoy = new Date();

    if (!isOpen) return null;

    const tocar = (dia) => {
        // Rango cerrado o sin empezar → este toque abre uno nuevo.
        if (!inicio || (inicio && fin)) { setInicio(dia); setFin(null); return; }
        if (dia < inicio) { setFin(inicio); setInicio(dia); return; }
        setFin(dia);
    };

    const enRango = (dia) => {
        if (!inicio || !fin) return false;
        return dia > inicio && dia < fin;
    };
    const esExtremo = (dia) => mismoDia(dia, inicio) || mismoDia(dia, fin);

    const atajo = (dias, desdeHoy = 0) => {
        const a = new Date(); a.setDate(a.getDate() + desdeHoy);
        const b = new Date(); b.setDate(b.getDate() + desdeHoy + dias);
        setInicio(a); setFin(dias === 0 ? a : b); setMes(a);
    };
    const esteMes = () => {
        const a = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
        const b = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
        setInicio(a); setFin(b); setMes(a);
    };

    const aplicar = () => {
        if (!inicio) return;
        onAplicar(aTexto(inicio), aTexto(fin || inicio));
        onClose();
    };

    const etiqueta = inicio
        ? (fin && !mismoDia(inicio, fin)
            ? `${fechaCorta(aTexto(inicio))} → ${fechaCorta(aTexto(fin))}`
            : fechaCorta(aTexto(inicio)))
        : 'Elegí el primer día';

    return createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={onClose}>
            {/* El relieve: borde claro arriba, sombra larga abajo. */}
            <div onClick={e => e.stopPropagation()}
                className="w-full max-w-sm rounded-3xl border border-[var(--glass-border)] bg-[var(--color-surface)]
                           shadow-[0_35px_60px_-15px_rgba(0,0,0,0.55),0_0_0_1px_rgba(255,255,255,0.06)_inset]
                           overflow-hidden animate-[float_0.25s_ease-out]">

                <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--glass-border)]
                                bg-gradient-to-b from-[var(--color-primary)]/15 to-transparent">
                    <span className="text-sm font-bold text-[var(--color-text)] flex items-center gap-2">
                        <CalendarDays size={16} className="text-[var(--color-primary)]" /> Elegir fechas
                    </span>
                    <button type="button" onClick={onClose}
                        className="p-1 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-4 space-y-3">
                    {/* Atajos */}
                    <div className="flex flex-wrap gap-1.5">
                        {[
                            { txt: 'Hoy', fn: () => atajo(0) },
                            { txt: 'Mañana', fn: () => atajo(0, 1) },
                            { txt: 'Próximos 7 días', fn: () => atajo(6) },
                            { txt: 'Este mes', fn: () => esteMes() },
                        ].map(a => (
                            <button key={a.txt} type="button" onClick={a.fn}
                                className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold border border-[var(--glass-border)]
                                           bg-[var(--glass-bg)] text-[var(--color-text-muted)]
                                           shadow-[0_2px_0_var(--glass-border)] hover:text-[var(--color-text)]
                                           active:translate-y-[2px] active:shadow-none transition-all">
                                {a.txt}
                            </button>
                        ))}
                    </div>

                    {/* Mes */}
                    <div className="flex items-center justify-between">
                        <button type="button" onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))}
                            className="w-9 h-9 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)]
                                       text-[var(--color-text)] flex items-center justify-center
                                       shadow-[0_3px_0_var(--glass-border)] active:translate-y-[3px] active:shadow-none transition-all">
                            <ChevronLeft size={18} />
                        </button>
                        <span className="text-sm font-black text-[var(--color-text)] capitalize">
                            {MESES[mes.getMonth()]} {mes.getFullYear()}
                        </span>
                        <button type="button" onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))}
                            className="w-9 h-9 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)]
                                       text-[var(--color-text)] flex items-center justify-center
                                       shadow-[0_3px_0_var(--glass-border)] active:translate-y-[3px] active:shadow-none transition-all">
                            <ChevronRight size={18} />
                        </button>
                    </div>

                    <div className="grid grid-cols-7 gap-1 text-center">
                        {DIAS.map((d, i) => (
                            <span key={i} className="text-[10px] font-bold text-[var(--color-text-muted)] py-1">{d}</span>
                        ))}
                        {celdas.map((dia, i) => {
                            if (!dia) return <span key={i} />;
                            const extremo = esExtremo(dia);
                            const medio = enRango(dia);
                            const esHoy = mismoDia(dia, hoy);
                            return (
                                <button key={i} type="button" onClick={() => tocar(dia)}
                                    className={cn(
                                        'h-10 rounded-xl text-sm font-bold transition-all border',
                                        extremo
                                            // El día elegido: en relieve, con sombra propia.
                                            ? 'bg-[var(--color-primary)] text-[var(--color-on-primary)] border-[var(--color-primary)] shadow-[0_4px_0_var(--color-primary-dark),0_8px_14px_-6px_rgba(0,0,0,0.6)] -translate-y-[1px]'
                                            : medio
                                                // Los días del medio: hundidos, para que se lea el camino
                                                // entre el inicio y el fin sin competir con los extremos.
                                                ? 'bg-[var(--color-primary)]/25 text-[var(--color-text)] border-[var(--color-primary)]/40 shadow-[inset_0_2px_4px_rgba(0,0,0,0.25)]'
                                                : 'bg-[var(--glass-bg)] text-[var(--color-text)] border-[var(--glass-border)] shadow-[0_2px_0_var(--glass-border)] hover:-translate-y-[1px]',
                                        'active:translate-y-[2px] active:shadow-none',
                                        esHoy && !extremo && 'ring-1 ring-[var(--color-primary)]'
                                    )}>
                                    {dia.getDate()}
                                </button>
                            );
                        })}
                    </div>

                    <p className="text-center text-xs font-bold text-[var(--color-text)]">{etiqueta}</p>
                </div>

                <div className="flex gap-2 p-4 pt-0">
                    <button type="button" onClick={() => { onVerTodos(); onClose(); }}
                        className="flex-1 py-2.5 rounded-xl text-sm font-bold border border-[var(--glass-border)]
                                   text-[var(--color-text-muted)] hover:text-[var(--color-text)]
                                   shadow-[0_3px_0_var(--glass-border)] active:translate-y-[3px] active:shadow-none transition-all">
                        Ver todos
                    </button>
                    <button type="button" onClick={aplicar} disabled={!inicio}
                        className="flex-1 py-2.5 rounded-xl text-sm font-black bg-[var(--color-primary)] text-[var(--color-on-primary)]
                                   flex items-center justify-center gap-1.5 disabled:opacity-40
                                   shadow-[0_4px_0_var(--color-primary-dark)] active:translate-y-[4px] active:shadow-none transition-all">
                        <Check size={16} /> Aplicar
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}
