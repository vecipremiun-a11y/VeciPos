import React, { useState } from 'react';
import { Plus, Edit, Trash2, X } from 'lucide-react';
import { useStore } from '../store/useStore';

const Categories = () => {
    const { categories, addCategory, updateCategory, deleteCategory } = useStore();
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
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-white neon-text">Categorías</h1>
                    <p className="text-gray-400">Gestiona las categorías de tus productos</p>
                </div>
                <button onClick={handleNewCategory} className="btn-primary flex items-center gap-2">
                    <Plus size={20} /> Nueva Categoría
                </button>
            </div>

            {/* Table */}
            <div className="glass-card overflow-hidden p-0">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-white/5 text-gray-300 uppercase text-sm font-semibold">
                            <tr>
                                <th className="px-6 py-5">Nombre</th>
                                <th className="px-6 py-5">Color</th>
                                <th className="px-6 py-5">Estado</th>
                                <th className="px-6 py-5 text-center">POS</th>
                                <th className="px-6 py-5 text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {categories.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="text-center py-10 text-gray-500">
                                        No hay categorías registradas.
                                    </td>
                                </tr>
                            ) : (
                                categories.map((category) => (
                                    <tr key={category.id} className="hover:bg-white/5 transition-colors group">
                                        <td className="px-6 py-5 font-medium text-white text-lg">{category.name}</td>
                                        <td className="px-6 py-5">
                                            <div
                                                className="w-8 h-8 rounded-full border border-white/20 shadow-sm"
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
                                                <button
                                                    onClick={() => handleEdit(category)}
                                                    className="p-3 hover:bg-white/10 rounded-lg text-blue-400 transition-colors"
                                                >
                                                    <Edit size={20} />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(category.id)}
                                                    className="p-3 hover:bg-white/10 rounded-lg text-red-400 transition-colors"
                                                >
                                                    <Trash2 size={20} />
                                                </button>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="glass-card w-full max-w-md relative animate-[float_0.3s_ease-out]">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
                >
                    <X size={24} />
                </button>

                <h2 className="text-2xl font-bold mb-6 neon-text border-b border-white/10 pb-4">
                    {categoryToEdit ? 'Editar Categoría' : 'Nueva Categoría'}
                </h2>

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label className="block text-sm text-gray-400 mb-1">Nombre</label>
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
                        <label className="block text-sm text-gray-400 mb-1">Color Identificador</label>
                        <div className="flex gap-4 items-center">
                            <input
                                type="color"
                                value={formData.color}
                                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                                className="h-10 w-20 bg-transparent border border-white/20 rounded cursor-pointer"
                            />
                            <span className="text-gray-400 text-sm font-mono">{formData.color}</span>
                        </div>
                    </div>

                    <div className="flex gap-4">
                        <div className="flex-1">
                            <label className="block text-sm text-gray-400 mb-1">Estado</label>
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
                                <span className="text-sm font-medium text-gray-300">Mostrar en POS</span>
                            </label>
                        </div>
                    </div>

                    <div className="flex gap-3 justify-end pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 rounded-lg hover:bg-white/10 text-white transition-colors"
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
