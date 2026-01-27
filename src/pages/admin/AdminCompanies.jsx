import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/useStore';
import { Search, Plus, Building2, Calendar, MoreVertical, Power, Ban } from 'lucide-react';

const AdminCompanies = () => {
    const { fetchAllCompanies, createCompany, toggleCompanyStatus } = useStore();
    const [companies, setCompanies] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newCompany, setNewCompany] = useState({ id: '', name: '' });

    const loadCompanies = async () => {
        setLoading(true);
        const data = await fetchAllCompanies();
        setCompanies(data);
        setLoading(false);
    };

    useEffect(() => {
        loadCompanies();
    }, []);

    const handleCreate = async (e) => {
        e.preventDefault();
        if (!newCompany.id || !newCompany.name) return;

        // Simple ID validation (alpha-numeric dash)
        const idRegex = /^[a-z0-9-]+$/;
        if (!idRegex.test(newCompany.id)) {
            alert("El ID solo puede contener letras minúsculas, números y guiones.");
            return;
        }

        const res = await createCompany(newCompany.id, newCompany.name);
        if (res.success) {
            setShowCreateModal(false);
            setNewCompany({ id: '', name: '' });
            loadCompanies();
        } else {
            alert("Error al crear empresa: " + res.error);
        }
    };

    const handleToggleStatus = async (id, currentStatus) => {
        const newStatus = currentStatus === 'active' ? 'suspended' : 'active';
        if (window.confirm(`¿Estás seguro de cambiar el estado a ${newStatus}?`)) {
            const res = await toggleCompanyStatus(id, newStatus);
            if (res.success) {
                loadCompanies();
            } else {
                alert("Error: " + res.error);
            }
        }
    };

    return (
        <div className="p-8 max-w-7xl mx-auto">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-white">Gestión de Empresas</h1>
                    <p className="text-gray-400 mt-1">Administra los inquilinos del sistema SaaS.</p>
                </div>
                <button
                    onClick={() => setShowCreateModal(true)}
                    className="flex items-center gap-2 bg-white text-black px-4 py-2 rounded-xl font-medium hover:bg-gray-200 transition-colors"
                >
                    <Plus size={20} />
                    Nueva Empresa
                </button>
            </div>

            {/* List */}
            <div className="bg-[#18181b] border border-white/10 rounded-2xl overflow-hidden">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="border-b border-white/10 text-gray-400 text-sm">
                            <th className="p-4 font-medium">Empresa / ID</th>
                            <th className="p-4 font-medium">Estado</th>
                            <th className="p-4 font-medium">Fecha Creación</th>
                            <th className="p-4 font-medium text-right">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {loading ? (
                            <tr><td colSpan="4" className="p-8 text-center text-gray-500">Cargando...</td></tr>
                        ) : companies.length === 0 ? (
                            <tr><td colSpan="4" className="p-8 text-center text-gray-500">No hay empresas registradas.</td></tr>
                        ) : (
                            companies.map((company) => (
                                <tr key={company.id} className="hover:bg-white/5 transition-colors">
                                    <td className="p-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center text-gray-400">
                                                <Building2 size={20} />
                                            </div>
                                            <div>
                                                <div className="font-medium text-white">{company.name}</div>
                                                <div className="text-xs text-gray-500 font-mono">{company.id}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${company.status === 'active'
                                                ? 'bg-green-500/10 text-green-500 border-green-500/20'
                                                : company.status === 'suspended'
                                                    ? 'bg-red-500/10 text-red-500 border-red-500/20'
                                                    : 'bg-gray-500/10 text-gray-500 border-gray-500/20'
                                            }`}>
                                            {company.status === 'active' ? 'Activa' : company.status === 'suspended' ? 'Suspendida' : company.status}
                                        </span>
                                    </td>
                                    <td className="p-4">
                                        <div className="flex items-center gap-2 text-sm text-gray-400">
                                            <Calendar size={14} />
                                            {new Date(company.created_at).toLocaleDateString()}
                                        </div>
                                    </td>
                                    <td className="p-4 text-right">
                                        <button
                                            onClick={() => handleToggleStatus(company.id, company.status)}
                                            className={`p-2 rounded-lg transition-colors ${company.status === 'active'
                                                    ? 'text-red-400 hover:bg-red-500/10'
                                                    : 'text-green-400 hover:bg-green-500/10'
                                                }`}
                                            title={company.status === 'active' ? "Suspender" : "Activar"}
                                        >
                                            {company.status === 'active' ? <Ban size={18} /> : <Power size={18} />}
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Create Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-[#18181b] border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl">
                        <h2 className="text-xl font-bold text-white mb-4">Nueva Empresa</h2>
                        <form onSubmit={handleCreate} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">Nombre Empresa</label>
                                <input
                                    type="text"
                                    required
                                    className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-2 text-white outline-none focus:border-white/30"
                                    value={newCompany.name}
                                    onChange={e => setNewCompany({ ...newCompany, name: e.target.value })}
                                    placeholder="Ej. Mi Tienda Sucursal 2"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">ID Único (Slug)</label>
                                <input
                                    type="text"
                                    required
                                    className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-2 text-white outline-none focus:border-white/30 font-mono text-sm"
                                    value={newCompany.id}
                                    onChange={e => setNewCompany({ ...newCompany, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                                    placeholder="ej. mi-tienda-sucursal-2"
                                />
                                <p className="text-xs text-gray-500 mt-1">Solo letras minúsculas, números y guiones.</p>
                            </div>
                            <div className="flex justify-end gap-3 mt-6">
                                <button
                                    type="button"
                                    onClick={() => setShowCreateModal(false)}
                                    className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="bg-white text-black px-4 py-2 rounded-xl font-medium hover:bg-gray-200 transition-colors"
                                >
                                    Crear Empresa
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminCompanies;
