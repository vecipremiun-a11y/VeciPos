// Nombre de fantasía de la empresa (Kevin, 9-nov-2026; migración 0039).
//
// Es el nombre corto con que el cliente reconoce su negocio: va arriba del menú
// en vez de POSVECI y en el selector de empresa, y distingue una sucursal de otra
// (se viene el traspaso entre sucursales). No lo usan la boleta, el SII ni la
// impresión.
//
// Lo usan el navegador y el servidor (companyActions), así que la regla de
// limpieza es una sola.

export const LARGO_NOMBRE_FANTASIA = 30;

/** Espacios de más fuera y hasta 30 caracteres. Vacío → null (no tiene). */
export function limpiarNombreFantasia(valor) {
    const s = String(valor ?? '').replace(/\s+/g, ' ').trim();
    return Array.from(s).slice(0, LARGO_NOMBRE_FANTASIA).join('').trim() || null;
}

/** Cómo se llama una empresa en pantalla: su nombre de fantasía o, si no tiene, el de siempre. */
export function nombreDeEmpresa(empresa, nombresFantasia) {
    if (!empresa) return '';
    return (nombresFantasia && nombresFantasia[empresa.id]) || empresa.name || '';
}
