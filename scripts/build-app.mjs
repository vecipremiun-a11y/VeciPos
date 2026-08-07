// Build para la app nativa (Capacitor). NO usar `npm run build` para el APK.
//
// En web la app se sirve del mismo origen que la API, así que `/api/...` funciona
// solo. Dentro del APK el WebView corre en https://localhost, donde /api no
// resuelve a ningún servidor: hay que compilar con VITE_API_BASE_URL para que
// src/lib/apiBase.js reescriba las llamadas hacia la API real.
//
// Pasó en producción (7-ago-2026): dos APK compilados con `npm run build` a
// secas quedaron sin esa variable y los usuarios no podían iniciar sesión. El
// build salía "exitoso" y el APK se firmaba igual, así que no había ninguna
// señal hasta abrirlo en el teléfono. Por eso este script VERIFICA el resultado
// y falla si la URL no quedó dentro del bundle.
//
// Uso:
//   npm run build:app                       # apunta a https://app.posveci.com
//   npm run build:app -- https://otra.url   # apunta a otra API

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const API = (process.argv[2] || 'https://app.posveci.com').replace(/\/$/, '');
const DIST_ASSETS = path.join(process.cwd(), 'dist', 'assets');

console.log(`\n▶ Build nativo apuntando a: ${API}\n`);

const r = spawnSync('npx', ['vite', 'build'], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, VITE_API_BASE_URL: API },
});
if (r.status !== 0) {
    console.error('\n❌ El build falló.');
    process.exit(r.status ?? 1);
}

// Red de seguridad: sin esto el APK se genera igual y falla recién en el teléfono.
const enBundle = readdirSync(DIST_ASSETS)
    .filter(f => f.endsWith('.js'))
    .some(f => readFileSync(path.join(DIST_ASSETS, f), 'utf8').includes(API));

if (!enBundle) {
    console.error(`\n❌ El bundle NO contiene ${API}.`);
    console.error('   El APK quedaría sin saber a qué servidor hablarle y nadie podría entrar.');
    console.error('   Revisá src/lib/apiBase.js y que la variable llegue a Vite.');
    process.exit(1);
}

console.log(`\n✅ Verificado: el bundle apunta a ${API}`);
console.log('   Seguí con:  npx cap sync android  →  gradlew assembleRelease\n');
