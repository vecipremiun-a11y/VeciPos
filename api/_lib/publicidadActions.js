// Publicidad con IA (migración 0036). Ver api/ai/publicidad.js.
//
// Arquitectura híbrida, a propósito:
//   · La IA hace SOLO lo visual: el fondo (gpt-image-2.5-flare) o, si se pide,
//     una escena con el producto integrado a partir de su foto real
//     (gpt-image-2.5-sunburst, edición con referencia).
//   · El nombre, el precio, la unidad y los textos los dibuja el navegador
//     encima (src/lib/publicidad/componer.js). Así un precio nunca depende de que
//     la IA lo escriba bien, y cambiarlo no cuesta otra generación.
//   · La excepción es "Con chat" (generarChat): ahí la IA hace la publicidad
//     entera, textos y precios incluidos, porque el cliente la describe libre.
//
// Probado de verdad contra OpenAI el 23-oct-2026 (autorizado por Kevin): un fondo
// 1024x1536 con flare tardó 11,7 s (172 tokens de texto + 343 de imagen), y la
// escena integrada con sunburst 16,6 s (1.024 tokens de imagen de entrada).
// Sunburst no acepta `input_fidelity` (400 invalid_input_fidelity_model).
//
// Nada de esto toca `products`: lo que se guarda del producto es una COPIA en el
// diseño (nombre, unidad, precio normal del momento y el precio de la publicidad).

import { put, get, del } from '@vercel/blob';
import { periodoActual } from './aiGuards.js';
import { syncProductToStore } from '../integration/client.js';

// ── Parámetros del producto (precio y cupo confirmados por Kevin el 25-oct-2026) ──
export const CUPO_IMAGENES_MES = 200;   // imágenes generadas por sucursal y mes
export const TOPE_IMAGENES_MIN = 5;     // nadie genera 5 fondos en un minuto a mano
export const MODELO_FONDO = 'gpt-image-2.5-flare';
export const MODELO_INTEGRADO = 'gpt-image-2.5-sunburst';
const CALIDAD = 'medium';
// Precios por millón de tokens (página del modelo de OpenAI, sep-2026): texto de
// entrada 5, imagen de entrada 8, imagen de salida 30. Es una ESTIMACIÓN para el
// historial; lo que se cobra de verdad está en el panel de OpenAI.
const USD_M = { texto: 5, imagenEntrada: 8, imagenSalida: 30 };

const APP_KEY = 'publicidad';
const PERMISO = 'ads.use';
const ROLES_SIEMPRE = new Set(['owner', 'super_admin', 'Administrador']);
// Las imágenes son de cada empresa: se guardan privadas en Vercel Blob y el
// navegador las pide a este servidor, que revisa que sean de la empresa.
const ACCESO_BLOB = process.env.PUBLICIDAD_BLOB_ACCESS === 'public' ? 'public' : 'private';

// ── Catálogos (el navegador tiene la misma lista con sus medidas en px) ──────
// El cuadrado también se genera vertical: cuesta menos (343 tokens de salida
// contra 439 del 1024x1024, medido en las filas del 25-oct-2026) y deja un
// tercio de imagen fuera del recorte para mover el encuadre (componer.js).
export const FORMATOS = {
    post_vertical: { nombre: 'Publicación vertical (Instagram / Facebook)', orientacion: 'vertical', size: '1024x1536' },
    historia: { nombre: 'Historia o estado de WhatsApp', orientacion: 'vertical alto', size: '1024x1536' },
    cuadrado: { nombre: 'Publicación cuadrada', orientacion: 'vertical, que se publica recortada a un cuadrado', size: '1024x1536' },
    horizontal: { nombre: 'Formato horizontal', orientacion: 'horizontal', size: '1536x1024' },
    cartel: { nombre: 'Cartel para imprimir', orientacion: 'vertical', size: '1024x1536' },
    cartel_horizontal: { nombre: 'Cartel para imprimir en hoja acostada', orientacion: 'horizontal', size: '1536x1024' },
    // Las pantallas se miran de lejos, desde la fila de la caja: el nombre se lo dice a la IA.
    pantalla: { nombre: 'Pantalla del local (televisor horizontal que se mira de lejos)', orientacion: 'horizontal', size: '1536x1024' },
    pantalla_vertical: { nombre: 'Pantalla vertical del local (televisor parado que se mira de lejos)', orientacion: 'vertical alto', size: '1024x1536' },
    mayorista: { nombre: 'Publicidad mayorista', orientacion: 'vertical', size: '1024x1536' },
    personalizado: { nombre: 'Personalizado', orientacion: null, size: null },
};
export const CAMPANAS = {
    oferta_dia: 'Oferta del día: urgente y atractiva, energía de "solo hoy"',
    descuento: 'Descuento: destaca el ahorro',
    destacado: 'Producto destacado: elegante, protagonismo del producto',
    liquidacion: 'Liquidación de stock: urgencia, "hasta agotar stock"',
    por_cantidad: 'Promoción por cantidad: "lleva más, paga menos"',
    caja_display: 'Venta por caja o display: abundancia, volumen, almacén',
    combo: 'Combo de productos: productos que se complementan',
    temporada: 'Campaña de temporada: ambientación de la época del año',
    general: 'Publicidad general del negocio: cercano, de barrio, confiable',
};
// Cada estilo: el tratamiento (luz, colores, ánimo) y varias escenas. Cada fondo
// elige una escena al azar, así apretar de nuevo trae otra foto y no la misma
// (Kevin, 25-oct-2026: el que no sabe de publicidad tiene que sorprenderse con
// solo apretar el botón).
export const ESTILOS = {
    moderno: { trato: 'comercial moderno y limpio, luz de estudio suave, colores vivos pero elegantes', escenas: [
        'superficie de mármol claro sobre un fondo degradado de color, con reflejos suaves y algunas hojas verdes desenfocadas en los bordes',
        'mesón de una cocina moderna y luminosa, muy desenfocado, con luz natural de ventana',
        'set de estudio con un podio redondo bajo y formas geométricas suaves, sombras delicadas',
    ] },
    economico: { trato: 'oferta de supermercado económico, rojo y amarillo intensos, energía de liquidación, muy llamativo', escenas: [
        'fondo rojo intenso con rayos de luz amarilla que salen del centro y destellos, como un afiche de oferta',
        'pasillo de supermercado muy desenfocado con luces cálidas y una superficie roja brillante en primer plano',
        'fondo amarillo con confeti rojo y formas de estallido en los bordes',
    ] },
    minimalista: { trato: 'profesional y minimalista, mucho espacio libre, tonos suaves', escenas: [
        'fondo liso de color pastel con la sombra suave de las hojas de una planta proyectada por la luz de una ventana',
        'superficie de piedra clara contra una pared lisa, composición limpia con mucho aire',
        'podio cilíndrico blanco sobre un fondo de un solo color suave, luz difusa',
    ] },
    colorido: { trato: 'colorido y llamativo, alegre, alto contraste', escenas: [
        'fondo con formas orgánicas de colores vivos (naranja, morado, turquesa) y luz brillante',
        'explosión de confeti y serpentinas de colores alrededor de un espacio central limpio',
        'pared pintada de colores vivos estilo pop, con sombras marcadas de sol',
    ] },
    mayorista: { trato: 'mayorista, bodega o almacén con cajas y pallets, sobrio y confiable', escenas: [
        'bodega amplia con pallets y cajas apiladas, muy desenfocada, luz de galpón',
        'pallet de madera en primer plano con estanterías industriales desenfocadas al fondo',
        'andén de carga ordenado con cajas de cartón sin marcas, luz fría y limpia',
    ] },
    festivo: { trato: 'celebración alegre, con brillo y color', escenas: [
        'globos de colores, serpentinas y luces de fiesta desenfocadas',
        'mesa de cumpleaños con guirnaldas y confeti, luz cálida',
        'fondo con destellos dorados y confeti cayendo',
    ] },
    marca: { trato: 'identidad de un almacén de barrio chileno, cálido y cercano', escenas: [
        'mesón de madera de un almacén tradicional, con frascos y estanterías muy desenfocadas al fondo, luz cálida',
        'fachada de un almacén de barrio chileno al atardecer, muy desenfocada, con las luces encendidas',
        'interior de un minimarket ordenado y luminoso, muy desenfocado',
    ] },
    // Por fecha
    fiestas_patrias: { trato: 'Fiestas Patrias chilenas, alegre y criollo, rojo, azul y blanco', escenas: [
        'ramada chilena con banderines tricolor colgando, techo de ramas, luces cálidas y una mesa de madera rústica',
        'mesa con mantel a cuadros rojo y blanco, guirnaldas de banderines chilenos y volantines de colores en un cielo azul de septiembre',
        'fondo azul con guirnaldas de banderines rojos, blancos y azules, copihues rojos y una superficie de madera clara',
    ] },
    navidad: { trato: 'Navidad y Año Nuevo, cálido y mágico, rojo, verde y dorado', escenas: [
        'mesa con mantel rojo, luces de navidad desenfocadas con bokeh dorado, ramas de pino y adornos',
        'árbol de pascua iluminado muy desenfocado al fondo y una superficie de madera con regalos envueltos en los bordes',
        'fondo oscuro elegante con destellos dorados, estrellas y fuegos artificiales de año nuevo',
    ] },
    verano: { trato: 'verano fresco y luminoso, turquesa, amarillo sol y blanco', escenas: [
        'superficie con hielo picado y gotas de agua, con una playa chilena soleada muy desenfocada al fondo',
        'borde de una piscina de agua turquesa brillante, sol fuerte y sombras marcadas',
        'mesa de terraza al aire libre con rodajas de limón y naranja, hojas verdes y cielo azul',
    ] },
    invierno: { trato: 'invierno acogedor, tonos cálidos café, crema y naranjo', escenas: [
        'mesa de madera junto a una ventana con gotas de lluvia, luz cálida interior y una manta tejida',
        'cocina acogedora con vapor suave, tazas humeantes desenfocadas y luz de lámpara',
        'rincón con una estufa a leña encendida muy desenfocada al fondo y una superficie de madera',
    ] },
    escolar: { trato: 'vuelta a clases, alegre y ordenado, colores primarios', escenas: [
        'escritorio de madera clara con cuadernos, lápices de colores y una mochila desenfocada',
        'sala de clases luminosa muy desenfocada, con útiles escolares ordenados en los bordes de una mesa',
        'fondo amarillo visto desde arriba con útiles escolares ordenados en los bordes',
    ] },
    // Por tipo de producto
    asado: { trato: 'asado chileno, rústico y apetitoso, luz cálida de atardecer', escenas: [
        'parrilla con brasas encendidas y humo suave, tabla de madera rústica y pocillos de greda con pebre',
        'mesa de madera en un patio al atardecer, con la parrilla y luces colgantes desenfocadas al fondo',
        'superficie de pizarra oscura con romero, sal de mar y ají, con fuego desenfocado al fondo',
    ] },
    once: { trato: 'once o desayuno chileno, cálido y hogareño, luz de mañana', escenas: [
        'mesa con mantel claro, panera con marraquetas, tazas de té y mermelada, luz de ventana',
        'mesón de cocina luminoso con una tabla de madera, pan recién horneado y una tetera desenfocada',
        'mesa de desayuno vista desde arriba con café, pan y fruta, tonos crema',
    ] },
    feria: { trato: 'feria libre chilena, fresco y natural, verdes y colores de fruta', escenas: [
        'cajones de madera con frutas y verduras frescas desenfocados, toldo de feria y luz de mañana',
        'superficie de madera con hojas verdes y gotas de agua, con un puesto de feria desenfocado al fondo',
        'canasto de mimbre con verduras frescas en los bordes sobre un fondo verde claro',
    ] },
    natural: { trato: 'natural y saludable, verdes suaves, madera clara, luz natural', escenas: [
        'superficie de madera clara con hojas, semillas y granos, luz natural suave',
        'cocina luminosa con plantas, frutas frescas y tonos verdes, muy desenfocada',
        'fondo verde suave con ramas de eucalipto y sombras de hojas',
    ] },
    hogar: { trato: 'hogar y limpieza, brillante y fresco, blancos y celestes', escenas: [
        'cocina blanca reluciente con luz natural y burbujas de jabón suaves',
        'baño moderno impecable con azulejos claros y destellos de limpieza',
        'lavadero luminoso con ropa blanca doblada y burbujas',
    ] },
    mascotas: { trato: 'mascotas, alegre y tierno, colores cálidos', escenas: [
        'living acogedor con una cama de mascota y juguetes, luz cálida',
        'patio con pasto verde, una pelota y sol de tarde, con un perro feliz muy desenfocado al fondo',
        'fondo de color pastel con huellitas y juguetes de mascota en los bordes',
    ] },
};
export const LARGO_IDEA = 300; // lo que el usuario escribe para el fondo o el ajuste

