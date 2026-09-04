// Prueba del cálculo del "día de la empresa" que usa el backfill.
//
// El bug que motivó esto (3-sep-2026): la herramienta de reparación filtraba
// las ventas por día UTC. Chile va 4 horas atrás, así que el día UTC arranca a
// las 20:00 del día anterior en Chile — y el contador del día quedó con
// $436.884 / 148 ventas cuando lo real eran $89.966 / 41. Las otras 107 eran
// ventas de la noche anterior.
//
//   node scripts/optim/test-dia-local.mjs

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

// Mismas funciones que usa el backfill.
function desfaseMinutos(tz, fecha) {
    const partes = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(fecha);
    const p = {};
    for (const x of partes) p[x.type] = x.value;
    const comoSiFueraUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
    return (comoSiFueraUTC - fecha.getTime()) / 60000;
}
function medianocheLocalEnUTC(dia, tz) {
    const aproximado = new Date(`${dia}T00:00:00Z`);
    let inicio = new Date(aproximado.getTime() - desfaseMinutos(tz, aproximado) * 60000);
    inicio = new Date(aproximado.getTime() - desfaseMinutos(tz, inicio) * 60000);
    return inicio;
}
const rango = (dia, tz) => {
    const desde = medianocheLocalEnUTC(dia, tz);
    const siguiente = new Date(new Date(`${dia}T12:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
    return { desde, hasta: medianocheLocalEnUTC(siguiente, tz) };
};

const TZ = 'America/Santiago';

console.log('1. El día chileno arranca a las 04:00 UTC (Chile = UTC-4)');
const r = rango('2026-09-03', TZ);
check('empieza el 3-sep a las 04:00 UTC', r.desde.toISOString() === '2026-09-03T04:00:00.000Z', r.desde.toISOString());
check('termina el 4-sep a las 04:00 UTC', r.hasta.toISOString() === '2026-09-04T04:00:00.000Z', r.hasta.toISOString());
check('el día dura 24 horas', (r.hasta - r.desde) / 3600000 === 24, ((r.hasta - r.desde) / 3600000) + ' h');

console.log('\n2. Las ventas caen en el día correcto');
const caeEn = (iso) => (new Date(iso) >= r.desde && new Date(iso) < r.hasta);
check('venta de las 00:02 UTC (2-sep 20:02 en Chile) NO es de hoy', !caeEn('2026-09-03T00:02:52.137Z'));
check('venta de las 02:53 UTC (2-sep 22:53 en Chile) NO es de hoy', !caeEn('2026-09-03T02:53:04.437Z'));
check('venta de las 11:30 UTC (3-sep 07:30 en Chile) SÍ es de hoy', caeEn('2026-09-03T11:30:16.028Z'));
check('venta de las 19:23 UTC (3-sep 15:23 en Chile) SÍ es de hoy', caeEn('2026-09-03T19:23:43.654Z'));
check('venta de las 05:00 UTC del 4 (4-sep 01:00 en Chile) NO es de hoy', !caeEn('2026-09-04T05:00:00.000Z'));

console.log('\n3. Con el criterio VIEJO (día UTC) se colaban las de anoche');
const rangoUTC = { desde: new Date('2026-09-03T00:00:00Z'), hasta: new Date('2026-09-04T00:00:00Z') };
const caeEnUTC = (iso) => (new Date(iso) >= rangoUTC.desde && new Date(iso) < rangoUTC.hasta);
// El criterio viejo no "perdía" ventas de hoy: le SOBRABAN las de anoche.
// Por eso el total se infló (148 en vez de 41) en vez de quedar corto.
check('el criterio viejo contaba la venta de anoche (de ahí el inflado)', caeEnUTC('2026-09-03T00:02:52.137Z'));
check('y también contaba las de hoy, por eso sumaba de más', caeEnUTC('2026-09-03T19:23:43.654Z'));
check('el criterio nuevo deja fuera la de anoche', !caeEn('2026-09-03T00:02:52.137Z'));

console.log('\n4. Funciona con otras zonas horarias');
const rMex = rango('2026-09-03', 'America/Mexico_City');
check('México da un rango de 24 h', (rMex.hasta - rMex.desde) / 3600000 === 24, rMex.desde.toISOString() + ' → ' + rMex.hasta.toISOString());
const rUTC = rango('2026-09-03', 'UTC');
check('en UTC el día arranca a las 00:00', rUTC.desde.toISOString() === '2026-09-03T00:00:00.000Z', rUTC.desde.toISOString());

console.log(fallas === 0 ? '\nTODO OK\n' : `\n${fallas} PRUEBAS FALLARON\n`);
process.exit(fallas === 0 ? 0 : 1);
