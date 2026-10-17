import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Printer, Download, Receipt, FileText, Loader2 } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { reportCall } from '../../lib/dataApi';
import { printSaleReceipt } from '../../lib/saleReceipt';
import { configBoleta, descargarBoletaPdf } from '../../lib/comprobanteEnvio';
import { cn } from '../../lib/utils';
import { toast } from '../../lib/toast';

const NOMBRE_DOC = { 39: 'Boleta', 33: 'Factura', 34: 'Factura exenta' };

/**
 * Imprimir o descargar otra vez el documento de una venta ya hecha (boleta,
 * factura o nota de venta). Para el pedido que se entrega ya pagado: si el
 * documento no iba en el paquete, se imprime o se manda en el momento.
 */
export default function DocumentoVenta({ saleId }) {
    const { activeCompanyId, currentCurrency, fetchSaleDetails, users } = useStore();
    const [venta, setVenta] = useState(null);
    const [dte, setDte] = useState(null);
    const [cargando, setCargando] = useState(true);
    const [trabajando, setTrabajando] = useState(null);

    useEffect(() => {
        let vivo = true;
        (async () => {
            setCargando(true);
            const [v, d] = await Promise.all([
                fetchSaleDetails(saleId).catch(() => null),
                reportCall(activeCompanyId, 'dteForSale', { saleId }).catch(() => []),
            ]);
            if (!vivo) return;
            setVenta(v);
            setDte(d?.[0]?.folio ? d[0] : null);
            setCargando(false);
        })();
        return () => { vivo = false; };
    }, [saleId, activeCompanyId, fetchSaleDetails]);

    if (cargando) {
        return <p className="text-xs text-[var(--color-text-muted)] flex items-center justify-center gap-1.5 py-2"><Loader2 size={13} className="animate-spin" /> Buscando el documento…</p>;
    }
    if (!venta) return <p className="text-xs text-[var(--color-text-muted)] text-center py-2">No se encontró la venta #{saleId}.</p>;

    const tipo = Number(dte?.tipo ?? venta.dte_tipo ?? 0) || 0;
    const vendedor = users?.find(u => u.id === venta.user_id)?.name || (venta.user_id ? 'Vendedor' : 'Tienda web');
    const doc = { ...venta, tipoDte: tipo, clientName: venta.clientName || venta.client_name };
    const etiqueta = tipo && dte ? `${NOMBRE_DOC[tipo] || 'Documento'} N° ${dte.folio}` : `Nota de venta N° ${venta.id}`;

    const imprimir = async () => {
        setTrabajando('imprimir');
        try {
            const r = await printSaleReceipt(doc, {
                sellerName: vendedor,
                receiptConfig: await configBoleta(activeCompanyId),
                currency: currentCurrency,
                dteInfo: dte, tedXml: dte?.xml_firmado || null,
            });
            if (!r?.ok) {
                toast(r?.error === 'NO_PRINTER' ? 'Configurá la impresora en Configuración → General → Impresora térmica.'
                    : r?.error === 'POPUP_BLOCKED' ? 'El navegador bloqueó la ventana de impresión.'
                        : `No se pudo imprimir: ${r?.error || ''}`, 'error');
            }
        } finally { setTrabajando(null); }
    };
    const descargar = async () => {
        setTrabajando('descargar');
        try {
            await descargarBoletaPdf(doc, {
                companyId: activeCompanyId, currency: currentCurrency, sellerName: vendedor,
                dteInfo: dte, tedXml: dte?.xml_firmado || null,
            });
        } catch (e) {
            toast(`No se pudo descargar: ${e?.message || e}`, 'error');
        } finally { setTrabajando(null); }
    };

    return (
        <div className="w-full">
            <div className={cn('mx-auto mb-3 w-fit px-3 py-1.5 rounded-full text-xs font-bold border flex items-center gap-1.5',
                tipo ? 'bg-blue-500/15 border-blue-500/40 text-blue-400' : 'bg-[var(--glass-bg)] border-[var(--glass-border)] text-[var(--color-text-muted)]')}>
                {tipo ? <Receipt size={14} /> : <FileText size={14} />} {etiqueta}
            </div>
            <div className="grid grid-cols-2 gap-2">
                <button onClick={imprimir} disabled={!!trabajando}
                    className="py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                    <Printer size={18} /> {trabajando === 'imprimir' ? 'Imprimiendo…' : 'Imprimir'}
                </button>
                <button onClick={descargar} disabled={!!trabajando}
                    className="py-3 rounded-xl border border-[var(--glass-border)] text-[var(--color-text)] font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                    <Download size={18} /> {trabajando === 'descargar' ? 'Generando…' : 'Descargar'}
                </button>
            </div>
        </div>
    );
}

/**
 * Ventana con el documento de una venta. Por defecto es la "Entrega exitosa" de
 * un pedido que ya estaba pagado; con `encabezado` sirve para reimprimir
 * cuando se quiera (p. ej. para meter la boleta en el paquete).
 */
export function EntregaExitosaModal({ titulo, saleId, onClose, encabezado = null }) {
    return createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-3">
            <div className="w-full max-w-md p-5 max-h-full overflow-y-auto rounded-2xl bg-[var(--color-surface)] border border-[var(--glass-border)] shadow-2xl flex flex-col items-center text-center">
                {!encabezado && <CheckCircle2 size={44} className="text-green-400 mb-2" />}
                <h3 className="text-xl font-bold text-[var(--color-text)]">{encabezado || 'Entrega exitosa'}</h3>
                <p className="text-sm text-[var(--color-text-muted)] mb-4">{encabezado ? titulo : `${titulo} entregado · ya estaba pagado`}</p>
                {saleId && <DocumentoVenta saleId={saleId} />}
                <button onClick={onClose} className="mt-3 w-full py-3 rounded-xl border border-[var(--glass-border)] text-[var(--color-text-muted)] font-bold">
                    Cerrar
                </button>
            </div>
        </div>,
        document.body
    );
}
