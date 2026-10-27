import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, X, Camera, Banknote, CreditCard, Landmark, Receipt, FileText, Printer, Download, CheckCircle2, Clock, AlertTriangle, ExternalLink } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { formatCurrency } from '../../utils/formatCurrency';
import { reportCall } from '../../lib/dataApi';
import { printSaleReceipt } from '../../lib/saleReceipt';
import { configBoleta, descargarBoletaPdf } from '../../lib/comprobanteEnvio';
import { formatoAImprimir } from '../../lib/formatoImpresion';
import { cn } from '../../lib/utils';
import { toast } from '../../lib/toast';

const RECEIVERS = [
    { id: 'cliente', label: 'El cliente' },
    { id: 'familiar', label: 'Un familiar' },
    { id: 'conserje', label: 'Conserje' },
    { id: 'otro', label: 'Otra persona' },
];
const MEDIOS = [
    { id: 'Efectivo', label: 'Efectivo', Icon: Banknote },
    { id: 'Transferencia', label: 'Transferencia', Icon: Landmark },
    { id: 'Tarjeta', label: 'Tarjeta', Icon: CreditCard },
];

/**
 * Cobrar y entregar un pedido que se paga al recibir.
 *
 * Es el momento en que nace la venta: se elige el medio de pago y si va boleta
 * o nota de venta (por defecto, nota de venta). Después de "Entrega exitosa" se
 * puede imprimir o descargar el documento.
 *
 *   · `envio`  un envío: el pedido a domicilio del POS (`source_type = 'pedido'`)
 *               o un pedido de la tienda web (`'preorder'`). Lo usan el modo
 *               repartidor y la bandeja de Envíos; se anota quién recibió.
 *   · `pedido` un pedido de la tienda web que se cobra en el local (retiro, o el
 *               despacho que vuelve a la caja). Lo usa la pestaña Tienda.
 *   · `confirmarPago` (con `pedido`): transferencia que el local revisó. El medio
 *               es Transferencia, la venta nace acá y el pedido pasa a Preparando.
 *   · `documento` (con `pedido`): pedido pagado con Mercado Pago. No se cobra: se
 *               hace la boleta, o la factura si el cliente la pidió con sus datos.
 */
