import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Camera, AlertTriangle, CheckCircle2, Loader2, FileWarning } from 'lucide-react';
import { useStore } from '../store/useStore';
import { achicarImagen } from '../lib/dictado';
import { fetchConLimite } from '../lib/conectividad';
import { formatCurrency } from '../utils/formatCurrency';
import { toast } from '../lib/toast';

// Foto de factura → pedido creado, sin conversación de por medio.
//
// El asistente ya sabía hacer esto, pero había que entrar a otra pantalla,
// escribir la instrucción y esperar la respuesta. Acá es un botón: se saca la
// foto y el pedido queda hecho.
//
// Lo importante de esta pantalla NO es lo que cargó — eso se ve en el pedido —
// sino lo que NO cargó. Un renglón que quedó afuera y nadie vio se descubre
// semanas después, cuando el stock no cuadra. Por eso los que quedaron afuera
// van primero, con el motivo, y la diferencia contra el total impreso en la
// factura se muestra en plata.

const CargarFacturaModal = ({ archivo, onClose, onCreado }) => {
    const { activeCompanyId, currentCurrency, addItemsToSupplierOrder } = useStore();

    const [estado, setEstado] = useState('leyendo');   // leyendo | error | listo
    const [error, setError] = useState(null);
    const [resultado, setResultado] = useState(null);
    const [vistaPrevia, setVistaPrevia] = useState(null);
    const [enlazando, setEnlazando] = useState(null);  // "posición:idProducto" en curso

    // Evita que una respuesta que llega tarde escriba sobre una pantalla ya
    // cerrada: leer una factura tarda, y el usuario puede cerrar mientras tanto.
    //
    // Se vuelve a marcar como viva al entrar, no solo al crearse: en desarrollo
    // React monta, desmonta y vuelve a montar. Sin esta línea la ventana quedaba
    // marcada como muerta desde el primer desmonte y descartaba en silencio la
    // respuesta que sí venía en camino — el spinner giraba para siempre.
    const vivo = useRef(true);
    useEffect(() => {
        vivo.current = true;
        return () => { vivo.current = false; };
    }, []);

    // El aviso al padre va por referencia y no por dependencia del efecto: si
    // entrara como dependencia, cada render del padre volvería a dispararlo y se
    // crearía el pedido de nuevo.
    const avisar = useRef(onCreado);
    avisar.current = onCreado;

    // Este efecto crea un pedido de verdad, así que tiene que correr UNA vez y
    // nada más. En desarrollo React monta los componentes dos veces a propósito,
    // y sin este candado eso serían dos pedidos por cada foto.
    const yaMandado = useRef(false);

    // Ojo con el candado de arriba: la lectura NO se cancela al desmontar. Si se
    // cancelara, el desmonte de desarrollo mataría el único envío permitido y no
    // habría un segundo. Quien decide si el resultado se muestra es `vivo`.
    useEffect(() => {
        if (yaMandado.current) return;
        yaMandado.current = true;

        (async () => {
            try {
                const foto = await achicarImagen(archivo);
                if (!vivo.current) return;
                setVistaPrevia(foto.dataUrl);

                // Dos minutos de plazo, no los 12 segundos del resto del sistema:
                // una factura de 20 renglones se lee en unos 20, pero una foto
                // pesada o borrosa da más trabajo. Lo que no puede pasar es quedar
                // esperando para siempre — de ahí el corte. Este camino no toca el
                // detector de conexión, así que tardar no manda la app a offline.
                const r = await fetchConLimite('/api/ai/factura-pedido', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ companyId: activeCompanyId, imagen: foto.dataUrl }),
                }, 120000);
                const data = await r.json().catch(() => null);
                if (!vivo.current) return;

                if (!data) { setError('El servidor respondió algo que no se entiende.'); setEstado('error'); return; }
                if (!data.success) {
                    setError(data.message || data.error || 'No se pudo leer la factura.');
                    setResultado(data.sinEmparejar?.length ? data : null);
                    setEstado('error');
                    return;
                }
                setResultado(data);
                setEstado('listo');
                avisar.current?.(data);
            } catch (e) {
                if (!vivo.current) return;
                const porTiempo = e?.name === 'TimeoutError' || e?.name === 'AbortError';
                setError(porTiempo
                    ? 'La lectura se pasó de los dos minutos. Puede que la foto esté muy pesada o borrosa: probá sacarla más de cerca y con buena luz.'
                    : 'No se pudo enviar la foto: ' + e.message);
                setEstado('error');
            }
        })();
    }, [archivo, activeCompanyId]);

    const plata = (n) => formatCurrency(n, currentCurrency);
    const sinEmparejar = resultado?.sinEmparejar || [];

    // Enganchar a mano un renglón que quedó ambiguo.
    //
    // El emparejador se niega a elegir cuando dos productos puntúan igual, y hace
    // bien: la diferencia está justo en la palabra que importa —el sabor, el
    // gramaje— y adivinar mal desajusta el stock en silencio. Pero la persona que
    // tiene la factura en la mano sí sabe cuál era, y hasta ahora tenía que
    // cerrar, entrar al pedido y buscar el producto de nuevo. Con un toque queda.
    //
    // La cantidad y el costo salen de la factura, no se vuelven a pedir: ya se
    // leyeron bien, lo único que faltaba era saber a qué producto iban.
    const enlazar = async (posicion, candidato) => {
        const linea = sinEmparejar[posicion];
        if (!resultado?.pedidoId || !linea || enlazando) return;
        setEnlazando(`${posicion}:${candidato.id}`);

        const tasa = linea.iva != null ? Number(linea.iva) : (Number(candidato.taxRate) || 0);
        const costWithTax = Math.round(linea.costo * (1 + tasa / 100));
        const r = await addItemsToSupplierOrder(resultado.pedidoId, [{
            id: candidato.id,
            name: candidato.name,
            sku: candidato.sku,
            cost: linea.costo,
            costWithTax,
            quantity: linea.cantidad,
            taxRate: tasa,
        }]);

        if (!vivo.current) return;
        setEnlazando(null);
        if (!r?.success) {
            toast(r?.error || 'No se pudo enganchar el producto', 'error');
            return;
        }

        setResultado(prev => {
            if (!prev) return prev;
            const netoNuevo = (prev.totalNeto || 0) + linea.costo * linea.cantidad;
            return {
                ...prev,
                emparejados: (prev.emparejados || 0) + 1,
                items: [...(prev.items || []), {
                    producto: candidato.name,
                    desdeFactura: linea.descripcion,
                    cantidad: linea.cantidad,
                    costo: linea.costo,
                }],
                // El total lo manda el servidor, que es quien recalculó el pedido.
                total: Number(r.total_amount) || prev.total,
                totalNeto: netoNuevo,
                sinEmparejar: prev.sinEmparejar.filter((_, i) => i !== posicion),
                factura: prev.factura && {
                    ...prev.factura,
                    diferencia: prev.factura.totalImpreso > 0
                        ? Math.round(prev.factura.totalImpreso - netoNuevo)
                        : null,
                },
            };
        });
        toast(`${candidato.name} agregado al pedido`, 'success');
        avisar.current?.({ pedidoId: resultado.pedidoId });
    };

    return createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="glass rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden border border-[var(--glass-border)] animate-in zoom-in-50 duration-200">

                <div className="p-4 border-b border-[var(--glass-border)] bg-[var(--glass-bg)] flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <Camera size={20} className="text-[var(--color-primary)]" />
                        <h2 className="text-xl font-bold text-[var(--color-text)]">Cargar factura</h2>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-[var(--glass-bg)] rounded-lg transition-colors">
                        <X size={20} className="text-[var(--color-text-muted)]" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-5">

                    {estado === 'leyendo' && (
                        <div className="flex flex-col items-center gap-4 py-8 text-center">
                            {vistaPrevia && (
                                <img src={vistaPrevia} alt="Factura" className="max-h-40 rounded-lg border border-[var(--glass-border)] opacity-60" />
                            )}
                            <Loader2 size={32} className="animate-spin text-[var(--color-primary)]" />
                            <div>
                                <p className="font-bold text-[var(--color-text)]">Leyendo la factura…</p>
                                <p className="text-sm text-[var(--color-text-muted)]">
                                    Puede tardar hasta medio minuto. No cierres esta ventana.
                                </p>
                            </div>
                        </div>
                    )}

                    {estado === 'error' && (
                        <div className="space-y-4">
                            <div className="flex gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
                                <AlertTriangle size={20} className="text-red-400 shrink-0 mt-0.5" />
                                <div>
                                    <p className="font-bold text-red-400">No se creó ningún pedido</p>
                                    <p className="text-sm text-[var(--color-text)]">{error}</p>
                                </div>
                            </div>
                            {/* Sin pedido creado no hay dónde enganchar: van como texto. */}
                            {sinEmparejar.length > 0 && (
                                <Afuera renglones={sinEmparejar} plata={plata} />
                            )}
                        </div>
                    )}

                    {estado === 'listo' && resultado && (
                        <div className="space-y-5">
                            <div className="flex gap-3 p-4 rounded-xl bg-green-500/10 border border-green-500/30">
                                <CheckCircle2 size={20} className="text-green-400 shrink-0 mt-0.5" />
                                <div>
                                    <p className="font-bold text-green-400">Pedido #{resultado.pedidoId} creado</p>
                                    <p className="text-sm text-[var(--color-text)]">
                                        {resultado.proveedor} · {resultado.emparejados} de {resultado.factura?.renglones} renglones cargados
                                        {resultado.factura?.numero ? ` · Factura N° ${resultado.factura.numero}` : ''}
                                    </p>
                                </div>
                            </div>

                            {resultado.yaCargada && (
                                <div className="flex gap-3 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/30">
                                    <FileWarning size={20} className="text-yellow-400 shrink-0 mt-0.5" />
                                    <div className="text-sm">
                                        <p className="font-bold text-yellow-400">Ojo: esta factura ya estaba cargada</p>
                                        <p className="text-[var(--color-text)]">
                                            El pedido #{resultado.yaCargada.pedidoId} tiene el mismo número de factura.
                                            Si es la misma, borrá uno de los dos antes de pasarlo a compra.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Lo que quedó afuera va ARRIBA de lo que entró: es lo
                                único que requiere que alguien haga algo. */}
                            {sinEmparejar.length > 0 && (
                                <Afuera renglones={sinEmparejar} plata={plata} onEnlazar={enlazar} enlazando={enlazando} />
                            )}

                            <div>
                                <h3 className="font-bold text-[var(--color-text)] mb-2">
                                    Cargado en el pedido ({resultado.items?.length || 0})
                                </h3>
                                <div className="overflow-hidden rounded-xl border border-[var(--glass-border)]">
                                    <table className="w-full text-sm">
                                        <thead className="bg-[var(--glass-bg)]">
                                            <tr>
                                                <th className="p-3 text-left font-medium text-[var(--color-text-muted)]">Producto</th>
                                                <th className="p-3 text-center font-medium text-[var(--color-text-muted)]">Cant.</th>
                                                <th className="p-3 text-right font-medium text-[var(--color-text-muted)]">Costo</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-[var(--glass-border)]">
                                            {(resultado.items || []).map((i, idx) => (
                                                <tr key={idx}>
                                                    <td className="p-3">
                                                        <p className="font-medium">{i.producto}</p>
                                                        {/* Cómo venía escrito en el papel: es lo único
                                                            que permite cachar un emparejamiento malo. */}
                                                        {i.desdeFactura && i.desdeFactura !== i.producto && (
                                                            <p className="text-xs text-[var(--color-text-muted)]">
                                                                en la factura: {i.desdeFactura}
                                                            </p>
                                                        )}
                                                    </td>
                                                    <td className="p-3 text-center font-bold">{i.cantidad}</td>
                                                    <td className="p-3 text-right">{plata(i.costo)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        <tfoot className="bg-[var(--glass-bg)]">
                                            <tr>
                                                {/* Los costos de arriba son netos y el total va con
                                                    IVA, igual que en el detalle del pedido. Se aclara
                                                    para que nadie intente multiplicar y no le dé. */}
                                                <td colSpan="2" className="p-3 text-right font-bold">Total del pedido (con IVA)</td>
                                                <td className="p-3 text-right font-bold text-[var(--color-primary)]">{plata(resultado.total)}</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>

                            {/* La diferencia contra el total impreso es el control más
                                rápido: si da cero, entró todo. */}
                            {resultado.factura?.totalImpreso > 0 && (
                                <p className={`text-sm ${resultado.factura.diferencia ? 'text-yellow-400' : 'text-[var(--color-text-muted)]'}`}>
                                    La factura dice {plata(resultado.factura.totalImpreso)} de neto.
                                    {resultado.factura.diferencia
                                        ? ` Faltan ${plata(resultado.factura.diferencia)} por lo que quedó afuera.`
                                        : ' Cuadra con lo cargado.'}
                                </p>
                            )}
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-[var(--glass-border)] bg-[var(--glass-bg)] flex justify-end gap-2">
                    <button
                        onClick={onClose}
                        disabled={estado === 'leyendo'}
                        className="px-6 py-2 bg-[var(--color-primary)] text-black rounded-lg font-bold hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {estado === 'listo' ? 'Ver el pedido' : 'Cerrar'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

// Los renglones que no entraron, con el motivo. Sin el motivo la lista no sirve:
// no es lo mismo "no está en el catálogo" (hay que crear el producto) que "hay
// varios que le calzan" (hay que elegir).
//
// Cuando hay candidatos van como botones: el que tiene la factura adelante sabe
// cuál era, y tocarlo lo mete al pedido con la cantidad y el costo que ya se
// leyeron. `onEnlazar` viene vacío si no hay pedido al que engancharlo (cuando
// no se emparejó ni un renglón no se crea nada), y ahí quedan como texto.
const Afuera = ({ renglones, plata, onEnlazar, enlazando }) => (
    <div>
        <h3 className="font-bold text-yellow-400 mb-2 flex items-center gap-2">
            <AlertTriangle size={16} />
            Quedó afuera ({renglones.length})
        </h3>
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 divide-y divide-yellow-500/20">
            {renglones.map((l, idx) => (
                <div key={`${l.descripcion}-${idx}`} className="p-3 text-sm">
                    <div className="flex justify-between gap-3">
                        <p className="font-medium text-[var(--color-text)]">{l.descripcion}</p>
                        {l.cantidad > 0 && (
                            <p className="text-[var(--color-text-muted)] whitespace-nowrap">
                                {l.cantidad} × {plata(l.costo)}
                            </p>
                        )}
                    </div>
                    <p className="text-xs text-yellow-400/90 mt-0.5">{l.motivo}</p>

                    {l.candidatos?.length > 0 && (
                        onEnlazar ? (
                            <div className="mt-2">
                                <p className="text-xs text-[var(--color-text-muted)] mb-1.5">¿Cuál es?</p>
                                <div className="flex flex-wrap gap-1.5">
                                    {l.candidatos.map((c) => {
                                        const clave = `${idx}:${c.id}`;
                                        const esperando = enlazando === clave;
                                        return (
                                            <button
                                                key={c.id}
                                                onClick={() => onEnlazar(idx, c)}
                                                disabled={Boolean(enlazando)}
                                                className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[var(--glass-bg)] border border-[var(--color-primary)]/40 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                                            >
                                                {esperando && <Loader2 size={12} className="animate-spin" />}
                                                {c.name}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : (
                            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                                Calzan igual: {l.candidatos.map(c => c.name).join(' · ')}
                            </p>
                        )
                    )}
                </div>
            ))}
        </div>
        <p className="text-xs text-[var(--color-text-muted)] mt-2">
            Los que no tienen opciones no están en el catálogo: hay que crear el producto
            y después agregarlo desde el detalle del pedido, con “Agregar productos”.
        </p>
    </div>
);

export default CargarFacturaModal;
