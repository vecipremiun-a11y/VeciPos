// Bajar un archivo (PDF, Excel, CSV, imagen) y avisar que se hizo.
//
// Kevin, 4-nov-2026: "las descargas de algunos no están funcionando y otros no
// avisan". Dentro de la app, el WebView ignora `<a download>`: doc.save(),
// XLSX.writeFile() y los enlaces de descarga no guardaban nada y tampoco daban
// error. En la app va por el plugin nativo GuardarImagen, a Descargas › POSVECI
// (las imágenes, a la galería). Todo lo que se baja pasa por acá: nadie más arma
// el enlace, y así ninguna descarga queda sin aviso.
//
// Estas funciones no lanzan: avisan en pantalla si falla y devuelven { ok, error }.

import { Capacitor, registerPlugin } from '@capacitor/core';
import { avisoHecho, toast } from './toast';

const GuardarImagen = registerPlugin('GuardarImagen');

const TIPOS = {
    pdf: 'application/pdf',
    csv: 'text/csv',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
};
const tipoDe = (nombre) => TIPOS[String(nombre).split('.').pop().toLowerCase()] || 'application/octet-stream';

function aBase64(blob) {
    return new Promise((resolve, reject) => {
        const lector = new FileReader();
        lector.onerror = () => reject(new Error('No se pudo leer el archivo.'));
        lector.onload = () => resolve(String(lector.result).split(',')[1]);
        lector.readAsDataURL(blob);
    });
}

function bajarEnNavegador(blob, nombre) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Con tiempo: revocarla enseguida corta la descarga en algunos navegadores.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function fallo(e, nombre) {
    const motivo = String(e?.message || e || '');
    const mensaje = e?.code === 'UNIMPLEMENTED'
        ? 'Esta versión de la app todavía no descarga archivos: actualizala, o abrí POSVECI en el navegador.'
        : motivo.includes('ANDROID_VIEJO')
            ? 'Este teléfono tiene un Android anterior al 10: abrí POSVECI en el navegador para descargar.'
            : `No se pudo descargar «${nombre}». ${motivo}`.trim();
    toast(mensaje, 'error', { ms: 7000 });
    return { ok: false, error: mensaje };
}

/** Baja un archivo: `contenido` es un Blob o los bytes (ArrayBuffer, Uint8Array) o el texto. */
export async function guardarArchivo(contenido, nombre, { tipo } = {}) {
    try {
        const blob = contenido instanceof Blob ? contenido : new Blob([contenido], { type: tipo || tipoDe(nombre) });
        if (Capacitor.isNativePlatform()) {
            await GuardarImagen.guardarArchivo({ base64: await aBase64(blob), nombre, tipo: blob.type || tipoDe(nombre) });
            avisoHecho(`«${nombre}» quedó guardado en Descargas › POSVECI.`);
        } else {
            bajarEnNavegador(blob, nombre);
            avisoHecho(`Se descargó «${nombre}». Está en tu carpeta de descargas.`);
        }
        return { ok: true };
    } catch (e) {
        return fallo(e, nombre);
    }
}

/** Un PDF hecho con jsPDF (en lugar de doc.save, que en la app no guarda nada). */
export function guardarPdf(doc, nombre) {
    return guardarArchivo(doc.output('blob'), nombre);
}

/** Un Excel (en lugar de XLSX.writeFile). Se pasa `XLSX` para no cargarlo con cada pantalla. */
export function guardarExcel(XLSX, libro, nombre) {
    return guardarArchivo(XLSX.write(libro, { bookType: 'xlsx', type: 'array' }), nombre);
}

/** Una imagen en data URL: en la app va a la galería; en el navegador, como archivo. */
export async function guardarImagen(dataUrl, nombre) {
    try {
        if (Capacitor.isNativePlatform()) {
            const [cabeza, base64] = String(dataUrl).split(',');
            const tipo = cabeza.match(/image\/(?:png|webp|jpeg)/)?.[0] || 'image/jpeg';
            await GuardarImagen.guardar({ base64, nombre, tipo });
            avisoHecho('Imagen guardada en la galería (Imágenes › POSVECI).');
        } else {
            bajarEnNavegador(await (await fetch(dataUrl)).blob(), nombre);
            avisoHecho(`Se descargó «${nombre}». Está en tu carpeta de descargas.`);
        }
        return { ok: true };
    } catch (e) {
        return fallo(e, nombre);
    }
}

/**
 * El aviso después de imprimir, con lo que devuelven printSaleReceipt e
 * imprimirComprobanteEnvio. `que`: "la boleta", "el comprobante". En la app sale
 * por la térmica; en el navegador se abre la ventana de impresión.
 */
export function avisarImpresion(r, que = 'el documento') {
    if (r?.ok) {
        avisoHecho(Capacitor.isNativePlatform() ? `Se mandó ${que} a la impresora.` : `Se abrió la ventana para imprimir ${que}.`);
        return;
    }
    toast(r?.error === 'NO_PRINTER' ? 'No hay impresora: configurala en Configuración → General → Impresora térmica, o usá Descargar.'
        : r?.error === 'POPUP_BLOCKED' ? 'El navegador bloqueó la ventana de impresión: permití las ventanas emergentes.'
            : `No se pudo imprimir: ${r?.error || ''}`, 'error', { ms: 7000 });
}
