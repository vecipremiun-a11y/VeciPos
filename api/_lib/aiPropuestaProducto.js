// Propuesta de cambios sobre UN producto, con el "después" completo.
//
// El requisito que le da forma a todo este archivo: cuando se cambia una cosa,
// otras se mueven solas. Subir el costo cambia el margen; cambiar el IVA cambia
// el precio final; poner una oferta tacha el precio normal. Si la persona
// confirma viendo solo lo que pidió, termina aprobando cambios que no vio.
//
// Por eso acá no se calcula "lo que pediste" sino el ESTADO FINAL del producto,
// campo por campo, marcando cuáles cambian porque los pediste y cuáles cambian
// como consecuencia.
//
// Nada de esto escribe. Devuelve la propuesta para que la confirme una persona.

// La misma fórmula que usa la pantalla de Compras (Purchases.jsx:203), para que
// el asistente y el sistema no calculen precios distintos.
const precioDesdeCosto = (costo, margen, iva) =>
    Math.round(costo * (1 + margen / 100) * (1 + iva / 100));

const margenDesdePrecio = (precio, costo, iva) => {
    if (!(costo > 0)) return null;
    const neto = precio / (1 + iva / 100);
    return Math.round(((neto - costo) / costo) * 1000) / 10;
};

const num = (v) => (v == null || v === '' ? null : Number(v));

// Segunda barrera contra un cero mal puesto.
//
// Pidiendo "pone el precio del zapallo en 1300", el modelo mandó ademas costo 0
// y margen 0 —porque el esquema exigia todos los campos y yo habia escrito
// "manda 0 para no tocar"—. El producto quedaba con costo cero y el precio
// calculado sobre esa base.
//
// El esquema ya acepta null, que es lo correcto. Esto queda igual: para costo,
// precio y margen, un cero NUNCA es un cambio que alguien quiera de verdad, asi
// que se trata como "no lo toques". El IVA no entra acá: 0% es Exento, un valor
// legitimo.
const numSinCero = (v) => {
    const n = num(v);
    return n === 0 ? null : n;
};

