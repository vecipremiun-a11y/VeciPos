/**
 * Validación y formateo de RUT chileno
 */

// Limpiar RUT: remover puntos y guion
export function cleanRut(rut) {
    if (!rut) return '';
    return String(rut).replace(/[.\-\s]/g, '').toUpperCase();
}

// Calcular dígito verificador
function calcDv(rutBody) {
    let sum = 0;
    let mul = 2;
    for (let i = rutBody.length - 1; i >= 0; i--) {
        sum += parseInt(rutBody[i]) * mul;
        mul = mul === 7 ? 2 : mul + 1;
    }
    const remainder = 11 - (sum % 11);
    if (remainder === 11) return '0';
    if (remainder === 10) return 'K';
    return String(remainder);
}

// Validar RUT chileno (retorna true si es válido)
export function validateRut(rut) {
    if (!rut) return false;
    const clean = cleanRut(rut);
    if (clean.length < 2) return false;

    const body = clean.slice(0, -1);
    const dv = clean.slice(-1);

    if (!/^\d+$/.test(body)) return false;
    if (parseInt(body) < 1000000) return false; // mínimo 1.000.000

    return calcDv(body) === dv;
}

// Formatear RUT: 12345678-9 → 12.345.678-9
export function formatRut(rut) {
    if (!rut) return '';
    const clean = cleanRut(rut);
    if (clean.length < 2) return rut;

    const body = clean.slice(0, -1);
    const dv = clean.slice(-1);

    // Agregar puntos cada 3 dígitos desde la derecha
    const formatted = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${formatted}-${dv}`;
}

// Formatear mientras se escribe (sin puntos, solo guion)
export function formatRutInput(rut) {
    if (!rut) return '';
    const clean = cleanRut(rut);
    if (clean.length <= 1) return clean;

    const body = clean.slice(0, -1);
    const dv = clean.slice(-1);
    return `${body}-${dv}`;
}
