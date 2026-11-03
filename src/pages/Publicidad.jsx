import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    Megaphone, Search, Loader2, X, Sparkles, Download, Save, Copy, Trash2, Pencil, Plus, Upload,
    History, AlertTriangle, CheckCircle2, Palette, Image as ImageIcon, Wand2, Lightbulb, Move, Printer,
    CircleHelp, ChevronDown, Type, RotateCcw, Zap, MessageSquare, Send, Paperclip, ShoppingBag, ImageOff,
    Scissors, Camera, PackageCheck,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { formatCurrency } from '../utils/formatCurrency';
import { resumenOferta } from '../lib/ofertas';
import { reportCall } from '../lib/dataApi';
import { guardarImagenes, imagenesGuardadas, reemplazarImagen } from '../lib/db/imagenesLocal';
import { compressImage } from '../lib/imageCompression';
import { opcionesCategorias } from '../lib/arbolCategorias';
import {
    FORMATOS, CAMPANAS, ESTILOS, GRUPOS_ESTILO, ESTILO_AUTO, IDEAS_EJEMPLO, AJUSTES_RAPIDOS, LETRAS, LETRAS_URL, PALETAS, IDEAS_CHAT,
    formatoPorId, campanaPorId, estiloPorId, letrasPorId, sugerirEstilo, medidas, textoUnidad,
} from '../lib/publicidad/catalogo';
import {
    cargarImagen, dibujarPublicidad, dibujarImagen, zoomEntera, quitarFondoBlanco, pedirLetras, prepararLetras, esquinas, ESCALA_PIEZA,
} from '../lib/publicidad/componer';
import { publicidad, descargarImagen, imprimirImagen, achicarFoto } from '../lib/publicidad/api';

// Publicidad IA: se eligen productos del inventario, la IA hace SOLO el fondo y
// el nombre, el precio y los textos los dibuja el sistema encima
// (lib/publicidad/componer.js). Cambiar un precio o un texto no vuelve a
// generar nada: la IA se llama únicamente con los botones de la sección Fondo
// (fondo, integrar y ajustar).

const OFERTAS = '__ofertas__'; // opción del filtro de categorías
const POR_PAGINA = 200;          // tope del reporte categoryProducts

const aDataUrl = (img) => (!img ? null : String(img).startsWith('data:') ? img : `data:image/jpeg;base64,${img}`);
const nuevaClave = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const hoy = () => new Date().toISOString().slice(0, 10);

const DISENO_VACIO = {
    id: null, status: 'borrador', title: '',
    formato: 'post_vertical', personalizado: { ancho: 1080, alto: 1080 },
    campana: 'oferta_dia', estilo: ESTILO_AUTO, idea: '',
    titulo: null, mensaje: '', extra: '', negocio: null, mostrarNegocio: true,
    colores: null, ajustes: { escala: 1, posX: null, posY: null },
    encuadre: { x: 0, y: 0, zoom: 1 }, // del fondo: correrlo y alejarlo/acercarlo (componer.js)
    letras: 'clasica',
    mover: {}, // lo que se corrió y agrandó cada texto; una nueva arranca con todo en su lugar
};

// La publicidad hecha con chat. `mensajes`: cada pedido con la imagen que salió
// (`desde`: la imagen que se cambió; null si se creó una nueva). `actual`: la que
// se ve y la que cambia el próximo pedido. `guardado`: firmaChat de cuando se
// guardó o se abrió.
const CHAT_VACIO = {
    id: null, status: 'borrador', title: '',
    formato: 'post_vertical', personalizado: { ancho: 1080, alto: 1080 },
    mensajes: [], actual: null, encuadre: { x: 0, y: 0, zoom: null }, // zoom null: la imagen entera (componer.js)
    guardado: null,
};

// El recorte de un producto (pestaña Recortar). `producto`: para cuál es, si se
// eligió (es al que se le ofrece ponérsela). `original`: la foto de la que se
// parte; `deInventario` si es la que ya tiene el producto. `fondoId`/`url`/
// `dataUrl`: lo que hizo la IA (el recorte sin fondo se saca de ahí).
// `id`: la del Historial, si se guardó (`guardado`: cómo se guardó).
// `asignada`: los productos que ya la tienen. `formato`, `tamano` (del producto,
// 0,88 = el 88 % del lado que manda) y `fondo` (null = sin fondo, PNG): cómo sale
// la foto que se baja o se guarda; se arma sin IA, así que se cambia antes o después.
const RECORTE_VACIO = {
    id: null, title: '', guardado: null, producto: null, original: null, deInventario: false, nota: '',
    fondoId: null, url: null, dataUrl: null, asignada: [],
    formato: 'cuadrado', personalizado: { ancho: 800, alto: 800 }, tamano: 0.88, fondo: '#ffffff',
};

/** Cómo sale un recorte: guardado así, no se guarda de nuevo; con otra medida, tamaño o fondo, queda otro. */
function firmaRecorte(r) {
    const { ancho, alto } = medidas(r.formato, r.personalizado);
    return `${ancho}x${alto}|${Number(r.tamano).toFixed(2)}|${r.fondo || 'sin'}`;
}

// Lo que se ve en la publicidad, para saber si cambió desde que se guardó o se
// abrió: con cambios, guardar crea otra (Kevin, 27-oct-2026). El nombre no
// cuenta (renombrarla actualiza la misma), ni las fotos mientras se cargan.
function firmaDiseno(d, visibles, fondoId, imagenes) {
    return JSON.stringify({
        d: { ...d, id: undefined, status: undefined, title: undefined },
        fondoId,
        productos: visibles.map(it => [
            it.productId, Number(it.precioPublicidad) || 0, it.etiqueta, it.nombreVisible, it.presentacion?.id ?? null,
            it.mostrarAntes, it.quitarFondo, it.fotoPropia ? `propia:${it.fotoPropia.length}` : (it.fotoUrl || null),
        ]),
        imagenes: imagenes.map(im => [im.id, im.quitarFondo, im.foto ? `propia:${im.foto.length}` : (im.fotoUrl || null)]),
    });
}
const firmaChat = (c) => JSON.stringify([c.actual, firmaFormato(c.formato, c.personalizado), c.encuadre]);

const NOMBRE_PIEZA = { titulo: 'Título', mensaje: 'Mensaje', pie: 'Pie', nombre: 'Nombre', precio: 'Precio', etiqueta: 'Etiqueta', foto: 'Foto' };

