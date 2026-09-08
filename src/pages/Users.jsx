import React, { useState, useMemo } from 'react';
import { Plus, Trash2, User, UserMinus, RotateCcw, CalendarDays, Pencil, Search, Users as UsersIcon, ShoppingCart, Package, ClipboardList, ChevronLeft, ChevronRight, X, Briefcase, CreditCard, Calendar } from 'lucide-react';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';
import { usePermissions } from '../hooks/usePermissions';
import { toast } from '../lib/toast';
import { validateRut, formatRutInput, formatRut } from '../utils/rutValidation';
import BajaPersonalModal from '../components/BajaPersonalModal';

const Users = () => {
    const { users, currentUser, currentUserCompanyRole, addUser, deleteUser, updateUser, activeCompanyId, fetchCompanyRoles, darDeBajaUsuario, reincorporarUsuario, fetchPersonalDadoDeBaja } = useStore();
    const { can } = usePermissions();

    // Solo el dueño (o super admin) puede eliminar usuarios; y el dueño no se puede eliminar.
    const isOwner = currentUserCompanyRole === 'owner' || currentUserCompanyRole === 'super_admin' || currentUser?.role === 'super_admin';

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState(null);
    const [activeTab, setActiveTab] = useState('general'); // 'general' | 'labor'
    const [companyRoles, setCompanyRoles] = useState([]);
    const [formData, setFormData] = useState({
        name: '', username: '', role: 'Caja', password: '', email: '',
        rut: '',
        // Labor Profile
        has_labor_profile: false,
        labor_weekly_hours: 42,
        labor_exempt_art22: false,
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
    // Qué lista se está mirando: los activos o los eliminados.
    const [listaVisible, setListaVisible] = useState('activos');
    // A quién se está dando de baja (abre el modal con fecha y motivo).
    const [bajaDe, setBajaDe] = useState(null);
    // Legajos del ex personal, con sus fechas. Los trae el servidor calculados
    // de los movimientos: no dependen de que alguien los haya cargado a mano.
    const [exPersonal, setExPersonal] = useState([]);
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

    // Las fechas del ex personal se piden solo cuando se los muestra: mientras
    // estén ocultos, ese dato no le sirve a nadie.
    React.useEffect(() => {
        if (listaVisible !== 'eliminados' || !activeCompanyId || !fetchPersonalDadoDeBaja) return;
        let vigente = true;
        fetchPersonalDadoDeBaja().then(filas => { if (vigente) setExPersonal(filas); });
        return () => { vigente = false; };
    }, [listaVisible, activeCompanyId, fetchPersonalDadoDeBaja]);

    // Legajo de un ex empleado, por id, para pintar sus fechas en la fila.
    const legajoDe = useMemo(() => {
        const m = new Map();
        for (const p of exPersonal) m.set(Number(p.id), p);
        return m;
    }, [exPersonal]);

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
    // Quien ya no tiene acceso SALE de la lista.
    //
    // Kevin lo pidió así y tiene razón: si cada persona que deja de trabajar
    // queda a la vista para siempre, la pantalla de usuarios termina siendo un
    // cementerio y cuesta encontrar a los que sí trabajan hoy.
    //
    // Pero la fila del usuario NO se borra de la base, y no es un detalle
    // técnico: el historial saca el nombre del vendedor de ahí
    // (`LEFT JOIN users` en ventas, cierres de caja y asistencia). Borrarla
    // dejaría 20.033 ventas de Kenia sin nombre, para siempre. Se esconde, que
    // es lo que hace falta, y el historial sigue diciendo quién vendió.
    //
    // Por eso hay DOS listas: Activos y Eliminados. En la de eliminados se ve
    // desde y hasta cuándo trabajó cada uno, y se los puede restaurar.
    const activos = useMemo(() => users.filter(u => u.company_role), [users]);
    const sinAcceso = useMemo(() => users.filter(u => !u.company_role), [users]);

    const filteredUsers = useMemo(() => {
        let result = users.filter(user => {
            const esActivo = !!user.company_role;
            if (esActivo !== (listaVisible === 'activos')) return false;
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
    }, [users, searchTerm, sortField, sortDirection, listaVisible]);

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
                rut: user.rut || '',
                // Labor
                has_labor_profile: !!user.has_labor_profile,
                labor_weekly_hours: user.labor_weekly_hours ?? 42,
                labor_exempt_art22: !!user.labor_exempt_art22,
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
                name: '', username: '', role: 'Caja', password: '', email: '', rut: '',
                has_labor_profile: false, labor_weekly_hours: 42, labor_exempt_art22: false,
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

        if (formData.rut && !validateRut(formData.rut)) {
            toast.error('El RUT no es válido. Revisa el dígito verificador.');
            return;
        }

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

    // Quién puede entrar de verdad, y quién no.
    //
    // Esta columna decía "Activo" para todos, siempre — estaba escrita fija, con
    // un comentario que decía "por ahora". O sea que un usuario al que ya se le
    // había quitado el acceso seguía figurando igual que uno que entra todos los
    // días, y no había forma de saberlo desde acá.
    //
    // Lo que decide es la membresía a la empresa (`company_role`): el login la
    // exige, así que sin ella no se entra desde ningún lado.
    const getStatusBadge = (user) => {
        if (user.company_role) {
            return (
                <span className="px-3 py-1 rounded-full bg-green-500/20 text-green-400 border border-green-500/30 text-xs font-medium">
                    Activo
                </span>
            );
        }
        // Dado de baja: se muestra desde y hasta cuándo trabajó. Las fechas las
        // calcula el servidor de sus movimientos, así que salen aunque a la
        // ficha nunca se le haya cargado la fecha de inicio.
        const legajo = legajoDe.get(Number(user.id));
        const dia = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : null);
        return (
            <div className="flex flex-col gap-1">
                <span
                    className="px-3 py-1 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 text-xs font-medium w-fit"
                    title="No puede iniciar sesión. Su historial de ventas, caja y asistencia sigue intacto."
                >
                    Eliminado
                </span>
                {legajo && (
                    <span className="text-[10px] text-[var(--color-text-muted)] flex items-center gap-1">
                        <CalendarDays size={11} className="shrink-0" />
                        {dia(legajo.desde) || '?'} → {dia(legajo.hasta) || '?'}
                    </span>
                )}
                {legajo?.labor_end_reason && (
                    <span className="text-[10px] text-[var(--color-text-muted)] italic">{legajo.labor_end_reason}</span>
                )}
                {legajo && (
                    <span className="text-[10px] text-[var(--color-text-muted)]">
                        {Number(legajo.ventas).toLocaleString('es-CL')} ventas · {legajo.cajas} cajas
                    </span>
                )}
            </div>
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

            {/* Dos listas separadas, no una mezclada.
                Los activos por un lado y los eliminados por otro: es como se
                piensa el personal, y evita que la lista de todos los días se
                llene de gente que ya no trabaja. */}
            <div className="flex gap-1 border-b border-[var(--glass-border)]">
                {[
                    ['activos', 'Activos', activos.length],
                    ['eliminados', 'Eliminados', sinAcceso.length],
                ].map(([clave, texto, n]) => (
                    <button
                        key={clave}
                        onClick={() => { setListaVisible(clave); setCurrentPage(1); }}
                        className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
                            listaVisible === clave
                                ? (clave === 'activos'
                                    ? 'border-green-400 text-green-400'
                                    : 'border-red-400 text-red-400')
                                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                        }`}
                    >
                        {texto}
                        {n > 0 && (
                            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold text-white ${
                                clave === 'activos' ? 'bg-green-500' : 'bg-red-500'
                            }`}>
                                {n}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* Users Table */}
            <div className="glass-card p-0 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-[var(--glass-bg)] border-b border-[var(--glass-border)]">
                            <tr className="text-[var(--color-text-muted)] text-xs uppercase tracking-wider">
                                <th className="px-6 py-4">#</th>
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
                                paginatedUsers.map((user, i) => (
                                    <tr key={user.id} className="hover:bg-[var(--glass-bg)] transition-colors group">
                                        {/* Número de fila, no el id de la base.
                                            El id trae los huecos de todo lo que se
                                            borró alguna vez —1, 2, 4, 5, 7, 10…— y
                                            eso no le dice nada a nadie: se ve como
                                            si faltaran usuarios. El id real queda
                                            en el título, que es donde sirve. */}
                                        <td
                                            className="px-6 py-4 text-[var(--color-text-muted)] text-sm"
                                            title={`ID interno: ${user.id}`}
                                        >
                                            {(currentPage - 1) * itemsPerPage + i + 1}
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
                                                {/* Quitar el acceso: lo que hace falta el 99% de las veces.
                                                    Alguien deja de trabajar y no tiene que poder entrar
                                                    nunca más, desde ningún equipo — pero sus ventas, sus
                                                    cierres de caja y su asistencia se quedan donde están.
                                                    Antes esto solo aparecía como consuelo después de que
                                                    fallara el borrado. */}
                                                {/* Dar de baja: lo que corresponde cuando alguien deja de
                                                    trabajar. Cierra el legajo con fecha y motivo, le quita
                                                    el acceso y lo saca de esta lista. Su historial queda
                                                    entero y a su nombre, en "Ex personal". */}
                                                {isOwner && user.company_role !== 'owner' && user.username !== 'admin' && user.company_role && (
                                                    <button
                                                        onClick={() => setBajaDe(user)}
                                                        className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-amber-400 hover:bg-amber-500/10 transition-all"
                                                        title="Eliminar usuario (sale de la lista; conserva todo su historial)"
                                                    >
                                                        <UserMinus size={18} />
                                                    </button>
                                                )}
                                                {/* Reincorporar: si volvió, o si fue un error. */}
                                                {isOwner && !user.company_role && (
                                                    <button
                                                        onClick={async () => {
                                                            if (!window.confirm(
                                                                `¿Restaurar a ${user.name}?\n\nVuelve a la lista de activos y puede entrar de nuevo con el rol "${user.role}".`
                                                            )) return;
                                                            const r = await reincorporarUsuario(user.id, user.role);
                                                            toast(
                                                                r?.success
                                                                    ? `${user.name} vuelve a tener acceso.`
                                                                    : (r?.error || 'No se pudo reincorporar.'),
                                                                r?.success ? 'success' : 'error'
                                                            );
                                                        }}
                                                        className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-green-400 hover:bg-green-500/10 transition-all"
                                                        title="Restaurar (vuelve a la lista de activos)"
                                                    >
                                                        <RotateCcw size={18} />
                                                    </button>
                                                )}
                                                {/* Borrado definitivo: SOLO para quien no dejó nada.
                                                    Un usuario con ventas, cajas o asistencia no se borra —su
                                                    nombre en el historial sale de esta fila— y para eso está
                                                    Eliminar, que cierra el legajo. Acá se limpian los que se
                                                    crearon por error y nunca trabajaron. */}
                                                {isOwner && !user.company_role && (() => {
                                                    const lg = legajoDe.get(Number(user.id));
                                                    const dejoAlgo = !lg || Number(lg.ventas) > 0 || Number(lg.cajas) > 0 || Number(lg.marcas) > 0;
                                                    if (dejoAlgo) return null;
                                                    return (
                                                        <button
                                                            onClick={async () => {
                                                                if (!window.confirm(
                                                                    `¿Borrar a ${user.name} definitivamente?\n\n` +
                                                                    'No tiene ventas, ni cierres de caja, ni asistencia: no se pierde nada.\n\n' +
                                                                    'Esto no se puede deshacer.'
                                                                )) return;
                                                                const r = await deleteUser(user.id);
                                                                toast(
                                                                    r?.success ? `${user.name} se borró del sistema.` : (r?.error || 'No se pudo borrar.'),
                                                                    r?.success ? 'success' : 'error'
                                                                );
                                                            }}
                                                            className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-all"
                                                            title="Borrar definitivamente (no dejó historial)"
                                                        >
                                                            <Trash2 size={18} />
                                                        </button>
                                                    );
                                                })()}
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
                    <div className="glass-card modal-solido w-full max-w-2xl p-6 relative animate-in fade-in zoom-in-95 duration-200 my-8">
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

                                {/* El RUT identifica al trabajador en el libro de asistencia y en su
                                    comprobante de marcación. Sin él, el registro no prueba quién marcó. */}
                                <div>
                                    <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider">
                                        RUT
                                    </label>
                                    <input
                                        className={cn(
                                            "glass-input w-full",
                                            formData.rut && !validateRut(formData.rut) && "border-red-500/50"
                                        )}
                                        value={formData.rut}
                                        onChange={e => setFormData({ ...formData, rut: formatRutInput(e.target.value) })}
                                        placeholder="12345678-9"
                                    />
                                    {formData.rut
                                        ? (validateRut(formData.rut)
                                            ? <p className="text-[10px] text-green-400 mt-1">{formatRut(formData.rut)}</p>
                                            : <p className="text-[10px] text-red-400 mt-1">El dígito verificador no cuadra.</p>)
                                        : <p className="text-[10px] text-[var(--color-text-muted)] mt-1">Necesario para el libro de asistencia y los comprobantes.</p>}
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
                                        <option value="Repartidor">Repartidor (solo entregas)</option>
                                        {companyRoles.filter(r => !['Administrador','Caja','Vendedor','Bodeguero','Supervisor','Repartidor'].includes(r.role_name)).map(r => (
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

                                        {/* Jornada del contrato. El informe de horas compara contra lo
                                            PACTADO, no contra el máximo legal: un part-time de 30 h no
                                            está en déficit por no llegar a 42. */}
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider">
                                                    Jornada pactada (h/semana)
                                                </label>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    max="45"
                                                    step="0.5"
                                                    className="glass-input w-full"
                                                    value={formData.labor_weekly_hours}
                                                    disabled={formData.labor_exempt_art22}
                                                    onChange={e => setFormData({ ...formData, labor_weekly_hours: e.target.value })}
                                                />
                                                <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
                                                    Máximo legal vigente: 42 h (Ley 21.561).
                                                </p>
                                            </div>
                                            <div className="flex flex-col justify-center">
                                                <label className="flex items-start gap-2 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        className="mt-0.5"
                                                        checked={formData.labor_exempt_art22}
                                                        onChange={e => setFormData({ ...formData, labor_exempt_art22: e.target.checked })}
                                                    />
                                                    <span className="text-xs text-[var(--color-text)]">
                                                        Excluido de limitación de jornada
                                                        <span className="block text-[10px] text-[var(--color-text-muted)]">
                                                            Art. 22 inc. 2°: sin fiscalización superior inmediata. No se le
                                                            calculan horas extra ni se le exige registro.
                                                        </span>
                                                    </span>
                                                </label>
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

            {/* Baja de personal: fecha de salida y motivo. */}
            <BajaPersonalModal
                usuario={bajaDe}
                onCancel={() => setBajaDe(null)}
                onConfirm={async ({ endDate, reason }) => {
                    const r = await darDeBajaUsuario(bajaDe.id, { endDate, reason });
                    if (!r?.success) return r;
                    setBajaDe(null);
                    setExPersonal([]); // se vuelve a pedir cuando se abra la vista
                    toast(
                        `${r.nombre} quedó dado de baja el ${String(r.salida).split('-').reverse().join('/')}. ` +
                        'Ya no puede entrar, y todo su historial se conservó.',
                        'success'
                    );
                    return true;
                }}
            />
        </div>
    );
};

export default Users;
