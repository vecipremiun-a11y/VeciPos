// Formatos, campañas y estilos de Publicidad IA. Los ids son los mismos que valida
// el servidor (api/_lib/publicidadActions.js). Las medidas son las de la imagen
// final que se descarga; el fondo de la IA se pide en su tamaño nativo más
// cercano y se recorta (nunca se estira).

export const FORMATOS = [
    { id: 'post_vertical', nombre: 'Publicación vertical', corto: '4:5', detalle: 'Instagram y Facebook · 4:5', ancho: 1080, alto: 1350, max: 6 },
    { id: 'historia', nombre: 'Historia / estado', corto: '9:16', detalle: 'Instagram y WhatsApp · 9:16', ancho: 1080, alto: 1920, max: 6 },
    { id: 'cuadrado', nombre: 'Publicación cuadrada', corto: '1:1', detalle: '1:1', ancho: 1080, alto: 1080, max: 4 },
    { id: 'horizontal', nombre: 'Horizontal', corto: '1,91:1', detalle: 'Facebook y web · 1,91:1', ancho: 1200, alto: 628, max: 4 },
    { id: 'cartel', nombre: 'Cartel para imprimir', corto: 'A4', detalle: 'Hoja A4 vertical', ancho: 1240, alto: 1754, max: 6 },
    { id: 'mayorista', nombre: 'Publicidad mayorista', corto: 'Mayorista', detalle: 'Precio por caja o display · 4:5', ancho: 1080, alto: 1350, max: 6 },
    { id: 'personalizado', nombre: 'Personalizado', corto: 'Libre', detalle: 'Ancho y alto a elección', ancho: 1080, alto: 1080, max: 6 },
];

export const CAMPANAS = [
    { id: 'oferta_dia', nombre: 'Oferta del día', titulo: 'OFERTA DEL DÍA', etiqueta: 'OFERTA' },
    { id: 'descuento', nombre: 'Descuento', titulo: 'DESCUENTO', etiqueta: 'DESCUENTO' },
    { id: 'destacado', nombre: 'Producto destacado', titulo: 'RECOMENDADO', etiqueta: '' },
    { id: 'liquidacion', nombre: 'Liquidación de stock', titulo: 'LIQUIDACIÓN', etiqueta: 'HASTA AGOTAR STOCK' },
    { id: 'por_cantidad', nombre: 'Promoción por cantidad', titulo: 'LLEVA MÁS, PAGA MENOS', etiqueta: 'PROMO' },
    { id: 'caja_display', nombre: 'Venta por caja o display', titulo: 'POR CAJA', etiqueta: 'POR CAJA' },
    { id: 'combo', nombre: 'Combo de productos', titulo: 'COMBO', etiqueta: '' },
    { id: 'temporada', nombre: 'Campaña de temporada', titulo: 'TEMPORADA', etiqueta: '' },
    { id: 'general', nombre: 'Publicidad del negocio', titulo: '', etiqueta: '' },
];

