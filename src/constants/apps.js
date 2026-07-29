// Catálogo de complementos (Apps) del Marketplace de POSVECI.
// Cada App se compra aparte del plan (solo cuentas Profesional) y trae 30 días de
// prueba gratis. El gating efectivo lo aplica hasApp() en el store.
//
//   scope  : 'branch'  = licencia por sucursal · 'company' = por empresa (a futuro)
//   status : 'available' = comprable ya · 'coming_soon' = "Próximamente" (no comprable)
//   moduleKeys : módulos existentes que la App desbloquea (ver src/constants/modules.js)
//   icon   : nombre de icono lucide (lo resuelve el Marketplace)

export const APP_TRIAL_DAYS = 30;

export const ALL_APPS = [
    // ── Reales / comprables ───────────────────────────────────────────
    {
        key: 'cocina',
        name: 'Cocina',
        description: 'Encargos, preventas y pantalla de producción para tu cocina.',
        priceClp: 5000, priceUsd: 5,
        scope: 'branch',
        status: 'available',
        moduleKeys: ['preorders', 'production'],
        icon: 'ChefHat',
    },
    {
        key: 'integracion',
        name: 'Integración tienda',
        description: 'Sincroniza productos, precios y stock con tu tienda WooCommerce.',
        priceClp: 10000, priceUsd: 10,
        scope: 'branch',
        status: 'available',
        moduleKeys: ['integrations'],
        icon: 'Plug',
    },
    {
        key: 'bascula',
        name: 'Báscula',
        description: 'Conecta una balanza para vender productos por kilo.',
        priceClp: 10000, priceUsd: 10,
        scope: 'branch',
        status: 'available',
        moduleKeys: ['scale'],
        icon: 'Scale',
    },
    {
        key: 'tienda_web',
        name: 'Tienda Web',
        description: 'Recibe pedidos web de tus clientes y sincroniza tu catálogo online.',
        priceClp: 15000, priceUsd: 15,
        scope: 'branch',
        status: 'available',
        moduleKeys: ['web'],
        icon: 'Globe',
    },
    {
        key: 'etiquetas',
        name: 'Etiquetas',
        description: 'Imprime etiquetas con nombre, código de barra y precio para escanear en el POS.',
        priceClp: 5000, priceUsd: 5,
        scope: 'branch',
        status: 'available',
        moduleKeys: ['labels'],
        icon: 'Tags',
    },

    {
        key: 'delivery',
        name: 'Delivery',
        description: 'Reparto a domicilio: repartidores, envíos, rastreo en vivo y liquidación.',
        priceClp: 10000, priceUsd: 10,
        scope: 'branch',
        status: 'available',
        moduleKeys: ['delivery'],
        icon: 'Bike',
    },

    // ── Próximamente · por sucursal ───────────────────────────────────
    { key: 'fidelizacion', name: 'Fidelización', description: 'Puntos y recompensas para tus clientes.', scope: 'branch', status: 'coming_soon', icon: 'Gift' },
    { key: 'whatsapp', name: 'WhatsApp', description: 'Notifica y vende por WhatsApp.', scope: 'branch', status: 'coming_soon', icon: 'MessageCircle' },
    { key: 'restaurante', name: 'Restaurante', description: 'Gestión de mesas y comandas para restaurantes.', scope: 'branch', status: 'coming_soon', icon: 'Utensils' },
    { key: 'barberia', name: 'Barbería', description: 'Agenda y citas para tu barbería o salón.', scope: 'branch', status: 'coming_soon', icon: 'Scissors' },
    { key: 'pantalla_pedidos', name: 'Pantalla de Pedidos', description: 'Pantalla para mostrar el estado de los pedidos.', scope: 'branch', status: 'coming_soon', icon: 'MonitorPlay' },

    // ── Próximamente · por empresa ────────────────────────────────────
    { key: 'rrhh', name: 'RRHH', description: 'Recursos humanos avanzado para toda la empresa.', scope: 'company', status: 'coming_soon', icon: 'UsersRound' },
    { key: 'contabilidad', name: 'Contabilidad', description: 'Contabilidad y libros para toda la empresa.', scope: 'company', status: 'coming_soon', icon: 'Calculator' },
    { key: 'api', name: 'API', description: 'Integra POSVECI con tus sistemas vía API.', scope: 'company', status: 'coming_soon', icon: 'Code' },
    { key: 'ia', name: 'IA', description: 'Asistente inteligente y predicciones para tu negocio.', scope: 'company', status: 'coming_soon', icon: 'Sparkles' },
    { key: 'bi', name: 'Business Intelligence', description: 'Tableros y análisis avanzado de tus datos.', scope: 'company', status: 'coming_soon', icon: 'BarChart3' },
];

export const getAppByKey = (key) => ALL_APPS.find(a => a.key === key);

// Precio de una App en la moneda indicada (null si es "Próximamente").
export const getAppPrice = (app, currency = 'CLP') =>
    app?.status === 'available' ? (currency === 'USD' ? app.priceUsd : app.priceClp) : null;
