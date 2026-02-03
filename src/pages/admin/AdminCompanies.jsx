import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/useStore';
import { formatInCompanyTime } from '../../lib/dateHelpers';
import { Search, Plus, Building2, Calendar, MoreVertical, Power, Ban } from 'lucide-react';

const AdminCompanies = () => {
    const { fetchAllCompanies, createCompany, toggleCompanyStatus, currentCompanyTimezone } = useStore();
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

        const companyPayload = {
            id: newCompany.id,
            name: newCompany.name,
            country: newCompany.country,
            plan: newCompany.plan,
            newUser: newCompany.createUser ? {
                name: newCompany.userName,
                username: newCompany.userUsername,
                password: newCompany.userPassword
            } : null
        };

        const res = await createCompany(companyPayload);
        if (res.success) {
            setShowCreateModal(false);
            setNewCompany({ id: '', name: '', country: 'CL', plan: 'basic', createUser: false, userName: '', userUsername: '', userPassword: '' });
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
                                            {formatInCompanyTime(company.created_at, currentCompanyTimezone, 'dd/MM/yyyy')}
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
                        <form onSubmit={handleCreate} className="space-y-4 max-h-[80vh] overflow-y-auto pr-2">
                            <div className="space-y-4">
                                <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Datos de la Empresa</h3>
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
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-400 mb-1">País</label>
                                        <select
                                            className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-2 text-white outline-none focus:border-white/30"
                                            value={newCompany.country || 'CL'}
                                            onChange={e => setNewCompany({ ...newCompany, country: e.target.value })}
                                        >
                                            <option value="CL">Chile</option>
                                            <option value="AR">Argentina</option>
                                            <option value="PE">Perú</option>
                                            <option value="CO">Colombia</option>
                                            <option value="MX">México</option>
                                            <option value="US">Estados Unidos</option>
                                            <option value="ES">España</option>
                                            <option value="other">Otro</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-400 mb-1">Plan</label>
                                        <select
                                            className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-2 text-white outline-none focus:border-white/30"
                                            value={newCompany.plan || 'basic'}
                                            onChange={e => setNewCompany({ ...newCompany, plan: e.target.value })}
                                        >
                                            <option value="basic">Básico</option>
                                            <option value="pro">Pro</option>
                                            <option value="enterprise">Enterprise</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <div className="pt-4 border-t border-white/10 space-y-4">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Usuario Administrador</h3>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            className="rounded border-gray-600 bg-black/20 text-blue-500"
                                            checked={newCompany.createUser || false}
                                            onChange={e => setNewCompany({ ...newCompany, createUser: e.target.checked })}
                                        />
                                        <span className="text-xs text-gray-400">Crear usuario</span>
                                    </label>
                                </div>

                                {newCompany.createUser && (
                                    <div className="space-y-3 bg-white/5 p-4 rounded-xl">
                                        <div>
                                            <label className="block text-xs font-medium text-gray-400 mb-1">Nombre Completo</label>
                                            <input
                                                type="text"
                                                required={newCompany.createUser}
                                                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm outline-none focus:border-white/30"
                                                value={newCompany.userName || ''}
                                                onChange={e => setNewCompany({ ...newCompany, userName: e.target.value })}
                                                placeholder="Nombre del administrador"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-gray-400 mb-1">Usuario / Email</label>
                                            <input
                                                type="text"
                                                required={newCompany.createUser}
                                                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm outline-none focus:border-white/30"
                                                value={newCompany.userUsername || ''}
                                                onChange={e => setNewCompany({ ...newCompany, userUsername: e.target.value })}
                                                placeholder="usuario_admin"
                                                autoComplete="off"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-gray-400 mb-1">Contraseña</label>
                                            <input
                                                type="password"
                                                required={newCompany.createUser}
                                                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm outline-none focus:border-white/30"
                                                value={newCompany.userPassword || ''}
                                                onChange={e => setNewCompany({ ...newCompany, userPassword: e.target.value })}
                                                placeholder="******"
                                                autoComplete="new-password"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="flex justify-end gap-3 mt-6 pt-2 border-t border-white/10">
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
