import React, { useState } from 'react';
import { Search, Plus, Edit, Trash2, User, Phone, Mail, MapPin, X, Check, CreditCard, FileText } from 'lucide-react';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

const ClientModal = ({ isOpen, onClose, client, onSubmit }) => {
    const [formData, setFormData] = useState({
        name: client?.name || '',
        rut: client?.rut || '',
        phone: client?.phone || '',
        email: client?.email || '',
        address: client?.address || ''
    });

    React.useEffect(() => {
        if (client) {
            setFormData({
                name: client.name || '',
                rut: client.rut || '',
                phone: client.phone || '',
                email: client.email || '',
                address: client.address || ''
            });
        } else {
            setFormData({ name: '', rut: '', phone: '', email: '', address: '' });
        }
    }, [client, isOpen]);

    if (!isOpen) return null;

    const handleSubmit = (e) => {
        e.preventDefault();
        onSubmit(formData);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="glass-card w-full max-w-lg p-6 relative"
            >
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                >
                    <X size={20} />
                </button>

                <h2 className="text-2xl font-bold text-[var(--color-text)] mb-6 flex items-center gap-2">
                    {client ? <Edit className="text-[var(--color-primary)]" /> : <Plus className="text-[var(--color-primary)]" />}
                    {client ? 'Editar Cliente' : 'Nuevo Cliente'}
                </h2>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-[var(--color-text-muted)]">Nombre *</label>
                        <div className="relative">
                            <User className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" size={18} />
                            <input
                                type="text"
                                required
                                className="glass-input !pl-10 w-full"
                                value={formData.name}
                                onChange={e => setFormData({ ...formData, name: e.target.value })}
                                placeholder="Nombre completo"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-[var(--color-text-muted)]">RUT / DNI</label>
                            <div className="relative">
                                <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" size={18} />
                                <input
                                    type="text"
                                    className="glass-input !pl-10 w-full"
                                    value={formData.rut}
                                    onChange={e => setFormData({ ...formData, rut: e.target.value })}
                                    placeholder="ID fiscal"
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-[var(--color-text-muted)]">Teléfono</label>
                            <div className="relative">
                                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" size={18} />
                                <input
                                    type="text"
                                    className="glass-input !pl-10 w-full"
                                    value={formData.phone}
                                    onChange={e => setFormData({ ...formData, phone: e.target.value })}
                                    placeholder="+56 9..."
                                />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-[var(--color-text-muted)]">Email</label>
                        <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" size={18} />
                            <input
                                type="email"
                                className="glass-input !pl-10 w-full"
                                value={formData.email}
                                onChange={e => setFormData({ ...formData, email: e.target.value })}
                                placeholder="contacto@ejemplo.com"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-[var(--color-text-muted)]">Dirección</label>
                        <div className="relative">
                            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" size={18} />
                            <input
                                type="text"
                                className="glass-input !pl-10 w-full"
                                value={formData.address}
                                onChange={e => setFormData({ ...formData, address: e.target.value })}
                                placeholder="Calle, Número, Ciudad"
                            />
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 rounded-lg hover:bg-white/5 text-[var(--color-text-muted)] transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            className="btn-primary px-6 py-2 rounded-lg flex items-center gap-2 font-bold"
                        >
                            <Check size={18} />
                            {client ? 'Guardar Cambios' : 'Crear Cliente'}
                        </button>
                    </div>
                </form>
            </motion.div>
        </div>
    );
};

import ClientAccountDetails from '../components/ClientAccountDetails';

