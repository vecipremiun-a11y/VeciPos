import React, { useState } from 'react';
import { Plus, Edit, Trash2, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { usePermissions } from '../hooks/usePermissions';

const Categories = () => {
    const { categories, addCategory, updateCategory, deleteCategory } = useStore();
    const { can } = usePermissions();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingCategory, setEditingCategory] = useState(null);

    const handleEdit = (category) => {
        setEditingCategory(category);
        setIsModalOpen(true);
    };

    const handleDelete = (id) => {
        if (window.confirm('¿Estás seguro de eliminar esta categoría?')) {
            deleteCategory(id);
        }
    };

    const handleNewCategory = () => {
        setEditingCategory(null);
        setIsModalOpen(true);
    };

    const handleSave = (categoryData) => {
        if (editingCategory) {
            updateCategory(editingCategory.id, categoryData);
        } else {
            addCategory(categoryData);
        }
        setIsModalOpen(false);
    };

    return (
        <div className="space-y-6">
            {/* Header - Compact on Mobile */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 md:gap-4">
                <div>
                    <h1 className="text-xl lg:text-3xl font-bold text-[var(--color-text)] neon-text">Categorías</h1>
                    <p className="text-xs lg:text-base text-[var(--color-text-muted)]">Gestiona las categorías de tus productos</p>
                </div>
                {can('categories.create') && (
                    <button onClick={handleNewCategory} className="btn-primary flex items-center gap-2 text-sm lg:text-base px-3 lg:px-4 py-2">
                        <Plus size={18} /> Nueva Categoría
                    </button>
                )}
            </div>

            {/* Categories List - Compact rows on Mobile, Table on Desktop */}
            <div className="glass-card overflow-hidden p-0">
                {/* Mobile View - Compact Rows */}
                <div className="lg:hidden">
                    {/* Mobile Header */}
                    <div className="bg-[var(--glass-bg)] text-[var(--color-text-muted)] uppercase text-[10px] font-bold px-3 py-3">
                        <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 items-center">
                            <div>NOMBRE</div>
                            <div className="w-12 text-center">COLOR</div>
                            <div className="w-16 text-center">ESTADO</div>
                            <div className="w-12 text-center">POS</div>
                            <div className="w-12 text-center">ACCIONES</div>
                        </div>
                    </div>

                    {/* Mobile Rows */}
                    <div className="divide-y divide-[var(--glass-border)] pb-20">
                        {categories.length === 0 ? (
                            <div className="text-center py-10 text-[var(--color-text-muted)] text-sm">
                                No hay categorías registradas.
                            </div>
                        ) : (
                            categories.map((category) => (
                                <div key={category.id} className="px-3 py-3 hover:bg-[var(--glass-bg)] transition-colors">
                                    <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 items-center">
                                        {/* Name */}
                                        <div className="font-bold text-[var(--color-text)] text-sm truncate">
                                            {category.name}
                                        </div>

                                        {/* Color */}
                                        <div className="w-12 flex justify-center">
                                            <div
                                                className="w-6 h-6 rounded-full border border-[var(--glass-border)] shadow-sm"
                                                style={{ backgroundColor: category.color || '#cccccc' }}
                                            ></div>
                                        </div>

                                        {/* Status */}
                                        <div className="w-16 flex justify-center">
                                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${category.status === 'active'
                                                ? 'bg-green-500/20 text-green-400'
                                                : 'bg-red-500/20 text-red-400'
                                                }`}>
                                                {category.status === 'active' ? 'ACTIVA' : 'INACTIVA'}
                                            </span>
                                        </div>

                                        {/* POS */}
                                        <div className="w-12 flex justify-center">
                                            <div className={`w-2.5 h-2.5 rounded-full ${category.showInPos !== false
                                                ? 'bg-blue-400 shadow-[0_0_6px_rgba(59,130,246,0.6)]'
                                                : 'bg-gray-600'
                                                }`}></div>
                                        </div>

                                        {/* Actions */}
                                        <div className="w-12 flex justify-center">
                                            {can('categories.edit') && (
                                                <button
                                                    onClick={() => handleEdit(category)}
                                                    className="p-1.5 hover:bg-[var(--color-surface-hover)] rounded text-[var(--color-text-muted)] transition-colors"
                                                >
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                        <circle cx="12" cy="12" r="1" />
                                                        <circle cx="12" cy="5" r="1" />
                                                        <circle cx="12" cy="19" r="1" />
                                                    </svg>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Desktop View - Original Table */}
                <div className="hidden lg:block overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-[var(--glass-bg)] text-[var(--color-text-muted)] uppercase text-sm font-semibold">
                            <tr>
                                <th className="px-6 py-5">Nombre</th>
                                <th className="px-6 py-5">Color</th>
                                <th className="px-6 py-5">Estado</th>
                                <th className="px-6 py-5 text-center">POS</th>
                                <th className="px-6 py-5 text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y border-[var(--glass-border)]">
                            {categories.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="text-center py-10 text-[var(--color-text-muted)]">
                                        No hay categorías registradas.
                                    </td>
                                </tr>
                            ) : (
                                categories.map((category) => (
                                    <tr key={category.id} className="hover:bg-[var(--glass-bg)] transition-colors group">
                                        <td className="px-6 py-5 font-medium text-[var(--color-text)] text-lg">{category.name}</td>
                                        <td className="px-6 py-5">
                                            <div
                                                className="w-8 h-8 rounded-full border border-[var(--glass-border)] shadow-sm"
                                                style={{ backgroundColor: category.color || '#cccccc' }}
                                                title={category.color}
                                            ></div>
                                        </td>
                                        <td className="px-6 py-5">
                                            <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${category.status === 'active'
                                                ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                                                : 'bg-red-500/10 text-red-400 border border-red-500/20'
                                                }`}>
                                                {category.status === 'active' ? 'Activa' : 'Inactiva'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-5 text-center">
                                            <div className={`w-3 h-3 rounded-full mx-auto ${category.showInPos !== false ? 'bg-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.5)]' : 'bg-gray-600'}`} title={category.showInPos !== false ? 'Visible en POS' : 'Oculto en POS'}></div>
                                        </td>
                                        <td className="px-6 py-5 text-right">
                                            <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                {can('categories.edit') && (
                                                    <button
                                                        onClick={() => handleEdit(category)}
                                                        className="p-3 hover:bg-[var(--color-surface-hover)] rounded-lg text-blue-400 transition-colors"
                                                    >
                                                        <Edit size={20} />
                                                    </button>
                                                )}
                                                {can('categories.delete') && (
                                                    <button
                                                        onClick={() => handleDelete(category.id)}
                                                        className="p-3 hover:bg-[var(--color-surface-hover)] rounded-lg text-red-400 transition-colors"
                                                    >
                                                        <Trash2 size={20} />
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
            </div>

            <CategoryModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSave={handleSave}
                categoryToEdit={editingCategory}
            />
        </div>
    );
};

const CategoryModal = ({ isOpen, onClose, onSave, categoryToEdit }) => {
    const [formData, setFormData] = useState({
        name: '',
        color: '#3b82f6', // Default blue
        status: 'active',
        showInPos: true
    });

    React.useEffect(() => {
        if (categoryToEdit) {
            setFormData({
                ...categoryToEdit,
                showInPos: categoryToEdit.showInPos !== false
            });
        } else {
            setFormData({ name: '', color: '#3b82f6', status: 'active', showInPos: true });
        }
    }, [categoryToEdit, isOpen]);

    if (!isOpen) return null;

    const handleSubmit = (e) => {
        e.preventDefault();
        onSave(formData);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-surface)] dark:bg-black/60 backdrop-blur-sm p-4">
            <div className="glass-card w-full max-w-md relative animate-[float_0.3s_ease-out]">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                >
                    <X size={24} />
                </button>

                <h2 className="text-2xl font-bold mb-6 neon-text border-b border-[var(--glass-border)] pb-4">
                    {categoryToEdit ? 'Editar Categoría' : 'Nueva Categoría'}
                </h2>

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label className="block text-sm text-[var(--color-text-muted)] mb-1">Nombre</label>
                        <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            className="glass-input w-full"
                            required
                            placeholder="Ej. Bebidas"
                        />
                    </div>

                    <div>
                        <label className="block text-sm text-[var(--color-text-muted)] mb-1">Color Identificador</label>
                        <div className="flex gap-4 items-center">
                            <input
                                type="color"
                                value={formData.color}
                                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                                className="h-10 w-20 bg-transparent border border-[var(--glass-border)] rounded cursor-pointer"
                            />
                            <span className="text-[var(--color-text-muted)] text-sm font-mono">{formData.color}</span>
                        </div>
                    </div>

                    <div className="flex gap-4">
                        <div className="flex-1">
                            <label className="block text-sm text-[var(--color-text-muted)] mb-1">Estado</label>
                            <select
                                value={formData.status}
                                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                                className="glass-input w-full"
                            >
                                <option value="active" className="bg-gray-900">Activa</option>
                                <option value="inactive" className="bg-gray-900">Inactiva</option>
                            </select>
                        </div>
                        <div className="flex items-center pt-6">
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                                <div className="relative">
                                    <input
                                        type="checkbox"
                                        checked={formData.showInPos}
                                        onChange={(e) => setFormData({ ...formData, showInPos: e.target.checked })}
                                        className="sr-only peer"
                                    />
                                    <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--color-primary)]"></div>
                                </div>
                                <span className="text-sm font-medium text-[var(--color-text-muted)]">Mostrar en POS</span>
                            </label>
                        </div>
                    </div>

                    <div className="flex gap-3 justify-end pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 rounded-lg hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            className="btn-primary py-2 px-6"
                        >
                            Guardar
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default Categories;
