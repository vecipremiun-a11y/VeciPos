import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, CreditCard, Landmark, Clock, ExternalLink, Wallet, Copy, Check, AlertCircle, ChevronRight, Upload, FileText } from 'lucide-react';
import { BILLING_CYCLES, PAYMENT_CONFIG, formatMoney } from '../../config/mercadopago';
import { useStore } from '../../store/useStore';
import { cn } from '../../lib/utils';

// ─── Procesamiento del comprobante de transferencia ──────────────────────────
// Las imágenes se comprimen a JPEG (canvas) para no inflar la BD; los PDF se
// guardan tal cual si pesan poco. Todo termina como data URL base64 en payments.
const MAX_INPUT_BYTES = 10 * 1024 * 1024;   // 10 MB de entrada
const MAX_STORED_LEN = 1_400_000;           // ~1 MB ya en base64

function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(new Error('No se pudo leer el archivo.'));
        r.readAsDataURL(file);
    });
}

function compressImage(dataUrl, maxDim = 1500, quality = 0.72) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            let { width, height } = img;
            if (width > maxDim || height > maxDim) {
                const scale = maxDim / Math.max(width, height);
                width = Math.round(width * scale);
                height = Math.round(height * scale);
            }
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            let q = quality;
            let out = canvas.toDataURL('image/jpeg', q);
            while (out.length > MAX_STORED_LEN && q > 0.4) {
                q -= 0.12;
                out = canvas.toDataURL('image/jpeg', q);
            }
            resolve(out);
        };
        img.onerror = () => reject(new Error('decode'));
        img.src = dataUrl;
    });
}

async function processReceiptFile(file) {
    const isImage = file.type.startsWith('image/');
    const isPdf = file.type === 'application/pdf';
    if (!isImage && !isPdf) throw new Error('Formato no válido. Sube una imagen o un PDF.');
    if (file.size > MAX_INPUT_BYTES) throw new Error('El archivo supera los 10 MB.');

    const dataUrl = await readAsDataURL(file);
    if (isImage) {
        try {
            return await compressImage(dataUrl);
        } catch {
            if (dataUrl.length <= MAX_STORED_LEN) return dataUrl; // navegador no decodificó (HEIC, etc.)
            throw new Error('No se pudo procesar la imagen. Intenta con una foto JPG o PNG.');
        }
    }
    // PDF
    if (dataUrl.length > MAX_STORED_LEN) throw new Error('El PDF es muy pesado (máx ~1 MB). Envía una foto o un PDF más liviano.');
    return dataUrl;
}

