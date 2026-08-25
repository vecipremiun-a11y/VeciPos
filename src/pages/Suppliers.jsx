import React, { useState } from 'react';
import { Plus, Edit, Trash2, X, Phone, Mail, Search } from 'lucide-react';
import { useStore } from '../store/useStore';
import { usePermissions } from '../hooks/usePermissions';

// Sin tildes y en minúsculas: escribir "munoz" tiene que encontrar "Muñoz".
const normalizar = (txt) => String(txt ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const Suppliers = () => {
    const { suppliers, addSupplier, updateSupplier, deleteSupplier } = useStore();
    const { can } = usePermissions();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');

    // Busca por nombre, teléfono o email: el proveedor se puede tener anotado de
    // cualquiera de las tres formas.
    const termino = normalizar(searchTerm.trim());
    const proveedoresFiltrados = termino
        ? suppliers.filter((supplier) =>
            normalizar(supplier.name).includes(termino) ||
            normalizar(supplier.phone).includes(termino) ||
            normalizar(supplier.email).includes(termino))
        : suppliers;

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

    const handleSave = async (supplierData) => {
        let result;
        if (editingSupplier) {
            console.log("Updating supplier:", editingSupplier.id, supplierData);
            result = await updateSupplier(editingSupplier.id, supplierData);
        } else {
            console.log("Adding supplier:", supplierData);
            result = await addSupplier(supplierData);
        }

        console.log("Save result:", result);

        if (result.success) {
            setIsModalOpen(false);
        } else {
            alert("Error al guardar: " + result.error);
        }
    };

    return (
        <div className="space-y-6">
            {/* Header - Compact on Mobile */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 md:gap-4">
                <div>
                    <h1 className="text-xl lg:text-3xl font-bold text-[var(--color-text)] neon-text">Proveedores</h1>
                    <p className="text-xs lg:text-base text-[var(--color-text-muted)]">
                        {termino
                            ? `${proveedoresFiltrados.length} de ${suppliers.length} proveedores`
                            : 'Gestiona tus proveedores y contactos'}
                    </p>
                </div>

                <div className="flex gap-2 lg:gap-4 w-full md:w-auto shrink-0">
                    <div className="relative flex-1 md:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar proveedor..."
                            className="glass-input !pl-10 !pr-9 w-full text-sm"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        {searchTerm && (
                            <button
                                onClick={() => setSearchTerm('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                                aria-label="Limpiar búsqueda"
                            >
                                <X size={16} />
                            </button>
                        )}
                    </div>
                    {can('suppliers.create') && (
                        <button onClick={handleNewSupplier} className="btn-primary flex items-center gap-2 text-sm lg:text-base px-3 lg:px-4 py-2 whitespace-nowrap">
                            <Plus size={18} /> <span className="hidden sm:inline">Nuevo Proveedor</span>
                        </button>
                    )}
                </div>
            </div>

            {/* Suppliers List - Compact rows on Mobile, Table on Desktop */}
            <div className="glass-card overflow-hidden p-0">
                {/* Mobile View - Compact Rows */}
                <div className="lg:hidden">
                    {/* Mobile Header */}
                    <div className="bg-[var(--glass-bg)] text-[var(--color-text-muted)] uppercase text-[10px] font-bold px-3 py-3">
                        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center">
                            <div>NOMBRE</div>
                            <div className="w-16 text-center">TELÉFONO</div>
                            <div className="w-16 text-center">ESTADO</div>
                            <div className="w-12 text-center">ACCIONES</div>
                        </div>
                    </div>

                    {/* Mobile Rows */}
                    <div className="divide-y divide-[var(--glass-border)] pb-20">
                        {proveedoresFiltrados.length === 0 ? (
                            <div className="text-center py-10 text-[var(--color-text-muted)] text-sm">
                                {termino ? `Ningún proveedor coincide con "${searchTerm}".` : 'No hay proveedores registrados.'}
                            </div>
                        ) : (
                            proveedoresFiltrados.map((supplier) => (
                                <div key={supplier.id} className="px-3 py-3 hover:bg-[var(--glass-bg)] transition-colors">
                                    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center">
                                        {/* Name */}
                                        <div className="font-bold text-[var(--color-text)] text-sm truncate">
                                            {supplier.name}
                                        </div>

                                        {/* Phone */}
                                        <div className="w-16 text-center text-[var(--color-text-muted)] text-xs truncate">
                                            {supplier.phone || '-'}
                                        </div>

                                        {/* Status */}
                                        <div className="w-16 flex justify-center">
                                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${supplier.status === 'active'
                                                ? 'bg-green-500/20 text-green-400'
                                                : 'bg-red-500/20 text-red-400'
                                                }`}>
                                                {supplier.status === 'active' ? 'ACTIVA' : 'INACTIVA'}
                                            </span>
                                        </div>

                                        {/* Actions */}
                                        <div className="w-12 flex justify-center">
                                            {can('suppliers.edit') && (
                                                <button
                                                    onClick={() => handleEdit(supplier)}
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
                        <thead className="bg-[var(--glass-bg)] text-gray-300 uppercase text-sm font-semibold">
                            <tr>
                                <th className="px-6 py-5">Nombre</th>
                                <th className="px-6 py-5">Teléfono</th>
                                <th className="px-6 py-5">Email</th>
                                <th className="px-6 py-5">Estado</th>
                                <th className="px-6 py-5 text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--glass-border)]">
                            {proveedoresFiltrados.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="text-center py-10 text-[var(--color-text-muted)]">
                                        {termino ? `Ningún proveedor coincide con "${searchTerm}".` : 'No hay proveedores registrados.'}
                                    </td>
                                </tr>
                            ) : (
                                proveedoresFiltrados.map((supplier) => (
                                    <tr key={supplier.id} className="hover:bg-[var(--glass-bg)] transition-colors group">
                                        <td className="px-6 py-5 font-medium text-[var(--color-text)] text-lg">{supplier.name}</td>
                                        <td className="px-6 py-5 text-[var(--color-text-muted)]">{supplier.phone || '-'}</td>
                                        <td className="px-6 py-5 text-[var(--color-text-muted)]">{supplier.email || '-'}</td>
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
                                                {can('suppliers.edit') && (
                                                    <button
                                                        onClick={() => handleEdit(supplier)}
                                                        className="p-3 hover:bg-[var(--glass-bg)] rounded-lg text-blue-400 transition-colors"
                                                    >
                                                        <Edit size={20} />
                                                    </button>
                                                )}
                                                {can('suppliers.delete') && (
                                                    <button
                                                        onClick={() => handleDelete(supplier.id)}
                                                        className="p-3 hover:bg-[var(--glass-bg)] rounded-lg text-red-400 transition-colors"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--glass-bg)] backdrop-blur-sm p-4">
            <div className="glass-card modal-solido w-full max-w-md relative animate-[float_0.3s_ease-out]">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                >
                    <X size={24} />
                </button>

                <h2 className="text-2xl font-bold mb-6 neon-text border-b border-[var(--glass-border)] pb-4">
                    {supplierToEdit ? 'Editar Proveedor' : 'Nuevo Proveedor'}
                </h2>

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label className="block text-sm text-[var(--color-text-muted)] mb-1">Nombre Empresa / Proveedor</label>
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
                        <label className="block text-sm text-[var(--color-text-muted)] mb-1">Teléfono</label>
                        <div className="relative">
                            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" size={16} />
                            <input
                                type="tel"
                                value={formData.phone}
                                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                className="glass-input w-full !pl-10"
                                placeholder="+56 9 1234 5678"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm text-[var(--color-text-muted)] mb-1">Email</label>
                        <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" size={16} />
                            <input
                                type="email"
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                className="glass-input w-full !pl-10"
                                placeholder="contacto@proveedor.com"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm text-[var(--color-text-muted)] mb-1">Nombre del Vendedor</label>
                        <input
                            type="text"
                            value={formData.seller_name || ''}
                            onChange={(e) => setFormData({ ...formData, seller_name: e.target.value })}
                            className="glass-input w-full"
                            placeholder="Ej. Juan Pérez"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm text-[var(--color-text-muted)] mb-1">Días de Pedido</label>
                            <input
                                type="text"
                                value={formData.order_days || ''}
                                onChange={(e) => setFormData({ ...formData, order_days: e.target.value })}
                                className="glass-input w-full"
                                placeholder="Ej. Lunes, Jueves"
                            />
                        </div>
                        <div>
                            <label className="block text-sm text-[var(--color-text-muted)] mb-1">Días de Entrega</label>
                            <input
                                type="text"
                                value={formData.delivery_days || ''}
                                onChange={(e) => setFormData({ ...formData, delivery_days: e.target.value })}
                                className="glass-input w-full"
                                placeholder="Ej. Martes, Viernes"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm text-[var(--color-text-muted)] mb-1">Estado</label>
                        <select
                            value={formData.status}
                            onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                            className="glass-input w-full"
                        >
                            <option value="active" className="bg-[var(--color-surface)] dark:bg-gray-900 text-[var(--color-text)]">Activo</option>
                            <option value="inactive" className="bg-[var(--color-surface)] dark:bg-gray-900 text-[var(--color-text)]">Inactivo</option>
                        </select>
                    </div>

                    <div className="flex gap-3 justify-end pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 rounded-lg hover:bg-[var(--glass-bg)] text-[var(--color-text)] transition-colors"
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
