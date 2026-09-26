const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/**
 * 'YYYY-MM-DD' → "17 sep" (o "17 sep 2025" si no es de este año).
 *
 * La fecha se arma en hora LOCAL: `new Date('2026-09-17')` se interpreta como
 * UTC y en Chile eso muestra el día anterior.
 */
export function fechaCorta(texto) {
    if (!texto) return '';
    const [a, m, d] = String(texto).split('-').map(Number);
    if (!a || !m || !d) return '';
    const fecha = new Date(a, m - 1, d);
    const mes = MESES[fecha.getMonth()].slice(0, 3);
    const año = fecha.getFullYear() !== new Date().getFullYear() ? ` ${fecha.getFullYear()}` : '';
    return `${fecha.getDate()} ${mes}${año}`;
}

export { MESES };
