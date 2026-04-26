// Genera todos los iconos PWA a partir de public/icon-source.png
//
// Uso:
//   1. Guarda tu logo cuadrado (mínimo 512x512) en: public/icon-source.png
//   2. Ejecuta: node scripts/generate-pwa-icons.mjs
//
// Genera:
//   - public/icon-192.png            (192x192)
//   - public/icon-512.png            (512x512)
//   - public/icon-512-maskable.png   (512x512 con padding 10% para Android adaptive)
//   - public/apple-touch-icon.png    (180x180 para iOS)
//   - public/favicon.ico             (multi-size)

import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, '..', 'public');
const SOURCE = resolve(PUBLIC_DIR, 'icon-source.png');

if (!existsSync(SOURCE)) {
  console.error('❌ Falta el archivo:', SOURCE);
  console.error('   Guarda tu logo (idealmente 512x512 o más grande) ahí y vuelve a correr el script.');
  process.exit(1);
}

const BG = { r: 11, g: 17, b: 32, alpha: 1 }; // #0b1120 (theme_color)

async function makeIcon(size, name, { maskable = false } = {}) {
  const out = resolve(PUBLIC_DIR, name);
  if (maskable) {
    // Para maskable: dejar 10% de "safe area" alrededor del logo
    const inner = Math.round(size * 0.8);
    const logo = await sharp(SOURCE).resize(inner, inner, { fit: 'contain', background: BG }).toBuffer();
    await sharp({
      create: { width: size, height: size, channels: 4, background: BG },
    })
      .composite([{ input: logo, gravity: 'center' }])
      .png()
      .toFile(out);
  } else {
    await sharp(SOURCE)
      .resize(size, size, { fit: 'contain', background: BG })
      .png()
      .toFile(out);
  }
  console.log(`✅ ${name} (${size}x${size}${maskable ? ', maskable' : ''})`);
}

async function makeFavicon() {
  // Genera un PNG 48x48 como favicon (los navegadores modernos lo aceptan).
  // Si quieres .ico real, usa https://realfavicongenerator.net/
  const out = resolve(PUBLIC_DIR, 'favicon.png');
  await sharp(SOURCE).resize(48, 48, { fit: 'contain', background: BG }).png().toFile(out);
  console.log('✅ favicon.png (48x48)');
}

(async () => {
  try {
    await makeIcon(192, 'icon-192.png');
    await makeIcon(512, 'icon-512.png');
    await makeIcon(512, 'icon-512-maskable.png', { maskable: true });
    await makeIcon(180, 'apple-touch-icon.png');
    await makeFavicon();
    console.log('\n🎉 Todos los iconos generados en /public');
  } catch (err) {
    console.error('❌ Error generando iconos:', err);
    process.exit(1);
  }
})();
