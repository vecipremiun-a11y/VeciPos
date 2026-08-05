import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ShoppingCart, CakeSlice, Store, Clock, Package, Check, Truck, X, User,
    Phone, MapPin, ArrowRight, RefreshCw, ClipboardList, CreditCard, ThumbsUp,
    MessageCircle, Plus, Minus, Trash2, Search, Save,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';
import { formatCurrency } from '../utils/formatCurrency';
import { toast } from '../lib/toast';
import PaymentDetailPicker from '../components/PaymentDetailPicker';
import OrderTabBadge from '../components/OrderTabBadge';

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

const isEditable = (status) => status !== 'delivered' && status !== 'canceled';

// Link de WhatsApp para un teléfono chileno: solo dígitos, últimos 9, prefijo 56.
const waLink = (phone) => {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return null;
    return `https://wa.me/56${digits.slice(-9)}`;
};

const normalizeItem = (it) => ({
    product_id: it.product_id || 0,
    product_name: it.product_name,
    qty: Number(it.qty) || 1,
    unit: it.unit || 'Und',
    unit_price: Number(it.unit_price) || 0,
    line_total: Number(it.line_total) || 0,
    note: it.note || '',
    external_product_id: it.external_product_id || null,
});

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
            <div className="glass-card w-full max-w-sm p-0 overflow-hidden !bg-[#18181b]" onClick={e => e.stopPropagation()}>
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

