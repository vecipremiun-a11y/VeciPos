import React, { useEffect, useRef, useState } from 'react';
import { FileText, Check } from 'lucide-react';
import { useStore } from '../store/useStore';
import { reportCall } from '../lib/dataApi';
import { isThermalAvailable } from '../lib/thermalPrint';
import { cn } from '../lib/utils';
import { FORMATOS_BOLETA, formatoAImprimir, guardarFormatoDelUsuario } from '../lib/formatoImpresion';

/**
 * Botón del POS para elegir en qué formato imprime la boleta ESTE usuario en
 * ESTE equipo: 58mm, 80mm o A4 (ver lib/formatoImpresion.js). Lo elegido vale
 * para imprimir después de la venta y para reimprimir desde el Historial.
 *
 * En la app del celular no aparece: ahí imprime la térmica Bluetooth.
 */
export default function FormatoBoletaButton({ className }) {
    const activeCompanyId = useStore((s) => s.activeCompanyId);
    const userId = useStore((s) => s.currentUser?.id);
    const [formato, setFormato] = useState(() => formatoAImprimir(null, activeCompanyId, userId));
    const [abierto, setAbierto] = useState(false);
    const caja = useRef(null);

    // Sin elección propia, se muestra el de la empresa (Configuración → Boleta).
    useEffect(() => {
        let vivo = true;
        setFormato(formatoAImprimir(null, activeCompanyId, userId));
        reportCall(activeCompanyId, 'receiptConfig', {})
            .then(rows => { if (vivo) setFormato(formatoAImprimir(rows?.[0] || null, activeCompanyId, userId)); })
            .catch(() => { /* sin conexión: queda el del usuario o 58mm */ });
        return () => { vivo = false; };
    }, [activeCompanyId, userId]);

    // Se cierra al tocar fuera.
    useEffect(() => {
        if (!abierto) return undefined;
        const fuera = (e) => { if (caja.current && !caja.current.contains(e.target)) setAbierto(false); };
        document.addEventListener('pointerdown', fuera);
        return () => document.removeEventListener('pointerdown', fuera);
    }, [abierto]);

    if (isThermalAvailable()) return null;

    const actual = FORMATOS_BOLETA.find(f => f.id === formato) || FORMATOS_BOLETA[0];
    const elegir = (f) => {
        guardarFormatoDelUsuario(activeCompanyId, userId, f.id);
        setFormato(f.id);
        setAbierto(false);
    };

    return (
        <div ref={caja} className={cn('relative shrink-0', className)}>
            <button type="button" onClick={() => setAbierto(a => !a)}
                title={`Boleta en ${actual.nombre} · tocar para cambiar`}
                aria-haspopup="listbox" aria-expanded={abierto}
                className="h-full min-h-[44px] px-3 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[var(--color-text)] hover:border-[var(--color-primary)]/50 flex items-center gap-1.5 text-xs font-bold">
                <FileText size={16} className="text-[var(--color-primary)]" />
                {actual.nombre}
            </button>
            {abierto && (
                <div role="listbox" className="absolute right-0 top-full mt-2 z-50 w-56 rounded-xl border border-[var(--glass-border)] bg-[var(--color-surface)] shadow-2xl p-1.5">
                    <p className="px-2.5 pt-1.5 pb-2 text-[11px] text-[var(--color-text-muted)]">Formato de la boleta (tu impresora)</p>
                    {FORMATOS_BOLETA.map(f => (
                        <button key={f.id} type="button" role="option" aria-selected={f.id === formato}
                            onClick={() => elegir(f)}
                            className={cn('w-full flex items-center gap-2 px-2.5 py-2.5 rounded-lg text-left transition-colors',
                                f.id === formato ? 'bg-[var(--color-primary)]/15' : 'hover:bg-[var(--glass-bg)]')}>
                            <span className="flex-1 min-w-0">
                                <span className="block text-sm font-bold text-[var(--color-text)]">{f.nombre}</span>
                                <span className="block text-[11px] text-[var(--color-text-muted)]">{f.detalle}</span>
                            </span>
                            {f.id === formato && <Check size={16} className="text-[var(--color-primary)] shrink-0" />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
