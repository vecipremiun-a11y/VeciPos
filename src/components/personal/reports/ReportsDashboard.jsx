import React, { useState, useEffect } from 'react';
import { useStore } from '../../../store/useStore';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { BarChart3, TrendingUp, Clock, AlertTriangle, Users, DollarSign } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const ReportsDashboard = () => {
    const { fetchStaffMembers, staffMembers } = useStore();
    const [loading, setLoading] = useState(false);

    // Mock data for UI demonstration until backend aggregation logic is ready
    const [stats, setStats] = useState({
        punctuality: 95,
        absences: 3,
        overtime: 12.5,
        payrollCost: 4500000
    });

    const data = [
        { name: 'Sem 1', asistencia: 98, atrasos: 2 },
        { name: 'Sem 2', asistencia: 95, atrasos: 5 },
        { name: 'Sem 3', asistencia: 92, atrasos: 8 },
        { name: 'Sem 4', asistencia: 97, atrasos: 3 },
    ];

    useEffect(() => {
        fetchStaffMembers();
        // In real implementation, we would fetch aggregated stats here
        // const loadStats = async () => { ... }
    }, []);

    const StatCard = ({ title, value, subtext, icon: Icon, colorClass }) => (
        <div className="glass-card p-4 flex items-center justify-between">
            <div>
                <p className="text-sm text-[var(--color-text-muted)] font-medium uppercase">{title}</p>
                <p className="text-2xl font-bold text-[var(--color-text)] mt-1">{value}</p>
                {subtext && <p className="text-xs text-[var(--color-text-muted)] mt-1">{subtext}</p>}
            </div>
            <div className={cn("p-3 rounded-xl bg-[var(--glass-bg)]", colorClass)}>
                <Icon size={24} />
            </div>
        </div>
    );

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                    title="Puntualidad Global"
                    value={`${stats.punctuality}%`}
                    subtext="+2% vs mes anterior"
                    icon={Clock}
                    colorClass="text-green-400"
                />
                <StatCard
                    title="Ausencias del Mes"
                    value={stats.absences}
                    subtext="3 licencias, 0 injustificadas"
                    icon={AlertTriangle}
                    colorClass="text-orange-400"
                />
                <StatCard
                    title="Horas Extra Total"
                    value={`${stats.overtime} hrs`}
                    subtext="Acumulado este mes"
                    icon={TrendingUp}
                    colorClass="text-blue-400"
                />
                <StatCard
                    title="Costo Nómina Est."
                    value={`$${(stats.payrollCost / 1000000).toFixed(1)}M`}
                    subtext="Proyección cierre de mes"
                    icon={DollarSign}
                    colorClass="text-purple-400"
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="glass-card p-6">
                    <h3 className="text-lg font-bold text-[var(--color-text)] mb-4 flex items-center gap-2">
                        <BarChart3 size={20} className="text-[var(--color-primary)]" />
                        Tendencia de Asistencia
                    </h3>
                    <div className="h-[300px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={data}>
                                <defs>
                                    <linearGradient id="colorAsistencia" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" vertical={false} />
                                <XAxis dataKey="name" stroke="var(--color-text-muted)" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis stroke="var(--color-text-muted)" fontSize={12} tickLine={false} axisLine={false} unit="%" />
                                <Tooltip
                                    contentStyle={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--glass-border)', color: 'var(--color-text)' }}
                                    itemStyle={{ color: 'var(--color-text)' }}
                                />
                                <Area type="monotone" dataKey="asistencia" stroke="#22c55e" fillOpacity={1} fill="url(#colorAsistencia)" strokeWidth={2} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="glass-card p-6">
                    <h3 className="text-lg font-bold text-[var(--color-text)] mb-4 flex items-center gap-2">
                        <Users size={20} className="text-[var(--color-primary)]" />
                        Próximas Vacaciones
                    </h3>
                    <div className="space-y-4">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)]">
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center text-blue-400 font-bold">
                                    E{i}
                                </div>
                                <div className="flex-1">
                                    <p className="font-bold text-[var(--color-text)] text-sm">Empleado {i}</p>
                                    <p className="text-xs text-[var(--color-text-muted)]">Gerente de Tienda</p>
                                </div>
                                <div className="text-right">
                                    <p className="font-bold text-[var(--color-text)] text-sm">15 Mar</p>
                                    <p className="text-xs text-[var(--color-text-muted)]">10 días</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ReportsDashboard;
