// Cruce de un abono importado del banco (XLSX) contra las ventas con tarjeta
// del datáfono en POSVECI. Estrategia:
//
//   1) Para cada transacción del banco, busca una venta POSVECI con MISMO
//      monto y MISMO día.
//   2) Si hay varias candidatas (mismo monto, mismo día), elige la más
//      cercana en hora (ventana ±toleranceMinutes minutos).
//   3) Cada venta solo puede matchear UNA transacción del banco.
//
// Devuelve:
//   - matches: parejas { bankTx, sale, deltaMinutes }
//   - bankOnly: transacciones del banco sin venta en POSVECI (¡plata cobrada
//     pero venta no registrada!)
//   - posOnly: ventas POSVECI sin transacción del banco (registradas pero
//     no en este abono — posible cancelación o venta pendiente)

const round = Math.round;

const sameDay = (a, b) => a && b && a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

const deltaMin = (a, b) => Math.abs((a - b) / 60000);

export function crossMatch(bankTransactions, posSales, { toleranceMinutes = 60 } = {}) {
    const matches = [];
    const usedSaleIds = new Set();
    const bankOnly = [];

    // Index ventas POSVECI por monto entero para búsqueda O(1).
    const salesByAmount = new Map();
    for (const s of posSales) {
        const amt = round(Number(s.total) || 0);
        if (!salesByAmount.has(amt)) salesByAmount.set(amt, []);
        salesByAmount.get(amt).push(s);
    }

    // Ordenamos las transacciones por hora para que el matcher sea estable
    // (la primera del día consume la venta más temprana de su monto).
    const sortedBank = [...bankTransactions].sort((a, b) => {
        if (!a.datetime || !b.datetime) return 0;
        return a.datetime - b.datetime;
    });

    for (const tx of sortedBank) {
        const amt = round(Number(tx.saleAmount) || 0);
        const txDate = tx.datetime;
        const candidates = (salesByAmount.get(amt) || []).filter(s => !usedSaleIds.has(s.id));

        // Filtra candidatas del mismo día
        const sameDayCandidates = candidates.filter(s => {
            const sd = new Date(s.date);
            return sameDay(sd, txDate);
        });

        if (sameDayCandidates.length === 0) {
            bankOnly.push(tx);
            continue;
        }

        // Elige la más cercana en hora
        let best = null;
        for (const s of sameDayCandidates) {
            const sd = new Date(s.date);
            const d = txDate ? deltaMin(sd, txDate) : 0;
            if (!best || d < best.delta) best = { sale: s, delta: d };
        }

        if (best) {
            usedSaleIds.add(best.sale.id);
            matches.push({ bankTx: tx, sale: best.sale, deltaMinutes: round(best.delta) });
            const _confidence = best.delta <= toleranceMinutes ? 'high' : 'medium';
            matches[matches.length - 1].confidence = _confidence;
        } else {
            bankOnly.push(tx);
        }
    }

    const posOnly = posSales.filter(s => !usedSaleIds.has(s.id));

    return {
        matches,
        bankOnly,
        posOnly,
        summary: {
            totalBankCount: bankTransactions.length,
            totalBankAmount: bankTransactions.reduce((a, t) => a + (Number(t.saleAmount) || 0), 0),
            totalBankDeposit: bankTransactions.reduce((a, t) => a + (Number(t.totalAbono) || 0), 0),
            matchedCount: matches.length,
            matchedAmount: matches.reduce((a, m) => a + (Number(m.bankTx.saleAmount) || 0), 0),
            matchedDeposit: matches.reduce((a, m) => a + (Number(m.bankTx.totalAbono) || 0), 0),
            bankOnlyCount: bankOnly.length,
            bankOnlyAmount: bankOnly.reduce((a, t) => a + (Number(t.saleAmount) || 0), 0),
            posOnlyCount: posOnly.length,
            posOnlyAmount: posOnly.reduce((a, s) => a + (Number(s.total) || 0), 0),
        },
    };
}
