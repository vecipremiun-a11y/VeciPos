// Qué NUNCA sale hacia el modelo.
//
// Con pocas herramientas alcanzaba con no exponer los reportes delicados. Al
// abrir el catálogo a todo el sistema eso deja de servir: son decenas de
// consultas, y basta que UNA traiga de más —hoy o dentro de seis meses, cuando
// alguien agregue una columna a un SELECT *— para que un dato personal termine
// en un servidor de OpenAI. De ahí no se puede volver.
//
// Por eso el filtro está acá y no en cada reporte: un solo lugar por donde pasa
// todo, en vez de cuarenta lugares donde acertar. Un reporte nuevo nace
// protegido sin que su autor tenga que acordarse.
//
// Se filtra por NOMBRE de campo, no por tabla, porque el nombre viaja con el
// dato: si una consulta futura hace un JOIN y trae `password`, se llama
// `password` igual.

// Nunca, bajo ningún concepto. Contraseñas, PIN, certificados, llaves de
// integración y datos bancarios: nada de esto ayuda a responder una pregunta de
// negocio, y todo esto hace daño si se filtra.
const PROHIBIDO = [
    /^password/i, /passwd/i, /^hash/i, /labor_pin/i, /(^|_)pin$/i,
    /token/i, /secret/i, /api_key/i, /api_consumer/i, /certificad/i, /(^|_)cert/i,
    /^clave/i, /private/i,
    /pay_bank/i, /account_number/i, /(^|_)cvv/i, /(^|_)card_number/i,
];

// Datos personales identificatorios. Pedido explícito: RUT fuera. Se suman
// teléfono, correo y dirección — un asistente de negocio contesta "cuánto me
// deben" y "quiénes deben", nunca necesita el RUT ni el celular de nadie para
// eso, y son exactamente los campos que convierten un listado en una filtración.
const PERSONAL = [
    /(^|_)rut($|_)/i, /(^|_)dni($|_)/i,
    /(^|_)phone($|_)/i, /telefono/i, /celular/i,
    /(^|_)email($|_)/i, /correo/i,
    /(^|_)address($|_)/i, /direccion/i, /domicilio/i,
];

const BLOQUEADOS = [...PROHIBIDO, ...PERSONAL];

const esBloqueado = (campo) => BLOQUEADOS.some(re => re.test(campo));

/**
 * Limpia lo que devuelve un reporte antes de que lo vea el modelo.
 * Funciona sobre filas, objetos anidados y arrays, porque los reportes devuelven
 * las tres formas y el dato peligroso puede estar en cualquiera.
 *
 * Devuelve también qué se quitó, para poder auditarlo sin tener que confiar.
 */
export function limpiarParaIA(valor, quitados = new Set()) {
    if (Array.isArray(valor)) {
        return { datos: valor.map(v => limpiarParaIA(v, quitados).datos), quitados };
    }
    if (valor && typeof valor === 'object') {
        const salida = {};
        for (const [k, v] of Object.entries(valor)) {
            if (esBloqueado(k)) { quitados.add(k); continue; }
            salida[k] = (v && typeof v === 'object')
                ? limpiarParaIA(v, quitados).datos
                : v;
        }
        return { datos: salida, quitados };
    }
    return { datos: valor, quitados };
}

// Reportes que no se exponen enteros, porque el reporte ENTERO es el problema:
// son las pantallas de Configuración. Ahí no hay una columna que filtrar — el
// contenido completo son credenciales, certificados y parámetros de conexión.
export const REPORTES_VEDADOS = new Set([
    'siiConfigPos', 'receiptConfig', 'companyPreventaInfo',
    'latestDteByType', 'dteMapBySales', 'dteForSale', 'dtesList',
]);

export { esBloqueado };
