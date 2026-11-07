// Las cuentas de Producción: cuánto cuesta un gramo de cada insumo y cuánto
// cuesta lo que se fabrica con ellos. Sin red ni estado: entra la receta y los
// insumos, sale el costo.
//
// DECISIÓN DE KEVIN (6-nov-2026): la receta usa el COSTO + IVA de cada insumo,
// nunca el precio de venta. Es la última fila de impuestos de su ficha, lo que
// dice la factura (incluye otros impuestos, como el 5% del cerdo).
//
//   costo por gramo  = costo con impuestos ÷ (contenido en g × (1 − merma))
//   costo de la línea = cantidad (en g) × costo por gramo
//   costo de la tanda = suma de las líneas + otros costos (gas, luz, mano de obra)
//   costo por unidad  = costo de la tanda ÷ lo que rinde
//
// Al pasarlo a la ficha del producto fabricado ("Usar como costo") se le saca el
// IVA de ESE producto, porque el campo Costo es siempre sin IVA: así su fila
// "Costo + IVA" muestra exactamente el costo de la receta y el precio queda
// costo de la receta × (1 + utilidad), igual que con cualquier producto comprado.
// El IVA no se cuenta dos veces.

// Con extensión: así también lo puede importar Node (scripts/optim/test-produccion-recetas.mjs).
import { costoConImpuestos, tasaExtra } from './impuestosProducto.js';
import { getCurrencyConfig } from '../utils/formatCurrency.js';

export const UNIDADES = {
    g: { familia: 'peso', factor: 1, nombre: 'g', largo: 'gramo' },
    kg: { familia: 'peso', factor: 1000, nombre: 'kg', largo: 'kilo' },
    ml: { familia: 'volumen', factor: 1, nombre: 'ml', largo: 'ml' },
    L: { familia: 'volumen', factor: 1000, nombre: 'L', largo: 'litro' },
    und: { familia: 'unidad', factor: 1, nombre: 'und', largo: 'unidad' },
};

export const UNIDADES_POR_FAMILIA = {
    peso: ['g', 'kg'],
    volumen: ['ml', 'L'],
    unidad: ['und'],
};

const num = (v) => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
};

/**
 * Cómo se mide un insumo: en qué familia (peso, volumen, unidades) y cuánto trae
 * una unidad del producto, en la unidad chica de esa familia (g, ml, und).
 *
 *  - Con contenido cargado ("trae 25 kg"): eso.
 *  - Producto por Kg o Lt: su propia unidad (1 kg = 1.000 g).
 *  - Si no, se cuenta por unidades. Sirve para un huevo o una vienesa; para un
 *    saco es un error, y por eso va marcado `sinContenido`.
 */
export function medidaInsumo(producto, produccion) {
    const contenido = num(produccion?.input_content);
    const u = UNIDADES[produccion?.input_unit];
    const merma = Math.min(Math.max(num(produccion?.input_waste), 0), 95);
    if (contenido > 0 && u) {
        return { familia: u.familia, porUnidad: contenido * u.factor, merma, contenido, unidad: produccion.input_unit, sinContenido: false };
    }
    const unidad = String(producto?.unit || 'Und').toLowerCase();
    if (unidad === 'kg') return { familia: 'peso', porUnidad: 1000, merma, contenido: 1, unidad: 'kg', sinContenido: false, porSuUnidad: true };
    if (unidad === 'lt' || unidad === 'l') return { familia: 'volumen', porUnidad: 1000, merma, contenido: 1, unidad: 'L', sinContenido: false, porSuUnidad: true };
    return { familia: 'unidad', porUnidad: 1, merma, contenido: 1, unidad: 'und', sinContenido: true };
}

/** Lo que cuesta una unidad del producto con IVA y otros impuestos. */
export const costoUnidadConImpuestos = (producto) =>
    costoConImpuestos(producto?.cost, producto?.tax_rate, producto?.extra_taxes);

