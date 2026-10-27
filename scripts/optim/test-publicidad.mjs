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
const llamadas = { generate: 0, edit: 0 };
let fallarCon = null;
const iaFalsa = {
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

    check('ritmo: 5 en un minuto frena', await pa.ritmoPublicidadExcedido(db, A));
    check('el ritmo es por empresa', !(await pa.ritmoPublicidadExcedido(db, B)));
    for (let i = 0; i < pa.CUPO_IMAGENES_MES; i++) await db.execute({ sql: "INSERT INTO ad_backgrounds (company_id, status, mode, model, created_at) VALUES ('otra', 'lista', 'fondo', 'x', ?)", args: [new Date().toISOString()] });
    check('cupo: 200 en el mes = agotado', (await pa.cupoPublicidad(db, B)).agotado);
    check('el cupo de una empresa no toca a la otra', !(await pa.cupoPublicidad(db, A)).agotado);

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

    const lista = await pa.listarDisenos(db, A, {});
    check('el historial trae la miniatura', lista.disenos.find(x => x.id === d1)?.miniatura?.startsWith('data:image/jpeg'));
    check('el historial de la otra empresa está vacío', (await pa.listarDisenos(db, B, {})).disenos.length === 0);
    check('otra empresa no puede abrirla', !(await pa.obtenerDiseno(db, B, { id: d1 })).success);

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
