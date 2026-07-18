import React, { useState, useEffect } from 'react';
import { X, Building2, UserPlus, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useStore } from '../../store/useStore';

const CreateCompanyModal = ({ onClose, onCreated }) => {
    const { createCompany, adminFetchUsers } = useStore();
    const [loading, setLoading] = useState(false);
    const [showUserSection, setShowUserSection] = useState(false);
    const [users, setUsers] = useState([]);

    useEffect(() => {
        adminFetchUsers?.().then(setUsers).catch(() => {});
    }, [adminFetchUsers]);

    const [form, setForm] = useState({
        id: '',
        name: '',
        country: 'CL',
        plan: 'standard',
        ownerUserId: '',
        createUser: false,
        username: '',
        password: '',
        fullName: ''
    });

    const [errors, setErrors] = useState({});

    const handleChange = (field, value) => {
        setForm(prev => ({ ...prev, [field]: value }));
        if (errors[field]) {
            setErrors(prev => ({ ...prev, [field]: null }));
        }
    };

    const generateId = () => {
        const slug = form.name
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
        handleChange('id', slug || `empresa-${Date.now()}`);
    };

    const validate = () => {
        const newErrors = {};
        if (!form.id.trim()) newErrors.id = 'ID requerido';
        if (/\s/.test(form.id)) newErrors.id = 'ID no puede contener espacios';
        if (!form.name.trim()) newErrors.name = 'Nombre requerido';
        if (form.createUser) {
            if (!form.username.trim()) newErrors.username = 'Username requerido';
            if (!form.password.trim()) newErrors.password = 'Contraseña requerida';
        }
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!validate()) return;

        setLoading(true);
        try {
            const companyData = {
                id: form.id.trim(),
                name: form.name.trim(),
                country: form.country,
                plan: form.plan,
                status: 'active',
            };

            if (form.createUser) {
                companyData.newUser = {
                    username: form.username.trim(),
                    password: form.password,
                    name: form.fullName.trim() || form.username.trim()
                };
            } else if (form.ownerUserId) {
                companyData.ownerUserId = Number(form.ownerUserId);
            }

            const res = await createCompany(companyData);
            if (res.success) {
                onCreated?.();
                onClose();
            } else {
                alert('Error: ' + (res.error || 'Error desconocido'));
            }
        } catch (err) {
            alert('Error: ' + err.message);
        } finally {
            setLoading(false);
        }
    };

    const InputField = ({ label, field, type = 'text', placeholder, error, ...props }) => (
        <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">{label}</label>
            <input
                type={type}
                value={form[field]}
                onChange={(e) => handleChange(field, e.target.value)}
                placeholder={placeholder}
                className={cn(
                    'w-full px-3 py-2.5 bg-white/5 border rounded-xl text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 transition-all',
                    error
                        ? 'border-red-500/50 focus:ring-red-500/30'
                        : 'border-white/10 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)]/50'
                )}
                {...props}
            />
            {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
        </div>
    );

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[#18181b] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl animate-in fade-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-white/10">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-[var(--color-primary)]/10 flex items-center justify-center">
                            <Building2 size={20} className="text-[var(--color-primary)]" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white">Nueva Empresa</h2>
                            <p className="text-xs text-gray-500">Crear empresa manualmente</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-white/10 rounded-lg transition-colors text-gray-400 hover:text-white"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-6 space-y-5">

                    {/* Company Name */}
                    <InputField
                        label="Nombre de la Empresa"
                        field="name"
                        placeholder="Ej: Mi Tienda"
                        error={errors.name}
                        onBlur={() => { if (!form.id && form.name) generateId(); }}
                    />

                    {/* Company ID */}
                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="text-xs font-medium text-gray-400">ID de Empresa</label>
                            <button
                                type="button"
                                onClick={generateId}
                                className="text-[10px] text-[var(--color-primary)] hover:underline"
                            >
                                Generar desde nombre
                            </button>
                        </div>
                        <input
                            type="text"
                            value={form.id}
                            onChange={(e) => handleChange('id', e.target.value.replace(/\s/g, '-').toLowerCase())}
                            placeholder="mi-tienda"
                            className={cn(
                                'w-full px-3 py-2.5 bg-white/5 border rounded-xl text-white text-sm font-mono placeholder-gray-600 focus:outline-none focus:ring-2 transition-all',
                                errors.id
                                    ? 'border-red-500/50 focus:ring-red-500/30'
                                    : 'border-white/10 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)]/50'
                            )}
                        />
                        {errors.id && <p className="text-xs text-red-400 mt-1">{errors.id}</p>}
                    </div>

                    {/* Country & Plan */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-medium text-gray-400 mb-1.5">País</label>
                            <select
                                value={form.country}
                                onChange={(e) => handleChange('country', e.target.value)}
                                className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 transition-all appearance-none"
                            >
                                <option value="CL">🇨🇱 Chile</option>
                                <option value="AR">🇦🇷 Argentina</option>
                                <option value="MX">🇲🇽 México</option>
                                <option value="CO">🇨🇴 Colombia</option>
                                <option value="PE">🇵🇪 Perú</option>
                                <option value="EC">🇪🇨 Ecuador</option>
                                <option value="US">🇺🇸 USA</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-400 mb-1.5">Plan</label>
                            <select
                                value={form.plan}
                                onChange={(e) => handleChange('plan', e.target.value)}
                                className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 transition-all appearance-none"
                            >
                                <option value="standard">Standard</option>
                                <option value="professional">Profesional</option>
                            </select>
                        </div>
                    </div>

                    {/* Dueño de la empresa (cliente) — el enlace a su cuenta se deduce de aquí */}
                    <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Dueño de la empresa</label>
                        <select
                            value={form.ownerUserId}
                            onChange={(e) => handleChange('ownerUserId', e.target.value)}
                            disabled={form.createUser}
                            className={cn(
                                'w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 transition-all appearance-none',
                                form.createUser && 'opacity-50 cursor-not-allowed'
                            )}
                        >
                            <option value="">— Yo (super admin) —</option>
                            {users.map(u => (
                                <option key={u.id} value={u.id}>{u.username}{u.name ? ` · ${u.name}` : ''}</option>
                            ))}
                        </select>
                        <p className="text-[10px] text-gray-500 mt-1">
                            Solo clientes (dueños de cuenta). La empresa se enlaza a la cuenta de ese dueño automáticamente. O crea un dueño nuevo abajo.
                        </p>
                    </div>

                    {/* Divider - Create User */}
                    <div className="border-t border-white/10 pt-4">
                        <button
                            type="button"
                            onClick={() => {
                                setShowUserSection(!showUserSection);
                                handleChange('createUser', !form.createUser);
                            }}
                            className="flex items-center justify-between w-full group"
                        >
                            <div className="flex items-center gap-2">
                                <UserPlus size={16} className="text-gray-400 group-hover:text-white transition-colors" />
                                <span className="text-sm font-medium text-gray-300 group-hover:text-white transition-colors">
                                    Crear dueño nuevo (cliente)
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className={cn(
                                    'text-[10px] font-bold px-2 py-0.5 rounded-full transition-colors',
                                    showUserSection
                                        ? 'bg-green-500/20 text-green-400'
                                        : 'bg-white/5 text-gray-500'
                                )}>
                                    {showUserSection ? 'SÍ' : 'NO'}
                                </span>
                                {showUserSection ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
                            </div>
                        </button>

                        {showUserSection && (
                            <div className="mt-4 space-y-4 pl-2 border-l-2 border-[var(--color-primary)]/20 ml-2">
                                <p className="text-[11px] text-amber-400/90">
                                    Este usuario será el <strong>dueño</strong> de la empresa (acceso y control total; no se puede eliminar). Estos son sus datos de acceso.
                                </p>
                                <InputField
                                    label="Username"
                                    field="username"
                                    placeholder="admin"
                                    error={errors.username}
                                />
                                <InputField
                                    label="Contraseña"
                                    field="password"
                                    type="text"
                                    placeholder="••••••••"
                                    error={errors.password}
                                />
                                <InputField
                                    label="Nombre Completo (Opcional)"
                                    field="fullName"
                                    placeholder="Juan Pérez"
                                />
                            </div>
                        )}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-2.5 bg-white/5 text-gray-400 font-medium rounded-xl hover:bg-white/10 transition-colors text-sm"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="flex-1 px-4 py-2.5 bg-[var(--color-primary)] text-black font-bold rounded-xl hover:brightness-110 transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" />
                                    Creando...
                                </>
                            ) : (
                                'Crear Empresa'
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CreateCompanyModal;
