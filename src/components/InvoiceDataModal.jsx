import React, { useState, useEffect, useMemo } from 'react';
import { X, Search, FileText, Receipt, UserCheck, Save, CreditCard, Banknote, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { useStore } from '../store/useStore';
import { validateRut, formatRut, cleanRut } from '../utils/rutValidation';

const InvoiceDataModal = ({ isOpen, onClose, onConfirm, initialTipoDte = 33 }) => {
    const { clients, carts, activeCartId, addClient } = useStore();

    const posSelectedClient = useMemo(() => {
        return carts.find(c => c.id === activeCartId)?.client || null;
    }, [carts, activeCartId]);

    const [tipoDte, setTipoDte] = useState(initialTipoDte);
    const [formaPago, setFormaPago] = useState('contado'); // contado | credito
    const [diasCredito, setDiasCredito] = useState(30);
    const [saveAsClient, setSaveAsClient] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const [form, setForm] = useState({
        rut: '',
        razon_social: '',
        giro: '',
        direccion: '',
        comuna: '',
        ciudad: '',
    });

    const [rutError, setRutError] = useState('');
    const [searchResult, setSearchResult] = useState(null); // null = no search, 'found' | 'not_found'
    const [foundClient, setFoundClient] = useState(null);

    // Reset when modal opens
    useEffect(() => {
        if (isOpen) {
            setTipoDte(initialTipoDte);
            setFormaPago('contado');
            setDiasCredito(30);
            setRutError('');
            setSearchResult(null);
            setFoundClient(null);
            setSaveAsClient(false);
            setIsSaving(false);

            // Pre-fill from selected client
            if (posSelectedClient) {
                const client = clients.find(c => c.id === posSelectedClient.id);
                if (client) {
                    setForm({
                        rut: client.rut || '',
                        razon_social: client.razon_social || client.name || '',
                        giro: client.giro || '',
                        direccion: client.address || '',
                        comuna: client.comuna || '',
                        ciudad: client.ciudad || '',
                    });
                    setFoundClient(client);
                    setSearchResult('found');
                    return;
                }
            }
            setForm({ rut: '', razon_social: '', giro: '', direccion: '', comuna: '', ciudad: '' });
        }
    }, [isOpen]);

    const handleRutChange = (e) => {
        const raw = e.target.value;
        setForm(prev => ({ ...prev, rut: raw }));
        setRutError('');
        setSearchResult(null);
        setFoundClient(null);
    };

    const handleRutBlur = () => {
        if (!form.rut.trim()) return;
        const formatted = formatRut(form.rut);
        setForm(prev => ({ ...prev, rut: formatted }));
        if (!validateRut(form.rut)) {
            setRutError('RUT inválido');
        } else if (!searchResult && !isSearching) {
            // Auto-search when leaving the field with a valid RUT
            handleSearchByRut();
        }
    };

    const [isSearching, setIsSearching] = useState(false);

    const handleSearchByRut = async () => {
        const clean = cleanRut(form.rut);
        if (!clean) return;

        if (!validateRut(form.rut)) {
            setRutError('RUT inválido');
            return;
        }

        // Search in clients by cleaned RUT
        const found = clients.find(c => {
            if (!c.rut) return false;
            return cleanRut(c.rut) === clean;
        });

        if (found) {
            setForm({
                rut: formatRut(found.rut),
                razon_social: found.razon_social || found.name || '',
                giro: found.giro || '',
                direccion: found.address || '',
                comuna: found.comuna || '',
                ciudad: found.ciudad || '',
            });
            setFoundClient(found);
            setSearchResult('found');
            setSaveAsClient(false);
            return;
        }

        // Not found locally — query SII
        setIsSearching(true);
        setSearchResult(null);
        try {
            const res = await fetch(`/api/sii/lookup-rut?rut=${encodeURIComponent(clean)}`);
            const data = await res.json();

            if (data.found) {
                setForm(prev => ({
                    ...prev,
                    rut: formatRut(clean),
                    razon_social: data.razon_social || prev.razon_social,
                    giro: data.giro || prev.giro,
                    direccion: data.direccion || prev.direccion,
                    comuna: data.comuna || prev.comuna,
                    ciudad: data.ciudad || prev.ciudad,
                }));
                setSearchResult('sii_found');
                setFoundClient(null);
                setSaveAsClient(true);
            } else {
                setSearchResult('not_found');
                setFoundClient(null);
                setSaveAsClient(true);
            }
        } catch (err) {
            console.error('Error consultando SII:', err);
            setSearchResult('not_found');
            setFoundClient(null);
            setSaveAsClient(true);
        } finally {
            setIsSearching(false);
        }
    };

    const handleRutKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSearchByRut();
        }
    };

    const handleFieldChange = (field) => (e) => {
        setForm(prev => ({ ...prev, [field]: e.target.value }));
    };

    // Validate form completeness
    const isFormValid = useMemo(() => {
        if (!form.rut.trim() || !validateRut(form.rut)) return false;
        if (!form.razon_social.trim()) return false;
        if (!form.giro.trim()) return false;
        if (!form.direccion.trim()) return false;
        if (!form.comuna.trim()) return false;
        if (!form.ciudad.trim()) return false;
        return true;
    }, [form]);

    const handleConfirm = async () => {
        if (!isFormValid || isSaving) return;
        setIsSaving(true);

        try {
            // Save as client if checkbox is checked and not already a client
            if (saveAsClient && !foundClient) {
                await addClient({
                    name: form.razon_social,
                    rut: cleanRut(form.rut),
                    razon_social: form.razon_social,
                    giro: form.giro,
                    phone: '',
                    email: '',
                    address: form.direccion,
                    comuna: form.comuna,
                    ciudad: form.ciudad,
                });
            }

            const invoiceData = {
                tipoDte,
                rut_receptor: cleanRut(form.rut),
                razon_social_receptor: form.razon_social.trim(),
                giro_receptor: form.giro.trim(),
                dir_receptor: form.direccion.trim(),
                comuna_receptor: form.comuna.trim(),
                ciudad_receptor: form.ciudad.trim(),
                formaPago,
                diasCredito: formaPago === 'credito' ? diasCredito : null,
            };

            onConfirm(invoiceData);
        } catch (err) {
            console.error('Error en InvoiceDataModal:', err);
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    const inputClass = "w-full px-3 py-2 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 text-sm";
    const labelClass = "block text-xs font-medium text-[var(--color-text-muted)] mb-1";

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/85 backdrop-blur-md" onClick={onClose} />

            {/* Modal */}
            <div className="relative w-full max-w-lg bg-[#0f0f2a] border border-[var(--glass-border)] rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--glass-border)]">
                    <div className="flex items-center gap-2">
                        <FileText size={20} className="text-purple-400" />
                        <h2 className="text-lg font-bold text-[var(--color-text)]">Datos de Facturación</h2>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
                        <X size={18} className="text-[var(--color-text-muted)]" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                    {/* Tipo DTE selector */}
                    <div>
                        <label className={labelClass}>Tipo de Documento</label>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setTipoDte(33)}
                                className={cn(
                                    "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-bold transition-all",
                                    tipoDte === 33
                                        ? "bg-purple-500 text-white shadow-lg shadow-purple-500/20"
                                        : "bg-[var(--glass-bg)] text-[var(--color-text-muted)] border border-[var(--glass-border)] hover:border-purple-500/50"
                                )}
                            >
                                <FileText size={14} />
                                Factura Afecta (33)
                            </button>
                            <button
                                onClick={() => setTipoDte(34)}
                                className={cn(
                                    "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-bold transition-all",
                                    tipoDte === 34
                                        ? "bg-amber-500 text-white shadow-lg shadow-amber-500/20"
                                        : "bg-[var(--glass-bg)] text-[var(--color-text-muted)] border border-[var(--glass-border)] hover:border-amber-500/50"
                                )}
                            >
                                <Receipt size={14} />
                                Factura Exenta (34)
                            </button>
                        </div>
                    </div>

                    {/* RUT search */}
                    <div>
                        <label className={labelClass}>RUT Receptor *</label>
                        <div className="flex gap-2">
                            <div className="flex-1 relative">
                                <input
                                    type="text"
                                    value={form.rut}
                                    onChange={handleRutChange}
                                    onBlur={handleRutBlur}
                                    onKeyDown={handleRutKeyDown}
                                    placeholder="12.345.678-9"
                                    className={cn(inputClass, rutError && "border-red-500 focus:ring-red-500/50")}
                                    autoFocus
                                />
                                {rutError && <p className="text-red-400 text-xs mt-1">{rutError}</p>}
                            </div>
                            <button
                                onClick={handleSearchByRut}
                                disabled={isSearching}
                                className="px-3 py-2 rounded-lg bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 transition-colors border border-purple-500/30 disabled:opacity-50"
                                title="Buscar cliente por RUT"
                            >
                                {isSearching ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
                            </button>
                        </div>
                        {isSearching && (
                            <p className="text-xs text-purple-400 mt-1.5 flex items-center gap-1">
                                <Loader2 size={12} className="animate-spin" />
                                Consultando datos en SII...
                            </p>
                        )}
                        {searchResult === 'found' && (
                            <div className="flex items-center gap-1.5 mt-1.5 text-xs text-green-400">
                                <UserCheck size={13} />
                                <span>Cliente encontrado: {foundClient?.name}</span>
                            </div>
                        )}
                        {searchResult === 'sii_found' && (
                            <div className="flex items-center gap-1.5 mt-1.5 text-xs text-green-400">
                                <UserCheck size={13} />
                                <span>Datos cargados desde SII</span>
                            </div>
                        )}
                        {searchResult === 'not_found' && (
                            <p className="text-xs text-amber-400 mt-1.5">RUT no registrado — completa los datos manualmente</p>
                        )}
                    </div>

                    {/* Razón Social */}
                    <div>
                        <label className={labelClass}>Razón Social *</label>
                        <input
                            type="text"
                            value={form.razon_social}
                            onChange={handleFieldChange('razon_social')}
                            placeholder="Nombre legal de la empresa"
                            className={inputClass}
                        />
                    </div>

                    {/* Giro */}
                    <div>
                        <label className={labelClass}>Giro *</label>
                        <input
                            type="text"
                            value={form.giro}
                            onChange={handleFieldChange('giro')}
                            placeholder="Actividad económica"
                            className={inputClass}
                        />
                    </div>

                    {/* Dirección + Comuna + Ciudad */}
                    <div className="grid grid-cols-1 gap-3">
                        <div>
                            <label className={labelClass}>Dirección *</label>
                            <input
                                type="text"
                                value={form.direccion}
                                onChange={handleFieldChange('direccion')}
                                placeholder="Dirección del receptor"
                                className={inputClass}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className={labelClass}>Comuna *</label>
                                <input
                                    type="text"
                                    value={form.comuna}
                                    onChange={handleFieldChange('comuna')}
                                    placeholder="Comuna"
                                    className={inputClass}
                                />
                            </div>
                            <div>
                                <label className={labelClass}>Ciudad *</label>
                                <input
                                    type="text"
                                    value={form.ciudad}
                                    onChange={handleFieldChange('ciudad')}
                                    placeholder="Ciudad"
                                    className={inputClass}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Forma de Pago */}
                    <div>
                        <label className={labelClass}>Forma de Pago</label>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setFormaPago('contado')}
                                className={cn(
                                    "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-bold transition-all",
                                    formaPago === 'contado'
                                        ? "bg-green-500 text-white shadow-lg shadow-green-500/20"
                                        : "bg-[var(--glass-bg)] text-[var(--color-text-muted)] border border-[var(--glass-border)] hover:border-green-500/50"
                                )}
                            >
                                <Banknote size={14} />
                                Contado
                            </button>
                            <button
                                onClick={() => setFormaPago('credito')}
                                className={cn(
                                    "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-bold transition-all",
                                    formaPago === 'credito'
                                        ? "bg-blue-500 text-white shadow-lg shadow-blue-500/20"
                                        : "bg-[var(--glass-bg)] text-[var(--color-text-muted)] border border-[var(--glass-border)] hover:border-blue-500/50"
                                )}
                            >
                                <CreditCard size={14} />
                                Crédito
                            </button>
                        </div>
                        {formaPago === 'credito' && (
                            <div className="mt-2">
                                <label className={labelClass}>Plazo (días)</label>
                                <select
                                    value={diasCredito}
                                    onChange={(e) => setDiasCredito(Number(e.target.value))}
                                    className={inputClass}
                                >
                                    <option value={15}>15 días</option>
                                    <option value={30}>30 días</option>
                                    <option value={45}>45 días</option>
                                    <option value={60}>60 días</option>
                                    <option value={90}>90 días</option>
                                </select>
                            </div>
                        )}
                    </div>

                    {/* Save as client checkbox */}
                    {!foundClient && form.rut.trim() && (
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={saveAsClient}
                                onChange={(e) => setSaveAsClient(e.target.checked)}
                                className="w-4 h-4 rounded border-gray-600 text-purple-500 focus:ring-purple-500/30 bg-transparent"
                            />
                            <span className="text-sm text-[var(--color-text-muted)]">
                                <Save size={13} className="inline mr-1" />
                                Guardar como cliente
                            </span>
                        </label>
                    )}
                </div>

                {/* Footer */}
                <div className="px-5 py-4 border-t border-[var(--glass-border)] flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 py-2.5 rounded-xl text-sm font-bold text-[var(--color-text-muted)] bg-[var(--glass-bg)] border border-[var(--glass-border)] hover:bg-white/10 transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={!isFormValid || isSaving}
                        className={cn(
                            "flex-1 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2",
                            isFormValid && !isSaving
                                ? "bg-purple-500 text-white hover:bg-purple-600 shadow-lg shadow-purple-500/20"
                                : "bg-gray-700 text-gray-500 cursor-not-allowed"
                        )}
                    >
                        {isSaving ? (
                            <><Loader2 size={16} className="animate-spin" /> Procesando...</>
                        ) : (
                            <>
                                <FileText size={16} />
                                Continuar al Pago
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default InvoiceDataModal;