// Cada estilo trae la paleta de lo que dibuja el sistema (banda del título,
// globo del precio, etiqueta). Se puede cambiar en el editor. La etiqueta lleva
// letra oscura: `acento` tiene que ser claro.
export const ESTILOS = [
    { id: 'moderno', grupo: 'general', nombre: 'Comercial moderno', colores: { principal: '#DC2626', acento: '#FACC15', texto: '#FFFFFF' } },
    { id: 'economico', grupo: 'general', nombre: 'Supermercado económico', colores: { principal: '#E11D2E', acento: '#FFD60A', texto: '#FFFFFF' } },
    { id: 'minimalista', grupo: 'general', nombre: 'Profesional y minimalista', colores: { principal: '#111827', acento: '#10B981', texto: '#FFFFFF' } },
    { id: 'colorido', grupo: 'general', nombre: 'Colorido y llamativo', colores: { principal: '#7C3AED', acento: '#F97316', texto: '#FFFFFF' } },
    { id: 'mayorista', grupo: 'general', nombre: 'Mayorista', colores: { principal: '#1D4ED8', acento: '#F59E0B', texto: '#FFFFFF' } },
    { id: 'festivo', grupo: 'general', nombre: 'Celebración', colores: { principal: '#B91C1C', acento: '#16A34A', texto: '#FFFFFF' } },
    { id: 'marca', grupo: 'general', nombre: 'Almacén de barrio', colores: { principal: '#0F766E', acento: '#FBBF24', texto: '#FFFFFF' } },
    { id: 'fiestas_patrias', grupo: 'fecha', nombre: 'Fiestas Patrias', colores: { principal: '#D52B1E', acento: '#F8FAFC', texto: '#FFFFFF' } },
    { id: 'navidad', grupo: 'fecha', nombre: 'Navidad y Año Nuevo', colores: { principal: '#B91C1C', acento: '#FCD34D', texto: '#FFFFFF' } },
    { id: 'verano', grupo: 'fecha', nombre: 'Verano', colores: { principal: '#0891B2', acento: '#FDE047', texto: '#FFFFFF' } },
    { id: 'invierno', grupo: 'fecha', nombre: 'Invierno', colores: { principal: '#7C2D12', acento: '#FDBA74', texto: '#FFFFFF' } },
    { id: 'escolar', grupo: 'fecha', nombre: 'Vuelta a clases', colores: { principal: '#2563EB', acento: '#FACC15', texto: '#FFFFFF' } },
    { id: 'asado', grupo: 'producto', nombre: 'Asado', colores: { principal: '#7F1D1D', acento: '#FB923C', texto: '#FFFFFF' } },
    { id: 'once', grupo: 'producto', nombre: 'Once y desayuno', colores: { principal: '#92400E', acento: '#FDE68A', texto: '#FFFFFF' } },
    { id: 'feria', grupo: 'producto', nombre: 'Feria (frutas y verduras)', colores: { principal: '#15803D', acento: '#FDE047', texto: '#FFFFFF' } },
    { id: 'natural', grupo: 'producto', nombre: 'Natural y saludable', colores: { principal: '#166534', acento: '#BEF264', texto: '#FFFFFF' } },
    { id: 'hogar', grupo: 'producto', nombre: 'Hogar y limpieza', colores: { principal: '#0369A1', acento: '#7DD3FC', texto: '#FFFFFF' } },
    { id: 'mascotas', grupo: 'producto', nombre: 'Mascotas', colores: { principal: '#C2410C', acento: '#FDE68A', texto: '#FFFFFF' } },
];
export const GRUPOS_ESTILO = [
    { id: 'general', nombre: 'Generales' },
    { id: 'fecha', nombre: 'Por fecha' },
    { id: 'producto', nombre: 'Por tipo de producto' },
];
// Diseños de letras (Kevin, 26-oct-2026): la letra del título y la etiqueta, la
// del precio y la del resto (nombre, mensaje, pie). `peso` fijo solo en las que
// vienen en un solo grosor: si no, el navegador las engruesa a la fuerza y se ven
// mal. Si la fuente no llega (sin internet), sale la que sigue en la lista.
const ARIAL = 'Arial, Helvetica, sans-serif';
const ARIAL_BLACK = '"Arial Black", "Arial Bold", Arial, Helvetica, sans-serif';
export const LETRAS = [
    { id: 'clasica', nombre: 'Clásica', titulo: { familia: ARIAL }, precio: { familia: ARIAL_BLACK }, texto: { familia: ARIAL } },
    { id: 'impacto', nombre: 'Impacto', titulo: { familia: `Anton, ${ARIAL_BLACK}`, peso: 400 }, precio: { familia: `Anton, ${ARIAL_BLACK}`, peso: 400 }, texto: { familia: ARIAL } },
    { id: 'moderna', nombre: 'Moderna', titulo: { familia: `Montserrat, ${ARIAL}` }, precio: { familia: `Montserrat, ${ARIAL_BLACK}` }, texto: { familia: `Montserrat, ${ARIAL}` } },
    { id: 'amigable', nombre: 'Amigable', titulo: { familia: `"Baloo 2", ${ARIAL}` }, precio: { familia: `"Baloo 2", ${ARIAL_BLACK}` }, texto: { familia: `"Baloo 2", ${ARIAL}` } },
    { id: 'a_mano', nombre: 'A mano', titulo: { familia: `Pacifico, ${ARIAL}`, peso: 400 }, precio: { familia: `"Baloo 2", ${ARIAL_BLACK}` }, texto: { familia: `"Baloo 2", ${ARIAL}` } },
    { id: 'elegante', nombre: 'Elegante', titulo: { familia: '"Playfair Display", Georgia, serif' }, precio: { familia: '"Playfair Display", Georgia, serif' }, texto: { familia: `Montserrat, ${ARIAL}` } },
    { id: 'divertida', nombre: 'Divertida', titulo: { familia: `Bangers, ${ARIAL_BLACK}`, peso: 400 }, precio: { familia: `Bangers, ${ARIAL_BLACK}`, peso: 400 }, texto: { familia: ARIAL } },
];
// Las fuentes de LETRAS (Google Fonts; la PWA ya las guarda para usarlas sin internet).
export const LETRAS_URL = 'https://fonts.googleapis.com/css2?family=Anton&family=Baloo+2:wght@700;800&family=Bangers&family=Montserrat:wght@700;800;900&family=Pacifico&family=Playfair+Display:wght@700;900&display=swap';

