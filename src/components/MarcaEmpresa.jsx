import React, { useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';

/**
 * Lo de arriba del menú: el nombre de fantasía de la empresa activa, con
 * POSVECI chico debajo (Kevin, 9-nov-2026). Sin nombre de fantasía, POSVECI
 * como siempre.
 *
 * El nombre usa la letra más grande con la que entra en una línea; si ni con la
 * más chica entra, pasa a dos líneas. Se mide el texto de verdad y no se cuentan
 * letras: "MINIMARKET" en mayúsculas ocupa bastante más que "minimarket".
 */
const TAMANOS = [24, 20, 17];
const TAMANO_DOS_LINEAS = 15;

let lienzo = null;
function tamanoQueEntra(h1, nombre) {
    const ancho = h1.clientWidth;
    if (!ancho) return null; // oculto: se mide cuando se vea
    const cs = getComputedStyle(h1);
    lienzo = lienzo || document.createElement('canvas').getContext('2d');
    for (let i = 0; i < TAMANOS.length; i++) {
        lienzo.font = `${cs.fontWeight} ${TAMANOS[i]}px ${cs.fontFamily}`;
        if (lienzo.measureText(nombre).width <= ancho) return i;
    }
    return TAMANOS.length;
}

const MarcaEmpresa = ({ oculta, movil }) => {
    const nombre = useStore((s) => s.companyFantasyNames?.[s.activeCompanyId] || '');
    const ref = useRef(null);
    const [tamano, setTamano] = useState(0);

    useLayoutEffect(() => {
        if (!nombre) return undefined;
        const medir = () => {
            const t = ref.current && tamanoQueEntra(ref.current, nombre);
            if (t != null) setTamano(t);
        };
        medir();
        // Si la fuente llega después, las medidas cambian.
        let vivo = true;
        document.fonts?.ready?.then(() => { if (vivo) medir(); });
        return () => { vivo = false; };
    }, [nombre, movil, oculta]);

    if (!nombre) {
        return (
            <h1 className={cn('font-bold text-2xl neon-text transition-opacity duration-300 text-[var(--color-text)]', oculta && 'opacity-0 hidden')}>
                POSVECI
            </h1>
        );
    }

    const dosLineas = tamano >= TAMANOS.length;
    return (
        <div
            data-prueba="marca-empresa"
            title={nombre}
            className={cn(
                'flex flex-col items-center justify-center min-w-0 w-full text-center transition-opacity duration-300',
                // En el celular el botón ☰ va adentro, a la derecha: mismo margen a los dos lados para que quede centrado.
                movil ? 'px-12' : 'px-5',
                oculta && 'opacity-0 hidden',
            )}
        >
            <h1
                ref={ref}
                style={{ fontSize: dosLineas ? TAMANO_DOS_LINEAS : TAMANOS[tamano] }}
                className={cn(
                    'font-bold neon-text text-[var(--color-text)] w-full',
                    dosLineas ? 'leading-tight line-clamp-2 break-words' : 'leading-tight whitespace-nowrap overflow-hidden text-ellipsis',
                )}
            >
                {nombre}
            </h1>
            <span className="text-[9px] font-semibold tracking-[0.35em] text-[var(--color-text-muted)] opacity-70 mt-0.5 pl-[0.35em]">
                POSVECI
            </span>
        </div>
    );
};

export default MarcaEmpresa;