const nowIso = () => new Date().toISOString();
const limpio = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// ── Candados ──────────────────────────────────────────────────────────────────

/** Dueño y administradores siempre; otro rol, si el dueño le activó `ads.use`. */
export async function puedeUsarPublicidad(turso, userId, companyId) {
    const r = await turso.execute({
        sql: `SELECT uc.role AS rol_empresa, u.role AS rol_global
              FROM user_companies uc LEFT JOIN users u ON u.id = uc.user_id
              WHERE uc.user_id = ? AND uc.company_id = ? LIMIT 1`,
        args: [userId, companyId],
    });
    const fila = r.rows[0];
    if (!fila) return false;
    if (ROLES_SIEMPRE.has(fila.rol_empresa) || ROLES_SIEMPRE.has(fila.rol_global)) return true;
    const p = await turso.execute({
        sql: 'SELECT granted FROM role_permissions WHERE company_id = ? AND role = ? AND permission = ? LIMIT 1',
        args: [companyId, fila.rol_empresa, PERMISO],
    });
    return Number(p.rows[0]?.granted) === 1;
}

/** La App "Publicidad IA" activa o en prueba vigente para esta sucursal. */
export async function tieneAppPublicidad(turso, companyId) {
    const r = await turso.execute({
        sql: 'SELECT status, trial_ends_at FROM company_apps WHERE company_id = ? AND app_key = ? LIMIT 1',
        args: [companyId, APP_KEY],
    });
    const f = r.rows[0];
    if (!f) return false;
    if (f.status === 'active') return true;
    return f.status === 'trial' && !!f.trial_ends_at && new Date(f.trial_ends_at) > new Date();
}

/** Imágenes generadas este mes (hora de Chile). Las fallidas no cuentan. */
export async function cupoPublicidad(turso, companyId) {
    const periodo = periodoActual();
    const desde = inicioDelPeriodoUtc(periodo);
    const r = await turso.execute({
        sql: `SELECT COUNT(*) AS n FROM ad_backgrounds
              WHERE company_id = ? AND status = 'lista' AND created_at >= ?`,
        args: [companyId, desde],
    });
    const usados = Number(r.rows[0]?.n) || 0;
    return { periodo, usados, cupo: CUPO_IMAGENES_MES, restantes: Math.max(0, CUPO_IMAGENES_MES - usados), agotado: usados >= CUPO_IMAGENES_MES };
}

// Comienzo del mes en Chile, en UTC: el 1° a las 00:00 con UTC-3. En invierno
// (UTC-4) la última hora del mes anterior cuenta como del mes nuevo; para un cupo
// de imágenes da lo mismo.
function inicioDelPeriodoUtc(periodo) {
    return new Date(`${periodo}-01T00:00:00-03:00`).toISOString();
}

async function ritmoExcedido(turso, companyId) {
    const desde = new Date(Date.now() - 60_000).toISOString();
    const r = await turso.execute({
        sql: 'SELECT COUNT(*) AS n FROM ad_backgrounds WHERE company_id = ? AND created_at >= ?',
        args: [companyId, desde],
    });
    return Number(r.rows[0]?.n) >= TOPE_IMAGENES_MIN;
}

// ── Vercel Blob ───────────────────────────────────────────────────────────────

function tokenBlob() { return process.env.BLOB_READ_WRITE_TOKEN || null; }
export const blobConfigurado = () => !!tokenBlob();

// Inyectable para las pruebas (sin red ni costo).
let _blob = { put, get, del };
export function __probarConBlob(falso) { _blob = falso || { put, get, del }; }

async function subir(ruta, buffer, contentType) {
    const r = await _blob.put(ruta, buffer, {
        access: ACCESO_BLOB, contentType, addRandomSuffix: true, token: tokenBlob(),
    });
    return r.url;
}

async function leerComoDataUrl(url) {
    const r = await _blob.get(url, { access: ACCESO_BLOB, token: tokenBlob() });
    if (!r) return null;
    const partes = [];
    for await (const parte of r.stream) partes.push(Buffer.from(parte));
    const tipo = r.blob?.contentType || r.headers?.get?.('content-type') || 'image/webp';
    return `data:${tipo};base64,${Buffer.concat(partes).toString('base64')}`;
}

async function borrarBlobs(urls) {
    const lista = (urls || []).filter(Boolean);
    if (!lista.length) return;
    try { await _blob.del(lista, { token: tokenBlob() }); }
    catch (e) { console.warn('[publicidad] no se pudieron borrar archivos', e?.message); }
}

const dataUrlABuffer = (d) => {
    const m = String(d || '').match(/^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/);
    return m ? { tipo: m[1], buffer: Buffer.from(m[2], 'base64') } : null;
};

// ── Productos: SIEMPRE de la empresa, leídos de la base ──────────────────────

async function productosDeLaEmpresa(turso, companyId, ids) {
    const lista = [...new Set((ids || []).map(Number).filter(n => Number.isInteger(n) && n > 0))];
    if (!lista.length) return [];
    const r = await turso.execute({
        sql: `SELECT id, name, category, unit, price, offer_price, is_offer, sku
              FROM products WHERE company_id = ? AND id IN (${lista.map(() => '?').join(',')})`,
        args: [companyId, ...lista],
    });
    return r.rows;
}

// ── Prompt ────────────────────────────────────────────────────────────────────

/**
 * El pedido a la IA. La escena sale de la idea que escribió el usuario o, si no
 * escribió nada, de una de las escenas del estilo (`azar` se inyecta en las
 * pruebas). Las reglas del final van siempre: la IA no escribe precios ni
 * dibuja marcas, y deja lugar para lo que pone el sistema.
 */
// Dónde dibuja el sistema el título, el nombre y el precio (componer.js), para
// que la IA deje esos lugares libres y no queden encima del producto. Medido con
// el recorte de cada formato, en % de la imagen de la IA: el título baja hasta
// el 22-23 % (post; 32 % en el cuadrado, que sale de la vertical; 28 % en
// horizontal) y el nombre y el precio suben hasta el 57 % (cuadrado), 65 %
// (post), 71 % (cartel) o 78 % (historia); en horizontal ocupan el 39 % derecho.
const ZONAS = {
    vertical: 'Composición: el producto va centrado, entre el 25 % y el 60 % de la altura de la imagen (medida desde arriba). El 40 % inferior es una superficie despejada y pareja, sin objetos, porque ahí se ponen el nombre y el precio, y el 25 % superior también queda despejado (pared o fondo desenfocado) para el título.',
    horizontal: 'Composición: el producto va a la izquierda, dentro del 55 % izquierdo de la imagen y entre el 30 % y el 92 % de la altura. El 40 % derecho queda despejado (fondo suave y desenfocado) porque ahí se ponen el nombre y el precio, y el 28 % superior también despejado para el título.',
};
// En la escena integrada la IA no respetó esos porcentajes (filas 21 y 23,
// 25-oct-2026: el bidón ocupó casi todo el alto), así que se le pide en lenguaje
// de fotógrafo. Tampoco es seguro: lo que asegura el margen es el encuadre del
// fondo en la pantalla. En el cuadrado entre el título y el precio queda un
// cuarto de la imagen, en los demás formatos un tercio o más.
const ENCUADRE_INTEGRADO = {
    vertical: (cuanto) => `Encuadre: plano abierto, con la cámara alejada. El producto se ve entero y chico en el cuadro: ocupa como máximo ${cuanto} del alto de la imagen, centrado y apenas por encima de la mitad. Delante de él se ve mucha superficie vacía y pareja (mesa, mesón o piso) hasta el borde de abajo, sin objetos, y arriba queda pared o fondo desenfocado, también despejado: en esos espacios se ponen después el título, el nombre y el precio.`,
    horizontal: () => 'Encuadre: plano abierto, con la cámara alejada. El producto se ve entero y chico en el cuadro, en la mitad izquierda de la imagen, y ocupa como máximo la mitad del alto. Toda la mitad derecha queda vacía, con un fondo suave y desenfocado, y arriba también queda espacio despejado: ahí se ponen después el título, el nombre y el precio.',
};

export function armarPrompt({ formato, campana, estilo, productos, modo, colores, idea, horizontal = false, azar = Math.random }) {
    const f = FORMATOS[formato] || FORMATOS.post_vertical;
    const e = ESTILOS[estilo] || ESTILOS.moderno;
    const varios = productos.length > 1;
    const lista = productos.map(p => `${p.name}${p.category ? ` (${p.category})` : ''}`).join('; ');
    const pedido = limpio(idea, LARGO_IDEA);
    const escena = pedido
        ? `Escena pedida por el negocio: «${pedido}». Interprétala como un director de arte: respétala y hazla verse profesional, atractiva y sorprendente.`
        : `Escena: ${e.escenas[Math.min(e.escenas.length - 1, Math.floor(azar() * e.escenas.length))]}.`;
    const partes = [
        `Fotografía publicitaria profesional, con calidad de campaña de una gran cadena de supermercados, para las redes sociales de un almacén o minimarket de barrio en Chile. Formato ${f.orientacion || 'según la medida pedida'}.`,
        `Campaña: ${CAMPANAS[campana] || CAMPANAS.general}.`,
        `Estilo visual: ${e.trato}.`,
        escena,
        colores?.length ? `Paleta sugerida: ${colores.slice(0, 3).join(', ')}.` : '',
    ];
    const lado = horizontal ? 'horizontal' : 'vertical';
    const zonas = ZONAS[lado];
    if (modo === 'integrado') {
        partes.push(
            `Usa EXACTAMENTE el producto de la imagen de referencia (${lista}). Conserva el envase idéntico: misma forma, colores, logotipo, textos impresos y proporciones. No cambies, no agregues ni inventes nada del envase, su tamaño ni su contenido.`,
            'El producto es el protagonista de la escena: apoyado en una superficie acorde, con luz y sombras realistas, el fondo con desenfoque suave y, a sus costados, ingredientes o elementos que se asocien a él.',
            ENCUADRE_INTEGRADO[lado](formato === 'cuadrado' ? 'un cuarto' : 'un tercio'),
        );
    } else {
        partes.push(
            // El nombre le da a la IA de qué se trata: el fondo combina con el
            // producto aunque no lo vea (Kevin, 25-oct-2026).
            `Productos a promocionar: ${lista}. Ambienta la escena con ingredientes, acompañamientos o elementos que se asocien a estos productos y a cómo se usan o consumen, para que el fondo combine con ellos, pero NO dibujes los productos ni sus envases.`,
            varios
                ? 'Crea SOLO el fondo: superficie o ambiente suave y parejo en casi toda la imagen, con decoración solo en los bordes, porque encima se pondrán varias tarjetas de productos con sus precios.'
                : `Crea SOLO el escenario de fondo: la foto real del producto se pone después encima, en el lugar despejado. ${zonas.replace('el producto va', 'el lugar para el producto va')}`,
            'NO incluyas productos envasados, envases, marcas ni logos (los elementos de ambientación sí).',
        );
    }
    partes.push(
        'Fotorrealista y nítida, con iluminación cuidada, profundidad de campo y colores ricos: tiene que verse apetitosa, moderna y lista para publicar.',
        'NO escribas ningún texto, letra, número ni precio en la imagen.',
    );
    return partes.filter(Boolean).join(' ');
}

