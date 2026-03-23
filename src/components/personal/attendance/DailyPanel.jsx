import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../../store/useStore';
import { format, isSameDay, startOfDay, endOfDay, startOfWeek, endOfWeek } from 'date-fns';
import { es } from 'date-fns/locale';
import { UserCheck, UserX, AlertCircle, Clock, Search, MoreVertical, LogOut, FileWarning } from 'lucide-react';
import { cn } from '../../../lib/utils';

const DailyPanel = () => {
    const {
        staffMembers,
        attendanceToday,
        workShifts,
        pendingCorrections,
        fetchStaffMembers,
        fetchAttendanceToday,
        fetchShifts,
        fetchPendingCorrections,
        registerManualAttendance,
        createAbsence
    } = useStore();

    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        const loadData = async () => {
            setLoading(true);
            const now = new Date();
            // Fetch shifts for current week to find today's shift
            const start = startOfWeek(now, { weekStartsOn: 1 });
            const end = endOfWeek(now, { weekStartsOn: 1 });

            await Promise.all([
                fetchStaffMembers(),
                fetchAttendanceToday(),
                fetchPendingCorrections(),
                fetchShifts(start.toISOString(), end.toISOString())
            ]);
            setLoading(false);
        };
        loadData();
    }, []);

    // Combine data to build rows
    const dailyRows = useMemo(() => {
        if (!staffMembers) return [];

        const todayStr = format(new Date(), 'yyyy-MM-dd');
        const filter = searchTerm.toLowerCase();

        return staffMembers
            .filter(u => u.name.toLowerCase().includes(filter) || u.labor_position?.toLowerCase().includes(filter))
            .map(user => {
                const attendance = attendanceToday.find(a => a.user_id === user.id);

                // Find shift for today
                // shifts are usually stored flat or by day? 
                // The store has `workShifts` array. We need to check structure.
                // Assuming workShifts has { user_id, start_time, end_time } where start_time is full ISO or just time?
                // Phase 2 createShift uses ISO strings for start/end.
                const shift = workShifts.find(s =>
                    s.user_id === user.id &&
                    s.start_time.startsWith(todayStr)
                );

                let status = 'absent';
                if (attendance) {
                    if (attendance.check_out) status = 'completed';
                    else status = 'inside';
                } else if (!shift) {
                    status = 'no_shift';
                }

                return {
                    user,
                    attendance,
                    shift,
                    status
                };
            });
    }, [staffMembers, attendanceToday, workShifts, searchTerm]);

    const stats = useMemo(() => {
        return {
            inside: dailyRows.filter(r => r.status === 'inside').length,
            absent: dailyRows.filter(r => r.status === 'absent').length,
            completed: dailyRows.filter(r => r.status === 'completed').length,
            corrections: pendingCorrections.length
        };
    }, [dailyRows, pendingCorrections]);

    if (loading) return <div className="p-10 text-center text-[var(--color-text-muted)]">Cargando panel...</div>;

    const handleManualExit = async (userId) => {
        if (!window.confirm("¿Registrar salida manual ahora?")) return;
        const note = prompt("Motivo (opcional):");
        await registerManualAttendance(userId, 'check_out', new Date().toISOString(), note || 'Manual Exit', 'Admin'); // recordedBy hardcoded for now
        await fetchAttendanceToday(); // Refresh
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Stats Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="glass-card p-4 flex items-center gap-4 bg-green-500/5 border-green-500/20">
                    <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                        <UserCheck className="text-green-400" size={20} />
                    </div>
                    <div>
                        <p className="text-[var(--color-text-muted)] text-xs uppercase font-bold">En Turno</p>
                        <p className="text-2xl font-bold text-[var(--color-text)]">{stats.inside}</p>
                    </div>
                </div>
                <div className="glass-card p-4 flex items-center gap-4 bg-red-500/5 border-red-500/20">
                    <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                        <UserX className="text-red-400" size={20} />
                    </div>
                    <div>
                        <p className="text-[var(--color-text-muted)] text-xs uppercase font-bold">Ausentes</p>
                        <p className="text-2xl font-bold text-[var(--color-text)]">{stats.absent}</p>
                    </div>
                </div>
                <div className="glass-card p-4 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                        <Clock className="text-blue-400" size={20} />
                    </div>
                    <div>
                        <p className="text-[var(--color-text-muted)] text-xs uppercase font-bold">Completados</p>
                        <p className="text-2xl font-bold text-[var(--color-text)]">{stats.completed}</p>
                    </div>
                </div>
                <div className="glass-card p-4 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center">
                        <FileWarning className="text-orange-400" size={20} />
                    </div>
                    <div>
                        <p className="text-[var(--color-text-muted)] text-xs uppercase font-bold">Correcciones</p>
                        <p className="text-2xl font-bold text-[var(--color-text)]">{stats.corrections}</p>
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="glass-card p-0 overflow-hidden">
                <div className="p-4 border-b border-[var(--glass-border)] flex gap-4">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" size={16} />
                        <input
                            className="glass-input !pl-9 w-full"
                            placeholder="Buscar empleado..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-[var(--glass-bg)] border-b border-[var(--glass-border)] text-xs uppercase text-[var(--color-text-muted)]">
                            <tr>
                                <th className="px-6 py-3">Empleado</th>
                                <th className="px-6 py-3">Turno</th>
                                <th className="px-6 py-3">Entrada</th>
                                <th className="px-6 py-3">Salida</th>
                                <th className="px-6 py-3">Estado</th>
                                <th className="px-6 py-3 text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--glass-border)]">
                            {dailyRows.map(row => (
                                <tr key={row.user.id} className="hover:bg-[var(--glass-bg)] transition-colors">
                                    <td className="px-6 py-4">
                                        <div>
                                            <p className="font-medium text-[var(--color-text)]">{row.user.name}</p>
                                            <p className="text-xs text-[var(--color-text-muted)]">{row.user.labor_position || 'Sin cargo'}</p>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-sm">
                                        {row.shift ? (
                                            <span className="text-[var(--color-text)]">
                                                {row.shift.start_time && !isNaN(new Date(row.shift.start_time)) ? format(new Date(row.shift.start_time), 'HH:mm') : '--:--'} - {row.shift.end_time && !isNaN(new Date(row.shift.end_time)) ? format(new Date(row.shift.end_time), 'HH:mm') : '--:--'}
                                            </span>
                                        ) : (
                                            <span className="text-[var(--color-text-muted)] text-xs italic">Sin turno</span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-sm">
                                        {row.attendance && row.attendance.check_in && !isNaN(new Date(row.attendance.check_in)) ? format(new Date(row.attendance.check_in), 'HH:mm') : '-'}
                                    </td>
                                    <td className="px-6 py-4 text-sm">
                                        {row.attendance?.check_out && !isNaN(new Date(row.attendance.check_out)) ? format(new Date(row.attendance.check_out), 'HH:mm') : '-'}
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={cn(
                                            "px-2 py-1 rounded-full text-xs font-medium border",
                                            row.status === 'inside' && "bg-green-500/20 text-green-400 border-green-500/30",
                                            row.status === 'absent' && "bg-red-500/20 text-red-400 border-red-500/30",
                                            row.status === 'completed' && "bg-blue-500/20 text-blue-400 border-blue-500/30",
                                            row.status === 'no_shift' && "bg-gray-500/20 text-gray-400 border-gray-500/30"
                                        )}>
                                            {row.status === 'inside' && 'En Turno'}
                                            {row.status === 'absent' && 'Ausente'}
                                            {row.status === 'completed' && 'Completado'}
                                            {row.status === 'no_shift' && 'Sin Turno'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex justify-end gap-2">
                                            {row.status === 'inside' && (
                                                <button
                                                    onClick={() => handleManualExit(row.user.id)}
                                                    className="p-1 hover:bg-red-500/10 rounded text-red-400"
                                                    title="Registrar Salida Manual"
                                                >
                                                    <LogOut size={16} />
                                                </button>
                                            )}
                                            {row.status === 'absent' && (
                                                <button className="p-1 hover:bg-[var(--glass-bg)] rounded text-[var(--color-text-muted)]" title="Justificar / Crear Ausencia">
                                                    <FileWarning size={16} />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {dailyRows.length === 0 && (
                                <tr>
                                    <td colSpan="6" className="px-6 py-8 text-center text-[var(--color-text-muted)]">
                                        No se encontraron empleados.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default DailyPanel;
