// ¿La oferta de un producto vale AHORA? (reglas de la migración 0033)
//
// Una oferta se apaga sola con la primera regla que se cumpla:
//   · `hasta`   pasó la fecha y hora
//   · `limite`  se vendieron esas unidades a precio de oferta
//
// Las reglas no vienen en el producto: las manda la revisión de ofertas
// (offersSweep) y el store las guarda en `reglasOferta` por id de producto. Así
// el POS deja de cobrar la oferta a la hora exacta aunque el catálogo todavía
// no se haya actualizado.

const esOferta = (p) => (p?.is_offer === 1 || p?.is_offer === true) && Number(p?.offer_price) > 0;

/** `regla` = { hasta, limite, vendidas, apagada } o undefined (sin reglas). */
export function ofertaVigente(producto, regla, ahora = Date.now()) {
    if (!esOferta(producto)) return false;
    if (!regla) return true;
    if (regla.apagada) return false;
    if (regla.hasta && ahora >= new Date(regla.hasta).getTime()) return false;
    const limite = Number(regla.limite) || 0;
    if (limite > 0 && (Number(regla.vendidas) || 0) >= limite) return false;
    return true;
}

/** "Quedan 4 de 10 · hasta mié 08 oct 20:00", o null si no tiene reglas. */
export function resumenOferta(regla) {
    if (!regla || regla.apagada) return null;
    const partes = [];
    const limite = Number(regla.limite) || 0;
    if (limite > 0) partes.push(`Quedan ${Math.max(0, limite - (Number(regla.vendidas) || 0))} de ${limite}`);
    if (regla.hasta) {
        const f = new Date(regla.hasta);
        partes.push(`hasta ${f.toLocaleDateString('es-CL', { weekday: 'short', day: '2-digit', month: 'short' })} ${f.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}`);
    }
    return partes.length ? partes.join(' · ') : null;
}

/** Instante ISO → valor para <input type="datetime-local"> en hora local. */
export function aInputLocal(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return '';
    const dos = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}T${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

/** Valor de <input type="datetime-local"> (hora local) → instante ISO, o null. */
export function deInputLocal(valor) {
    if (!valor) return null;
    const d = new Date(valor);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** Atajos de "hasta": hoy a las 23:59, o dentro de N días a las 23:59 (hora local). */
export function finDelDia(diasDesdeHoy = 0) {
    const d = new Date();
    d.setDate(d.getDate() + diasDesdeHoy);
    d.setHours(23, 59, 0, 0);
    return d.toISOString();
}
