import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { useNavigate } from 'react-router-dom';
import { DollarSign, ArrowUpRight, ArrowDownLeft, Clock, ShoppingCart, LogOut, X, TrendingUp, TrendingDown, CreditCard, ArrowLeftRight, Banknote, AlertTriangle, Landmark, History } from 'lucide-react';
import { format, isToday, differenceInHours } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '../lib/utils';
import CashClosingModal from './CashClosingModal';
import CashCloseSuccessModal from './CashCloseSuccessModal';
import CierreAutorizadoModal from './CierreAutorizadoModal';
import { formatCurrency } from '../utils/formatCurrency';

import { usePermissions } from '../hooks/usePermissions';
import { createSmartInterval } from '../lib/smartPolling';
import { pendingOpsApi } from '../lib/db/localdb';

// A partir de aquí se considera que la caja quedó abierta de un turno anterior.
// 18 h cubre un turno largo sin molestar, y detecta la caja olvidada de días.
const STALE_REGISTER_HOURS = 18;

/**
 * Sello de tiempo de un movimiento. Si no es de hoy se antepone el día: una caja
 * que lleva días abierta mezcla fechas, y viendo solo "8:02 PM" sobre "12:33 PM"
 * la lista parece desordenada cuando en realidad son días distintos.
 */
function stampOf(fecha) {
    const d = new Date(fecha);
    if (isNaN(d)) return '';
    return isToday(d) ? format(d, 'h:mm a') : format(d, "d MMM · h:mm a", { locale: es });
}

/** Aspecto de cada tipo de movimiento: icono, color y nombre por defecto. */
const TX_LOOK = {
    APERTURA: { icon: <Clock size={12} />, box: 'bg-yellow-500/20 text-yellow-500 border-yellow-500/30', amount: 'text-green-400', sign: '+', fallback: 'Apertura' },
    VENTA: { icon: <ShoppingCart size={12} />, box: 'bg-blue-500/20 text-blue-400 border-blue-500/30', amount: 'text-green-400', sign: '+', fallback: 'Venta (Efectivo)' },
    INGRESO: { icon: <ArrowUpRight size={12} />, box: 'bg-green-500/20 text-green-400 border-green-500/30', amount: 'text-green-400', sign: '+', fallback: 'Ingreso' },
    RETIRO: { icon: <ArrowDownLeft size={12} />, box: 'bg-orange-500/20 text-orange-400 border-orange-500/30', amount: 'text-orange-400', sign: '-', fallback: 'Retiro' },
};

/** Una línea del listado. La comparten las pestañas Efectivo y Movimientos. */
function TxRow({ tx, currency }) {
    const look = TX_LOOK[tx.type] || TX_LOOK.INGRESO;
    return (
        <div className="flex justify-between items-center text-xs lg:text-sm p-1.5 lg:p-2 rounded-lg hover:bg-[var(--glass-bg)] transition-colors">
            <div className="flex items-center gap-2 min-w-0">
                <div className={cn("w-6 h-6 lg:w-8 lg:h-8 rounded-full flex items-center justify-center border shrink-0", look.box)}>
                    {look.icon}
                </div>
                <div className="flex flex-col min-w-0">
                    <span className="font-bold text-[var(--color-text)] text-xs lg:text-sm truncate max-w-[110px] lg:max-w-[220px]">
                        {/* Los cobros de encargo en efectivo llegan como VENTA con
                            `reason` (el nº de encargo y el cliente). */}
                        {tx.reason || look.fallback}
                    </span>
                    <span className="text-[9px] lg:text-[10px] text-[var(--color-text-muted)]">{tx.type}</span>
                </div>
            </div>
            <div className="text-right shrink-0 pl-2">
                <span className={cn("block font-bold text-xs lg:text-sm", look.amount)}>
                    {look.sign}{formatCurrency(tx.amount, currency)}
                </span>
                <span className="text-[9px] lg:text-[10px] text-[var(--color-text-muted)]">{stampOf(tx.date)}</span>
            </div>
        </div>
    );
}

