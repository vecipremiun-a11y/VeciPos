import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ShoppingCart, CakeSlice, Store, Clock, Package, Check, Truck, X, User,
    Phone, MapPin, ArrowRight, RefreshCw, ClipboardList, CreditCard, ThumbsUp
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';
import { formatCurrency } from '../utils/formatCurrency';
import PaymentDetailPicker from '../components/PaymentDetailPicker';

// Flujo de pedidos de la tienda web (pagados online): incluye el paso
// "Confirmado" (aceptar el pedido) y entrega SIN checkout — solo estado.
const STATUS_CONFIG = {
    pending: { label: 'Pendiente', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', icon: Clock, next: 'confirmed' },
    confirmed: { label: 'Confirmado', color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30', icon: ThumbsUp, next: 'preparing' },
    preparing: { label: 'Preparando', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', icon: Package, next: 'ready' },
    ready: { label: 'Listo', color: 'bg-green-500/20 text-green-400 border-green-500/30', icon: Check, next: 'delivered' },
    delivered: { label: 'Entregado', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', icon: Truck, next: null },
    canceled: { label: 'Cancelado', color: 'bg-red-500/20 text-red-400 border-red-500/30', icon: X, next: null },
};

const STATUS_NEXT_LABEL = {
    pending: 'Confirmar',
    confirmed: 'Preparar',
    preparing: 'Marcar Listo',
    ready: 'Entregar',
};

// Cobro contra entrega: registra el pago del saldo (efectivo cuadra en caja,
// tarjeta/transferencia con su detalle) y el backend auto-marca 'delivered'.
function CodChargeModal({ order, onClose, onCharged, currentCurrency }) {
    const [method, setMethod] = useState('Efectivo');
    const [terminalId, setTerminalId] = useState(null);
    const [bankAccountId, setBankAccountId] = useState(null);
    const [saving, setSaving] = useState(false);
    const amount = Number(order.remaining_amount) || 0;

    const charge = async () => {
        setSaving(true);
        const ok = await onCharged(order, amount, method, { terminalId, bankAccountId });
        setSaving(false);
        if (ok) onClose();
    };

    return (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
            <div className="glass-card w-full max-w-sm p-0 overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b border-[var(--glass-border)] flex items-center justify-between">
                    <h3 className="font-bold text-sm text-[var(--color-text)]">Cobrar y entregar #{order.external_public_code || order.id}</h3>
                    <button onClick={onClose} className="p-1 rounded-full hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)]"><X size={16} /></button>
                </div>
                <div className="p-4 space-y-4">
                    <div className="text-center">
                        <p className="text-xs text-[var(--color-text-muted)]">Monto a cobrar (contra entrega)</p>
                        <p className="text-3xl font-bold text-[var(--color-primary)]">{formatCurrency(amount, currentCurrency)}</p>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        {['Efectivo', 'Tarjeta', 'Transferencia'].map(m => (
                            <button key={m} onClick={() => setMethod(m)}
                                className={cn('py-2 rounded-lg text-xs font-bold border transition-all',
                                    method === m
                                        ? 'bg-[var(--color-primary)] text-black border-[var(--color-primary)]'
                                        : 'bg-[var(--glass-bg)] text-[var(--color-text-muted)] border-[var(--glass-border)]'
                                )}>
                                {m}
                            </button>
                        ))}
                    </div>
                    <PaymentDetailPicker
                        method={method}
                        terminalId={terminalId}
                        bankAccountId={bankAccountId}
                        onChange={({ terminalId: t, bankAccountId: b }) => {
                            if (t !== undefined) setTerminalId(t);
                            if (b !== undefined) setBankAccountId(b);
                        }}
                    />
                </div>
                <div className="p-4 border-t border-[var(--glass-border)] flex justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg border border-[var(--glass-border)] text-[var(--color-text)] text-sm">Cancelar</button>
                    <button onClick={charge} disabled={saving}
                        className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-black font-bold text-sm disabled:opacity-50">
                        {saving ? 'Registrando…' : 'Cobrar y entregar'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// Modal de detalle liviano: pedido pagado online — sin cobro de saldo.
function StoreOrderDetailModal({ order, onClose, onStatusChange, currentCurrency }) {
    const { getPreorderDetails } = useStore();
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const config = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
    const StatusIcon = config.icon;

    useEffect(() => {
        let alive = true;
        getPreorderDetails(order.id).then(result => {
            if (alive && result?.success) setItems(result.items || []);
            if (alive) setLoading(false);
        });
        return () => { alive = false; };
    }, [order.id, getPreorderDetails]);

    return (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
            <div className="glass-card w-full max-w-lg max-h-[90vh] overflow-y-auto p-0" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b border-[var(--glass-border)] flex items-center justify-between sticky top-0 bg-[var(--color-background)] z-10">
                    <div className="flex items-center gap-3">
                        <div className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-bold', config.color)}>
                            <StatusIcon size={12} /> {config.label}
                        </div>
                        <span className="font-bold text-[var(--color-text)]">#{order.external_public_code || order.id}</span>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-full hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)]">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-4 space-y-4">
                    {/* Cliente y entrega */}
                    <div className="space-y-1.5 text-sm">
                        <p className="font-bold text-[var(--color-text)] flex items-center gap-2">
                            <User size={14} className="text-[var(--color-primary)]" /> {order.client_name || 'Cliente web'}
                        </p>
                        {order.client_phone && (
                            <p className="text-[var(--color-text-muted)] flex items-center gap-2"><Phone size={12} /> {order.client_phone}</p>
                        )}
                        {order.delivery_type === 'delivery' && order.delivery_address && (
                            <p className="text-[var(--color-text-muted)] flex items-center gap-2"><MapPin size={12} /> {order.delivery_address}</p>
                        )}
                        <p className="text-[var(--color-text-muted)] flex items-center gap-2">
                            <Clock size={12} /> Pedido: {order.due_date} {order.due_time}
                            {order.delivery_type === 'delivery' ? ' · Despacho' : ' · Retiro en tienda'}
                        </p>
                        {Number(order.remaining_amount) > 0 ? (
                            <p className="text-orange-400 flex items-center gap-2 font-medium">
                                <CreditCard size={12} /> Contra entrega · por cobrar {formatCurrency(order.remaining_amount, currentCurrency)}
                            </p>
                        ) : (
                            <p className="text-green-400 flex items-center gap-2 font-medium">
                                <CreditCard size={12} /> Pagado online{order.payment_method ? ` · ${order.payment_method}` : ''}
                            </p>
                        )}
                        {order.notes && <p className="text-xs text-[var(--color-text-muted)] italic">"{order.notes}"</p>}
                    </div>

                    {/* Items */}
                    <div className="border border-[var(--glass-border)] rounded-lg overflow-hidden">
                        {loading ? (
                            <p className="p-4 text-center text-sm text-[var(--color-text-muted)]">Cargando detalle…</p>
                        ) : (
                            <div className="divide-y divide-[var(--glass-border)]">
                                {items.map(item => (
                                    <div key={item.id} className="p-3 flex justify-between items-center text-sm">
                                        <div>
                                            <p className="text-[var(--color-text)] font-medium">{item.product_name}</p>
                                            <p className="text-xs text-[var(--color-text-muted)]">
                                                {item.qty} {item.unit || 'Und'} × {formatCurrency(item.unit_price, currentCurrency)}
                                            </p>
                                            {item.note && <p className="text-xs text-amber-400">{item.note}</p>}
                                        </div>
                                        <strong className="text-[var(--color-text)]">{formatCurrency(item.line_total, currentCurrency)}</strong>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="flex justify-between items-center text-sm">
                        {Number(order.delivery_fee) > 0 && (
                            <span className="text-[var(--color-text-muted)]">Despacho: {formatCurrency(order.delivery_fee, currentCurrency)}</span>
                        )}
                        <span className="ml-auto text-lg font-bold text-[var(--color-text)]">
                            Total {formatCurrency(order.total_amount, currentCurrency)}
                        </span>
                    </div>
                </div>

                {/* Acciones */}
                {(config.next || (order.status !== 'canceled' && order.status !== 'delivered')) && (
                    <div className="p-4 border-t border-[var(--glass-border)] flex gap-2">
                        {order.status !== 'canceled' && order.status !== 'delivered' && (
                            <button
                                onClick={() => onStatusChange(order.id, 'canceled')}
                                className="px-4 py-2.5 rounded-lg text-xs font-bold bg-red-500/15 text-red-400 border border-red-500/30"
                            >
                                Cancelar pedido
                            </button>
                        )}
                        {config.next && (
                            <button
                                onClick={() => onStatusChange(order.id, config.next)}
                                className="flex-1 py-2.5 rounded-lg text-xs font-bold btn-primary flex items-center justify-center gap-1.5"
                            >
                                <ArrowRight size={14} />
                                {order.status === 'ready' && Number(order.remaining_amount) > 0
                                    ? 'Cobrar y Entregar'
                                    : STATUS_NEXT_LABEL[order.status]}
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export default function StoreOrders() {
    const navigate = useNavigate();
    const { preorders, fetchPreorders, updatePreorderStatus, addPreorderPayment, currentCurrency } = useStore();
    const [statusFilter, setStatusFilter] = useState('all');
    const [loading, setLoading] = useState(true);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [codOrder, setCodOrder] = useState(null); // pedido contra entrega en cobro

    // Sin rango de fechas: caen todos los pedidos, ordenados por fecha
    // (el server los devuelve created_at DESC para kind='store').
    const getListFilters = useCallback(() => ({
        kind: 'store',
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
    }), [statusFilter]);

    const load = useCallback(async () => {
        setLoading(true);
        await fetchPreorders(getListFilters());
        setLoading(false);
    }, [fetchPreorders, getListFilters]);

    useEffect(() => { load(); }, [load]);

    const handleStatusChange = async (orderId, newStatus) => {
        let reason = null;
        if (newStatus === 'canceled') {
            reason = window.prompt('Motivo de la cancelación (se informa al cliente):');
            if (reason === null) return; // abortó el prompt
        }
        // Contra entrega: al entregar primero se cobra el saldo (mini-modal).
        const order = preorders.find(p => p.id === orderId);
        if (newStatus === 'delivered' && Number(order?.remaining_amount) > 0) {
            setSelectedOrder(null);
            setCodOrder(order);
            return;
        }
        // Pagado online: solo cambio de estado — el pago ya ocurrió en la web
        // y el stock lo descontó la tienda al comprar. Nada de checkout ni caja.
        const result = await updatePreorderStatus(orderId, newStatus, reason, getListFilters());
        if (!result.success) {
            alert('Error al actualizar: ' + (result.error || ''));
            return;
        }
        setSelectedOrder(null);
    };

    // Cobro contra entrega: registra el pago (efectivo → caja abierta; el backend
    // deja el pedido en 'delivered' al completar el total) y luego notifica el
    // estado a MiniVeci vía updatePreorderStatus (idempotente si ya está entregado).
    const handleCodCharge = async (order, amount, method, { terminalId, bankAccountId }) => {
        const pay = await addPreorderPayment(order.id, amount, method, 'final', { terminalId, bankAccountId });
        if (!pay.success) {
            alert('Error al registrar el cobro: ' + (pay.error || ''));
            return false;
        }
        await updatePreorderStatus(order.id, 'delivered', null, getListFilters());
        return true;
    };

    const activeCount = preorders.filter(p => p.status !== 'delivered' && p.status !== 'canceled').length;

    return (
        <div className="flex flex-col h-[calc(100vh-100px)]">
            {/* Switch Venta / Encargos / Tienda */}
            <div className="flex flex-wrap items-center gap-2 mb-3 shrink-0">
                <div className="inline-flex p-0.5 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)]">
                    <button
                        onClick={() => navigate('/pos')}
                        className="px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                    >
                        <ShoppingCart size={14} /> Venta
                    </button>
                    <button
                        onClick={() => navigate('/preorders')}
                        className="px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                    >
                        <CakeSlice size={14} /> Encargos
                    </button>
                    <button className="px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 bg-[var(--color-primary)] text-black">
                        <Store size={14} /> Tienda
                        {activeCount > 0 && (
                            <span className="ml-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center bg-black text-[var(--color-primary)]">
                                {activeCount}
                            </span>
                        )}
                    </button>
                </div>

                <button onClick={load} title="Actualizar" className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg)]">
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            {/* Filtros */}
            <div className="glass-card p-3 mb-4 shrink-0">
                <div className="flex gap-1.5 overflow-x-auto">
                    {[
                        { key: 'all', label: 'Todos' },
                        { key: 'pending', label: '⏳ Pendientes' },
                        { key: 'confirmed', label: '👍 Confirmados' },
                        { key: 'preparing', label: '📦 Preparando' },
                        { key: 'ready', label: '✅ Listos' },
                        { key: 'delivered', label: '🚚 Entregados' },
                        { key: 'canceled', label: '❌ Cancelados' },
                    ].map(s => (
                        <button key={s.key} onClick={() => setStatusFilter(s.key)}
                            className={cn('px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all',
                                statusFilter === s.key
                                    ? 'bg-[var(--color-primary)] text-black'
                                    : 'glass text-[var(--color-text-muted)]'
                            )}>
                            {s.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Cards */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                {loading && preorders.length === 0 ? (
                    <div className="text-center py-12 text-[var(--color-text-muted)]">Cargando pedidos…</div>
                ) : preorders.length === 0 ? (
                    <div className="text-center py-12 space-y-3">
                        <ClipboardList size={48} className="mx-auto text-[var(--color-text-muted)] opacity-30" />
                        <p className="text-[var(--color-text-muted)]">No hay pedidos de la tienda para este filtro</p>
                    </div>
                ) : (
                    preorders.map(order => {
                        const config = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
                        const StatusIcon = config.icon;
                        return (
                            <div key={order.id}
                                onClick={() => setSelectedOrder(order)}
                                className="glass-card p-4 cursor-pointer hover:border-[var(--color-primary)] transition-all border border-[var(--glass-border)] space-y-3 active:scale-[0.99]">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-bold', config.color)}>
                                            <StatusIcon size={12} /> {config.label}
                                        </div>
                                        <span className="text-xs text-[var(--color-text-muted)]">#{order.external_public_code || order.id}</span>
                                        <span className={cn('text-[10px] px-2 py-0.5 rounded-full border font-bold',
                                            order.delivery_type === 'delivery'
                                                ? 'bg-purple-500/15 text-purple-400 border-purple-500/30'
                                                : 'bg-sky-500/15 text-sky-400 border-sky-500/30')}>
                                            {order.delivery_type === 'delivery' ? '🛵 Despacho' : '🏪 Retiro'}
                                        </span>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-bold text-[var(--color-primary)]">
                                            <Clock size={12} className="inline mr-1" />{order.due_time}
                                        </p>
                                        <p className="text-[10px] text-[var(--color-text-muted)]">{order.due_date}</p>
                                    </div>
                                </div>

                                <div className="flex justify-between items-start">
                                    <div className="space-y-1 min-w-0">
                                        <p className="text-sm font-bold text-[var(--color-text)] flex items-center gap-1.5">
                                            <User size={14} className="text-[var(--color-primary)]" /> {order.client_name || 'Cliente web'}
                                        </p>
                                        {order.client_phone && (
                                            <p className="text-xs text-[var(--color-text-muted)] flex items-center gap-1">
                                                <Phone size={10} /> {order.client_phone}
                                            </p>
                                        )}
                                        <p className="text-xs text-[var(--color-text-muted)] line-clamp-1">{order.items_summary}</p>
                                    </div>
                                    <div className="text-right space-y-1 shrink-0 ml-3">
                                        <p className="text-lg font-bold text-[var(--color-text)]">{formatCurrency(order.total_amount, currentCurrency)}</p>
                                        {Number(order.remaining_amount) > 0 ? (
                                            <p className="text-xs text-orange-400 font-bold">💵 Por cobrar al entregar</p>
                                        ) : (
                                            <p className="text-xs text-green-400 font-bold">✓ Pagado online</p>
                                        )}
                                    </div>
                                </div>

                                {STATUS_NEXT_LABEL[order.status] && (
                                    <div className="flex gap-2 pt-1">
                                        <button onClick={(e) => { e.stopPropagation(); handleStatusChange(order.id, config.next); }}
                                            className="flex-1 py-2 rounded-lg text-xs font-bold btn-primary flex items-center justify-center gap-1.5">
                                            <ArrowRight size={14} />
                                            {order.status === 'ready' && Number(order.remaining_amount) > 0
                                                ? 'Cobrar y Entregar'
                                                : STATUS_NEXT_LABEL[order.status]}
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>

            {selectedOrder && (
                <StoreOrderDetailModal
                    order={selectedOrder}
                    onClose={() => setSelectedOrder(null)}
                    onStatusChange={handleStatusChange}
                    currentCurrency={currentCurrency}
                />
            )}

            {codOrder && (
                <CodChargeModal
                    order={codOrder}
                    onClose={() => setCodOrder(null)}
                    onCharged={handleCodCharge}
                    currentCurrency={currentCurrency}
                />
            )}
        </div>
    );
}