/** "Ajustar este fondo": un cambio sobre un fondo ya generado, sin rehacerlo. */
export function armarPromptAjuste({ cambio, integrado }) {
    return [
        `Edita esta imagen publicitaria aplicando SOLO este cambio: «${limpio(cambio, LARGO_IDEA)}».`,
        'Mantén el encuadre, la composición y los espacios libres que tiene: ahí van después el título, el producto y el precio.',
        integrado
            ? 'El producto que aparece debe quedar EXACTAMENTE igual: mismo envase, forma, colores, logotipo y textos impresos.'
            : 'NO agregues productos envasados, envases, marcas ni logos.',
        'Que siga viéndose como una fotografía publicitaria profesional, realista y nítida.',
        'NO agregues ningún texto, letra, número ni precio.',
    ].join(' ');
}

function sizeDe(formato, ancho, alto) {
    const f = FORMATOS[formato];
    if (f?.size) return f.size;
    const r = Number(ancho) / Number(alto);
    // Como el cuadrado: casi cuadrada también sale de la vertical.
    return r > 1.15 ? '1536x1024' : '1024x1536';
}

function costoEstimado(usage) {
    const det = usage?.input_tokens_details || {};
    const imagenIn = Number(det.image_tokens || 0);
    const textoIn = det.text_tokens != null ? Number(det.text_tokens) : Math.max(0, Number(usage?.input_tokens || 0) - imagenIn);
    const imagenOut = Number(usage?.output_tokens || 0);
    return (textoIn * USD_M.texto + imagenIn * USD_M.imagenEntrada + imagenOut * USD_M.imagenSalida) / 1e6;
}

// Mensaje para la persona, sin detalles internos ni la clave.
function mensajeDeError(e) {
    const status = e?.status;
    const code = String(e?.code || e?.error?.code || '');
    if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached') return 'La cuenta de IA no tiene saldo disponible. Avisale al administrador de POSVECI.';
    if (status === 429) return 'La IA está recibiendo demasiados pedidos. Probá de nuevo en un minuto.';
    if (code === 'moderation_blocked' || code === 'content_policy_violation') return 'La IA rechazó el pedido por sus reglas de contenido. Probá con otro estilo o campaña.';
    if (status === 400) return 'La IA no aceptó el pedido. Probá con otra configuración.';
    if (e?.name === 'AbortError' || /timeout|timed out/i.test(String(e?.message))) return 'La IA tardó demasiado. Probá de nuevo.';
    return 'No se pudo generar la imagen. Probá de nuevo.';
}

// ── Cada generación: reservarla, cerrarla y anotar el error ─────────────────

/**
 * Antes de llamar a la IA. `llave` (del navegador): un doble clic o un reintento
 * con la misma no genera ni cobra dos veces. Y un usuario genera de a una imagen
 * (las que quedaron colgadas más de 3 min no traban). Devuelve null para seguir,
 * o la respuesta que hay que dar sin generar.
 */
async function revisarClaveYTurno(turso, companyId, session, llave, que = 'fondo') {
    const ese = que === 'fondo' ? 'Ese fondo' : 'Esa imagen';
    if (llave) {
        const ya = await turso.execute({
            sql: 'SELECT id, status, url, mode, size, created_at FROM ad_backgrounds WHERE company_id = ? AND client_key = ? LIMIT 1',
            args: [companyId, llave],
        });
        const f = ya.rows[0];
        if (f?.status === 'lista') return { success: true, repetido: true, fondo: { id: Number(f.id), url: f.url, modo: f.mode, size: f.size } };
        const colgado = f?.status === 'pendiente' && Date.now() - new Date(f.created_at).getTime() > 180_000;
        if (f?.status === 'pendiente' && !colgado) return { success: false, error: 'GENERANDO', message: `${ese} ya se está generando.` };
        // Un intento que falló (o que quedó colgado porque la función se cortó)
        // suelta la clave: reintentar con la misma tiene que poder generar.
        if (f) {
            await turso.execute({
                sql: `UPDATE ad_backgrounds SET client_key = NULL,
                        status = CASE WHEN status = 'pendiente' THEN 'error' ELSE status END,
                        error = COALESCE(error, 'Se cortó antes de terminar')
                      WHERE id = ? AND company_id = ?`,
                args: [Number(f.id), companyId],
            });
        }
    }
    const enCurso = await turso.execute({
        sql: `SELECT COUNT(*) AS n FROM ad_backgrounds WHERE company_id = ? AND user_id = ? AND status = 'pendiente' AND created_at >= ?`,
        args: [companyId, session?.uid ?? null, new Date(Date.now() - 180_000).toISOString()],
    });
    if (Number(enCurso.rows[0]?.n) > 0) {
        return { success: false, error: 'GENERANDO', message: que === 'fondo' ? 'Ya hay un fondo generándose. Esperá a que termine.' : 'Ya hay una imagen generándose. Esperá a que termine.' };
    }
    return null;
}

/** Sube la imagen, deja la fila lista y anota el consumo. Devuelve { url, segundos }. */
async function cerrarIntento(turso, companyId, session, { id, carpeta, b64, usage, t0, costoExtra = 0 }) {
    const url = await subir(`publicidad/${companyId}/${carpeta}/${id}.webp`, Buffer.from(b64, 'base64'), 'image/webp');
    const segundos = Math.round((Date.now() - t0) / 100) / 10;
    const costo = costoEstimado(usage) + costoExtra;
    await turso.execute({
        sql: `UPDATE ad_backgrounds SET status = 'lista', url = ?, input_tokens = ?, output_tokens = ?, cost_usd = ?, seconds = ?
              WHERE id = ? AND company_id = ?`,
        args: [url, Number(usage?.input_tokens) || 0, Number(usage?.output_tokens) || 0, costo, segundos, id, companyId],
    });
    // Mismo registro de consumo que el Asistente (sin créditos: el cupo de
    // imágenes es aparte), para ver el gasto total de IA en un solo lugar.
    try {
        await turso.execute({
            sql: `INSERT INTO ai_usage (company_id, user_id, kind, credits, period, input_tokens, cached_tokens, output_tokens, cost_usd, created_at)
                  VALUES (?, ?, 'imagen', 0, ?, ?, 0, ?, ?, ?)`,
            args: [companyId, session?.uid ?? null, periodoActual(), Number(usage?.input_tokens) || 0, Number(usage?.output_tokens) || 0, costo, nowIso()],
        });
    } catch { /* el consumo es informativo: la imagen ya quedó */ }
    return { url, segundos };
}

async function anotarError(turso, companyId, id, mensaje, t0) {
    await turso.execute({
        sql: "UPDATE ad_backgrounds SET status = 'error', error = ?, seconds = ? WHERE id = ? AND company_id = ?",
        args: [mensaje, Math.round((Date.now() - t0) / 100) / 10, id, companyId],
    });
}

// ── Acciones ──────────────────────────────────────────────────────────────────

/**
 * Genera un fondo (o la escena con el producto integrado), o ajusta uno ya
 * generado (`modo: 'ajuste'`, con `baseId` y el `cambio` pedido). Una sola
 * llamada a la IA por pedido explícito del usuario, y cada una cuenta como una
 * imagen del cupo. `clave` (del navegador): un doble clic o un reintento con la
 * misma clave no genera ni cobra dos veces.
 */
