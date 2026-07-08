import React, { useState, useEffect, useMemo } from 'react';
import { useStore } from '../store/useStore';
import { dataApiCall, reportCall } from '../lib/dataApi';
import { formatCurrency } from '../utils/formatCurrency';
import { formatInCompanyTime, toUTC } from '../lib/dateHelpers';
import {
    FileText, Receipt, CheckCircle2, Clock, AlertTriangle, XCircle,
    Search, Calendar, RefreshCw, Filter, ChevronDown, ChevronUp,
    ExternalLink, Stamp
} from 'lucide-react';

const DocumentosSII = () => {
    const { activeCompanyId, currentCompanyTimezone, currentCurrency } = useStore();

    const todayStr = new Date().toLocaleDateString('en-CA');
    const [dateFrom, setDateFrom] = useState(todayStr);
    const [dateTo, setDateTo] = useState(todayStr);
    const [tipoFilter, setTipoFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [searchFolio, setSearchFolio] = useState('');

    const [dtes, setDtes] = useState([]);
    const [loading, setLoading] = useState(false);
    const [stats, setStats] = useState({ total: 0, accepted: 0, rejected: 0, pending: 0, totalAmount: 0 });
    const [selectedDte, setSelectedDte] = useState(null);
    const [checkingStatus, setCheckingStatus] = useState(null);
    const [retrying, setRetrying] = useState(null);

    const fetchDtes = async () => {
        if (!activeCompanyId) return;
        setLoading(true);
        try {
            const tz = currentCompanyTimezone || 'America/Santiago';
            const startUtc = dateFrom ? toUTC(new Date(`${dateFrom}T00:00:00`), tz).toISOString() : null;
            const endUtc = dateTo ? toUTC(new Date(`${dateTo}T23:59:59`), tz).toISOString() : null;
            const result = { rows: await reportCall(activeCompanyId, 'dtesList', { startUtc, endUtc, tipoFilter, statusFilter }) };
            setDtes(result.rows);

            // Calc stats
            const rows = result.rows;
            setStats({
                total: rows.length,
                accepted: rows.filter(r => r.status === 'accepted').length,
                rejected: rows.filter(r => r.status === 'rejected').length,
                pending: rows.filter(r => r.status === 'pending' || r.status === 'sent').length,
                totalAmount: rows.reduce((sum, r) => sum + (Number(r.sale_total) || 0), 0)
            });
        } catch (e) {
            console.error('Error fetching DTEs:', e);
        } finally {
            setLoading(false);
        }
    };

    const [autoChecked, setAutoChecked] = useState(false);

    useEffect(() => {
        fetchDtes();
        setAutoChecked(false);
    }, [activeCompanyId, dateFrom, dateTo, tipoFilter, statusFilter]);

    // Auto-check pending/sent DTEs on page load
    useEffect(() => {
        if (autoChecked || !dtes.length || !activeCompanyId) return;
        const pendingDtes = dtes.filter(d => (d.status === 'sent' || d.status === 'pending') && d.track_id);
        if (!pendingDtes.length) return;

        setAutoChecked(true);
        let cancelled = false;
        const checkPending = async () => {
            let updated = false;
            for (const dte of pendingDtes) {
                if (cancelled) break;
                try {
                    const resp = await fetch(`/api/sii/status?track_id=${encodeURIComponent(dte.track_id)}`, {
                        headers: { 'x-company-id': activeCompanyId },
                    });
                    const data = await resp.json();
                    if (resp.ok && data.estado && data.estado !== data.estado_anterior) {
                        console.log(`✅ DTE ${dte.folio}: ${data.estado_anterior} → ${data.estado}`);
                        updated = true;
                    }
                } catch (e) {
                    console.warn(`Auto-check DTE ${dte.folio} falló:`, e.message);
                }
            }
            if (!cancelled && updated) fetchDtes();
        };
        checkPending();

        return () => { cancelled = true; };
    }, [dtes, autoChecked]);

    const filteredDtes = useMemo(() => {
        if (!searchFolio) return dtes;
        return dtes.filter(d => String(d.folio).includes(searchFolio));
    }, [dtes, searchFolio]);

    const handleCheckStatus = async (dte) => {
        setCheckingStatus(dte.id);
        try {
            const resp = await fetch(`/api/sii/status?track_id=${encodeURIComponent(dte.track_id)}`, {
                method: 'GET',
                headers: { 'x-company-id': activeCompanyId },
            });
            const data = await resp.json();
            if (resp.ok && data.estado) {
                // El backend ya actualiza la DB, solo refrescamos
                fetchDtes();
            } else if (data.error) {
                console.error('SII status error:', data.error);
            }
        } catch (e) {
            console.error('Error checking DTE status:', e);
        } finally {
            setCheckingStatus(null);
        }
    };

    const handleRetry = async (dte) => {
        setRetrying(dte.id);
        try {
            // Eliminar el DTE con error para poder reemitir
            await dataApiCall('dteRetryDelete', { companyId: activeCompanyId, dteId: dte.id });
            // Re-emitir
            const resp = await fetch('/api/sii/emit', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-company-id': activeCompanyId,
                },
                body: JSON.stringify({
                    sale_id: dte.sale_id,
                    tipo_dte: Number(dte.tipo),
                }),
            });
            const data = await resp.json();
            if (data.success) {
                console.log('DTE reemitido exitosamente:', data);
            } else {
                console.error('Error reemitiendo DTE:', data.error);
            }
            fetchDtes();
        } catch (e) {
            console.error('Error en reintento:', e);
        } finally {
            setRetrying(null);
        }
    };

    const parseSiiResponse = (responseStr) => {
        if (!responseStr) return null;
        try {
            return JSON.parse(responseStr);
        } catch {
            return { raw: responseStr };
        }
    };

    const getStatusBadge = (status) => {
        switch (status) {
            case 'accepted':
                return (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-green-500/20 text-green-400 border border-green-500/30">
                        <CheckCircle2 size={12} /> Aceptado
                    </span>
                );
            case 'rejected':
                return (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-red-500/20 text-red-400 border border-red-500/30">
                        <XCircle size={12} /> Rechazado
                    </span>
                );
            case 'sent':
                return (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                        <Clock size={12} /> Enviado
                    </span>
                );
            case 'pending':
                return (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-gray-500/20 text-gray-400 border border-gray-500/30">
                        <Clock size={12} /> Pendiente
                    </span>
                );
            case 'error':
                return (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-red-500/20 text-red-400 border border-red-500/30">
                        <AlertTriangle size={12} /> Error
                    </span>
                );
            default:
                return (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-gray-500/20 text-gray-400 border border-gray-500/30">
                        {status || 'Desconocido'}
                    </span>
                );
        }
    };

    const getTipoBadge = (tipo) => {
        if (Number(tipo) === 33) {
            return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-purple-500/20 text-purple-400 border border-purple-500/30">
                    <FileText size={12} /> Factura
                </span>
            );
        }
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">
                <Receipt size={12} /> Boleta
            </span>
        );
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-400">
                        <Stamp size={24} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-white">Documentos SII</h1>
                        <p className="text-sm text-gray-400">Documentos tributarios electrónicos emitidos</p>
                    </div>
                </div>
                <button
                    onClick={fetchDtes}
                    disabled={loading}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] text-gray-300 hover:text-white hover:border-white/20 transition-all disabled:opacity-50"
                >
                    <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                    Actualizar
                </button>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="glass-card p-4">
                    <div className="text-2xl font-black text-white">{stats.total}</div>
                    <div className="text-xs text-gray-400">Total DTEs</div>
                </div>
                <div className="glass-card p-4">
                    <div className="text-2xl font-black text-green-400">{stats.accepted}</div>
                    <div className="text-xs text-gray-400 flex items-center gap-1"><CheckCircle2 size={12} /> Aceptados</div>
                </div>
                <div className="glass-card p-4">
                    <div className="text-2xl font-black text-red-400">{stats.rejected}</div>
                    <div className="text-xs text-gray-400 flex items-center gap-1"><XCircle size={12} /> Rechazados</div>
                </div>
                <div className="glass-card p-4">
                    <div className="text-2xl font-black text-yellow-400">{stats.pending}</div>
                    <div className="text-xs text-gray-400 flex items-center gap-1"><Clock size={12} /> Pendientes</div>
                </div>
                <div className="glass-card p-4 col-span-2 md:col-span-1">
                    <div className="text-2xl font-black text-cyan-400">{formatCurrency(stats.totalAmount, currentCurrency)}</div>
                    <div className="text-xs text-gray-400">Monto Total</div>
                </div>
            </div>

            {/* Filters */}
            <div className="glass-card p-4">
                <div className="flex flex-wrap gap-3 items-end">
                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-gray-400">Desde</label>
                        <input
                            type="date"
                            value={dateFrom}
                            onChange={e => setDateFrom(e.target.value)}
                            className="glass-input text-sm px-3 py-2"
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-gray-400">Hasta</label>
                        <input
                            type="date"
                            value={dateTo}
                            onChange={e => setDateTo(e.target.value)}
                            className="glass-input text-sm px-3 py-2"
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-gray-400">Tipo</label>
                        <select
                            value={tipoFilter}
                            onChange={e => setTipoFilter(e.target.value)}
                            className="glass-input text-sm px-3 py-2"
                        >
                            <option value="">Todos</option>
                            <option value="39">Boleta (39)</option>
                            <option value="33">Factura (33)</option>
                        </select>
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-gray-400">Estado</label>
                        <select
                            value={statusFilter}
                            onChange={e => setStatusFilter(e.target.value)}
                            className="glass-input text-sm px-3 py-2"
                        >
                            <option value="">Todos</option>
                            <option value="accepted">Aceptado</option>
                            <option value="rejected">Rechazado</option>
                            <option value="sent">Enviado</option>
                            <option value="pending">Pendiente</option>
                            <option value="error">Error</option>
                        </select>
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-gray-400">Buscar Folio</label>
                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                value={searchFolio}
                                onChange={e => setSearchFolio(e.target.value)}
                                placeholder="N° folio..."
                                className="glass-input text-sm pl-8 pr-3 py-2 w-32"
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* DTE Table */}
            <div className="glass-card overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <RefreshCw size={24} className="animate-spin text-gray-400" />
                    </div>
                ) : filteredDtes.length === 0 ? (
                    <div className="text-center py-20 text-gray-400">
                        <Stamp size={48} className="mx-auto mb-4 opacity-30" />
                        <p className="text-lg font-medium">No hay documentos</p>
                        <p className="text-sm">No se encontraron DTEs para los filtros seleccionados</p>
                    </div>
                ) : (
                    <>
                        {/* Desktop table */}
                        <div className="hidden md:block overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-[var(--glass-border)] text-left text-gray-400">
                                        <th className="px-4 py-3 font-medium">Folio</th>
                                        <th className="px-4 py-3 font-medium">Tipo</th>
                                        <th className="px-4 py-3 font-medium">Estado</th>
                                        <th className="px-4 py-3 font-medium">Monto</th>
                                        <th className="px-4 py-3 font-medium">Fecha</th>
                                        <th className="px-4 py-3 font-medium">Track ID</th>
                                        <th className="px-4 py-3 font-medium">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredDtes.map(dte => (
                                        <tr
                                            key={dte.id}
                                            className="border-b border-[var(--glass-border)] hover:bg-white/5 transition-colors cursor-pointer"
                                            onClick={() => setSelectedDte(selectedDte?.id === dte.id ? null : dte)}
                                        >
                                            <td className="px-4 py-3 font-bold text-white">N° {dte.folio}</td>
                                            <td className="px-4 py-3">{getTipoBadge(dte.tipo)}</td>
                                            <td className="px-4 py-3">{getStatusBadge(dte.status)}</td>
                                            <td className="px-4 py-3 text-green-400 font-bold">
                                                {dte.sale_total ? formatCurrency(Number(dte.sale_total), currentCurrency) : '-'}
                                            </td>
                                            <td className="px-4 py-3 text-gray-300">
                                                {formatInCompanyTime(dte.created_at, currentCompanyTimezone, 'dd/MM/yy HH:mm')}
                                            </td>
                                            <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                                                {dte.track_id ? dte.track_id.slice(0, 12) + '...' : '-'}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex gap-1">
                                                    {(dte.status === 'sent' || dte.status === 'pending') && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleCheckStatus(dte); }}
                                                            disabled={checkingStatus === dte.id}
                                                            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 border border-yellow-500/20 transition-all disabled:opacity-50"
                                                        >
                                                            <RefreshCw size={12} className={checkingStatus === dte.id ? 'animate-spin' : ''} />
                                                            Consultar
                                                        </button>
                                                    )}
                                                    {dte.status === 'error' && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleRetry(dte); }}
                                                            disabled={retrying === dte.id}
                                                            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 border border-orange-500/20 transition-all disabled:opacity-50"
                                                        >
                                                            <RefreshCw size={12} className={retrying === dte.id ? 'animate-spin' : ''} />
                                                            Reintentar
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Mobile cards */}
                        <div className="md:hidden divide-y divide-[var(--glass-border)]">
                            {filteredDtes.map(dte => (
                                <div
                                    key={dte.id}
                                    className="p-4 hover:bg-white/5 transition-colors"
                                    onClick={() => setSelectedDte(selectedDte?.id === dte.id ? null : dte)}
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="font-bold text-white text-lg">N° {dte.folio}</span>
                                        {getTipoBadge(dte.tipo)}
                                    </div>
                                    <div className="flex items-center justify-between">
                                        {getStatusBadge(dte.status)}
                                        <span className="text-green-400 font-bold">
                                            {dte.sale_total ? formatCurrency(Number(dte.sale_total), currentCurrency) : '-'}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between mt-2">
                                        <span className="text-xs text-gray-500">
                                            {formatInCompanyTime(dte.created_at, currentCompanyTimezone, 'dd/MM/yy HH:mm')}
                                        </span>
                                        {(dte.status === 'sent' || dte.status === 'pending') && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleCheckStatus(dte); }}
                                                disabled={checkingStatus === dte.id}
                                                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 border border-yellow-500/20 transition-all disabled:opacity-50"
                                            >
                                                <RefreshCw size={12} className={checkingStatus === dte.id ? 'animate-spin' : ''} />
                                                Consultar
                                            </button>
                                        )}
                                    </div>

                                    {selectedDte?.id === dte.id && (
                                        <div className="mt-3 p-3 rounded-lg bg-white/5 border border-white/10 space-y-2 text-sm">
                                            <div className="flex justify-between">
                                                <span className="text-gray-400">Sale ID:</span>
                                                <span className="text-white font-mono">{dte.sale_id || '-'}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-gray-400">Track ID:</span>
                                                <span className="text-white font-mono text-xs">{dte.track_id || '-'}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-gray-400">Pago:</span>
                                                <span className="text-white">{dte.payment_method || '-'}</span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>

            {/* Desktop Detail Panel */}
            {selectedDte && (
                <div className="hidden md:block glass-card p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            {Number(selectedDte.tipo) === 33 ? <FileText size={20} /> : <Receipt size={20} />}
                            Detalle DTE N° {selectedDte.folio}
                        </h3>
                        <button onClick={() => setSelectedDte(null)} className="text-gray-400 hover:text-white">
                            <XCircle size={20} />
                        </button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                            <span className="text-xs text-gray-400">Tipo Documento</span>
                            <div className="mt-1">{getTipoBadge(selectedDte.tipo)}</div>
                        </div>
                        <div>
                            <span className="text-xs text-gray-400">Estado</span>
                            <div className="mt-1">{getStatusBadge(selectedDte.status)}</div>
                        </div>
                        <div>
                            <span className="text-xs text-gray-400">Monto Venta</span>
                            <div className="mt-1 text-green-400 font-bold">
                                {selectedDte.sale_total ? formatCurrency(Number(selectedDte.sale_total), currentCurrency) : '-'}
                            </div>
                        </div>
                        <div>
                            <span className="text-xs text-gray-400">Método de Pago</span>
                            <div className="mt-1 text-white">{selectedDte.payment_method || '-'}</div>
                        </div>
                        <div>
                            <span className="text-xs text-gray-400">Folio</span>
                            <div className="mt-1 text-white font-bold">{selectedDte.folio}</div>
                        </div>
                        <div>
                            <span className="text-xs text-gray-400">Sale ID</span>
                            <div className="mt-1 text-white font-mono">{selectedDte.sale_id || '-'}</div>
                        </div>
                        <div className="col-span-2">
                            <span className="text-xs text-gray-400">Track ID</span>
                            <div className="mt-1 text-white font-mono text-sm break-all">{selectedDte.track_id || '-'}</div>
                        </div>
                        <div>
                            <span className="text-xs text-gray-400">Fecha de Emisión</span>
                            <div className="mt-1 text-white">
                                {formatInCompanyTime(selectedDte.created_at, currentCompanyTimezone, 'dd/MM/yyyy HH:mm:ss')}
                            </div>
                        </div>
                        {selectedDte.sii_response && (
                            <div className="col-span-2 md:col-span-4">
                                <span className="text-xs text-gray-400">Respuesta SII</span>
                                <div className="mt-1 p-3 rounded-lg bg-white/5 border border-white/10 font-mono text-xs text-gray-300 break-all whitespace-pre-wrap">
                                    {(() => {
                                        const parsed = parseSiiResponse(selectedDte.sii_response);
                                        if (parsed?.error) return <span className="text-red-400">{parsed.error}</span>;
                                        return JSON.stringify(parsed, null, 2);
                                    })()}
                                </div>
                            </div>
                        )}
                    </div>
                    {selectedDte.status === 'error' && (
                        <div className="mt-4 pt-4 border-t border-[var(--glass-border)]">
                            <button
                                onClick={() => handleRetry(selectedDte)}
                                disabled={retrying === selectedDte.id}
                                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 border border-orange-500/30 transition-all disabled:opacity-50"
                            >
                                <RefreshCw size={16} className={retrying === selectedDte.id ? 'animate-spin' : ''} />
                                Reintentar envío al SII
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default DocumentosSII;
