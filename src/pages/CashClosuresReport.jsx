import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { format, isValid } from 'date-fns';
import { Search, Eye, Calendar, Users, User, Check, ChevronDown, X } from 'lucide-react';
import { cn } from '../lib/utils';

// Helper for safe date formatting
const safeFormat = (dateString, fmt) => {
    if (!dateString) return '-';
    const d = new Date(dateString);
    if (!isValid(d)) return '-';
    return format(d, fmt);
};

// Vendor Selector 3D
const ClosureVendorSelector = ({ value, onChange, users }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const selectedLabel = value || 'Todos';
    const colors = ['#00f0ff', '#a855f7', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#6366f1', '#14b8a6'];
    const getColor = (i) => colors[i % colors.length];
    const getInitials = (name) => name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

    return (
        <div ref={ref} style={{ position: 'relative', minWidth: 220 }}>
            <button
                onClick={() => setOpen(!open)}
                style={{
                    width: '100%', padding: '10px 14px', borderRadius: 12,
                    border: '1px solid ' + (open ? 'rgba(0,240,255,0.5)' : 'rgba(255,255,255,0.08)'),
                    background: 'linear-gradient(145deg, rgba(15,15,45,0.9), rgba(20,20,60,0.7))',
                    boxShadow: open ? '0 0 20px rgba(0,240,255,0.15), inset 0 1px 0 rgba(255,255,255,0.05)' : '0 4px 15px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)',
                    color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.85rem',
                }}
            >
                {value ? (
                    <span style={{ width: 28, height: 28, borderRadius: 8, background: `linear-gradient(135deg, ${getColor(users.indexOf(value))}, ${getColor(users.indexOf(value))}88)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700, flexShrink: 0, boxShadow: `0 2px 8px ${getColor(users.indexOf(value))}40` }}>{getInitials(value)}</span>
                ) : (
                    <span style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, rgba(0,240,255,0.2), rgba(0,240,255,0.05))', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Users size={14} style={{ color: '#00f0ff' }} /></span>
                )}
                <span style={{ flex: 1, textAlign: 'left', fontWeight: 500 }}>{selectedLabel}</span>
                <ChevronDown size={16} style={{ color: 'rgba(255,255,255,0.4)', transition: 'transform 0.25s', transform: open ? 'rotate(180deg)' : 'rotate(0)' }} />
            </button>
            {open && (
                <div style={{
                    position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 50, borderRadius: 14,
                    border: '1px solid rgba(0,240,255,0.15)', background: 'linear-gradient(165deg, rgba(12,12,40,0.98), rgba(8,8,30,0.98))',
                    backdropFilter: 'blur(24px)', boxShadow: '0 12px 40px rgba(0,0,0,0.5), 0 0 30px rgba(0,240,255,0.08)', padding: 6, maxHeight: 280, overflowY: 'auto',
                    animation: 'vendorDropIn 0.2s ease-out',
                }}>
                    {[{ val: '', label: 'Todos' }, ...users.map(u => ({ val: u, label: u }))].map((opt, i) => {
                        const isSelected = opt.val === value;
                        return (
                            <button key={opt.val} onClick={() => { onChange(opt.val); setOpen(false); }}
                                style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: 'none', background: isSelected ? 'rgba(0,240,255,0.1)' : 'transparent', color: isSelected ? '#00f0ff' : '#e2e8f0', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.85rem', marginBottom: 2 }}
                                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = isSelected ? 'rgba(0,240,255,0.1)' : 'transparent'; }}
                            >
                                {opt.val ? (
                                    <span style={{ width: 30, height: 30, borderRadius: 8, background: `linear-gradient(135deg, ${getColor(i - 1)}, ${getColor(i - 1)}66)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700, color: '#fff', boxShadow: `0 2px 8px ${getColor(i - 1)}30` }}>{getInitials(opt.label)}</span>
                                ) : (
                                    <span style={{ width: 30, height: 30, borderRadius: 8, background: 'linear-gradient(135deg, rgba(0,240,255,0.2), rgba(0,240,255,0.05))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Users size={14} style={{ color: '#00f0ff' }} /></span>
                                )}
                                <span style={{ flex: 1, textAlign: 'left', fontWeight: isSelected ? 600 : 400 }}>{opt.label}</span>
                                {isSelected && <Check size={16} style={{ color: '#00f0ff' }} />}
                            </button>
                        );
                    })}
                </div>
            )}
            <style>{`@keyframes vendorDropIn { from { opacity: 0; transform: translateY(-8px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }`}</style>
        </div>
    );
};

