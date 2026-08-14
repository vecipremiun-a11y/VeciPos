import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';

import integrationConfigHandler from './api/integration/config.js';
import integrationWebhookHandler from './api/integration/webhook.js';
import integrationSyncPriceHandler from './api/integration/sync-price.js';
import integrationSyncStockHandler from './api/integration/sync-stock.js';
import integrationRetryStockHandler from './api/integration/retry-stock.js';
import integrationSyncProductHandler from './api/integration/sync-product.js';
import notifyMiniveciStatusHandler from './api/integration/notify-miniveci-status.js';
import pushPreorderHandler from './api/integration/push-preorder.js';
import pushSorteoHandler from './api/integration/push-sorteo.js';

import externalPreordersHandler from './api/external/preorders.js';
import externalClientsHandler from './api/external/clients.js';

import kdsOrdersHandler from './api/kds/orders.js';
import kdsUpdateStatusHandler from './api/kds/update-status.js';

import sorteoPublicHandler from './api/sorteo/public.js';
import sorteoRegisterHandler from './api/sorteo/register.js';

import siiConfigHandler from './api/sii/config.js';
import siiUploadCertHandler from './api/sii/upload-cert.js';
import siiRequestCafHandler from './api/sii/request-caf.js';
import siiFoliosHandler from './api/sii/folios.js';
import siiEmitHandler from './api/sii/emit.js';
import siiStatusHandler from './api/sii/status.js';
import siiRcofHandler from './api/sii/rcof.js';
import siiLookupRutHandler from './api/sii/lookup-rut.js';
import siiReservedFoliosHandler from './api/sii/reserved-folios.js';
import siiReserveFoliosHandler from './api/sii/reserve-folios.js';

import startTrialHandler from './api/start-trial.js';
import subscribeHandler from './api/subscribe.js';
import expireCompaniesHandler from './api/cron/expire-companies.js';
import authLoginHandler from './api/auth/login.js';
import adminActionsHandler from './api/admin/actions.js';
import dataActionsHandler from './api/data/actions.js';
import pingHandler from './api/ping.js';
import aiConsultarHandler from './api/ai/consultar.js';
import aiFacturaPedidoHandler from './api/ai/factura-pedido.js';

dotenv.config({ path: '.env.local' });
dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3010);

const corsOptions = {
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);

        const allowedOrigins = new Set([
            'http://localhost:5173',
            'http://localhost:5174',
        ]);

        if (allowedOrigins.has(origin)) {
            return callback(null, true);
        }

        return callback(new Error(`CORS origin no permitida: ${origin}`));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-company-id', 'x-api-consumer-key', 'x-signature', 'x-wc-webhook-signature'],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/health', (_req, res) => {
    return res.status(200).json({ success: true, service: 'pos-integration-api' });
});

// Latido de conectividad del POS (ver api/ping.js). En dev lo sirve Express.
app.all('/api/ping', async (req, res) => {
    try { return await pingHandler(req, res); }
    catch (error) { return res.status(500).json({ ok: false, error: error.message }); }
});

// Asistente IA. En Vercel es su propia ruta con maxDuration largo; en dev lo
// sirve Express igual que el resto.
app.all('/api/ai/consultar', async (req, res) => {
    try { return await aiConsultarHandler(req, res); }
    catch (error) { return res.status(500).json({ success: false, error: error.message }); }
});

// Foto de factura → pedido, desde el botón de Pedidos Realizados.
app.all('/api/ai/factura-pedido', async (req, res) => {
    try { return await aiFacturaPedidoHandler(req, res); }
    catch (error) { return res.status(500).json({ success: false, error: error.message }); }
});

app.all('/api/integration/config', async (req, res) => {
    try {
        return await integrationConfigHandler(req, res);
    } catch (error) {
        console.error('❌ /api/integration/config fatal error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
        });
    }
});

app.all('/api/integration/webhook', async (req, res) => {
    try {
        return await integrationWebhookHandler(req, res);
    } catch (error) {
        console.error('❌ /api/integration/webhook fatal error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
        });
    }
});

