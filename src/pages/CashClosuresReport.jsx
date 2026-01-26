import React, { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { format, isValid } from 'date-fns';
import { Search, Eye, Filter, X } from 'lucide-react';
import { cn } from '../lib/utils';

// Helper for safe date formatting
const safeFormat = (dateString, fmt) => {
    if (!dateString) return '-';
    const d = new Date(dateString);
    if (!isValid(d)) return '-';
    return format(d, fmt);
};

const CashClosuresReport = () => {
    const { fetchClosedRegisters, getRegisterReport } = useStore();
    const [closures, setClosures] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showFilters, setShowFilters] = useState(false);
    const [filterUser, setFilterUser] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStartDate, setFilterStartDate] = useState('');
    const [filterEndDate, setFilterEndDate] = useState('');

    // Modal state
    const [detailModalOpen, setDetailModalOpen] = useState(false);
    const [selectedRegister, setSelectedRegister] = useState(null);
    const [reportDetails, setReportDetails] = useState(null);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            setIsLoading(true);
            const data = await fetchClosedRegisters();
            // Ensure data is an array
            setClosures(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error("Error loading closures:", error);
            setClosures([]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleViewDetails = async (register) => {
        if (!register) return;
        setDetailModalOpen(true);
        setSelectedRegister(register);
        setReportDetails(null); // Reset details while loading

        try {
            const report = await getRegisterReport(register);
            setReportDetails(report);
        } catch (error) {
            console.error("Error loading detailed report:", error);
        }
    };

    const closeDetailModal = () => {
        setDetailModalOpen(false);
        setSelectedRegister(null);
        setReportDetails(null);
    };

    // Extract unique users for filter dropdown (safely)
    const uniqueUsers = Array.from(new Set(closures.map(c => c?.user_name))).filter(Boolean);

    const filteredClosures = closures.filter(c => {
        if (!c) return false;

        const obs = c.observations || '';
        const uname = c.user_name || '';
        const search = searchTerm || '';

        try {
            const matchesSearch =
                String(obs).toLowerCase().includes(search.toLowerCase()) ||
                String(uname).toLowerCase().includes(search.toLowerCase());

            const matchesUser = filterUser ? String(c.user_name) === String(filterUser) : true;

            let matchesDate = true;
            if (filterStartDate && c.closing_time) {
                const closeDate = new Date(c.closing_time);
                matchesDate = matchesDate && isValid(closeDate) && closeDate >= new Date(filterStartDate);
            }
            if (filterEndDate && c.closing_time) {
                const closeDate = new Date(c.closing_time);
                matchesDate = matchesDate && isValid(closeDate) && closeDate <= new Date(filterEndDate);
            }

            return matchesSearch && matchesUser && matchesDate;
        } catch (error) {
            console.error("Filter error:", error);
            return false;
        }
    });

    const clearFilters = () => {
        setFilterUser('');
        setFilterStartDate('');
        setFilterEndDate('');
        setSearchTerm('');
    };

    return (
        <div className="space-y-6 relative z-10 p-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-[var(--color-text)] neon-text">Cierres de Caja</h1>
                    <p className="text-[var(--color-text-muted)]">Historial y detalle de turnos cerrados</p>
                </div>
            </div>

            {/* Filter Bar */}
            <div className="space-y-4">
                <div className="glass-card p-4 flex gap-4">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" size={20} />
                        <input
                            type="text"
                            placeholder="Buscar por usuario u observación..."
                            className="glass-input !pl-12 w-full"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className={cn(
                            "btn-secondary flex items-center gap-2 transition-all",
                            showFilters ? "bg-[var(--color-primary)] text-black" : ""
                        )}
                    >
                        <Filter size={18} />
                        {showFilters ? 'Ocultar Filtros' : 'Filtrar'}
                    </button>
                </div>

                {/* Expanded Filters */}
                {showFilters && (
                    <div className="glass-card p-4 grid grid-cols-1 md:grid-cols-4 gap-4 animate-in fade-in slide-in-from-top-2">
                        <div className="space-y-1">
                            <label className="text-xs text-[var(--color-text-muted)]">Vendedor</label>
                            <select
                                className="glass-input w-full [&>option]:bg-[#0f0f2d] [&>option]:text-white"
                                value={filterUser}
                                onChange={(e) => setFilterUser(e.target.value)}
                            >
                                <option value="">Todos los vendedores</option>
                                {uniqueUsers.map(user => (
                                    <option key={user} value={user}>{user}</option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs text-[var(--color-text-muted)]">Desde (Fecha/Hora)</label>
                            <input
                                type="datetime-local"
                                className="glass-input w-full"
                                value={filterStartDate}
                                onChange={(e) => setFilterStartDate(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs text-[var(--color-text-muted)]">Hasta (Fecha/Hora)</label>
                            <input
                                type="datetime-local"
                                className="glass-input w-full"
                                value={filterEndDate}
                                onChange={(e) => setFilterEndDate(e.target.value)}
                            />
                        </div>
                        <div className="flex items-end">
                            <button
                                onClick={clearFilters}
                                className="w-full btn-ghost border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                            >
                                Limpiar Filtros
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Table */}
            <div className="glass-card p-0 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-[var(--glass-bg)] text-[var(--color-text-muted)] uppercase text-xs font-semibold">
                            <tr>
                                <th className="px-6 py-4">Fecha Cierre</th>
                                <th className="px-6 py-4">Usuario</th>
                                <th className="px-6 py-4">Apertura</th>
                                <th className="px-6 py-4">Cierre</th>
                                <th className="px-6 py-4">Diferencia</th>
                                <th className="px-6 py-4 text-center">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--glass-border)]">
                            {isLoading ? (
                                <tr><td colSpan="6" className="text-center py-8">Cargando...</td></tr>
                            ) : filteredClosures.length === 0 ? (
                                <tr><td colSpan="6" className="text-center py-8 text-[var(--color-text-muted)]">
                                    {closures.length > 0 ? 'No se encontraron resultados.' : 'No hay cierres registrados.'}
                                </td></tr>
                            ) : (
                                filteredClosures.map((item) => (
                                    <tr key={item?.id || Math.random()} className="hover:bg-[var(--glass-bg)] transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col">
                                                <span className="text-[var(--color-text)] font-medium">
                                                    {safeFormat(item.closing_time, 'dd/MM/yyyy HH:mm')}
                                                </span>
                                                <span className="text-xs text-[var(--color-text-muted)]">
                                                    Turno #{item.id}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-[var(--color-text)]">{item.user_name || 'Desconocido'}</td>
                                        <td className="px-6 py-4 text-[var(--color-text-muted)]">${Number(item.opening_amount || 0).toFixed(2)}</td>
                                        <td className="px-6 py-4 font-bold text-[var(--color-primary)]">${Number(item.final_amount || 0).toFixed(2)}</td>
                                        <td className="px-6 py-4">
                                            <span className={cn(
                                                "px-2 py-1 rounded text-xs font-bold border",
                                                (item.difference || 0) === 0 ? "bg-green-500/20 text-green-400 border-green-500/30" :
                                                    (item.difference || 0) > 0 ? "bg-blue-500/20 text-blue-400 border-blue-500/30" :
                                                        "bg-red-500/20 text-red-400 border-red-500/30"
                                            )}>
                                                {(item.difference || 0) > 0 ? '+' : ''}{Number(item.difference || 0).toFixed(2)}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            <button
                                                onClick={() => handleViewDetails(item)}
                                                className="hover:text-[var(--color-primary)] text-[var(--color-text-muted)] transition-colors p-2"
                                                title="Ver Detalle"
                                            >
                                                <Eye size={20} />
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Detail Modal */}
            {detailModalOpen && selectedRegister && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                    <div className="bg-[var(--color-surface)] border border-[var(--color-primary)] rounded-t-2xl w-full max-w-md shadow-[0_0_50px_rgba(0,240,255,0.2)] relative flex flex-col max-h-[90vh] ticket-modal">
                        <button
                            onClick={closeDetailModal}
                            className="absolute top-4 right-4 text-[var(--color-text-muted)] hover:text-[var(--color-text)] z-10"
                        >
                            <X size={24} />
                        </button>

                        <div className="p-6 pb-2 text-center relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[var(--color-primary)] to-transparent opacity-50"></div>
                            <h2 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-[var(--color-primary)] neon-text mb-1">CIERRE</h2>
                            <p className="text-[var(--color-primary)] font-bold tracking-widest text-lg">DETALLE #{selectedRegister.id}</p>
                            <div className="mt-4 border-b-2 border-dashed border-[var(--color-primary)]/30 w-full opacity-50"></div>
                        </div>

                        <div className="p-8 pt-2 overflow-y-auto space-y-4 font-mono text-sm text-[var(--color-text)]">
                            {!reportDetails ? (
                                <div className="text-center py-10 animate-pulse text-[var(--color-primary)]">Cargando detalles...</div>
                            ) : (
                                <>
                                    <div className="space-y-1 pb-4 border-b border-dashed border-[var(--glass-border)] text-center">
                                        <p className="text-[var(--color-text-muted)] text-xs uppercase tracking-wider">Responsable</p>
                                        <p className="font-bold text-lg">{selectedRegister.user_name}</p>
                                        <div className="flex justify-center gap-4 text-xs text-[var(--color-text-muted)] mt-1">
                                            <span>{safeFormat(selectedRegister.opening_time, 'dd/MM HH:mm')}</span>
                                            <span>→</span>
                                            <span>{safeFormat(selectedRegister.closing_time, 'dd/MM HH:mm')}</span>
                                        </div>
                                    </div>

                                    <div className="space-y-3 py-2">
                                        <div className="flex justify-between items-end border-b border-[var(--glass-border)] pb-2">
                                            <span className="text-[var(--color-text-muted)]">Fondo Inicial</span>
                                            <span className="font-bold text-lg">${Number(reportDetails.opening_amount).toFixed(2)}</span>
                                        </div>

                                        <div className="flex justify-between items-end">
                                            <span className="text-[var(--color-primary)] font-bold">Ventas Totales</span>
                                            <span className="font-bold text-lg text-[var(--color-primary)]">${Number(reportDetails.salesBreakdown?.total || 0).toFixed(2)}</span>
                                        </div>
                                        <div className="pl-4 text-xs space-y-1 text-[var(--color-text-muted)] border-l-2 border-[var(--glass-border)] ml-1">
                                            <div className="flex justify-between"><span>Efectivo</span> <span>${Number(reportDetails.salesBreakdown?.cash || 0).toFixed(2)}</span></div>
                                            <div className="flex justify-between"><span>Tarjeta</span> <span>${Number(reportDetails.salesBreakdown?.card || 0).toFixed(2)}</span></div>
                                            <div className="flex justify-between"><span>Transferencia</span> <span>${Number(reportDetails.salesBreakdown?.transfer || 0).toFixed(2)}</span></div>
                                        </div>

                                        {(reportDetails.movements?.in > 0 || reportDetails.movements?.out > 0) && (
                                            <div className="grid grid-cols-2 gap-4 pt-2">
                                                <div className="bg-green-500/10 p-2 rounded border border-green-500/20">
                                                    <div className="text-xs text-green-400">Ingresos</div>
                                                    <div className="font-bold text-green-300">+${Number(reportDetails.movements.in).toFixed(2)}</div>
                                                </div>
                                                <div className="bg-red-500/10 p-2 rounded border border-red-500/20">
                                                    <div className="text-xs text-red-400">Retiros</div>
                                                    <div className="font-bold text-red-300">-${Number(reportDetails.movements.out).toFixed(2)}</div>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div className="bg-[var(--glass-bg)] p-4 rounded-lg border border-[var(--glass-border)] space-y-3 mt-4">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-[var(--color-text-muted)]">Efectivo Esperado</span>
                                            <span className="font-bold">${Number(reportDetails.calculatedExpected || 0).toFixed(2)}</span>
                                        </div>
                                        <div className="flex justify-between text-base">
                                            <span className="font-bold">Efectivo Real</span>
                                            <span className="font-bold text-white text-lg">${Number(selectedRegister.final_amount || 0).toFixed(2)}</span>
                                        </div>
                                        <div className="border-t border-[var(--glass-border)] pt-2 flex justify-between items-center">
                                            <span className="text-sm font-medium">Diferencia</span>
                                            <span className={cn(
                                                "font-black text-xl neon-text",
                                                (selectedRegister.difference || 0) >= 0 ? "text-[var(--color-primary)]" : "text-red-500"
                                            )}>
                                                {(selectedRegister.difference || 0) > 0 ? '+' : ''}{Number(selectedRegister.difference || 0).toFixed(2)}
                                            </span>
                                        </div>
                                    </div>

                                    {selectedRegister.observations && (
                                        <div className="text-xs text-center text-[var(--color-text-muted)] italic pt-2">
                                            "{selectedRegister.observations}"
                                        </div>
                                    )}

                                    <div className="pt-4 text-center">
                                        <p className="text-[10px] text-[var(--color-text-muted)] tracking-widest uppercase">
                                            *** Fin del Reporte ***
                                        </p>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CashClosuresReport;
