// Unidades de medida de un producto (Caja, Display, Pack…). Ver migración 0030.
//
// El stock vive SIEMPRE en unidades: una presentación solo dice cuántas unidades
// trae y a cuánto se vende entera. Por eso acá no se toca stock ni ventas — eso
// lo resuelve el carrito, que manda la caja como unidades.

const limpio = (v) => (v === undefined || v === null ? '' : String(v).trim());

/**
 * Crea o actualiza una presentación.
 *
 * El código de barras no puede chocar con nada que la pistola ya reconozca: ni
 * con el SKU de un producto, ni con otra presentación. Si chocara, escanear daría
 * una cosa u otra según quién responda primero.
 */
async function presentationSave(turso, companyId, session, { presentation = {} }) {
    const productId = Number(presentation.product_id ?? presentation.productId);
    const nombre = limpio(presentation.name);
    const codigo = limpio(presentation.barcode);
    const unidades = Number(presentation.units);
    const precio = Number(presentation.price);
    const id = presentation.id ? Number(presentation.id) : null;

    if (!productId) return { success: false, error: 'Falta el producto' };
    if (!nombre) return { success: false, error: 'Poné un nombre: Caja, Display, Pack…' };
    if (!(unidades >= 2)) return { success: false, error: 'Una presentación trae al menos 2 unidades' };
    if (!Number.isInteger(unidades)) return { success: false, error: 'Las unidades van enteras: es un producto por unidad' };
    if (!(precio > 0)) return { success: false, error: 'Falta el precio de venta' };

    // El precio tiene que dividirse exacto por las unidades.
    //
    // La caja viaja a la venta como unidades —30 × (7.600 ÷ 30)— y la boleta
    // electrónica redondea el precio unitario ANTES de multiplicar
    // (api/sii/_sii.js): 253,33 → 253 → 253 × 30 = $7.590. El cliente pagaría
    // $7.600 y la boleta diría $7.590. Kevin eligió (2-oct-2026) no tocar el SII
    // y exigir un precio que divida exacto: se ofrecen los dos más cercanos.
    if (!Number.isInteger(precio / unidades)) {
        const abajo = Math.floor(precio / unidades) * unidades;
        const arriba = Math.ceil(precio / unidades) * unidades;
        return {
            success: false,
            error: `El precio tiene que dividirse exacto por las ${unidades} unidades, para que la boleta cuadre. Probá con $${abajo.toLocaleString('es-CL')} o $${arriba.toLocaleString('es-CL')}.`,
            sugerencias: [abajo, arriba].filter(n => n > 0),
        };
    }

    const prod = await turso.execute({
        sql: 'SELECT id, sku, units_per_box FROM products WHERE id = ? AND company_id = ?',
        args: [productId, companyId],
    });
    if (!prod.rows[0]) return { success: false, error: 'Producto no encontrado' };

    if (codigo) {
        const choqueProducto = await turso.execute({
            sql: 'SELECT id, name FROM products WHERE company_id = ? AND UPPER(TRIM(sku)) = UPPER(?) LIMIT 1',
            args: [companyId, codigo],
        });
        if (choqueProducto.rows[0]) {
            return {
                success: false,
                error: `Ese código ya es el de un producto: "${choqueProducto.rows[0].name}". La caja necesita su propio código.`,
            };
        }
        const choquePresentacion = await turso.execute({
            sql: `SELECT pp.id, pp.name, p.name AS producto FROM product_presentations pp
                  JOIN products p ON p.id = pp.product_id AND p.company_id = pp.company_id
                  WHERE pp.company_id = ? AND UPPER(TRIM(pp.barcode)) = UPPER(?) AND pp.id IS NOT ? LIMIT 1`,
            args: [companyId, codigo, id],
        });
        if (choquePresentacion.rows[0]) {
            const c = choquePresentacion.rows[0];
            return { success: false, error: `Ese código ya es de "${c.name}" de ${c.producto}.` };
        }
    }

    let fila;
    if (id) {
        const r = await turso.execute({
            sql: `UPDATE product_presentations
                     SET name = ?, barcode = ?, units = ?, price = ?, updated_at = datetime('now')
                   WHERE id = ? AND company_id = ? AND product_id = ?
                   RETURNING *`,
            args: [nombre, codigo || null, unidades, precio, id, companyId, productId],
        });
        fila = r.rows[0];
        if (!fila) return { success: false, error: 'Esa unidad de medida no existe' };
    } else {
        const r = await turso.execute({
            sql: `INSERT INTO product_presentations (company_id, product_id, name, barcode, units, price)
                  VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
            args: [companyId, productId, nombre, codigo || null, unidades, precio],
        });
        fila = r.rows[0];
    }

    // La carga de facturas con IA usa `units_per_box` para darse cuenta de que un
    // renglón vino por caja. Si el producto todavía no lo tiene, la primera
    // presentación se lo da.
    if (!(Number(prod.rows[0].units_per_box) >= 2)) {
        try {
            await turso.execute({
                sql: 'UPDATE products SET units_per_box = ? WHERE id = ? AND company_id = ?',
                args: [Math.round(unidades), productId, companyId],
            });
        } catch { /* no es lo importante de esta operación */ }
    }

    await turso.execute({
        sql: 'INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        args: [companyId, session?.uid ?? null, id ? 'UPDATE' : 'CREATE', 'PRODUCT_PRESENTATION',
            JSON.stringify({ productId, nombre, unidades, precio, codigo: codigo || null }), new Date().toISOString()],
    });

    return { success: true, presentation: fila };
}

async function presentationDelete(turso, companyId, session, { id }) {
    if (!id) return { success: false, error: 'Falta id' };
    const r = await turso.execute({
        sql: 'DELETE FROM product_presentations WHERE id = ? AND company_id = ? RETURNING product_id, name',
        args: [id, companyId],
    });
    if (!r.rows[0]) return { success: false, error: 'Esa unidad de medida no existe' };
    await turso.execute({
        sql: 'INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        args: [companyId, session?.uid ?? null, 'DELETE', 'PRODUCT_PRESENTATION',
            JSON.stringify({ id, productId: r.rows[0].product_id, nombre: r.rows[0].name }), new Date().toISOString()],
    });
    return { success: true };
}

export const presentationActions = { presentationSave, presentationDelete };
