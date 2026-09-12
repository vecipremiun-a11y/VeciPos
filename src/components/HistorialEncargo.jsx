// Línea de tiempo de un encargo: qué pasó, cuándo, quién y por qué.
//
// Por qué existe: hasta la migración 0028 un encargo no guardaba nada de esto.
// Cuando el #690 apareció cancelado, la única forma de saber la hora fue
// rebuscar en los logs de integración, y el usuario nunca se pudo identificar.
// Ahora la pregunta "¿quién canceló esto?" se contesta abriendo el pedido.
//
// Se muestra en Encargos, en Producción y en Tienda: es el mismo dato.

import React from 'react';
import { useStore } from '../store/useStore';
import { formatInCompanyTime } from '../lib/dateHelpers';
import {
    Clock, Check, ChefHat, PackageCheck, Truck, Ban, PlusCircle, History,
} from 'lucide-react';

const ESTADOS = {
    pending: { texto: 'Pendiente', icono: Clock, color: 'text-amber-400', borde: 'border-amber-500/40' },
    confirmed: { texto: 'Confirmado', icono: Check, color: 'text-cyan-400', borde: 'border-cyan-500/40' },
    preparing: { texto: 'En preparación', icono: ChefHat, color: 'text-blue-400', borde: 'border-blue-500/40' },
    ready: { texto: 'Listo', icono: PackageCheck, color: 'text-emerald-400', borde: 'border-emerald-500/40' },
    out_for_delivery: { texto: 'En reparto', icono: Truck, color: 'text-indigo-400', borde: 'border-indigo-500/40' },
    delivered: { texto: 'Entregado', icono: PackageCheck, color: 'text-emerald-400', borde: 'border-emerald-500/40' },
    canceled: { texto: 'Cancelado', icono: Ban, color: 'text-red-400', borde: 'border-red-500/40' },
};

// De qué pantalla vino. El KDS no identifica personas (entra por token de
// panadería), así que ahí la pantalla ES la respuesta.
const FUENTES = {
    encargos: 'Encargos',
    produccion: 'Producción',
    kds: 'Panadería (KDS)',
    tienda: 'Tienda web',
    sistema: 'Sistema',
};

// El servidor guarda ISO con Z. Las filas viejas que hubieran caído en el
// DEFAULT de SQLite vienen sin marca de zona y también son UTC.
function aFecha(valor) {
    if (!valor) return null;
    const s = String(valor);
    const iso = /[Zz]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s.replace(' ', 'T') + 'Z';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
}

export default function HistorialEncargo({ historial, compacto = false }) {
    const tz = useStore((s) => s.currentCompanyTimezone) || 'America/Santiago';

    if (!Array.isArray(historial) || historial.length === 0) {
        return (
            <div className="text-xs text-[var(--color-text-muted)] bg-[var(--color-surface-hover)] border border-[var(--glass-border)] rounded-lg p-3">
                Este encargo no tiene movimientos registrados. Los encargos
                anteriores al 8-sep-2026 no guardaban su historial.
            </div>
        );
    }

    const cuando = (v) => {
        const d = aFecha(v);
        if (!d) return '—';
        try { return formatInCompanyTime(d, tz, 'dd/MM/yyyy HH:mm'); } catch { return d.toLocaleString(); }
    };

    return (
        <div className="space-y-2">
            {!compacto && (
                <h4 className="text-xs font-bold text-[var(--color-text-muted)] flex items-center gap-1.5 uppercase tracking-wide">
                    <History size={13} />
                    Historial
                </h4>
            )}

            <ol className="space-y-1.5">
                {historial.map((h, i) => {
                    const esAlta = !h.from_status;
                    const cfg = ESTADOS[h.to_status] || { texto: h.to_status, icono: Clock, color: 'text-[var(--color-text-muted)]', borde: 'border-[var(--glass-border)]' };
                    const Icono = esAlta ? PlusCircle : cfg.icono;
                    const esCancelacion = h.to_status === 'canceled';

                    return (
                        <li
                            key={h.id ?? i}
                            className={`rounded-lg border p-2.5 ${esCancelacion
                                ? 'border-red-500/40 bg-red-500/10'
                                : `${cfg.borde} bg-[var(--color-surface-hover)]`}`}
                        >
                            {/* flex-wrap: en un teléfono el nombre y la hora no
                                entran en la misma línea. */}
                            <div className="flex items-start justify-between gap-2 flex-wrap">
                                <span className={`text-xs font-bold flex items-center gap-1.5 ${esAlta ? 'text-[var(--color-text)]' : cfg.color}`}>
                                    <Icono size={13} className="shrink-0" />
                                    {esAlta ? 'Creado' : cfg.texto}
                                </span>
                                <span className="text-[11px] text-[var(--color-text-muted)] tabular-nums">
                                    {cuando(h.created_at)}
                                </span>
                            </div>

                            <div className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                                {h.user_name
                                    ? <>por <span className="text-[var(--color-text)] font-semibold">{h.user_name}</span></>
                                    : 'sin usuario registrado'}
                                {h.source && FUENTES[h.source] ? ` · ${FUENTES[h.source]}` : ''}
                            </div>

                            {h.reason && (
                                <p className={`mt-1.5 text-xs ${esCancelacion ? 'text-red-300' : 'text-amber-300'} break-words`}>
                                    “{h.reason}”
                                </p>
                            )}
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}
