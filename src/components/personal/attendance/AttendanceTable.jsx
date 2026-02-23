import React, { useState, useEffect } from 'react';
import { useStore } from '../../../store/useStore';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { Search, Calendar, ChevronLeft, ChevronRight, Download, Filter } from 'lucide-react';
import { cn } from '../../../lib/utils';

const AttendanceTable = () => {
    const { fetchAttendanceByRange, staffMembers, fetchStaffMembers } = useStore();
    const [attendanceData, setAttendanceData] = useState([]);
    const [loading, setLoading] = useState(false);

    // Filters
    const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
    const [endDate, setEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
    const [selectedUser, setSelectedUser] = useState('');

    useEffect(() => {
        fetchStaffMembers();
    }, []);

    useEffect(() => {
        handleSearch();
    }, [startDate, endDate, selectedUser]);

    const handleSearch = async () => {
        setLoading(true);
        const data = await fetchAttendanceByRange(startDate, endDate, selectedUser || null);
        setAttendanceData(data || []);
        setLoading(false);
    };

    const getUserName = (id) => {
        const user = staffMembers.find(u => u.id === id);
        return user ? user.name : 'Desconocido';
    };

    return (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Filters Bar */}
            <div className="glass-card p-4 flex flex-col md:flex-row gap-4 items-end md:items-center justify-between">
                <div className="flex flex-col md:flex-row gap-4 w-full md:w-auto">
                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase">Desde</label>
                        <input
                            type="date"
                            className="glass-input"
                            value={startDate}
                            onChange={e => setStartDate(e.target.value)}
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase">Hasta</label>
                        <input
                            type="date"
                            className="glass-input"
                            value={endDate}
                            onChange={e => setEndDate(e.target.value)}
                        />
                    </div>
                    <div className="flex flex-col gap-1.5 min-w-[200px]">
                        <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase">Empleado</label>
                        <select
                            className="glass-input bg-[var(--color-surface)]"
                            value={selectedUser}
                            onChange={e => setSelectedUser(e.target.value)}
                        >
                            <option value="">Todos</option>
                            {staffMembers.map(u => (
                                <option key={u.id} value={u.id}>{u.name}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="flex gap-2">
                    <button className="btn-secondary flex items-center gap-2">
                        <Download size={16} />
                        Exportar
                    </button>
                </div>
            </div>

            {/* Table */}
            <div className="glass-card p-0 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-[var(--glass-bg)] border-b border-[var(--glass-border)] text-xs uppercase text-[var(--color-text-muted)]">
                            <tr>
                                <th className="px-6 py-3">Fecha</th>
                                <th className="px-6 py-3">Empleado</th>
                                <th className="px-6 py-3">Entrada</th>
                                <th className="px-6 py-3">Salida</th>
                                <th className="px-6 py-3">Ubicación</th>
                                <th className="px-6 py-3">Notas</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--glass-border)]">
                            {loading ? (
                                <tr>
                                    <td colSpan="6" className="px-6 py-8 text-center text-[var(--color-text-muted)]">
                                        Cargando datos...
                                    </td>
                                </tr>
                            ) : attendanceData.length === 0 ? (
                                <tr>
                                    <td colSpan="6" className="px-6 py-8 text-center text-[var(--color-text-muted)]">
                                        No hay registros en este periodo.
                                    </td>
                                </tr>
                            ) : (
                                attendanceData.map(record => (
                                    <tr key={record.id} className="hover:bg-[var(--glass-bg)] transition-colors">
                                        <td className="px-6 py-4 text-sm font-medium">
                                            {format(new Date(record.date || record.check_in), 'dd/MM/yyyy')}
                                        </td>
                                        <td className="px-6 py-4">
                                            {getUserName(record.user_id)}
                                        </td>
                                        <td className="px-6 py-4 text-sm">
                                            {record.check_in ? format(new Date(record.check_in), 'HH:mm') : '-'}
                                        </td>
                                        <td className="px-6 py-4 text-sm">
                                            {record.check_out ? format(new Date(record.check_out), 'HH:mm') : '-'}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-[var(--color-text-muted)]">
                                            {record.branch || '-'}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-[var(--color-text-muted)] max-w-xs truncate">
                                            {record.notes || '-'}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default AttendanceTable;
