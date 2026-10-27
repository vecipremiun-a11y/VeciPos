import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    Megaphone, Search, Loader2, X, Sparkles, Download, Save, Copy, Trash2, Pencil, Plus, Upload,
    History, AlertTriangle, CheckCircle2, Palette, Image as ImageIcon, Wand2, Lightbulb, Move, Printer,
    CircleHelp, ChevronDown, Type, RotateCcw,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { formatCurrency } from '../utils/formatCurrency';
import { resumenOferta } from '../lib/ofertas';
import { reportCall } from '../lib/dataApi';
import { opcionesCategorias } from '../lib/arbolCategorias';
import {
    FORMATOS, CAMPANAS, ESTILOS, GRUPOS_ESTILO, ESTILO_AUTO, IDEAS_EJEMPLO, AJUSTES_RAPIDOS, LETRAS, LETRAS_URL, PALETAS,
    formatoPorId, campanaPorId, estiloPorId, letrasPorId, sugerirEstilo, medidas, textoUnidad,
} from '../lib/publicidad/catalogo';
import {
    cargarImagen, dibujarPublicidad, quitarFondoBlanco, pedirLetras, prepararLetras, esquinas, ESCALA_PIEZA,
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

const NOMBRE_PIEZA = { titulo: 'Título', mensaje: 'Mensaje', pie: 'Pie', nombre: 'Nombre', precio: 'Precio', etiqueta: 'Etiqueta', foto: 'Foto' };

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
    const [menu, setMenu] = useState(null);           // menú abierto sobre la vista previa: 'formato' | 'letras' | 'colores'
    const [panelFondo, setPanelFondo] = useState(null); // 'encuadre' | 'ajustar', bajo los fondos

    const lienzo = useRef(null);
    const barraMenus = useRef(null);
    const fotos = useRef(new Map()); // productId → { clave, img }
    const clave = useRef(null);      // { clave, firma }: un reintento tras un corte no vuelve a cobrar
    const piezas = useRef([]);       // dónde quedó cada texto en el último dibujo
    const arrastre = useRef(null);   // { modo: 'mover' | 'tamano', pieza, inicio, ... }
    const tocarVacio = useRef(null); // un toque fuera de los textos: si no se arrastra, suelta la elegida

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
    const escenaIntegrada = fondo?.modo === 'integrado' && visibles.length === 1 && fondo.productId === visibles[0].productId;
    // Por qué los botones de IA están apagados, para que no parezcan rotos.
    const motivoSinIA = !estado ? null
        : !estado.success ? 'No se pudo revisar la Publicidad (mirá el aviso de arriba).'
            : !estado.app ? 'Para usar la IA hay que activar la App "Publicidad IA" en el Marketplace.'
                : !estado.almacenamiento ? 'Falta conectar el almacenamiento de imágenes (Vercel Blob).'
                    : cupo?.agotado ? 'Ya se usaron todas las imágenes del mes.'
                        : !visibles.length ? 'Agregá un producto primero.'
                            : null;

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

    // ── Fotos de los productos (y su fondo blanco quitado) ────────────────────
    useEffect(() => {
        let vivo = true;
        for (const it of items) {
            const src = it.fotoPropia || it.fotoGuardada || it.fotoInventario;
            const k = src ? `${src.length}:${src.slice(-48)}:${it.quitarFondo ? 1 : 0}` : 'sin';
            const ya = fotos.current.get(it.productId);
            if (ya?.clave === k) continue;
            fotos.current.set(it.productId, { clave: k, img: null });
            if (!src) { setVersion(v => v + 1); continue; }
            cargarImagen(src).then(img => {
                if (!vivo || fotos.current.get(it.productId)?.clave !== k) return;
                fotos.current.set(it.productId, { clave: k, img: it.quitarFondo ? quitarFondoBlanco(img) : img });
                setVersion(v => v + 1);
            }).catch(() => { /* la publicidad sale sin foto */ });
        }
        const ids = new Set(items.map(it => it.productId));
        for (const id of fotos.current.keys()) if (!ids.has(id)) fotos.current.delete(id);
        return () => { vivo = false; };
    }, [items]);

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
        };
        // `version` avisa que llegó una foto (viven en un ref).
    }, [ancho, alto, d, fondoImg, colores, letras, seleccion, dinero, campana, nombreEmpresa, visibles, fondo, version]); // eslint-disable-line react-hooks/exhaustive-deps

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

    const guardar = async (status) => {
        if (!visibles.length || guardando) return;
        setGuardando(true); setAviso(null);
        const conArchivo = !!estado?.almacenamiento;
        const limpia = imagenLimpia();
        const r = await publicidad(activeCompanyId, 'guardar', {
            id: d.id, title: d.title, status, formato: d.formato, campana: d.campana, estilo: estiloId,
            backgroundId: fondo?.id ?? null,
            productos: visibles.map(it => ({
                productId: it.productId, precioPublicidad: Number(it.precioPublicidad) || 0,
                etiqueta: it.etiqueta ?? '', nombreVisible: it.nombreVisible, presentacionId: it.presentacion?.id ?? null,
                fotoUrl: it.fotoPropia ? null : it.fotoUrl, fotoPropia: conArchivo ? it.fotoPropia : null,
            })),
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
        setItems(prev => prev.map(it => it.fotoPropia && porId.get(it.productId)?.fotoUrl
            ? { ...it, fotoUrl: porId.get(it.productId).fotoUrl, fotoGuardada: it.fotoPropia, fotoPropia: null } : it));
        avisar('ok', status === 'final'
            ? 'Publicidad guardada como final.'
            : `Borrador guardado.${conArchivo ? '' : ' (Sin almacenamiento configurado: se guardan los datos y la miniatura, no la imagen.)'}`);
    };

    const descargar = async () => {
        if (!lienzo.current || !visibles.length) return;
        const r = await descargarImagen(imagenLimpia().toDataURL('image/jpeg', 0.92), nombreArchivo());
        if (r.mensaje) avisar(r.ok ? 'ok' : 'error', r.mensaje);
    };

    // Kevin, 26-oct-2026: el cartel A4 se imprime directo, sin bajarlo antes. Va
    // al doble (300 ppp en la hoja) para que las letras salgan nítidas en papel.
    const imprimir = async () => {
        if (!lienzo.current || !visibles.length || imprimiendo) return;
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
        setD(DISENO_VACIO); setItems([]); setFondos([]); setFondoId(null); setAviso(null); clave.current = null;
        setCambio(''); setConIdea(false); setSeleccion(null); setMenu(null); setPanelFondo(null);
    };

    // ── Abrir una guardada (desde el historial) ───────────────────────────────
    const abrir = async (id) => {
        setAbriendo(true); setAviso(null);
        const r = await publicidad(activeCompanyId, 'obtener', { id });
        setAbriendo(false);
        if (!r.success) { avisar('error', r.message); return; }
        const g = r.diseno;
        const lay = g.layout || {};
        setD({
            ...DISENO_VACIO, id: g.id, status: g.status, title: g.title || '', formato: g.format,
            personalizado: lay.personalizado || DISENO_VACIO.personalizado,
            campana: g.campaign || 'general', estilo: g.style || 'moderno', idea: lay.idea || '',
            titulo: g.textos?.titulo ?? null, mensaje: g.textos?.mensaje || '', extra: g.textos?.extra || '',
            mostrarNegocio: g.textos?.mostrarNegocio !== false, negocio: lay.negocio ?? null,
            colores: lay.colores || null, ajustes: { ...DISENO_VACIO.ajustes, ...(lay.ajustes || {}) },
            encuadre: { ...DISENO_VACIO.encuadre, ...(lay.encuadre || {}) },
            letras: lay.letras || DISENO_VACIO.letras, mover: lay.mover || {},
        });
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
        for (const it of nuevos) {
            if (it.fotoUrl) {
                publicidad(activeCompanyId, 'imagen', { url: it.fotoUrl }).then(x => {
                    if (x.success) cambiarItem(it.productId, { fotoGuardada: x.dataUrl, cargandoFoto: false });
                    else cargarFotoInventario(it.productId);
                });
            } else cargarFotoInventario(it.productId);
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
                        La IA crea solo el fondo; la foto real, el nombre y el precio los pone el sistema. Cambiar un precio no gasta imágenes.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {cupo && (
                        <span title="Imágenes IA del mes" className="whitespace-nowrap text-xs font-bold px-3 py-1.5 rounded-full bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text-muted)]">
                            <span className="hidden sm:inline">Imágenes IA del mes: </span><span className="sm:hidden">IA: </span>
                            <span className="text-[var(--color-text)]">{cupo.usados} / {cupo.cupo}</span>
                        </span>
                    )}
                    <div className="flex rounded-lg border border-[var(--glass-border)] overflow-hidden">
                        {[['crear', 'Crear', Pencil], ['historial', 'Historial', History]].map(([id, txt, icono]) => (
                            <button key={id} onClick={() => { setPestana(id); setSeleccion(null); setMenu(null); }}
                                className={`px-3 py-2 text-sm font-bold flex items-center gap-1.5 ${pestana === id ? 'bg-[var(--color-primary)] text-[var(--color-on-primary)]' : 'text-[var(--color-text-muted)]'}`}>
                                {React.createElement(icono, { size: 15 })} {txt}
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
            ) : (
                <>
                    {/* Productos: lo primero y a todo el ancho */}
                    <div className="glass-card p-3 relative z-30">
                        {fuente ? (
                            <ListaProductos key={fuente} inicio={selectorFuente} cargar={cargarFuente} dinero={dinero} yaElegidos={items.map(it => it.productId)}
                                vacio={fuente === OFERTAS
                                    ? 'No hay productos con oferta activa. Se prenden en Inventario → editar el producto → Oferta.'
                                    : 'Esta categoría no tiene productos.'}
                                libres={formato.max - items.length} onElegir={agregar} onQuitar={quitar} onAgregarVarios={agregarVarios} />
                        ) : (
                            <div className="flex flex-col sm:flex-row gap-2">
                                {selectorFuente}
                                <div className="flex-1 min-w-0">
                                    <BuscadorProductos buscar={searchProductsForDropdown} onElegir={agregar} dinero={dinero}
                                        yaElegidos={items.map(it => it.productId)} lleno={items.length >= formato.max} />
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
                                        {Object.keys(d.mover).length > 0 && (
                                            <button type="button" onClick={() => cambiar({ mover: {} })} title="Volver todos los textos a su lugar"
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
                                            Tocá un texto{visibles.length === 1 && !escenaIntegrada ? ' o la foto' : ''} para elegirlo: arrastralo para moverlo y
                                            tirá de sus esquinas para agrandarlo o achicarlo. En la PC, las flechas lo corren y Esc lo suelta.
                                            Lo que se guarda, se descarga o se imprime sale sin el marco.
                                        </Ayuda>
                                    </div>

                                    {menu && (
                                        <div className="absolute z-30 top-full mt-1.5 left-0 right-0 sm:right-auto sm:w-[380px] max-h-[65vh] overflow-y-auto rounded-xl border border-[var(--glass-border)] bg-[var(--color-surface)] shadow-2xl p-3">
                                            {menu === 'formato' && (
                                                <>
                                                    <TituloMenu>Formato</TituloMenu>
                                                    <div className="flex flex-col gap-0.5">
                                                        {FORMATOS.map(f => {
                                                            const m = medidas(f.id, d.personalizado);
                                                            const activo = d.formato === f.id;
                                                            return (
                                                                <button key={f.id} type="button" onClick={() => { cambiar({ formato: f.id }); if (f.id !== 'personalizado') setMenu(null); }}
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
                                                    {d.formato === 'personalizado' && (
                                                        <div className="grid grid-cols-2 gap-2 mt-2">
                                                            <Campo etiqueta="Ancho (px)">
                                                                <input type="number" min={300} max={2400} value={d.personalizado.ancho} className="glass-input w-full text-sm"
                                                                    onChange={e => cambiar({ personalizado: { ...d.personalizado, ancho: e.target.value } })} />
                                                            </Campo>
                                                            <Campo etiqueta="Alto (px)">
                                                                <input type="number" min={300} max={2400} value={d.personalizado.alto} className="glass-input w-full text-sm"
                                                                    onChange={e => cambiar({ personalizado: { ...d.personalizado, alto: e.target.value } })} />
                                                            </Campo>
                                                        </div>
                                                    )}
                                                </>
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
                                    <canvas ref={lienzo} className={`block max-w-full h-auto max-h-[55vh] lg:max-h-[70vh] select-none ${visibles.length ? '' : 'opacity-30'}`}
                                        onPointerDown={empezarArrastre} onPointerMove={moverArrastre} onPointerUp={soltarArrastre}
                                        onPointerCancel={soltarArrastre} onLostPointerCapture={soltarArrastre} />
                                    {!visibles.length && (
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
                                    <BarraPieza nombre={NOMBRE_PIEZA[seleccion] || 'Texto'} tamano={tamanoDe(seleccion)} tope={topeTamano(seleccion)}
                                        nota={seleccion === 'pie' && tamanoDe('pie') >= 1 ? 'Ocupa todo el ancho: achicalo para moverlo a los lados.' : null}
                                        onTamano={(v) => cambiarTamano(seleccion, v)} onASuLugar={() => piezaASuLugar(seleccion)} onListo={() => setSeleccion(null)} />
                                )}
                                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 2xl:grid-cols-4 gap-2 mt-3">
                                    {d.formato === 'cartel' && (
                                        <Boton onClick={imprimir} disabled={!visibles.length || imprimiendo} icono={imprimiendo ? Loader2 : Printer} girando={imprimiendo} principal className="col-span-full">
                                            {imprimiendo ? 'Preparando la hoja…' : 'Imprimir cartel A4'}
                                        </Boton>
                                    )}
                                    <Boton onClick={() => guardar('borrador')} disabled={!visibles.length || guardando || !estado?.app} icono={guardando ? Loader2 : Save} girando={guardando}>Borrador</Boton>
                                    <Boton onClick={() => guardar('final')} disabled={!visibles.length || guardando || !estado?.app} icono={CheckCircle2}>Guardar final</Boton>
                                    <Boton onClick={descargar} disabled={!visibles.length} icono={Download} principal={d.formato !== 'cartel'}>Descargar</Boton>
                                    <Boton onClick={nueva} icono={Plus}>Nueva</Boton>
                                </div>
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
                                    <p className="text-xs text-[var(--color-text-muted)]">Buscá un producto arriba, o elegí una categoría o las ofertas.</p>
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
function BarraPieza({ nombre, tamano, tope, nota, onTamano, onASuLugar, onListo }) {
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
                <button type="button" onClick={onASuLugar} className="min-h-[44px] px-2 text-xs font-bold text-[var(--color-primary)]">A su lugar</button>
                <button type="button" onClick={onListo} className="min-h-[44px] px-4 rounded-lg text-xs font-bold bg-[var(--color-primary)] text-[var(--color-on-primary)]">Listo</button>
            </div>
            {nota && <p className="w-full text-[11px] text-[var(--color-text-muted)]">{nota}</p>}
        </div>
    );
}

function BuscadorProductos({ buscar, onElegir, dinero, yaElegidos, lleno }) {
    const [termino, setTermino] = useState('');
    const [resultados, setResultados] = useState([]);
    const [buscando, setBuscando] = useState(false);

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
                                className="w-full text-left px-3 py-2.5 border-b border-[var(--glass-border)] last:border-0 hover:bg-white/5 disabled:opacity-40 flex items-center justify-between gap-2">
                                <span className="min-w-0">
                                    <span className="block text-sm font-bold text-[var(--color-text)] truncate">{p.name}</span>
                                    <span className="block text-[11px] text-[var(--color-text-muted)] truncate">{p.category || 'Sin categoría'} · {p.unit || 'Und'}{Number(p.has_image) === 1 ? ' · con foto' : ' · sin foto'}</span>
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

function Historial({ companyId, dinero, onAbrir, abriendo, avisar }) {
    const [lista, setLista] = useState(null);
    const [ocupado, setOcupado] = useState(null);

    const cargar = useCallback(async () => {
        const r = await publicidad(companyId, 'listar', { limit: 60 });
        if (r.success) setLista(r.disenos);
        else { setLista([]); avisar('error', r.message); }
    }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => { cargar(); }, [cargar]);

    const duplicar = async (x) => {
        setOcupado(x.id);
        const r = await publicidad(companyId, 'duplicar', { id: x.id });
        setOcupado(null);
        if (!r.success) { avisar('error', r.message); return; }
        avisar('ok', 'Copia creada: cambiá lo que necesites (por ejemplo el precio) y guardala.');
        onAbrir(r.id);
    };

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
        const res = await descargarImagen(dataUrl, `${nombreDe(x)}.jpg`);
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
                            {formatoPorId(x.format).nombre} · {new Date(x.updatedAt).toLocaleDateString('es-CL')}{x.usuario ? ` · ${x.usuario}` : ''}
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
                            {[
                                [Pencil, 'Editar', () => onAbrir(x.id)],
                                [Copy, 'Duplicar', () => duplicar(x)],
                                [Download, 'Bajar', () => bajar(x)],
                                ...(x.format === 'cartel' ? [[Printer, 'Imprimir', () => imprimir(x)]] : []),
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
