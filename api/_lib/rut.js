// Validación de RUT chileno en el servidor.
//
// El navegador ya valida (src/utils/rutValidation.js) para dar feedback al
// escribir, pero el que responde por el dato guardado es el servidor: un RUT
// inválido en un registro de asistencia lo invalida como prueba de identidad.

export function cleanRut(rut) {
    return String(rut || '').replace(/[.\-\s]/g, '').toUpperCase();
}

export function rutIsValid(rut) {
    const clean = cleanRut(rut);
    if (clean.length < 2) return false;

    const body = clean.slice(0, -1);
    const dv = clean.slice(-1);
    if (!/^\d+$/.test(body)) return false;

    let sum = 0;
    let mul = 2;
    for (let i = body.length - 1; i >= 0; i--) {
        sum += parseInt(body[i], 10) * mul;
        mul = mul === 7 ? 2 : mul + 1;
    }
    const rest = 11 - (sum % 11);
    const expected = rest === 11 ? '0' : rest === 10 ? 'K' : String(rest);
    return expected === dv;
}

// Normaliza a "12345678-9": una sola forma guardada, sin puntos, DV en mayúscula.
// El formato con puntos es cosa de la pantalla, no de la base.
export function normalizeRut(rut) {
    const clean = cleanRut(rut);
    if (clean.length < 2) return null;
    return `${clean.slice(0, -1)}-${clean.slice(-1)}`;
}