// Devolución al entregar (cuando el pedido se editó a la baja y quedó saldo a favor).
function RefundModal({ order, amount, onClose, onConfirm, currentCurrency }) {
    const [saving, setSaving] = useState(false);
    const go = async () => {
        setSaving(true);
        const ok = await onConfirm(order, amount);
        setSaving(false);
        if (ok) onClose();
    };
    return (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
            <div className="glass-card w-full max-w-sm p-0 overflow-hidden !bg-[#18181b]" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b border-[var(--glass-border)] flex items-center justify-between">
                    <h3 className="font-bold text-sm text-[var(--color-text)]">Devolver y entregar #{order.external_public_code || order.id}</h3>
                    <button onClick={onClose} className="p-1 rounded-full hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)]"><X size={16} /></button>
                </div>
                <div className="p-4 space-y-2 text-center">
                    <p className="text-xs text-[var(--color-text-muted)]">El pedido se editó a la baja. Devuelve al cliente</p>
                    <p className="text-3xl font-bold text-orange-400">{formatCurrency(amount, currentCurrency)}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">Se registra como salida de efectivo en tu caja abierta.</p>
                </div>
                <div className="p-4 border-t border-[var(--glass-border)] flex justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg border border-[var(--glass-border)] text-[var(--color-text)] text-sm">Cancelar</button>
                    <button onClick={go} disabled={saving}
                        className="px-4 py-2 rounded-lg bg-orange-500 text-black font-bold text-sm disabled:opacity-50">
                        {saving ? 'Registrando…' : 'Devolver y entregar'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// Modal para AÑADIR un producto al pedido: buscador server-side. El precio y las
// ofertas vienen del sistema (misma fuente que la tienda), así que se toman de aquí.
function AddProductModal({ onAdd, onClose, currentCurrency }) {
    const { searchProductsForDropdown } = useStore();
    const [q, setQ] = useState('');
    const [results, setResults] = useState([]);
    const [busy, setBusy] = useState(false);
    const [added, setAdded] = useState(0);
    const timer = useRef(null);
    const inputRef = useRef(null);

    useEffect(() => { inputRef.current?.focus(); }, []);

    useEffect(() => {
        if (timer.current) clearTimeout(timer.current);
        if (!q || q.trim().length < 2) { setResults([]); setBusy(false); return; }
        setBusy(true);
        timer.current = setTimeout(async () => {
            const rows = await searchProductsForDropdown(q.trim());
            setResults(rows.slice(0, 30));
            setBusy(false);
        }, 300);
        return () => timer.current && clearTimeout(timer.current);
    }, [q, searchProductsForDropdown]);

    const pick = (p) => {
        const price = (p.is_offer && p.offer_price) ? p.offer_price : p.price;
        onAdd({
            product_id: p.id,
            product_name: p.name,
            qty: 1,
            unit: p.unit || 'Und',
            unit_price: Number(price) || 0,
            line_total: Number(price) || 0,
        });
        setAdded(n => n + 1);
        toast(`Agregado: ${p.name}`, 'success');
    };

    return (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
            <div className="glass-card w-full max-w-md p-0 overflow-hidden !bg-[#18181b] flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b border-[var(--glass-border)] flex items-center justify-between shrink-0">
                    <h3 className="font-bold text-sm text-[var(--color-text)]">Añadir producto al pedido</h3>
                    <button onClick={onClose} className="p-1 rounded-full hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)]"><X size={16} /></button>
                </div>
                <div className="p-4 shrink-0">
                    <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)]">
                        <Search size={16} className="text-[var(--color-text-muted)]" />
                        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
                            placeholder="Buscar producto por nombre o código…"
                            className="flex-1 bg-transparent text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)]" />
                    </div>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-2">
                    {busy && <p className="p-3 text-center text-xs text-[var(--color-text-muted)]">Buscando…</p>}
                    {!busy && q.trim().length >= 2 && results.length === 0 && (
                        <p className="p-3 text-center text-xs text-[var(--color-text-muted)]">Sin resultados para "{q}"</p>
                    )}
                    {!busy && q.trim().length < 2 && (
                        <p className="p-3 text-center text-xs text-[var(--color-text-muted)]">Escribe al menos 2 letras para buscar.</p>
                    )}
                    <div className="divide-y divide-[var(--glass-border)]">
                        {results.map(p => {
                            const price = (p.is_offer && p.offer_price) ? p.offer_price : p.price;
                            return (
                                <button key={p.id} onClick={() => pick(p)}
                                    className="w-full flex items-center justify-between gap-2 py-2.5 px-1 text-left hover:bg-[var(--glass-bg)] rounded-md transition-colors">
                                    <div className="min-w-0">
                                        <p className="text-sm text-[var(--color-text)] truncate">{p.name}</p>
                                        {p.sku && <p className="text-[10px] text-[var(--color-text-muted)]">{p.sku}</p>}
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <span className="text-xs text-[var(--color-primary)] font-bold">{formatCurrency(price, currentCurrency)}</span>
                                        <span className="w-6 h-6 rounded-md bg-[var(--color-primary)]/15 text-[var(--color-primary)] flex items-center justify-center"><Plus size={14} /></span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
                <div className="p-3 border-t border-[var(--glass-border)] flex items-center justify-between shrink-0">
                    <span className="text-xs text-[var(--color-text-muted)]">{added > 0 ? `${added} agregado${added > 1 ? 's' : ''}` : 'Selecciona productos para agregar'}</span>
                    <button onClick={onClose} className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-black font-bold text-sm">Listo</button>
                </div>
            </div>
        </div>
    );
}

// Detalle del pedido (panel derecho en desktop / modal en móvil). Cliente,
// WhatsApp, edición directa de productos (± / quitar / añadir) y acciones.
function StoreOrderDetail({ order, currentCurrency, onStatusChange, onEditItems, onClose, embedded = false }) {
    const { getPreorderDetails } = useStore();
    const [items, setItems] = useState([]);
    const [draft, setDraft] = useState([]);
    const [dirty, setDirty] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showAdd, setShowAdd] = useState(false);

    const config = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
    const StatusIcon = config.icon;
    const editable = isEditable(order.status);
    const deposit = Number(order.deposit_amount) || 0;
    const deliveryFee = Number(order.delivery_fee) || 0;
    const wa = waLink(order.client_phone);

    const loadItems = useCallback(async () => {
        setLoading(true);
        const r = await getPreorderDetails(order.id);
        const list = r?.success ? (r.items || []) : [];
        setItems(list);
        setDraft(list.map(normalizeItem));
        setDirty(false);
        setLoading(false);
    }, [order.id, getPreorderDetails]);

    useEffect(() => { loadItems(); }, [loadItems]);

    const recalcLine = (it) => ({ ...it, line_total: Math.round((Number(it.qty) || 0) * (Number(it.unit_price) || 0)) });
    const setQty = (idx, qty) => { setDraft(d => d.map((it, i) => i === idx ? recalcLine({ ...it, qty: Math.max(1, qty) }) : it)); setDirty(true); };
    const removeItem = (idx) => { setDraft(d => d.filter((_, i) => i !== idx)); setDirty(true); };
    const addItem = (item) => {
        setDraft(d => {
            const existing = d.findIndex(x => x.product_id && x.product_id === item.product_id);
            if (existing >= 0) return d.map((it, i) => i === existing ? recalcLine({ ...it, qty: (Number(it.qty) || 0) + 1 }) : it);
            return [...d, normalizeItem(item)];
        });
        setDirty(true);
    };
    const discard = () => { setDraft(items.map(normalizeItem)); setDirty(false); };

    const draftItemsTotal = useMemo(() => draft.reduce((a, it) => a + (Number(it.line_total) || 0), 0), [draft]);
    const draftTotal = draftItemsTotal + deliveryFee;
    const draftDiff = draftTotal - deposit;

    const save = async () => {
        if (draft.length === 0) { alert('El pedido debe tener al menos un producto.'); return; }
        setSaving(true);
        const r = await onEditItems(order.id, draft);
        setSaving(false);
        if (r?.success) { await loadItems(); toast('Pedido actualizado', 'success'); }
        else alert('Error al guardar: ' + (r?.error || ''));
    };

    // Total/saldo mostrados: si es editable usa el borrador (refleja cambios en vivo).
    const shownTotal = editable ? draftTotal : (Number(order.total_amount) || 0);
    const shownRemaining = editable ? draftDiff : (Number(order.remaining_amount) || 0);

    const finalLabel = order.status === 'ready'
        ? (shownRemaining > 0 ? 'Cobrar y entregar' : shownRemaining < 0 ? 'Devolver y entregar' : 'Entregar')
        : STATUS_NEXT_LABEL[order.status];

    const list = editable ? draft : items;

    return (
        <div className={cn('flex flex-col min-h-0', embedded ? 'h-full w-full' : 'max-h-[92vh]')}>
            {/* Header */}
            <div className="p-4 border-b border-[var(--glass-border)] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3 flex-wrap">
                    <div className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-bold', config.color)}>
                        <StatusIcon size={12} /> {config.label}
                    </div>
                    <span className="font-bold text-[var(--color-text)]">#{order.external_public_code || order.id}</span>
                    <span className={cn('text-[10px] px-2 py-0.5 rounded-full border font-bold',
                        order.delivery_type === 'delivery'
                            ? 'bg-purple-500/15 text-purple-400 border-purple-500/30'
                            : 'bg-sky-500/15 text-sky-400 border-sky-500/30')}>
                        {order.delivery_type === 'delivery' ? '🛵 Despacho' : '🏪 Retiro'}
                    </span>
                </div>
                {onClose && (
                    <button onClick={onClose} className="p-1.5 rounded-full hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] lg:hidden">
                        <X size={18} />
                    </button>
                )}
            </div>

            {/* Contenido scrollable: cliente + productos */}
            <div className="p-4 space-y-5 overflow-y-auto flex-1 min-h-0">
                {/* Cliente + contacto */}
                <div className="space-y-2 text-sm">
                    <p className="font-bold text-[var(--color-text)] flex items-center gap-2 text-base">
                        <User size={16} className="text-[var(--color-primary)]" /> {order.client_name || 'Cliente web'}
                    </p>
                    {order.client_phone && (
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[var(--color-text-muted)] flex items-center gap-1.5"><Phone size={12} /> {order.client_phone}</span>
                            {wa && (
                                <a href={wa} target="_blank" rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-green-500/15 text-green-400 border border-green-500/30 hover:bg-green-500/25 transition-colors">
                                    <MessageCircle size={12} /> WhatsApp
                                </a>
                            )}
                            <a href={`tel:${order.client_phone}`}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-[var(--glass-bg)] text-[var(--color-text-muted)] border border-[var(--glass-border)] hover:text-[var(--color-text)] transition-colors">
                                <Phone size={12} /> Llamar
                            </a>
                        </div>
                    )}
                    {order.delivery_type === 'delivery' && (
                        <p className="text-[var(--color-text-muted)] flex items-start gap-2">
                            <MapPin size={12} className="mt-0.5 shrink-0" />
                            {order.delivery_address || <span className="italic">Sin dirección registrada</span>}
                        </p>
                    )}
                    <p className="text-[var(--color-text-muted)] flex items-center gap-2">
                        <Clock size={12} /> Pedido: {order.due_date} {order.due_time}
                        {order.delivery_type === 'delivery' ? ' · Despacho' : ' · Retiro en tienda'}
                    </p>
                    {order.notes && <p className="text-xs text-[var(--color-text-muted)] italic">"{order.notes}"</p>}
                </div>

                {/* Productos */}
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Productos</h4>
                        {editable && (
                            <button onClick={() => setShowAdd(true)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[var(--color-primary)]/15 text-[var(--color-primary)] border border-[var(--color-primary)]/30 hover:bg-[var(--color-primary)]/25">
                                <Plus size={14} /> Añadir producto
                            </button>
                        )}
                    </div>

                    <div className="border border-[var(--glass-border)] rounded-lg overflow-hidden">
                        {loading ? (
                            <p className="p-4 text-center text-sm text-[var(--color-text-muted)]">Cargando detalle…</p>
                        ) : list.length === 0 ? (
                            <p className="p-4 text-center text-sm text-[var(--color-text-muted)]">Sin productos</p>
                        ) : (
                            <div className="divide-y divide-[var(--glass-border)]">
                                {list.map((item, idx) => (
                                    <div key={item.id ?? `${item.product_id}-${idx}`} className="p-3 flex justify-between items-center gap-3 text-sm">
                                        <div className="min-w-0 flex-1">
                                            <p className="text-[var(--color-text)] font-medium truncate">{item.product_name}</p>
                                            <p className="text-xs text-[var(--color-text-muted)]">
                                                {item.qty} {item.unit || 'Und'} × {formatCurrency(item.unit_price, currentCurrency)} = {formatCurrency(item.line_total, currentCurrency)}
                                            </p>
                                            {item.note && <p className="text-xs text-amber-400">{item.note}</p>}
                                        </div>
                                        {editable ? (
                                            <div className="flex items-center gap-1.5 shrink-0">
                                                <button onClick={() => setQty(idx, (Number(item.qty) || 1) - 1)}
                                                    className="w-7 h-7 rounded-md bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)] flex items-center justify-center hover:border-[var(--color-primary)]/50"><Minus size={13} /></button>
                                                <span className="w-7 text-center text-sm font-bold text-[var(--color-text)]">{item.qty}</span>
                                                <button onClick={() => setQty(idx, (Number(item.qty) || 1) + 1)}
                                                    className="w-7 h-7 rounded-md bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)] flex items-center justify-center hover:border-[var(--color-primary)]/50"><Plus size={13} /></button>
                                                <button onClick={() => removeItem(idx)}
                                                    className="w-7 h-7 rounded-md bg-red-500/15 border border-red-500/30 text-red-400 flex items-center justify-center ml-1 hover:bg-red-500/25"><Trash2 size={13} /></button>
                                            </div>
                                        ) : (
                                            <strong className="text-[var(--color-text)] shrink-0">{formatCurrency(item.line_total, currentCurrency)}</strong>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Footer fijo: barra de guardar (si hay cambios) + totales + acciones */}
            <div className="border-t border-[var(--glass-border)] shrink-0">
                {dirty && (
                    <div className="p-3 bg-[var(--color-primary)]/[0.06] border-b border-[var(--glass-border)] flex items-center gap-2">
                        <span className="text-xs text-[var(--color-text-muted)] flex-1">Tienes cambios sin guardar</span>
                        <button onClick={discard} disabled={saving}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold border border-[var(--glass-border)] text-[var(--color-text)]">Descartar</button>
                        <button onClick={save} disabled={saving}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[var(--color-primary)] text-black inline-flex items-center gap-1.5 disabled:opacity-50">
                            <Save size={13} /> {saving ? 'Guardando…' : 'Guardar cambios'}
                        </button>
                    </div>
                )}

                <div className="p-4 space-y-1 text-sm">
                    {deliveryFee > 0 && (
                        <div className="flex justify-between text-[var(--color-text-muted)]">
                            <span>Despacho</span><span>{formatCurrency(deliveryFee, currentCurrency)}</span>
                        </div>
                    )}
                    <div className="flex justify-between items-center">
                        <span className="font-bold text-[var(--color-text)]">Total</span>
                        <span className="text-xl font-bold text-[var(--color-text)]">{formatCurrency(shownTotal, currentCurrency)}</span>
                    </div>
                    {shownRemaining > 0 ? (
                        <p className="text-orange-400 flex items-center gap-2 font-medium justify-end">
                            <CreditCard size={12} /> Por cobrar al entregar {formatCurrency(shownRemaining, currentCurrency)}
                        </p>
                    ) : shownRemaining < 0 ? (
                        <p className="text-orange-400 flex items-center gap-2 font-medium justify-end">
                            <CreditCard size={12} /> A devolver al entregar {formatCurrency(Math.abs(shownRemaining), currentCurrency)}
                        </p>
                    ) : (
                        <p className="text-green-400 flex items-center gap-2 font-medium justify-end">
                            <CreditCard size={12} /> Pagado online{order.payment_method ? ` · ${order.payment_method}` : ''}
                        </p>
                    )}
                </div>

                {editable && (
                    <div className="px-4 pb-4 flex gap-2">
                        <button
                            onClick={() => onStatusChange(order.id, 'canceled')}
                            className="px-4 py-2.5 rounded-lg text-xs font-bold bg-red-500/15 text-red-400 border border-red-500/30"
                        >
                            Cancelar
                        </button>
                        {config.next && (
                            <button
                                onClick={() => onStatusChange(order.id, config.next)}
                                disabled={dirty}
                                title={dirty ? 'Guarda los cambios primero' : ''}
                                className="flex-1 py-2.5 rounded-lg text-xs font-bold btn-primary flex items-center justify-center gap-1.5 disabled:opacity-40"
                            >
                                <ArrowRight size={14} /> {finalLabel}
                            </button>
                        )}
                    </div>
                )}
            </div>

            {showAdd && (
                <AddProductModal onAdd={addItem} onClose={() => setShowAdd(false)} currentCurrency={currentCurrency} />
            )}
        </div>
    );
}

export default function StoreOrders() {
    const navigate = useNavigate();
    const {
        preorders, fetchPreorders, updatePreorderStatus, addPreorderPayment,
        editPreorderItems, _registerPreorderCash, currentCurrency,
        orderBadges, fetchOrderBadges,
    } = useStore();
    const [statusFilter, setStatusFilter] = useState('all');
    const [loading, setLoading] = useState(true);
    const [selectedId, setSelectedId] = useState(null);
    const [codOrder, setCodOrder] = useState(null);
    const [refundOrder, setRefundOrder] = useState(null);

    const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);
    useEffect(() => {
        const mq = window.matchMedia('(min-width: 1024px)');
        const h = (e) => setIsDesktop(e.matches);
        mq.addEventListener('change', h);
        return () => mq.removeEventListener('change', h);
    }, []);

    const getListFilters = useCallback(() => ({
        kind: 'store',
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
    }), [statusFilter]);

    const load = useCallback(async () => {
        setLoading(true);
        await fetchPreorders(getListFilters());
        fetchOrderBadges();
        setLoading(false);
    }, [fetchPreorders, getListFilters, fetchOrderBadges]);

    useEffect(() => { load(); }, [load]);

    const selectedOrder = useMemo(() => preorders.find(p => p.id === selectedId) || null, [preorders, selectedId]);

    const handleStatusChange = async (orderId, newStatus) => {
        let reason = null;
        if (newStatus === 'canceled') {
            reason = window.prompt('Motivo de la cancelación (se informa al cliente):');
            if (reason === null) return;
        }
        const order = preorders.find(p => p.id === orderId);
        const remaining = Number(order?.remaining_amount) || 0;
        if (newStatus === 'delivered' && remaining > 0) { setRefundOrder(null); setCodOrder(order); return; }
        if (newStatus === 'delivered' && remaining < 0) { setCodOrder(null); setRefundOrder(order); return; }
        const result = await updatePreorderStatus(orderId, newStatus, reason, getListFilters());
        // Efectivo que no llegó a ninguna caja: aviso que hay que cerrar, para que
        // no se descubra recién al cuadrar el turno.
        if (result.cashWarning) alert('⚠️ ' + result.cashWarning);
        if (!result.success) { alert('Error al actualizar: ' + (result.error || '')); return; }
    };

    const handleEditItems = async (orderId, items) => {
        return await editPreorderItems(orderId, items, getListFilters());
    };

    const handleCodCharge = async (order, amount, method, { terminalId, bankAccountId }) => {
        const pay = await addPreorderPayment(order.id, amount, method, 'final', { terminalId, bankAccountId });
        if (pay.cashWarning) alert('⚠️ ' + pay.cashWarning);
        if (!pay.success) { alert('Error al registrar el cobro: ' + (pay.error || '')); return false; }
        await updatePreorderStatus(order.id, 'delivered', null, getListFilters());
        return true;
    };

    const handleRefund = async (order, amount) => {
        const out = await _registerPreorderCash({
            amount, direction: 'OUT',
            reason: `Devolución pedido tienda #${order.external_public_code || order.id}`,
        });
        if (out && out.success === false) { alert('Error al registrar la devolución: ' + (out.error || '')); return false; }
        await updatePreorderStatus(order.id, 'delivered', null, getListFilters());
        return true;
    };

    return (
        <div className="flex flex-col h-[calc(100vh-100px)]">
            {/* Switch Venta / Encargos / Tienda */}
            <div className="flex flex-wrap items-center gap-2 mb-3 shrink-0">
                <div className="inline-flex p-0.5 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)]">
                    <button onClick={() => navigate('/pos')}
                        className="px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
                        <ShoppingCart size={14} /> Venta
                    </button>
                    <button onClick={() => navigate('/preorders')}
                        className="px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
                        <CakeSlice size={14} /> Encargos
                        <OrderTabBadge count={orderBadges?.encargo} />
                    </button>
                    <button className="px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 bg-[var(--color-primary)] text-black">
                        <Store size={14} /> Tienda
                        <OrderTabBadge count={orderBadges?.store} />
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
                                statusFilter === s.key ? 'bg-[var(--color-primary)] text-black' : 'glass text-[var(--color-text-muted)]')}>
                            {s.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* 2 paneles: lista (izq) + detalle (der, desktop) */}
            <div className="flex-1 min-h-0 flex gap-4">
                {/* Lista */}
                <div className="w-full lg:w-[360px] lg:shrink-0 overflow-y-auto space-y-2 pr-1">
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
                            const isSel = order.id === selectedId;
                            return (
                                <div key={order.id}
                                    onClick={() => setSelectedId(order.id)}
                                    className={cn('glass-card p-3 cursor-pointer transition-all border space-y-2 active:scale-[0.99]',
                                        isSel ? 'border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]/40' : 'border-[var(--glass-border)] hover:border-[var(--color-primary)]/60')}>
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <div className={cn('flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[10px] font-bold shrink-0', config.color)}>
                                                <StatusIcon size={11} /> {config.label}
                                            </div>
                                            <span className="text-[10px] text-[var(--color-text-muted)] truncate">#{order.external_public_code || order.id}</span>
                                        </div>
                                        <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">{order.due_time}</span>
                                    </div>
                                    <div className="flex justify-between items-start gap-2">
                                        <div className="min-w-0">
                                            <p className="text-sm font-bold text-[var(--color-text)] truncate flex items-center gap-1.5">
                                                <User size={13} className="text-[var(--color-primary)] shrink-0" /> {order.client_name || 'Cliente web'}
                                            </p>
                                            <p className="text-xs text-[var(--color-text-muted)] line-clamp-1">{order.items_summary}</p>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className="text-sm font-bold text-[var(--color-text)]">{formatCurrency(order.total_amount, currentCurrency)}</p>
                                            <p className={cn('text-[10px] font-bold', Number(order.remaining_amount) > 0 ? 'text-orange-400' : 'text-green-400')}>
                                                {order.delivery_type === 'delivery' ? '🛵' : '🏪'} {Number(order.remaining_amount) > 0 ? 'Por cobrar' : '✓ Pagado'}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Detalle inline (desktop) — ocupa todo el espacio restante */}
                {isDesktop && (
                    <div className="hidden lg:block flex-1 min-h-0 glass-card p-0 overflow-hidden">
                        {selectedOrder ? (
                            <StoreOrderDetail
                                key={selectedOrder.id}
                                order={selectedOrder}
                                currentCurrency={currentCurrency}
                                onStatusChange={handleStatusChange}
                                onEditItems={handleEditItems}
                                embedded
                            />
                        ) : (
                            <div className="h-full w-full flex flex-col items-center justify-center text-center text-[var(--color-text-muted)] gap-3">
                                <Store size={48} className="opacity-30" />
                                <p>Selecciona un pedido para ver el detalle</p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Detalle en modal (móvil) */}
            {!isDesktop && selectedOrder && (
                <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setSelectedId(null)}>
                    <div className="glass-card w-full sm:max-w-lg h-[92vh] sm:h-auto p-0 overflow-hidden !bg-[#18181b]" onClick={e => e.stopPropagation()}>
                        <StoreOrderDetail
                            key={selectedOrder.id}
                            order={selectedOrder}
                            currentCurrency={currentCurrency}
                            onStatusChange={handleStatusChange}
                            onEditItems={handleEditItems}
                            onClose={() => setSelectedId(null)}
                            embedded
                        />
                    </div>
                </div>
            )}

            {codOrder && (
                <CodChargeModal order={codOrder} onClose={() => setCodOrder(null)} onCharged={handleCodCharge} currentCurrency={currentCurrency} />
            )}
            {refundOrder && (
                <RefundModal order={refundOrder} amount={Math.abs(Number(refundOrder.remaining_amount) || 0)} onClose={() => setRefundOrder(null)} onConfirm={handleRefund} currentCurrency={currentCurrency} />
            )}
        </div>
    );
}
