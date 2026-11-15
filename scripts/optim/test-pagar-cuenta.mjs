// Botón «Pagar» de Vencimientos y fondos (Kevin, 14-nov-2026).
//
// El acceso rápido para pagar una cuenta del local: solo se cambia el monto
// (el del recurrente es un estimado; el real llega con la boleta), el medio de
// pago, la fecha (hoy, o el día real si se anota después) y de qué fondo sale
// (caja chica, capital…). El vencimiento queda como estaba, y pagar antes o
// después no cambia a qué mes pertenece la cuenta. Los recurrentes sin pagar
// siguen en Vencimientos hasta 3 meses atrás.
//
// Se prueba contra bases locales con las migraciones (una sin la 0041, para
// el rato entre el push y migrate-all). No toca ninguna base real.
//
//   node scripts/optim/test-pagar-cuenta.mjs

import { createClient } from '@libsql/client';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { financeActions } from '../../api/_lib/financeActions.js';

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

const dir = mkdtempSync(join(tmpdir(), 'pagar-'));
const bases = [];
// 0000 es una foto del esquema: sentencia por sentencia, saltando lo que ya existe.
async function nuevaBase(nombre, hasta = 9999) {
    const base = createClient({ url: `file:${join(dir, nombre).split(String.fromCharCode(92)).join('/')}` });
    bases.push(base);
    for (const f of readdirSync('migrations').filter((x) => /^\d{4}_.*\.sql$/.test(x) && Number(x.slice(0, 4)) <= hasta).sort()) {
        const sql = readFileSync(join('migrations', f), 'utf8').replace(/--[^\n]*/g, '');
        for (const s of sql.split(/;\s*(?:\n|$)/).map((x) => x.trim()).filter(Boolean)) {
            try { await base.execute(s); } catch (e) {
                if (!/duplicate column|already exists/i.test(e.message)) throw e;
            }
        }
    }
    await base.execute("INSERT INTO companies (id, name) VALUES ('acme', 'Acme'), ('otra', 'Otra')");
    return base;
}
try {
    const db = await nuevaBase('t.db');
    const S = { uid: 1, username: 'kevin', role: 'super_admin' };
    const F = financeActions;
    const fila = async (sql, args = []) => (await db.execute({ sql, args })).rows[0];
    const mes = (m) => ({ startDate: `${m}-01`, endDate: `${m}-${new Date(Date.UTC(+m.slice(0, 4), +m.slice(5), 0)).getUTCDate()}` });

    // Luz: estimado $350.000, vence el 9.
    let r = await F.recurringSave(db, 'acme', S, { data: {
        description: 'Luz', supplier: 'CGE', amount: 350000, start_date: '2026-01-01', due_day: 9, payment_method: 'Debito',
    } });
    check('crea el recurrente', r.success, r.error);
    const luz = await fila("SELECT * FROM recurring_expenses WHERE description = 'Luz'");

    let b = await F.financeBootstrap(db, 'acme', S, mes('2026-11'));
    let ob = b.obligations.find((o) => o.kind === 'recurring' && String(o.templateId) === String(luz.id));
    check('noviembre: sale en Vencimientos con el estimado', ob?.amount === 350000 && ob?.dueDate === '2026-11-09', JSON.stringify(ob));
    check('el resumen usa el estimado mientras no se paga', Math.round(b.summary.recurringExpenses) === 350000, b.summary.recurringExpenses);

    // ── Pagar antes del vencimiento, con el monto real ──
    r = await F.expensePay(db, 'acme', S, { data: {
        recurring_expense_id: luz.id, period_key: '2026-11', amount: 342150, payment_method: 'Débito', paid_at: '2026-11-05',
    } });
    check('paga la luz de noviembre', r.success, r.error);
    let g = await fila("SELECT * FROM business_expenses WHERE recurring_expense_id = ? AND period_key = '2026-11'", [luz.id]);
    check('con el monto real', Number(g?.amount) === 342150, g?.amount);
    check('pagado, con la fecha de pago', g?.status === 'paid' && g?.paid_at === '2026-11-05', `${g?.status} ${g?.paid_at}`);
    check('el vencimiento sigue siendo el de la cuenta (9), no el día del pago', g?.due_date === '2026-11-09', g?.due_date);
    check('fecha del gasto = día del pago (mismo mes)', g?.expense_date === '2026-11-05', g?.expense_date);
    check('medio de pago y datos de la plantilla', g?.payment_method === 'Débito' && g?.description === 'Luz' && g?.supplier === 'CGE');

    b = await F.financeBootstrap(db, 'acme', S, mes('2026-11'));
    check('ya no sale en Vencimientos', !b.obligations.some((o) => String(o.templateId) === String(luz.id) || String(o.recurringExpenseId) === String(luz.id)));
    check('el resumen pasa al monto real', Math.round(b.summary.recurringExpenses) === 342150, b.summary.recurringExpenses);
    const plantilla = await fila('SELECT amount FROM recurring_expenses WHERE id = ?', [luz.id]);
    check('el estimado del recurrente no cambia', Number(plantilla.amount) === 350000);

    // Doble clic / dos pestañas.
    r = await F.expensePay(db, 'acme', S, { data: { recurring_expense_id: luz.id, period_key: '2026-11', amount: 1, paid_at: '2026-11-06' } });
    check('no se paga dos veces el mismo mes', r.success === false && /ya está pagada/.test(r.error), r.error);
    g = await fila("SELECT amount, paid_at FROM business_expenses WHERE recurring_expense_id = ? AND period_key = '2026-11'", [luz.id]);
    check('y el pago queda como estaba', Number(g.amount) === 342150 && g.paid_at === '2026-11-05');
    const n = await fila("SELECT COUNT(*) n FROM business_expenses WHERE recurring_expense_id = ? AND period_key = '2026-11'", [luz.id]);
    check('una sola fila del mes', Number(n.n) === 1);

    // ── Adelantado: la de diciembre, pagada el 10 de noviembre ──
    r = await F.expensePay(db, 'acme', S, { data: { recurring_expense_id: luz.id, period_key: '2026-12', amount: 360000, payment_method: 'Transferencia', paid_at: '2026-11-10' } });
    check('paga diciembre por adelantado', r.success, r.error);
    g = await fila("SELECT * FROM business_expenses WHERE recurring_expense_id = ? AND period_key = '2026-12'", [luz.id]);
    check('pagada el 10-nov, cuenta de diciembre', g?.paid_at === '2026-11-10' && g?.due_date === '2026-12-09' && g?.expense_date === '2026-12-09', `${g?.paid_at} ${g?.due_date} ${g?.expense_date}`);
    const bDic = await F.financeBootstrap(db, 'acme', S, mes('2026-12'));
    check('diciembre lleva el gasto real', Math.round(bDic.summary.recurringExpenses) === 360000, bDic.summary.recurringExpenses);
    b = await F.financeBootstrap(db, 'acme', S, mes('2026-11'));
    check('noviembre no cambia', Math.round(b.summary.recurringExpenses) === 342150, b.summary.recurringExpenses);

    // ── Atrasado: la de octubre, pagada el 14 de noviembre ──
    r = await F.expensePay(db, 'acme', S, { data: { recurring_expense_id: luz.id, period_key: '2026-10', amount: 330000, paid_at: '2026-11-14' } });
    g = await fila("SELECT * FROM business_expenses WHERE recurring_expense_id = ? AND period_key = '2026-10'", [luz.id]);
    check('octubre pagado tarde: queda en octubre', r.success && g?.expense_date === '2026-10-09' && g?.paid_at === '2026-11-14', `${g?.expense_date} ${g?.paid_at}`);
    check('sin medio elegido usa el del recurrente', g?.payment_method === 'Debito', g?.payment_method);

    // ── Un gasto anotado como Pendiente ──
    r = await F.expenseSave(db, 'acme', S, { data: {
        description: 'Contador', amount: 100000, expense_date: '2026-11-02', due_date: '2026-11-20', status: 'pending', payment_method: 'Transferencia', notes: 'boleta 55',
    } });
    const cont = await fila("SELECT * FROM business_expenses WHERE description = 'Contador'");
    b = await F.financeBootstrap(db, 'acme', S, mes('2026-11'));
    check('el pendiente sale en Vencimientos', b.obligations.some((o) => o.kind === 'expense' && String(o.id) === String(cont.id)));

    r = await F.expensePay(db, 'otra', S, { data: { id: cont.id, amount: 1, paid_at: '2026-11-14' } });
    g = await fila('SELECT * FROM business_expenses WHERE id = ?', [cont.id]);
    check('otra empresa no puede pagarlo', r.success === false && g.status === 'pending' && Number(g.amount) === 100000);

    r = await F.expensePay(db, 'acme', S, { data: { id: cont.id, amount: 95000, paid_at: '2026-11-14' } });
    g = await fila('SELECT * FROM business_expenses WHERE id = ?', [cont.id]);
    check('lo paga con el monto real', r.success && g.status === 'paid' && Number(g.amount) === 95000 && g.paid_at === '2026-11-14', r.error);
    check('fecha, vencimiento y notas quedan', g.expense_date === '2026-11-02' && g.due_date === '2026-11-20' && g.notes === 'boleta 55');
    check('sin medio elegido conserva el que tenía', g.payment_method === 'Transferencia', g.payment_method);
    r = await F.expensePay(db, 'acme', S, { data: { id: cont.id, amount: 1, paid_at: '2026-11-15' } });
    check('pagar otra vez el mismo: error', r.success === false && /ya no está pendiente/.test(r.error), r.error);

    // ── Un recurrente del mes que se había anotado como Pendiente ──
    await F.recurringSave(db, 'acme', S, { data: { description: 'Agua', amount: 50000, start_date: '2026-01-01', due_day: 18 } });
    const agua = await fila("SELECT * FROM recurring_expenses WHERE description = 'Agua'");
    await F.expenseSave(db, 'acme', S, { data: {
        recurring_expense_id: agua.id, period_key: '2026-11', description: 'Agua', amount: 50000, expense_date: '2026-11-03', due_date: '2026-11-18', status: 'pending',
    } });
    r = await F.expensePay(db, 'acme', S, { data: { recurring_expense_id: agua.id, period_key: '2026-11', amount: 47300, payment_method: 'Efectivo', paid_at: '2026-11-14' } });
    const filasAgua = (await db.execute({ sql: "SELECT * FROM business_expenses WHERE recurring_expense_id = ? AND period_key = '2026-11'", args: [agua.id] })).rows;
    check('paga ese mismo pendiente, sin duplicar', r.success && filasAgua.length === 1 && filasAgua[0].status === 'paid' && Number(filasAgua[0].amount) === 47300, r.error);

    // ── Validaciones ──
    r = await F.expensePay(db, 'acme', S, { data: { recurring_expense_id: luz.id, period_key: '2027-01', amount: 0 } });
    check('monto 0: error', r.success === false && /mayor que cero/.test(r.error), r.error);
    r = await F.expensePay(db, 'acme', S, { data: { amount: 1000 } });
    check('sin decir qué cuenta: error', r.success === false, r.error);
    r = await F.expensePay(db, 'acme', S, { data: { recurring_expense_id: 99999, period_key: '2027-01', amount: 1000 } });
    check('recurrente que no existe: error', r.success === false, r.error);
    r = await F.expensePay(db, 'acme', { uid: 77, role: 'Caja' }, { data: { recurring_expense_id: luz.id, period_key: '2027-01', amount: 1000 } });
    check('sin permiso de finanzas: error', r.success === false && /permiso/.test(r.error), r.error);

    // ── Fecha de pago: la real, si se anota después ──
    const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await F.recurringSave(db, 'acme', S, { data: { description: 'Teléfono', amount: 20000, start_date: '2026-01-01', due_day: 10 } });
    const tel = await fila("SELECT * FROM recurring_expenses WHERE description = 'Teléfono'");
    r = await F.expensePay(db, 'acme', S, { data: { recurring_expense_id: tel.id, period_key: ayer.slice(0, 7), amount: 19990, paid_at: ayer } });
    g = await fila('SELECT paid_at, expense_date FROM business_expenses WHERE recurring_expense_id = ?', [tel.id]);
    check('pagado ayer, anotado hoy: queda con la fecha de ayer', r.success && g?.paid_at === ayer && g?.expense_date === ayer, `${g?.paid_at} ${g?.expense_date}`);
    const enUnaSemana = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    r = await F.expensePay(db, 'acme', S, { data: { recurring_expense_id: tel.id, period_key: enUnaSemana.slice(0, 7) === ayer.slice(0, 7) ? '2027-02' : enUnaSemana.slice(0, 7), amount: 1, paid_at: enUnaSemana } });
    check('fecha de pago futura: error', r.success === false && /futura/.test(r.error), r.error);

    // ── Recurrentes de meses anteriores sin pagar (hasta 3 meses atrás) ──
    const viejo = async (description, extra = {}) => {
        await F.recurringSave(db, 'acme', S, { data: { description, amount: 10000, start_date: '2026-01-01', due_day: 5, ...extra } });
        const t = await fila('SELECT * FROM recurring_expenses WHERE description = ?', [description]);
        // Anotado en el sistema en mayo: desde ahí se le puede deber.
        await db.execute({ sql: "UPDATE recurring_expenses SET created_at = '2026-05-01T12:00:00.000Z' WHERE id = ?", args: [t.id] });
        return t;
    };
    const meses = (b, t) => b.obligations.filter((o) => o.kind === 'recurring' && String(o.templateId) === String(t.id)).map((o) => o.periodKey);
    const gas = await viejo('Gas');
    b = await F.financeBootstrap(db, 'acme', S, mes('2026-11'));
    check('noviembre: el sin pagar sale en ago, sep, oct y nov', JSON.stringify(meses(b, gas)) === '["2026-08","2026-09","2026-10","2026-11"]', JSON.stringify(meses(b, gas)));
    const vOct = b.obligations.find((o) => String(o.templateId) === String(gas.id) && o.periodKey === '2026-10');
    check('con el vencimiento de su mes', vOct?.dueDate === '2026-10-05', vOct?.dueDate);
    await F.expensePay(db, 'acme', S, { data: { recurring_expense_id: gas.id, period_key: '2026-09', amount: 9000, paid_at: '2026-11-14' } });
    b = await F.financeBootstrap(db, 'acme', S, mes('2026-11'));
    check('pagado septiembre, quedan ago, oct y nov', JSON.stringify(meses(b, gas)) === '["2026-08","2026-10","2026-11"]', JSON.stringify(meses(b, gas)));
    b = await F.financeBootstrap(db, 'acme', S, mes('2026-08'));
    check('viendo agosto: may, jun, jul y ago', JSON.stringify(meses(b, gas)) === '["2026-05","2026-06","2026-07","2026-08"]', JSON.stringify(meses(b, gas)));
    b = await F.financeBootstrap(db, 'acme', S, mes('2026-06'));
    check('no antes de que se anotara en el sistema (mayo)', JSON.stringify(meses(b, gas)) === '["2026-05","2026-06"]', JSON.stringify(meses(b, gas)));
    const nuevo = await viejo('Seguro', { start_date: '2026-10-01' });
    b = await F.financeBootstrap(db, 'acme', S, mes('2026-11'));
    check('no antes de que empiece (octubre)', JSON.stringify(meses(b, nuevo)) === '["2026-10","2026-11"]', JSON.stringify(meses(b, nuevo)));
    const termino = await viejo('Alarma', { end_date: '2026-09-30' });
    b = await F.financeBootstrap(db, 'acme', S, mes('2026-11'));
    check('no después de que termina (septiembre)', JSON.stringify(meses(b, termino)) === '["2026-08","2026-09"]', JSON.stringify(meses(b, termino)));
    check('Luz (anotada este mes) sigue solo con lo suyo', b.obligations.filter((o) => String(o.templateId) === String(luz.id)).length === 0);

    // ── Fondos: caja chica, capital… ──
    b = await F.financeBootstrap(db, 'acme', S, mes('2026-11'));
    check('con la migración 0041: lista de fondos (vacía)', Array.isArray(b.funds) && b.funds.length === 0, JSON.stringify(b.funds));
    r = await F.fundSave(db, 'acme', S, { data: { name: 'Caja chica', initial_amount: 1000000, movement_date: '2026-11-01' } });
    check('crea «Caja chica» con $1.000.000', r.success, r.error);
    r = await F.fundSave(db, 'acme', S, { data: { name: 'Capital' } });
    const saldo = async (nombre, emp = 'acme') => (await F.financeBootstrap(db, emp, S, mes('2026-11'))).funds?.find((f) => f.name === nombre)?.balance;
    const caja = await fila("SELECT * FROM finance_funds WHERE name = 'Caja chica'");
    check('saldo inicial 1.000.000', (await saldo('Caja chica')) === 1000000, await saldo('Caja chica'));
    check('sin saldo inicial: 0', (await saldo('Capital')) === 0);

    // Pagar el agua de octubre... (recurrente) desde la caja chica
    r = await F.expensePay(db, 'acme', S, { data: { recurring_expense_id: gas.id, period_key: '2026-10', amount: 12000, paid_at: '2026-11-14', fund_id: caja.id } });
    check('pagar un recurrente desde la caja chica', r.success, r.error);
    check('la caja chica baja 12.000', (await saldo('Caja chica')) === 988000, await saldo('Caja chica'));
    g = await fila("SELECT fund_id FROM business_expenses WHERE recurring_expense_id = ? AND period_key = '2026-10'", [gas.id]);
    check('el gasto queda con su fondo', Number(g.fund_id) === Number(caja.id));

    // Un pendiente pagado desde la caja chica
    await F.expenseSave(db, 'acme', S, { data: { description: 'Gasfíter', amount: 40000, expense_date: '2026-11-10', status: 'pending' } });
    const gasf = await fila("SELECT * FROM business_expenses WHERE description = 'Gasfíter'");
    check('un pendiente no descuenta', (await saldo('Caja chica')) === 988000);
    r = await F.expensePay(db, 'acme', S, { data: { id: gasf.id, amount: 35000, paid_at: '2026-11-14', fund_id: caja.id } });
    check('al pagarlo, descuenta lo pagado', r.success && (await saldo('Caja chica')) === 953000, await saldo('Caja chica'));

    // Un gasto puntual nuevo, ya pagado, desde la caja chica (Registrar gasto)
    r = await F.expenseSave(db, 'acme', S, { data: { description: 'Aseo', amount: 8000, expense_date: '2026-11-12', status: 'paid', fund_id: caja.id } });
    const aseo = await fila("SELECT * FROM business_expenses WHERE description = 'Aseo'");
    check('Registrar gasto con fondo: queda en el gasto nuevo', r.success && Number(aseo.fund_id) === Number(caja.id), r.error);
    check('y descuenta', (await saldo('Caja chica')) === 945000, await saldo('Caja chica'));
    const otros = await db.execute({ sql: 'SELECT COUNT(*) n FROM business_expenses WHERE fund_id IS NOT NULL', args: [] });
    check('solo los 3 gastos elegidos tienen fondo', Number(otros.rows[0].n) === 3, otros.rows[0].n);

    // Corregir el monto del gasto: el saldo lo sigue solo
    await F.expenseSave(db, 'acme', S, { data: { ...aseo, amount: 10000 } });
    check('corregir el monto: el saldo se ajusta', (await saldo('Caja chica')) === 943000, await saldo('Caja chica'));
    // Editar sin tocar el fondo (pedido sin fund_id) lo conserva
    await F.expenseSave(db, 'acme', S, { data: { id: aseo.id, description: 'Aseo', amount: 10000, expense_date: '2026-11-12', status: 'paid' } });
    g = await fila('SELECT fund_id FROM business_expenses WHERE id = ?', [aseo.id]);
    check('editar sin mandar fondo lo conserva', Number(g.fund_id) === Number(caja.id));
    // Quitarle el fondo
    await F.expenseSave(db, 'acme', S, { data: { id: aseo.id, description: 'Aseo', amount: 10000, expense_date: '2026-11-12', status: 'paid', fund_id: null } });
    check('quitarle el fondo: vuelve la plata', (await saldo('Caja chica')) === 953000, await saldo('Caja chica'));
    // Borrar el gasto pagado con fondo
    await F.expenseDelete(db, 'acme', S, { id: gasf.id });
    check('borrar el gasto: vuelve la plata', (await saldo('Caja chica')) === 988000, await saldo('Caja chica'));

    // Aportes y retiros
    r = await F.fundMovementAdd(db, 'acme', S, { data: { fund_id: caja.id, kind: 'deposit', amount: 200000, movement_date: '2026-11-13', description: 'Aporte del dueño' } });
    check('agregar plata', r.success && (await saldo('Caja chica')) === 1188000, await saldo('Caja chica'));
    r = await F.fundMovementAdd(db, 'acme', S, { data: { fund_id: caja.id, kind: 'withdrawal', amount: 50000, movement_date: '2026-11-13', description: 'Para mercadería' } });
    check('sacar plata', r.success && (await saldo('Caja chica')) === 1138000, await saldo('Caja chica'));
    r = await F.fundMovementAdd(db, 'acme', S, { data: { fund_id: caja.id, kind: 'deposit', amount: 0 } });
    check('monto 0: error', r.success === false);
    r = await F.fundMovementAdd(db, 'acme', S, { data: { fund_id: caja.id, kind: 'robo', amount: 10 } });
    check('tipo raro: error', r.success === false);
    r = await F.fundMovementAdd(db, 'otra', S, { data: { fund_id: caja.id, kind: 'deposit', amount: 10 } });
    check('otra empresa no puede mover el fondo', r.success === false && (await saldo('Caja chica')) === 1138000);
    r = await F.fundMovementAdd(db, 'acme', S, { data: { fund_id: caja.id, kind: 'deposit', amount: 10, movement_date: enUnaSemana } });
    check('fecha futura: error', r.success === false && /futura/.test(r.error), r.error);

    // Historial
    r = await F.fundMovements(db, 'acme', S, { fundId: caja.id });
    const tipos = r.movements.map((m) => `${m.kind}:${m.amount}`);
    check('historial: aportes, retiros y gastos pagados', r.success && tipos.includes('deposit:1000000') && tipos.includes('deposit:200000') && tipos.includes('withdrawal:50000') && tipos.includes('expense:12000') && r.movements.length === 4, JSON.stringify(tipos));
    check('historial: el más nuevo primero', r.movements[0].date >= r.movements.at(-1).date);
    r = await F.fundMovements(db, 'otra', S, { fundId: caja.id });
    check('historial de otra empresa: vacío', r.success && r.movements.length === 0);

    // Borrar un movimiento manual
    const retiro = await fila("SELECT id FROM finance_fund_movements WHERE kind = 'withdrawal'");
    await F.fundMovementDelete(db, 'otra', S, { id: retiro.id });
    check('otra empresa no borra el movimiento', (await saldo('Caja chica')) === 1138000);
    await F.fundMovementDelete(db, 'acme', S, { id: retiro.id });
    check('borrar el retiro: vuelve la plata', (await saldo('Caja chica')) === 1188000, await saldo('Caja chica'));

    // Un fondo de otra empresa no se puede usar para pagar
    await F.fundSave(db, 'otra', S, { data: { name: 'Ajeno', initial_amount: 5000 } });
    const ajeno = await fila("SELECT id FROM finance_funds WHERE name = 'Ajeno'");
    await F.expenseSave(db, 'acme', S, { data: { description: 'Truco', amount: 1000, expense_date: '2026-11-12', status: 'paid', fund_id: ajeno.id } });
    g = await fila("SELECT fund_id FROM business_expenses WHERE description = 'Truco'");
    check('fondo de otra empresa: el gasto queda sin fondo', g.fund_id === null, String(g.fund_id));
    check('y el fondo ajeno no se toca', (await saldo('Ajeno', 'otra')) === 5000);

    // Renombrar y archivar
    await F.fundSave(db, 'acme', S, { data: { id: caja.id, name: 'Caja chica local' } });
    b = await F.financeBootstrap(db, 'acme', S, mes('2026-11'));
    check('renombrar', b.funds.some((f) => f.name === 'Caja chica local' && f.active && f.balance === 1188000));
    await F.fundSave(db, 'acme', S, { data: { id: caja.id, name: 'Caja chica local', active: false } });
    b = await F.financeBootstrap(db, 'acme', S, mes('2026-11'));
    check('archivar: sigue en la lista, inactivo', b.funds.some((f) => f.name === 'Caja chica local' && !f.active));
    r = await F.fundMovementAdd(db, 'acme', S, { data: { fund_id: caja.id, kind: 'deposit', amount: 10 } });
    check('a un fondo archivado no se le agrega plata', r.success === false);
    r = await F.fundSave(db, 'acme', S, { data: { name: '   ' } });
    check('sin nombre: error', r.success === false);

    // ── Base sin la migración 0041 (entre el push y migrate-all) ──
    const sin = await nuevaBase('sin0041.db', 40);
    b = await F.financeBootstrap(sin, 'acme', S, mes('2026-11'));
    check('sin 0041: Administración carga igual, sin fondos', b.success && b.funds === null);
    r = await F.expenseSave(sin, 'acme', S, { data: { description: 'Pan', amount: 5000, expense_date: '2026-11-12', status: 'paid' } });
    check('sin 0041: Registrar gasto funciona', r.success, r.error);
    await F.recurringSave(sin, 'acme', S, { data: { description: 'Luz', amount: 1000, start_date: '2026-01-01', due_day: 9 } });
    const luzSin = (await sin.execute('SELECT id FROM recurring_expenses LIMIT 1')).rows[0];
    r = await F.expensePay(sin, 'acme', S, { data: { recurring_expense_id: luzSin.id, period_key: '2026-11', amount: 900, paid_at: '2026-11-14' } });
    check('sin 0041: Pagar funciona', r.success, r.error);
    await F.expenseSave(sin, 'acme', S, { data: { description: 'Pend', amount: 100, expense_date: '2026-11-12', status: 'pending' } });
    const pend = (await sin.execute("SELECT id FROM business_expenses WHERE description = 'Pend'")).rows[0];
    r = await F.expensePay(sin, 'acme', S, { data: { id: pend.id, amount: 100, paid_at: '2026-11-14' } });
    check('sin 0041: pagar un pendiente funciona', r.success, r.error);
} finally {
    for (const base of bases) base.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows */ }
}

console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
process.exit(fallas ? 1 : 0);