// Las imágenes que se agregan encima (Kevin, 29-oct-2026: un logo, un sello…).
// No son productos: entran recortadas, sin nombre ni precio, y se mueven y
// agrandan como los textos (su lugar va en `d.mover`, con su id).
const MAX_IMAGENES = 4;
const esImagen = (id) => String(id).startsWith('img-');
const nombrePieza = (id) => (esImagen(id) ? 'Imagen' : NOMBRE_PIEZA[id] || 'Texto');
const nuevaImagen = (foto) => ({
    id: `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    foto, fotoUrl: null, fotoGuardada: null, quitarFondo: true,
});

// Elegir y arrastrar en la vista previa: el punto en px de la imagen y lo que
// hay ahí, con un margen para el dedo.
function puntoEnLienzo(c, e) {
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height, escala: c.width / r.width };
}
function piezaEn(piezas, p) {
    const tol = 8 * p.escala;
    for (let i = piezas.length - 1; i >= 0; i--) {
        const c = piezas[i];
        if (p.x >= c.x - tol && p.x <= c.x + c.w + tol && p.y >= c.y - tol && p.y <= c.y + c.h + tol) return c;
    }
    return null;
}
/** Primero las esquinas de la pieza elegida (para agrandarla), después cualquier pieza (para moverla). */
function tomar(piezas, seleccion, p) {
    const sel = seleccion && piezas.find(k => k.id === seleccion);
    if (sel && esquinas(sel).some(([x, y]) => Math.hypot(p.x - x, p.y - y) <= 14 * p.escala)) return { pieza: sel, esquina: true };
    const pieza = piezaEn(piezas, p);
    return pieza ? { pieza, esquina: false } : null;
}
const limitar = (v, min, max) => Math.min(max, Math.max(min, v));

// Las reglas de la oferta (0033) vienen solo en la lista "En oferta"; el
// buscador no las trae.
const reglaDe = (p) => (p.offer_until || Number(p.offer_units_limit) > 0
    ? { hasta: p.offer_until || null, limite: Number(p.offer_units_limit) || 0, vendidas: Number(p.offer_units_sold) || 0 }
    : null);

/** "Válido hasta el domingo, 26 de octubre", para el mensaje de la publicidad. */
function textoVigencia(regla) {
    if (!regla) return '';
    const hasta = regla.hasta ? new Date(regla.hasta) : null;
    const fecha = hasta && Number.isFinite(hasta.getTime())
        ? hasta.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' }) : null;
    if (fecha && regla.limite > 0) return `Válido hasta el ${fecha} o hasta agotar stock`;
    if (fecha) return `Válido hasta el ${fecha}`;
    return regla.limite > 0 ? 'Hasta agotar stock' : '';
}

function itemDesdeProducto(p, presentaciones = []) {
    const oferta = Number(p.is_offer) === 1 && Number(p.offer_price) > 0 ? Number(p.offer_price) : null;
    return {
        productId: Number(p.id), nombre: p.name, nombreVisible: '', categoria: p.category || null, unidad: p.unit || 'Und',
        reglaOferta: oferta ? reglaDe(p) : null,
        precioNormal: Number(p.price) || 0, precioOferta: oferta, precioPublicidad: oferta ?? (Number(p.price) || 0),
        etiqueta: null, presentacion: null, presentaciones,
        mostrarAntes: true, quitarFondo: true, tieneFotoInventario: Number(p.has_image) === 1 || !!p.image,
        fotoInventario: null, fotoPropia: null, fotoUrl: null, fotoGuardada: null, cargandoFoto: true,
    };
}

export default function Publicidad() {
    const activeCompanyId = useStore(s => s.activeCompanyId);
    const currentCurrency = useStore(s => s.currentCurrency);
    const availableCompanies = useStore(s => s.availableCompanies);
    const searchProductsForDropdown = useStore(s => s.searchProductsForDropdown);
    const fetchProductImage = useStore(s => s.fetchProductImage);
    const presentacionesDe = useStore(s => s.presentacionesDe);
    const categories = useStore(s => s.categories);
    const conteoCategorias = useStore(s => s.conteoCategorias);
    const fetchConteoCategorias = useStore(s => s.fetchConteoCategorias);

    const nombreEmpresa = (availableCompanies || []).find(c => c.id === activeCompanyId)?.name || '';
    const dinero = useCallback((n) => formatCurrency(n, currentCurrency), [currentCurrency]);

    const [pestana, setPestana] = useState('crear');
    const [estado, setEstado] = useState(null);
    const [d, setD] = useState(DISENO_VACIO);
    const [items, setItems] = useState([]);
    const [imagenes, setImagenes] = useState([]); // las agregadas encima: { id, foto, fotoUrl, fotoGuardada, quitarFondo }
    const [fondos, setFondos] = useState([]);
    const [fondoId, setFondoId] = useState(null);
    const [fondoImg, setFondoImg] = useState(null);
    const [generando, setGenerando] = useState(null);
    const [guardando, setGuardando] = useState(false);
    const [imprimiendo, setImprimiendo] = useState(false);
    const [abriendo, setAbriendo] = useState(false);
    const [aviso, setAviso] = useState(null); // { tipo: 'ok'|'error', texto }
    const [version, setVersion] = useState(0);
    const [fuente, setFuente] = useState(''); // '' = buscador · OFERTAS · nombre de una categoría
    const [conIdea, setConIdea] = useState(false);
    const [cambio, setCambio] = useState(''); // lo que se le pide a "Ajustar este fondo"

    const [seleccion, setSeleccion] = useState(null); // la pieza elegida en la vista previa
    const [chat, setChat] = useState(CHAT_VACIO);     // la publicidad con chat (sigue ahí al cambiar de pestaña)
    const [recorte, setRecorte] = useState(RECORTE_VACIO); // el recorte de un producto (también)
    const [menu, setMenu] = useState(null);           // menú abierto sobre la vista previa: 'formato' | 'letras' | 'colores'
    const [panelFondo, setPanelFondo] = useState(null); // 'encuadre' | 'ajustar', bajo los fondos

    const lienzo = useRef(null);
    const barraMenus = useRef(null);
    const fotos = useRef(new Map()); // productId → { clave, img }
    const clave = useRef(null);      // { clave, firma }: un reintento tras un corte no vuelve a cobrar
    const guardado = useRef({ id: null, firma: null }); // cómo estaba al guardarla o abrirla (ver firmaDiseno)
    const piezas = useRef([]);       // dónde quedó cada texto en el último dibujo
    const arrastre = useRef(null);   // { modo: 'mover' | 'tamano', pieza, inicio, ... }
    const tocarVacio = useRef(null); // un toque fuera de los textos: si no se arrastra, suelta la elegida
    const archivoImagen = useRef(null); // «Agregar imagen»: un logo u otra imagen encima
    const porElegir = useRef(null);     // la imagen recién agregada: se elige apenas esté recortada

    const formato = formatoPorId(d.formato);
    const campana = campanaPorId(d.campana);
    const { ancho, alto } = medidas(d.formato, d.personalizado);
    const visibles = useMemo(() => items.slice(0, formato.max), [items, formato.max]);
    // "Automático": el estilo sale de los productos y la fecha; es el que se manda y se guarda.
    const sugerido = useMemo(
        () => sugerirEstilo(visibles.map(it => ({ categoria: it.categoria, nombre: it.nombre })), { formatoId: d.formato, campanaId: d.campana }),
        [visibles, d.formato, d.campana]
    );
    const estiloId = d.estilo === ESTILO_AUTO ? sugerido.id : d.estilo;
    const colores = d.colores || estiloPorId(estiloId).colores;
    const letras = letrasPorId(d.letras);
    const fondo = fondos.find(f => f.id === fondoId) || null;
    const cupo = estado?.cupo;
    const iaApagada = !estado?.app || !estado?.almacenamiento || !!cupo?.agotado;
    // Con un solo producto con foto, integrarlo es lo que mejor sale (la IA ve
    // la foto): pasa a ser el botón principal.
    const integrable = visibles.length === 1 && !!visibles[0]?.tieneFotoInventario;
    // Puede ser solo imágenes y textos (un logo y un aviso): eso también se guarda, se baja y se imprime.
    const hayAlgo = visibles.length > 0 || imagenes.length > 0;
    const escenaIntegrada = fondo?.modo === 'integrado' && visibles.length === 1 && fondo.productId === visibles[0].productId;
    // Por qué los botones de IA están apagados, para que no parezcan rotos.
    const motivoSinIAChat = !estado ? null
        : !estado.success ? 'No se pudo revisar la Publicidad (mirá el aviso de arriba).'
            : !estado.app ? 'Para usar la IA hay que activar la App "Publicidad IA" en el Marketplace.'
                : !estado.almacenamiento ? 'Falta conectar el almacenamiento de imágenes (Vercel Blob).'
                    : cupo?.agotado ? 'Ya se usaron todas las imágenes del mes.'
                        : null;
    const motivoSinIA = motivoSinIAChat || (estado && !visibles.length ? 'Agregá un producto primero.' : null);

    const refrescarEstado = useCallback(async () => {
        if (!activeCompanyId) return;
        const r = await publicidad(activeCompanyId, 'estado');
        if (r.success) setEstado(r);
        else setEstado(e => e || { error: r.message });
    }, [activeCompanyId]);

    useEffect(() => { refrescarEstado(); }, [refrescarEstado]);

    const avisar = (tipo, texto) => setAviso({ tipo, texto });
    const cambiar = (campos) => setD(prev => ({ ...prev, ...campos }));
    const cambiarItem = (productId, campos) => setItems(prev => prev.map(it => it.productId === productId ? { ...it, ...campos } : it));

    // ── Fotos de los productos y las imágenes agregadas (sin su fondo blanco) ─
    useEffect(() => {
        let vivo = true;
        const fuentes = [
            ...items.map(it => ({ id: it.productId, src: it.fotoPropia || it.fotoGuardada || it.fotoInventario, quitar: it.quitarFondo })),
            ...imagenes.map(im => ({ id: im.id, src: im.foto || im.fotoGuardada, quitar: im.quitarFondo })),
        ];
        for (const { id, src, quitar } of fuentes) {
            const k = src ? `${src.length}:${src.slice(-48)}:${quitar ? 1 : 0}` : 'sin';
            const ya = fotos.current.get(id);
            if (ya?.clave === k) continue;
            // Mientras se recorta la nueva queda la anterior: no parpadea ni se suelta si estaba elegida.
            fotos.current.set(id, { clave: k, img: src ? (ya?.img ?? null) : null });
            if (!src) { setVersion(v => v + 1); continue; }
            cargarImagen(src).then(img => {
                if (!vivo || fotos.current.get(id)?.clave !== k) return;
                fotos.current.set(id, { clave: k, img: quitar ? quitarFondoBlanco(img) : img });
                setVersion(v => v + 1);
                // Recién agregada: queda elegida, con sus esquinas, para moverla y agrandarla.
                if (porElegir.current === id) { porElegir.current = null; setSeleccion(id); }
            }).catch(() => { /* la publicidad sale sin esa foto */ });
        }
        const ids = new Set(fuentes.map(f => f.id));
        for (const id of fotos.current.keys()) if (!ids.has(id)) fotos.current.delete(id);
        return () => { vivo = false; };
    }, [items, imagenes]);

    // Las fuentes de todos los diseños se piden al abrir (las muestras del selector
    // las usan); el lienzo se redibuja cuando llegan las del diseño elegido.
    useEffect(() => { pedirLetras(LETRAS_URL); }, []);
    useEffect(() => {
        let vivo = true;
        prepararLetras(LETRAS_URL, letras).then(() => { if (vivo) setVersion(v => v + 1); });
        return () => { vivo = false; };
    }, [letras]);

    useEffect(() => {
        let vivo = true;
        if (!fondo?.dataUrl) { setFondoImg(null); return undefined; }
        cargarImagen(fondo.dataUrl).then(img => { if (vivo) setFondoImg(img); }).catch(() => { if (vivo) setFondoImg(null); });
        return () => { vivo = false; };
    }, [fondo?.dataUrl]);

    // ── Dibujo (cada cambio se ve al instante, sin volver a generar) ──────────
    const datosDibujo = useMemo(() => {
        const integradoDe = escenaIntegrada ? fondo.productId : null;
        return {
            ancho, alto, formatoId: d.formato, fondo: fondoImg, colores, ajustes: d.ajustes, encuadre: d.encuadre, dinero,
            letras, mover: d.mover, seleccion,
            textos: {
                titulo: d.titulo ?? campana.titulo, mensaje: d.mensaje, extra: d.extra,
                negocio: d.mostrarNegocio ? (d.negocio ?? nombreEmpresa) : '',
            },
            productos: visibles.map(it => {
                const ref = it.presentacion ? it.presentacion.precio : it.precioNormal;
                return {
                    nombre: it.nombreVisible || it.nombre,
                    precio: Number(it.precioPublicidad) || 0,
                    precioAntes: it.mostrarAntes && ref > Number(it.precioPublicidad) ? ref : null,
                    unidadTexto: textoUnidad(it),
                    etiqueta: it.etiqueta ?? (visibles.length <= 2 ? campana.etiqueta : ''),
                    // La escena integrada ya trae el producto: no se dibuja dos veces.
                    foto: integradoDe === it.productId ? null : (fotos.current.get(it.productId)?.img || null),
                };
            }),
            imagenes: imagenes.map(im => ({ id: im.id, img: fotos.current.get(im.id)?.img || null })),
        };
        // `version` avisa que llegó una foto (viven en un ref).
    }, [ancho, alto, d, fondoImg, colores, letras, seleccion, dinero, campana, nombreEmpresa, visibles, imagenes, fondo, version]); // eslint-disable-line react-hooks/exhaustive-deps

    // También al volver del Historial: esa pestaña desarma la vista previa y el
    // lienzo nuevo nace en blanco (Kevin, 26-oct-2026: "la imagen se va").
    useEffect(() => {
        if (!lienzo.current) return;
        piezas.current = dibujarPublicidad(lienzo.current, datosDibujo);
        // La pieza elegida ya no está (se borró ese texto, se agregaron productos): se suelta.
        if (seleccion && !piezas.current.some(k => k.id === seleccion)) setSeleccion(null);
    }, [datosDibujo, seleccion, pestana]);

    // Lo que se guarda, se descarga o se imprime va sin el marco de la pieza elegida.
    // `escala` la dibuja más grande: todo se mide en proporción al lado, así que
    // sale igual que la vista previa, con más detalle.
    const imagenLimpia = (escala = 1) => {
        const c = document.createElement('canvas');
        dibujarPublicidad(c, { ...datosDibujo, ancho: ancho * escala, alto: alto * escala, seleccion: null });
        return c;
    };

    // ── Elegir, mover y agrandar los textos (y la foto) en la vista previa ───
    // Kevin, 26-oct-2026: "que al darle click me salga seleccionado el que quiero
    // mover y agrandar y achicar". En el celular, un dedo sobre un texto (o sobre
    // una esquina del elegido) lo toma a él y no a la página; en cualquier otra
    // parte de la imagen la página se desliza como siempre.
    useEffect(() => {
        const c = lienzo.current;
        if (!c) return undefined;
        const alTocar = (e) => {
            const t = e.touches[0];
            if (t && tomar(piezas.current, seleccion, puntoEnLienzo(c, t))) e.preventDefault();
        };
        c.addEventListener('touchstart', alTocar, { passive: false });
        return () => c.removeEventListener('touchstart', alTocar);
    }, [pestana, seleccion]);

    const inicioDe = (pieza) => (pieza.id === 'foto'
        ? { x: pieza.posX, y: pieza.posY }
        : { x: pieza.dx / lienzo.current.width, y: pieza.dy / lienzo.current.height });

    /** Corre la pieza `dxPx`, `dyPx` desde `inicio`, hasta el borde de la imagen y no más (así volver no tiene un tramo muerto). */
    const correrPieza = (pieza, inicio, dxPx, dyPx) => {
        const c = lienzo.current;
        const dx = limitar(dxPx, -pieza.x, c.width - pieza.w - pieza.x);
        const dy = limitar(dyPx, -pieza.y, c.height - pieza.h - pieza.y);
        if (pieza.id === 'foto') {
            setD(prev => ({ ...prev, ajustes: { ...prev.ajustes, posX: limitar(inicio.x + dx / c.width, 0.15, 0.85), posY: limitar(inicio.y + dy / pieza.libre, 0.1, 0.9) } }));
        } else {
            setD(prev => ({ ...prev, mover: { ...prev.mover, [pieza.id]: { ...prev.mover[pieza.id], x: inicio.x + dx / c.width, y: inicio.y + dy / c.height } } }));
        }
    };

    // El tamaño de cada pieza; el de la foto es el del deslizador "Tamaño de la foto".
    const tamanoDe = (id) => (id === 'foto' ? Number(d.ajustes.escala) || 1 : Number(d.mover[id]?.escala) || 1);
    const topeTamano = (id) => (id === 'foto' ? { min: 0.4, max: 1.8 } : ESCALA_PIEZA);
    const cambiarTamano = (id, valor) => {
        const { min, max } = topeTamano(id);
        const v = limitar(valor, min, max);
        if (id === 'foto') setD(prev => ({ ...prev, ajustes: { ...prev.ajustes, escala: v } }));
        else setD(prev => ({ ...prev, mover: { ...prev.mover, [id]: { ...prev.mover[id], escala: v } } }));
    };
    const piezaASuLugar = (id) => {
        if (id === 'foto') { setD(prev => ({ ...prev, ajustes: { ...prev.ajustes, escala: 1, posX: null, posY: null } })); return; }
        setD(prev => {
            const mover = { ...prev.mover };
            delete mover[id];
            return { ...prev, mover };
        });
    };

    const empezarArrastre = (e) => {
        const c = lienzo.current;
        const p = puntoEnLienzo(c, e);
        const toma = generando ? null : tomar(piezas.current, seleccion, p);
        if (!toma) { tocarVacio.current = p; return; }
        const { pieza, esquina } = toma;
        e.preventDefault();
        // preventDefault deja el foco donde estaba: si era el buscador, las flechas y
        // Supr irían a sus letras y no a la pieza elegida.
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) document.activeElement.blur();
        c.setPointerCapture?.(e.pointerId);
        const centro = { x: pieza.x + pieza.w / 2, y: pieza.y + pieza.h / 2 };
        arrastre.current = esquina
            ? { modo: 'tamano', pieza, centro, distancia: Math.max(1, Math.hypot(p.x - centro.x, p.y - centro.y)), inicio: tamanoDe(pieza.id) }
            : { modo: 'mover', pieza, desde: p, inicio: inicioDe(pieza) };
        setSeleccion(pieza.id);
    };
    const moverArrastre = (e) => {
        const c = lienzo.current;
        const p = puntoEnLienzo(c, e);
        const a = arrastre.current;
        if (!a) {
            const toma = tomar(piezas.current, seleccion, p);
            c.style.cursor = !toma ? '' : toma.esquina ? 'nwse-resize' : 'move';
            return;
        }
        // Tirar de una esquina agranda o achica desde el centro, en proporción.
        if (a.modo === 'tamano') cambiarTamano(a.pieza.id, a.inicio * Math.hypot(p.x - a.centro.x, p.y - a.centro.y) / a.distancia);
        else correrPieza(a.pieza, a.inicio, p.x - a.desde.x, p.y - a.desde.y);
    };
    const soltarArrastre = (e) => {
        if (arrastre.current) { arrastre.current = null; return; }
        // Un toque (sin arrastrar) en la imagen fuera de los textos suelta la elegida.
        const v = tocarVacio.current;
        tocarVacio.current = null;
        if (!v || e.type !== 'pointerup') return;
        const p = puntoEnLienzo(lienzo.current, e);
        if (Math.hypot(p.x - v.x, p.y - v.y) < 10 * p.escala) setSeleccion(null);
    };

    // Los menús de la vista previa se cierran tocando fuera de ellos o con Esc.
    useEffect(() => {
        if (!menu) return undefined;
        const fuera = (e) => { if (!barraMenus.current?.contains(e.target)) setMenu(null); };
        const tecla = (e) => { if (e.key === 'Escape') setMenu(null); };
        document.addEventListener('pointerdown', fuera);
        window.addEventListener('keydown', tecla);
        return () => { document.removeEventListener('pointerdown', fuera); window.removeEventListener('keydown', tecla); };
    }, [menu]);

    // En la PC: las flechas corren la pieza elegida (con Shift, más) y Esc la suelta.
    useEffect(() => {
        if (!seleccion) return undefined;
        const tecla = (e) => {
            if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName)) return;
            if (e.key === 'Escape') { setSeleccion(null); return; }
            if ((e.key === 'Delete' || e.key === 'Backspace') && esImagen(seleccion)) { e.preventDefault(); quitarImagen(seleccion); return; }
            const paso = e.shiftKey ? 20 : 4;
            const flecha = { ArrowLeft: [-paso, 0], ArrowRight: [paso, 0], ArrowUp: [0, -paso], ArrowDown: [0, paso] }[e.key];
            const pieza = flecha && piezas.current.find(k => k.id === seleccion);
            if (!pieza) return;
            e.preventDefault();
            correrPieza(pieza, inicioDe(pieza), ...flecha);
        };
        window.addEventListener('keydown', tecla);
        return () => window.removeEventListener('keydown', tecla);
    }, [seleccion]);

    // ── Productos ─────────────────────────────────────────────────────────────
    const cargarFotoInventario = useCallback(async (productId) => {
        const img = await fetchProductImage(productId).catch(() => null);
        cambiarItem(productId, { fotoInventario: aDataUrl(img), cargandoFoto: false, tieneFotoInventario: !!img });
    }, [fetchProductImage]);

    // Varios de una vez ("Agregar" en la lista de ofertas): hasta llenar el formato.
    const agregarVarios = (lista) => {
        const ya = new Set(items.map(it => it.productId));
        const nuevos = lista.filter(p => !ya.has(Number(p.id)));
        if (!nuevos.length) return;
        const libres = formato.max - items.length;
        if (libres <= 0) { avisar('error', `Este formato admite hasta ${formato.max} productos.`); return; }
        const entran = nuevos.slice(0, libres);
        setItems(prev => [...prev, ...entran.map(p => itemDesdeProducto(p,
            (presentacionesDe?.(p.id) || []).filter(x => Number(x.is_active ?? 1) === 1)
                .map(x => ({ id: Number(x.id), nombre: x.name, unidades: Number(x.units), precio: Number(x.price) }))))]);
        for (const p of entran) cargarFotoInventario(Number(p.id));
        if (nuevos.length > entran.length) avisar('error', `Entraron ${entran.length} de ${nuevos.length}: una imagen de este formato lleva hasta ${formato.max} productos.`);
    };
    const agregar = (p) => agregarVarios([p]);
    const quitar = (productId) => setItems(prev => prev.filter(x => x.productId !== productId));

    // Filtro por categoría (con su rama, igual que el POS) o por "Ofertas".
    const opcionesCategoria = useMemo(
        () => opcionesCategorias((categories || []).filter(c => (c.status ?? 'active') === 'active'), conteoCategorias),
        [categories, conteoCategorias]
    );
    const cargarFuente = useCallback(async (offset) => {
        if (fuente === OFERTAS) {
            const r = await publicidad(activeCompanyId, 'ofertas');
            return r.success ? { productos: r.productos || [] } : { error: r.message };
        }
        try {
            const filas = await reportCall(activeCompanyId, 'categoryProducts', { category: fuente, offset, limit: POR_PAGINA });
            return { productos: filas, hayMas: filas.length === POR_PAGINA };
        } catch (e) {
            return { error: e?.message || 'No se pudieron cargar los productos.' };
        }
    }, [activeCompanyId, fuente]);

    const elegirPresentacion = (it, valor) => {
        const pres = it.presentaciones.find(x => String(x.id) === String(valor)) || null;
        const oferta = it.precioOferta ?? it.precioNormal;
        cambiarItem(it.productId, { presentacion: pres, precioPublicidad: pres ? pres.precio : oferta });
    };

    const subirFoto = async (it, archivo) => {
        try {
            const dataUrl = await achicarFoto(archivo);
            cambiarItem(it.productId, { fotoPropia: dataUrl, fotoUrl: null });
        } catch (e) { avisar('error', e.message); }
    };

    // Kevin, 29-oct-2026: lo que se sube no es un producto, es un complemento (un
    // logo, un sello): entra recortado, al centro y un poco corrido de la
    // anterior, y queda elegido para llevarlo a su lugar.
    const agregarImagen = async (archivo) => {
        if (imagenes.length >= MAX_IMAGENES) { avisar('error', `Se pueden agregar hasta ${MAX_IMAGENES} imágenes.`); return; }
        try {
            const im = nuevaImagen(await achicarFoto(archivo));
            const corrida = 0.04 * imagenes.length;
            porElegir.current = im.id;
            setImagenes(prev => [...prev, im]);
            setD(prev => ({ ...prev, mover: { ...prev.mover, [im.id]: { x: corrida, y: corrida, escala: 1 } } }));
            avisar('ok', 'Imagen agregada. Arrastrala a su lugar y tirá de sus esquinas para agrandarla o achicarla.');
        } catch (e) { avisar('error', e.message); }
    };
    const cambiarImagen = (id, campos) => setImagenes(prev => prev.map(im => (im.id === id ? { ...im, ...campos } : im)));
    const quitarImagen = (id) => {
        setImagenes(prev => prev.filter(im => im.id !== id));
        setD(prev => {
            const mover = { ...prev.mover };
            delete mover[id];
            return { ...prev, mover };
        });
        setSeleccion(s => (s === id ? null : s));
    };

    // ── Fondo con IA (lo único que cuesta) ────────────────────────────────────
    // modo: 'fondo' | 'integrado' | 'ajuste' (un cambio sobre el fondo elegido).
    const generar = async (modo) => {
        const ajuste = modo === 'ajuste';
        const pedido = cambio.trim();
        if (generando || !visibles.length || (ajuste && (!fondo || !pedido))) return;
        setAviso(null);
        const firma = JSON.stringify(ajuste
            ? [modo, fondo.id, pedido]
            : [d.formato, d.campana, estiloId, d.idea.trim(), modo, visibles.map(it => it.productId), ancho, alto]);
        if (clave.current?.firma !== firma) clave.current = { clave: nuevaClave(), firma };
        setGenerando(modo);
        const r = await publicidad(activeCompanyId, 'generarFondo', {
            formato: d.formato, campana: d.campana, estilo: estiloId, modo, clave: clave.current.clave,
            productIds: visibles.map(it => it.productId), designId: d.id, ancho, alto,
            colores: [colores.principal, colores.acento], idea: d.idea.trim(),
            ...(ajuste ? { baseId: fondo.id, cambio: pedido } : {}),
        }, 70000);
        setGenerando(null);
        if (r.success) {
            clave.current = null;
            let dataUrl = r.dataUrl;
            if (!dataUrl && r.fondo?.url) dataUrl = (await publicidad(activeCompanyId, 'imagen', { url: r.fondo.url })).dataUrl || null;
            // El ajuste de una escena con el producto sigue trayendo el producto.
            const modoFondo = r.fondo.modo || (ajuste ? fondo.modo : modo);
            const productId = modoFondo !== 'integrado' ? null : ajuste ? fondo.productId : visibles[0].productId;
            const nuevo = { id: r.fondo.id, url: r.fondo.url, modo: modoFondo, productId, dataUrl };
            setFondos(prev => [nuevo, ...prev.filter(f => f.id !== nuevo.id)]);
            setFondoId(nuevo.id);
            // El ajuste conserva la composición, así que también el encuadre; un fondo nuevo arranca centrado.
            if (ajuste) setCambio('');
            else cambiar({ encuadre: DISENO_VACIO.encuadre });
            avisar('ok', r.repetido ? 'Ese fondo ya estaba generado: no se cobró de nuevo.'
                : `${ajuste ? 'Fondo ajustado' : 'Fondo listo'} en ${r.fondo.segundos ?? '–'} s. El anterior sigue en la fila, por si te gustaba más.`);
            refrescarEstado();
        } else {
            // Si fue un corte de red, la misma clave sirve para no pagar dos veces el
            // mismo fondo; si la IA contestó con error, el próximo intento es nuevo.
            if (r.error !== 'TIEMPO' && r.error !== 'RED') clave.current = null;
            avisar('error', r.error === 'TIEMPO'
                ? 'La IA tardó más de lo esperado. Probá de nuevo en un momento: si el fondo alcanzó a generarse, aparece sin cobrarse otra vez.'
                : r.message);
            if (r.error === 'CUPO' || r.error === 'IA') refrescarEstado();
        }
    };

    const elegirFondo = async (f) => {
        if (!f) { setFondoId(null); return; }
        setFondoId(f.id);
        if (!f.dataUrl && f.url) {
            const r = await publicidad(activeCompanyId, 'imagen', { url: f.url });
            if (r.success) setFondos(prev => prev.map(x => x.id === f.id ? { ...x, dataUrl: r.dataUrl } : x));
            else avisar('error', 'No se pudo cargar ese fondo.');
        }
    };

    // ── Guardar / descargar ───────────────────────────────────────────────────
    const nombreArchivo = () => {
        const base = (d.title || visibles.map(it => it.nombreVisible || it.nombre).join(' ') || 'publicidad')
            .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50).toLowerCase();
        return `publicidad-${base || 'posveci'}-${hoy()}.jpg`;
    };

    const miniatura = (origen) => {
        const c = document.createElement('canvas');
        const f = 260 / Math.max(ancho, alto);
        c.width = Math.round(ancho * f); c.height = Math.round(alto * f);
        c.getContext('2d').drawImage(origen, 0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', 0.7);
    };

    // Kevin, 27-oct-2026: cada guardado es otra publicidad, aunque no se haya
    // apretado «Nueva». Solo se actualiza la misma si no cambió nada desde que se
    // guardó o se abrió: pasar el borrador a final, o cambiarle solo el nombre.
    const conCambios = !!d.id && !(guardado.current.id === d.id && guardado.current.firma === firmaDiseno(d, visibles, fondo?.id ?? null, imagenes));

    const guardar = async (status) => {
        if (!hayAlgo || guardando) return;
        setGuardando(true); setAviso(null);
        const conArchivo = !!estado?.almacenamiento;
        const limpia = imagenLimpia();
        const otra = conCambios;
        const r = await publicidad(activeCompanyId, 'guardar', {
            id: otra ? null : d.id, title: d.title, status, formato: d.formato, campana: d.campana, estilo: estiloId,
            backgroundId: fondo?.id ?? null,
            productos: visibles.map(it => ({
                productId: it.productId, precioPublicidad: Number(it.precioPublicidad) || 0,
                etiqueta: it.etiqueta ?? '', nombreVisible: it.nombreVisible, presentacionId: it.presentacion?.id ?? null,
                fotoUrl: it.fotoPropia ? null : it.fotoUrl, fotoPropia: conArchivo ? it.fotoPropia : null,
            })),
            // Sin almacenamiento no hay dónde guardarlas: salen en la imagen, no en el diseño.
            imagenes: conArchivo ? imagenes.map(im => ({ id: im.id, quitarFondo: im.quitarFondo, ...(im.foto ? { foto: im.foto } : { fotoUrl: im.fotoUrl }) })) : [],
            textos: { titulo: d.titulo ?? campana.titulo, mensaje: d.mensaje, extra: d.extra, mostrarNegocio: d.mostrarNegocio },
            layout: {
                personalizado: d.personalizado, colores: d.colores, ajustes: d.ajustes, encuadre: d.encuadre, negocio: d.negocio, idea: d.idea.trim(),
                letras: d.letras, mover: d.mover,
                productos: Object.fromEntries(visibles.map(it => [it.productId, {
                    mostrarAntes: it.mostrarAntes, quitarFondo: it.quitarFondo, etiquetaPropia: it.etiqueta !== null,
                }])),
            },
            finalJpeg: conArchivo ? limpia.toDataURL('image/jpeg', 0.88) : null,
            miniatura: miniatura(limpia),
        }, 45000);
        setGuardando(false);
        if (!r.success) { avisar('error', r.message); return; }
        cambiar({ id: r.id, status });
        // Las fotos subidas ya quedaron guardadas: la próxima vez viajan solo como URL.
        const porId = new Map((r.productos || []).map(p => [p.productId, p]));
        const yaSubida = (it) => (it.fotoPropia && porId.get(it.productId)?.fotoUrl
            ? { ...it, fotoUrl: porId.get(it.productId).fotoUrl, fotoGuardada: it.fotoPropia, fotoPropia: null } : it);
        setItems(prev => prev.map(yaSubida));
        const imagenPorId = new Map((r.imagenes || []).map(im => [im.id, im.fotoUrl]));
        const imagenSubida = (im) => (im.foto && imagenPorId.get(im.id)
            ? { ...im, fotoUrl: imagenPorId.get(im.id), fotoGuardada: im.foto, foto: null } : im);
        setImagenes(prev => prev.map(imagenSubida));
        guardado.current = { id: r.id, firma: firmaDiseno(d, visibles.map(yaSubida), fondo?.id ?? null, imagenes.map(imagenSubida)) };
        const nombre = r.title ? ` «${r.title}»` : '';
        avisar('ok', otra
            ? `Guardada como otra publicidad${nombre}${status === 'final' ? '' : ' (borrador)'}. La anterior sigue igual en el Historial.`
            : status === 'final'
                ? `Publicidad${nombre} guardada como final.`
                : `Borrador${nombre} guardado.${conArchivo ? '' : ' (Sin almacenamiento configurado: se guardan los datos y la miniatura, no la imagen.)'}`);
    };

    const descargar = async () => {
        if (!lienzo.current || !hayAlgo) return;
        const r = await descargarImagen(imagenLimpia().toDataURL('image/jpeg', 0.92), nombreArchivo());
        if (r.mensaje) avisar(r.ok ? 'ok' : 'error', r.mensaje);
    };

    // Kevin, 26-oct-2026: el cartel A4 se imprime directo, sin bajarlo antes; el
    // 27-oct pidió lo mismo para todos los formatos. Va al doble (300 ppp en la
    // hoja) para que las letras salgan nítidas en papel.
    const imprimir = async () => {
        if (!lienzo.current || !hayAlgo || imprimiendo) return;
        setImprimiendo(true); setAviso(null);
        await new Promise(r => setTimeout(r, 30)); // que se vea "Preparando" antes del trabajo pesado
        let datos = imagenLimpia(2).toDataURL('image/jpeg', 0.92);
        // Un lienzo más grande que lo que aguanta el equipo sale vacío ("data:,"): va al tamaño normal.
        if (datos.length < 100) datos = imagenLimpia().toDataURL('image/jpeg', 0.92);
        const r = await imprimirImagen(datos, nombreArchivo().replace(/\.jpg$/, ''));
        setImprimiendo(false);
        if (!r.ok) avisar('error', r.mensaje);
    };

    const nueva = () => {
        setD(DISENO_VACIO); setItems([]); setImagenes([]); setFondos([]); setFondoId(null); setAviso(null); clave.current = null;
        setCambio(''); setConIdea(false); setSeleccion(null); setMenu(null); setPanelFondo(null);
        guardado.current = { id: null, firma: null };
    };

    // ── Abrir una guardada (desde el historial) ───────────────────────────────
    // `comoNueva` («Duplicar»): se abre igual pero sin guardar; al guardarla queda
    // otra publicidad, numerada si tiene el mismo nombre.
    const abrir = async (id, { comoNueva = false } = {}) => {
        setAbriendo(true); setAviso(null);
        const r = await publicidad(activeCompanyId, 'obtener', { id });
        setAbriendo(false);
        if (!r.success) { avisar('error', r.message); return; }
        const g = r.diseno;
        const lay = g.layout || {};
        const idAbierta = comoNueva ? null : g.id;
        if (comoNueva) avisar('ok', 'Copia abierta: cambiá lo que necesites (por ejemplo el precio) y guardala. La original no se toca.');
        // Hecha con chat: se abre en su pestaña, con sus pedidos y versiones.
        if (lay.modo === 'chat') {
            const abierta = {
                ...CHAT_VACIO, id: idAbierta, status: comoNueva ? 'borrador' : g.status, title: g.title || '', formato: g.format,
                personalizado: lay.personalizado || CHAT_VACIO.personalizado,
                mensajes: Array.isArray(lay.mensajes) ? lay.mensajes : [],
                actual: g.backgroundId, encuadre: { ...CHAT_VACIO.encuadre, ...(lay.encuadre || {}) },
            };
            setChat({ ...abierta, guardado: firmaChat(abierta) });
            setPestana('chat');
            return;
        }
        // Un recorte: se abre en su pestaña, listo para ponérselo a un producto.
        if (lay.modo === 'recorte') {
            const delRecorte = (r.fondos || []).find(f => f.id === g.backgroundId);
            const abierto = {
                formato: g.format, personalizado: lay.personalizado || RECORTE_VACIO.personalizado,
                tamano: Number(lay.tamano) > 0 ? Number(lay.tamano) : RECORTE_VACIO.tamano,
                fondo: lay.fondo === undefined ? RECORTE_VACIO.fondo : lay.fondo,
            };
            setRecorte({
                ...RECORTE_VACIO, ...abierto, id: idAbierta, title: g.title || '', nota: lay.nota || '',
                guardado: idAbierta ? firmaRecorte(abierto) : null,
                producto: lay.producto?.id ? { id: Number(lay.producto.id), name: lay.producto.nombre || '' } : null,
                fondoId: g.backgroundId, url: delRecorte?.url || g.finalUrl || null,
            });
            setPestana('recorte');
            return;
        }
        const abierta = {
            ...DISENO_VACIO, id: idAbierta, status: comoNueva ? 'borrador' : g.status, title: g.title || '', formato: g.format,
            personalizado: lay.personalizado || DISENO_VACIO.personalizado,
            campana: g.campaign || 'general', estilo: g.style || 'moderno', idea: lay.idea || '',
            titulo: g.textos?.titulo ?? null, mensaje: g.textos?.mensaje || '', extra: g.textos?.extra || '',
            mostrarNegocio: g.textos?.mostrarNegocio !== false, negocio: lay.negocio ?? null,
            colores: lay.colores || null, ajustes: { ...DISENO_VACIO.ajustes, ...(lay.ajustes || {}) },
            encuadre: { ...DISENO_VACIO.encuadre, ...(lay.encuadre || {}) },
            letras: lay.letras || DISENO_VACIO.letras, mover: lay.mover || {},
        };
        setD(abierta);
        const nuevos = (g.productos || []).map(p => {
            const extra = lay.productos?.[p.productId] || {};
            const pres = (presentacionesDe?.(p.productId) || []).filter(x => Number(x.is_active ?? 1) === 1)
                .map(x => ({ id: Number(x.id), nombre: x.name, unidades: Number(x.units), precio: Number(x.price) }));
            return {
                productId: p.productId, nombre: p.nombre, nombreVisible: p.nombreVisible || '', categoria: p.categoria, unidad: p.unidad,
                precioNormal: p.precioNormal, precioOferta: p.precioOferta, precioPublicidad: p.precioPublicidad,
                etiqueta: extra.etiquetaPropia ? (p.etiqueta || '') : null,
                presentacion: p.presentacion, presentaciones: pres,
                mostrarAntes: extra.mostrarAntes !== false, quitarFondo: extra.quitarFondo !== false,
                tieneFotoInventario: true, fotoInventario: null, fotoPropia: null, fotoUrl: p.fotoUrl || null, fotoGuardada: null,
                cargandoFoto: true,
            };
        });
        setItems(nuevos);
        const agregadas = (Array.isArray(lay.imagenes) ? lay.imagenes : []).filter(im => esImagen(im?.id) && im.fotoUrl)
            .map(im => ({ id: im.id, foto: null, fotoUrl: im.fotoUrl, fotoGuardada: null, quitarFondo: im.quitarFondo !== false }));
        setImagenes(agregadas);
        porElegir.current = null;
        const lista = (r.fondos || []).map(f => ({ id: f.id, url: f.url, modo: f.modo, productId: f.modo === 'integrado' ? nuevos[0]?.productId : null, dataUrl: null }));
        setFondos(lista);
        setFondoId(null);
        setPestana('crear');
        clave.current = null;
        setCambio('');
        setSeleccion(null);
        setMenu(null);
        setPanelFondo(null);
        const elegido = lista.find(f => f.id === g.backgroundId);
        if (elegido) elegirFondo(elegido);
        guardado.current = { id: idAbierta, firma: firmaDiseno(abierta, nuevos.slice(0, formatoPorId(g.format).max), elegido?.id ?? null, agregadas) };
        for (const it of nuevos) {
            if (it.fotoUrl) {
                publicidad(activeCompanyId, 'imagen', { url: it.fotoUrl }).then(x => {
                    if (x.success) cambiarItem(it.productId, { fotoGuardada: x.dataUrl, cargandoFoto: false });
                    else cargarFotoInventario(it.productId);
                });
            } else cargarFotoInventario(it.productId);
        }
        for (const im of agregadas) {
            publicidad(activeCompanyId, 'imagen', { url: im.fotoUrl }).then(x => {
                if (x.success) cambiarImagen(im.id, { fotoGuardada: x.dataUrl });
            });
        }
    };

    // El principal va primero (integrar, si hay un solo producto con foto).
    const botonIntegrar = (
        <Boton onClick={() => generar('integrado')} icono={generando === 'integrado' ? Loader2 : Wand2} girando={generando === 'integrado'}
            disabled={!integrable || !!generando || iaApagada} principal={integrable}>
            {fondos.some(f => f.modo === 'integrado') ? 'Otra escena con el producto' : 'Integrar producto con IA'}
        </Boton>
    );
    const botonFondo = (
        <Boton onClick={() => generar('fondo')} icono={generando === 'fondo' ? Loader2 : Sparkles} girando={generando === 'fondo'}
            disabled={!visibles.length || !!generando || iaApagada} principal={!integrable}>
            {fondos.some(f => f.modo === 'fondo') ? 'Otro fondo con IA' : 'Fondo con IA'}
        </Boton>
    );
    // Kevin, 28-oct-2026: junto al buscador. Desde el 29-oct lo que se sube es un complemento, no un producto.
    const botonImagen = (
        <button type="button" onClick={() => archivoImagen.current?.click()} disabled={imagenes.length >= MAX_IMAGENES}
            title={imagenes.length >= MAX_IMAGENES ? `Hasta ${MAX_IMAGENES} imágenes por publicidad` : 'Un logo, un sello u otra imagen: entra sin su fondo blanco y la llevás a donde quieras'}
            className="shrink-0 min-h-[44px] px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] text-sm font-bold text-[var(--color-text)] flex items-center justify-center gap-1.5 hover:border-[var(--color-primary)]/60 disabled:opacity-40">
            <Upload size={15} className="shrink-0" />
            <span className="sm:hidden">Imagen</span><span className="hidden sm:inline">Agregar imagen</span>
        </button>
    );
    const gastoIA = `Usa 1 imagen del mes${cupo ? ` (quedan ${cupo.restantes})` : ''}. Cambiar precios y textos no gasta.`;
    const encuadreMovido = d.encuadre.x !== 0 || d.encuadre.y !== 0 || d.encuadre.zoom !== 1;
    const alternarMenu = (id) => setMenu(m => (m === id ? null : id));

    // De dónde se eligen los productos: el buscador (todas), las ofertas o una categoría.
    const selectorFuente = (
        <select value={fuente} onChange={e => setFuente(e.target.value)} aria-label="Categoría" className="glass-input text-sm w-full sm:w-60 shrink-0"
            onMouseDown={() => fetchConteoCategorias?.()} onFocus={() => fetchConteoCategorias?.()}>
            <option value="">Todas las categorías</option>
            <option value={OFERTAS}>★ Ofertas</option>
            {opcionesCategoria.length > 0 && (
                <optgroup label="Categorías">
                    {opcionesCategoria.map(o => <option key={o.id} value={o.value}>{o.etiqueta}</option>)}
                </optgroup>
            )}
        </select>
    );

    if (estado && estado.success && !estado.permitido) {
        return (
            <div className="p-6">
                <div className="glass-card p-6 max-w-lg mx-auto text-center space-y-2">
                    <AlertTriangle className="mx-auto text-amber-400" />
                    <p className="font-bold text-[var(--color-text)]">No tenés habilitada la Publicidad</p>
                    <p className="text-sm text-[var(--color-text-muted)]">El dueño puede activarla para tu rol en Configuración → Roles.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col gap-4 p-3 sm:p-4 lg:p-6 overflow-y-auto">
            <div className="shrink-0 flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                    <h1 className="text-xl lg:text-2xl font-bold text-[var(--color-text)] flex items-center gap-2">
                        <Megaphone className="text-[var(--color-primary)]" /> Publicidad
                    </h1>
                    <p className="text-[var(--color-text-muted)] text-xs lg:text-sm">
                        {pestana === 'chat'
                            ? 'Escribí la publicidad que querés y la IA la hace completa. Después pedí cambios sobre la misma, o algo distinto.'
                            : pestana === 'recorte'
                                ? 'Sacale una foto al producto y la IA lo deja solo, sobre fondo blanco. Guardala en el Historial o ponela en un producto del inventario.'
                                : 'La IA crea solo el fondo; la foto real, el nombre y el precio los pone el sistema. Cambiar un precio no gasta imágenes.'}
                    </p>
                </div>
                <div className="w-full sm:w-auto flex flex-wrap items-center justify-end gap-2">
                    {cupo && (
                        <span title="Imágenes IA del mes" className="whitespace-nowrap text-xs font-bold px-3 py-1.5 rounded-full bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text-muted)]">
                            <span className="hidden sm:inline">Imágenes IA del mes: </span><span className="sm:hidden">IA: </span>
                            <span className="text-[var(--color-text)]">{cupo.usados} / {cupo.cupo}</span>
                        </span>
                    )}
                    {/* Cuatro pestañas: en el celular van a todo el ancho y sin ícono, para que entren */}
                    <div className="w-full sm:w-auto grid grid-cols-4 sm:flex rounded-lg border border-[var(--glass-border)] overflow-hidden">
                        {[['crear', 'Rápida', Zap], ['chat', 'Con chat', MessageSquare], ['recorte', 'Recortar', Scissors], ['historial', 'Historial', History]].map(([id, txt, icono]) => (
                            <button key={id} onClick={() => { setPestana(id); setSeleccion(null); setMenu(null); }}
                                className={`min-h-[44px] sm:min-h-0 px-1 sm:px-3 py-2 text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 whitespace-nowrap ${pestana === id ? 'bg-[var(--color-primary)] text-[var(--color-on-primary)]' : 'text-[var(--color-text-muted)]'}`}>
                                {React.createElement(icono, { size: 15, className: 'hidden sm:block shrink-0' })} {txt}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {estado && !estado.success && (
                <Banner tipo="error">No se pudo revisar la Publicidad: {estado.error}</Banner>
            )}
            {estado?.success && !estado.app && (
                <Banner tipo="error">Publicidad IA es una App del Marketplace: activala para generar fondos y guardar.</Banner>
            )}
            {estado?.success && estado.app && !estado.almacenamiento && (
                <Banner tipo="error">Falta configurar el almacenamiento de imágenes (Vercel Blob): por ahora no se pueden generar fondos con IA ni guardar la imagen final. El fondo de color y la descarga funcionan.</Banner>
            )}
            {aviso && <Banner tipo={aviso.tipo} onClose={() => setAviso(null)}>{aviso.texto}</Banner>}

            {pestana === 'historial' ? (
                <Historial companyId={activeCompanyId} dinero={dinero} onAbrir={abrir} abriendo={abriendo} avisar={avisar} />
            ) : pestana === 'chat' ? (
                <ChatPublicidad companyId={activeCompanyId} chat={chat} setChat={setChat} dinero={dinero} moneda={currentCurrency}
                    cupo={cupo} iaApagada={iaApagada} motivoSinIA={motivoSinIAChat} buscar={searchProductsForDropdown}
                    avisar={avisar} limpiarAviso={() => setAviso(null)} refrescarEstado={refrescarEstado} estado={estado} />
            ) : pestana === 'recorte' ? (
                <RecortePublicidad companyId={activeCompanyId} recorte={recorte} setRecorte={setRecorte} dinero={dinero}
                    cupo={cupo} iaApagada={iaApagada} motivoSinIA={motivoSinIAChat} buscar={searchProductsForDropdown}
                    avisar={avisar} limpiarAviso={() => setAviso(null)} refrescarEstado={refrescarEstado} estado={estado} />
            ) : (
                <>
                    {/* Productos: lo primero y a todo el ancho */}
                    <div className="glass-card p-3 relative z-30">
                        <input ref={archivoImagen} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) agregarImagen(f); }} />
                        {fuente ? (
                            <ListaProductos key={fuente} inicio={<>{selectorFuente}{botonImagen}</>} cargar={cargarFuente} dinero={dinero} yaElegidos={items.map(it => it.productId)}
                                vacio={fuente === OFERTAS
                                    ? 'No hay productos con oferta activa. Se prenden en Inventario → editar el producto → Oferta.'
                                    : 'Esta categoría no tiene productos.'}
                                libres={formato.max - items.length} onElegir={agregar} onQuitar={quitar} onAgregarVarios={agregarVarios} />
                        ) : (
                            <div className="flex flex-col sm:flex-row gap-2">
                                {selectorFuente}
                                <div className="flex-1 min-w-0 flex gap-2">
                                    <div className="flex-1 min-w-0">
                                        <BuscadorProductos buscar={searchProductsForDropdown} onElegir={agregar} dinero={dinero}
                                            yaElegidos={items.map(it => it.productId)} lleno={items.length >= formato.max} />
                                    </div>
                                    {botonImagen}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex flex-col lg:flex-row gap-4 min-h-0">
                        {/* Vista previa: primero en el celular, a la derecha en la PC */}
                        <div className="lg:order-2 lg:flex-1 min-w-0">
                            <div className="glass-card p-3 relative z-20 lg:sticky lg:top-0">
                                {/* Formato, letras y colores: se ven cambiar en la imagen al instante */}
                                <div ref={barraMenus} className="relative flex flex-wrap items-center gap-1.5 mb-2">
                                    <BotonMenu abierto={menu === 'formato'} onClick={() => alternarMenu('formato')} etiqueta={`Formato · ${ancho}×${alto}`}
                                        icono={<FormaFormato ancho={ancho} alto={alto} />}>
                                        <span className="sm:hidden">{formato.corto}</span><span className="hidden sm:inline">{formato.nombre}</span>
                                    </BotonMenu>
                                    <BotonMenu abierto={menu === 'letras'} onClick={() => alternarMenu('letras')} etiqueta="Tipo de letra" icono={<Type size={15} className="shrink-0" />}>
                                        {letras.nombre}
                                    </BotonMenu>
                                    <BotonMenu abierto={menu === 'colores'} onClick={() => alternarMenu('colores')} etiqueta="Colores" icono={<Muestras colores={colores} />}>
                                        <span className="hidden sm:inline">Colores</span>
                                    </BotonMenu>
                                    <div className="ml-auto flex items-center gap-1">
                                        {Object.keys(d.mover).some(k => !esImagen(k)) && (
                                            <button type="button" title="Volver todos los textos a su lugar"
                                                onClick={() => cambiar({ mover: Object.fromEntries(Object.entries(d.mover).filter(([k]) => esImagen(k))) })}
                                                className="min-h-[36px] px-2 rounded-lg text-xs font-bold text-[var(--color-primary)] flex items-center gap-1 hover:bg-white/5">
                                                <RotateCcw size={14} /> <span className="hidden sm:inline">Textos a su lugar</span>
                                            </button>
                                        )}
                                        {d.id && (
                                            <span className="hidden sm:inline text-[11px] font-bold text-[var(--color-text-muted)] px-1">
                                                #{d.id} · {d.status === 'final' ? 'Final' : 'Borrador'}
                                            </span>
                                        )}
                                        <Ayuda titulo="Cómo editar la imagen">
                                            Tocá un texto{visibles.length === 1 && !escenaIntegrada ? ', la foto' : ''} o una imagen agregada para elegirlo: arrastralo para moverlo y
                                            tirá de sus esquinas para agrandarlo o achicarlo. En la PC, las flechas lo corren y Esc lo suelta; Supr borra una imagen elegida.
                                            Lo que se guarda, se descarga o se imprime sale sin el marco.
                                        </Ayuda>
                                    </div>

                                    {menu && (
                                        <div className="absolute z-30 top-full mt-1.5 left-0 right-0 sm:right-auto sm:w-[380px] max-h-[65vh] overflow-y-auto rounded-xl border border-[var(--glass-border)] bg-[var(--color-surface)] shadow-2xl p-3">
                                            {menu === 'formato' && (
                                                <ListaFormatos formato={d.formato} personalizado={d.personalizado}
                                                    onElegir={(id) => { cambiar({ formato: id }); if (id !== 'personalizado') setMenu(null); }}
                                                    onPersonalizado={(p) => cambiar({ personalizado: p })} />
                                            )}
                                            {menu === 'letras' && (
                                                <>
                                                    <TituloMenu>Tipo de letra</TituloMenu>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        {LETRAS.map(l => (
                                                            <button key={l.id} type="button" onClick={() => cambiar({ letras: l.id })}
                                                                className={`min-h-[64px] px-2 py-1.5 rounded-lg border-2 flex flex-col items-center justify-center gap-0.5 ${d.letras === l.id ? 'border-[var(--color-primary)]' : 'border-[var(--glass-border)] hover:border-[var(--color-primary)]/50'}`}
                                                                style={{ background: `linear-gradient(135deg, ${colores.principal}22, ${colores.acento}33)` }}>
                                                                <span className="text-[var(--color-text)] leading-tight text-lg truncate max-w-full" style={{ fontFamily: l.titulo.familia, fontWeight: l.titulo.peso ?? 900 }}>
                                                                    OFERTA <span style={{ fontFamily: l.precio.familia, fontWeight: l.precio.peso ?? 900 }}>{dinero(990)}</span>
                                                                </span>
                                                                <span className="text-[10px] font-bold text-[var(--color-text-muted)]">{l.nombre}</span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                </>
                                            )}
                                            {menu === 'colores' && (
                                                <>
                                                    <TituloMenu>Combinaciones</TituloMenu>
                                                    <div className="grid grid-cols-4 gap-2">
                                                        {PALETAS.map(p => {
                                                            const activa = ['principal', 'acento', 'texto'].every(k => String(colores[k]).toLowerCase() === p[k].toLowerCase());
                                                            return (
                                                                <button key={p.id} type="button" title={p.nombre} aria-label={p.nombre}
                                                                    onClick={() => cambiar({ colores: { principal: p.principal, acento: p.acento, texto: p.texto } })}
                                                                    className={`h-11 rounded-lg overflow-hidden flex border-2 ${activa ? 'border-[var(--color-primary)]' : 'border-[var(--glass-border)] hover:border-[var(--color-primary)]/50'}`}>
                                                                    <span className="flex-[3]" style={{ background: p.principal }} />
                                                                    <span className="flex-[2]" style={{ background: p.acento }} />
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                    <TituloMenu className="mt-4">A tu gusto</TituloMenu>
                                                    <div className="grid grid-cols-3 gap-2">
                                                        {[['principal', 'Principal'], ['acento', 'Etiqueta'], ['texto', 'Texto']].map(([k, txt]) => (
                                                            <label key={k} className="text-[11px] font-bold text-[var(--color-text-muted)] flex flex-col gap-1">
                                                                {txt}
                                                                <input type="color" value={colores[k]} onChange={e => cambiar({ colores: { ...colores, [k]: e.target.value } })}
                                                                    className="w-full h-10 rounded border border-[var(--glass-border)] bg-transparent" />
                                                            </label>
                                                        ))}
                                                    </div>
                                                    {d.colores && (
                                                        <button type="button" onClick={() => cambiar({ colores: null })} className="min-h-[36px] mt-2 text-xs font-bold text-[var(--color-primary)]">
                                                            Volver a los colores del estilo
                                                        </button>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>

                                <div className="relative bg-black/20 rounded-lg flex items-center justify-center overflow-hidden">
                                    <canvas ref={lienzo} className={`block max-w-full h-auto max-h-[55vh] lg:max-h-[70vh] select-none ${hayAlgo ? '' : 'opacity-30'}`}
                                        onPointerDown={empezarArrastre} onPointerMove={moverArrastre} onPointerUp={soltarArrastre}
                                        onPointerCancel={soltarArrastre} onLostPointerCapture={soltarArrastre} />
                                    {!hayAlgo && (
                                        <p className="absolute inset-0 flex items-center justify-center text-sm text-white font-bold text-center px-6">
                                            Buscá un producto arriba para empezar
                                        </p>
                                    )}
                                    {generando && (
                                        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2 text-white">
                                            <Loader2 className="animate-spin" size={32} />
                                            <p className="text-sm font-bold">{generando === 'ajuste' ? 'Ajustando el fondo… (15 a 25 s)' : 'Generando con IA… (10 a 20 s)'}</p>
                                        </div>
                                    )}
                                </div>
                                {seleccion && (
                                    <BarraPieza nombre={nombrePieza(seleccion)} tamano={tamanoDe(seleccion)} tope={topeTamano(seleccion)}
                                        nota={seleccion === 'pie' && tamanoDe('pie') >= 1 ? 'Ocupa todo el ancho: achicalo para moverlo a los lados.' : null}
                                        onTamano={(v) => cambiarTamano(seleccion, v)} onASuLugar={() => piezaASuLugar(seleccion)} onListo={() => setSeleccion(null)}
                                        onQuitar={esImagen(seleccion) ? () => quitarImagen(seleccion) : null} />
                                )}
                                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 2xl:grid-cols-4 gap-2 mt-3">
                                    <Boton onClick={imprimir} disabled={!hayAlgo || imprimiendo} icono={imprimiendo ? Loader2 : Printer} girando={imprimiendo} principal={formato.hoja} className="col-span-full">
                                        {imprimiendo ? 'Preparando la hoja…' : formato.hoja ? 'Imprimir cartel A4' : 'Imprimir'}
                                    </Boton>
                                    <Boton onClick={() => guardar('borrador')} disabled={!hayAlgo || guardando || !estado?.app} icono={guardando ? Loader2 : Save} girando={guardando}>Borrador</Boton>
                                    <Boton onClick={() => guardar('final')} disabled={!hayAlgo || guardando || !estado?.app} icono={CheckCircle2}>Guardar final</Boton>
                                    <Boton onClick={descargar} disabled={!hayAlgo} icono={Download} principal={!formato.hoja}>Descargar</Boton>
                                    <Boton onClick={nueva} icono={Plus}>Nueva</Boton>
                                </div>
                                {conCambios && hayAlgo && (
                                    <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">
                                        Con estos cambios se guarda como otra publicidad: la anterior queda igual en el Historial.
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Controles */}
                        <div className="lg:order-1 lg:w-[440px] shrink-0 flex flex-col gap-4">
                            {/* La IA es la protagonista: sus botones van primero */}
                            <Seccion titulo="Fondo con IA">
                                <div className="flex flex-col gap-2">
                                    {(integrable ? ['integrado', 'fondo'] : ['fondo', 'integrado']).map(modo => (
                                        <div key={modo} className="flex items-center gap-1">
                                            <div className="flex-1 min-w-0 grid">{modo === 'integrado' ? botonIntegrar : botonFondo}</div>
                                            <Ayuda titulo={modo === 'integrado' ? 'Integrar producto con IA' : 'Fondo con IA'}>
                                                {modo === 'integrado'
                                                    ? 'La IA ve la foto y arma la escena alrededor de tu producto, con luz, sombra e ingredientes que combinan. Es lo que mejor sale con 1 producto con foto. Revisá el envase antes de publicar: puede variar un poco.'
                                                    : 'Una foto de ambiente detrás de tus productos, que combina con ellos por su nombre. Sirve para 2 a 6 productos. Con el estilo Automático elige según tus productos y la fecha, y cada vez sale distinta.'}
                                                {' '}{gastoIA}
                                            </Ayuda>
                                        </div>
                                    ))}
                                </div>
                                {motivoSinIA && <p className="text-xs font-bold text-amber-400">{motivoSinIA}</p>}

                                <div className="grid grid-cols-2 gap-2">
                                    <Campo etiqueta="Campaña">
                                        <select value={d.campana} onChange={e => cambiar({ campana: e.target.value })} className="glass-input w-full text-sm px-2.5">
                                            {CAMPANAS.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                                        </select>
                                    </Campo>
                                    <div className="flex flex-col gap-1 min-w-0">
                                        <span className="flex items-center justify-between gap-1 text-[11px] font-bold text-[var(--color-text-muted)]">
                                            Estilo
                                            <Ayuda chica titulo="Estilo del fondo">
                                                Automático elige el estilo según tus productos y la fecha, y cada fondo sale distinto.
                                                {visibles.length > 0 && <> Ahora usaría <b className="text-[var(--color-text)]">{estiloPorId(sugerido.id).nombre}</b>{sugerido.motivo ? ` ${sugerido.motivo}` : ''}.</>}
                                                {' '}Elegir otro estilo cambia también los colores.
                                            </Ayuda>
                                        </span>
                                        <select value={d.estilo} onChange={e => cambiar({ estilo: e.target.value, colores: null })} aria-label="Estilo" className="glass-input w-full text-sm px-2.5">
                                            <option value={ESTILO_AUTO}>✨ Automático</option>
                                            {GRUPOS_ESTILO.map(g => (
                                                <optgroup key={g.id} label={g.nombre}>
                                                    {ESTILOS.filter(s => s.grupo === g.id).map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                                                </optgroup>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                {conIdea || d.idea ? (
                                    <div className="flex flex-col gap-2">
                                        <Campo etiqueta="Tu idea para el fondo (opcional)">
                                            <textarea value={d.idea} maxLength={300} rows={2} onChange={e => cambiar({ idea: e.target.value })}
                                                className="glass-input w-full text-sm resize-none" placeholder="Ej: mesa de madera con limones y hielo" />
                                        </Campo>
                                        <div className="flex flex-wrap gap-1.5">
                                            {IDEAS_EJEMPLO.map(t => <Chip key={t} activo={d.idea === t} onClick={() => cambiar({ idea: t })}>{t}</Chip>)}
                                        </div>
                                        <button onClick={() => { cambiar({ idea: '' }); setConIdea(false); }} className="min-h-[32px] text-xs font-bold text-[var(--color-text-muted)] self-start">
                                            Quitar mi idea y que la IA elija
                                        </button>
                                    </div>
                                ) : (
                                    <button onClick={() => setConIdea(true)} className="min-h-[32px] text-xs font-bold text-[var(--color-primary)] flex items-center gap-1 self-start">
                                        <Lightbulb size={14} /> Tengo una idea para el fondo (opcional)
                                    </button>
                                )}

                                <div className="flex gap-2 overflow-x-auto pb-1">
                                    <button onClick={() => elegirFondo(null)} title="Sin IA: fondo de color"
                                        className={`shrink-0 w-16 h-16 rounded-lg border-2 flex flex-col items-center justify-center text-[10px] font-bold ${fondoId === null ? 'border-[var(--color-primary)]' : 'border-[var(--glass-border)]'}`}
                                        style={{ background: `linear-gradient(135deg, ${colores.principal}33, ${colores.acento}55)` }}>
                                        <Palette size={16} /> Color
                                    </button>
                                    {fondos.map(f => (
                                        <button key={f.id} onClick={() => { if (f.id !== fondoId) cambiar({ encuadre: DISENO_VACIO.encuadre }); elegirFondo(f); }} title={f.modo === 'integrado' ? 'Escena con el producto' : 'Fondo IA'}
                                            className={`shrink-0 w-16 h-16 rounded-lg border-2 overflow-hidden bg-black/30 flex items-center justify-center ${fondoId === f.id ? 'border-[var(--color-primary)]' : 'border-[var(--glass-border)]'}`}>
                                            {f.dataUrl ? <img src={f.dataUrl} alt="" className="w-full h-full object-cover" /> : <ImageIcon size={18} className="text-[var(--color-text-muted)]" />}
                                        </button>
                                    ))}
                                </div>

                                {fondo && (
                                    <div className="grid grid-cols-2 gap-2">
                                        {[['encuadre', 'Encuadre', Move], ['ajustar', 'Ajustar con IA', Wand2]].map(([id, txt, icono]) => (
                                            <button key={id} type="button" onClick={() => setPanelFondo(p => (p === id ? null : id))} aria-expanded={panelFondo === id}
                                                className={`min-h-[40px] px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 border ${panelFondo === id
                                                    ? 'border-[var(--color-primary)] text-[var(--color-primary)] bg-[var(--color-primary)]/10'
                                                    : 'border-[var(--glass-border)] text-[var(--color-text)] bg-[var(--glass-bg)]'}`}>
                                                {React.createElement(icono, { size: 14, className: 'shrink-0' })} <span className="truncate">{txt}</span>
                                                {id === 'encuadre' && encuadreMovido && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-[var(--color-primary)]" aria-label="cambiado" />}
                                                <ChevronDown size={14} className={`shrink-0 transition-transform ${panelFondo === id ? 'rotate-180' : ''}`} />
                                            </button>
                                        ))}
                                    </div>
                                )}
                                {fondo && panelFondo === 'encuadre' && (
                                    <div className="rounded-lg border border-[var(--glass-border)] p-3 flex flex-col gap-2">
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="text-[11px] font-bold text-[var(--color-text-muted)]">Encuadre del fondo · no gasta imágenes</p>
                                            <Ayuda chica titulo="Encuadre del fondo">
                                                La IA hace la foto más grande de lo que se ve. Subila para que el producto quede lejos del precio, o alejala
                                                si quedó muy grande. Lo que queda sin foto se rellena con la misma imagen, difuminada.
                                            </Ayuda>
                                        </div>
                                        <Deslizador etiqueta="Arriba o abajo" extremos={['Bajar', 'Subir']} min={-1} max={1} paso={0.02} valor={d.encuadre.y}
                                            onChange={v => cambiar({ encuadre: { ...d.encuadre, y: v } })} />
                                        <Deslizador etiqueta="A los lados" extremos={['Izquierda', 'Derecha']} min={-1} max={1} paso={0.02} valor={d.encuadre.x}
                                            onChange={v => cambiar({ encuadre: { ...d.encuadre, x: v } })} />
                                        <Deslizador etiqueta="Tamaño" extremos={['Alejar', 'Acercar']} min={0.6} max={1.4} paso={0.02} valor={d.encuadre.zoom}
                                            onChange={v => cambiar({ encuadre: { ...d.encuadre, zoom: v } })} />
                                        {encuadreMovido && (
                                            <button onClick={() => cambiar({ encuadre: DISENO_VACIO.encuadre })} className="min-h-[32px] text-xs font-bold text-[var(--color-primary)] self-start">
                                                Volver al centro
                                            </button>
                                        )}
                                    </div>
                                )}
                                {fondo && panelFondo === 'ajustar' && (
                                    <div className="rounded-lg border border-[var(--glass-border)] p-3 flex flex-col gap-2">
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="text-[11px] font-bold text-[var(--color-text-muted)]">Pedile un cambio a este fondo</p>
                                            <Ayuda chica titulo="Ajustar con IA">
                                                Le pedís un cambio al fondo elegido ("más luminoso", "agregá hielo") sin empezar de cero. {gastoIA}
                                            </Ayuda>
                                        </div>
                                        <div className="flex flex-wrap gap-1.5">
                                            {AJUSTES_RAPIDOS.map(t => <Chip key={t} activo={cambio === t} onClick={() => setCambio(t)}>{t}</Chip>)}
                                        </div>
                                        <div className="flex gap-2">
                                            <input value={cambio} maxLength={300} onChange={e => setCambio(e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter') generar('ajuste'); }}
                                                placeholder="O escribí el cambio: agregá hielo, más rojo…" className="glass-input flex-1 min-w-0 text-sm" />
                                            <button onClick={() => generar('ajuste')} disabled={!cambio.trim() || !!generando || iaApagada}
                                                className="shrink-0 min-h-[44px] px-3 rounded-lg text-sm font-bold flex items-center gap-1.5 bg-[var(--color-primary)] text-[var(--color-on-primary)] disabled:opacity-40">
                                                {generando === 'ajuste' ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />} Ajustar
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </Seccion>

                            <Seccion titulo={`Productos (${items.length}/${formato.max})`}>
                                {!items.length && (
                                    <p className="text-xs text-[var(--color-text-muted)]">Buscá un producto arriba, o elegí una categoría o las ofertas. Para sumar un logo u otra imagen, usá «Agregar imagen» junto al buscador.</p>
                                )}
                                {items.map(it => (
                                    <ItemProducto key={it.productId} it={it} dinero={dinero} campana={campana} varios={visibles.length > 2}
                                        onCambiar={(c) => cambiarItem(it.productId, c)}
                                        onPresentacion={(v) => elegirPresentacion(it, v)}
                                        onFoto={(f) => subirFoto(it, f)}
                                        onVigencia={(texto) => cambiar({ mensaje: texto })}
                                        onQuitar={() => quitar(it.productId)} />
                                ))}
                                {items.length > formato.max && (
                                    <p className="text-xs text-amber-400">Este formato muestra hasta {formato.max} productos: los demás no salen en la imagen.</p>
                                )}
                            </Seccion>

                            {imagenes.length > 0 && (
                                <Seccion titulo={`Imágenes agregadas (${imagenes.length}/${MAX_IMAGENES})`}>
                                    {imagenes.map((im, i) => (
                                        <div key={im.id} className={`flex items-center gap-2 p-2 rounded-lg border ${seleccion === im.id ? 'border-[var(--color-primary)]' : 'border-[var(--glass-border)]'}`}>
                                            <button type="button" onClick={() => setSeleccion(im.id)} title="Elegirla en la imagen" className="shrink-0 rounded-lg overflow-hidden">
                                                <FotoProducto foto={im.foto || im.fotoGuardada || undefined} lado={44} />
                                            </button>
                                            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                                                <button type="button" onClick={() => setSeleccion(im.id)} className="min-h-[28px] text-left text-sm font-bold text-[var(--color-text)] truncate">
                                                    Imagen {i + 1}
                                                </button>
                                                <label className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
                                                    <input type="checkbox" checked={im.quitarFondo} onChange={e => cambiarImagen(im.id, { quitarFondo: e.target.checked })} />
                                                    Quitar fondo blanco
                                                </label>
                                            </div>
                                            <button type="button" onClick={() => quitarImagen(im.id)} aria-label={`Quitar la imagen ${i + 1}`}
                                                className="shrink-0 w-11 h-11 rounded-lg flex items-center justify-center text-[var(--color-text-muted)] hover:text-red-400 hover:bg-white/5">
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    ))}
                                    <p className="text-[11px] text-[var(--color-text-muted)]">
                                        Van encima de la publicidad: tocala en la imagen para moverla y tirá de sus esquinas para cambiar el tamaño.
                                    </p>
                                </Seccion>
                            )}

                            <Seccion titulo="Textos">
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-2">
                                    <Campo etiqueta="Título">
                                        <input value={d.titulo ?? campana.titulo} maxLength={60} onChange={e => cambiar({ titulo: e.target.value })} className="glass-input w-full text-sm" />
                                    </Campo>
                                    <Campo etiqueta="Mensaje">
                                        <input value={d.mensaje} maxLength={140} onChange={e => cambiar({ mensaje: e.target.value })} className="glass-input w-full text-sm" placeholder="Ej: Solo este sábado" />
                                    </Campo>
                                </div>
                                <Campo etiqueta="Pie: texto adicional">
                                    <input value={d.extra} maxLength={80} onChange={e => cambiar({ extra: e.target.value })} className="glass-input w-full text-sm" placeholder="Ej: WhatsApp +56 9 1234 5678" />
                                </Campo>
                                <div className="flex flex-col gap-1">
                                    <label className="flex items-center gap-2 text-[11px] font-bold text-[var(--color-text-muted)]">
                                        <input type="checkbox" checked={d.mostrarNegocio} onChange={e => cambiar({ mostrarNegocio: e.target.checked })} />
                                        Nombre del negocio en el pie
                                    </label>
                                    {d.mostrarNegocio && (
                                        <input value={d.negocio ?? nombreEmpresa} maxLength={60} onChange={e => cambiar({ negocio: e.target.value })} aria-label="Nombre del negocio" className="glass-input w-full text-sm" />
                                    )}
                                </div>
                                <Campo etiqueta="Nombre en el historial">
                                    <input value={d.title} maxLength={120} onChange={e => cambiar({ title: e.target.value })} className="glass-input w-full text-sm" placeholder="Ej: Ofertas fin de semana" />
                                </Campo>
                            </Seccion>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

// ── Piezas ────────────────────────────────────────────────────────────────────

function Banner({ tipo, children, onClose }) {
    const error = tipo === 'error';
    return (
        <div className={`shrink-0 flex items-start gap-2 p-3 rounded-lg border text-sm ${error ? 'bg-red-500/10 border-red-500/30 text-red-300' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'}`}>
            {error ? <AlertTriangle size={16} className="shrink-0 mt-0.5" /> : <CheckCircle2 size={16} className="shrink-0 mt-0.5" />}
            <p className="flex-1 min-w-0">{children}</p>
            {onClose && <button onClick={onClose} className="shrink-0 p-1 -m-1" aria-label="Cerrar"><X size={16} /></button>}
        </div>
    );
}

function Seccion({ titulo, children }) {
    return (
        <div className="glass-card p-4 flex flex-col gap-3">
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{titulo}</p>
            {children}
        </div>
    );
}

function Campo({ etiqueta, children }) {
    return (
        <label className="flex flex-col gap-1 text-[11px] font-bold text-[var(--color-text-muted)] min-w-0">
            {etiqueta}
            {children}
        </label>
    );
}

function Boton({ onClick, disabled, icono: Icono, girando, principal, className = '', children }) {
    return (
        <button onClick={onClick} disabled={disabled}
            className={`${className} min-h-[44px] px-3 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-1.5 border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${principal
                ? 'bg-[var(--color-primary)] text-[var(--color-on-primary)] border-[var(--color-primary)]'
                : 'bg-[var(--glass-bg)] text-[var(--color-text)] border-[var(--glass-border)]'}`}>
            {Icono && <Icono size={16} className={girando ? 'animate-spin' : ''} />}
            <span className="truncate">{children}</span>
        </button>
    );
}

function Chip({ activo, onClick, children }) {
    return (
        <button type="button" onClick={onClick}
            className={`min-h-[36px] px-3 rounded-full text-[11px] font-bold border ${activo
                ? 'bg-[var(--color-primary)] text-[var(--color-on-primary)] border-[var(--color-primary)]'
                : 'bg-[var(--glass-bg)] text-[var(--color-text)] border-[var(--glass-border)]'}`}>
            {children}
        </button>
    );
}

function Deslizador({ etiqueta, min, max, paso, valor, onChange, extremos }) {
    return (
        <label className="flex flex-col gap-1 text-[11px] font-bold text-[var(--color-text-muted)]">
            {etiqueta}
            <span className="flex items-center gap-2 font-normal">
                {extremos && <span className="w-14 shrink-0">{extremos[0]}</span>}
                <input type="range" min={min} max={max} step={paso} value={valor} onChange={e => onChange(Number(e.target.value))} className="flex-1 min-w-0" />
                {extremos && <span className="w-14 shrink-0 text-right">{extremos[1]}</span>}
            </span>
        </label>
    );
}

/**
 * El "?" que explica algo sin ocupar lugar en la pantalla (Kevin, 26-oct-2026).
 * Con el mouse se abre al pasar por encima; en el celular, con un toque, y se
 * cierra tocando fuera. Va en un portal para que ninguna tarjeta lo tape.
 */
function Ayuda({ titulo, chica, children }) {
    const boton = useRef(null);
    const fija = useRef(false); // abierta con un clic o un toque: no se cierra al sacar el mouse
    const [pos, setPos] = useState(null);

    const abrir = () => {
        const r = boton.current?.getBoundingClientRect();
        if (!r) return;
        const ancho = Math.min(300, window.innerWidth - 24);
        const left = limitar(r.right - ancho, 12, window.innerWidth - ancho - 12);
        // Abajo del "?", o arriba si está muy abajo en la pantalla.
        setPos(r.bottom < window.innerHeight * 0.6
            ? { left, ancho, top: r.bottom + 6 }
            : { left, ancho, bottom: window.innerHeight - r.top + 6 });
    };
    const cerrar = useCallback(() => { fija.current = false; setPos(null); }, []);

    useEffect(() => {
        if (!pos) return undefined;
        const fuera = (e) => { if (!boton.current?.contains(e.target)) cerrar(); };
        document.addEventListener('pointerdown', fuera);
        window.addEventListener('scroll', cerrar, true);
        window.addEventListener('resize', cerrar);
        return () => {
            document.removeEventListener('pointerdown', fuera);
            window.removeEventListener('scroll', cerrar, true);
            window.removeEventListener('resize', cerrar);
        };
    }, [pos, cerrar]);

    return (
        <>
            <button ref={boton} type="button" aria-label={`Ayuda: ${titulo}`} aria-expanded={!!pos}
                onClick={() => { if (pos && fija.current) cerrar(); else { fija.current = true; abrir(); } }}
                onMouseEnter={() => { if (!pos) abrir(); }} onMouseLeave={() => { if (!fija.current) setPos(null); }}
                className={`shrink-0 inline-flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:text-[var(--color-primary)] ${pos ? 'text-[var(--color-primary)]' : ''} ${chica ? 'w-6 h-6 -my-1' : 'w-9 h-11'}`}>
                <CircleHelp size={chica ? 14 : 18} />
            </button>
            {pos && createPortal(
                <div role="tooltip" style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.ancho }}
                    className="z-[200] p-3 rounded-lg border border-[var(--glass-border)] bg-[var(--color-surface)] shadow-2xl text-xs leading-relaxed text-[var(--color-text-muted)] font-normal normal-case tracking-normal text-left pointer-events-none">
                    {titulo && <p className="font-bold text-[var(--color-text)] mb-1">{titulo}</p>}
                    {children}
                </div>,
                document.body,
            )}
        </>
    );
}