/** Lo que cuesta un gramo (o ml, o unidad) del insumo, ya contando la merma. */
export function costoPorBase(producto, produccion) {
    const m = medidaInsumo(producto, produccion);
    const util = m.porUnidad * (1 - m.merma / 100);
    if (!(util > 0)) return 0;
    return costoUnidadConImpuestos(producto) / util;
}

/** La unidad que se propone al agregar el insumo a una receta. */
export function unidadSugerida(producto, produccion) {
    const m = medidaInsumo(producto, produccion);
    if (m.familia === 'peso') return m.porUnidad >= 1000 ? 'kg' : 'g';
    if (m.familia === 'volumen') return m.porUnidad >= 1000 ? 'L' : 'ml';
    return 'und';
}

/**
 * Una línea de la receta. `insumo` = { producto, produccion } o undefined si el
 * producto ya no existe.
 */
export function calcularLinea(linea, insumo) {
    const qty = num(linea?.qty);
    if (!insumo?.producto) return { costo: 0, error: 'eliminado' };
    const m = medidaInsumo(insumo.producto, insumo.produccion);
    const u = UNIDADES[linea?.unit];
    if (!u || u.familia !== m.familia) return { costo: 0, error: 'unidad', medida: m };
    const costo = qty * u.factor * costoPorBase(insumo.producto, insumo.produccion);
    let aviso = null;
    if (!(num(insumo.producto.cost) > 0)) aviso = 'sinCosto';
    else if (m.sinContenido) aviso = 'sinContenido';
    return { costo, error: qty > 0 ? null : 'cantidad', aviso, medida: m };
}

/**
 * La receta completa. `insumos` es un mapa id → { producto, produccion }.
 * Devuelve el costo de la tanda, por unidad, y cuántas líneas tienen problemas.
 */
export function calcularReceta(receta, insumos) {
    const items = Array.isArray(receta?.items) ? receta.items : [];
    const otros = Array.isArray(receta?.others) ? receta.others : [];
    const lineas = items.map((l) => ({ ...l, ...calcularLinea(l, insumos?.[l.product_id] ?? insumos?.[String(l.product_id)]) }));
    const totalInsumos = lineas.reduce((s, l) => s + (l.error ? 0 : l.costo), 0);
    const totalOtros = otros.reduce((s, o) => s + Math.max(num(o?.amount), 0), 0);
    const total = totalInsumos + totalOtros;
    const rinde = num(receta?.yield);
    return {
        lineas,
        totalInsumos,
        totalOtros,
        total,
        rinde: rinde > 0 ? rinde : null,
        porUnidad: rinde > 0 ? total / rinde : null,
        errores: lineas.filter((l) => l.error).length,
        avisos: lineas.filter((l) => !l.error && l.aviso).length,
    };
}

/**
 * Lo que va en el campo Costo ($) del producto fabricado: el costo de la receta
 * sin el IVA (ni los otros impuestos) de ese producto. Ver el porqué arriba.
 */
export function costoNetoParaFicha(porUnidad, iva, extras) {
    const n = num(porUnidad);
    if (!(n > 0)) return 0;
    return n / (1 + (num(iva) + tasaExtra(extras)) / 100);
}

// "Harina Morro 25 kg" → 25 kg. Solo propone: la persona lo confirma.
const RE_MEDIDA = /(\d+(?:[.,]\d+)?)\s*(kilos?|kgs?|kg\.?|gramos?|grs?\.?|g|cc|ml|litros?|lts?\.?|lt|l)(?![a-záéíóúñ])/i;
const RE_UNIDADES = /(?:\bx\s*(\d+)\b|\b(\d+)\s*(?:unidades|unid\.?|und\.?|un\.?|u)(?![a-záéíóúñ]))/i;

