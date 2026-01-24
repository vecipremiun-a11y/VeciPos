import React, { useState } from 'react';
import { Plus, Trash2, Shield, User, Pencil } from 'lucide-react';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';

const Users = () => {
    const { users, currentUser, addUser, deleteUser, updateUser } = useStore();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState(null);
    const [formData, setFormData] = useState({ name: '', username: '', role: 'Vendedor', password: '' });

    // Simple protection: only Admin allows editing users
    if (currentUser?.role !== 'Administrador') {
        return <div className="text-center p-10 text-red-500">Acceso Denegado. Se requieren permisos de Administrador.</div>;
    }

    const handleOpenModal = (user = null) => {
        if (user) {
            setEditingUser(user);
            setFormData({ name: user.name, username: user.username, role: user.role, password: '' });
        } else {
            setEditingUser(null);
            setFormData({ name: '', username: '', role: 'Vendedor', password: '' });
        }
        setIsModalOpen(true);
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (editingUser) {
            updateUser(editingUser.id, formData);
        } else {
            addUser(formData);
        }
        setIsModalOpen(false);
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold text-[var(--color-text)] neon-text">Gestión de Usuarios</h1>
                <button onClick={() => handleOpenModal()} className="btn-primary flex items-center gap-2">
                    <Plus size={20} /> Nuevo Usuario
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {users.map(user => (
                    <div key={user.id} className="glass-card flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-[var(--glass-bg)] flex items-center justify-center text-[var(--color-primary)]">
                            <User size={24} />
                        </div>
                        <div className="flex-1">
                            <h3 className="text-[var(--color-text)] font-bold">{user.name}</h3>
                            <p className="text-[var(--color-text-muted)] text-sm">@{user.username}</p>
                            <span className="inline-block mt-1 px-2 py-0.5 rounded-md bg-[var(--color-secondary)]/20 text-[var(--color-secondary)] text-xs border border-[var(--color-secondary)]/30">
                                {user.role}
                            </span>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => handleOpenModal(user)}
                                className="p-2 text-[var(--color-text-muted)] hover:text-blue-400 transition-colors"
                            >
                                <Pencil size={18} />
                            </button>
                            {user.username !== 'admin' && (
                                <button
                                    onClick={() => deleteUser(user.id)}
                                    className="p-2 text-[var(--color-text-muted)] hover:text-red-400 transition-colors"
                                >
                                    <Trash2 size={18} />
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--glass-bg)] backdrop-blur-sm">
                    <div className="glass-card w-full max-w-md relative animate-[float_0.3s_ease-out]">
                        <h2 className="text-xl font-bold mb-4 text-[var(--color-text)]">{editingUser ? 'Editar Usuario' : 'Nuevo Usuario'}</h2>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="block text-sm text-[var(--color-text-muted)] mb-1">Nombre Completo</label>
                                <input
                                    className="glass-input w-full"
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-[var(--color-text-muted)] mb-1">Usuario</label>
                                <input
                                    className="glass-input w-full"
                                    value={formData.username}
                                    onChange={e => setFormData({ ...formData, username: e.target.value })}
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-[var(--color-text-muted)] mb-1">
                                    {editingUser ? 'Nueva Contraseña (opcional)' : 'Contraseña (por defecto: 123456)'}
                                </label>
                                <input
                                    className="glass-input w-full"
                                    type="password"
                                    value={formData.password}
                                    onChange={e => setFormData({ ...formData, password: e.target.value })}
                                    placeholder={editingUser ? "************" : "123456"}
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-[var(--color-text-muted)] mb-1">Rol</label>
                                <select
                                    className="glass-input w-full bg-[var(--color-surface)] dark:bg-gray-900 text-[var(--color-text)]"
                                    value={formData.role}
                                    onChange={e => setFormData({ ...formData, role: e.target.value })}
                                >
                                    <option value="Vendedor">Vendedor</option>
                                    <option value="Bodeguero">Bodeguero</option>
                                    <option value="Administrador">Administrador</option>
                                </select>
                            </div>
                            <div className="flex justify-end gap-2 pt-4">
                                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 rounded-lg text-[var(--color-text)] hover:bg-[var(--glass-bg)]">Cancelar</button>
                                <button type="submit" className="btn-primary">{editingUser ? 'Guardar Cambios' : 'Crear'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Users;