export async function generarFondo(turso, openai, companyId, session, body) {
    const { formato, campana, estilo, productIds, modo = 'fondo', clave, designId = null, ancho, alto, colores, idea, baseId, cambio } = body || {};
    if (!FORMATOS[formato]) return { success: false, error: 'Formato no válido' };
    if (campana && !CAMPANAS[campana]) return { success: false, error: 'Campaña no válida' };
    if (estilo && !ESTILOS[estilo]) return { success: false, error: 'Estilo no válido' };
    if (!['fondo', 'integrado', 'ajuste'].includes(modo)) return { success: false, error: 'Modo no válido' };
    if (modo === 'ajuste' && !limpio(cambio, LARGO_IDEA)) return { success: false, error: 'Escribí qué querés cambiar del fondo' };
    if (!blobConfigurado()) return { success: false, error: 'SIN_ALMACENAMIENTO', message: 'Falta configurar el almacenamiento de imágenes (Vercel Blob).' };

    const productos = await productosDeLaEmpresa(turso, companyId, productIds);
    if (!productos.length) return { success: false, error: 'Elegí al menos un producto' };
    if (modo === 'integrado' && productos.length !== 1) return { success: false, error: 'Integrar el producto con IA es para un solo producto' };
    // La foto real se revisa antes de anotar nada: sin foto no hay nada que integrar.
    let fotoProducto = null;
    if (modo === 'integrado') {
        const foto = await turso.execute({ sql: 'SELECT image FROM products WHERE id = ? AND company_id = ?', args: [productos[0].id, companyId] });
        fotoProducto = dataUrlABuffer(foto.rows[0]?.image);
        if (!fotoProducto) return { success: false, error: 'SIN_FOTO', message: 'Ese producto no tiene foto en el inventario: no se puede integrar con IA. Usá "Fondo con IA".' };
    }
    // El ajuste parte de un fondo de ESTA empresa. Si era una escena con el
    // producto, el resultado también lo es (no se dibuja el producto dos veces).
    let base = null;
    if (modo === 'ajuste') {
        base = (await turso.execute({
            sql: "SELECT id, mode, size, url, design_id FROM ad_backgrounds WHERE id = ? AND company_id = ? AND status = 'lista' LIMIT 1",
            args: [Number(baseId) || 0, companyId],
        })).rows[0];
        if (!base?.url) return { success: false, error: 'Fondo no encontrado' };
    }
    const modoGuardado = base ? (base.mode === 'integrado' ? 'integrado' : 'fondo') : modo;

    const llave = clave ? limpio(clave, 80) : null;
    const sinGenerar = await revisarClaveYTurno(turso, companyId, session, llave, 'fondo');
    if (sinGenerar) return sinGenerar;

    // Lo que se edita (la foto del producto o el fondo a ajustar), antes de anotar
    // el intento: si el fondo no se puede leer, no se gasta nada.
    let imagenBase = fotoProducto;
    if (base) {
        imagenBase = dataUrlABuffer(await leerComoDataUrl(base.url).catch(() => null));
        if (!imagenBase) return { success: false, error: 'Fondo no encontrado', message: 'No se pudo leer ese fondo para ajustarlo. Probá con otro.' };
    }

    // Editar (integrar o ajustar) va con el modelo de edición, probado con fotos reales.
    const modelo = modo === 'fondo' ? MODELO_FONDO : MODELO_INTEGRADO;
    const size = base?.size || sizeDe(formato, ancho, alto);
    const paleta = (Array.isArray(colores) ? colores : []).filter(c => /^#[0-9a-f]{6}$/i.test(c));
    const prompt = base
        ? armarPromptAjuste({ cambio, integrado: modoGuardado === 'integrado' })
        : armarPrompt({ formato, campana, estilo, productos, modo, colores: paleta, idea, horizontal: size === '1536x1024' });
    const disenoDe = designId ? Number(designId) : (base?.design_id ? Number(base.design_id) : null);

    let fila;
    try {
        fila = await turso.execute({
            sql: `INSERT INTO ad_backgrounds (company_id, design_id, user_id, status, mode, model, size, prompt, client_key, created_at)
                  VALUES (?, ?, ?, 'pendiente', ?, ?, ?, ?, ?, ?) RETURNING id`,
            args: [companyId, disenoDe, session?.uid ?? null, modoGuardado, modelo, size, prompt, llave, nowIso()],
        });
    } catch (e) {
        if (/UNIQUE/i.test(String(e?.message))) return { success: false, error: 'GENERANDO', message: 'Ese fondo ya se está generando.' };
        throw e;
    }
    const id = Number(fila.rows[0].id);
    const t0 = Date.now();
    try {
        let r;
        if (imagenBase) {
            const img = imagenBase;
            const { toFile } = await import('openai');
            r = await openai.images.edit({
                model: modelo, prompt, size, quality: CALIDAD, n: 1, output_format: 'webp', output_compression: 80,
                image: await toFile(img.buffer, `${base ? 'fondo' : 'producto'}.${img.tipo.split('/')[1]}`, { type: img.tipo }),
            });
        } else {
            r = await openai.images.generate({ model: modelo, prompt, size, quality: CALIDAD, n: 1, output_format: 'webp', output_compression: 80 });
        }
        const b64 = r?.data?.[0]?.b64_json;
        if (!b64) throw new Error('La IA no devolvió imagen');
        const { url, segundos } = await cerrarIntento(turso, companyId, session, { id, carpeta: 'fondos', b64, usage: r.usage, t0 });
        return { success: true, fondo: { id, url, modelo, segundos, modo: modoGuardado }, dataUrl: `data:image/webp;base64,${b64}` };
    } catch (e) {
        const mensaje = mensajeDeError(e);
        console.error('[publicidad] generación falló', { id, modelo, status: e?.status, code: e?.code });
        await anotarError(turso, companyId, id, mensaje, t0);
        return { success: false, error: 'IA', message: mensaje };
    }
}

// ── Con chat ──────────────────────────────────────────────────────────────────
// Kevin, 27-oct-2026: la otra forma de crear, además de la rápida. El cliente
// escribe lo que quiere y aprieta Generar, sin conversación. Acá la IA hace la
// publicidad ENTERA, textos y precios incluidos: lo eligió Kevin sabiendo que
// puede equivocarse en una letra o un número (la pantalla avisa que se revise).
// Cada pedido siguiente cambia la imagen actual o crea otra distinta: lo decide
// un modelo de texto, que además le escribe el pedido a la IA de imágenes como
// un director de arte. Si ese modelo falla, se sigue igual con el texto del
// cliente tal cual (cambiar si hay imagen, crear si no).
export const MODELO_TEXTO = 'gpt-5.6-luna';
export const LARGO_PEDIDO = 600;
export const MAX_PRODUCTOS_CHAT = 3;
export const MAX_IMAGENES_CHAT = 2;
// Precios de gpt-5.6-luna por millón de tokens (los mismos de aiGuards.js).
const USD_M_TEXTO = { entrada: 0.20, salida: 1.20 };

// Kevin, 27-oct-2026: pasada a 1200×628, la imagen salió 1536×1024 y se vio con
// relleno difuminado a los costados. Los modelos aceptan medidas a pedido (lados
// múltiplos de 16, proporción entre 1:3 y 3:1, de 655.360 a 8,3 millones de
// píxeles): se pide la proporción exacta del formato, con los mismos píxeles que
// 1024×1536 para que el costo no cambie. El cuadrado sigue en 1024×1024.
const PIXELES_CHAT = 1024 * 1536;
const relacionIA = (r) => Math.min(3, Math.max(1 / 3, r));

/** El tamaño que se le pide a la IA: la proporción del formato (la que se pueda, entre 1:3 y 3:1). */
export function sizeChat(formato, ancho, alto) {
    const r = relacionIA(relacionDe(formato, ancho, alto));
    if (Math.abs(r - 1) < 0.03) return '1024x1024';
    const de16 = (n) => Math.round(n / 16) * 16;
    let w = de16(Math.sqrt(PIXELES_CHAT * r)), h = de16(Math.sqrt(PIXELES_CHAT / r));
    // Al redondear, el 3:1 se pasaría un poco del límite.
    while (w / h > 3) w -= 16;
    while (h / w > 3) h -= 16;
    return `${w}x${h}`;
}

/** Si dos tamaños tienen la misma proporción (a menos de 3 %): pasar de uno al otro daría la misma imagen. */
export function mismaProporcion(a, b) {
    const r = (s) => { const [w, h] = String(s || '').split('x').map(Number); return w > 0 && h > 0 ? w / h : NaN; };
    return Math.abs(r(a) / r(b) - 1) < 0.03;
}

// Ancho ÷ alto de cada formato (las mismas medidas que catalogo.js en el navegador).
const RELACION = {
    post_vertical: 1080 / 1350, historia: 1080 / 1920, cuadrado: 1, horizontal: 1200 / 628, cartel: 1240 / 1754, mayorista: 1080 / 1350,
    cartel_horizontal: 1754 / 1240, pantalla: 1920 / 1080, pantalla_vertical: 1080 / 1920,
};
function relacionDe(formato, ancho, alto) {
    if (formato !== 'personalizado') return RELACION[formato] || 0.8;
    const r = Number(ancho) / Number(alto);
    return Number.isFinite(r) && r > 0 ? r : 1;
}

/**
 * La imagen se recorta a la medida del formato: lo que quede en esa franja se
 * pierde. Se le pide a la IA que la deje sin textos ni producto (con 2 puntos
 * de margen de más).
 */
export function zonaSegura(formato, ancho, alto, size) {
    const [w, h] = size.split('x').map(Number);
    const rt = relacionDe(formato, ancho, alto), rs = w / h;
    if (Math.abs(rt - rs) / rs < 0.03) return 'Dejá un margen de respiro en los cuatro bordes: ningún texto pegado al borde.';
    if (rt > rs) {
        const pct = Math.ceil(((1 - rs / rt) / 2) * 100) + 2;
        return `La imagen se recorta después: el ${pct} % de arriba y el ${pct} % de abajo se pierden. Ahí no va ningún texto, precio ni el producto: solo fondo.`;
    }
    const pct = Math.ceil(((1 - rt / rs) / 2) * 100) + 2;
    return `La imagen se recorta después: el ${pct} % de la izquierda y el ${pct} % de la derecha se pierden. Ahí no va ningún texto, precio ni el producto: solo fondo.`;
}

const INSTRUCCIONES_CHAT = [
    'Sos el director de arte de POSVECI, un sistema para almacenes y minimarkets de barrio en Chile. Un cliente escribe qué publicidad quiere y vos le escribís el pedido a una IA que genera imágenes. No conversás con el cliente: solo devolvés el JSON.',
    'ACCION. Si hay una imagen actual y el pedido es un cambio sobre ella (colores, fondo, textos, precio, el tamaño de algo, agregar o quitar un elemento, la letra, pasarla a otro formato), es "editar". Si pide otra publicidad (otro producto, otro tema, "otra distinta", "empezá de nuevo", "haceme una de…"), es "nueva". Sin imagen actual, siempre es "nueva". Si dudás, "editar".',
    'PROMPT si es "nueva": describí la publicidad completa como un diseñador profesional de una gran cadena: composición, fondo y ambiente, iluminación, colores, tipografía (grande, gruesa, muy legible en un celular) y jerarquía (titular, producto, precio). Escribí entre comillas cada texto que tiene que aparecer en la imagen, exactamente como va.',
    'PROMPT si es "editar": una instrucción corta y precisa de qué cambiar. No describas de nuevo la publicidad.',
    'TEXTOS Y PRECIOS. Usá solo los textos y precios que dio el cliente o que vienen de los productos del inventario. Nunca inventes precios, teléfonos, direcciones, horarios, marcas ni descuentos. Si el cliente no dio precio y el producto tiene precio de oferta, usá ese; si no, el normal. Los precios van con el formato que te paso ($1.300). Respetá tildes y eñes. Pocos textos: titular, producto y precio, y como mucho una frase más.',
    'Si el pedido no es una publicidad, convertilo igual en la mejor publicidad posible para el negocio.',
].join('\n');

const ESQUEMA_CHAT = {
    type: 'object',
    additionalProperties: false,
    properties: {
        accion: { type: 'string', enum: ['editar', 'nueva'] },
        prompt: { type: 'string' },
    },
    required: ['accion', 'prompt'],
};

function dineroDe(n, moneda) {
    const m = /^[A-Z]{3}$/.test(String(moneda || '')) ? moneda : 'CLP';
    try {
        return new Intl.NumberFormat('es-CL', { style: 'currency', currency: m, maximumFractionDigits: m === 'CLP' ? 0 : 2 }).format(Number(n) || 0);
    } catch {
        return `$${Math.round(Number(n) || 0).toLocaleString('es-CL')}`;
    }
}

/** Lo que lee el director de arte: el formato, la imagen actual, los productos y el pedido. */
export function armarEntradaChat({ formato, pedido, anteriores = [], hayBase, productos = [], subidas = 0, moneda }) {
    const f = FORMATOS[formato] || FORMATOS.post_vertical;
    const lineas = [`Formato: ${f.nombre}.`];
    if (hayBase) {
        lineas.push('Imagen actual: sí.');
        const previos = anteriores.map(t => limpio(t, LARGO_PEDIDO)).filter(Boolean).slice(-4);
        if (previos.length) lineas.push(`Pedidos que la armaron, en orden: ${previos.map((t, i) => `${i + 1}) «${t}»`).join(' ')}`);
    } else {
        lineas.push('Imagen actual: no.');
    }
    if (productos.length) {
        lineas.push('Productos del inventario que agregó el cliente (con su foto real como referencia):');
        for (const p of productos) {
            const oferta = Number(p.is_offer) === 1 && Number(p.offer_price) > 0;
            lineas.push(`- ${p.name}: precio normal ${dineroDe(p.price, moneda)}${oferta ? `, precio de oferta ${dineroDe(p.offer_price, moneda)}` : ''}.`);
        }
    }
    if (subidas) lineas.push(`Imágenes que subió el cliente: ${subidas} (por ejemplo su logo o una foto, para usar en la publicidad).`);
    lineas.push(`Pedido nuevo: «${limpio(pedido, LARGO_PEDIDO)}»`);
    return lineas.join('\n');
}

