import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, X, Check, CheckCheck, AlertTriangle, AlertCircle, TrendingDown, Trash2 } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '../lib/utils';
import { createSmartInterval } from '../lib/smartPolling';
import WebOrderCard from './WebOrderCard';

const NotificationBell = () => {
    const [isOpen, setIsOpen] = useState(false);
    const panelRef = useRef(null);
    const navigate = useNavigate();

    // FASE 10 · useShallow para evitar re-render con cualquier mutación del store.
    const {
        inventoryAlerts,
        unreadAlertCount,
        fetchInventoryAlerts,
        fetchUnreadAlertCount,
        markAlertRead,
        markAllAlertsRead,
        deleteOldAlerts,
        webOrders,
        currentCurrency,
        fetchPendingWebOrders,
        removeWebOrder,
        updatePreorderStatus,
    } = useStore(useShallow(s => ({
        inventoryAlerts: s.inventoryAlerts,
        unreadAlertCount: s.unreadAlertCount,
        fetchInventoryAlerts: s.fetchInventoryAlerts,
        fetchUnreadAlertCount: s.fetchUnreadAlertCount,
        markAlertRead: s.markAlertRead,
        markAllAlertsRead: s.markAllAlertsRead,
        deleteOldAlerts: s.deleteOldAlerts,
        webOrders: s.webOrders,
        currentCurrency: s.currentCurrency,
        fetchPendingWebOrders: s.fetchPendingWebOrders,
        removeWebOrder: s.removeWebOrder,
        updatePreorderStatus: s.updatePreorderStatus,
    })));

    const totalBadge = unreadAlertCount + (webOrders?.length || 0);

    const handleAcceptWebOrder = async (id) => {
        await updatePreorderStatus(id, 'confirmed');
        removeWebOrder(id);
    };
    const handleRejectWebOrder = async (id) => {
        if (!window.confirm('¿Rechazar este encargo? El cliente verá que fue rechazado.')) return;
        await updatePreorderStatus(id, 'canceled', 'Rechazado desde el aviso de encargo web');
        removeWebOrder(id);
    };
    const handleViewWebOrder = (id) => {
        setIsOpen(false);
        navigate('/preorders', { state: { tab: 'list', focusPreorderId: id } });
    };

    // FASE 9 · Polling inteligente del badge de alertas:
    // 2min con actividad / 10min idle, pausa tab oculta y sin conexión.
    useEffect(() => {
        fetchUnreadAlertCount();
        const stop = createSmartInterval(fetchUnreadAlertCount, {
            label: 'notif-bell',
            activeMs: 2 * 60_000,
            idleMs: 10 * 60_000,
            pauseWhenHidden: true,
            pauseWhenOffline: true,
            runOnVisible: true,
            runOnActivity: true,
        });
        return stop;
    }, []);

    // Fetch alerts when panel opens
    useEffect(() => {
        if (isOpen) {
            fetchInventoryAlerts(30);
            fetchPendingWebOrders(); // reconciliar encargos web (cae los ya atendidos)
        }
    }, [isOpen]);

    // Close on outside click
    useEffect(() => {
        const handler = (e) => {
            if (panelRef.current && !panelRef.current.contains(e.target)) {
                setIsOpen(false);
            }
        };
        if (isOpen) document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [isOpen]);

    const getAlertIcon = (type) => {
        switch (type) {
            case 'critical': return <AlertCircle size={16} className="text-red-400" />;
            case 'prediction': return <TrendingDown size={16} className="text-blue-400" />;
            default: return <AlertTriangle size={16} className="text-amber-400" />;
        }
    };

    const getPriorityBadge = (priority) => {
        switch (priority) {
            case 'critical': return 'bg-red-500/20 text-red-400 border-red-500/30';
            case 'important': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
            default: return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
        }
    };

    const formatTime = (dateStr) => {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        if (diffMins < 1) return 'Ahora';
        if (diffMins < 60) return `hace ${diffMins}m`;
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `hace ${diffHours}h`;
        const diffDays = Math.floor(diffHours / 24);
        return `hace ${diffDays}d`;
    };

    return (
        <div className="relative" ref={panelRef}>
            {/* Bell Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="relative p-2 hover:bg-[var(--color-surface-hover)] rounded-full text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                title="Notificaciones de inventario"
            >
                <Bell size={20} />
                {totalBadge > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 animate-pulse">
                        {totalBadge > 99 ? '99+' : totalBadge}
                    </span>
                )}
            </button>

            {/* Dropdown Panel */}
            {isOpen && (
                <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 max-h-[70vh] rounded-xl border border-[var(--glass-border)] bg-[var(--color-background)] shadow-2xl shadow-black/40 z-50 flex flex-col overflow-hidden">
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--glass-border)] bg-[var(--color-surface)]">
                        <div className="flex items-center gap-2">
                            <Bell size={16} className="text-[var(--color-primary)]" />
                            <span className="font-semibold text-sm text-[var(--color-text)]">Alertas de Inventario</span>
                            {unreadAlertCount > 0 && (
                                <span className="text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full">{unreadAlertCount}</span>
                            )}
                        </div>
                        <div className="flex items-center gap-1">
                            {unreadAlertCount > 0 && (
                                <button
                                    onClick={() => markAllAlertsRead()}
                                    className="p-1.5 hover:bg-[var(--color-surface-hover)] rounded-lg text-[var(--color-text-muted)] hover:text-green-400 transition-colors"
                                    title="Marcar todas como leídas"
                                >
                                    <CheckCheck size={16} />
                                </button>
                            )}
                            <button
                                onClick={() => setIsOpen(false)}
                                className="p-1.5 hover:bg-[var(--color-surface-hover)] rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    </div>

                    {/* Alerts List */}
                    <div className="flex-1 overflow-y-auto">
                        {/* Encargos web (miniveci) pendientes */}
                        {webOrders && webOrders.length > 0 && (
                            <div className="p-3 space-y-2 border-b border-[var(--glass-border)] bg-amber-500/[0.03]">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-400 px-1">
                                    Encargos web ({webOrders.length})
                                </p>
                                {webOrders.map(order => (
                                    <WebOrderCard
                                        key={order.id}
                                        order={order}
                                        currency={currentCurrency}
                                        onAccept={handleAcceptWebOrder}
                                        onReject={handleRejectWebOrder}
                                        onView={handleViewWebOrder}
                                    />
                                ))}
                            </div>
                        )}

                        {inventoryAlerts.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-10 text-[var(--color-text-muted)]">
                                <Bell size={32} className="opacity-30 mb-2" />
                                <p className="text-sm">Sin alertas de inventario</p>
                                <p className="text-xs opacity-70 mt-1">Configura alertas en tus productos</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-[var(--glass-border)]">
                                {inventoryAlerts.map((alert) => (
                                    <div
                                        key={alert.id}
                                        className={cn(
                                            "px-4 py-3 hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer",
                                            !alert.is_read && "bg-[var(--color-primary)]/5 border-l-2 border-l-[var(--color-primary)]"
                                        )}
                                        onClick={() => {
                                            if (!alert.is_read) markAlertRead(alert.id);
                                        }}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className="mt-0.5">{getAlertIcon(alert.alert_type)}</div>
                                            <div className="flex-1 min-w-0">
                                                <p className={cn(
                                                    "text-sm leading-tight",
                                                    !alert.is_read ? "font-semibold text-[var(--color-text)]" : "text-[var(--color-text-muted)]"
                                                )}>
                                                    {alert.title}
                                                </p>
                                                <p className="text-xs text-[var(--color-text-muted)] mt-0.5 line-clamp-2">{alert.message}</p>
                                                <div className="flex items-center gap-2 mt-1.5">
                                                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full border", getPriorityBadge(alert.priority))}>
                                                        {alert.priority === 'critical' ? 'Crítico' : alert.priority === 'important' ? 'Importante' : 'Normal'}
                                                    </span>
                                                    {alert.current_stock !== null && (
                                                        <span className="text-[10px] text-[var(--color-text-muted)]">
                                                            Stock: {alert.current_stock}
                                                        </span>
                                                    )}
                                                    <span className="text-[10px] text-[var(--color-text-muted)] ml-auto">{formatTime(alert.created_at)}</span>
                                                </div>
                                            </div>
                                            {!alert.is_read && (
                                                <div className="w-2 h-2 rounded-full bg-[var(--color-primary)] mt-2 shrink-0" />
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    {inventoryAlerts.length > 0 && (
                        <div className="px-4 py-2 border-t border-[var(--glass-border)] bg-[var(--color-surface)] flex items-center justify-between">
                            <button
                                onClick={async () => {
                                    await deleteOldAlerts(30);
                                    fetchInventoryAlerts(30);
                                }}
                                className="text-xs text-[var(--color-text-muted)] hover:text-red-400 transition-colors flex items-center gap-1"
                            >
                                <Trash2 size={12} /> Limpiar antiguas
                            </button>
                            <span className="text-[10px] text-[var(--color-text-muted)]">
                                {inventoryAlerts.length} alertas
                            </span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default NotificationBell;