const CashClosuresReport = () => {
    const { fetchClosedRegisters, getRegisterReport } = useStore();
    const [closures, setClosures] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [offset, setOffset] = useState(0);
    const LIMIT = 20;

    const [showFilters, setShowFilters] = useState(false);
    const [filterUser, setFilterUser] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [dateRange, setDateRange] = useState('today');
    const [startDate, setStartDate] = useState(() => new Date().toLocaleDateString('en-CA'));
    const [endDate, setEndDate] = useState(() => new Date().toLocaleDateString('en-CA'));

    // Modal state
    const [detailModalOpen, setDetailModalOpen] = useState(false);
    const [selectedRegister, setSelectedRegister] = useState(null);
    const [reportDetails, setReportDetails] = useState(null);

    const observer = useRef();

    const setDefaultDates = (range) => {
        const today = new Date();
        const end = today.toLocaleDateString('en-CA');
        let start;
        switch (range) {
            case 'today': start = end; break;
            case 'week': { const d = new Date(today); d.setDate(d.getDate() - 7); start = d.toLocaleDateString('en-CA'); break; }
            case 'month': { const d = new Date(today); d.setMonth(d.getMonth() - 1); start = d.toLocaleDateString('en-CA'); break; }
            case 'all': start = ''; break;
            default: return;
        }
        setStartDate(start);
        setEndDate(range === 'all' ? '' : end);
    };

    const loadData = async (currentOffset, isReset = false) => {
        if (isLoading) return;
        try {
            setIsLoading(true);
            const data = await fetchClosedRegisters(LIMIT, currentOffset, startDate || undefined, endDate || undefined);

            if (isReset) {
                setClosures(Array.isArray(data) ? data : []);
                setOffset(LIMIT);
            } else {
                setClosures(prev => [...prev, ...data]);
                setOffset(prev => prev + LIMIT);
            }

            if (data.length < LIMIT) {
                setHasMore(false);
            } else {
                setHasMore(true);
            }

        } catch (error) {
            console.error("Error loading closures:", error);
        } finally {
            setIsLoading(false);
        }
    };

    // Initial load & reload on date change
    useEffect(() => {
        setOffset(0);
        setHasMore(true);
        loadData(0, true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [startDate, endDate]);

    const lastClosureRef = useCallback(node => {
        if (isLoading) return;
        if (observer.current) observer.current.disconnect();
        observer.current = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && hasMore) {
                // Pass current offset to load next batch
                loadData(offset);
            }
        });
        if (node) observer.current.observe(node);
    }, [isLoading, hasMore, offset]); // loadData is stable enough or we ignore it if it causes issues, but offset is key

    const handleViewDetails = async (register) => {
        if (!register) return;
        setDetailModalOpen(true);
        setSelectedRegister(register);
        setReportDetails(null);

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

    const uniqueUsers = Array.from(new Set(closures.map(c => c?.user_name))).filter(Boolean);

    const filteredClosures = React.useMemo(() => {
        return closures.filter(c => {
            if (!c) return false;

            const obs = c.observations || '';
            const uname = c.user_name || '';
            const search = searchTerm || '';

            try {
                const matchesSearch =
                    String(obs).toLowerCase().includes(search.toLowerCase()) ||
                    String(uname).toLowerCase().includes(search.toLowerCase());

                const matchesUser = filterUser ? String(c.user_name) === String(filterUser) : true;

                return matchesSearch && matchesUser;
            } catch (error) {
                console.error("Filter error:", error);
                return false;
            }
        });
    }, [closures, searchTerm, filterUser]);

    const clearFilters = () => {
        setFilterUser('');
        setSearchTerm('');
        setDateRange('today');
        setDefaultDates('today');
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
            <div className="glass-card p-4 space-y-3" style={{ position: 'relative', zIndex: 40 }}>
                {/* Date filters */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                    <Calendar size={16} style={{ color: 'var(--color-text-muted)' }} />
                    {[
                        { key: 'today', label: 'Hoy' },
                        { key: 'week', label: 'Semana' },
                        { key: 'month', label: 'Mes' },
                        { key: 'all', label: 'Todo' },
                        { key: 'custom', label: 'Personalizado' }
                    ].map(opt => (
                        <button
                            key={opt.key}
                            onClick={() => { setDateRange(opt.key); if (opt.key !== 'custom') setDefaultDates(opt.key); }}
                            style={{
                                padding: '5px 12px',
                                borderRadius: 8,
                                border: dateRange === opt.key ? '1px solid var(--primary, #00f0ff)' : '1px solid var(--border, #1e293b)',
                                background: dateRange === opt.key ? 'rgba(0,240,255,0.15)' : 'transparent',
                                color: dateRange === opt.key ? 'var(--primary, #00f0ff)' : 'var(--color-text-muted)',
                                cursor: 'pointer',
                                fontSize: '0.8rem',
                                fontWeight: dateRange === opt.key ? 600 : 400
                            }}
                        >
                            {opt.label}
                        </button>
                    ))}
                    {dateRange === 'custom' && (
                        <>
                            <input
                                type="date"
                                className="glass-input"
                                value={startDate}
                                onChange={e => setStartDate(e.target.value)}
                                style={{ padding: '5px 8px', fontSize: '0.85rem' }}
                            />
                            <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                            <input
                                type="date"
                                className="glass-input"
                                value={endDate}
                                onChange={e => setEndDate(e.target.value)}
                                style={{ padding: '5px 8px', fontSize: '0.85rem' }}
                            />
                        </>
                    )}
                </div>
                {/* Search + vendor filter */}
                <div className="flex gap-4">
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
                    <ClosureVendorSelector
                        value={filterUser}
                        onChange={setFilterUser}
                        users={uniqueUsers}
                    />
                </div>
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
                            {filteredClosures.map((item, index) => {
                                const isLast = filteredClosures.length === index + 1;
                                return (
                                    <tr
                                        key={item?.id || index}
                                        ref={isLast ? lastClosureRef : null}
                                        className="hover:bg-[var(--glass-bg)] transition-colors"
                                    >
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
                                );
                            })}

                            {/* Loading State or Empty State */}
                            {isLoading && (
                                <tr>
                                    <td colSpan="6" className="text-center py-4 text-[var(--color-primary)] animate-pulse">
                                        Cargando más registros...
                                    </td>
                                </tr>
                            )}

                            {!isLoading && filteredClosures.length === 0 && (
                                <tr>
                                    <td colSpan="6" className="text-center py-8 text-[var(--color-text-muted)]">
                                        No se encontraron resultados.
                                    </td>
                                </tr>
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
                                            {(reportDetails.salesBreakdown?.credit || 0) > 0 && (
                                                <div className="flex justify-between"><span>Crédito</span> <span>${Number(reportDetails.salesBreakdown.credit).toFixed(2)}</span></div>
                                            )}
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


