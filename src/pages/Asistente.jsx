import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, Send, AlertTriangle, Loader2, Mic, MicOff, ImagePlus, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { hayConexion, alCambiarConexion } from '../lib/conectividad';
import { hayDictado, iniciarDictado, achicarImagen } from '../lib/dictado';
import { dataApiCall } from '../lib/dataApi';
import { formatCurrency } from '../utils/formatCurrency';

// Asistente IA: preguntarle al negocio en castellano.
//
// La pantalla es deliberadamente tonta. Toda la lógica que importa —licencia,
// cupo, ritmo, qué reportes se pueden consultar— vive en el servidor
// (api/ai/consultar.js), porque acá controla gasto real y el navegador no es
// una fuente confiable para eso.

const SUGERENCIAS = [
    '¿Cuánto vendí hoy?',
    '¿Qué productos no se están moviendo?',
    '¿Cuál vendedora rindió más este mes?',
    '¿Qué se me está por acabar?',
];

const Asistente = () => {
    const { activeCompanyId, currentCurrency } = useStore(useShallow(s => ({
        activeCompanyId: s.activeCompanyId,
        currentCurrency: s.currentCurrency,
    })));

    const [mensajes, setMensajes] = useState([]);
    const [texto, setTexto] = useState('');
    const [pensando, setPensando] = useState(false);
    const [cupo, setCupo] = useState(null);
    const [online, setOnline] = useState(hayConexion());
    const [dictando, setDictando] = useState(false);
    const [dictadoRoto, setDictadoRoto] = useState(null);
    const [imagen, setImagen] = useState(null);   // { dataUrl, ancho, alto }
    const [propuesta, setPropuesta] = useState(null);
    const [aplicando, setAplicando] = useState(false);
    const finRef = useRef(null);
    const cortarDictado = useRef(null);
    const archivoRef = useRef(null);
    const cajaTextoRef = useRef(null);

    // El textarea crece hasta LINEAS_MAX y recién ahí hace scroll.
    //
    // El tope se calcula con la altura real de línea en vez de un número fijo de
    // píxeles. Con 160px puestos a ojo la barra aparecía antes de completar la
    // sexta línea —había lugar y ya molestaba—, y además se rompería al cambiar
    // el tamaño de letra. Midiendo, entran exactamente seis.
    //
    // El scroll se enciende solo cuando hace falta: con `overflow-y: auto` fijo,
    // el navegador dibuja la barra apenas el contenido pasa un píxel.
    //
    // Y la altura se pone en 0 antes de medir porque si no el navegador informa
    // la altura vieja, y al borrar texto el campo nunca volvería a achicarse.
    const LINEAS_MAX = 6;
    useEffect(() => {
        const caja = cajaTextoRef.current;
        if (!caja) return;
        const estilo = getComputedStyle(caja);
        const alturaLinea = parseFloat(estilo.lineHeight) || 22;
        const relleno = parseFloat(estilo.paddingTop) + parseFloat(estilo.paddingBottom);
        const tope = alturaLinea * LINEAS_MAX + relleno;

        caja.style.height = '0px';
        const necesita = caja.scrollHeight;
        caja.style.height = Math.min(necesita, tope) + 'px';
        caja.style.overflowY = necesita > tope ? 'auto' : 'hidden';
    }, [texto]);

    // Cortar el micrófono si se sale de la pantalla: si no, sigue escuchando
    // en segundo plano y el indicador de grabación queda prendido.
    useEffect(() => () => cortarDictado.current?.(), []);

    const alternarDictado = () => {
        if (dictando) { cortarDictado.current?.(); return; }
        setDictando(true);
        cortarDictado.current = iniciarDictado({
            onParcial: (t) => setTexto(t),
            onError: (m) => {
                // Una sola vez. El reconocimiento del navegador falla igual en
                // cada intento —falta permiso, o el navegador no alcanza el
                // servicio de voz, como pasa dentro del navegador de VS Code—,
                // así que repetir el aviso solo apila mensajes idénticos.
                setDictadoRoto(m);
                setMensajes(x => x.some(i => i.texto === m) ? x : [...x, { rol: 'error', texto: m }]);
            },
            onFin: () => setDictando(false),
        });
    };

    const elegirImagen = async (e) => {
        const archivo = e.target.files?.[0];
        e.target.value = '';   // permite volver a elegir la misma foto
        if (!archivo) return;
        try {
            setImagen(await achicarImagen(archivo));
        } catch (err) {
            setMensajes(x => [...x, { rol: 'error', texto: err.message }]);
        }
    };

    // El asistente necesita internet sí o sí. En vez de dejar que falle y
    // mostrar un error feo, se avisa antes — la venta offline no se toca.
    useEffect(() => alCambiarConexion(setOnline), []);

    useEffect(() => {
        finRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [mensajes, pensando]);


    // Acá SÍ se escribe, y solo desde un clic de la persona. Va por la acción
    // normal del sistema (productPriceUpdate), que toca precio y costo y nada
    // más: no puede pisar categoría, proveedor ni los otros 19 campos.
    const aplicarPropuesta = async () => {
        if (!propuesta || aplicando) return;
        setAplicando(true);
        try {
            const r = await dataApiCall('productPriceUpdate', {
                companyId: activeCompanyId,
                id: propuesta.productoId,
                valores: propuesta.valores,
            });
            if (r?.success) {
                setMensajes(m => [...m, {
                    rol: 'ia',
                    texto: `Listo: ${r.producto} quedó actualizado.`,
                }]);
                setPropuesta(null);
            } else {
                setMensajes(m => [...m, { rol: 'error', texto: r?.error || 'No se pudo aplicar el cambio.' }]);
            }
        } catch (e) {
            setMensajes(m => [...m, { rol: 'error', texto: 'No se pudo aplicar: ' + e.message }]);
        } finally {
            setAplicando(false);
        }
    };

    const preguntar = async (pregunta) => {
        const q = (pregunta ?? texto).trim();
        // Con foto adjunta se puede mandar sin escribir nada: se asume que la
        // pregunta es sobre la imagen.
        if ((!q && !imagen) || pensando) return;
        const consulta = q || '¿Qué ves en esta imagen?';
        const foto = imagen;

        if (dictando) cortarDictado.current?.();
        setTexto('');
        setImagen(null);
        setPropuesta(null);
        setMensajes(m => [...m, { rol: 'user', texto: consulta, imagen: foto?.dataUrl }]);
        setPensando(true);

        try {
            const r = await fetch('/api/ai/consultar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    companyId: activeCompanyId,
                    pregunta: consulta,
                    imagen: foto?.dataUrl || null,
                    currency: currentCurrency,
                    // Memoria corta: solo lo necesario para repreguntar ("¿y ayer?")
                    // sin inflar el prompt de cada consulta.
                    historial: mensajes.slice(-6).map(m => ({
                        role: m.rol === 'user' ? 'user' : 'assistant',
                        content: m.texto,
                    })),
                }),
            });
            const data = await r.json();

            if (data?.cupo) setCupo(data.cupo);

            if (!data?.success) {
                setMensajes(m => [...m, {
                    rol: 'error',
                    texto: data?.message || data?.error || 'No pude responder esa consulta.',
                    codigo: data?.error,
                }]);
            } else {
                setMensajes(m => [...m, {
                    rol: 'ia',
                    texto: data.respuesta,
                    reportes: data.reportes || [],
                }]);
                // El modelo propone; el cambio lo confirma la persona en la
                // tarjeta de abajo. Nada se escribió todavía.
                if (data.propuesta) setPropuesta(data.propuesta);
            }
        } catch (e) {
            setMensajes(m => [...m, { rol: 'error', texto: 'No se pudo conectar: ' + e.message }]);
        } finally {
            setPensando(false);
        }
    };

    return (
        <div className="flex flex-col h-[calc(100vh-8rem)] max-w-3xl mx-auto">
            {/* Cabecera */}
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-[var(--glass-border)]">
                <div className="flex items-center gap-2 min-w-0">
                    <Sparkles size={20} className="text-[var(--color-primary)] shrink-0" />
                    <h1 className="text-lg font-bold text-[var(--color-text)] truncate">Asistente</h1>
                </div>
                {cupo && (
                    <span className={`text-xs font-medium shrink-0 ${cupo.avisar ? 'text-amber-400' : 'text-[var(--color-text-muted)]'}`}>
                        {cupo.restantes.toLocaleString('es-CL')} consultas este mes
                    </span>
                )}
            </div>

            {/* Aviso al 80%: informa sin cortar nada. */}
            {cupo?.avisar && !cupo.agotado && (
                <div className="mt-3 flex items-start gap-2 text-xs bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 text-amber-300">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>Te quedan {cupo.restantes.toLocaleString('es-CL')} consultas. El cupo se renueva el 1º.</span>
                </div>
            )}

            {!online && (
                <div className="mt-3 flex items-start gap-2 text-xs bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 text-amber-300">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>Sin conexión. El asistente necesita internet — la venta sigue funcionando igual.</span>
                </div>
            )}

            {/* Conversación */}
            <div className="flex-1 overflow-y-auto py-4 space-y-3">
                {mensajes.length === 0 && (
                    <div className="text-center py-8 space-y-4">
                        <p className="text-sm text-[var(--color-text-muted)]">
                            Preguntale a tu negocio lo que quieras saber.
                        </p>
                        <div className="flex flex-wrap gap-2 justify-center">
                            {SUGERENCIAS.map(s => (
                                <button
                                    key={s}
                                    onClick={() => preguntar(s)}
                                    disabled={!online}
                                    className="text-xs px-3 py-1.5 rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-text)] transition-colors disabled:opacity-40"
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {mensajes.map((m, i) => (
                    <div key={i} className={`flex ${m.rol === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                            m.rol === 'user'
                                ? 'bg-[var(--color-primary)] text-[var(--color-on-primary)] font-medium'
                                : m.rol === 'error'
                                    ? 'bg-red-500/10 border border-red-500/30 text-red-300'
                                    : 'bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)]'
                        }`}>
                            {m.imagen && (
                                <img
                                    src={m.imagen}
                                    alt="Imagen enviada"
                                    className="mb-2 rounded-lg max-h-56 w-auto"
                                />
                            )}
                            {m.texto}
                            {m.reportes?.length > 0 && (
                                <div className="mt-2 pt-2 border-t border-[var(--glass-border)] text-[11px] text-[var(--color-text-muted)]">
                                    Consultó: {m.reportes.join(', ')}
                                </div>
                            )}
                        </div>
                    </div>
                ))}

                {pensando && (
                    <div className="flex justify-start">
                        <div className="flex items-center gap-2 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl px-3.5 py-2.5 text-sm text-[var(--color-text-muted)]">
                            <Loader2 size={14} className="animate-spin" />
                            Revisando tus datos…
                        </div>
                    </div>
                )}
                <div ref={finRef} />
            </div>

            {/* Propuesta pendiente de confirmar. Se muestra separada del chat,
                pegada al campo de escritura, para que no se pierda entre los
                mensajes: es lo único de esta pantalla que modifica datos. */}
            {propuesta && (
                <div className="mt-3 rounded-xl border border-[var(--color-primary)]/50 bg-[var(--color-primary)]/10 p-3 space-y-3">
                    <div>
                        <p className="text-sm font-bold text-[var(--color-text)] break-words">{propuesta.producto}</p>
                        <p className="text-[11px] text-[var(--color-text-muted)]">Así va a quedar si confirmás:</p>
                    </div>

                    {/* Todos los campos que se mueven, no solo los pedidos: los que
                        cambian por consecuencia van marcados para que no sorprendan. */}
                    <div className="rounded-lg overflow-hidden border border-[var(--glass-border)]">
                        {(propuesta.campos || []).map((c, i) => (
                            <div key={i} className={`flex items-baseline gap-2 px-2.5 py-1.5 text-xs ${i % 2 ? 'bg-[var(--glass-bg)]' : ''}`}>
                                <span className="w-28 shrink-0 text-[var(--color-text-muted)]">{c.campo}</span>
                                <span className="line-through text-[var(--color-text-muted)]">{String(c.antes)}</span>
                                <span className="text-[var(--color-text-muted)]">→</span>
                                <span className="font-bold text-[var(--color-text)]">{String(c.ahora)}</span>
                                {c.motivo === 'consecuencia' && (
                                    <span className="ml-auto shrink-0 text-[10px] text-amber-400">se ajusta solo</span>
                                )}
                            </div>
                        ))}
                    </div>

                    {(propuesta.avisos || []).length > 0 && (
                        <div className="space-y-1">
                            {propuesta.avisos.map((a, i) => (
                                <p key={i} className="flex items-start gap-1.5 text-[11px] text-amber-300">
                                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />{a}
                                </p>
                            ))}
                        </div>
                    )}

                    <div className="flex gap-2">
                        <button
                            onClick={aplicarPropuesta}
                            disabled={aplicando}
                            className="flex-1 bg-[var(--color-primary)] text-[var(--color-on-primary)] font-bold rounded-lg py-2 text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
                        >
                            {aplicando ? 'Aplicando…' : 'Aplicar los cambios'}
                        </button>
                        <button
                            onClick={() => setPropuesta(null)}
                            disabled={aplicando}
                            className="px-4 rounded-lg border border-[var(--glass-border)] text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors disabled:opacity-50"
                        >
                            Cancelar
                        </button>
                    </div>
                </div>
            )}

            {/* Entrada */}
            <div className="pt-3 border-t border-[var(--glass-border)] space-y-2">
                {/* Foto adjunta, con opción de sacarla antes de enviar */}
                {imagen && (
                    <div className="flex items-center gap-3 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl p-2">
                        <img src={imagen.dataUrl} alt="Imagen adjunta" className="h-14 w-14 object-cover rounded-lg shrink-0" />
                        <div className="flex-1 min-w-0 text-xs text-[var(--color-text-muted)]">
                            <p className="text-[var(--color-text)]">Imagen lista para enviar</p>
                            <p>{imagen.ancho}×{imagen.alto} · cuenta como 3 consultas del cupo</p>
                        </div>
                        <button
                            onClick={() => setImagen(null)}
                            className="shrink-0 p-2 rounded-lg hover:bg-red-500/20 text-red-400 transition-colors"
                            aria-label="Quitar la imagen"
                        >
                            <X size={16} />
                        </button>
                    </div>
                )}

                {/* items-end: al crecer el campo, los botones quedan alineados
                    abajo con la última línea, no estirados a lo alto.

                    Ojo con eso: antes la fila no tenía alineación y los botones
                    se estiraban solos hasta la altura del campo. Al poner
                    items-end se quedaron sin altura propia y encogieron al
                    tamaño del ícono —quedaron como pastillas chatas—. Por eso
                    ahora la llevan puesta: h-11 son los mismos 44 px que mide el
                    campo con una línea (2 de borde + 20 de padding + 22,75 de
                    interlineado). */}
                <div className="flex items-end gap-2">
                    <input
                        ref={archivoRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={elegirImagen}
                        className="hidden"
                    />
                    <button
                        onClick={() => archivoRef.current?.click()}
                        disabled={pensando || !online}
                        title="Adjuntar una foto"
                        className="shrink-0 h-11 w-11 flex items-center justify-center bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text-muted)] rounded-xl hover:text-[var(--color-text)] hover:border-[var(--color-primary)] transition-colors disabled:opacity-40"
                        aria-label="Adjuntar una foto"
                    >
                        <ImagePlus size={18} />
                    </button>

                    {/* El micrófono solo aparece si el navegador puede dictar: mejor
                        que no esté a que esté y falle al apretarlo. */}
                    {hayDictado() && !dictadoRoto && (
                        <button
                            onClick={alternarDictado}
                            disabled={pensando || !online}
                            title={dictando ? 'Dejar de dictar' : 'Dictar la pregunta'}
                            className={`shrink-0 h-11 w-11 flex items-center justify-center rounded-xl border transition-colors disabled:opacity-40 ${
                                dictando
                                    ? 'bg-red-500/20 border-red-500/50 text-red-400 animate-pulse'
                                    : 'bg-[var(--glass-bg)] border-[var(--glass-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-primary)]'
                            }`}
                            aria-label={dictando ? 'Dejar de dictar' : 'Dictar la pregunta'}
                        >
                            {dictando ? <MicOff size={18} /> : <Mic size={18} />}
                        </button>
                    )}

                    {/* Textarea y no input: una pregunta larga —o dictada— no entra
                        en una línea, y con un input el texto se corría hacia el
                        costado y no se veía lo que uno acababa de escribir. Crece
                        con el contenido hasta un tope y ahí recién hace scroll. */}
                    <textarea
                        ref={cajaTextoRef}
                        rows={1}
                        value={texto}
                        onChange={e => setTexto(e.target.value)}
                        onKeyDown={e => {
                            // Enter envía; Shift+Enter hace un salto de línea, que
                            // ahora sirve de algo porque el campo tiene varias.
                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); preguntar(); }
                        }}
                        placeholder={
                            !online ? 'Sin conexión'
                                : dictando ? 'Escuchando… hablá tranquilo'
                                    : imagen ? 'Preguntá algo sobre la imagen (o enviá sin texto)'
                                        : 'Escribí tu pregunta…'
                        }
                        disabled={pensando || !online}
                        className="flex-1 min-w-0 resize-none overflow-hidden bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl px-4 py-2.5 text-sm leading-relaxed text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)] disabled:opacity-50"
                    />
                    <button
                        onClick={() => preguntar()}
                        disabled={pensando || (!texto.trim() && !imagen) || !online}
                        className="shrink-0 h-11 px-4 flex items-center justify-center bg-[var(--color-primary)] text-[var(--color-on-primary)] rounded-xl hover:opacity-90 transition-opacity disabled:opacity-40"
                        aria-label="Enviar pregunta"
                    >
                        <Send size={18} />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Asistente;
