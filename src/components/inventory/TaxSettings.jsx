
import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { Plus, Edit, Trash2, Save, X, AlertCircle } from 'lucide-react';
import { usePermissions } from '../../hooks/usePermissions';

const TaxSettings = () => {
    const { taxRates, fetchTaxRates, addTaxRate, updateTaxRate, deleteTaxRate, currentCurrency } = useStore();
    const { can } = usePermissions();

    const [isEditing, setIsEditing] = useState(null);
    const [editForm, setEditForm] = useState({ name: '', rate: '', is_default: false });
    const [isCreating, setIsCreating] = useState(false);
    const [createForm, setCreateForm] = useState({ name: '', rate: '', is_default: false });
    const [error, setError] = useState(null);

    useEffect(() => {
        fetchTaxRates();
    }, []);

    const handleEditClick = (tax) => {
        setIsEditing(tax.id);
        setEditForm({ name: tax.name, rate: tax.rate, is_default: tax.is_default === 1 });
        setError(null);
    };

    const handleCancelEdit = () => {
        setIsEditing(null);
        setEditForm({ name: '', rate: '', is_default: false });
        setError(null);
    };

    const handleSaveEdit = async (id) => {
        if (!editForm.name || editForm.rate === '') {
            setError('Nombre y Tasa son obligatorios');
            return;
        }
        const res = await updateTaxRate(id, {
            ...editForm,
            rate: parseFloat(editForm.rate)
        });
        if (res.success) {
            setIsEditing(null);
        } else {
            setError(res.error);
        }
    };

    const handleCreateClick = () => {
        setIsCreating(true);
        setCreateForm({ name: '', rate: '', is_default: false });
        setError(null);
    };

    const handleCancelCreate = () => {
        setIsCreating(false);
        setCreateForm({ name: '', rate: '', is_default: false });
        setError(null);
    };

    const handleSaveCreate = async () => {
        if (!createForm.name || createForm.rate === '') {
            setError('Nombre y Tasa son obligatorios');
            return;
        }
        const res = await addTaxRate({
            ...createForm,
            rate: parseFloat(createForm.rate)
        });
        if (res.success) {
            setIsCreating(false);
            setCreateForm({ name: '', rate: '', is_default: false });
        } else {
            setError(res.error);
        }
    };

    const handleDelete = async (id) => {
        if (window.confirm('¿Estás seguro de eliminar este impuesto?')) {
            await deleteTaxRate(id);
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-bold text-white">Configuración de Impuestos</h2>
                    <p className="text-sm text-gray-400">Administra los impuestos aplicables a tus productos</p>
                </div>
                {(can('taxes.create')) && !isCreating && (
                    <button
                        onClick={handleCreateClick}
                        className="btn-primary flex items-center gap-2 px-4 py-2"
                    >
                        <Plus size={18} /> Nuevo Impuesto
                    </button>
                )}
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/20 p-3 rounded-lg flex items-center gap-2 text-red-400">
                    <AlertCircle size={18} />
                    <span>{error}</span>
                </div>
            )}

            <div className="glass-card overflow-hidden">
                <table className="w-full text-left">
                    <thead className="bg-black/20 text-gray-400 uppercase text-xs font-semibold">
                        <tr>
                            <th className="px-6 py-4">Nombre</th>
                            <th className="px-6 py-4">Tasa (%)</th>
                            <th className="px-6 py-4">Por Defecto</th>
                            <th className="px-6 py-4 text-right">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {isCreating && (
                            <tr className="bg-[var(--color-primary)]/5">
                                <td className="px-6 py-4">
                                    <input
                                        type="text"
                                        placeholder="Nombre (ej: IVA)"
                                        className="glass-input w-full"
                                        value={createForm.name}
                                        onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                                        autoFocus
                                    />
                                </td>
                                <td className="px-6 py-4">
                                    <div className="relative">
                                        <input
                                            type="number"
                                            placeholder="19"
                                            className="glass-input w-full pr-8"
                                            value={createForm.rate}
                                            onChange={(e) => setCreateForm({ ...createForm, rate: e.target.value })}
                                        />
                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">%</span>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={createForm.is_default}
                                            onChange={(e) => setCreateForm({ ...createForm, is_default: e.target.checked })}
                                            className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
                                        />
                                        <span className="text-sm">Predeterminado</span>
                                    </label>
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <div className="flex justify-end gap-2">
                                        <button onClick={handleSaveCreate} className="p-2 bg-green-500/20 text-green-400 rounded hover:bg-green-500/30">
                                            <Save size={18} />
                                        </button>
                                        <button onClick={handleCancelCreate} className="p-2 bg-red-500/20 text-red-400 rounded hover:bg-red-500/30">
                                            <X size={18} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        )}

                        {taxRates.map((tax) => (
                            <tr key={tax.id} className="hover:bg-white/5 transition-colors">
                                {isEditing === tax.id ? (
                                    <>
                                        <td className="px-6 py-4">
                                            <input
                                                type="text"
                                                className="glass-input w-full"
                                                value={editForm.name}
                                                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                            />
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="relative">
                                                <input
                                                    type="number"
                                                    className="glass-input w-full pr-8"
                                                    value={editForm.rate}
                                                    onChange={(e) => setEditForm({ ...editForm, rate: e.target.value })}
                                                />
                                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">%</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={editForm.is_default}
                                                    onChange={(e) => setEditForm({ ...editForm, is_default: e.target.checked })}
                                                    className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
                                                />
                                                <span className="text-sm">Predeterminado</span>
                                            </label>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex justify-end gap-2">
                                                <button onClick={() => handleSaveEdit(tax.id)} className="p-2 bg-green-500/20 text-green-400 rounded hover:bg-green-500/30">
                                                    <Save size={18} />
                                                </button>
                                                <button onClick={handleCancelEdit} className="p-2 bg-red-500/20 text-red-400 rounded hover:bg-red-500/30">
                                                    <X size={18} />
                                                </button>
                                            </div>
                                        </td>
                                    </>
                                ) : (
                                    <>
                                        <td className="px-6 py-4 font-medium text-white">{tax.name}</td>
                                        <td className="px-6 py-4 text-gray-300">{tax.rate}%</td>
                                        <td className="px-6 py-4">
                                            {tax.is_default === 1 && (
                                                <span className="px-2 py-1 bg-[var(--color-primary)]/20 text-[var(--color-primary)] text-xs rounded-full border border-[var(--color-primary)]/30">
                                                    Predeterminado
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            {(can('taxes.edit') || can('taxes.delete')) && (
                                                <div className="flex justify-end gap-2">
                                                    {can('taxes.edit') && (
                                                        <button onClick={() => handleEditClick(tax)} className="p-2 text-blue-400 hover:bg-blue-400/10 rounded transition-colors">
                                                            <Edit size={18} />
                                                        </button>
                                                    )}
                                                    {can('taxes.delete') && (
                                                        <button onClick={() => handleDelete(tax.id)} className="p-2 text-red-400 hover:bg-red-400/10 rounded transition-colors">
                                                            <Trash2 size={18} />
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                    </>
                                )}
                            </tr>
                        ))}

                        {taxRates.length === 0 && !isCreating && (
                            <tr>
                                <td colspan="4" className="px-6 py-8 text-center text-gray-500">
                                    No hay impuestos configurados. Crea uno nuevo para comenzar.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default TaxSettings;