export function sugerirContenido(nombre) {
    const texto = String(nombre || '');
    const m = texto.match(RE_MEDIDA);
    if (m) {
        const cantidad = num(m[1]);
        const u = m[2].toLowerCase().replace('.', '');
        let unidad = null;
        if (/^(kilos?|kgs?|kg)$/.test(u)) unidad = 'kg';
        else if (/^(gramos?|grs?|g)$/.test(u)) unidad = 'g';
        else if (/^(cc|ml)$/.test(u)) unidad = 'ml';
        else if (/^(litros?|lts?|lt|l)$/.test(u)) unidad = 'L';
        if (unidad && cantidad > 0) return { content: cantidad, unit: unidad };
    }
    const n = texto.match(RE_UNIDADES);
    if (n) {
        const cantidad = num(n[1] || n[2]);
        if (cantidad > 1) return { content: cantidad, unit: 'und' };
    }
    return null;
}

/**
 * Plata con los decimales que hacen falta: un gramo de harina cuesta $0,69 y
 * un pan $47,05, y redondearlos a peso los vuelve inútiles. Desde $100 para
 * arriba, como siempre.
 */
export function plataFina(valor, moneda = 'CLP') {
    const cfg = getCurrencyConfig(moneda);
    const v = num(valor);
    const decimales = Math.abs(v) < 100 ? Math.max(cfg.decimals, 2) : cfg.decimals;
    const texto = new Intl.NumberFormat(cfg.locale, { minimumFractionDigits: 0, maximumFractionDigits: decimales }).format(v);
    return cfg.position === 'before' ? `${cfg.symbol}${texto}` : `${texto}${cfg.symbol}`;
}

/** "25 kg", "1,5 L", "30 und". */
export function textoCantidad(cantidad, unidad) {
    const n = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 3 }).format(num(cantidad));
    return `${n} ${UNIDADES[unidad]?.nombre || unidad || ''}`.trim();
}

/** Cómo se llama lo que rinde una tanda, según la unidad del producto fabricado. */
export function nombreRinde(unidadProducto) {
    const u = String(unidadProducto || 'Und').toLowerCase();
    if (u === 'kg') return 'kg';
    if (u === 'lt' || u === 'l') return 'L';
    if (u === 'caja') return 'cajas';
    if (u === 'mt') return 'mt';
    return 'unidades';
}

/** Lo mismo en singular, para "costo por …". */
export function nombreRindeUno(unidadProducto) {
    const u = String(unidadProducto || 'Und').toLowerCase();
    if (u === 'kg') return 'kg';
    if (u === 'lt' || u === 'l') return 'L';
    if (u === 'caja') return 'caja';
    if (u === 'mt') return 'mt';
    return 'unidad';
}

/** El estado de la ficha, en el formato que se guarda. null = nada que guardar. */
export function normalizarProduccion(p) {
    if (!p) return null;
    const esInsumo = !!p.is_input;
    const contenido = num(p.input_content);
    const unidad = UNIDADES[p.input_unit] ? p.input_unit : null;
    const receta = p.recipe
        ? {
            yield: num(p.recipe.yield) > 0 ? num(p.recipe.yield) : null,
            items: (p.recipe.items || [])
                .map((i) => ({ product_id: Number(i.product_id), qty: num(i.qty), unit: i.unit }))
                .filter((i) => i.product_id > 0 && i.qty > 0 && UNIDADES[i.unit]),
            others: (p.recipe.others || [])
                .map((o) => ({ name: String(o.name || '').trim(), amount: Math.max(num(o.amount), 0) }))
                .filter((o) => o.name || o.amount > 0),
        }
        : null;
    const recetaVacia = !receta || (!receta.yield && !receta.items.length && !receta.others.length);
    if (!esInsumo && recetaVacia) return null;
    return {
        is_input: esInsumo,
        input_content: esInsumo && contenido > 0 && unidad ? contenido : null,
        input_unit: esInsumo && contenido > 0 && unidad ? unidad : null,
        input_waste: esInsumo ? Math.min(Math.max(num(p.input_waste), 0), 95) : 0,
        recipe: recetaVacia ? null : receta,
    };
}
