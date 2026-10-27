// Composición de la publicidad en un <canvas>: fondo (de la IA o de color) +
// foto REAL de cada producto + nombre, precio, unidad, etiqueta y textos.
//
// Todo lo comercial lo dibuja este código, no la IA: así el precio sale siempre
// bien escrito y se puede cambiar al instante sin volver a generar el fondo.
//
// Cada producto llega con SU foto adentro del mismo objeto ({ nombre, precio,
// foto, ... }): nunca se emparejan por posición en listas separadas, que es como
// un precio termina en el producto equivocado.

// Las letras de siempre (diseño "Clásica"); los demás diseños están en catalogo.js (LETRAS).
const FAMILIA = 'Arial, Helvetica, sans-serif';
const FAMILIA_PRECIO = '"Arial Black", "Arial Bold", Arial, Helvetica, sans-serif';
const CLASICA = { titulo: { familia: FAMILIA }, precio: { familia: FAMILIA_PRECIO }, texto: { familia: FAMILIA } };

export function cargarImagen(src) {
    return new Promise((resolve, reject) => {
        if (!src) { resolve(null); return; }
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
        img.src = src;
    });
}

// ── Letras (diseños de LETRAS en catalogo.js) ────────────────────────────────

let hojaLetras = null;

/** Pide la hoja de las fuentes una sola vez. Sin internet queda la letra del sistema, y se reintenta la próxima. */
export function pedirLetras(url) {
    if (!hojaLetras) {
        hojaLetras = new Promise((resolve) => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = url;
            link.onload = () => resolve(true);
            link.onerror = () => { link.remove(); hojaLetras = null; resolve(false); };
            document.head.appendChild(link);
        });
    }
    return hojaLetras;
}

/** Espera las fuentes de un diseño: el lienzo dibuja con otra la que todavía no llegó, y no avisa cuando llega. */
export async function prepararLetras(url, letras) {
    if (!(await pedirLetras(url)) || !document.fonts?.load) return;
    await Promise.all([letras.titulo, letras.precio, letras.texto].flatMap(rol =>
        (rol.peso ? [rol.peso] : [700, 800, 900]).map(peso => document.fonts.load(`${peso} 40px ${rol.familia}`).catch(() => null))));
}

const anchoDe = (img) => img?.naturalWidth || img?.width || 0;
const altoDe = (img) => img?.naturalHeight || img?.height || 0;

/**
 * Quita el fondo blanco de una foto de producto: borra (deja transparente) el
 * blanco que toca los bordes, sin tocar el envase. No usa IA: el producto queda
 * exactamente como en la foto.
 */
export function quitarFondoBlanco(img, tolerancia = 26) {
    const w = anchoDe(img), h = altoDe(img);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    if (!w || !h) return c;
    const datos = ctx.getImageData(0, 0, w, h);
    const p = datos.data;
    const limite = 255 - tolerancia;
    const blanco = (i) => p[i] >= limite && p[i + 1] >= limite && p[i + 2] >= limite
        && Math.max(p[i], p[i + 1], p[i + 2]) - Math.min(p[i], p[i + 1], p[i + 2]) < 18;
    const visto = new Uint8Array(w * h);
    const cola = new Int32Array(w * h);
    let ini = 0, fin = 0;
    const meter = (x, y) => {
        const k = y * w + x;
        if (visto[k]) return;
        visto[k] = 1;
        if (blanco(k * 4)) cola[fin++] = k;
    };
    for (let x = 0; x < w; x++) { meter(x, 0); meter(x, h - 1); }
    for (let y = 0; y < h; y++) { meter(0, y); meter(w - 1, y); }
    while (ini < fin) {
        const k = cola[ini++];
        p[k * 4 + 3] = 0;
        const x = k % w, y = (k - x) / w;
        if (x > 0) meter(x - 1, y);
        if (x < w - 1) meter(x + 1, y);
        if (y > 0) meter(x, y - 1);
        if (y < h - 1) meter(x, y + 1);
    }
    // Borde suave: los píxeles casi blancos pegados a lo borrado quedan a medias.
    for (let k = 0; k < w * h; k++) {
        if (p[k * 4 + 3] === 0) continue;
        const x = k % w, y = (k - x) / w;
        const junto = (x > 0 && p[(k - 1) * 4 + 3] === 0) || (x < w - 1 && p[(k + 1) * 4 + 3] === 0)
            || (y > 0 && p[(k - w) * 4 + 3] === 0) || (y < h - 1 && p[(k + w) * 4 + 3] === 0);
        if (junto) {
            const luz = (p[k * 4] + p[k * 4 + 1] + p[k * 4 + 2]) / 3;
            if (luz > 200) p[k * 4 + 3] = Math.round(255 * Math.min(1, (255 - luz) / 55));
        }
    }
    ctx.putImageData(datos, 0, 0);
    return c;
}

