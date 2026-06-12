import React, { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { CreditCard, Calendar, Search, Save, History, ChevronDown, ChevronRight, Smartphone, Trash2, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { formatCurrency } from '../../utils/formatCurrency';
import { findBestMatch, netExpected, sumNet } from '../../lib/reconciliation/matcher';

// Helper: hoy y hace 7 días en formato yyyy-MM-dd para los inputs.
const todayStr = () => format(new Date(), 'yyyy-MM-dd');
const daysAgoStr = (n) => format(new Date(Date.now() - n * 86400000), 'yyyy-MM-dd');

const PaymentReconciliation = () => {
    const {
        paymentTerminals,
        fetchPaymentMethodsSettings,
        currentCurrency,
        fetchTerminalCardSales,
        fetchPaymentReconciliations,
        savePaymentReconciliation,
        deletePaymentReconciliation,
        fetchConciliatedSaleIds,
        fetchUntaggedCardSalesCount,
    } = useStore(useShallow(s => ({
        paymentTerminals: s.paymentTerminals,
        fetchPaymentMethodsSettings: s.fetchPaymentMethodsSettings,
        currentCurrency: s.currentCurrency,
        fetchTerminalCardSales: s.fetchTerminalCardSales,
        fetchPaymentReconciliations: s.fetchPaymentReconciliations,
        savePaymentReconciliation: s.savePaymentReconciliation,
        deletePaymentReconciliation: s.deletePaymentReconciliation,
        fetchConciliatedSaleIds: s.fetchConciliatedSaleIds,
        fetchUntaggedCardSalesCount: s.fetchUntaggedCardSalesCount,
    })));

    const [terminalId, setTerminalId] = useState('');
    const [startDate, setStartDate] = useState(daysAgoStr(7));
    const [endDate, setEndDate] = useState(todayStr());
    const [sales, setSales] = useState([]);             // ventas disponibles (no conciliadas)
    const [consumedCount, setConsumedCount] = useState(0); // cuántas ya estaban conciliadas
    const [untagged, setUntagged] = useState({ count: 0, total: 0 });
    const [loadingSales, setLoadingSales] = useState(false);

    const [depositAmount, setDepositAmount] = useState('');
    const [depositDate, setDepositDate] = useState(todayStr());
    const [depositNotes, setDepositNotes] = useState('');
    const [matchResult, setMatchResult] = useState(null);
    const [matchedSales, setMatchedSales] = useState([]);
    const [salesExpanded, setSalesExpanded] = useState(false);
    const [saving, setSaving] = useState(false);

    const [history, setHistory] = useState([]);

    // Cargar datáfonos al montar
    useEffect(() => {
        fetchPaymentMethodsSettings();
        loadHistory();
    }, []);

    // Seleccionar el primer datáfono por defecto
    useEffect(() => {
        if (!terminalId && paymentTerminals?.length) {
            setTerminalId(String(paymentTerminals[0].id));
        }
    }, [paymentTerminals, terminalId]);

    const terminal = useMemo(
        () => paymentTerminals?.find(t => String(t.id) === String(terminalId)) || null,
        [paymentTerminals, terminalId]
    );

    const commissionRate = Number(terminal?.commission_rate) || 0;
    const fixedFee = Number(terminal?.fixed_fee) || 0;
    const includesIva = !!terminal?.commission_includes_iva;
    const effectivePct = includesIva ? commissionRate : commissionRate * 1.19;

    const loadSales = async () => {
        if (!terminalId) return;
        setLoadingSales(true);
        setMatchResult(null);
        setMatchedSales([]);
        // 1. Ventas del datáfono en el rango
        const res = await fetchTerminalCardSales({ terminalId: Number(terminalId), startDate, endDate });
        const allSales = res.success ? res.sales : [];
        // 2. Excluir las que ya fueron conciliadas con match → evita doble conteo.
        const consumed = await fetchConciliatedSaleIds(Number(terminalId));
        const available = allSales.filter(s => !consumed.has(s.id));
        setSales(available);
        setConsumedCount(allSales.length - available.length);
        // 3. Diagnóstico: ventas "Tarjeta" sin datáfono asignado en el mismo rango.
        const untaggedRes = await fetchUntaggedCardSalesCount({ startDate, endDate });
        setUntagged(untaggedRes);
        setLoadingSales(false);
    };

    const loadHistory = async () => {
        const res = await fetchPaymentReconciliations({ limit: 30 });
        if (res.success) setHistory(res.reconciliations);
    };

    // Auto-cargar cuando cambian los filtros (con debounce manual simple)
    useEffect(() => {
        if (terminalId && startDate && endDate) {
            const t = setTimeout(loadSales, 250);
            return () => clearTimeout(t);
        }
    }, [terminalId, startDate, endDate]);

    const totals = useMemo(() => {
        const bruto = sales.reduce((s, x) => s + (Number(x.total) || 0), 0);
        const neto = sumNet(sales, commissionRate, fixedFee, includesIva);
        const comision = bruto - neto;
        return { bruto, neto, comision, count: sales.length };
    }, [sales, commissionRate, fixedFee, includesIva]);

    const handleSearch = () => {
        const amount = parseFloat(depositAmount);
        if (!amount || amount <= 0) {
            setMatchResult({ error: 'Ingresa el monto del abono recibido' });
            return;
        }
        if (!sales.length) {
            setMatchResult({ error: 'No hay ventas con tarjeta para este datáfono en el rango (excluidas las ya conciliadas).' });
            return;
        }
        // Aviso explícito: el abono es mayor al neto total disponible → el sistema
        // NO va a inventar ventas. Mejor avisar y que el usuario revise.
        if (amount > totals.neto + 100) {
            setMatchResult({
                error: `⚠️ El abono ($${amount.toLocaleString('es-CL')}) es mayor que el neto disponible ($${Math.round(totals.neto).toLocaleString('es-CL')}). Probablemente faltan ventas por registrar o están etiquetadas a otro datáfono. Revisa la sección de diagnóstico abajo, o guárdalo como abono histórico.`
            });
            return;
        }
        // Tolerancia adaptativa: $50 mínimo, o 0.3% del abono (para absorber
        // diferencias por mix débito/crédito cuando el datáfono cobra distinto
        // según tipo de tarjeta y POSVECI no sabe cuál fue cada venta).
        const tol = Math.max(50, Math.round(amount * 0.003));
        const result = findBestMatch(sales, amount, { commissionRate, fixedFee, includesIva, toleranceClp: tol });
        if (!result) {
            setMatchResult({ error: 'No se encontró ninguna combinación de ventas que cuadre con ese abono.' });
            setMatchedSales([]);
            return;
        }
        setMatchResult(result);
        setMatchedSales(result.sales);
    };

    // Guarda la conciliación. Si hay match → guarda con ventas + neto esperado.
    // Si no hay match (manual / histórico) → guarda solo el abono con notas.
    const handleSave = async ({ manual = false } = {}) => {
        const amount = parseFloat(depositAmount);
        if (!amount || amount <= 0) {
            setMatchResult({ error: 'Ingresa el monto del abono recibido.' });
            return;
        }
        setSaving(true);
        try {
            const isManual = manual || !matchResult || matchResult.error || !matchedSales.length;
            const dates = matchedSales.map(s => s.date).sort();
            const baseNote = depositNotes.trim();
            const autoNote = isManual
                ? 'Abono manual / histórico (sin match automático)'
                : (matchResult.strategy === 'contiguous'
                    ? `Ventas contiguas (${matchedSales.length})`
                    : `Combinación libre (${matchedSales.length} ventas)`);
            const finalNote = baseNote ? `${autoNote} · ${baseNote}` : autoNote;

            const res = await savePaymentReconciliation({
                terminalId: Number(terminalId),
                depositDate,
                depositAmount: amount,
                expectedAmount: isManual ? amount : matchResult.sumNet,
                saleIds: isManual ? [] : matchedSales.map(s => s.id),
                salesFrom: isManual ? null : (dates[0] || null),
                salesTo: isManual ? null : (dates[dates.length - 1] || null),
                notes: finalNote,
            });
            if (res.success) {
                setDepositAmount('');
                setDepositNotes('');
                setMatchResult(null);
                setMatchedSales([]);
                await loadHistory();
                await loadSales();
            } else {
                setMatchResult({ error: res.error || 'No se pudo guardar.' });
            }
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteHistory = async (id) => {
        if (!window.confirm('¿Borrar este registro de conciliación? No afecta las ventas.')) return;
        const res = await deletePaymentReconciliation(id);
        if (res.success) loadHistory();
    };

    return (
        <div className="p-2 lg:p-0 space-y-6">
            {/* HEADER */}
            <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-blue-500/15 text-blue-300">
                    <CreditCard size={22} />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-[var(--color-text)]">Conciliación de Datáfonos</h1>
                    <p className="text-sm text-[var(--color-text-muted)]">
                        Cruza los abonos del banco con las ventas registradas en POSVECI. Funciona para Compraquí, Tuu, Transbank, MercadoPago, Getnet y cualquier otro datáfono.
                    </p>
                </div>
            </div>

            {/* AVISO si no hay datáfonos */}
            {!paymentTerminals?.length && (
                <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200">
                    <AlertTriangle size={20} className="shrink-0 mt-0.5" />
                    <div className="text-sm">
                        Primero registra tus datáfonos en <b>Configuración → Medios de Pago</b> y configurales su comisión (%).
                    </div>
                </div>
            )}

            {/* FILTROS */}
            <div className="glass-card p-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                        <label className="block text-xs text-[var(--color-text-muted)] mb-1">Datáfono</label>
                        <select
                            value={terminalId}
                            onChange={(e) => setTerminalId(e.target.value)}
                            className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
                        >
                            <option value="">Selecciona un datáfono</option>
                            {paymentTerminals?.map(t => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                        </select>
                        {terminal && (
                            <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
                                Comisión: {commissionRate}%
                                {!includesIva && commissionRate > 0 && <span> + IVA → <b className="text-[var(--color-primary)]">{effectivePct.toFixed(4)}%</b> efectiva</span>}
                                {includesIva && commissionRate > 0 && <span className="text-green-400"> (IVA incluido)</span>}
                                {fixedFee > 0 && ` · ${formatCurrency(fixedFee, currentCurrency)} fijo`}
                            </p>
                        )}
                    </div>
                    <div>
                        <label className="block text-xs text-[var(--color-text-muted)] mb-1">Desde</label>
                        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                            className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]" />
                    </div>
                    <div>
                        <label className="block text-xs text-[var(--color-text-muted)] mb-1">Hasta</label>
                        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                            className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]" />
                    </div>
                </div>
            </div>

            {/* DIAGNÓSTICO: ventas con tarjeta sin datáfono asignado en el rango */}
            {untagged.count > 0 && (
                <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200">
                    <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                    <div className="text-xs">
                        <b>Hay {untagged.count} ventas con tarjeta SIN datáfono asignado</b> en este rango,
                        sumando <b>{formatCurrency(untagged.total, currentCurrency)}</b>. Esas ventas no aparecen
                        en el cálculo de ningún datáfono. Capacita a los cajeros para que seleccionen el datáfono
                        al cobrar con tarjeta — si no lo hacen, los abonos nunca van a cuadrar.
                    </div>
                </div>
            )}

            {/* TOTALES + VENTAS */}
            <div className="glass-card p-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <Stat label="Ventas disponibles" value={`${totals.count}`} />
                    <Stat label="Total bruto" value={formatCurrency(totals.bruto, currentCurrency)} />
                    <Stat label="Comisión estimada" value={formatCurrency(totals.comision, currentCurrency)} tone="muted" />
                    <Stat label="Neto esperado" value={formatCurrency(totals.neto, currentCurrency)} tone="primary" />
                </div>
                {consumedCount > 0 && (
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-2 flex items-center gap-1">
                        <Info size={12} /> {consumedCount} venta{consumedCount > 1 ? 's' : ''} ya {consumedCount > 1 ? 'estaban' : 'estaba'} en una conciliación previa — ocultas del pool para no contarlas dos veces.
                    </p>
                )}

                <button
                    onClick={() => setSalesExpanded(v => !v)}
                    className="mt-3 flex items-center gap-2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                >
                    {salesExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    {salesExpanded ? 'Ocultar ventas' : 'Ver ventas en detalle'}
                </button>

                {salesExpanded && (
                    <div className="mt-3 max-h-72 overflow-y-auto custom-scrollbar rounded-lg border border-[var(--glass-border)]">
                        {loadingSales ? (
                            <div className="p-4 text-center text-[var(--color-text-muted)] text-sm">Cargando…</div>
                        ) : sales.length === 0 ? (
                            <div className="p-4 text-center text-[var(--color-text-muted)] text-sm">Sin ventas con tarjeta en el rango seleccionado.</div>
                        ) : (
                            <table className="w-full text-xs">
                                <thead className="text-[var(--color-text-muted)] bg-[var(--color-surface)] sticky top-0">
                                    <tr>
                                        <th className="text-left px-3 py-2">Fecha</th>
                                        <th className="text-left px-3 py-2">Origen</th>
                                        <th className="text-left px-3 py-2">Ref.</th>
                                        <th className="text-right px-3 py-2">Bruto</th>
                                        <th className="text-right px-3 py-2">Neto</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sales.map(s => (
                                        <tr key={s.id} className="border-t border-[var(--glass-border)]">
                                            <td className="px-3 py-2 text-[var(--color-text-muted)]">{format(new Date(s.date), 'dd/MM HH:mm')}</td>
                                            <td className="px-3 py-2">{s.source}</td>
                                            <td className="px-3 py-2 text-[var(--color-text-muted)]">{s.source === 'POS' ? `#${s.saleId}` : `Encargo #${s.preorderId}`}</td>
                                            <td className="px-3 py-2 text-right">{formatCurrency(s.total, currentCurrency)}</td>
                                            <td className="px-3 py-2 text-right text-[var(--color-primary)]">{formatCurrency(netExpected(s, commissionRate, fixedFee, includesIva), currentCurrency)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}
            </div>

            {/* CONCILIAR ABONO */}
            <div className="glass-card p-4">
                <h3 className="text-base font-bold text-[var(--color-text)] mb-1">Conciliar un abono</h3>
                <p className="text-xs text-[var(--color-text-muted)] mb-4">
                    Ingresa el monto que te abonó el banco. POSVECI busca qué ventas (contiguas o no) suman a ese valor.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                    <div>
                        <label className="block text-xs text-[var(--color-text-muted)] mb-1">Fecha del abono</label>
                        <input type="date" value={depositDate} onChange={e => setDepositDate(e.target.value)}
                            className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]" />
                    </div>
                    <div>
                        <label className="block text-xs text-[var(--color-text-muted)] mb-1">Monto abonado</label>
                        <input type="number" min="0" step="1" value={depositAmount} onChange={e => setDepositAmount(e.target.value)}
                            placeholder="Ej: 186450"
                            className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]" />
                    </div>
                    <div className="flex items-end">
                        <button
                            onClick={handleSearch}
                            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white font-semibold hover:opacity-90 transition-opacity"
                        >
                            <Search size={16} /> Buscar coincidencia
                        </button>
                    </div>
                </div>

                <div className="mb-3">
                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">Notas (opcional)</label>
                    <input
                        type="text"
                        value={depositNotes}
                        onChange={e => setDepositNotes(e.target.value)}
                        placeholder='Ej: "Cubre ventas previas al módulo" o "Abono parcial #1 del día"'
                        className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
                    />
                </div>

                {matchResult?.error && (
                    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">{matchResult.error}</div>
                )}

                {matchResult && !matchResult.error && (
                    <div className="mt-2 space-y-3">
                        <div className={`p-3 rounded-lg border ${matchResult.diff === 0 ? 'bg-green-500/10 border-green-500/30 text-green-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-200'}`}>
                            <div className="flex items-center gap-2 mb-1">
                                {matchResult.diff === 0
                                    ? <><CheckCircle2 size={16} /><b>Coincidencia exacta encontrada</b></>
                                    : <><AlertTriangle size={16} /><b>Coincidencia cercana (revisa)</b></>}
                            </div>
                            <div className="text-xs grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
                                <div>Ventas incluidas: <b>{matchedSales.length}</b></div>
                                <div>Neto suma: <b>{formatCurrency(matchResult.sumNet, currentCurrency)}</b></div>
                                <div>Diferencia: <b>{formatCurrency(matchResult.diff, currentCurrency)}</b></div>
                                <div>Estrategia: <b>{matchResult.strategy === 'contiguous' ? 'Ventana contigua' : 'Combinación libre'}</b></div>
                            </div>
                            {matchedSales.length > 0 && (
                                <div className="text-[11px] mt-2 opacity-90">
                                    Desde {format(new Date(matchedSales[0].date), 'dd/MM HH:mm')} hasta {format(new Date(matchedSales[matchedSales.length - 1].date), 'dd/MM HH:mm')}
                                </div>
                            )}
                        </div>

                        <button
                            onClick={() => handleSave()}
                            disabled={saving}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-500 text-white font-semibold hover:bg-green-600 transition-colors disabled:opacity-50"
                        >
                            <Save size={16} /> Marcar como conciliado y guardar
                        </button>
                    </div>
                )}

                {/* Atajo siempre disponible: guardar el abono SIN match exacto
                    (útil cuando arrancas el módulo y los primeros abonos cubren
                    ventas anteriores que no estaban etiquetadas con datáfono). */}
                <div className="mt-4 pt-3 border-t border-[var(--glass-border)]">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="text-[11px] text-[var(--color-text-muted)] max-w-md">
                            ¿No encuentra match exacto? Puedes <b>registrar el abono manualmente</b> con notas
                            para auditoría — útil al arrancar el módulo o cuando un abono cubre ventas pre-módulo.
                        </div>
                        <button
                            onClick={() => handleSave({ manual: true })}
                            disabled={saving || !depositAmount}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--glass-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 transition-colors text-xs"
                        >
                            <Save size={14} /> Guardar como abono histórico
                        </button>
                    </div>
                </div>
            </div>

            {/* HISTORIAL */}
            <div className="glass-card p-4">
                <div className="flex items-center gap-2 mb-3">
                    <History size={18} className="text-[var(--color-text-muted)]" />
                    <h3 className="text-base font-bold text-[var(--color-text)]">Historial de conciliaciones</h3>
                </div>
                {history.length === 0 ? (
                    <div className="p-4 text-center text-[var(--color-text-muted)] text-sm flex items-center justify-center gap-2">
                        <Info size={14} /> Aún no has conciliado abonos.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead className="text-[var(--color-text-muted)]">
                                <tr>
                                    <th className="text-left px-3 py-2">Fecha abono</th>
                                    <th className="text-left px-3 py-2">Datáfono</th>
                                    <th className="text-right px-3 py-2">Abonado</th>
                                    <th className="text-right px-3 py-2">Esperado</th>
                                    <th className="text-right px-3 py-2">Dif.</th>
                                    <th className="text-left px-3 py-2">Ventas</th>
                                    <th className="text-left px-3 py-2">Por</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {history.map(h => {
                                    let saleIds = [];
                                    try { saleIds = JSON.parse(h.sale_ids || '[]'); } catch { /* noop */ }
                                    const isManual = saleIds.length === 0;
                                    const diff = Number(h.difference) || 0;
                                    return (
                                        <tr key={h.id} className="border-t border-[var(--glass-border)]">
                                            <td className="px-3 py-2">{h.deposit_date}</td>
                                            <td className="px-3 py-2">
                                                <span className="inline-flex items-center gap-1">
                                                    {h.terminal_color && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: h.terminal_color }} />}
                                                    <Smartphone size={12} className="text-[var(--color-text-muted)]" />
                                                    {h.terminal_name || '—'}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-right">{formatCurrency(h.deposit_amount, currentCurrency)}</td>
                                            <td className="px-3 py-2 text-right text-[var(--color-text-muted)]">{formatCurrency(h.expected_amount, currentCurrency)}</td>
                                            <td className={`px-3 py-2 text-right ${isManual ? 'text-[var(--color-text-muted)]' : Math.abs(diff) > 50 ? 'text-amber-400' : 'text-green-400'}`}>
                                                {isManual ? '—' : formatCurrency(diff, currentCurrency)}
                                            </td>
                                            <td className="px-3 py-2 text-[var(--color-text-muted)]">
                                                {isManual
                                                    ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--glass-border)] text-[var(--color-text-muted)]">Manual</span>
                                                    : saleIds.length}
                                            </td>
                                            <td className="px-3 py-2 text-[var(--color-text-muted)]">{h.user_name || '—'}</td>
                                            <td className="px-3 py-2 text-right">
                                                <button onClick={() => handleDeleteHistory(h.id)} className="text-[var(--color-text-muted)] hover:text-red-400">
                                                    <Trash2 size={14} />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

const Stat = ({ label, value, tone = 'default' }) => (
    <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--color-surface)] px-3 py-2">
        <p className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
        <p className={`text-lg font-bold ${tone === 'primary' ? 'text-[var(--color-primary)]' : tone === 'muted' ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text)]'}`}>
            {value}
        </p>
    </div>
);

// Iconos no usados explícitamente afuera del componente — silencio el linter manteniendo
// las importaciones legibles.
void Calendar;

export default PaymentReconciliation;
