import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../store/useStore';
import { DollarSign, Clock, Landmark, CheckCircle, Check, X, CreditCard, Save, Wallet, Paperclip, FileText } from 'lucide-react';
import { formatMoney, PAYMENT_CONFIG } from '../../config/mercadopago';
import { cn } from '../../lib/utils';

const STATUS_BADGE = {
    pending: { label: 'Pendiente', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
    approved: { label: 'Aprobado', cls: 'bg-green-500/15 text-green-400 border-green-500/30' },
    rejected: { label: 'Rechazado', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
};

const METHOD_LABEL = {
    mercadopago: { label: 'MercadoPago', icon: CreditCard, cls: 'text-sky-400' },
    transfer: { label: 'Transferencia', icon: Landmark, cls: 'text-emerald-400' },
};

const formatDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? '—' : d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const StatCard = ({ title, value, icon, color, bgColor }) => (
    <div className="bg-[#18181b] border border-white/10 rounded-2xl p-5">
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center mb-3', bgColor, color)}>{icon}</div>
        <div className={cn('text-2xl font-bold', color)}>{value}</div>
        <div className="text-sm text-gray-400">{title}</div>
    </div>
);

const AdminPayments = () => {
    const { fetchAllPayments, adminApprovePayment, adminRejectPayment, fetchPaymentReceipt } = useStore();
    const [payments, setPayments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('all');
    const [busyId, setBusyId] = useState(null);
    const [tab, setTab] = useState('payments'); // 'payments' | 'transfer'
    const [receiptView, setReceiptView] = useState(null); // { loading, data }

    const openReceipt = async (p) => {
        setReceiptView({ loading: true, data: null });
        const data = await fetchPaymentReceipt(p.id);
        setReceiptView({ loading: false, data });
    };

    const load = async () => {
        setLoading(true);
        try {
            setPayments(await fetchAllPayments());
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { load(); }, []);

    const handleApprove = async (p) => {
        if (!window.confirm(`¿Aprobar este pago de ${formatMoney(p.amount, p.currency || 'CLP')} y activar la suscripción de "${p.company_name || p.company_id}"?`)) return;
        setBusyId(p.id);
        const r = await adminApprovePayment(p.id);
        setBusyId(null);
        if (r.success) load();
        else alert('Error: ' + r.error);
    };

    const handleReject = async (p) => {
        if (!window.confirm('¿Rechazar este pago?')) return;
        setBusyId(p.id);
        const r = await adminRejectPayment(p.id);
        setBusyId(null);
        if (r.success) load();
        else alert('Error: ' + r.error);
    };

    const stats = {
        total: payments.length,
        pending: payments.filter(p => p.status === 'pending').length,
        transfers: payments.filter(p => p.status === 'pending' && p.payment_method === 'transfer').length,
        approved: payments.filter(p => p.status === 'approved').length,
    };

    const filtered = payments.filter(p => {
        if (filter === 'all') return true;
        if (filter === 'transfer') return p.payment_method === 'transfer';
        return p.status === filter;
    });

    return (
        <div className="p-8 max-w-7xl mx-auto">
            <div className="mb-6">
                <h1 className="text-3xl font-bold text-white mb-2">Pagos</h1>
                <p className="text-gray-400">Pagos en curso, pendientes y transferencias por aprobar</p>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 mb-8 border-b border-white/10">
                {[
                    { id: 'payments', label: 'Pagos' },
                    { id: 'transfer', label: 'Datos de transferencia' },
                ].map(t => (
                    <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        className={cn(
                            'px-4 py-2.5 text-sm font-bold border-b-2 -mb-px transition-all',
                            tab === t.id ? 'border-[var(--color-primary)] text-white' : 'border-transparent text-gray-400 hover:text-white'
                        )}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {tab === 'transfer' && <TransferSettingsForm />}

            {tab === 'payments' && (<>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                <StatCard title="Total pagos" value={stats.total} icon={<DollarSign size={20} />} color="text-blue-400" bgColor="bg-blue-500/10" />
                <StatCard title="Pendientes" value={stats.pending} icon={<Clock size={20} />} color="text-amber-400" bgColor="bg-amber-500/10" />
                <StatCard title="Transferencias por aprobar" value={stats.transfers} icon={<Landmark size={20} />} color="text-emerald-400" bgColor="bg-emerald-500/10" />
                <StatCard title="Aprobados" value={stats.approved} icon={<CheckCircle size={20} />} color="text-green-400" bgColor="bg-green-500/10" />
            </div>

            <div className="flex gap-2 mb-6 flex-wrap">
                {[
                    { id: 'all', label: 'Todos' },
                    { id: 'pending', label: 'Pendientes' },
                    { id: 'transfer', label: 'Transferencias' },
                    { id: 'approved', label: 'Aprobados' },
                    { id: 'rejected', label: 'Rechazados' },
                ].map(f => (
                    <button
                        key={f.id}
                        onClick={() => setFilter(f.id)}
                        className={cn(
                            'px-4 py-2 rounded-lg text-sm font-medium transition-all',
                            filter === f.id ? 'bg-[var(--color-primary)] text-black' : 'bg-white/5 text-gray-400 hover:bg-white/10'
                        )}
                    >
                        {f.label}
                    </button>
                ))}
            </div>

            <div className="bg-[#18181b] border border-white/10 rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-white/5">
                            <tr>
                                {['Empresa', 'Descripción', 'Método', 'Monto', 'Estado', 'Fecha', 'Acciones'].map(h => (
                                    <th key={h} className="px-6 py-4 text-left text-xs font-semibold text-gray-400 uppercase">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {loading ? (
                                <tr><td colSpan="7" className="px-6 py-12 text-center text-gray-500">Cargando…</td></tr>
                            ) : filtered.length === 0 ? (
                                <tr><td colSpan="7" className="px-6 py-12 text-center text-gray-500">No hay pagos con este filtro</td></tr>
                            ) : filtered.map((p) => {
                                const badge = STATUS_BADGE[p.status] || { label: p.status || '—', cls: 'bg-white/5 text-gray-400 border-white/10' };
                                const method = METHOD_LABEL[p.payment_method];
                                const MethodIcon = method?.icon;
                                return (
                                    <tr key={p.id} className="hover:bg-white/5 transition-colors">
                                        <td className="px-6 py-4 text-white font-medium">{p.company_name || p.company_id}</td>
                                        <td className="px-6 py-4 text-gray-300">{p.description || '—'}</td>
                                        <td className="px-6 py-4">
                                            {method ? (
                                                <span className={cn('inline-flex items-center gap-1.5 text-sm', method.cls)}>
                                                    {MethodIcon && <MethodIcon size={15} />} {method.label}
                                                </span>
                                            ) : <span className="text-gray-500">—</span>}
                                        </td>
                                        <td className="px-6 py-4 text-white font-bold">{formatMoney(p.amount, p.currency || 'CLP')}</td>
                                        <td className="px-6 py-4">
                                            <span className={cn('text-xs font-bold px-2.5 py-1 rounded-full border', badge.cls)}>{badge.label}</span>
                                        </td>
                                        <td className="px-6 py-4 text-gray-400">{formatDate(p.created_at)}</td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                {p.has_receipt ? (
                                                    <button
                                                        onClick={() => openReceipt(p)}
                                                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-sky-500/15 text-sky-400 text-xs font-bold hover:bg-sky-500/25"
                                                        title="Ver comprobante"
                                                    >
                                                        <Paperclip size={14} /> Comprobante
                                                    </button>
                                                ) : null}
                                                {p.status === 'pending' ? (
                                                    <>
                                                        <button
                                                            onClick={() => handleApprove(p)}
                                                            disabled={busyId === p.id}
                                                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-500/15 text-green-400 text-xs font-bold hover:bg-green-500/25 disabled:opacity-50"
                                                        >
                                                            <Check size={14} /> Aprobar
                                                        </button>
                                                        <button
                                                            onClick={() => handleReject(p)}
                                                            disabled={busyId === p.id}
                                                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-500/15 text-red-400 text-xs font-bold hover:bg-red-500/25 disabled:opacity-50"
                                                        >
                                                            <X size={14} /> Rechazar
                                                        </button>
                                                    </>
                                                ) : (!p.has_receipt && <span className="text-gray-600 text-xs">—</span>)}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
            </>)}

            {receiptView && (
                <ReceiptModal
                    loading={receiptView.loading}
                    data={receiptView.data}
                    onClose={() => setReceiptView(null)}
                />
            )}
        </div>
    );
};

const ReceiptModal = ({ loading, data, onClose }) => {
    const isPdf = typeof data === 'string' && data.startsWith('data:application/pdf');
    return createPortal(
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-[#18181b] border border-white/10 rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
                    <h3 className="font-bold text-white flex items-center gap-2"><Paperclip size={16} className="text-sky-400" /> Comprobante de transferencia</h3>
                    <div className="flex items-center gap-3">
                        {data && (
                            <a
                                href={data}
                                target="_blank"
                                rel="noopener noreferrer"
                                download={isPdf ? 'comprobante.pdf' : 'comprobante.jpg'}
                                className="text-xs font-bold text-sky-400 hover:underline"
                            >
                                Abrir / Descargar
                            </a>
                        )}
                        <button onClick={onClose} className="text-gray-400 hover:text-white p-1"><X size={18} /></button>
                    </div>
                </div>
                <div className="p-4 overflow-auto flex-1 flex items-center justify-center bg-black/30 min-h-[200px]">
                    {loading ? (
                        <span className="text-gray-400 text-sm">Cargando comprobante…</span>
                    ) : !data ? (
                        <span className="text-gray-500 text-sm flex items-center gap-2"><FileText size={16} /> Sin comprobante</span>
                    ) : isPdf ? (
                        <iframe title="comprobante" src={data} className="w-full h-[72vh] rounded-lg bg-white" />
                    ) : (
                        <img src={data} alt="comprobante" className="max-w-full max-h-[72vh] rounded-lg" />
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

const INPUT_CLS ='w-full bg-[#0f0f12] border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:border-[var(--color-primary)] outline-none';

const TransferSettingsForm = () => {
    const { fetchPaymentSettings, savePaymentSettings } = useStore();
    const [form, setForm] = useState({ ...PAYMENT_CONFIG.bankTransfer, paypalUser: PAYMENT_CONFIG.paypalUser });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        let alive = true;
        fetchPaymentSettings().then(cfg => {
            if (!alive || !cfg) return;
            setForm({
                bank: cfg.bankTransfer?.bank ?? PAYMENT_CONFIG.bankTransfer.bank,
                accountType: cfg.bankTransfer?.accountType ?? PAYMENT_CONFIG.bankTransfer.accountType,
                accountNumber: cfg.bankTransfer?.accountNumber ?? PAYMENT_CONFIG.bankTransfer.accountNumber,
                holder: cfg.bankTransfer?.holder ?? PAYMENT_CONFIG.bankTransfer.holder,
                rut: cfg.bankTransfer?.rut ?? PAYMENT_CONFIG.bankTransfer.rut,
                email: cfg.bankTransfer?.email ?? PAYMENT_CONFIG.bankTransfer.email,
                paypalUser: cfg.paypalUser ?? PAYMENT_CONFIG.paypalUser,
            });
        }).finally(() => alive && setLoading(false));
        return () => { alive = false; };
    }, []);

    const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setSaved(false); };

    const save = async () => {
        setSaving(true);
        const config = {
            bankTransfer: {
                bank: form.bank, accountType: form.accountType, accountNumber: form.accountNumber,
                holder: form.holder, rut: form.rut, email: form.email,
            },
            paypalUser: form.paypalUser,
        };
        const r = await savePaymentSettings(config);
        setSaving(false);
        if (r.success) { setSaved(true); setTimeout(() => setSaved(false), 2500); }
        else alert('Error al guardar: ' + r.error);
    };

    if (loading) return <p className="text-gray-500">Cargando…</p>;

    const fields = [
        { k: 'bank', label: 'Banco', ph: 'Ej: Banco Estado' },
        { k: 'accountType', label: 'Tipo de cuenta', ph: 'Ej: Cuenta Corriente' },
        { k: 'accountNumber', label: 'N° de cuenta', ph: '00000000' },
        { k: 'holder', label: 'Titular', ph: 'Nombre del titular' },
        { k: 'rut', label: 'RUT', ph: '00.000.000-0' },
        { k: 'email', label: 'Email para comprobantes', ph: 'pagos@tudominio.com' },
    ];

    return (
        <div className="max-w-2xl space-y-6">
            {/* Datos bancarios */}
            <div className="bg-[#18181b] border border-white/10 rounded-2xl p-6">
                <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-1">
                    <Landmark size={18} className="text-emerald-400" /> Datos de transferencia bancaria
                </h2>
                <p className="text-sm text-gray-400 mb-5">Estos datos los verán tus clientes al elegir pagar por transferencia.</p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {fields.map(f => (
                        <div key={f.k}>
                            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">{f.label}</label>
                            <input
                                type="text"
                                className={INPUT_CLS}
                                placeholder={f.ph}
                                value={form[f.k] || ''}
                                onChange={(e) => set(f.k, e.target.value)}
                            />
                        </div>
                    ))}
                </div>
            </div>

            {/* PayPal */}
            <div className="bg-[#18181b] border border-white/10 rounded-2xl p-6">
                <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-1">
                    <Wallet size={18} className="text-indigo-400" /> PayPal (clientes en USD)
                </h2>
                <p className="text-sm text-gray-400 mb-4">Tu usuario de PayPal.me. Déjalo vacío para mostrar "Próximamente".</p>
                <div className="flex items-center gap-2">
                    <span className="text-gray-500 text-sm">paypal.me/</span>
                    <input
                        type="text"
                        className={INPUT_CLS}
                        placeholder="tuusuario"
                        value={form.paypalUser || ''}
                        onChange={(e) => set('paypalUser', e.target.value.trim())}
                    />
                </div>
            </div>

            <div className="flex items-center gap-3">
                <button
                    onClick={save}
                    disabled={saving}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-[var(--color-primary)] text-black font-bold rounded-xl hover:brightness-110 transition-all text-sm disabled:opacity-60"
                >
                    <Save size={16} /> {saving ? 'Guardando…' : 'Guardar cambios'}
                </button>
                {saved && <span className="text-green-400 text-sm font-medium flex items-center gap-1"><Check size={16} /> Guardado</span>}
            </div>
        </div>
    );
};

export default AdminPayments;
