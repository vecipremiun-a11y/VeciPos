// Configuración de MercadoPago para el frontend
export const MERCADOPAGO_CONFIG = {
    publicKey: import.meta.env.VITE_MERCADOPAGO_PUBLIC_KEY,
    locale: 'es-CL'
};

// Planes de suscripción
export const SUBSCRIPTION_PLANS = {
    monthly: {
        id: 'monthly',
        name: 'Plan Mensual',
        price: 30000,
        currency: 'CLP',
        frequency: 'monthly',
        description: 'Facturación mensual',
        features: [
            'Punto de venta completo',
            'Gestión de inventario',
            'Reportes en tiempo real',
            'Múltiples usuarios',
            'Soporte por email'
        ]
    },
    yearly: {
        id: 'yearly',
        name: 'Plan Anual',
        price: 300000,
        pricePerMonth: 25000,
        currency: 'CLP',
        frequency: 'yearly',
        description: 'Facturación anual - Ahorra $60,000',
        discount: '17% de descuento',
        features: [
            'Todo lo del plan mensual',
            'Ahorro de $60,000 al año',
            '2 meses gratis',
            'Soporte prioritario',
            'Actualizaciones anticipadas'
        ]
    }
};

// Helper para formatear precios
export const formatPrice = (amount) => {
    return new Intl.NumberFormat('es-CL', {
        style: 'currency',
        currency: 'CLP',
        minimumFractionDigits: 0
    }).format(amount);
};
