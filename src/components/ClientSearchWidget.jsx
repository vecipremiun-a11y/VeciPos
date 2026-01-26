import React, { useState, useEffect, useRef } from 'react';
import { Search, UserPlus, X, User, Check } from 'lucide-react';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';

const ClientSearchWidget = () => {
    const { clients, posSelectedClient, setPosSelectedClient, addClient } = useStore();
    const [searchTerm, setSearchTerm] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const wrapperRef = useRef(null);

    // New Client Form State
    const [newClientData, setNewClientData] = useState({
        name: '',
        rut: '',
        phone: '',
        email: '',
        address: ''
    });

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const filteredClients = searchTerm.length > 0
        ? clients.filter(c =>
            c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (c.rut && c.rut.includes(searchTerm))
        ).slice(0, 5)
        : [];

    const handleSelectClient = (client) => {
        setPosSelectedClient(client);
        setSearchTerm('');
        setIsOpen(false);
    };

    const handleClearClient = () => {
        setPosSelectedClient(null);
        setSearchTerm('');
    };

    const handleAddClientSubmit = async (e) => {
        e.preventDefault();
        if (!newClientData.name) return;

        const result = await addClient(newClientData);
        if (result.success) {
            handleSelectClient(result.client);
            setIsAddModalOpen(false);
            setNewClientData({ name: '', rut: '', phone: '', email: '', address: '' });
        } else {
            alert('Error al crear cliente');
        }
    };

    return (
        <div className="relative w-full" ref={wrapperRef}>
            {posSelectedClient ? (
                <div className="flex items-center justify-between bg-[var(--color-primary)]/10 border border-[var(--color-primary)] rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2 overflow-hidden">
                        <User size={18} className="text-[var(--color-primary)] shrink-0" />
                        <div className="flex flex-col truncate">
                            <span className="text-[var(--color-text)] font-medium text-sm truncate">{posSelectedClient.name}</span>
                            {posSelectedClient.rut && <span className="text-[var(--color-text-muted)] text-xs">{posSelectedClient.rut}</span>}
                        </div>
                    </div>
                    <button
                        onClick={handleClearClient}
                        className="text-[var(--color-text-muted)] hover:text-red-400 p-1 rounded-full hover:bg-[var(--glass-bg)] transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>
            ) : (
                <div className="relative">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" size={16} />
                        <input
                            type="text"
                            placeholder="Buscar cliente..."
                            className="glass-input !pl-9 !pr-20 w-full text-sm py-2"
                            value={searchTerm}
                            onChange={(e) => {
                                setSearchTerm(e.target.value);
                                setIsOpen(true);
                            }}
                            onFocus={() => setIsOpen(true)}
                        />
                        <button
                            onClick={() => setIsAddModalOpen(true)}
                            className="absolute right-1 top-1/2 -translate-y-1/2 bg-[var(--color-primary)] text-black text-xs font-bold px-2 py-1 rounded hover:opacity-90 transition-opacity flex items-center gap-1"
                        >
                            <UserPlus size={14} />
                            Agregar
                        </button>
                    </div>

                    {/* Dropdown Results */}
                    {isOpen && searchTerm.length > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-[#18181b] border border-[var(--glass-border)] shadow-xl z-[100] rounded-lg overflow-hidden max-h-60 overflow-y-auto">
                            {filteredClients.length > 0 ? (
                                filteredClients.map(client => (
                                    <button
                                        key={client.id}
                                        onClick={() => handleSelectClient(client)}
                                        className="w-full text-left px-4 py-3 hover:bg-[var(--color-primary)] hover:text-black transition-colors flex items-center justify-between group border-b border-white/5 last:border-0"
                                    >
                                        <div>
                                            <p className="font-bold text-sm text-white group-hover:text-black transition-colors">{client.name}</p>
                                            <p className="text-xs text-gray-400 group-hover:text-black/70 transition-colors">{client.rut}</p>
                                        </div>
                                    </button>
                                ))
                            ) : (
                                <div className="p-3 text-center text-xs text-[var(--color-text-muted)]">
                                    No se encontraron clientes.
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Add Client Modal */}
            {isAddModalOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="glass-card w-full max-w-md p-6 relative animate-in fade-in zoom-in duration-200">
                        <button
                            onClick={() => setIsAddModalOpen(false)}
                            className="absolute top-4 right-4 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                        >
                            <X size={20} />
                        </button>

                        <h3 className="text-xl font-bold text-[var(--color-text)] mb-4 flex items-center gap-2">
                            <UserPlus className="text-[var(--color-primary)]" />
                            Nuevo Cliente
                        </h3>

                        <form onSubmit={handleAddClientSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-[var(--color-text-muted)]">Nombre *</label>
                                <input
                                    type="text"
                                    required
                                    className="glass-input w-full"
                                    value={newClientData.name}
                                    onChange={e => setNewClientData({ ...newClientData, name: e.target.value })}
                                    placeholder="Nombre completo"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-[var(--color-text-muted)]">RUT / DNI</label>
                                    <input
                                        type="text"
                                        className="glass-input w-full"
                                        value={newClientData.rut}
                                        onChange={e => setNewClientData({ ...newClientData, rut: e.target.value })}
                                        placeholder="12.345.678-9"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-[var(--color-text-muted)]">Teléfono</label>
                                    <input
                                        type="text"
                                        className="glass-input w-full"
                                        value={newClientData.phone}
                                        onChange={e => setNewClientData({ ...newClientData, phone: e.target.value })}
                                        placeholder="+56 9..."
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-[var(--color-text-muted)]">Email</label>
                                <input
                                    type="email"
                                    className="glass-input w-full"
                                    value={newClientData.email}
                                    onChange={e => setNewClientData({ ...newClientData, email: e.target.value })}
                                    placeholder="cliente@ejemplo.com"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-[var(--color-text-muted)]">Dirección</label>
                                <input
                                    type="text"
                                    className="glass-input w-full"
                                    value={newClientData.address}
                                    onChange={e => setNewClientData({ ...newClientData, address: e.target.value })}
                                    placeholder="Dirección..."
                                />
                            </div>

                            <button
                                type="submit"
                                className="w-full btn-primary py-3 rounded-xl mt-2 flex items-center justify-center gap-2 font-bold"
                            >
                                <Check size={18} />
                                Guardar Cliente
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ClientSearchWidget;
