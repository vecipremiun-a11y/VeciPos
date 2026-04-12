import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, ScanBarcode, ShoppingCart, Clock, User, Package } from 'lucide-react';
import { useStore } from '../store/useStore';
import { formatCurrency } from '../utils/formatCurrency';

const PreventasListModal = ({ isOpen, onClose, onLoadPreventa }) => {
    const { fetchPendingPreventas, fetchPreventaByCode, currentCurrency } = useStore();
    const [preventas, setPreventas] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(false);
    const searchRef = useRef(null);

    useEffect(() => {
        if (isOpen) {
            loadPreventas();
            setTimeout(() => searchRef.current?.focus(), 100);
        } else {
            setSearchTerm('');
            setPreventas([]);
        }
    }, [isOpen]);

    const loadPreventas = async () => {
        setLoading(true);
        const data = await fetchPendingPreventas();
        setPreventas(data);
        setLoading(false);
    };

    const handleSearch = (e) => {
        setSearchTerm(e.target.value);
    };

    const handleSearchKeyDown = async (e) => {
        if (e.key === 'Enter' && searchTerm.trim()) {
            // If it looks like a preventa code (starts with PV), try direct lookup
            if (searchTerm.trim().toUpperCase().startsWith('PV')) {
                const preventa = await fetchPreventaByCode(searchTerm.trim().toUpperCase());
                if (preventa) {
                    handleSelect(preventa);
                    return;
                }
            }
        }
    };

    const handleSelect = (preventa) => {
        onLoadPreventa(preventa);
        onClose();
    };

    // Filter preventas by search term
    const filtered = preventas.filter(p => {
        if (!searchTerm.trim()) return true;
        const term = searchTerm.toLowerCase();
        const matchCode = p.code.toLowerCase().includes(term);
        const matchVendedor = (p.created_by_name || '').toLowerCase().includes(term);
        const matchItems = p.items.some(item => (item.name || '').toLowerCase().includes(term));
        return matchCode || matchVendedor || matchItems;
    });

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <div className="relative glass-card rounded-2xl w-full max-w-lg max-h-[85vh] shadow-2xl border border-[var(--glass-border)] animate-in zoom-in-95 duration-200 flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-[var(--glass-border)]">
                    <div className="flex items-center gap-2">
                        <Package size={20} className="text-purple-400" />
                        <h2 className="text-lg font-bold text-[var(--color-text)]">Preventas Pendientes</h2>
                        <span className="bg-purple-500/20 text-purple-300 text-xs font-bold px-2 py-0.5 rounded-full">
                            {filtered.length}
                        </span>
                    </div>
                    <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                        <X size={20} />
                    </button>
                </div>

                {/* Search bar */}
                <div className="p-3 border-b border-[var(--glass-border)]">
                    <div className="relative">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                        <input
                            ref={searchRef}
                            type="text"
                            value={searchTerm}
                            onChange={handleSearch}
                            onKeyDown={handleSearchKeyDown}
                            placeholder="Buscar por código, vendedor o producto... (escanear código)"
                            className="w-full pl-9 pr-10 py-2.5 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] text-sm focus:outline-none focus:border-purple-500"
                        />
                        <ScanBarcode size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-purple-400" />
                    </div>
                </div>

                {/* List */}
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {loading ? (
                        <div className="text-center py-8 text-[var(--color-text-muted)]">
                            <div className="animate-spin w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full mx-auto mb-2" />
                            Cargando...
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="text-center py-8 text-[var(--color-text-muted)]">
                            <Package size={40} className="mx-auto mb-2 opacity-40" />
                            <p>{searchTerm ? 'No se encontraron preventas' : 'No hay preventas pendientes'}</p>
                        </div>
                    ) : (
                        filtered.map(preventa => (
                            <div
                                key={preventa.id}
                                className="glass-card rounded-xl p-3 border border-[var(--glass-border)] hover:border-purple-500/50 transition-all cursor-pointer group"
                                onClick={() => handleSelect(preventa)}
                            >
                                <div className="flex justify-between items-start mb-2">
                                    <div>
                                        <span className="font-mono font-bold text-purple-400 text-sm tracking-wider">{preventa.code}</span>
                                        <div className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] mt-0.5">
                                            <User size={10} />
                                            <span>{preventa.created_by_name}</span>
                                            <span className="mx-1">·</span>
                                            <Clock size={10} />
                                            <span>{new Date(preventa.created_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</span>
                                        </div>
                                    </div>
                                    <span className="font-bold text-[var(--color-text)] text-lg">{formatCurrency(preventa.total, currentCurrency)}</span>
                                </div>

                                {/* Items preview */}
                                <div className="text-xs text-[var(--color-text-muted)] space-y-0.5">
                                    {preventa.items.slice(0, 3).map((item, i) => (
                                        <div key={i} className="flex justify-between">
                                            <span className="truncate mr-2">{item.quantity}x {item.name}</span>
                                            <span>{formatCurrency(item.price * item.quantity, currentCurrency)}</span>
                                        </div>
                                    ))}
                                    {preventa.items.length > 3 && (
                                        <div className="text-purple-400 text-xs">+{preventa.items.length - 3} más...</div>
                                    )}
                                </div>

                                {/* Load button on hover */}
                                <div className="mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <div className="bg-purple-600 text-white text-center text-xs font-bold py-1.5 rounded-lg flex items-center justify-center gap-1">
                                        <ShoppingCart size={12} />
                                        Cargar al carrito
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default PreventasListModal;