export default function CobrarEnvioModal({ envio = null, pedido = null, confirmarPago = false, documento = false, onClose, onDone }) {
    const { activeCompanyId, currentCurrency, currentUser, cobrarEntregarPedido, cobrarPedidoTienda } = useStore();
    const plata = (n) => formatCurrency(n, currentCurrency);
    const enLocal = !!pedido;
    const aCobrar = documento
        ? Number(pedido.total_amount) || 0
        : enLocal
            ? Number(pedido.remaining_amount) || 0
            : Number(envio?.pendiente_real ?? envio?.amount_to_collect) || 0;
    // Datos de factura que el cliente dejó en la tienda (si la pidió), con
    // cualquier medio de pago (14-oct-2026): el documento va a ser factura.
    const factura = (() => {
        const raw = pedido?.invoice_data ?? envio?.invoice_data;
        if (!raw) return null;
        try { return JSON.parse(raw); } catch { return null; }
    })();
    const titulo = enLocal ? `Pedido #${pedido.external_public_code || pedido.id}` : `Envío #${envio?.id}`;
    const cliente = enLocal ? pedido.client_name : envio?.client_name;

    const [kind, setKind] = useState('cliente');
    const [name, setName] = useState('');
    const [photo, setPhoto] = useState(null);
    const [medio, setMedio] = useState(documento ? 'Mercado Pago' : confirmarPago ? 'Transferencia' : 'Efectivo');
    const [docs, setDocs] = useState({ boleta: false, factura: false, cargando: true });
    const [tipoDte, setTipoDte] = useState(0);
    const [cobrando, setCobrando] = useState(false);
    const [error, setError] = useState(null);
    const [hecho, setHecho] = useState(null);       // { venta, saleId }
    const [dte, setDte] = useState(null);           // { folio, xml_firmado, status }
    const [trabajando, setTrabajando] = useState(null);
    const fileRef = useRef(null);

    // ¿La empresa emite boletas? Mismo criterio que el POS (sii_config).
    useEffect(() => {
        let vivo = true;
        reportCall(activeCompanyId, 'siiConfigPos', {})
            .then(rows => {
                if (!vivo) return;
                const r = rows?.[0];
                let dtes = [0];
                try { dtes = r?.enabled_dtes ? JSON.parse(r.enabled_dtes) : [0]; } catch { dtes = [0]; }
                const boleta = Number(r?.is_active) === 1 && dtes.includes(39);
                const conFactura = Number(r?.is_active) === 1 && dtes.includes(33);
                setDocs({ boleta, factura: conFactura, cargando: false });
                // Pidió factura (y la empresa factura): el documento es factura, con
                // sus datos, en cualquier medio de pago. Mercado Pago sin factura:
                // boleta; sin SII, nota de venta. Lo demás, se elige (nota por defecto).
                if (factura && conFactura) setTipoDte(33);
                else if (documento) setTipoDte(boleta ? 39 : 0);
            })
            .catch(() => vivo && setDocs({ boleta: false, factura: false, cargando: false }));
        return () => { vivo = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeCompanyId]);

    // Boleta o factura: el folio y el timbre llegan unos segundos después de la venta.
    useEffect(() => {
        if (!hecho?.saleId || ![39, 33].includes(tipoDte)) return;
        let vivo = true;
        let intentos = 0;
        const mirar = async () => {
            try {
                const rows = await reportCall(activeCompanyId, 'dteForSale', { saleId: hecho.saleId });
                if (!vivo) return;
                if (rows?.[0]?.folio) { setDte(rows[0]); return; }
            } catch { /* se reintenta */ }
            if (vivo && ++intentos < 20) setTimeout(mirar, 2000);
        };
        mirar();
        return () => { vivo = false; };
    }, [hecho, tipoDte, activeCompanyId]);

    if (!envio && !pedido) return null;

    const onPick = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                const max = 900;
                const escala = Math.min(1, max / Math.max(img.width, img.height));
                const cv = document.createElement('canvas');
                cv.width = Math.round(img.width * escala);
                cv.height = Math.round(img.height * escala);
                cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
                setPhoto(cv.toDataURL('image/jpeg', 0.6));
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    };

    const puedeCobrar = !cobrando && !docs.cargando && (enLocal || kind !== 'otro' || name.trim().length > 1);

    const cobrar = async () => {
        setCobrando(true);
        setError(null);
        const conFactura = tipoDte === 33 && factura ? {
            invoiceData: {
                rut_receptor: factura.rut, razon_social_receptor: factura.razon_social,
                giro_receptor: factura.giro || '', dir_receptor: factura.direccion || '',
                comuna_receptor: factura.comuna || '', ciudad_receptor: factura.ciudad || '',
            },
        } : {};
        const cobro = enLocal
            ? { paymentMethod: medio, tipoDte, collectedAmount: aCobrar, ...conFactura }
            : {
                ...conFactura,
                paymentMethod: medio,
                tipoDte,
                collectedAmount: aCobrar,
                receivedByKind: kind,
                receivedBy: kind === 'otro' ? name.trim() : (RECEIVERS.find(x => x.id === kind)?.label || null),
                proofPhoto: photo,
            };
        const r = enLocal
            ? await cobrarPedidoTienda(pedido, cobro, { confirmarPago, documento })
            : envio.source_type === 'preorder'
                ? await cobrarPedidoTienda({ id: envio.source_id }, cobro, { envio })
                : await cobrarEntregarPedido(envio, cobro);
        setCobrando(false);
        if (!r?.success) { setError(r?.error || 'No se pudo cobrar'); return; }
        if (r.cashWarning) toast(r.cashWarning, 'error');
        setHecho({ venta: r.venta, saleId: r.saleId });
        onDone?.(r);
    };

    const ventaParaDoc = () => ({ ...hecho.venta, tipoDte, clientName: hecho.venta.client?.name || hecho.venta.clientName || cliente });
    const esperandoTimbre = [39, 33].includes(tipoDte) && !dte;
    const nombreDoc = tipoDte === 33 ? 'factura' : tipoDte === 39 ? 'boleta' : 'nota de venta';

    const imprimir = async () => {
        setTrabajando('imprimir');
        try {
            const receiptConfig = await configBoleta(activeCompanyId);
            const r = await printSaleReceipt(ventaParaDoc(), {
                sellerName: currentUser?.name || currentUser?.username,
                receiptConfig,
                currency: currentCurrency,
                dteInfo: dte, tedXml: dte?.xml_firmado || null,
                formato: formatoAImprimir(receiptConfig, activeCompanyId, currentUser?.id),
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
            await descargarBoletaPdf(ventaParaDoc(), {
                companyId: activeCompanyId, currency: currentCurrency,
                sellerName: currentUser?.name || currentUser?.username,
                dteInfo: dte, tedXml: dte?.xml_firmado || null,
            });
        } catch (e) {
            toast(`No se pudo descargar: ${e?.message || e}`, 'error');
        } finally { setTrabajando(null); }
    };

    const contenido = hecho ? (
        // ── Cobro exitoso ──
        <div className="flex flex-col items-center text-center">
            <CheckCircle2 size={44} className="text-green-400 mb-2" />
            <h3 className="text-xl font-bold text-[var(--color-text)]">
                {documento ? (tipoDte === 33 ? 'Factura hecha' : tipoDte === 39 ? 'Boleta hecha' : 'Venta registrada')
                    : confirmarPago ? 'Pago confirmado' : 'Entrega exitosa'}
            </h3>
            <p className="text-sm text-[var(--color-text-muted)] mb-1">
                {documento ? titulo : confirmarPago ? `${titulo} pasa a Preparando` : `${titulo} entregado`} · Venta #{hecho.saleId}
            </p>
            <p className="text-3xl font-black text-[var(--color-primary)] my-2">{plata(aCobrar)}</p>
            <p className="text-xs text-[var(--color-text-muted)] mb-4">{medio}</p>
            <div className={cn('mb-4 px-3 py-1.5 rounded-full text-xs font-bold border flex items-center gap-1.5',
                tipoDte ? 'bg-blue-500/15 border-blue-500/40 text-blue-400' : 'bg-[var(--glass-bg)] border-[var(--glass-border)] text-[var(--color-text-muted)]')}>
                {tipoDte ? <Receipt size={14} /> : <FileText size={14} />}
                {tipoDte
                    ? (dte ? `${tipoDte === 33 ? 'Factura' : 'Boleta'} N° ${dte.folio}` : <><Clock size={13} className="animate-pulse" /> Emitiendo {nombreDoc}…</>)
                    : `Nota de venta N° ${hecho.saleId}`}
            </div>
            <div className="grid grid-cols-2 gap-2 w-full mb-3">
                <button onClick={imprimir} disabled={!!trabajando || esperandoTimbre}
                    className="py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                    <Printer size={18} /> {esperandoTimbre ? 'Esperando…' : trabajando === 'imprimir' ? 'Imprimiendo…' : 'Imprimir'}
                </button>
                <button onClick={descargar} disabled={!!trabajando || esperandoTimbre}
                    className="py-3 rounded-xl border border-[var(--glass-border)] text-[var(--color-text)] font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                    <Download size={18} /> {trabajando === 'descargar' ? 'Generando…' : 'Descargar'}
                </button>
            </div>
            <button onClick={onClose} className="w-full py-3 rounded-xl border border-[var(--glass-border)] text-[var(--color-text-muted)] font-bold">
                Cerrar
            </button>
        </div>
    ) : (
        // ── Cobrar y entregar ──
        <>
            <div className="flex items-center justify-between mb-1">
                <h3 className="text-lg font-bold text-[var(--color-text)] flex items-center gap-2">
                    <Check className="text-emerald-400" size={20} /> {documento ? `Hacer ${nombreDoc}` : confirmarPago ? 'Confirmar transferencia' : enLocal ? 'Cobrar' : 'Cobrar y entregar'}
                </h3>
                <button onClick={onClose} disabled={cobrando} className="text-[var(--color-text-muted)]"><X size={20} /></button>
            </div>
            <p className="text-sm text-[var(--color-text-muted)] mb-4">{titulo} · {cliente}</p>

            <div className="mb-4 p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 flex items-center justify-between">
                <span className="text-sm text-amber-400 font-bold">{documento ? 'Pagado con Mercado Pago' : confirmarPago ? 'Monto a transferir' : 'A cobrar'}</span>
                <span className="text-xl font-black text-amber-400">{plata(aCobrar)}</span>
            </div>
            {confirmarPago && pedido?.payment_proof_url && (
                <a href={pedido.payment_proof_url} target="_blank" rel="noopener noreferrer"
                    className="mb-4 w-full py-2.5 rounded-xl border border-[var(--glass-border)] text-[var(--color-text)] text-sm font-bold flex items-center justify-center gap-2">
                    <ExternalLink size={16} /> Ver comprobante
                </a>
            )}

            {!enLocal && (<>
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">¿Quién recibió?</p>
            <div className="grid grid-cols-2 gap-2 mb-3">
                {RECEIVERS.map(r => (
                    <button key={r.id} type="button" onClick={() => setKind(r.id)}
                        className={cn('py-2.5 rounded-lg text-sm font-bold border transition-all',
                            kind === r.id ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                                : 'border-[var(--glass-border)] text-[var(--color-text-muted)]')}>
                        {r.label}
                    </button>
                ))}
            </div>
            {kind === 'otro' && (
                <input value={name} onChange={e => setName(e.target.value)} autoFocus
                    className="glass-input w-full mb-3" placeholder="Nombre de quien recibió" />
            )}

            <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPick} className="hidden" />
            {photo ? (
                <div className="relative mb-4">
                    <img src={photo} alt="Constancia" className="w-full rounded-xl max-h-40 object-cover" />
                    <button type="button" onClick={() => setPhoto(null)} className="absolute top-2 right-2 p-1.5 rounded-full bg-black/70 text-white"><X size={14} /></button>
                </div>
            ) : (
                <button type="button" onClick={() => fileRef.current?.click()}
                    className="w-full py-3 mb-4 rounded-xl border-2 border-dashed border-[var(--glass-border)] text-[var(--color-text-muted)] flex items-center justify-center gap-2 text-sm font-bold">
                    <Camera size={18} /> Foto del pedido (opcional)
                </button>
            )}
            </>)}

            {tipoDte === 33 && factura && (
                <div className="mb-4 p-3 rounded-xl border border-blue-500/30 bg-blue-500/10 text-xs text-left space-y-0.5">
                    <p className="font-bold text-blue-400 mb-1">Datos de la factura (los dejó el cliente)</p>
                    <p className="text-[var(--color-text)]">{factura.razon_social} · RUT {factura.rut}</p>
                    {factura.giro && <p className="text-[var(--color-text-muted)]">Giro: {factura.giro}</p>}
                    {(factura.direccion || factura.comuna) && <p className="text-[var(--color-text-muted)]">{[factura.direccion, factura.comuna, factura.ciudad].filter(Boolean).join(', ')}</p>}
                </div>
            )}
            {factura && !docs.cargando && !docs.factura && (
                <p className="mb-4 text-xs text-amber-400">El cliente pidió factura, pero la factura electrónica no está activa{documento ? `: se hará ${nombreDoc}` : ''}.</p>
            )}

            {!confirmarPago && !documento && (<>
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">Medio de pago</p>
            <div className="grid grid-cols-3 gap-2 mb-4">
                {MEDIOS.map(({ id, label, Icon }) => (
                    <button key={id} type="button" onClick={() => setMedio(id)}
                        className={cn('py-2.5 rounded-lg text-xs font-bold border flex flex-col items-center gap-1 transition-all',
                            medio === id ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                                : 'border-[var(--glass-border)] text-[var(--color-text-muted)]')}>
                        <Icon size={18} /> {label}
                    </button>
                ))}
            </div>
            </>)}

            {!documento && !(factura && docs.factura) && (<>
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">Documento</p>
            <div className="grid grid-cols-2 gap-2 mb-4">
                {docs.boleta && (
                    <button type="button" onClick={() => setTipoDte(39)}
                        className={cn('py-2.5 rounded-lg text-sm font-bold border flex items-center justify-center gap-1.5',
                            tipoDte === 39 ? 'border-blue-500 bg-blue-500/10 text-blue-400' : 'border-[var(--glass-border)] text-[var(--color-text-muted)]')}>
                        <Receipt size={16} /> Boleta
                    </button>
                )}
                <button type="button" onClick={() => setTipoDte(0)}
                    className={cn('py-2.5 rounded-lg text-sm font-bold border flex items-center justify-center gap-1.5',
                        !docs.boleta && 'col-span-2',
                        tipoDte === 0 ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'border-[var(--glass-border)] text-[var(--color-text-muted)]')}>
                    <FileText size={16} /> Nota de venta
                </button>
            </div>
            </>)}

            {error && (
                <p className="mb-3 text-xs text-red-400 flex items-start gap-1.5">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {error}
                </p>
            )}

            <div className="flex gap-3">
                <button type="button" onClick={onClose} disabled={cobrando}
                    className="flex-1 py-3 rounded-xl border border-[var(--glass-border)] text-[var(--color-text-muted)] font-bold">
                    Cancelar
                </button>
                <button type="button" onClick={cobrar} disabled={!puedeCobrar}
                    className="flex-[2] py-3 rounded-xl bg-emerald-500 text-black font-bold disabled:opacity-40">
                    {cobrando ? (documento ? 'Haciendo…' : confirmarPago ? 'Confirmando…' : 'Cobrando…')
                        : `${documento ? `Hacer ${nombreDoc}` : confirmarPago ? 'Confirmar pago' : 'Cobrar'} ${plata(aCobrar)}`}
                </button>
            </div>
        </>
    );

    return createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-3">
            <div className="w-full max-w-md p-5 max-h-full overflow-y-auto rounded-2xl bg-[var(--color-surface)] border border-[var(--glass-border)] shadow-2xl">
                {contenido}
            </div>
        </div>,
        document.body
    );
}
