import React, { useState, useEffect, useMemo } from 'react';
import {
    Clock, User, ChefHat, Check, X, AlertTriangle,
    Calendar, Filter, Package, Search, Eye, ChevronDown, Truck
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';
import { formatCurrency } from '../utils/formatCurrency';
import { usePermissions } from '../hooks/usePermissions';

// ========== STATUS CONFIG ==========
const STATUS_CONFIG = {
    pending: { label: 'Pendiente', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30', dotColor: 'bg-amber-400', icon: Clock },
    preparing: { label: 'En Preparación', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', dotColor: 'bg-blue-400', icon: Package },
    ready: { label: 'Listo', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', dotColor: 'bg-emerald-400', icon: Check },
    delivered: { label: 'Entregado', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30', dotColor: 'bg-gray-400', icon: Truck },
    canceled: { label: 'Cancelado', color: 'bg-red-500/20 text-red-400 border-red-500/30', dotColor: 'bg-red-400', icon: X },
};

// ========== DETAIL MODAL ==========
const ProductionDetailModal = ({ preorder, onClose, onStatusChange }) => {
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
                            <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border", config.color)}>
                                <StatusIcon size={10} /> {config.label}
                            </span>
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
                                {preorder.status === 'pending' && (
                                    <button onClick={() => { onStatusChange(preorder.id, 'preparing'); onClose(); }}
                                        className="flex-1 py-3 rounded-xl font-bold text-sm bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:from-blue-500 hover:to-blue-400 transition-all shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2 active:scale-[0.98]">
                                        <ChefHat size={16} />
                                        Empezar Preparación
                                    </button>
                                )}
                                {preorder.status === 'preparing' && (
                                    <button onClick={() => { onStatusChange(preorder.id, 'ready'); onClose(); }}
                                        className="flex-1 py-3 rounded-xl font-bold text-sm bg-gradient-to-r from-emerald-600 to-emerald-500 text-white hover:from-emerald-500 hover:to-emerald-400 transition-all shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2 active:scale-[0.98]">
                                        <Check size={16} />
                                        Marcar Listo
                                    </button>
                                )}
                                {preorder.status === 'ready' && (
                                    <button onClick={() => { onStatusChange(preorder.id, 'delivered'); onClose(); }}
                                        className="flex-1 py-3 rounded-xl font-bold text-sm bg-gradient-to-r from-emerald-600 to-emerald-500 text-white hover:from-emerald-500 hover:to-emerald-400 transition-all shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2 active:scale-[0.98]">
                                        <Truck size={16} />
                                        Entregar
                                    </button>
                                )}
                                <button onClick={() => { onStatusChange(preorder.id, 'canceled'); onClose(); }}
                                    className="py-3 px-5 rounded-xl font-bold text-sm bg-red-500/15 text-red-400 border border-red-500/25 hover:bg-red-500/25 transition-all flex items-center justify-center gap-2 active:scale-[0.98]">
                                    <X size={16} />
                                    Rechazar
                                </button>
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

    // Build filters
    const getFilters = () => {
        const today = new Date().toLocaleDateString('en-CA');
        const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA');
        const filters = { status: statusFilter };
        if (dateFilter === 'today') filters.date = today;
        else if (dateFilter === 'tomorrow') filters.date = tomorrow;
        else if (dateFilter === 'custom' && customDate) filters.date = customDate;
        return filters;
    };

    useEffect(() => {
        fetchPreorders(getFilters());
    }, [dateFilter, customDate, statusFilter]);

    // Auto-refresh every 30 seconds
    useEffect(() => {
        const interval = setInterval(() => fetchPreorders(getFilters()), 30000);
        return () => clearInterval(interval);
    }, [dateFilter, customDate, statusFilter]);

    const handleStatusChange = async (preorderId, newStatus) => {
        await updatePreorderStatus(preorderId, newStatus);
        fetchPreorders(getFilters());
    };

    // Summary counts
    const counts = useMemo(() => ({
        pending: preorders.filter(p => p.status === 'pending').length,
        preparing: preorders.filter(p => p.status === 'preparing').length,
        completed: preorders.filter(p => p.status === 'ready' || p.status === 'delivered').length,
    }), [preorders]);

    // Filtered preorders for table
    const filteredPreorders = useMemo(() => {
        return preorders.filter(p => {
            if (statusFilter === 'pending') return p.status === 'pending';
            if (statusFilter === 'preparing') return p.status === 'preparing';
            if (statusFilter === 'ready') return p.status === 'ready' || p.status === 'delivered';
            return p.status !== 'canceled';
        });
    }, [preorders, statusFilter]);

    const canManage = can('production.manage');

    // Summary card config
    const summaryCards = [
        {
            icon: Clock,
            label: 'Órdenes Pendientes',
            count: counts.pending,
            borderColor: 'border-l-amber-500',
            textColor: 'text-amber-600 dark:text-amber-400',
            bg: 'bg-amber-50 dark:bg-amber-500/10',
            iconColor: 'text-amber-600 dark:text-amber-400',
            iconBg: 'bg-amber-100 dark:bg-amber-500/20'
        },
        {
            icon: ChefHat,
            label: 'En Preparación',
            count: counts.preparing,
            borderColor: 'border-l-blue-500',
            textColor: 'text-blue-600 dark:text-blue-400',
            bg: 'bg-blue-50 dark:bg-blue-500/10',
            iconColor: 'text-blue-600 dark:text-blue-400',
            iconBg: 'bg-blue-100 dark:bg-blue-500/20'
        },
        {
            icon: Check,
            label: 'Órdenes Completas',
            count: counts.completed,
            borderColor: 'border-l-emerald-500',
            textColor: 'text-emerald-600 dark:text-emerald-400',
            bg: 'bg-emerald-50 dark:bg-emerald-500/10',
            iconColor: 'text-emerald-600 dark:text-emerald-400',
            iconBg: 'bg-emerald-100 dark:bg-emerald-500/20'
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

            {/* ===== SUMMARY CARDS — horizontal like the reference ===== */}
            <div className="grid grid-cols-3 gap-3 sm:gap-4 shrink-0">
                {summaryCards.map((card, i) => {
                    const Icon = card.icon;
                    return (
                        <div key={i}
                            className={cn(
                                "relative overflow-hidden rounded-xl border-l-[6px] p-3 sm:p-4 transition-all shadow-sm",
                                card.bg,
                                card.borderColor
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
                        </div>
                    );
                })}
            </div>

            {/* ===== STATUS TABS ===== */}
            <div className="flex gap-2 shrink-0 flex-wrap">
                {[
                    { key: 'all', label: 'Todos' },
                    { key: 'pending', label: '⏳ Pendiente', dotColor: 'bg-amber-400' },
                    { key: 'preparing', label: '🍳 En Preparación', dotColor: 'bg-blue-400' },
                    { key: 'ready', label: '✅ Listo / Entregado', dotColor: 'bg-emerald-400' },
                ].map(tab => (
                    <button key={tab.key} onClick={() => setStatusFilter(tab.key)}
                        className={cn("px-4 py-2.5 rounded-xl text-sm font-semibold transition-all border flex items-center gap-2",
                            statusFilter === tab.key
                                ? "bg-[var(--color-primary)] text-black border-[var(--color-primary)] shadow-lg shadow-[var(--color-primary)]/20"
                                : "bg-[var(--glass-bg)] text-[var(--color-text-muted)] border-[var(--glass-border)] hover:border-[var(--color-primary)]/50 hover:text-[var(--color-text)]"
                        )}>
                        {tab.dotColor && statusFilter !== tab.key && <span className={cn("w-2 h-2 rounded-full", tab.dotColor)} />}
                        {tab.label}
                    </button>
                ))}
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
                        {/* Desktop Table */}
                        <div className="hidden lg:block h-full overflow-y-auto">
                            <table className="w-full">
                                <thead className="sticky top-0 z-10 bg-[var(--color-surface)]/95 backdrop-blur-xl">
                                    <tr className="border-b border-[var(--glass-border)]">
                                        <th className="text-left py-3.5 px-5 text-[11px] uppercase tracking-widest font-bold text-[var(--color-text-muted)]">Hora</th>
                                        <th className="text-left py-3.5 px-5 text-[11px] uppercase tracking-widest font-bold text-[var(--color-text-muted)]">Cliente</th>
                                        <th className="text-left py-3.5 px-5 text-[11px] uppercase tracking-widest font-bold text-[var(--color-text-muted)]">Productos</th>
                                        <th className="text-center py-3.5 px-5 text-[11px] uppercase tracking-widest font-bold text-[var(--color-text-muted)]">Cant.</th>
                                        <th className="text-left py-3.5 px-5 text-[11px] uppercase tracking-widest font-bold text-[var(--color-text-muted)]">Notas</th>
                                        <th className="text-center py-3.5 px-5 text-[11px] uppercase tracking-widest font-bold text-[var(--color-text-muted)]">Estado</th>
                                        <th className="text-center py-3.5 px-5 text-[11px] uppercase tracking-widest font-bold text-[var(--color-text-muted)]">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredPreorders.map((order, idx) => {
                                        const config = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
                                        const StatusIcon = config.icon;
                                        const totalQty = order.items_summary
                                            ? order.items_summary.split(',').reduce((sum, item) => {
                                                const match = item.trim().match(/x(\d+)/);
                                                return sum + (match ? parseInt(match[1]) : 0);
                                            }, 0)
                                            : 0;

                                        return (
                                            <tr key={order.id}
                                                className={cn(
                                                    "hover:bg-white/[0.03] transition-all cursor-pointer group",
                                                    idx < filteredPreorders.length - 1 && "border-b border-[var(--glass-border)]/50"
                                                )}
                                                onClick={() => setSelectedPreorder(order)}>
                                                <td className="py-4 px-5">
                                                    <div className="flex flex-col">
                                                        <span className="text-sm font-bold text-[var(--color-primary)]">{order.due_time}</span>
                                                        <span className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{order.due_date}</span>
                                                    </div>
                                                </td>
                                                <td className="py-4 px-5">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs shadow-md shadow-purple-500/20">
                                                            {(order.client_name || 'S')[0].toUpperCase()}
                                                        </div>
                                                        <span className="text-sm font-semibold text-[var(--color-text)]">{order.client_name || 'Sin nombre'}</span>
                                                    </div>
                                                </td>
                                                <td className="py-4 px-5">
                                                    <p className="text-sm text-[var(--color-text)] line-clamp-2 max-w-[260px] leading-relaxed">{order.items_summary}</p>
                                                </td>
                                                <td className="py-4 px-5 text-center">
                                                    <span className="inline-flex items-center justify-center w-9 h-9 text-sm font-bold text-[var(--color-text)] bg-[var(--glass-bg)] rounded-xl border border-[var(--glass-border)]">
                                                        {totalQty}
                                                    </span>
                                                </td>
                                                <td className="py-4 px-5">
                                                    {order.notes ? (
                                                        <p className="text-xs text-amber-400 line-clamp-2 max-w-[180px] italic flex items-start gap-1">
                                                            <span className="shrink-0">📝</span> {order.notes}
                                                        </p>
                                                    ) : (
                                                        <span className="text-xs text-[var(--color-text-muted)] opacity-40">—</span>
                                                    )}
                                                </td>
                                                <td className="py-4 px-5 text-center">
                                                    <span className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border", config.color)}>
                                                        <StatusIcon size={12} />
                                                        {config.label}
                                                    </span>
                                                </td>
                                                <td className="py-4 px-5">
                                                    <div className="flex items-center justify-center gap-2" onClick={e => e.stopPropagation()}>
                                                        {canManage && order.status === 'pending' && (
                                                            <button onClick={() => handleStatusChange(order.id, 'preparing')}
                                                                className="px-3.5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-md shadow-blue-500/20 hover:shadow-lg hover:shadow-blue-500/30 transition-all flex items-center gap-1.5 active:scale-95">
                                                                <ChefHat size={13} />
                                                                Empezar
                                                            </button>
                                                        )}
                                                        {canManage && order.status === 'preparing' && (
                                                            <button onClick={() => handleStatusChange(order.id, 'ready')}
                                                                className="px-3.5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-md shadow-emerald-500/20 hover:shadow-lg hover:shadow-emerald-500/30 transition-all flex items-center gap-1.5 active:scale-95">
                                                                <Check size={13} />
                                                                Listo
                                                            </button>
                                                        )}
                                                        {canManage && order.status === 'ready' && (
                                                            <button onClick={() => handleStatusChange(order.id, 'delivered')}
                                                                className="px-3.5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-md shadow-emerald-500/20 hover:shadow-lg hover:shadow-emerald-500/30 transition-all flex items-center gap-1.5 active:scale-95">
                                                                <Truck size={13} />
                                                                Entregar
                                                            </button>
                                                        )}
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

                        {/* Mobile Cards */}
                        <div className="lg:hidden h-full overflow-y-auto space-y-3 p-3">
                            {filteredPreorders.map(order => {
                                const config = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
                                const StatusIcon = config.icon;

                                return (
                                    <div key={order.id}
                                        onClick={() => setSelectedPreorder(order)}
                                        className="rounded-2xl p-4 cursor-pointer transition-all border border-[var(--glass-border)] hover:border-[var(--color-primary)]/30 space-y-3 active:scale-[0.99] bg-[var(--color-surface)]">
                                        {/* Top row: status + time */}
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border", config.color)}>
                                                    <StatusIcon size={12} />
                                                    {config.label}
                                                </span>
                                                <span className="text-[10px] text-[var(--color-text-muted)] font-medium">#{order.id}</span>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-sm font-bold text-[var(--color-primary)]">🕐 {order.due_time}</p>
                                                <p className="text-[10px] text-[var(--color-text-muted)]">{order.due_date}</p>
                                            </div>
                                        </div>

                                        {/* Client + products */}
                                        <div className="space-y-1.5">
                                            <p className="text-sm font-bold text-[var(--color-text)] flex items-center gap-1.5">
                                                <User size={14} className="text-[var(--color-primary)]" />
                                                {order.client_name || 'Sin nombre'}
                                            </p>
                                            <p className="text-xs text-[var(--color-text-muted)] line-clamp-2 leading-relaxed">{order.items_summary}</p>
                                            {order.notes && (
                                                <p className="text-xs text-amber-400 italic">📝 {order.notes}</p>
                                            )}
                                        </div>

                                        {/* Quick action */}
                                        {canManage && (order.status === 'pending' || order.status === 'preparing' || order.status === 'ready') && (
                                            <div className="flex gap-2 pt-1" onClick={e => e.stopPropagation()}>
                                                {order.status === 'pending' && (
                                                    <button onClick={() => handleStatusChange(order.id, 'preparing')}
                                                        className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-md shadow-blue-500/20 flex items-center justify-center gap-1.5 active:scale-95">
                                                        <ChefHat size={14} /> Empezar
                                                    </button>
                                                )}
                                                {order.status === 'preparing' && (
                                                    <button onClick={() => handleStatusChange(order.id, 'ready')}
                                                        className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-md shadow-emerald-500/20 flex items-center justify-center gap-1.5 active:scale-95">
                                                        <Check size={14} /> Listo
                                                    </button>
                                                )}
                                                {order.status === 'ready' && (
                                                    <button onClick={() => handleStatusChange(order.id, 'delivered')}
                                                        className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-md shadow-emerald-500/20 flex items-center justify-center gap-1.5 active:scale-95">
                                                        <Truck size={14} /> Entregar
                                                    </button>
                                                )}
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
                />
            )}
        </div>
    );
};

export default Production;
