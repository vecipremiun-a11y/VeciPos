// Algoritmo de conciliación de abonos de datáfono.
//
// Problema: el datáfono te abona un monto (ej. $186.450). El sistema tiene
// muchas ventas con tarjeta de ese datáfono. ¿Qué subset de ventas suma a ese
// abono, considerando que el procesador retiene una comisión por venta?
//
// Para cada venta de monto `total`:
//   neto_esperado = total × (1 - commission_rate/100) - fixed_fee
//
// Buscamos un subset de ventas cuyo sum(neto_esperado) ≈ deposit_amount.
// La función calcula los netos de cada venta y delega al buscador.
//
// Estrategia:
//   1) Ventanas contiguas (rápido, refleja "datáfono deposita por hora" típico).
//      O(N²) — para 200 ventas son 40k operaciones, instantáneo.
//   2) Subset-sum por DP/bitset si la ventana contigua no encuentra (lento pero
//      necesario en casos donde el datáfono mezcla ventas no consecutivas).
//      Solo se activa para N ≤ 25 por costo (2^25 = 33M ops, ~300ms).
//
// Todos los montos se redondean a enteros (CLP no tiene decimales) para evitar
// errores de coma flotante en la búsqueda.

const round = (n) => Math.round(n);

// Calcula el neto que el procesador abona por una venta dada su comisión.
export function netExpected(sale, commissionRate, fixedFee) {
    const total = Number(sale.total) || 0;
    const cr = Number(commissionRate) || 0;
    const ff = Number(fixedFee) || 0;
    const net = total * (1 - cr / 100) - ff;
    return Math.max(0, net);
}

// Suma de netos para un set de ventas.
export function sumNet(sales, commissionRate, fixedFee) {
    return sales.reduce((acc, s) => acc + netExpected(s, commissionRate, fixedFee), 0);
}

// Match por ventanas contiguas. Las ventas DEBEN venir ordenadas por fecha asc.
// Devuelve la mejor ventana (sales array) cuyo suma de netos esté dentro de la
// tolerancia, o null si ninguna sirve.
export function findContiguousMatch(sales, depositAmount, { commissionRate = 0, fixedFee = 0, toleranceClp = 50 } = {}) {
    if (!sales.length) return null;
    const target = round(depositAmount);

    // Precalcular netos
    const nets = sales.map(s => round(netExpected(s, commissionRate, fixedFee)));

    // Prefix sums para sumas en O(1)
    const prefix = [0];
    for (let i = 0; i < nets.length; i++) prefix.push(prefix[i] + nets[i]);

    let best = null;
    for (let i = 0; i < sales.length; i++) {
        for (let j = i; j < sales.length; j++) {
            const sum = prefix[j + 1] - prefix[i];
            const diff = Math.abs(sum - target);
            if (diff <= toleranceClp) {
                if (!best || diff < best.diff) {
                    best = {
                        sales: sales.slice(i, j + 1),
                        sumNet: sum,
                        diff,
                        target,
                    };
                }
            }
        }
    }
    return best;
}

// Subset-sum exacto para casos donde las ventas que entraron al abono NO son
// contiguas (ej. abono retrasado que mezcla ventas de días distintos).
// Limit duro de N=25 para no explotar (2^25 ≈ 33M).
// Devuelve { sales, sumNet, diff } o null.
export function findSubsetSumMatch(sales, depositAmount, { commissionRate = 0, fixedFee = 0, toleranceClp = 50 } = {}) {
    if (!sales.length || sales.length > 25) return null;
    const target = round(depositAmount);
    const nets = sales.map(s => round(netExpected(s, commissionRate, fixedFee)));
    const n = sales.length;

    let best = null;
    const limit = 1 << n;
    for (let mask = 1; mask < limit; mask++) {
        let sum = 0;
        for (let i = 0; i < n; i++) {
            if (mask & (1 << i)) sum += nets[i];
        }
        const diff = Math.abs(sum - target);
        if (diff <= toleranceClp) {
            if (!best || diff < best.diff || (diff === best.diff && popCount(mask) < best.count)) {
                const subset = [];
                for (let i = 0; i < n; i++) if (mask & (1 << i)) subset.push(sales[i]);
                best = { sales: subset, sumNet: sum, diff, target, count: subset.length };
            }
        }
    }
    if (best) delete best.count;
    return best;
}

function popCount(x) {
    let count = 0;
    while (x) { count += x & 1; x >>>= 1; }
    return count;
}

// Buscador combinado: intenta ventanas contiguas primero (caso típico). Si no,
// hace subset-sum cuando es factible.
export function findBestMatch(sales, depositAmount, opts = {}) {
    const contig = findContiguousMatch(sales, depositAmount, opts);
    if (contig && contig.diff === 0) return { strategy: 'contiguous', ...contig };

    const sub = findSubsetSumMatch(sales, depositAmount, opts);
    if (sub && (!contig || sub.diff < contig.diff)) return { strategy: 'subset', ...sub };

    if (contig) return { strategy: 'contiguous', ...contig };
    return null;
}
