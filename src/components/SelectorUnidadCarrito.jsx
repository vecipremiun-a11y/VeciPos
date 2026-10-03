import React from 'react';
import { cn } from '../lib/utils';

/**
 * [ Und | Caja (30) | Display (24) ] en un renglón del carrito.
 *
 * Aparece solo si el producto tiene unidades de medida cargadas en su ficha.
 * Cambiar a "Caja" vende la caja entera a su precio: el vendedor no necesita
 * saber cuántas unidades trae, lo dice el renglón.
 */
export default function SelectorUnidadCarrito({ item, presentaciones, onElegir }) {
    if (!presentaciones?.length) return null;
    const actual = item.presentacion?.id ?? null;
    const boton = (activo) => cn(
        'px-2.5 py-1 rounded-md text-[11px] font-bold transition-all whitespace-nowrap',
        activo
            ? 'bg-[var(--color-primary)] text-[var(--color-on-primary)] shadow-sm'
            : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
    );
    return (
        <div className="inline-flex flex-wrap gap-0.5 p-0.5 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] mt-1">
            <button type="button" className={boton(actual === null)} onClick={() => actual !== null && onElegir(null)}>
                Und
            </button>
            {presentaciones.map(p => (
                <button key={p.id} type="button" className={boton(String(actual) === String(p.id))}
                    onClick={() => String(actual) !== String(p.id) && onElegir(p)}>
                    {p.name} ({Number(p.units)})
                </button>
            ))}
        </div>
    );
}
