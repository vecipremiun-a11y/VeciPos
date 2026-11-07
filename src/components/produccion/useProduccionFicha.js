// La parte de Producción de la ficha del producto: si es insumo, cuánto trae, y
// su receta si se fabrica. Se carga aparte (tabla product_production, migración
// 0038) y se guarda junto con el producto, con el botón Guardar de siempre.
import { useCallback, useEffect, useRef, useState } from 'react';
import { dataApiCall } from '../../lib/dataApi';
import { normalizarProduccion } from '../../lib/produccion';

export const PRODUCCION_VACIA = { is_input: false, input_content: '', input_unit: '', input_waste: '', recipe: null };

/** La fila del servidor, como la edita el formulario (campos vacíos = ''). */
export function produccionDesdeFila(fila) {
    if (!fila) return { ...PRODUCCION_VACIA };
    return {
        is_input: !!fila.is_input,
        input_content: fila.input_content ?? '',
        input_unit: fila.input_unit || '',
        input_waste: Number(fila.input_waste) > 0 ? fila.input_waste : '',
        recipe: fila.recipe
            ? {
                yield: fila.recipe.yield ?? '',
                items: (fila.recipe.items || []).map((i) => ({ product_id: Number(i.product_id), qty: i.qty, unit: i.unit })),
                others: (fila.recipe.others || []).map((o) => ({ name: o.name || '', amount: o.amount || '' })),
            }
            : null,
    };
}

/** { id: { producto, produccion } } a partir de lo que devuelve el servidor. */
export function mapaInsumos(lista) {
    const mapa = {};
    for (const x of lista || []) {
        if (x?.producto?.id != null) mapa[Number(x.producto.id)] = { producto: x.producto, produccion: x.produccion || null };
    }
    return mapa;
}

export function useProduccionFicha(productId, abierta, companyId) {
    const [valor, setValor] = useState(PRODUCCION_VACIA);
    const [insumos, setInsumos] = useState({});
    // 'listo' | 'cargando' | 'error'. Con 'error' no se guarda nada: no se puede
    // pisar una receta que no se llegó a ver.
    const [estado, setEstado] = useState('listo');
    const [error, setError] = useState('');
    const inicialRef = useRef(JSON.stringify(null));
    const turnoRef = useRef(0);

    const cargar = useCallback(async () => {
        const turno = ++turnoRef.current;
        if (!productId) {
            setValor({ ...PRODUCCION_VACIA });
            setInsumos({});
            inicialRef.current = JSON.stringify(null);
            setEstado('listo');
            setError('');
            return;
        }
        setEstado('cargando');
        setError('');
        const r = await dataApiCall('production.get', { companyId, productId });
        if (turno !== turnoRef.current) return; // se abrió otro producto mientras tanto
        if (!r?.success) {
            setEstado('error');
            setError(r?.error || 'No se pudo cargar');
            return;
        }
        const v = produccionDesdeFila(r.produccion);
        setValor(v);
        setInsumos(mapaInsumos(r.insumos));
        inicialRef.current = JSON.stringify(normalizarProduccion(v));
        setEstado('listo');
    }, [productId, companyId]);

    useEffect(() => {
        if (!abierta) return;
        cargar();
    }, [abierta, cargar]);

    /**
     * Lo que va en `_produccion` al guardar: undefined si no cambió nada (o si no
     * se pudo cargar), null si ya no es insumo ni tiene receta.
     */
    const paraGuardar = useCallback(() => {
        if (estado !== 'listo') return undefined;
        const n = normalizarProduccion(valor);
        return JSON.stringify(n) === inicialRef.current ? undefined : n;
    }, [estado, valor]);

    return { valor, setValor, insumos, setInsumos, estado, error, recargar: cargar, paraGuardar };
}