const PlanCheckoutModal = ({ plan, billingCycle, currency, companyId, onClose }) => {
    const { registerTransferIntent, fetchPaymentSettings } = useStore();
    const [loading, setLoading] = useState(null); // 'mp' mientras redirige
    const [error, setError] = useState('');
    const [openTransfer, setOpenTransfer] = useState(false);
    const [copied, setCopied] = useState(false);
    const [transferState, setTransferState] = useState(null); // 'loading' | 'done'
    const [payConfig, setPayConfig] = useState(PAYMENT_CONFIG); // datos editados por el admin
    const [receipt, setReceipt] = useState(null); // { dataUrl, name, isImage }
    const [receiptBusy, setReceiptBusy] = useState(false);
    const fileInputRef = useRef(null);

    // Carga los datos de pago configurados por el admin (con PAYMENT_CONFIG como respaldo)
    useEffect(() => {
        let alive = true;
        fetchPaymentSettings?.().then(cfg => {
            if (alive && cfg) setPayConfig({
                bankTransfer: { ...PAYMENT_CONFIG.bankTransfer, ...(cfg.bankTransfer || {}) },
                paypalUser: cfg.paypalUser ?? PAYMENT_CONFIG.paypalUser,
            });
        }).catch(() => {});
        return () => { alive = false; };
    }, [fetchPaymentSettings]);

    const amount = plan.prices[currency][billingCycle];
    const cycleLabel = BILLING_CYCLES[billingCycle].label;
    const bank = payConfig.bankTransfer;

    const onPickReceipt = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // permite re-seleccionar el mismo archivo
        if (!file) return;
        setError('');
        setReceiptBusy(true);
        try {
            const dataUrl = await processReceiptFile(file);
            setReceipt({ dataUrl, name: file.name, isImage: dataUrl.startsWith('data:image/') });
        } catch (err) {
            setReceipt(null);
            setError(err.message || 'No se pudo subir el comprobante.');
        } finally {
            setReceiptBusy(false);
        }
    };

    const registerTransfer = async () => {
        setError('');
        setTransferState('loading');
        const r = await registerTransferIntent({
            companyId, planId: plan.id, billingCycle, amount, currency,
            planName: `${plan.name} (${cycleLabel})`,
            receiptData: receipt?.dataUrl || null,
        });
        if (r?.success) {
            setTransferState('done');
        } else {
            setError(r?.error || 'No se pudo registrar la transferencia.');
            setTransferState(null);
        }
    };

    // Pagar con MercadoPago → crea preferencia y redirige
    const payWithMercadoPago = async () => {
        setError('');
        setLoading('mp');
        try {
            const res = await fetch('/api/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ companyId, planId: plan.id, billingCycle }),
            });
            const data = await res.json();
            if (data.success && data.init_point) {
                window.location.href = data.init_point;
            } else {
                setError(data.error || 'No se pudo iniciar el pago.');
                setLoading(null);
            }
        } catch (err) {
            console.error('Error MercadoPago:', err);
            setError('Error de conexión. Intenta nuevamente.');
            setLoading(null);
        }
    };

    const payWithPaypal = () => {
        if (!payConfig.paypalUser) return;
        const url = `https://paypal.me/${payConfig.paypalUser}/${amount}USD`;
        window.open(url, '_blank', 'noopener');
    };

    const copyBankDetails = async () => {
        const text = `Banco: ${bank.bank}\nTipo: ${bank.accountType}\nN°: ${bank.accountNumber}\nTitular: ${bank.holder}\nRUT: ${bank.rut}\nEmail: ${bank.email}\nMonto: ${formatMoney(amount, currency)}`;
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            const ta = document.createElement('textarea');
            ta.value = text; document.body.appendChild(ta); ta.select();
            try { document.execCommand('copy'); } catch { /* noop */ }
            document.body.removeChild(ta);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const showMercadoPago = currency === 'CLP';
    const showPaypal = currency === 'USD';

    return createPortal(
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="glass-card w-full max-w-md max-h-[90vh] overflow-y-auto border border-white/10 shadow-2xl !bg-[#18181b] !backdrop-blur-none"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-start justify-between mb-1">
                    <div>
                        <h3 className="text-lg font-bold text-[var(--color-text)]">Contratar {plan.name}</h3>
                        <p className="text-sm text-[var(--color-text-muted)]">Facturación {cycleLabel.toLowerCase()}</p>
                    </div>
                    <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] p-1">
                        <X size={20} />
                    </button>
                </div>

                {/* Monto */}
                <div className="flex items-baseline gap-1 my-4">
                    <span className="text-3xl font-extrabold text-[var(--color-text)]">{formatMoney(amount, currency)}</span>
                    <span className="text-[var(--color-text-muted)] text-sm">{BILLING_CYCLES[billingCycle].suffix} · {currency}</span>
                </div>

                <p className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">Elige cómo pagar</p>

                <div className="space-y-3">
                    {/* MercadoPago (CLP) */}
                    {showMercadoPago && (
                        <button
                            onClick={payWithMercadoPago}
                            disabled={loading === 'mp'}
                            className="w-full flex items-center gap-3 p-4 rounded-xl border border-[var(--glass-border)] hover:border-[var(--color-primary)]/60 hover:bg-[var(--color-primary)]/5 transition-all text-left disabled:opacity-60"
                        >
                            <div className="p-2 rounded-lg bg-sky-500/15 text-sky-400"><CreditCard size={20} /></div>
                            <div className="flex-1">
                                <p className="font-bold text-[var(--color-text)]">MercadoPago</p>
                                <p className="text-xs text-[var(--color-text-muted)]">Tarjeta de crédito/débito. Activación inmediata.</p>
                            </div>
                            <span className="text-xs font-bold text-[var(--color-primary)]">
                                {loading === 'mp' ? 'Redirigiendo…' : 'Pagar'}
                            </span>
                        </button>
                    )}

                    {/* PayPal (USD) */}
                    {showPaypal && (
                        <button
                            onClick={payWithPaypal}
                            disabled={!payConfig.paypalUser}
                            className="w-full flex items-center gap-3 p-4 rounded-xl border border-[var(--glass-border)] hover:border-[var(--color-primary)]/60 hover:bg-[var(--color-primary)]/5 transition-all text-left disabled:opacity-50"
                        >
                            <div className="p-2 rounded-lg bg-indigo-500/15 text-indigo-400"><Wallet size={20} /></div>
                            <div className="flex-1">
                                <p className="font-bold text-[var(--color-text)]">PayPal</p>
                                <p className="text-xs text-[var(--color-text-muted)]">Paga en USD desde cualquier país.</p>
                            </div>
                            <span className="text-xs font-bold text-[var(--color-primary)] flex items-center gap-1">
                                {payConfig.paypalUser ? <>Pagar <ExternalLink size={12} /></> : 'Próximamente'}
                            </span>
                        </button>
                    )}

                    {/* Transferencia bancaria (siempre) */}
                    <div className="rounded-xl border border-[var(--glass-border)] overflow-hidden">
                        <button
                            onClick={() => setOpenTransfer(v => !v)}
                            className="w-full flex items-center gap-3 p-4 hover:bg-[var(--glass-bg)] transition-all text-left"
                        >
                            <div className="p-2 rounded-lg bg-emerald-500/15 text-emerald-400"><Landmark size={20} /></div>
                            <div className="flex-1">
                                <p className="font-bold text-[var(--color-text)]">Transferencia bancaria</p>
                                <p className="text-xs text-[var(--color-text-muted)]">Activación manual (hasta 24 hrs hábiles).</p>
                            </div>
                            <ChevronRight size={18} className={cn('text-[var(--color-text-muted)] transition-transform', openTransfer && 'rotate-90')} />
                        </button>

                        {openTransfer && (
                            <div className="px-4 pb-4 pt-1 space-y-3 border-t border-[var(--glass-border)]">
                                <div className="text-sm text-[var(--color-text)] space-y-1 pt-3">
                                    <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Banco</span><span className="font-medium">{bank.bank}</span></div>
                                    <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Tipo</span><span className="font-medium">{bank.accountType}</span></div>
                                    <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">N° cuenta</span><span className="font-medium">{bank.accountNumber}</span></div>
                                    <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Titular</span><span className="font-medium">{bank.holder}</span></div>
                                    <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">RUT</span><span className="font-medium">{bank.rut}</span></div>
                                    <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Email</span><span className="font-medium">{bank.email}</span></div>
                                    <div className="flex justify-between pt-1 border-t border-[var(--glass-border)] mt-1"><span className="text-[var(--color-text-muted)]">Monto</span><span className="font-bold text-[var(--color-primary)]">{formatMoney(amount, currency)}</span></div>
                                </div>

                                <button
                                    onClick={copyBankDetails}
                                    className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-[var(--color-primary)]/40 text-[var(--color-primary)] text-sm font-bold hover:bg-[var(--color-primary)]/10"
                                >
                                    {copied ? <><Check size={14} /> Copiado</> : <><Copy size={14} /> Copiar datos</>}
                                </button>

                                <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
                                    <Clock size={14} className="mt-0.5 flex-shrink-0" />
                                    <span>Adjunta tu comprobante aquí o envíalo a <strong>{bank.email}</strong>. La activación del plan puede demorar hasta <strong>24 horas hábiles</strong>.</span>
                                </div>

                                {/* Subir comprobante (foto o PDF) */}
                                {transferState !== 'done' && (
                                    <div>
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept="image/*,application/pdf"
                                            className="hidden"
                                            onChange={onPickReceipt}
                                        />
                                        {receipt ? (
                                            <div className="flex items-center gap-3 p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
                                                {receipt.isImage ? (
                                                    <img src={receipt.dataUrl} alt="comprobante" className="w-10 h-10 rounded object-cover flex-shrink-0" />
                                                ) : (
                                                    <div className="w-10 h-10 rounded bg-emerald-500/15 text-emerald-400 flex items-center justify-center flex-shrink-0"><FileText size={18} /></div>
                                                )}
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm text-[var(--color-text)] truncate">{receipt.name}</p>
                                                    <p className="text-xs text-emerald-400 flex items-center gap-1"><Check size={12} /> Comprobante listo</p>
                                                </div>
                                                <button
                                                    onClick={() => setReceipt(null)}
                                                    className="text-[var(--color-text-muted)] hover:text-red-400 p-1 flex-shrink-0"
                                                    title="Quitar comprobante"
                                                >
                                                    <X size={16} />
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => fileInputRef.current?.click()}
                                                disabled={receiptBusy}
                                                className="w-full flex items-center justify-center gap-2 py-3 rounded-lg border border-dashed border-[var(--glass-border)] text-sm font-medium text-[var(--color-text-muted)] hover:border-[var(--color-primary)]/60 hover:text-[var(--color-primary)] transition-colors disabled:opacity-60"
                                            >
                                                {receiptBusy ? 'Procesando…' : <><Upload size={15} /> Adjuntar comprobante (foto o PDF)</>}
                                            </button>
                                        )}
                                    </div>
                                )}

                                {transferState === 'done' ? (
                                    <div className="flex items-start gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2.5">
                                        <Check size={14} className="mt-0.5 flex-shrink-0" />
                                        <span>¡Listo! Registramos tu transferencia. Activaremos tu plan en cuanto verifiquemos el pago (hasta 24 hrs hábiles).</span>
                                    </div>
                                ) : (
                                    <button
                                        onClick={registerTransfer}
                                        disabled={transferState === 'loading' || receiptBusy}
                                        className="w-full py-2 rounded-lg bg-emerald-500/15 text-emerald-400 text-sm font-bold hover:bg-emerald-500/25 transition-colors disabled:opacity-60"
                                    >
                                        {transferState === 'loading' ? 'Registrando…' : 'Ya hice la transferencia'}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {error && (
                    <div className="mt-4 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg p-3 text-sm flex items-center gap-2">
                        <AlertCircle size={16} /> {error}
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
};

export default PlanCheckoutModal;
