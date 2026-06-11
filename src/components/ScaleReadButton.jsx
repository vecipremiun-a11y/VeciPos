import React, { useState } from 'react';
import { Scale, Loader2 } from 'lucide-react';
import { scaleService } from '../lib/scale/scaleService';

// Botón chico que aparece en la tarjeta del carrito para productos por kg.
// Al apretarlo, espera que la báscula marque peso estable y dispara
// `onWeight(kg)` con el peso leído.
//
// Estados:
//   - báscula no soportada / sin conexión → tooltip "Configurar báscula"
//   - leyendo → spinner
//   - éxito → llama onWeight
//   - error / timeout → mensaje breve por 2s
const ScaleReadButton = ({ onWeight, className = '' }) => {
    const [state, setState] = useState('idle'); // 'idle' | 'reading' | 'error'
    const [errorMsg, setErrorMsg] = useState('');
    const supported = scaleService.isSupported();
    const connected = scaleService.isConnected();

    const handleClick = async () => {
        if (state === 'reading') return;
        if (!supported) {
            setErrorMsg('Tu navegador no soporta báscula. Usa Chrome o Edge.');
            setState('error');
            setTimeout(() => setState('idle'), 2500);
            return;
        }
        if (!connected) {
            // Intentar reconectar al último puerto autorizado antes de exigir config
            const ok = await scaleService.connectRemembered().catch(() => false);
            if (!ok) {
                setErrorMsg('Conecta la báscula en Configuración → Báscula.');
                setState('error');
                setTimeout(() => setState('idle'), 2500);
                return;
            }
        }
        setState('reading');
        try {
            const reading = await scaleService.readStable({ timeoutMs: 6000 });
            if (reading.weight > 0 && onWeight) onWeight(Number(reading.weight.toFixed(3)));
            setState('idle');
        } catch (e) {
            setErrorMsg(e?.message || 'No se pudo leer.');
            setState('error');
            setTimeout(() => setState('idle'), 2500);
        }
    };

    const title = state === 'error'
        ? errorMsg
        : connected
            ? 'Leer peso de la báscula'
            : 'Báscula no conectada (Configuración → Báscula)';

    return (
        <button
            type="button"
            onClick={handleClick}
            disabled={state === 'reading'}
            title={title}
            className={
                'inline-flex items-center justify-center w-7 h-7 rounded-md border border-[var(--glass-border)] ' +
                'transition-colors ' +
                (state === 'error'
                    ? 'bg-red-500/15 text-red-300 border-red-500/40'
                    : connected
                        ? 'bg-[var(--color-primary)]/15 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/25'
                        : 'bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]') +
                ' ' + className
            }
        >
            {state === 'reading'
                ? <Loader2 size={14} className="animate-spin" />
                : <Scale size={14} />}
        </button>
    );
};

export default ScaleReadButton;
