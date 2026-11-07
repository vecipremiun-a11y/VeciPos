// Producción: qué productos son insumos, cuánto trae cada uno y la receta de lo
// que se fabrica (migración 0038). Fase 1, 6-nov-2026.
//
// Esto solo GUARDA datos. Las cuentas (costo por gramo, costo de la tanda, costo
// por unidad) se hacen en el navegador con src/lib/produccion.js, a partir del
// Costo de la ficha de cada insumo. El costo nunca se copia acá: si mañana sube
// la harina, todas las recetas lo ven sin que nadie las toque.
//
// Nada de esto mueve stock, ni lo lee la venta, el SII, la tienda o la impresión.

import { filtroBusquedaProducto } from './busquedaProductos.js';
import { PRODUCT_COLS_SIN_IMAGEN } from './reportActions.js';

export const UNIDADES_PRODUCCION = ['g', 'kg', 'ml', 'L', 'und'];

const MAX_LINEAS = 40;
const MAX_OTROS = 10;
const TOPE = 1_000_000;

const numero = (v) => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
};

/**
 * Deja la receta y los datos de insumo en un formato fijo, sin basura.
 * Devuelve null si no queda nada que guardar (ni insumo ni receta).
 * `productId` es el producto dueño de la receta: no puede ser su propio insumo.
 */
export function limpiarProduccion(valor, productId = null) {
    if (!valor || typeof valor !== 'object') return null;

    const esInsumo = !!valor.is_input;
    let contenido = numero(valor.input_content);
    let unidad = UNIDADES_PRODUCCION.includes(valor.input_unit) ? valor.input_unit : null;
    if (!(contenido > 0 && contenido < TOPE) || !unidad) { contenido = null; unidad = null; }
    let merma = numero(valor.input_waste);
    if (!(merma > 0)) merma = 0;
    if (merma > 95) merma = 95;

    let receta = null;
    const r = valor.recipe;
    if (r && typeof r === 'object') {
        const rinde = numero(r.yield);
        const items = (Array.isArray(r.items) ? r.items : [])
            .map((i) => ({
                product_id: Number(i?.product_id),
                qty: numero(i?.qty),
                unit: UNIDADES_PRODUCCION.includes(i?.unit) ? i.unit : null,
            }))
            .filter((i) => Number.isInteger(i.product_id) && i.product_id > 0
                && i.product_id !== Number(productId)
                && i.qty > 0 && i.qty < TOPE && i.unit)
            .slice(0, MAX_LINEAS);
        const otros = (Array.isArray(r.others) ? r.others : [])
            .map((o) => ({ name: String(o?.name ?? '').trim().slice(0, 60), amount: numero(o?.amount) }))
            .map((o) => ({ ...o, amount: o.amount > 0 && o.amount < 1e9 ? o.amount : 0 }))
            .filter((o) => o.name || o.amount > 0)
            .slice(0, MAX_OTROS);
        const yieldOk = rinde > 0 && rinde < TOPE ? rinde : null;
        if (items.length || otros.length || yieldOk) {
            receta = { yield: yieldOk, items, others: otros };
        }
    }

    if (!esInsumo && !receta) return null;
    return {
        is_input: esInsumo ? 1 : 0,
        // Los datos del insumo se guardan solo si está marcado como insumo.
        input_content: esInsumo ? contenido : null,
        input_unit: esInsumo ? unidad : null,
        input_waste: esInsumo ? merma : 0,
        recipe: receta,
    };
}

/** La fila tal cual la usa el navegador: la receta ya parseada. */
function filaPublica(f) {
    if (!f) return null;
    let receta = null;
    if (f.recipe) {
        try { receta = JSON.parse(f.recipe); } catch { receta = null; }
    }
    return {
        product_id: Number(f.product_id),
        is_input: Number(f.is_input) === 1,
        input_content: f.input_content == null ? null : Number(f.input_content),
        input_unit: f.input_unit || null,
        input_waste: Number(f.input_waste) || 0,
        recipe: receta,
        updated_at: f.updated_at || null,
    };
}

async function productoDeLaEmpresa(turso, companyId, productId) {
    const r = await turso.execute({
        sql: 'SELECT id FROM products WHERE id = ? AND company_id = ?',
        args: [productId, companyId],
    });
    return r.rows.length > 0;
}

/** De una lista de ids, los que son productos de esta empresa. */
async function idsDeLaEmpresa(turso, companyId, ids) {
    const unicos = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    const validos = new Set();
    for (let i = 0; i < unicos.length; i += 400) {
        const lote = unicos.slice(i, i + 400);
        const r = await turso.execute({
            sql: `SELECT id FROM products WHERE company_id = ? AND id IN (${lote.map(() => '?').join(',')})`,
            args: [companyId, ...lote],
        });
        for (const f of r.rows) validos.add(Number(f.id));
    }
    return validos;
}