// Combinaciones de colores listas (el menú Colores de la vista previa): un toque
// cambia los tres. `acento` es el fondo de la etiqueta, que lleva letra oscura.
export const PALETAS = [
    { id: 'rojo', nombre: 'Rojo oferta', principal: '#DC2626', acento: '#FACC15', texto: '#FFFFFF' },
    { id: 'azul', nombre: 'Azul', principal: '#1D4ED8', acento: '#FDE047', texto: '#FFFFFF' },
    { id: 'turquesa', nombre: 'Turquesa', principal: '#0891B2', acento: '#FDE047', texto: '#FFFFFF' },
    { id: 'verde', nombre: 'Verde fresco', principal: '#15803D', acento: '#FACC15', texto: '#FFFFFF' },
    { id: 'naranja', nombre: 'Naranja', principal: '#EA580C', acento: '#FEF08A', texto: '#FFFFFF' },
    { id: 'morado', nombre: 'Morado', principal: '#7C3AED', acento: '#FDE68A', texto: '#FFFFFF' },
    { id: 'rosa', nombre: 'Rosa', principal: '#DB2777', acento: '#FDE047', texto: '#FFFFFF' },
    { id: 'dorado', nombre: 'Negro y dorado', principal: '#111827', acento: '#EAB308', texto: '#FFFFFF' },
];

// "Automático": el sistema elige el estilo por los productos y la fecha. No viaja
// al servidor: se manda (y se guarda) el estilo que salió.
export const ESTILO_AUTO = 'auto';

// Ejemplos para "Describí tu idea" y cambios rápidos para "Ajustar este fondo",
// para el que no sabe qué escribir.
export const IDEAS_EJEMPLO = [
    'Mesa de madera con limones y hielo',
    'Playa chilena al atardecer',
    'Cocina de campo con mantel a cuadros',
    'Fondo elegante negro y dorado',
    'Picnic en el parque un día de sol',
    'Góndola de supermercado con luces',
];
export const AJUSTES_RAPIDOS = [
    'Más luminoso',
    'Más oscuro y elegante',
    'Más colorido',
    'Más simple, con menos cosas',
    'Más cálido',
    'Más fresco',
];

const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Tipo de producto según la categoría o el nombre (sin tildes). `pan` va con
// final de palabra: "pañal" sin tilde es "panal".
const TIPOS = [
    ['mascotas', /\b(mascotas?|perros?|gatos?|dog|cat|arena sanitaria)\b/],
    ['bebidas', /\b(bebida|agua|jugo|gaseosa|refresco|helado|hielo|nectar|isotonica|energetica)/],
    ['asado', /\b(carne|vacuno|cerdo|pollo|longaniza|chorizo|prieta|costill|asado|parrilla|carbon|cordero|churrasco|hamburguesa)/],
    ['caliente', /\b(te|cafe|sopas?|consome|infusion|mate)\b/],
    ['feria', /\b(fruta|verdura|hortaliza|palta|tomate|cebolla|lechuga|limon|manzana|platano|naranja|zanahoria|frutilla)/],
    ['hogar', /\b(limpieza|aseo|detergente|cloro|lavaloza|suavizante|desinfectante|papel higienico|lavaplatos|limpiador|jabon)/],
    ['escolar', /\b(escolar|cuaderno|lapi[cz]|utiles|libreria|mochila|plumon|tempera)/],
    ['once', /\bpan(es|aderia)?\b|\b(fiambre|jamon|queso|mantequilla|margarina|mermelada|manjar|leche|cereal|galleta|avena|marraqueta|hallulla|yogu)/],
    ['natural', /\b(saludable|integral|organico|sin azucar|light|vegan|frutos secos|almendra|nuez|quinoa|chia)/],
];

