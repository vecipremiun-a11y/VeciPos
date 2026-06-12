// Cruce de un abono importado del banco (XLSX) contra las ventas con tarjeta
// del datáfono en POSVECI. Estrategia (en orden de prioridad):
//
//   1) MATCH POR CÓDIGO DE AUTORIZACIÓN: la llave única que emite el banco
//      y queda impresa en el recibo. Si la cajera lo ingresó al cobrar,
//      esto da match 100% exacto sin depender de monto ni hora. Es la
//      manera profesional de cruzar.
//   2) MATCH POR MONTO + DÍA + HORA: si no hay authCode, comparar por monto
//      exacto en el mismo día. Si hay varias candidatas, elegir la más
//      cercana en hora (±toleranceMinutes).
//   3) Cada venta solo puede matchear UNA transacción del banco.
//
// Devuelve:
//   - matches: parejas { bankTx, sale, deltaMinutes, matchedBy }
//       matchedBy = 'authCode' | 'amountTime'
//   - bankOnly: transacciones del banco sin venta en POSVECI (¡plata cobrada
//     pero venta no registrada!)
//   - posOnly: ventas POSVECI sin transacción del banco (registradas pero
//     no en este abono — posible cancelación o venta pendiente)

const round = Math.round;

const sameDay = (a, b) => a && b && a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

const deltaMin = (a, b) => Math.abs((a - b) / 60000);

// Normaliza un código de autorización para comparación robusta: quita ceros
// a la izquierda, espacios y caracteres no numéricos. "0054169" === "54169".
const normAuth = (v) => {
    if (!v) return '';
    return String(v).trim().replace(/[^0-9A-Z]/gi, '').replace(/^0+/, '').toUpperCase();
};

export function crossMatch(bankTransactions, posSales, { toleranceMinutes = 60 } = {}) {
    const matches = [];
    const usedSaleIds = new Set();
    const bankOnly = [];

    // Index por código de autorización (normalizado) → match exacto y barato.
    const salesByAuth = new Map();
    for (const s of posSales) {
        const a = normAuth(s.authCode);
        if (!a) continue;
        if (!salesByAuth.has(a)) salesByAuth.set(a, []);
        salesByAuth.get(a).push(s);
    }

    // Index por monto entero para el fallback.
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

    // ============================================================
    // PASADA 1: match por código de autorización (100% exacto)
    // ============================================================
    const remainingBank = [];
    for (const tx of sortedBank) {
        // El XLSX trae 'authCode' (código autorización) y 'operationNumber'.
        // Algunos bancos imprimen uno u otro en el recibo, así que comparamos
        // contra ambos por si la cajera tipeó cualquiera de los dos.
        const candidateAuths = [normAuth(tx.authCode), normAuth(tx.operationNumber)].filter(Boolean);
        let matched = false;
        for (const a of candidateAuths) {
            const candidates = (salesByAuth.get(a) || []).filter(s => !usedSaleIds.has(s.id));
            if (candidates.length > 0) {
                const sale = candidates[0];
                usedSaleIds.add(sale.id);
                const sd = new Date(sale.date);
                matches.push({
                    bankTx: tx,
                    sale,
                    deltaMinutes: tx.datetime ? round(deltaMin(sd, tx.datetime)) : 0,
                    matchedBy: 'authCode',
                    confidence: 'high',
                });
                matched = true;
                break;
            }
        }
        if (!matched) remainingBank.push(tx);
    }

    // ============================================================
    // PASADA 2: fallback por monto + mismo día + hora cercana
    // ============================================================
    for (const tx of remainingBank) {
        const amt = round(Number(tx.saleAmount) || 0);
        const txDate = tx.datetime;
        const candidates = (salesByAmount.get(amt) || []).filter(s => !usedSaleIds.has(s.id));

        const sameDayCandidates = candidates.filter(s => {
            const sd = new Date(s.date);
            return sameDay(sd, txDate);
        });

        if (sameDayCandidates.length === 0) {
            bankOnly.push(tx);
            continue;
        }

        let best = null;
        for (const s of sameDayCandidates) {
            const sd = new Date(s.date);
            const d = txDate ? deltaMin(sd, txDate) : 0;
            if (!best || d < best.delta) best = { sale: s, delta: d };
        }

        if (best) {
            usedSaleIds.add(best.sale.id);
            matches.push({
                bankTx: tx,
                sale: best.sale,
                deltaMinutes: round(best.delta),
                matchedBy: 'amountTime',
                confidence: best.delta <= toleranceMinutes ? 'high' : 'medium',
            });
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