/**
 * Guarda (o borra) la fila de producción de un producto. La llaman el alta y la
 * edición del producto cuando la ficha manda `_produccion`.
 */
export async function guardarProduccion(turso, companyId, productId, valor) {
    const id = Number(productId);
    if (!Number.isInteger(id) || id <= 0) return { success: false, error: 'Falta el producto' };
    if (!(await productoDeLaEmpresa(turso, companyId, id))) return { success: false, error: 'Producto no encontrado' };

    const limpio = limpiarProduccion(valor, id);
    if (!limpio) {
        await turso.execute({
            sql: 'DELETE FROM product_production WHERE product_id = ? AND company_id = ?',
            args: [id, companyId],
        });
        return { success: true, produccion: null };
    }

    // Un insumo de otra empresa no entra en la receta, aunque alguien mande su id.
    if (limpio.recipe?.items.length) {
        const validos = await idsDeLaEmpresa(turso, companyId, limpio.recipe.items.map((i) => i.product_id));
        limpio.recipe.items = limpio.recipe.items.filter((i) => validos.has(i.product_id));
    }

    const ahora = new Date().toISOString();
    await turso.execute({
        sql: `INSERT INTO product_production (product_id, company_id, is_input, input_content, input_unit, input_waste, recipe, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(product_id) DO UPDATE SET
                is_input = excluded.is_input, input_content = excluded.input_content,
                input_unit = excluded.input_unit, input_waste = excluded.input_waste,
                recipe = excluded.recipe, updated_at = excluded.updated_at
              WHERE product_production.company_id = excluded.company_id`,
        args: [id, companyId, limpio.is_input, limpio.input_content, limpio.input_unit, limpio.input_waste,
            limpio.recipe ? JSON.stringify(limpio.recipe) : null, ahora],
    });
    return { success: true, produccion: { product_id: id, ...limpio, is_input: limpio.is_input === 1, updated_at: ahora } };
}

/**
 * Para el alta y la edición del producto: si la receta no se pudo guardar, el
 * producto igual quedó guardado, así que no se devuelve un error que invite a
 * guardarlo de nuevo. Se devuelve un aviso para mostrar.
 */
export async function guardarProduccionConAviso(turso, companyId, productId, valor) {
    try {
        const r = await guardarProduccion(turso, companyId, productId, valor);
        return r.success ? null : `El producto se guardó, pero la receta no: ${r.error}`;
    } catch (e) {
        console.error('[produccion] no se pudo guardar', e);
        return 'El producto se guardó, pero la receta no. Probá de nuevo en un rato.';
    }
}

// Lo que el navegador necesita de un insumo para calcular su costo.
const COLS_INSUMO = 'p.id, p.name, p.sku, p.unit, p.cost, p.price, p.tax_rate, p.extra_taxes, p.sale_mode, p.stock';
const COLS_PRODUCCION = 'pp.is_input AS pp_is_input, pp.input_content AS pp_input_content, pp.input_unit AS pp_input_unit, pp.input_waste AS pp_input_waste, pp.recipe AS pp_recipe, pp.product_id AS pp_product_id, pp.updated_at AS pp_updated_at';

function separar(fila) {
    const producto = {};
    const pp = {};
    for (const [k, v] of Object.entries(fila)) {
        if (k.startsWith('pp_')) pp[k.slice(3)] = v;
        else producto[k] = v;
    }
    return { producto, produccion: pp.product_id == null ? null : filaPublica(pp) };
}

async function insumosPorId(turso, companyId, ids) {
    const unicos = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    const salida = [];
    for (let i = 0; i < unicos.length; i += 400) {
        const lote = unicos.slice(i, i + 400);
        const r = await turso.execute({
            sql: `SELECT ${COLS_INSUMO}, ${COLS_PRODUCCION}
                  FROM products p LEFT JOIN product_production pp ON pp.product_id = p.id AND pp.company_id = p.company_id
                  WHERE p.company_id = ? AND p.id IN (${lote.map(() => '?').join(',')})`,
            args: [companyId, ...lote],
        });
        salida.push(...r.rows.map(separar));
    }
    return salida;
}