// Cómo se acomoda la imagen al pasarla a otra forma.
// - Kevin, 27-oct-2026: al pasar una vertical a horizontal, la IA la dejó igual
//   con fondo a los costados y tuvo que pedir "utilizar más el ancho… el arroz
//   más grande, el precio a un lado y no rellenar de puro fondo".
// - Kevin, 28-oct-2026: un arroz solo sobre fondo blanco, pasado a 800×800, volvió
//   con granos, una cuchara y un sello "PESO NETO 1 kg." que no pidió. El pedido
//   daba por hecho que había titular y precio, y "nada de franjas de fondo vacío"
//   le hizo llenar el blanco. Pasarla es solo acomodar lo que ya tiene: sin
//   textos, el producto solo; con fondo liso, sigue liso.
const FORMAS = {
    ancho: { nombre: 'horizontal (más ancha que alta)', textos: 'el producto grande a un lado y los textos al otro, usando todo el ancho' },
    alto: { nombre: 'vertical (más alta que ancha)', textos: 'el titular arriba, el producto grande al medio y el precio abajo, usando todo el alto' },
    cuadrado: { nombre: 'cuadrada', textos: 'el producto grande y los textos bien visibles, usando todo el cuadrado' },
};
function acomodoDe(size, conCambio) {
    const [w, h] = String(size).split('x').map(Number);
    const r = w / h;
    const f = FORMAS[r > 1.15 ? 'ancho' : r < 0.87 ? 'alto' : 'cuadrado'];
    return [
        `Pasala a una imagen ${f.nombre} y acomodá lo que ya tiene a esta medida, sin agregar nada${conCambio ? ' más que el cambio pedido' : ''}: ningún elemento, adorno, sello, texto ni precio que no esté en la imagen.`,
        `Si tiene titular, precio u otros textos, reacomodalos para que se lean bien: ${f.textos}.`,
        'Si es solo un producto, agrandalo lo que permita la medida, sin cortarlo.',
        'El espacio que se gana lleva el mismo fondo: si es liso (por ejemplo blanco), sigue liso y sin adornos.',
    ].join(' ');
}

/**
 * El pedido final a la IA de imágenes: lo del director de arte más las reglas
 * que van siempre. `adaptar`: pasar la actual a otro formato, sin otro cambio.
 */
export function armarPromptChat({ accion, prompt, formato, ancho, alto, size, conProductos, subidas, cambiaFormato, adaptar }) {
    const partes = [];
    if (adaptar) {
        partes.push(
            'Esta imagen es la actual.',
            acomodoDe(size, false),
            'Todo lo demás queda igual: los mismos textos, colores, letras, estilo y fondo.',
        );
    } else if (accion === 'editar') {
        partes.push(`La primera imagen es la publicidad actual. Editala aplicando SOLO esto: ${prompt}`);
        if (cambiaFormato) partes.push('Todo lo demás queda igual: textos, precios, productos, colores y estilo.', acomodoDe(size, true));
        else partes.push('Todo lo demás queda exactamente igual: textos, precios, productos, colores y composición.');
    } else {
        partes.push(
            prompt,
            `Es una publicidad para las redes sociales o la vitrina de un almacén de barrio en Chile. Formato: ${(FORMATOS[formato] || FORMATOS.post_vertical).nombre}.`,
        );
    }
    if (conProductos) partes.push('En las imágenes de referencia de productos, usá EXACTAMENTE esos envases: misma forma, colores, logotipo y textos impresos, sin cambiarlos.');
    if (subidas) partes.push('Las imágenes que subió el cliente (logo o foto) se usan como pide el pedido, sin deformarlas.');
    // Al pasarla no hay textos entre comillas, y "colores ricos" la invita a decorar.
    partes.push(
        adaptar ? 'Los textos que ya tiene se copian exactos, letra por letra.' : 'Todos los textos van en español, escritos exactamente como están entre comillas, sin faltas de ortografía y sin agregar otros.',
        zonaSegura(formato, ancho, alto, size),
        adaptar ? 'La misma nitidez y calidad que la actual.' : 'Calidad de agencia: nítida, colores ricos, tipografía profesional y muy legible.',
    );
    return partes.join(' ');
}

/**
 * Una publicidad hecha con chat, o un cambio sobre la actual (`baseId`).
 * `productIds` (hasta 3): sus fotos van de referencia y su nombre y precio
 * exactos al director de arte. `imagenes` (hasta 2, data URL): lo que subió el
 * cliente. Cuenta como una imagen del cupo, igual que un fondo.
 *
 * `adaptar: true` pasa la imagen actual al formato elegido, sin escribir nada
 * (Kevin, 27-oct-2026): no hay pedido que interpretar, así que no pasa por el
 * director de arte. Solo cuando la imagen tiene otra proporción que el formato:
 * con la misma, la IA haría la misma imagen.
 */
export async function generarChat(turso, openai, companyId, session, body) {
    const { formato, pedido, anteriores, productIds, imagenes, baseId, clave, designId = null, ancho, alto, moneda } = body || {};
    const adaptar = body?.adaptar === true;
    if (!FORMATOS[formato]) return { success: false, error: 'Formato no válido' };
    const texto = limpio(pedido, LARGO_PEDIDO) || (adaptar ? `Pasarla a ${FORMATOS[formato].nombre}` : '');
    if (!texto) return { success: false, error: 'Escribí qué publicidad querés' };
    if (adaptar && !baseId) return { success: false, error: 'Falta la imagen que se pasa al otro formato' };
    if (!blobConfigurado()) return { success: false, error: 'SIN_ALMACENAMIENTO', message: 'Falta configurar el almacenamiento de imágenes (Vercel Blob).' };

    const ids = adaptar ? [] : (Array.isArray(productIds) ? productIds : []).slice(0, MAX_PRODUCTOS_CHAT);
    const productos = await productosDeLaEmpresa(turso, companyId, ids);
    if (productos.length !== new Set(ids.map(Number)).size) return { success: false, error: 'Hay productos que no son de esta empresa o ya no existen' };
    const lista = adaptar ? [] : Array.isArray(imagenes) ? imagenes : [];
    if (lista.length > MAX_IMAGENES_CHAT) return { success: false, error: `Se pueden subir hasta ${MAX_IMAGENES_CHAT} imágenes` };
    const subidas = lista.map(dataUrlABuffer);
    if (subidas.some(s => !s || s.buffer.length > 2_000_000)) return { success: false, error: 'Las imágenes tienen que ser JPG, PNG o WebP de hasta 2 MB' };

    // Las fotos de los productos y la imagen actual, antes de anotar nada: si no
    // se pueden leer, no se gasta.
    const fotos = [];
    if (productos.length) {
        const r = await turso.execute({
            sql: `SELECT id, image FROM products WHERE company_id = ? AND id IN (${productos.map(() => '?').join(',')})`,
            args: [companyId, ...productos.map(p => p.id)],
        });
        for (const f of r.rows) { const b = dataUrlABuffer(f.image); if (b) fotos.push(b); }
    }
    let base = null, imagenBase = null;
    if (baseId) {
        base = (await turso.execute({
            sql: "SELECT id, mode, size, url, design_id FROM ad_backgrounds WHERE id = ? AND company_id = ? AND status = 'lista' LIMIT 1",
            args: [Number(baseId) || 0, companyId],
        })).rows[0];
        if (!base?.url) return { success: false, error: 'Imagen no encontrada' };
    }
    const size = sizeChat(formato, ancho, alto);
    if (adaptar && mismaProporcion(base.size, size)) return { success: false, error: 'MISMA_FORMA', message: 'Esta imagen ya tiene la medida de este formato: no hace falta pasarla.' };
    if (base) {
        imagenBase = dataUrlABuffer(await leerComoDataUrl(base.url).catch(() => null));
        if (!imagenBase) return { success: false, error: 'Imagen no encontrada', message: 'No se pudo leer la imagen actual. Elegí otra versión o empezá una nueva.' };
    }

    const llave = clave ? limpio(clave, 80) : null;
    const sinGenerar = await revisarClaveYTurno(turso, companyId, session, llave, 'imagen');
    if (sinGenerar) return sinGenerar;

    const disenoDe = designId ? Number(designId) : (base?.design_id ? Number(base.design_id) : null);
    let fila;
    try {
        fila = await turso.execute({
            sql: `INSERT INTO ad_backgrounds (company_id, design_id, user_id, status, mode, model, size, prompt, client_key, created_at)
                  VALUES (?, ?, ?, 'pendiente', 'chat', ?, ?, ?, ?, ?) RETURNING id`,
            args: [companyId, disenoDe, session?.uid ?? null, MODELO_INTEGRADO, size, texto, llave, nowIso()],
        });
    } catch (e) {
        if (/UNIQUE/i.test(String(e?.message))) return { success: false, error: 'GENERANDO', message: 'Esa imagen ya se está generando.' };
        throw e;
    }
    const id = Number(fila.rows[0].id);
    const t0 = Date.now();

    // 1) El director de arte decide si cambia la actual o crea otra, y escribe el pedido.
    let accion = base ? 'editar' : 'nueva';
    let promptDirector = `«${texto}»`;
    let costoTexto = 0;
    if (!adaptar) {
        try {
            const r = await openai.responses.create({
                model: MODELO_TEXTO,
                instructions: INSTRUCCIONES_CHAT,
                input: armarEntradaChat({ formato, pedido: texto, anteriores: Array.isArray(anteriores) ? anteriores : [], hayBase: !!base, productos, subidas: subidas.length, moneda }),
                text: { format: { type: 'json_schema', name: 'publicidad', schema: ESQUEMA_CHAT, strict: true } },
            }, { timeout: 15_000 });
            costoTexto = ((Number(r.usage?.input_tokens) || 0) * USD_M_TEXTO.entrada + (Number(r.usage?.output_tokens) || 0) * USD_M_TEXTO.salida) / 1e6;
            const salida = JSON.parse(r.output_text || '{}');
            if (base && salida.accion === 'nueva') accion = 'nueva';
            if (limpio(salida.prompt, 4000)) promptDirector = limpio(salida.prompt, 4000);
        } catch (e) {
            console.warn('[publicidad] director de arte falló, sigue con el pedido tal cual', { status: e?.status, code: e?.code });
        }
    }

    // 2) La imagen. Editar parte de la actual; las fotos de los productos y lo
    //    que subió el cliente van de referencia.
    const referencias = [...(accion === 'editar' ? [imagenBase] : []), ...fotos, ...subidas];
    const prompt = armarPromptChat({
        accion, prompt: promptDirector, formato, ancho, alto, size, adaptar,
        conProductos: fotos.length > 0, subidas: subidas.length, cambiaFormato: accion === 'editar' && !mismaProporcion(base.size, size),
    });
    const modelo = referencias.length ? MODELO_INTEGRADO : MODELO_FONDO;
    try {
        // Lo que queda de los 60 s de la función, con 5 de margen para guardar.
        const opciones = { timeout: Math.max(20_000, 55_000 - (Date.now() - t0)) };
        let r;
        if (referencias.length) {
            const { toFile } = await import('openai');
            const archivos = await Promise.all(referencias.map((img, i) => toFile(img.buffer, `ref${i}.${img.tipo.split('/')[1]}`, { type: img.tipo })));
            r = await openai.images.edit({
                model: modelo, prompt, size, quality: CALIDAD, n: 1, output_format: 'webp', output_compression: 80,
                image: archivos.length === 1 ? archivos[0] : archivos,
            }, opciones);
        } else {
            r = await openai.images.generate({ model: modelo, prompt, size, quality: CALIDAD, n: 1, output_format: 'webp', output_compression: 80 }, opciones);
        }
        const b64 = r?.data?.[0]?.b64_json;
        if (!b64) throw new Error('La IA no devolvió imagen');
        await turso.execute({ sql: 'UPDATE ad_backgrounds SET model = ?, prompt = ? WHERE id = ? AND company_id = ?', args: [modelo, prompt, id, companyId] });
        const { url, segundos } = await cerrarIntento(turso, companyId, session, { id, carpeta: 'chat', b64, usage: r.usage, t0, costoExtra: costoTexto });
        return { success: true, accion, fondo: { id, url, modelo, segundos, modo: 'chat', size }, dataUrl: `data:image/webp;base64,${b64}` };
    } catch (e) {
        const mensaje = mensajeDeError(e);
        console.error('[publicidad] chat falló', { id, modelo, status: e?.status, code: e?.code });
        await anotarError(turso, companyId, id, mensaje, t0);
        return { success: false, error: 'IA', message: mensaje };
    }
}

