import React, { useEffect, useState, useMemo } from 'react';
import {
    Truck, Plus, MapPin, Phone, Banknote, Clock, Check, X, Loader2,
    AlertTriangle, Package, Navigation,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { formatCurrency } from '../../utils/formatCurrency';
import { usePermissions } from '../../hooks/usePermissions';
import { toast } from '../../lib/toast';
import { cn } from '../../lib/utils';

// Columnas del tablero (mismo orden que el flujo del envío).
const COLS = [
    { id: 'pending', label: 'Pendientes', cls: 'text-amber-400 border-amber-500/30 bg-amber-500/5' },
    { id: 'assigned', label: 'Asignados', cls: 'text-sky-400 border-sky-500/30 bg-sky-500/5' },
    { id: 'accepted', label: 'Aceptados', cls: 'text-indigo-400 border-indigo-500/30 bg-indigo-500/5' },
    { id: 'picked_up', label: 'Retirados', cls: 'text-violet-400 border-violet-500/30 bg-violet-500/5' },
    { id: 'on_route', label: 'En ruta', cls: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/5' },
    { id: 'delivered', label: 'Entregados', cls: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/5' },
];

const SOURCE_LABEL = { preorder: 'Pedido', sale: 'Venta', manual: 'Manual' };

const sinceText = (iso) => {
    if (!iso) return '';
    const m = Math.floor((Date.now() - new Date(iso)) / 60000);
    if (m < 1) return 'recién';
    if (m < 60) return `hace ${m} min`;
    const h = Math.floor(m / 60);
    return `hace ${h} h`;
};

// Delivery → Envíos. Una sola bandeja para pedidos de tienda, encargos y ventas
// del POS marcadas para despacho.
export default function Shipments() {
    const {
        deliveries, deliveryCounts, deliveryAssignMode, couriers, currentCurrency,
        fetchDeliveryBoard, fetchCouriers, assignDelivery, setDeliveryStatus,
        createDelivery, fetchImportableOrders, saveDeliverySettings,
    } = useStore();
    const { can } = usePermissions();

    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('all');
    const [showNew, setShowNew] = useState(false);
    const [importables, setImportables] = useState([]);
    const [failing, setFailing] = useState(null);   // envío al que se le marca "no entregado"

    const load = React.useCallback(async () => {
        await Promise.all([fetchDeliveryBoard(), fetchCouriers()]);
        const imp = await fetchImportableOrders();
        setImportables(imp?.orders || []);
        setLoading(false);
    }, [fetchDeliveryBoard, fetchCouriers, fetchImportableOrders]);

    useEffect(() => {
        load();
        // Refresco periódico: el tablero cambia desde el celular del repartidor.
        const t = setInterval(load, 30000);
        return () => clearInterval(t);
    }, [load]);

    const shown = useMemo(
        () => (filter === 'all' ? deliveries : deliveries.filter(d => d.status === filter)),
        [deliveries, filter]
    );
    const activeCouriers = useMemo(() => couriers.filter(c => c.active), [couriers]);

    const assign = async (d, courierId) => {
        const r = await assignDelivery(d.id, courierId ? Number(courierId) : null);
        if (!r?.success) toast(r?.error || 'No se pudo asignar', 'error');
    };

    const advance = async (d, status, extra) => {
        const r = await setDeliveryStatus(d.id, status, extra);
        if (!r?.success) toast(r?.error || 'No se pudo actualizar', 'error');
    };

    // Pasa un pedido existente (encargo / tienda) a la bandeja de envíos.
    const importOrder = async (o) => {
        const r = await createDelivery({
            sourceType: 'preorder', sourceId: o.id,
            clientName: o.client_name, clientPhone: o.client_phone,
            address: o.delivery_address || '',
            amountToCollect: Number(o.remaining) || 0,
            deliveryFee: Number(o.delivery_fee) || 0,
        });
        if (r?.success) { toast('Envío creado', 'success'); load(); }
        else toast(r?.error || 'No se pudo crear el envío', 'error');
    };

    return (
        <div className="h-full flex flex-col gap-4 p-4 lg:p-6 overflow-y-auto">
            {/* Encabezado */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 shrink-0">
                <div>
                    <h1 className="text-xl lg:text-2xl font-bold text-[var(--color-text)] flex items-center gap-2">
                        <Truck className="text-[var(--color-primary)]" /> Envíos
                    </h1>
                    <p className="text-[var(--color-text-muted)] text-xs lg:text-sm">
                        Pedidos de tienda, encargos y ventas a domicilio en una sola bandeja.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {can('delivery.assign') && (
                        <select value={deliveryAssignMode} onChange={e => saveDeliverySettings(e.target.value)}
                            className="glass-input !py-2 text-sm" title="Cómo se asignan los envíos">
                            <option value="manual">Asignación manual</option>
                            <option value="request">El repartidor lo toma</option>
                            <option value="auto">Automática</option>
                        </select>
                    )}
                    {can('delivery.assign') && (
                        <button onClick={() => setShowNew(true)}
                            className="btn-primary px-4 py-2.5 rounded-xl font-bold flex items-center gap-2 shrink-0">
                            <Plus size={18} /> Nuevo envío
                        </button>
                    )}
                </div>
            </div>

            {/* Pedidos que aún no están en envíos */}
            {importables.length > 0 && can('delivery.assign') && (
                <div className="glass-card p-4 border border-amber-500/30 bg-amber-500/5">
                    <p className="text-sm font-bold text-amber-400 flex items-center gap-2 mb-3">
                        <AlertTriangle size={15} /> {importables.length} pedido(s) a domicilio sin envío
                    </p>
                    <div className="space-y-2">
                        {importables.map(o => (
                            <div key={o.id} className="flex items-center justify-between gap-3 p-2 rounded-lg bg-[var(--glass-bg)]">
                                <div className="min-w-0">
                                    <p className="text-sm text-[var(--color-text)] truncate">
                                        #{o.id} · {o.client_name || 'Sin cliente'}
                                    </p>
                                    <p className="text-[11px] text-[var(--color-text-muted)] truncate">{o.delivery_address || 'Sin dirección'}</p>
                                </div>
                                <button onClick={() => importOrder(o)}
                                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[var(--color-primary)]/15 text-[var(--color-primary)] shrink-0">
                                    Pasar a envío
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Contadores por estado */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 shrink-0">
                <button onClick={() => setFilter('all')}
                    className={cn('p-3 rounded-xl border text-left transition-all',
                        filter === 'all' ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10' : 'border-[var(--glass-border)] bg-[var(--glass-bg)]')}>
                    <p className="text-lg font-black text-[var(--color-text)]">{deliveries.length}</p>
                    <p className="text-[11px] text-[var(--color-text-muted)]">Todos</p>
                </button>
                {COLS.map(c => (
                    <button key={c.id} onClick={() => setFilter(c.id)}
                        className={cn('p-3 rounded-xl border text-left transition-all',
                            filter === c.id ? c.cls : 'border-[var(--glass-border)] bg-[var(--glass-bg)]')}>
                        <p className={cn('text-lg font-black', filter === c.id ? '' : 'text-[var(--color-text)]')}>
                            {deliveryCounts[c.id] || 0}
                        </p>
                        <p className="text-[11px] text-[var(--color-text-muted)]">{c.label}</p>
                    </button>
                ))}
            </div>

            {/* Lista */}
            {loading ? (
                <div className="flex items-center justify-center py-16 text-[var(--color-text-muted)]">
                    <Loader2 className="animate-spin mr-2" size={20} /> Cargando…
                </div>
            ) : shown.length === 0 ? (
                <div className="glass-card p-10 flex flex-col items-center gap-3 text-[var(--color-text-muted)]">
                    <Package size={48} className="opacity-20" />
                    <p>No hay envíos {filter !== 'all' ? 'en este estado' : 'todavía'}.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {shown.map(d => {
                        const col = COLS.find(c => c.id === d.status);
                        // Si el pedido ya se cobró en el local, el repartidor no cobra
                        // (y no habrá nada que rendir): se avisa para evitar confusión.
                        const yaCobrado = d.pendiente_real != null && Number(d.pendiente_real) <= 0;
                        const cobra = Number(d.amount_to_collect) > 0 && !yaCobrado;
                        return (
                            <div key={d.id} className="glass-card p-4 space-y-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="font-bold text-[var(--color-text)]">
                                            #{d.id} <span className="text-xs font-normal text-[var(--color-text-muted)]">
                                                · {SOURCE_LABEL[d.source_type] || d.source_type}
                                                {d.source_id ? ` #${d.source_id}` : ''}
                                            </span>
                                        </p>
                                        <p className="text-sm text-[var(--color-text)]">{d.client_name || 'Sin cliente'}</p>
                                        {d.client_phone && (
                                            <a href={`tel:${d.client_phone}`} className="text-xs text-[var(--color-text-muted)] flex items-center gap-1 hover:text-[var(--color-primary)]">
                                                <Phone size={11} /> {d.client_phone}
                                            </a>
                                        )}
                                    </div>
                                    <div className="text-right shrink-0">
                                        <span className={cn('text-[10px] font-bold px-2 py-1 rounded-full border', col?.cls || '')}>
                                            {col?.label || d.status}
                                        </span>
                                        <p className="text-[11px] text-[var(--color-text-muted)] mt-1 flex items-center gap-1 justify-end">
                                            <Clock size={10} /> {sinceText(d.created_at)}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                                    <span className="text-[var(--color-text-muted)] flex items-center gap-1 min-w-0">
                                        <MapPin size={12} className="shrink-0" />
                                        <span className="truncate">{d.address}</span>
                                    </span>
                                    <span className={cn('flex items-center gap-1 font-bold', cobra ? 'text-amber-400' : 'text-emerald-400')}>
                                        <Banknote size={12} />
                                        {cobra
                                            ? `Cobrar ${formatCurrency(d.amount_to_collect, currentCurrency)}`
                                            : (yaCobrado && Number(d.amount_to_collect) > 0 ? 'Ya cobrado en caja' : 'Pagado')}
                                    </span>
                                    {d.courier_name && (
                                        <span className="text-cyan-400 font-medium">🛵 {d.courier_name}</span>
                                    )}
                                </div>

                                {/* Acciones */}
                                {can('delivery.assign') && !['delivered', 'failed', 'canceled'].includes(d.status) && (
                                    <div className="flex flex-wrap gap-2 pt-2 border-t border-[var(--glass-border)]">
                                        {/* Reasignar solo antes del retiro. */}
                                        {['pending', 'assigned'].includes(d.status) && (
                                            <select value={d.courier_id || ''} onChange={e => assign(d, e.target.value)}
                                                className="glass-input !py-1.5 text-xs flex-1 min-w-[140px]">
                                                <option value="">— Sin asignar —</option>
                                                {activeCouriers.map(c => (
                                                    <option key={c.id} value={c.id}>{c.name} ({c.active_count})</option>
                                                ))}
                                            </select>
                                        )}
                                        {/* Solo la acción SIGUIENTE: las etapas no se saltan
                                            (el servidor también lo valida). */}
                                        {d.status === 'accepted' && (
                                            <button onClick={() => advance(d, 'picked_up')}
                                                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-violet-500/10 text-violet-400 border border-violet-500/30">
                                                Retirado
                                            </button>
                                        )}
                                        {d.status === 'picked_up' && (
                                            <button onClick={() => advance(d, 'on_route')}
                                                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                                                <Navigation size={12} className="inline mr-1" /> En ruta
                                            </button>
                                        )}
                                        {d.status === 'on_route' && (
                                            <button onClick={() => advance(d, 'delivered')}
                                                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                                                <Check size={12} className="inline mr-1" /> Entregado
                                            </button>
                                        )}
                                        {['assigned', 'accepted', 'picked_up', 'on_route'].includes(d.status) && (
                                            <button onClick={() => setFailing(d)}
                                                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-500/10 text-red-400 border border-red-500/30">
                                                <X size={12} className="inline mr-1" /> No entregado
                                            </button>
                                        )}
                                    </div>
                                )}
                                {d.status === 'failed' && d.failed_reason && (
                                    <p className="text-xs text-red-400 italic">Motivo: {d.failed_reason}</p>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {showNew && <NewDeliveryModal onClose={() => setShowNew(false)} onSaved={load} />}
            {failing && (
                <FailModal d={failing} onClose={() => setFailing(null)}
                    onConfirm={async (reason) => { await advance(failing, 'failed', { reason }); setFailing(null); }} />
            )}
        </div>
    );
}

// Envío manual (p. ej. una venta del mostrador que se manda a domicilio).
function NewDeliveryModal({ onClose, onSaved }) {
    const { createDelivery } = useStore();
    const [f, setF] = useState({ clientName: '', clientPhone: '', address: '', addressNotes: '', amountToCollect: '', deliveryFee: '', notes: '' });
    const [saving, setSaving] = useState(false);

    const submit = async (e) => {
        e.preventDefault();
        setSaving(true);
        const r = await createDelivery({
            sourceType: 'manual',
            clientName: f.clientName, clientPhone: f.clientPhone,
            address: f.address, addressNotes: f.addressNotes,
            amountToCollect: Number(f.amountToCollect) || 0,
            deliveryFee: Number(f.deliveryFee) || 0,
            notes: f.notes,
        });
        setSaving(false);
        if (r?.success) { toast('Envío creado', 'success'); onSaved?.(); onClose(); }
        else toast(r?.error || 'No se pudo crear', 'error');
    };

    return (
        <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <form onSubmit={submit} className="glass-card w-full max-w-md p-6 max-h-full overflow-y-auto relative">
                <button type="button" onClick={onClose} className="absolute top-4 right-4 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                    <X size={20} />
                </button>
                <h2 className="text-xl font-bold text-[var(--color-text)] mb-5 flex items-center gap-2">
                    <Truck className="text-[var(--color-primary)]" size={20} /> Nuevo envío
                </h2>
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-sm text-[var(--color-text-muted)]">Cliente</label>
                            <input value={f.clientName} onChange={e => setF({ ...f, clientName: e.target.value })} className="glass-input w-full mt-1" />
                        </div>
                        <div>
                            <label className="text-sm text-[var(--color-text-muted)]">Teléfono</label>
                            <input value={f.clientPhone} onChange={e => setF({ ...f, clientPhone: e.target.value })} className="glass-input w-full mt-1" placeholder="+569…" />
                        </div>
                    </div>
                    <div>
                        <label className="text-sm text-[var(--color-text-muted)]">Dirección *</label>
                        <input required value={f.address} onChange={e => setF({ ...f, address: e.target.value })}
                            className="glass-input w-full mt-1" placeholder="Calle, número, comuna" />
                    </div>
                    <div>
                        <label className="text-sm text-[var(--color-text-muted)]">Referencia</label>
                        <input value={f.addressNotes} onChange={e => setF({ ...f, addressNotes: e.target.value })}
                            className="glass-input w-full mt-1" placeholder="Casa azul, portón negro…" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-sm text-[var(--color-text-muted)]">Cobrar al entregar</label>
                            <input type="number" inputMode="decimal" value={f.amountToCollect}
                                onChange={e => setF({ ...f, amountToCollect: e.target.value })}
                                className="glass-input w-full mt-1" placeholder="0 = ya pagado" />
                        </div>
                        <div>
                            <label className="text-sm text-[var(--color-text-muted)]">Costo de envío</label>
                            <input type="number" inputMode="decimal" value={f.deliveryFee}
                                onChange={e => setF({ ...f, deliveryFee: e.target.value })} className="glass-input w-full mt-1" placeholder="0" />
                        </div>
                    </div>
                </div>
                <div className="flex gap-3 mt-6">
                    <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-[var(--glass-border)] text-[var(--color-text-muted)] font-bold">
                        Cancelar
                    </button>
                    <button type="submit" disabled={saving} className="flex-1 btn-primary py-2.5 rounded-lg font-bold disabled:opacity-50">
                        {saving ? 'Creando…' : 'Crear envío'}
                    </button>
                </div>
            </form>
        </div>
    );
}

function FailModal({ d, onClose, onConfirm }) {
    const [reason, setReason] = useState('');
    return (
        <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="glass-card w-full max-w-sm p-6">
                <h3 className="text-lg font-bold text-[var(--color-text)] mb-3 flex items-center gap-2">
                    <AlertTriangle className="text-red-400" size={20} /> No entregado
                </h3>
                <p className="text-sm text-[var(--color-text-muted)] mb-3">Envío #{d.id} · {d.client_name}</p>
                <textarea value={reason} onChange={e => setReason(e.target.value)} autoFocus
                    className="glass-input w-full h-24 resize-none" placeholder="Motivo: nadie en casa, dirección incorrecta…" />
                <div className="flex gap-3 mt-4">
                    <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-[var(--glass-border)] text-[var(--color-text-muted)] font-bold">
                        Cancelar
                    </button>
                    <button onClick={() => onConfirm(reason)} disabled={!reason.trim()}
                        className="flex-1 py-2.5 rounded-lg bg-red-500 text-white font-bold disabled:opacity-50">
                        Confirmar
                    </button>
                </div>
            </div>
        </div>
    );
}
