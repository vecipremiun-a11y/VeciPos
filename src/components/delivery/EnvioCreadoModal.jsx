import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Printer, Download, X, MapPin, Clock, Banknote } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { formatCurrency } from '../../utils/formatCurrency';
import { imprimirComprobanteEnvio, descargarComprobanteEnvio, textoEntrega } from '../../lib/comprobanteEnvio';
import { toast } from '../../lib/toast';

/**
 * "Envío creado": se muestra al despachar un pedido a domicilio. Desde acá se
 * imprime o descarga el comprobante para pegar en el paquete (informativo, no es
 * boleta: la boleta sale al entregar).
 */
export default function EnvioCreadoModal({ envio, onClose }) {
    const { activeCompanyId, currentCurrency } = useStore();
    const [trabajando, setTrabajando] = useState(null);
    if (!envio) return null;

    const plata = (n) => formatCurrency(n, currentCurrency);
    const pedido = typeof envio.order_data === 'string' ? JSON.parse(envio.order_data || 'null') : envio.order_data;
    const entrega = textoEntrega(envio.scheduled_date, envio.scheduled_time);

    const correr = async (que, fn) => {
        setTrabajando(que);
        try {
            const r = await fn(envio, { companyId: activeCompanyId, currency: currentCurrency });
            if (!r?.ok) {
                toast(r?.error === 'NO_PRINTER'
                    ? 'Configurá la impresora en Configuración → General → Impresora térmica.'
                    : r?.error === 'POPUP_BLOCKED'
                        ? 'El navegador bloqueó la ventana de impresión: permití las ventanas emergentes.'
                        : `No se pudo: ${r?.error || ''}`, 'error');
            }
        } catch (e) {
            toast(`No se pudo: ${e?.message || e}`, 'error');
        } finally {
            setTrabajando(null);
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <div className="relative glass-card modal-solido rounded-2xl p-6 w-full max-w-sm max-h-full overflow-y-auto">
                <button onClick={onClose} className="absolute top-4 right-4 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                    <X size={20} />
                </button>
                <div className="flex flex-col items-center text-center mb-4">
                    <CheckCircle2 size={40} className="text-green-400 mb-2" />
                    <h2 className="text-xl font-bold text-[var(--color-text)]">Envío creado</h2>
                    <p className="text-sm text-[var(--color-text-muted)]">#{envio.id} · {envio.client_name || 'Sin cliente'}</p>
                </div>

                <div className="space-y-2 text-sm mb-4">
                    {entrega && (
                        <p className="flex items-center gap-2 text-[var(--color-text)] font-bold">
                            <Clock size={15} className="text-[var(--color-primary)] shrink-0" /> Entrega: {entrega}
                        </p>
                    )}
                    <p className="flex items-start gap-2 text-[var(--color-text-muted)]">
                        <MapPin size={15} className="shrink-0 mt-0.5" /> {envio.address}
                    </p>
                    {Number(envio.amount_to_collect) > 0 && (
                        <p className="flex items-center gap-2 text-amber-400 font-bold">
                            <Banknote size={15} className="shrink-0" /> Cobrar al recibir: {plata(envio.amount_to_collect)}
                        </p>
                    )}
                    {pedido?.items?.length > 0 && (
                        <p className="text-[11px] text-[var(--color-text-muted)]">
                            {pedido.items.length} {pedido.items.length === 1 ? 'producto separado' : 'productos separados'} del stock hasta la entrega.
                        </p>
                    )}
                </div>

                <p className="text-[11px] text-[var(--color-text-muted)] mb-2 text-center">Comprobante para pegar en el paquete</p>
                <div className="grid grid-cols-2 gap-2 mb-3">
                    <button onClick={() => correr('imprimir', imprimirComprobanteEnvio)} disabled={!!trabajando}
                        className="py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                        <Printer size={18} /> {trabajando === 'imprimir' ? 'Imprimiendo…' : 'Imprimir'}
                    </button>
                    <button onClick={() => correr('descargar', descargarComprobanteEnvio)} disabled={!!trabajando}
                        className="py-3 rounded-xl border border-[var(--glass-border)] text-[var(--color-text)] font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                        <Download size={18} /> {trabajando === 'descargar' ? 'Generando…' : 'Descargar'}
                    </button>
                </div>
                <button onClick={onClose}
                    className="w-full py-3 rounded-xl border border-[var(--glass-border)] text-[var(--color-text-muted)] font-bold">
                    Listo
                </button>
            </div>
        </div>,
        document.body
    );
}
