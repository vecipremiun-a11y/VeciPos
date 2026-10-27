// Formato de la boleta que imprime cada usuario: 58mm, 80mm o A4.
//
// Configuración → Boleta guarda el formato de la empresa. Pero cada caja tiene su
// impresora (una térmica de 58, otra de 80, la oficina una de hoja), así que
// desde el POS cada usuario elige el suyo (botón de formato junto a "Buscar
// cliente", pedido por Kevin el 23-oct-2026). Se guarda en ESTE equipo y para
// ESE usuario: el formato depende de la impresora que tiene al lado. Si no eligió
// nada, vale el de la empresa.
//
// En la app del celular no aplica: ahí se imprime por Bluetooth en la térmica, con
// el ancho de papel de su impresora (Configuración → Impresora térmica).

export const FORMATOS_BOLETA = [
    { id: '58mm', nombre: '58mm', detalle: 'Térmica angosta' },
    { id: '80mm', nombre: '80mm', detalle: 'Térmica ancha' },
    { id: 'a4', nombre: 'A4', detalle: 'Carta / Hoja completa' },
];

const valido = (f) => FORMATOS_BOLETA.some(x => x.id === f);
const clave = (companyId, userId) => `posveci:formatoBoleta:${companyId || 'sin'}:${userId || 'sin'}`;

/** El formato que eligió este usuario en este equipo, o null. */
export function formatoDelUsuario(companyId, userId) {
    try {
        const f = localStorage.getItem(clave(companyId, userId));
        return valido(f) ? f : null;
    } catch {
        return null;
    }
}

/** Guarda el formato del usuario en este equipo. */
export function guardarFormatoDelUsuario(companyId, userId, formato) {
    if (!valido(formato)) return;
    try { localStorage.setItem(clave(companyId, userId), formato); } catch { /* sin almacenamiento: vale el de la empresa */ }
}

/** Con qué formato se imprime: el del usuario, si no el de la empresa, si no 58mm. */
export function formatoAImprimir(receiptConfig, companyId, userId) {
    const deEmpresa = valido(receiptConfig?.format) ? receiptConfig.format : null;
    return formatoDelUsuario(companyId, userId) || deEmpresa || '58mm';
}