app.all('/api/integration/sync-price', async (req, res) => {
    try {
        return await integrationSyncPriceHandler(req, res);
    } catch (error) {
        console.error('❌ /api/integration/sync-price fatal error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
        });
    }
});

app.all('/api/integration/sync-stock', async (req, res) => {
    try {
        return await integrationSyncStockHandler(req, res);
    } catch (error) {
        console.error('❌ /api/integration/sync-stock fatal error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
        });
    }
});

app.all('/api/integration/sync-product', async (req, res) => {
    try {
        return await integrationSyncProductHandler(req, res);
    } catch (error) {
        console.error('❌ /api/integration/sync-product fatal error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
        });
    }
});

app.all('/api/integration/retry-stock', async (req, res) => {
    try {
        return await integrationRetryStockHandler(req, res);
    } catch (error) {
        console.error('❌ /api/integration/retry-stock fatal error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
        });
    }
});

// SII routes
app.all('/api/sii/config', async (req, res) => {
    try { return await siiConfigHandler(req, res); }
    catch (error) { console.error('❌ /api/sii/config error:', error); return res.status(500).json({ error: error.message }); }
});
app.all('/api/sii/upload-cert', async (req, res) => {
    try { return await siiUploadCertHandler(req, res); }
    catch (error) { console.error('❌ /api/sii/upload-cert error:', error); return res.status(500).json({ error: error.message }); }
});
app.all('/api/sii/request-caf', async (req, res) => {
    try { return await siiRequestCafHandler(req, res); }
    catch (error) { console.error('❌ /api/sii/request-caf error:', error); return res.status(500).json({ error: error.message }); }
});
app.all('/api/sii/folios', async (req, res) => {
    try { return await siiFoliosHandler(req, res); }
    catch (error) { console.error('❌ /api/sii/folios error:', error); return res.status(500).json({ error: error.message }); }
});
app.all('/api/sii/emit', async (req, res) => {
    try { return await siiEmitHandler(req, res); }
    catch (error) { console.error('❌ /api/sii/emit error:', error); return res.status(500).json({ error: error.message }); }
});
app.all('/api/sii/status', async (req, res) => {
    try { return await siiStatusHandler(req, res); }
    catch (error) { console.error('❌ /api/sii/status error:', error); return res.status(500).json({ error: error.message }); }
});
app.all('/api/sii/rcof', async (req, res) => {
    try { return await siiRcofHandler(req, res); }
    catch (error) { console.error('❌ /api/sii/rcof error:', error); return res.status(500).json({ error: error.message }); }
});
app.all('/api/sii/lookup-rut', async (req, res) => {
    try { return await siiLookupRutHandler(req, res); }
    catch (error) { console.error('❌ /api/sii/lookup-rut error:', error); return res.status(500).json({ error: error.message }); }
});
app.all('/api/sii/reserved-folios', async (req, res) => {
    try { return await siiReservedFoliosHandler(req, res); }
    catch (error) { console.error('❌ /api/sii/reserved-folios error:', error); return res.status(500).json({ error: error.message }); }
});
app.all('/api/sii/reserve-folios', async (req, res) => {
    try { return await siiReserveFoliosHandler(req, res); }
    catch (error) { console.error('❌ /api/sii/reserve-folios error:', error); return res.status(500).json({ error: error.message }); }
});

app.all('/api/integration/notify-miniveci-status', async (req, res) => {
    try { return await notifyMiniveciStatusHandler(req, res); }
    catch (error) { console.error('❌ /api/integration/notify-miniveci-status error:', error); return res.status(500).json({ error: error.message }); }
});

app.all('/api/integration/push-preorder', async (req, res) => {
    try { return await pushPreorderHandler(req, res); }
    catch (error) { console.error('❌ /api/integration/push-preorder error:', error); return res.status(500).json({ error: error.message }); }
});

