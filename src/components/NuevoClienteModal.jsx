import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { UserPlus, X, Check, AlertCircle, User, Phone, MapPin } from 'lucide-react';
import { useStore } from '../store/useStore';
import AsyncButton from './AsyncButton';

/**
 * Alta rápida de cliente, en su propia ventana.
 *
 * Va aparte y no dentro del formulario que la abre: metida ahí, la pantalla del
 * encargo quedaba con demasiada información junta y costaba encontrar el dato que
 * uno buscaba. Se abre por encima (z mayor) y al guardar devuelve el cliente ya
 * creado, para que quien la llamó lo deje seleccionado sin volver a buscarlo.
 *
 * Solo el nombre es obligatorio: es lo único que hace falta para poder encontrarlo
 * después. El celular y la dirección se pueden completar más adelante — la
 * dirección sirve para los encargos con delivery.
 */
export default function NuevoClienteModal({ isOpen, onClose, onCreated, nombreInicial = '', celularInicial = '' }) {
    const { clients, addClient } = useStore();
    const [nombre, setNombre] = useState(nombreInicial);
    const [celular, setCelular] = useState(celularInicial);
    const [direccion, setDireccion] = useState('');
    const [error, setError] = useState('');

    if (!isOpen) return null;

    const guardar = async () => {
        const n = nombre.trim();
        if (!n) { setError('Escribe el nombre del cliente.'); return; }
        // Mismo nombre ya registrado: casi siempre es el mismo cliente. Mejor avisar
        // que llenar el listado de duplicados imposibles de distinguir después.
        if (clients.some(c => c.name.trim().toLowerCase() === n.toLowerCase())) {
            setError('Ya existe un cliente con ese nombre. Búscalo en el listado.');
            return;
        }
        const r = await addClient({ name: n, phone: celular.trim(), address: direccion.trim() });
        if (!r?.success) { setError(r?.error || 'No se pudo registrar el cliente.'); return; }
        onCreated(r.client);
        setNombre(''); setCelular(''); setDireccion(''); setError('');
    };

    return createPortal(
        // z por encima del modal que la abrió (el de Confirmar Encargo usa z-50).
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="glass-card modal-solido w-full max-w-sm animate-[float_0.25s_ease-out]">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-[var(--color-text)] flex items-center gap-2">
                        <UserPlus className="text-[var(--color-primary)]" size={20} />
                        Nuevo cliente
                    </h3>
                    <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] p-1">
                        <X size={20} />
                    </button>
                </div>

                <div className="space-y-3">
                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-[var(--color-text-muted)] flex items-center gap-1.5">
                            <User size={13} /> Nombre <span className="text-red-400">*</span>
                        </label>
                        <input type="text" autoFocus placeholder="Ej: Luis Javier"
                            className="glass-input w-full text-sm"
                            value={nombre}
                            onChange={e => { setNombre(e.target.value); setError(''); }}
                            onKeyDown={e => { if (e.key === 'Enter') guardar(); }} />
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-[var(--color-text-muted)] flex items-center gap-1.5">
                            <Phone size={13} /> Celular <span className="font-normal opacity-70">(opcional)</span>
                        </label>
                        <input type="tel" placeholder="Ej: 9 1234 5678"
                            className="glass-input w-full text-sm"
                            value={celular} onChange={e => setCelular(e.target.value)} />
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-[var(--color-text-muted)] flex items-center gap-1.5">
                            <MapPin size={13} /> Dirección <span className="font-normal opacity-70">(opcional)</span>
                        </label>
                        <input type="text" placeholder="Ej: Thompson 742"
                            className="glass-input w-full text-sm"
                            value={direccion} onChange={e => setDireccion(e.target.value)} />
                        <p className="text-[10px] text-[var(--color-text-muted)]">
                            Se usa para los encargos con delivery: queda cargada y no hay que escribirla cada vez.
                        </p>
                    </div>

                    {error && (
                        <p className="text-[11px] text-red-400 flex items-start gap-1">
                            <AlertCircle size={12} className="shrink-0 mt-0.5" /> {error}
                        </p>
                    )}

                    <div className="flex gap-2 pt-1">
                        <button type="button" onClick={onClose}
                            className="flex-1 py-2.5 rounded-lg text-sm font-bold border border-[var(--glass-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                            Cancelar
                        </button>
                        <AsyncButton
                            onClick={guardar}
                            icon={<Check size={16} />}
                            loadingText="Guardando…"
                            className="flex-1 py-2.5 rounded-lg text-sm font-bold bg-[var(--color-primary)] text-black flex items-center justify-center gap-1.5"
                        >
                            Guardar
                        </AsyncButton>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}