const CashStatusWidget = () => {
    // FASE 10 · useShallow para aislar re-renders.
    const { cashRegister, registerStats, refreshRegisterStats, addCashMovement, closeRegister, currentUser, currentCurrency, getRegisterMethodTransactions, activeCompanyId } = useStore(
        useShallow(s => ({
            cashRegister: s.cashRegister,
            registerStats: s.registerStats,
            refreshRegisterStats: s.refreshRegisterStats,
            addCashMovement: s.addCashMovement,
            closeRegister: s.closeRegister,
            currentUser: s.currentUser,
            currentCurrency: s.currentCurrency,
            getRegisterMethodTransactions: s.getRegisterMethodTransactions,
            activeCompanyId: s.activeCompanyId,
        }))
    );
    const { can } = usePermissions();
    const navigate = useNavigate();
    const [isOpen, setIsOpen] = useState(false);
    const [txModalType, setTxModalType] = useState(null); // 'IN' or 'OUT'
    const [isClosingModalOpen, setIsClosingModalOpen] = useState(false);
    const [showStaleNotice, setShowStaleNotice] = useState(false);
    const [successModalData, setSuccessModalData] = useState(null);
    // Datos del cierre que quedó esperando la clave del supervisor.
    const [autorizacion, setAutorizacion] = useState(null);
    const [isProcessing, setIsProcessing] = useState(false);
    // Pestaña activa del desglose de movimientos. Tarjeta/Transferencia se
    // cargan LAZY al abrir su pestaña → cero impacto en el load inicial.
    const [activeTab, setActiveTab] = useState('Efectivo');
    const [methodTx, setMethodTx] = useState({ Tarjeta: null, Transferencia: null });
    const [methodTxLoading, setMethodTxLoading] = useState(false);

    // Lazy fetch del detalle de Tarjeta o Transferencia. Efectivo y Movimientos
    // salen de registerStats, que ya está cargado: no piden nada al servidor.
    useEffect(() => {
        if (!isOpen || !cashRegister?.id) return;
        if (activeTab !== 'Tarjeta' && activeTab !== 'Transferencia') return;
        if (methodTx[activeTab] != null) return; // ya cargado
        let alive = true;
        setMethodTxLoading(true);
        getRegisterMethodTransactions(cashRegister.id, activeTab).then(res => {
            if (!alive) return;
            setMethodTx(prev => ({ ...prev, [activeTab]: res?.transactions || [] }));
        }).finally(() => alive && setMethodTxLoading(false));
        return () => { alive = false; };
    }, [activeTab, isOpen, cashRegister?.id, methodTx, getRegisterMethodTransactions]);

    // Invalidar cache de pestañas al cerrarse el dropdown → próxima apertura
    // verá datos frescos sin haber pegado a la base mientras estaba cerrado.
    useEffect(() => {
        if (!isOpen) setMethodTx({ Tarjeta: null, Transferencia: null });
    }, [isOpen]);

    // FASE 9 · Polling inteligente de stats de caja:
    // 15s con actividad reciente, 60s idle, pausa con tab oculta.
    // Antes era setInterval(10s) ciego — muy agresivo a la base.
    useEffect(() => {
        if (cashRegister) {
            refreshRegisterStats(cashRegister.id);
            const stop = createSmartInterval(
                () => refreshRegisterStats(cashRegister.id),
                {
                    label: 'cash-status',
                    activeMs: 15_000,
                    idleMs: 60_000,
                    pauseWhenHidden: true,
                    pauseWhenOffline: true,
                    runOnVisible: true,
                    runOnActivity: true,
                }
            );
            return stop;
        }
    }, [cashRegister, refreshRegisterStats]);

    // ── Ventas offline propias sin subir ────────────────────────────
    //
    // Una caja no se puede cerrar con ventas del cajero todavía en el equipo:
    // esas ventas son suyas y tienen que entrar en su cierre. Si cierra antes,
    // el cuadre le da mal —le sobra plata en el cajón contra lo que el sistema
    // registró— y cuando esas ventas suban van a caer fuera de una caja ya
    // cerrada.
    //
    // Se cuentan solo las del usuario que tiene la sesión: cada cajero cierra
    // la suya, y la cola de otro no le corresponde ni la puede resolver.
    const [ventasSinSubir, setVentasSinSubir] = useState(0);
    useEffect(() => {
        if (!activeCompanyId || !cashRegister) { setVentasSinSubir(0); return; }
        let vivo = true;
        const contar = async () => {
            try {
                const todas = await pendingOpsApi.list(activeCompanyId);
                const mias = todas.filter(o =>
                    o.status !== 'synced' &&
                    (o.userId == null || Number(o.userId) === Number(currentUser?.id))
                );
                if (vivo) setVentasSinSubir(mias.length);
            } catch { /* Dexie no disponible: no bloquear el cierre por eso */ }
        };
        contar();
        const stop = createSmartInterval(contar, {
            label: 'caja-ventas-offline',
            activeMs: 10_000,
            idleMs: 30_000,
            pauseWhenHidden: true,
            pauseWhenOffline: false, // justamente hay que contarlas sin conexión
            runOnVisible: true,
            runOnActivity: true,
        });
        return () => { vivo = false; stop(); };
    }, [activeCompanyId, cashRegister, currentUser?.id]);

    // Caja olvidada abierta de días anteriores: avisar al entrar al POS. Una vez por
    // caja y por sesión del navegador, para avisar sin volverse molesto.
    useEffect(() => {
        if (!cashRegister?.opening_time) return;
        if (differenceInHours(new Date(), new Date(cashRegister.opening_time)) < STALE_REGISTER_HOURS) return;
        const key = `pv_stale_notice_${cashRegister.id}`;
        try {
            if (sessionStorage.getItem(key)) return;
            sessionStorage.setItem(key, '1');
        } catch { /* sin sessionStorage: se avisa igual */ }
        setShowStaleNotice(true);
    }, [cashRegister?.id, cashRegister?.opening_time]);

    // Listados de las pestañas. Cada movimiento aparece en UNA sola, o parece que
    // se estuviera contando dos veces:
    //   · Efectivo → las ventas cobradas en efectivo, igual que Tarjeta y
    //     Transferencia muestran las suyas. Cuadra con el recuadro "Efectivo".
    //   · Movimientos → la plata que entra y sale sin ser venta: con cuánto se
    //     abrió, los ingresos y los retiros. Cuadra con sus tres recuadros.
    // La apertura va dentro de la lista, no clavada arriba: antes quedaba
    // encabezando por código y es lo más viejo del turno.
    const { efectivoList, movimientosList } = useMemo(() => {
        const txs = registerStats?.transactions || [];
        const apertura = cashRegister ? [{
            id: '__apertura__', type: 'APERTURA',
            amount: registerStats?.initial || 0,
            reason: 'Apertura de caja',
            date: cashRegister.opening_time,
        }] : [];
        const recientesPrimero = (a, b) => new Date(b.date) - new Date(a.date);
        return {
            efectivoList: txs.filter(t => t.type === 'VENTA').sort(recientesPrimero),
            movimientosList: [...txs.filter(t => t.type !== 'VENTA'), ...apertura].sort(recientesPrimero),
        };
    }, [registerStats?.transactions, registerStats?.initial, cashRegister]);

    // If no register is open AND no success data to show, render nothing
    if (!cashRegister && !successModalData) return null;

    // La caja puede llevar días abierta (pasó en producción: 4,6 días). Mostrar solo
    // "9:08 AM" hace creer que es de hoy, así que se añade la fecha y un aviso.
    const openedAt = cashRegister ? new Date(cashRegister.opening_time) : null;
    const openedToday = openedAt ? isToday(openedAt) : true;
    const hoursOpen = openedAt ? differenceInHours(new Date(), openedAt) : 0;
    const isStale = hoursOpen >= STALE_REGISTER_HOURS;
    const staleLabel = hoursOpen >= 48
        ? `abierta hace ${Math.floor(hoursOpen / 24)} días`
        : `abierta hace ${hoursOpen} h`;

    const ownerName = currentUser?.name || currentUser?.username || '';

    const handleInitialCloseClick = () => {
        setIsClosingModalOpen(true);
        setIsOpen(false);
    };

    // Cuenta las ventas propias que siguen en el equipo. Se relee siempre desde
    // Dexie —nunca del estado— porque puede entrar una venta mientras el modal
    // de cierre está abierto.
    const contarMisPendientes = async () => {
        try {
            const todas = await pendingOpsApi.list(activeCompanyId);
            return todas.filter(o =>
                o.status !== 'synced' &&
                (o.userId == null || Number(o.userId) === Number(currentUser?.id))
            ).length;
        } catch {
            return 0; // Dexie no disponible: no bloquear el cierre por eso
        }
    };

    const handleConfirmClose = async (registerId, finalAmount, observations, difference, override = null) => {
        // Candado real, no solo el botón deshabilitado.
        const pendientes = await contarMisPendientes();
        if (pendientes > 0) {
            setVentasSinSubir(pendientes);
            if (!override) {
                // Sin autorización: se ofrece la llave del supervisor en vez de
                // dejar al cajero sin salida.
                setIsClosingModalOpen(false);
                setAutorizacion({ registerId, finalAmount, observations, difference, pendientes });
                return;
            }
            override.pendientes = pendientes;
        }

        const res = await closeRegister(registerId, finalAmount, observations, difference, override);
        if (res !== true) {
            // Se devuelve el error para que el diálogo de autorización lo muestre
            // y no se cierre: la clave mal escrita no debe perder el cierre.
            return res || { success: false, error: 'No se pudo cerrar la caja.' };
        }
        setAutorizacion(null);
        {
            // Prepare data for Success Modal
            setSuccessModalData({
                registerId,
                user: currentUser,
                openingTime: cashRegister.opening_time,
                closingTime: new Date().toISOString(),
                openingAmount: cashRegister.opening_amount,
                salesBreakdown: registerStats.salesBreakdown || { cash: registerStats.sales, card: 0, transfer: 0, credit: 0, total: registerStats.sales },
                movementsIn: registerStats.movements_in,
                movementsOut: registerStats.movements_out,
                expectedBalance: registerStats.balance,
                realBalance: finalAmount,
                difference: difference,
                observations: observations
            });
            setIsClosingModalOpen(false);
        }
        return true;
    };

    const handleSuccessModalClose = () => {
        setSuccessModalData(null);
        navigate('/dashboard');
    };

    const handleTransactionConfirm = async (amount, reason) => {
        if (!txModalType || isProcessing) return;

        try {
            setIsProcessing(true);
            await addCashMovement(cashRegister.id, txModalType, amount, reason);
            await refreshRegisterStats(cashRegister.id);
            setTxModalType(null);
        } catch (error) {
            console.error("Transaction failed:", error);
            alert("Error al registrar movimiento");
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <>
            {cashRegister && (
                <div className="relative">
                    {/* Widget Button */}
                    <button
                        onClick={() => {
                            setIsOpen(!isOpen);
                            refreshRegisterStats(cashRegister.id);
                        }}
                        className="h-10 px-4 rounded-xl bg-[var(--glass-bg)] border-[var(--glass-border)] flex items-center gap-3 hover:border-[var(--color-primary)] transition-all group"
                    >
                        <div className="flex flex-col items-end">
                            {/* Mismo formato que el desplegable: antes el botón truncaba
                                con Math.floor y mostraba $195.049 donde el detalle decía
                                $195.050, y el cajero desconfiaba del número. */}
                            <span className="text-[var(--color-primary)] font-bold text-lg leading-none">
                                {formatCurrency(registerStats.balance, currentCurrency)}
                            </span>
                            <span className={cn(
                                "text-[10px] flex items-center gap-1",
                                isStale ? "text-amber-400 font-semibold" : "text-[var(--color-text-muted)]"
                            )}>
                                {isStale ? <AlertTriangle size={10} /> : <Clock size={10} />}
                                {/* Compacto: si se abrió hoy, solo la hora; si fue otro día,
                                    solo la fecha abreviada (sin hora) para no ocupar espacio. */}
                                {openedToday
                                    ? `Desde ${format(openedAt, 'h:mm a', { locale: es })}`
                                    : `Desde ${format(openedAt, "d MMM", { locale: es })}`}
                            </span>
                        </div>
                        <div className="w-8 h-8 rounded-lg bg-[var(--color-primary)]/10 flex items-center justify-center text-[var(--color-primary)] group-hover:bg-[var(--color-primary)] group-hover:text-black transition-colors">
                            <DollarSign size={18} />
                        </div>
                    </button>

                    {/* Dropdown / Modal - Responsive - Using Portal */}
                    {isOpen && createPortal(
                        <div className="fixed inset-0 z-[9999]">
                            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsOpen(false)}></div>
                            {/* En celular ocupa la pantalla (inset-4). En escritorio crece:
                                con 360 px fijos quedaba con ancho de teléfono en un monitor. */}
                            <div className="absolute inset-4 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 w-auto sm:w-[420px] lg:w-[640px] glass-card p-0 !bg-[#0f0f2d]/98 border-[var(--glass-border)] shadow-2xl overflow-hidden animate-[float_0.2s_ease-out] max-h-[90vh] flex flex-col rounded-2xl">
                                {/* Header */}
                                <div className="p-3 border-b border-[var(--glass-border)] flex justify-between items-center shrink-0">
                                    {/* "Mi caja · <nombre>": el número es de ESTE usuario, no del
                                        local. Con dos cajeros a la vez, cada uno ve solo lo suyo. */}
                                    <h3 className="font-bold text-[var(--color-text)] text-sm lg:text-base truncate">
                                        Mi caja{ownerName ? <span className="text-[var(--color-text-muted)] font-medium"> · {ownerName}</span> : null}
                                    </h3>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <div className="px-2 py-0.5 rounded bg-green-500/20 text-green-400 text-[10px] lg:text-xs font-bold border border-green-500/30">
                                            Turno Activo
                                        </div>
                                        <button onClick={() => setIsOpen(false)} className="p-1 text-gray-400 hover:text-white">
                                            <X size={18} />
                                        </button>
                                    </div>
                                </div>

                                {/* Scrollable Content */}
                                <div className="flex-1 overflow-y-auto">
                                    {/* Main Balance */}
                                    <div className="p-4 bg-gradient-to-br from-[var(--color-primary)]/10 to-transparent flex flex-col items-center justify-center border-b border-[var(--glass-border)]">
                                        <span className="text-3xl lg:text-4xl font-extrabold text-[var(--color-primary)] mb-0.5 text-glow">
                                            {formatCurrency(registerStats.balance, currentCurrency)}
                                        </span>
                                        <span className="text-xs lg:text-sm text-[var(--color-text-muted)] font-medium">Efectivo en caja · solo mis ventas</span>
                                        <span className="text-[10px] lg:text-xs text-[var(--color-text-muted)] mt-1">
                                            Abierta el {format(openedAt, "EEE d 'de' MMMM, h:mm a", { locale: es })}
                                        </span>
                                    </div>

                                    {/* Caja arrastrada de días anteriores: el saldo ya no representa
                                        lo que hay en el cajón. Pasó en producción con 4,6 días. */}
                                    {isStale && (
                                        <div className="mx-3 mt-3 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-2">
                                            <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
                                            <p className="text-[11px] lg:text-xs text-amber-200/90 leading-relaxed">
                                                Esta caja lleva <strong>{staleLabel}</strong>. El saldo viene acumulando
                                                desde entonces, no es lo vendido hoy. Conviene cerrarla y abrir una nueva por turno.
                                            </p>
                                        </div>
                                    )}

                                    {/* Desglose del turno. Solo Efectivo entra al saldo de arriba:
                                        tarjeta, transferencia y crédito no están en el cajón. */}
                                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 p-3">
                                        <div className="p-2 lg:p-3 bg-green-500/5 rounded-xl border border-green-500/20 flex flex-col items-center">
                                            <Banknote size={14} className="text-green-400 mb-0.5" />
                                            <span className="text-base lg:text-lg font-bold text-green-400">{formatCurrency(registerStats.sales, currentCurrency)}</span>
                                            <span className="text-[10px] lg:text-xs text-green-300/60">Efectivo</span>
                                        </div>
                                        <div className="p-2 lg:p-3 bg-blue-500/5 rounded-xl border border-blue-500/20 flex flex-col items-center">
                                            <CreditCard size={14} className="text-blue-400 mb-0.5" />
                                            <span className="text-base lg:text-lg font-bold text-blue-400">{formatCurrency(registerStats.salesBreakdown?.card || 0, currentCurrency)}</span>
                                            <span className="text-[10px] lg:text-xs text-blue-300/60">Tarjeta</span>
                                        </div>
                                        <div className="p-2 lg:p-3 bg-purple-500/5 rounded-xl border border-purple-500/20 flex flex-col items-center">
                                            <ArrowLeftRight size={14} className="text-purple-400 mb-0.5" />
                                            <span className="text-base lg:text-lg font-bold text-purple-400">{formatCurrency(registerStats.salesBreakdown?.transfer || 0, currentCurrency)}</span>
                                            <span className="text-[10px] lg:text-xs text-purple-300/60">Transferencia</span>
                                        </div>
                                        <div className="p-2 lg:p-3 bg-orange-500/5 rounded-xl border border-orange-500/20 flex flex-col items-center">
                                            <TrendingDown size={14} className="text-orange-400 mb-0.5" />
                                            <span className="text-base lg:text-lg font-bold text-orange-400">{formatCurrency(registerStats.movements_out, currentCurrency)}</span>
                                            <span className="text-[10px] lg:text-xs text-orange-300/60">Retiros</span>
                                        </div>
                                        {/* Crédito: el dato ya venía en salesBreakdown pero no se
                                            mostraba, así que una venta fiada desaparecía de la vista. */}
                                        {(registerStats.salesBreakdown?.credit || 0) > 0 && (
                                            <div className="p-2 lg:p-3 bg-rose-500/5 rounded-xl border border-rose-500/20 flex flex-col items-center col-span-2 lg:col-span-4">
                                                <Landmark size={14} className="text-rose-400 mb-0.5" />
                                                <span className="text-base lg:text-lg font-bold text-rose-400">{formatCurrency(registerStats.salesBreakdown.credit, currentCurrency)}</span>
                                                <span className="text-[10px] lg:text-xs text-rose-300/60">Crédito (por cobrar)</span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="grid grid-cols-2 gap-2 px-3 pb-3">
                                        {can('pos.cash_in') && (
                                            <button
                                                onClick={() => setTxModalType('IN')}
                                                className="p-2.5 rounded-xl border border-green-500/30 text-green-400 hover:bg-green-500/10 font-bold text-xs lg:text-sm flex items-center justify-center gap-1.5 transition-all"
                                            >
                                                <ArrowDownLeft size={14} /> Ingreso
                                            </button>
                                        )}
                                        {can('pos.cash_out') && (
                                            <button
                                                onClick={() => setTxModalType('OUT')}
                                                className="p-2.5 rounded-xl border border-orange-500/30 text-orange-400 hover:bg-orange-500/10 font-bold text-xs lg:text-sm flex items-center justify-center gap-1.5 transition-all"
                                            >
                                                <ArrowUpRight size={14} /> Retiro
                                            </button>
                                        )}
                                    </div>

                                    {/* Tabs + Transaction List */}
                                    <div className="px-3 pb-2">
                                        <div className="flex gap-1 mb-2 p-1 bg-[var(--glass-bg)] rounded-lg border border-[var(--glass-border)]">
                                            {[
                                                { key: 'Efectivo', label: 'Efectivo', icon: <Banknote size={12} />, color: 'text-green-400' },
                                                { key: 'Tarjeta', label: 'Tarjeta', icon: <CreditCard size={12} />, color: 'text-blue-400' },
                                                { key: 'Transferencia', label: 'Transfer.', icon: <ArrowLeftRight size={12} />, color: 'text-purple-400' },
                                                { key: 'Movimientos', label: 'Movim.', icon: <History size={12} />, color: 'text-amber-400' }
                                            ].map(t => (
                                                <button key={t.key}
                                                    onClick={() => setActiveTab(t.key)}
                                                    className={cn(
                                                        "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] lg:text-xs font-bold transition-all",
                                                        activeTab === t.key
                                                            ? cn("bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/30", t.color)
                                                            : "text-[var(--color-text-muted)] hover:text-white"
                                                    )}>
                                                    {t.icon}<span className="hidden sm:inline">{t.label}</span>
                                                </button>
                                            ))}
                                        </div>

                                        <div className="space-y-1.5 max-h-[180px] lg:max-h-[220px] overflow-y-auto pr-1 scrollbar-thin">
                                            {activeTab === 'Efectivo' && (
                                                efectivoList.length === 0 ? (
                                                    <div className="text-center text-[var(--color-text-muted)] text-xs py-6">
                                                        Sin ventas en efectivo este turno
                                                    </div>
                                                ) : efectivoList.map(tx => (
                                                    <TxRow key={`${tx.type}-${tx.id}`} tx={tx} currency={currentCurrency} />
                                                ))
                                            )}

                                            {/* Movimientos: la plata que entra y sale sin contar ventas.
                                                Responde "con cuánto abrí, cuánto metí y cuánto saqué",
                                                que es lo que se revisa al cuadrar la caja. */}
                                            {activeTab === 'Movimientos' && (
                                                <>
                                                    <div className="grid grid-cols-3 gap-1.5 mb-2">
                                                        <div className="rounded-lg bg-yellow-500/5 border border-yellow-500/20 p-1.5 text-center">
                                                            <p className="text-[9px] text-yellow-300/70 uppercase tracking-wide">Apertura</p>
                                                            <p className="text-[11px] lg:text-sm font-bold text-yellow-400">{formatCurrency(registerStats.initial, currentCurrency)}</p>
                                                        </div>
                                                        <div className="rounded-lg bg-green-500/5 border border-green-500/20 p-1.5 text-center">
                                                            <p className="text-[9px] text-green-300/70 uppercase tracking-wide">Ingresos</p>
                                                            <p className="text-[11px] lg:text-sm font-bold text-green-400">{formatCurrency(registerStats.movements_in || 0, currentCurrency)}</p>
                                                        </div>
                                                        <div className="rounded-lg bg-orange-500/5 border border-orange-500/20 p-1.5 text-center">
                                                            <p className="text-[9px] text-orange-300/70 uppercase tracking-wide">Retiros</p>
                                                            <p className="text-[11px] lg:text-sm font-bold text-orange-400">{formatCurrency(registerStats.movements_out || 0, currentCurrency)}</p>
                                                        </div>
                                                    </div>
                                                    {movimientosList.length === 0 ? (
                                                        <div className="text-center text-[var(--color-text-muted)] text-xs py-4">Sin ingresos ni retiros este turno</div>
                                                    ) : movimientosList.map(tx => (
                                                        <TxRow key={`${tx.type}-${tx.id}`} tx={tx} currency={currentCurrency} />
                                                    ))}
                                                </>
                                            )}

                                            {(activeTab === 'Tarjeta' || activeTab === 'Transferencia') && (
                                                methodTxLoading && methodTx[activeTab] == null ? (
                                                    <div className="text-center text-[var(--color-text-muted)] text-xs py-6">Cargando…</div>
                                                ) : (methodTx[activeTab]?.length ?? 0) === 0 ? (
                                                    <div className="text-center text-[var(--color-text-muted)] text-xs py-6">
                                                        Sin cobros con {activeTab === 'Tarjeta' ? 'tarjeta' : 'transferencia'} este turno
                                                    </div>
                                                ) : methodTx[activeTab].map(tx => {
                                                    const isCard = activeTab === 'Tarjeta';
                                                    const accent = isCard ? 'text-blue-400 bg-blue-500/20 border-blue-500/30' : 'text-purple-400 bg-purple-500/20 border-purple-500/30';
                                                    const detailLabel = isCard ? 'Datáfono' : 'Cuenta';
                                                    return (
                                                        <div key={tx.id} className="flex justify-between items-start text-xs lg:text-sm p-2 rounded-lg hover:bg-[var(--glass-bg)] transition-colors">
                                                            <div className="flex items-start gap-2 min-w-0 flex-1">
                                                                <div className={cn("w-6 h-6 lg:w-8 lg:h-8 rounded-full flex items-center justify-center border shrink-0", accent)}>
                                                                    {isCard ? <CreditCard size={12} /> : <ArrowLeftRight size={12} />}
                                                                </div>
                                                                <div className="flex flex-col min-w-0 flex-1">
                                                                    <span className="font-bold text-[var(--color-text)] text-xs lg:text-sm truncate">
                                                                        {tx.reference}
                                                                    </span>
                                                                    <span className="text-[9px] lg:text-[10px] text-[var(--color-text-muted)] truncate">
                                                                        {tx.source} · {detailLabel}: {tx.detail || '—'}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            <div className="text-right shrink-0 ml-2">
                                                                <span className={cn("block font-bold text-xs lg:text-sm", isCard ? "text-blue-400" : "text-purple-400")}>
                                                                    +{formatCurrency(tx.amount, currentCurrency)}
                                                                </span>
                                                                <span className="text-[9px] lg:text-[10px] text-[var(--color-text-muted)]">{format(new Date(tx.date), 'h:mm a')}</span>
                                                            </div>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Footer */}
                                <div className="p-3 border-t border-[var(--glass-border)] bg-[var(--glass-bg)] shrink-0">
                                    {can('pos.close_register') && (
                                        ventasSinSubir > 0 ? (
                                            <>
                                                {/* La caja no se cierra con ventas propias sin subir:
                                                    son plata que ya está en el cajón pero que el
                                                    sistema todavía no registró. Cerrar ahora daría
                                                    un cuadre falso y esas ventas caerían fuera de
                                                    una caja ya cerrada. */}
                                                <div className="w-full rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                                                    <div className="flex items-center gap-2 font-bold text-amber-400">
                                                        <AlertTriangle size={14} />
                                                        No podés cerrar la caja todavía
                                                    </div>
                                                    <p className="mt-1 text-[var(--color-text-muted)]">
                                                        Te {ventasSinSubir === 1 ? 'queda' : 'quedan'}{' '}
                                                        <span className="font-bold text-[var(--color-text)]">
                                                            {ventasSinSubir} venta{ventasSinSubir === 1 ? '' : 's'}
                                                        </span>{' '}
                                                        sin subir al servidor. Esa plata ya está en el
                                                        cajón, así que tiene que entrar en tu cierre.
                                                    </p>
                                                    <button
                                                        onClick={() => { setIsOpen(false); navigate('/offline-sales'); }}
                                                        className="mt-2 w-full py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs transition-colors"
                                                    >
                                                        Ver y subir mis ventas pendientes
                                                    </button>
                                                </div>
                                                {/* Sigue habilitado, pero avisando: el cajero cuenta
                                                    la plata igual y al confirmar se le pide la clave
                                                    del supervisor. Deshabilitarlo del todo dejaba el
                                                    turno sin salida cuando la venta no entraba por
                                                    algo ajeno al cajero (sin stock, sin folios). */}
                                                <button
                                                    onClick={handleInitialCloseClick}
                                                    className="mt-2 w-full py-2.5 rounded-lg border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:border-amber-500/50 font-bold text-sm transition-all flex items-center justify-center gap-2"
                                                >
                                                    <LogOut size={16} />
                                                    Cerrar con clave de supervisor
                                                </button>
                                            </>
                                        ) : (
                                            <button
                                                onClick={handleInitialCloseClick}
                                                className="w-full py-2.5 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 hover:border-red-500/50 font-bold text-sm transition-all flex items-center justify-center gap-2"
                                            >
                                                <LogOut size={16} />
                                                Cerrar Caja
                                            </button>
                                        )
                                    )}
                                </div>
                            </div>
                        </div>,
                        document.body
                    )}
                </div>
            )}

            {/* Aviso de caja arrastrada de un turno anterior. Sale al entrar al POS,
                una vez por caja y sesión. Reutiliza el cierre de caja de siempre. */}
            {showStaleNotice && cashRegister && createPortal(
                <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
                    <div className="glass-card w-full max-w-sm p-6 !bg-[#0f0f2d]/98 border border-amber-500/40 rounded-2xl text-center">
                        <div className="w-12 h-12 mx-auto rounded-full bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 mb-4">
                            <AlertTriangle size={24} />
                        </div>
                        <h3 className="text-lg font-bold text-[var(--color-text)] mb-2">Tienes una caja sin cerrar</h3>
                        <p className="text-sm text-[var(--color-text-muted)] mb-4 leading-relaxed">
                            Está abierta desde el{' '}
                            <strong className="text-[var(--color-text)]">
                                {format(new Date(cashRegister.opening_time), "d 'de' MMMM, h:mm a", { locale: es })}
                            </strong>{' '}
                            ({staleLabel}). Mientras no la cierres, el saldo sigue sumando turnos
                            anteriores y no refleja lo que hay en el cajón.
                        </p>
                        <div className="flex flex-col gap-2">
                            <button
                                onClick={() => { setShowStaleNotice(false); setIsClosingModalOpen(true); }}
                                className="w-full py-2.5 rounded-xl bg-amber-400 text-black font-bold text-sm hover:bg-amber-300 transition-all"
                            >
                                Cerrar caja ahora
                            </button>
                            <button
                                onClick={() => setShowStaleNotice(false)}
                                className="w-full py-2 rounded-xl border border-[var(--glass-border)] text-[var(--color-text-muted)] font-medium text-sm hover:text-white transition-all"
                            >
                                Seguir vendiendo por ahora
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Sub Modals */}
            <TransactionModal
                isOpen={!!txModalType}
                onClose={() => setTxModalType(null)}
                type={txModalType}
                onConfirm={handleTransactionConfirm}
                isProcessing={isProcessing}
            />

            {/* Only render closing modal if register exists (it requires register stats) */}
            {cashRegister && (
                <CashClosingModal
                    isOpen={isClosingModalOpen}
                    onClose={() => setIsClosingModalOpen(false)}
                    stats={registerStats}
                    registerId={cashRegister.id}
                    onConfirm={handleConfirmClose}
                />
            )}

            {/* Llave de supervisor: aparece cuando el cierre se frenó porque
                quedaban ventas del cajero sin subir. */}
            <CierreAutorizadoModal
                datos={autorizacion}
                onCancel={() => setAutorizacion(null)}
                onConfirm={({ username, password, reason }) => handleConfirmClose(
                    autorizacion.registerId,
                    autorizacion.finalAmount,
                    autorizacion.observations,
                    autorizacion.difference,
                    { username, password, reason },
                )}
            />

            <CashCloseSuccessModal
                isOpen={!!successModalData}
                onClose={handleSuccessModalClose}
                data={successModalData}
            />
        </>
    );
};

const TransactionModal = ({ isOpen, onClose, type, onConfirm, isProcessing }) => {
    const [amount, setAmount] = useState('');
    const [reason, setReason] = useState('');

    useEffect(() => {
        if (isOpen) {
            setAmount('');
            setReason('');
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSubmit = () => {
        if (!amount) return;
        onConfirm(parseFloat(amount), reason || (type === 'IN' ? 'Ingreso Manual' : 'Retiro Manual'));
    };

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[var(--color-surface)]/50 dark:bg-black/80 backdrop-blur-sm">
            <div className="glass-card w-full max-w-sm p-6 relative animate-[float_0.3s_ease-out] !bg-[#0f0f2d]/90">
                <button onClick={onClose} className="absolute top-4 right-4 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"><X size={20} /></button>

                <h3 className="text-xl font-bold text-[var(--color-text)] mb-6 flex items-center gap-2">
                    {type === 'IN' ? <ArrowDownLeft className="text-green-400" /> : <ArrowUpRight className="text-orange-400" />}
                    {type === 'IN' ? 'Registrar Ingreso' : 'Registrar Retiro'}
                </h3>

                <div className="space-y-4">
                    <div>
                        <label className="text-sm text-[var(--color-text-muted)] mb-1 block">Monto</label>
                        <input
                            type="number"
                            placeholder="0"
                            value={amount}
                            onChange={e => setAmount(e.target.value)}
                            className="glass-input w-full text-2xl font-bold text-center"
                            autoFocus
                        />
                    </div>
                    <div>
                        <label className="text-sm text-[var(--color-text-muted)] mb-1 block">Motivo (Opcional)</label>
                        <input
                            type="text"
                            placeholder="Ej: Cambio, Pago proveedor..."
                            value={reason}
                            onChange={e => setReason(e.target.value)}
                            className="glass-input w-full text-sm"
                        />
                    </div>

                    <button
                        onClick={handleSubmit}
                        disabled={isProcessing}
                        className={cn(
                            "w-full py-3 rounded-xl font-bold text-black shadow-lg transition-all flex items-center justify-center gap-2",
                            type === 'IN'
                                // El aviso de "trabajando" va en el botón (la rueda y el
                                // texto de abajo), no en el cursor del mouse.
                                ? (isProcessing ? "bg-green-400/50 btn-trabajando" : "bg-green-400 hover:bg-green-300 shadow-green-400/20")
                                : (isProcessing ? "bg-orange-400/50 btn-trabajando" : "bg-orange-400 hover:bg-orange-300 shadow-orange-400/20")
                        )}
                    >
                        {isProcessing ? (
                            <>
                                <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                                Procesando...
                            </>
                        ) : (
                            `Confirmar ${type === 'IN' ? 'Ingreso' : 'Retiro'}`
                        )}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default CashStatusWidget;
