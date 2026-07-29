import React, { useEffect, useState, useRef } from 'react';
import {
    Bike, MapPin, Phone, Check, X, Navigation, Package, Loader2,
    Banknote, AlertTriangle, Hand,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { formatCurrency } from '../../utils/formatCurrency';
import { toast } from '../../lib/toast';
import { cn } from '../../lib/utils';

// Modo Repartidor: lo que ve el repartidor en su celular. Solo sus pedidos.
// La ubicación se comparte SOLO mientras tiene envíos en curso, cada 25 s, y se
// apaga sola al terminar (cuida la batería).
const PING_MS = 25000;

export default function CourierMode() {
    const {
        fetchMyDeliveries, takeDelivery, setDeliveryStatus, pingCourierLocation, currentCurrency,
    } = useStore();

    const [state, setState] = useState({ isCourier: true, deliveries: [], available: [], me: null, pendingCash: 0 });
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(null);
    const [failing, setFailing] = useState(null);
    const watchRef = useRef(null);

    const load = React.useCallback(async () => {
        const r = await fetchMyDeliveries();
        if (r?.success) setState(r);
        setLoading(false);
    }, [fetchMyDeliveries]);

    useEffect(() => {
        load();
        const t = setInterval(load, 20000);
        return () => clearInterval(t);
    }, [load]);

    // Compartir ubicación solo si hay envíos en curso.
    const enRuta = state.deliveries.length > 0;
    useEffect(() => {
        if (!enRuta || typeof navigator === 'undefined' || !navigator.geolocation) return;
        const send = () => {
            navigator.geolocation.getCurrentPosition(
                (p) => pingCourierLocation(p.coords.latitude, p.coords.longitude),
                () => { /* sin permiso: se ignora */ },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 20000 }
            );
        };
        send();
        watchRef.current = setInterval(send, PING_MS);
        return () => { clearInterval(watchRef.current); watchRef.current = null; };
    }, [enRuta, pingCourierLocation]);

    const act = async (d, status, extra) => {
        setBusy(d.id);
        const r = await setDeliveryStatus(d.id, status, extra);
        setBusy(null);
        if (r?.success) { toast('Listo', 'success'); load(); }
        else toast(r?.error || 'No se pudo actualizar', 'error');
    };

    const take = async (d) => {
        setBusy(d.id);
        const r = await takeDelivery(d.id);
        setBusy(null);
        if (r?.success) { toast('Pedido tomado', 'success'); load(); }
        else toast(r?.error || 'No se pudo tomar', 'error');
    };

    // Abre la app de mapas del teléfono con la dirección.
    const navigate = (d) => {
        const q = d.lat != null && d.lng != null ? `${d.lat},${d.lng}` : d.address;
        window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`, '_blank');
    };

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center text-[var(--color-text-muted)] gap-2">
                <Loader2 className="animate-spin" size={20} /> Cargando…
            </div>
        );
    }

    if (!state.isCourier) {
        return (
            <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center text-[var(--color-text-muted)]">
                <Bike size={56} className="opacity-20" />
                <h2 className="text-lg font-bold text-[var(--color-text)]">No estás registrado como repartidor</h2>
                <p className="text-sm max-w-xs">
                    Pídele al administrador que te agregue en <strong>Delivery → Repartidores</strong> y enlace tu usuario.
                </p>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col gap-3 p-4 overflow-y-auto">
            <div className="shrink-0">
                <h1 className="text-xl font-bold text-[var(--color-text)] flex items-center gap-2">
                    <Bike className="text-[var(--color-primary)]" /> Mis pedidos
                    <span className="text-sm font-normal text-[var(--color-text-muted)]">({state.deliveries.length})</span>
                </h1>
                {enRuta && (
                    <p className="text-[11px] text-emerald-400 flex items-center gap-1 mt-0.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse inline-block" />
                        Compartiendo ubicación
                    </p>
                )}
            </div>

            {/* Recaudado por rendir */}
            {state.pendingCash > 0 && (
                <div className="glass-card p-3 flex items-center justify-between border border-amber-500/30 bg-amber-500/5">
                    <span className="text-sm text-amber-400 flex items-center gap-2">
                        <Banknote size={16} /> Recaudado por rendir
                    </span>
                    <span className="font-black text-amber-400">{formatCurrency(state.pendingCash, currentCurrency)}</span>
                </div>
            )}

            {/* Mis envíos */}
            {state.deliveries.length === 0 ? (
                <div className="glass-card p-8 flex flex-col items-center gap-2 text-[var(--color-text-muted)]">
                    <Package size={44} className="opacity-20" />
                    <p className="text-sm">No tienes pedidos asignados.</p>
                </div>
            ) : state.deliveries.map(d => {
                const cobra = Number(d.amount_to_collect) > 0;
                return (
                    <div key={d.id} className="glass-card p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                                <p className="font-bold text-[var(--color-text)]">#{d.id}</p>
                                <p className="text-sm text-[var(--color-text)]">{d.client_name || 'Sin cliente'}</p>
                            </div>
                            <span className={cn('text-[10px] font-bold px-2 py-1 rounded-full border shrink-0',
                                d.status === 'assigned' ? 'text-sky-400 border-sky-500/30 bg-sky-500/10'
                                    : d.status === 'picked_up' ? 'text-violet-400 border-violet-500/30 bg-violet-500/10'
                                        : 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10')}>
                                {d.status === 'assigned' ? 'ASIGNADO' : d.status === 'picked_up' ? 'RETIRADO' : 'EN RUTA'}
                            </span>
                        </div>

                        <p className="text-sm text-[var(--color-text-muted)] flex items-start gap-1.5">
                            <MapPin size={14} className="shrink-0 mt-0.5" />
                            <span>{d.address}{d.address_notes ? ` · ${d.address_notes}` : ''}</span>
                        </p>
                        {d.client_phone && (
                            <a href={`tel:${d.client_phone}`} className="text-sm text-[var(--color-primary)] flex items-center gap-1.5">
                                <Phone size={14} /> {d.client_phone}
                            </a>
                        )}
                        <p className={cn('text-sm font-bold flex items-center gap-1.5', cobra ? 'text-amber-400' : 'text-emerald-400')}>
                            <Banknote size={14} />
                            {cobra ? `Cobrar ${formatCurrency(d.amount_to_collect, currentCurrency)}` : 'Ya pagado'}
                        </p>

                        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[var(--glass-border)]">
                            {d.status === 'assigned' ? (
                                <button onClick={() => act(d, 'picked_up')} disabled={busy === d.id}
                                    className="col-span-2 py-3 rounded-xl font-bold bg-violet-500/15 text-violet-300 border border-violet-500/30 disabled:opacity-50">
                                    <Check size={16} className="inline mr-1" /> Retiré el pedido
                                </button>
                            ) : (
                                <>
                                    <button onClick={() => navigate(d)}
                                        className="py-3 rounded-xl font-bold bg-[var(--color-primary)]/15 text-[var(--color-primary)] border border-[var(--color-primary)]/30">
                                        <Navigation size={16} className="inline mr-1" /> Navegar
                                    </button>
                                    {d.status === 'picked_up' ? (
                                        <button onClick={() => act(d, 'on_route')} disabled={busy === d.id}
                                            className="py-3 rounded-xl font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 disabled:opacity-50">
                                            Salí a repartir
                                        </button>
                                    ) : (
                                        <button onClick={() => act(d, 'delivered')} disabled={busy === d.id}
                                            className="py-3 rounded-xl font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 disabled:opacity-50">
                                            <Check size={16} className="inline mr-1" /> Entregado
                                        </button>
                                    )}
                                    <button onClick={() => setFailing(d)}
                                        className="col-span-2 py-2.5 rounded-xl text-sm font-bold text-red-400 border border-red-500/30">
                                        <X size={14} className="inline mr-1" /> No pude entregar
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                );
            })}

            {/* Pedidos disponibles para tomar (modos "a solicitud" y "automático") */}
            {state.available?.length > 0 && (
                <>
                    <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mt-2">
                        Disponibles para tomar
                    </p>
                    {state.available.map(d => (
                        <div key={d.id} className="glass-card p-3 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <p className="text-sm font-bold text-[var(--color-text)]">#{d.id} · {d.client_name || 'Sin cliente'}</p>
                                <p className="text-xs text-[var(--color-text-muted)] truncate">{d.address}</p>
                            </div>
                            <button onClick={() => take(d)} disabled={busy === d.id}
                                className="px-3 py-2 rounded-lg text-xs font-bold bg-[var(--color-primary)]/15 text-[var(--color-primary)] shrink-0 disabled:opacity-50">
                                <Hand size={13} className="inline mr-1" /> Tomar
                            </button>
                        </div>
                    ))}
                </>
            )}

            {failing && (
                <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="glass-card w-full max-w-sm p-5">
                        <h3 className="text-lg font-bold text-[var(--color-text)] mb-3 flex items-center gap-2">
                            <AlertTriangle className="text-red-400" size={20} /> No pude entregar
                        </h3>
                        <FailReasons onPick={async (reason) => { await act(failing, 'failed', { reason }); setFailing(null); }} />
                        <button onClick={() => setFailing(null)}
                            className="w-full mt-3 py-2.5 rounded-lg border border-[var(--glass-border)] text-[var(--color-text-muted)] font-bold">
                            Cancelar
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// Motivos frecuentes: en la calle es más rápido tocar que escribir.
function FailReasons({ onPick }) {
    const OPTS = ['Nadie en el domicilio', 'Dirección incorrecta', 'El cliente rechazó el pedido', 'No pude contactar al cliente'];
    const [otro, setOtro] = useState('');
    return (
        <div className="space-y-2">
            {OPTS.map(o => (
                <button key={o} onClick={() => onPick(o)}
                    className="w-full text-left px-3 py-2.5 rounded-lg border border-[var(--glass-border)] text-sm text-[var(--color-text)] hover:bg-[var(--glass-bg)]">
                    {o}
                </button>
            ))}
            <div className="flex gap-2">
                <input value={otro} onChange={e => setOtro(e.target.value)} placeholder="Otro motivo…" className="glass-input flex-1" />
                <button onClick={() => otro.trim() && onPick(otro.trim())} disabled={!otro.trim()}
                    className="px-3 rounded-lg bg-red-500 text-white font-bold text-sm disabled:opacity-40">OK</button>
            </div>
        </div>
    );
}
