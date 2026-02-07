import { createClient } from '@libsql/client';
import mercadopago from 'mercadopago';

// Configurar MercadoPago
mercadopago.configure({
    access_token: process.env.MERCADOPAGO_ACCESS_TOKEN
});

// Configurar Turso
const turso = createClient({
    url: process.env.VITE_TURSO_DATABASE_URL,
    authToken: process.env.VITE_TURSO_AUTH_TOKEN
});

export default async function handler(req, res) {
    // Solo permitir POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { planId, planName, amount, currency, registrationData } = req.body;

        console.log('📝 Creating payment preference:', { planId, amount });

        // Validar datos
        if (!planId || !amount || !registrationData) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Generar IDs únicos
        const companyId = `company_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const paymentId = `payment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Crear empresa en estado pending
        await turso.execute({
            sql: `INSERT INTO companies (id, name, timezone, status, created_at) 
                  VALUES (?, ?, 'America/Santiago', 'pending_payment', ?)`,
            args: [companyId, registrationData.company.name, new Date().toISOString()]
        });

        console.log('✅ Company created:', companyId);

        // Guardar datos de registro temporalmente
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

        // Guardar datos de registro en JSON para uso posterior
        const registrationJson = JSON.stringify(registrationData);

        // Crear preferencia de pago en MercadoPago
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

        const response = await mercadopago.preferences.create(preference);

        console.log('✅ Preference created:', response.body.id);

        // Actualizar payment con preference_id
        await turso.execute({
            sql: `UPDATE payments SET mercadopago_preference_id = ? WHERE id = ?`,
            args: [response.body.id, paymentId]
        });

        return res.status(200).json({
            success: true,
            init_point: response.body.init_point,
            preference_id: response.body.id
        });

    } catch (error) {
        console.error('❌ Error creating payment:', error);
        return res.status(500).json({
            success: false,
            error: 'Error al crear el pago',
            details: error.message
        });
    }
};