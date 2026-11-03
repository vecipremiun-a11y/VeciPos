// Publicidad IA (migración 0036): candados, aislamiento entre empresas, copia de
// precios y control de costo, contra una base SQLite local con todas las
// migraciones. La IA y Vercel Blob son FALSOS: esta prueba no gasta nada ni sale
// a la red. (La IA real se probó aparte el 23-oct-2026, con permiso de Kevin.)
//
//   node scripts/optim/test-publicidad.mjs

import { createClient } from '@libsql/client';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

const dir = mkdtempSync(join(tmpdir(), 'publicidad-'));
const url = `file:${join(dir, 't.db').split(String.fromCharCode(92)).join('/')}`;
process.env.VITE_TURSO_DATABASE_URL = url;
process.env.VITE_TURSO_AUTH_TOKEN = 'local';
process.env.JWT_SECRET = 'prueba-publicidad';
delete process.env.BLOB_READ_WRITE_TOKEN;

const db = createClient({ url });
const A = 'acme', B = 'otra';
const dueño = { uid: 1, role: 'owner' };
const cuenta = async (sql, args = []) => Number((await db.execute({ sql, args })).rows[0].n);

// ── Falsos ──────────────────────────────────────────────────────────────────
const guardados = new Map();
let subidas = 0;
const blobFalso = {
    put: async (ruta, buffer, opts) => {
        subidas++;
        const u = `https://falso.blob/${ruta}-${subidas}`;
        guardados.set(u, { buffer: Buffer.from(buffer), contentType: opts.contentType, access: opts.access });
        return { url: u };
    },
    get: async (u) => {
        const f = guardados.get(u);
        if (!f) return null;
        return { stream: (async function* () { yield f.buffer; })(), blob: { contentType: f.contentType } };
    },
    del: async (urls) => { for (const u of urls) guardados.delete(u); },
};
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const JPG_CHAT = `data:image/jpeg;base64,${PNG_1PX}`;
const llamadas = { generate: 0, edit: 0, texto: 0 };
let fallarCon = null;
// El director de arte del chat: contesta lo que diga `directorDice` (o falla).
let directorDice = { accion: 'nueva', prompt: 'PROMPT DEL DIRECTOR' };
let directorFalla = false;
const iaFalsa = {
    responses: {
        create: async (p, opciones) => {
            llamadas.texto++; llamadas.textoUltimo = p; llamadas.textoOpciones = opciones;
            if (directorFalla) throw Object.assign(new Error('caído'), { status: 500 });
            return { output_text: JSON.stringify(directorDice), usage: { input_tokens: 800, output_tokens: 300 } };
        },
    },
    images: {
        generate: async (p) => {
            llamadas.generate++; llamadas.ultimo = p;
            if (fallarCon) throw fallarCon;
            return { data: [{ b64_json: PNG_1PX }], usage: { input_tokens: 172, input_tokens_details: { text_tokens: 172, image_tokens: 0 }, output_tokens: 343 } };
        },
        edit: async (p) => {
            llamadas.edit++; llamadas.ultimo = p;
            return { data: [{ b64_json: PNG_1PX }], usage: { input_tokens: 1189, input_tokens_details: { text_tokens: 165, image_tokens: 1024 }, output_tokens: 343 } };
        },
    },
};

