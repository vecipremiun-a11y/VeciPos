import React, { useState } from 'react';
import { Plus, Edit, Trash2, X, Phone, Mail } from 'lucide-react';
import { useStore } from '../store/useStore';

const Suppliers = () => {
    const { suppliers, addSupplier, updateSupplier, deleteSupplier } = useStore();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState(null);

    const handleEdit = (supplier) => {
        setEditingSupplier(supplier);
        setIsModalOpen(true);
    };

    const handleDelete = (id) => {
        if (window.confirm('¿Estás seguro de eliminar este proveedor?')) {
            deleteSupplier(id);
        }
    };

    const handleNewSupplier = () => {
        setEditingSupplier(null);
        setIsModalOpen(true);
    };

    const handleSave = (supplierData) => {
        if (editingSupplier) {
            updateSupplier(editingSupplier.id, supplierData);
        } else {
            addSupplier(supplierData);
        }
        setIsModalOpen(false);
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-white neon-text">Proveedores</h1>
                    <p className="text-gray-400">Gestiona tus proveedores y contactos</p>
                </div>
                <button onClick={handleNewSupplier} className="btn-primary flex items-center gap-2">
                    <Plus size={20} /> Nuevo Proveedor
                </button>
            </div>

            {/* Table */}
            <div className="glass-card overflow-hidden p-0">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-white/5 text-gray-300 uppercase text-sm font-semibold">
                            <tr>
                                <th className="px-6 py-5">Nombre</th>
                                <th className="px-6 py-5">Teléfono</th>
                                <th className="px-6 py-5">Email</th>
                                <th className="px-6 py-5">Estado</th>
                                <th className="px-6 py-5 text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {suppliers.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="text-center py-10 text-gray-500">
                                        No hay proveedores registrados.
                                    </td>
                                </tr>
                            ) : (
                                suppliers.map((supplier) => (
                                    <tr key={supplier.id} className="hover:bg-white/5 transition-colors group">
                                        <td className="px-6 py-5 font-medium text-white text-lg">{supplier.name}</td>
                                        <td className="px-6 py-5 text-gray-400">{supplier.phone || '-'}</td>
                                        <td className="px-6 py-5 text-gray-400">{supplier.email || '-'}</td>
                                        <td className="px-6 py-5">
                                            <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${supplier.status === 'active'
                                                    ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                                                    : 'bg-red-500/10 text-red-400 border border-red-500/20'
                                                }`}>
                                                {supplier.status === 'active' ? 'Activo' : 'Inactivo'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-5 text-right">
                                            <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => handleEdit(supplier)}
                                                    className="p-3 hover:bg-white/10 rounded-lg text-blue-400 transition-colors"
                                                >
                                                    <Edit size={20} />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(supplier.id)}
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

            <SupplierModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSave={handleSave}
                supplierToEdit={editingSupplier}
            />
        </div>
    );
};

const SupplierModal = ({ isOpen, onClose, onSave, supplierToEdit }) => {
    const [formData, setFormData] = useState({
        name: '',
        phone: '',
        email: '',
        status: 'active'
    });

    React.useEffect(() => {
        if (supplierToEdit) {
            setFormData(supplierToEdit);
        } else {
            setFormData({ name: '', phone: '', email: '', status: 'active' });
        }
    }, [supplierToEdit, isOpen]);

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
                    {supplierToEdit ? 'Editar Proveedor' : 'Nuevo Proveedor'}
                </h2>

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label className="block text-sm text-gray-400 mb-1">Nombre Empresa / Proveedor</label>
                        <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            className="glass-input w-full"
                            required
                            placeholder="Ej. Distribuidora Central"
                        />
                    </div>

                    <div>
                        <label className="block text-sm text-gray-400 mb-1">Teléfono</label>
                        <div className="relative">
                            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                            <input
                                type="tel"
                                value={formData.phone}
                                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                className="glass-input w-full pl-10"
                                placeholder="+56 9 1234 5678"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm text-gray-400 mb-1">Email</label>
                        <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                            <input
                                type="email"
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                className="glass-input w-full pl-10"
                                placeholder="contacto@proveedor.com"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm text-gray-400 mb-1">Estado</label>
                        <select
                            value={formData.status}
                            onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                            className="glass-input w-full"
                        >
                            <option value="active" className="bg-gray-900">Activo</option>
                            <option value="inactive" className="bg-gray-900">Inactivo</option>
                        </select>
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

export default Suppliers;