// ── Utilidades de dibujo ──────────────────────────────────────────────────────

function rectRedondo(ctx, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}

/** `rol`: la letra del diseño ({ familia, peso }); su `peso` fijo manda sobre el pedido. */
function fuente(ctx, tam, peso, rol) { ctx.font = `${rol.peso ?? peso} ${Math.round(tam)}px ${rol.familia}`; }

/** El tamaño más grande (entre min y max) con el que `texto` entra en `maxAncho`. */
function ajustar(ctx, texto, maxAncho, tamMax, tamMin, peso, rol) {
    let tam = tamMax;
    while (tam > tamMin) {
        fuente(ctx, tam, peso, rol);
        if (ctx.measureText(texto).width <= maxAncho) return tam;
        tam *= 0.94;
    }
    return tamMin;
}

/** Corta `texto` en líneas de `maxAncho`; la última, con "…" si no entra. */
function envolver(ctx, texto, maxAncho, maxLineas) {
    const palabras = String(texto || '').split(/\s+/).filter(Boolean);
    const lineas = [];
    let actual = '';
    for (const p of palabras) {
        const prueba = actual ? `${actual} ${p}` : p;
        if (ctx.measureText(prueba).width <= maxAncho || !actual) actual = prueba;
        else { lineas.push(actual); actual = p; }
    }
    if (actual) lineas.push(actual);
    if (lineas.length <= maxLineas) return lineas;
    const quedan = lineas.slice(0, maxLineas);
    let ultima = `${quedan[maxLineas - 1]} ${lineas.slice(maxLineas).join(' ')}`;
    while (ultima.length > 1 && ctx.measureText(`${ultima}…`).width > maxAncho) ultima = ultima.slice(0, -1);
    quedan[maxLineas - 1] = `${ultima.trim()}…`;
    return quedan;
}

/** Dibuja la imagen cubriendo todo el rectángulo, recortando lo que sobra (sin estirar). */
function cubrir(ctx, img, x, y, w, h) {
    const iw = anchoDe(img), ih = altoDe(img);
    const escala = Math.max(w / iw, h / ih);
    const sw = w / escala, sh = h / escala;
    ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}

// La imagen difuminada de cada fondo, para no recalcularla en cada movimiento del deslizador.
const difuminados = new WeakMap(); // imagen → { clave, lienzo }

