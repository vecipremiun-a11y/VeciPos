// Por qué en la app no se veían las fotos de los productos (11-sep-2026).
//
// Kevin: "esta parte en la app no se ven las imágenes al seleccionar un
// producto". En la web sí se veían. Esto mide contra la base REAL por qué.
//
// LA CAUSA. Realizar Pedido pedía TODAS las fotos de la página en UNA sola
// consulta. El cliente corta a los 12 segundos (ESPERA_NORMAL_MS en
// useStore.js): si la respuesta no entra en ese tiempo, se va entera al catch y
// la pantalla queda sin NINGUNA foto — no con algunas, con ninguna. En un
// escritorio con WiFi llega y no se nota; en un teléfono no llega nunca.
//
// Esta medición imprime, para los proveedores más grandes, cuánto pesa esa
// única respuesta y cuánto tardaría en bajarla un teléfono. Y compara contra
// el esquema por lotes de lib/fotosProductos.js.
//
//   node scripts/optim/medir-fotos-pedido.mjs

import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';

const env = {};
for (const l of readFileSync('.env.databases.local', 'utf8').split('\n')) {
    const m = l.match(/^([A-Z_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const db = createClient({
    url: 'libsql://poskem-db-jasongo.aws-us-east-1.turso.io',
    authToken: env.POSKEM_TOKEN,
});

// Lo que espera el cliente antes de darse por vencido (useStore.js).
const CORTE_MS = 12000;
// El tamaño de lote de lib/fotosProductos.js.
const POR_LOTE = 8;
// Velocidad de bajada de referencia en un teléfono con 4G flojo.
const MBPS = 2;

const mb = (bytes) => bytes / 1024 / 1024;
const segundos = (bytes) => (bytes * 8) / 1024 / 1024 / MBPS;

console.log(`Corte del cliente: ${CORTE_MS / 1000}s · lote: ${POR_LOTE} fotos · referencia: ${MBPS} Mbps\n`);

const proveedores = await db.execute(`
    SELECT supplier, COUNT(*) n
    FROM products
    WHERE company_id='default' AND supplier IS NOT NULL AND supplier != ''
      AND image IS NOT NULL AND image != ''
    GROUP BY supplier ORDER BY n DESC LIMIT 5`);

console.log('Proveedor'.padEnd(22) + 'Fotos'.padStart(6) + 'Una sola consulta'.padStart(20) + 'En teléfono'.padStart(14) + '   Resultado');
console.log('-'.repeat(84));

let peor = null;
for (const p of proveedores.rows) {
    // Realizar Pedido trae hasta 100 productos por página.
    const ids = await db.execute({
        sql: `SELECT id, length(image) bytes FROM products
              WHERE company_id='default' AND supplier=? AND image IS NOT NULL AND image!=''
              LIMIT 100`,
        args: [p.supplier],
    });
    const total = ids.rows.reduce((s, r) => s + Number(r.bytes || 0), 0);
    const seg = segundos(total);
    const entra = seg * 1000 < CORTE_MS;
    const fila = String(p.supplier).slice(0, 20).padEnd(22)
        + String(ids.rows.length).padStart(6)
        + `${mb(total).toFixed(2)} MB`.padStart(20)
        + `${seg.toFixed(0)} s`.padStart(14)
        + (entra ? '   entra' : '   SE CORTA → 0 fotos');
    console.log(fila);
    if (!peor || total > peor.total) peor = { nombre: p.supplier, total, n: ids.rows.length, ids: ids.rows };
}

console.log(`\n── El peor caso: ${peor.nombre} ──`);
console.log(`  ${peor.n} fotos · ${mb(peor.total).toFixed(2)} MB · ${segundos(peor.total).toFixed(0)} s en el teléfono`);
console.log(`  ANTES: una consulta de ${mb(peor.total).toFixed(2)} MB → se pasa del corte → la pantalla queda SIN NINGUNA foto.`);

const lotes = Math.ceil(peor.n / POR_LOTE);
let mayorLote = 0;
for (let i = 0; i < peor.ids.length; i += POR_LOTE) {
    const suma = peor.ids.slice(i, i + POR_LOTE).reduce((s, r) => s + Number(r.bytes || 0), 0);
    if (suma > mayorLote) mayorLote = suma;
}
console.log(`  AHORA: ${lotes} consultas; la más pesada ${mb(mayorLote).toFixed(2)} MB = ${segundos(mayorLote).toFixed(1)} s.`);
console.log(`         Cada tanda se dibuja apenas llega, y si una falla las anteriores ya se vieron.`);
console.log(`         Además, las que el equipo ya tiene guardadas salen sin pedir nada.`);

const ok = segundos(mayorLote) * 1000 < CORTE_MS;
console.log(`\n${ok ? 'OK' : 'OJO'}: el lote más pesado ${ok ? 'entra' : 'NO entra'} en el corte de ${CORTE_MS / 1000}s.`);
process.exitCode = ok ? 0 : 1;