try {
    for (const m of readdirSync('migrations').filter(f => /^\d{4}_.*\.sql$/.test(f)).sort()) {
        try { await db.executeMultiple(readFileSync('migrations/' + m, 'utf8')); } catch (e) { console.log(`  (migración ${m}: ${e.message.split('\n')[0]})`); }
    }
    const FOTO = `data:image/png;base64,${PNG_1PX}`;
    await db.executeMultiple(`
        INSERT INTO companies (id, name) VALUES ('acme', 'Acme'), ('otra', 'Otra');
        INSERT INTO users (id, username, password, name, role, company_id) VALUES
          (1, 'jefe', 'x', 'Dueño', 'owner', 'acme'), (2, 'katy', 'x', 'Katy', 'Caja', 'acme'), (3, 'intruso', 'x', 'Intruso', 'owner', 'otra');
        INSERT INTO user_companies (user_id, company_id, role) VALUES (1, 'acme', 'owner'), (2, 'acme', 'Caja'), (3, 'otra', 'owner');
        INSERT INTO products (id, name, price, stock, category, sku, unit, is_offer, offer_price, company_id, image) VALUES
          (10, 'Arroz Tucapel 1 kg', 1590, 40, 'Abarrotes', 'A1', 'Und', 1, 1290, 'acme', '${FOTO}'),
          (11, 'Aceite Belmont 900 ml', 2990, 20, 'Abarrotes', 'A2', 'Und', 0, 0, 'acme', NULL),
          (12, 'Pollo entero', 2490, 5, 'Carnes', 'A3', 'Kg', 0, 0, 'acme', NULL),
          (20, 'Producto de la otra', 999, 9, 'X', 'B1', 'Und', 0, 0, 'otra', '${FOTO}'),
          (13, 'Galletas oferta vencida', 990, 10, 'Abarrotes', 'A4', 'Und', 1, 790, 'acme', NULL),
          (14, 'Bebida oferta agotada', 1500, 10, 'Bebidas', 'A5', 'Und', 1, 1200, 'acme', NULL),
          (15, 'Café Nescafé 170 g', 6990, 10, 'Abarrotes', 'A6', 'Und', 1, 5990, 'acme', NULL),
          (16, 'Oferta sin precio', 500, 10, 'Abarrotes', 'A7', 'Und', 1, 0, 'acme', NULL);
        UPDATE products SET offer_until = '2020-01-01T00:00:00.000Z' WHERE id = 13;
        UPDATE products SET offer_units_limit = 10, offer_units_sold = 10 WHERE id = 14;
        UPDATE products SET offer_until = '2099-01-01T00:00:00.000Z', offer_units_limit = 50, offer_units_sold = 3 WHERE id = 15;
        INSERT INTO product_presentations (id, company_id, product_id, name, units, price) VALUES
          (5, 'acme', 11, 'Caja', 12, 33000), (6, 'otra', 20, 'Caja', 10, 9000);
    `);

    const pa = await import('../../api/_lib/publicidadActions.js');
    pa.__probarConBlob(blobFalso);

    // ── Candados ───────────────────────────────────────────────────────────
    check('el dueño puede usarla', await pa.puedeUsarPublicidad(db, 1, A));
    check('una cajera sin el permiso no', !(await pa.puedeUsarPublicidad(db, 2, A)));
    await db.execute({ sql: "INSERT INTO role_permissions (company_id, role, permission, granted) VALUES ('acme', 'Caja', 'ads.use', 1)" });
    check('con ads.use activado, sí', await pa.puedeUsarPublicidad(db, 2, A));
    check('alguien de otra empresa no', !(await pa.puedeUsarPublicidad(db, 3, A)));
    check('sin la App no hay acceso', !(await pa.tieneAppPublicidad(db, A)));
    await db.execute({ sql: "INSERT INTO company_apps (company_id, app_key, status, trial_ends_at) VALUES ('acme', 'publicidad', 'trial', ?)", args: [new Date(Date.now() - 86400000).toISOString()] });
    check('prueba vencida: sin acceso', !(await pa.tieneAppPublicidad(db, A)));
    await db.execute("UPDATE company_apps SET status = 'active' WHERE company_id = 'acme'");
    check('App activa: acceso', await pa.tieneAppPublicidad(db, A));

    // ── Prompt ─────────────────────────────────────────────────────────────
    const pf = pa.armarPrompt({ formato: 'post_vertical', campana: 'oferta_dia', estilo: 'economico', productos: [{ name: 'Arroz' }], modo: 'fondo' });
    check('prompt de fondo: sin texto ni precios', /NO escribas ningún texto/.test(pf) && /NO incluyas productos/.test(pf));
    const pi = pa.armarPrompt({ formato: 'post_vertical', campana: 'oferta_dia', estilo: 'economico', productos: [{ name: 'Arroz' }], modo: 'integrado' });
    check('prompt integrado: conservar el envase', /Conserva el envase idéntico/.test(pi) && /NO escribas/.test(pi));
    check('fondo con IA: el nombre del producto ambienta la escena (sin dibujarlo)',
        /Productos a promocionar: Arroz\./.test(pf) && /se asocien a estos productos/.test(pf) && /NO dibujes los productos/.test(pf));
    check('integrado: plano abierto, producto chico y lugar libre para título, nombre y precio',
        /plano abierto/.test(pi) && /como máximo un tercio del alto/.test(pi) && /superficie vacía/.test(pi) && !/40 % inferior/.test(pi));
    const pc = pa.armarPrompt({ formato: 'cuadrado', campana: 'oferta_dia', estilo: 'moderno', productos: [{ name: 'Arroz' }], modo: 'integrado' });
    check('integrado cuadrado: el producto más chico (entre título y precio queda menos)', /como máximo un cuarto del alto/.test(pc) && /recortada a un cuadrado/.test(pc));
    check('fondo con IA de 1 producto: sigue marcando el lugar libre', /el lugar para el producto va centrado/.test(pf) && /40 % inferior/.test(pf));
    const ph = pa.armarPrompt({ formato: 'horizontal', campana: 'oferta_dia', estilo: 'moderno', productos: [{ name: 'Arroz' }], modo: 'integrado', horizontal: true });
    check('horizontal: el producto a la izquierda, nombre y precio a la derecha', /mitad izquierda/.test(ph) && /mitad derecha queda vacía/.test(ph) && !/un tercio del alto/.test(ph));
    const promptDe = (extra) => pa.armarPrompt({ formato: 'post_vertical', campana: 'oferta_dia', productos: [{ name: 'Agua' }], modo: 'fondo', ...extra });
    const conIdea = promptDe({ estilo: 'verano', idea: 'Playa al atardecer' });
    check('con idea propia: la escena es la del usuario y las reglas siguen',
        /«Playa al atardecer»/.test(conIdea) && !pa.ESTILOS.verano.escenas.some(e => conIdea.includes(e)) && /NO escribas ningún texto/.test(conIdea));
    check('sin idea: una escena del estilo, distinta según el azar',
        promptDe({ estilo: 'asado', azar: () => 0 }).includes(pa.ESTILOS.asado.escenas[0]) && promptDe({ estilo: 'asado', azar: () => 0.999 }).includes(pa.ESTILOS.asado.escenas[2]));
    check('la idea se corta (no entra un texto gigante)', promptDe({ estilo: 'moderno', idea: 'x'.repeat(5000) }).length < 2500);

    // ── Estilos: los mismos en el navegador y en el servidor; el automático ──
    const cat = await import('../../src/lib/publicidad/catalogo.js');
    check('los estilos del navegador y del servidor son los mismos', cat.ESTILOS.map(e => e.id).sort().join() === Object.keys(pa.ESTILOS).sort().join());
    // Kevin, 28-oct-2026: hoja A4 acostada y pantallas del local. El servidor tiene
    // su propia lista de proporciones: si le falta una, el chat la pide en 4:5.
    const fijos = cat.FORMATOS.filter(f => f.id !== 'personalizado');
    check('los formatos del navegador y del servidor son los mismos', cat.FORMATOS.map(f => f.id).sort().join() === Object.keys(pa.FORMATOS).sort().join());
    check('formatos: el chat pide cada uno en su proporción (±1 %)',
        fijos.every(f => { const [w, h] = pa.sizeChat(f.id).split('x').map(Number); return Math.abs((w / h) / (f.ancho / f.alto) - 1) < 0.01; }),
        fijos.map(f => `${f.id} ${pa.sizeChat(f.id)}`).join(' '));
    check('formatos: el fondo de la rápida sale acostado solo para los horizontales',
        fijos.every(f => pa.FORMATOS[f.id].size === (f.ancho > f.alto * 1.15 ? '1536x1024' : '1024x1536')));
    check('formatos nuevos: A4 acostada 1488×1056, pantalla 1680×944, pantalla parada como la historia; las dos hojas se imprimen',
        pa.sizeChat('cartel_horizontal') === '1488x1056' && pa.sizeChat('pantalla') === '1680x944' && pa.sizeChat('pantalla_vertical') === pa.sizeChat('historia')
        && cat.FORMATOS.filter(f => f.hoja).map(f => f.id).join() === 'cartel,cartel_horizontal');
    check('cada estilo tiene tratamiento, 3 escenas y su grupo',
        Object.values(pa.ESTILOS).every(e => e.trato && e.escenas.length === 3) && cat.ESTILOS.every(e => cat.GRUPOS_ESTILO.some(g => g.id === e.grupo)));
    const delSistema = /^(Arial|"Arial Black"|Georgia|Helvetica)$/;
    const deWeb = [...new Set(cat.LETRAS.flatMap(l => [l.titulo, l.precio, l.texto]).map(r => r.familia.split(',')[0].trim()).filter(f => !delSistema.test(f)))];
    check('letras: cada diseño tiene título, precio y texto, y la clásica es la primera',
        cat.LETRAS[0].id === 'clasica' && cat.LETRAS.every(l => l.nombre && l.titulo?.familia && l.precio?.familia && l.texto?.familia) && cat.letrasPorId('no-existe').id === 'clasica');
    check('letras: cada fuente de internet está en la hoja que se pide', deWeb.length >= 5 && deWeb.every(f => cat.LETRAS_URL.includes(`family=${f.replace(/"/g, '').replace(/ /g, '+')}`)), deWeb.join(', '));
    const sug = (prods, fecha, extra = {}) => cat.sugerirEstilo(prods, { fecha: new Date(fecha), ...extra }).id;
    const agua = [{ categoria: 'Aguas', nombre: 'Agua Quarzo 10lt' }];
    const te = [{ categoria: 'Abarrotes', nombre: 'Té Supremo 100 bolsas' }];
    check('auto: agua en octubre → Verano', sug(agua, '2026-10-25T12:00:00') === 'verano');
    check('auto: carnes → Asado', sug([{ categoria: 'Carnes', nombre: 'Pollo entero' }], '2026-10-25T12:00:00') === 'asado');
    check('auto: té en julio → Invierno; en octubre → Once', sug(te, '2026-07-10T12:00:00') === 'invierno' && sug(te, '2026-10-10T12:00:00') === 'once');
    check('auto: en septiembre manda Fiestas Patrias', sug([{ categoria: 'Carnes', nombre: 'Longaniza' }], '2026-09-12T12:00:00') === 'fiestas_patrias');
    check('auto: en diciembre, Navidad', sug(agua, '2026-12-05T12:00:00') === 'navidad');
    check('auto: la categoría pesa más que el nombre', sug([{ categoria: 'Bebidas', nombre: 'Jugo de naranja 1 L' }], '2026-11-02T12:00:00') === 'verano');
    check('auto: "pañales" no es pan', sug([{ categoria: 'Bebé', nombre: 'Pañales Babysec G' }], '2026-10-25T12:00:00', { campanaId: 'destacado' }) === 'moderno');
    check('auto: sin pista, una oferta va como Económico', sug([{ categoria: 'Abarrotes', nombre: 'Arroz Tucapel' }], '2026-10-25T12:00:00', { campanaId: 'oferta_dia' }) === 'economico');
    check('auto: formato mayorista → Mayorista', sug(agua, '2026-10-25T12:00:00', { formatoId: 'mayorista' }) === 'mayorista');

    // ── Generar fondo ──────────────────────────────────────────────────────
    const base = { formato: 'post_vertical', campana: 'oferta_dia', estilo: 'moderno', productIds: [10] };
    let r = await pa.generarFondo(db, iaFalsa, A, dueño, { ...base, clave: 'k1' });
    check('sin Vercel Blob no genera (ni cobra)', r.error === 'SIN_ALMACENAMIENTO' && llamadas.generate === 0);
    process.env.BLOB_READ_WRITE_TOKEN = 'falso';

    r = await pa.generarFondo(db, iaFalsa, A, dueño, { ...base, productIds: [20], clave: 'k0' });
    check('un producto de OTRA empresa no sirve', !r.success && llamadas.generate === 0, r.error);

    r = await pa.generarFondo(db, iaFalsa, A, dueño, { ...base, clave: 'k1' });
    const fondo1 = r.fondo?.id;
    check('genera el fondo', r.success && !!r.dataUrl && llamadas.generate === 1);
    check('pidió el modelo y la medida correctos', llamadas.ultimo?.model === 'gpt-image-2.5-flare' && llamadas.ultimo?.size === '1024x1536' && llamadas.ultimo?.n === 1);
    const fila1 = (await db.execute({ sql: 'SELECT * FROM ad_backgrounds WHERE id = ?', args: [fondo1] })).rows[0];
    check('queda "lista" con tokens y costo', fila1?.status === 'lista' && Number(fila1.output_tokens) === 343 && Math.abs(Number(fila1.cost_usd) - (172 * 5 + 343 * 30) / 1e6) < 1e-9, String(fila1?.cost_usd));
    check('el archivo va a la carpeta de la empresa, privado', String(fila1?.url).includes(`publicidad/${A}/fondos/`) && guardados.get(fila1.url)?.access === 'private');
    check('el consumo queda en ai_usage (0 créditos)', await cuenta("SELECT COUNT(*) n FROM ai_usage WHERE company_id = 'acme' AND kind = 'imagen' AND credits = 0") === 1);

    r = await pa.generarFondo(db, iaFalsa, A, dueño, { ...base, clave: 'k1' });
    check('doble clic (misma clave): no vuelve a llamar a la IA', r.success && r.repetido && llamadas.generate === 1);

    fallarCon = Object.assign(new Error('rate'), { status: 429 });
    r = await pa.generarFondo(db, iaFalsa, A, dueño, { ...base, clave: 'k2' });
    check('error de la IA: mensaje claro', !r.success && r.error === 'IA' && /demasiados pedidos/.test(r.message));
    check('el fallido no cuenta para el cupo', (await pa.cupoPublicidad(db, A)).usados === 1);
    fallarCon = null;
    r = await pa.generarFondo(db, iaFalsa, A, dueño, { ...base, clave: 'k2' });
    check('reintentar tras un error con la misma clave sí genera', r.success && !r.repetido);

    await db.execute({ sql: "INSERT INTO ad_backgrounds (company_id, user_id, status, mode, model, client_key, created_at) VALUES ('acme', 1, 'pendiente', 'fondo', 'x', 'k3', ?)", args: [new Date().toISOString()] });
    const antes = llamadas.generate;
    r = await pa.generarFondo(db, iaFalsa, A, dueño, { ...base, clave: 'k4' });
    check('con otro fondo generándose, no arranca otro', r.error === 'GENERANDO' && llamadas.generate === antes);
    r = await pa.generarFondo(db, iaFalsa, A, dueño, { ...base, clave: 'k3' });
    check('la misma clave en curso: "ya se está generando"', r.error === 'GENERANDO');
    await db.execute({ sql: "UPDATE ad_backgrounds SET created_at = ? WHERE client_key = 'k3'", args: [new Date(Date.now() - 240_000).toISOString()] });
    r = await pa.generarFondo(db, iaFalsa, A, dueño, { ...base, clave: 'k3' });
    check('uno colgado (+3 min) no traba para siempre', r.success);

    r = await pa.generarFondo(db, iaFalsa, A, dueño, { ...base, productIds: [10, 11], modo: 'integrado', clave: 'k5' });
    check('integrar es para un solo producto', !r.success && llamadas.edit === 0);
    r = await pa.generarFondo(db, iaFalsa, A, dueño, { ...base, productIds: [11], modo: 'integrado', clave: 'k6' });
    check('integrar sin foto: avisa y no llama a la IA', !r.success && /no tiene foto/.test(r.message) && llamadas.edit === 0);
    check('ni anota un intento (no gasta ritmo)', await cuenta("SELECT COUNT(*) n FROM ad_backgrounds WHERE client_key = 'k6'") === 0);
    r = await pa.generarFondo(db, iaFalsa, A, dueño, { ...base, modo: 'integrado', clave: 'k7' });
    check('integrar con foto: usa edición con la foto real', r.success && llamadas.edit === 1 && llamadas.ultimo?.model === 'gpt-image-2.5-sunburst' && !!llamadas.ultimo?.image);
    check('sin input_fidelity (sunburst lo rechaza)', !('input_fidelity' in (llamadas.ultimo || {})));

    // ── Ajustar un fondo ya generado ───────────────────────────────────────
    const escena = r.fondo.id;
    const ahoraIso = new Date().toISOString();
    r = await pa.generarFondo(db, iaFalsa, A, dueño, { ...base, modo: 'ajuste', baseId: fondo1, cambio: '   ', clave: 'a0' });
    check('ajustar sin decir qué: no llama a la IA', !r.success && llamadas.edit === 1);
    const ajena = (await db.execute({ sql: "INSERT INTO ad_backgrounds (company_id, status, mode, model, url, created_at) VALUES ('otra', 'lista', 'fondo', 'x', 'https://falso.blob/ajena', ?) RETURNING id", args: [ahoraIso] })).rows[0].id;
    r = await pa.generarFondo(db, iaFalsa, A, dueño, { ...base, modo: 'ajuste', baseId: ajena, cambio: 'Más luminoso', clave: 'a1' });
    check('no se ajusta un fondo de otra empresa', !r.success && /no encontrado/.test(r.error) && llamadas.edit === 1);
    r = await pa.generarFondo(db, iaFalsa, A, dueño, { ...base, modo: 'ajuste', baseId: fondo1, cambio: 'Más luminoso', clave: 'a2' });
    check('ajustar: edita el fondo elegido con el modelo de edición',
        r.success && llamadas.edit === 2 && llamadas.ultimo?.model === 'gpt-image-2.5-sunburst' && !!llamadas.ultimo?.image && /«Más luminoso»/.test(llamadas.ultimo?.prompt));
    const filaAjuste = (await db.execute({ sql: 'SELECT mode, size, status FROM ad_backgrounds WHERE id = ?', args: [r.fondo.id] })).rows[0];
    check('el ajuste es un fondo nuevo, el original queda', filaAjuste?.status === 'lista' && filaAjuste.mode === 'fondo' && r.fondo.id !== fondo1 && guardados.has(fila1.url));
    r = await pa.generarFondo(db, iaFalsa, A, dueño, { ...base, modo: 'ajuste', baseId: escena, cambio: 'más cálido', clave: 'a3' });
    check('ajustar una escena integrada: sigue integrada y cuida el envase', r.success && r.fondo.modo === 'integrado' && /EXACTAMENTE igual/.test(llamadas.ultimo?.prompt));
    const sinArchivo = (await db.execute({ sql: "INSERT INTO ad_backgrounds (company_id, status, mode, model, url, created_at) VALUES ('acme', 'lista', 'fondo', 'x', 'https://falso.blob/borrado', ?) RETURNING id", args: [ahoraIso] })).rows[0].id;
    const editsAntes = llamadas.edit;
    r = await pa.generarFondo(db, iaFalsa, A, dueño, { ...base, modo: 'ajuste', baseId: sinArchivo, cambio: 'más cálido', clave: 'a4' });
    check('si el fondo no se puede leer: avisa, sin IA y sin anotar',
        !r.success && llamadas.edit === editsAntes && await cuenta("SELECT COUNT(*) n FROM ad_backgrounds WHERE client_key = 'a4'") === 0);
    r = await pa.generarFondo(db, iaFalsa, A, dueño, { ...base, formato: 'horizontal', clave: 'h1' });
    check('formato horizontal: pide 1536x1024 y deja libre la derecha', r.success && llamadas.ultimo?.size === '1536x1024' && /40 % derecho/.test(llamadas.ultimo?.prompt));
    r = await pa.generarFondo(db, iaFalsa, A, dueño, { ...base, formato: 'cuadrado', clave: 'c1' });
    check('cuadrado: se genera vertical (más barato y con lugar para mover el encuadre)', r.success && llamadas.ultimo?.size === '1024x1536');
    r = await pa.generarFondo(db, iaFalsa, A, dueño, { ...base, formato: 'personalizado', ancho: 1000, alto: 1000, clave: 'c2' });
    check('personalizado casi cuadrado: también vertical', r.success && llamadas.ultimo?.size === '1024x1536');
    // Kevin, 29-oct-2026: lo que se sube con «Agregar imagen» es un complemento, no un producto: la IA no lo ve.
    const generadosAntes = llamadas.generate + llamadas.edit;
    r = await pa.generarFondo(db, iaFalsa, A, dueño, { ...base, productIds: [], libres: ['Queso de cabra artesanal'], clave: 'l1' });
    check('sin productos del inventario no hay fondo (lo subido ya no cuenta como producto)',
        !r.success && /al menos un producto/.test(r.error) && llamadas.generate + llamadas.edit === generadosAntes);

    check('ritmo: 5 en un minuto frena', await pa.ritmoPublicidadExcedido(db, A));
    check('el ritmo es por empresa', !(await pa.ritmoPublicidadExcedido(db, B)));
    for (let i = 0; i < pa.CUPO_IMAGENES_MES; i++) await db.execute({ sql: "INSERT INTO ad_backgrounds (company_id, status, mode, model, created_at) VALUES ('otra', 'lista', 'fondo', 'x', ?)", args: [new Date().toISOString()] });
    check('cupo: 200 en el mes = agotado', (await pa.cupoPublicidad(db, B)).agotado);
    check('el cupo de una empresa no toca a la otra', !(await pa.cupoPublicidad(db, A)).agotado);

    // ── Con chat ───────────────────────────────────────────────────────────
    const chatBase = { formato: 'post_vertical', moneda: 'CLP' };
    const gen0 = llamadas.generate, edit0 = llamadas.edit;
    r = await pa.generarChat(db, iaFalsa, A, dueño, { ...chatBase, pedido: '   ', clave: 'ch0' });
    check('chat sin pedido: no llama a nada', !r.success && llamadas.texto === 0 && llamadas.generate === gen0);
    r = await pa.generarChat(db, iaFalsa, A, dueño, { ...chatBase, pedido: 'Oferta de bebidas', productIds: [20], clave: 'ch1' });
    check('chat con un producto de otra empresa: rechazado sin IA', !r.success && llamadas.texto === 0);
    r = await pa.generarChat(db, iaFalsa, A, dueño, { ...chatBase, pedido: 'Oferta de bebidas', imagenes: ['data:text/html;base64,AAAA'], clave: 'ch2' });
    check('chat con una imagen que no es imagen: rechazado', !r.success && llamadas.texto === 0);

    r = await pa.generarChat(db, iaFalsa, A, dueño, { ...chatBase, pedido: 'Publicidad de bebidas a $990 con fondo de playa', clave: 'ch3' });
    const chat1 = r.fondo?.id;
    check('chat nuevo: crea con el modelo de generación (sin referencias)', r.success && r.accion === 'nueva' && r.fondo.modo === 'chat' && llamadas.generate === gen0 + 1 && llamadas.ultimo.model === 'gpt-image-2.5-flare');
    check('chat: el director de arte lee el pedido y su prompt va a la IA', llamadas.texto === 1 && /Pedido nuevo: «Publicidad de bebidas a \$990/.test(llamadas.textoUltimo.input)
        && /Imagen actual: no/.test(llamadas.textoUltimo.input) && llamadas.ultimo.prompt.startsWith('PROMPT DEL DIRECTOR'));
    check('chat: con tope de tiempo para el director (no se come los 60 s)', llamadas.textoOpciones?.timeout === 15_000);
    check('chat: se pide a la medida del formato (4:5 → 1120×1408), sin franja que se recorte', llamadas.ultimo.size === '1120x1408' && /margen de respiro/.test(llamadas.ultimo.prompt) && !/se recorta/.test(llamadas.ultimo.prompt), llamadas.ultimo.size);
    const filaChat = (await db.execute({ sql: 'SELECT * FROM ad_backgrounds WHERE id = ?', args: [chat1] })).rows[0];
    check('chat: la imagen queda guardada como "chat", con el costo del director sumado',
        filaChat.mode === 'chat' && filaChat.status === 'lista' && String(filaChat.url).includes(`publicidad/${A}/chat/`)
        && Math.abs(Number(filaChat.cost_usd) - ((172 * 5 + 343 * 30) / 1e6 + (800 * 0.2 + 300 * 1.2) / 1e6)) < 1e-9, String(filaChat.cost_usd));
    check('chat: cuenta para el cupo como cualquier imagen', (await pa.cupoPublicidad(db, A)).usados === await cuenta("SELECT COUNT(*) n FROM ad_backgrounds WHERE company_id = 'acme' AND status = 'lista'"));
    r = await pa.generarChat(db, iaFalsa, A, dueño, { ...chatBase, pedido: 'Publicidad de bebidas a $990 con fondo de playa', clave: 'ch3' });
    check('chat: doble clic no genera dos veces', r.success && r.repetido && llamadas.texto === 1);

    directorDice = { accion: 'editar', prompt: 'el fondo en rojo' };
    r = await pa.generarChat(db, iaFalsa, A, dueño, { ...chatBase, pedido: 'ponele el fondo rojo', baseId: chat1, anteriores: ['Publicidad de bebidas a $990 con fondo de playa'], clave: 'ch4' });
    check('chat: un cambio edita la imagen actual', r.success && r.accion === 'editar' && llamadas.edit === edit0 + 1 && llamadas.ultimo.model === 'gpt-image-2.5-sunburst'
        && /^La primera imagen es la publicidad actual\. Editala aplicando SOLO esto: el fondo en rojo/.test(llamadas.ultimo.prompt));
    check('chat: el director ve que hay imagen y lo que se pidió antes', /Imagen actual: sí/.test(llamadas.textoUltimo.input) && /1\) «Publicidad de bebidas/.test(llamadas.textoUltimo.input));
    const chat2 = r.fondo.id;
    directorDice = { accion: 'nueva', prompt: 'Otra publicidad de Navidad' };
    r = await pa.generarChat(db, iaFalsa, A, dueño, { ...chatBase, pedido: 'ahora una de Navidad para el pan', baseId: chat2, clave: 'ch5' });
    check('chat: algo distinto crea otra (sin partir de la actual)', r.success && r.accion === 'nueva' && llamadas.ultimo.model === 'gpt-image-2.5-flare' && !/primera imagen/.test(llamadas.ultimo.prompt));
    directorFalla = true;
    r = await pa.generarChat(db, iaFalsa, A, dueño, { ...chatBase, pedido: 'más grande el precio', baseId: chat2, clave: 'ch6' });
    check('chat: si el director falla, igual cambia la actual con el pedido tal cual', r.success && r.accion === 'editar' && /«más grande el precio»/.test(llamadas.ultimo.prompt));
    directorFalla = false;
    directorDice = { accion: 'nueva', prompt: 'Arroz en oferta' };
    const editAntes = llamadas.edit;
    r = await pa.generarChat(db, iaFalsa, A, dueño, { ...chatBase, formato: 'cuadrado', pedido: 'arroz en oferta', productIds: [10, 11], imagenes: [JPG_CHAT], clave: 'ch7' });
    check('chat con productos: el director recibe nombre y precios con formato', /Arroz Tucapel 1 kg: precio normal \$1\.590, precio de oferta \$1\.290/.test(llamadas.textoUltimo.input) && /Aceite Belmont 900 ml: precio normal \$2\.990\./.test(llamadas.textoUltimo.input));
    check('chat con productos: edición con la foto real y la subida, cuidando el envase',
        r.success && llamadas.edit === editAntes + 1 && Array.isArray(llamadas.ultimo.image) && llamadas.ultimo.image.length === 2 && /EXACTAMENTE esos envases/.test(llamadas.ultimo.prompt) && /subió el cliente/.test(llamadas.ultimo.prompt));
    check('chat cuadrado: se genera cuadrado (no se recorta un tercio de textos)', llamadas.ultimo.size === '1024x1024' && /margen de respiro/.test(llamadas.ultimo.prompt));
    const ajenaChat = (await db.execute({ sql: "INSERT INTO ad_backgrounds (company_id, status, mode, model, url, created_at) VALUES ('otra', 'lista', 'chat', 'x', 'https://falso.blob/ajena-chat', ?) RETURNING id", args: [new Date().toISOString()] })).rows[0].id;
    const textoAntes = llamadas.texto;
    r = await pa.generarChat(db, iaFalsa, A, dueño, { ...chatBase, pedido: 'cambiale el color', baseId: ajenaChat, clave: 'ch8' });
    check('chat: no se edita una imagen de otra empresa', !r.success && llamadas.texto === textoAntes);
    // Pasarla a otro formato con un toque: sin pedido escrito y sin director.
    const textoAntesAdaptar = llamadas.texto, editAntesAdaptar = llamadas.edit;
    r = await pa.generarChat(db, iaFalsa, A, dueño, { ...chatBase, formato: 'mayorista', adaptar: true, baseId: chat2, clave: 'ad0' });
    check('adaptar a la misma proporción (4:5 → mayorista 4:5): no gasta', !r.success && r.error === 'MISMA_FORMA' && llamadas.edit === editAntesAdaptar);
    r = await pa.generarChat(db, iaFalsa, A, dueño, { ...chatBase, formato: 'horizontal', adaptar: true, clave: 'ad1' });
    check('adaptar sin imagen: rechazado', !r.success && llamadas.edit === editAntesAdaptar);
    r = await pa.generarChat(db, iaFalsa, A, dueño, { ...chatBase, formato: 'horizontal', adaptar: true, baseId: chat2, productIds: [10], imagenes: [JPG_CHAT], clave: 'ad2' });
    check('adaptar vertical → horizontal: edita la actual, sin director y sin escribir nada',
        r.success && r.accion === 'editar' && llamadas.texto === textoAntesAdaptar && llamadas.edit === editAntesAdaptar + 1 && llamadas.ultimo.size === '1728x912'
        && !Array.isArray(llamadas.ultimo.image) && /^Esta imagen es la actual\. Pasala a una imagen horizontal/.test(llamadas.ultimo.prompt), llamadas.ultimo.prompt.slice(0, 80));
    check('adaptar: si tiene textos, los reparte usando todo el ancho (lo que Kevin tuvo que pedir a mano el 27-oct)',
        /Si tiene titular, precio u otros textos, reacomodalos[^.]*el producto grande a un lado y los textos al otro, usando todo el ancho/.test(llamadas.ultimo.prompt));
    // Kevin, 28-oct-2026: un arroz solo sobre blanco, pasado a 800×800, volvió con granos, cuchara y un sello "PESO NETO".
    check('adaptar: no agrega nada y un fondo liso sigue liso (no "llenar" ni "colores ricos")',
        /sin agregar nada: ningún elemento, adorno, sello, texto ni precio/.test(llamadas.ultimo.prompt) && /si es liso \(por ejemplo blanco\), sigue liso/.test(llamadas.ultimo.prompt)
        && !/franjas|llenar|colores ricos|publicidad terminada|entre comillas/.test(llamadas.ultimo.prompt));
    const aCuadrado = pa.armarPromptChat({ accion: 'editar', prompt: '«Pasarla a Personalizado (800×800)»', formato: 'personalizado', ancho: 800, alto: 800, size: pa.sizeChat('personalizado', 800, 800), adaptar: true });
    check('adaptar a 800×800: cuadrada, sin dar por hecho que hay precio, y el producto solo se agranda sin cortarlo',
        /Pasala a una imagen cuadrada/.test(aCuadrado) && !/el precio bien visible/.test(aCuadrado) && /Si es solo un producto, agrandalo lo que permita la medida, sin cortarlo/.test(aCuadrado), aCuadrado.slice(0, 120));
    const filaAdaptada = (await db.execute({ sql: 'SELECT prompt, size, cost_usd FROM ad_backgrounds WHERE id = ?', args: [r.fondo.id] })).rows[0];
    // chat2 fue la misma edición pero con director: la adaptada cuesta eso menos el director.
    const costoChat2 = Number((await db.execute({ sql: 'SELECT cost_usd FROM ad_backgrounds WHERE id = ?', args: [chat2] })).rows[0].cost_usd);
    check('adaptar: queda anotada horizontal y sin costo de director',
        filaAdaptada.size === '1728x912' && Math.abs(Number(filaAdaptada.cost_usd) - (costoChat2 - (800 * 0.2 + 300 * 1.2) / 1e6)) < 1e-9, `${filaAdaptada.cost_usd} vs ${costoChat2}`);
    const chatAdaptada = r.fondo.id;
    directorDice = { accion: 'editar', prompt: 'pasala a horizontal' };
    r = await pa.generarChat(db, iaFalsa, A, dueño, { ...chatBase, formato: 'horizontal', pedido: 'ahora para esa dimensión', baseId: chat2, clave: 'ad3' });
    check('escrito a mano, un cambio de forma también reacomoda (no "composición igual")',
        r.success && /Pasala a una imagen horizontal/.test(llamadas.ultimo.prompt) && /usando todo el ancho/.test(llamadas.ultimo.prompt) && !/composición\./.test(llamadas.ultimo.prompt));
    check('escrito a mano con cambio de forma: no agrega nada más que el cambio pedido',
        /sin agregar nada más que el cambio pedido/.test(llamadas.ultimo.prompt) && /Editala aplicando SOLO esto: pasala a horizontal/.test(llamadas.ultimo.prompt));
    await db.execute({ sql: 'DELETE FROM ad_backgrounds WHERE id = ?', args: [r.fondo.id] });
    check('zona segura (si la medida no coincide): historia se recorta a los costados, horizontal arriba y abajo',
        /izquierda/.test(pa.zonaSegura('historia', 0, 0, '1024x1536')) && /de arriba/.test(pa.zonaSegura('horizontal', 0, 0, '1536x1024')));
    // Kevin, 27-oct-2026: pasada a 1200×628 salía 1536×1024 con relleno. Ahora, a la medida.
    const medidas = [['post_vertical'], ['historia'], ['horizontal'], ['cartel'], ['mayorista'], ['personalizado', 1754, 1240], ['personalizado', 2400, 300], ['personalizado', 300, 2400], ['personalizado', 2400, 1000]]
        .map(([f, a, b]) => ({ f, a, b, s: pa.sizeChat(f, a, b) }));
    const dentroDeLaIA = (s) => { const [w, h] = s.split('x').map(Number); return w % 16 === 0 && h % 16 === 0 && w * h >= 655360 && w * h <= 8294400 && Math.max(w, h) <= 3840 && w / h <= 3 && h / w <= 3; };
    check('medidas a pedido: todas dentro de lo que acepta la IA (múltiplos de 16, 1:3 a 3:1, píxeles)', medidas.every(m => dentroDeLaIA(m.s)), medidas.map(m => m.s).join(' '));
    check('medidas a pedido: la proporción de cada formato a menos de 1 %, salvo la que pasa de 3:1',
        pa.sizeChat('horizontal') === '1728x912' && pa.sizeChat('post_vertical') === '1120x1408' && pa.sizeChat('historia') === '944x1680' && pa.sizeChat('cartel') === '1056x1488'
        && pa.sizeChat('personalizado', 1754, 1240) === '1488x1056' && pa.sizeChat('personalizado', 2400, 300) === '2160x720' && pa.sizeChat('cuadrado') === '1024x1024');
    check('medidas a pedido: mismos píxeles que 1024×1536 (el mismo costo), ±2 %', medidas.filter(m => m.f !== 'personalizado' || m.a !== 2400 || m.b !== 300).every(m => { const [w, h] = m.s.split('x').map(Number); return Math.abs(w * h / (1024 * 1536) - 1) < 0.02; }));
    check('misma proporción: 4:5 y mayorista sí, 4:5 e historia no', pa.mismaProporcion(pa.sizeChat('post_vertical'), pa.sizeChat('mayorista')) && !pa.mismaProporcion(pa.sizeChat('post_vertical'), pa.sizeChat('historia')) && !pa.mismaProporcion(null, '1024x1024'));
    // Las del chat se guardan sin productos y se llevan sus versiones.
    r = await pa.guardarDiseno(db, A, dueño, {
        formato: 'post_vertical', status: 'final', productos: [], backgroundId: chat2,
        layout: { modo: 'chat', mensajes: [{ texto: 'a', fondoId: chat1 }, { texto: 'b', fondoId: chat2, desde: chat1 }] }, finalJpeg: JPG_CHAT, miniatura: JPG_CHAT,
    });
    check('chat: se guarda sin productos del inventario', r.success, r.error);
    check('chat: las versiones quedan de esa publicidad (se borran con ella)', await cuenta('SELECT COUNT(*) n FROM ad_backgrounds WHERE id IN (?, ?) AND design_id = ?', [chat1, chat2, r.id]) === 2);
    const listaChat = await pa.listarDisenos(db, A, {});
    check('chat: el historial la marca como hecha con chat', listaChat.disenos.find(x => x.id === r.id)?.conChat === true && listaChat.disenos.find(x => x.id === r.id)?.title === 'Publicidad con chat');
    r = await pa.guardarDiseno(db, A, dueño, { formato: 'post_vertical', productos: [] });
    check('la rápida sigue pidiendo productos', !r.success);
    r = await pa.eliminarDiseno(db, A, { id: listaChat.disenos.find(x => x.conChat).id });
    check('chat: eliminarla borra sus versiones', r.success && await cuenta('SELECT COUNT(*) n FROM ad_backgrounds WHERE id IN (?, ?)', [chat1, chat2]) === 0);
    // La misma del chat guardada en dos formatos: comparten versiones.
    const vPost = (await db.execute({ sql: "INSERT INTO ad_backgrounds (company_id, status, mode, model, size, url, created_at) VALUES (?, 'lista', 'chat', 'x', '1024x1536', 'https://falso.blob/v-post', ?) RETURNING id", args: [A, new Date().toISOString()] })).rows[0].id;
    const capaChat = (ids) => ({ modo: 'chat', mensajes: ids.map(fondoId => ({ texto: 't', fondoId })) });
    const dPost = (await pa.guardarDiseno(db, A, dueño, { formato: 'post_vertical', status: 'final', productos: [], backgroundId: vPost, layout: capaChat([vPost]), finalJpeg: JPG_CHAT })).id;
    const dHoriz = (await pa.guardarDiseno(db, A, dueño, { formato: 'horizontal', status: 'final', productos: [], backgroundId: chatAdaptada, layout: capaChat([vPost, chatAdaptada]), finalJpeg: JPG_CHAT })).id;
    await pa.eliminarDiseno(db, A, { id: dPost });
    const vPostDespues = (await db.execute({ sql: 'SELECT design_id FROM ad_backgrounds WHERE id = ?', args: [vPost] })).rows[0];
    check('dos formatos: borrar una no borra la versión que usa la otra (pasa a la otra)', vPostDespues && Number(vPostDespues.design_id) === dHoriz, JSON.stringify(vPostDespues));
    await pa.eliminarDiseno(db, A, { id: dHoriz });
    check('dos formatos: borrar la última se lleva todas las versiones', await cuenta('SELECT COUNT(*) n FROM ad_backgrounds WHERE id IN (?, ?)', [vPost, chatAdaptada]) === 0);

    // ── Guardar: copia de precios, aislamiento, inventario intacto ─────────
    const invAntes = JSON.stringify((await db.execute('SELECT * FROM products ORDER BY id')).rows);
    const JPG = `data:image/jpeg;base64,${PNG_1PX}`;
    r = await pa.guardarDiseno(db, A, dueño, {
        formato: 'post_vertical', campana: 'oferta_dia', estilo: 'moderno', backgroundId: fondo1,
        productos: [
            { productId: 10, precioPublicidad: 990, nombre: 'NOMBRE INVENTADO', etiqueta: 'OFERTA' },
            { productId: 11, precioPublicidad: 29900, presentacionId: 5, fotoPropia: JPG },
        ],
        textos: { titulo: 'OFERTA DEL DÍA' }, layout: { colores: null }, finalJpeg: JPG, miniatura: JPG,
    });
    const d1 = r.id;
    check('guarda la publicidad', r.success && d1 > 0, r.error);
    const g = (await pa.obtenerDiseno(db, A, { id: d1 })).diseno;
    const arroz = g.productos.find(p => p.productId === 10);
    const aceite = g.productos.find(p => p.productId === 11);
    check('el nombre sale del inventario, no del navegador', arroz.nombre === 'Arroz Tucapel 1 kg');
    check('precio normal y de oferta del momento', arroz.precioNormal === 1590 && arroz.precioOferta === 1290);
    check('el precio de la publicidad es el elegido', arroz.precioPublicidad === 990 && aceite.precioPublicidad === 29900);
    check('cada precio con SU producto (por id)', g.productos[0].productId === 10 && g.productos[1].productId === 11);
    check('la caja del aceite queda en la copia', aceite.presentacion?.id === 5 && aceite.presentacion.unidades === 12);
    check('la foto subida va a Blob de la empresa', String(aceite.fotoUrl).includes(`publicidad/${A}/fotos/11`));
    check('el inventario NO cambió', JSON.stringify((await db.execute('SELECT * FROM products ORDER BY id')).rows) === invAntes);
    check('el fondo quedó ligado a la publicidad', await cuenta('SELECT COUNT(*) n FROM ad_backgrounds WHERE id = ? AND design_id = ?', [fondo1, d1]) === 1);

    await db.execute("UPDATE products SET price = 1990 WHERE id = 10");
    const g2 = (await pa.obtenerDiseno(db, A, { id: d1 })).diseno;
    check('si el producto cambia de precio, la publicidad guardada no', g2.productos[0].precioNormal === 1590 && g2.productos[0].precioPublicidad === 990);

    r = await pa.guardarDiseno(db, A, dueño, { formato: 'post_vertical', productos: [{ productId: 20, precioPublicidad: 1 }] });
    check('no se puede guardar con un producto de otra empresa', !r.success);
    r = await pa.guardarDiseno(db, A, dueño, { formato: 'post_vertical', productos: [{ productId: 11, precioPublicidad: 1, presentacionId: 6 }] });
    check('una caja de otra empresa se ignora', r.success && r.productos[0].presentacion === null);
    const d2 = r.id;
    r = await pa.guardarDiseno(db, B, { uid: 3 }, { id: d1, formato: 'post_vertical', productos: [{ productId: 20, precioPublicidad: 1 }] });
    check('otra empresa no puede pisar una publicidad ajena', !r.success && /no encontrada/.test(r.error));
    r = await pa.guardarDiseno(db, A, dueño, { formato: 'post_vertical', productos: [{ productId: 10, precioPublicidad: 1 }], backgroundId: (await db.execute("SELECT id FROM ad_backgrounds WHERE company_id = 'otra' LIMIT 1")).rows[0].id });
    check('ni usar un fondo de otra empresa', !r.success && /Fondo/.test(r.error));
    r = await pa.guardarDiseno(db, A, dueño, { formato: 'post_vertical', productos: [{ productId: 10, precioPublicidad: -5 }] });
    check('precio negativo: rechazado', !r.success);
    r = await pa.guardarDiseno(db, A, dueño, { formato: 'post_vertical', productos: [{ productId: 10, precioPublicidad: 1 }], layout: { x: 'a'.repeat(21000) } });
    check('un diseño gigante se rechaza (no se corta el JSON)', !r.success);

    const finalViejo = g.finalUrl;
    r = await pa.guardarDiseno(db, A, dueño, { id: d1, formato: 'post_vertical', productos: [{ productId: 10, precioPublicidad: 950 }], finalJpeg: JPG, backgroundId: fondo1 });
    check('al reemplazar la imagen final, la vieja se borra', r.success && !guardados.has(finalViejo) && guardados.has(r.finalUrl));
    check('y la foto que ya no se usa también', !guardados.has(aceite.fotoUrl));

    // ── Imágenes agregadas encima (Kevin, 29-oct-2026: "que entre como un elemento… logos o más cosas") ──
    const invAntesImagenes = JSON.stringify((await db.execute('SELECT * FROM products ORDER BY id')).rows);
    const PNG = `data:image/png;base64,${PNG_1PX}`;
    let ri = await pa.guardarDiseno(db, A, dueño, {
        formato: 'post_vertical', status: 'final',
        productos: [{ productId: 10, precioPublicidad: 990 }],
        imagenes: [{ id: 'img-logo-1', foto: PNG, quitarFondo: true }, { id: 'img-sello-2', foto: JPG, quitarFondo: false }],
        layout: { mover: { 'img-logo-1': { x: 0.3, y: -0.4, escala: 0.6 } }, imagenes: [{ id: 'img-falsa', fotoUrl: 'https://otro.sitio/x.png' }] },
    });
    const dImg = ri.id;
    const layImg = ri.success ? (await pa.obtenerDiseno(db, A, { id: dImg })).diseno.layout : {};
    const [logo, sello] = layImg.imagenes || [];
    check('imágenes agregadas: quedan en el diseño, no como productos',
        ri.success && ri.productos.length === 1 && layImg.imagenes?.length === 2 && logo.id === 'img-logo-1' && logo.quitarFondo === true && sello.quitarFondo === false, ri.error);
    check('van a Blob de la empresa y se leen de nuevo',
        String(logo?.fotoUrl).includes(`publicidad/${A}/imagenes/img-logo-1`) && (await pa.imagenDeLaEmpresa(db, A, { url: logo.fotoUrl })).success && ri.imagenes?.[1]?.fotoUrl === sello.fotoUrl);
    check('su lugar queda en mover; una URL ajena metida en el layout no se guarda',
        layImg.mover?.['img-logo-1']?.escala === 0.6 && !JSON.stringify(layImg).includes('otro.sitio'));
    check('otra empresa no puede leerlas', !(await pa.imagenDeLaEmpresa(db, B, { url: logo.fotoUrl })).success);
    check('el inventario NO cambió', JSON.stringify((await db.execute('SELECT * FROM products ORDER BY id')).rows) === invAntesImagenes);
    ri = await pa.guardarDiseno(db, A, dueño, { formato: 'post_vertical', textos: { titulo: 'CERRADO POR INVENTARIO' }, imagenes: [{ id: 'img-solo-1', fotoUrl: logo.fotoUrl }] });
    const dOtraImg = ri.id;
    check('solo imágenes y textos (sin productos) también se guarda, reusando una ya guardada', ri.success && ri.imagenes?.[0]?.fotoUrl === logo.fotoUrl, ri.error);
    ri = await pa.guardarDiseno(db, A, dueño, { formato: 'post_vertical', productos: [] });
    check('sin productos ni imágenes: rechazado', !ri.success);
    ri = await pa.guardarDiseno(db, A, dueño, { formato: 'post_vertical', imagenes: [1, 2, 3, 4, 5].map(n => ({ id: `img-${n}`, foto: PNG })) });
    check(`más de ${pa.MAX_IMAGENES} imágenes: rechazado`, !ri.success && /hasta 4/.test(ri.error));
    ri = await pa.guardarDiseno(db, A, dueño, { formato: 'post_vertical', imagenes: [{ id: 'titulo', foto: PNG }] });
    check('un id que no es de imagen (se pisaría con el título): rechazado', !ri.success && ri.error === 'Imagen no válida');
    ri = await pa.guardarDiseno(db, A, dueño, { formato: 'post_vertical', imagenes: [{ id: 'img-a', foto: PNG }, { id: 'img-a', foto: PNG }] });
    check('dos con el mismo id: rechazado', !ri.success && ri.error === 'Imagen no válida');
    ri = await pa.guardarDiseno(db, A, dueño, { formato: 'post_vertical', imagenes: [{ id: 'img-a', fotoUrl: 'https://falso.blob/publicidad/otra/imagenes/x.png' }] });
    check('una URL que no está en ninguna publicidad de la empresa: rechazada', !ri.success && ri.error === 'Imagen no encontrada');
    ri = await pa.guardarDiseno(db, B, { uid: 3 }, { formato: 'post_vertical', imagenes: [{ id: 'img-a', fotoUrl: logo.fotoUrl }] });
    check('ni la de otra empresa', !ri.success && ri.error === 'Imagen no encontrada');
    ri = await pa.guardarDiseno(db, A, dueño, { formato: 'post_vertical', imagenes: [{ id: 'img-a', foto: 'data:text/html;base64,PGgxPg==' }] });
    check('un archivo que no es imagen: rechazado', !ri.success && /no es válida/.test(ri.error));
    ri = await pa.guardarDiseno(db, A, dueño, { formato: 'post_vertical', imagenes: [{ id: 'img-1', foto: PNG }, { id: 'img-2', foto: PNG }] });
    const dos = ri.imagenes;
    ri = await pa.guardarDiseno(db, A, dueño, { id: ri.id, formato: 'post_vertical', imagenes: [{ id: 'img-1', fotoUrl: dos[0].fotoUrl }] });
    check('al actualizarla sin una imagen, la que sacó se borra y la otra queda', ri.success && guardados.has(dos[0].fotoUrl) && !guardados.has(dos[1].fotoUrl));
    await pa.eliminarDiseno(db, A, { id: ri.id });
    await pa.eliminarDiseno(db, A, { id: dImg });
    check('al borrar la original, el logo que usa la otra NO se borra; el sello sí', guardados.has(logo.fotoUrl) && !guardados.has(sello.fotoUrl));
    await pa.eliminarDiseno(db, A, { id: dOtraImg });
    check('al borrar la última que lo usa, se borra', !guardados.has(logo.fotoUrl));

    const lista = await pa.listarDisenos(db, A, {});
    check('el historial trae la miniatura', lista.disenos.find(x => x.id === d1)?.miniatura?.startsWith('data:image/jpeg'));
    check('el historial de la otra empresa está vacío', (await pa.listarDisenos(db, B, {})).disenos.length === 0);
    check('otra empresa no puede abrirla', !(await pa.obtenerDiseno(db, B, { id: d1 })).success);

    // ── Cada guardado es otra; el mismo nombre se numera (Kevin, 27-oct-2026) ──
    const conTitulo = (titulo, extra = {}) => pa.guardarDiseno(db, A, dueño, { formato: 'post_vertical', productos: [{ productId: 10, precioPublicidad: 1000 }], textos: { titulo }, ...extra });
    const n1 = await conTitulo('PROMO FINDE');
    const n2 = await conTitulo('PROMO FINDE');
    const n3 = await conTitulo('PROMO FINDE');
    check('mismo nombre: la primera queda igual y las siguientes #2, #3', n1.title === 'PROMO FINDE' && n2.title === 'PROMO FINDE #2' && n3.title === 'PROMO FINDE #3' && n1.nuevo && n3.nuevo, [n1.title, n2.title, n3.title].join(' | '));
    const n4 = await conTitulo('', { title: 'PROMO FINDE #2' });
    check('una abierta ("#2") y guardada con cambios sigue la cuenta: #4', n4.title === 'PROMO FINDE #4', n4.title);
    const u2 = await conTitulo('', { id: n2.id, status: 'final' });
    check('sin cambios (borrador → final) actualiza la misma y conserva su número', u2.id === n2.id && !u2.nuevo && u2.title === 'PROMO FINDE #2' && await cuenta("SELECT COUNT(*) n FROM ad_designs WHERE company_id = ? AND title LIKE 'PROMO FINDE%'", [A]) === 4, u2.title);
    const unico = await conTitulo('Liquidación #5');
    check('un nombre que no está queda tal cual, aunque termine en #', unico.title === 'Liquidación #5', unico.title);
    const raro = await conTitulo('50%_off');
    const raro2 = await conTitulo('50%_off');
    const otroRaro = await conTitulo('5000off');
    check('los % y _ del nombre no se toman como comodín', raro.title === '50%_off' && raro2.title === '50%_off #2' && otroRaro.title === '5000off', [raro2.title, otroRaro.title].join(' | '));
    const deB = await pa.guardarDiseno(db, B, { uid: 3 }, { formato: 'post_vertical', productos: [{ productId: 20, precioPublicidad: 1 }], textos: { titulo: 'PROMO FINDE' } });
    check('la numeración es por empresa', deB.success && deB.title === 'PROMO FINDE', deB.title || deB.error);
    const dup = await pa.duplicarDiseno(db, A, dueño, { id: n1.id });
    const dupTitulo = (await pa.obtenerDiseno(db, A, { id: dup.id })).diseno.title;
    check('duplicar también numera (no "(copia)")', dupTitulo === 'PROMO FINDE #5', dupTitulo);
    for (const x of [n1, n2, n3, n4, unico, raro, raro2, otroRaro, dup]) await pa.eliminarDiseno(db, A, { id: x.id });
    await pa.eliminarDiseno(db, B, { id: deB.id });

    // ── Imágenes: solo las de la empresa ───────────────────────────────────
    const img = await pa.imagenDeLaEmpresa(db, A, { url: r.finalUrl });
    check('la imagen final se entrega a su empresa', img.success && img.dataUrl.startsWith('data:image/jpeg;base64,'));
    check('a otra empresa no', !(await pa.imagenDeLaEmpresa(db, B, { url: r.finalUrl })).success);
    check('ni una URL cualquiera', !(await pa.imagenDeLaEmpresa(db, A, { url: 'https://falso.blob/otra-cosa' })).success);

    // ── Duplicar y eliminar ────────────────────────────────────────────────
    r = await pa.duplicarDiseno(db, A, dueño, { id: d1 });
    const copia = (await pa.obtenerDiseno(db, A, { id: r.id })).diseno;
    check('duplicar: borrador nuevo, con su origen y sin imagen final', copia.status === 'borrador' && copia.parentId === d1 && !copia.finalUrl && copia.productos[0].precioPublicidad === 950);
    check('otra empresa no puede duplicarla', !(await pa.duplicarDiseno(db, B, { uid: 3 }, { id: d1 })).success);
    const urlFondo1 = fila1.url;
    r = await pa.eliminarDiseno(db, A, { id: d1 });
    check('eliminar la original', r.success && await cuenta('SELECT COUNT(*) n FROM ad_designs WHERE id = ?', [d1]) === 0);
    check('el fondo que usa la copia NO se borra', guardados.has(urlFondo1) && await cuenta('SELECT COUNT(*) n FROM ad_backgrounds WHERE id = ?', [fondo1]) === 1);
    check('otra empresa no puede eliminar', !(await pa.eliminarDiseno(db, B, { id: d2 })).success && await cuenta('SELECT COUNT(*) n FROM ad_designs WHERE id = ?', [d2]) === 1);

    // ── Recortar un producto (Kevin, 30-oct-2026) ──────────────────────────
    const pr = pa.armarPromptRecorte('');
    check('recorte: fondo blanco puro y el producto exactamente igual',
        /fondo blanco puro/.test(pr) && /EXACTAMENTE igual/.test(pr) && /no corrijas su etiqueta/.test(pr) && /No agregues textos/.test(pr));
    check('recorte sin indicación: deja el producto principal', /dejá solo el principal/.test(pr));
    const prNota = pa.armarPromptRecorte('solo la botella de la izquierda');
    check('recorte con indicación: la del negocio, sin la regla general', /«solo la botella de la izquierda»/.test(prNota) && !/dejá solo el principal/.test(prNota));
    check('la indicación se corta', pa.armarPromptRecorte('x'.repeat(5000)).length < pr.length + 200);

    const editRec = llamadas.edit;
    const usadosAntes = (await pa.cupoPublicidad(db, A)).usados;
    r = await pa.generarRecorte(db, iaFalsa, A, dueño, { foto: JPG_CHAT, clave: 'rec-1' });
    const filaRec = (await db.execute({ sql: 'SELECT * FROM ad_backgrounds WHERE id = ?', args: [r.fondo?.id ?? -1] })).rows[0];
    check('recorte con la foto sacada: una edición con sunburst, cuadrada',
        r.success && llamadas.edit === editRec + 1 && llamadas.ultimo.model === pa.MODELO_INTEGRADO && llamadas.ultimo.size === '1024x1024' && /fondo blanco puro/.test(llamadas.ultimo.prompt));
    check('recorte: queda como imagen de la empresa, en su carpeta, y se devuelve',
        filaRec?.mode === 'recorte' && filaRec.status === 'lista' && /\/recortes\//.test(filaRec.url) && guardados.has(filaRec.url) && r.dataUrl?.startsWith('data:image/webp;base64,'));
    check('recorte: cuenta como una imagen del cupo', (await pa.cupoPublicidad(db, A)).usados === usadosAntes + 1);
    const repetido = await pa.generarRecorte(db, iaFalsa, A, dueño, { foto: JPG_CHAT, clave: 'rec-1' });
    check('recorte: la misma clave no genera ni cobra dos veces', repetido.success && repetido.repetido && repetido.fondo.id === r.fondo.id && llamadas.edit === editRec + 1);
    const recorteId = r.fondo.id;

    r = await pa.generarRecorte(db, iaFalsa, A, dueño, { productId: 10, nota: 'solo el paquete' });
    check('recorte con la foto del inventario: la lee de la base', r.success && llamadas.edit === editRec + 2 && /«solo el paquete»/.test(llamadas.ultimo.prompt));
    r = await pa.generarRecorte(db, iaFalsa, A, dueño, { productId: 11 });
    check('producto sin foto: SIN_FOTO, sin llamar a la IA', !r.success && r.error === 'SIN_FOTO' && llamadas.edit === editRec + 2);
    r = await pa.generarRecorte(db, iaFalsa, A, dueño, { productId: 20 });
    check('la foto de un producto de otra empresa: no', !r.success && llamadas.edit === editRec + 2);
    r = await pa.generarRecorte(db, iaFalsa, A, dueño, {});
    check('sin foto ni producto: no llama a la IA', !r.success && llamadas.edit === editRec + 2);
    r = await pa.generarRecorte(db, iaFalsa, A, dueño, { foto: 'data:text/html;base64,PGI+' });
    check('una foto que no es imagen: no', !r.success && llamadas.edit === editRec + 2);

    // Guardarlo en el Historial: sin productos, con la foto ya sobre blanco.
    r = await pa.guardarDiseno(db, A, dueño, {
        status: 'final', formato: 'cuadrado', productos: [], backgroundId: recorteId,
        layout: { modo: 'recorte', producto: { id: 11, nombre: 'Aceite Belmont 900 ml' }, nota: '' }, finalJpeg: JPG_CHAT,
    });
    const recGuardado = r.id;
    const listaRec = (await pa.listarDisenos(db, A, {})).disenos.find(x => x.id === recGuardado);
    const abiertoRec = await pa.obtenerDiseno(db, A, { id: recGuardado });
    check('recorte en el Historial: sin productos, con nombre propio y marcado como recorte',
        r.success && r.title === 'Foto recortada' && listaRec?.recorte === true && listaRec.conChat === false && listaRec.tieneFinal);
    check('recorte abierto del Historial: trae su imagen y para qué producto era',
        abiertoRec.diseno.layout.modo === 'recorte' && abiertoRec.diseno.layout.producto.id === 11 && abiertoRec.fondos.some(f => f.id === recorteId));
    check('una rápida sin productos sigue sin poder guardarse', !(await pa.guardarDiseno(db, A, dueño, { formato: 'cuadrado', productos: [], layout: {} })).success);

    // Ponérsela a un producto: el inventario y, solo la foto, la tienda online.
    const enviosTienda = [];
    let tiendaContesta = async () => ({ success: true, status: 200 });
    pa.__probarConTienda(async (x) => { enviosTienda.push(x); return tiendaContesta(x); }, 300);
    await db.execute("INSERT INTO products (id, name, price, stock, category, sku, unit, company_id) VALUES (17, 'Pan amasado', 200, 50, 'Panadería', '', 'Und', 'acme')");
    const FOTO_NUEVA = `data:image/jpeg;base64,${Buffer.from('foto recortada').toString('base64')}`;
    const antes11 = (await db.execute('SELECT stock, price, name, updated_at FROM products WHERE id = 11')).rows[0];
    r = await pa.asignarFotoProducto(db, A, dueño, { productId: 11, foto: FOTO_NUEVA, fondoId: recorteId });
    const ahora11 = (await db.execute('SELECT image, stock, price, name, updated_at FROM products WHERE id = 11')).rows[0];
    check('poner la foto: queda en el inventario y no toca nada más',
        r.success && !r.reemplazo && ahora11.image === FOTO_NUEVA && ahora11.stock === antes11.stock && ahora11.price === antes11.price && ahora11.name === antes11.name);
    check('poner la foto: cambia updated_at (los otros equipos bajan el producto de nuevo)', ahora11.updated_at && ahora11.updated_at !== antes11.updated_at);
    check('a la tienda va SOLO la foto, con el id y el código',
        r.tienda === 'ok' && enviosTienda.length === 1 && enviosTienda[0].companyId === A
        && JSON.stringify(Object.keys(enviosTienda[0].product).sort()) === '["id","image","sku"]' && enviosTienda[0].product.id === 11 && enviosTienda[0].product.sku === 'A2' && enviosTienda[0].product.image === FOTO_NUEVA,
        JSON.stringify(enviosTienda[0]?.product && Object.keys(enviosTienda[0].product)));
    const registro = (await db.execute("SELECT details FROM audit_logs WHERE company_id = 'acme' AND entity = 'PRODUCT' ORDER BY id DESC LIMIT 1")).rows[0];
    check('queda en el registro de cambios, con el recorte de origen', /"origen":"publicidad_recorte"/.test(registro?.details) && registro.details.includes(`"recorte":${recorteId}`));
    r = await pa.asignarFotoProducto(db, A, dueño, { productId: 10, foto: FOTO_NUEVA });
    check('a un producto que ya tenía foto: la reemplaza y lo avisa', r.success && r.reemplazo === true);
    r = await pa.asignarFotoProducto(db, A, dueño, { productId: 17, foto: FOTO_NUEVA });
    check('producto sin código: se pone en el inventario, no va a la tienda', r.success && r.tienda === 'sin_codigo' && enviosTienda.length === 2);
    const envios = enviosTienda.length;
    r = await pa.asignarFotoProducto(db, B, { uid: 3 }, { productId: 11, foto: FOTO_NUEVA });
    check('otra empresa no puede ponerle foto a un producto ajeno', !r.success && enviosTienda.length === envios);
    r = await pa.asignarFotoProducto(db, A, dueño, { productId: 12, foto: 'data:text/html;base64,PGI+' });
    const img12 = (await db.execute('SELECT image FROM products WHERE id = 12')).rows[0].image;
    check('una foto que no es imagen: no se guarda', !r.success && img12 === null && enviosTienda.length === envios);
    r = await pa.asignarFotoProducto(db, A, dueño, { productId: 12, foto: `data:image/jpeg;base64,${Buffer.alloc(450_000).toString('base64')}` });
    check('una foto demasiado pesada para el inventario: no', !r.success && (await db.execute('SELECT image FROM products WHERE id = 12')).rows[0].image === null);
    tiendaContesta = async () => ({ success: false, error: 'Integración no configurada o inactiva' });
    check('sin tienda conectada: se pone igual', (await pa.asignarFotoProducto(db, A, dueño, { productId: 12, foto: FOTO_NUEVA })).tienda === 'sin_tienda');
    tiendaContesta = async () => ({ success: false, status: 500 });
    check('la tienda falla: la foto queda puesta y lo dice', (await pa.asignarFotoProducto(db, A, dueño, { productId: 12, foto: FOTO_NUEVA })).tienda === 'error');
    tiendaContesta = async () => { throw new Error('caída'); };
    check('la tienda se cae: no rompe', (await pa.asignarFotoProducto(db, A, dueño, { productId: 12, foto: FOTO_NUEVA })).tienda === 'error');
    tiendaContesta = () => new Promise(() => {});
    const t0Tienda = Date.now();
    r = await pa.asignarFotoProducto(db, A, dueño, { productId: 12, foto: FOTO_NUEVA });
    check('la tienda tarda: no se espera más del tope', r.success && r.tienda === 'enviando' && Date.now() - t0Tienda < 2000);
    pa.__probarConTienda(null);

    // ── El endpoint: orden de los candados ─────────────────────────────────
    const { signSession } = await import('../../api/_lib/auth.js');
    const handler = (await import('../../api/ai/publicidad.js')).default;
    const pedir = async (uid, body) => {
        let code = 0, json = null;
        const res = { status(c) { code = c; return this; }, json(j) { json = j; return this; } };
        await handler({ method: 'POST', headers: { cookie: uid ? `pv_session=${signSession({ uid, role: 'x' })}` : '' }, body }, res);
        return { code, json };
    };
    let x = await pedir(null, { companyId: A, action: 'listar' });
    check('sin sesión: 401', x.code === 401);
    x = await pedir(3, { companyId: A, action: 'listar' });
    check('usuario de otra empresa: 403', x.code === 403);
    await db.execute("DELETE FROM role_permissions WHERE role = 'Caja'");
    x = await pedir(2, { companyId: A, action: 'listar' });
    check('cajera sin permiso: SIN_ROL', x.code === 403 && x.json.error === 'SIN_ROL');
    x = await pedir(3, { companyId: B, action: 'generarFondo', ...base });
    check('sin la App: SIN_APP (antes de la IA)', x.code === 403 && x.json.error === 'SIN_APP');
    x = await pedir(2, { companyId: A, action: 'ofertas' });
    check('ofertas: la cajera sin permiso tampoco', x.code === 403 && x.json.error === 'SIN_ROL');
    x = await pedir(3, { companyId: B, action: 'ofertas' });
    check('ofertas: sin la App igual se leen (como el buscador)', x.code === 200 && x.json.success && x.json.productos.length === 0);
    x = await pedir(1, { companyId: A, action: 'ofertas' });
    check('ofertas: solo las vigentes con precio, por nombre', x.code === 200 && x.json.productos.map(p => Number(p.id)).join() === '10,15',
        x.json.productos?.map(p => p.id).join());
    check('ofertas: trae la foto y las reglas', Number(x.json.productos[0].has_image) === 1 && Number(x.json.productos[1].offer_units_limit) === 50);
    await db.execute("INSERT INTO company_apps (company_id, app_key, status) VALUES ('otra', 'publicidad', 'active')");
    await db.execute("UPDATE ad_backgrounds SET created_at = '2026-01-01T00:00:00.000Z' WHERE company_id = 'otra'");
    await db.execute({ sql: "UPDATE ad_backgrounds SET created_at = ? WHERE company_id = 'otra'", args: [new Date(Date.now() - 120_000).toISOString()] });
    delete process.env.OPENAI_API_KEY;
    x = await pedir(3, { companyId: B, action: 'generarFondo', ...base, productIds: [20] });
    check('cupo agotado: frena antes de crear el cliente de IA', x.code === 200 && x.json.error === 'CUPO');
    x = await pedir(3, { companyId: B, action: 'generarChat', formato: 'post_vertical', pedido: 'una oferta' });
    check('chat: el cupo agotado también lo frena', x.code === 200 && x.json.error === 'CUPO');
    x = await pedir(3, { companyId: B, action: 'recortar', foto: JPG_CHAT });
    check('recortar: el cupo agotado también lo frena', x.code === 200 && x.json.error === 'CUPO');
    x = await pedir(2, { companyId: A, action: 'asignarFoto', productId: 12, foto: JPG_CHAT });
    check('poner la foto: la cajera sin permiso de Publicidad no', x.code === 403 && x.json.error === 'SIN_ROL');
    x = await pedir(1, { companyId: A, action: 'estado' });
    check('estado: cupo y almacenamiento', x.json.success && x.json.cupo.cupo === 200 && x.json.almacenamiento === true);
} catch (e) {
    console.error(e);
    fallas++;
} finally {
    db.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows a veces retiene el archivo */ }
}

console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
process.exit(fallas ? 1 : 0);