app.all('/api/integration/push-sorteo', async (req, res) => {
    try { return await pushSorteoHandler(req, res); }
    catch (error) { console.error('❌ /api/integration/push-sorteo error:', error); return res.status(500).json({ error: error.message }); }
});

app.all('/api/external/preorders', async (req, res) => {
    try { return await externalPreordersHandler(req, res); }
    catch (error) { console.error('❌ /api/external/preorders error:', error); return res.status(500).json({ error: error.message }); }
});

app.all('/api/external/clients', async (req, res) => {
    try { return await externalClientsHandler(req, res); }
    catch (error) { console.error('❌ /api/external/clients error:', error); return res.status(500).json({ error: error.message }); }
});

app.all('/api/kds/orders', async (req, res) => {
    try { return await kdsOrdersHandler(req, res); }
    catch (error) { console.error('❌ /api/kds/orders error:', error); return res.status(500).json({ error: error.message }); }
});

app.all('/api/kds/update-status', async (req, res) => {
    try { return await kdsUpdateStatusHandler(req, res); }
    catch (error) { console.error('❌ /api/kds/update-status error:', error); return res.status(500).json({ error: error.message }); }
});

app.all('/api/sorteo/public', async (req, res) => {
    try { return await sorteoPublicHandler(req, res); }
    catch (error) { console.error('❌ /api/sorteo/public error:', error); return res.status(500).json({ error: error.message }); }
});

app.all('/api/sorteo/register', async (req, res) => {
    try { return await sorteoRegisterHandler(req, res); }
    catch (error) { console.error('❌ /api/sorteo/register error:', error); return res.status(500).json({ error: error.message }); }
});

// Registro público de prueba gratis (crea cuenta trial sin pago)
app.all('/api/start-trial', async (req, res) => {
    try { return await startTrialHandler(req, res); }
    catch (error) { console.error('❌ /api/start-trial error:', error); return res.status(500).json({ success: false, error: error.message }); }
});

// Suscripción in-app: crea preferencia de pago MercadoPago (CLP) para empresa existente
app.all('/api/subscribe', async (req, res) => {
    try { return await subscribeHandler(req, res); }
    catch (error) { console.error('❌ /api/subscribe error:', error); return res.status(500).json({ success: false, error: error.message }); }
});

// Cron: marca Vencidas las empresas con access_until pasado (en prod lo dispara Vercel Cron).
app.all('/api/cron/expire-companies', async (req, res) => {
    try { return await expireCompaniesHandler(req, res); }
    catch (error) { console.error('❌ /api/cron/expire-companies error:', error); return res.status(500).json({ ok: false, error: error.message }); }
});

// Auth: login server-side (bcrypt + sesión). El navegador ya no consulta la contraseña.
app.all('/api/auth/login', async (req, res) => {
    try { return await authLoginHandler(req, res); }
    catch (error) { console.error('❌ /api/auth/login error:', error); return res.status(500).json({ success: false, error: error.message }); }
});

// Admin: mutaciones sensibles server-side (exige sesión firmada de super_admin).
app.all('/api/admin/actions', async (req, res) => {
    try { return await adminActionsHandler(req, res); }
    catch (error) { console.error('❌ /api/admin/actions error:', error); return res.status(500).json({ success: false, error: error.message }); }
});

// Datos del app normal (exige sesión + membresía a la empresa).
app.all('/api/data/actions', async (req, res) => {
    try { return await dataActionsHandler(req, res); }
    catch (error) { console.error('❌ /api/data/actions error:', error); return res.status(500).json({ success: false, error: error.message }); }
});

app.use('/api', (_req, res) => {
    return res.status(404).json({
        success: false,
        error: 'API route not found',
    });
});

app.use((error, _req, res, _next) => {
    console.error('❌ Express unhandled error:', error);
    return res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message,
    });
});

app.listen(PORT, () => {
    console.log(`✅ Integration API running on http://localhost:${PORT}`);
    console.log('✅ CORS enabled for http://localhost:5173 and http://localhost:5174');
});