/** Un botón de la barra de la vista previa que abre su menú (formato, letras, colores). */
function BotonMenu({ abierto, onClick, etiqueta, icono, children }) {
    return (
        <button type="button" onClick={onClick} aria-expanded={abierto} aria-haspopup="true" title={etiqueta}
            className={`min-h-[36px] px-2.5 rounded-lg text-xs font-bold flex items-center gap-1.5 border transition-colors ${abierto
                ? 'border-[var(--color-primary)] text-[var(--color-primary)] bg-[var(--color-primary)]/10'
                : 'border-[var(--glass-border)] text-[var(--color-text)] bg-[var(--glass-bg)] hover:border-[var(--color-primary)]/60'}`}>
            {icono}
            <span className="truncate max-w-[7.5rem] sm:max-w-[12rem]">{children}</span>
            <ChevronDown size={14} className={`shrink-0 transition-transform ${abierto ? 'rotate-180' : ''}`} />
        </button>
    );
}

/** Los formatos, con el dibujo de su proporción y su medida (la rápida y el chat). */
function ListaFormatos({ formato, personalizado, onElegir, onPersonalizado }) {
    return (
        <>
            <TituloMenu>Formato</TituloMenu>
            <div className="flex flex-col gap-0.5">
                {FORMATOS.map(f => {
                    const m = medidas(f.id, personalizado);
                    const activo = formato === f.id;
                    return (
                        <button key={f.id} type="button" onClick={() => onElegir(f.id)}
                            className={`min-h-[48px] px-2 py-1.5 rounded-lg flex items-center gap-3 text-left ${activo ? 'bg-[var(--color-primary)]/15 text-[var(--color-primary)]' : 'text-[var(--color-text-muted)] hover:bg-white/5'}`}>
                            <FormaFormato ancho={m.ancho} alto={m.alto} lado={22} />
                            <span className="flex-1 min-w-0">
                                <span className="block text-sm font-bold text-[var(--color-text)] truncate">{f.nombre}</span>
                                <span className="block text-[11px] text-[var(--color-text-muted)] truncate">{f.detalle}</span>
                            </span>
                            <span className="shrink-0 text-[11px] tabular-nums text-[var(--color-text-muted)]">{m.ancho}×{m.alto}</span>
                        </button>
                    );
                })}
            </div>
            {formato === 'personalizado' && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                    <Campo etiqueta="Ancho (px)">
                        <input type="number" min={300} max={2400} value={personalizado.ancho} className="glass-input w-full text-sm"
                            onChange={e => onPersonalizado({ ...personalizado, ancho: e.target.value })} />
                    </Campo>
                    <Campo etiqueta="Alto (px)">
                        <input type="number" min={300} max={2400} value={personalizado.alto} className="glass-input w-full text-sm"
                            onChange={e => onPersonalizado({ ...personalizado, alto: e.target.value })} />
                    </Campo>
                </div>
            )}
        </>
    );
}