export async function proponerCambiosProducto(turso, companyId, cambios = {}) {
    const { productoId } = cambios;
    if (!productoId) return { error: 'Falta el producto. Buscalo con productoBuscar y usá su id.' };

    const r = await turso.execute({
        sql: `SELECT id, name, category, cost, price, tax_rate, is_offer, offer_price,
                     price_ranges, unit, supplier
              FROM products WHERE id = ? AND company_id = ?`,
        args: [productoId, companyId],
    });
    const p = r.rows[0];
    if (!p) return { error: 'No encontré ese producto.' };

    // ── Lo que NO se puede inventar ──────────────────────────────────────
    //
    // El IVA y la categoría se eligen entre los que ya existen. Crear uno nuevo
    // desde una conversación sería demasiado fácil: basta un nombre mal
    // entendido para llenar el sistema de categorías fantasma o de un IVA que
    // no corresponde a ninguna norma.
    const [ivasRes, catsRes] = await Promise.all([
        turso.execute({ sql: 'SELECT name, rate FROM tax_rates WHERE company_id = ? ORDER BY rate', args: [companyId] }),
        turso.execute({ sql: 'SELECT name FROM categories WHERE company_id = ? ORDER BY name', args: [companyId] }),
    ]);
    const ivas = ivasRes.rows.map(x => ({ nombre: x.name, tasa: Number(x.rate) }));
    const categorias = catsRes.rows.map(x => x.name);

    const avisos = [];

    // ── IVA ──
    let ivaFinal = Number(p.tax_rate) || 0;
    if (cambios.iva != null && cambios.iva !== '') {
        const pedido = Number(cambios.iva);
        const existe = ivas.find(x => x.tasa === pedido);
        if (!existe) {
            return {
                error: `El IVA de ${pedido}% no está creado en el sistema. Los disponibles son: ` +
                       ivas.map(x => `${x.nombre} (${x.tasa}%)`).join(', ') +
                       '. Elegí uno de esos — no puedo crear tasas nuevas.',
            };
        }
        ivaFinal = pedido;
    }

    // ── Categoría ──
    let categoriaFinal = p.category;
    if (cambios.categoria) {
        const buscado = String(cambios.categoria).trim().toLowerCase();
        const existe = categorias.find(c => c.toLowerCase() === buscado)
                    || categorias.find(c => c.toLowerCase().includes(buscado));
        if (!existe) {
            return {
                error: `La categoría "${cambios.categoria}" no existe. Las creadas son: ` +
                       categorias.join(', ') + '. Elegí una de esas — no puedo crear categorías nuevas.',
            };
        }
        categoriaFinal = existe;
    }

    // ── Costo, margen y precio ───────────────────────────────────────────
    //
    // Tres valores atados entre sí: fijados dos, el tercero sale solo. Se
    // respeta lo que la persona dijo y se recalcula lo que no dijo, dejando
    // constancia de que se movió sin que lo pidiera.
    const costoAntes = Number(p.cost) || 0;
    const precioAntes = Number(p.price) || 0;
    const ivaAntes = Number(p.tax_rate) || 0;
    const margenAntes = margenDesdePrecio(precioAntes, costoAntes, ivaAntes);

    const costoFinal = numSinCero(cambios.costo) ?? costoAntes;
    let precioFinal = numSinCero(cambios.precio) ?? precioAntes;
    const margenPedido = numSinCero(cambios.margen);

    // Se miran los valores YA filtrados de ceros, no los crudos: con `cambios.costo
    // != null` un 0 mal puesto entraba igual a la rama de recálculo y movía el
    // precio sin que nadie hubiera pedido tocar el costo.
    const pidioPrecio = numSinCero(cambios.precio) != null;
    const pidioCosto = numSinCero(cambios.costo) != null;

    if (margenPedido != null) {
        precioFinal = precioDesdeCosto(costoFinal, margenPedido, ivaFinal);
        if (!pidioPrecio) avisos.push('El precio se recalculó a partir del margen que pediste.');
    } else if (!pidioPrecio && (pidioCosto || ivaFinal !== ivaAntes)) {
        // Cambió el costo o el IVA y no dijeron qué hacer con el precio. Se
        // mantiene el margen que el producto ya tenía: es lo que un comerciante
        // espera al reponer más caro.
        if (margenAntes != null) {
            precioFinal = precioDesdeCosto(costoFinal, margenAntes, ivaFinal);
            avisos.push(`El precio se recalculó para mantener el margen de ${margenAntes}%. Si querías dejar el precio quieto, decilo.`);
        }
    }
    const margenFinal = margenDesdePrecio(precioFinal, costoFinal, ivaFinal);

    // ── Oferta ───────────────────────────────────────────────────────────
    //
    // El precio normal NO se toca: queda como referencia y es el que se muestra
    // tachado. La oferta vive en su propio campo.
    let enOferta = Number(p.is_offer) === 1;
    let precioOferta = Number(p.offer_price) || 0;
    if (cambios.oferta != null) {
        enOferta = Boolean(cambios.oferta);
        if (enOferta) {
            const nuevo = numSinCero(cambios.precioOferta);
            if (!nuevo || nuevo <= 0) {
                return { error: 'Para poner el producto en oferta necesito el precio de oferta. ¿A cuánto lo dejamos?' };
            }
            if (nuevo >= precioFinal) {
                return { error: `El precio de oferta (${nuevo}) tiene que ser MENOR que el precio normal (${precioFinal}). ¿Cuál va?` };
            }
            precioOferta = nuevo;
            avisos.push(`El precio normal de ${precioFinal} se mantiene y se va a mostrar tachado.`);
        } else {
            precioOferta = 0;
            avisos.push('Se saca de oferta: vuelve a venderse al precio normal.');
        }
    } else if (numSinCero(cambios.precioOferta)) {
        enOferta = true;
        precioOferta = numSinCero(cambios.precioOferta);
        avisos.push(`El precio normal de ${precioFinal} se mantiene y se va a mostrar tachado.`);
    }

    // ── Escala por cantidad ──────────────────────────────────────────────
    //
    // Cada tramo guarda su propio margen, asi que si cambia el costo los precios
    // de la escala quedan desactualizados. Se recalculan con el margen de cada
    // tramo, y se avisa: es el caso mas facil de pasar por alto.
    let escala = [];
    try { escala = JSON.parse(p.price_ranges || '[]') || []; } catch { escala = []; }
    let escalaFinal = escala;
    if (escala.length && costoFinal !== costoAntes) {
        escalaFinal = escala.map(t => ({
            ...t,
            price: String(precioDesdeCosto(costoFinal, Number(t.margin) || 0, ivaFinal)),
        }));
        avisos.push(`La escala por cantidad tiene ${escala.length} tramos: sus precios se recalculan con el costo nuevo, manteniendo el margen de cada uno.`);
    }

    // ── El estado final, campo por campo ─────────────────────────────────
    const pedido = new Set(Object.keys(cambios).filter(k =>
        k !== 'productoId' && cambios[k] != null && cambios[k] !== '' &&
        !(cambios[k] === 0 && k !== 'iva')));
    const fila = (campo, antes, ahora, loPidio) => ({
        campo, antes, ahora,
        cambia: String(antes) !== String(ahora),
        motivo: !loPidio && String(antes) !== String(ahora) ? 'consecuencia' : 'pedido',
    });

    const campos = [
        fila('Categoría', p.category, categoriaFinal, pedido.has('categoria')),
        fila('Costo', costoAntes, costoFinal, pedido.has('costo')),
        fila('Precio', precioAntes, precioFinal, pedido.has('precio') || pedido.has('margen')),
        fila('Margen %', margenAntes, margenFinal, pedido.has('margen')),
        fila('IVA %', ivaAntes, ivaFinal, pedido.has('iva')),
        fila('En oferta', Number(p.is_offer) === 1 ? 'Sí' : 'No', enOferta ? 'Sí' : 'No', pedido.has('oferta')),
        fila('Precio oferta', Number(p.offer_price) || 0, precioOferta, pedido.has('precioOferta')),
    ];
    if (escala.length) {
        escala.forEach((t, i) => campos.push(
            fila(`Escala ${t.min}${t.max ? '-' + t.max : '+'} und`, t.price, escalaFinal[i]?.price, false)
        ));
    }

    const cambian = campos.filter(c => c.cambia);
    if (!cambian.length) return { error: 'Con esos valores el producto queda igual que ahora. ¿Qué querés cambiar?' };

    return {
        propuesta: {
            tipo: 'cambio_producto',
            productoId: Number(p.id),
            producto: p.name,
            campos: cambian,
            // Lo que va a la escritura, ya resuelto.
            valores: {
                category: categoriaFinal,
                cost: costoFinal,
                price: precioFinal,
                tax_rate: ivaFinal,
                is_offer: enOferta ? 1 : 0,
                offer_price: precioOferta,
                price_ranges: escalaFinal,
            },
            avisos,
        },
        aviso: 'Propuesta lista. Todavía NO se aplicó: la confirma la persona desde la pantalla.',
    };
}