// ── Recortar un producto ──────────────────────────────────────────────────────
// Kevin, 30-oct-2026: en Publicidad, la foto de un producto (sacada con el celular
// o la que ya tiene en el inventario) recortada por la IA sobre fondo blanco, para
// guardarla en el Historial o ponérsela a un producto que no tiene foto. La IA
// vuelve a dibujar el producto: puede cambiar una letra de la etiqueta, y por eso
// la pantalla pide revisarla antes de ponérsela. Cuenta como una imagen del cupo.
export const LARGO_NOTA_RECORTE = 150;
export const SIZE_RECORTE = '1024x1024';

/** El pedido a la IA. `nota`: lo que escribió el usuario (por ejemplo cuál de los productos dejar). */
export function armarPromptRecorte(nota) {
    const indicacion = limpio(nota, LARGO_NOTA_RECORTE);
    return [
        'Foto de catálogo para una tienda online: el mismo producto de esta imagen, solo, sobre un fondo blanco puro (#FFFFFF), liso y parejo de borde a borde, sin sombra, sin piso, sin reflejos ni degradé.',
        'Conservá el producto EXACTAMENTE igual: misma forma, colores, logotipo, textos impresos, números y proporciones. No lo cambies, no inventes nada del envase y no corrijas su etiqueta.',
        indicacion ? `Indicación del negocio: «${indicacion}».` : 'Si en la foto hay varios productos, dejá solo el principal: el más grande y más al centro.',
        'Sacá todo lo que no es el producto: la mano, la mesa, la estantería, otros productos, carteles de precio y el fondo.',
        'El producto va entero, derecho y centrado, grande: ocupa cerca del 85 % del alto o del ancho de la imagen, con un margen blanco parejo alrededor.',
        'Luz de estudio suave y pareja, nítido.',
        'No agregues textos, sellos, adornos ni nada que no esté en el producto.',
    ].join(' ');
}

/**
 * Recorta un producto con la IA. La foto llega como `foto` (data URL, sacada o
 * subida) o se lee del inventario con `productId` (la del producto, de ESTA
 * empresa). `clave`: un reintento con la misma no genera ni cobra dos veces.
 */
export async function generarRecorte(turso, openai, companyId, session, body) {
    const { foto, productId, nota, clave } = body || {};
    if (!blobConfigurado()) return { success: false, error: 'SIN_ALMACENAMIENTO', message: 'Falta configurar el almacenamiento de imágenes (Vercel Blob).' };
    let original = null;
    if (foto) {
        original = dataUrlABuffer(foto);
        if (!original || original.buffer.length > 3_000_000) return { success: false, error: 'La foto tiene que ser JPG, PNG o WebP de hasta 3 MB' };
    } else if (productId) {
        const f = (await turso.execute({ sql: 'SELECT image FROM products WHERE id = ? AND company_id = ?', args: [Number(productId) || 0, companyId] })).rows[0];
        if (!f) return { success: false, error: 'Producto no encontrado' };
        original = dataUrlABuffer(f.image);
        if (!original) return { success: false, error: 'SIN_FOTO', message: 'Ese producto no tiene foto en el inventario: sacale una con «Tomar foto».' };
    } else {
        return { success: false, error: 'Sacá o subí una foto del producto' };
    }

    const llave = clave ? limpio(clave, 80) : null;
    const sinGenerar = await revisarClaveYTurno(turso, companyId, session, llave, 'imagen');
    if (sinGenerar) return sinGenerar;

    const prompt = armarPromptRecorte(nota);
    let fila;
    try {
        fila = await turso.execute({
            sql: `INSERT INTO ad_backgrounds (company_id, design_id, user_id, status, mode, model, size, prompt, client_key, created_at)
                  VALUES (?, NULL, ?, 'pendiente', 'recorte', ?, ?, ?, ?, ?) RETURNING id`,
            args: [companyId, session?.uid ?? null, MODELO_INTEGRADO, SIZE_RECORTE, prompt, llave, nowIso()],
        });
    } catch (e) {
        if (/UNIQUE/i.test(String(e?.message))) return { success: false, error: 'GENERANDO', message: 'Esa imagen ya se está generando.' };
        throw e;
    }
    const id = Number(fila.rows[0].id);
    const t0 = Date.now();
    try {
        const { toFile } = await import('openai');
        const r = await openai.images.edit({
            model: MODELO_INTEGRADO, prompt, size: SIZE_RECORTE, quality: CALIDAD, n: 1, output_format: 'webp', output_compression: 90,
            image: await toFile(original.buffer, `producto.${original.tipo.split('/')[1]}`, { type: original.tipo }),
        });
        const b64 = r?.data?.[0]?.b64_json;
        if (!b64) throw new Error('La IA no devolvió imagen');
        const { url, segundos } = await cerrarIntento(turso, companyId, session, { id, carpeta: 'recortes', b64, usage: r.usage, t0 });
        return { success: true, fondo: { id, url, modelo: MODELO_INTEGRADO, segundos, modo: 'recorte', size: SIZE_RECORTE }, dataUrl: `data:image/webp;base64,${b64}` };
    } catch (e) {
        const mensaje = mensajeDeError(e);
        console.error('[publicidad] recorte falló', { id, status: e?.status, code: e?.code });
        await anotarError(turso, companyId, id, mensaje, t0);
        return { success: false, error: 'IA', message: mensaje };
    }
}

// A la tienda online (MiniVeci) va SOLO la foto, por el mismo camino que usa la
// ficha del producto cuando se le cambia la foto: { id, sku, image } (Kevin,
// 30-oct-2026: "mandar actualizar la página de MiniVeci, solo la imagen").
// Se espera hasta 8 s; si tarda más, el envío sigue solo y queda en el log de la
// integración. Inyectable para las pruebas.
let _sincronizarTienda = syncProductToStore;
let _topeTiendaMs = 8000;
export function __probarConTienda(falso, ms = 8000) { _sincronizarTienda = falso || syncProductToStore; _topeTiendaMs = ms; }

/**
 * Le pone a un producto de ESTA empresa la foto recortada (`foto`: JPEG ya
 * achicado por el navegador, como la ficha del producto). `fondoId` (el recorte)
 * queda anotado en el registro de cambios.
 */
export async function asignarFotoProducto(turso, companyId, session, { productId, foto, fondoId } = {}) {
    const img = dataUrlABuffer(foto);
    if (!img || img.buffer.length > 400_000) return { success: false, error: 'La foto no es válida' };
    const p = (await turso.execute({
        sql: `SELECT id, name, sku, CASE WHEN image IS NOT NULL AND image != '' THEN 1 ELSE 0 END AS tenia
              FROM products WHERE id = ? AND company_id = ?`,
        args: [Number(productId) || 0, companyId],
    })).rows[0];
    if (!p) return { success: false, error: 'Producto no encontrado' };
    const imagen = `data:${img.tipo};base64,${img.buffer.toString('base64')}`;
    // updated_at: así los otros equipos vuelven a bajar el producto y ven que ya tiene foto.
    await turso.execute({
        sql: 'UPDATE products SET image = ?, updated_at = ? WHERE id = ? AND company_id = ?',
        args: [imagen, nowIso(), Number(p.id), companyId],
    });
    const reemplazo = Number(p.tenia) === 1;
    await turso.execute({
        sql: 'INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        args: [companyId, session?.uid ?? null, 'UPDATE', 'PRODUCT', JSON.stringify({
            id: Number(p.id), campos: ['image'], origen: 'publicidad_recorte', recorte: Number(fondoId) || null, reemplazo,
        }), nowIso()],
    });

    // Sin código no hay cómo encontrarlo en la tienda (lo mismo que hace la ficha).
    let tienda = 'sin_codigo';
    if (String(p.sku ?? '').trim()) {
        let timer;
        const tope = new Promise(resolve => { timer = setTimeout(() => resolve({ success: false, timeout: true }), _topeTiendaMs); });
        const r = await Promise.race([
            _sincronizarTienda({ companyId, product: { id: Number(p.id), sku: p.sku, image: imagen } }).catch(e => ({ success: false, error: e?.message })),
            tope,
        ]).finally(() => clearTimeout(timer));
        tienda = r?.success ? 'ok' : r?.timeout ? 'enviando' : /no configurada|inactiva/i.test(String(r?.error)) ? 'sin_tienda' : 'error';
    }
    return { success: true, producto: { id: Number(p.id), nombre: p.name }, reemplazo, tienda };
}

/**
 * El nombre para una publicidad nueva. Kevin, 27-oct-2026: cada guardado es otra
 * publicidad, y si el nombre ya está se numera: "OFERTA DEL DÍA", "OFERTA DEL
 * DÍA #2", "#3"… Una abierta del Historial ("OFERTA DEL DÍA #2") y guardada con
 * cambios sigue la cuenta de su nombre base. Un nombre que no está queda tal cual.
 */