function TituloMenu({ className = '', children }) {
    return <p className={`${className} text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2`}>{children}</p>;
}

/** El dibujo de un formato: un rectángulo con su proporción. */
function FormaFormato({ ancho, alto, lado = 15 }) {
    const w = Number(ancho) || 1, h = Number(alto) || 1;
    const f = lado / Math.max(w, h);
    return (
        <span className="shrink-0 inline-flex items-center justify-center" style={{ width: lado, height: lado }}>
            <span className="block rounded-[2px] border-[1.5px] border-current" style={{ width: Math.max(5, Math.round(w * f)), height: Math.max(5, Math.round(h * f)) }} />
        </span>
    );
}

/** Los tres colores del diseño, como puntos. */
function Muestras({ colores }) {
    return (
        <span className="flex -space-x-1 shrink-0">
            {['principal', 'acento', 'texto'].map(k => (
                <span key={k} className="w-3.5 h-3.5 rounded-full border border-black/40" style={{ background: colores[k] }} />
            ))}
        </span>
    );
}

/** La barra de la pieza elegida en la vista previa: su tamaño, volverla a su lugar y soltarla. */
/** `onQuitar`: solo las imágenes agregadas se borran desde acá; su "lugar" es el centro. */
function BarraPieza({ nombre, tamano, tope, nota, onTamano, onASuLugar, onListo, onQuitar }) {
    const boton = 'shrink-0 w-11 h-11 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[var(--color-text)] font-black text-sm disabled:opacity-40';
    return (
        <div className="mt-2 rounded-lg border border-[var(--color-primary)] p-2 flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-[var(--color-text)] w-full sm:w-auto">{nombre}</span>
            <div className="flex items-center gap-2 flex-1 min-w-[220px]">
                <button type="button" onClick={() => onTamano(tamano / 1.1)} disabled={tamano <= tope.min} className={boton} aria-label="Achicar">A−</button>
                <input type="range" min={tope.min} max={tope.max} step={0.05} value={tamano} onChange={e => onTamano(Number(e.target.value))}
                    className="flex-1 min-w-0" aria-label={`Tamaño: ${nombre}`} />
                <button type="button" onClick={() => onTamano(tamano * 1.1)} disabled={tamano >= tope.max} className={boton} aria-label="Agrandar">A+</button>
                <span className="shrink-0 w-11 text-right text-[11px] font-bold tabular-nums text-[var(--color-text-muted)]">{Math.round(tamano * 100)}%</span>
            </div>
            <div className="flex items-center gap-2 ml-auto">
                {onQuitar && (
                    <button type="button" onClick={onQuitar} className="min-h-[44px] px-2 text-xs font-bold text-red-400 flex items-center gap-1">
                        <Trash2 size={14} /> Quitar
                    </button>
                )}
                <button type="button" onClick={onASuLugar} className="min-h-[44px] px-2 text-xs font-bold text-[var(--color-primary)]">{onQuitar ? 'Al centro' : 'A su lugar'}</button>
                <button type="button" onClick={onListo} className="min-h-[44px] px-4 rounded-lg text-xs font-bold bg-[var(--color-primary)] text-[var(--color-on-primary)]">Listo</button>
            </div>
            {nota && <p className="w-full text-[11px] text-[var(--color-text-muted)]">{nota}</p>}
        </div>
    );
}

