import React, { useState, useMemo } from 'react';
import { Plus, Trash2, User, Pencil, Search, Users as UsersIcon, ShoppingCart, Package, ClipboardList, ChevronLeft, ChevronRight, X, Briefcase, CreditCard, Calendar } from 'lucide-react';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';
import { usePermissions } from '../hooks/usePermissions';

const Users = () => {
    const { users, currentUser, currentUserCompanyRole, addUser, deleteUser, updateUser, activeCompanyId, fetchCompanyRoles } = useStore();
    const { can } = usePermissions();

    // Solo el dueño (o super admin) puede eliminar usuarios; y el dueño no se puede eliminar.
    const isOwner = currentUserCompanyRole === 'owner' || currentUserCompanyRole === 'super_admin' || currentUser?.role === 'super_admin';

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState(null);
    const [activeTab, setActiveTab] = useState('general'); // 'general' | 'labor'
    const [companyRoles, setCompanyRoles] = useState([]);
    const [formData, setFormData] = useState({
        name: '', username: '', role: 'Caja', password: '', email: '',
        // Labor Profile
        has_labor_profile: false,
        labor_position: '',
        labor_branch: '',
        labor_start_date: '',
        labor_status: 'active',
        labor_pin: '',
        // Payment
        pay_type: 'monthly',
        pay_method: 'transfer',
        pay_day: '',
        pay_base_amount: 0,
        pay_fixed_bonus: 0,
        pay_fixed_discount: 0,
        pay_bank_name: '',
        pay_bank_account: '',
        pay_bank_account_type: '',
        pay_bank_owner: ''
    });

    // Search and pagination
    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    // Sorting
    const [sortField, setSortField] = useState('id');
    const [sortDirection, setSortDirection] = useState('asc');

    // Load company roles for dropdown
    React.useEffect(() => {
        if (activeCompanyId && fetchCompanyRoles) {
            fetchCompanyRoles().then(roles => {
                if (roles && roles.length > 0) setCompanyRoles(roles);
            });
        }
    }, [activeCompanyId, fetchCompanyRoles]);

    // DEBUG (Removed - Moved down)


    // Stats calculations
    const stats = useMemo(() => {
        const total = users.length;
        const admins = users.filter(u => u.role === 'Administrador').length;
        const sellers = users.filter(u => u.role === 'Vendedor').length;
        const warehouse = users.filter(u => u.role === 'Bodeguero').length;
        const supervisors = users.filter(u => u.role === 'Supervisor').length;
        return { total, admins, sellers, warehouse, supervisors };
    }, [users]);

    // Filtered and sorted users
    const filteredUsers = useMemo(() => {
        let result = users.filter(user => {
            const search = searchTerm.toLowerCase();
            return (
                user.name?.toLowerCase().includes(search) ||
                user.username?.toLowerCase().includes(search) ||
                user.email?.toLowerCase().includes(search) ||
                user.role?.toLowerCase().includes(search)
            );
        });

        // Sort
        result.sort((a, b) => {
            let aVal = a[sortField] || '';
            let bVal = b[sortField] || '';
            if (typeof aVal === 'string') aVal = aVal.toLowerCase();
            if (typeof bVal === 'string') bVal = bVal.toLowerCase();

            if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });

        return result;
    }, [users, searchTerm, sortField, sortDirection]);

    // Permission check
    if (!can('users.view')) {
        return <div className="text-center p-10 text-red-500">Acceso Denegado. Se requieren permisos de Administrador o Gestión de Usuarios.</div>;
    }

    // Pagination
    const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);
    const paginatedUsers = filteredUsers.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    const handleSort = (field) => {
        if (sortField === field) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection('asc');
        }
    };

    const handleOpenModal = (user = null) => {
        setActiveTab('general');
        if (user) {
            setEditingUser(user);
            setFormData({
                name: user.name,
                username: user.username,
                role: user.role,
                password: '',
                email: user.email || '',
                // Labor
                has_labor_profile: !!user.has_labor_profile,
                labor_position: user.labor_position || '',
                labor_branch: user.labor_branch || '',
                labor_start_date: user.labor_start_date || '',
                labor_status: user.labor_status || 'active',
                labor_pin: user.labor_pin || '',
                // Payment
                pay_type: user.pay_type || 'monthly',
                pay_method: user.pay_method || 'transfer',
                pay_day: user.pay_day || '',
                pay_base_amount: user.pay_base_amount || 0,
                pay_fixed_bonus: user.pay_fixed_bonus || 0,
                pay_fixed_discount: user.pay_fixed_discount || 0,
                pay_bank_name: user.pay_bank_name || '',
                pay_bank_account: user.pay_bank_account || '',
                pay_bank_account_type: user.pay_bank_account_type || '',
                pay_bank_owner: user.pay_bank_owner || ''
            });
        } else {
            setEditingUser(null);
            setFormData({
                name: '', username: '', role: 'Caja', password: '', email: '',
                has_labor_profile: false,
                labor_position: '', labor_branch: '', labor_start_date: '',
                labor_status: 'active', labor_pin: '',
                pay_type: 'monthly', pay_method: 'transfer', pay_day: '',
                pay_base_amount: 0, pay_fixed_bonus: 0, pay_fixed_discount: 0,
                pay_bank_name: '', pay_bank_account: '', pay_bank_account_type: '', pay_bank_owner: ''
            });
        }
        setIsModalOpen(true);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        let result;
        if (editingUser) {
            result = await updateUser(editingUser.id, formData);
        } else {
            result = await addUser(formData);
        }

        if (result && !result.success) {
            alert(result.error);
            return;
        }

        setIsModalOpen(false);
    };

    const getRoleBadgeStyle = (role) => {
        switch (role) {
            case 'Administrador':
                return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
            case 'Caja':
                return 'bg-green-500/20 text-green-400 border-green-500/30';
            case 'Vendedor':
                return 'bg-violet-500/20 text-violet-400 border-violet-500/30';
            case 'Bodeguero':
                return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
            case 'Supervisor':
                return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
            default:
                return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
        }
    };

    const getStatusBadge = (user) => {
        // For now, all users are "active" - you can add status field later
        return (
            <span className="px-3 py-1 rounded-full bg-green-500/20 text-green-400 border border-green-500/30 text-xs font-medium">
                Activo
            </span>
        );
    };

    const getLastLogin = (user) => {
        // Placeholder - add last_login field to your users table
        return <span className="text-[var(--color-text-muted)] text-sm">-</span>;
    };

    return (
        <div className="space-y-6 p-4 lg:p-0">
            {/* Header */}
            <div>
                <h1 className="text-2xl lg:text-3xl font-bold text-[var(--color-text)]">Usuarios</h1>
                <p className="text-[var(--color-text-muted)] text-sm">Inicio / Usuarios</p>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="glass-card p-4 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-[var(--color-primary)]/20 flex items-center justify-center">
                        <UsersIcon className="text-[var(--color-primary)]" size={24} />
                    </div>
                    <div>
                        <p className="text-[var(--color-text-muted)] text-xs uppercase tracking-wider">Total Usuarios</p>
                        <p className="text-2xl font-bold text-[var(--color-text)]">{stats.total}</p>
                    </div>
                </div>
                <div className="glass-card p-4 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center">
                        <ShoppingCart className="text-purple-400" size={24} />
                    </div>
                    <div>
                        <p className="text-[var(--color-text-muted)] text-xs uppercase tracking-wider">Administradores</p>
                        <p className="text-2xl font-bold text-[var(--color-text)]">{stats.admins}</p>
                    </div>
                </div>
                <div className="glass-card p-4 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center">
                        <Package className="text-green-400" size={24} />
                    </div>
                    <div>
                        <p className="text-[var(--color-text-muted)] text-xs uppercase tracking-wider">Vendedores</p>
                        <p className="text-2xl font-bold text-[var(--color-text)]">{stats.sellers}</p>
                    </div>
                </div>
                <div className="glass-card p-4 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center">
                        <ClipboardList className="text-blue-400" size={24} />
                    </div>
                    <div>
                        <p className="text-[var(--color-text-muted)] text-xs uppercase tracking-wider">Bodegueros</p>
                        <p className="text-2xl font-bold text-[var(--color-text)]">{stats.warehouse}</p>
                    </div>
                </div>
                <div className="glass-card p-4 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-yellow-500/20 flex items-center justify-center">
                        <ClipboardList className="text-yellow-400" size={24} />
                    </div>
                    <div>
                        <p className="text-[var(--color-text-muted)] text-xs uppercase tracking-wider">Supervisores</p>
                        <p className="text-2xl font-bold text-[var(--color-text)]">{stats.supervisors}</p>
                    </div>
                </div>
            </div>

            {/* Search and Actions Bar */}
            <div className="glass-card p-4 flex flex-col lg:flex-row gap-4 items-center justify-between">
                <div className="relative flex-1 w-full lg:max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" size={18} />
                    <input
                        type="text"
                        placeholder="Buscar usuario..."
                        className="glass-input !pl-10 w-full"
                        value={searchTerm}
                        onChange={(e) => {
                            setSearchTerm(e.target.value);
                            setCurrentPage(1);
                        }}
                    />
                </div>
                {can('users.create') && (
                    <button onClick={() => handleOpenModal()} className="btn-primary flex items-center gap-2 w-full lg:w-auto justify-center">
                        <Plus size={20} />
                        Nuevo Usuario
                    </button>
                )}
            </div>

            {/* Users Table */}
            <div className="glass-card p-0 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-[var(--glass-bg)] border-b border-[var(--glass-border)]">
                            <tr className="text-[var(--color-text-muted)] text-xs uppercase tracking-wider">
                                <th
                                    className="px-6 py-4 cursor-pointer hover:text-[var(--color-text)] transition-colors"
                                    onClick={() => handleSort('id')}
                                >
                                    <div className="flex items-center gap-1">
                                        ID
                                        {sortField === 'id' && (
                                            <span className="text-[var(--color-primary)]">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                                        )}
                                    </div>
                                </th>
                                <th
                                    className="px-6 py-4 cursor-pointer hover:text-[var(--color-text)] transition-colors"
                                    onClick={() => handleSort('name')}
                                >
                                    <div className="flex items-center gap-1">
                                        Nombre
                                        {sortField === 'name' && (
                                            <span className="text-[var(--color-primary)]">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                                        )}
                                    </div>
                                </th>
                                <th className="px-6 py-4">Email</th>
                                <th
                                    className="px-6 py-4 cursor-pointer hover:text-[var(--color-text)] transition-colors"
                                    onClick={() => handleSort('role')}
                                >
                                    <div className="flex items-center gap-1">
                                        Rol
                                        {sortField === 'role' && (
                                            <span className="text-[var(--color-primary)]">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                                        )}
                                    </div>
                                </th>
                                <th className="px-6 py-4">Status</th>
                                <th className="px-6 py-4">Última vez login</th>
                                <th className="px-6 py-4 text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--glass-border)]">
                            {paginatedUsers.length === 0 ? (
                                <tr>
                                    <td colSpan="7" className="px-6 py-12 text-center text-[var(--color-text-muted)]">
                                        No se encontraron usuarios.
                                    </td>
                                </tr>
                            ) : (
                                paginatedUsers.map(user => (
                                    <tr key={user.id} className="hover:bg-[var(--glass-bg)] transition-colors group">
                                        <td className="px-6 py-4 text-[var(--color-text-muted)] text-sm">
                                            #{String(user.id).slice(-4)}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[var(--color-primary)]/30 to-purple-500/30 flex items-center justify-center border border-[var(--glass-border)]">
                                                    <User size={18} className="text-[var(--color-primary)]" />
                                                </div>
                                                <div>
                                                    <p className="font-medium text-[var(--color-text)]">{user.name}</p>
                                                    <p className="text-xs text-[var(--color-text-muted)]">@{user.username}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-[var(--color-text-muted)] text-sm">
                                            {user.email || '-'}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <span className={cn(
                                                    "px-3 py-1 rounded-full text-xs font-medium border",
                                                    getRoleBadgeStyle(user.role)
                                                )}>
                                                    {user.role}
                                                </span>
                                                {user.company_role === 'owner' && (
                                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold border border-amber-500/40 bg-amber-500/15 text-amber-400 uppercase tracking-wider">
                                                        Dueño
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            {getStatusBadge(user)}
                                        </td>
                                        <td className="px-6 py-4">
                                            {getLastLogin(user)}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex justify-end gap-2">
                                                {can('users.edit') && (
                                                    <button
                                                        onClick={() => handleOpenModal(user)}
                                                        className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-blue-400 hover:bg-blue-500/10 transition-all"
                                                        title="Editar"
                                                    >
                                                        <Pencil size={18} />
                                                    </button>
                                                )}
                                                {isOwner && user.company_role !== 'owner' && user.username !== 'admin' && (
                                                    <button
                                                        onClick={async () => {
                                                            if (window.confirm(`¿Eliminar usuario ${user.name}?`)) {
                                                                const result = await deleteUser(user.id);
                                                                if (result && !result.success) {
                                                                    alert(result.error);
                                                                }
                                                            }
                                                        }}
                                                        className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-all"
                                                        title="Eliminar"
                                                    >
                                                        <Trash2 size={18} />
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                <div className="px-6 py-4 border-t border-[var(--glass-border)] flex flex-col lg:flex-row items-center justify-between gap-4">
                    <p className="text-sm text-[var(--color-text-muted)]">
                        Mostrando {paginatedUsers.length} de {filteredUsers.length} usuarios.
                    </p>

                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-[var(--color-text-muted)]">Mostrar</span>
                            <select
                                value={itemsPerPage}
                                onChange={(e) => {
                                    setItemsPerPage(Number(e.target.value));
                                    setCurrentPage(1);
                                }}
                                className="glass-input !py-1 !px-2 text-sm"
                            >
                                <option value={10}>10</option>
                                <option value={25}>25</option>
                                <option value={50}>50</option>
                            </select>
                        </div>

                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                className="p-2 rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--glass-bg)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                <ChevronLeft size={18} />
                            </button>

                            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                let pageNum;
                                if (totalPages <= 5) {
                                    pageNum = i + 1;
                                } else if (currentPage <= 3) {
                                    pageNum = i + 1;
                                } else if (currentPage >= totalPages - 2) {
                                    pageNum = totalPages - 4 + i;
                                } else {
                                    pageNum = currentPage - 2 + i;
                                }

                                return (
                                    <button
                                        key={pageNum}
                                        onClick={() => setCurrentPage(pageNum)}
                                        className={cn(
                                            "w-8 h-8 rounded-lg text-sm font-medium transition-colors",
                                            currentPage === pageNum
                                                ? "bg-[var(--color-primary)] text-black"
                                                : "text-[var(--color-text-muted)] hover:bg-[var(--glass-bg)]"
                                        )}
                                    >
                                        {pageNum}
                                    </button>
                                );
                            })}

                            <button
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages || totalPages === 0}
                                className="p-2 rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--glass-bg)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                <ChevronRight size={18} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
                    <div className="glass-card w-full max-w-2xl p-6 relative animate-in fade-in zoom-in-95 duration-200 my-8">
                        <button
                            onClick={() => setIsModalOpen(false)}
                            className="absolute top-4 right-4 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                        >
                            <X size={20} />
                        </button>

                        <h2 className="text-xl font-bold mb-6 text-[var(--color-text)] flex items-center gap-2">
                            <User className="text-[var(--color-primary)]" />
                            {editingUser ? 'Editar Usuario' : 'Nuevo Usuario'}
                        </h2>

                        {/* Tabs */}
                        <div className="flex border-b border-[var(--glass-border)] mb-6">
                            <button
                                type="button"
                                onClick={() => setActiveTab('general')}
                                className={cn(
                                    "px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2",
                                    activeTab === 'general'
                                        ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                                        : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                                )}
                            >
                                <User size={16} />
                                General
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab('labor')}
                                className={cn(
                                    "px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2",
                                    activeTab === 'labor'
                                        ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                                        : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                                )}
                            >
                                <Briefcase size={16} />
                                Ficha Laboral
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-4">
                            {/* General Tab */}
                            <div className={cn("space-y-4", activeTab !== 'general' && "hidden")}>
                                <div>
                                    <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider">
                                        Nombre Completo
                                    </label>
                                    <input
                                        className="glass-input w-full"
                                        value={formData.name}
                                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                                        placeholder="Juan Pérez"
                                        required
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider">
                                            Usuario
                                        </label>
                                        <input
                                            className="glass-input w-full"
                                            value={formData.username}
                                            onChange={e => setFormData({ ...formData, username: e.target.value })}
                                            placeholder="jperez"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider">
                                            {editingUser ? 'Nueva Contraseña' : 'Contraseña'}
                                        </label>
                                        <input
                                            className="glass-input w-full"
                                            type="password"
                                            value={formData.password}
                                            onChange={e => setFormData({ ...formData, password: e.target.value })}
                                            placeholder={editingUser ? "••••••••" : "123456"}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider">
                                        Email (Opcional)
                                    </label>
                                    <input
                                        className="glass-input w-full"
                                        type="email"
                                        value={formData.email}
                                        onChange={e => setFormData({ ...formData, email: e.target.value })}
                                        placeholder="usuario@email.com"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider">
                                        Rol
                                    </label>
                                    <select
                                        className="glass-input w-full bg-[var(--color-surface)] text-[var(--color-text)]"
                                        value={formData.role}
                                        onChange={e => setFormData({ ...formData, role: e.target.value })}
                                    >
                                        <option value="Administrador">Administrador</option>
                                        <option value="Caja">Caja</option>
                                        <option value="Vendedor">Vendedor</option>
                                        <option value="Bodeguero">Bodeguero</option>
                                        <option value="Supervisor">Supervisor</option>
                                        {companyRoles.filter(r => !['Administrador','Caja','Vendedor','Bodeguero','Supervisor'].includes(r.role_name)).map(r => (
                                            <option key={r.role_name} value={r.role_name}>{r.role_name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* Labor Profile Tab */}
                            <div className={cn("space-y-6", activeTab !== 'labor' && "hidden")}>

                                <div className="flex items-center justify-between bg-[var(--glass-bg)] p-4 rounded-xl border border-[var(--glass-border)]">
                                    <div>
                                        <h3 className="text-sm font-bold text-[var(--color-text)]">Activar Ficha Laboral</h3>
                                        <p className="text-xs text-[var(--color-text-muted)]">Habilita funciones de asistencia y pago para este usuario.</p>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input
                                            type="checkbox"
                                            className="sr-only peer"
                                            checked={formData.has_labor_profile}
                                            onChange={e => setFormData({ ...formData, has_labor_profile: e.target.checked })}
                                        />
                                        <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--color-primary)]"></div>
                                    </label>
                                </div>

                                {formData.has_labor_profile && (
                                    <>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider">
                                                    Cargo / Área
                                                </label>
                                                <input
                                                    className="glass-input w-full"
                                                    value={formData.labor_position}
                                                    onChange={e => setFormData({ ...formData, labor_position: e.target.value })}
                                                    placeholder="Ej: Cajero Principal"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider">
                                                    Sucursal
                                                </label>
                                                <input
                                                    className="glass-input w-full"
                                                    value={formData.labor_branch}
                                                    onChange={e => setFormData({ ...formData, labor_branch: e.target.value })}
                                                    placeholder="Ej: Central"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider">
                                                    Fecha Ingreso
                                                </label>
                                                <input
                                                    type="date"
                                                    className="glass-input w-full"
                                                    value={formData.labor_start_date}
                                                    onChange={e => setFormData({ ...formData, labor_start_date: e.target.value })}
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider">
                                                    Estado Laboral
                                                </label>
                                                <select
                                                    className="glass-input w-full bg-[var(--color-surface)] text-[var(--color-text)]"
                                                    value={formData.labor_status}
                                                    onChange={e => setFormData({ ...formData, labor_status: e.target.value })}
                                                >
                                                    <option value="active">Activo</option>
                                                    <option value="inactive">Inactivo</option>
                                                    <option value="suspended">Suspendido</option>
                                                </select>
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider">
                                                PIN de Asistencia (4-6 dígitos)
                                            </label>
                                            <div className="flex gap-2">
                                                <input
                                                    type="text"
                                                    maxLength="6"
                                                    className="glass-input flex-1"
                                                    value={formData.labor_pin}
                                                    onChange={e => setFormData({ ...formData, labor_pin: e.target.value.replace(/\D/g, '') })}
                                                    placeholder="1234"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const pin = Math.floor(1000 + Math.random() * 9000).toString();
                                                        setFormData({ ...formData, labor_pin: pin });
                                                    }}
                                                    className="px-3 py-2 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-xs hover:bg-[var(--color-surface-hover)] transition-colors"
                                                >
                                                    Generar
                                                </button>
                                            </div>
                                            <p className="text-[10px] text-[var(--color-text-muted)] mt-1">Este PIN se usará en el Kiosco.</p>
                                        </div>

                                        <div className="border-t border-[var(--glass-border)] my-4"></div>
                                        <h4 className="text-sm font-bold text-[var(--color-text)] flex items-center gap-2 mb-4">
                                            <CreditCard size={16} /> Configuración de Pago
                                        </h4>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider">Tipo Pago</label>
                                                <select className="glass-input w-full bg-[var(--color-surface)]" value={formData.pay_type} onChange={e => setFormData({ ...formData, pay_type: e.target.value })}>
                                                    <option value="monthly">Mensual</option>
                                                    <option value="weekly">Semanal</option>
                                                    <option value="daily">Diario</option>
                                                    <option value="hourly">Por Hora</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider">Forma Pago</label>
                                                <select className="glass-input w-full bg-[var(--color-surface)]" value={formData.pay_method} onChange={e => setFormData({ ...formData, pay_method: e.target.value })}>
                                                    <option value="transfer">Transferencia</option>
                                                    <option value="cash">Efectivo</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider">Día de Pago</label>
                                                <input className="glass-input w-full" value={formData.pay_day} onChange={e => setFormData({ ...formData, pay_day: e.target.value })} placeholder="Ej: 05" />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider">Sueldo Base</label>
                                                <input type="number" className="glass-input w-full" value={formData.pay_base_amount} onChange={e => setFormData({ ...formData, pay_base_amount: Number(e.target.value) })} />
                                            </div>
                                        </div>

                                        {formData.pay_method === 'transfer' && (
                                            <div className="bg-[var(--glass-bg)] p-4 rounded-xl space-y-3">
                                                <p className="text-xs font-bold uppercase text-[var(--color-text-muted)]">Datos Bancarios</p>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <input className="glass-input w-full" placeholder="Banco" value={formData.pay_bank_name} onChange={e => setFormData({ ...formData, pay_bank_name: e.target.value })} />
                                                    <input className="glass-input w-full" placeholder="Tipo Cuenta" value={formData.pay_bank_account_type} onChange={e => setFormData({ ...formData, pay_bank_account_type: e.target.value })} />
                                                    <input className="glass-input w-full col-span-2" placeholder="N° Cuenta" value={formData.pay_bank_account} onChange={e => setFormData({ ...formData, pay_bank_account: e.target.value })} />
                                                    <input className="glass-input w-full col-span-2" placeholder="Titular" value={formData.pay_bank_owner} onChange={e => setFormData({ ...formData, pay_bank_owner: e.target.value })} />
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>

                            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-[var(--glass-border)]">
                                <button
                                    type="button"
                                    onClick={() => setIsModalOpen(false)}
                                    className="px-4 py-2 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--glass-bg)] rounded-lg transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="btn-primary"
                                >
                                    {editingUser ? 'Guardar Cambios' : 'Crear Usuario'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Users;
