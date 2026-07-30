import React, { useEffect, useState, useRef } from 'react';
import {
    Bike, MapPin, Phone, Check, X, Navigation, Package, Loader2, Camera,
    Banknote, AlertTriangle, Hand, ChevronLeft, Inbox, CheckCircle2, XCircle, Truck,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { formatCurrency } from '../../utils/formatCurrency';
import { toast } from '../../lib/toast';
import { cn } from '../../lib/utils';

// Modo Repartidor. Menú con 4 tarjetas y, dentro de cada una, los envíos del día
// en ese estado. La ubicación se comparte SOLO mientras hay envíos en curso, cada
// 25 s, y se apaga sola (cuida la batería).
const PING_MS = 25000;

// Las 4 vistas del menú.
const CARDS = [
    { id: 'nuevos', label: 'Pedidos', hint: 'Asignados por aceptar', icon: Inbox, cls: 'text-sky-400 border-sky-500/40 bg-sky-500/10' },
    { id: 'enCurso', label: 'Pendientes', hint: 'Los que estoy repartiendo', icon: Truck, cls: 'text-amber-400 border-amber-500/40 bg-amber-500/10' },
    { id: 'entregados', label: 'Entregados', hint: 'Completados (24 h)', icon: CheckCircle2, cls: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10' },
    { id: 'fallidos', label: 'Fallidos', hint: 'No se pudo (24 h)', icon: XCircle, cls: 'text-red-400 border-red-500/40 bg-red-500/10' },
];

const RECEIVERS = [
    { id: 'cliente', label: 'El cliente' },
    { id: 'familiar', label: 'Un familiar' },
    { id: 'conserje', label: 'Conserje' },
    { id: 'otro', label: 'Otra persona' },
];

export default function CourierMode() {
    const { fetchMyDeliveries, takeDelivery, setDeliveryStatus, pingCourierLocation, currentCurrency } = useStore();

    const [data, setData] = useState({ isCourier: true, nuevos: [], enCurso: [], entregados: [], fallidos: [], available: [], pendingCash: 0 });
    const [loading, setLoading] = useState(true);
    const [view, setView] = useState(null);     // null = menú principal
    const [busy, setBusy] = useState(null);
    const [failing, setFailing] = useState(null);
    const [delivering, setDelivering] = useState(null);
    const timerRef = useRef(null);

    const load = React.useCallback(async () => {
        const r = await fetchMyDeliveries();
        if (r?.success) setData(r);
        setLoading(false);
    }, [fetchMyDeliveries]);

    useEffect(() => {
        load();
        const t = setInterval(load, 20000);
        return () => clearInterval(t);
    }, [load]);

    // Ubicación solo mientras hay envíos en curso.
    const enRuta = (data.enCurso || []).length > 0;
    useEffect(() => {
        if (!enRuta || typeof navigator === 'undefined' || !navigator.geolocation) return;
        const send = () => navigator.geolocation.getCurrentPosition(
            (p) => pingCourierLocation(p.coords.latitude, p.coords.longitude),
            () => { /* sin permiso: se ignora */ },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 20000 }
        );
        send();
        timerRef.current = setInterval(send, PING_MS);
        return () => { clearInterval(timerRef.current); timerRef.current = null; };
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

    /**
     * Navegar. ANTES de retirar el destino es el LOCAL (hay que ir a buscar el
     * pedido); después de salir a repartir, la dirección del cliente.
     */
    const navigateTo = (d) => {
        const alLocal = d.status === 'accepted';
        const destino = alLocal
            ? (data.pickupAddress || data.pickupName)
            : (d.lat != null && d.lng != null ? `${d.lat},${d.lng}` : d.address);
        if (!destino) { toast('No hay dirección para navegar', 'error'); return; }
        window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destino)}&travelmode=driving`, '_blank');
    };

    if (loading) {
        return <div className="h-full flex items-center justify-center text-[var(--color-text-muted)] gap-2">
            <Loader2 className="animate-spin" size={20} /> Cargando…
        </div>;
    }

    if (!data.isCourier) {
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

    const counts = {
        nuevos: (data.nuevos || []).length,
        enCurso: (data.enCurso || []).length,
        entregados: (data.entregados || []).length,
        fallidos: (data.fallidos || []).length,
    };

    // ── Menú principal ──────────────────────────────────────────────────────
    if (!view) {
        return (
            <div className="h-full flex flex-col gap-4 p-4 overflow-y-auto">
                <div>
                    <h1 className="text-xl font-bold text-[var(--color-text)] flex items-center gap-2">
                        <Bike className="text-[var(--color-primary)]" /> {data.me?.name || 'Repartidor'}
                    </h1>
                    {enRuta && (
                        <p className="text-[11px] text-emerald-400 flex items-center gap-1 mt-0.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse inline-block" />
                            Compartiendo ubicación
                        </p>
                    )}
                </div>

                {data.pendingCash > 0 && (
                    <div className="glass-card p-3 flex items-center justify-between border border-amber-500/30 bg-amber-500/5">
                        <span className="text-sm text-amber-400 flex items-center gap-2">
                            <Banknote size={16} /> Recaudado por rendir
                        </span>
                        <span className="font-black text-amber-400">{formatCurrency(data.pendingCash, currentCurrency)}</span>
                    </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                    {CARDS.map(({ id, label, hint, icon: Icon, cls }) => (
                        <button key={id} onClick={() => setView(id)}
                            className={cn('p-4 rounded-2xl border text-left transition-all active:scale-95', cls)}>
                            <div className="flex items-start justify-between">
                                <Icon size={22} />
                                <span className="text-3xl font-black leading-none">{counts[id]}</span>
                            </div>
                            <p className="font-bold mt-2">{label}</p>
                            <p className="text-[11px] opacity-70 leading-tight">{hint}</p>
                        </button>
                    ))}
                </div>

                {/* Disponibles para tomar (modos "a solicitud" y "automático") */}
                {data.available?.length > 0 && (
                    <div className="glass-card p-3">
                        <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">
                            Disponibles para tomar
                        </p>
                        <div className="space-y-2">
                            {data.available.map(d => (
                                <div key={d.id} className="flex items-center justify-between gap-3 p-2 rounded-lg bg-[var(--glass-bg)]">
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
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // ── Detalle de una vista ────────────────────────────────────────────────
    const card = CARDS.find(c => c.id === view);
    const list = data[view] || [];

    return (
        <div className="h-full flex flex-col gap-3 p-4 overflow-y-auto">
            <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => setView(null)}
                    className="p-2 rounded-xl border border-[var(--glass-border)] text-[var(--color-text)]">
                    <ChevronLeft size={18} />
                </button>
                <h1 className="text-lg font-bold text-[var(--color-text)]">
                    {card?.label} <span className="text-sm font-normal text-[var(--color-text-muted)]">({list.length})</span>
                </h1>
            </div>

            {list.length === 0 ? (
                <div className="glass-card p-8 flex flex-col items-center gap-2 text-[var(--color-text-muted)]">
                    <Package size={40} className="opacity-20" />
                    <p className="text-sm text-center">No hay pedidos en este estado.</p>
                </div>
            ) : list.map(d => (
                <OrderCard
                    key={d.id} d={d} view={view} busy={busy === d.id} currency={currentCurrency}
                    pickupName={data.pickupName}
                    onAccept={() => act(d, 'accepted')}
                    onPickedUp={() => act(d, 'picked_up')}
                    onRoute={() => act(d, 'on_route')}
                    onNavigate={() => navigateTo(d)}
                    onDeliver={() => setDelivering(d)}
                    onFail={() => setFailing(d)}
                />
            ))}

            {failing && (
                <FailModal onClose={() => setFailing(null)}
                    onPick={async (reason) => { await act(failing, 'failed', { reason }); setFailing(null); }} />
            )}
            {delivering && (
                <DeliverModal d={delivering} currency={currentCurrency} onClose={() => setDelivering(null)}
                    onConfirm={async (extra) => { await act(delivering, 'delivered', extra); setDelivering(null); }} />
            )}
        </div>
    );
}

// ── Tarjeta de un envío ─────────────────────────────────────────────────────
function OrderCard({ d, view, busy, currency, pickupName, onAccept, onPickedUp, onRoute, onNavigate, onDeliver, onFail }) {
    const cobra = Number(d.amount_to_collect) > 0;
    const cerrado = ['delivered', 'failed'].includes(d.status);
    const alLocal = d.status === 'accepted';

    const badge = {
        assigned: { t: 'ASIGNADO', c: 'text-sky-400 border-sky-500/30 bg-sky-500/10' },
        accepted: { t: 'ACEPTADO', c: 'text-indigo-400 border-indigo-500/30 bg-indigo-500/10' },
        picked_up: { t: 'RETIRADO', c: 'text-violet-400 border-violet-500/30 bg-violet-500/10' },
        on_route: { t: 'EN RUTA', c: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10' },
        delivered: { t: 'ENTREGADO', c: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' },
        failed: { t: 'NO ENTREGADO', c: 'text-red-400 border-red-500/30 bg-red-500/10' },
    }[d.status] || { t: d.status, c: '' };

    return (
        <div className="glass-card p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <p className="font-bold text-[var(--color-text)]">#{d.id}</p>
                    <p className="text-sm text-[var(--color-text)]">{d.client_name || 'Sin cliente'}</p>
                </div>
                <span className={cn('text-[10px] font-bold px-2 py-1 rounded-full border shrink-0', badge.c)}>{badge.t}</span>
            </div>

            <p className="text-sm text-[var(--color-text-muted)] flex items-start gap-1.5">
                <MapPin size={14} className="shrink-0 mt-0.5" />
                <span>{d.address}{d.address_notes ? ` · ${d.address_notes}` : ''}</span>
            </p>
            {d.client_phone && !cerrado && (
                <a href={`tel:${d.client_phone}`} className="text-sm text-[var(--color-primary)] flex items-center gap-1.5">
                    <Phone size={14} /> {d.client_phone}
                </a>
            )}
            <p className={cn('text-sm font-bold flex items-center gap-1.5', cobra ? 'text-amber-400' : 'text-emerald-400')}>
                <Banknote size={14} />
                {cobra ? `Cobrar ${formatCurrency(d.amount_to_collect, currency)}` : 'Ya pagado'}
            </p>

            {/* Cerrados: solo se muestra el resultado */}
            {cerrado ? (
                <div className="pt-2 border-t border-[var(--glass-border)] text-xs text-[var(--color-text-muted)] space-y-1">
                    {d.status === 'delivered' && d.received_by_kind && (
                        <p>Recibió: <strong className="text-[var(--color-text)]">
                            {d.received_by || RECEIVERS.find(r => r.id === d.received_by_kind)?.label}
                        </strong></p>
                    )}
                    {d.status === 'failed' && d.failed_reason && <p className="text-red-400 italic">{d.failed_reason}</p>}
                    {d.proof_photo && (
                        <img src={d.proof_photo} alt="Constancia" className="mt-2 rounded-lg max-h-32 object-cover" />
                    )}
                </div>
            ) : (
                <div className="space-y-2 pt-2 border-t border-[var(--glass-border)]">
                    {/* Aviso de a dónde navega ahora */}
                    {alLocal && (
                        <p className="text-[11px] text-indigo-300 flex items-center gap-1">
                            <Navigation size={11} /> Vas a buscar el pedido a {pickupName || 'el local'}
                        </p>
                    )}

                    {view === 'nuevos' ? (
                        <button onClick={onAccept} disabled={busy}
                            className="w-full py-3 rounded-xl font-bold bg-sky-500/15 text-sky-300 border border-sky-500/30 disabled:opacity-50">
                            <Check size={16} className="inline mr-1" /> Aceptar pedido
                        </button>
                    ) : (
                        <>
                            <div className="grid grid-cols-2 gap-2">
                                {/* El botón de navegar se apaga cuando ya se entregó */}
                                <button onClick={onNavigate}
                                    className="py-3 rounded-xl font-bold bg-[var(--color-primary)]/15 text-[var(--color-primary)] border border-[var(--color-primary)]/30">
                                    <Navigation size={16} className="inline mr-1" /> Navegar
                                </button>
                                {d.status === 'accepted' && (
                                    <button onClick={onPickedUp} disabled={busy}
                                        className="py-3 rounded-xl font-bold bg-violet-500/15 text-violet-300 border border-violet-500/30 disabled:opacity-50">
                                        Retiré
                                    </button>
                                )}
                                {d.status === 'picked_up' && (
                                    <button onClick={onRoute} disabled={busy}
                                        className="py-3 rounded-xl font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 disabled:opacity-50">
                                        Salí a repartir
                                    </button>
                                )}
                                {d.status === 'on_route' && (
                                    <button onClick={onDeliver} disabled={busy}
                                        className="py-3 rounded-xl font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 disabled:opacity-50">
                                        <Check size={16} className="inline mr-1" /> Entregar
                                    </button>
                                )}
                            </div>
                            <button onClick={onFail}
                                className="w-full py-2.5 rounded-xl text-sm font-bold text-red-400 border border-red-500/30">
                                <X size={14} className="inline mr-1" /> No pude entregar
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Modal de entrega: quién recibió + foto ──────────────────────────────────
function DeliverModal({ d, currency, onClose, onConfirm }) {
    const [kind, setKind] = useState('cliente');
    const [name, setName] = useState('');
    const [photo, setPhoto] = useState(null);
    const [saving, setSaving] = useState(false);
    const fileRef = useRef(null);

    // La foto se comprime en el celular antes de subirla: una foto de cámara pesa
    // varios MB y no tiene sentido guardarla así.
    const onPick = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                const max = 900;
                const escala = Math.min(1, max / Math.max(img.width, img.height));
                const cv = document.createElement('canvas');
                cv.width = Math.round(img.width * escala);
                cv.height = Math.round(img.height * escala);
                cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
                setPhoto(cv.toDataURL('image/jpeg', 0.6));
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    };

    const puedeConfirmar = kind !== 'otro' || name.trim().length > 1;

    const confirm = async () => {
        setSaving(true);
        await onConfirm({
            receivedByKind: kind,
            receivedBy: kind === 'otro' ? name.trim() : (RECEIVERS.find(r => r.id === kind)?.label || null),
            proofPhoto: photo,
            collectedMethod: Number(d.amount_to_collect) > 0 ? 'Efectivo' : null,
        });
        setSaving(false);
    };

    return (
        <div className="fixed inset-0 z-[9999] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-3">
            <div className="glass-card w-full max-w-md p-5 max-h-full overflow-y-auto">
                <div className="flex items-center justify-between mb-1">
                    <h3 className="text-lg font-bold text-[var(--color-text)] flex items-center gap-2">
                        <Check className="text-emerald-400" size={20} /> Confirmar entrega
                    </h3>
                    <button onClick={onClose} className="text-[var(--color-text-muted)]"><X size={20} /></button>
                </div>
                <p className="text-sm text-[var(--color-text-muted)] mb-4">#{d.id} · {d.client_name}</p>

                {Number(d.amount_to_collect) > 0 && (
                    <div className="mb-4 p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 flex items-center justify-between">
                        <span className="text-sm text-amber-400 font-bold">Cobrar en efectivo</span>
                        <span className="font-black text-amber-400">{formatCurrency(d.amount_to_collect, currency)}</span>
                    </div>
                )}

                <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">¿Quién recibió?</p>
                <div className="grid grid-cols-2 gap-2 mb-3">
                    {RECEIVERS.map(r => (
                        <button key={r.id} onClick={() => setKind(r.id)}
                            className={cn('py-2.5 rounded-lg text-sm font-bold border transition-all',
                                kind === r.id
                                    ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                                    : 'border-[var(--glass-border)] text-[var(--color-text-muted)]')}>
                            {r.label}
                        </button>
                    ))}
                </div>
                {kind === 'otro' && (
                    <input value={name} onChange={e => setName(e.target.value)} autoFocus
                        className="glass-input w-full mb-3" placeholder="Nombre de quien recibió" />
                )}

                {/* Foto de constancia */}
                <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">Foto (opcional)</p>
                <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPick} className="hidden" />
                {photo ? (
                    <div className="relative mb-4">
                        <img src={photo} alt="Constancia" className="w-full rounded-xl max-h-48 object-cover" />
                        <button onClick={() => setPhoto(null)}
                            className="absolute top-2 right-2 p-1.5 rounded-full bg-black/70 text-white">
                            <X size={14} />
                        </button>
                    </div>
                ) : (
                    <button onClick={() => fileRef.current?.click()}
                        className="w-full py-4 mb-4 rounded-xl border-2 border-dashed border-[var(--glass-border)] text-[var(--color-text-muted)] flex flex-col items-center gap-1">
                        <Camera size={26} />
                        <span className="text-sm font-bold">Tomar foto del pedido</span>
                    </button>
                )}

                <div className="flex gap-3">
                    <button onClick={onClose}
                        className="flex-1 py-3 rounded-xl border border-[var(--glass-border)] text-[var(--color-text-muted)] font-bold">
                        Cancelar
                    </button>
                    <button onClick={confirm} disabled={saving || !puedeConfirmar}
                        className="flex-1 py-3 rounded-xl bg-emerald-500 text-black font-bold disabled:opacity-40">
                        {saving ? 'Guardando…' : 'Entregado'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function FailModal({ onClose, onPick }) {
    const OPTS = ['Nadie en el domicilio', 'Dirección incorrecta', 'El cliente rechazó el pedido', 'No pude contactar al cliente'];
    const [otro, setOtro] = useState('');
    return (
        <div className="fixed inset-0 z-[9999] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="glass-card w-full max-w-sm p-5">
                <h3 className="text-lg font-bold text-[var(--color-text)] mb-3 flex items-center gap-2">
                    <AlertTriangle className="text-red-400" size={20} /> No pude entregar
                </h3>
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
                <button onClick={onClose}
                    className="w-full mt-3 py-2.5 rounded-lg border border-[var(--glass-border)] text-[var(--color-text-muted)] font-bold">
                    Cancelar
                </button>
            </div>
        </div>
    );
}