const Clients = () => {
    const { clients, addClient, updateClient, deleteClient } = useStore();
    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingClient, setEditingClient] = useState(null);

    // Account View State
    const [selectedAccountClient, setSelectedAccountClient] = useState(null);

    const filteredClients = clients.filter(client =>
        client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (client.rut && client.rut.includes(searchTerm))
    );

    const handleSubmit = async (data) => {
        if (editingClient) {
            await updateClient(editingClient.id, data);
        } else {
            await addClient(data);
        }
        setIsModalOpen(false);
        setEditingClient(null);
    };

    const handleEdit = (client) => {
        setEditingClient(client);
        setIsModalOpen(true);
    };

    const handleViewAccount = (client) => {
        setSelectedAccountClient(client);
    };

    const handleBackToClients = () => {
        setSelectedAccountClient(null);
    };

    const handleDelete = async (id) => {
        if (window.confirm('¿Estás seguro de eliminar este cliente?')) {
            await deleteClient(id);
        }
    };

    // If Account View is active, show it instead of the list
    if (selectedAccountClient) {
        return (
            <div className="h-full p-6 overflow-hidden">
                <ClientAccountDetails
                    client={selectedAccountClient}
                    onBack={handleBackToClients}
                />
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col gap-6 p-6 overflow-hidden">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0">
                <div>
                    <h1 className="text-3xl font-bold text-[var(--color-text)] neon-text mb-2">Gestión de Clientes</h1>
                    <p className="text-[var(--color-text-muted)]">Administra tu base de datos de clientes.</p>
                </div>

                <div className="flex gap-4 w-full md:w-auto">
                    <div className="relative flex-1 md:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" size={20} />
                        <input
                            type="text"
                            placeholder="Buscar por nombre o RUT..."
                            className="glass-input !pl-10 w-full"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <button
                        onClick={() => {
                            setEditingClient(null);
                            setIsModalOpen(true);
                        }}
                        className="btn-primary flex items-center gap-2 px-4 py-2 rounded-xl whitespace-nowrap"
                    >
                        <Plus size={20} />
                        Nuevo Cliente
                    </button>
                </div>
            </div>

            <div className="flex-1 glass-card p-0 overflow-hidden flex flex-col">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-black/20 border-b border-[var(--glass-border)]">
                            <tr>
                                <th className="text-left p-4 text-[var(--color-text-muted)] font-medium">Cliente</th>
                                <th className="text-left p-4 text-[var(--color-text-muted)] font-medium">Contacto</th>
                                <th className="text-left p-4 text-[var(--color-text-muted)] font-medium">Ubicación</th>
                                <th className="text-right p-4 text-[var(--color-text-muted)] font-medium">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--glass-border)]">
                            {filteredClients.map((client) => (
                                <tr key={client.id} className="hover:bg-white/5 transition-colors group">
                                    <td className="p-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center text-[var(--color-primary)] font-bold">
                                                {client.name.charAt(0).toUpperCase()}
                                            </div>
                                            <div>
                                                <div className="font-medium text-[var(--color-text)]">{client.name}</div>
                                                <div className="text-xs text-[var(--color-text-muted)]">{client.rut || 'Sin RUT'}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <div className="space-y-1">
                                            {client.phone && (
                                                <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                                                    <Phone size={14} />
                                                    {client.phone}
                                                </div>
                                            )}
                                            {client.email && (
                                                <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                                                    <Mail size={14} />
                                                    {client.email}
                                                </div>
                                            )}
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        {client.address && (
                                            <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] max-w-[200px] truncate">
                                                <MapPin size={14} className="shrink-0" />
                                                <span className="truncate">{client.address}</span>
                                            </div>
                                        )}
                                    </td>
                                    <td className="p-4 text-right">
                                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => handleViewAccount(client)}
                                                className="p-2 hover:bg-yellow-500/20 text-[var(--color-text-muted)] hover:text-yellow-400 rounded-lg transition-colors flex items-center gap-2"
                                                title="Ver Cuenta"
                                            >
                                                <FileText size={18} />
                                                <span className="text-xs font-bold hidden md:inline">Cuenta</span>
                                            </button>
                                            <button
                                                onClick={() => handleEdit(client)}
                                                className="p-2 hover:bg-[var(--color-primary)]/20 text-[var(--color-text-muted)] hover:text-[var(--color-primary)] rounded-lg transition-colors"
                                                title="Editar"
                                            >
                                                <Edit size={18} />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(client.id)}
                                                className="p-2 hover:bg-red-500/20 text-[var(--color-text-muted)] hover:text-red-400 rounded-lg transition-colors"
                                                title="Eliminar"
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {filteredClients.length === 0 && (
                                <tr>
                                    <td colSpan="4" className="p-8 text-center text-[var(--color-text-muted)]">
                                        No se encontraron clientes.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <ClientModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                client={editingClient}
                onSubmit={handleSubmit}
            />
        </div>
    );
};

export default Clients;
