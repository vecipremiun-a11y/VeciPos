// Red de seguridad contra el doble envío.
//
// Un mouse con el clic sensible dispara dos veces en pocos milisegundos y el
// sistema alcanzaba a mandar la operación dos veces: pasó con un abono de cliente
// (dos filas a las 23:19:09 del mismo segundo) y con una compra facturada.
//
// Acá se corta a nivel de red: mientras una operación que MODIFICA datos está en
// vuelo, una segunda idéntica no sale — se le devuelve la misma promesa, así que
// la pantalla se comporta igual pero al servidor llega una sola.
//
// Esto es el respaldo, no la defensa principal: los botones se bloquean y muestran
// una rueda mientras trabajan (ver AsyncButton). Sirve para lo que no pase por ahí.

// Campos que cambian entre dos clics del MISMO botón sin que la operación sea
// distinta: la marca de tiempo se calcula al momento de llamar, así que dos clics
// seguidos producen fechas distintas por milisegundos. Si se incluyeran en la
// firma, dos envíos accidentales parecerían operaciones diferentes.
const CAMPOS_VOLATILES = new Set(['date', 'createdAt', 'created_at', 'updatedAt', 'updated_at', 'timestamp', 'nowIso']);

/** Firma estable de una operación, ignorando lo que cambia solo por el reloj. */
function firma(action, payload) {
    const limpio = (valor) => {
        if (Array.isArray(valor)) return valor.map(limpio);
        if (valor && typeof valor === 'object') {
            const salida = {};
            for (const clave of Object.keys(valor).sort()) {
                if (CAMPOS_VOLATILES.has(clave)) continue;
                salida[clave] = limpio(valor[clave]);
            }
            return salida;
        }
        return valor;
    };
    try {
        return `${action}|${JSON.stringify(limpio(payload))}`;
    } catch {
        return null;   // payload no serializable: mejor dejarlo pasar que romperlo
    }
}

// Las lecturas se pueden repetir sin consecuencias. Solo se protege lo que
// escribe, y se reconoce por el nombre de la acción.
const SOLO_LECTURA = /^(report|.*(List|Fetch|Load|Get|Check|Stats|Details|Count|Search|Transactions|Ids))$/;

const enVuelo = new Map();

/**
 * Ejecuta `correr()` evitando que la misma operación salga dos veces a la vez.
 * Devuelve la promesa en curso si ya hay una idéntica trabajando.
 */
export function sinDobleEnvio(action, payload, correr) {
    if (SOLO_LECTURA.test(action)) return correr();
    const clave = firma(action, payload);
    if (!clave) return correr();

    const yaVa = enVuelo.get(clave);
    if (yaVa) {
        console.warn(`[doble envío evitado] "${action}" ya estaba en curso; se ignora la repetición.`);
        return yaVa;
    }
    const promesa = correr().finally(() => enVuelo.delete(clave));
    enVuelo.set(clave, promesa);
    return promesa;
}

/** Solo para pruebas: deja el registro limpio entre casos. */
export function _limpiarEnVuelo() {
    enVuelo.clear();
}