/** La misma imagen muy desenfocada y algo oscura, cubriendo todo: el relleno al alejar o mover el fondo. */
function difuminado(img, W, H) {
    const clave = `${W}x${H}`;
    const ya = difuminados.get(img);
    if (ya?.clave === clave) return ya.lienzo;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    if (typeof ctx.filter === 'string') {
        // Más grande que el lienzo, para que el desenfoque no aclare los bordes.
        const r = Math.round(Math.min(W, H) * 0.04);
        ctx.filter = `blur(${r}px)`;
        cubrir(ctx, img, -r * 2, -r * 2, W + r * 4, H + r * 4);
        ctx.filter = 'none';
    } else {
        // Sin `filter` (Safari viejo): achicarla y volver a agrandarla también la desenfoca.
        const chico = document.createElement('canvas');
        chico.width = 32; chico.height = Math.max(1, Math.round(32 * H / W));
        cubrir(chico.getContext('2d'), img, 0, 0, chico.width, chico.height);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(chico, 0, 0, W, H);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(0, 0, W, H);
    difuminados.set(img, { clave, lienzo: c });
    return c;
}

/**
 * El fondo con su encuadre: `y` lo sube (hasta 1) o lo baja (hasta −1), `x` lo
 * lleva a la derecha (hasta 1) o a la izquierda (hasta −1) y `zoom` lo acerca
 * (>1) o lo aleja (<1). La IA entrega solo 3 medidas y cada formato recorta una
 * parte; moverlo muestra lo recortado (Kevin, 25-oct-2026: "hay imagen generada
 * más de lo que se muestra"). Lo que queda sin cubrir, al alejarlo o al moverlo
 * más que lo recortado, se rellena con la misma imagen difuminada.
 */
function dibujarFondo(ctx, img, W, H, { x = 0, y = 0, zoom = 1 } = {}) {
    const iw = anchoDe(img), ih = altoDe(img);
    if (!iw || !ih) return;
    const z = Math.min(1.4, Math.max(0.6, Number(zoom) || 1));
    const s = Math.max(W / iw, H / ih) * z;
    const dw = iw * s, dh = ih * s;
    // Se mueve lo recortado y, si es poco, hasta un 20 % del lado.
    const correr = (v, sobra, lado) => Math.max(Math.abs(sobra) / 2, lado * 0.2) * Math.min(1, Math.max(-1, Number(v) || 0));
    const dx = (W - dw) / 2 + correr(x, W - dw, W), dy = (H - dh) / 2 - correr(y, H - dh, H);
    const hueco = dx > 0.5 || dy > 0.5 || dy + dh < H - 0.5;
    if (hueco) ctx.drawImage(difuminado(img, W, H), 0, 0);
    ctx.save();
    if (hueco) { ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = Math.min(W, H) * 0.03; }
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
}

/** Dibuja la imagen entera dentro del rectángulo, centrada (sin deformar). */
function contener(ctx, img, x, y, w, h) {
    const iw = anchoDe(img), ih = altoDe(img);
    if (!iw || !ih) return { x, y, w: 0, h: 0 };
    const escala = Math.min(w / iw, h / ih);
    const dw = iw * escala, dh = ih * escala;
    const dx = x + (w - dw) / 2, dy = y + (h - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
    return { x: dx, y: dy, w: dw, h: dh };
}

function aclarar(hex, cuanto) {
    const n = parseInt(String(hex).replace('#', ''), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const f = (c) => Math.round(c + (255 - c) * cuanto);
    return `rgb(${f(r)}, ${f(g)}, ${f(b)})`;
}

// Las piezas que se eligen, arrastran y agrandan en la vista previa (Kevin,
// 26-oct-2026). `mover[id] = { x, y, escala }`: lo corrido, en fracciones del
// lienzo para que sirva en cualquier formato, y el tamaño, desde su centro. Nunca
// se sale de la imagen, y queda anotada su caja para poder tomarla.
const entre = (v, min, max) => Math.min(Math.max(v, min), Math.max(min, max));
export const ESCALA_PIEZA = { min: 0.4, max: 2.5 };

function pieza(pz, id, x, y, w, h) {
    const mov = pz.mover[id];
    const s = mov ? entre(Number(mov.escala) || 1, ESCALA_PIEZA.min, ESCALA_PIEZA.max) : 1;
    const sw = w * s, sh = h * s;
    const x0 = x + (w - sw) / 2, y0 = y + (h - sh) / 2;
    const dx = mov ? entre((Number(mov.x) || 0) * pz.W, -x0, pz.W - sw - x0) : 0;
    const dy = mov ? entre((Number(mov.y) || 0) * pz.H, -y0, pz.H - sh - y0) : 0;
    pz.cajas.push({ id, x: x0 + dx, y: y0 + dy, w: sw, h: sh, dx, dy, escala: s });
    return { dx, dy, s, cx: x + w / 2, cy: y + h / 2 };
}

/** Lo que se dibuje después queda corrido y agrandado como la pieza (desde su centro). */
function colocar(ctx, t) {
    ctx.translate(t.cx + t.dx, t.cy + t.dy);
    ctx.scale(t.s, t.s);
    ctx.translate(-t.cx, -t.cy);
}

/** La etiqueta ("OFERTA"). Con `pz` es una pieza que se arrastra; en las tarjetas, no. */
function etiquetaInclinada(ctx, texto, x, y, tam, colores, rol, pz = null) {
    if (!texto) return;
    ctx.save();
    fuente(ctx, tam, 900, rol);
    const w = ctx.measureText(texto).width + tam * 1.1;
    const h = tam * 1.7;
    // Inclinada, sube un poco a la derecha: la caja para tomarla lo incluye.
    const sube = w * Math.sin(0.12);
    if (pz) colocar(ctx, pieza(pz, 'etiqueta', x, y - sube, w, h + sube));
    ctx.translate(x, y);
    ctx.rotate(-0.12);
    ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = tam * 0.4; ctx.shadowOffsetY = tam * 0.12;
    rectRedondo(ctx, 0, 0, w, h, h * 0.22);
    ctx.fillStyle = colores.acento; ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#111111'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillText(texto, w / 2, h / 2 + tam * 0.04);
    ctx.restore();
}

// ── Composición ───────────────────────────────────────────────────────────────

/**
 * d = {
 *   ancho, alto, formatoId,
 *   fondo: Image|Canvas|null,
 *   productos: [{ nombre, precio, precioAntes, unidadTexto, etiqueta, foto }],
 *   textos: { titulo, mensaje, extra, negocio },
 *   colores: { principal, acento, texto },
 *   ajustes: { escala, posX, posY },
 *   encuadre: { x, y, zoom },
 *   letras: { titulo, precio, texto },   // un diseño de LETRAS (catalogo.js)
 *   mover: { titulo: { x, y, escala }, ... }, // lo que se corrió y agrandó cada pieza
 *   seleccion: 'precio',                 // la pieza elegida en la vista previa
 *   dinero: (n) => '$1.450',
 * }
 * Devuelve las cajas de las piezas que se pueden arrastrar, en el orden en que
 * se dibujaron (la última queda encima).
 */
export function dibujarPublicidad(canvas, d) {
    const W = Math.round(d.ancho), H = Math.round(d.alto);
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const u = Math.min(W, H);
    const m = u * 0.05;
    const col = { principal: '#DC2626', acento: '#FACC15', texto: '#FFFFFF', ...(d.colores || {}) };
    const t = d.textos || {};
    const dinero = d.dinero || ((n) => `$${n}`);
    const L = d.letras || CLASICA;
    const pz = { W, H, mover: d.mover || {}, cajas: [] };
    ctx.textBaseline = 'alphabetic';

    // Fondo
    if (d.fondo) dibujarFondo(ctx, d.fondo, W, H, d.encuadre);
    else {
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, aclarar(col.principal, 0.82));
        g.addColorStop(1, aclarar(col.acento, 0.7));
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }

    // El pie, el título y el mensaje se miden primero (el lugar de los productos
    // se calcula con ellos en su lugar de siempre: moverlos no corre a nadie) y se
    // dibujan al final, para que queden encima si se los arrastra sobre un producto.
    const encima = [];

    // Pie: nombre del negocio y texto extra
    const altoPie = (t.negocio || t.extra) ? u * 0.075 : 0;
    // Ocupa todo el ancho: a los lados se mueve recién cuando se lo achica.
    if (altoPie) encima.push(() => {
        ctx.save();
        colocar(ctx, pieza(pz, 'pie', 0, H - altoPie, W, altoPie));
        ctx.fillStyle = 'rgba(0,0,0,0.62)';
        ctx.fillRect(0, H - altoPie, W, altoPie);
        ctx.fillStyle = '#FFFFFF'; ctx.textBaseline = 'middle';
        if (t.negocio) {
            ajustar(ctx, t.negocio, W * (t.extra ? 0.45 : 0.9), u * 0.034, u * 0.018, 800, L.texto);
            ctx.textAlign = t.extra ? 'left' : 'center';
            ctx.fillText(t.negocio, t.extra ? m : W / 2, H - altoPie / 2);
        }
        if (t.extra) {
            ajustar(ctx, t.extra, W * (t.negocio ? 0.45 : 0.9), u * 0.03, u * 0.016, 700, L.texto);
            ctx.textAlign = t.negocio ? 'right' : 'center';
            ctx.fillText(t.extra, t.negocio ? W - m : W / 2, H - altoPie / 2);
        }
        ctx.restore();
    });

    // Encabezado: título en su banda y mensaje
    let y = m;
    if (t.titulo) {
        const tam = ajustar(ctx, t.titulo, W - m * 2 - u * 0.06, u * 0.105, u * 0.04, 900, L.titulo);
        fuente(ctx, tam, 900, L.titulo);
        const anchoBanda = Math.min(W - m * 2, ctx.measureText(t.titulo).width + u * 0.08);
        const altoBanda = tam * 1.45;
        const yBanda = y;
        encima.push(() => {
            ctx.save();
            colocar(ctx, pieza(pz, 'titulo', (W - anchoBanda) / 2, yBanda, anchoBanda, altoBanda));
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = u * 0.02; ctx.shadowOffsetY = u * 0.006;
            rectRedondo(ctx, (W - anchoBanda) / 2, yBanda, anchoBanda, altoBanda, altoBanda * 0.25);
            ctx.fillStyle = col.principal; ctx.fill();
            ctx.restore();
            fuente(ctx, tam, 900, L.titulo);
            ctx.fillStyle = col.texto; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(t.titulo, W / 2, yBanda + altoBanda / 2 + tam * 0.03);
            ctx.restore();
        });
        y += altoBanda + u * 0.02;
    }
    if (t.mensaje?.trim()) {
        const tam = u * 0.042;
        fuente(ctx, tam, 800, L.texto);
        const lineas = envolver(ctx, t.mensaje, W - m * 2, 2);
        const ancho = Math.max(...lineas.map(l => ctx.measureText(l).width));
        const yMensaje = y;
        encima.push(() => {
            ctx.save();
            colocar(ctx, pieza(pz, 'mensaje', (W - ancho) / 2, yMensaje, ancho, lineas.length * tam * 1.25));
            fuente(ctx, tam, 800, L.texto);
            ctx.textAlign = 'center';
            ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = u * 0.012;
            ctx.fillStyle = '#FFFFFF';
            lineas.forEach((l, i) => ctx.fillText(l, W / 2, yMensaje + tam + i * tam * 1.25));
            ctx.restore();
        });
        y += lineas.length * tam * 1.25 + u * 0.01;
    }

    const productos = (d.productos || []).filter(Boolean);
    const zona = { x: m, y: y + u * 0.01, w: W - m * 2, h: H - altoPie - m - (y + u * 0.01) };
    if (productos.length === 1) dibujarUno(ctx, productos[0], zona, { W, H, u, m, col, L, pz, dinero, ajustes: d.ajustes || {}, mayorista: d.formatoId === 'mayorista' });
    else if (productos.length > 1) dibujarVarios(ctx, productos, zona, { W, H, u, col, L, dinero, mayorista: d.formatoId === 'mayorista' });
    for (const dibujar of encima) dibujar();

    // La pieza elegida: marco y esquinas para agrandarla. Solo en la vista previa
    // (lo que se guarda o se descarga se dibuja sin `seleccion`).
    const sel = d.seleccion && pz.cajas.find(c => c.id === d.seleccion);
    if (sel) {
        ctx.save();
        ctx.setLineDash([u * 0.02, u * 0.012]);
        ctx.lineWidth = Math.max(2, u * 0.005);
        ctx.strokeStyle = '#FFFFFF'; ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = u * 0.008;
        ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
        ctx.setLineDash([]);
        ctx.lineWidth = Math.max(2, u * 0.004);
        ctx.strokeStyle = '#0EA5E9';
        for (const [ex, ey] of esquinas(sel)) {
            ctx.beginPath();
            ctx.arc(ex, ey, u * 0.016, 0, Math.PI * 2);
            ctx.fillStyle = '#FFFFFF'; ctx.fill(); ctx.stroke();
        }
        ctx.restore();
    }
    return pz.cajas;
}

/** Las cuatro esquinas de una caja (de donde se agranda o achica una pieza). */
export function esquinas(c) {
    return [[c.x, c.y], [c.x + c.w, c.y], [c.x, c.y + c.h], [c.x + c.w, c.y + c.h]];
}

/** Las líneas del globo del precio y su alto, sin dibujar (para reservarle lugar). */
function medirPrecio(ctx, p, w, { u, L, dinero, mayorista }) {
    const tamPrecio = ajustar(ctx, dinero(p.precio), w * 0.86, u * 0.13, u * 0.05, 900, L.precio);
    const tamChico = Math.max(u * 0.022, tamPrecio * 0.27);
    const lineas = [];
    if (mayorista) lineas.push({ texto: 'PRECIO MAYORISTA', tam: tamChico, peso: 900, rol: L.texto });
    if (p.precioAntes && p.precioAntes > p.precio) lineas.push({ texto: `Antes ${dinero(p.precioAntes)}`, tam: tamChico, peso: 700, rol: L.texto, tachado: true });
    lineas.push({ texto: dinero(p.precio), tam: tamPrecio, peso: 900, rol: L.precio });
    if (p.unidadTexto) lineas.push({ texto: p.unidadTexto, tam: tamChico * 1.05, peso: 800, rol: L.texto });
    return { lineas, alto: lineas.reduce((s, l) => s + l.tam * 1.18, 0) + u * 0.035 };
}

function bloquePrecio(ctx, x, y, w, { lineas, alto }, { u, col }) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = u * 0.025; ctx.shadowOffsetY = u * 0.008;
    rectRedondo(ctx, x, y - alto, w, alto, u * 0.03);
    ctx.fillStyle = col.principal; ctx.fill();
    ctx.restore();
    let cy = y - alto + u * 0.0175;
    ctx.textAlign = 'center'; ctx.fillStyle = col.texto;
    for (const l of lineas) {
        fuente(ctx, l.tam, l.peso, l.rol);
        cy += l.tam * 1.0;
        ctx.globalAlpha = l.tachado ? 0.85 : 1;
        ctx.fillText(l.texto, x + w / 2, cy);
        if (l.tachado) {
            const tw = ctx.measureText(l.texto).width;
            ctx.fillRect(x + w / 2 - tw / 2, cy - l.tam * 0.33, tw, Math.max(1, l.tam * 0.09));
        }
        ctx.globalAlpha = 1;
        cy += l.tam * 0.18;
    }
    return alto;
}

function dibujarUno(ctx, p, zona, { W, H, u, col, L, pz, dinero, ajustes, mayorista }) {
    const horizontal = W > H * 1.2;
    const escala = Math.min(1.8, Math.max(0.4, Number(ajustes.escala) || 1));
    // Precio: abajo a la derecha (vertical) o a la derecha al medio (horizontal).
    const anchoPrecio = horizontal ? W * 0.36 : Math.min(W * 0.5, zona.w * 0.55);
    const xPrecio = zona.x + zona.w - anchoPrecio;
    const yPrecio = horizontal ? zona.y + zona.h * 0.82 : zona.y + zona.h;
    const precio = medirPrecio(ctx, p, anchoPrecio, { u, L, dinero, mayorista });

    // Nombre exacto del producto, a la izquierda del precio (vertical) o encima (horizontal).
    const anchoNombre = horizontal ? anchoPrecio : zona.w - anchoPrecio - u * 0.03;
    const xNombre = horizontal ? xPrecio : zona.x;
    const tam = Math.max(u * 0.03, Math.min(u * 0.055, anchoNombre / 9));
    fuente(ctx, tam, 900, L.texto);
    const lineas = envolver(ctx, p.nombre, anchoNombre - u * 0.04, 3);
    const altoNombre = lineas.length * tam * 1.2 + u * 0.03;
    const yNombre = horizontal ? yPrecio - precio.alto - u * 0.02 - altoNombre : yPrecio - altoNombre;

    // Foto del producto (la real), en su caja, con sombra. En vertical va en el
    // espacio que queda ARRIBA del precio y el nombre, con margen: así ninguno
    // tapa el producto (Kevin, 25-oct-2026). Agrandarla con el deslizador puede
    // pasar ese margen: es a propósito.
    if (p.foto) {
        const libre = horizontal ? zona.h : zona.h - Math.max(precio.alto, altoNombre) - u * 0.03;
        const cw = (horizontal ? W * 0.42 : zona.w * 0.78) * escala;
        const ch = (horizontal ? zona.h * 0.85 : libre * 0.94) * escala;
        const posX = ajustes.posX ?? (horizontal ? 0.3 : 0.5);
        const posY = ajustes.posY ?? 0.5;
        const cx = W * posX;
        const cy = zona.y + libre * posY;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.38)'; ctx.shadowBlur = u * 0.035; ctx.shadowOffsetY = u * 0.015;
        const caja = contener(ctx, p.foto, cx - cw / 2, cy - ch / 2, cw, ch);
        ctx.restore();
        // La foto se arrastra y agranda con su posición y tamaño (los mismos deslizadores): `libre` pasa px a posY.
        pz.cajas.push({ id: 'foto', ...caja, posX, posY, libre, escala });
        if (p.etiqueta) etiquetaInclinada(ctx, p.etiqueta, caja.x + caja.w * 0.02, caja.y + caja.h * 0.02, u * 0.04, col, L.titulo, pz);
    } else if (p.etiqueta) {
        etiquetaInclinada(ctx, p.etiqueta, zona.x, zona.y + u * 0.02, u * 0.04, col, L.titulo, pz);
    }

    ctx.save();
    colocar(ctx, pieza(pz, 'precio', xPrecio, yPrecio - precio.alto, anchoPrecio, precio.alto));
    bloquePrecio(ctx, xPrecio, yPrecio, anchoPrecio, precio, { u, col });
    ctx.restore();

    ctx.save();
    colocar(ctx, pieza(pz, 'nombre', xNombre, yNombre, anchoNombre, altoNombre));
    ctx.save();
    rectRedondo(ctx, xNombre, yNombre, anchoNombre, altoNombre, u * 0.02);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fill();
    ctx.restore();
    fuente(ctx, tam, 900, L.texto);
    ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'left';
    lineas.forEach((l, i) => ctx.fillText(l, xNombre + u * 0.02, yNombre + u * 0.015 + tam * (i + 0.95) * 1.2 - tam * 0.2));
    ctx.restore();
}

