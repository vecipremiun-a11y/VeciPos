import React, { useState, useRef, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * Botón que se bloquea solo mientras su acción trabaja.
 *
 * El problema que resuelve: un mouse con el clic sensible dispara dos veces en
 * milisegundos y se enviaba la operación dos veces — pasó con un abono de cliente
 * (dos filas del mismo segundo) y con una compra facturada. Duplicar plata es
 * grave, así que el botón deja de aceptar clics apenas empieza a trabajar.
 *
 * Y sobre todo LO MUESTRA, en el botón mismo: una rueda girando donde estaba el
 * icono, el texto cambiado a lo que está haciendo, y una franja de luz que lo
 * recorre de lado a lado. Quien apretó ve que su clic entró y no vuelve a apretar,
 * que es de donde salía el duplicado.
 *
 * Se usa igual que un <button> normal; solo hay que darle un `onClick` que
 * devuelva una promesa (una función `async`) para que sepa cuándo terminó.
 *
 *   <AsyncButton onClick={guardar} className="...">Guardar</AsyncButton>
 *
 * Props propias:
 *   · icon         icono a la izquierda; se reemplaza por la rueda mientras corre
 *   · loadingText  texto durante el trabajo (por defecto, el mismo de siempre)
 *   · busy         para forzarlo desde afuera si el estado vive en el padre
 */
export default function AsyncButton({
    onClick,
    children,
    className,
    disabled = false,
    icon = null,
    loadingText = null,
    busy = false,
    type = 'button',
    ...resto
}) {
    const [trabajando, setTrabajando] = useState(false);
    // Evita avisarle a un componente que ya se desmontó (los modales se cierran
    // solos al terminar, así que esto pasa casi siempre).
    const vivo = useRef(true);
    useEffect(() => () => { vivo.current = false; }, []);

    const corriendo = trabajando || busy;

    const manejar = async (e) => {
        // Aunque el botón ya está deshabilitado, esto ataja el clic que llega en
        // el mismo tick, antes de que React vuelva a pintar.
        if (corriendo || disabled) { e.preventDefault(); return; }
        if (!onClick) return;
        setTrabajando(true);
        try {
            await onClick(e);
        } finally {
            if (vivo.current) setTrabajando(false);
        }
    };

    return (
        <button
            type={type}
            onClick={manejar}
            disabled={disabled || corriendo}
            aria-busy={corriendo || undefined}
            className={cn(
                className,
                // El aviso va EN EL BOTÓN, no en el cursor del mouse: la rueda, el
                // texto y la franja de luz que lo recorre (.btn-trabajando) son lo
                // que le dice a quien lo apretó que el clic ya entró.
                corriendo && 'btn-trabajando',
                disabled && !corriendo && 'opacity-50 cursor-not-allowed',
            )}
            {...resto}
        >
            {corriendo
                ? <Loader2 size={18} className="animate-spin shrink-0" />
                : icon}
            {corriendo ? (loadingText || 'Procesando…') : children}
        </button>
    );
}
