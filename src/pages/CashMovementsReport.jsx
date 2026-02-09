import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { Search, Filter, ArrowUpCircle, ArrowDownCircle, ChevronDown, ChevronRight, User } from 'lucide-react';
import { cn } from '../lib/utils';
import { formatInCompanyTime } from '../lib/dateHelpers';
import { formatCurrency } from '../utils/formatCurrency';

// Helper for safe date formatting
const safeFormat = (dateString, fmt, timezone) => {
    if (!dateString) return '-';
    return formatInCompanyTime(dateString, timezone, fmt);
};

const CashMovementsReport = () => {
    const { fetchCashMovements, currentCompanyTimezone, currentCurrency } = useStore();
    const [movements, setMovements] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [offset, setOffset] = useState(0);
    const LIMIT = 20;

    const [expandedGroups, setExpandedGroups] = useState({}); // { registerId: boolean }

    // Filters
    const [filterUser, setFilterUser] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [showFilters, setShowFilters] = useState(false);

    const observer = useRef();

    const loadData = async (currentOffset, isReset = false) => {
        if (isLoading) return;
        try {
            setIsLoading(true);
            const data = await fetchCashMovements(LIMIT, currentOffset);

            // Determine how many registers we actually fetched
            // Since our backend fetches registers and then their movements,
            // counting 'opening' nodes gives us the count of registers.
            const fetchedRegistersCount = data.filter(item => item.source === 'opening').length;

            if (isReset) {
                setMovements(Array.isArray(data) ? data : []);
                setOffset(LIMIT);
            } else {
                setMovements(prev => [...prev, ...data]);
                setOffset(prev => prev + LIMIT);
            }

            if (fetchedRegistersCount < LIMIT) {
                setHasMore(false);
            } else {
                setHasMore(true);
            }

        } catch (error) {
            console.error("Error loading movements:", error);
            if (isReset) setMovements([]);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadData(0, true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const lastGroupRef = useCallback(node => {
        if (isLoading) return;
        if (observer.current) observer.current.disconnect();
        observer.current = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && hasMore) {
                loadData(offset);
            }
        });
        if (node) observer.current.observe(node);
    }, [isLoading, hasMore, offset]);

    const uniqueUsers = Array.from(new Set(movements.map(m => m?.user_name))).filter(Boolean);

    // Grouping Logic
    const groupedMovements = React.useMemo(() => {
        const groups = {};

        movements.forEach(m => {
            // Apply Filters first
            const search = searchTerm.toLowerCase();
            const reason = (m.reason || '').toLowerCase();
            const uname = (m.user_name || '').toLowerCase();

            // Simple search filter: if using search, check current item or user
            // Note: Since we are grouping, ideally we want to show the GROUP if any of its items match,
            // OR if the group user matches.
            // The current logic filters INDIVIDUAL items.
            // If we filter individual items, we might end up with empty groups or groups with partial items.
            // Let's stick to the existing logic which seems to filter inputs before grouping?
            // Wait, existing logic was:
            // "if (searchTerm && !reason.includes(search) && !uname.includes(search)) return;"
            // This filters OUT items that don't match.
            // If all items in a group are filtered out, the group won't exist (unless the opening matches).

            if (searchTerm && !reason.includes(search) && !uname.includes(search)) return;
            if (filterUser && m.user_name !== filterUser) return;

            const regId = m.register_id || 'unknown';

            if (!groups[regId]) {
                groups[regId] = {
                    register_id: regId,
                    user_name: m.user_name,
                    opening_time: null,
                    items: [],
                    totalIn: 0,
                    totalOut: 0,
                    balance: 0
                };
            }

            // Detect Opening Time (from the opening record)
            if (m.source === 'opening') {
                groups[regId].opening_time = m.created_at;
            } else if (!groups[regId].opening_time && m.created_at) {
                // Fallback: use first movement time if opening missing
                groups[regId].opening_time = m.created_at;
            }

            groups[regId].items.push(m);

            const amount = parseFloat(m.amount || 0);
            if (m.type === 'in') {
                groups[regId].totalIn += amount;
                groups[regId].balance += amount;
            } else {
                groups[regId].totalOut += amount;
                groups[regId].balance -= amount;
            }
        });

        // Convert to array and sort by opening date desc
        return Object.values(groups).sort((a, b) => {
            return new Date(b.opening_time || 0) - new Date(a.opening_time || 0);
        });
    }, [movements, searchTerm, filterUser]);

    const toggleGroup = (regId) => {
        setExpandedGroups(prev => ({
            ...prev,
            [regId]: !prev[regId]
        }));
    };

    return (
        <div className="space-y-6 relative z-10 p-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-[var(--color-text)] neon-text">Movimientos de Caja</h1>
                    <p className="text-[var(--color-text-muted)]">Agrupado por turno de usuario</p>
                </div>
            </div>

            {/* Filter Bar */}
            <div className="glass-card p-4 flex gap-4">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" size={20} />
                    <input
                        type="text"
                        placeholder="Buscar por usuario..."
                        className="glass-input !pl-12 w-full"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <select
                    className="glass-input w-48 [&>option]:bg-[#0f0f2d] [&>option]:text-white"
                    value={filterUser}
                    onChange={(e) => setFilterUser(e.target.value)}
                >
                    <option value="">Todos los vendedores</option>
                    {uniqueUsers.map(user => (
                        <option key={user} value={user}>{user}</option>
                    ))}
                </select>
            </div>

            <div className="space-y-4">
                {groupedMovements.length === 0 && !isLoading && (
                    <div className="text-center py-12 text-gray-500">No se encontraron registros.</div>
                )}

                {groupedMovements.map((group, index) => {
                    const isLast = groupedMovements.length === index + 1;
                    return (
                        <div
                            key={group.register_id}
                            ref={isLast ? lastGroupRef : null}
                            className="glass-card p-0 overflow-hidden border border-[var(--glass-border)]"
                        >

                            {/* Group Header (Turn) */}
                            <div
                                onClick={() => toggleGroup(group.register_id)}
                                className="p-4 bg-[var(--surface-hover)] hover:bg-white/5 cursor-pointer flex items-center justify-between transition-colors"
                            >
                                <div className="flex items-center gap-4">
                                    <div className="bg-[var(--color-primary)]/20 p-2 rounded-full text-[var(--color-primary)]">
                                        <User size={20} />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-white text-lg">{group.user_name || 'Desconocido'}</h3>
                                        <p className="text-sm text-gray-400">
                                            Turno #{group.register_id} • Iniciado: {safeFormat(group.opening_time, "dd/MM/yy HH:mm", currentCompanyTimezone)}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-6">
                                    <div className="text-right">
                                        <span className="text-xs text-gray-500 uppercase block">Total Ingresos</span>
                                        <span className="text-green-400 font-bold font-mono">
                                            +{formatCurrency(group.totalIn, currentCurrency)}
                                        </span>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-xs text-gray-500 uppercase block">Total Retiros</span>
                                        <span className="text-orange-400 font-bold font-mono">
                                            -{formatCurrency(group.totalOut, currentCurrency)}
                                        </span>
                                    </div>


                                    <div className={cn("transition-transform duration-300", expandedGroups[group.register_id] ? "rotate-180" : "")}>
                                        <ChevronDown size={20} className="text-gray-400" />
                                    </div>
                                </div>
                            </div>

                            {/* Group Details (Movements List) */}
                            {expandedGroups[group.register_id] && (
                                <div className="border-t border-[var(--glass-border)] bg-black/20 animate-in slide-in-from-top-2 duration-200">
                                    <table className="w-full text-left text-sm">
                                        <thead className="text-[var(--color-text-muted)] text-xs uppercase bg-black/20">
                                            <tr>
                                                <th className="px-6 py-3 font-medium">Hora</th>
                                                <th className="px-6 py-3 font-medium">Tipo</th>
                                                <th className="px-6 py-3 font-medium">Concepto</th>
                                                <th className="px-6 py-3 font-medium text-right">Monto</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/5">
                                            {group.items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map(item => (
                                                <tr key={item.id} className="hover:bg-white/5 transition-colors">
                                                    <td className="px-6 py-3 text-gray-300 font-mono">
                                                        {safeFormat(item.created_at, "HH:mm", currentCompanyTimezone)}
                                                    </td>
                                                    <td className="px-6 py-3">
                                                        <span className={cn(
                                                            "px-2 py-0.5 rounded text-[10px] font-bold border",
                                                            item.type === 'in'
                                                                ? "bg-green-500/10 text-green-400 border-green-500/20"
                                                                : "bg-red-500/10 text-red-400 border-red-500/20"
                                                        )}>
                                                            {item.type === 'in' ? 'INGRESO' : 'RETIRO'}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-3 text-gray-300">
                                                        {item.reason}
                                                    </td>
                                                    <td className={cn(
                                                        "px-6 py-3 font-mono font-bold text-right",
                                                        item.type === 'in' ? "text-green-400" : "text-orange-400"
                                                    )}>
                                                        {item.type === 'in' ? '+' : '-'}{formatCurrency(Number(item.amount), currentCurrency)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    );
                })}

                {isLoading && (
                    <div className="text-center py-4 text-[var(--color-primary)] animate-pulse">
                        Cargando más registros...
                    </div>
                )}
            </div>
        </div>
    );
};

export default CashMovementsReport;
