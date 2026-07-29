import React, { useEffect, useState } from 'react';
import { Bike, Plus, Trash2, Phone, Banknote, X, Loader2, User } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { formatCurrency } from '../../utils/formatCurrency';
import { usePermissions } from '../../hooks/usePermissions';
import { toast } from '../../lib/toast';
import { cn } from '../../lib/utils';

const VEHICLES = [
    { id: 'moto', label: 'Moto' },
    { id: 'auto', label: 'Auto' },
    { id: 'bici', label: 'Bicicleta' },
    { id: 'pie', label: 'A pie' },
];

const STATUS = {
    available: { label: 'Disponible', cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' },
    busy: { label: 'En ruta', cls: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30' },
    off: { label: 'Fuera de turno', cls: 'text-[var(--color-text-muted)] bg-[var(--glass-bg)] border-[var(--glass-border)]' },
};

// Delivery → Repartidores. Alta/baja y estado de cada repartidor, con lo que
// tiene recaudado pendiente de rendir a caja.
export default function Couriers() {
    const { couriers, fetchCouriers, saveCourier, deleteCourier, users, fetchUsers, currentCurrency, cashRegister, createSettlement } = useStore();
    const { can } = usePermissions();
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(null);   // objeto = modal abierto
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        (async () => {
            await fetchCouriers();
            if (typeof fetchUsers === 'function') { try { await fetchUsers(); } catch { /* opcional */ } }
            setLoading(false);
        })();
    }, [fetchCouriers, fetchUsers]);

    const blank = { name: '', phone: '', vehicle: 'moto', userId: '', active: true };

    const submit = async (e) => {
        e.preventDefault();
        setSaving(true);
        const r = await saveCourier({
            id: editing.id,
            name: editing.name,
            phone: editing.phone,
            vehicle: editing.vehicle,
            userId: editing.userId ? Number(editing.userId) : null,
            active: editing.active,
            status: editing.status,
        });
        setSaving(false);
        if (r?.success) { toast('Repartidor guardado', 'success'); setEditing(null); }
        else toast(r?.error || 'No se pudo guardar', 'error');
    };

    const remove = async (c) => {
        if (!window.confirm(`¿Quitar a ${c.name}?`)) return;
        const r = await deleteCourier(c.id);
        if (r?.success) toast(r.deactivated ? 'Tiene envíos activos: quedó desactivado' : 'Repartidor eliminado', 'info');
        else toast(r?.error || 'No se pudo eliminar', 'error');
    };

    const settle = async (c) => {
        if (!cashRegister?.id) { toast('Abre una caja para recibir la rendición', 'error'); return; }
        if (!window.confirm(`Recibir ${formatCurrency(c.pending_cash, currentCurrency)} de ${c.name} e ingresarlo a tu caja?`)) return;
        const r = await createSettlement(c.id, cashRegister.id);
        if (r?.success) { toast(`Rendición registrada: ${formatCurrency(r.cash, currentCurrency)}`, 'success'); fetchCouriers(); }
        else toast(r?.error || 'No se pudo liquidar', 'error');
    };

    return (
        <div className="h-full flex flex-col gap-4 p-4 lg:p-6 overflow-y-auto">
            <div className="flex items-center justify-between gap-3 shrink-0">
                <div>
                    <h1 className="text-xl lg:text-2xl font-bold text-[var(--color-text)] flex items-center gap-2">
                        <Bike className="text-[var(--color-primary)]" /> Repartidores
                    </h1>
                    <p className="text-[var(--color-text-muted)] text-xs lg:text-sm">
                        Quiénes reparten y cuánto tienen recaudado por rendir.
                    </p>
                </div>
                {can('delivery.couriers') && (
                    <button onClick={() => setEditing({ ...blank })}
                        className="btn-primary px-4 py-2.5 rounded-xl font-bold flex items-center gap-2 shrink-0">
                        <Plus size={18} /> Agregar
                    </button>
                )}
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-16 text-[var(--color-text-muted)]">
                    <Loader2 className="animate-spin mr-2" size={20} /> Cargando…
                </div>
            ) : couriers.length === 0 ? (
                <div className="glass-card p-10 flex flex-col items-center gap-3 text-[var(--color-text-muted)]">
                    <Bike size={48} className="opacity-20" />
                    <p>Aún no tienes repartidores.</p>
                </div>
            ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {couriers.map(c => {
                        const st = STATUS[c.status] || STATUS.off;
                        return (
                            <div key={c.id} className={cn('glass-card p-4 flex flex-col gap-3', !c.active && 'opacity-50')}>
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="font-bold text-[var(--color-text)] truncate">{c.name}</p>
                                        <p className="text-xs text-[var(--color-text-muted)] capitalize">
                                            {VEHICLES.find(v => v.id === c.vehicle)?.label || c.vehicle}
                                            {c.phone && <> · <a href={`tel:${c.phone}`} className="hover:text-[var(--color-primary)]">{c.phone}</a></>}
                                        </p>
                                        {c.user_name && (
                                            <p className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1 mt-0.5">
                                                <User size={11} /> {c.user_name}
                                            </p>
                                        )}
                                    </div>
                                    <span className={cn('text-[10px] font-bold px-2 py-1 rounded-full border shrink-0', st.cls)}>
                                        {c.active ? st.label : 'Inactivo'}
                                    </span>
                                </div>

                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-[var(--color-text-muted)]">Envíos activos</span>
                                    <span className="font-bold text-[var(--color-text)]">{c.active_count}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-[var(--color-text-muted)]">Por rendir</span>
                                    <span className={cn('font-bold', c.pending_cash > 0 ? 'text-amber-400' : 'text-[var(--color-text-muted)]')}>
                                        {formatCurrency(c.pending_cash, currentCurrency)}
                                    </span>
                                </div>

                                <div className="flex gap-2 pt-2 border-t border-[var(--glass-border)]">
                                    {can('delivery.settle') && c.pending_cash > 0 && (
                                        <button onClick={() => settle(c)}
                                            className="flex-1 py-2 rounded-lg text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center justify-center gap-1.5">
                                            <Banknote size={14} /> Liquidar
                                        </button>
                                    )}
                                    {can('delivery.couriers') && (
                                        <>
                                            <button onClick={() => setEditing({ ...c, userId: c.user_id || '' })}
                                                className="flex-1 py-2 rounded-lg text-xs font-bold border border-[var(--glass-border)] text-[var(--color-text-muted)]">
                                                Editar
                                            </button>
                                            <button onClick={() => remove(c)}
                                                className="px-3 py-2 rounded-lg text-[var(--color-text-muted)] hover:text-red-400 border border-[var(--glass-border)]">
                                                <Trash2 size={14} />
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Alta / edición */}
            {editing && (
                <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                    <form onSubmit={submit} className="glass-card w-full max-w-md p-6 max-h-full overflow-y-auto relative">
                        <button type="button" onClick={() => setEditing(null)}
                            className="absolute top-4 right-4 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                            <X size={20} />
                        </button>
                        <h2 className="text-xl font-bold text-[var(--color-text)] mb-5 flex items-center gap-2">
                            <Bike className="text-[var(--color-primary)]" size={20} />
                            {editing.id ? 'Editar repartidor' : 'Nuevo repartidor'}
                        </h2>

                        <div className="space-y-4">
                            <div>
                                <label className="text-sm text-[var(--color-text-muted)]">Nombre *</label>
                                <input required value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
                                    className="glass-input w-full mt-1" placeholder="Nombre y apellido" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-sm text-[var(--color-text-muted)]">Teléfono</label>
                                    <input value={editing.phone || ''} onChange={e => setEditing({ ...editing, phone: e.target.value })}
                                        className="glass-input w-full mt-1" placeholder="+569…" />
                                </div>
                                <div>
                                    <label className="text-sm text-[var(--color-text-muted)]">Vehículo</label>
                                    <select value={editing.vehicle} onChange={e => setEditing({ ...editing, vehicle: e.target.value })}
                                        className="glass-input w-full mt-1">
                                        {VEHICLES.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="text-sm text-[var(--color-text-muted)]">Usuario del sistema</label>
                                <select value={editing.userId || ''} onChange={e => setEditing({ ...editing, userId: e.target.value })}
                                    className="glass-input w-full mt-1">
                                    <option value="">— Sin cuenta (no entra a la app) —</option>
                                    {(users || []).map(u => <option key={u.id} value={u.id}>{u.name} ({u.username})</option>)}
                                </select>
                                <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
                                    Enlázalo a un usuario para que pueda entrar en <strong>Modo Repartidor</strong> y ver sus pedidos.
                                </p>
                            </div>
                            {editing.id && (
                                <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                                    <input type="checkbox" checked={!!editing.active}
                                        onChange={e => setEditing({ ...editing, active: e.target.checked })} />
                                    Activo
                                </label>
                            )}
                        </div>

                        <div className="flex gap-3 mt-6">
                            <button type="button" onClick={() => setEditing(null)}
                                className="flex-1 py-2.5 rounded-lg border border-[var(--glass-border)] text-[var(--color-text-muted)] font-bold">
                                Cancelar
                            </button>
                            <button type="submit" disabled={saving} className="flex-1 btn-primary py-2.5 rounded-lg font-bold disabled:opacity-50">
                                {saving ? 'Guardando…' : 'Guardar'}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
}
