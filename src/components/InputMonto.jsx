import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { getCurrencyConfig } from '../utils/formatCurrency';
import { cn } from '../lib/utils';

/**
 * Campo de monto con la moneda de la empresa: el símbolo adelante y los miles
 * separados mientras se escribe (en CLP, 750000 → 750.000). Devuelve un número
 * con `onChange(numero)`; vacío = 0.
 *
 * Existe porque los montos del personal (sueldo, anticipos, bonos) eran
 * `type="number"` y se veían "750000", todo junto (Kevin, 13-nov-2026).
 *
 * Decimales: solo si la moneda los usa (USD, EUR…), con el separador de su
 * país. En CLP cualquier punto o coma se ignora: "25.000" es 25000.
 */
const agrupar = (digitos, miles) => digitos.replace(/\B(?=(\d{3})+(?!\d))/g, miles);

function separadores(locale) {
    try {
        const partes = new Intl.NumberFormat(locale).formatToParts(1234567.5);
        return {
            miles: partes.find((p) => p.type === 'group')?.value ?? '.',
            decimal: partes.find((p) => p.type === 'decimal')?.value ?? ',',
        };
    } catch {
        return { miles: '.', decimal: ',' };
    }
}

// Texto escrito → { texto formateado, número }.
function leer(crudo, { decimales, miles, decimal }) {
    let s = String(crudo ?? '');
    let decs = null;
    if (decimales > 0) {
        const i = s.indexOf(decimal);
        if (i !== -1) {
            decs = s.slice(i + 1).replace(/\D/g, '').slice(0, decimales);
            s = s.slice(0, i);
        }
    }
    const ent = s.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    if (ent === '' && decs === null) return { texto: '', numero: 0 };
    const texto = agrupar(ent || '0', miles) + (decs !== null ? decimal + decs : '');
    return { texto, numero: Number(`${ent || '0'}.${decs || '0'}`) };
}

// Número (del formulario) → texto para mostrar.
function mostrar(valor, { decimales, miles, decimal }) {
    const n = Number(valor);
    if (!valor || !Number.isFinite(n) || n <= 0) return '';
    const [ent, dec = ''] = n.toFixed(decimales).split('.');
    const decs = dec.replace(/0+$/, '');
    return agrupar(ent, miles) + (decs ? decimal + decs : '');
}

const InputMonto = ({ value, onChange, className, moneda, placeholder = '0', ...resto }) => {
    const monedaEmpresa = useStore((s) => s.currentCurrency);
    const cfg = getCurrencyConfig(moneda || monedaEmpresa || 'CLP');
    const formato = { decimales: cfg.decimals, ...separadores(cfg.locale) };

    const [texto, setTexto] = useState(() => mostrar(value, formato));
    const ref = useRef(null);
    // Cuántos dígitos quedaban a la izquierda del cursor: al agregar o sacar un
    // separador de miles, el cursor vuelve a quedar después del mismo dígito.
    const cursor = useRef(null);

    // Si el valor cambia desde afuera (abrir otro usuario, limpiar el
    // formulario), se muestra ese; si es el mismo que se está escribiendo, no se
    // toca para no borrar un decimal a medio escribir.
    useEffect(() => {
        if (Number(value || 0) !== leer(texto, formato).numero) setTexto(mostrar(value, formato));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, cfg.code]);

    useLayoutEffect(() => {
        const el = ref.current;
        if (cursor.current == null || !el || document.activeElement !== el) return;
        let vistos = 0;
        let pos = 0;
        while (pos < texto.length && vistos < cursor.current) {
            if (/\d/.test(texto[pos]) || texto[pos] === formato.decimal) vistos++;
            pos++;
        }
        el.setSelectionRange(pos, pos);
        cursor.current = null;
    });

    const alEscribir = (e) => {
        const crudo = e.target.value;
        const hasta = crudo.slice(0, e.target.selectionStart ?? crudo.length);
        cursor.current = (hasta.match(/\d/g) || []).length
            + (formato.decimales > 0 && hasta.includes(formato.decimal) ? 1 : 0);
        const { texto: nuevo, numero } = leer(crudo, formato);
        setTexto(nuevo);
        onChange?.(numero);
    };

    // Espacio para el símbolo ($, S/, R$, Bs…) antes del número.
    const sangria = `calc(0.75rem + ${cfg.symbol.length}ch + 0.5rem)`;
    return (
        <div className="relative">
            <span className="pointer-events-none absolute z-10 left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]">
                {cfg.symbol}
            </span>
            <input
                {...resto}
                ref={ref}
                type="text"
                inputMode={formato.decimales > 0 ? 'decimal' : 'numeric'}
                autoComplete="off"
                className={cn('glass-input w-full', className)}
                style={{ paddingLeft: sangria, ...(resto.style || {}) }}
                value={texto}
                onChange={alEscribir}
                placeholder={placeholder}
            />
        </div>
    );
};

export default InputMonto;