// Las fotos de los productos del buscador y de los adjuntos del chat (Kevin,
// 27-oct-2026: "cómo sé si ese producto tiene imagen o no"). Primero las que ya
// están en el equipo y las que faltan en un solo pedido. Las que no tienen foto
// en el inventario no se piden. Si el pedido falla no se anota nada: se vuelve
// a intentar en la próxima búsqueda.
const fotosCache = new Map();   // `${companyId}:${id}` → data URL, o null si no tiene foto
const fotosEnCamino = new Map(); // `${companyId}:${id}` → la promesa del pedido que la trae

/** Trae las fotos que faltan (sin pedir dos veces la que ya viene en camino). */
function pedirFotos(companyId, ids) {
    const k = (id) => `${companyId}:${id}`;
    const nuevos = ids.filter(id => !fotosCache.has(k(id)) && !fotosEnCamino.has(k(id)));
    if (nuevos.length) {
        const pedido = (async () => {
            const locales = await imagenesGuardadas(nuevos).catch(() => ({}));
            const red = nuevos.filter(id => !locales[id]);
            const deRed = {};
            let respondio = true;
            if (red.length) {
                try {
                    for (const f of await reportCall(companyId, 'productImages', { ids: red })) if (f.image) deRed[Number(f.id)] = f.image;
                    if (Object.keys(deRed).length) guardarImagenes(companyId, deRed).catch(() => {});
                } catch { respondio = false; }
            }
            for (const id of nuevos) {
                const foto = locales[id] || deRed[id];
                if (foto) fotosCache.set(k(id), aDataUrl(foto));
                else if (respondio) fotosCache.set(k(id), null);
                fotosEnCamino.delete(k(id));
            }
        })();
        for (const id of nuevos) fotosEnCamino.set(k(id), pedido);
    }
    return Promise.all(ids.map(id => fotosEnCamino.get(k(id))).filter(Boolean));
}

function useFotosProductos(companyId, productos) {
    const [, setVersion] = useState(0);
    const ids = productos.map(p => `${p.id}:${p.has_image}`).join(',');
    useEffect(() => {
        if (!companyId || !productos.length) return undefined;
        for (const p of productos) if (Number(p.has_image) === 0) fotosCache.set(`${companyId}:${p.id}`, null);
        const pedir = productos.filter(p => Number(p.has_image) !== 0).map(p => Number(p.id)).slice(0, 12);
        let vivo = true;
        pedirFotos(companyId, pedir).then(() => { if (vivo) setVersion(v => v + 1); });
        return () => { vivo = false; };
    }, [companyId, ids]); // eslint-disable-line react-hooks/exhaustive-deps
    return (id) => fotosCache.get(`${companyId}:${id}`); // undefined: todavía no se sabe
}

/** La foto del producto en chico; sin foto, el aviso; mientras carga, la ruedita. */
function FotoProducto({ foto, lado = 40 }) {
    return (
        <span className="shrink-0 rounded bg-white flex items-center justify-center overflow-hidden" style={{ width: lado, height: lado }}>
            {foto ? <img src={foto} alt="" className="max-w-full max-h-full object-contain" />
                : foto === null ? <ImageOff size={Math.round(lado * 0.42)} className="text-amber-500" aria-label="Sin foto" />
                    : <Loader2 size={Math.round(lado * 0.38)} className="animate-spin text-gray-400" />}
        </span>
    );
}

function BuscadorProductos({ buscar, onElegir, dinero, yaElegidos, lleno }) {
    const companyId = useStore(s => s.activeCompanyId);
    const [termino, setTermino] = useState('');
    const [resultados, setResultados] = useState([]);
    const [buscando, setBuscando] = useState(false);
    const fotoDe = useFotosProductos(companyId, resultados);

    useEffect(() => {
        if (termino.trim().length < 2) { setResultados([]); return undefined; }
        let vivo = true;
        setBuscando(true);
        const t = setTimeout(async () => {
            const r = await buscar(termino.trim()).catch(() => []);
            if (vivo) { setResultados(r || []); setBuscando(false); }
        }, 300);
        return () => { vivo = false; clearTimeout(t); };
    }, [termino, buscar]);

    return (
        <div className="relative">
            <div className="flex items-center gap-2 glass-input w-full text-sm">
                {buscando ? <Loader2 size={16} className="animate-spin shrink-0" /> : <Search size={16} className="shrink-0 text-[var(--color-text-muted)]" />}
                <input value={termino} onChange={e => setTermino(e.target.value)} disabled={lleno}
                    placeholder={lleno ? 'Llegaste al máximo de este formato' : 'Buscar producto por nombre o código'}
                    className="flex-1 min-w-0 bg-transparent outline-none" />
                {termino && <button onClick={() => setTermino('')} aria-label="Limpiar"><X size={16} /></button>}
            </div>
            {resultados.length > 0 && (
                <div className="absolute z-20 left-0 right-0 mt-1 max-h-72 overflow-y-auto rounded-lg border border-[var(--glass-border)] bg-[var(--color-surface)] shadow-xl">
                    {resultados.map(p => {
                        const ya = yaElegidos.includes(Number(p.id));
                        const oferta = Number(p.is_offer) === 1 && Number(p.offer_price) > 0;
                        return (
                            <button key={p.id} disabled={ya} onClick={() => { onElegir(p); setTermino(''); setResultados([]); }}
                                className="w-full text-left px-3 py-2 border-b border-[var(--glass-border)] last:border-0 hover:bg-white/5 disabled:opacity-40 flex items-center gap-2.5">
                                <FotoProducto foto={fotoDe(p.id)} />
                                <span className="flex-1 min-w-0">
                                    <span className="block text-sm font-bold text-[var(--color-text)] truncate">{p.name}</span>
                                    <span className="block text-[11px] text-[var(--color-text-muted)] truncate">
                                        {p.category || 'Sin categoría'} · {p.unit || 'Und'}
                                        {fotoDe(p.id) === null && <b className="text-amber-400"> · sin foto</b>}
                                    </span>
                                </span>
                                <span className="shrink-0 text-sm font-bold text-[var(--color-text)]">
                                    {dinero(oferta ? p.offer_price : p.price)}
                                    {oferta && <span className="block text-[10px] text-[var(--color-text-muted)] line-through text-right">{dinero(p.price)}</span>}
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// Los productos de una categoría (o las ofertas), para elegirlos sin buscarlos
// uno por uno. Tocar uno lo agrega; tocarlo de nuevo lo saca.
// `cargar(offset)` → { productos, hayMas } o { error }. `inicio` va al comienzo de
// la fila del filtro (el selector de categoría, en la barra de productos).
function ListaProductos({ inicio, cargar, vacio, dinero, yaElegidos, libres, onElegir, onQuitar, onAgregarVarios }) {
    const [lista, setLista] = useState(null);
    const [error, setError] = useState(null);
    const [hayMas, setHayMas] = useState(false);
    const [cargandoMas, setCargandoMas] = useState(false);
    const [filtro, setFiltro] = useState('');

    useEffect(() => {
        let vivo = true;
        cargar(0).then(r => {
            if (!vivo) return;
            setLista(r.productos || []); setError(r.error || null); setHayMas(!!r.hayMas);
        });
        return () => { vivo = false; };
    }, [cargar]);

    const verMas = async () => {
        setCargandoMas(true);
        const r = await cargar(lista.length);
        setCargandoMas(false);
        if (r.error) { setError(r.error); return; }
        setLista(prev => [...prev, ...r.productos.filter(p => !prev.some(x => x.id === p.id))]);
        setHayMas(!!r.hayMas);
    };

    const filtradas = useMemo(() => {
        const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        const f = sinTildes(filtro.trim());
        return f ? (lista || []).filter(p => sinTildes(p.name).includes(f) || sinTildes(p.category).includes(f)) : (lista || []);
    }, [lista, filtro]);
    const sinElegir = filtradas.filter(p => !yaElegidos.includes(Number(p.id)));

    const conInicio = (resto) => (
        <div className="flex flex-col gap-2">
            {inicio}
            {resto}
        </div>
    );
    if (!lista) return conInicio(<div className="flex justify-center p-2"><Loader2 size={18} className="animate-spin text-[var(--color-text-muted)]" /></div>);
    if (error && !lista.length) return conInicio(<p className="text-xs text-red-300">{error}</p>);
    if (!lista.length) return conInicio(<p className="text-xs text-[var(--color-text-muted)]">{vacio}</p>);

    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-col sm:flex-row gap-2">
                {inicio}
                <div className="flex-1 min-w-0 flex items-center gap-2">
                    <div className="flex-1 min-w-0 flex items-center gap-2 glass-input text-sm">
                        <Search size={15} className="shrink-0 text-[var(--color-text-muted)]" />
                        <input value={filtro} onChange={e => setFiltro(e.target.value)} placeholder={`Filtrar ${lista.length}${hayMas ? '+' : ''} productos`}
                            className="flex-1 min-w-0 bg-transparent outline-none" />
                        {filtro && <button onClick={() => setFiltro('')} aria-label="Limpiar"><X size={15} /></button>}
                    </div>
                    <button onClick={() => onAgregarVarios(sinElegir)} disabled={!sinElegir.length || libres <= 0}
                        className="shrink-0 min-h-[44px] px-3 rounded-lg text-sm font-bold flex items-center gap-1 bg-[var(--color-primary)] text-[var(--color-on-primary)] disabled:opacity-40">
                        <Plus size={15} /> Agregar {Math.max(0, Math.min(libres, sinElegir.length))}
                    </button>
                </div>
            </div>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--glass-border)] p-1.5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-1.5 content-start">
                {filtradas.map(p => {
                    const ya = yaElegidos.includes(Number(p.id));
                    const oferta = Number(p.is_offer) === 1 && Number(p.offer_price) > 0;
                    const vigencia = oferta ? resumenOferta(reglaDe(p)) : null;
                    return (
                        <button key={p.id} onClick={() => (ya ? onQuitar(Number(p.id)) : onElegir(p))} disabled={!ya && libres <= 0}
                            className={`w-full text-left px-3 py-2 min-h-[44px] rounded-md border flex items-center gap-2.5 disabled:opacity-40 ${ya ? 'bg-[var(--color-primary)]/10 border-[var(--color-primary)]/50' : 'border-[var(--glass-border)] hover:bg-white/5'}`}>
                            {ya ? <CheckCircle2 size={18} className="shrink-0 text-[var(--color-primary)]" /> : <Plus size={18} className="shrink-0 text-[var(--color-text-muted)]" />}
                            <span className="flex-1 min-w-0">
                                <span className="block text-sm font-bold text-[var(--color-text)] truncate">{p.name}</span>
                                <span className="block text-[11px] text-[var(--color-text-muted)] truncate">
                                    {oferta && <b className="text-amber-400">Oferta · </b>}
                                    {p.category || 'Sin categoría'}{Number(p.has_image) === 1 ? ' · con foto' : ' · sin foto'}
                                </span>
                                {vigencia && <span className="block text-[11px] text-amber-400 truncate">{vigencia}</span>}
                            </span>
                            <span className="shrink-0 text-right">
                                <span className="block text-sm font-bold text-[var(--color-text)]">{dinero(oferta ? p.offer_price : p.price)}</span>
                                {oferta && <span className="block text-[10px] text-[var(--color-text-muted)] line-through">{dinero(p.price)}</span>}
                            </span>
                        </button>
                    );
                })}
                {!filtradas.length && (
                    <p className="col-span-full text-xs text-[var(--color-text-muted)] p-3">
                        Ningún producto coincide con "{filtro}"{hayMas ? ' entre los cargados: tocá "Ver más" o buscalo en "Todas".' : '.'}
                    </p>
                )}
                {hayMas && (
                    <button onClick={verMas} disabled={cargandoMas}
                        className="col-span-full w-full min-h-[44px] text-sm font-bold text-[var(--color-primary)] flex items-center justify-center gap-1.5 disabled:opacity-40">
                        {cargandoMas && <Loader2 size={15} className="animate-spin" />} Ver más productos
                    </button>
                )}
            </div>
            {error && <p className="text-xs text-red-300">{error}</p>}
        </div>
    );
}

function ItemProducto({ it, dinero, campana, varios, onCambiar, onPresentacion, onFoto, onVigencia, onQuitar }) {
    const archivo = useRef(null);
    const foto = it.fotoPropia || it.fotoGuardada || it.fotoInventario;
    const referencia = it.presentacion ? it.presentacion.precio : it.precioNormal;
    const vigencia = textoVigencia(it.reglaOferta);
    return (
        <div className="rounded-lg border border-[var(--glass-border)] p-3 flex flex-col gap-2">
            <div className="flex items-start gap-3">
                <div className="w-14 h-14 shrink-0 rounded bg-white flex items-center justify-center overflow-hidden">
                    {foto ? <img src={foto} alt="" className="max-w-full max-h-full object-contain" />
                        : it.cargandoFoto ? <Loader2 size={16} className="animate-spin text-gray-400" /> : <ImageIcon size={18} className="text-gray-400" />}
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-[var(--color-text)] leading-tight">{it.nombre}</p>
                    <p className="text-[11px] text-[var(--color-text-muted)]">
                        Precio normal {dinero(it.precioNormal)}{it.precioOferta ? ` · oferta ${dinero(it.precioOferta)}` : ''}
                    </p>
                    {vigencia && (
                        <p className="text-[11px] text-amber-400">
                            Oferta: {resumenOferta(it.reglaOferta)} ·{' '}
                            <button onClick={() => onVigencia(vigencia)} className="font-bold text-[var(--color-primary)]">Poner en el mensaje</button>
                        </p>
                    )}
                </div>
                <button onClick={onQuitar} className="p-2 -m-1 text-[var(--color-text-muted)] hover:text-red-400" aria-label="Quitar producto"><Trash2 size={16} /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
                <Campo etiqueta="Precio de la publicidad">
                    <input type="number" min={0} inputMode="numeric" value={it.precioPublicidad} className="glass-input w-full text-sm"
                        onChange={e => onCambiar({ precioPublicidad: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) })} />
                </Campo>
                <Campo etiqueta="Se vende por">
                    <select value={it.presentacion?.id ?? ''} onChange={e => onPresentacion(e.target.value)} className="glass-input w-full text-sm">
                        <option value="">{textoUnidad({ unidad: it.unidad })}</option>
                        {it.presentaciones.map(p => <option key={p.id} value={p.id}>{p.nombre} ({p.unidades} und)</option>)}
                    </select>
                </Campo>
                <Campo etiqueta="Nombre en la imagen">
                    <input value={it.nombreVisible} maxLength={80} placeholder={it.nombre} onChange={e => onCambiar({ nombreVisible: e.target.value })} className="glass-input w-full text-sm" />
                </Campo>
                <Campo etiqueta="Etiqueta">
                    <input value={it.etiqueta ?? (varios ? '' : campana.etiqueta)} maxLength={30} placeholder="Ej: OFERTA"
                        onChange={e => onCambiar({ etiqueta: e.target.value })} className="glass-input w-full text-sm" />
                </Campo>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--color-text)]">
                {referencia > Number(it.precioPublicidad) && (
                    <label className="flex items-center gap-1.5">
                        <input type="checkbox" checked={it.mostrarAntes} onChange={e => onCambiar({ mostrarAntes: e.target.checked })} />
                        Mostrar "Antes {dinero(referencia)}"
                    </label>
                )}
                {foto && (
                    <label className="flex items-center gap-1.5">
                        <input type="checkbox" checked={it.quitarFondo} onChange={e => onCambiar({ quitarFondo: e.target.checked })} />
                        Quitar fondo blanco
                    </label>
                )}
                <button onClick={() => archivo.current?.click()} className="flex items-center gap-1 font-bold text-[var(--color-primary)]">
                    <Upload size={13} /> {it.fotoPropia || it.fotoUrl ? 'Cambiar foto' : 'Subir otra foto'}
                </button>
                {(it.fotoPropia || it.fotoUrl) && (
                    <button onClick={() => onCambiar({ fotoPropia: null, fotoUrl: null, fotoGuardada: null })} className="font-bold text-[var(--color-text-muted)]">
                        Usar la del inventario
                    </button>
                )}
                <input ref={archivo} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFoto(f); }} />
            </div>
            {!foto && !it.cargandoFoto && (
                <p className="text-[11px] text-amber-400">Este producto no tiene foto en el inventario: subí una o la publicidad sale solo con el nombre y el precio.</p>
            )}
        </div>
    );
}

