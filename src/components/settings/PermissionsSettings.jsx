import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/useStore';
import { ALL_PERMISSIONS } from '../../constants/permissions';
import { Shield, Check, X, AlertTriangle, Plus, Trash2, Edit2, RotateCcw, Save, LayoutGrid, List } from 'lucide-react';

const ToggleSwitch = ({ enabled, onChange, disabled }) => (
    <button
        onClick={() => !disabled && onChange(!enabled)}
        disabled={disabled}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ${enabled ? 'bg-emerald-500' : 'bg-gray-600'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${enabled ? 'translate-x-6' : 'translate-x-1'
            }`} />
    </button>
);

const PermissionsSettings = () => {
    const {
        rolePermissions, fetchRolePermissions, togglePermission, activeCompanyId,
        fetchCompanyRoles, createCustomRole, deleteCustomRole, renameCustomRole, resetRoleDefaults
    } = useStore();

    const [roles, setRoles] = useState([]);
    const [loading, setLoading] = useState(false);
    const [selectedRole, setSelectedRole] = useState(null); // High-level selection state

    // Modals State
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(null);
    const [showEditModal, setShowEditModal] = useState(null);

    // Create Role Form
    const [newRoleName, setNewRoleName] = useState('');
    const [newRoleDesc, setNewRoleDesc] = useState('');
    const [newRoleColor, setNewRoleColor] = useState('#6366f1');
    const [copyFromRole, setCopyFromRole] = useState('');

    const COLORS = ['#6366f1', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b'];

    useEffect(() => {
        if (activeCompanyId) {
            loadData();
        }
    }, [activeCompanyId]);

    const loadData = async () => {
        setLoading(true);
        await fetchRolePermissions(); // Fetch permissions first
        const roleList = await fetchCompanyRoles(); // Then roles
        setRoles(roleList);

        // Auto-select first role if none selected or if selected was deleted
        if (roleList && roleList.length > 0) {
            if (!selectedRole || !roleList.find(r => r.role_name === selectedRole.role_name)) {
                setSelectedRole(roleList[0]);
            } else {
                // Formatting update: maintain selection object reference freshness
                setSelectedRole(roleList.find(r => r.role_name === selectedRole.role_name));
            }
        } else {
            setSelectedRole(null);
        }
        setLoading(false);
    };

    const isGranted = (role, permissionId) => {
        if (!rolePermissions) return false;
        const perm = rolePermissions.find(p => p.role === role && p.permission === permissionId);
        return perm ? Number(perm.granted) === 1 : false;
    };

    const handleToggle = async (role, permissionId, currentStatus) => {
        await togglePermission(role, permissionId, !currentStatus);
        // Refresh permissions local state if needed, but store handles it mostly
    };

    const handleCreateRole = async () => {
        if (!newRoleName.trim()) return alert("El nombre del rol es obligatorio");

        const res = await createCustomRole(newRoleName, newRoleDesc, newRoleColor, copyFromRole);
        if (res.success) {
            setShowCreateModal(false);
            setNewRoleName('');
            setNewRoleDesc('');
            loadData();
        } else {
            alert("Error al crear rol: " + res.error);
        }
    };

    const handleDeleteRole = async () => {
        if (!showDeleteModal) return;
        const res = await deleteCustomRole(showDeleteModal.role_name);
        if (res.success) {
            setShowDeleteModal(null);
            loadData();
        } else {
            alert("Error al eliminar rol: " + res.error);
        }
    };

    const handleRenameRole = async () => {
        if (!showEditModal || !newRoleName.trim()) return;
        const res = await renameCustomRole(showEditModal.role_name, newRoleName);
        if (res.success) {
            setShowEditModal(null);
            loadData();
        } else {
            alert("Error al renombrar rol: " + res.error);
        }
    };

    const handleResetDefaults = async (roleName) => {
        if (window.confirm(`¿Estás seguro de restaurar los permisos por defecto para ${roleName}? Se perderán las configuraciones actuales.`)) {
            const res = await resetRoleDefaults(roleName);
            if (res.success) {
                alert("Permisos restaurados correctamente");
                fetchRolePermissions(); // Refresh UI
            } else {
                alert("Error: " + res.error);
            }
        }
    };

    const openEditModal = (role) => {
        setNewRoleName(role.role_name);
        setShowEditModal(role);
    };

    return (
        <div className="h-[calc(100vh-140px)] min-h-[600px] flex flex-col md:flex-row gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

            {/* LEFT SIDEBAR: ROLE LIST */}
            <div className="w-full md:w-1/3 lg:w-1/4 flex flex-col gap-4">
                <div className="glass-card p-4 flex flex-col h-full border border-[var(--glass-border)]">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="font-bold text-[var(--color-text)] flex items-center gap-2">
                            <LayoutGrid size={18} className="text-purple-400" /> Roles
                        </h3>
                        <button
                            onClick={() => setShowCreateModal(true)}
                            className="p-1.5 rounded-lg bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-colors"
                            title="Crear Nuevo Rol"
                        >
                            <Plus size={18} />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                        {roles.map(role => (
                            <button
                                key={role.role_name}
                                onClick={() => setSelectedRole(role)}
                                className={`w-full text-left p-3 rounded-lg border transition-all duration-200 flex items-center justify-between group ${selectedRole?.role_name === role.role_name
                                    ? 'bg-[var(--glass-border)] border-[var(--color-primary)] shadow-md'
                                    : 'border-transparent hover:bg-[var(--glass-border)]'
                                    }`}
                            >
                                <div className="flex items-center gap-3">
                                    <div
                                        className="w-3 h-3 rounded-full shadow-sm"
                                        style={{ backgroundColor: role.color }}
                                    />
                                    <div>
                                        <div className={`font-medium ${selectedRole?.role_name === role.role_name ? 'text-[var(--color-text)]' : 'text-[var(--color-text-muted)]'}`}>
                                            {role.role_name}
                                        </div>
                                        {Number(role.is_system) === 1 && (
                                            <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] opacity-60">Sistema</span>
                                        )}
                                    </div>
                                </div>

                                {/* Current Selection Indicator */}
                                {selectedRole?.role_name === role.role_name && (
                                    <div className="bg-[var(--color-primary)] w-1.5 h-1.5 rounded-full animate-pulse" />
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* RIGHT PANEL: PERMISSIONS MATRIX (SINGLE ROLE) */}
            <div className="flex-1 flex flex-col gap-4 h-full overflow-hidden">
                {selectedRole ? (
                    <div className="glass-card p-0 flex flex-col h-full border border-[var(--glass-border)] overflow-hidden">
                        {/* Header */}
                        <div className="p-6 border-b border-[var(--glass-border)] bg-[var(--glass-bg)] flex justify-between items-center">
                            <div className="flex items-center gap-4">
                                <div
                                    className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg"
                                    style={{ backgroundColor: selectedRole.color + '20' }}
                                >
                                    <Shield size={20} style={{ color: selectedRole.color }} />
                                </div>
                                <div>
                                    <h2 className="text-2xl font-bold text-[var(--color-text)] flex items-center gap-2">
                                        {selectedRole.role_name}
                                    </h2>
                                    <p className="text-sm text-[var(--color-text-muted)]">
                                        {selectedRole.description || (selectedRole.is_system ? "Rol del sistema" : "Rol personalizado")}
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                {Number(selectedRole.is_system) === 1 ? (
                                    <button
                                        onClick={() => handleResetDefaults(selectedRole.role_name)}
                                        className="btn-ghost flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-blue-400"
                                    >
                                        <RotateCcw size={16} /> Restaurar Por Defecto
                                    </button>
                                ) : (
                                    <>
                                        <button
                                            onClick={() => openEditModal(selectedRole)}
                                            className="btn-ghost flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-yellow-400"
                                        >
                                            <Edit2 size={16} /> Editar Nombre
                                        </button>
                                        <button
                                            onClick={() => setShowDeleteModal(selectedRole)}
                                            className="btn-ghost flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-red-400"
                                        >
                                            <Trash2 size={16} /> Eliminar Rol
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Scrollable Permissions List */}
                        <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar relative">
                            {/* Hint/Warning */}
                            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 flex items-start gap-3 mb-4">
                                <AlertTriangle className="text-blue-400 flex-shrink-0 mt-0.5" size={16} />
                                <p className="text-sm text-[var(--color-text-muted)]">
                                    Los cambios se guardan automáticamente. Activa los interruptores para conceder permisos a <span className="text-[var(--color-text)] font-semibold">{selectedRole.role_name}</span>.
                                </p>
                            </div>

                            {ALL_PERMISSIONS.map((group) => (
                                <div key={group.id} className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                                    <h3 className="text-xs font-bold text-[var(--color-primary)] uppercase tracking-wider mb-3 px-1 border-b border-[var(--glass-border)] pb-2">
                                        {group.label}
                                    </h3>
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                        {group.permissions.map((perm) => {
                                            const granted = isGranted(selectedRole.role_name, perm.id);
                                            return (
                                                <div
                                                    key={perm.id}
                                                    className={`p-4 rounded-xl border transition-all duration-200 flex items-center justify-between group hover:border-[var(--glass-border)] ${granted
                                                        ? 'bg-[var(--glass-border)]/50 border-[var(--glass-border)]'
                                                        : 'bg-transparent border-transparent'
                                                        }`}
                                                >
                                                    <div className="flex-1 mr-4">
                                                        <div className="text-[var(--color-text)] font-medium text-sm">
                                                            {perm.label}
                                                        </div>
                                                        <div className="text-[var(--color-text-muted)] text-xs font-mono opacity-50 mt-0.5">
                                                            {perm.id}
                                                        </div>
                                                    </div>
                                                    <ToggleSwitch
                                                        enabled={granted}
                                                        onChange={() => handleToggle(selectedRole.role_name, perm.id, granted)}
                                                    />
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}

                            {/* Bottom padding for scroll */}
                            <div className="h-10" />
                        </div>
                    </div>
                ) : (
                    <div className="glass-card flex-1 flex flex-col items-center justify-center text-center p-8 opacity-60">
                        <div className="w-16 h-16 rounded-full bg-[var(--glass-border)] flex items-center justify-center mb-4">
                            <List size={32} className="text-[var(--color-text-muted)]" />
                        </div>
                        <h3 className="text-xl font-bold text-[var(--color-text)]">Selecciona un rol</h3>
                        <p className="text-[var(--color-text-muted)]">Elige un rol de la lista izquierda para gestionar sus permisos.</p>
                    </div>
                )}
            </div>

            {/* CREATE ROLE MODAL */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="glass-card w-full max-w-md space-y-4 animate-in fade-in zoom-in duration-300">
                        <h3 className="text-xl font-bold text-[var(--color-text)]">Crear Nuevo Rol</h3>

                        <div className="space-y-2">
                            <label className="text-sm text-[var(--color-text-muted)]">Nombre del Rol</label>
                            <input
                                type="text"
                                value={newRoleName}
                                onChange={e => setNewRoleName(e.target.value)}
                                className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] focus:border-[var(--color-primary)] outline-none transition-colors"
                                placeholder="Ej: Cajero Nocturno"
                                autoFocus
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm text-[var(--color-text-muted)]">Descripción (Opcional)</label>
                            <input
                                type="text"
                                value={newRoleDesc}
                                onChange={e => setNewRoleDesc(e.target.value)}
                                className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] focus:border-[var(--color-primary)] outline-none transition-colors"
                                placeholder="Breve descripción del rol"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm text-[var(--color-text-muted)]">Color Identificativo</label>
                            <div className="flex gap-2 flex-wrap p-2 bg-[var(--glass-bg)] rounded-lg border border-[var(--glass-border)]">
                                {COLORS.map(c => (
                                    <button
                                        key={c}
                                        onClick={() => setNewRoleColor(c)}
                                        className={`w-8 h-8 rounded-full border-2 transition-all ${newRoleColor === c ? 'border-white scale-110 shadow-lg' : 'border-transparent opacity-60 hover:opacity-100'}`}
                                        style={{ backgroundColor: c }}
                                    />
                                ))}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm text-[var(--color-text-muted)]">Copiar permisos de (Opcional)</label>
                            <select
                                value={copyFromRole}
                                onChange={e => setCopyFromRole(e.target.value)}
                                className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] focus:border-[var(--color-primary)] outline-none transition-colors"
                            >
                                <option value="">-- Empezar desde cero --</option>
                                {roles.map(r => (
                                    <option key={r.role_name} value={r.role_name}>{r.role_name}</option>
                                ))}
                            </select>
                        </div>

                        <div className="flex gap-3 pt-4">
                            <button onClick={() => setShowCreateModal(false)} className="flex-1 py-2 text-[var(--color-text-muted)] hover:bg-[var(--glass-border)] rounded-lg transition-colors">
                                Cancelar
                            </button>
                            <button onClick={handleCreateRole} className="flex-1 btn-primary py-2 rounded-lg shadow-lg hover:shadow-cyan-500/20">
                                Crear Rol
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* DELETE ROLE MODAL */}
            {showDeleteModal && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="glass-card w-full max-w-sm space-y-4 animate-in fade-in zoom-in duration-300 border border-red-500/30">
                        <div className="flex items-center gap-3 text-red-500 mb-2">
                            <Trash2 size={24} />
                            <h3 className="text-xl font-bold">Eliminar Rol</h3>
                        </div>
                        <p className="text-[var(--color-text)]">
                            ¿Estás seguro de eliminar el rol <span className="font-bold">{showDeleteModal.role_name}</span>?
                        </p>
                        <p className="text-sm text-[var(--color-text-muted)] bg-red-500/10 p-3 rounded-lg border border-red-500/20">
                            ⚠️ Los usuarios asignados a este rol serán movidos automáticamente al rol <strong>Vendedor</strong>.
                        </p>
                        <div className="flex gap-3 pt-2">
                            <button onClick={() => setShowDeleteModal(null)} className="flex-1 py-2 text-[var(--color-text-muted)] hover:bg-[var(--glass-border)] rounded-lg transition-colors">
                                Cancelar
                            </button>
                            <button onClick={handleDeleteRole} className="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold py-2 rounded-lg transition-colors shadow-lg hover:shadow-red-500/20">
                                Sí, eliminar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* EDIT ROLE MODAL */}
            {showEditModal && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="glass-card w-full max-w-sm space-y-4 animate-in fade-in zoom-in duration-300">
                        <h3 className="text-xl font-bold text-[var(--color-text)]">Renombrar Rol</h3>
                        <div className="space-y-2">
                            <label className="text-sm text-[var(--color-text-muted)]">Nuevo nombre para {showEditModal.role_name}</label>
                            <input
                                type="text"
                                value={newRoleName}
                                onChange={e => setNewRoleName(e.target.value)}
                                className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] focus:border-[var(--color-primary)] outline-none transition-colors"
                            />
                        </div>
                        <div className="flex gap-3 pt-2">
                            <button onClick={() => setShowEditModal(null)} className="flex-1 py-2 text-[var(--color-text-muted)] hover:bg-[var(--glass-border)] rounded-lg transition-colors">
                                Cancelar
                            </button>
                            <button onClick={handleRenameRole} className="flex-1 btn-primary py-2 rounded-lg shadow-lg">
                                Guardar Cambios
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PermissionsSettings;
