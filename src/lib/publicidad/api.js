// Llamadas a /api/ai/publicidad y la descarga de la imagen terminada.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { fetchConLimite } from '../conectividad';
import { avisoHecho } from '../toast';

/**
 * Una acción del servidor de Publicidad. Generar un fondo tarda 10-20 s (la IA
 * se corta a los 50 s), así que ese pedido tiene 70 s de plazo; el resto, 30.
 * Nunca lanza: devuelve { success:false, error, message } para mostrar.
 */
export async function publicidad(companyId, action, datos = {}, ms = 30000) {
    try {
        const r = await fetchConLimite('/api/ai/publicidad', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ ...datos, companyId, action }),
        }, ms);
        const data = await r.json().catch(() => null);
        if (!data) return { success: false, error: 'RESPUESTA', message: r.status === 413 ? 'La imagen es muy pesada para guardarla.' : 'El servidor respondió algo que no se entiende.' };
        if (!data.success && !data.message) data.message = data.error || 'No se pudo completar.';
        return data;
    } catch (e) {
        const porTiempo = e?.name === 'TimeoutError' || e?.name === 'AbortError';
        return { success: false, error: porTiempo ? 'TIEMPO' : 'RED', message: porTiempo ? 'El servidor tardó demasiado en contestar.' : 'Sin conexión con el servidor.' };
    }
}

/** Baja la imagen y avisa: en la app va a la galería; en el navegador, como archivo. */
export { guardarImagen as descargarImagen } from '../descargas';

const ImprimirImagen = registerPlugin('ImprimirImagen');
const HOJA = 'posveci-hoja-impresion';

/**
 * Imprime la imagen sola en una hoja A4, entera y centrada (cualquier formato,
 * no solo el cartel). En la app va por el plugin nativo, porque el WebView de
 * Android no imprime: window.print() no hace nada. En el navegador la imagen se
 * pone en la misma página, que al imprimir esconde todo lo demás: una ventana
 * aparte la frena el bloqueador de ventanas y la PWA del iPhone no la abre. La
 * hoja va sin márgenes (así el navegador no le agrega la fecha ni la dirección)
 * y con 5 mm de borde blanco para la impresora. Una imagen apaisada va en la
 * hoja acostada: parada, la de 1,91:1 ocuparía un tercio de la hoja.
 */
export async function imprimirImagen(dataUrl, nombre) {
    if (Capacitor.isNativePlatform()) {
        try {
            await ImprimirImagen.imprimir({ base64: String(dataUrl).split(',')[1], nombre });
            avisoHecho('Se abrió la ventana para imprimir la imagen.');
            return { ok: true };
        } catch (e) {
            if (e?.code === 'UNIMPLEMENTED') return { ok: false, mensaje: 'Esta versión de la app todavía no imprime: actualizala, o abrí POSVECI en el navegador.' };
            return { ok: false, mensaje: e?.message || 'No se pudo imprimir.' };
        }
    }
    document.getElementById(HOJA)?.remove();
    const img = new Image();
    img.alt = nombre;
    img.src = dataUrl;
    try {
        await img.decode();
    } catch {
        return { ok: false, mensaje: 'No se pudo preparar la hoja para imprimir.' };
    }
    const acostada = img.naturalWidth > img.naturalHeight;
    const hoja = document.createElement('div');
    hoja.id = HOJA;
    const estilo = document.createElement('style');
    // Un milímetro menos de alto que la hoja: justo al borde, algunos navegadores sacan una segunda hoja en blanco.
    estilo.textContent = `
        #${HOJA} { display: none; }
        @page { size: A4 ${acostada ? 'landscape' : 'portrait'}; margin: 0; }
        @media print {
            html, body { margin: 0 !important; padding: 0 !important; background: #fff !important;
                         height: auto !important; min-height: 0 !important; overflow: visible !important; }
            body > :not(#${HOJA}) { display: none !important; }
            #${HOJA} { display: flex !important; align-items: center; justify-content: center;
                       box-sizing: border-box; width: ${acostada ? '297mm' : '210mm'}; height: ${acostada ? '209mm' : '296mm'}; padding: 5mm; overflow: hidden; }
            #${HOJA} img { display: block; max-width: 100%; max-height: 100%; }
        }`;
    hoja.append(estilo, img);
    document.body.appendChild(hoja);
    const limpiar = () => { hoja.remove(); window.removeEventListener('afterprint', limpiar); };
    window.addEventListener('afterprint', limpiar);
    avisoHecho('Se abrió la ventana para imprimir la imagen.');
    window.print();
    return { ok: true };
}

/** Achica una foto subida (para que entre en el pedido al servidor). */
export function achicarFoto(archivo, lado = 1000) {
    return new Promise((resolve, reject) => {
        if (!archivo || !/^image\/(png|jpe?g|webp)$/.test(archivo.type)) { reject(new Error('Elegí una foto JPG, PNG o WebP.')); return; }
        const lector = new FileReader();
        lector.onerror = () => reject(new Error('No se pudo leer la foto.'));
        lector.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error('No se pudo leer la foto.'));
            img.onload = () => {
                const f = Math.min(1, lado / Math.max(img.width, img.height));
                const c = document.createElement('canvas');
                c.width = Math.round(img.width * f); c.height = Math.round(img.height * f);
                c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                // Un PNG puede venir recortado (con transparencia): WebP la conserva y
                // pesa mucho menos. Safari no sabe generar WebP y devuelve PNG.
                resolve(archivo.type === 'image/jpeg' ? c.toDataURL('image/jpeg', 0.88) : c.toDataURL('image/webp', 0.9));
            };
            img.src = lector.result;
        };
        lector.readAsDataURL(archivo);
    });
}
