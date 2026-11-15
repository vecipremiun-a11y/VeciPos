// "Mostrar" de razón social, giro y dirección en la boleta (Kevin, 10-nov-2026;
// migración 0040). Del emisor, el SII exige impreso solo el RUT; razón social,
// giro y dirección son opcionales.
//
// Lo del servidor se prueba contra una base local con todas las migraciones,
// y también sin la 0040 (el código tiene que funcionar igual mientras no se
// aplique). No toca ninguna base real.
//
//   node scripts/optim/test-boleta-mostrar.mjs

import { createClient } from '@libsql/client';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { companyActions, leerConfigBoleta } from '../../api/_lib/companyActions.js';
import { reportRun } from '../../api/_lib/reportActions.js';

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

const migraciones = readdirSync('migrations').filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
// Empresas antes de la 0040: una con dirección en la boleta y otra sin.
const EMPRESAS = `
    INSERT INTO companies (id, name, receipt_business_name, receipt_address, receipt_show_tax_id) VALUES
        ('con_dir', 'Con dirección', 'Cruz de motupe', 'sotomayor 1460-A', 1),
        ('sin_dir', 'Sin dirección', 'Otro negocio', '', 1),
        ('nula', 'Nula', NULL, NULL, 1);
`;
async function base({ con0040 = true } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'boleta-'));
    const db = createClient({ url: `file:${join(dir, 't.db').split(String.fromCharCode(92)).join('/')}` });
    // 0000 es una foto del esquema tomada después de varias migraciones: se aplica
    // sentencia por sentencia y se salta lo que ya existe. La 0040 entra con
    // executeMultiple, como en migrate-all, y después de cargar las empresas.
    for (const f of migraciones) {
        if (f.startsWith('0040')) continue;
        const sql = readFileSync(join('migrations', f), 'utf8').replace(/--[^\n]*/g, '');
        for (const sentencia of sql.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean)) {
            try { await db.execute(sentencia); } catch (e) {
                if (!/duplicate column|already exists/i.test(e.message)) throw e;
            }
        }
    }
    await db.executeMultiple(EMPRESAS);
    if (con0040) await db.executeMultiple(readFileSync(join('migrations', '0040_receipt_show_emisor.sql'), 'utf8'));
    return { db, dir };
}
const cerrar = ({ db, dir }) => { db.close(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows */ } };
const session = { uid: 7, username: 'jefe' };
const guardar = (db, id, config) => companyActions.receiptSettingsSave(db, id, session, { config });
const reporte = async (db, id) => (await reportRun(db, id, session, { name: 'receiptConfig' })).rows[0][0];

console.log('1. La migración 0040');
{
    const b = await base();
    try {
        const cols = (await b.db.execute('PRAGMA table_info(companies)')).rows.map((r) => r.name);
        check('agrega las tres columnas', ['receipt_show_razon_social', 'receipt_show_giro', 'receipt_show_address'].every((c) => cols.includes(c)));
        const con = await leerConfigBoleta(b.db, 'con_dir');
        const sin = await leerConfigBoleta(b.db, 'sin_dir');
        const nula = await leerConfigBoleta(b.db, 'nula');
        check('dirección: sí por defecto en todas', con.show_address === 1 && sin.show_address === 1 && nula.show_address === 1, JSON.stringify([con.show_address, sin.show_address, nula.show_address]));
        check('razón social y giro: no por defecto', con.show_razon_social === 0 && con.show_giro === 0 && nula.show_razon_social === 0 && nula.show_giro === 0);
        await b.db.execute("INSERT INTO companies (id, name) VALUES ('nueva', 'Nueva')");
        const nueva = await leerConfigBoleta(b.db, 'nueva');
        check('empresa nueva: dirección prendida, razón social y giro apagados', nueva.show_address === 1 && nueva.show_razon_social === 0 && nueva.show_giro === 0);
    } finally { cerrar(b); }
}

console.log('\n2. Guardar y leer (con la 0040)');
{
    const b = await base();
    try {
        const config = { business_name: 'Cruz de motupe', address: '', tax_id: '24.480.416-0', show_tax_id: true, show_phone: true, show_email: false, format: '58mm' };
        let r = await guardar(b.db, 'con_dir', { ...config, show_razon_social: false, show_giro: true, show_address: false });
        check('guarda', r.success === true);
        let c = await leerConfigBoleta(b.db, 'con_dir');
        check('los tres "Mostrar" quedan guardados', c.show_razon_social === 0 && c.show_giro === 1 && c.show_address === 0, JSON.stringify([c.show_razon_social, c.show_giro, c.show_address]));
        check('lo de antes también', c.tax_id === '24.480.416-0' && c.show_tax_id === 1 && c.address === '' && c.format === '58mm');

        // Una versión vieja de la app (sin los campos nuevos) no los pisa.
        r = await guardar(b.db, 'con_dir', { ...config, address: 'Sotomayor 1460-A' });
        c = await leerConfigBoleta(b.db, 'con_dir');
        check('app vieja: guarda y no toca los "Mostrar" nuevos', r.success && c.address === 'Sotomayor 1460-A' && c.show_razon_social === 0 && c.show_address === 0);

        const rep = await reporte(b.db, 'con_dir');
        check('el reporte del Historial trae lo mismo', rep.show_razon_social === 0 && rep.show_giro === 1 && rep.show_address === 0 && rep.business_name === 'Cruz de motupe' && rep.format === '58mm');
        const load = await companyActions.receiptSettingsLoad(b.db, 'con_dir');
        check('Configuración → Boleta trae lo mismo', load.success && load.config.show_giro === 1 && load.config.show_address === 0);
        const otra = await reporte(b.db, 'sin_dir');
        check('cada empresa ve la suya', otra.business_name === 'Otro negocio' && otra.show_razon_social === 0 && otra.show_address === 1);
        const ninguna = (await reportRun(b.db, 'no-existe', session, { name: 'receiptConfig' })).rows[0];
        check('empresa inexistente: sin filas', Array.isArray(ninguna) && ninguna.length === 0);
    } finally { cerrar(b); }
}

console.log('\n3. Sin la 0040 (código nuevo antes de migrar)');
{
    const b = await base({ con0040: false });
    try {
        const c = await leerConfigBoleta(b.db, 'con_dir');
        check('lee la config de antes', c && c.business_name === 'Cruz de motupe' && c.address === 'sotomayor 1460-A');
        check('sin los "Mostrar" nuevos (la app usa los de por defecto)', c.show_address === undefined && c.show_giro === undefined);
        const r = await guardar(b.db, 'con_dir', { business_name: 'Nuevo nombre', address: 'x', show_tax_id: true, show_giro: false, show_address: false, format: '80mm' });
        const d = await leerConfigBoleta(b.db, 'con_dir');
        check('guarda lo de antes aunque vengan los nuevos', r.success && d.business_name === 'Nuevo nombre' && d.format === '80mm');
        const rep = await reporte(b.db, 'con_dir');
        check('el reporte del Historial funciona', rep.business_name === 'Nuevo nombre');
    } finally { cerrar(b); }
}

console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
process.exit(fallas ? 1 : 0);