export async function tituloLibre(turso, companyId, titulo) {
    if (!titulo) return titulo;
    const base = titulo.replace(/\s+#\d+$/, '').trim() || titulo;
    const escapado = base.replace(/[\\%_]/g, c => `\\${c}`);
    const r = await turso.execute({
        sql: "SELECT title FROM ad_designs WHERE company_id = ? AND (title = ? OR title = ? OR title LIKE ? ESCAPE '\\')",
        args: [companyId, titulo, base, `${escapado} #%`],
    });
    const usados = r.rows.map(x => String(x.title));
    if (!usados.includes(titulo)) return titulo;
    let mayor = 1;
    for (const t of usados) {
        const n = t.startsWith(`${base} #`) ? t.slice(base.length + 2) : '';
        if (/^\d+$/.test(n)) mayor = Math.max(mayor, Number(n));
    }
    const sufijo = ` #${mayor + 1}`;
    return `${base.slice(0, 120 - sufijo.length)}${sufijo}`;
}

// Las imágenes que el cliente agrega encima de la publicidad (Kevin, 29-oct-2026:
// "que entre como un elemento recortando el fondo blanco… poner logos o más
// cosas"). No son productos: no llevan nombre ni precio, y se mueven y agrandan
// como los textos. Su id viene del navegador y solo las distingue en el diseño.
export const MAX_IMAGENES = 4;
const ID_IMAGEN = /^img-[a-z0-9-]{1,40}$/;

/** Las URLs de las imágenes agregadas de una publicidad guardada (en su `layout`). */
function urlsDeImagenes(layoutJson) {
    try {
        const lista = JSON.parse(layoutJson || '{}').imagenes;
        return Array.isArray(lista) ? lista.map(im => im?.fotoUrl).filter(u => typeof u === 'string') : [];
    } catch { return []; }
}

/**
 * Guarda (crea o actualiza) una publicidad. Los productos se leen de la base de
 * ESTA empresa: el nombre, la unidad y el precio normal son los del inventario en
 * este momento; el precio de la publicidad es el que eligió el usuario, y queda
 * como copia (si el producto cambia de precio, la publicidad no cambia).
 *
 * `imagenes` (hasta MAX_IMAGENES): las agregadas como complemento, cada una con
 * su `foto` nueva (data URL) o la `fotoUrl` que ya tenía guardada. Quedan en
 * `layout.imagenes`; su lugar y tamaño, en `layout.mover` como los textos.
 *
 * La pantalla manda `id` solo si no cambió nada desde que se guardó o se abrió
 * (pasar de borrador a final, o cambiarle solo el nombre); con cambios manda
 * null y queda otra publicidad. Al actualizar sin nombre se conserva el que
 * tenía (que puede estar numerado).
 */
export async function guardarDiseno(turso, companyId, session, body) {
    const { id = null, title, status = 'borrador', formato, campana = null, estilo = null, productos = [], imagenes = [], textos = {}, layout = {}, backgroundId = null, finalJpeg = null, miniatura = null } = body || {};
    if (!FORMATOS[formato]) return { success: false, error: 'Formato no válido' };
    if (campana && !CAMPANAS[campana]) return { success: false, error: 'Campaña no válida' };
    if (estilo && !ESTILOS[estilo]) return { success: false, error: 'Estilo no válido' };
    if (!['borrador', 'final'].includes(status)) return { success: false, error: 'Estado no válido' };
    if (!Array.isArray(imagenes) || imagenes.length > MAX_IMAGENES) return { success: false, error: `Se pueden agregar hasta ${MAX_IMAGENES} imágenes` };
    if (imagenes.some(im => !ID_IMAGEN.test(String(im?.id))) || new Set(imagenes.map(im => im.id)).size !== imagenes.length) return { success: false, error: 'Imagen no válida' };
    // Una hecha con chat puede no tener productos del inventario: la describió el
    // cliente. Una rápida puede ser solo imágenes y textos (un logo y un aviso), y
    // un recorte es solo la foto del producto.
    const conChat = layout?.modo === 'chat';
    const recorte = layout?.modo === 'recorte';
    if (!Array.isArray(productos) || (!productos.length && !conChat && !recorte && !imagenes.length)) return { success: false, error: 'La publicidad no tiene productos' };
    if (productos.length > 12) return { success: false, error: 'Demasiados productos para una publicidad' };
    // Cortar el JSON lo dejaría ilegible: si no entra, se rechaza. Las imágenes
    // las anota el servidor, ya validadas.
    const resto = { ...(layout && typeof layout === 'object' ? layout : {}) };
    delete resto.imagenes;
    if (JSON.stringify(resto).length > 20000) return { success: false, error: 'El diseño trae demasiados datos' };
    const thumb = typeof miniatura === 'string' && /^data:image\/(?:jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/.test(miniatura) && miniatura.length <= 80_000 ? miniatura : null;
    if ((finalJpeg || productos.some(p => p?.fotoPropia) || imagenes.some(im => im?.foto)) && !blobConfigurado()) {
        return { success: false, error: 'SIN_ALMACENAMIENTO', message: 'Falta configurar el almacenamiento de imágenes (Vercel Blob).' };
    }

    const delInventario = new Map((await productosDeLaEmpresa(turso, companyId, productos.map(p => p?.productId))).map(p => [Number(p.id), p]));
    const faltan = productos.filter(p => !delInventario.has(Number(p?.productId)));
    if (faltan.length) return { success: false, error: 'Hay productos que no son de esta empresa o ya no existen' };
    // Una imagen ya guardada vuelve solo como la URL que tenía en una publicidad de
    // ESTA empresa (la misma, o la original de una copia).
    for (const im of imagenes) {
        if (im.foto || !im.fotoUrl) continue;
        const usada = await turso.execute({
            sql: 'SELECT 1 FROM ad_designs WHERE company_id = ? AND instr(layout, ?) > 0 LIMIT 1',
            args: [companyId, JSON.stringify(String(im.fotoUrl)).slice(1, -1)],
        });
        if (!usada.rows[0]) return { success: false, error: 'Imagen no encontrada' };
    }

    let anterior = null;
    if (id) {
        anterior = (await turso.execute({ sql: 'SELECT * FROM ad_designs WHERE id = ? AND company_id = ?', args: [Number(id), companyId] })).rows[0];
        if (!anterior) return { success: false, error: 'Publicidad no encontrada' };
    }
    if (backgroundId) {
        const fb = await turso.execute({ sql: "SELECT id FROM ad_backgrounds WHERE id = ? AND company_id = ? AND status = 'lista'", args: [Number(backgroundId), companyId] });
        if (!fb.rows[0]) return { success: false, error: 'Fondo no encontrado' };
    }

    // Copia de cada producto, emparejada por su id (nunca por posición).
    const urlsNuevas = [];
    const copia = [];
    for (const p of productos) {
        const inv = delInventario.get(Number(p.productId));
        const precio = Math.round(Number(p.precioPublicidad));
        if (!(precio >= 0) || precio > 1e9) return { success: false, error: `Precio no válido para ${inv.name}` };
        let presentacion = null;
        if (p.presentacionId) {
            const pr = await turso.execute({
                sql: 'SELECT id, name, units, price FROM product_presentations WHERE id = ? AND product_id = ? AND company_id = ?',
                args: [Number(p.presentacionId), inv.id, companyId],
            });
            const f = pr.rows[0];
            if (f) presentacion = { id: Number(f.id), nombre: f.name, unidades: Number(f.units), precio: Number(f.price) };
        }
        let fotoUrl = typeof p.fotoUrl === 'string' && p.fotoUrl.startsWith('http') ? p.fotoUrl : null;
        if (p.fotoPropia) {
            const img = dataUrlABuffer(p.fotoPropia);
            if (!img || img.buffer.length > 3_000_000) return { success: false, error: `La foto subida para ${inv.name} no es válida (JPG, PNG o WebP de hasta 3 MB)` };
            fotoUrl = await subir(`publicidad/${companyId}/fotos/${inv.id}.${img.tipo.split('/')[1]}`, img.buffer, img.tipo);
            urlsNuevas.push(fotoUrl);
        }
        copia.push({
            productId: Number(inv.id),
            nombre: inv.name,
            categoria: inv.category || null,
            unidad: inv.unit || 'Und',
            precioNormal: Number(inv.price) || 0,
            precioOferta: Number(inv.is_offer) === 1 && Number(inv.offer_price) > 0 ? Number(inv.offer_price) : null,
            precioPublicidad: precio,
            etiqueta: limpio(p.etiqueta, 30) || null,
            nombreVisible: limpio(p.nombreVisible, 80) || null,
            presentacion,
            fotoUrl,
        });
    }

    const agregadas = [];
    for (const im of imagenes) {
        let fotoUrl = im.foto ? null : String(im.fotoUrl || '') || null;
        if (im.foto) {
            const img = dataUrlABuffer(im.foto);
            if (!img || img.buffer.length > 3_000_000) return { success: false, error: 'Una de las imágenes agregadas no es válida (JPG, PNG o WebP de hasta 3 MB)' };
            fotoUrl = await subir(`publicidad/${companyId}/imagenes/${im.id}.${img.tipo.split('/')[1]}`, img.buffer, img.tipo);
            urlsNuevas.push(fotoUrl);
        }
        if (fotoUrl) agregadas.push({ id: im.id, fotoUrl, quitarFondo: im.quitarFondo !== false });
    }
    const layoutJson = JSON.stringify(agregadas.length ? { ...resto, imagenes: agregadas } : resto);

    let finalUrl = anterior?.final_url || null;
    if (finalJpeg) {
        const img = dataUrlABuffer(finalJpeg);
        if (!img || img.buffer.length > 3_500_000) return { success: false, error: 'La imagen final no es válida' };
        finalUrl = await subir(`publicidad/${companyId}/finales/${id || 'nuevo'}.${img.tipo === 'image/png' ? 'png' : 'jpg'}`, img.buffer, img.tipo);
        urlsNuevas.push(finalUrl);
    }

    const t = {
        titulo: limpio(textos.titulo, 120), mensaje: limpio(textos.mensaje, 300), extra: limpio(textos.extra, 200),
        mostrarNegocio: textos.mostrarNegocio !== false,
    };
    const ahora = nowIso();
    const elegido = limpio(title, 120) || anterior?.title || t.titulo || copia.map(c => c.nombre).join(', ').slice(0, 120)
        || (conChat ? 'Publicidad con chat' : recorte ? 'Foto recortada' : '');
    const titulo = anterior ? elegido : await tituloLibre(turso, companyId, elegido);
    const datos = [titulo, status, formato, campana, estilo, JSON.stringify(copia), JSON.stringify(t), layoutJson, backgroundId ? Number(backgroundId) : null, finalUrl, thumb ?? anterior?.thumb ?? null];
    let disenoId;
    if (anterior) {
        await turso.execute({
            sql: `UPDATE ad_designs SET title = ?, status = ?, format = ?, campaign = ?, style = ?, products = ?, texts = ?, layout = ?,
                    background_id = ?, final_url = ?, thumb = ?, updated_at = ? WHERE id = ? AND company_id = ?`,
            args: [...datos, ahora, anterior.id, companyId],
        });
        disenoId = Number(anterior.id);
        // Lo que se reemplazó ya no lo usa nadie.
        const viejas = [];
        if (finalJpeg && anterior.final_url && anterior.final_url !== finalUrl) viejas.push(anterior.final_url);
        try {
            const antes = JSON.parse(anterior.products || '[]').map(x => x.fotoUrl).filter(Boolean);
            const ahoraUsadas = new Set(copia.map(c => c.fotoUrl).filter(Boolean));
            viejas.push(...antes.filter(u => !ahoraUsadas.has(u)));
        } catch { /* sin fotos propias */ }
        // Las imágenes agregadas que ya no están, si no las usa una copia.
        const siguen = new Set(agregadas.map(im => im.fotoUrl));
        for (const u of urlsDeImagenes(anterior.layout).filter(x => !siguen.has(x))) {
            const enOtra = await turso.execute({
                sql: 'SELECT 1 FROM ad_designs WHERE company_id = ? AND id != ? AND instr(layout, ?) > 0 LIMIT 1',
                args: [companyId, Number(anterior.id), JSON.stringify(u).slice(1, -1)],
            });
            if (!enOtra.rows[0]) viejas.push(u);
        }
        await borrarBlobs(viejas);
    } else {
        const r = await turso.execute({
            sql: `INSERT INTO ad_designs (company_id, user_id, title, status, format, campaign, style, products, texts, layout, background_id, final_url, thumb, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
            args: [companyId, session?.uid ?? null, ...datos, ahora, ahora],
        });
        disenoId = Number(r.rows[0].id);
    }
    if (backgroundId) {
        await turso.execute({ sql: 'UPDATE ad_backgrounds SET design_id = ? WHERE id = ? AND company_id = ? AND design_id IS NULL', args: [disenoId, Number(backgroundId), companyId] });
    }
    // Las versiones anteriores del chat quedan de esta publicidad: se borran con ella.
    const versiones = conChat && Array.isArray(layout.mensajes)
        ? [...new Set(layout.mensajes.map(m => Number(m?.fondoId)).filter(n => Number.isInteger(n) && n > 0))].slice(0, 50) : [];
    if (versiones.length) {
        await turso.execute({
            sql: `UPDATE ad_backgrounds SET design_id = ? WHERE company_id = ? AND mode = 'chat' AND design_id IS NULL AND id IN (${versiones.map(() => '?').join(',')})`,
            args: [disenoId, companyId, ...versiones],
        });
    }
    return { success: true, id: disenoId, title: titulo, nuevo: !anterior, productos: copia, imagenes: agregadas, finalUrl };
}

export async function listarDisenos(turso, companyId, { limit = 30, offset = 0 } = {}) {
    const lim = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100);
    const off = Math.max(parseInt(offset, 10) || 0, 0);
    const r = await turso.execute({
        sql: `SELECT d.id, d.title, d.status, d.format, d.campaign, d.style, d.products, d.final_url, d.thumb, d.parent_id,
                     d.created_at, d.updated_at, u.name AS usuario, json_extract(d.layout, '$.modo') AS modo
              FROM ad_designs d LEFT JOIN users u ON u.id = d.user_id
              WHERE d.company_id = ? ORDER BY d.updated_at DESC LIMIT ? OFFSET ?`,
        args: [companyId, lim, off],
    });
    return {
        success: true,
        disenos: r.rows.map(d => {
            let productos = [];
            try { productos = JSON.parse(d.products || '[]'); } catch { productos = []; }
            return {
                id: Number(d.id), title: d.title, status: d.status, format: d.format, campaign: d.campaign, style: d.style,
                productos: productos.map(p => ({ productId: p.productId, nombre: p.nombre, precioPublicidad: p.precioPublicidad })),
                tieneFinal: !!d.final_url, finalUrl: d.final_url, miniatura: d.thumb || null, parentId: d.parent_id ? Number(d.parent_id) : null,
                usuario: d.usuario || null, createdAt: d.created_at, updatedAt: d.updated_at, conChat: d.modo === 'chat', recorte: d.modo === 'recorte',
            };
        }),
    };
}

export async function obtenerDiseno(turso, companyId, { id }) {
    const d = (await turso.execute({ sql: 'SELECT * FROM ad_designs WHERE id = ? AND company_id = ?', args: [Number(id), companyId] })).rows[0];
    if (!d) return { success: false, error: 'Publicidad no encontrada' };
    const fondos = await turso.execute({
        sql: `SELECT id, mode, model, url, seconds, cost_usd, created_at FROM ad_backgrounds
              WHERE company_id = ? AND (design_id = ? OR id = ?) AND status = 'lista' ORDER BY id DESC LIMIT 20`,
        args: [companyId, Number(d.id), d.background_id ? Number(d.background_id) : -1],
    });
    const json = (v, def) => { try { return JSON.parse(v || ''); } catch { return def; } };
    return {
        success: true,
        diseno: {
            id: Number(d.id), title: d.title, status: d.status, format: d.format, campaign: d.campaign, style: d.style,
            productos: json(d.products, []), textos: json(d.texts, {}), layout: json(d.layout, {}),
            backgroundId: d.background_id ? Number(d.background_id) : null, finalUrl: d.final_url,
            parentId: d.parent_id ? Number(d.parent_id) : null, createdAt: d.created_at, updatedAt: d.updated_at,
        },
        fondos: fondos.rows.map(f => ({ id: Number(f.id), modo: f.mode, modelo: f.model, url: f.url, segundos: f.seconds, costoUsd: f.cost_usd, createdAt: f.created_at })),
    };
}

/** Copia una publicidad como borrador nuevo (para actualizar precios sin tocar la original). */
export async function duplicarDiseno(turso, companyId, session, { id }) {
    const d = (await turso.execute({ sql: 'SELECT * FROM ad_designs WHERE id = ? AND company_id = ?', args: [Number(id), companyId] })).rows[0];
    if (!d) return { success: false, error: 'Publicidad no encontrada' };
    const ahora = nowIso();
    // Numerada como cualquier otra con el mismo nombre ("OFERTA DEL DÍA #2"), no "(copia)".
    const titulo = await tituloLibre(turso, companyId, d.title || 'Publicidad');
    const r = await turso.execute({
        sql: `INSERT INTO ad_designs (company_id, user_id, title, status, format, campaign, style, products, texts, layout, background_id, final_url, thumb, parent_id, created_at, updated_at)
              VALUES (?, ?, ?, 'borrador', ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?) RETURNING id`,
        args: [companyId, session?.uid ?? null, titulo, d.format, d.campaign, d.style,
            d.products, d.texts, d.layout, d.background_id, d.thumb || null, Number(d.id), ahora, ahora],
    });
    return { success: true, id: Number(r.rows[0].id) };
}

export async function eliminarDiseno(turso, companyId, { id }) {
    const d = (await turso.execute({ sql: 'SELECT * FROM ad_designs WHERE id = ? AND company_id = ?', args: [Number(id), companyId] })).rows[0];
    if (!d) return { success: false, error: 'Publicidad no encontrada' };
    const urls = [d.final_url, ...urlsDeImagenes(d.layout)];
    try { urls.push(...JSON.parse(d.products || '[]').map(p => p.fotoUrl)); } catch { /* sin fotos */ }
    // Los fondos que solo usaba esta publicidad: una copia puede compartir el
    // suyo, y una del chat guardada en otro formato, sus versiones anteriores.
    // Los compartidos pasan a la otra, así se borran cuando se borre esa.
    const fondos = await turso.execute({ sql: 'SELECT id, url FROM ad_backgrounds WHERE company_id = ? AND design_id = ?', args: [companyId, Number(d.id)] });
    // Las fotos subidas pueden estar en una copia: solo se borran si nadie más las usa.
    const otras = await turso.execute({ sql: 'SELECT id, products, final_url, background_id, layout FROM ad_designs WHERE company_id = ? AND id != ?', args: [companyId, Number(d.id)] });
    const otraQueLoUsa = new Map(); // id del fondo → id de otra publicidad que lo usa
    const usadasPorOtras = new Set();
    for (const o of otras.rows) {
        const usa = (fondoId) => { if (fondoId && !otraQueLoUsa.has(Number(fondoId))) otraQueLoUsa.set(Number(fondoId), Number(o.id)); };
        usa(o.background_id);
        try { for (const m of JSON.parse(o.layout || '{}').mensajes || []) usa(m?.fondoId); } catch { /* sin versiones */ }
        if (o.final_url) usadasPorOtras.add(o.final_url);
        try { for (const p of JSON.parse(o.products || '[]')) if (p.fotoUrl) usadasPorOtras.add(p.fotoUrl); } catch { /* */ }
        for (const u of urlsDeImagenes(o.layout)) usadasPorOtras.add(u);
    }
    const borrables = fondos.rows.filter(f => !otraQueLoUsa.has(Number(f.id)));
    const heredados = fondos.rows.filter(f => otraQueLoUsa.has(Number(f.id)));
    urls.push(...borrables.map(f => f.url));
    await turso.batch([
        { sql: 'DELETE FROM ad_designs WHERE id = ? AND company_id = ?', args: [Number(d.id), companyId] },
        ...borrables.map(f => ({ sql: 'DELETE FROM ad_backgrounds WHERE id = ? AND company_id = ?', args: [Number(f.id), companyId] })),
        ...heredados.map(f => ({ sql: 'UPDATE ad_backgrounds SET design_id = ? WHERE id = ? AND company_id = ?', args: [otraQueLoUsa.get(Number(f.id)), Number(f.id), companyId] })),
    ]);
    await borrarBlobs(urls.filter(u => u && !usadasPorOtras.has(u)));
    return { success: true };
}

/**
 * Una imagen guardada (fondo, foto subida o imagen final) como data URL, solo si
 * la usa algo de ESTA empresa. Así el navegador nunca necesita la URL de Blob ni
 * acceso directo al almacenamiento.
 */
export async function imagenDeLaEmpresa(turso, companyId, { url }) {
    if (!url || typeof url !== 'string') return { success: false, error: 'Falta la imagen' };
    const deFondo = await turso.execute({ sql: 'SELECT 1 FROM ad_backgrounds WHERE company_id = ? AND url = ? LIMIT 1', args: [companyId, url] });
    let propia = !!deFondo.rows[0];
    if (!propia) {
        const deDiseno = await turso.execute({
            sql: 'SELECT 1 FROM ad_designs WHERE company_id = ? AND (final_url = ? OR instr(products, ?) > 0 OR instr(layout, ?) > 0) LIMIT 1',
            args: [companyId, url, JSON.stringify(url).slice(1, -1), JSON.stringify(url).slice(1, -1)],
        });
        propia = !!deDiseno.rows[0];
    }
    if (!propia) return { success: false, error: 'Imagen no encontrada' };
    const dataUrl = await leerComoDataUrl(url);
    return dataUrl ? { success: true, dataUrl } : { success: false, error: 'Imagen no encontrada' };
}

/**
 * Los productos con oferta vigente, para armar la publicidad desde ahí sin
 * buscarlos uno por uno. Usa el índice parcial de 0033 (is_offer = 1).
 * Las que ya vencieron por fecha o por unidades no salen, aunque la revisión de
 * ofertas todavía no las haya apagado.
 */
export async function ofertasParaPublicidad(turso, companyId) {
    const r = await turso.execute({
        sql: `SELECT id, name, price, offer_price, is_offer, category, unit,
                     offer_until, offer_units_limit, offer_units_sold,
                     CASE WHEN image IS NOT NULL AND image != '' THEN 1 ELSE 0 END AS has_image
              FROM products
              WHERE company_id = ? AND is_offer = 1 AND offer_price > 0
              ORDER BY name COLLATE NOCASE LIMIT 300`,
        args: [companyId],
    });
    const ahora = Date.now();
    const vigente = (p) => {
        if (p.offer_until && new Date(p.offer_until).getTime() <= ahora) return false;
        const limite = Number(p.offer_units_limit) || 0;
        return !(limite > 0 && (Number(p.offer_units_sold) || 0) >= limite);
    };
    return { success: true, productos: r.rows.filter(vigente).map(p => ({ ...p })) };
}

export async function estadoPublicidad(turso, companyId, session) {
    const [permitido, app, cupo] = await Promise.all([
        puedeUsarPublicidad(turso, session?.uid, companyId),
        tieneAppPublicidad(turso, companyId),
        cupoPublicidad(turso, companyId),
    ]);
    return { success: true, permitido, app, cupo, almacenamiento: blobConfigurado(), modelos: { fondo: MODELO_FONDO, integrado: MODELO_INTEGRADO } };
}

export { ritmoExcedido as ritmoPublicidadExcedido };
