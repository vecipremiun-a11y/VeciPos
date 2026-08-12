// Dictado por voz, usando el reconocimiento que ya trae el navegador.
//
// Se elige esto y no la transcripción de OpenAI por una razón simple: es
// gratis. La transcripción por API costaría plata en cada dictado y saldría del
// mismo margen del complemento, mientras que el navegador lo hace sin cobrar y
// sin viaje extra al servidor.
//
// A cambio hay que ser honesto con el límite: no está en todos lados. Chrome y
// Edge de escritorio lo tienen; Firefox no, y dentro de la app Android depende
// de la versión del WebView. Por eso `hayDictado()` existe: si no está, el
// micrófono no se muestra en vez de aparecer y fallar al apretarlo.

const Reconocimiento = typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null;

/** ¿Este navegador puede dictar? */
export const hayDictado = () => Boolean(Reconocimiento);

/**
 * Arranca el dictado. Devuelve una función para cortarlo.
 *
 * @param {object} cb
 *   onParcial(texto)  — lo que va escuchando, para mostrarlo mientras habla
 *   onFinal(texto)    — el texto ya definitivo
 *   onError(motivo)   — en castellano, listo para mostrar
 *   onFin()           — terminó, por lo que sea
 */
export function iniciarDictado({ onParcial, onFinal, onError, onFin }) {
    if (!Reconocimiento) { onError?.('Este navegador no permite dictar.'); return () => {}; }

    const rec = new Reconocimiento();
    rec.lang = 'es-CL';
    // `continuous` deja seguir hablando entre pausas: dictar una pregunta larga
    // no debería cortarse por respirar.
    rec.continuous = true;
    // Resultados parciales para que se vea que está escuchando. Sin esto la
    // pantalla queda muda y uno no sabe si el micrófono agarró.
    rec.interimResults = true;

    let final = '';

    rec.onresult = (e) => {
        let parcial = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
            const t = e.results[i][0].transcript;
            if (e.results[i].isFinal) final += t;
            else parcial += t;
        }
        onParcial?.((final + parcial).trim());
    };

    rec.onerror = (e) => {
        const motivos = {
            'not-allowed': 'No diste permiso para usar el micrófono.',
            'service-not-allowed': 'No diste permiso para usar el micrófono.',
            'no-speech': 'No se escuchó nada.',
            'audio-capture': 'No se encontró un micrófono.',
            'network': 'El dictado necesita internet.',
        };
        // 'aborted' es lo que llega cuando uno mismo lo corta: no es un error
        // que haya que mostrarle a nadie.
        if (e.error !== 'aborted') onError?.(motivos[e.error] || 'No se pudo dictar.');
    };

    rec.onend = () => { onFinal?.(final.trim()); onFin?.(); };

    try { rec.start(); }
    catch { onError?.('No se pudo abrir el micrófono.'); onFin?.(); }

    return () => { try { rec.stop(); } catch { /* ya estaba cerrado */ } };
}

/**
 * Achica una foto antes de mandarla.
 *
 * Una foto de teléfono son varios MB y el costo en tokens crece con el tamaño.
 * A 1024 px de lado mayor se lee perfecto una factura y el archivo baja a una
 * fracción. Se hace acá y no en el servidor porque así tampoco se sube el peso
 * por la red, que en un local con internet flojo es lo que más se siente.
 */
export function achicarImagen(archivo, ladoMax = 1024, calidad = 0.8) {
    return new Promise((resolver, rechazar) => {
        const lector = new FileReader();
        lector.onerror = () => rechazar(new Error('No se pudo leer la imagen'));
        lector.onload = () => {
            const img = new Image();
            img.onerror = () => rechazar(new Error('El archivo no es una imagen válida'));
            img.onload = () => {
                const escala = Math.min(1, ladoMax / Math.max(img.width, img.height));
                const lienzo = document.createElement('canvas');
                lienzo.width = Math.round(img.width * escala);
                lienzo.height = Math.round(img.height * escala);
                lienzo.getContext('2d').drawImage(img, 0, 0, lienzo.width, lienzo.height);
                resolver({
                    dataUrl: lienzo.toDataURL('image/jpeg', calidad),
                    ancho: lienzo.width,
                    alto: lienzo.height,
                });
            };
            img.src = lector.result;
        };
        lector.readAsDataURL(archivo);
    });
}
