// Stock separado: lo que un pedido aparta de products.stock antes de venderse.
//
// Lo usan el pedido a domicilio del POS (deliveries, migración 0032) y el pedido
// de la tienda web (preorders, migración 0034). En los dos casos la venta nace
// después, al cobrar: primero se devuelve lo separado y recién ahí la venta
// descuenta stock y lotes por el camino de siempre. Así el stock nunca se cuenta
// dos veces.

const nowIso = () => new Date().toISOString();

/**
 * Separa (signo -1) o devuelve (signo +1) stock. `reservas` = [{ productId, qty }].
 *
 * Al separar respeta la misma regla que la venta: sin el modo "ajuste de
 * inventario" no deja el stock en negativo, y si un producto no alcanza deshace
 * lo que ya había separado. `permitirNegativo` salta esa regla: es para lo que
 * ya se vendió en otro lado (un pedido pagado en la web) y no se puede rechazar.
 */
export async function moverStock(turso, companyId, reservas, signo, { permitirNegativo: forzar = false } = {}) {
    if (!reservas.length) return { ok: true };
    const iso = nowIso();
    let permitirNegativo = signo > 0 || forzar;
    if (signo < 0 && !permitirNegativo) {
        try {
            const co = await turso.execute({ sql: 'SELECT inventory_adjustment_mode FROM companies WHERE id = ?', args: [companyId] });
            permitirNegativo = Number(co.rows[0]?.inventory_adjustment_mode) === 1;
        } catch { /* sin la columna: se respeta el stock */ }
    }
    const res = await turso.batch(reservas.map(r => (signo < 0 && !permitirNegativo
        ? {
            sql: 'UPDATE products SET stock = ROUND(stock - ?, 3), updated_at = ? WHERE id = ? AND company_id = ? AND stock >= ?',
            args: [r.qty, iso, r.productId, companyId, r.qty],
        }
        : {
            sql: 'UPDATE products SET stock = ROUND(stock + ?, 3), updated_at = ? WHERE id = ? AND company_id = ?',
            args: [signo * r.qty, iso, r.productId, companyId],
        })));
    const fallidos = reservas.filter((_, i) => Number(res[i]?.rowsAffected) !== 1);
    if (!fallidos.length || signo > 0 || forzar) return { ok: true };

    const hechos = reservas.filter((_, i) => Number(res[i]?.rowsAffected) === 1);
    if (hechos.length) {
        await turso.batch(hechos.map(h => ({
            sql: 'UPDATE products SET stock = ROUND(stock + ?, 3), updated_at = ? WHERE id = ? AND company_id = ?',
            args: [h.qty, iso, h.productId, companyId],
        })));
    }
    const p = await turso.execute({
        sql: 'SELECT name, stock FROM products WHERE id = ? AND company_id = ?',
        args: [fallidos[0].productId, companyId],
    });
    const f = p.rows[0];
    return {
        ok: false,
        error: f
            ? `Stock insuficiente para "${f.name}": quedan ${Number(f.stock)} y el pedido lleva ${fallidos[0].qty}.`
            : 'Un producto del pedido ya no existe en el inventario.',
    };
}