export const productionActions = {
    /** Lo de un producto, para su ficha: su fila y los insumos de su receta. */
    async get(turso, companyId, _session, { productId }) {
        const id = Number(productId);
        if (!Number.isInteger(id) || id <= 0) return { success: false, error: 'Falta el producto' };
        const r = await turso.execute({
            sql: 'SELECT * FROM product_production WHERE product_id = ? AND company_id = ?',
            args: [id, companyId],
        });
        const produccion = filaPublica(r.rows[0]);
        const ids = produccion?.recipe?.items?.map((i) => i.product_id) || [];
        const insumos = ids.length ? await insumosPorId(turso, companyId, ids) : [];
        return { success: true, produccion, insumos };
    },

    /** El buscador de insumos de la receta. */
    async search(turso, companyId, _session, { term, excludeId }) {
        const f = filtroBusquedaProducto(term, ['p.name', 'p.sku']);
        if (!f) return { success: true, insumos: [] };
        const excluir = Number(excludeId) || 0;
        const r = await turso.execute({
            sql: `SELECT ${COLS_INSUMO}, ${COLS_PRODUCCION}
                  FROM products p LEFT JOIN product_production pp ON pp.product_id = p.id AND pp.company_id = p.company_id
                  WHERE p.company_id = ? AND p.id <> ? AND ${f.sql}
                  ORDER BY pp.is_input DESC, p.name COLLATE NOCASE
                  LIMIT 12`,
            args: [companyId, excluir, ...f.args],
        });
        return { success: true, insumos: r.rows.map(separar) };
    },

    /**
     * Todo lo de Producción, para su pestaña: cada fila de producción y los
     * productos que aparecen (los fabricados enteros, para poder abrir su ficha;
     * los insumos con lo justo para calcular).
     */
    async overview(turso, companyId) {
        const r = await turso.execute({
            sql: 'SELECT * FROM product_production WHERE company_id = ?',
            args: [companyId],
        });
        const producciones = r.rows.map(filaPublica);
        const fabricados = producciones.filter((p) => p.recipe).map((p) => p.product_id);
        const otros = new Set();
        for (const p of producciones) {
            if (!p.recipe) otros.add(p.product_id);
            for (const i of p.recipe?.items || []) otros.add(i.product_id);
        }
        for (const id of fabricados) otros.delete(id);

        const completos = [];
        for (let i = 0; i < fabricados.length; i += 400) {
            const lote = fabricados.slice(i, i + 400);
            const q = await turso.execute({
                // Las columnas de la lista del inventario: con esto se abre la ficha.
                sql: `SELECT ${PRODUCT_COLS_SIN_IMAGEN}, extra_taxes,
                        CASE WHEN image IS NOT NULL AND image != '' THEN 1 ELSE 0 END AS has_image
                      FROM products WHERE company_id = ? AND id IN (${lote.map(() => '?').join(',')})`,
                args: [companyId, ...lote],
            });
            completos.push(...q.rows);
        }
        const insumos = otros.size ? (await insumosPorId(turso, companyId, [...otros])).map((x) => x.producto) : [];
        return { success: true, producciones, productos: [...completos, ...insumos] };
    },

    /**
     * Marca otro producto como insumo y guarda cuánto trae, al instante. Se usa
     * desde la receta de un producto cuando uno de sus insumos no tiene
     * contenido: así no hay que salir de la ficha. No toca la receta de ese otro
     * producto, si tuviera.
     */
    async saveInput(turso, companyId, _session, { productId, content, unit, waste }) {
        const id = Number(productId);
        if (!Number.isInteger(id) || id <= 0) return { success: false, error: 'Falta el producto' };
        if (!(await productoDeLaEmpresa(turso, companyId, id))) return { success: false, error: 'Producto no encontrado' };
        const limpio = limpiarProduccion({ is_input: true, input_content: content, input_unit: unit, input_waste: waste }, id);
        if (!limpio?.input_content) return { success: false, error: 'Indicá cuánto trae (por ejemplo 25 kg)' };
        const ahora = new Date().toISOString();
        await turso.execute({
            sql: `INSERT INTO product_production (product_id, company_id, is_input, input_content, input_unit, input_waste, recipe, updated_at)
                  VALUES (?, ?, 1, ?, ?, ?, NULL, ?)
                  ON CONFLICT(product_id) DO UPDATE SET
                    is_input = 1, input_content = excluded.input_content, input_unit = excluded.input_unit,
                    input_waste = excluded.input_waste, updated_at = excluded.updated_at
                  WHERE product_production.company_id = excluded.company_id`,
            args: [id, companyId, limpio.input_content, limpio.input_unit, limpio.input_waste, ahora],
        });
        const r = await turso.execute({
            sql: 'SELECT * FROM product_production WHERE product_id = ? AND company_id = ?',
            args: [id, companyId],
        });
        return { success: true, produccion: filaPublica(r.rows[0]) };
    },
};
