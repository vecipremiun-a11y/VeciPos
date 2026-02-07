import { createClient } from '@libsql/client';
import { MercadoPagoConfig, Preference } from 'mercadopago';

// Configurar MercadoPago
const client = new MercadoPagoConfig({
    accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN
});
const preferenceClient = new Preference(client);

// Configurar Turso
const turso = createClient({
    url: process.env.VITE_TURSO_DATABASE_URL,
    authToken: process.env.VITE_TURSO_AUTH_TOKEN
});

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { planId, planName, amount, currency, registrationData } = req.body;

        console.log('📝 Creating payment preference:', { planId, amount });

        if (!planId || !amount || !registrationData) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const companyId = `company_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const paymentId = `payment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        await turso.execute({
            sql: `INSERT INTO companies (id, name, timezone, status, created_at) 
                  VALUES (?, ?, 'America/Santiago', 'pending_payment', ?)`,
            args: [companyId, registrationData.company.name, new Date().toISOString()]
        });

        console.log('✅ Company created:', companyId);

        await turso.execute({
            sql: `INSERT INTO payments (id, company_id, amount, currency, status, description, payer_email, created_at)
                  VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
            args: [
                paymentId,
                companyId,
                amount,
                currency,
                `Registro: ${planName}`,
                registrationData.admin.email,
                new Date().toISOString()
            ]
        });

        const registrationJson = JSON.stringify(registrationData);

        const preference = {
            items: [
                {
                    title: `POSVECI - ${planName}`,
                    description: `Suscripción al sistema POS (15 días de prueba incluidos)`,
                    quantity: 1,
                    unit_price: amount,
                    currency_id: currency
                }
            ],
            payer: {
                name: registrationData.admin.name,
                email: registrationData.admin.email
            },
            back_urls: {
                success: `${process.env.VITE_APP_URL}/payment-success`,
                failure: `${process.env.VITE_APP_URL}/payment-failure`,
                pending: `${process.env.VITE_APP_URL}/payment-pending`
            },
            auto_return: 'approved',
            external_reference: companyId,
            metadata: {
                company_id: companyId,
                payment_id: paymentId,
                plan_id: planId,
                registration_data: registrationJson
            },
            notification_url: `${process.env.VITE_APP_URL}/api/webhook`
        };

        console.log('🔄 Creating MercadoPago preference...');

        const response = await preferenceClient.create({ body: preference });

        console.log('✅ Preference created:', response.id);

        await turso.execute({
            sql: `UPDATE payments SET mercadopago_preference_id = ? WHERE id = ?`,
            args: [response.id, paymentId]
        });

        return res.status(200).json({
            success: true,
            init_point: response.init_point,
            preference_id: response.id
        });

    } catch (error) {
        console.error('❌ Error creating payment:', error);
        return res.status(500).json({
            success: false,
            error: 'Error al crear el pago',
            details: error.message
        });
    }
}