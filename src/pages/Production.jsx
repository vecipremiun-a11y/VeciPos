import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
    Clock, User, ChefHat, Check, X, AlertTriangle,
    Calendar, Filter, Package, Search, Eye, ChevronDown, Truck,
    List, LayoutGrid, Globe, CircleCheck, PackageCheck, Ban
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';
import { formatCurrency } from '../utils/formatCurrency';
import { usePermissions } from '../hooks/usePermissions';
import { playProductionSound } from '../utils/productionSounds';
import { createSmartInterval } from '../lib/smartPolling';
import Pusher from 'pusher-js';

// ========== HELPERS ==========
/**
 * Parsea el string `items_summary` (ej: "Pan de Completo 1kg x10.0, Pan de Churrasco 1kg x5.0")
 * en una lista estructurada [{ name, qty }, ...]. Tolerante a `x10`, `x10.0`, `x10.5`.
 */
const parseItemsSummary = (summary) => {
    if (!summary || typeof summary !== 'string') return [];
    return summary.split(',').map(raw => {
        const txt = raw.trim();
        if (!txt) return null;
        const m = txt.match(/^(.+?)\s*x\s*(\d+(?:[.,]\d+)?)\s*$/i);
        if (m) {
            const qtyNum = parseFloat(m[2].replace(',', '.'));
            // Mostrar entero si es .0, decimal si no
            const qtyStr = Number.isInteger(qtyNum) ? String(qtyNum) : qtyNum.toString();
            return { name: m[1].trim(), qty: qtyStr };
        }
        return { name: txt, qty: '1' };
    }).filter(Boolean);
};

// Badge para encargos provenientes de la web (mini-veci u otro canal externo)
const ExternalSourceBadge = ({ preorder, size = 'sm' }) => {
    if (!preorder?.external_source) return null;
    const code = preorder.external_public_code;
    const label = preorder.external_source === 'miniveci' ? 'mini-veci' : preorder.external_source;
    const iconSize = size === 'sm' ? 10 : 12;
    return (
        <span
            title={code ? `${label} · ${code}` : label}
            className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-bold border bg-violet-500/15 text-violet-300 border-violet-500/30 tabular-nums whitespace-nowrap",
                size === 'sm' ? "text-[10px]" : "text-xs"
            )}
        >
            <Globe size={iconSize} />
            {code || label}
        </span>
    );
};