/**
 * El estilo que le queda a estos productos hoy: primero las fechas grandes
 * (Fiestas Patrias, Navidad), después el tipo de producto (la categoría pesa más
 * que el nombre) y por último la campaña. Devuelve { id, motivo } para mostrar
 * por qué se eligió.
 */
export function sugerirEstilo(productos, { fecha = new Date(), formatoId, campanaId } = {}) {
    const mes = fecha.getMonth(), dia = fecha.getDate();
    const calor = [9, 10, 11, 0, 1, 2].includes(mes);   // octubre a marzo
    const frio = [4, 5, 6, 7].includes(mes);            // mayo a agosto
    if (mes === 8 && dia <= 21) return { id: 'fiestas_patrias', motivo: 'por Fiestas Patrias' };
    if (mes === 11) return { id: 'navidad', motivo: 'por Navidad y Año Nuevo' };
    if (formatoId === 'mayorista' || campanaId === 'caja_display') return { id: 'mayorista', motivo: 'por ser venta por caja' };

    const puntos = new Map();
    const ejemplo = new Map();
    for (const p of productos || []) {
        const cat = sinTildes(p.categoria), nom = sinTildes(p.nombre);
        for (const [tipo, re] of TIPOS) {
            const n = (re.test(cat) ? 2 : 0) + (re.test(nom) ? 1 : 0);
            if (!n) continue;
            puntos.set(tipo, (puntos.get(tipo) || 0) + n);
            if (!ejemplo.has(tipo)) ejemplo.set(tipo, re.test(cat) ? `la categoría ${p.categoria}` : `«${p.nombre}»`);
        }
    }
    let tipo = null;
    for (const [t, n] of puntos) if (!tipo || n > puntos.get(tipo)) tipo = t;
    if (tipo) {
        const id = tipo === 'bebidas' ? (calor ? 'verano' : 'colorido')
            : tipo === 'caliente' ? (frio ? 'invierno' : 'once')
                : tipo;
        return { id, motivo: `por ${ejemplo.get(tipo)}` };
    }
    if ((mes === 1 && dia >= 15) || (mes === 2 && dia <= 15)) return { id: 'escolar', motivo: 'por la vuelta a clases' };
    if (['oferta_dia', 'descuento', 'liquidacion', 'por_cantidad'].includes(campanaId)) return { id: 'economico', motivo: 'por ser una oferta' };
    if (campanaId === 'general') return { id: 'marca', motivo: 'por ser publicidad del negocio' };
    if (campanaId === 'combo') return { id: 'colorido', motivo: 'por ser un combo' };
    if (campanaId === 'temporada') return calor ? { id: 'verano', motivo: 'por la temporada' } : frio ? { id: 'invierno', motivo: 'por la temporada' } : { id: 'colorido', motivo: 'por la temporada' };
    return { id: 'moderno', motivo: '' };
}

export const formatoPorId = (id) => FORMATOS.find(f => f.id === id) || FORMATOS[0];
export const campanaPorId = (id) => CAMPANAS.find(c => c.id === id) || CAMPANAS[0];
export const estiloPorId = (id) => ESTILOS.find(e => e.id === id) || ESTILOS[0];
export const letrasPorId = (id) => LETRAS.find(l => l.id === id) || LETRAS[0];

/** Medidas de la imagen final (personalizado: las que se pidieron, con tope). */
export function medidas(formatoId, personalizado = {}) {
    const f = formatoPorId(formatoId);
    if (f.id !== 'personalizado') return { ancho: f.ancho, alto: f.alto };
    const tope = (n) => Math.min(2400, Math.max(300, Math.round(Number(n) || 1080)));
    return { ancho: tope(personalizado.ancho), alto: tope(personalizado.alto) };
}

/** "c/u", "el kilo" o "Caja (30 und)", según cómo se vende en la publicidad. */
export function textoUnidad(producto) {
    if (producto?.presentacion) return `${producto.presentacion.nombre} (${producto.presentacion.unidades} und)`;
    const u = String(producto?.unidad || 'Und').toLowerCase();
    if (u === 'kg') return 'el kilo';
    if (u === 'lt' || u === 'l') return 'el litro';
    if (u === 'gr' || u === 'g') return 'el gramo';
    return 'c/u';
}
