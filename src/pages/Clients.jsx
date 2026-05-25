import React, { useState, useEffect } from 'react';
import { Search, Plus, Edit, Trash2, User, Phone, Mail, MapPin, X, Check, CreditCard, FileText, ShieldAlert, ShieldOff, Shield, AlertTriangle, Clock, DollarSign, Filter } from 'lucide-react';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';
import { usePermissions } from '../hooks/usePermissions';
import { motion, AnimatePresence } from 'framer-motion';

const ClientModal = ({ isOpen, onClose, client, onSubmit }) => {
    const [formData, setFormData] = useState({
        name: client?.name || '',
        rut: client?.rut || '',
        razon_social: client?.razon_social || '',
        giro: client?.giro || '',
        phone: client?.phone || '',
        email: client?.email || '',
        address: client?.address || '',
        comuna: client?.comuna || '',
        ciudad: client?.ciudad || '',
        credit_limit: client?.credit_limit || 0,
        credit_period_days: client?.credit_period_days || 30,
        credit_enabled: client?.credit_enabled !== undefined ? (client.credit_enabled === 1 || client.credit_enabled === true) : true,
        client_status: client?.client_status || 'active'
    });

    React.useEffect(() => {
        if (client) {
            setFormData({
                name: client.name || '',
                rut: client.rut || '',
                razon_social: client.razon_social || '',
                giro: client.giro || '',
                phone: client.phone || '',
                email: client.email || '',
                address: client.address || '',
                comuna: client.comuna || '',
                ciudad: client.ciudad || '',
                credit_limit: client.credit_limit || 0,
                credit_period_days: client.credit_period_days || 30,
                credit_enabled: client.credit_enabled === 1 || client.credit_enabled === true,
                client_status: client.client_status || 'active'
            });
        } else {
            setFormData({ name: '', rut: '', razon_social: '', giro: '', phone: '', email: '', address: '', comuna: '', ciudad: '', credit_limit: 0, credit_period_days: 30, credit_enabled: true, client_status: 'active' });
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
                                placeholder="Calle, Número"
                            />
                        </div>
                    </div>

                    {/* Datos de Facturación SII */}
                    <div className="border-t border-[var(--glass-border)] pt-4 mt-4">
                        <h3 className="text-sm font-bold text-[var(--color-text)] mb-3 flex items-center gap-2">
                            <FileText size={16} className="text-blue-400" />
                            Datos de Facturación (SII)
                        </h3>
                        <div className="space-y-3">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-[var(--color-text-muted)]">Razón Social</label>
                                <input
                                    type="text"
                                    className="glass-input w-full"
                                    value={formData.razon_social}
                                    onChange={e => setFormData({ ...formData, razon_social: e.target.value })}
                                    placeholder="Nombre legal de la empresa"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-[var(--color-text-muted)]">Giro</label>
                                <input
                                    type="text"
                                    className="glass-input w-full"
                                    value={formData.giro}
                                    onChange={e => setFormData({ ...formData, giro: e.target.value })}
                                    placeholder="Actividad económica"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-[var(--color-text-muted)]">Comuna</label>
                                    <input
                                        type="text"
                                        className="glass-input w-full"
                                        value={formData.comuna}
                                        onChange={e => setFormData({ ...formData, comuna: e.target.value })}
                                        placeholder="Comuna"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-[var(--color-text-muted)]">Ciudad</label>
                                    <input
                                        type="text"
                                        className="glass-input w-full"
                                        value={formData.ciudad}
                                        onChange={e => setFormData({ ...formData, ciudad: e.target.value })}
                                        placeholder="Ciudad"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Credit Management Section */}
                    <div className="border-t border-[var(--glass-border)] pt-4 mt-4">
                        <h3 className="text-sm font-bold text-[var(--color-text)] mb-3 flex items-center gap-2">
                            <DollarSign size={16} className="text-[var(--color-primary)]" />
                            Configuración de Crédito
                        </h3>

                        <div className="grid grid-cols-2 gap-4">
                            {/* Client Status */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-[var(--color-text-muted)]">Estado del Cliente</label>
                                <select
                                    className="glass-input w-full"
                                    value={formData.client_status}
                                    onChange={e => setFormData({ ...formData, client_status: e.target.value })}
                                >
                                    <option value="active">Activo</option>
                                    <option value="credit_blocked">Bloqueado Crédito</option>
                                    <option value="blocked">Bloqueado Total</option>
                                </select>
                            </div>

                            {/* Credit Enabled Toggle */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-[var(--color-text-muted)]">Permitir Crédito</label>
                                <button
                                    type="button"
                                    onClick={() => setFormData({ ...formData, credit_enabled: !formData.credit_enabled })}
                                    disabled={formData.client_status === 'blocked' || formData.client_status === 'credit_blocked'}
                                    className={cn(
                                        'w-full h-10 rounded-lg border transition-all flex items-center justify-center gap-2 text-sm font-medium',
                                        formData.credit_enabled && formData.client_status === 'active'
                                            ? 'bg-green-500/20 border-green-500/50 text-green-400'
                                            : 'bg-red-500/10 border-red-500/30 text-red-400',
                                        (formData.client_status === 'blocked' || formData.client_status === 'credit_blocked') && 'opacity-50 cursor-not-allowed'
                                    )}
                                >
                                    {formData.credit_enabled && formData.client_status === 'active' ? (
                                        <><Shield size={16} /> Habilitado</>
                                    ) : (
                                        <><ShieldOff size={16} /> Deshabilitado</>
                                    )}
                                </button>
                            </div>
                        </div>

                        {formData.credit_enabled && formData.client_status === 'active' && (
                            <div className="grid grid-cols-2 gap-4 mt-3">
                                {/* Credit Limit */}
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-[var(--color-text-muted)]">Límite de Crédito ($)</label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="1000"
                                        className="glass-input w-full"
                                        value={formData.credit_limit || ''}
                                        onChange={e => setFormData({ ...formData, credit_limit: parseFloat(e.target.value) || 0 })}
                                        placeholder="0 = Sin límite"
                                    />
                                </div>

                                {/* Credit Period Days */}
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-[var(--color-text-muted)]">Plazo de Pago (días)</label>
                                    <input
                                        type="number"
                                        min="1"
                                        max="365"
                                        className="glass-input w-full"
                                        value={formData.credit_period_days}
                                        onChange={e => setFormData({ ...formData, credit_period_days: parseInt(e.target.value) || 30 })}
                                        placeholder="30"
                                    />
                                </div>
                            </div>
                        )}
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
    const { can } = usePermissions();
    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingClient, setEditingClient] = useState(null);
    const [statusFilter, setStatusFilter] = useState('all'); // 'all', 'moroso', 'blocked'

    // Account View State
    const [selectedAccountClient, setSelectedAccountClient] = useState(null);

    const getClientDebtInfo = (client) => ({
        totalDebt: parseFloat(client.total_debt) || 0,
        pendingCount: parseInt(client.pending_sales_count) || 0,
        overdueCount: parseInt(client.overdue_count) || 0,
        dueSoonCount: 0,
        oldestOverdueDays: 0
    });

    const filteredClients = clients.filter(client => {
        const matchesSearch = client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (client.rut && client.rut.includes(searchTerm));
        if (!matchesSearch) return false;

        if (statusFilter === 'moroso') {
            return (parseInt(client.overdue_count) || 0) > 0;
        }
        if (statusFilter === 'blocked') {
            return client.client_status === 'blocked' || client.client_status === 'credit_blocked';
        }
        return true;
    });

    const handleSubmit = async (data) => {
        const result = editingClient
            ? await updateClient(editingClient.id, data)
            : await addClient(data);

        // Bloqueo por RUT/correo duplicado: no cerrar el modal, avisar al usuario.
        if (result && result.success === false) {
            if (result.error === 'RUT_DUPLICATE') {
                alert(result.message || 'Ya existe un cliente con ese RUT.');
            } else if (result.error === 'EMAIL_DUPLICATE') {
                alert(result.message || 'Ya existe un cliente con ese correo.');
            } else if (result.error) {
                alert('Error: ' + (result.message || result.error));
            }
            return; // mantener el modal abierto para corregir
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
        <div className="h-full flex flex-col gap-4 lg:gap-6 p-4 lg:p-6 overflow-hidden">
            {/* Header - Compact on Mobile */}
            <div className="shrink-0">
                <h1 className="text-xl lg:text-3xl font-bold text-[var(--color-text)] mb-1">Gestión de Clientes</h1>
                <p className="text-sm lg:text-base text-[var(--color-text-muted)]">Administra tu base de datos de clientes.</p>
            </div>

            {/* Search & Add Button - Side by Side */}
            <div className="flex gap-2 lg:gap-4 shrink-0">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" size={18} />
                    <input
                        type="text"
                        placeholder="Buscar por nombre o RUT..."
                        className="glass-input !pl-10 w-full text-sm"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                {can('clients.create') && (
                    <button
                        onClick={() => {
                            setEditingClient(null);
                            setIsModalOpen(true);
                        }}
                        className="btn-primary flex items-center gap-2 px-3 lg:px-4 py-2 rounded-xl whitespace-nowrap text-sm lg:text-base"
                    >
                        <Plus size={18} />
                        <span className="hidden sm:inline">Nuevo Cliente</span>
                    </button>
                )}
            </div>

            {/* Filter Buttons */}
            <div className="flex gap-2 shrink-0 flex-wrap">
                <button
                    onClick={() => setStatusFilter('all')}
                    className={cn(
                        'px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
                        statusFilter === 'all'
                            ? 'bg-[var(--color-primary)]/20 border-[var(--color-primary)]/50 text-[var(--color-primary)]'
                            : 'border-[var(--glass-border)] text-[var(--color-text-muted)] hover:bg-white/5'
                    )}
                >
                    Todos ({clients.length})
                </button>
                <button
                    onClick={() => setStatusFilter('moroso')}
                    className={cn(
                        'px-3 py-1.5 rounded-lg text-xs font-medium transition-all border flex items-center gap-1',
                        statusFilter === 'moroso'
                            ? 'bg-red-500/20 border-red-500/50 text-red-400'
                            : 'border-[var(--glass-border)] text-[var(--color-text-muted)] hover:bg-white/5'
                    )}
                >
                    <AlertTriangle size={14} />
                    Morosos ({clients.filter(c => (parseInt(c.overdue_count) || 0) > 0).length})
                </button>
                <button
                    onClick={() => setStatusFilter('blocked')}
                    className={cn(
                        'px-3 py-1.5 rounded-lg text-xs font-medium transition-all border flex items-center gap-1',
                        statusFilter === 'blocked'
                            ? 'bg-orange-500/20 border-orange-500/50 text-orange-400'
                            : 'border-[var(--glass-border)] text-[var(--color-text-muted)] hover:bg-white/5'
                    )}
                >
                    <ShieldAlert size={14} />
                    Bloqueados ({clients.filter(c => c.client_status === 'blocked' || c.client_status === 'credit_blocked').length})
                </button>
            </div>

            {/* Client List - Cards on Mobile, Table on Desktop */}
            <div className="flex-1 overflow-hidden">
                {/* Mobile Cards View */}
                <div className="lg:hidden h-full overflow-y-auto space-y-3 pb-20">
                    {filteredClients.map((client) => {
                        const debtInfo = getClientDebtInfo(client);
                        return (
                        <div
                            key={client.id}
                            className={cn(
                                "glass-card p-4 space-y-3",
                                client.client_status === 'blocked' && 'border-red-500/30',
                                client.client_status === 'credit_blocked' && 'border-orange-500/30'
                            )}
                            onClick={() => {
                                if (can('clients.view_account')) {
                                    handleViewAccount(client)
                                }
                            }}
                        >
                            {/* Header: Avatar + Name/RUT */}
                            <div className="flex items-center gap-3">
                                <div className={cn(
                                    "w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg",
                                    client.client_status === 'blocked' ? 'bg-red-500/20 text-red-400' :
                                    client.client_status === 'credit_blocked' ? 'bg-orange-500/20 text-orange-400' :
                                    'bg-[var(--color-primary)]/20 text-[var(--color-primary)]'
                                )}>
                                    {client.name.charAt(0).toUpperCase()}
                                </div>
                                <div className="flex-1">
                                    <div className="font-bold text-[var(--color-text)] text-base flex items-center gap-2">
                                        {client.name}
                                        {client.client_status === 'blocked' && <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">Bloqueado</span>}
                                        {client.client_status === 'credit_blocked' && <span className="text-xs px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400">Sin Crédito</span>}
                                    </div>
                                    <div className="text-sm text-[var(--color-text-muted)]">{client.rut || 'Sin RUT'}</div>
                                </div>
                                {/* Quick Actions */}
                                <div className="flex gap-1">
                                    {can('clients.edit') && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleEdit(client);
                                            }}
                                            className="p-2 hover:bg-[var(--color-primary)]/20 text-[var(--color-text-muted)] hover:text-[var(--color-primary)] rounded-lg transition-colors"
                                        >
                                            <Edit size={16} />
                                        </button>
                                    )}
                                    {can('clients.delete') && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDelete(client.id);
                                            }}
                                            className="p-2 hover:bg-red-500/20 text-[var(--color-text-muted)] hover:text-red-400 rounded-lg transition-colors"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Contact Details */}
                            <div className="space-y-1.5 pl-1">
                                {client.phone && (
                                    <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                                        <Phone size={14} className="text-[var(--color-primary)]" />
                                        {client.phone}
                                    </div>
                                )}
                                {client.email && (
                                    <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                                        <Mail size={14} className="text-[var(--color-primary)]" />
                                        {client.email}
                                    </div>
                                )}
                                {client.address && (
                                    <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                                        <MapPin size={14} className="text-[var(--color-primary)]" />
                                        <span className="truncate">{client.address}</span>
                                    </div>
                                )}
                            </div>
                            {/* Debt & Status Indicators */}
                            {(debtInfo.totalDebt > 0 || debtInfo.overdueCount > 0) && (
                                <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-[var(--glass-border)]">
                                    {debtInfo.totalDebt > 0 && (
                                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 font-medium">
                                            Deuda: ${debtInfo.totalDebt.toLocaleString()}
                                        </span>
                                    )}
                                    {debtInfo.overdueCount > 0 && (
                                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 font-bold flex items-center gap-1">
                                            <AlertTriangle size={12} /> Moroso ({debtInfo.oldestOverdueDays}d)
                                        </span>
                                    )}
                                    {debtInfo.overdueCount === 0 && debtInfo.dueSoonCount > 0 && (
                                        <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 font-medium flex items-center gap-1">
                                            <Clock size={12} /> Por vencer
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                    })}
                    {filteredClients.length === 0 && (
                        <div className="text-center py-12 text-[var(--color-text-muted)]">
                            No se encontraron clientes.
                        </div>
                    )}
                </div>

                {/* Desktop Table View */}
                <div className="hidden lg:block h-full glass-card p-0 overflow-hidden">
                    <div className="overflow-x-auto h-full">
                        <table className="w-full">
                            <thead className="bg-black/20 border-b border-[var(--glass-border)] sticky top-0">
                                <tr>
                                    <th className="text-left p-4 text-[var(--color-text-muted)] font-medium">Cliente</th>
                                    <th className="text-left p-4 text-[var(--color-text-muted)] font-medium">Estado</th>
                                    <th className="text-left p-4 text-[var(--color-text-muted)] font-medium">Deuda</th>
                                    <th className="text-left p-4 text-[var(--color-text-muted)] font-medium">Contacto</th>
                                    <th className="text-right p-4 text-[var(--color-text-muted)] font-medium">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--glass-border)]">
                                {filteredClients.map((client) => {
                                    const debtInfo = getClientDebtInfo(client);
                                    return (
                                    <tr key={client.id} className={cn("hover:bg-white/5 transition-colors group", client.client_status === 'blocked' && 'bg-red-500/5')}>
                                        <td className="p-4">
                                            <div className="flex items-center gap-3">
                                                <div className={cn(
                                                    "w-10 h-10 rounded-full flex items-center justify-center font-bold",
                                                    client.client_status === 'blocked' ? 'bg-red-500/10 text-red-400' :
                                                    client.client_status === 'credit_blocked' ? 'bg-orange-500/10 text-orange-400' :
                                                    'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                                                )}>
                                                    {client.name.charAt(0).toUpperCase()}
                                                </div>
                                                <div>
                                                    <div className="font-medium text-[var(--color-text)]">{client.name}</div>
                                                    <div className="text-xs text-[var(--color-text-muted)]">{client.rut || 'Sin RUT'}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex flex-col gap-1">
                                                {client.client_status === 'blocked' && (
                                                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 font-bold w-fit">
                                                        <ShieldAlert size={12} /> Bloqueado
                                                    </span>
                                                )}
                                                {client.client_status === 'credit_blocked' && (
                                                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 font-medium w-fit">
                                                        <ShieldOff size={12} /> Sin Crédito
                                                    </span>
                                                )}
                                                {client.client_status === 'active' && !client.credit_enabled && (
                                                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400 font-medium w-fit">
                                                        <ShieldOff size={12} /> Crédito OFF
                                                    </span>
                                                )}
                                                {client.client_status === 'active' && (client.credit_enabled === 1 || client.credit_enabled === true) && (
                                                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 w-fit">
                                                        <Shield size={12} /> Activo
                                                    </span>
                                                )}
                                                {debtInfo.overdueCount > 0 && (
                                                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 font-bold w-fit animate-pulse">
                                                        <AlertTriangle size={12} /> Moroso ({debtInfo.oldestOverdueDays}d)
                                                    </span>
                                                )}
                                                {debtInfo.overdueCount === 0 && debtInfo.dueSoonCount > 0 && (
                                                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 w-fit">
                                                        <Clock size={12} /> Por vencer
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <div className="space-y-1">
                                                {debtInfo.totalDebt > 0 ? (
                                                    <div className="text-sm font-bold text-red-400">
                                                        ${debtInfo.totalDebt.toLocaleString()}
                                                    </div>
                                                ) : (
                                                    <div className="text-sm text-green-400">Sin deuda</div>
                                                )}
                                                {client.credit_limit > 0 && (
                                                    <div className="text-xs text-[var(--color-text-muted)]">
                                                        Límite: ${parseFloat(client.credit_limit).toLocaleString()}
                                                    </div>
                                                )}
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
                                        <td className="p-4 text-right">
                                            <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                {can('clients.view_account') && (
                                                    <button
                                                        onClick={() => handleViewAccount(client)}
                                                        className="p-2 hover:bg-yellow-500/20 text-[var(--color-text-muted)] hover:text-yellow-400 rounded-lg transition-colors flex items-center gap-2"
                                                        title="Ver Cuenta"
                                                    >
                                                        <FileText size={18} />
                                                        <span className="text-xs font-bold">Cuenta</span>
                                                    </button>
                                                )}
                                                {can('clients.edit') && (
                                                    <button
                                                        onClick={() => handleEdit(client)}
                                                        className="p-2 hover:bg-[var(--color-primary)]/20 text-[var(--color-text-muted)] hover:text-[var(--color-primary)] rounded-lg transition-colors"
                                                        title="Editar"
                                                    >
                                                        <Edit size={18} />
                                                    </button>
                                                )}
                                                {can('clients.delete') && (
                                                    <button
                                                        onClick={() => handleDelete(client.id)}
                                                        className="p-2 hover:bg-red-500/20 text-[var(--color-text-muted)] hover:text-red-400 rounded-lg transition-colors"
                                                        title="Eliminar"
                                                    >
                                                        <Trash2 size={18} />
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                    );
                                })}
                                {filteredClients.length === 0 && (
                                    <tr>
                                        <td colSpan="6" className="p-8 text-center text-[var(--color-text-muted)]">
                                            No se encontraron clientes.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
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
