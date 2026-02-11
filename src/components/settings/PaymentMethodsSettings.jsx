import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/useStore';
import {
    CreditCard,
    Wallet,
    Landmark,
    Users,
    Layers,
    Plus,
    Trash2,
    X,
    Smartphone,
    Pencil
} from 'lucide-react';

const PaymentMethodsSettings = () => {
    const {
        paymentMethodsConfig,
        paymentTerminals,
        bankAccounts,
        fetchPaymentMethodsSettings,
        togglePaymentMethod,
        addPaymentTerminal,
        updatePaymentTerminal,
        deletePaymentTerminal,
        addBankAccount,
        updateBankAccount,
        deleteBankAccount
    } = useStore();

    const [isTerminalModalOpen, setIsTerminalModalOpen] = useState(false);
    const [isBankModalOpen, setIsBankModalOpen] = useState(false);

    // Edit States
    const [editingTerminalId, setEditingTerminalId] = useState(null);
    const [editingAccountId, setEditingAccountId] = useState(null);

    // Form States
    const [newTerminal, setNewTerminal] = useState({ name: '', color: '#3B82F6' });
    const [newAccount, setNewAccount] = useState({
        bank_name: '',
        account_number: '',
        account_type: 'Vista',
        owner_name: '',
        rut: '',
        email: ''
    });

    const terminalColors = [
        '#3B82F6', // Blue
        '#EF4444', // Red
        '#10B981', // Green
        '#F59E0B', // Yellow
        '#8B5CF6', // Purple
        '#EC4899', // Pink
        '#6366F1', // Indigo
        '#14B8A6', // Teal
    ];

    useEffect(() => {
        fetchPaymentMethodsSettings();
    }, []);

    const handleToggle = async (method, currentValue) => {
        await togglePaymentMethod(method, !currentValue);
    };

    const handleSaveTerminal = async () => {
        if (!newTerminal.name) return;

        let result;
        if (editingTerminalId) {
            result = await updatePaymentTerminal(editingTerminalId, newTerminal);
        } else {
            result = await addPaymentTerminal(newTerminal);
        }

        if (result.success) {
            setNewTerminal({ name: '', color: '#3B82F6' });
            setEditingTerminalId(null);
            setIsTerminalModalOpen(false);
        }
    };

    const openAddTerminalModal = () => {
        setNewTerminal({ name: '', color: '#3B82F6' });
        setEditingTerminalId(null);
        setIsTerminalModalOpen(true);
    };

    const openEditTerminalModal = (terminal) => {
        setNewTerminal({ name: terminal.name, color: terminal.color || '#3B82F6' });
        setEditingTerminalId(terminal.id);
        setIsTerminalModalOpen(true);
    };

    const handleSaveBankAccount = async () => {
        if (!newAccount.bank_name || !newAccount.account_number) return;

        let result;
        if (editingAccountId) {
            result = await updateBankAccount(editingAccountId, newAccount);
        } else {
            result = await addBankAccount(newAccount);
        }

        if (result.success) {
            setNewAccount({
                bank_name: '',
                account_number: '',
                account_type: 'Vista',
                owner_name: '',
                rut: '',
                email: ''
            });
            setEditingAccountId(null);
            setIsBankModalOpen(false);
        }
    };

    const openAddAccountModal = () => {
        setNewAccount({
            bank_name: '',
            account_number: '',
            account_type: 'Vista',
            owner_name: '',
            rut: '',
            email: ''
        });
        setEditingAccountId(null);
        setIsBankModalOpen(true);
    };

    const openEditAccountModal = (account) => {
        setNewAccount({
            bank_name: account.bank_name,
            account_number: account.account_number,
            account_type: account.account_type,
            owner_name: account.owner_name,
            rut: account.rut,
            email: account.email
        });
        setEditingAccountId(account.id);
        setIsBankModalOpen(true);
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="glass-card border-l-4 border-l-[var(--color-primary)]">
                <h2 className="text-xl font-bold text-[var(--color-text)]">Medios de Pago</h2>
                <p className="text-sm text-[var(--color-text-muted)]">Activa y configura los métodos de pago disponibles en el punto de venta</p>


            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* EFECTIVO */}
                <div className="glass-card relative overflow-hidden group">
                    <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-3">
                            <div className="p-3 rounded-xl bg-green-500/20 text-green-400">
                                <Wallet size={24} />
                            </div>
                            <div>
                                <h3 className="font-bold text-lg text-[var(--color-text)]">Efectivo</h3>
                                <p className="text-xs text-[var(--color-text-muted)]">Pagos en billetes y monedas</p>
                            </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={paymentMethodsConfig.cash_enabled === 1}
                                onChange={() => handleToggle('cash', paymentMethodsConfig.cash_enabled)}
                            />
                            <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
                        </label>
                    </div>
                </div>

                {/* TARJETA */}
                <div className="glass-card relative overflow-hidden group">
                    <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-3">
                            <div className="p-3 rounded-xl bg-blue-500/20 text-blue-400">
                                <CreditCard size={24} />
                            </div>
                            <div>
                                <h3 className="font-bold text-lg text-[var(--color-text)]">Tarjeta (Débito/Crédito)</h3>
                                <p className="text-xs text-[var(--color-text-muted)]">POS y ventas electrónicas</p>
                            </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={paymentMethodsConfig.card_enabled === 1}
                                onChange={() => handleToggle('card', paymentMethodsConfig.card_enabled)}
                            />
                            <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                        </label>
                    </div>

                    {paymentMethodsConfig.card_enabled === 1 && (
                        <div className="mt-4 pt-4 border-t border-[var(--glass-border)] animate-in fade-in">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-sm font-medium text-[var(--color-text)]">Terminales / Maquinas</span>
                                <button
                                    onClick={openAddTerminalModal}
                                    className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                                >
                                    <Plus size={12} /> Agregar
                                </button>
                            </div>
                            <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar pr-1">
                                {paymentTerminals.length === 0 ? (
                                    <p className="text-xs text-[var(--color-text-muted)] italic">No hay terminales registrados</p>
                                ) : (
                                    paymentTerminals.map(terminal => (
                                        <div key={terminal.id} className="flex justify-between items-center bg-[var(--glass-bg)] p-2 rounded-lg border border-[var(--glass-border)]">
                                            <div className="flex items-center gap-2">
                                                <div
                                                    className="w-3 h-3 rounded-full shadow-sm"
                                                    style={{ backgroundColor: terminal.color || '#3B82F6' }}
                                                />
                                                <Smartphone size={14} className="text-[var(--color-text-muted)]" />
                                                <span className="text-sm text-[var(--color-text)]">{terminal.name}</span>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={() => openEditTerminalModal(terminal)}
                                                    className="text-blue-400 hover:text-blue-300 p-1"
                                                >
                                                    <Pencil size={14} />
                                                </button>
                                                <button
                                                    onClick={() => deletePaymentTerminal(terminal.id)}
                                                    className="text-red-400 hover:text-red-300 p-1"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* TRANSFERENCIA */}
                <div className="glass-card relative overflow-hidden group">
                    <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-3">
                            <div className="p-3 rounded-xl bg-purple-500/20 text-purple-400">
                                <Landmark size={24} />
                            </div>
                            <div>
                                <h3 className="font-bold text-lg text-[var(--color-text)]">Transferencia</h3>
                                <p className="text-xs text-[var(--color-text-muted)]">Pagos por transferencia bancaria</p>
                            </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={paymentMethodsConfig.transfer_enabled === 1}
                                onChange={() => handleToggle('transfer', paymentMethodsConfig.transfer_enabled)}
                            />
                            <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-500"></div>
                        </label>
                    </div>

                    {paymentMethodsConfig.transfer_enabled === 1 && (
                        <div className="mt-4 pt-4 border-t border-[var(--glass-border)] animate-in fade-in">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-sm font-medium text-[var(--color-text)]">Cuentas Bancarias</span>
                                <button
                                    onClick={openAddAccountModal}
                                    className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1"
                                >
                                    <Plus size={12} /> Agregar
                                </button>
                            </div>
                            <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar pr-1">
                                {bankAccounts.length === 0 ? (
                                    <p className="text-xs text-[var(--color-text-muted)] italic">No hay cuentas registradas</p>
                                ) : (
                                    bankAccounts.map(account => (
                                        <div key={account.id} className="flex justify-between items-center bg-[var(--glass-bg)] p-2 rounded-lg border border-[var(--glass-border)]">
                                            <div className="flex flex-col">
                                                <span className="text-sm font-bold text-[var(--color-text)]">{account.bank_name}</span>
                                                <span className="text-xs text-[var(--color-text-muted)]">{account.account_type} • {account.account_number}</span>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={() => openEditAccountModal(account)}
                                                    className="text-blue-400 hover:text-blue-300 p-1"
                                                >
                                                    <Pencil size={14} />
                                                </button>
                                                <button
                                                    onClick={() => deleteBankAccount(account.id)}
                                                    className="text-red-400 hover:text-red-300 p-1"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* CRÉDITO / FIADO */}
                <div className="glass-card relative overflow-hidden group">
                    <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-3">
                            <div className="p-3 rounded-xl bg-orange-500/20 text-orange-400">
                                <Users size={24} />
                            </div>
                            <div>
                                <h3 className="font-bold text-lg text-[var(--color-text)]">Crédito / Fiado</h3>
                                <p className="text-xs text-[var(--color-text-muted)]">Ventas a crédito a clientes de confianza</p>
                            </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={paymentMethodsConfig.credit_enabled === 1}
                                onChange={() => handleToggle('credit', paymentMethodsConfig.credit_enabled)}
                            />
                            <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-500"></div>
                        </label>
                    </div>
                </div>

                {/* PAGO MIXTO */}
                <div className="glass-card relative overflow-hidden group">
                    <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-3">
                            <div className="p-3 rounded-xl bg-pink-500/20 text-pink-400">
                                <Layers size={24} />
                            </div>
                            <div>
                                <h3 className="font-bold text-lg text-[var(--color-text)]">Pago Mixto</h3>
                                <p className="text-xs text-[var(--color-text-muted)]">Combinar múltiples formas de pago</p>
                            </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={paymentMethodsConfig.mixed_enabled === 1}
                                onChange={() => handleToggle('mixed', paymentMethodsConfig.mixed_enabled)}
                            />
                            <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-pink-500"></div>
                        </label>
                    </div>
                    <div className="mt-2 text-xs text-[var(--color-text-muted)] bg-[var(--glass-bg)] p-2 rounded border border-[var(--glass-border)]">
                        ℹ️ Permite dividir el total de una venta entre efectivo, tarjeta, transferencia, etc.
                    </div>
                </div>

            </div>

            {/* MODAL: Add Terminal */}
            {isTerminalModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="glass-card w-full max-w-sm p-6 relative animate-in zoom-in-95 duration-200">
                        <button
                            onClick={() => setIsTerminalModalOpen(false)}
                            className="absolute top-4 right-4 text-[var(--color-text-muted)] hover:text-white"
                        >
                            <X size={20} />
                        </button>
                        <h3 className="text-xl font-bold text-[var(--color-text)] mb-4">
                            {editingTerminalId ? 'Editar Terminal' : 'Agregar Terminal'}
                        </h3>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Nombre *</label>
                                <input
                                    type="text"
                                    value={newTerminal.name}
                                    onChange={e => setNewTerminal({ ...newTerminal, name: e.target.value })}
                                    placeholder="Ej: SumUp Air, Transbank 1"
                                    className="glass-input w-full"
                                    autoFocus
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-[var(--color-text)] mb-2">Color Identificativo</label>
                                <div className="flex gap-2 flex-wrap">
                                    {terminalColors.map(color => (
                                        <button
                                            key={color}
                                            onClick={() => setNewTerminal({ ...newTerminal, color })}
                                            className={`w-8 h-8 rounded-full border-2 transition-transform hover:scale-110 ${newTerminal.color === color ? 'border-white scale-110 shadow-lg' : 'border-transparent'
                                                }`}
                                            style={{ backgroundColor: color }}
                                            aria-label={`Seleccionar color ${color}`}
                                        />
                                    ))}
                                </div>
                            </div>

                            <div className="pt-2 flex justify-end gap-3">
                                <button
                                    onClick={() => setIsTerminalModalOpen(false)}
                                    className="px-4 py-2 rounded-lg text-sm font-medium text-[var(--color-text)] hover:bg-white/10 transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={handleSaveTerminal}
                                    className="btn-primary"
                                    disabled={!newTerminal.name}
                                >
                                    {editingTerminalId ? 'Actualizar' : 'Guardar'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL: Add Bank Account */}
            {isBankModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="glass-card w-full max-w-md p-6 relative animate-in zoom-in-95 duration-200 field-group overflow-y-auto max-h-[90vh]">
                        <button
                            onClick={() => setIsBankModalOpen(false)}
                            className="absolute top-4 right-4 text-[var(--color-text-muted)] hover:text-white"
                        >
                            <X size={20} />
                        </button>
                        <h3 className="text-xl font-bold text-[var(--color-text)] mb-4">
                            {editingAccountId ? 'Editar Cuenta Bancaria' : 'Agregar Cuenta Bancaria'}
                        </h3>

                        <div className="space-y-3">
                            <div>
                                <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Banco *</label>
                                <input
                                    type="text"
                                    value={newAccount.bank_name}
                                    onChange={e => setNewAccount({ ...newAccount, bank_name: e.target.value })}
                                    placeholder="Ej: Banco Estado"
                                    className="glass-input w-full"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Tipo de Cuenta</label>
                                <select
                                    value={newAccount.account_type}
                                    onChange={e => setNewAccount({ ...newAccount, account_type: e.target.value })}
                                    className="glass-input w-full"
                                >
                                    <option value="Vista / RUT" className="bg-gray-900">Vista / RUT</option>
                                    <option value="Corriente" className="bg-gray-900">Corriente</option>
                                    <option value="Ahorro" className="bg-gray-900">Ahorro</option>
                                    <option value="Chequera Electrónica" className="bg-gray-900">Chequera Electrónica</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Número de Cuenta *</label>
                                <input
                                    type="text"
                                    value={newAccount.account_number}
                                    onChange={e => setNewAccount({ ...newAccount, account_number: e.target.value })}
                                    placeholder="Ej: 12345678"
                                    className="glass-input w-full"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Nombre Titular</label>
                                <input
                                    type="text"
                                    value={newAccount.owner_name}
                                    onChange={e => setNewAccount({ ...newAccount, owner_name: e.target.value })}
                                    placeholder="Nombre completo"
                                    className="glass-input w-full"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-sm font-medium text-[var(--color-text)] mb-1">RUT</label>
                                    <input
                                        type="text"
                                        value={newAccount.rut}
                                        onChange={e => setNewAccount({ ...newAccount, rut: e.target.value })}
                                        placeholder="12.345.678-9"
                                        className="glass-input w-full"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Email</label>
                                    <input
                                        type="email"
                                        value={newAccount.email}
                                        onChange={e => setNewAccount({ ...newAccount, email: e.target.value })}
                                        placeholder="pago@ejemplo.com"
                                        className="glass-input w-full"
                                    />
                                </div>
                            </div>

                            <div className="pt-4 flex justify-end gap-3">
                                <button
                                    onClick={() => setIsBankModalOpen(false)}
                                    className="px-4 py-2 rounded-lg text-sm font-medium text-[var(--color-text)] hover:bg-white/10 transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={handleSaveBankAccount}
                                    className="btn-primary"
                                    disabled={!newAccount.bank_name || !newAccount.account_number}
                                >
                                    {editingAccountId ? 'Actualizar Cuenta' : 'Guardar Cuenta'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};

export default PaymentMethodsSettings;