// ========== STATUS CONFIG ==========
const STATUS_CONFIG = {
    pending: { label: 'Pendiente', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30', dotColor: 'bg-amber-400', icon: Clock },
    confirmed: { label: 'Confirmado', color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30', dotColor: 'bg-cyan-400', icon: CircleCheck },
    preparing: { label: 'En Preparación', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', dotColor: 'bg-blue-400', icon: Package },
    ready: { label: 'Listo', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', dotColor: 'bg-emerald-400', icon: Check },
    out_for_delivery: { label: 'En Reparto', color: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30', dotColor: 'bg-indigo-400', icon: Truck },
    delivered: { label: 'Entregado', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30', dotColor: 'bg-gray-400', icon: PackageCheck },
    canceled: { label: 'Cancelado', color: 'bg-red-500/20 text-red-400 border-red-500/30', dotColor: 'bg-red-400', icon: X },
};

// Acciones "hacia adelante" disponibles según estado actual y tipo de entrega.
// Devuelve [{ status, label, icon, variant }]. La rama ready depende de pickup/delivery.
const getForwardActions = (order) => {
    const isDelivery = order.delivery_type === 'delivery';
    switch (order.status) {
        case 'pending':
            return [{ status: 'confirmed', label: 'Confirmar', icon: CircleCheck, variant: 'cyan' }];
        case 'confirmed':
            return [{ status: 'preparing', label: 'Empezar', icon: ChefHat, variant: 'blue' }];
        case 'preparing':
            return [{ status: 'ready', label: 'Marcar Listo', icon: Check, variant: 'emerald' }];
        case 'ready':
            return isDelivery
                ? [{ status: 'out_for_delivery', label: 'Enviar a Reparto', icon: Truck, variant: 'indigo' }]
                : [{ status: 'delivered', label: 'Entregar', icon: PackageCheck, variant: 'emerald' }];
        case 'out_for_delivery':
            return [{ status: 'delivered', label: 'Entregar', icon: PackageCheck, variant: 'emerald' }];
        default:
            return [];
    }
};

// ¿Se puede rechazar/cancelar desde este estado? (con motivo)
const canRejectOrder = (order) =>
    ['pending', 'confirmed', 'preparing', 'ready'].includes(order.status);

// Clases por variante de botón (gradiente + sombra)
const ACTION_VARIANTS = {
    cyan: 'from-cyan-600 to-cyan-500 shadow-cyan-500/20 hover:shadow-cyan-500/30',
    blue: 'from-blue-600 to-blue-500 shadow-blue-500/20 hover:shadow-blue-500/30',
    emerald: 'from-emerald-600 to-emerald-500 shadow-emerald-500/20 hover:shadow-emerald-500/30',
    indigo: 'from-indigo-600 to-indigo-500 shadow-indigo-500/20 hover:shadow-indigo-500/30',
};

// Botones de acción según la máquina de estados. `layout`:
//  - 'inline': compacto para la tabla (rechazo icono-only)
//  - 'block':  botones flex-1 para tarjetas/modal/mobile (rechazo con label)
const ProductionActions = ({ order, canManage, onAction, onReject, layout = 'block' }) => {
    if (!canManage) return null;
    const actions = getForwardActions(order);
    const showReject = canRejectOrder(order);
    if (actions.length === 0 && !showReject) return null;

    const inline = layout === 'inline';
    const fwdBase = inline
        ? 'px-3.5 py-2 rounded-xl text-xs font-bold'
        : 'flex-1 py-2.5 rounded-xl text-xs font-bold';

    return (
        <>
            {actions.map(a => {
                const Icon = a.icon;
                return (
                    <button key={a.status} onClick={() => onAction(order.id, a.status)}
                        className={cn(fwdBase, 'bg-gradient-to-r text-white shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-1.5 active:scale-95', ACTION_VARIANTS[a.variant])}>
                        <Icon size={inline ? 13 : 14} /> {a.label}
                    </button>
                );
            })}
            {showReject && (
                <button onClick={() => onReject(order)}
                    title="Rechazar"
                    className={cn(
                        inline ? 'px-3 py-2' : 'px-3 py-2.5',
                        'rounded-xl text-xs font-bold bg-red-500/15 text-red-400 border border-red-500/25 hover:bg-red-500/25 transition-all flex items-center justify-center gap-1.5'
                    )}>
                    <Ban size={inline ? 13 : 14} /> {inline ? '' : 'Rechazar'}
                </button>
            )}
        </>
    );
};

// ========== REJECT REASON MODAL ==========
const RejectReasonModal = ({ order, onClose, onConfirm }) => {
    const [reason, setReason] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleConfirm = async () => {
        setSubmitting(true);
        await onConfirm(order.id, reason.trim());
        setSubmitting(false);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="glass-card w-full max-w-md animate-[float_0.3s_ease-out]" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center shrink-0">
                        <Ban size={20} className="text-white" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-[var(--color-text)]">Rechazar encargo</h2>
                        <p className="text-xs text-[var(--color-text-muted)]">
                            #{order.id} · {order.client_name || 'Sin nombre'}
                        </p>
                    </div>
                </div>

                <label className="block text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
                    Motivo del rechazo
                </label>
                <textarea
                    autoFocus
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    placeholder="Ej: no alcanzamos a tener listo para esa hora"
                    rows={3}
                    className="glass-input w-full text-sm rounded-xl p-3 resize-none"
                />
                <p className="text-[11px] text-[var(--color-text-muted)] mt-1.5">
                    El cliente verá este motivo en miniveci. Opcional pero recomendado.
                </p>

                <div className="flex gap-2 pt-4">
                    <button onClick={onClose}
                        className="flex-1 py-2.5 rounded-xl font-bold text-sm border border-[var(--glass-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-white/5 transition-all">
                        Cancelar
                    </button>
                    <button onClick={handleConfirm} disabled={submitting}
                        className="flex-1 py-2.5 rounded-xl font-bold text-sm bg-gradient-to-r from-red-600 to-rose-500 text-white shadow-lg shadow-red-500/25 hover:from-red-500 hover:to-rose-400 transition-all flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50">
                        <Ban size={16} /> {submitting ? 'Rechazando...' : 'Confirmar rechazo'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ========== DETAIL MODAL ==========
const ProductionDetailModal = ({ preorder, onClose, onStatusChange, onReject, canManage }) => {
    const [details, setDetails] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const { getPreorderDetails } = useStore();
    const config = STATUS_CONFIG[preorder.status] || STATUS_CONFIG.pending;
    const StatusIcon = config.icon;

    useEffect(() => {
        const load = async () => {
            const result = await getPreorderDetails(preorder.id);
            if (result.success) setDetails(result);
            setIsLoading(false);
        };
        load();
    }, [preorder.id]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="glass-card w-full max-w-lg animate-[float_0.3s_ease-out] max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
                            <ChefHat size={20} className="text-white" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-[var(--color-text)]">Orden #{preorder.id}</h2>
                            <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                                <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border", config.color)}>
                                    <StatusIcon size={10} /> {config.label}
                                </span>
                                <ExternalSourceBadge preorder={preorder} />
                            </div>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] p-2 rounded-xl hover:bg-white/5 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {isLoading ? (
                    <div className="flex items-center justify-center py-16">
                        <div className="animate-spin rounded-full h-8 w-8 border-2 border-[var(--color-primary)] border-t-transparent" />
                    </div>
                ) : details ? (
                    <div className="space-y-5">
                        {/* Client & Schedule */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-xl p-3.5 bg-gradient-to-br from-[var(--glass-bg)] to-transparent border border-[var(--glass-border)]">
                                <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider font-bold mb-1.5">👤 Cliente</p>
                                <p className="text-sm font-bold text-[var(--color-text)]">{details.preorder.client_name || 'Sin nombre'}</p>
                                {details.preorder.client_phone && (
                                    <p className="text-xs text-[var(--color-text-muted)] mt-1">📱 {details.preorder.client_phone}</p>
                                )}
                            </div>
                            <div className="rounded-xl p-3.5 bg-gradient-to-br from-[var(--glass-bg)] to-transparent border border-[var(--glass-border)]">
                                <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider font-bold mb-1.5">📅 Entrega</p>
                                <p className="text-sm font-bold text-[var(--color-text)]">{details.preorder.due_date}</p>
                                <p className="text-xs text-[var(--color-primary)] font-bold mt-1">
                                    🕐 {details.preorder.due_time}
                                </p>
                            </div>
                        </div>

                        {/* Items */}
                        <div>
                            <p className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">🧾 Productos a preparar</p>
                            <div className="space-y-2">
                                {details.items.map(item => (
                                    <div key={item.id} className="flex justify-between items-center rounded-xl p-3 bg-[var(--glass-bg)] border border-[var(--glass-border)] hover:border-[var(--glass-border-hover)] transition-colors">
                                        <div className="flex-1">
                                            <p className="text-sm font-bold text-[var(--color-text)]">{item.product_name}</p>
                                            {item.note && <p className="text-xs text-amber-400 italic mt-0.5">📝 {item.note}</p>}
                                        </div>
                                        <span className="bg-[var(--color-primary)]/15 text-[var(--color-primary)] text-sm font-bold px-3 py-1 rounded-full border border-[var(--color-primary)]/20">
                                            x{item.qty} {item.unit}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Notes */}
                        {details.preorder.notes && (
                            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3.5 text-sm flex items-start gap-2.5">
                                <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />
                                <span className="text-amber-300">{details.preorder.notes}</span>
                            </div>
                        )}

                        {/* Actions */}
                        {preorder.status !== 'delivered' && preorder.status !== 'canceled' && (
                            <div className="flex gap-2 pt-1">
                                <ProductionActions
                                    order={preorder}
                                    canManage={canManage}
                                    onAction={(id, status) => { onStatusChange(id, status); onClose(); }}
                                    onReject={(order) => { onClose(); onReject(order); }}
                                    layout="block"
                                />
                            </div>
                        )}
                    </div>
                ) : (
                    <p className="text-center text-[var(--color-text-muted)] py-8">No se encontró la orden</p>
                )}
            </div>
        </div>
    );
};

// ========== MAIN PRODUCTION PAGE ==========
const Production = () => {
    const { preorders, fetchPreorders, updatePreorderStatus, currentCurrency } = useStore();
    const { can } = usePermissions();

    const [dateFilter, setDateFilter] = useState('today');
    const [customDate, setCustomDate] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [selectedPreorder, setSelectedPreorder] = useState(null);
    const [rejectingOrder, setRejectingOrder] = useState(null);
    // Vista preferida persistida en localStorage: 'list' | 'cards'
    const [viewMode, setViewMode] = useState(() => {
        try { return localStorage.getItem('production_view_mode') || 'list'; } catch { return 'list'; }
    });
    useEffect(() => {
        try { localStorage.setItem('production_view_mode', viewMode); } catch { /* ignore */ }
    }, [viewMode]);

    // ===== Sonido para nuevos pedidos del día =====
    // Mantenemos los IDs ya vistos. En el primer fetch solo poblamos la
    // referencia (sin sonido). En fetches posteriores, si aparece un nuevo
    // pedido cuya fecha de entrega es HOY, reproducimos un beep.
    const seenIdsRef = useRef(null);
    const playNewOrderSound = () => playProductionSound();

    // Build filters — el filtro de estado se aplica en cliente para que los
    // contadores de las tarjetas resumen se mantengan correctos al cambiar
    // de pestaña/filtro.
    const getFilters = () => {
        const today = new Date().toLocaleDateString('en-CA');
        const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA');
        const filters = {};
        if (dateFilter === 'today') filters.date = today;
        else if (dateFilter === 'tomorrow') filters.date = tomorrow;
        else if (dateFilter === 'custom' && customDate) filters.date = customDate;
        return filters;
    };

    useEffect(() => {
        fetchPreorders(getFilters());
    }, [dateFilter, customDate]);

    // Al cambiar de fecha, resetear el filtro de estado para mostrar todas las órdenes
    useEffect(() => {
        setStatusFilter('all');
    }, [dateFilter, customDate]);

    // El refresh principal es vía SSE (push en vivo, ver useEffect siguiente).
    // Este intervalo queda solo como red de seguridad por si el canal SSE muere
    // sin avisar (proxy raro, sleep del SO, etc.). 2 min en activo es invisible
    // para el operario y no genera carga.
    useEffect(() => {
        const stop = createSmartInterval(
            () => fetchPreorders(getFilters()),
            {
                label: 'production-fallback',
                activeMs: 2 * 60_000,
                idleMs: 5 * 60_000,
                pauseWhenHidden: true,
                pauseWhenOffline: true,
                runOnVisible: true,
                runOnActivity: false,
            }
        );
        return stop;
    }, [dateFilter, customDate]);

    // Canal Pusher en vivo: el backend publica `order.created`/`order.updated`
    // apenas miniveci dispara el POST. Sin polling, sin tener que refrescar.
    // Mantengo una sola suscripción durante toda la vida del componente; los
    // filtros se aplican vía `refreshRef` para no resuscribir el canal cuando
    // cambian.
    const refreshRef = useRef(() => { });
    refreshRef.current = () => fetchPreorders(getFilters());

    useEffect(() => {
        const key = import.meta.env.VITE_PUSHER_KEY;
        const cluster = import.meta.env.VITE_PUSHER_CLUSTER;
        if (!key || !cluster) {
            console.warn('📡 Pusher deshabilitado (faltan VITE_PUSHER_KEY/CLUSTER) — solo polling de fallback');
            return;
        }

        const pusher = new Pusher(key, {
            cluster,
            forceTLS: true,
            enabledTransports: ['ws', 'wss'],
        });

        pusher.connection.bind('connected', () => {
            console.log('📡 Pusher conectado — pedidos en vivo activos');
        });
        pusher.connection.bind('error', (err) => {
            console.warn('📡 Pusher error de conexión:', err?.error?.data?.message || err);
        });

        const channel = pusher.subscribe('preorders');
        const onMutation = (label) => (data) => {
            console.log(`📡 Pusher ${label}:`, data?.public_code || data?.id || data);
            refreshRef.current();
        };
        channel.bind('order.created', onMutation('order.created'));
        channel.bind('order.updated', onMutation('order.updated'));

        return () => {
            try {
                channel.unbind_all();
                pusher.unsubscribe('preorders');
                pusher.disconnect();
            } catch { /* ignore */ }
        };
    }, []);

    // Detectar nuevos pedidos: solo suena si el pedido es para HOY.
    useEffect(() => {
        const today = new Date().toLocaleDateString('en-CA');
        const currentIds = new Set(preorders.map(p => p.id));

        // Primer render: solo poblar la referencia, sin sonar
        if (seenIdsRef.current === null) {
            seenIdsRef.current = currentIds;
            return;
        }

        const newOrders = preorders.filter(
            p => !seenIdsRef.current.has(p.id) && p.due_date === today
        );

        if (newOrders.length > 0) {
            playNewOrderSound();
        }

        seenIdsRef.current = currentIds;
    }, [preorders]);

    const handleStatusChange = async (preorderId, newStatus) => {
        await updatePreorderStatus(preorderId, newStatus);
        fetchPreorders(getFilters());
    };

    const handleReject = async (preorderId, reason) => {
        await updatePreorderStatus(preorderId, 'canceled', reason);
        fetchPreorders(getFilters());
    };

    // Summary counts
    const counts = useMemo(() => ({
        pending: preorders.filter(p => p.status === 'pending' || p.status === 'confirmed').length,
        preparing: preorders.filter(p => p.status === 'preparing').length,
        completed: preorders.filter(p => p.status === 'ready' || p.status === 'out_for_delivery' || p.status === 'delivered').length,
    }), [preorders]);

    // Filtered preorders for table
    const filteredPreorders = useMemo(() => {
        return preorders.filter(p => {
            if (statusFilter === 'pending') return p.status === 'pending' || p.status === 'confirmed';
            if (statusFilter === 'preparing') return p.status === 'preparing';
            if (statusFilter === 'ready') return p.status === 'ready' || p.status === 'out_for_delivery' || p.status === 'delivered';
            return p.status !== 'canceled';
        });
    }, [preorders, statusFilter]);

    // Total a producir: agrupa todos los productos de las órdenes filtradas
    // sumando las cantidades por nombre de producto. Permite al panadero saber
    // de un vistazo cuánto debe preparar en total de cada producto.
    const productionTotals = useMemo(() => {
        const map = new Map();
        filteredPreorders.forEach(order => {
            // Solo contar lo que aún hay que producir (excluye lo ya hecho/entregado/cancelado)
            if (['ready', 'out_for_delivery', 'delivered', 'canceled'].includes(order.status)) return;
            const items = parseItemsSummary(order.items_summary);
            items.forEach(it => {
                const qty = parseFloat(String(it.qty).replace(',', '.')) || 0;
                const prev = map.get(it.name) || 0;
                map.set(it.name, prev + qty);
            });
        });
        return Array.from(map.entries())
            .map(([name, qty]) => ({
                name,
                qty: Number.isInteger(qty) ? String(qty) : qty.toFixed(2).replace(/\.?0+$/, '')
            }))
            .sort((a, b) => parseFloat(b.qty) - parseFloat(a.qty));
    }, [filteredPreorders]);

    const canManage = can('production.manage');

    // Summary card config — also act as status filters
    const summaryCards = [
        {
            icon: Clock,
            label: 'Órdenes Pendientes',
            count: counts.pending,
            filterKey: 'pending',
            borderColor: 'border-l-amber-500',
            textColor: 'text-amber-600 dark:text-amber-400',
            bg: 'bg-amber-50 dark:bg-amber-500/10',
            iconColor: 'text-amber-600 dark:text-amber-400',
            iconBg: 'bg-amber-100 dark:bg-amber-500/20',
            ringColor: 'ring-amber-500'
        },
        {
            icon: ChefHat,
            label: 'En Preparación',
            count: counts.preparing,
            filterKey: 'preparing',
            borderColor: 'border-l-blue-500',
            textColor: 'text-blue-600 dark:text-blue-400',
            bg: 'bg-blue-50 dark:bg-blue-500/10',
            iconColor: 'text-blue-600 dark:text-blue-400',
            iconBg: 'bg-blue-100 dark:bg-blue-500/20',
            ringColor: 'ring-blue-500'
        },
        {
            icon: Check,
            label: 'Órdenes Completas',
            count: counts.completed,
            filterKey: 'ready',
            borderColor: 'border-l-emerald-500',
            textColor: 'text-emerald-600 dark:text-emerald-400',
            bg: 'bg-emerald-50 dark:bg-emerald-500/10',
            iconColor: 'text-emerald-600 dark:text-emerald-400',
            iconBg: 'bg-emerald-100 dark:bg-emerald-500/20',
            ringColor: 'ring-emerald-500'
        },
    ];

    return (
        <div className="flex flex-col h-[calc(100vh-100px)] gap-5">
            {/* ===== HEADER ===== */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
                        <ChefHat size={22} className="text-white" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-[var(--color-text)]">Producción</h1>
                        <p className="text-xs text-[var(--color-text-muted)]">Pantalla de cocina · Tiempo real</p>
                    </div>
                </div>

                {/* Date Filters */}
                <div className="flex items-center gap-2 flex-wrap">
                    {[
                        { key: 'today', label: 'Hoy' },
                        { key: 'tomorrow', label: 'Mañana' },
                        { key: 'custom', label: '📅 Fecha' },
                    ].map(f => (
                        <button key={f.key} onClick={() => setDateFilter(f.key)}
                            className={cn("px-4 py-2 rounded-xl text-sm font-semibold transition-all border",
                                dateFilter === f.key
                                    ? "bg-[var(--color-primary)] text-black border-[var(--color-primary)] shadow-lg shadow-[var(--color-primary)]/20"
                                    : "bg-[var(--glass-bg)] text-[var(--color-text-muted)] border-[var(--glass-border)] hover:border-[var(--color-primary)]/50 hover:text-[var(--color-text)]"
                            )}>
                            {f.label}
                        </button>
                    ))}
                    {dateFilter === 'custom' && (
                        <input type="date" value={customDate} onChange={e => setCustomDate(e.target.value)}
                            className="glass-input text-sm py-2 px-3 rounded-xl" />
                    )}
                </div>
            </div>

            {/* ===== SUMMARY CARDS — also work as status filters ===== */}
            <div className="grid grid-cols-3 gap-3 sm:gap-4 shrink-0">
                {summaryCards.map((card, i) => {
                    const Icon = card.icon;
                    const isActive = statusFilter === card.filterKey;
                    return (
                        <button key={i}
                            type="button"
                            onClick={() => setStatusFilter(isActive ? 'all' : card.filterKey)}
                            title={isActive ? 'Click para ver todos' : `Filtrar: ${card.label}`}
                            className={cn(
                                "relative overflow-hidden rounded-xl border-l-[6px] p-3 sm:p-4 transition-all shadow-sm text-left cursor-pointer hover:scale-[1.02] hover:shadow-md",
                                card.bg,
                                card.borderColor,
                                isActive && cn("ring-2 ring-offset-2 ring-offset-[var(--color-bg)] scale-[1.02] shadow-lg", card.ringColor)
                            )}>
                            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                                <div className={cn("p-2 rounded-lg flex items-center justify-center shrink-0", card.iconBg)}>
                                    <Icon size={20} className={card.iconColor} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[10px] sm:text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider truncate">
                                        {card.label}
                                    </p>
                                    <p className={cn("text-2xl sm:text-3xl font-black mt-0.5 tracking-tight", card.textColor)}>
                                        {card.count}
                                    </p>
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>

            {/* ===== TOTAL A PRODUCIR (agregado por producto) ===== */}
            {productionTotals.length > 0 && (
                <div className="shrink-0 rounded-2xl border border-[var(--glass-border)] bg-gradient-to-br from-amber-500/[0.07] via-orange-500/[0.04] to-transparent overflow-hidden">
                    <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-[var(--glass-border)] bg-black/10 dark:bg-white/[0.02]">
                        <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-md shadow-amber-500/25 shrink-0">
                                <Package size={16} className="text-white" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-sm font-bold text-[var(--color-text)] truncate">Total a Producir</p>
                                <p className="text-[11px] text-[var(--color-text-muted)] truncate">
                                    Suma por producto de todas las órdenes pendientes en cocina
                                </p>
                            </div>
                        </div>
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500/15 text-amber-400 border border-amber-500/25 tabular-nums shrink-0">
                            {productionTotals.length} {productionTotals.length === 1 ? 'producto' : 'productos'}
                        </span>
                    </div>
                    <div className="p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2.5">
                        {productionTotals.map((p, i) => (
                            <div key={i}
                                className="group flex items-center gap-3 rounded-xl bg-[var(--color-surface)] border border-[var(--glass-border)] p-2.5 hover:border-[var(--color-primary)]/40 hover:shadow-md transition-all">
                                <div className="flex flex-col items-center justify-center min-w-[3.75rem] py-1.5 px-2 rounded-lg bg-gradient-to-br from-[var(--color-primary)]/20 to-[var(--color-primary)]/5 border border-[var(--color-primary)]/30">
                                    <span className="text-lg font-black text-[var(--color-primary)] leading-none tabular-nums">
                                        {p.qty}
                                    </span>
                                    <span className="text-[9px] font-bold text-[var(--color-primary)]/80 uppercase tracking-wider mt-0.5">
                                        und
                                    </span>
                                </div>
                                <p className="text-sm font-semibold text-[var(--color-text)] leading-snug line-clamp-2 flex-1 min-w-0">
                                    {p.name}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ===== TOOLBAR: reset filter + view toggle ===== */}
            <div className="flex items-center justify-between gap-3 shrink-0 flex-wrap">
                {statusFilter !== 'all' ? (
                    <button
                        type="button"
                        onClick={() => setStatusFilter('all')}
                        className="px-4 py-2 rounded-xl text-sm font-semibold transition-all border bg-[var(--color-primary)] text-black border-[var(--color-primary)] shadow-lg shadow-[var(--color-primary)]/20 hover:opacity-90"
                    >
                        Ver Todos
                    </button>
                ) : <span />}

                {/* View toggle: lista | tarjetas */}
                <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)]">
                    <button
                        type="button"
                        onClick={() => setViewMode('list')}
                        title="Vista de lista"
                        className={cn(
                            "px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all",
                            viewMode === 'list'
                                ? "bg-[var(--color-primary)] text-black shadow"
                                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                        )}>
                        <List size={14} />
                        Lista
                    </button>
                    <button
                        type="button"
                        onClick={() => setViewMode('cards')}
                        title="Vista de tarjetas (boletas)"
                        className={cn(
                            "px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all",
                            viewMode === 'cards'
                                ? "bg-[var(--color-primary)] text-black shadow"
                                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                        )}>
                        <LayoutGrid size={14} />
                        Tarjetas
                    </button>
                </div>
            </div>

            {/* ===== TABLE / CARDS ===== */}
            <div className="flex-1 overflow-hidden rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)]">
                {filteredPreorders.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-[var(--color-text-muted)] gap-3">
                        <span className="text-6xl opacity-30">🍽️</span>
                        <p className="text-lg font-semibold">No hay órdenes</p>
                        <p className="text-sm opacity-60">Las órdenes de encargos aparecerán aquí automáticamente</p>
                    </div>
                ) : (
                    <>
                        {/* Desktop: Lista (tabla) */}
                        {viewMode === 'list' && (
                        <div className="hidden lg:block h-full overflow-y-auto">
                            <table className="w-full">
                                <thead className="sticky top-0 z-10 bg-[var(--color-surface)]/95 backdrop-blur-xl">
                                    <tr className="border-b border-[var(--glass-border)]">
                                        <th className="text-left py-3.5 px-5 text-[11px] uppercase tracking-widest font-bold text-[var(--color-text-muted)]">Hora</th>
                                        <th className="text-left py-3.5 px-5 text-[11px] uppercase tracking-widest font-bold text-[var(--color-text-muted)]">Cliente</th>
                                        <th className="text-left py-3.5 px-5 text-[11px] uppercase tracking-widest font-bold text-[var(--color-text-muted)]">Productos</th>
                                        <th className="text-center py-3.5 px-5 text-[11px] uppercase tracking-widest font-bold text-[var(--color-text-muted)]">Ítems</th>
                                        <th className="text-left py-3.5 px-5 text-[11px] uppercase tracking-widest font-bold text-[var(--color-text-muted)]">Notas</th>
                                        <th className="text-center py-3.5 px-5 text-[11px] uppercase tracking-widest font-bold text-[var(--color-text-muted)]">Estado</th>
                                        <th className="text-center py-3.5 px-5 text-[11px] uppercase tracking-widest font-bold text-[var(--color-text-muted)]">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredPreorders.map((order, idx) => {
                                        const config = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
                                        const StatusIcon = config.icon;
                                        const parsedItems = parseItemsSummary(order.items_summary);
                                        const itemsCount = parsedItems.length;

                                        return (
                                            <tr key={order.id}
                                                className={cn(
                                                    "hover:bg-white/[0.03] transition-all cursor-pointer group",
                                                    idx < filteredPreorders.length - 1 && "border-b border-[var(--glass-border)]/50"
                                                )}
                                                onClick={() => setSelectedPreorder(order)}>
                                                <td className="py-4 px-5 align-top">
                                                    <div className="flex flex-col">
                                                        <span className="text-sm font-bold text-[var(--color-primary)]">{order.due_time}</span>
                                                        <span className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{order.due_date}</span>
                                                    </div>
                                                </td>
                                                <td className="py-4 px-5 align-top">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs shadow-md shadow-purple-500/20">
                                                            {(order.client_name || 'S')[0].toUpperCase()}
                                                        </div>
                                                        <div className="flex flex-col gap-1 min-w-0">
                                                            <span className="text-sm font-semibold text-[var(--color-text)] truncate">{order.client_name || 'Sin nombre'}</span>
                                                            <ExternalSourceBadge preorder={order} />
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="py-4 px-5 align-top">
                                                    {parsedItems.length > 0 ? (
                                                        <ul className="flex flex-col gap-1.5 max-w-[340px]">
                                                            {parsedItems.map((it, i) => (
                                                                <li key={i} className="flex items-center gap-2.5">
                                                                    <span className="inline-flex items-center justify-center min-w-[3rem] h-7 px-2 rounded-lg text-xs font-black bg-[var(--color-primary)]/15 text-[var(--color-primary)] border border-[var(--color-primary)]/25 tabular-nums">
                                                                        {it.qty} und
                                                                    </span>
                                                                    <span className="text-sm text-[var(--color-text)] leading-snug">{it.name}</span>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    ) : (
                                                        <span className="text-xs text-[var(--color-text-muted)] opacity-40">Sin productos</span>
                                                    )}
                                                </td>
                                                <td className="py-4 px-5 text-center align-top">
                                                    <div className="inline-flex flex-col items-center">
                                                        <span className="inline-flex items-center justify-center min-w-[2.25rem] h-9 px-2.5 text-sm font-bold text-[var(--color-text)] bg-[var(--glass-bg)] rounded-xl border border-[var(--glass-border)] tabular-nums">
                                                            {itemsCount}
                                                        </span>
                                                        <span className="text-[10px] text-[var(--color-text-muted)] mt-1 uppercase tracking-wider">
                                                            {itemsCount === 1 ? 'ítem' : 'ítems'}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="py-4 px-5 align-top">
                                                    {order.notes ? (
                                                        <p className="text-xs text-amber-400 line-clamp-2 max-w-[180px] italic flex items-start gap-1">
                                                            <span className="shrink-0">📝</span> {order.notes}
                                                        </p>
                                                    ) : (
                                                        <span className="text-xs text-[var(--color-text-muted)] opacity-40">—</span>
                                                    )}
                                                </td>
                                                <td className="py-4 px-5 text-center align-top">
                                                    <span className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border", config.color)}>
                                                        <StatusIcon size={12} />
                                                        {config.label}
                                                    </span>
                                                </td>
                                                <td className="py-4 px-5 align-top">
                                                    <div className="flex items-center justify-center gap-2 flex-wrap" onClick={e => e.stopPropagation()}>
                                                        <ProductionActions
                                                            order={order}
                                                            canManage={canManage}
                                                            onAction={handleStatusChange}
                                                            onReject={setRejectingOrder}
                                                            layout="inline"
                                                        />
                                                        <button onClick={() => setSelectedPreorder(order)}
                                                            className="px-3 py-2 rounded-xl text-xs font-semibold text-[var(--color-text-muted)] border border-[var(--glass-border)] hover:border-[var(--color-primary)]/50 hover:text-[var(--color-primary)] transition-all flex items-center gap-1.5">
                                                            <Eye size={13} />
                                                            Ver
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        )}

                        {/* Desktop: Tarjetas tipo boleta */}
                        {viewMode === 'cards' && (
                        <div className="hidden lg:block h-full overflow-y-auto p-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
                                {filteredPreorders.map(order => {
                                    const config = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
                                    const StatusIcon = config.icon;
                                    const parsedItems = parseItemsSummary(order.items_summary);
                                    return (
                                        <div key={order.id}
                                            onClick={() => setSelectedPreorder(order)}
                                            className={cn(
                                                "relative flex flex-col rounded-2xl border-t-[6px] bg-[var(--color-surface)] shadow-md hover:shadow-xl hover:-translate-y-0.5 transition-all cursor-pointer overflow-hidden",
                                                order.status === 'pending' && 'border-amber-500',
                                                order.status === 'confirmed' && 'border-cyan-500',
                                                order.status === 'preparing' && 'border-blue-500',
                                                order.status === 'ready' && 'border-emerald-500',
                                                order.status === 'out_for_delivery' && 'border-indigo-500',
                                                order.status === 'delivered' && 'border-gray-500',
                                                order.status === 'canceled' && 'border-red-500',
                                            )}>
                                            {/* Cabecera tipo boleta: cliente */}
                                            <div className="px-4 pt-4 pb-3 border-b border-dashed border-[var(--glass-border)]">
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="flex items-center gap-2.5 min-w-0">
                                                        <div className="w-10 h-10 shrink-0 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm shadow-md shadow-purple-500/20">
                                                            {(order.client_name || 'S')[0].toUpperCase()}
                                                        </div>
                                                        <div className="min-w-0">
                                                            <p className="text-base font-bold text-[var(--color-text)] truncate">
                                                                {order.client_name || 'Sin nombre'}
                                                            </p>
                                                            <p className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-2 mt-0.5">
                                                                <span className="font-bold text-[var(--color-primary)]">🕐 {order.due_time}</span>
                                                                <span>·</span>
                                                                <span>{order.due_date}</span>
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border shrink-0", config.color)}>
                                                        <StatusIcon size={10} />
                                                        {config.label}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-2 mt-2 flex-wrap">
                                                    <p className="text-[10px] text-[var(--color-text-muted)] font-mono">Orden #{order.id}</p>
                                                    <ExternalSourceBadge preorder={order} />
                                                </div>
                                            </div>

                                            {/* Productos */}
                                            <div className="flex-1 px-4 py-3">
                                                <p className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Productos</p>
                                                {parsedItems.length > 0 ? (
                                                    <ul className="flex flex-col gap-1.5">
                                                        {parsedItems.map((it, i) => (
                                                            <li key={i} className="flex items-center gap-2.5">
                                                                <span className="inline-flex items-center justify-center min-w-[3rem] h-7 px-2 rounded-lg text-xs font-black bg-[var(--color-primary)]/15 text-[var(--color-primary)] border border-[var(--color-primary)]/25 tabular-nums">
                                                                    {it.qty} und
                                                                </span>
                                                                <span className="text-sm text-[var(--color-text)] leading-snug">{it.name}</span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                ) : (
                                                    <span className="text-xs text-[var(--color-text-muted)] opacity-60">Sin productos</span>
                                                )}
                                                {order.notes && (
                                                    <p className="mt-3 text-xs text-amber-400 italic flex items-start gap-1.5 bg-amber-500/5 border border-amber-500/15 rounded-lg p-2">
                                                        <span className="shrink-0">📝</span> {order.notes}
                                                    </p>
                                                )}
                                            </div>

                                            {/* Pie con acciones */}
                                            <div className="px-4 py-3 border-t border-dashed border-[var(--glass-border)] bg-black/5 dark:bg-white/[0.02]"
                                                onClick={e => e.stopPropagation()}>
                                                {canManage && (getForwardActions(order).length > 0 || canRejectOrder(order)) ? (
                                                    <div className="flex gap-2">
                                                        <ProductionActions
                                                            order={order}
                                                            canManage={canManage}
                                                            onAction={handleStatusChange}
                                                            onReject={setRejectingOrder}
                                                            layout="block"
                                                        />
                                                        <button onClick={() => setSelectedPreorder(order)}
                                                            className="px-3 py-2.5 rounded-xl text-xs font-semibold text-[var(--color-text-muted)] border border-[var(--glass-border)] hover:border-[var(--color-primary)]/50 hover:text-[var(--color-primary)] transition-all flex items-center gap-1.5">
                                                            <Eye size={14} />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button onClick={() => setSelectedPreorder(order)}
                                                        className="w-full py-2.5 rounded-xl text-xs font-semibold text-[var(--color-text-muted)] border border-[var(--glass-border)] hover:border-[var(--color-primary)]/50 hover:text-[var(--color-primary)] transition-all flex items-center justify-center gap-1.5">
                                                        <Eye size={14} /> Ver detalles
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                        )}

                        {/* Mobile Cards */}
                        <div className="lg:hidden h-full overflow-y-auto space-y-3 p-3">
                            {filteredPreorders.map(order => {
                                const config = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
                                const StatusIcon = config.icon;
                                const parsedItems = parseItemsSummary(order.items_summary);

                                return (
                                    <div key={order.id}
                                        onClick={() => setSelectedPreorder(order)}
                                        className="rounded-2xl p-4 cursor-pointer transition-all border border-[var(--glass-border)] hover:border-[var(--color-primary)]/30 space-y-3 active:scale-[0.99] bg-[var(--color-surface)]">
                                        {/* Top row: status + time */}
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border", config.color)}>
                                                    <StatusIcon size={12} />
                                                    {config.label}
                                                </span>
                                                <span className="text-[10px] text-[var(--color-text-muted)] font-medium">#{order.id}</span>
                                                <ExternalSourceBadge preorder={order} />
                                            </div>
                                            <div className="text-right">
                                                <p className="text-sm font-bold text-[var(--color-primary)]">🕐 {order.due_time}</p>
                                                <p className="text-[10px] text-[var(--color-text-muted)]">{order.due_date}</p>
                                            </div>
                                        </div>

                                        {/* Client */}
                                        <p className="text-sm font-bold text-[var(--color-text)] flex items-center gap-1.5">
                                            <User size={14} className="text-[var(--color-primary)]" />
                                            {order.client_name || 'Sin nombre'}
                                        </p>

                                        {/* Products list */}
                                        {parsedItems.length > 0 && (
                                            <ul className="flex flex-col gap-1.5 rounded-xl bg-black/10 dark:bg-white/[0.03] border border-[var(--glass-border)] p-2.5">
                                                {parsedItems.map((it, i) => (
                                                    <li key={i} className="flex items-center gap-2.5">
                                                        <span className="inline-flex items-center justify-center min-w-[2.75rem] h-6 px-1.5 rounded-md text-[11px] font-black bg-[var(--color-primary)]/15 text-[var(--color-primary)] border border-[var(--color-primary)]/25 tabular-nums">
                                                            {it.qty} und
                                                        </span>
                                                        <span className="text-xs text-[var(--color-text)] leading-snug">{it.name}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}

                                        {order.notes && (
                                            <p className="text-xs text-amber-400 italic">📝 {order.notes}</p>
                                        )}

                                        {/* Quick action */}
                                        {canManage && (getForwardActions(order).length > 0 || canRejectOrder(order)) && (
                                            <div className="flex gap-2 pt-1" onClick={e => e.stopPropagation()}>
                                                <ProductionActions
                                                    order={order}
                                                    canManage={canManage}
                                                    onAction={handleStatusChange}
                                                    onReject={setRejectingOrder}
                                                    layout="block"
                                                />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>

            {/* Detail Modal */}
            {selectedPreorder && (
                <ProductionDetailModal
                    preorder={selectedPreorder}
                    onClose={() => setSelectedPreorder(null)}
                    onStatusChange={handleStatusChange}
                    onReject={setRejectingOrder}
                    canManage={canManage}
                />
            )}

            {/* Reject Reason Modal */}
            {rejectingOrder && (
                <RejectReasonModal
                    order={rejectingOrder}
                    onClose={() => setRejectingOrder(null)}
                    onConfirm={handleReject}
                />
            )}
        </div>
    );
};

export default Production;