function dibujarVarios(ctx, productos, zona, { W, H, u, col, L, dinero, mayorista }) {
    const n = productos.length;
    const horizontal = W > H * 1.2;
    const cols = horizontal ? Math.min(n, 4) : (n <= 2 && H / W > 1.5 ? 1 : 2);
    const filas = Math.ceil(n / cols);
    const sep = u * 0.025;
    const cw = (zona.w - sep * (cols - 1)) / cols;
    const ch = Math.min((zona.h - sep * (filas - 1)) / filas, cw * 1.6);
    const altoTotal = ch * filas + sep * (filas - 1);
    const y0 = zona.y + (zona.h - altoTotal) / 2;

    productos.forEach((p, i) => {
        const fila = Math.floor(i / cols);
        const enFila = Math.min(cols, n - fila * cols);
        const x0 = zona.x + (zona.w - (cw * enFila + sep * (enFila - 1))) / 2;
        const x = x0 + (i % cols) * (cw + sep);
        const y = y0 + fila * (ch + sep);
        const pad = cw * 0.06;

        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = u * 0.025; ctx.shadowOffsetY = u * 0.008;
        rectRedondo(ctx, x, y, cw, ch, u * 0.025);
        ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fill();
        ctx.restore();

        // Precio y unidad abajo; nombre arriba de ellos; la foto ocupa lo que queda.
        const tamPrecio = ajustar(ctx, dinero(p.precio), cw - pad * 2, ch * 0.16, u * 0.03, 900, L.precio);
        const tamChico = Math.max(u * 0.018, Math.min(tamPrecio * 0.34, ch * 0.055));
        let yAbajo = y + ch - pad;
        ctx.textAlign = 'center';
        if (p.unidadTexto) {
            fuente(ctx, tamChico, 700, L.texto);
            ctx.fillStyle = '#4B5563';
            ctx.fillText(p.unidadTexto, x + cw / 2, yAbajo);
            yAbajo -= tamChico * 1.25;
        }
        fuente(ctx, tamPrecio, 900, L.precio);
        ctx.fillStyle = col.principal;
        ctx.fillText(dinero(p.precio), x + cw / 2, yAbajo);
        yAbajo -= tamPrecio * 1.05;
        if ((p.precioAntes && p.precioAntes > p.precio) || mayorista) {
            const txt = p.precioAntes && p.precioAntes > p.precio ? `Antes ${dinero(p.precioAntes)}` : 'PRECIO MAYORISTA';
            fuente(ctx, tamChico, 800, L.texto);
            ctx.fillStyle = '#6B7280';
            ctx.fillText(txt, x + cw / 2, yAbajo);
            if (p.precioAntes && p.precioAntes > p.precio) {
                const tw = ctx.measureText(txt).width;
                ctx.fillRect(x + cw / 2 - tw / 2, yAbajo - tamChico * 0.33, tw, Math.max(1, tamChico * 0.09));
            }
            yAbajo -= tamChico * 1.3;
        }
        const tamNombre = Math.max(u * 0.02, Math.min(ch * 0.065, cw / 11));
        fuente(ctx, tamNombre, 800, L.texto);
        ctx.fillStyle = '#111827';
        const lineas = envolver(ctx, p.nombre, cw - pad * 2, 2);
        for (let k = lineas.length - 1; k >= 0; k--) {
            ctx.fillText(lineas[k], x + cw / 2, yAbajo);
            yAbajo -= tamNombre * 1.2;
        }
        const fotoAlto = yAbajo - (y + pad) - tamNombre * 0.2;
        if (p.foto && fotoAlto > ch * 0.2) contener(ctx, p.foto, x + pad, y + pad, cw - pad * 2, fotoAlto);
        if (p.etiqueta) etiquetaInclinada(ctx, p.etiqueta, x + pad * 0.3, y + pad * 0.3, Math.max(u * 0.02, cw * 0.065), col, L.titulo);
    });
}