// ── Con chat ──────────────────────────────────────────────────────────────────
// Kevin, 27-oct-2026: "que solo aparezca el chat y el botón generar, nada de
// conversación". El cliente escribe y genera; lo siguiente que pida cambia la
// imagen actual o crea otra distinta (lo decide el servidor). Acá la IA hace la
// publicidad entera, textos y precios incluidos: por eso se avisa que se revise.

const MAX_PRODUCTOS_CHAT = 3;
const MAX_IMAGENES_CHAT = 2;
const LARGO_PEDIDO = 600;
const precioDe = (p) => (Number(p.is_offer) === 1 && Number(p.offer_price) > 0 ? Number(p.offer_price) : Number(p.price) || 0);

/** El formato con sus medidas: dos personalizados de distinta medida son distintos. */
function firmaFormato(formato, personalizado) {
    const { ancho, alto } = medidas(formato, personalizado || {});
    return `${formato}:${ancho}x${alto}`;
}
// Si la imagen no tiene la proporción del formato (a más de 3 %, como
// mismaProporcion en el servidor). La IA llega hasta 1:3 y 3:1: un formato más
// extremo se compara con eso, para no ofrecer algo que no puede hacer.
function noLlenaElFormato(img, ancho, alto) {
    const w = img?.naturalWidth || img?.width, h = img?.naturalHeight || img?.height;
    if (!w || !h) return false;
    const posible = Math.min(3, Math.max(1 / 3, ancho / alto));
    return Math.abs((w / h) / posible - 1) > 0.03;
}

