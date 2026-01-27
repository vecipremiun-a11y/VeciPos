import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/useStore';
import { Building2, CheckCircle, XCircle, Activity } from 'lucide-react';

const AdminDashboard = () => {
    const { fetchAdminStats } = useStore();
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadStats = async () => {
            const data = await fetchAdminStats();
            setStats(data);
            setLoading(false);
        };
        loadStats();
    }, [fetchAdminStats]);

    if (loading) return <div className="p-8 text-white">Cargando estadísticas...</div>;

    if (!stats) return <div className="p-8 text-red-400">Error al cargar estadísticas.</div>;

    return (
        <div className="p-8 max-w-7xl mx-auto">
            <h1 className="text-3xl font-bold text-white mb-8">Panel de Control</h1>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Total Companies */}
                <div className="bg-[#18181b] border border-white/10 p-6 rounded-2xl">
                    <div className="flex justify-between items-start mb-4">
                        <div className="p-3 bg-blue-500/10 rounded-xl text-blue-500">
                            <Building2 size={24} />
                        </div>
                        <span className="text-xs font-medium px-2 py-1 bg-white/5 rounded-lg text-gray-400">Total</span>
                    </div>
                    <div className="text-3xl font-bold text-white mb-1">{stats.totalCompanies}</div>
                    <div className="text-sm text-gray-400">Empresas registradas</div>
                </div>

                {/* Active Companies */}
                <div className="bg-[#18181b] border border-white/10 p-6 rounded-2xl">
                    <div className="flex justify-between items-start mb-4">
                        <div className="p-3 bg-green-500/10 rounded-xl text-green-500">
                            <CheckCircle size={24} />
                        </div>
                        <span className="text-xs font-medium px-2 py-1 bg-white/5 rounded-lg text-gray-400">Activas</span>
                    </div>
                    <div className="text-3xl font-bold text-white mb-1">{stats.activeCompanies}</div>
                    <div className="text-sm text-gray-400">Operando actualmente</div>
                </div>

                {/* Suspended Companies */}
                <div className="bg-[#18181b] border border-white/10 p-6 rounded-2xl">
                    <div className="flex justify-between items-start mb-4">
                        <div className="p-3 bg-red-500/10 rounded-xl text-red-500">
                            <XCircle size={24} />
                        </div>
                        <span className="text-xs font-medium px-2 py-1 bg-white/5 rounded-lg text-gray-400">Suspendidas</span>
                    </div>
                    <div className="text-3xl font-bold text-white mb-1">{stats.suspendedCompanies}</div>
                    <div className="text-sm text-gray-400">Acceso revocado</div>
                </div>
            </div>

            <div className="mt-10 bg-[#18181b] border border-white/10 rounded-2xl p-8 text-center">
                <div className="inline-flex items-center justify-center p-4 bg-white/5 rounded-full mb-4">
                    <Activity size={32} className="text-gray-400" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Sistema Operativo</h3>
                <p className="text-gray-400 max-w-md mx-auto">
                    El sistema SaaS está funcionando correctamente. Todas las empresas operan con bases de datos aisladas.
                </p>
            </div>
        </div>
    );
};

export default AdminDashboard;
