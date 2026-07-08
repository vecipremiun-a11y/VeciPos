import { createClient } from '@libsql/client';
import { MercadoPagoConfig, Preference } from 'mercadopago';

// Turso lazy (las env se leen en request porque server.js carga dotenv tras los imports)
let _turso = null;
function getTurso() {
    if (_turso) return _turso;
    const url = process.env.VITE_TURSO_DATABASE_URL;
    const authToken = process.env.VITE_TURSO_AUTH_TOKEN;
    if (!url || !authToken) throw new Error('Faltan variables Turso');
    _turso = createClient({ url, authToken });
    return _turso;
}

// MercadoPago lazy
let _pref = null;
function getPreferenceClient() {
    if (_pref) return _pref;
    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!accessToken) throw new Error('Falta MERCADOPAGO_ACCESS_TOKEN');
    _pref = new Preference(new MercadoPagoConfig({ accessToken }));
    return _pref;
}

// Precios (fuente de verdad del cobro, no se confía en el cliente).
// Chile (CL) se cobra en CLP; el resto de países en USD.
const PLAN_PRICES = {
    basico: { CLP: { monthly: 15000, annual: 150000 }, USD: { monthly: 15, annual: 150 } },
    medium: { CLP: { monthly: 30000, annual: 300000 }, USD: { monthly: 30, annual: 300 } },
    pro: { CLP: { monthly: 60000, annual: 600000 }, USD: { monthly: 60, annual: 600 } },
};
const PLAN_NAMES = { basico: 'Plan Básico', medium: 'Plan Medium', pro: 'Plan Pro' };

const displayCurrency = (countryCode) => {
    const cc = (countryCode || '').toString().trim().toUpperCase();
    return (cc === 'CL' || cc === 'CHILE' || cc === '') ? 'CLP' : 'USD';
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const turso = getTurso();
        const { companyId, planId, billingCycle } = req.body || {};

        // Validaciones
        if (!companyId || !PLAN_PRICES[planId] || !['monthly', 'annual'].includes(billingCycle)) {
            return res.status(400).json({ success: false, error: 'Datos de plan inválidos' });
        }

        // La empresa debe existir
        const c = await turso.execute({
            sql: 'SELECT id, name, email_main, country_code FROM companies WHERE id = ?',
            args: [companyId]
        });
        if (c.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Empresa no encontrada' });
        }
        const company = c.rows[0];

        // Moneda y monto a cobrar según el país (servidor = fuente de verdad)
        const currency = displayCurrency(company.country_code);
        const amount = PLAN_PRICES[planId][currency][billingCycle];
        const cycleLabel = billingCycle === 'annual' ? 'Anual' : 'Mensual';
        const planName = `${PLAN_NAMES[planId]} (${cycleLabel})`;

        const appUrl = process.env.VITE_APP_URL || '';
        const paymentId = `payment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Registrar pago pendiente
        await turso.execute({
            sql: `INSERT INTO payments (id, company_id, amount, currency, status, payment_method, description, payer_email, plan_id, billing_cycle, created_at)
                  VALUES (?, ?, ?, ?, 'pending', 'mercadopago', ?, ?, ?, ?, ?)`,
            args: [paymentId, companyId, amount, currency, `Suscripción: ${planName}`, company.email_main || null, planId, billingCycle, new Date().toISOString()]
        });

        // Crear preferencia de MercadoPago (en la moneda del país)
        const preference = {
            items: [{
                title: `POSVECI - ${planName}`,
                description: `Suscripción ${cycleLabel} al sistema POS`,
                quantity: 1,
                unit_price: amount,
                currency_id: currency
            }],
            ...(company.email_main ? { payer: { email: company.email_main } } : {}),
            back_urls: {
                success: `${appUrl}/payment-success`,
                failure: `${appUrl}/payment-failure`,
                pending: `${appUrl}/payment-pending`
            },
            auto_return: 'approved',
            external_reference: companyId,
            metadata: {
                type: 'subscription',
                company_id: companyId,
                payment_id: paymentId,
                plan_id: planId,
                billing_cycle: billingCycle
            },
            notification_url: `${appUrl}/api/webhook`
        };

        const response = await getPreferenceClient().create({ body: preference });

        await turso.execute({
            sql: 'UPDATE payments SET mercadopago_preference_id = ? WHERE id = ?',
            args: [response.id, paymentId]
        });

        return res.status(200).json({
            success: true,
            init_point: response.init_point,
            amount,
            currency,
            plan_name: planName
        });

    } catch (error) {
        console.error('❌ subscribe error:', error);
        return res.status(500).json({
            success: false,
            error: 'No se pudo iniciar el pago. Intenta nuevamente.',
            details: error.message
        });
    }
}