function ChatPublicidad({ companyId, chat, setChat, dinero, moneda, cupo, iaApagada, motivoSinIA, buscar, avisar, limpiarAviso, refrescarEstado, estado }) {
    const [texto, setTexto] = useState('');
    const [productos, setProductos] = useState([]); // los que van con el próximo pedido
    const [imagenes, setImagenes] = useState([]);   // lo que subió (data URL), con el próximo pedido
    const [generando, setGenerando] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [imprimiendo, setImprimiendo] = useState(false);
    const [menu, setMenu] = useState(null);         // 'formato' | 'producto'
    const [conEncuadre, setConEncuadre] = useState(false);
    const [img, setImg] = useState(null);           // la imagen actual, cargada
    const lienzo = useRef(null);
    const barra = useRef(null);
    const archivo = useRef(null);
    const clave = useRef(null); // { clave, firma }: un reintento del mismo pedido tras un corte no cobra dos veces

    const formato = formatoPorId(chat.formato);
    const { ancho, alto } = medidas(chat.formato, chat.personalizado);
    const actual = chat.mensajes.find(m => m.fondoId === chat.actual) || null;
    const cambiarChat = (c) => setChat(prev => ({ ...prev, ...c }));
    const ponerDataUrl = (fondoId, dataUrl) => setChat(prev => ({ ...prev, mensajes: prev.mensajes.map(m => (m.fondoId === fondoId ? { ...m, dataUrl } : m)) }));
    const fotoDe = useFotosProductos(companyId, productos);
    const gastoIA = `Cada pedido usa 1 imagen del mes${cupo ? ` (quedan ${cupo.restantes})` : ''}.`;

    // La imagen actual. Si vino del Historial se baja (el servidor revisa que sea de la empresa).
    useEffect(() => {
        if (!actual) { setImg(null); return undefined; }
        let vivo = true;
        if (actual.dataUrl) {
            cargarImagen(actual.dataUrl).then(i => { if (vivo) setImg(i); }).catch(() => { if (vivo) setImg(null); });
        } else if (actual.url) {
            publicidad(companyId, 'imagen', { url: actual.url }).then(r => {
                if (!vivo) return;
                if (r.success) ponerDataUrl(actual.fondoId, r.dataUrl);
                else avisar('error', 'No se pudo cargar esa imagen.');
            });
        }
        return () => { vivo = false; };
    }, [actual?.fondoId, actual?.dataUrl, actual?.url, companyId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Las miniaturas de las otras versiones, de a una (al abrir una del Historial).
    useEffect(() => {
        const faltan = chat.mensajes.filter(m => !m.dataUrl && m.url && m.fondoId !== chat.actual).slice(-8);
        if (!faltan.length) return undefined;
        let vivo = true;
        (async () => {
            for (const m of faltan) {
                const r = await publicidad(companyId, 'imagen', { url: m.url });
                if (!vivo) return;
                if (r.success) ponerDataUrl(m.fondoId, r.dataUrl);
            }
        })();
        return () => { vivo = false; };
    }, [chat.id, companyId]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (lienzo.current) dibujarImagen(lienzo.current, img, ancho, alto, chat.encuadre);
    }, [img, ancho, alto, chat.encuadre]);

    useEffect(() => {
        if (!menu) return undefined;
        const fuera = (e) => { if (!barra.current?.contains(e.target)) setMenu(null); };
        const tecla = (e) => { if (e.key === 'Escape') setMenu(null); };
        document.addEventListener('pointerdown', fuera);
        window.addEventListener('keydown', tecla);
        return () => { document.removeEventListener('pointerdown', fuera); window.removeEventListener('keydown', tecla); };
    }, [menu]);

    // Los pedidos que armaron la imagen actual, del primero al último (para que el
    // servidor sepa qué se pidió antes de este cambio).
    const cadena = () => {
        const porId = new Map(chat.mensajes.map(m => [m.fondoId, m]));
        const textos = [];
        for (let m = actual, vueltas = 0; m && vueltas < 20; m = m.desde ? porId.get(m.desde) : null, vueltas++) textos.unshift(m.texto);
        return textos.slice(-4);
    };

    // `adaptar`: pasar la actual al formato elegido, sin escribir nada (y sin lo adjuntado).
    const generar = async ({ adaptar = false } = {}) => {
        const pedido = adaptar ? `Pasarla a ${formato.nombre} (${ancho}×${alto})` : texto.trim();
        if (!pedido || generando || iaApagada || (adaptar && !actual)) return;
        const datos = {
            formato: chat.formato, ancho, alto, moneda, pedido,
            productIds: adaptar ? [] : productos.map(p => Number(p.id)), imagenes: adaptar ? [] : imagenes,
            baseId: actual?.fondoId ?? null, anteriores: actual ? cadena() : [], designId: chat.id,
            ...(adaptar ? { adaptar: true } : {}),
        };
        const firma = JSON.stringify({ ...datos, imagenes: imagenes.map(i => i.length) });
        if (!clave.current || clave.current.firma !== firma) clave.current = { clave: nuevaClave(), firma };
        setGenerando(true); setMenu(null); limpiarAviso();
        const r = await publicidad(companyId, 'generarChat', { ...datos, clave: clave.current.clave }, 70000);
        setGenerando(false);
        if (!r.success) {
            if (r.error !== 'TIEMPO' && r.error !== 'RED') clave.current = null;
            avisar('error', r.error === 'TIEMPO'
                ? 'La IA tardó demasiado. Probá de nuevo: si alcanzó a hacerla, no se cobra dos veces.'
                : (r.message || r.error));
            refrescarEstado();
            return;
        }
        clave.current = null;
        const accion = r.accion || (actual ? 'editar' : 'nueva');
        const nuevo = {
            texto: pedido, accion, fondoId: r.fondo.id, url: r.fondo.url, size: r.fondo.size || null,
            desde: accion === 'editar' ? (actual?.fondoId ?? null) : null,
            productos: adaptar ? [] : productos.map(p => ({ id: Number(p.id), nombre: p.name, precio: precioDe(p) })),
            ...(adaptar ? { adaptada: true } : {}),
            dataUrl: r.dataUrl || null,
        };
        setChat(prev => ({ ...prev, mensajes: [...prev.mensajes.filter(m => m.fondoId !== nuevo.fondoId), nuevo], actual: nuevo.fondoId, encuadre: CHAT_VACIO.encuadre }));
        if (!adaptar) { setTexto(''); setProductos([]); setImagenes([]); }
        refrescarEstado();
    };
    // La actual no tiene la medida del formato elegido (se ve entera con relleno):
    // se ofrece rearmarla a esa medida con un toque.
    const otraMedida = !!(img && actual && noLlenaElFormato(img, ancho, alto));

    const agregarProducto = (p) => {
        setProductos(prev => (prev.some(x => Number(x.id) === Number(p.id)) || prev.length >= MAX_PRODUCTOS_CHAT ? prev : [...prev, p]));
        setMenu(null);
    };
    const subirImagen = async (f) => {
        try {
            const d = await achicarFoto(f, 1000);
            setImagenes(prev => (prev.length >= MAX_IMAGENES_CHAT ? prev : [...prev, d]));
        } catch (e) {
            avisar('error', e.message);
        }
    };

    // Lo que se guarda, se baja o se imprime: la imagen recortada a la medida con su encuadre.
    const imagenFinal = () => {
        const c = document.createElement('canvas');
        dibujarImagen(c, img, ancho, alto, chat.encuadre);
        return c;
    };
    const nombreArchivo = () => {
        const base = (chat.title || chat.mensajes[0]?.texto || 'publicidad')
            .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).toLowerCase();
        return `publicidad-${base || 'chat'}-${hoy()}`;
    };

    // Como en la Rápida: con cambios desde que se guardó (otra imagen, otro formato
    // u otro encuadre) se guarda como otra publicidad, así quedan las dos en el
    // Historial (por ejemplo la del post y la del cartel).
    const firma = firmaChat(chat);
    const conCambios = !!chat.id && chat.guardado !== firma;

    const guardar = async () => {
        if (!img || guardando) return;
        setGuardando(true); limpiarAviso();
        const otra = conCambios;
        const c = imagenFinal();
        const m = document.createElement('canvas');
        const f = 260 / Math.max(c.width, c.height);
        m.width = Math.round(c.width * f); m.height = Math.round(c.height * f);
        m.getContext('2d').drawImage(c, 0, 0, m.width, m.height);
        const usados = new Map();
        for (const x of chat.mensajes) for (const p of x.productos || []) usados.set(p.id, p);
        const r = await publicidad(companyId, 'guardar', {
            id: otra ? null : chat.id, title: chat.title || chat.mensajes[0]?.texto?.slice(0, 80) || '', status: 'final', formato: chat.formato,
            productos: [...usados.values()].map(p => ({ productId: p.id, precioPublicidad: p.precio })),
            textos: {}, backgroundId: chat.actual,
            layout: {
                modo: 'chat', personalizado: chat.personalizado, encuadre: chat.encuadre,
                mensajes: chat.mensajes.slice(-15).map(({ dataUrl: _d, ...resto }) => resto),
            },
            finalJpeg: c.toDataURL('image/jpeg', 0.9), miniatura: m.toDataURL('image/jpeg', 0.7),
        }, 45000);
        setGuardando(false);
        if (!r.success) { avisar('error', r.message || r.error); return; }
        // Con el nombre que le quedó (puede estar numerado): guardarla de nuevo no lo pisa.
        cambiarChat({ id: r.id, status: 'final', guardado: firma, ...(r.title ? { title: r.title } : {}) });
        const nombre = r.title ? ` «${r.title}»` : '';
        avisar('ok', otra
            ? `Guardada como otra publicidad${nombre}. La anterior sigue igual en el Historial.`
            : `Publicidad${nombre} guardada en el Historial.`);
    };

    const descargar = async () => {
        if (!img) return;
        const r = await descargarImagen(imagenFinal().toDataURL('image/jpeg', 0.92), `${nombreArchivo()}.jpg`);
        if (r.mensaje) avisar(r.ok ? 'ok' : 'error', r.mensaje);
    };

    const imprimir = async () => {
        if (!img || imprimiendo) return;
        setImprimiendo(true); limpiarAviso();
        await new Promise(r => setTimeout(r, 30));
        const r = await imprimirImagen(imagenFinal().toDataURL('image/jpeg', 0.92), nombreArchivo());
        setImprimiendo(false);
        if (!r.ok) avisar('error', r.mensaje);
    };

    const nueva = () => {
        setChat({ ...CHAT_VACIO, formato: chat.formato, personalizado: chat.personalizado });
        setTexto(''); setProductos([]); setImagenes([]); setConEncuadre(false); clave.current = null; limpiarAviso();
    };

    const adjunto = 'max-w-full p-1.5 pr-1 rounded-lg flex items-center gap-2 border border-[var(--glass-border)] bg-[var(--glass-bg)]';
    const quitarAdjunto = 'shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-white/10 hover:text-[var(--color-text)]';
    const botonBarra = 'min-h-[36px] px-2.5 rounded-lg text-xs font-bold flex items-center gap-1.5 border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[var(--color-text)] hover:border-[var(--color-primary)]/60 disabled:opacity-40';

    return (
        <div className="flex flex-col lg:flex-row gap-4 min-h-0">
            {/* La imagen: en el celular aparece cuando ya hay una (o se está haciendo), así la caja queda arriba */}
            <div className={`lg:order-2 lg:flex-1 min-w-0 ${img || generando ? '' : 'hidden lg:block'}`}>
                <div className="glass-card p-3 relative z-20 lg:sticky lg:top-0">
                    <div className="flex items-center justify-between mb-2 gap-2">
                        <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{formato.nombre} · {ancho}×{alto}</p>
                        {chat.id && <span className="text-[11px] font-bold text-[var(--color-text-muted)]">#{chat.id} · Guardada</span>}
                    </div>
                    <div className="relative bg-black/20 rounded-lg flex items-center justify-center overflow-hidden">
                        <canvas ref={lienzo} className={`block max-w-full h-auto max-h-[55vh] lg:max-h-[70vh] ${img ? '' : 'opacity-40'}`} />
                        {!img && !generando && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white text-center px-6">
                                <MessageSquare size={28} />
                                <p className="text-sm font-bold">Escribí la publicidad que querés y apretá Generar</p>
                            </div>
                        )}
                        {generando && (
                            <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2 text-white text-center px-6">
                                <Loader2 className="animate-spin" size={32} />
                                <p className="text-sm font-bold">Creando la publicidad con IA… (20 a 40 s)</p>
                            </div>
                        )}
                    </div>
                    {img && (
                        <p className="mt-2 text-[11px] text-amber-400 flex items-start gap-1.5">
                            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                            Revisá los textos y el precio antes de publicar: la IA puede equivocarse en una letra o un número.
                        </p>
                    )}
                    {otraMedida && !generando && (
                        <div className="mt-2 rounded-lg border border-[var(--color-primary)]/40 bg-[var(--color-primary)]/10 p-2.5 flex flex-col sm:flex-row sm:items-center gap-2">
                            <p className="flex-1 text-xs text-[var(--color-text)]">
                                Esta imagen no tiene la medida de <b>{formato.nombre} ({ancho}×{alto})</b>. La IA la puede rearmar a esa medida,
                                completa y sin relleno, sin que escribas nada (1 imagen del mes).
                            </p>
                            <button type="button" onClick={() => generar({ adaptar: true })} disabled={iaApagada}
                                className="shrink-0 min-h-[44px] px-4 rounded-lg text-sm font-bold flex items-center justify-center gap-2 bg-[var(--color-primary)] text-[var(--color-on-primary)] disabled:opacity-40">
                                <Wand2 size={16} /> Pasarla a {formato.id === 'personalizado' ? `${ancho}×${alto}` : formato.corto}
                            </button>
                        </div>
                    )}
                    {img && conEncuadre && (
                        <div className="mt-2 rounded-lg border border-[var(--glass-border)] p-3 flex flex-col gap-2">
                            <Deslizador etiqueta="Arriba o abajo" extremos={['Bajar', 'Subir']} min={-1} max={1} paso={0.02} valor={chat.encuadre.y}
                                onChange={v => cambiarChat({ encuadre: { ...chat.encuadre, y: v } })} />
                            <Deslizador etiqueta="A los lados" extremos={['Izquierda', 'Derecha']} min={-1} max={1} paso={0.02} valor={chat.encuadre.x}
                                onChange={v => cambiarChat({ encuadre: { ...chat.encuadre, x: v } })} />
                            <Deslizador etiqueta="Tamaño" extremos={['Alejar', 'Acercar']} min={0.6} max={1.4} paso={0.02} valor={chat.encuadre.zoom ?? (img ? zoomEntera(img, ancho, alto) : 1)}
                                onChange={v => cambiarChat({ encuadre: { ...chat.encuadre, zoom: v } })} />
                            <div className="flex flex-wrap gap-x-4">
                                <button onClick={() => cambiarChat({ encuadre: CHAT_VACIO.encuadre })} className="min-h-[32px] text-xs font-bold text-[var(--color-primary)]">
                                    Entera y al centro
                                </button>
                                <button onClick={() => cambiarChat({ encuadre: { x: 0, y: 0, zoom: 1 } })} className="min-h-[32px] text-xs font-bold text-[var(--color-primary)]">
                                    Llenar todo (recorta los bordes)
                                </button>
                            </div>
                        </div>
                    )}
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 2xl:grid-cols-4 gap-2 mt-3">
                        <Boton onClick={imprimir} disabled={!img || imprimiendo} icono={imprimiendo ? Loader2 : Printer} girando={imprimiendo} principal={formato.hoja} className="col-span-full">
                            {imprimiendo ? 'Preparando la hoja…' : formato.hoja ? 'Imprimir cartel A4' : 'Imprimir'}
                        </Boton>
                        <Boton onClick={() => setConEncuadre(v => !v)} disabled={!img} icono={Move}>Encuadre</Boton>
                        <Boton onClick={guardar} disabled={!img || guardando || !estado?.app} icono={guardando ? Loader2 : Save} girando={guardando}>Guardar</Boton>
                        <Boton onClick={descargar} disabled={!img} icono={Download} principal={!formato.hoja}>Descargar</Boton>
                        <Boton onClick={nueva} icono={Plus}>Nueva</Boton>
                    </div>
                    {conCambios && img && (
                        <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">
                            Con estos cambios se guarda como otra publicidad: la anterior queda igual en el Historial.
                        </p>
                    )}
                </div>
            </div>

            {/* El chat: la caja y Generar, y abajo lo que se fue pidiendo */}
            <div className="lg:order-1 lg:w-[440px] shrink-0 flex flex-col gap-4">
                <div className="glass-card p-3 relative z-30 flex flex-col gap-2">
                    {(productos.length > 0 || imagenes.length > 0) && (
                        <div className="flex flex-wrap gap-1.5">
                            {productos.map(p => (
                                <span key={p.id} className={adjunto}>
                                    <FotoProducto foto={fotoDe(p.id)} lado={44} />
                                    <span className="min-w-0">
                                        <span className="block text-xs font-bold text-[var(--color-text)] truncate">{p.name}</span>
                                        <span className="block text-[11px] text-[var(--color-text-muted)]">
                                            {dinero(precioDe(p))}
                                            {fotoDe(p.id) === null && <b className="text-amber-400"> · sin foto</b>}
                                        </span>
                                    </span>
                                    <button type="button" onClick={() => setProductos(prev => prev.filter(x => x.id !== p.id))} aria-label={`Quitar ${p.name}`} className={quitarAdjunto}><X size={14} /></button>
                                </span>
                            ))}
                            {imagenes.map((d, i) => (
                                <span key={i} className={adjunto}>
                                    <img src={d} alt="" className="w-11 h-11 rounded object-cover bg-white" />
                                    <span className="text-xs font-bold text-[var(--color-text)]">Imagen {i + 1}</span>
                                    <button type="button" onClick={() => setImagenes(prev => prev.filter((_x, j) => j !== i))} aria-label={`Quitar la imagen ${i + 1}`} className={quitarAdjunto}><X size={14} /></button>
                                </span>
                            ))}
                        </div>
                    )}
                    {productos.some(p => fotoDe(p.id) === null) && (
                        <p className="text-[11px] text-amber-400 flex items-start gap-1.5">
                            <ImageOff size={13} className="shrink-0 mt-0.5" />
                            <span>
                                {productos.filter(p => fotoDe(p.id) === null).map(p => `«${p.name}»`).join(', ')} no tiene foto en el inventario: la IA
                                lo dibuja por el nombre y puede no parecerse. Si querés el tuyo, subí su foto con «Imagen».
                            </span>
                        </p>
                    )}
                    <textarea value={texto} maxLength={LARGO_PEDIDO} rows={4} onChange={e => setTexto(e.target.value)} aria-label="Lo que querés en la publicidad"
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generar(); } }}
                        placeholder={actual
                            ? 'Pedí un cambio («el precio más grande», «fondo rojo») o una publicidad distinta'
                            : 'Describí la publicidad: qué producto, precio, textos, estilo y colores…'}
                        className="glass-input w-full text-sm resize-none" />
                    <div ref={barra} className="relative flex flex-wrap items-center gap-1.5">
                        <BotonMenu abierto={menu === 'formato'} onClick={() => setMenu(v => (v === 'formato' ? null : 'formato'))} etiqueta={`Formato · ${ancho}×${alto}`}
                            icono={<FormaFormato ancho={ancho} alto={alto} />}>
                            <span className="sm:hidden">{formato.corto}</span><span className="hidden sm:inline">{formato.nombre}</span>
                        </BotonMenu>
                        <BotonMenu abierto={menu === 'producto'} onClick={() => setMenu(v => (v === 'producto' ? null : 'producto'))} etiqueta="Agregar un producto del inventario"
                            icono={<ShoppingBag size={15} className="shrink-0" />}>
                            Producto
                        </BotonMenu>
                        <button type="button" onClick={() => archivo.current?.click()} disabled={imagenes.length >= MAX_IMAGENES_CHAT} title="Subir una imagen: tu logo o una foto" className={botonBarra}>
                            <Paperclip size={15} className="shrink-0" /> Imagen
                        </button>
                        <input ref={archivo} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) subirImagen(f); }} />

                        {menu === 'formato' && (
                            <div className="absolute z-30 top-full mt-1.5 left-0 right-0 max-h-[60vh] overflow-y-auto rounded-xl border border-[var(--glass-border)] bg-[var(--color-surface)] shadow-2xl p-3">
                                <ListaFormatos formato={chat.formato} personalizado={chat.personalizado}
                                    onElegir={(id) => { cambiarChat({ formato: id, encuadre: CHAT_VACIO.encuadre }); if (id !== 'personalizado') setMenu(null); }}
                                    onPersonalizado={(p) => cambiarChat({ personalizado: p })} />
                            </div>
                        )}
                        {menu === 'producto' && (
                            <div className="absolute z-30 top-full mt-1.5 left-0 right-0 rounded-xl border border-[var(--glass-border)] bg-[var(--color-surface)] shadow-2xl p-3">
                                <TituloMenu>Producto del inventario</TituloMenu>
                                <BuscadorProductos buscar={buscar} onElegir={agregarProducto} dinero={dinero}
                                    yaElegidos={productos.map(p => Number(p.id))} lleno={productos.length >= MAX_PRODUCTOS_CHAT} />
                                <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">
                                    La IA usa su foto real y su precio. Hasta {MAX_PRODUCTOS_CHAT} por pedido.
                                </p>
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <Ayuda titulo="Cómo funciona">
                            Escribí la publicidad que querés: producto, precio, textos, estilo y colores. Con «Producto» la IA usa la foto real
                            y el precio del inventario; con «Imagen» podés sumar tu logo o una foto. Después, lo que pidas se le cambia a esa
                            misma imagen; si pedís algo distinto, se crea otra. Para tenerla en otro formato, elegilo en «Formato»: no hace
                            falta escribirlo. {gastoIA}
                        </Ayuda>
                        <span className="flex-1 text-[11px] text-[var(--color-text-muted)] tabular-nums">{texto.length > LARGO_PEDIDO - 100 ? `${texto.length}/${LARGO_PEDIDO}` : ''}</span>
                        <button type="button" onClick={() => generar()} disabled={!texto.trim() || generando || iaApagada}
                            className="shrink-0 min-h-[44px] px-5 rounded-lg text-sm font-bold flex items-center gap-2 bg-[var(--color-primary)] text-[var(--color-on-primary)] disabled:opacity-40">
                            {generando ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Generar
                        </button>
                    </div>
                    {motivoSinIA && <p className="text-xs font-bold text-amber-400">{motivoSinIA}</p>}
                    {!chat.mensajes.length && (
                        <div className="flex flex-col gap-1.5 mt-1">
                            <TituloMenu>Ideas para empezar</TituloMenu>
                            {IDEAS_CHAT.map(t => (
                                <button key={t} type="button" onClick={() => setTexto(t)}
                                    className="min-h-[40px] px-3 py-2 rounded-lg border border-[var(--glass-border)] text-left text-xs text-[var(--color-text)] hover:border-[var(--color-primary)]/60 hover:bg-white/5">
                                    {t}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {chat.mensajes.length > 0 && (
                    <Seccion titulo={`Lo que pediste (${chat.mensajes.length})`}>
                        <div className="flex flex-col gap-2">
                            {[...chat.mensajes].reverse().map(m => {
                                const esta = m.fondoId === chat.actual;
                                return (
                                    <button key={m.fondoId} type="button" onClick={() => cambiarChat({ actual: m.fondoId, encuadre: CHAT_VACIO.encuadre })}
                                        className={`flex items-start gap-3 p-2 rounded-lg border text-left ${esta ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10' : 'border-[var(--glass-border)] hover:bg-white/5'}`}>
                                        <span className="w-12 h-14 shrink-0 rounded bg-black/30 overflow-hidden flex items-center justify-center">
                                            {m.dataUrl ? <img src={m.dataUrl} alt="" className="w-full h-full object-cover" /> : <ImageIcon size={16} className="text-[var(--color-text-muted)]" />}
                                        </span>
                                        <span className="flex-1 min-w-0">
                                            <span className="block text-xs text-[var(--color-text)] line-clamp-3">{m.texto}</span>
                                            <span className="block mt-1 text-[10px] font-bold text-[var(--color-text-muted)]">
                                                {m.adaptada ? 'Pasada a otro formato' : m.accion === 'editar' ? 'Cambio sobre la anterior' : 'Nueva'}{esta ? ' · la que se ve' : ''}
                                            </span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                        <p className="text-[11px] text-[var(--color-text-muted)]">Tocá una para volver a ella: el próximo pedido la cambia a esa.</p>
                    </Seccion>
                )}
            </div>
        </div>
    );
}

// ── Recortar ──────────────────────────────────────────────────────────────────
// Kevin, 30-oct-2026: la foto de un producto recortada por la IA sobre fondo
// blanco, para guardarla en el Historial o ponérsela a un producto (que también
// la manda a la tienda online, solo la foto). El blanco que deja la IA se
// empareja acá: lo casi blanco pegado al borde pasa a blanco puro.
const LARGO_NOTA_RECORTE = 150;
const TIENDA_TRAS_ASIGNAR = {
    ok: 'También se cambió en la tienda online.',
    enviando: 'La tienda online está tardando en contestar: la foto le llega en un rato.',
    error: 'La tienda online no la recibió: probá ponerla de nuevo más tarde.',
    sin_codigo: 'No se mandó a la tienda online porque el producto no tiene código.',
};

/**
 * El producto sin su fondo, con transparencia (Kevin, 31-oct-2026: "tenerlo en
 * PNG y cambiarle el color de fondo, o guardarlo sin fondo"). El fondo que deja
 * la IA es liso pero no siempre blanco puro: se toma el color de los bordes y se
 * borra lo que se le parece y toca el borde. Lo claro del producto que no se
 * parece tanto al fondo (una tapa gris) se queda. El contorno queda a medias y
 * sin el blanco mezclado, para que no se vea un halo claro sobre un fondo oscuro.
 */
function sinFondo(img, tolerancia = 18) {
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const datos = ctx.getImageData(0, 0, w, h);
    const p = datos.data;
    // El color del fondo: la mediana de los bordes, canal por canal (un producto
    // que toca un borde, como un busto cortado abajo, no la mueve).
    const borde = [[], [], []];
    const anotar = (k) => { borde[0].push(p[k * 4]); borde[1].push(p[k * 4 + 1]); borde[2].push(p[k * 4 + 2]); };
    for (let x = 0; x < w; x += 2) { anotar(x); anotar((h - 1) * w + x); }
    for (let y = 0; y < h; y += 2) { anotar(y * w); anotar(y * w + w - 1); }
    const fondo = borde.map(v => v.sort((a, b) => a - b)[v.length >> 1]);
    const dist = (k) => Math.max(Math.abs(p[k * 4] - fondo[0]), Math.abs(p[k * 4 + 1] - fondo[1]), Math.abs(p[k * 4 + 2] - fondo[2]));
    const visto = new Uint8Array(w * h);
    const cola = new Int32Array(w * h);
    let ini = 0, fin = 0;
    const meter = (k) => {
        if (visto[k]) return;
        visto[k] = 1;
        if (dist(k) <= tolerancia) cola[fin++] = k;
    };
    for (let x = 0; x < w; x++) { meter(x); meter((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { meter(y * w); meter(y * w + w - 1); }
    while (ini < fin) {
        const k = cola[ini++];
        p[k * 4 + 3] = 0;
        const x = k % w;
        if (x > 0) meter(k - 1);
        if (x < w - 1) meter(k + 1);
        if (k >= w) meter(k - w);
        if (k < w * (h - 1)) meter(k + w);
    }
    const borrado = (k) => p[k * 4 + 3] === 0;
    for (let k = 0; k < w * h; k++) {
        if (borrado(k)) continue;
        const x = k % w;
        const junto = (x > 0 && borrado(k - 1)) || (x < w - 1 && borrado(k + 1)) || (k >= w && borrado(k - w)) || (k < w * (h - 1) && borrado(k + w));
        if (!junto) continue;
        const d = dist(k);
        if (d >= tolerancia * 4) continue;
        const a = Math.min(1, Math.max(0.1, (d - tolerancia) / (tolerancia * 3)));
        for (let j = 0; j < 3; j++) p[k * 4 + j] = Math.max(0, Math.min(255, Math.round((p[k * 4 + j] - (1 - a) * fondo[j]) / a)));
        p[k * 4 + 3] = Math.round(255 * a);
    }
    ctx.putImageData(datos, 0, 0);
    return c;
}

/** Como la foto que se sube en la ficha del producto: hasta 800 px, y liviana para la caja sin internet. */
async function fotoParaInventario(dataUrl) {
    const blob = await (await fetch(dataUrl)).blob();
    return compressImage(blob, 150, 800, 800);
}

/** El rectángulo que ocupa el producto en el recorte: lo que no es transparente. */
function cajaDelProducto(lienzo) {
    const w = lienzo.width, h = lienzo.height;
    const p = lienzo.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (p[(y * w + x) * 4 + 3] > 20) {
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
            }
        }
    }
    return x1 < 0 ? { x: 0, y: 0, w, h } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// Kevin, 31-oct-2026: "pasarlo a otras medidas", "agrandar y achicar" y
// "cambiarle el color de fondo o guardarlo sin fondo". Nada de eso necesita la
// IA: el producto ya está recortado, y acá se pone sobre el fondo elegido (null =
// transparente), a `tamano` del lado que manda (0,88 de entrada) y centrado.
// Si el producto llega a un borde de la foto (un busto cortado abajo), queda
// pegado a ese borde de la medida, para que no flote con el corte a la vista.
const AIRE_RECORTE = 0.88;
function recorteAMedida({ lienzo, caja }, ancho, alto, { tamano = AIRE_RECORTE, fondo = '#ffffff' } = {}, destino = null) {
    const c = destino || document.createElement('canvas');
    c.width = ancho; c.height = alto;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, ancho, alto);
    if (fondo) {
        ctx.fillStyle = fondo;
        ctx.fillRect(0, 0, ancho, alto);
    }
    const f = Math.min((ancho * tamano) / caja.w, (alto * tamano) / caja.h);
    const w = caja.w * f, h = caja.h * f;
    const pegado = (desde, hasta, lado) => (desde <= 1 && hasta < lado - 1 ? 'inicio' : hasta >= lado - 1 && desde > 1 ? 'fin' : 'centro');
    const enX = pegado(caja.x, caja.x + caja.w, lienzo.width);
    const enY = pegado(caja.y, caja.y + caja.h, lienzo.height);
    const x = enX === 'inicio' ? 0 : enX === 'fin' ? ancho - w : (ancho - w) / 2;
    const y = enY === 'inicio' ? 0 : enY === 'fin' ? alto - h : (alto - h) / 2;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(lienzo, caja.x, caja.y, caja.w, caja.h, x, y, w, h);
    return c;
}

// Los fondos de un toque; "Otro color" abre el selector y "Sin fondo" deja la transparencia.
const FONDOS_RECORTE = [
    ['#ffffff', 'Blanco'], ['#111111', 'Negro'], ['#f3f4f6', 'Gris claro'], ['#facc15', 'Amarillo'], ['#dc2626', 'Rojo'],
    ['#2563eb', 'Azul'], ['#16a34a', 'Verde'], ['#f9a8d4', 'Rosado'], ['#7dd3fc', 'Celeste'],
];
// El "tablero" gris y blanco con que se muestra lo transparente.
const TABLERO = { backgroundColor: '#ffffff', backgroundImage: 'conic-gradient(#d4d4d8 25%, transparent 0 50%, #d4d4d8 0 75%, transparent 0)', backgroundSize: '20px 20px' };

/** El botón de la medida del recorte, con la lista de formatos (los de la publicidad). */
function MedidaRecorte({ recorte, onCambiar }) {
    const [abierto, setAbierto] = useState(false);
    const caja = useRef(null);
    const formato = formatoPorId(recorte.formato);
    const { ancho, alto } = medidas(recorte.formato, recorte.personalizado);
    useEffect(() => {
        if (!abierto) return undefined;
        const fuera = (e) => { if (!caja.current?.contains(e.target)) setAbierto(false); };
        const tecla = (e) => { if (e.key === 'Escape') setAbierto(false); };
        document.addEventListener('pointerdown', fuera);
        window.addEventListener('keydown', tecla);
        return () => { document.removeEventListener('pointerdown', fuera); window.removeEventListener('keydown', tecla); };
    }, [abierto]);
    return (
        <div ref={caja} className="relative">
            <BotonMenu abierto={abierto} onClick={() => setAbierto(v => !v)} etiqueta={`Medida · ${ancho}×${alto}`} icono={<FormaFormato ancho={ancho} alto={alto} />}>
                {formato.id === 'personalizado' ? `${ancho}×${alto}` : `${formato.corto} · ${ancho}×${alto}`}
            </BotonMenu>
            {abierto && (
                <div className="absolute z-40 top-full mt-1.5 left-0 w-[min(88vw,26rem)] max-h-[60vh] overflow-y-auto rounded-xl border border-[var(--glass-border)] bg-[var(--color-surface)] shadow-2xl p-3">
                    <ListaFormatos formato={recorte.formato} personalizado={recorte.personalizado}
                        onElegir={(id) => { onCambiar({ formato: id }); if (id !== 'personalizado') setAbierto(false); }}
                        onPersonalizado={(p) => onCambiar({ personalizado: p })} />
                    <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">
                        Cambiar la medida no usa la IA ni gasta imágenes: el producto se centra sobre blanco.
                    </p>
                </div>
            )}
        </div>
    );
}

function RecortePublicidad({ companyId, recorte, setRecorte, dinero, cupo, iaApagada, motivoSinIA, buscar, avisar, limpiarAviso, refrescarEstado, estado }) {
    const [generando, setGenerando] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [asignando, setAsignando] = useState(null); // id del producto al que se le está poniendo
    const [eligiendo, setEligiendo] = useState(false); // el buscador de "Ponerla en otro producto"
    const camara = useRef(null);
    const archivo = useRef(null);
    const clave = useRef(null); // { clave, firma }: un reintento tras un corte no cobra dos veces
    const cambiar = (c) => setRecorte(prev => ({ ...prev, ...c }));
    const producto = recorte.producto;
    const fotoDe = useFotosProductos(companyId, producto ? [{ id: producto.id }] : []);
    const fotoActual = producto ? fotoDe(producto.id) : undefined; // undefined: cargando · null: sin foto
    const yaPuesta = (id) => recorte.asignada.some(a => a.id === Number(id));
    const gastoIA = `Usa 1 imagen del mes${cupo ? ` (quedan ${cupo.restantes})` : ''}.`;

    // Lo que hizo la IA. Si vino del Historial, primero se baja (queda en el
    // estado: al volver a la pestaña no se pide de nuevo).
    useEffect(() => {
        if (!recorte.fondoId || recorte.dataUrl || !recorte.url) return undefined;
        const fondoId = recorte.fondoId;
        let vivo = true;
        publicidad(companyId, 'imagen', { url: recorte.url }).then(r => {
            if (!vivo) return;
            if (!r.success) { avisar('error', 'No se pudo cargar la foto recortada.'); return; }
            setRecorte(prev => (prev.fondoId === fondoId ? { ...prev, dataUrl: r.dataUrl } : prev));
        });
        return () => { vivo = false; };
    }, [recorte.fondoId, recorte.dataUrl, recorte.url, companyId]); // eslint-disable-line react-hooks/exhaustive-deps

    // El producto sin fondo (transparente) y dónde está: de ahí sale todo lo demás, sin IA.
    const [base, setBase] = useState(null); // { lienzo, caja }
    useEffect(() => {
        setBase(null);
        if (!recorte.dataUrl) return undefined;
        let vivo = true;
        cargarImagen(recorte.dataUrl).then(img => {
            if (!vivo || !img) return;
            const lienzo = sinFondo(img);
            setBase({ lienzo, caja: cajaDelProducto(lienzo) });
        }).catch(() => {});
        return () => { vivo = false; };
    }, [recorte.dataUrl]);

    // La vista previa se dibuja en un lienzo (al mover el tamaño no se arma un
    // archivo en cada paso); el archivo se arma solo al bajar o guardar.
    const { ancho, alto } = medidas(recorte.formato, recorte.personalizado);
    const como = { tamano: recorte.tamano, fondo: recorte.fondo };
    const vista = useRef(null);
    useEffect(() => {
        if (base && vista.current) recorteAMedida(base, ancho, alto, como, vista.current);
    }, [base, ancho, alto, recorte.tamano, recorte.fondo]); // eslint-disable-line react-hooks/exhaustive-deps
    // Sin fondo va en PNG (la transparencia); con fondo, en JPG, que pesa mucho menos.
    const archivoFinal = (lienzo) => (recorte.fondo ? lienzo.toDataURL('image/jpeg', 0.92) : lienzo.toDataURL('image/png'));
    const guardadaAsi = !!recorte.id && recorte.guardado === firmaRecorte(recorte);

    const ponerFoto = async (f) => {
        try {
            cambiar({ original: await achicarFoto(f, 1024), deInventario: false });
        } catch (e) {
            avisar('error', e.message);
        }
    };

    const elegirProducto = (p) => {
        // Si se partía de la foto de otro producto, esa ya no corresponde.
        cambiar({ producto: { id: Number(p.id), name: p.name }, ...(recorte.deInventario ? { original: null, deInventario: false } : {}) });
    };

    const generar = async () => {
        if (!recorte.original || generando || iaApagada) return;
        const datos = recorte.deInventario ? { productId: producto.id } : { foto: recorte.original };
        const firma = JSON.stringify([recorte.deInventario ? producto.id : recorte.original.length, recorte.nota]);
        if (!clave.current || clave.current.firma !== firma) clave.current = { clave: nuevaClave(), firma };
        setGenerando(true); setEligiendo(false); limpiarAviso();
        const r = await publicidad(companyId, 'recortar', { ...datos, nota: recorte.nota, clave: clave.current.clave }, 70000);
        setGenerando(false);
        if (!r.success) {
            if (r.error !== 'TIEMPO' && r.error !== 'RED') clave.current = null;
            avisar('error', r.error === 'TIEMPO'
                ? 'La IA tardó demasiado. Probá de nuevo: si alcanzó a hacerlo, no se cobra dos veces.'
                : (r.message || r.error));
            refrescarEstado();
            return;
        }
        clave.current = null;
        // Otro recorte: todavía no está en el Historial ni en ningún producto.
        cambiar({ id: null, title: '', fondoId: r.fondo.id, url: r.fondo.url, dataUrl: r.dataUrl || null, final: null, asignada: [] });
        refrescarEstado();
    };

    // En el producto va siempre cuadrada, como las fotos de la tienda, sea cual sea la medida elegida.
    const ponerEn = async (p) => {
        if (!base || asignando) return;
        const id = Number(p.id);
        const tiene = typeof fotosCache.get(`${companyId}:${id}`) === 'string' || Number(p.has_image) === 1;
        if (tiene && !yaPuesta(id) && !window.confirm(`«${p.name}» ya tiene foto. ¿Reemplazarla por la recortada?`)) return;
        setAsignando(id); limpiarAviso();
        let foto;
        try {
            // Siempre igual que las de la tienda: cuadrada, sobre blanco y al tamaño de siempre.
            foto = await fotoParaInventario(recorteAMedida(base, 800, 800).toDataURL('image/jpeg', 0.92));
        } catch {
            setAsignando(null);
            avisar('error', 'No se pudo preparar la foto.');
            return;
        }
        const r = await publicidad(companyId, 'asignarFoto', { productId: id, foto, fondoId: recorte.fondoId });
        setAsignando(null);
        if (!r.success) { avisar('error', r.message || r.error); return; }
        // En este equipo se ve al tiro: el buscador, el inventario y la caja.
        fotosCache.set(`${companyId}:${id}`, foto);
        reemplazarImagen(companyId, id, foto).catch(() => {});
        useStore.setState(s => ({ products: s.products.map(x => (Number(x.id) === id ? { ...x, image: foto, has_image: 1 } : x)) }));
        setRecorte(prev => ({ ...prev, asignada: [...prev.asignada.filter(a => a.id !== id), { id, nombre: r.producto?.nombre || p.name }] }));
        setEligiendo(false);
        const tienda = TIENDA_TRAS_ASIGNAR[r.tienda];
        avisar('ok', `Foto puesta en «${r.producto?.nombre || p.name}»${r.reemplazo ? ' (reemplazó la que tenía)' : ''}.${tienda ? ` ${tienda}` : ''}`);
    };

    const nombreArchivo = () => {
        const nombre = (recorte.title || producto?.name || 'producto')
            .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).toLowerCase();
        return `recorte-${nombre || 'producto'}-${hoy()}.${recorte.fondo ? 'jpg' : 'png'}`;
    };

    // Va al Historial como una publicidad más, tal como se ve (medida, tamaño y
    // fondo). Cambiado algo desde que se guardó, queda otra (como en la Rápida).
    const guardar = async () => {
        if (!base || guardando || guardadaAsi) return;
        setGuardando(true); limpiarAviso();
        const otra = !!recorte.id;
        const lienzo = recorteAMedida(base, ancho, alto, como);
        let final = archivoFinal(lienzo);
        // Un PNG grande (una pantalla sin fondo) puede no entrar en el pedido: va en WebP, que guarda la transparencia.
        if (final.length > 3_800_000) final = lienzo.toDataURL('image/webp', 0.95);
        // La miniatura es JPG: lo transparente se ve blanco.
        const m = recorteAMedida(base, Math.round(260 * Math.min(1, ancho / alto)), Math.round(260 * Math.min(1, alto / ancho)), { ...como, fondo: recorte.fondo || '#ffffff' });
        const r = await publicidad(companyId, 'guardar', {
            id: null, title: producto?.name || recorte.asignada[0]?.nombre || '', status: 'final', formato: recorte.formato,
            productos: [], textos: {}, backgroundId: recorte.fondoId,
            layout: {
                modo: 'recorte', producto: producto ? { id: producto.id, nombre: producto.name } : null, nota: recorte.nota || '',
                tamano: Number(recorte.tamano.toFixed(2)), fondo: recorte.fondo,
                ...(recorte.formato === 'personalizado' ? { personalizado: { ancho, alto } } : {}),
            },
            finalJpeg: final, miniatura: m.toDataURL('image/jpeg', 0.7),
        }, 45000);
        setGuardando(false);
        if (!r.success) { avisar('error', r.message || r.error); return; }
        cambiar({ id: r.id, title: r.title || '', guardado: firmaRecorte(recorte) });
        avisar('ok', `${otra ? 'Guardada como otra, así como se ve' : 'Guardada en el Historial'}${r.title ? `: «${r.title}»` : ''}.`);
    };

    const descargar = async () => {
        if (!base) return;
        const r = await descargarImagen(archivoFinal(recorteAMedida(base, ancho, alto, como)), nombreArchivo());
        if (r.mensaje) avisar(r.ok ? 'ok' : 'error', r.mensaje);
    };

    // La medida y el fondo elegidos quedan para el próximo recorte; el tamaño vuelve al de siempre.
    const nueva = () => {
        setRecorte({ ...RECORTE_VACIO, formato: recorte.formato, personalizado: recorte.personalizado, fondo: recorte.fondo });
        setEligiendo(false); clave.current = null; limpiarAviso();
    };
    const fondoPropio = !!recorte.fondo && !FONDOS_RECORTE.some(([c]) => c === recorte.fondo);

    const hayResultado = !!recorte.fondoId;
    const quitarAdjunto = 'shrink-0 w-9 h-9 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-white/10 hover:text-[var(--color-text)]';

    return (
        <div className="flex flex-col lg:flex-row gap-4 min-h-0">
            {/* El resultado: en el celular aparece cuando ya hay uno (o se está haciendo) */}
            <div className={`lg:order-2 lg:flex-1 min-w-0 ${hayResultado || generando ? '' : 'hidden lg:block'}`}>
                {/* Encima de la otra tarjeta: en el celular el buscador de "Ponerla en…" se abre sobre ella */}
                <div className="glass-card p-3 relative z-30 lg:sticky lg:top-0">
                    <div className="flex items-center justify-between mb-2 gap-2">
                        {hayResultado
                            ? <MedidaRecorte recorte={recorte} onCambiar={cambiar} />
                            : <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Foto recortada · {ancho}×{alto}</p>}
                        {guardadaAsi && <span className="text-[11px] font-bold text-[var(--color-text-muted)]">#{recorte.id} · En el Historial</span>}
                    </div>
                    {/* Con la proporción de la medida elegida y entera en la pantalla (una 9:16 no pasa del 56 % del alto).
                        Sin fondo, lo transparente se ve como un tablero. */}
                    <div className={`relative mx-auto rounded-lg flex items-center justify-center overflow-hidden ${base && !recorte.fondo ? '' : 'bg-white'}`}
                        style={{ aspectRatio: `${ancho} / ${alto}`, width: `min(100%, calc(56vh * ${ancho / alto}))`, ...(base && !recorte.fondo ? TABLERO : {}) }}>
                        {base
                            ? <canvas ref={vista} aria-label="Producto recortado" className="w-full h-full" />
                            : !generando && (
                                <div className="flex flex-col items-center justify-center gap-2 text-gray-500 text-center px-6">
                                    {hayResultado ? <Loader2 className="animate-spin" size={28} /> : <Scissors size={28} />}
                                    <p className="text-sm font-bold">{hayResultado ? 'Cargando la foto…' : 'Acá aparece el producto recortado'}</p>
                                </div>
                            )}
                        {generando && (
                            <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2 text-white text-center px-6">
                                <Loader2 className="animate-spin" size={32} />
                                <p className="text-sm font-bold">Recortando con IA… (15 a 30 s)</p>
                            </div>
                        )}
                    </div>
                    {/* Agrandar o achicar el producto y elegir el fondo (Kevin, 31-oct-2026): sin IA, al instante */}
                    {base && (
                        <div className="mt-3 rounded-lg border border-[var(--glass-border)] p-3 flex flex-col gap-3">
                            <Deslizador etiqueta={`Tamaño del producto · ${Math.round(recorte.tamano * 100)} %`} extremos={['Achicar', 'Agrandar']}
                                min={0.3} max={1.2} paso={0.01} valor={recorte.tamano} onChange={v => cambiar({ tamano: v })} />
                            <div>
                                <p className="text-[11px] font-bold text-[var(--color-text-muted)] mb-1.5">Fondo</p>
                                <div className="flex flex-wrap items-center gap-2">
                                    {FONDOS_RECORTE.map(([color, nombre]) => (
                                        <button key={color} type="button" onClick={() => cambiar({ fondo: color })} title={nombre} aria-label={`Fondo ${nombre}`}
                                            aria-pressed={recorte.fondo === color}
                                            className={`w-10 h-10 rounded-full border-2 ${recorte.fondo === color ? 'border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/50' : 'border-[var(--glass-border)]'}`}
                                            style={{ background: color }} />
                                    ))}
                                    <label title="Otro color" aria-label="Otro color de fondo"
                                        className={`relative w-10 h-10 rounded-full border-2 overflow-hidden cursor-pointer ${fondoPropio ? 'border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/50' : 'border-[var(--glass-border)]'}`}
                                        style={{ background: fondoPropio ? recorte.fondo : 'conic-gradient(#ef4444, #facc15, #22c55e, #06b6d4, #3b82f6, #a855f7, #ef4444)' }}>
                                        <input type="color" value={recorte.fondo || '#ffffff'} onChange={e => cambiar({ fondo: e.target.value })}
                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                                    </label>
                                    <button type="button" onClick={() => cambiar({ fondo: null })} aria-pressed={!recorte.fondo}
                                        className={`min-h-[40px] px-3 rounded-full border-2 text-xs font-bold text-gray-800 ${!recorte.fondo ? 'border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/50' : 'border-[var(--glass-border)]'}`}
                                        style={TABLERO}>
                                        Sin fondo (PNG)
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                    {base && (
                        <div className="mt-2 flex items-start gap-2">
                            {recorte.original && (
                                <span className="shrink-0 flex flex-col items-center gap-0.5">
                                    <img src={recorte.original} alt="La foto original" className="w-14 h-14 rounded object-cover bg-black/30" />
                                    <span className="text-[10px] font-bold text-[var(--color-text-muted)]">Antes</span>
                                </span>
                            )}
                            <p className="text-[11px] text-amber-400 flex items-start gap-1.5">
                                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                                Revisá que la etiqueta haya quedado igual a la del producto: la IA lo vuelve a dibujar y puede cambiar una letra o un número.
                            </p>
                        </div>
                    )}
                    {recorte.asignada.length > 0 && (
                        <p className="mt-2 text-xs text-emerald-400 flex items-start gap-1.5">
                            <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                            <span>Puesta en {recorte.asignada.map(a => `«${a.nombre}»`).join(', ')}.</span>
                        </p>
                    )}
                    <div className="grid grid-cols-2 gap-2 mt-3">
                        {producto && !yaPuesta(producto.id) && (
                            <Boton onClick={() => ponerEn({ ...producto, has_image: typeof fotoActual === 'string' ? 1 : 0 })} disabled={!base || !!asignando || !estado?.app}
                                icono={asignando === producto.id ? Loader2 : PackageCheck} girando={asignando === producto.id} principal className="col-span-full">
                                Ponerla en «{producto.name}»
                            </Boton>
                        )}
                        <Boton onClick={() => setEligiendo(v => !v)} disabled={!base || !!asignando || !estado?.app}
                            icono={asignando && asignando !== producto?.id ? Loader2 : ShoppingBag} girando={!!asignando && asignando !== producto?.id}
                            principal={!producto || yaPuesta(producto.id)} className="col-span-full">
                            {producto ? 'Ponerla en otro producto' : 'Ponerla en un producto'}
                        </Boton>
                        {eligiendo && (
                            <div className="col-span-full rounded-lg border border-[var(--glass-border)] p-3 relative z-30">
                                <TituloMenu>¿En qué producto?</TituloMenu>
                                <BuscadorProductos buscar={buscar} onElegir={ponerEn} dinero={dinero} yaElegidos={recorte.asignada.map(a => a.id)} lleno={false} />
                                <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">
                                    Buscalo por nombre o código. Si ya tiene foto, te pregunta antes de reemplazarla. La foto se cambia en el inventario
                                    y en la tienda online (solo la foto: el precio y el stock no se tocan).
                                </p>
                            </div>
                        )}
                        <Boton onClick={guardar} disabled={!base || guardando || guardadaAsi || !estado?.app} icono={guardando ? Loader2 : guardadaAsi ? CheckCircle2 : Save} girando={guardando}>
                            {guardadaAsi ? 'En el Historial' : 'Guardar'}
                        </Boton>
                        <Boton onClick={descargar} disabled={!base} icono={Download}>{recorte.fondo ? 'Descargar' : 'Descargar PNG'}</Boton>
                    </div>
                    {base && (
                        <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">
                            Descargar y Guardar van como se ve: {ancho}×{alto}{recorte.fondo ? ', en JPG' : ', en PNG sin fondo'}. En el producto va siempre
                            cuadrada (800×800) y sobre blanco, como las fotos de la tienda.
                        </p>
                    )}
                </div>
            </div>

            {/* La foto de la que se parte y el botón de la IA */}
            <div className="lg:order-1 lg:w-[440px] shrink-0 flex flex-col gap-4">
                <div className="glass-card p-3 relative z-20 flex flex-col gap-3">
                    <div>
                        <TituloMenu>1 · El producto (si querés)</TituloMenu>
                        {producto ? (
                            <div className="p-1.5 pr-1 rounded-lg flex items-center gap-2 border border-[var(--glass-border)] bg-[var(--glass-bg)]">
                                <FotoProducto foto={fotoActual} lado={44} />
                                <span className="flex-1 min-w-0">
                                    <span className="block text-sm font-bold text-[var(--color-text)] truncate">{producto.name}</span>
                                    <span className="block text-[11px] text-[var(--color-text-muted)]">
                                        {fotoActual === null ? <b className="text-amber-400">Sin foto en el inventario: sacale una abajo</b>
                                            : typeof fotoActual === 'string' ? 'Tiene foto en el inventario' : 'Revisando la foto…'}
                                    </span>
                                </span>
                                <button type="button" onClick={() => cambiar({ producto: null, ...(recorte.deInventario ? { original: null, deInventario: false } : {}) })}
                                    aria-label={`Quitar ${producto.name}`} className={quitarAdjunto}><X size={15} /></button>
                            </div>
                        ) : (
                            <BuscadorProductos buscar={buscar} onElegir={elegirProducto} dinero={dinero} yaElegidos={[]} lleno={false} />
                        )}
                        <p className="mt-1.5 text-[11px] text-[var(--color-text-muted)]">
                            Elegilo si la foto es para un producto del inventario: al terminar se la ponés con un toque.
                        </p>
                    </div>

                    <div>
                        <TituloMenu>2 · La foto</TituloMenu>
                        <input ref={camara} type="file" accept="image/*" capture="environment" className="hidden"
                            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) ponerFoto(f); }} />
                        <input ref={archivo} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) ponerFoto(f); }} />
                        {recorte.original && (
                            <div className="mb-2 flex items-center gap-3">
                                <img src={recorte.original} alt="La foto elegida" className="w-20 h-20 rounded-lg object-contain bg-black/30" />
                                <p className="flex-1 text-xs text-[var(--color-text-muted)]">
                                    {recorte.deInventario ? 'La foto que tiene en el inventario.' : 'Tu foto.'} Podés cambiarla antes de recortar.
                                </p>
                                {/* Kevin, 31-oct-2026: "cargué una imagen pero me equivoqué, cómo la borro" */}
                                <button type="button" onClick={() => cambiar({ original: null, deInventario: false })} disabled={generando}
                                    aria-label="Quitar la foto" title="Quitar la foto" className={`${quitarAdjunto} disabled:opacity-40`}><Trash2 size={16} /></button>
                            </div>
                        )}
                        <div className="grid grid-cols-2 gap-2">
                            <Boton onClick={() => camara.current?.click()} icono={Camera} principal={!recorte.original}>Tomar foto</Boton>
                            <Boton onClick={() => archivo.current?.click()} icono={Upload}>Subir foto</Boton>
                            {typeof fotoActual === 'string' && !recorte.deInventario && (
                                <Boton onClick={() => cambiar({ original: fotoActual, deInventario: true })} icono={ImageIcon} className="col-span-full">
                                    Usar la foto que ya tiene
                                </Boton>
                            )}
                        </div>
                    </div>

                    {/* Antes de recortar se elige acá; después, arriba de la foto (no se ven los dos a la vez) */}
                    {!hayResultado && (
                        <div>
                            <TituloMenu>3 · La medida</TituloMenu>
                            <MedidaRecorte recorte={recorte} onCambiar={cambiar} />
                            <p className="mt-1.5 text-[11px] text-[var(--color-text-muted)]">Se puede cambiar después, sin gastar otra imagen.</p>
                        </div>
                    )}

                    <Campo etiqueta="Qué dejar en la foto (si hace falta)">
                        <input value={recorte.nota} maxLength={LARGO_NOTA_RECORTE} onChange={e => cambiar({ nota: e.target.value })}
                            placeholder="Por ejemplo: solo la botella de la izquierda" className="glass-input w-full text-sm" />
                    </Campo>

                    <div className="flex items-center gap-2">
                        <Ayuda titulo="Cómo funciona">
                            Sacale una foto al producto (o subila) y la IA lo deja solo, derecho y sobre fondo blanco: sin la mano, la mesa ni
                            lo que haya atrás. Después guardalo en el Historial, bajalo, o ponelo como foto de un producto del inventario: la
                            foto cambia también en la tienda online. Sale mejor con el producto de frente, entero y con buena luz. {gastoIA}
                        </Ayuda>
                        <span className="flex-1" />
                        <button type="button" onClick={generar} disabled={!recorte.original || generando || iaApagada}
                            className="shrink-0 min-h-[44px] px-5 rounded-lg text-sm font-bold flex items-center gap-2 bg-[var(--color-primary)] text-[var(--color-on-primary)] disabled:opacity-40">
                            {generando ? <Loader2 size={16} className="animate-spin" /> : <Scissors size={16} />} {hayResultado ? 'Recortar de nuevo' : 'Recortar con IA'}
                        </button>
                    </div>
                    {motivoSinIA ? <p className="text-xs font-bold text-amber-400">{motivoSinIA}</p>
                        : !recorte.original && <p className="text-[11px] text-[var(--color-text-muted)]">Sacá o subí una foto para recortarla. {gastoIA}</p>}
                    {(hayResultado || recorte.original || producto) && (
                        <button type="button" onClick={nueva} className="self-start min-h-[36px] text-xs font-bold text-[var(--color-primary)] flex items-center gap-1">
                            <Plus size={14} /> Empezar otro recorte
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

function Historial({ companyId, dinero, onAbrir, abriendo, avisar }) {
    const [lista, setLista] = useState(null);
    const [ocupado, setOcupado] = useState(null);

    const cargar = useCallback(async () => {
        const r = await publicidad(companyId, 'listar', { limit: 60 });
        if (r.success) setLista(r.disenos);
        else { setLista([]); avisar('error', r.message); }
    }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => { cargar(); }, [cargar]);

    // Se abre como una nueva, sin guardar nada todavía: al guardarla queda otra
    // publicidad (numerada). Antes creaba un borrador "(copia)" que, editado y
    // guardado, dejaba una tercera.
    const duplicar = (x) => onAbrir(x.id, { comoNueva: true });

    const eliminar = async (x) => {
        if (!window.confirm(`¿Eliminar "${x.title || 'Publicidad'}"? No se puede deshacer.`)) return;
        setOcupado(x.id);
        const r = await publicidad(companyId, 'eliminar', { id: x.id });
        setOcupado(null);
        if (!r.success) { avisar('error', r.message); return; }
        setLista(prev => prev.filter(y => y.id !== x.id));
    };

    // La imagen final guardada. Sin ella (no había almacenamiento) se abre en el editor.
    const imagenGuardada = async (x, desde) => {
        if (!x.finalUrl) { onAbrir(x.id); return null; }
        setOcupado(x.id);
        const r = await publicidad(companyId, 'imagen', { url: x.finalUrl });
        setOcupado(null);
        if (!r.success) { avisar('error', `No se pudo bajar la imagen. Abrila y ${desde} desde el editor.`); return null; }
        return r.dataUrl;
    };
    const nombreDe = (x) => {
        const base = (x.title || 'publicidad').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 50).toLowerCase();
        return `publicidad-${base}-${String(x.updatedAt).slice(0, 10)}`;
    };

    const bajar = async (x) => {
        const dataUrl = await imagenGuardada(x, 'descargala');
        if (!dataUrl) return;
        // Un recorte sin fondo está guardado en PNG (o WebP si era muy grande): se baja con su extensión.
        const ext = /^data:image\/png/.test(dataUrl) ? 'png' : /^data:image\/webp/.test(dataUrl) ? 'webp' : 'jpg';
        const res = await descargarImagen(dataUrl, `${nombreDe(x)}.${ext}`);
        if (res.mensaje) avisar(res.ok ? 'ok' : 'error', res.mensaje);
    };

    const imprimir = async (x) => {
        const dataUrl = await imagenGuardada(x, 'imprimila');
        if (!dataUrl) return;
        const res = await imprimirImagen(dataUrl, nombreDe(x));
        if (!res.ok) avisar('error', res.mensaje);
    };

    if (!lista) return <div className="flex justify-center p-10"><Loader2 className="animate-spin text-[var(--color-text-muted)]" /></div>;
    if (!lista.length) return <div className="glass-card p-8 text-center text-sm text-[var(--color-text-muted)]">Todavía no hay publicidades guardadas.</div>;

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {lista.map(x => (
                <div key={x.id} className="glass-card p-3 flex gap-3">
                    <div className="w-24 h-28 shrink-0 rounded bg-black/30 overflow-hidden flex items-center justify-center">
                        {x.miniatura ? <img src={x.miniatura} alt="" className="w-full h-full object-contain" /> : <ImageIcon className="text-[var(--color-text-muted)]" />}
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col gap-1">
                        <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-bold text-[var(--color-text)] leading-tight line-clamp-2">{x.title || 'Publicidad'}</p>
                            <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${x.status === 'final' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
                                {x.status === 'final' ? 'Final' : 'Borrador'}
                            </span>
                        </div>
                        <p className="text-[11px] text-[var(--color-text-muted)]">
                            {x.conChat && <b className="text-[var(--color-primary)]">Con chat · </b>}
                            {x.recorte ? <b className="text-[var(--color-primary)]">Foto recortada</b> : formatoPorId(x.format).nombre} · {new Date(x.updatedAt).toLocaleDateString('es-CL')}{x.usuario ? ` · ${x.usuario}` : ''}
                        </p>
                        <ul className="text-[11px] text-[var(--color-text)] space-y-0.5">
                            {x.productos.slice(0, 3).map(p => (
                                <li key={p.productId} className="flex justify-between gap-2">
                                    <span className="truncate">{p.nombre}</span>
                                    <span className="shrink-0 font-bold">{dinero(p.precioPublicidad)}</span>
                                </li>
                            ))}
                            {x.productos.length > 3 && <li className="text-[var(--color-text-muted)]">y {x.productos.length - 3} más</li>}
                        </ul>
                        <div className="flex flex-wrap gap-1 mt-auto pt-1">
                            {/* Un recorte se abre para ponérselo a un producto; duplicarlo no sirve de nada. */}
                            {[
                                [Pencil, x.recorte ? 'Abrir' : 'Editar', () => onAbrir(x.id)],
                                ...(x.recorte ? [] : [[Copy, 'Duplicar', () => duplicar(x)]]),
                                [Download, 'Bajar', () => bajar(x)],
                                [Printer, 'Imprimir', () => imprimir(x)],
                                [Trash2, 'Borrar', () => eliminar(x)],
                            ].map(([icono, txt, fn]) => (
                                <button key={txt} onClick={fn} disabled={ocupado === x.id || abriendo}
                                    className="min-h-[36px] px-2 rounded-md text-[11px] font-bold flex items-center gap-1 bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)] disabled:opacity-40">
                                    {React.createElement(icono, { size: 13 })} {txt}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
