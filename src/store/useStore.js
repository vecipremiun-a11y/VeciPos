import { create } from 'zustand';
import { getDeviceId } from '../utils/deviceId';
import { persist } from 'zustand/middleware';
import { getNowInCompanyTime, getCompanyDayStart, getCompanyDayEnd, getStartFromDateString, getEndFromDateString, formatInCompanyTime } from '../lib/dateHelpers';
import { localDb, pendingOpsApi, siiFoliosApi } from '../lib/db/localdb';
import { syncCatalogIncremental } from '../lib/db/sync';
import { buscarProductosLocal, productosPorCategoriaLocal, productoPorCodigoLocal } from '../lib/db/catalogoLocal';
import { guardarImagenes, imagenesGuardadas } from '../lib/db/imagenesLocal';
import { markActivity } from '../lib/smartPolling';
import { setTabUserId, getTabUserId, broadcastLogin, broadcastLogout } from '../lib/sessionGuard';
import { alExpirarSesion, esSesionExpirada, sesionExpirada, reiniciarAvisoSesion } from '../lib/sesion';
import { sinDobleEnvio } from '../lib/inFlight';
import { hayConexion, reportarResultadoRed, fetchConLimite, ponerOfflineManual } from '../lib/conectividad';
import { getModuleByKey } from '../constants/modules';
import { getPlanLevel } from '../config/mercadopago';
import bcrypt from 'bcryptjs';

// Llama al endpoint admin autenticado (server-side, exige sesión firmada de super_admin).
// Las mutaciones sensibles ya NO se ejecutan desde el navegador con el token de BD.
async function adminApiCall(action, payload = {}) {
    try {
        const r = await fetch('/api/admin/actions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ action, ...payload }),
        });
        const data = await r.json().catch(() => ({ success: false, error: 'Respuesta inválida del servidor' }));
        if (data && typeof data === 'object') data._status = r.status;
        if (esSesionExpirada(data)) sesionExpirada();
        return data;
    } catch (e) {
        return { success: false, error: 'Error de red: ' + e.message };
    }
}

// Llama al endpoint de datos del app (sesión de usuario + membresía a la empresa,
// validadas en el servidor). Ver api/data/actions.js
//
// Va envuelto en `sinDobleEnvio`: si un doble clic manda la misma operación de
// escritura dos veces, la segunda se suma a la primera en vez de duplicarla.
function userApiCall(action, payload = {}) {
    return sinDobleEnvio(action, payload, () => _userApiCall(action, payload));
}

// Tiempo máximo de espera de una llamada al servidor.
//
// Sin esto, con el WiFi del local encendido pero SIN internet, `fetch` no
// fallaba: se quedaba colgado. El cajero veía la venta "procesando" y el modo
// offline nunca se activaba, porque el camino que encola la venta recién corre
// cuando la llamada falla. Medido en Node contra una IP muerta: 10,7 s; en el
// navegador puede ser mucho más, y si la conexión TCP se abre y el servidor no
// responde, no termina nunca.
//
// 12 s es holgado: las funciones de Vercel cortan a los 10, así que una
// respuesta más lenta que eso ya está muerta de todos modos.
const API_TIMEOUT_MS = 12000;

/** ¿El POS se da por sin conexión ahora mismo? Mira el monitor real (latido a
 * /api/ping), no solo `navigator.onLine`, que con WiFi sin internet miente. */
const sinInternet = () => (typeof navigator !== 'undefined' && !navigator.onLine) || !hayConexion();

// Acciones que SÍ pueden salir a la red aunque el sistema se dé por offline.
//
// Son las que forman parte del camino de vuelta: si se cortaran, el POS no
// tendría cómo darse cuenta de que la conexión volvió.
const ACCIONES_QUE_SIEMPRE_INTENTAN = new Set(['saleCommit', 'saleAggregations']);

async function _userApiCall(action, payload = {}) {
    // ── Sin conexión, no se sale a la red: se contesta al instante ────
    //
    // Sin esto, cada pantalla que no sea el POS —reportes, compras, inventario—
    // disparaba su llamada igual y esperaba los 12 segundos del corte antes de
    // fallar. Con el modo offline prendido a propósito eso es absurdo: el cajero
    // ya SABE que no hay servidor, y encima cada pantalla se sentía "colgada".
    //
    // Las partes que funcionan sin conexión —vender, buscar productos, buscar
    // clientes, ver la cola— no pasan por acá: leen de Dexie. Las demás avisan
    // en el acto que necesitan internet, que es la verdad, en vez de hacer
    // esperar para decir lo mismo.
    if (sinInternet() && !ACCIONES_QUE_SIEMPRE_INTENTAN.has(action)) {
        return { success: false, error: 'Sin conexión', sinConexion: true, _status: 0 };
    }
    try {
        const r = await fetchConLimite('/api/data/actions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            // expectedUserId va al final: identifica a nombre de quién cree actuar ESTA
            // pestaña. El servidor lo compara con la cookie y corta si no coinciden.
            //
            // Se toma del estado del store, con sessionGuard como respaldo: depender
            // solo de sessionGuard hacía que las primeras llamadas tras recargar
            // salieran con null (la rehidratación aún no lo había fijado) y el candado
            // no se activaba nunca.
            body: JSON.stringify({
                action,
                ...payload,
                expectedUserId: useStore.getState().currentUser?.id ?? getTabUserId(),
            }),
        });
        const data = await r.json().catch(() => ({ success: false, error: 'Respuesta inválida del servidor' }));
        if (data && typeof data === 'object') data._status = r.status;
        // El servidor contestó: hay internet. Confirma el estado sin gastar un
        // latido aparte.
        reportarResultadoRed(true);
        // La sesión venció o la cookie no llegó. Antes esto se devolvía como un
        // error cualquiera y la app seguía como si nada, mostrando pantallas vacías.
        if (esSesionExpirada(data)) sesionExpirada();
        if (data?.error === 'SESSION_MISMATCH') {
            // La sesión del navegador ya es de otro usuario: esta pestaña se alinea.
            try { useStore.getState().flagSessionTakeover(data); } catch { /* noop */ }
        } else {
            // Llamada normal: la identidad de la pestaña coincide con la sesión, así
            // que el contador anti-bucle de adopción vuelve a cero. Se limpia AQUÍ y
            // no al arrancar: si lo hiciera main.jsx, cada recarga lo reiniciaría y
            // el tope nunca frenaría un ciclo adoptar→recargar→adoptar.
            try { sessionStorage.removeItem('pv_adopt_tries'); } catch { /* noop */ }
        }
        return data;
    } catch (e) {
        // _network: la petición ni llegó al servidor (offline / caída / se agotó el
        // tiempo) — addSale usa esto para encolar la venta en la cola failsafe en
        // vez de perderla.
        const seCorto = e?.name === 'AbortError' || e?.name === 'TimeoutError';
        // Se distingue "tardó demasiado" de "no hay red", porque no son lo mismo
        // y confundirlos tuvo consecuencias: el detalle de cierre de caja
        // tardaba 49 segundos por una consulta mal indexada, y el POS se
        // declaraba sin internet teniéndolo. Si fue por tiempo, decide el latido
        // (ver conectividad.js); si la petición ni salió, se corta de una.
        reportarResultadoRed(false, seCorto);
        return {
            success: false,
            error: seCorto ? 'Sin respuesta del servidor' : 'Error de red: ' + e.message,
            _network: true,
        };
    }
}

// Atajo para el catálogo de reportes server-side (Fase 1 · Paso 18+).
// Devuelve el array de filas de la query `queryIndex` del reporte `name`.
async function reportRows(companyId, name, params = {}, queryIndex = 0) {
    const r = await userApiCall('report', { companyId, name, params });
    if (!r?.success) throw new Error(r?.error || 'Error en reporte');
    return r.rows[queryIndex] || [];
}

let fetchInProgress = false;

// ¿El POS está sin internet AHORA?
//
// No alcanza con `navigator.onLine`: con el WiFi del local prendido y el
// internet caído contesta que sí hay conexión. Quien sabe de verdad es el
// monitor de conectividad, que late contra /api/ping (ver src/lib/conectividad.js).
//
// Las ventas ya preguntaban así —por eso seguían funcionando sin internet—;
// el catálogo no, y por eso el buscador quedaba esperando 12 segundos y volvía
// vacío con el catálogo entero guardado en IndexedDB.
// (la definición vive arriba, junto a _userApiCall, que también la usa)

// Turno de la última lectura de catálogo pedida.
//
// La pantalla se pinta primero con lo guardado y después con lo que contesta el
// servidor. Si el cajero siguió escribiendo mientras tanto, la respuesta vieja
// llega cuando ya no corresponde: se descarta en vez de pisar lo que se está
// buscando ahora.
let secuenciaCatalogo = 0;

// Espera una promesa hasta `ms`. Si se pasa, devuelve { llego: false } sin
// cancelarla: la respuesta tardía simplemente ya no se usa.
function conCorte(promesa, ms) {
    return Promise.race([
        promesa.then((valor) => ({ llego: true, valor })),
        new Promise((resolver) => setTimeout(() => resolver({ llego: false }), ms)),
    ]);
}

// Cuánto se le espera al servidor al escanear un código antes de resolver con lo
// guardado. Escanear tiene que ser instantáneo: si la red está pesada, el precio
// del último sync es mejor respuesta que una pantalla trabada.
const ESPERA_ESCANEO_MS = 1200;

const safeJsonStringify = (value) => JSON.stringify(value, (_key, currentValue) => {
    if (typeof currentValue === 'bigint') {
        const asNumber = Number(currentValue);
        return Number.isFinite(asNumber) ? asNumber : currentValue.toString();
    }
    return currentValue;
});

const normalizeSku = (value) => {
    if (value === undefined || value === null) {
        return '';
    }

    return String(value).trim().toUpperCase();
};

export const useStore = create(persist((set, get) => ({
    // Initial State
    products: [],
    // Por qué falló la última carga del inventario, si falló. Sin esto, un corte
    // por tiempo se ve igual que una empresa sin productos.
    inventoryError: null,
    // Delivery (App): repartidores y tablero de envíos
    couriers: [],
    deliveries: [],
    deliveryCounts: {},
    deliveryAssignMode: 'manual',
    productLots: [], // New state for lots
    categories: [],
    suppliers: [],
    users: [],
    rolePermissions: [], // 🔒 Permissions State (Initialized)
    companyModules: [], // 🏷️ Feature Flags per company
    companyApps: [], // 🧩 Complementos (Apps) contratados por la empresa/sucursal
    currentPlanLevel: null, // 🎚️ Nivel del plan activo (Free=0…Pro=3). null = aún sin cargar → sin restricción.
    purchases: [],
    sales: [],
    // Multi-cart system
    carts: [
        {
            id: 1,
            name: 'Ticket 1',
            items: [],
            client: null,
            tipoDte: 39,
            createdAt: Date.now()
        }
    ],
    activeCartId: 1,
    nextCartId: 2,

    // Payment Methods State
    paymentMethodsConfig: {
        cash_enabled: 1,
        card_enabled: 1,
        transfer_enabled: 1,
        credit_enabled: 1,
        mixed_enabled: 1
    },
    paymentTerminals: [],
    bankAccounts: [],
    taxRates: [], // 🆕 Tax Rates State

    // 👷 GESTIÓN LABORAL - Estado Inicial
    staffMembers: [],
    attendanceToday: [],
    pendingCorrections: [],
    workShifts: [],
    laborAbsences: [],
    personalConfig: null,
    salaryAdvances: [],
    payrollPeriods: [],
    payrollPayments: [],
    vacationRequests: [],
    vacationBalances: [],

    // Computed getters (derivados automáticamente, sin duplicación)
    get cart() {
        const { carts, activeCartId } = get();
        return carts.find(c => c.id === activeCartId)?.items || [];
    },

    get posSelectedClient() {
        const { carts, activeCartId } = get();
        return carts.find(c => c.id === activeCartId)?.client || null;
    },
    activeRegisters: [],
    cashRegister: null,
    currentUser: null,
    isLoading: false,
    error: null,
    _hasHydrated: false,
    setHasHydrated: (state) => set({ _hasHydrated: state }),
    darkMode: true, // Default to dark mode

    toggleDarkMode: () => set((state) => ({ darkMode: !state.darkMode })),

    inventoryAdjustmentMode: false, // Will be loaded from DB per company
    creditBlockMode: 'warn', // 'warn' or 'block' - loaded from DB per company

    toggleInventoryAdjustmentMode: async () => {
        const { activeCompanyId, inventoryAdjustmentMode } = get();
        const newValue = !inventoryAdjustmentMode;

        try {
            // Server-side (whitelist de columnas). Ver companyActions.companyFieldsUpdate
            const r = await userApiCall('companyFieldsUpdate', { companyId: activeCompanyId, fields: { inventory_adjustment_mode: newValue ? 1 : 0 } });
            if (!r?.success) return r || { success: false, error: 'Error' };
            set({ inventoryAdjustmentMode: newValue });
            return { success: true };
        } catch (e) {
            console.error('Error updating inventory adjustment mode:', e);
            return { success: false, error: e.message };
        }
    },

    // SaaS State & Logic
    activeCompanyId: 'default',
    availableCompanies: [], // List of companies the user can access
    currentCompanyTimezone: 'America/Santiago', // <-- Timezone support
    currentCurrency: 'CLP', // Moneda activa de la empresa
    // Default to default for migration, but logic should update this. 
    // Wait, I should probably load this from localStorage? 
    // For now 'default' is safe as we backfilled everything to 'default'.

    // Estado del sistema de soporte
    supportTickets: [],
    currentTicket: null,
    unreadSupportCount: 0,

    // Pestaña zombi: se inició sesión con otro usuario en otra pestaña del mismo
    // navegador, así que esta ya no puede operar (ver src/lib/sessionGuard.js).
    // Lo levanta el aviso entre pestañas o el rechazo SESSION_MISMATCH del servidor.
    sessionTakeover: null,

    // La sesión del servidor venció (401). Ver src/lib/sesion.js y el cartel en
    // src/components/SesionExpiradaModal.jsx
    sesionExpirada: false,

    marcarSesionExpirada: () => {
        if (get().sesionExpirada) return;
        console.warn('⚠️ La sesión expiró: el servidor ya no reconoce la cookie.');
        set({ sesionExpirada: true, isLoading: false });
    },

    flagSessionTakeover: (info = {}) => {
        if (get().sessionTakeover) return; // ya en marcha, no repetir
        console.warn('⚠️ La sesión del navegador cambió en otra pestaña:', info);
        set({
            sessionTakeover: {
                previousUserName: get().currentUser?.name || get().currentUser?.username || null,
                sessionUserId: info.sessionUserId ?? null,
                at: new Date().toISOString(),
            },
        });
        // No basta con bloquear: la pestaña debe SEGUIR a la sesión real. Si hay una
        // cuenta activa, se adopta; si se cerró sesión, se cierra aquí también.
        get().adoptServerSession();
    },

    /**
     * Alinea esta pestaña con la sesión que realmente tiene el navegador.
     *
     * La cookie es del navegador entero: si en otra pestaña entraron con otra cuenta,
     * esta se queda mostrando una cuenta que ya no existe. En vez de dejarla pegada,
     * se le pregunta al servidor de quién es la sesión y se adopta esa cuenta.
     * Si ya no hay sesión válida (cierre de sesión), se cierra aquí también.
     *
     * Se llama SIN expectedUserId a propósito: es justamente la llamada que resuelve
     * la discrepancia, así que no debe ser rechazada por el candado del servidor.
     */
    adoptServerSession: async () => {
        // Tope anti-bucle: adoptar termina en recarga, y si por lo que sea la pestaña
        // volviera a detectar discrepancia recargaría sin parar. Al tercer intento en
        // la misma pestaña se cierra sesión y se manda al login, que siempre resuelve.
        try {
            const tries = Number(sessionStorage.getItem('pv_adopt_tries') || 0) + 1;
            sessionStorage.setItem('pv_adopt_tries', String(tries));
            if (tries > 2) {
                console.warn('🚪 Demasiados intentos de adoptar la sesión — al login');
                sessionStorage.removeItem('pv_adopt_tries');
                get().logout();
                if (typeof window !== 'undefined') window.location.replace('/login');
                return { success: false };
            }
        } catch { /* sin sessionStorage: seguimos sin tope */ }

        try {
            const r = await fetch('/api/data/actions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ action: 'sessionUser' }),
            });
            const data = await r.json().catch(() => ({}));

            if (!data?.success || !data.user) {
                // Sin sesión válida: la cerraron en otra pestaña.
                console.warn('🚪 La sesión del navegador ya no es válida — cerrando esta pestaña');
                get().logout();
                if (typeof window !== 'undefined') window.location.replace('/login');
                return { success: false };
            }

            const { user, companies, activeCompanyId } = data;
            const activeCompany = companies.find(c => c.id === activeCompanyId) || companies[0];
            console.log('🔄 Esta pestaña adopta la sesión de:', user.name || user.username);

            fetchInProgress = false; // permitir que fetchInitialData vuelva a correr
            set({
                currentUser: user,
                availableCompanies: companies,
                activeCompanyId: activeCompany.id,
                currentCompanyTimezone: activeCompany.timezone || 'America/Santiago',
                currentCurrency: activeCompany.currency || 'CLP',
                currentUserCompanyRole: activeCompany.role,
                inventoryAdjustmentMode: activeCompany.inventory_adjustment_mode === 1,
                sessionTakeover: null,
                // Datos de la cuenta anterior: se vacían para no mezclarlos. El carrito
                // también, o el usuario nuevo heredaría el ticket a medio cobrar del
                // anterior. Se repite en el guardado manual de abajo para que ambas
                // escrituras coincidan, gane la que gane.
                cashRegister: null,
                registerStats: { balance: 0, sales: 0, movements_in: 0, movements_out: 0, initial: 0, transactions: [] },
                carts: [{ id: 1, name: 'Ticket 1', items: [], client: null, createdAt: Date.now() }],
                activeCartId: 1,
                nextCartId: 2,
                posSelectedClient: null,
            });
            setTabUserId(user.id);

            // Guardado MANUAL antes de recargar, igual que en login(): el guardado
            // automático del store no alcanza a escribir antes de que la recarga corte
            // la página, y la pestaña volvía a arrancar con la cuenta anterior —
            // detectaba la discrepancia otra vez y entraba en un ciclo de recargas.
            try {
                localStorage.setItem('pos-storage', JSON.stringify({
                    state: {
                        currentUser: user,
                        activeCompanyId: activeCompany.id,
                        availableCompanies: companies,
                        currentCompanyTimezone: activeCompany.timezone || 'America/Santiago',
                        currentCurrency: activeCompany.currency || 'CLP',
                        currentUserCompanyRole: activeCompany.role,
                        inventoryAdjustmentMode: activeCompany.inventory_adjustment_mode === 1,
                        darkMode: get().darkMode,
                        // Carrito vacío: los tickets eran de la cuenta anterior.
                        carts: [{ id: 1, name: 'Ticket 1', items: [], client: null, createdAt: Date.now() }],
                        activeCartId: 1,
                        nextCartId: 2,
                    },
                    version: 0,
                }));
            } catch (e) {
                console.warn('No se pudo guardar la sesión adoptada:', e);
            }

            // Recargar para arrancar limpio con la cuenta nueva (permisos, catálogo,
            // caja y carritos de la otra cuenta no deben sobrevivir).
            if (typeof window !== 'undefined') window.location.reload();
            return { success: true };
        } catch (e) {
            console.error('❌ No se pudo adoptar la sesión del navegador:', e);
            return { success: false };
        }
    },

    currentUserCompanyRole: null,

    validateCompanyAccess: (userId, companyId) => {
        const { availableCompanies, currentUser } = get();
        // 1. Basic User Check
        if (!currentUser || !userId) return false;

        // 2. Super Admin Bypass (Optional, but safer to stick to explicit membership for data consistency)
        // However, if super_admin is not "owner" but needs access, this might be needed.
        // But our createCompany makes them owner. So membership check is robust.

        // 3. Check Membership
        return availableCompanies.some(c => c.id === companyId);
    },


    // Clients State & Actions
    clients: [],
    // setPosSelectedClient is defined below in the multi-cart section (L3641+)

    addClient: async (client) => {
        try {
            // Server-side (sesión + membresía): la unicidad de RUT/email se valida
            // AHORA contra la BD completa (antes solo contra el estado cargado) y
            // el INSERT + audit corren en api/data/actions.js.
            const r = await userApiCall('clientCreate', { companyId: get().activeCompanyId, client });
            if (!r?.success) return r || { success: false, error: 'Error creando cliente' };
            const newClient = r.client;

            set((state) => ({ clients: [...state.clients, newClient].sort((a, b) => a.name.localeCompare(b.name)) }));
            return { success: true, client: newClient };
        } catch (e) {
            console.error("Add client error", e);
            return { success: false, error: e.message };
        }
    },

    updateClient: async (id, updatedClient) => {
        try {
            const { activeCompanyId, currentUser, validateCompanyAccess } = get();
            if (!validateCompanyAccess(currentUser?.id, activeCompanyId)) return { success: false, error: "Access Denied" };

            // Server-side (sesión + membresía): unicidad RUT/email contra la BD
            // (excluyendo este cliente) + UPDATE + audit en api/data/actions.js.
            const r = await userApiCall('clientUpdate', { companyId: activeCompanyId, id, client: updatedClient });
            if (!r?.success) return r || { success: false, error: 'Error actualizando cliente' };

            set((state) => ({
                clients: state.clients.map((c) => c.id === id ? { ...c, ...updatedClient } : c).sort((a, b) => a.name.localeCompare(b.name))
            }));
            return { success: true };
        } catch (e) {
            console.error("Update client error", e);
            return { success: false, error: e.message };
        }
    },

    deleteClient: async (id) => {
        try {
            const { activeCompanyId, currentUser, validateCompanyAccess } = get();
            if (!validateCompanyAccess(currentUser?.id, activeCompanyId)) return { success: false, error: "Access Denied" };

            // Server-side (sesión + membresía): DELETE + audit log
            const r = await userApiCall('clientDelete', { companyId: activeCompanyId, id });
            if (!r?.success) return r || { success: false, error: 'Error eliminando cliente' };

            set((state) => ({
                clients: state.clients.filter((c) => c.id !== id)
            }));
            return { success: true };
        } catch (e) {
            console.error("Delete client error", e);
            return { success: false, error: e.message };
        }
    },



    // Actions
    // Server-side (scope de sesión: empresas del usuario autenticado). userId se
    // ignora — el servidor usa el uid de la cookie firmada. Ver bootstrapActions.js
    fetchUserCompanies: async () => {
        try {
            const r = await userApiCall('userCompanies', {});
            const companies = r?.success ? (r.companies || []) : [];
            set({ availableCompanies: companies });
            return companies;
        } catch (e) {
            console.error("Fetch user companies error", e);
            return [];
        }
    },

    setActiveCompanyId: async (companyId) => {
        const { currentUser, availableCompanies, fetchInitialData, activeCompanyId: previousCompanyId } = get();

        // Validate
        const targetCompany = availableCompanies.find(c => c.id === companyId);
        if (!targetCompany) {
            console.error("Attempted to switch to invalid company", companyId);
            return { success: false, error: "Invalid Company" };
        }

        // OFFLINE: bloquear cambio de empresa porque no podemos descargar
        // el catálogo de la empresa nueva. Solo permitir si es la misma empresa.
        if (sinInternet() && companyId !== previousCompanyId) {
            console.warn("Cannot switch company while offline");
            return {
                success: false,
                error: 'Sin conexión a internet. Para cambiar de empresa necesitas conexión.'
            };
        }

        console.log("Switching to company:", companyId);

        // OPTIMIZACIÓN cambio de empresa: NO purgamos el catálogo local de la empresa
        // anterior. Cada empresa conserva su catálogo en IndexedDB (todo está indexado
        // por companyId, no hay mezcla), así al volver a ella no se re-descarga todo.
        // El sync de catálogo de abajo pasa a INCREMENTAL (solo trae lo que cambió).

        // CLEAR STATE IMMEDIATELY to prevent data bleeding
        set({
            isLoading: true,
            activeCompanyId: companyId,
            // Load inventory mode from target company
            inventoryAdjustmentMode: targetCompany.inventory_adjustment_mode === 1,
            creditBlockMode: targetCompany.credit_block_mode || 'warn',
            // Clear all data lists
            products: [],
            productLots: [],
            categories: [],
            suppliers: [],
            users: [],
            rolePermissions: [], // 🔒 Permissions State
            companyModules: [], // 🏷️ Clear feature flags
            companyApps: [], // 🧩 Clear apps
            clients: [],
            purchases: [],
            sales: [],
            // Clear Dashboard/POS specific state
            // Clear Dashboard/POS specific state
            cashRegister: null, // Critical: Reset cash register
            activeRegisters: [],
            posSelectedClient: null,
            // Reset Multi-Cart System
            carts: [
                {
                    id: 1,
                    name: 'Ticket 1',
                    items: [],
                    client: null,
                    createdAt: Date.now()
                }
            ],
            activeCartId: 1,
            nextCartId: 2
        });

        if (currentUser) {
            localStorage.setItem(`activeCompanyId:${currentUser.id}`, companyId);
        }

        // Reload data (incluye permisos y módulos en el batch)
        await fetchInitialData();

        // Sincronizar catálogo a IndexedDB local en background (no bloquear UI).
        // INCREMENTAL: la 1ª vez por empresa baja todo (fallback a full); los siguientes
        // cambios solo traen filas con updated_at más nuevo → cambio casi instantáneo.
        if (!sinInternet()) {
            syncCatalogIncremental(companyId).catch((e) =>
                console.warn('[sync] catálogo background falló:', e)
            );
        }

        // After data load, check if this user has an open register in the NEW company
        // We need to fetch this explicitly because fetchInitialData might not set cashRegister
        const { checkRegisterStatus } = get();
        if (currentUser) {
            await checkRegisterStatus(currentUser.id);
        }

        set({ isLoading: false });
        return { success: true };
    },

    fetchInitialData: async () => {
        if (fetchInProgress) {
            console.log('⚠️ fetchInitialData already in progress, skipping duplicate call');
            return;
        }
        fetchInProgress = true;
        console.time('⏱️ fetchInitialData');
        set({ isLoading: true, error: null });

        // ============================================
        // 📴 BOOTSTRAP OFFLINE
        // ============================================
        // Si no hay internet, leer el catálogo desde Dexie en lugar de Turso.
        // Esto permite que el POS funcione tras refrescar la pestaña sin red.
        //
        // Quién decide es el monitor de conectividad, no `navigator.onLine`: con el
        // WiFi del local prendido y el internet caído, `navigator.onLine` dice que sí
        // hay conexión y el arranque se iba a buscar el servidor que no contesta.
        if (sinInternet()) {
            try {
                const { activeCompanyId } = get();
                if (activeCompanyId) {
                    console.log('📴 Sin internet — cargando catálogo desde IndexedDB...');
                    const [products, productLots, clients, categories, taxRates] = await Promise.all([
                        localDb.products.where('companyId').equals(activeCompanyId).toArray(),
                        localDb.productLots.where('companyId').equals(activeCompanyId).toArray(),
                        localDb.clients.where('companyId').equals(activeCompanyId).toArray(),
                        localDb.categories.where('companyId').equals(activeCompanyId).toArray(),
                        localDb.taxRates.where('companyId').equals(activeCompanyId).toArray(),
                    ]);
                    const pendingCount = await pendingOpsApi.count(activeCompanyId, 'queued');
                    set({
                        products,
                        productLots,
                        clients,
                        // Mismo mapeo que el arranque con internet: sin esto las
                        // categorías marcadas como ocultas en el POS aparecían igual
                        // cuando la app arrancaba sin conexión.
                        categories: categories.map(c => ({ ...c, showInPos: c.show_in_pos !== 0 })),
                        taxRates,
                        pendingSalesCount: pendingCount,
                        isLoading: false,
                    });
                    console.log(`📴 Catálogo offline cargado: ${products.length} productos, ${clients.length} clientes`);
                } else {
                    set({ isLoading: false });
                }
            } catch (e) {
                console.error('❌ Error bootstrap offline:', e);
                set({ isLoading: false, error: 'No se pudo cargar catálogo offline' });
            } finally {
                fetchInProgress = false;
                console.timeEnd('⏱️ fetchInitialData');
            }
            return;
        }

        try {
            console.log('📊 fetchInitialData START');

            // El esquema lo provisiona el pipeline migrations/ (0000_base_schema.sql).
            // El navegador ya no crea/altera tablas ni gestiona schema_version (Paso 36).

            const { currentUser } = get();
            let { activeCompanyId, availableCompanies } = get();

            console.log('🔍 Initial state:', {
                user: currentUser?.username,
                activeCompanyId,
                companiesCount: availableCompanies?.length
            });

            // CRÍTICO: Si hay usuario pero NO hay empresas cargadas (recarga de página)
            if (currentUser && (!availableCompanies || availableCompanies.length === 0)) {
                console.log('🔄 Page reload detected - Loading user companies...');

                // Cargar empresas del usuario (server-side, scope de sesión)
                const ucRes = await userApiCall('userCompanies', {});
                availableCompanies = ucRes?.success ? (ucRes.companies || []) : [];

                if (availableCompanies.length === 0) {
                    throw new Error("Usuario sin empresas asignadas");
                }

                // Determinar activeCompanyId correcto
                // Prioridad 1: company_id del usuario (su empresa home)
                if (currentUser.company_id && availableCompanies.some(c => c.id === currentUser.company_id)) {
                    activeCompanyId = currentUser.company_id;
                    console.log('✅ Using user home company:', currentUser.company_id);
                }
                // Prioridad 2: Última empresa guardada en localStorage
                else {
                    const storedCompanyId = localStorage.getItem(`activeCompanyId:${currentUser.id}`);
                    if (storedCompanyId && availableCompanies.some(c => c.id === storedCompanyId)) {
                        activeCompanyId = storedCompanyId;
                        console.log('✅ Using stored company from localStorage:', storedCompanyId);
                    } else {
                        activeCompanyId = availableCompanies[0].id;
                        console.log('✅ Using first available company:', activeCompanyId);
                    }
                }

                const activeCompany = availableCompanies.find(c => c.id === activeCompanyId);

                // Actualizar estado
                set({
                    availableCompanies,
                    activeCompanyId,
                    currentCompanyTimezone: activeCompany.timezone || 'America/Santiago',
                    currentCurrency: activeCompany.currency || 'CLP',
                    currentUserCompanyRole: activeCompany.role,
                    inventoryAdjustmentMode: activeCompany.inventory_adjustment_mode === 1,
                    creditBlockMode: activeCompany.credit_block_mode || 'warn'
                });


                // Guardar en localStorage
                localStorage.setItem(`activeCompanyId:${currentUser.id}`, activeCompanyId);
            }

            console.log('🏢 Loading data for company:', activeCompanyId);

            // SINGLE BATCH FETCH server-side: 1 round-trip para toda la metadata
            // (product_lots, categorías, proveedores, usuarios SIN password, clientes,
            //  permisos, impuestos, módulos, medios de pago, datáfonos, cuentas, config).
            // ==========================================
            console.time('⏱️ BatchFetch');
            const boot = await userApiCall('bootstrap', { companyId: activeCompanyId });
            console.timeEnd('⏱️ BatchFetch');
            if (!boot?.success) throw new Error(boot?.error || 'Error cargando datos iniciales');

            console.log('👥 Loaded users:', boot.users.length);

            const payConfig = boot.paymentMethodsConfig;

            // Process company config
            if (boot.companyConfig) {
                const cfg = boot.companyConfig;
                const freshMode = cfg.inventory_adjustment_mode === 1;
                const freshCurrency = cfg.currency || 'CLP';
                const freshCreditBlockMode = cfg.credit_block_mode || 'warn';

                // Nivel de plan para el gating (Standard=1, Profesional=2).
                // Plan desconocido/legacy → 2 (Profesional) para no romper acceso existente.
                const lvl = getPlanLevel(cfg.plan);
                const planLevel = (lvl == null) ? 2 : lvl;

                set({ inventoryAdjustmentMode: freshMode, currentCurrency: freshCurrency, creditBlockMode: freshCreditBlockMode, currentPlanLevel: planLevel });
            }

            // Removed products mapping
            const productLots = boot.productLots;
            const categories = (boot.categories || []).map(c => ({
                ...c,
                showInPos: c.show_in_pos !== 0
            }));
            const suppliers = boot.suppliers;
            const users = boot.users;
            const clients = boot.clients;

            set({
                productLots, categories, suppliers, users, clients,
                rolePermissions: boot.rolePermissions,
                taxRates: boot.taxRates,
                companyModules: boot.companyModules,
                companyApps: boot.companyApps || [],
                paymentMethodsConfig: payConfig,
                paymentTerminals: boot.paymentTerminals,
                bankAccounts: boot.bankAccounts
            });

            console.timeEnd('⏱️ fetchInitialData');
            console.log(`✅ Initial Load: Metadata only.`);
            console.log('✅ fetchInitialData COMPLETE');
        } catch (error) {
            console.error("Failed to fetch data:", error);
            set({ error: error.message });
        } finally {
            fetchInProgress = false;
            set({ isLoading: false });
        }
    },

    // 🏷️ COMPANY MODULES — see definition in "COMPANY MODULE MANAGEMENT" section below

    // Búsqueda de productos: primero lo guardado, después el servidor.
    //
    // Antes preguntaba `navigator.onLine`, que con el WiFi del local prendido y el
    // internet caído contesta que sí. La búsqueda salía a la red, esperaba los 12 s
    // del tiempo límite y volvía vacía: el cajero veía "cargando" y ningún producto,
    // con el catálogo entero guardado en IndexedDB sin que nadie lo mirara.
    //
    // Ahora la lista se pinta con lo guardado —al instante, haya red o no— y la
    // respuesta del servidor, si llega, la reemplaza. Las dos salen con el mismo
    // orden, así que al llegar la red lo único que cambia son el stock y las fotos,
    // igual que ya pasaba con loadProductImages.
    searchProducts: async (term) => {
        const { activeCompanyId } = get();
        if (!term) return;

        const miTurno = ++secuenciaCatalogo;
        const vigente = () => secuenciaCatalogo === miTurno;

        // 1) Lo guardado, ya. Si no hay nada guardado NO se pinta vacío: se espera
        //    al servidor, para no mostrar "sin resultados" en un equipo recién
        //    instalado que todavía no alcanzó a sincronizar.
        let hayLocal = false;
        try {
            const locales = await buscarProductosLocal(activeCompanyId, term);
            if (!vigente()) return;
            if (locales.length > 0) {
                hayLocal = true;
                set({ products: locales });
            }
        } catch (e) {
            console.error('Búsqueda local falló', e);
        }

        if (sinInternet()) return;

        // 2) El servidor manda cuando contesta.
        try {
            const rows = await reportRows(activeCompanyId, 'productsSearch', { term, limit: 50 });
            if (!vigente()) return;
            const products = rows.map(p => ({
                ...p,
                price_ranges: p.price_ranges ? JSON.parse(p.price_ranges) : []
            }));
            set({ products });

            // Las fotos van aparte: la búsqueda ya no las trae (pesaban 40 veces
            // más que el resto junto). Se piden en una sola consulta y aparecen
            // sobre la grilla ya dibujada, igual que en categoryProducts.
            const imgIds = products.filter(p => p.has_image).map(p => p.id);
            if (imgIds.length) get().loadProductImages(imgIds);
        } catch (e) {
            console.error("Search failed", e);
            // El servidor no contestó: se queda lo guardado. Si tampoco había nada
            // guardado, la lista queda vacía —que es la verdad— y el aviso de "sin
            // conexión" ya está en pantalla.
            if (!hayLocal && vigente()) set({ products: [] });
        }
    },

    // Producto por código escaneado.
    //
    // Con internet manda el servidor, porque el precio puede haber cambiado hace un
    // minuto. Pero no se le espera para siempre: si tarda más de ESPERA_ESCANEO_MS y
    // el producto está guardado, se sigue con el guardado. Escanear no puede quedar
    // trabado esperando una red pesada.
    getProductByBarcode: async (barcode) => {
        const { activeCompanyId } = get();

        // Lo guardado se pide siempre: sirve de respuesta y de red de seguridad.
        const guardado = productoPorCodigoLocal(activeCompanyId, barcode).catch((e) => {
            console.error('Barcode lookup offline failed', e);
            return null;
        });

        if (sinInternet()) return await guardado;

        try {
            const r = await conCorte(
                reportRows(activeCompanyId, 'productByBarcode', { barcode }),
                ESPERA_ESCANEO_MS
            );
            if (!r.llego) return await guardado;
            const p = r.valor[0];
            if (!p) return null;
            return {
                ...p,
                price_ranges: p.price_ranges ? JSON.parse(p.price_ranges) : []
            };
        } catch (e) {
            console.error("Barcode lookup failed", e);
            return await guardado;
        }
    },

    searchProductsForDropdown: async (term) => {
        const { activeCompanyId } = get();
        if (!term) return [];

        // Sin internet, lo guardado es lo único que hay.
        // Sin fotos: es un desplegable de texto, no la grilla del POS.
        if (sinInternet()) return buscarProductosLocal(activeCompanyId, term, 50, { conFotos: false }).catch(() => []);

        try {
            const rows = await reportRows(activeCompanyId, 'productsSearch', { term, limit: 50 });
            return rows.map(p => ({
                ...p,
                price_ranges: p.price_ranges ? JSON.parse(p.price_ranges) : []
            }));
        } catch (e) {
            console.error("Dropdown search failed", e);
            return buscarProductosLocal(activeCompanyId, term, 50, { conFotos: false }).catch(() => []);
        }
    },



    loadCategoryProducts: async (category, offset = 0, limit = 30) => {
        const { activeCompanyId } = get();
        const primeraPagina = offset === 0;

        const miTurno = ++secuenciaCatalogo;
        const vigente = () => secuenciaCatalogo === miTurno;

        // La primera página reemplaza la grilla; las siguientes (scroll infinito) suman.
        const pintar = (filas) => {
            if (primeraPagina) set({ products: filas });
            else set({ products: [...get().products, ...filas] });
        };

        // 1) Lo guardado.
        //    La primera página se pinta al instante, para que la grilla nunca
        //    aparezca vacía mientras se espera al servidor. Las páginas del scroll
        //    NO se pintan si hay internet: sumarían filas que el servidor va a
        //    volver a sumar (quedarían duplicadas).
        let hayMasLocal = false;
        let pinteLocal = false;
        let sinRed = sinInternet();
        try {
            const locales = await productosPorCategoriaLocal(activeCompanyId, category, offset, limit);
            if (!vigente()) return false;
            sinRed = sinInternet();
            hayMasLocal = locales.length === limit;
            if (locales.length > 0 && (primeraPagina || sinRed)) {
                pintar(locales);
                pinteLocal = true;
            }
        } catch (e) {
            console.error('Catálogo local falló', e);
        }

        if (sinRed) return hayMasLocal;

        // 2) El servidor manda cuando contesta.
        try {
            // Query server-side SIN 'image' (base64 pesado): la grilla aparece al
            // instante y las imágenes se cargan después en 1 consulta (loadProductImages).
            const rows = await reportRows(activeCompanyId, 'categoryProducts', { category, offset, limit });
            if (!vigente()) return hayMasLocal;

            const products = rows.map(p => ({
                ...p,
                price_ranges: p.price_ranges ? JSON.parse(p.price_ranges) : []
            }));

            pintar(products);

            // Cargar las imágenes en SEGUNDO PLANO (1 sola consulta) para esta página.
            // No se espera: la grilla ya se ve; las fotos aparecen al llegar.
            const imgIds = products.filter(p => p.has_image).map(p => p.id);
            if (imgIds.length) get().loadProductImages(imgIds);

            // Retornar si hay más productos
            return rows.length === limit; // true si hay más
        } catch (e) {
            console.error("❌ Load category products failed", e);
            // El servidor no contestó: vale lo que ya se pintó desde lo guardado.
            return pinteLocal ? hayMasLocal : false;
        }
    },

    // ─────────────────────────────────────────────────────────────
    // Códigos de proveedor de un producto.
    //
    // Viven en la misma tabla que los que el sistema aprende solo al corregir un
    // renglón de factura (product_supplier_aliases), así que lo que se escribe a
    // mano en la ficha también hace que las facturas de ese proveedor entren
    // solas. Ver api/_lib/purchaseActions.js
    // ─────────────────────────────────────────────────────────────

    fetchProductAliases: async (productId) => {
        const { activeCompanyId } = get();
        if (!productId || !activeCompanyId) return [];
        try {
            const r = await userApiCall('productAliasesList', { companyId: activeCompanyId, productId });
            return r?.success ? r.rows : [];
        } catch (e) {
            console.warn('No se pudieron leer los códigos de proveedor:', e);
            return [];
        }
    },

    addProductAlias: async (productId, codigo, supplierId = null) => {
        const { activeCompanyId } = get();
        return await userApiCall('productAliasAdd', { companyId: activeCompanyId, productId, codigo, supplierId });
    },

    deleteProductAlias: async (id) => {
        const { activeCompanyId } = get();
        return await userApiCall('productAliasDelete', { companyId: activeCompanyId, id });
    },

    /**
     * Aplica lo que se tocó en la ficha: primero los borrados, después los altas.
     *
     * En ese orden a propósito. Si alguien saca un código de este producto y lo
     * vuelve a agregar en la misma edición —o lo mueve de un producto a otro— al
     * revés se borraría el que se acaba de crear.
     *
     * Devuelve los avisos que valga la pena mostrar (por ejemplo, que un código
     * se movió desde otro producto).
     */
    aplicarCodigosProveedor: async (productId, cambios) => {
        if (!productId || !cambios) return [];
        const avisos = [];

        for (const id of cambios.borrar || []) {
            const r = await get().deleteProductAlias(id);
            if (!r?.success) avisos.push(`No se pudo borrar un código: ${r?.error || 'error'}`);
        }

        for (const c of cambios.agregar || []) {
            const r = await get().addProductAlias(productId, c.codigo, c.supplierId);
            if (!r?.success) avisos.push(`Código ${c.codigo}: ${r?.error || 'no se pudo guardar'}`);
            else if (r.movidoDe) avisos.push(`El código ${c.codigo} se movió desde "${r.movidoDe}"`);
        }

        return avisos;
    },

    // Foto de UN producto. Las búsquedas ya no traen la columna `image` (pesaba
    // 40 veces más que el resto de los datos juntos), así que las pantallas que
    // muestran la foto del producto ELEGIDO la piden acá al seleccionarlo.
    fetchProductImage: async (id) => {
        const { activeCompanyId } = get();
        if (!id || !activeCompanyId) return null;
        try {
            const rows = await reportRows(activeCompanyId, 'productImages', { ids: [id] });
            const foto = rows[0]?.image || null;
            if (foto) guardarImagenes(activeCompanyId, { [id]: foto }).catch(() => {});
            return foto;
        } catch (e) {
            console.warn('No se pudo cargar la foto del producto:', e);
            return null;
        }
    },

    // Carga las imágenes (base64) de productos por id y las mezcla en el estado.
    // Permite que la grilla del POS aparezca al instante y las fotos lleguen después.
    loadProductImages: async (ids) => {
        if (!ids || ids.length === 0) return;
        const { activeCompanyId } = get();
        try {
            const rows = await reportRows(activeCompanyId, 'productImages', { ids });
            const imgMap = {};
            for (const r of rows) imgMap[r.id] = r.image || null;
            set(state => ({
                products: state.products.map(p => (imgMap[p.id] !== undefined ? { ...p, image: imgMap[p.id] } : p)),
            }));

            // Las fotos que ya bajamos quedan guardadas para verlas sin internet.
            // No se espera: la grilla ya las está mostrando (ver imagenesLocal.js).
            guardarImagenes(activeCompanyId, imgMap).catch((e) =>
                console.warn('No se pudieron guardar las fotos para offline:', e)
            );
        } catch (e) {
            console.warn('No se pudieron cargar imágenes de productos:', e);
        }
    },

    // --- TAX RATES ACTIONS ---
    fetchTaxRates: async () => {
        const { activeCompanyId } = get();
        try {
            const rows = await reportRows(activeCompanyId, 'taxRates', {});
            set({ taxRates: rows });
        } catch (e) {
            console.error("Failed to fetch tax rates:", e);
        }
    },

    // Server-side (sesión + membresía). Ver api/_lib/taxActions.js
    addTaxRate: async (taxData) => {
        const { activeCompanyId } = get();
        const r = await userApiCall('taxRateCreate', { companyId: activeCompanyId, taxData });
        if (r?.success) await get().fetchTaxRates();
        return r || { success: false, error: 'Error' };
    },

    updateTaxRate: async (id, taxData) => {
        const { activeCompanyId } = get();
        const r = await userApiCall('taxRateUpdate', { companyId: activeCompanyId, id, taxData });
        if (r?.success) await get().fetchTaxRates();
        return r || { success: false, error: 'Error' };
    },

    deleteTaxRate: async (id) => {
        const { activeCompanyId } = get();
        const r = await userApiCall('taxRateDelete', { companyId: activeCompanyId, id });
        if (r?.success) await get().fetchTaxRates();
        return r || { success: false, error: 'Error' };
    },

    // Server-side (sesión + membresía). Las fechas se calculan aquí (zona horaria)
    // y la query corre en api/data/actions.js.
    fetchSales: async (fromDate, toDate, offset = 0, limit = 30, paymentMethodFilter = '', sellerIdFilter = '', saleIdFilter = '') => {
        try {
            const { activeCompanyId, currentCompanyTimezone, sales: currentSales } = get();

            let start = null, end = null;
            if (!saleIdFilter) {
                if (fromDate && toDate) {
                    start = getStartFromDateString(fromDate, currentCompanyTimezone).toISOString();
                    end = getEndFromDateString(toDate, currentCompanyTimezone).toISOString();
                } else {
                    const today = new Date();
                    start = getCompanyDayStart(today, currentCompanyTimezone).toISOString();
                    end = getCompanyDayEnd(today, currentCompanyTimezone).toISOString();
                }
            }

            const r = await userApiCall('fetchSales', {
                companyId: activeCompanyId, start, end, offset, limit,
                paymentMethodFilter, sellerIdFilter, saleIdFilter,
            });
            if (!r?.success) { console.error('❌ fetchSales:', r?.error); return 0; }

            const newSales = (r.data || []).map(sale => ({
                ...sale,
                items: null, // se cargan bajo demanda
                paymentDetails: null,
                paymentMethod: sale.payment_method,
                observation: sale.observation || '',
            }));

            if (offset === 0) set({ sales: newSales });
            else set({ sales: [...currentSales, ...newSales] });

            return newSales.length;
        } catch (e) {
            console.error("Fetch sales error", e);
            return 0;
        }
    },

    /**
     * Fetch full sales (with items) for reporting purposes.
     * - Filters by company_id and date range in company timezone.
     * - Excludes cancelled sales (status != 'cancelled').
     * - Returns the array (does NOT mutate the `sales` state used by the history UI).
     */
    fetchSalesForReport: async (startDate, endDate) => {
        try {
            const { activeCompanyId, currentCompanyTimezone } = get();
            if (!startDate || !endDate) return [];
            const start = getStartFromDateString(startDate, currentCompanyTimezone).toISOString();
            const end = getEndFromDateString(endDate, currentCompanyTimezone).toISOString();
            const rows = await reportRows(activeCompanyId, 'salesForReport', { start, end });
            return rows.map(s => ({
                ...s,
                paymentMethod: s.payment_method,
            }));
        } catch (e) {
            console.error("fetchSalesForReport error", e);
            return [];
        }
    },

    fetchClientSales: async (clientId) => {
        try {
            const { activeCompanyId } = get();

            // Query for ALL sales for this client (newest first)
            const rows = await reportRows(activeCompanyId, 'clientSales', { clientId });
            return rows.map(sale => ({
                ...sale,
                items: typeof sale.items === 'string' ? JSON.parse(sale.items) : sale.items,
                paymentMethod: sale.payment_method, // Mapping for UI
                clientId: sale.client_id, // Mapping for UI consistency
                observation: sale.observation || ''
            }));
        } catch (e) {
            console.error("Error fetching client sales:", e);
            return [];
        }
    },

    // Sync denormalized debt columns for a single client (DB + local state)
    _syncClientDebt: async (clientId) => {
        try {
            const { activeCompanyId } = get();
            if (!clientId || !activeCompanyId) return;

            // Server-side (sesión + membresía): recálculo y persistencia de la deuda
            // en api/data/actions.js. Misma firma — la llaman addSale y cancelación.
            const r = await userApiCall('clientSyncDebt', { companyId: activeCompanyId, clientId });
            if (!r?.success) { console.warn('_syncClientDebt server error:', r?.error); return; }

            set(state => ({
                clients: state.clients.map(c =>
                    c.id === clientId ? { ...c, total_debt: r.totalDebt, pending_sales_count: r.pendingCount, overdue_count: r.overdueCount } : c
                )
            }));
        } catch (e) {
            console.warn('_syncClientDebt error:', e);
        }
    },

    // Get credit status for a single client (debt, limit, overdue status)
    getClientCreditStatus: async (clientId) => {
        try {
            const { activeCompanyId } = get();
            const clientData = get().clients.find(c => c.id === clientId);
            if (!clientData) return null;

            // Server-side (agregación de deuda); el estado/límite salen del cliente.
            const r = await userApiCall('clientCreditStatus', { companyId: activeCompanyId, clientId });
            if (!r?.success) return null;
            const row = r.row;
            const totalDebt = parseFloat(row?.total_debt || 0);
            const creditLimit = parseFloat(clientData.credit_limit || 0);
            const overdueCount = parseInt(row?.overdue_count || 0);
            const dueSoonCount = parseInt(row?.due_soon_count || 0);
            let oldestOverdueDays = 0;
            if (row?.oldest_overdue_date) {
                oldestOverdueDays = Math.floor((Date.now() - new Date(row.oldest_overdue_date).getTime()) / (1000 * 60 * 60 * 24));
            }

            return {
                totalDebt,
                creditLimit,
                availableCredit: creditLimit > 0 ? Math.max(0, creditLimit - totalDebt) : null,
                creditUsagePercent: creditLimit > 0 ? Math.min(100, (totalDebt / creditLimit) * 100) : 0,
                hasOverdue: overdueCount > 0,
                overdueCount,
                dueSoonCount,
                oldestOverdueDays,
                pendingCount: parseInt(row?.pending_count || 0),
                clientStatus: clientData.client_status || 'active',
                creditEnabled: clientData.credit_enabled === 1 || clientData.credit_enabled === true
            };
        } catch (e) {
            console.error('Error getting client credit status:', e);
            return null;
        }
    },

    // Fetch debt summary for ALL clients (for list view indicators)
    fetchClientsDebtSummary: async () => {
        try {
            const { activeCompanyId } = get();
            const r = await userApiCall('clientsDebtSummary', { companyId: activeCompanyId });
            if (!r?.success) return {};

            const debtMap = {};
            for (const row of r.rows) {
                let oldestOverdueDays = 0;
                if (row.oldest_overdue_date) {
                    oldestOverdueDays = Math.floor((Date.now() - new Date(row.oldest_overdue_date).getTime()) / (1000 * 60 * 60 * 24));
                }
                debtMap[row.client_id] = {
                    totalDebt: parseFloat(row.total_debt || 0),
                    pendingCount: parseInt(row.pending_count || 0),
                    overdueCount: parseInt(row.overdue_count || 0),
                    dueSoonCount: parseInt(row.due_soon_count || 0),
                    oldestOverdueDays
                };
            }
            return debtMap;
        } catch (e) {
            console.error('Error fetching clients debt summary:', e);
            return {};
        }
    },

    // Update credit_block_mode for the current company
    setCreditBlockMode: async (mode) => {
        try {
            const { activeCompanyId } = get();
            const r = await userApiCall('companyFieldsUpdate', { companyId: activeCompanyId, fields: { credit_block_mode: mode } });
            if (!r?.success) return r || { success: false, error: 'Error' };
            set({ creditBlockMode: mode });
            return { success: true };
        } catch (e) {
            console.error('Error setting credit block mode:', e);
            return { success: false, error: e.message };
        }
    },

    fetchSaleDetails: async (saleId) => {
        try {
            const { activeCompanyId, sales } = get();

            // Server-side (sesión + membresía): venta completa + folio DTE
            const r = await userApiCall('saleDetails', { companyId: activeCompanyId, saleId });
            if (r?.success && r.sale) {
                const fullSale = r.sale;
                const dte_folio = r.dte_folio ?? null;
                const dte_tipo = r.dte_tipo ?? null;

                const processedSale = {
                    ...fullSale,
                    items: fullSale.items ? JSON.parse(fullSale.items) : [],
                    paymentMethod: fullSale.payment_method,
                    paymentDetails: fullSale.payment_details ? JSON.parse(fullSale.payment_details) : null,
                    observation: fullSale.observation || '',
                    clientId: fullSale.client_id,
                    clientName: fullSale.client_name,
                    dte_folio,
                    dte_tipo,
                };

                // Update the specific sale in the list with full details
                set({
                    sales: sales.map(s => s.id === saleId ? processedSale : s)
                });

                return processedSale;
            }
            return null;
        } catch (e) {
            console.error("Fetch sale details error", e);
            return null;
        }
    },

    fetchTodaySales: async () => {
        try {
            const { activeCompanyId, currentCompanyTimezone } = get();
            const today = new Date();
            const startOfDayUTC = getCompanyDayStart(today, currentCompanyTimezone);
            const endOfDayUTC = getCompanyDayEnd(today, currentCompanyTimezone);

            return await reportRows(activeCompanyId, 'todaySales', {
                start: startOfDayUTC.toISOString(),
                end: endOfDayUTC.toISOString(),
            });
        } catch (e) {
            console.error("Fetch today sales error", e);
            return [];
        }
    },

    // Optimized for Chart (Lightweight: No JSON blobs)
    fetchMonthlyStats: async (fromDate, toDate) => {
        try {
            const { activeCompanyId, currentCompanyTimezone } = get();
            const start = getCompanyDayStart(new Date(fromDate), currentCompanyTimezone);
            const end = getCompanyDayEnd(new Date(toDate), currentCompanyTimezone);

            // We return raw rows, aggregation happens in component
            return await reportRows(activeCompanyId, 'monthlyStats', {
                start: start.toISOString(),
                end: end.toISOString(),
            });
        } catch (e) {
            console.error("Fetch monthly stats error", e);
            return [];
        }
    },

    fetchInventoryProducts: async (offset = 0, searchTerm = '', category = 'Todos') => {
        const { activeCompanyId, products: currentProducts } = get();
        try {
            const rows = await reportRows(activeCompanyId, 'inventoryProducts', { searchTerm, category, offset, limit: 50 });
            set({ inventoryError: null });

            const newProducts = rows.map(p => ({
                ...p,
                price_ranges: p.price_ranges ? JSON.parse(p.price_ranges) : []
            }));

            // Las fotos que ya se vieron alguna vez están guardadas en el equipo, así
            // que se pegan ANTES de pintar. Sin esto la lista aparecía sin fotos y
            // cada una entraba después: se veía como si las imágenes se recargaran
            // solas cada vez que entrabas a Inventario. Leer local cuesta unos ms.
            try {
                const guardadas = await imagenesGuardadas(newProducts.map(p => p.id));
                if (Object.keys(guardadas).length) {
                    for (const p of newProducts) {
                        if (guardadas[p.id]) p.image = guardadas[p.id];
                    }
                }
            } catch { /* sin fotos guardadas se sigue igual */ }

            if (offset === 0) {
                set({ products: newProducts });
            } else {
                set({ products: [...currentProducts, ...newProducts] });
            }

            // Las fotos se piden aparte y sin esperarlas: la lista ya se ve, y
            // cada una aparece cuando llega. Es lo mismo que hace la grilla del
            // POS desde que se le sacó la foto a su consulta.
            // Solo se piden al servidor las que NO estaban guardadas.
            const conFoto = newProducts.filter(p => p.has_image && !p.image).map(p => p.id);
            if (conFoto.length) get().loadProductImages(conFoto);

            return newProducts.length;
        } catch (e) {
            // Este catch se tragaba el problema: devolvía 0 y la pantalla decía
            // "No se encontraron productos", que es exactamente lo que se ve
            // cuando la empresa no tiene ninguno. Un corte por tiempo y un
            // catálogo vacío no son lo mismo y no pueden mostrarse igual.
            console.error('Inventory fetch failed', e);
            const seCorto = e?.name === 'TimeoutError' || e?.name === 'AbortError'
                || /tiempo|espera|network|fetch/i.test(e?.message || '');
            set({ inventoryError: seCorto
                ? 'La lista tardó demasiado y se cortó. Probá de nuevo.'
                : ('No se pudo cargar el inventario: ' + (e?.message || 'error desconocido')) });
            return 0;
        }
    },


    // Optimized for Recent Activity List (Limit 20)
    fetchRecentSales: async () => {
        try {
            const { activeCompanyId } = get();
            const rows = await reportRows(activeCompanyId, 'recentSales', {});
            const sales = rows.map(sale => ({
                ...sale,
                items: JSON.parse(sale.items),
                paymentMethod: sale.payment_method,
                paymentDetails: sale.payment_details ? JSON.parse(sale.payment_details) : null,
                observation: sale.observation || '',
                clientId: sale.client_id,
                clientName: sale.client_name
            }));
            return sales;
        } catch (e) {
            console.error("Fetch recent sales error", e);
            return [];
        }
    },

    fetchLowStockProducts: async () => {
        const { activeCompanyId } = get();
        try {
            return await reportRows(activeCompanyId, 'lowStockProducts', {});
        } catch (e) {
            console.error("Fetch low stock failed", e);
            return [];
        }
    },

    // Server-side (sesión + membresía). Las queries corren en api/data/actions.js;
    // aquí solo calculamos fechas (zona horaria) y procesamos el resultado.
    fetchDashboardData: async () => {
        const { activeCompanyId, currentCompanyTimezone } = get();
        try {
            const today = new Date();
            const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            const todayStr = formatInCompanyTime(today, currentCompanyTimezone, 'yyyy-MM-dd');
            const monthStartStr = formatInCompanyTime(startOfMonth, currentCompanyTimezone, 'yyyy-MM-dd');

            const r = await userApiCall('dashboard', { companyId: activeCompanyId, todayStr, monthStartStr });
            if (!r?.success) { console.error('❌ dashboard:', r?.error); return null; }
            const d = r.data;

            const recentSales = (d.recentSales || []).map(sale => ({
                ...sale,
                items: JSON.parse(sale.items),
                paymentMethod: sale.payment_method,
                paymentDetails: sale.payment_details ? JSON.parse(sale.payment_details) : null,
                observation: sale.observation || '',
                clientId: sale.client_id,
                clientName: sale.client_name
            }));

            // Cajas activas: sigue en el cliente (estado local).
            get().fetchActiveRegisters();
            const activeRegisters = get().activeRegisters;

            return {
                activeRegisters,
                todayUtility: d.todayUtility || 0,
                todayStats: d.todayStats || { total_sales: 0, total_orders: 0 },
                monthlyStats: d.monthlyStats || [],
                recentSales,
                lowStockProducts: d.lowStockProducts || [],
                topProducts: d.topProducts || []
            };
        } catch (e) {
            console.error("❌ Fetch dashboard data failed", e);
            return null;
        }
    },

    fetchProductLotsReport: async (productLimit = 20, productOffset = 0, searchTerm = '') => {
        const { activeCompanyId } = get();
        try {
            const r = await userApiCall('lotsReport', { companyId: activeCompanyId, productLimit, productOffset, searchTerm });
            return r?.success ? { products: r.products, hasMore: r.hasMore } : { products: [], hasMore: false };
        } catch (e) {
            console.error("Error fetching product lots report:", e);
            return { products: [], hasMore: false };
        }
    },

    fetchProductLotsGlobalStats: async () => {
        const { activeCompanyId } = get();
        try {
            const today = new Date().toISOString().split('T')[0];
            const d = new Date();
            d.setDate(d.getDate() + 30);
            const nextMonth = d.toISOString().split('T')[0];
            const r = await userApiCall('lotsGlobalStats', { companyId: activeCompanyId, today, nextMonth });
            return r?.success ? r.stats : null;
        } catch (e) {
            console.error("Error fetching stats:", e);
            return null;
        }
    },

    // Write off an expired lot: moves it to inventory_losses and sets quantity to 0
    // reason: 'expired' (pérdida) | 'supplier_exchange' (cambio proveedor)
    writeOffExpiredLot: async (lot, notes = '', reason = 'expired') => {
        const { activeCompanyId } = get();
        try {
            const r = await userApiCall('lotWriteOff', { companyId: activeCompanyId, lot, notes, reason });
            if (!r?.success) return r || { success: false, error: 'Error' };
            const totalLoss = r.totalLoss;

            // Update local state
            set((state) => ({
                productLots: state.productLots.map(l =>
                    l.id === lot.id ? { ...l, quantity: 0 } : l
                ),
                products: state.products.map(p =>
                    p.id === lot.product_id
                        ? { ...p, stock: Math.round((p.stock - lot.quantity) * 1000) / 1000 }
                        : p
                )
            }));

            return { success: true, totalLoss };
        } catch (e) {
            console.error('Error writing off lot:', e);
            return { success: false, error: e.message };
        }
    },

    // Write off ALL expired lots for a product at once
    // reason: 'expired' | 'supplier_exchange'
    writeOffAllExpiredLots: async (lots, notes = '', reason = 'expired') => {
        const { activeCompanyId } = get();
        try {
            const r = await userApiCall('lotWriteOffAll', { companyId: activeCompanyId, lots, notes, reason });
            if (!r?.success) return r || { success: false, error: 'Error' };

            const productStockDeductions = new Map(r.deductions || []);
            const lotIds = new Set(lots.map(l => l.id));
            set((state) => ({
                productLots: state.productLots.map(l => lotIds.has(l.id) ? { ...l, quantity: 0 } : l),
                products: state.products.map(p => {
                    const deduction = productStockDeductions.get(p.id);
                    return deduction ? { ...p, stock: Math.round((p.stock - deduction) * 1000) / 1000 } : p;
                })
            }));

            return { success: true, totalLoss: r.totalLoss, lotsProcessed: r.lotsProcessed };
        } catch (e) {
            console.error('Error batch writing off lots:', e);
            return { success: false, error: e.message };
        }
    },

    fetchInventoryLosses: async (limit = 50, offset = 0) => {
        try {
            const r = await userApiCall('lossesList', { companyId: get().activeCompanyId, limit, offset });
            return r?.success ? r.rows : [];
        } catch (e) {
            console.error('Error fetching inventory losses:', e);
            return [];
        }
    },

    fetchInventoryLossesStats: async () => {
        try {
            const r = await userApiCall('lossesStats', { companyId: get().activeCompanyId });
            return r?.success ? r.stats : { total_records: 0, total_units: 0, total_value: 0, total_products: 0 };
        } catch (e) {
            console.error('Error fetching loss stats:', e);
            return { total_records: 0, total_units: 0, total_value: 0, total_products: 0 };
        }
    },

    // ============ INVENTORY CONTROL (STOCK TAKE) ============

    createInventoryControl: async ({ name, type, category }) => {
        try {
            return await userApiCall('controlCreate', { companyId: get().activeCompanyId, name, type, category });
        } catch (e) {
            console.error('Error creating inventory control:', e);
            return { success: false, error: e.message };
        }
    },

    fetchActiveInventoryControl: async () => {
        try {
            const r = await userApiCall('controlActive', { companyId: get().activeCompanyId });
            return r?.success ? r.control : null;
        } catch (e) {
            console.error('Error fetching active control:', e);
            return null;
        }
    },

    fetchControlProducts: async (controlId, { limit = 50, offset = 0, search = '', filter = 'all', type = 'complete', category = null } = {}) => {
        try {
            const r = await userApiCall('controlProducts', { companyId: get().activeCompanyId, controlId, limit, offset, search, filter, type, category });
            return r?.success ? r.rows : [];
        } catch (e) {
            console.error('Error fetching control products:', e);
            return [];
        }
    },

    saveControlItem: async (controlId, productId, countedStock) => {
        try {
            const r = await userApiCall('controlSaveItem', { companyId: get().activeCompanyId, controlId, productId, countedStock });
            if (r?.success && r.item && !r.item.reEdit) {
                setTimeout(() => { get().checkInventoryAlerts([productId]); }, 100);
            }
            return r || { success: false, error: 'Error' };
        } catch (e) {
            console.error('Error saving control item:', e);
            return { success: false, error: e.message };
        }
    },

    removeControlItem: async (controlId, productId) => {
        try {
            return await userApiCall('controlRemoveItem', { companyId: get().activeCompanyId, controlId, productId });
        } catch (e) {
            console.error('Error removing control item:', e);
            return { success: false, error: e.message };
        }
    },

    completeInventoryControl: async (controlId) => {
        try {
            return await userApiCall('controlComplete', { companyId: get().activeCompanyId, controlId });
        } catch (e) {
            console.error('Error completing control:', e);
            return { success: false, error: e.message };
        }
    },

    cancelInventoryControl: async (controlId) => {
        try {
            return await userApiCall('controlCancel', { companyId: get().activeCompanyId, controlId });
        } catch (e) {
            console.error('Error cancelling control:', e);
            return { success: false, error: e.message };
        }
    },

    fetchControlReport: async (controlId) => {
        try {
            const r = await userApiCall('controlReport', { companyId: get().activeCompanyId, controlId });
            return r?.success
                ? { items: r.items, stats: r.stats }
                : { items: [], stats: { totalCounted: 0, withDifference: 0, missing: 0, surplus: 0, matched: 0, missingValue: 0, surplusValue: 0, totalDifferenceValue: 0 } };
        } catch (e) {
            console.error('Error fetching control report:', e);
            return { items: [], stats: { totalCounted: 0, withDifference: 0, missing: 0, surplus: 0, matched: 0, missingValue: 0, surplusValue: 0, totalDifferenceValue: 0 } };
        }
    },

    fetchControlHistory: async (limit = 20, offset = 0) => {
        try {
            const r = await userApiCall('controlHistory', { companyId: get().activeCompanyId, limit, offset });
            return r?.success ? r.rows : [];
        } catch (e) {
            console.error('Error fetching control history:', e);
            return [];
        }
    },

    // ============ INVENTORY RECONCILIATION ============

    fetchReconciliationData: async ({ limit = 30, offset = 0, search = '' } = {}) => {
        try {
            const r = await userApiCall('reconciliationData', { companyId: get().activeCompanyId, limit, offset, search });
            return r?.success ? { products: r.products, hasMore: r.hasMore, stats: r.stats } : { products: [], hasMore: false, stats: null };
        } catch (e) {
            console.error('Error fetching reconciliation data:', e);
            return { products: [], hasMore: false, stats: null };
        }
    },

    fetchProductLotsForReconciliation: async (productId) => {
        try {
            const r = await userApiCall('reconciliationLots', { companyId: get().activeCompanyId, productId });
            return r?.success ? r.rows : [];
        } catch (e) {
            console.error('Error fetching lots for reconciliation:', e);
            return [];
        }
    },

    reconcileProduct: async (productId, action, notes = '') => {
        // action: 'adjust_stock' (stock = total lotes) | 'adjust_lots' (lotes = stock)
        try {
            const r = await userApiCall('reconcileProduct', { companyId: get().activeCompanyId, productId, mode: action, notes });
            if (!r?.success) return r || { success: false, error: 'Error' };
            // Estado local: adjust_stock devuelve newStock
            if (action === 'adjust_stock' && r.newStock !== undefined) {
                set(state => ({ products: state.products.map(p => p.id === productId ? { ...p, stock: r.newStock } : p) }));
            }
            return { success: true, message: r.message };
        } catch (e) {
            console.error('Error reconciling product:', e);
            return { success: false, error: e.message };
        }
    },

    reconcileAllProducts: async (products, action, notes = '') => {
        const { reconcileProduct } = get();
        let success = 0;
        let failed = 0;
        for (const product of products) {
            const result = await reconcileProduct(product.id, action, notes);
            if (result.success) success++;
            else failed++;
        }
        return { success: true, message: `${success} productos conciliados, ${failed} errores` };
    },

    fetchProductProfitReport: async (startDate, endDate) => {
        try {
            const r = await userApiCall('productProfitReport', { companyId: get().activeCompanyId, startDate, endDate });
            if (!r?.success) return [];
            return r.rows.map(row => ({
                day: row.day,
                productId: row.product_id,
                productName: row.product_name,
                barcode: row.product_sku || '-',
                quantity: row.total_quantity,
                totalSale: row.total_revenue,
                totalCost: row.total_cost,
                totalProfit: row.total_profit,
                unitCost: row.total_quantity > 0 ? row.total_cost / row.total_quantity : 0,
                unitPrice: row.total_quantity > 0 ? row.total_revenue / row.total_quantity : 0
            }));
        } catch (e) {
            console.error("Error fetching report:", e);
            return [];
        }
    },

    // Server-side (mantenimiento: backfill de product_daily_profit). Ver maintenanceActions.js
    recalculateProductProfits: async () => {
        const { activeCompanyId } = get();
        if (!activeCompanyId) return { success: false, error: 'Falta companyId' };
        return userApiCall('recalculateProductProfits', { companyId: activeCompanyId });
    },
    login: async (username, password) => {
        try {
            // 1. Autenticar + resolver empresas + ciclo de vida de suscripción en el
            //    servidor (/api/auth/login). El navegador ya NO consulta la BD: recibe
            //    user + companies + activeCompanyId (o el error/needsRenewal del bloqueo).
            //    preferredCompanyId = última empresa activa persistida (misma prioridad).
            let preferredCompanyId = null;
            try {
                const persisted = JSON.parse(localStorage.getItem('pos-storage') || '{}');
                preferredCompanyId = persisted?.state?.activeCompanyId || null;
            } catch { /* ignore */ }

            const authRes = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ username, password, preferredCompanyId }),
            });
            const authData = await authRes.json().catch(() => ({}));
            if (!authData?.success || !authData.user) {
                return { success: false, error: authData?.error || 'Usuario o contraseña incorrectos', needsRenewal: authData?.needsRenewal };
            }

            const user = authData.user;
            const userCompanies = authData.companies || [];
            const activeCompanyId = authData.activeCompanyId;
            const activeCompany = userCompanies.find(c => c.id === activeCompanyId);
            if (!activeCompany) {
                return { success: false, error: 'No se pudo determinar la empresa activa.' };
            }

            // 4. Establecer estado
            set({
                currentUser: user,
                availableCompanies: userCompanies,
                activeCompanyId: activeCompanyId,
                currentCompanyTimezone: activeCompany.timezone || 'America/Santiago',
                currentUserCompanyRole: activeCompany.role,
                inventoryAdjustmentMode: activeCompany.inventory_adjustment_mode === 1,
                sessionTakeover: null,
            });

            // 4b. Esta pestaña pasa a actuar a nombre de `user`, y se avisa a las demás
            // pestañas del navegador: la cookie de sesión que acabamos de recibir las
            // afecta a todas. Las que tenían otro usuario quedan bloqueadas.
            setTabUserId(user.id);
            broadcastLogin(user.id);

            // Sesión nueva: el aviso de vencimiento vuelve a quedar armado.
            reiniciarAvisoSesion();

            // 5. Guardar en localStorage
            localStorage.setItem(`activeCompanyId:${user.id}`, activeCompanyId);

            // 6. FORZAR GUARDADO MANUAL DE SESIÓN (CRÍTICO)
            try {
                const persistedState = {
                    state: {
                        currentUser: user,
                        activeCompanyId: activeCompanyId,
                        availableCompanies: userCompanies,
                        currentCompanyTimezone: activeCompany.timezone || 'America/Santiago',
                        currentUserCompanyRole: activeCompany.role,
                        inventoryAdjustmentMode: activeCompany.inventory_adjustment_mode === 1,
                        darkMode: get().darkMode,
                        carts: get().carts,
                        activeCartId: get().activeCartId,
                        nextCartId: get().nextCartId
                    },
                    version: 0
                };

                localStorage.setItem('pos-storage', JSON.stringify(persistedState));
                console.log('💾 Session manually saved to localStorage');

                // Verificar que se guardó
                const saved = localStorage.getItem('pos-storage');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    console.log('✅ Verified saved user:', parsed?.state?.currentUser?.username);
                }
            } catch (e) {
                console.error('❌ Failed to save session manually:', e);
            }

            console.log('🔐 Login successful:', {
                user: user.username,
                homeCompany: user.company_id,
                activeCompany: activeCompanyId,
                availableCompanies: userCompanies.length
            });

            return { success: true };

        } catch (e) {
            console.error("Login error", e);
            return { success: false, error: "Error al iniciar sesión" };
        }
    },

    logout: () => {
        const { currentUser } = get();

        console.log('🚪 Logging out user:', currentUser?.username);

        // Reset fetch lock so login can trigger fetchInitialData again
        fetchInProgress = false;

        // Esta pestaña deja de actuar a nombre de nadie, y se avisa a las demás:
        // la cookie es del navegador entero, así que el cierre las afecta a todas.
        setTabUserId(null);
        broadcastLogout();

        // El modo offline manual muere con la sesión.
        //
        // Lo prende una persona que está mirando su caja, para su turno. No es
        // una configuración del equipo: si Chelo lo prende y después entra
        // Isaura, Isaura hereda un modo que no eligió —y hasta lo veía en la
        // pantalla de ingreso, antes de saber quién es—. Al entrar de nuevo se
        // comprueba la conexión de cero y, si el problema sigue, se vuelve a
        // prender con un toque.
        //
        // Sigue aguantando una RECARGA de pantalla, que es para lo que se
        // guardaba en el equipo: recargar no es cerrar sesión.
        try { ponerOfflineManual(false); } catch { /* no bloquear el cierre por esto */ }

        // Limpiar localStorage
        if (currentUser) {
            localStorage.removeItem(`activeCompanyId:${currentUser.id}`);
        }

        // LIMPIAR TODO EL ESTADO
        set({
            currentUser: null,
            availableCompanies: [],
            activeCompanyId: null,
            currentCompanyTimezone: 'America/Santiago',
            currentUserCompanyRole: null,
            products: [],
            productLots: [],
            categories: [],
            suppliers: [],
            users: [],        // ← CRÍTICO
            // Ahora que los permisos se guardan en disco, hay que borrarlos al
            // salir: si no, el set del usuario anterior queda en el navegador.
            rolePermissions: [],
            clients: [],
            sales: [],
            purchases: [],
            // Reset Multi-Cart
            carts: [
                {
                    id: 1,
                    name: 'Ticket 1',
                    items: [],
                    client: null,
                    createdAt: Date.now()
                }
            ],
            activeCartId: 1,
            nextCartId: 2,
            cashRegister: null,
            posSelectedClient: null,
            isLoading: false,
            error: null,
            sessionTakeover: null,
            sesionExpirada: false
        });
        reiniciarAvisoSesion();

        console.log('✅ Logout complete - All state cleared');
    },

    addUser: async (user) => {
        try {
            // Validación de rol + hash bcrypt + inserción corren server-side
            const r = await userApiCall('userCreate', { companyId: get().activeCompanyId, user });
            if (!r?.success) return r || { success: false, error: 'Error creando usuario' };
            set((state) => ({ users: [...state.users, r.user] }));
            return { success: true, user: r.user };
        } catch (e) {
            console.error("Add user error", e);
            return { success: false, error: e.message };
        }
    },

    updateUser: async (id, updatedUser) => {
        try {
            const r = await userApiCall('userUpdate', { companyId: get().activeCompanyId, id, user: updatedUser });
            if (!r?.success) return r || { success: false, error: 'Error actualizando usuario' };
            set((state) => ({
                users: state.users.map(u => u.id === id ? { ...u, ...updatedUser } : u)
            }));
            return { success: true };
        } catch (e) {
            console.error("Update user error", e);
        }
    },

    deleteUser: async (id) => {
        try {
            const r = await userApiCall('userDelete', { companyId: get().activeCompanyId, id });
            // El servidor puede rechazar con `tieneRegistrosLaborales`: se devuelve
            // tal cual para que la pantalla ofrezca quitar el acceso en su lugar.
            if (!r?.success) return r || { success: false, error: 'Error eliminando usuario' };
            set((state) => ({ users: state.users.filter(u => u.id !== id) }));
            return { success: true };
        } catch (e) {
            console.error("Delete user error", e);
            return { success: false, error: e.message };
        }
    },

    // Le quita el acceso a la empresa sin borrar su historial laboral. Es lo que
    // corresponde cuando alguien deja de trabajar y tiene asistencia o sueldos
    // cargados: esos registros no se borran.
    revokeUserAccess: async (id) => {
        try {
            const r = await userApiCall('userRevokeAccess', { companyId: get().activeCompanyId, id });
            if (!r?.success) return r || { success: false, error: 'Error quitando el acceso' };
            set((state) => ({ users: state.users.filter(u => u.id !== id) }));
            return { success: true };
        } catch (e) {
            console.error('Revoke user access error', e);
            return { success: false, error: e.message };
        }
    },

    // ============================================
    // 🔐 ROLE PERMISSIONS ACTIONS
    // ============================================

    hasPermission: (permission) => {
        const { currentUser, currentUserCompanyRole, rolePermissions } = get();

        // 1. No user/role = No permission
        if (!currentUser) return false;

        // 2. Super Admin & Owner BYPASS
        // Check "super_admin" global role OR "owner"/"super_admin" company role
        if (currentUser.role === 'super_admin' || currentUser.role === 'owner') return true;
        if (currentUserCompanyRole === 'owner' || currentUserCompanyRole === 'super_admin') return true;

        // 3. Administrador BYPASS (Optional - User asked to default explicit, but 'Administrador' usually means full access)
        // The prompt says "Administrador -> TODO habilitado" via DB, but having a fallback code bypass is safer/faster.
        if (currentUser.role === 'Administrador' || currentUserCompanyRole === 'Administrador') return true;

        // 4. Check specific permission
        if (!rolePermissions) return false; // Safety check
        const perm = rolePermissions.find(p => p.role === currentUserCompanyRole && p.permission === permission);

        // If permission record exists, use its value. 
        // If it doesn't exist, DEFAULT TO FALSE (Deny by default rule)
        // UNLESS it's a legacy user without migrated permissions? No, we seed them.
        return perm ? Number(perm.granted) === 1 : false;
    },

    fetchRolePermissions: async () => {
        const { activeCompanyId } = get();
        if (!activeCompanyId) return;

        try {
            const r = await userApiCall('rolePermissionsList', { companyId: activeCompanyId });
            if (r?.success) set({ rolePermissions: r.rows });
        } catch (e) {
            console.error("Error fetching role permissions:", e);
        }
    },

    updateRolePermission: async (role, permission, granted) => {
        const { activeCompanyId, currentUser, validateCompanyAccess } = get();
        if (!validateCompanyAccess(currentUser?.id, activeCompanyId)) {
            console.error("updateRolePermission: Access Denied");
            return { success: false, error: "Access Denied" };
        }
        try {
            const r = await userApiCall('rolePermissionUpdate', { companyId: activeCompanyId, role, permission, granted });
            if (!r?.success) return r || { success: false, error: 'Error' };
            await get().fetchRolePermissions();
            return { success: true };
        } catch (e) {
            console.error("Error updating permission (Role: " + role + ", Perm: " + permission + "):", e);
            return { success: false, error: e.message };
        }
    },



    // ============================================
    // 🎭 ROLE MANAGEMENT ACTIONS (NEW)
    // ============================================

    fetchCompanyRoles: async () => {
        const { activeCompanyId } = get();
        if (!activeCompanyId) return [];

        try {
            const r = await userApiCall('companyRolesList', { companyId: activeCompanyId });
            return r?.success ? r.roles : [];
        } catch (e) {
            console.error("Error fetching company roles:", e);
            return [];
        }
    },

    createCustomRole: async (roleName, description, color, copyFromRole) => {
        const { activeCompanyId, startLoading, stopLoading } = get();
        if (!activeCompanyId) return { success: false, error: "No company" };
        startLoading();
        try {
            const r = await userApiCall('customRoleCreate', { companyId: activeCompanyId, roleName, description, color, copyFromRole });
            stopLoading();
            return r?.success ? { success: true } : (r || { success: false, error: 'Error' });
        } catch (e) {
            console.error("Create role error:", e);
            stopLoading();
            return { success: false, error: e.message };
        }
    },

    deleteCustomRole: async (roleName) => {
        const { activeCompanyId, startLoading, stopLoading } = get();
        startLoading();
        try {
            const r = await userApiCall('customRoleDelete', { companyId: activeCompanyId, roleName });
            stopLoading();
            return r?.success ? { success: true } : (r || { success: false, error: 'Error' });
        } catch (e) {
            console.error("Delete role error:", e);
            stopLoading();
            return { success: false, error: e.message };
        }
    },

    renameCustomRole: async (oldName, newName) => {
        const { activeCompanyId, startLoading, stopLoading } = get();
        startLoading();
        try {
            const r = await userApiCall('customRoleRename', { companyId: activeCompanyId, oldName, newName });
            stopLoading();
            return r?.success ? { success: true } : (r || { success: false, error: 'Error' });
        } catch (e) {
            console.error("Rename role error:", e);
            stopLoading();
            return { success: false, error: e.message };
        }
    },

    togglePermission: async (role, permission, newValue) => {
        // Alias to updateRolePermission but matches the request naming consistency
        return get().updateRolePermission(role, permission, newValue);
    },

    resetRoleDefaults: async (role) => {
        try {
            const r = await userApiCall('roleResetDefaults', { companyId: get().activeCompanyId, role });
            if (!r?.success) return r || { success: false, error: 'Error' };
            await get().fetchRolePermissions();
            return { success: true };
        } catch (e) {
            console.error("Reset role error:", e);
            return { success: false, error: e.message };
        }
    },

    setupDefaultPermissions: async () => {
        const { activeCompanyId } = get();
        if (!activeCompanyId) return;
        try {
            await userApiCall('permissionsSeedDefaults', { companyId: activeCompanyId });
        } catch (e) {
            console.error("Error seeding permissions:", e);
        }
    },

    addProduct: async (product) => {
        try {
            const { activeCompanyId, currentUser, validateCompanyAccess } = get();
            if (!validateCompanyAccess(currentUser?.id, activeCompanyId)) return { success: false, error: "Access Denied" };

            // Server-side (sesión + membresía): dup-check de SKU, INSERT y audit log
            // corren en api/data/actions.js. El navegador ya no toca la BD.
            const r = await userApiCall('productCreate', { companyId: activeCompanyId, product });
            if (!r?.success) return r || { success: false, error: 'Error creando producto' };

            // Safely handle price_ranges for the local state update
            let parsedPriceRanges = [];
            try {
                // Try to use the returned DB value if possible, otherwise fall back to input
                const dbValue = r.product.price_ranges;
                if (typeof dbValue === 'string') {
                    parsedPriceRanges = JSON.parse(dbValue);
                } else if (Array.isArray(dbValue)) {
                    parsedPriceRanges = dbValue;
                } else {
                    parsedPriceRanges = product.price_ranges || [];
                }
            } catch (e) {
                console.warn("Error parsing price_ranges from DB, using input", e);
                parsedPriceRanges = product.price_ranges || [];
            }

            const newProduct = { ...r.product, price_ranges: parsedPriceRanges };

            set((state) => ({ products: [...state.products, newProduct].sort((a, b) => a.name.localeCompare(b.name)), _preorderCache: { key: '', products: [], ts: 0 } }));

            // POS -> Tienda: sincronizar producto nuevo si tiene SKU
            try {
                if (newProduct.sku && String(newProduct.sku).trim()) {
                    const syncPayload = {
                        id: newProduct.id,
                        sku: newProduct.sku,
                        name: newProduct.name,
                        category: newProduct.category,
                        stock: newProduct.stock,
                        price: newProduct.price,
                        cost: Number(newProduct.cost || 0),
                        unit: newProduct.unit || 'Und',
                        tax_rate: Number(newProduct.tax_rate || 0),
                        is_offer: newProduct.is_offer ? true : false,
                        offer_price: newProduct.is_offer ? Number(newProduct.offer_price || 0) : 0,
                        image: newProduct.image || null,
                        price_ranges: parsedPriceRanges || [],
                        sale_mode: newProduct.sale_mode || 'sale_only',
                        preorder_unit: newProduct.preorder_unit || null,
                        preorder_billing_unit: newProduct.preorder_billing_unit || 'unit',
                        preorder_price_per_kg: Number(newProduct.preorder_price_per_kg || 0),
                        preorder_gram_per_unit: Number(newProduct.preorder_gram_per_unit || 0),
                        preorder_use_base_price: newProduct.preorder_use_base_price !== undefined
                            ? Boolean(newProduct.preorder_use_base_price)
                            : true,
                        units_per_box: Number(newProduct.units_per_box || 0),
                    };
                    fetch(`/api/integration/sync-product?company_id=${encodeURIComponent(activeCompanyId)}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ product: syncPayload })
                    }).then(async (res) => {
                        const data = await res.json().catch(() => null);
                        if (!res.ok || !data?.success) {
                            console.warn('Product sync post-create failed:', { id: newProduct.id, status: res.status, data });
                        } else {
                            console.log('✅ Product sync post-create success:', { id: newProduct.id, sku: newProduct.sku });
                        }
                    }).catch(syncError => {
                        console.warn('Product sync post-create error:', syncError);
                    });
                }
            } catch (syncError) {
                console.warn('Product sync post-create setup error:', syncError);
            }

            // Save alert config if provided
            if (product._alertConfig) {
                get().saveAlertSettings(newProduct.id, product._alertConfig).catch(e => console.warn('Alert settings save error:', e));
            }

            // Los códigos de proveedor necesitan el id, así que recién ahora se pueden
            // guardar. Se espera: si alguno choca con otro producto hay que avisarlo.
            let avisosCodigos = [];
            if (product._codigosProveedor) {
                avisosCodigos = await get().aplicarCodigosProveedor(newProduct.id, product._codigosProveedor);
            }

            return { success: true, product: newProduct, avisosCodigos };
        } catch (e) {
            console.error("Add product error", e);
            return { success: false, error: e.message };
        }
    },

    updateProduct: async (id, updatedProduct) => {
        try {
            const { activeCompanyId, currentUser, validateCompanyAccess } = get();
            if (!validateCompanyAccess(currentUser?.id, activeCompanyId)) return { success: false, error: "Access Denied" };

            // Server-side (sesión + membresía): UPDATE, registro de ajuste de stock
            // (comparado contra el stock real en BD) y audit log en api/data/actions.js.
            const r = await userApiCall('productUpdate', { companyId: activeCompanyId, id, product: updatedProduct });
            if (!r?.success) return r || { success: false, error: 'Error actualizando producto' };

            // POS -> Tienda: sincronizar producto completo al editar
            try {
                if (updatedProduct.sku && normalizeSku(updatedProduct.sku)) {
                    // Solo enviar imagen si realmente cambió (evitar enviar ~200KB base64 cada vez)
                    const oldProd = get().products.find(p => p.id === id);
                    const imageChanged = updatedProduct.image !== (oldProd?.image || null);
                    console.log('🔄 Sync:', { sku: updatedProduct.sku, imageChanged, hasImage: !!updatedProduct.image });

                    const syncPayload = {
                        id,
                        sku: updatedProduct.sku,
                        name: updatedProduct.name,
                        category: updatedProduct.category,
                        stock: updatedProduct.stock,
                        price: updatedProduct.price,
                        cost: Number(updatedProduct.cost || 0),
                        unit: updatedProduct.unit || 'Und',
                        tax_rate: Number(updatedProduct.tax_rate || 0),
                        is_offer: updatedProduct.is_offer ? true : false,
                        offer_price: updatedProduct.is_offer ? Number(updatedProduct.offer_price || 0) : 0,
                        price_ranges: updatedProduct.price_ranges || [],
                        // Modo del producto y configuración de encargo (consumido por la tienda
                        // para decidir visibilidad / tipo de producto). Si la tienda ignora estos
                        // campos no pasa nada, se mantiene compatibilidad atrás.
                        sale_mode: updatedProduct.sale_mode || 'sale_only',
                        preorder_unit: updatedProduct.preorder_unit || null,
                        preorder_billing_unit: updatedProduct.preorder_billing_unit || 'unit',
                        preorder_price_per_kg: Number(updatedProduct.preorder_price_per_kg || 0),
                        preorder_gram_per_unit: Number(updatedProduct.preorder_gram_per_unit || 0),
                        preorder_use_base_price: updatedProduct.preorder_use_base_price !== undefined
                            ? Boolean(updatedProduct.preorder_use_base_price)
                            : true,
                        units_per_box: Number(updatedProduct.units_per_box || 0),
                    };
                    if (imageChanged && updatedProduct.image) {
                        syncPayload.image = updatedProduct.image;
                    }

                    fetch(`/api/integration/sync-product?company_id=${encodeURIComponent(activeCompanyId)}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ product: syncPayload })
                    }).then(async (res) => {
                        const data = await res.json().catch(() => null);
                        if (!res.ok || !data?.success) {
                            console.warn('Product sync post-edit failed:', { id, status: res.status, data });
                        } else {
                            console.log('✅ Product sync post-edit success:', { id, sku: updatedProduct.sku });
                        }
                    }).catch(syncError => {
                        console.warn('Product sync post-edit error:', syncError);
                    });
                }
            } catch (syncError) {
                console.warn('Product sync post-edit setup error:', syncError);
            }

            set((state) => ({
                products: state.products.map((p) => p.id === id ? { ...p, ...updatedProduct } : p),
                _preorderCache: { key: '', products: [], ts: 0 }
            }));

            // Save alert config if provided
            if (updatedProduct._alertConfig) {
                get().saveAlertSettings(id, updatedProduct._alertConfig).catch(e => console.warn('Alert settings save error:', e));
            }

            let avisosCodigos = [];
            if (updatedProduct._codigosProveedor) {
                avisosCodigos = await get().aplicarCodigosProveedor(id, updatedProduct._codigosProveedor);
            }

            return { success: true, avisosCodigos };
        } catch (e) {
            console.error("Update product error", e);
            return { success: false, error: e.message };
        }
    },

    syncSaleStockToStore: async ({ saleId, soldAt, items }) => {
        try {
            const { activeCompanyId } = get();

            if (!activeCompanyId || !Array.isArray(items) || items.length === 0) {
                console.warn('Stock sync skipped: payload incompleto', {
                    activeCompanyId,
                    saleId,
                    itemsCount: Array.isArray(items) ? items.length : 0,
                });
                return { success: false, error: 'Payload de sincronización incompleto' };
            }

            const normalizedItems = items.map(item => {
                const unit = (item?.unit || 'un').toLowerCase();
                const rawStock = Number(item?.stock ?? 0);
                const clampedStock = rawStock < 0 ? 0 : rawStock;
                const stock = (unit === 'kg' || unit === 'lt')
                    ? Math.round(clampedStock * 1000) / 1000
                    : Math.round(clampedStock);

                return {
                    sku: normalizeSku(item?.sku),
                    product_id: item?.product_id !== undefined && item?.product_id !== null
                        ? Number(item.product_id)
                        : null,
                    stock,
                    unit,
                };
            }).filter(item => item.sku && Number.isFinite(item.stock));

            if (normalizedItems.length === 0) {
                console.warn('Stock sync skipped: SKU inválido después de normalizar', {
                    saleId,
                    itemsCount: Array.isArray(items) ? items.length : 0,
                });
                return { success: false, error: 'No hay SKUs válidos para sincronizar' };
            }

            const response = await fetch(`/api/integration/sync-stock?company_id=${encodeURIComponent(activeCompanyId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: safeJsonStringify({
                    sale_id: saleId,
                    sold_at: soldAt,
                    items: normalizedItems,
                }),
            });

            const data = await response.json().catch(() => ({}));

            if (!response.ok || !data.success) {
                console.warn('Stock sync to store failed:', data);
                return {
                    success: false,
                    status: response.status,
                    body: data,
                };
            }

            return {
                success: true,
                status: 200,
                body: data,
            };
        } catch (error) {
            console.warn('Stock sync to store network error:', error);
            return { success: false, error: error.message };
        }
    },

    syncAllStockWithStore: async (onProgress) => {
        try {
            const { activeCompanyId } = get();

            if (!activeCompanyId) {
                return { success: false, error: 'Empresa activa no disponible' };
            }

            // Lectura de productos server-side y PAGINADA (Paso 37): trae 25 por
            // página (con image base64) para no pasar el límite de la respuesta.
            // El envío a WooCommerce (loop de abajo) queda EXACTAMENTE igual.
            const PAGE = 25;
            let offset = 0;
            let total = 0;
            let processed = 0;
            let updated = 0;
            let failed = 0;
            const failures = [];
            let firstPage = true;

            while (true) {
                const pageRes = await userApiCall('productsForStoreSync', { companyId: activeCompanyId, offset, limit: PAGE });
                if (!pageRes?.success) {
                    return { success: false, error: pageRes?.error || 'Error leyendo productos', total, updated, failed, failures };
                }
                if (firstPage) { total = pageRes.total || 0; firstPage = false; }
                const rows = pageRes.products || [];
                if (rows.length === 0) break;

                const items = rows.map(product => {
                    const unit = (product.unit || 'un').toLowerCase();
                    const rawStock = Number(product.stock || 0);
                    const clampedStock = rawStock < 0 ? 0 : rawStock;
                    // Kg/Lt: 3 decimales, Und: entero
                    const stock = (unit === 'kg' || unit === 'lt')
                        ? Math.round(clampedStock * 1000) / 1000
                        : Math.round(clampedStock);

                    let priceRanges = [];
                    try {
                        if (product.price_ranges) {
                            priceRanges = typeof product.price_ranges === 'string'
                                ? JSON.parse(product.price_ranges)
                                : product.price_ranges;
                        }
                    } catch { /* ignore */ }

                    const item = {
                        id: Number(product.id),
                        name: product.name || '',
                        sku: String(product.sku).trim(),
                        price: Number(product.price || 0),
                        stock,
                        category: product.category || 'General',
                        cost: Number(product.cost || 0),
                        unit,
                        tax_rate: Number(product.tax_rate || 0),
                        is_offer: product.is_offer ? true : false,
                        offer_price: product.is_offer ? Number(product.offer_price || 0) : 0,
                        price_ranges: priceRanges,
                    };

                    if (product.image) item.image = product.image;

                    return item;
                }).filter(product => product.sku);

                for (const item of items) {
                    try {
                        const response = await fetch(`/api/integration/sync-product?company_id=${encodeURIComponent(activeCompanyId)}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: safeJsonStringify({ product: item }),
                        });

                        const data = await response.json().catch(() => ({}));

                        if (response.ok && data.success) {
                            updated += 1;
                        } else {
                            failed += 1;
                            failures.push({
                                sku: item.sku,
                                status: response.status,
                                body: JSON.stringify(data).slice(0, 500),
                            });
                        }
                    } catch (err) {
                        failed += 1;
                        failures.push({ sku: item.sku, status: 0, body: err.message });
                    }

                    processed += 1;

                    if (typeof onProgress === 'function') {
                        onProgress({
                            processed,
                            total,
                            message: `Sincronizando ${processed} de ${total} productos...`,
                        });
                    }
                }

                offset += rows.length;
                if (rows.length < PAGE) break;
            }

            if (total === 0) {
                return { success: true, total: 0, updated: 0, failed: 0, failures: [] };
            }

            return {
                success: failed === 0,
                total,
                updated,
                failed,
                failures,
            };
        } catch (error) {
            console.error('syncAllStockWithStore error:', error);
            return { success: false, error: error.message, total: 0, updated: 0, failed: 0, failures: [] };
        }
    },

    deleteProduct: async (id) => {
        try {
            const { activeCompanyId, currentUser, validateCompanyAccess } = get();
            if (!validateCompanyAccess(currentUser?.id, activeCompanyId)) return { success: false, error: "Access Denied" };

            // Obtener SKU antes de borrar para sincronizar con tienda
            const productToDelete = get().products.find(p => p.id === id);

            // Server-side (sesión + membresía): DELETE + audit log
            const r = await userApiCall('productDelete', { companyId: activeCompanyId, id });
            if (!r?.success) return r || { success: false, error: 'Error eliminando producto' };

            // POS -> Tienda: sincronizar eliminación (stock 0, sin escalas)
            try {
                const sku = productToDelete?.sku;
                if (sku && String(sku).trim()) {
                    fetch(`/api/integration/sync-product?company_id=${encodeURIComponent(activeCompanyId)}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            product: {
                                id,
                                sku,
                                stock: 0,
                                price_ranges: [],
                            }
                        })
                    }).then(async (res) => {
                        const data = await res.json().catch(() => null);
                        if (!res.ok || !data?.success) {
                            console.warn('Product sync post-delete failed:', { id, status: res.status, data });
                        } else {
                            console.log('✅ Product sync post-delete success:', { id, sku });
                        }
                    }).catch(syncError => {
                        console.warn('Product sync post-delete error:', syncError);
                    });
                }
            } catch (syncError) {
                console.warn('Product sync post-delete setup error:', syncError);
            }

            set((state) => ({
                products: state.products.filter((p) => p.id !== id),
                _preorderCache: { key: '', products: [], ts: 0 }
            }));
            return { success: true };
        } catch (e) {
            console.error("Delete product error", e);
            return { success: false, error: e.message };
        }
    },

    // Categories
    addCategory: async (category) => {
        try {
            const { activeCompanyId, currentUser, validateCompanyAccess } = get();
            if (!validateCompanyAccess(currentUser?.id, activeCompanyId)) return { success: false, error: "Access Denied" };

            // Server-side (sesión + membresía): INSERT + audit log
            const r = await userApiCall('categoryCreate', { companyId: activeCompanyId, category });
            if (!r?.success) return r || { success: false, error: 'Error creando categoría' };
            const newCategory = r.category;

            set((state) => ({ categories: [...state.categories, newCategory] }));
            return { success: true, category: newCategory };
        } catch (e) {
            console.error("Add category error", e);
            return { success: false, error: e.message };
        }
    },

    updateCategory: async (id, updatedCategory) => {
        try {
            const { activeCompanyId, currentUser, validateCompanyAccess } = get();
            if (!validateCompanyAccess(currentUser?.id, activeCompanyId)) return { success: false, error: "Access Denied" };

            // Server-side (sesión + membresía): UPDATE de categoría + renombrado en
            // productos (batch atómico) + audit log. Devuelve nameChanged/oldName.
            const r = await userApiCall('categoryUpdate', { companyId: activeCompanyId, id, category: updatedCategory });
            if (!r?.success) return r || { success: false, error: 'Error actualizando categoría' };

            // Update Local State
            set((state) => ({
                // parent_id explícito: el formulario manda `parentId` (camelCase) y la
                // lista guarda `parent_id` (como viene de la base). Sin esta línea el
                // árbol no se reacomodaba hasta recargar la página.
                categories: state.categories.map((c) => c.id === id
                    ? { ...c, ...updatedCategory, parent_id: updatedCategory.parentId ?? null }
                    : c),
                products: r.nameChanged
                    ? state.products.map(p => p.category === r.oldName ? { ...p, category: updatedCategory.name } : p)
                    : state.products
            }));
            return { success: true };
        } catch (e) {
            console.error("Update category error", e);
            return { success: false, error: e.message };
        }
    },

    deleteCategory: async (id) => {
        try {
            const { activeCompanyId, currentUser, validateCompanyAccess } = get();
            if (!validateCompanyAccess(currentUser?.id, activeCompanyId)) return { success: false, error: "Access Denied" };

            // Server-side (sesión + membresía): DELETE + audit log
            const r = await userApiCall('categoryDelete', { companyId: activeCompanyId, id });
            if (!r?.success) return r || { success: false, error: 'Error eliminando categoría' };

            set((state) => ({
                categories: state.categories.filter((c) => c.id !== id)
            }));
            return { success: true };
        } catch (e) {
            console.error("Delete category error", e);
            return { success: false, error: e.message };
        }
    },

    // Suppliers
    addSupplier: async (supplier) => {
        try {
            const { activeCompanyId, currentUser, validateCompanyAccess } = get();
            if (!validateCompanyAccess(currentUser?.id, activeCompanyId)) return { success: false, error: "Access Denied" };

            // Server-side (sesión + membresía): INSERT + audit
            const r = await userApiCall('supplierCreate', { companyId: activeCompanyId, supplier });
            if (!r?.success) return r || { success: false, error: 'Error creando proveedor' };
            const newSupplier = r.supplier;

            set((state) => ({ suppliers: [...state.suppliers, newSupplier] }));
            return { success: true, supplier: newSupplier };
        } catch (e) {
            console.error("Add supplier error", e);
            return { success: false, error: e.message };
        }
    },

    updateSupplier: async (id, updatedSupplier) => {
        try {
            const { activeCompanyId, currentUser, validateCompanyAccess } = get();
            if (!validateCompanyAccess(currentUser?.id, activeCompanyId)) return { success: false, error: "Access Denied" };

            // Server-side: UPDATE + renombrado en productos (batch atómico) + audit
            const r = await userApiCall('supplierUpdate', { companyId: activeCompanyId, id, supplier: updatedSupplier });
            if (!r?.success) return r || { success: false, error: 'Error actualizando proveedor' };

            set((state) => ({
                suppliers: state.suppliers.map((s) => s.id === id ? { ...s, ...updatedSupplier } : s),
                products: r.nameChanged
                    ? state.products.map(p => p.supplier === r.oldName ? { ...p, supplier: updatedSupplier.name } : p)
                    : state.products
            }));
            return { success: true };
        } catch (e) {
            console.error("Update supplier error", e);
            return { success: false, error: e.message };
        }
    },

    deleteSupplier: async (id) => {
        try {
            const { activeCompanyId, currentUser, validateCompanyAccess } = get();
            if (!validateCompanyAccess(currentUser?.id, activeCompanyId)) return { success: false, error: "Access Denied" };

            // Server-side: DELETE + audit
            const r = await userApiCall('supplierDelete', { companyId: activeCompanyId, id });
            if (!r?.success) return r || { success: false, error: 'Error eliminando proveedor' };

            set((state) => ({
                suppliers: state.suppliers.filter((s) => s.id !== id)
            }));
            return { success: true };
        } catch (e) {
            console.error("Delete supplier error", e);
            return { success: false, error: e.message };
        }
    },

    fetchSupplierOrders: async (filters = {}) => {
        try {
            const { activeCompanyId } = get();
            const r = await userApiCall('supplierOrdersFetch', { companyId: activeCompanyId, filters });
            if (!r?.success) return [];
            return (r.rows || []).map(row => ({
                ...row,
                items: row.items ? JSON.parse(row.items) : []
            }));
        } catch (e) {
            console.error("Fetch supplier orders error", e);
            return [];
        }
    },

    createSupplierOrder: async (orderData) => {
        try {
            const r = await userApiCall('supplierOrderCreate', { companyId: get().activeCompanyId, orderData });
            return r?.success ? { success: true, order: r.order } : (r || { success: false, error: 'Error' });
        } catch (e) {
            console.error("Create supplier order error", e);
            return { success: false, error: e.message };
        }
    },

    // Marca un pedido a proveedor como recibido/cancelado. Lo usa "Pasar a
    // Compra": guardada la compra, el pedido deja de figurar como pendiente.
    setSupplierOrderStatus: async (id, status) => {
        try {
            const { activeCompanyId } = get();
            const r = await userApiCall('supplierOrderSetStatus', { companyId: activeCompanyId, id, status });
            return r?.success ? { success: true } : (r || { success: false, error: 'Error' });
        } catch (e) {
            console.error('Set supplier order status error', e);
            return { success: false, error: e.message };
        }
    },

    // Agrega productos a un pedido ya creado. La fusión y el nuevo total los
    // calcula el servidor (ver purchaseActions.supplierOrderAddItems).
    addItemsToSupplierOrder: async (id, items) => {
        try {
            const { activeCompanyId } = get();
            const r = await userApiCall('supplierOrderAddItems', { companyId: activeCompanyId, id, items });
            return r?.success ? r : (r || { success: false, error: 'Error' });
        } catch (e) {
            console.error('Add items to supplier order error', e);
            return { success: false, error: e.message };
        }
    },

    deleteSupplierOrder: async (id) => {
        try {
            const { activeCompanyId, currentUser, validateCompanyAccess } = get();
            if (!validateCompanyAccess(currentUser?.id, activeCompanyId)) return { success: false, error: "Access Denied" };

            const r = await userApiCall('supplierOrderDelete', { companyId: activeCompanyId, id });
            return r?.success ? { success: true } : (r || { success: false, error: 'Error' });
        } catch (e) {
            console.error("Delete supplier order error", e);
            return { success: false, error: e.message };
        }
    },

    // =========================================
    // SUPER ADMIN ACTIONS
    // =========================================

    // Server-side (exige sesión super_admin). Ver api/admin/actions.js
    fetchAdminStats: async () => {
        const r = await adminApiCall('adminStats');
        return r?.success ? r.data : null;
    },

    // Server-side (exige sesión super_admin). Ver api/admin/actions.js
    fetchAllCompanies: async () => {
        const r = await adminApiCall('listAllCompanies');
        return r?.success ? (r.data || []) : [];
    },

    // Admin: clientes (dueños) con TODAS sus empresas e info relevante, agrupado por cliente.
    // Admin (server-side): clientes con sus empresas. Ver api/admin/actions.js
    adminFetchClients: async () => {
        const r = await adminApiCall('listClients');
        return r?.success ? (r.data || []) : [];
    },

    // Restablece la contraseña de un cliente. Sin newPassword el servidor
    // genera una temporal y la devuelve para enviársela al cliente.
    adminResetUserPassword: async (userId, newPassword = null) => {
        return adminApiCall('resetUserPassword', { userId, newPassword });
    },

    // Admin (server-side): dueños de cuenta (para asignar dueño al crear empresa).
    adminFetchUsers: async () => {
        const r = await adminApiCall('listOwners');
        return r?.success ? (r.data || []) : [];
    },

    // Crea una empresa ADICIONAL enlazada a la cuenta actual (multi-empresa).
    // Nace limpia y en 'pending_payment'; aparece en el selector recién al activarse el pago.
    // Hereda zona horaria, moneda y país de la empresa actual; nombre por defecto "Empresa N".
    // Server-side (exige ser owner de la empresa actual). Ver companyActions.js
    createLinkedCompany: async ({ name, plan = 'professional' }) => {
        const { activeCompanyId } = get();
        if (!activeCompanyId) return { success: false, error: 'Sesión no válida' };
        return userApiCall('companyLinkedCreate', { companyId: activeCompanyId, name, plan });
    },

    // Sucursales de la cuenta (raíz + enlazadas) con su plan/estado. Panel "Mi Plan".
    fetchMyBranches: async () => {
        const { activeCompanyId } = get();
        if (!activeCompanyId) return [];
        const r = await userApiCall('companyBranches', { companyId: activeCompanyId });
        return r?.success ? (r.branches || []) : [];
    },

    // Server-side (exige sesión super_admin). Ver api/admin/actions.js
    createCompany: async (companyData) => {
        const r = await adminApiCall('createCompany', { companyData });
        if (r?.success) { try { await get().fetchUserCompanies(get().currentUser?.id); } catch { /* noop */ } }
        return r;
    },

    // toggleCompanyStatus, checkSubscriptionStatus, fetchAllSubscriptions
    // are defined in the ADMIN & SAAS ACTIONS section below


    // Purchases
    /**
     * Avisa a la tienda de los productos que acaba de tocar una compra.
     *
     * Una compra cambia stock, costo, precio de venta y —al recalcularse— los
     * tramos por cantidad. Todo eso se guardaba solo en la base del POS: la
     * tienda seguía mostrando lo viejo, con productos "Sin stock" que en el local
     * estaban recién ingresados.
     *
     * Vender sí avisaba, crear y editar un producto también. La compra era la
     * única que no. Se usa la misma vía que ya usa editar (sync-product), que
     * manda el producto completo, no solo el stock.
     *
     * De a uno y en segundo plano: son las mismas peticiones que haría editar
     * cada producto a mano, y no hay nadie esperándolas. Si la tienda está caída
     * la compra ya quedó guardada igual — no se pierde nada, solo hay que volver
     * a guardar el producto cuando la tienda vuelva.
     */
    sincronizarCompraConTienda: async (productIds) => {
        const { activeCompanyId, products } = get();
        if (!activeCompanyId || !productIds?.length) return;

        const aEnviar = products.filter(
            (p) => productIds.includes(p.id) && p.sku && normalizeSku(p.sku)
        );
        if (!aEnviar.length) return;

        let enviados = 0;
        for (const p of aEnviar) {
            // Mismo payload que al editar un producto (ver updateProduct). La foto
            // NO va: la compra no la cambia y son ~200 KB por producto.
            const payload = {
                id: p.id,
                sku: p.sku,
                name: p.name,
                category: p.category,
                stock: p.stock,
                price: p.price,
                cost: Number(p.cost || 0),
                unit: p.unit || 'Und',
                tax_rate: Number(p.tax_rate || 0),
                is_offer: p.is_offer ? true : false,
                offer_price: p.is_offer ? Number(p.offer_price || 0) : 0,
                price_ranges: p.price_ranges || [],
                sale_mode: p.sale_mode || 'sale_only',
                preorder_unit: p.preorder_unit || null,
                preorder_billing_unit: p.preorder_billing_unit || 'unit',
                preorder_price_per_kg: Number(p.preorder_price_per_kg || 0),
                preorder_gram_per_unit: Number(p.preorder_gram_per_unit || 0),
                preorder_use_base_price: p.preorder_use_base_price !== undefined
                    ? Boolean(p.preorder_use_base_price)
                    : true,
                units_per_box: Number(p.units_per_box || 0),
            };

            try {
                const res = await fetch(
                    `/api/integration/sync-product?company_id=${encodeURIComponent(activeCompanyId)}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ product: payload }),
                    }
                );
                const data = await res.json().catch(() => null);
                if (!res.ok || !data?.success) {
                    console.warn('Sync post-compra falló:', { sku: p.sku, status: res.status, data });
                } else {
                    enviados++;
                }
            } catch (e) {
                console.warn('Sync post-compra error:', { sku: p.sku, error: e?.message });
            }
        }

        if (enviados) console.log(`✅ Tienda actualizada: ${enviados} de ${aEnviar.length} producto(s) de la compra`);
        return { enviados, total: aEnviar.length };
    },

    addPurchase: async (purchase) => {
        try {
            const { currentUser, activeCompanyId, validateCompanyAccess } = get();

            // 0. Security Validation
            if (!validateCompanyAccess(currentUser ? currentUser.id : null, activeCompanyId)) {
                return { success: false, error: "Access Denied" };
            }

            // Server-side (Fase 1 · Paso 14): INSERT compra + stock/lotes + audit
            // + espejo purchase_items + resumen por proveedor, todo en el servidor.
            const r = await userApiCall('purchaseCreate', { companyId: activeCompanyId, purchase });
            if (!r?.success) return r || { success: false, error: 'Error registrando la compra' };
            const purchaseId = r.purchaseId;

            // Refetch lots or simulate (Optimistic). Usamos UUID o id+random para evitar
            // colisiones si addPurchase se invoca varias veces en el mismo tick.
            const tempBase = (typeof crypto !== 'undefined' && crypto.randomUUID)
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
            const newLots = purchase.items.map((item, idx) => ({
                id: `temp-${tempBase}-${item.id}-${idx}`, // Temp ID único
                product_id: item.id,
                batch_number: item.batchNumber || '',
                expiry_date: item.expiryDate || null,
                quantity: parseFloat(item.quantity),
                initial_quantity: parseFloat(item.quantity),
                cost: parseFloat(item.cost),
                supplier_name: purchase.supplierName,
                created_at: new Date().toISOString(),
                status: 'active',
                company_id: activeCompanyId,
                purchase_id: purchaseId
            }));

            // We need newPurchase object primarily for state update
            const newPurchase = {
                ...purchase,
                id: purchaseId, // Usamos el ID real devuelto por la BD
                status: 'completed',
                userId: currentUser ? currentUser.id : null,
                company_id: activeCompanyId
            };

            set((state) => ({
                purchases: [newPurchase, ...state.purchases],
                productLots: [...state.productLots, ...newLots],
                products: state.products.map(p => {
                    const purchasedItem = purchase.items.find(i => i.id === p.id);
                    if (purchasedItem) {
                        return {
                            ...p,
                            stock: Math.round((parseFloat(p.stock) + parseFloat(purchasedItem.quantity)) * 1000) / 1000,
                            cost: parseFloat(purchasedItem.cost),
                            price: parseFloat(purchasedItem.price),
                            sku: purchasedItem.sku,
                            tax_rate: parseFloat(purchasedItem.tax || 0),
                            supplier: purchase.supplierName // Update supplier
                        };
                    }
                    return p;
                })
            }));

            // (El resumen por proveedor ya lo actualizó purchaseCreate server-side)

            // POS → Tienda. Va DESPUÉS del set() a propósito: así se manda lo que
            // el POS ya está mostrando (stock sumado, costo y precio nuevos), y no
            // lo que venía en la factura antes de aplicarse.
            const idsComprados = purchase.items.map((i) => i.id).filter(Boolean);
            get().sincronizarCompraConTienda(idsComprados).catch((e) =>
                console.warn('No se pudo avisar a la tienda de la compra:', e)
            );

            // Check inventory alerts after purchase (non-blocking)
            setTimeout(() => {
                const productIds = purchase.items?.map(i => i.productId || i.product_id).filter(Boolean);
                get().checkInventoryAlerts(productIds);
            }, 100);

            return { success: true };
        } catch (e) {
            console.error("Add purchase error", e);
            return { success: false, error: e.message };
        }
    },

    fetchPurchases: async (offset = 0, limit = 50) => {
        try {
            const r = await userApiCall('purchasesFetch', { companyId: get().activeCompanyId, offset, limit });
            return r?.success ? (r.rows || []) : [];
        } catch (e) {
            console.error("Fetch purchases error", e);
            return [];
        }
    },

    fetchPurchaseDetails: async (id) => {
        try {
            const r = await userApiCall('purchaseDetails', { companyId: get().activeCompanyId, id });
            if (r?.success && r.purchase) {
                const purchase = r.purchase;
                return {
                    ...purchase,
                    items: typeof purchase.items === 'string' ? JSON.parse(purchase.items) : purchase.items
                };
            }
            return null;
        } catch (e) {
            console.error("Fetch purchase details error", e);
            return null;
        }
    },

    deletePurchase: async (id) => {
        try {
            const { activeCompanyId, currentUser, validateCompanyAccess } = get();
            if (!validateCompanyAccess(currentUser?.id, activeCompanyId)) return { success: false, error: "Access Denied" };

            const r = await userApiCall('purchaseDelete', { companyId: activeCompanyId, id });
            if (!r?.success) return r || { success: false, error: 'Error eliminando compra' };

            set((state) => ({
                purchases: state.purchases.filter(p => p.id !== id)
            }));
            return { success: true };
        } catch (e) {
            console.error("Delete purchase error", e);
            return { success: false, error: e.message };
        }
    },

    // ============================================
    // MULTI-CART SYSTEM
    // ============================================

    // Agregar nuevo carrito (máximo 3)
    addCart: () => {
        const { carts, nextCartId, activeCartId } = get();

        if (carts.length >= 3) {
            alert('Máximo 3 carritos simultáneos');
            return;
        }

        // Inherit tipoDte from current active cart (respects user's default)
        const activeCart = carts.find(c => c.id === activeCartId);
        const inheritedDte = activeCart ? activeCart.tipoDte : 0;

        const newCart = {
            id: nextCartId,
            name: `Ticket ${carts.length + 1}`,
            items: [],
            client: null,
            tipoDte: inheritedDte,
            createdAt: Date.now()
        };

        console.log('➕ Adding cart:', newCart.name);

        set({
            carts: [...carts, newCart],
            activeCartId: nextCartId,
            nextCartId: nextCartId + 1
        });
    },

    // Cambiar carrito activo (instantáneo)
    setActiveCart: (cartId) => {
        const { carts } = get();
        const cartExists = carts.find(c => c.id === cartId);

        if (!cartExists) {
            console.error('Cart not found:', cartId);
            return;
        }

        console.log('🔄 Switching to cart:', cartId);
        set({ activeCartId: cartId });

        // cart y posSelectedClient se actualizan automáticamente via getters
    },

    // Remover carrito (mínimo 1)
    removeCart: (cartId) => {
        const { carts, activeCartId } = get();

        if (carts.length === 1) {
            alert('Debe mantener al menos un carrito abierto');
            return;
        }

        const cartToRemove = carts.find(c => c.id === cartId);
        if (cartToRemove && cartToRemove.items.length > 0) {
            if (!confirm(`¿Cerrar ${cartToRemove.name}? Tiene ${cartToRemove.items.length} productos.`)) {
                return;
            }
        }

        console.log('❌ Removing cart:', cartId);

        // Filtrar el carrito eliminado y RENOMBRAR secuencialmente
        const newCarts = carts
            .filter(c => c.id !== cartId)
            .map((cart, index) => ({
                ...cart,
                name: `Ticket ${index + 1}`
            }));

        console.log('🔄 Carts renumbered:', newCarts.map(c => c.name).join(', '));

        // Si eliminamos el activo, cambiar al primero disponible
        const newActiveId = cartId === activeCartId
            ? newCarts[0].id
            : activeCartId;

        set({
            carts: newCarts,
            activeCartId: newActiveId
        });
    },

    // Renombrar carrito (opcional)
    renameCart: (cartId, newName) => {
        set(state => ({
            carts: state.carts.map(c =>
                c.id === cartId
                    ? { ...c, name: newName }
                    : c
            )
        }));
    },

    setPosSelectedClient: (client) => {
        set(state => ({
            carts: state.carts.map(c =>
                c.id === state.activeCartId
                    ? { ...c, client }
                    : c
            )
        }));
    },

    setCartTipoDte: (tipoDte) => {
        set(state => ({
            carts: state.carts.map(c =>
                c.id === state.activeCartId
                    ? { ...c, tipoDte }
                    : c
            )
        }));
    },

    // Cart (Local Only)
    _recalculateCartPrices: (cartItems) => {
        // 1. Calculate totals per group
        const groupTotals = {};
        cartItems.forEach(item => {
            if (item.scale_group_id) {
                groupTotals[item.scale_group_id] = (groupTotals[item.scale_group_id] || 0) + item.quantity;
            }
        });

        // Helper to calculate price for a single item context
        const calculateItemPrice = (product, quantityForScale) => {
            // Priority 1: Wholesale Ranges
            if (product.price_ranges && Array.isArray(product.price_ranges) && product.price_ranges.length > 0) {
                const match = product.price_ranges.find(r => {
                    const min = parseFloat(r.min) || 0;
                    const max = r.max ? parseFloat(r.max) : Infinity;
                    return quantityForScale >= min && quantityForScale <= max;
                });
                if (match) return parseFloat(match.price);
            }
            // Priority 2: Offer Price
            if (product.is_offer && product.offer_price > 0) {
                return parseFloat(product.offer_price);
            }
            // Priority 3: Base Price
            return parseFloat(product.original_price || product.price);
        };

        // 2. Update prices for all items
        return cartItems.map(item => {
            // If price was manually set, skip auto-calculation for this item
            if (item.isManualPrice) {
                return item;
            }

            let quantityForScale = item.quantity;

            if (item.scale_group_id && groupTotals[item.scale_group_id]) {
                quantityForScale = groupTotals[item.scale_group_id];
            }

            const newPrice = calculateItemPrice(item, quantityForScale);

            return {
                ...item,
                price: newPrice
            };
        });
    },

    addToCart: (product) => {
        const { carts, activeCartId, inventoryAdjustmentMode } = get();

        console.log('➕ addToCart called:', {
            product: product.name,
            activeCartId,
            inventoryMode: inventoryAdjustmentMode
        });

        // PASO 1: Encontrar el carrito activo
        const activeCart = carts.find(c => c.id === activeCartId);
        if (!activeCart) {
            console.error('❌ No active cart found');
            return;
        }

        // PASO 2: Verificar si el producto YA EXISTE en el carrito
        const existingItem = activeCart.items.find(i => String(i.id) === String(product.id));

        if (existingItem) {
            // PRODUCTO YA EXISTE → SUMAR CANTIDAD
            console.log('✅ Product exists, incrementing quantity');
            get().updateCartItem(existingItem.id, existingItem.quantity + 1);
            return;
        }

        // PASO 3: Producto NO existe → Validar stock (solo en modo normal)
        if (!inventoryAdjustmentMode) {
            // Calcular stock en TODOS los carritos
            const totalInAllCarts = carts.reduce((total, cart) => {
                const itemInCart = cart.items.find(i => i.id === product.id);
                return total + (itemInCart?.quantity || 0);
            }, 0);

            const availableStock = (product.stock || 0) - totalInAllCarts;

            if (availableStock <= 0) {
                alert(`Stock insuficiente para "${product.name}". Ya hay ${totalInAllCarts} unidades en carritos.`);
                return;
            }

            console.log('📦 Stock check:', {
                product: product.name,
                totalStock: product.stock,
                inCarts: totalInAllCarts,
                available: availableStock
            });
        }

        // PASO 4: Agregar producto NUEVO al carrito
        console.log('✅ Adding new product to cart');

        let newItemsContext = [];

        set(state => {
            const currentCart = state.carts.find(c => c.id === state.activeCartId);
            const rawNewItem = {
                id: product.id,
                name: product.name,
                price: product.price || 0,
                cost: product.cost || 0,
                quantity: 1,
                tax_rate: product.tax_rate || 0,
                image: product.image || null,
                sku: product.sku || '',
                stock: product.stock || 0,
                unit: product.unit || 'Und',
                category: product.category || '',
                discountPercent: 0,
                // Wholesale & Offer Support
                price_ranges: product.price_ranges || [],
                scale_group_id: product.scale_group_id || null,
                original_price: product.original_price || product.price,
                is_offer: product.is_offer,
                offer_price: product.offer_price,
                // Combo / Pack support
                is_combo: product.is_combo || false,
                combo_id: product.combo_id || null,
                combo_items: product.combo_items || null
            };

            const updatedItems = [...currentCart.items, rawNewItem];
            // Recalculate prices considering the new item (might trigger scale for group)
            newItemsContext = get()._recalculateCartPrices(updatedItems);

            return {
                carts: state.carts.map(c =>
                    c.id === state.activeCartId
                        ? {
                            ...c,
                            items: newItemsContext
                        }
                        : c
                )
            };
        });
    },


    updateCartItem: (productId, updates) => {
        const { carts, activeCartId } = get();

        // Handle quantity update with stock validation
        // Hybrid support: 'updates' can be object or quantity (if number)
        // User request implied simpler signature but we support object for compat

        let newQuantity;
        if (typeof updates === 'number') {
            newQuantity = updates;
        } else if (updates && typeof updates.quantity === 'number') {
            newQuantity = updates.quantity;
        }

        // Only validate if quantity is changing
        if (newQuantity !== undefined) {
            const product = carts.find(c => c.id === activeCartId)?.items.find(i => i.id === productId);
            if (!product) return; // Should not happen

            const totalInOtherCarts = carts.reduce((total, cart) => {
                if (cart.id === activeCartId) return total;
                const itemInCart = cart.items.find(i => i.id === productId);
                return total + (itemInCart?.quantity || 0);
            }, 0);

            const availableStock = (product.stock || 0) - totalInOtherCarts;

            // Si estamos en modo de ajuste de inventario, SALTAMOS la validación de stock
            const { inventoryAdjustmentMode } = get();

            if (!inventoryAdjustmentMode) {
                if (newQuantity > availableStock) {
                    alert(`Stock insuficiente. Solo hay ${availableStock} disponibles (${totalInOtherCarts} en otros carritos).`);
                    return;
                }
            }

            if (newQuantity <= 0 && !updates._skipRemoval) {
                get().removeFromCart(productId);
                return;
            }
        }

        set(state => {
            const currentCart = state.carts.find(c => c.id === state.activeCartId);
            const updatedItemsRaw = currentCart.items.map(item => {
                if (item.id === productId) {
                    // Apply updates
                    const isPriceUpdate = updates.price !== undefined;
                    const baseUpdate = typeof updates === 'object' ? updates : { quantity: updates };
                    return {
                        ...item,
                        ...baseUpdate,
                        isManualPrice: isPriceUpdate ? true : item.isManualPrice
                    };
                }
                return item;
            });

            // Recalculate prices for the whole cart
            const itemsWithPrices = get()._recalculateCartPrices(updatedItemsRaw);

            return {
                carts: state.carts.map(c =>
                    c.id === state.activeCartId
                        ? {
                            ...c,
                            items: itemsWithPrices
                        }
                        : c
                )
            };
        });
    },

    removeFromCart: (productId) => {
        set(state => {
            const currentCart = state.carts.find(c => c.id === state.activeCartId);
            const remainingItemsRaw = currentCart.items.filter(item => item.id !== productId);

            // Recalculate prices (e.g. if removing an item affects scale group total)
            const itemsWithPrices = get()._recalculateCartPrices(remainingItemsRaw);

            return {
                carts: state.carts.map(c =>
                    c.id === state.activeCartId
                        ? {
                            ...c,
                            items: itemsWithPrices
                        }
                        : c
                )
            };
        });
    },

    clearCart: () => {
        set(state => ({
            carts: state.carts.map(c =>
                c.id === state.activeCartId
                    ? { ...c, items: [], client: null }
                    : c
            )
        }));
    },



    addSale: async (sale) => {
        // ── Identificador propio de esta venta ───────────────────────
        //
        // Se pone UNA vez y viaja con la venta a todos lados: al servidor, a la
        // cola de reintento y a Dexie. Es lo que le permite al servidor
        // reconocer un reintento y devolver la venta que ya registró en vez de
        // cobrarla de nuevo.
        //
        // La condición `if (!sale.clientSaleId)` es la parte que importa: al
        // reintentar desde la cola llega la MISMA venta, que ya trae su
        // identificador, y hay que respetarlo. Generar uno nuevo acá sería
        // volver al problema original — el 12-ago-2026 una venta se cobró tres
        // veces en trece segundos por no tener esto.
        if (!sale.clientSaleId) {
            sale.clientSaleId = (globalThis.crypto?.randomUUID?.())
                || `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        }

        // ============================================
        // FASE 0: DETECCIÓN OFFLINE
        // ============================================
        // Si NO hay conexión, derivar a la ruta offline (Dexie + cola).
        // Esto permite seguir vendiendo aunque la conexión esté caída por
        // horas. La sincronización al servidor se hace automáticamente al
        // volver online (App.jsx + OfflineSync page).
        // Excepción: si la venta viene desde la cola de sincronización
        // (`_fromOfflineQueue`), NO re-encolar — debe procesarse online sí o sí.
        // `hayConexion()` es el monitor real (latido a /api/ping). Antes solo se
        // miraba navigator.onLine, que con WiFi sin internet dice "sí hay" — y la
        // venta salía a buscar el servidor en vez de guardarse offline.
        const sinConexion = sinInternet();
        if (sinConexion && !sale?._fromOfflineQueue) {
            try {
                return await get()._addSaleOffline(sale);
            } catch (offlineErr) {
                console.error('❌ Error en venta offline:', offlineErr);
                return { success: false, error: offlineErr.message || 'Error venta offline' };
            }
        }

        // ============================================
        // FASE 1: VALIDACIÓN RÁPIDA (PRE-PROCESAMIENTO)
        // ============================================
        const startTime = performance.now();

        try {
            const { productLots, currentUser, activeCompanyId, validateCompanyAccess } = get();

            // Validación básica ultra-rápida
            if (!sale?.items?.length || !sale.total || sale.total < 0) {
                return { success: false, error: 'Datos de venta inválidos' };
            }

            if (!validateCompanyAccess(currentUser?.id, activeCompanyId)) {
                return { success: false, error: 'Acceso denegado' };
            }

            const saleTotal = parseFloat(sale.total);

            // ============================================
            // FASE CRÍTICA SERVER-SIDE (Fase 1 · Paso 10)
            // ============================================
            // Validación de crédito + lecturas frescas + pre-cálculo FEFO +
            // transacción con guardas de concurrencia corren en el servidor
            // (api/_lib/salesActions.js — lógica portada tal cual). El servidor
            // devuelve los pre-cálculos para el estado local y el sync tienda.
            // Cada ítem del carrito arrastra `image` (la foto del producto en
            // base64, puesta en addToCart para que el POS la muestre en pantalla).
            // El servidor NUNCA la lee — arma la venta con PRODUCT_COLS_SIN_IMAGEN
            // (ver salesActions.js) — así que viajaba de ida y vuelta para nada.
            //
            // Medido en producción el 3-sep-2026: 46% de los productos tienen
            // foto (86 KB en promedio, hasta 266 KB), y son justo los más
            // vendidos (pan, tomate, palta, limón...). Una venta de 2 ítems subía
            // ~140 KB; una de carro grande (29 ítems), más de 2 MB — por la subida
            // del local, que es el tramo más lento. Sacarla de acá no cambia nada
            // de lo que el servidor procesa: solo dejan de subirse bytes que
            // nadie iba a leer del otro lado.
            const itemsSinFoto = sale.items.map(({ image: _image, ...item }) => item);

            const r = await userApiCall('saleCommit', {
                companyId: activeCompanyId,
                sale: {
                    items: itemsSinFoto,
                    total: saleTotal,
                    summary: sale.summary,
                    paymentMethod: sale.paymentMethod,
                    paymentDetails: sale.paymentDetails,
                    client: sale.client ? { id: sale.client.id, name: sale.client.name } : null,
                    // Sin esta línea, la clave anti-duplicado nunca llegaba al
                    // servidor: acá NO se manda el objeto `sale` entero, se arma
                    // uno nuevo campo por campo. Se puso la clave en addSale, se
                    // guardó en la cola de reintento, se agregó la columna y el
                    // índice único... y el dato se descartaba justo en este punto.
                    // Diez horas de ventas duplicadas después del despliegue con
                    // client_sale_id en NULL en las 167 ventas.
                    clientSaleId: sale.clientSaleId,
                    // La hora del cobro. Es la MISMA trampa de arriba: acá el
                    // payload se arma campo por campo, así que lo que no se
                    // nombre no llega. Sin esto el servidor estampa la hora en
                    // que la venta subió, y una cola que se vacía de golpe deja
                    // toda la mañana registrada en el mismo minuto.
                    offlineCreatedAt: sale._offlineCreatedAt || null,
                    // "Esta venta YA se cobró, no la rechaces por stock."
                    //
                    // Solo la traen las ventas que salen de una cola: cuando se
                    // cobraron, el equipo no podía consultar el stock real, y a
                    // esta altura el cliente ya se llevó el producto. Rechazarla
                    // ahora no devuelve la mercadería, solo pierde el registro.
                    // Una venta online normal llega sin esto y respeta el stock
                    // como siempre.
                    ventaOffline: sale.ventaOffline === true,
                },
            });

            if (!r?.success) {
                // Rechazo de negocio (stock/crédito/validación, HTTP 200):
                // NO se encola — se muestra el error tal cual (igual que antes).
                if (r && r._status === 200) return r;

                // Error de red / 5xx / sesión caída: cola failsafe — la venta
                // NO se pierde, se reintenta al recuperar conexión (igual que antes).
                const queued = get()._queueFailedSale(sale, r?.error || 'Sin conexión');
                if (queued) {
                    return {
                        success: true,
                        saleId: queued.tempId,
                        queued: true,
                        queueReason: r?.error || 'Sin conexión',
                    };
                }
                return r || { success: false, error: 'Error procesando la venta' };
            }

            const { saleId, date: now, itemsToProcess, productsToUpdate, lotsToUpdate } = r;
            const comboItems = sale.items.filter(i => i.is_combo);
            const productsMap = new Map((r.productsInfo || []).map(p => [String(p.id), p]));
            if (r.creditWarning) sale._creditWarning = r.creditWarning;

            // FASE 9 · Marca actividad para que el smart-polling (sync,
            // dashboard, alertas) cambie a modo "activo" y refresque ya.
            markActivity();

            console.log(`⚡ Venta (server-side): ${(performance.now() - startTime).toFixed(2)}ms`);

            // La venta YA está confirmada en el servidor. Lo que sigue es
            // post-procesamiento local (estado, sync tienda, agregaciones, SII):
            // si algo falla aquí, NO se re-encola (evita duplicados) — ver catch.
            try {

                const stockSyncByProduct = new Map();
                itemsToProcess.forEach(item => {
                    // For combos, sync component products instead
                    if (item.is_combo) return;
                    const key = String(item.id);
                    const current = stockSyncByProduct.get(key) || {
                        product_id: item.id,
                        sku: null,
                        quantity_sold: 0,
                        stock: null,
                    };

                    current.quantity_sold += Number(item.quantity || 0);
                    stockSyncByProduct.set(key, current);
                });

                // Add combo component products to stock sync
                comboItems.forEach(combo => {
                    const saleQty = parseFloat(combo.quantity) || 1;
                    (combo.combo_items || []).forEach(comp => {
                        const key = String(comp.product_id);
                        const current = stockSyncByProduct.get(key) || {
                            product_id: comp.product_id,
                            sku: null,
                            quantity_sold: 0,
                            stock: null,
                        };
                        current.quantity_sold += (parseFloat(comp.quantity) || 1) * saleQty;
                        stockSyncByProduct.set(key, current);
                    });
                });

                const stockSyncItems = Array.from(stockSyncByProduct.values()).map(item => {
                    const product = productsMap.get(String(item.product_id));
                    const previousStock = Number(product?.stock || 0);
                    const unit = (product?.unit || 'un').toLowerCase();
                    const raw = previousStock - Number(item.quantity_sold || 0);
                    const nextStock = (unit === 'kg' || unit === 'lt')
                        ? Math.round(raw * 1000) / 1000
                        : Math.round(raw);
                    return {
                        product_id: item.product_id,
                        sku: product?.sku || null,
                        stock: nextStock,
                        unit: product?.unit || 'Und',
                    };
                }).filter(item => item.sku && Number.isFinite(item.stock));

                if (stockSyncItems.length === 0) {
                    console.warn('Stock sync skipped: no hay items válidos con sku/stock', {
                        saleId,
                        rawItems: itemsToProcess.map(i => ({ id: i.id, name: i.name })),
                    });
                } else {
                    get().syncSaleStockToStore({
                        saleId,
                        soldAt: now,
                        items: stockSyncItems,
                    }).then(syncResult => {
                        if (!syncResult?.success) {
                            console.warn('Stock sync post-sale failed:', {
                                saleId,
                                syncResult,
                                items: stockSyncItems,
                            });
                        } else {
                            console.log('✅ Stock sync post-sale success:', {
                                saleId,
                                status: syncResult.status,
                                items: stockSyncItems,
                            });
                        }
                    }).catch(syncError => {
                        console.warn('Stock sync post-sale error:', {
                            saleId,
                            error: syncError?.message || String(syncError),
                            items: stockSyncItems,
                        });
                    });
                }

                // ============================================
                // FASE 4: ACTUALIZAR ESTADO LOCAL (OPTIMISTIC)
                // ============================================

                // Actualizar lotes localmente
                const updatedLots = [...productLots];
                lotsToUpdate.forEach(lotUpdate => {
                    const lot = updatedLots.find(l => l.id === lotUpdate.id);
                    if (lot) lot.quantity -= lotUpdate.deduct;
                });

                // Actualizar estado
                set((state) => ({
                    sales: [{
                        id: saleId,
                        date: now,
                        status: 'completed',
                        clientId: sale.client?.id || null,
                        clientName: sale.client?.name || null,
                        client_id: sale.client?.id || null,
                        client_name: sale.client?.name || null,
                        company_id: activeCompanyId,
                        user_id: currentUser?.id,
                        user_name: currentUser?.name,
                        items: itemsToProcess,
                        payment_method: sale.paymentMethod,
                        payment_details: sale.paymentDetails,
                        total: saleTotal,
                        summary: sale.summary
                    }, ...state.sales],
                    productLots: updatedLots,
                    products: state.products.map(p => {
                        const update = productsToUpdate.find(u => u.id === p.id);
                        if (update) {
                            return {
                                ...p,
                                stock: Math.round((p.stock - update.quantityToDeduct) * 1000) / 1000,
                                pending_adjustment: update.markPending ? 1 : p.pending_adjustment
                            };
                        }
                        return p;
                    })
                }));

                // Actualizar stats de caja (no blocking)
                const postSaleCashRegister = get().cashRegister;
                if (postSaleCashRegister?.id) {
                    get().refreshRegisterStats(postSaleCashRegister.id);
                }

                // ============================================
                // FASE 5: AGREGACIONES EN BACKGROUND (NO BLOQUEA)
                // ============================================

                // Esto se ejecuta DESPUÉS de que la UI ya mostró éxito
                // No afecta la velocidad percibida por el usuario
                setTimeout(async () => {
                    try {
                        await get().updateAllAggregations(
                            {
                                ...sale,
                                total: saleTotal,
                                date: now,
                                items: itemsToProcess
                            },
                            currentUser?.id,
                            currentUser?.name,
                            activeCompanyId,
                            get().currentCompanyTimezone
                        );
                    } catch (aggErr) {
                        console.error('⚠️ Aggregation update failed:', aggErr);
                    }
                }, 0);

                const totalTime = (performance.now() - startTime).toFixed(2);
                console.log(`✅ Venta completada en ${totalTime}ms`);

                // Check inventory alerts (non-blocking)
                setTimeout(() => {
                    const productIds = itemsToProcess.map(i => i.id).filter(Boolean);
                    get().checkInventoryAlerts(productIds);
                }, 100);

                // Sync client debt columns if credit sale (await: el saldo del cliente DEBE
                // quedar coherente antes de retornar para que la siguiente venta lo lea bien)
                if (sale.paymentMethod === 'Crédito' && sale.client?.id) {
                    try {
                        await get()._syncClientDebt(sale.client.id);
                    } catch (debtErr) {
                        console.warn('⚠️ _syncClientDebt failed post-sale:', debtErr);
                    }
                }

                // ============================================
                // FASE 6: EMISIÓN DTE SII (NON-BLOCKING)
                // ============================================
                setTimeout(async () => {
                    try {
                        // Flags de sii_config devueltos por saleCommit (sin tocar la BD)
                        const siiCfg = r.sii;
                        if (siiCfg && Number(siiCfg.auto_emit) === 1 && Number(siiCfg.is_active) === 1) {
                            // Use tipoDte from sale data (set in POS), fallback to auto-detect
                            const tipoDte = sale.tipoDte != null ? sale.tipoDte : ((sale.client?.rut && sale.client.rut.trim()) ? 33 : 39);
                            // Skip SII emission for Nota de Venta (tipo 0)
                            if (tipoDte === 0) {
                                console.log('📝 Nota de Venta — sin emisión SII');
                                return;
                            }
                            const body = {
                                sale_id: saleId,
                                tipo_dte: tipoDte,
                            };
                            if ((tipoDte === 33 || tipoDte === 34) && sale.invoiceData) {
                                body.rut_receptor = sale.invoiceData.rut_receptor;
                                body.razon_social_receptor = sale.invoiceData.razon_social_receptor;
                                body.giro_receptor = sale.invoiceData.giro_receptor;
                                body.dir_receptor = sale.invoiceData.dir_receptor;
                                body.comuna_receptor = sale.invoiceData.comuna_receptor;
                                body.ciudad_receptor = sale.invoiceData.ciudad_receptor;
                                if (sale.invoiceData.formaPago) {
                                    body.forma_pago = sale.invoiceData.formaPago;
                                    if (sale.invoiceData.diasCredito) {
                                        body.dias_credito = sale.invoiceData.diasCredito;
                                    }
                                }
                            } else if (tipoDte === 33 && sale.client) {
                                body.rut_receptor = sale.client.rut;
                                body.razon_social_receptor = sale.client.name || sale.client.razon_social || 'Sin Razón Social';
                            }
                            const emitRes = await fetch('/api/sii/emit', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'x-company-id': activeCompanyId,
                                },
                                body: JSON.stringify(body),
                            });
                            const emitData = await emitRes.json();
                            if (emitRes.ok && emitData.success) {
                                console.log(`📄 DTE emitido: Tipo ${tipoDte}, Folio ${emitData.folio}, TrackID ${emitData.track_id}`);
                                // Auto-check status after 15s
                                if (emitData.track_id) {
                                    setTimeout(async () => {
                                        try {
                                            await fetch(`/api/sii/status?track_id=${encodeURIComponent(emitData.track_id)}`, {
                                                headers: { 'x-company-id': activeCompanyId },
                                            });
                                            console.log('✅ Auto-check estado DTE completado');
                                        } catch (e) {
                                            console.warn('⚠️ Auto-check estado DTE falló:', e.message);
                                        }
                                    }, 15000);
                                }
                            } else {
                                console.warn('⚠️ DTE emission failed:', emitData.error || emitData);
                            }
                        }
                    } catch (siiErr) {
                        console.warn('⚠️ SII auto-emit error (non-blocking):', siiErr.message);
                    }
                }, 200);

                return { success: true, saleId, creditWarning: sale._creditWarning || null };

            } catch (postError) {
                // La venta YA fue confirmada por el servidor (commit hecho).
                // Un error en el post-procesamiento local NO debe re-encolarla
                // (generaría una venta duplicada al reintentar). Solo se loggea.
                console.error('⚠️ Error post-commit (venta ya guardada):', postError);
                return { success: true, saleId, creditWarning: sale._creditWarning || null };
            }

        } catch (e) {
            console.error('❌ Sale error:', e);
            // También intentar encolar si fue un error antes de la transacción
            try {
                const queued = get()._queueFailedSale(sale, e?.message || String(e));
                if (queued) {
                    return {
                        success: true,
                        saleId: queued.tempId,
                        queued: true,
                        queueReason: e?.message || 'Sin conexión',
                    };
                }
            } catch { /* noop */ }
            return { success: false, error: e.message };
        }
    },

    // ============================================
    // 🛟 COLA DE VENTAS PENDIENTES (FAILSAFE OFFLINE)
    // ============================================
    // Si una venta falla en la transacción (caída de red, timeout de Turso),
    // la guardamos en localStorage y la reintentamos en background.
    // Así el cajero NUNCA pierde una venta aunque la conexión se corte.

    /**
     * Procesa una venta SIN tocar Turso, usando solo Dexie y el state local.
     * Se llama cuando navigator.onLine === false.
     * El stock se decrementa LOCALMENTE en Dexie + Zustand para evitar sobreventa
     * en la misma sesión offline. Al volver online y sincronizar, addSale ejecuta
     * la transacción real contra Turso (fuente de verdad).
     */
    _addSaleOffline: async (sale) => {
        const startTime = performance.now();
        // `inventoryAdjustmentMode` ya no se lee acá: sin conexión NO se rechaza
        // por stock, esté el modo prendido o apagado. Ver el comentario largo
        // más abajo, en la sección de stock.
        const { activeCompanyId, currentUser, products, productLots, clients } = get();

        // Validación básica
        if (!sale?.items?.length || !sale.total || sale.total < 0) {
            return { success: false, error: 'Datos de venta inválidos' };
        }
        if (!activeCompanyId || !currentUser) {
            return { success: false, error: 'Sesión inválida — vuelve a iniciar sesión' };
        }

        // Validación de cliente
        if (sale.client?.id) {
            const c = clients.find(x => x.id === sale.client.id);
            if (c?.client_status === 'blocked') {
                return { success: false, error: 'CLIENT_BLOCKED', message: 'Este cliente está bloqueado.' };
            }
            if (sale.paymentMethod === 'Crédito' && c) {
                if (c.client_status === 'credit_blocked' || c.credit_enabled === 0) {
                    return { success: false, error: 'CREDIT_NOT_ALLOWED', message: 'Este cliente no tiene habilitado el crédito.' };
                }
                // Nota: el límite real se valida al sincronizar (requiere SUM en servidor).
            }
        }

        // ── Sin conexión NO se rechaza una venta por stock ───────────
        //
        // El stock que hay acá es una FOTO VIEJA: la del último momento en que
        // el equipo pudo hablar con el servidor. Desde entonces pudo entrar
        // mercadería, pudo vender otra caja, pudo hacerse un ajuste — y no hay
        // forma de saberlo hasta que vuelva el internet.
        //
        // Negarle la venta al cliente por un número que quizá ya no es cierto
        // es lo peor de los dos mundos: se pierde la venta Y el número sigue
        // sin ser cierto. Así que se vende, el producto queda marcado para
        // recuento (`pending_adjustment`) al sincronizar, y el stock real se
        // resuelve contra el servidor, que es el único que sabe.
        //
        // El "Modo Ajuste de Inventario" sigue mandando cuando HAY conexión:
        // esto es solo para lo que se cobró a ciegas.
        const sinStockLocal = [];
        for (const item of sale.items) {
            if (item.is_combo) continue;
            const product = products.find(p => p.id === item.id);
            if (!product) continue; // se resuelve contra el servidor al subir
            const lots = productLots.filter(l => (l.product_id === item.id || l.productId === item.id));
            const lotStock = lots.reduce((sum, l) => sum + parseFloat(l.quantity || 0), 0);
            const totalStock = parseFloat(product.stock || 0) + lotStock;
            if (parseFloat(item.quantity || 0) > totalStock) {
                sinStockLocal.push(item.name || product.name);
            }
        }
        if (sinStockLocal.length > 0) {
            console.warn(`📴 Venta offline con stock local en cero: ${sinStockLocal.join(', ')}. ` +
                'Se registra igual; queda para recuento al sincronizar.');
        }

        // Encolar en Dexie
        const tempId = `offline_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

        // Si es boleta (tipo 39), intentar tomar un folio CAF pre-reservado
        // para que el DTE pueda emitirse al sincronizar. Si no hay folios
        // disponibles, la venta se encola igual y el DTE se emitirá usando
        // el siguiente folio del CAF al sincronizar (puede fallar si no hay).
        let offlineFolio = null;
        const tipoDteRequested = sale.tipoDte ?? null;
        if (tipoDteRequested === 39) {
            try {
                offlineFolio = await siiFoliosApi.takeOne(activeCompanyId, 39, tempId);
                if (!offlineFolio) {
                    console.warn('⚠️ No hay folios CAF offline disponibles para boleta. Venta encolada sin folio.');
                }
            } catch (e) {
                console.warn('⚠️ Error tomando folio offline:', e);
            }
        }

        try {
            await pendingOpsApi.add({
                tempId,
                companyId: activeCompanyId,
                userId: currentUser.id,
                type: 'sale',
                payload: {
                    items: sale.items,
                    total: sale.total,
                    summary: sale.summary,
                    paymentMethod: sale.paymentMethod,
                    paymentDetails: sale.paymentDetails,
                    client: sale.client || null,
                    tipoDte: sale.tipoDte ?? null,
                    invoiceData: sale.invoiceData || null,
                    // La clave anti-duplicado tiene que viajar DENTRO de la cola.
                    // Acá el payload se arma campo por campo, así que sin esta
                    // línea se perdía —el mismo descuido que ya había pasado en
                    // saleCommit—. Y sin ella la cola es el peor lugar donde
                    // faltar: reintenta hasta diez veces, y cada reintento
                    // llegaría al servidor con una clave nueva, o sea como una
                    // venta distinta.
                    clientSaleId: sale.clientSaleId,
                    // La marca que le dice al servidor "esta ya se cobró, no la
                    // rechaces por stock". Sin ella, una venta hecha sin
                    // conexión podría quedarse trabada para siempre en la cola
                    // por un stock que cambió mientras no había internet.
                    ventaOffline: true,
                    _offlineCreatedAt: new Date().toISOString(),
                    _offlineUserId: currentUser.id,
                    _offlineUserName: currentUser.name || currentUser.username,
                    _offlineFolio: offlineFolio?.folio ?? null,
                    _offlineFolioId: offlineFolio?.id ?? null,
                    _offlineFolioTipoDte: offlineFolio?.tipoDte ?? null,
                },
            });
        } catch (e) {
            console.error('❌ No se pudo encolar venta offline en Dexie:', e);
            // Si tomamos folio, liberarlo para no perderlo.
            if (offlineFolio?.id) {
                await siiFoliosApi.releaseFolio(offlineFolio.id).catch(() => {});
            }
            // Fallback: usar localStorage (mecanismo legacy) para no perder la venta.
            const fallback = get()._queueFailedSale(sale, `offline-dexie-fail: ${e.message}`);
            if (fallback) {
                return { success: true, saleId: fallback.tempId, queued: true, queueReason: 'offline' };
            }
            return { success: false, error: 'No se pudo guardar la venta offline.' };
        }

        // Decrementar stock LOCAL en Dexie (best-effort, no bloqueante).
        try {
            for (const item of sale.items) {
                if (item.is_combo) continue;
                const qty = parseFloat(item.quantity || 0);
                if (!qty) continue;
                const localProd = await localDb.products.get(item.id);
                if (localProd) {
                    const newStock = parseFloat(localProd.stock || 0) - qty;
                    await localDb.products.update(item.id, { stock: newStock });
                }
            }
        } catch (e) {
            console.warn('⚠️ Decremento de stock local falló (no bloquea venta):', e);
        }

        // Actualizar contador y stock en Zustand state
        try {
            const total = await pendingOpsApi.count(activeCompanyId, 'queued');
            set({ pendingSalesCount: total });
        } catch { /* noop */ }

        try {
            set(state => ({
                products: state.products.map(p => {
                    const item = sale.items.find(i => !i.is_combo && i.id === p.id);
                    if (!item) return p;
                    const qty = parseFloat(item.quantity || 0);
                    return { ...p, stock: parseFloat(p.stock || 0) - qty };
                })
            }));
        } catch { /* noop */ }

        const elapsed = (performance.now() - startTime).toFixed(0);
        console.log(`📴 Venta OFFLINE encolada en ${elapsed}ms — tempId=${tempId}`);

        return {
            success: true,
            saleId: tempId,
            queued: true,
            offline: true,
            queueReason: 'offline',
            offlineFolio: offlineFolio?.folio ?? null,
        };
    },

    _queueFailedSale: (sale, reason = 'unknown') => {
        try {
            if (typeof window === 'undefined' || !window.localStorage) return null;
            const { activeCompanyId, currentUser, currentCompanyTimezone } = get();
            const KEY = 'poskem_pending_sales_v1';
            const queue = JSON.parse(localStorage.getItem(KEY) || '[]');
            const tempId = `pending_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
            const entry = {
                tempId,
                companyId: activeCompanyId,
                userId: currentUser?.id || null,
                userName: currentUser?.name || null,
                timezone: currentCompanyTimezone || null,
                queuedAt: new Date().toISOString(),
                attempts: 0,
                lastError: reason,
                sale: {
                    items: sale.items,
                    total: sale.total,
                    summary: sale.summary,
                    paymentMethod: sale.paymentMethod,
                    paymentDetails: sale.paymentDetails,
                    client: sale.client || null,
                    tipoDte: sale.tipoDte ?? null,
                    invoiceData: sale.invoiceData || null,
                    // Igual que en la cola de Dexie: sin la clave, cada reintento
                    // de esta cola de emergencia sería una venta nueva. Y acá se
                    // encola justamente cuando la respuesta no llegó — el caso en
                    // que es más probable que la venta SÍ se haya registrado.
                    clientSaleId: sale.clientSaleId,
                    // Esta cola también guarda ventas YA COBRADAS: el cajero
                    // cobró, el envío falló y se reintenta después. Mismo caso
                    // que la cola offline, así que tampoco se rechaza por stock.
                    ventaOffline: true,
                    // La hora del cobro, para que la venta se guarde con la hora
                    // en que se cobró y no con la que logre subir. Si la venta ya
                    // venía de la cola, conserva la suya: reencolar no la
                    // "rejuvenece".
                    _offlineCreatedAt: sale._offlineCreatedAt || new Date().toISOString(),
                },
            };
            queue.push(entry);
            localStorage.setItem(KEY, JSON.stringify(queue));
            set({ pendingSalesCount: queue.length });
            console.warn(`🛟 Venta encolada para reintento (tempId=${tempId}, motivo: ${reason})`);
            return entry;
        } catch (e) {
            console.error('Error encolando venta pendiente:', e);
            return null;
        }
    },

    getPendingSalesQueue: () => {
        try {
            if (typeof window === 'undefined' || !window.localStorage) return [];
            return JSON.parse(localStorage.getItem('poskem_pending_sales_v1') || '[]');
        } catch { return []; }
    },

    processPendingSalesQueue: async () => {
        try {
            if (typeof window === 'undefined' || !window.localStorage) return { processed: 0 };
            if (!navigator?.onLine) return { processed: 0, offline: true };
            const KEY = 'poskem_pending_sales_v1';
            const queue = JSON.parse(localStorage.getItem(KEY) || '[]');
            if (queue.length === 0) {
                // Aún así, contar lo que haya en Dexie para mantener el badge correcto
                let dexieCount = 0;
                try {
                    const { activeCompanyId } = get();
                    if (activeCompanyId) {
                        dexieCount = await pendingOpsApi.count(activeCompanyId, 'queued');
                    }
                } catch { /* noop */ }
                set({ pendingSalesCount: dexieCount });
                return { processed: 0, remaining: dexieCount };
            }
            const { activeCompanyId } = get();
            const remaining = [];
            let processed = 0;
            for (const entry of queue) {
                // Solo reintentar las de la empresa activa para evitar mezclar contextos.
                if (entry.companyId && activeCompanyId && entry.companyId !== activeCompanyId) {
                    remaining.push(entry);
                    continue;
                }
                try {
                    entry.attempts = (entry.attempts || 0) + 1;
                    const result = await get().addSale(entry.sale);
                    if (result?.success && !result.queued) {
                        processed += 1;
                        console.log(`✅ Venta pendiente sincronizada (tempId=${entry.tempId}, saleId=${result.saleId})`);
                    } else if (result?.queued) {
                        // Sigue offline — mantenerla
                        remaining.push(entry);
                    } else {
                        entry.lastError = result?.error || 'unknown';
                        if (entry.attempts < 10) remaining.push(entry);
                        else console.error(`❌ Venta pendiente descartada tras 10 intentos:`, entry);
                    }
                } catch (e) {
                    entry.lastError = e?.message || String(e);
                    if (entry.attempts < 10) remaining.push(entry);
                }
            }
            localStorage.setItem(KEY, JSON.stringify(remaining));
            // Contador unificado: legacy localStorage + Dexie pendingOps queued
            let dexieCount = 0;
            try {
                const { activeCompanyId } = get();
                if (activeCompanyId) {
                    dexieCount = await pendingOpsApi.count(activeCompanyId, 'queued');
                }
            } catch { /* noop */ }
            set({ pendingSalesCount: remaining.length + dexieCount });
            return { processed, remaining: remaining.length + dexieCount };
        } catch (e) {
            console.error('Error procesando cola de ventas pendientes:', e);
            return { processed: 0, error: e.message };
        }
    },

    cancelSale: async (saleId, observation = '') => {
        try {
            const { activeCompanyId, cashRegister } = get();

            // Server-side (Fase 1 · Paso 12): lee la venta, marca cancelada,
            // restaura stock + lotes y registra el REFUND — todo en un batch.
            // Devuelve la venta, items y stock fresco para el sync a tienda.
            const rc = await userApiCall('saleCancel', {
                companyId: activeCompanyId,
                saleId,
                observation,
                hasOpenRegister: Boolean(cashRegister?.id),
            });
            if (!rc?.success) {
                console.error('Sale not found for cancellation', rc?.error);
                return rc?.error ? { success: false, error: rc.error } : false;
            }

            const sale = rc.sale;
            const items = rc.items || [];

            console.log(`🚫 Cancelling Sale #${saleId} - Items: ${items.length}`);

            // 5. Reverse all aggregations (sales_daily_summary, vendor_daily_performance,
            //    product_daily_profit, product_movement_stats, hourly_sales_stats).
            //    This keeps the pre-aggregated reports (Venta de Productos, Análisis de Ventas)
            //    in sync with the live `sales` table.
            try {
                await get().reverseAllAggregations(
                    { ...sale, items, total: sale.total, date: sale.date },
                    sale.user_id,
                    activeCompanyId,
                    get().currentCompanyTimezone
                );
            } catch (aggErr) {
                console.warn('⚠️ reverseAllAggregations failed for cancelled sale', saleId, aggErr);
            }

            // 5. Update Local State
            set(state => ({
                sales: state.sales.map(s => s.id === saleId ? { ...s, status: 'cancelled', observation } : s),

                // Optimistically update products stock in UI
                products: state.products.map(p => {
                    const item = items.find(i => i.id === p.id);
                    if (item) {
                        return { ...p, stock: Math.round(((parseFloat(p.stock) || 0) + parseFloat(item.quantity)) * 1000) / 1000 };
                    }
                    return p;
                })
            }));

            // 6. Sync restored stock to online store (WooCommerce)
            try {
                const { products: updatedProducts } = get();

                // Stock fresco post-restauración ya viene de saleCancel
                const dbProducts = rc.products || [];

                const stockSyncItems = items.map(item => {
                    const dbProd = dbProducts.find(p => String(p.id) === String(item.id));
                    const stateProd = updatedProducts.find(p => String(p.id) === String(item.id));
                    const sku = dbProd?.sku || stateProd?.sku || null;
                    const unit = (dbProd?.unit || stateProd?.unit || 'un').toLowerCase();
                    const raw = parseFloat(dbProd?.stock ?? stateProd?.stock ?? 0);
                    const stock = (unit === 'kg' || unit === 'lt')
                        ? Math.round(raw * 1000) / 1000
                        : Math.round(raw);
                    return { product_id: item.id, sku, stock, unit: dbProd?.unit || stateProd?.unit || 'Und' };
                }).filter(item => item.sku && normalizeSku(item.sku) && Number.isFinite(item.stock));

                console.log(`🔄 Cancel sync: ${stockSyncItems.length} items to sync`, stockSyncItems);

                if (stockSyncItems.length > 0) {
                    get().syncSaleStockToStore({
                        saleId,
                        soldAt: new Date().toISOString(),
                        items: stockSyncItems,
                    }).then(syncResult => {
                        if (!syncResult?.success) {
                            console.warn('Stock sync post-cancel failed:', { saleId, syncResult, items: stockSyncItems });
                        } else {
                            console.log('✅ Stock sync post-cancel success:', { saleId, status: syncResult.status, items: stockSyncItems });
                        }
                    }).catch(syncError => {
                        console.warn('Stock sync post-cancel error:', { saleId, error: syncError?.message || String(syncError), items: stockSyncItems });
                    });
                } else {
                    console.warn('⚠️ Cancel sync skipped: no items with valid SKU', { saleId, items, dbProducts });
                }
            } catch (syncErr) {
                console.warn('Stock sync post-cancel setup error:', syncErr);
            }

            // Check inventory alerts after cancel (non-blocking)
            setTimeout(() => { get().checkInventoryAlerts(); }, 100);

            // Refrescar stats de caja para descontar la venta anulada
            const postCancelRegister = get().cashRegister;
            if (postCancelRegister?.id) {
                get().refreshRegisterStats(postCancelRegister.id);
            }

            // Sync client debt if this was a credit sale (await para que el saldo quede
            // actualizado antes de devolver el control a la UI)
            const cancelledClientId = sale.client_id || sale.clientId;
            if (cancelledClientId && sale.payment_method === 'Crédito') {
                try {
                    await get()._syncClientDebt(cancelledClientId);
                } catch (debtErr) {
                    console.warn('⚠️ _syncClientDebt failed post-cancel:', debtErr);
                }
            }

            return true;

        } catch (e) {
            console.error("Cancel sale error", e);
            return { success: false, error: e?.message || String(e) };
        }
    },

    // ============================================
    // 🔄 DEVOLUCIONES (Product Returns)
    // ============================================

    processReturn: async (saleId, returnItems, reason) => {
        try {
            const { activeCompanyId, currentCompanyTimezone } = get();

            // Día de la venta original en zona horaria del comercio. Necesitamos la
            // fecha de la venta → la trae fetchSaleDetails si no está en memoria.
            let sale = get().sales.find(s => s.id === saleId);
            if (!sale || !sale.date) sale = await get().fetchSaleDetails(saleId);
            if (!sale) return { success: false, error: 'Venta no encontrada' };
            const saleDay = formatInCompanyTime(sale.date, currentCompanyTimezone, 'yyyy-MM-dd');

            const openRegister = get().cashRegister;
            // Server-side: valida cantidades, inserta devolución, restaura stock/lotes,
            // ajusta resumen diario + movimiento de caja + reverso PARCIAL de agregaciones.
            const r = await userApiCall('saleReturnCommit', {
                companyId: activeCompanyId, saleId, returnItems, reason, saleDay,
                registerId: openRegister?.id || null,
            });
            if (!r?.success) return r || { success: false, error: 'Error procesando la devolución' };

            const validatedItems = r.validated;
            const returnTotal = r.returnTotal;
            const now = new Date().toISOString();

            // Update local state - stock
            set(state => ({
                products: state.products.map(p => {
                    const returnedItem = validatedItems.find(i => i.id === p.id);
                    if (returnedItem) {
                        return { ...p, stock: Math.round(((parseFloat(p.stock) || 0) + parseFloat(returnedItem.quantity)) * 1000) / 1000 };
                    }
                    return p;
                })
            }));

            // Sync stock to online store (non-blocking) — stock fresco viene del servidor
            try {
                const { products: updatedProducts } = get();
                const dbProducts = r.products || [];
                if (dbProducts.length > 0) {
                    const stockSyncItems = validatedItems.map(item => {
                        const dbProd = dbProducts.find(p => String(p.id) === String(item.id));
                        const stateProd = updatedProducts.find(p => String(p.id) === String(item.id));
                        const sku = dbProd?.sku || stateProd?.sku || null;
                        const unit = (dbProd?.unit || stateProd?.unit || 'un').toLowerCase();
                        const raw = parseFloat(dbProd?.stock ?? stateProd?.stock ?? 0);
                        const stock = (unit === 'kg' || unit === 'lt')
                            ? Math.round(raw * 1000) / 1000
                            : Math.round(raw);
                        return { product_id: item.id, sku, stock, unit: dbProd?.unit || stateProd?.unit || 'Und' };
                    }).filter(item => item.sku && normalizeSku(item.sku) && Number.isFinite(item.stock));

                    if (stockSyncItems.length > 0) {
                        get().syncSaleStockToStore({
                            saleId,
                            soldAt: now,
                            items: stockSyncItems,
                        }).catch(err => console.warn('Stock sync post-return error:', err));
                    }
                }
            } catch (syncErr) {
                console.warn('Stock sync post-return setup error:', syncErr);
            }

            // 10. Refrescar stats de caja si está abierta
            if (openRegister?.id) {
                get().refreshRegisterStats(openRegister.id);
            }

            setTimeout(() => { get().checkInventoryAlerts(); }, 100);

            return { success: true, returnTotal };

        } catch (e) {
            console.error("Process return error:", e);
            return { success: false, error: e?.message || String(e) };
        }
    },

    fetchSaleReturns: async (saleId) => {
        try {
            const r = await userApiCall('saleReturnsList', { companyId: get().activeCompanyId, saleId });
            if (!r?.success) return [];
            return r.rows.map(row => ({
                ...row,
                items: typeof row.items === 'string' ? JSON.parse(row.items) : row.items
            }));
        } catch (e) {
            console.error("Fetch sale returns error:", e);
            return [];
        }
    },

    registerClientPayment: async (client, amount, distributionOrSalesIds, paymentMethod) => {
        try {
            const { currentUser, sales, activeCompanyId } = get();

            // Support both old format (array of IDs) and new format (distribution array)
            let distribution;
            if (Array.isArray(distributionOrSalesIds) && distributionOrSalesIds.length > 0 && typeof distributionOrSalesIds[0] === 'object') {
                // New format: [{ saleId, amount, fullyPaid, newTotalPaid }]
                distribution = distributionOrSalesIds;
            } else {
                // Legacy format: array of sale IDs (mark all as fully paid)
                distribution = distributionOrSalesIds.map(id => {
                    const sale = sales.find(s => s.id === id);
                    return { saleId: id, amount: sale ? parseFloat(sale.total) : 0, fullyPaid: true, newTotalPaid: sale ? parseFloat(sale.total) : 0 };
                });
            }

            const partialCount = distribution.filter(d => !d.fullyPaid).length;
            const totalBoletas = distribution.length;
            let summaryDetail = `${totalBoletas} boleta${totalBoletas > 1 ? 's' : ''}`;
            if (partialCount > 0) summaryDetail += ` (${partialCount} parcial)`;

            const paymentDate = getNowInCompanyTime(get().currentCompanyTimezone).toISOString();

            // Server-side (sesión + membresía): inserta el abono (con company_id),
            // marca boletas pagadas (filtrando por empresa) y recalcula la deuda.
            const r = await userApiCall('clientRegisterPayment', {
                companyId: activeCompanyId,
                client: { id: client.id, name: client.name },
                amount,
                distribution,
                paymentMethod,
                date: paymentDate,
            });
            if (!r?.success) return r || { success: false, error: 'Error registrando el pago' };

            // Objeto local del abono (misma forma que antes, para la UI inmediata)
            const paymentSale = {
                date: paymentDate,
                total: amount,
                summary: `Abono de Cliente: ${client.name}`,
                items: [{
                    id: 'payment-adj',
                    name: `Abono / Pago de Deuda (${summaryDetail})`,
                    price: amount,
                    quantity: 1,
                    unit: 'Und'
                }],
                payment_method: paymentMethod,
                paymentDetails: { amount: amount, change: 0, type: 'debt_payment', distribution },
                user_id: currentUser ? currentUser.id : null,
                status: 'completed',
                has_negative_stock: 0,
                client_id: client.id,
                client_name: client.name
            };

            // Update Local State
            const distributionMap = new Map(distribution.map(d => [d.saleId, d]));
            set(state => ({
                sales: [
                    { ...paymentSale, id: Date.now() },
                    ...state.sales.map(s => {
                        const d = distributionMap.get(s.id);
                        if (!d) return s;
                        return {
                            ...s,
                            status: d.fullyPaid ? 'paid' : s.status,
                            amount_paid: d.newTotalPaid
                        };
                    })
                ],
                clients: r.debt?.success
                    ? state.clients.map(c => c.id === client.id
                        ? { ...c, total_debt: r.debt.totalDebt, pending_sales_count: r.debt.pendingCount, overdue_count: r.debt.overdueCount }
                        : c)
                    : state.clients
            }));

            // Force Fetch from DB to ensure consistency
            await get().fetchSales();

            // Refresh Register
            const { cashRegister, refreshRegisterStats } = get();
            if (cashRegister) {
                refreshRegisterStats(cashRegister.id);
            }

            return { success: true };

        } catch (e) {
            console.error("Register payment error", e);
            return { success: false, error: e.message };
        }
    },

    // Cash Register Logic
    fetchActiveRegisters: async () => {
        try {
            console.time('⏱️ fetchActiveRegisters');
            // Server-side: cajas abiertas + balance calculado (Fase 1 · Paso 13)
            const r = await userApiCall('registerActiveList', { companyId: get().activeCompanyId });
            set({ activeRegisters: r?.success ? (r.registers || []) : [] });
            console.timeEnd('⏱️ fetchActiveRegisters');
            console.log('✅ Active registers loaded:', r?.registers?.length || 0);
        } catch (e) {
            console.error("❌ Fetch active registers error", e);
            console.timeEnd('⏱️ fetchActiveRegisters');
        }
    },

    checkRegisterStatus: async (userId) => {
        try {
            const { activeCompanyId } = get();
            const r = await userApiCall('registerCheck', { companyId: activeCompanyId, userId });

            // Si el servidor no contestó, se CONSERVA la caja que ya se tenía.
            //
            // Antes, cualquier respuesta que no fuera exitosa dejaba la caja en
            // null. Sin conexión eso era grave: el POS pide abrir caja para
            // vender, así que salir a otra pantalla y volver dejaba a la cajera
            // sin poder vender —justo en la situación para la que existe el modo
            // offline—. La caja está abierta en el servidor y en el cajón; que no
            // podamos preguntarlo ahora no la cierra.
            //
            // Solo un "no tenés caja abierta" dicho POR EL SERVIDOR la borra.
            if (!r?.success) {
                if (!r?.sinConexion) console.warn('[caja] registerCheck falló, se conserva la caja conocida:', r?.error);
                return;
            }
            set({ cashRegister: r.register || null });
        } catch (e) {
            console.error("Check register error", e);
        }
    },

    openRegister: async (userId, amount) => {
        try {
            const { activeCompanyId } = get();

            // Server-side: dup-check de caja abierta + INSERT (misma validación crítica).
            // La hora de apertura la pone el servidor: si la mandaba el dispositivo y su
            // zona horaria no era la del local, la caja podía no sumar ninguna venta.
            const r = await userApiCall('registerOpen', {
                companyId: activeCompanyId,
                userId,
                amount,
            });

            if (!r?.success) {
                if (r?.existingRegister) {
                    console.error("⚠️ User already has an open register:", r.existingRegister);
                    set({ cashRegister: r.existingRegister });
                    return { success: false, error: r.error, existingRegister: r.existingRegister };
                }
                return { success: false, error: r?.error || 'Error al abrir la caja. Intenta nuevamente.' };
            }

            set({ cashRegister: r.register });
            console.log("✅ Cash register opened successfully:", r.register);
            return { success: true, register: r.register };
        } catch (e) {
            console.error("❌ Open register error", e);
            return { success: false, error: 'Error al abrir la caja. Intenta nuevamente.' };
        }
    },

    // `override` = { username, password, reason, pendientes } cuando un
    // supervisor autoriza cerrar con ventas offline sin subir. La clave se
    // verifica en el servidor (api/_lib/registerActions.js): acá solo viaja.
    //
    // Devuelve `true` si cerró; si no, un objeto con el error para poder
    // distinguir "clave mal" de "falló el cierre" y no cerrar el diálogo.
    closeRegister: async (registerId, finalAmount, observations, difference, override = null) => {
        try {
            const r = await userApiCall('registerClose', {
                companyId: get().activeCompanyId,
                registerId, finalAmount, observations, difference,
                ...(override ? { override } : {}),
            });
            if (!r?.success) return { success: false, error: r?.error || 'No se pudo cerrar la caja.', authFailed: !!r?._authFailed };
            set({ cashRegister: null });
            return true;
        } catch (e) {
            console.error("Close register error", e);
            return { success: false, error: e?.message || 'No se pudo cerrar la caja.' };
        }
    },

    registerStats: { balance: 0, sales: 0, movements_in: 0, movements_out: 0, initial: 0, transactions: [] },
    suspendedSalesCount: 0,
    pendingSalesCount: 0,

    refreshRegisterStats: async (registerId) => {
        try {
            console.time('⏱️ refreshRegisterStats');
            // Server-side: todo el cálculo (ventas, mixtas, encargos, movimientos)
            // corre en api/_lib/registerActions.js y devuelve el objeto final.
            const r = await userApiCall('registerStats', { companyId: get().activeCompanyId, registerId });
            if (r?.success && r.stats) {
                set({ registerStats: r.stats });
                console.log('✅ Stats refreshed:', {
                    balance: r.stats.balance,
                    sales: r.stats.sales,
                    movements_in: r.stats.movements_in,
                    movements_out: r.stats.movements_out
                });
            }
            console.timeEnd('⏱️ refreshRegisterStats');
        } catch (e) {
            console.error("❌ Refresh stats error", e);
            console.timeEnd('⏱️ refreshRegisterStats');
        }
    },

    // Detalle por método de pago (Tarjeta o Transferencia) para el desglose
    // del Estado de Caja. LAZY: solo se llama cuando el usuario abre la pestaña
    // → no afecta el tiempo de carga inicial de la caja.
    //
    // Devuelve transacciones combinadas POS + encargo (excluye cancelados),
    // ordenadas por fecha desc. Para POS: extrae datáfono/cuenta de
    // payment_details. Para encargos: no se captura datáfono/cuenta aún
    // (futuro), se muestra '-'.
    getRegisterMethodTransactions: async (registerId, method) => {
        try {
            if (!registerId || !method) return { success: false, transactions: [] };
            // Server-side: POS directo + mixtas + encargos, combinados y ordenados
            return await userApiCall('registerMethodTransactions', {
                companyId: get().activeCompanyId, registerId, method,
            });
        } catch (e) {
            console.error('Error obteniendo transacciones por método:', e);
            return { success: false, transactions: [], error: e.message };
        }
    },

    // ════════════════════════════════════════════════════════════════════
    //  CONCILIACIÓN DE DATÁFONOS
    // ════════════════════════════════════════════════════════════════════
    //  Lee ventas con tarjeta (POS + encargos) de un datáfono dado en un
    //  rango de fechas, para que la pantalla de Conciliación compute el
    //  neto esperado y haga match contra el abono real.
    //
    //  Incluye ventas POS con payment_method = 'Tarjeta' y payment_details
    //  que contiene terminal=<id>, mixtas con porción 'Tarjeta' del mismo
    //  terminal, y preorder_payments del terminal en el rango.
    fetchTerminalCardSales: async ({ terminalId, startDate, endDate }) => {
        try {
            const { activeCompanyId, currentCompanyTimezone, paymentTerminals } = get();
            if (!terminalId || !startDate || !endDate) {
                return { success: false, sales: [], error: 'Faltan parámetros' };
            }
            // PaymentModal guarda el NOMBRE del datáfono en payment_details.terminal
            // (no el ID). Necesitamos resolver el nombre para filtrar las ventas POS.
            // Los preorder_payments sí usan terminal_id numérico.
            const term = (paymentTerminals || []).find(t => Number(t.id) === Number(terminalId));
            const terminalName = term?.name || '';
            const utcStart = getStartFromDateString(startDate, currentCompanyTimezone).toISOString();
            const utcEnd = getEndFromDateString(endDate, currentCompanyTimezone).toISOString();

            // Server-side: POS directo + mixtas + encargos del datáfono, filtrados y ordenados
            return await userApiCall('terminalCardSales', {
                companyId: activeCompanyId, terminalId, terminalName, utcStart, utcEnd,
            });
        } catch (e) {
            console.error('Error fetching terminal card sales:', e);
            return { success: false, sales: [], error: e.message };
        }
    },

    // Devuelve un Set de IDs de ventas (formato "s_123" / "m_123_0" / "p_45")
    // que ya fueron consumidas por alguna conciliación CON match (sale_ids no vacío).
    // Las conciliaciones manuales/históricas (sale_ids vacío) no consumen ventas.
    fetchConciliatedSaleIds: async (terminalId) => {
        try {
            if (!terminalId) return new Set();
            const r = await userApiCall('conciliatedSaleIds', { companyId: get().activeCompanyId, terminalId });
            return new Set(r?.success ? (r.ids || []) : []);
        } catch (e) {
            console.error('Error fetching conciliated sale ids:', e);
            return new Set();
        }
    },

    // Devuelve el conteo de ventas "Tarjeta" sin datáfono asignado en el rango.
    // Útil para diagnosticar por qué un abono no cuadra (faltan ventas etiquetadas).
    fetchUntaggedCardSalesCount: async ({ startDate, endDate }) => {
        try {
            const { activeCompanyId, currentCompanyTimezone } = get();
            if (!startDate || !endDate) return { count: 0, total: 0 };
            const utcStart = getStartFromDateString(startDate, currentCompanyTimezone).toISOString();
            const utcEnd = getEndFromDateString(endDate, currentCompanyTimezone).toISOString();

            const r = await userApiCall('untaggedCardSalesCount', { companyId: activeCompanyId, utcStart, utcEnd });
            return r?.success ? { count: r.count, total: r.total } : { count: 0, total: 0 };
        } catch (e) {
            console.error('Error fetching untagged card sales:', e);
            return { count: 0, total: 0 };
        }
    },

    fetchPaymentReconciliations: async ({ terminalId = null, limit = 50 } = {}) => {
        try {
            return await userApiCall('reconciliationsList', { companyId: get().activeCompanyId, terminalId, limit });
        } catch (e) {
            console.error('Error fetching reconciliations:', e);
            return { success: false, reconciliations: [], error: e.message };
        }
    },

    savePaymentReconciliation: async ({ terminalId, depositDate, depositAmount, expectedAmount, saleIds, salesFrom, salesTo, notes }) => {
        try {
            // Server-side: created_by = usuario de la sesión (ya no manipulable)
            return await userApiCall('reconciliationSave', {
                companyId: get().activeCompanyId,
                terminalId, depositDate, depositAmount, expectedAmount, saleIds, salesFrom, salesTo, notes,
            });
        } catch (e) {
            console.error('Error saving reconciliation:', e);
            return { success: false, error: e.message };
        }
    },

    deletePaymentReconciliation: async (id) => {
        try {
            return await userApiCall('reconciliationDelete', { companyId: get().activeCompanyId, id });
        } catch (e) {
            console.error('Error deleting reconciliation:', e);
            return { success: false, error: e.message };
        }
    },

    // Historical Reports
    fetchClosedRegisters: async (limit = 20, offset = 0, startDate, endDate) => {
        try {
            const { activeCompanyId, currentCompanyTimezone } = get();

            const utcStart = startDate ? getStartFromDateString(startDate, currentCompanyTimezone).toISOString() : null;
            const utcEnd = endDate ? getEndFromDateString(endDate, currentCompanyTimezone).toISOString() : null;

            const r = await userApiCall('registersClosed', { companyId: activeCompanyId, limit, offset, utcStart, utcEnd });
            return r?.success ? r.rows : [];
        } catch (e) {
            console.error("Fetch closed registers error", e);
            return [];
        }
    },

    addCashMovement: async (registerId, type, amount, reason) => {
        try {
            const r = await userApiCall('cashMovementAdd', {
                companyId: get().activeCompanyId,
                registerId, type, amount, reason,
                date: getNowInCompanyTime(get().currentCompanyTimezone).toISOString(),
            });
            return Boolean(r?.success);
        } catch (e) {
            console.error("Add cash movement error", e);
            return false;
        }
    },

    fetchCashMovements: async (limit = 20, offset = 0, startDate, endDate) => {
        try {
            const { activeCompanyId, currentCompanyTimezone } = get();
            // Server-side: cajas paginadas + movimientos + aperturas combinados
            const utcStart = startDate ? getStartFromDateString(startDate, currentCompanyTimezone).toISOString() : null;
            const utcEnd = endDate ? getEndFromDateString(endDate, currentCompanyTimezone).toISOString() : null;

            const r = await userApiCall('cashMovementsList', { companyId: activeCompanyId, limit, offset, utcStart, utcEnd });
            return r?.success ? r.rows : [];

        } catch (e) {
            console.error("Fetch cash movements error:", e);
            return [];
        }
    },

    getRegisterReport: async (register) => {
        try {
            // Server-side: desglose por método + movimientos + esperado calculado
            const r = await userApiCall('registerReport', { companyId: get().activeCompanyId, register });
            return r?.success ? r.report : null;
        } catch (e) {
            console.error("Get register report error", e);
            return null;
        }
    },

    // ============================================
    // SUSPENDED SALES (Suspender/Recuperar Ventas)
    // ============================================

    // Actualizar contador de ventas suspendidas (rápido, solo COUNT)
    updateSuspendedCount: async () => {
        try {
            const r = await userApiCall('suspendedCount', { companyId: get().activeCompanyId });
            if (r?.success) set({ suspendedSalesCount: r.count });
        } catch (e) {
            console.error('❌ Update suspended count error:', e);
        }
    },

    // Suspender venta actual (guardar y limpiar carrito)
    suspendSale: async () => {
        try {
            const { carts, activeCartId, activeCompanyId, currentCompanyTimezone } = get();

            // DERIVAR cart y client manualmente (NO usar getters)
            const activeCart = carts.find(c => c.id === activeCartId);
            const cart = activeCart?.items || [];
            const posSelectedClient = activeCart?.client || null;

            console.log('💾 Attempting to suspend sale:', {
                activeCartId,
                cartItems: cart.length,
                items: cart.map(i => i.name)
            });

            if (cart.length === 0) {
                alert('El carrito está vacío');
                return false;
            }

            // Calcular totales
            const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            const tax = cart.reduce((sum, item) => {
                const taxRate = parseFloat(item.tax_rate) || 0;
                return sum + (item.price * item.quantity * taxRate / 100);
            }, 0);
            const total = subtotal + tax;
            const itemsCount = cart.reduce((sum, item) => sum + item.quantity, 0);

            const now = getNowInCompanyTime(currentCompanyTimezone).toISOString();

            const r = await userApiCall('suspendCreate', {
                companyId: activeCompanyId, cart, clientData: posSelectedClient,
                subtotal, tax, total, itemsCount, now,
            });
            if (!r?.success) { alert('Error al suspender la venta'); return false; }

            // Limpiar SOLO el carrito activo
            set(state => ({
                carts: state.carts.map(c =>
                    c.id === state.activeCartId
                        ? { ...c, items: [], client: null }
                        : c
                )
            }));

            // Actualizar contador
            await get().updateSuspendedCount();

            return true;
        } catch (e) {
            console.error('❌ Suspend sale error:', e);
            alert('Error al suspender la venta');
            return false;
        }
    },

    // Traer lista de ventas suspendidas (ligera, sin items completos)
    fetchSuspendedSales: async () => {
        try {
            const r = await userApiCall('suspendedList', { companyId: get().activeCompanyId });
            return r?.success ? r.rows : [];
        } catch (e) {
            console.error('❌ Fetch suspended sales error:', e);
            return [];
        }
    },

    // Recuperar venta (trae items completos y restaura carrito)
    recoverSale: async (saleId) => {
        try {
            const r = await userApiCall('suspendRecover', { companyId: get().activeCompanyId, saleId });
            if (!r?.success) {
                alert(r?.error || 'Esta venta ya fue recuperada o no existe');
                return false;
            }
            const items = r.items;
            const clientData = r.clientData;

            // Limpiar carrito actual
            get().clearCart();

            // Restaurar items TAL CUAL se suspendieron (cantidad/gramaje, precio
            // editado, dcto); addToCart reseteaba a 1 unidad y precio de catálogo.
            get().loadPreventaCart(items);

            // Restaurar cliente
            if (clientData) {
                get().setPosSelectedClient(clientData);
            }

            // Actualizar contador
            await get().updateSuspendedCount();
            return true;
        } catch (e) {
            console.error('❌ Recover sale error:', e);
            alert('Error al recuperar la venta');
            return false;
        }
    },

    // Eliminar venta suspendida
    deleteSuspendedSale: async (saleId) => {
        try {
            const r = await userApiCall('suspendDelete', { companyId: get().activeCompanyId, saleId });
            if (!r?.success) return false;
            await get().updateSuspendedCount();
            return true;
        } catch (e) {
            console.error('❌ Delete suspended sale error:', e);
            return false;
        }
    },

    // ============================================
    // �️ FUNCIONES DE PREVENTAS
    // ============================================

    pendingPreventasCount: 0,

    createPreventa: async (items, clientData, total) => {
        try {
            const { activeCompanyId, currentUser, currentCompanyTimezone } = get();
            if (!activeCompanyId || !currentUser) throw new Error('No company/user');

            // El código se genera en el cliente (zona horaria de la empresa)
            const now = getNowInCompanyTime(currentCompanyTimezone);
            const pad = (n) => String(n).padStart(2, '0');
            const yy = String(now.getFullYear()).slice(-2);
            const code = `PV${yy}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${Math.floor(Math.random() * 100).toString().padStart(2, '0')}`;

            const r = await userApiCall('preventaCreate', { companyId: activeCompanyId, items, clientData, total, code, now: now.toISOString() });
            if (!r?.success) return r || { success: false, error: 'Error' };

            await get().updatePreventasCount();
            return { success: true, code: r.code };
        } catch (e) {
            console.error('Error creating preventa:', e);
            return { success: false, error: e.message };
        }
    },

    // Restaura el carrito guardado de una preventa TAL CUAL se creó: respeta
    // cantidad/gramaje, precio editado y % de descuento. No pasa por addToCart
    // (que resetea a 1 unidad, precio de catálogo y 0% dcto) ni re-calcula
    // ofertas/escalas — el ticket impreso es el contrato con el cliente.
    loadPreventaCart: (items) => {
        const { carts, activeCartId } = get();
        const restored = (items || []).map(item => ({
            discountPercent: 0,
            unit: 'Und',
            category: '',
            price_ranges: [],
            scale_group_id: null,
            is_combo: false,
            combo_id: null,
            combo_items: null,
            ...item,
            price: Number(item.price) || 0,
            quantity: Number(item.quantity) || 1,
            cost: Number(item.cost) || 0,
            tax_rate: Number(item.tax_rate) || 0,
            original_price: item.original_price ?? item.price,
        }));
        set({
            carts: carts.map(c =>
                c.id === activeCartId ? { ...c, items: restored } : c
            ),
        });
    },

    fetchPendingPreventas: async () => {
        try {
            const r = await userApiCall('preventasPending', { companyId: get().activeCompanyId });
            if (!r?.success) return [];
            return r.rows.map(row => ({
                ...row,
                items: JSON.parse(row.items),
                client_data: row.client_data ? JSON.parse(row.client_data) : null
            }));
        } catch (e) {
            console.error('Error fetching preventas:', e);
            return [];
        }
    },

    fetchPreventaByCode: async (code) => {
        try {
            const r = await userApiCall('preventaByCode', { companyId: get().activeCompanyId, code });
            if (!r?.success || !r.preventa) return null;
            const p = r.preventa;
            return { ...p, items: JSON.parse(p.items), client_data: p.client_data ? JSON.parse(p.client_data) : null };
        } catch (e) {
            console.error('Error fetching preventa by code:', e);
            return null;
        }
    },

    completePreventa: async (code, saleId) => {
        try {
            const { activeCompanyId, currentCompanyTimezone } = get();
            const now = getNowInCompanyTime(currentCompanyTimezone).toISOString();
            const r = await userApiCall('preventaComplete', { companyId: activeCompanyId, code, saleId, now });
            await get().updatePreventasCount();
            return Boolean(r?.success && r.affected > 0);
        } catch (e) {
            console.error('Error completing preventa:', e);
            return false;
        }
    },

    cancelPreventa: async (code) => {
        try {
            const r = await userApiCall('preventaCancel', { companyId: get().activeCompanyId, code });
            await get().updatePreventasCount();
            return Boolean(r?.success && r.affected > 0);
        } catch (e) {
            console.error('Error cancelling preventa:', e);
            return false;
        }
    },

    updatePreventasCount: async () => {
        try {
            const r = await userApiCall('preventasCount', { companyId: get().activeCompanyId });
            set({ pendingPreventasCount: r?.success ? r.count : 0 });
        } catch (e) {
            set({ pendingPreventasCount: 0 });
        }
    },

    // ============================================
    // �🆕 FUNCIONES DE SUSCRIPCIÓN
    // ============================================

    // Verificar estado de suscripción de una empresa
    checkSubscriptionStatus: async (companyId) => {
        try {
            const rows = await reportRows(companyId, 'subscriptionRow', {});
            if (rows.length === 0) {
                return { isActive: false, status: 'not_found' };
            }

            const company = rows[0];
            const now = new Date();

            // Etiqueta legible del plan (según la suscripción contratada o el plan base)
            const planLabel = (() => {
                const map = {
                    standard: 'Plan Standard', professional: 'Plan Profesional',
                    // Legacy (pre-migración a 2 planes)
                    basico: 'Plan Standard', basic: 'Plan Standard',
                    medium: 'Plan Profesional', medio: 'Plan Profesional', pro: 'Plan Profesional',
                    monthly: 'Plan Mensual', yearly: 'Plan Anual',
                };
                return map[company.plan_id] || map[company.plan] || company.plan_id || company.plan || null;
            })();

            // Id de plan normalizado (standard|professional) para comparar jerarquía en la UI
            const planId = (() => {
                const r = (company.plan_id || company.plan || '').toString().trim().toLowerCase();
                if (r === 'standard' || r === 'basic' || r === 'basico') return 'standard';
                if (r === 'professional' || r === 'medium' || r === 'medio' || r === 'pro') return 'professional';
                return null;
            })();

            // Si está en trial
            // Fin de la prueba: trial_ends_at, o access_until como respaldo (el admin
            // al poner "Prueba" setea access_until; empresas viejas pueden no tener
            // trial_ends_at). Sin esto, "Mi Plan" mostraba vence/días en "—".
            const trialEndIso = company.trial_ends_at || company.access_until;
            if (company.status === 'trial' && trialEndIso) {
                const trialEnd = new Date(trialEndIso);
                if (now <= trialEnd) {
                    return {
                        isActive: true,
                        status: 'trial',
                        planLabel: 'Prueba gratis',
                        country_code: company.country_code,
                        trial_ends_at: trialEndIso,
                        expiresAt: trialEndIso,
                        daysRemaining: Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24))
                    };
                }
            }

            // Si tiene suscripción activa
            if (company.status === 'active' && company.current_period_end) {
                const periodEnd = new Date(company.current_period_end);
                if (now <= periodEnd) {
                    return {
                        isActive: true,
                        status: 'active',
                        planLabel,
                        planId,
                        country_code: company.country_code,
                        expiresAt: company.current_period_end,
                        renewsAt: company.current_period_end
                    };
                }
            }

            // En cualquier otro caso (past_due, suspended, etc.)
            return {
                isActive: company.status === 'active',
                status: company.status,
                planLabel,
                planId,
                country_code: company.country_code,
                expiresAt: company.current_period_end || company.trial_ends_at || null
            };

        } catch (error) {
            console.error('Error checking subscription:', error);
            return { isActive: false, status: 'error' };
        }
    },

    updateCurrency: async (newCurrency) => {
        const { activeCompanyId } = get();
        try {
            // Reusa companyFieldsUpdate (currency está en la whitelist server-side)
            const r = await userApiCall('companyFieldsUpdate', { companyId: activeCompanyId, fields: { currency: newCurrency } });
            if (!r?.success) return r || { success: false, error: 'Error' };
            set({ currentCurrency: newCurrency });
            return { success: true };
        } catch (e) {
            console.error('Error updating currency:', e);
            return { success: false, error: e.message };
        }
    },

    // Obtener historial de pagos de una empresa (excluye intentos abandonados en 'pending')
    fetchPaymentHistory: async (companyId) => {
        try {
            return await reportRows(companyId, 'paymentHistory', {});
        } catch (error) {
            console.error('Error fetching payment history:', error);
            return [];
        }
    },


    // ═══════════════════════════════════════════════════════════════
    // SISTEMA DE SOPORTE
    // ═══════════════════════════════════════════════════════════════

    /**
     * Crear nuevo ticket de soporte
     */
    createSupportTicket: async (subject, category = 'general', initialMessage = '') => {
        try {
            return await userApiCall('supportTicketCreate', { companyId: get().activeCompanyId, subject, category, initialMessage });
        } catch (e) {
            console.error('Error creating support ticket:', e);
            return { success: false, error: e.message };
        }
    },

    fetchSupportTickets: async () => {
        try {
            const r = await userApiCall('supportTicketsList', { companyId: get().activeCompanyId });
            if (!r?.success) return r || { success: false, error: 'Error' };
            const tickets = r.tickets || [];
            const unreadTotal = tickets.reduce((sum, t) => sum + (t.unread_count || 0), 0);
            set({ supportTickets: tickets, unreadSupportCount: unreadTotal });
            return { success: true, tickets };
        } catch (e) {
            console.error('Error fetching support tickets:', e);
            return { success: false, error: e.message };
        }
    },

    fetchTicketMessages: async (ticketId) => {
        try {
            return await userApiCall('supportTicketMessages', { companyId: get().activeCompanyId, ticketId });
        } catch (e) {
            console.error('Error fetching messages:', e);
            return { success: false, error: e.message };
        }
    },

    sendSupportMessage: async (ticketId, message) => {
        try {
            return await userApiCall('supportMessageSend', { companyId: get().activeCompanyId, ticketId, message });
        } catch (e) {
            console.error('Error sending message:', e);
            return { success: false, error: e.message };
        }
    },

    markMessagesAsRead: async (ticketId) => {
        try {
            const r = await userApiCall('supportMessagesMarkRead', { companyId: get().activeCompanyId, ticketId });
            get().fetchSupportTickets();
            return r?.success ? { success: true } : (r || { success: false, error: 'Error' });
        } catch (e) {
            console.error('Error marking as read:', e);
            return { success: false, error: e.message };
        }
    },

    uploadSupportAttachment: async (ticketId, messageId, file) => {
        try {
            // FileReader es del navegador → el base64 se genera aquí y se envía al servidor
            const base64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            return await userApiCall('supportAttachmentUpload', {
                companyId: get().activeCompanyId, ticketId, messageId,
                filename: file.name, fileType: file.type, fileSize: file.size, base64,
            });
        } catch (e) {
            console.error('Error uploading attachment:', e);
            return { success: false, error: e.message };
        }
    },

    fetchMessageAttachments: async (messageId) => {
        try {
            return await userApiCall('supportMessageAttachments', { companyId: get().activeCompanyId, messageId });
        } catch (e) {
            console.error('Error fetching attachments:', e);
            return { success: false, error: e.message };
        }
    },

    // ═══════════════════════════════════════════════════════════════
    // FUNCIONES ADMIN (para el panel de administración)
    // ═══════════════════════════════════════════════════════════════

    /**
     * Obtener TODOS los tickets (admin)
     */
    // ── Soporte admin (super_admin) — via /api/admin/actions ──

    fetchAllSupportTickets: async (filters = {}) => {
        try {
            const r = await adminApiCall('supportListAll', { filters });
            return r?.success ? { success: true, tickets: r.tickets || [] } : (r || { success: false, error: 'Error' });
        } catch (e) {
            console.error('Error fetching all tickets:', e);
            return { success: false, error: e.message };
        }
    },

    replyToTicket: async (ticketId, message) => {
        try {
            return await adminApiCall('supportReply', { ticketId, message });
        } catch (e) {
            console.error('Error replying to ticket:', e);
            return { success: false, error: e.message };
        }
    },

    updateTicketStatus: async (ticketId, status) => {
        try {
            return await adminApiCall('supportSetStatus', { ticketId, status });
        } catch (e) {
            console.error('Error updating ticket status:', e);
            return { success: false, error: e.message };
        }
    },

    updateTicketPriority: async (ticketId, priority) => {
        try {
            return await adminApiCall('supportSetPriority', { ticketId, priority });
        } catch (e) {
            console.error('Error updating ticket priority:', e);
            return { success: false, error: e.message };
        }
    },

    assignTicket: async (ticketId, adminId) => {
        try {
            return await adminApiCall('supportAssign', { ticketId, adminId });
        } catch (e) {
            console.error('Error assigning ticket:', e);
            return { success: false, error: e.message };
        }
    },

    markTicketAsReadByAdmin: async (ticketId) => {
        try {
            return await adminApiCall('supportMarkReadByAdmin', { ticketId });
        } catch (e) {
            console.error('Error marking as read by admin:', e);
            return { success: false, error: e.message };
        }
    },

    adminFetchCompanyContext: async (companyId) => {
        try {
            const r = await adminApiCall('supportCompanyContext', { companyId });
            return r?.success ? r.company : null;
        } catch (e) {
            console.error('Error loading company context:', e);
            return null;
        }
    },

    // ═══════════════════════════════════════════════════════════════
    // SISTEMA DE AGREGACIÓN Y ESTADÍSTICAS
    // ═══════════════════════════════════════════════════════════════

    // Las 5 agregaciones de venta (daily summary, vendor, product profit,
    // movement stats, hourly) corren AHORA server-side en un solo batch
    // atómico: acción 'saleAggregations' (api/_lib/salesActions.js).
    // Ver updateAllAggregations / reverseAllAggregations más abajo.

    // (updateSupplierPurchaseSummary se absorbió en purchaseCreate server-side — Paso 14)


    updateAllAggregations: async (saleData, userId, userName, companyId, timezone) => {
        try {
            // Fechas en zona horaria de la empresa; los UPSERTs corren server-side
            const tz = timezone || get().currentCompanyTimezone;
            const dateStr = formatInCompanyTime(saleData.date, tz, 'yyyy-MM-dd');
            const hour = parseInt(formatInCompanyTime(saleData.date, tz, 'H'), 10) || 0;

            const r = await userApiCall('saleAggregations', {
                companyId,
                saleData: { total: saleData.total, date: saleData.date, items: saleData.items },
                userId, userName, dateStr, hour,
            });
            if (!r?.success) return { success: false, error: r?.error };

            console.log('✅ All aggregations updated');
            return { success: true };
        } catch (e) {
            console.error('Error updating aggregations:', e);
            return { success: false, error: e.message };
        }
    },

    // ═══════════════════════════════════════════════════════════════
    // REVERSO DE AGREGACIONES (Para anulaciones)
    // ═══════════════════════════════════════════════════════════════

    reverseAllAggregations: async (saleData, userId, companyId, timezone) => {
        try {
            if (!saleData || !saleData.items) return { success: false, error: 'Missing sale data' };

            // Reverso de las 5 agregaciones en un batch atómico server-side
            const tz = timezone || get().currentCompanyTimezone;
            const dateStr = formatInCompanyTime(saleData.date, tz, 'yyyy-MM-dd');
            const hour = parseInt(formatInCompanyTime(saleData.date, tz, 'H'), 10) || 0;

            const r = await userApiCall('saleAggregationsReverse', {
                companyId,
                saleData: { total: saleData.total, date: saleData.date, items: saleData.items },
                userId, dateStr, hour,
            });
            if (!r?.success) return { success: false, error: r?.error };

            console.log('✅ All aggregations reversed for cancelled sale');
            return { success: true };
        } catch (e) {
            console.error('Error reversing aggregations:', e);
            return { success: false, error: e.message };
        }
    },



    // ═══════════════════════════════════════════════════════════════
    // REPORTES INSTANTÁNEOS (PRE-CALCULADOS)
    // ═══════════════════════════════════════════════════════════════

    getSalesSummaryByDate: async (date, companyId) => {
        try {
            const r = await userApiCall('report', { companyId: companyId || get().activeCompanyId, name: 'salesSummaryByDate', params: { date } });
            if (!r?.success) return r || { success: false, error: 'Error' };
            const row = r.rows[0][0] || null;
            // Map actual DB columns to expected field names
            const summary = row ? {
                ...row,
                date: row.day,
                total_amount: row.total_sales || 0,
                total_profit: 0, // Not tracked in this table
                total_items_sold: 0,
                total_sales: row.total_orders || 0
            } : null;
            return { success: true, summary };
        } catch (e) {
            console.error('Error getting sales summary:', e);
            return { success: false, error: e.message };
        }
    },

    getSalesSummaryByRange: async (startDate, endDate, companyId) => {
        try {
            const r = await userApiCall('report', { companyId: companyId || get().activeCompanyId, name: 'salesSummaryByRange', params: { startDate, endDate } });
            if (!r?.success) return r || { success: false, error: 'Error' };
            const salesResult = { rows: r.rows[0] };
            const profitResult = { rows: r.rows[1] };

            // Create a map of profit data by day
            const profitByDay = {};
            profitResult.rows.forEach(row => {
                profitByDay[row.day] = row;
            });

            // Merge data: use sales_daily_summary for amounts and product_daily_profit for profit
            const daily = salesResult.rows.map(row => {
                const profitData = profitByDay[row.day] || {};
                return {
                    date: row.day,
                    total_sales: row.total_orders || 0,
                    total_amount: row.total_sales || 0,
                    total_profit: profitData.total_profit || 0,
                    total_cost: profitData.total_cost || 0,
                    total_tax: profitData.total_tax || 0,
                    cash_amount: 0,
                    card_amount: 0,
                    transfer_amount: 0
                };
            });

            const totals = daily.reduce((acc, day) => ({
                totalSales: acc.totalSales + day.total_sales,
                totalAmount: acc.totalAmount + day.total_amount,
                totalCost: acc.totalCost + day.total_cost,
                totalProfit: acc.totalProfit + day.total_profit,
                totalTax: acc.totalTax + day.total_tax,
                cashAmount: 0,
                cardAmount: 0,
                transferAmount: 0
            }), { totalSales: 0, totalAmount: 0, totalCost: 0, totalProfit: 0, totalTax: 0, cashAmount: 0, cardAmount: 0, transferAmount: 0 });

            return { success: true, daily, totals };
        } catch (e) {
            console.error('Error getting sales range:', e);
            return { success: false, error: e.message };
        }
    },

    compareSalesWithPreviousPeriod: async (startDate, endDate, companyId) => {
        try {
            const start = new Date(startDate);
            const end = new Date(endDate);
            const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));

            const prevEnd = new Date(start);
            prevEnd.setDate(prevEnd.getDate() - 1);
            const prevStart = new Date(prevEnd);
            prevStart.setDate(prevStart.getDate() - daysDiff);

            const prevStartStr = prevStart.toLocaleDateString('en-CA');
            const prevEndStr = prevEnd.toLocaleDateString('en-CA');

            const current = await get().getSalesSummaryByRange(startDate, endDate, companyId);
            const previous = await get().getSalesSummaryByRange(prevStartStr, prevEndStr, companyId);

            if (!current.success || !previous.success) {
                return { success: false, error: 'Error fetching data' };
            }

            const comparison = {
                current: current.totals,
                previous: previous.totals,
                changes: {
                    salesChange: ((current.totals.totalSales - previous.totals.totalSales) / (previous.totals.totalSales || 1)) * 100,
                    amountChange: ((current.totals.totalAmount - previous.totals.totalAmount) / (previous.totals.totalAmount || 1)) * 100,
                    profitChange: ((current.totals.totalProfit - previous.totals.totalProfit) / (previous.totals.totalProfit || 1)) * 100
                }
            };

            return { success: true, comparison };
        } catch (e) {
            console.error('Error comparing periods:', e);
            return { success: false, error: e.message };
        }
    },

    getVendorRanking: async (startDate, endDate, companyId) => {
        try {
            const r = await userApiCall('report', { companyId: companyId || get().activeCompanyId, name: 'vendorRanking', params: { startDate, endDate } });
            if (!r?.success) return r || { success: false, error: 'Error' };
            return { success: true, ranking: r.rows[0] };
        } catch (e) {
            console.error('Error getting vendor ranking:', e);
            return { success: false, error: e.message };
        }
    },

    getTopProducts: async (startDate, endDate, limit = 10, companyId) => {
        try {
            const r = await userApiCall('report', { companyId: companyId || get().activeCompanyId, name: 'topProducts', params: { startDate, endDate, limit } });
            if (!r?.success) return r || { success: false, error: 'Error' };
            return { success: true, products: r.rows[0] };
        } catch (e) {
            console.error('Error getting top products:', e);
            return { success: false, error: e.message };
        }
    },

    getBestMarginProducts: async (startDate, endDate, limit = 10, companyId) => {
        try {
            const r = await userApiCall('report', { companyId: companyId || get().activeCompanyId, name: 'bestMarginProducts', params: { startDate, endDate, limit } });
            if (!r?.success) return r || { success: false, error: 'Error' };
            return { success: true, products: r.rows[0] };
        } catch (e) {
            console.error('Error getting best margin products:', e);
            return { success: false, error: e.message };
        }
    },

    getSalesByPaymentMethod: async (startDate, endDate, companyId, userId) => {
        try {
            const cid = companyId || get().activeCompanyId;
            const tz = get().currentCompanyTimezone;
            const utcStart = getStartFromDateString(startDate, tz).toISOString();
            const utcEnd = getEndFromDateString(endDate, tz).toISOString();
            const rep = await userApiCall('report', { companyId: cid, name: 'salesByPaymentMethod', params: { utcStart, utcEnd, userId } });
            if (!rep?.success) return rep || { success: false, error: 'Error' };
            const result = { rows: rep.rows[0] };
            const totalAmount = result.rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
            const totalCount = result.rows.reduce((s, r) => s + (Number(r.count) || 0), 0);
            const methods = result.rows.map(r => ({
                method: r.payment_method || 'Otro',
                amount: Number(r.amount) || 0,
                count: Number(r.count) || 0,
                percentage: totalAmount > 0 ? ((Number(r.amount) || 0) / totalAmount) * 100 : 0
            }));
            return { success: true, methods, totalAmount, totalCount };
        } catch (e) {
            console.error('Error getting sales by payment method:', e);
            return { success: false, error: e.message };
        }
    },

    getVendorTopProducts: async (startDate, endDate, userId, companyId, limit = 10) => {
        try {
            const cid = companyId || get().activeCompanyId;
            const tz = get().currentCompanyTimezone;
            const utcStart = getStartFromDateString(startDate, tz).toISOString();
            const utcEnd = getEndFromDateString(endDate, tz).toISOString();
            const rep = await userApiCall('report', { companyId: cid, name: 'vendorItems', params: { utcStart, utcEnd, userId } });
            if (!rep?.success) return rep || { success: false, error: 'Error' };
            const result = { rows: rep.rows[0] };
            const productMap = {};
            for (const row of result.rows) {
                try {
                    const items = JSON.parse(row.items || '[]');
                    for (const item of items) {
                        const key = item.id || item.name;
                        if (!productMap[key]) {
                            productMap[key] = { name: item.name, quantity: 0, amount: 0 };
                        }
                        productMap[key].quantity += Number(item.qty || item.quantity || 0);
                        productMap[key].amount += Number(item.qty || item.quantity || 0) * Number(item.price || 0);
                    }
                } catch {}
            }
            const products = Object.values(productMap)
                .sort((a, b) => b.quantity - a.quantity)
                .slice(0, limit);
            return { success: true, products };
        } catch (e) {
            console.error('Error getting vendor top products:', e);
            return { success: false, error: e.message };
        }
    },

    getVendorSalesSummary: async (startDate, endDate, companyId) => {
        try {
            const cid = companyId || get().activeCompanyId;
            const tz = get().currentCompanyTimezone;
            const utcStart = getStartFromDateString(startDate, tz).toISOString();
            const utcEnd = getEndFromDateString(endDate, tz).toISOString();
            const rep = await userApiCall('report', { companyId: cid, name: 'vendorSalesSummary', params: { utcStart, utcEnd } });
            if (!rep?.success) return rep || { success: false, error: 'Error' };
            const result = { rows: rep.rows[0] };
            const vendors = result.rows.map(r => ({
                user_id: r.user_id,
                user_name: r.user_name || 'Sin nombre',
                total_sales: Number(r.total_sales) || 0,
                total_amount: Number(r.total_amount) || 0,
                cash: Number(r.cash) || 0,
                card: Number(r.card) || 0,
                transfer: Number(r.transfer) || 0,
                mixed: Number(r.mixed) || 0,
                credit: Number(r.credit) || 0
            }));
            return { success: true, vendors };
        } catch (e) {
            console.error('Error getting vendor sales summary:', e);
            return { success: false, error: e.message };
        }
    },

    getPeakHoursAnalysis: async (startDate, endDate, companyId) => {
        try {
            const r = await userApiCall('report', { companyId: companyId || get().activeCompanyId, name: 'peakHours', params: { startDate, endDate } });
            if (!r?.success) return r || { success: false, error: 'Error' };
            return { success: true, hours: r.rows[0] };
        } catch (e) {
            console.error('Error getting peak hours:', e);
            return { success: false, error: e.message };
        }
    },

    getSupplierPurchaseSummary: async (startDate, endDate, companyId) => {
        try {
            return await userApiCall('supplierPurchaseSummaryGet', {
                companyId: companyId || get().activeCompanyId, startDate, endDate,
            });
        } catch (e) {
            console.error('Error getting supplier summary:', e);
            return { success: false, error: e.message };
        }
    },

    getSlowMovingProducts: async (companyId) => {
        try {
            const r = await userApiCall('report', { companyId: companyId || get().activeCompanyId, name: 'slowMovingProducts', params: {} });
            if (!r?.success) return r || { success: false, error: 'Error' };
            return { success: true, products: r.rows[0] };
        } catch (e) {
            console.error('Error getting slow moving products:', e);
            return { success: false, error: e.message };
        }
    },

    getAggregatedDashboardMetrics: async (companyId) => {
        try {
            const today = new Date().toLocaleDateString('en-CA');
            const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');

            const [todayData, yesterdayData] = await Promise.all([
                get().getSalesSummaryByDate(today, companyId),
                get().getSalesSummaryByDate(yesterday, companyId)
            ]);

            const todaySum = todayData.summary || {};
            const yesterdaySum = yesterdayData.summary || {};

            const metrics = {
                today: {
                    sales: todaySum.total_sales || 0,
                    amount: todaySum.total_amount || 0,
                    profit: todaySum.total_profit || 0,
                    items: todaySum.total_items_sold || 0
                },
                yesterday: {
                    sales: yesterdaySum.total_sales || 0,
                    amount: yesterdaySum.total_amount || 0,
                    profit: yesterdaySum.total_profit || 0,
                    items: yesterdaySum.total_items_sold || 0
                },
                changes: {
                    salesChange: ((todaySum.total_sales || 0) - (yesterdaySum.total_sales || 0)) / ((yesterdaySum.total_sales || 1)) * 100,
                    amountChange: ((todaySum.total_amount || 0) - (yesterdaySum.total_amount || 0)) / ((yesterdaySum.total_amount || 1)) * 100,
                    profitChange: ((todaySum.total_profit || 0) - (yesterdaySum.total_profit || 0)) / ((yesterdaySum.total_profit || 1)) * 100
                }
            };

            return { success: true, metrics };
        } catch (e) {
            console.error('Error getting dashboard metrics:', e);
            return { success: false, error: e.message };
        }
    },

    // ═══════════════════════════════════════════════════════════════
    // MANTENIMIENTO DE AGREGACIONES
    // ═══════════════════════════════════════════════════════════════

    // Server-side (mantenimiento). Ver api/_lib/maintenanceActions.js
    cleanOldProductStats: async (companyId) => {
        const cid = companyId || get().activeCompanyId;
        if (!cid) return { success: false, error: 'Falta companyId' };
        return userApiCall('cleanOldProductStats', { companyId: cid });
    },

    // Server-side (mantenimiento). Ver api/_lib/maintenanceActions.js
    recalculateProductAverages: async (companyId) => {
        const cid = companyId || get().activeCompanyId;
        if (!cid) return { success: false, error: 'Falta companyId' };
        return userApiCall('recalculateProductAverages', { companyId: cid });
    },

    // ==========================================
    // 👑 ADMIN & SAAS ACTIONS
    // ==========================================

    // ==========================================
    // 🏷️ COMPANY MODULE MANAGEMENT (Feature Flags)
    // ==========================================

    fetchCompanyModules: async (companyId) => {
        const targetCompanyId = companyId || get().activeCompanyId;
        if (!targetCompanyId) return [];
        try {
            const rows = await reportRows(targetCompanyId, 'companyModules', {});
            if (!companyId) set({ companyModules: rows });
            return rows;
        } catch (e) {
            console.error('Error fetching company modules:', e);
            return [];
        }
    },

    updateCompanyModule: async (companyId, moduleKey, enabled) => {
        try {
            const r = await userApiCall('companyModuleUpdate', { companyId, moduleKey, enabled });
            if (!r?.success) return r || { success: false, error: 'Error' };
            if (companyId === get().activeCompanyId) await get().fetchCompanyModules();
            return { success: true };
        } catch (e) {
            console.error('Error updating company module:', e);
            return { success: false, error: e.message };
        }
    },

    // Panel super_admin: activa/desactiva módulos/complementos de CUALQUIER empresa
    // sin exigir membresía (god-mode). Va por /api/admin/actions (gate super_admin).
    adminSetCompanyModule: async (companyId, moduleKey, enabled) => {
        const r = await adminApiCall('setCompanyModule', { companyId, moduleKey, enabled });
        if (r?.success && companyId === get().activeCompanyId) await get().fetchCompanyModules();
        return r || { success: false, error: 'Error' };
    },

    // Panel super_admin: overrides de módulos de una empresa (para el modal admin).
    adminFetchCompanyModules: async (companyId) => {
        const r = await adminApiCall('listCompanyModules', { companyId });
        return r?.success ? (r.data || []) : [];
    },

    // Panel super_admin: activar/desactivar complementos (Apps) de cualquier empresa
    // con precio/prueba/gratis (god-mode). Escribe en company_apps (como el Marketplace).
    adminSetCompanyApp: async (companyId, appKey, mode, opts = {}) => {
        const r = await adminApiCall('setCompanyApp', { companyId, appKey, mode, opts });
        if (r?.success && companyId === get().activeCompanyId) await get().fetchCompanyApps();
        return r || { success: false, error: 'Error' };
    },
    adminFetchCompanyApps: async (companyId) => {
        const r = await adminApiCall('listCompanyApps', { companyId });
        return r?.success ? (r.data || []) : [];
    },

    // ¿La empresa/sucursal activa tiene una App activa o con prueba vigente?
    // Los complementos son exclusivos de cuentas Profesional: si el plan baja a
    // Standard, sus Apps dejan de aplicar (aunque quede la fila de prueba).
    hasApp: (appKey) => {
        if (!appKey) return false;
        const { companyApps, currentPlanLevel } = get();
        if ((currentPlanLevel ?? 2) < 2) return false;
        const a = companyApps?.find(x => x.app_key === appKey);
        if (!a) return false;
        const now = new Date();
        // Fin del período vigente (pagado o de prueba). NULL = sin vencimiento
        // (grandfather). Una App cancelada (will_renew=0) sigue activa hasta aquí.
        const periodEnd = a.period_end || a.trial_ends_at || null;
        if (a.status === 'active') {
            return !periodEnd || new Date(periodEnd) >= now;
        }
        if (a.status === 'trial') {
            return !periodEnd || new Date(periodEnd) >= now;
        }
        return false; // cancelled / desconocido
    },

    hasModule: (moduleKey) => {
        const { companyModules, currentPlanLevel } = get();

        // El acceso a módulos en la app lo gobierna el PLAN de la empresa activa
        // (también para super_admin/owner: si entra a una empresa Standard, ve Standard).
        // La gestión de plataforma (god-mode) vive en el panel /admin, que no usa hasModule.

        // 1) Override explícito por empresa (el admin puede otorgar/revocar un módulo puntual).
        const record = companyModules?.find(m => m.module_key === moduleKey);
        if (record) return Number(record.enabled) === 1;

        // 2) Módulo vendido como complemento (App) → el gate es la App contratada,
        //    no el plan. (Cocina, Integración, Báscula, Tienda Web…)
        const mod = getModuleByKey(moduleKey);
        if (mod?.appKey) return get().hasApp(mod.appKey);

        // 3) Gate por plan: el plan activo debe alcanzar el nivel mínimo del módulo.
        //    currentPlanLevel null (aún sin cargar) → no restringir, para no parpadear bloqueos.
        const minLevel = mod?.minLevel ?? 0;
        const level = (currentPlanLevel == null) ? 2 : currentPlanLevel;
        return level >= minLevel;
    },

    // Complementos (Apps): listar/activar (prueba 30 días)/cancelar. Ver appActions.js
    fetchCompanyApps: async () => {
        const { activeCompanyId } = get();
        if (!activeCompanyId) return [];
        const r = await userApiCall('appList', { companyId: activeCompanyId });
        const apps = r?.success ? (r.apps || []) : [];
        set({ companyApps: apps });
        return apps;
    },

    activateApp: async (appKey) => {
        const { activeCompanyId, currentCurrency } = get();
        if (!activeCompanyId) return { success: false, error: 'Sesión no válida' };
        const r = await userApiCall('appActivate', { companyId: activeCompanyId, appKey, currency: currentCurrency || 'CLP' });
        if (r?.success) await get().fetchCompanyApps();
        return r || { success: false, error: 'Error' };
    },

    cancelApp: async (appKey) => {
        const { activeCompanyId } = get();
        if (!activeCompanyId) return { success: false, error: 'Sesión no válida' };
        const r = await userApiCall('appCancel', { companyId: activeCompanyId, appKey });
        if (r?.success) await get().fetchCompanyApps();
        return r || { success: false, error: 'Error' };
    },

    // Cotización del prorrateo de una App (para el modal de pago). El cobro real
    // lo recalcula /api/subscribe (kind:'app'); esto es solo para mostrar el monto.
    fetchAppChargeQuote: async (appKey) => {
        const { activeCompanyId } = get();
        if (!activeCompanyId) return null;
        const r = await userApiCall('appChargeQuote', { companyId: activeCompanyId, appKey });
        return r?.success ? r : null;
    },

    // Admin (server-side): todas las empresas con su suscripción. Ver api/admin/actions.js
    fetchAllSubscriptions: async () => {
        const r = await adminApiCall('listSubscriptions');
        if (!r?.success) throw new Error(r?.error || 'No autorizado');
        return r.data || [];
    },

    // Server-side (exige sesión super_admin). Ver api/admin/actions.js
    toggleCompanyStatus: async (companyId, newStatus) => adminApiCall('setCompanyStatus', { companyId, status: newStatus }),

    // Admin: fijar estado y/o fecha de caducidad (access_until). Activar/extender u overrides manuales.
    adminSetCompanyAccess: async (companyId, { status, accessUntil } = {}) => adminApiCall('setCompanyAccess', { companyId, status, accessUntil }),

    // Admin: cambiar el PLAN de una empresa (standard/professional). Define el gating por plan.
    adminSetCompanyPlan: async (companyId, plan) => adminApiCall('setCompanyPlan', { companyId, plan }),

    // Admin: monitoreo de uso por cliente (quién trabaja en el sistema y quién se enfrió).
    adminFetchClientActivity: async () => adminApiCall('clientActivity', {}),

    // Server-side (exige sesión super_admin): borra la empresa y sus datos. Ver api/admin/actions.js
    deleteCompany: async (companyId) => adminApiCall('deleteCompany', { companyId }),

    // Server-side (exige sesión super_admin). Ver api/admin/actions.js
    adminCreateSubscription: async (companyId, planId = 'monthly', amount = 30000) => {
        return adminApiCall('createManualSubscription', { companyId, planId, amount });
    },

    // Cliente registra que hizo una transferencia → queda pendiente de aprobación manual
    // receiptData: data URL (imagen comprimida o PDF) del comprobante, opcional.
    registerTransferIntent: async ({ companyId, planId, billingCycle, amount, currency, planName, receiptData }) => {
        const cid = companyId || get().activeCompanyId;
        return userApiCall('transferIntentCreate', { companyId: cid, planId, billingCycle, amount, currency, planName, receiptData });
    },

    // Admin: todos los pagos de todas las empresas (con nombre de empresa).
    // NO trae el blob del comprobante (receipt_url) para no inflar la lista; solo
    // un flag has_receipt. El comprobante se carga bajo demanda con fetchPaymentReceipt.
    // Admin (server-side): todos los pagos (con flag has_receipt). Ver api/admin/actions.js
    fetchAllPayments: async () => {
        const r = await adminApiCall('listPayments');
        return r?.success ? (r.data || []) : [];
    },

    // Admin (server-side): comprobante (data URL) de un pago, bajo demanda.
    fetchPaymentReceipt: async (paymentId) => {
        const r = await adminApiCall('getPaymentReceipt', { paymentId });
        return r?.success ? (r.data || null) : null;
    },

    // Admin: aprobar un pago (ej. transferencia) → activa la suscripción de la empresa
    // Server-side (exige sesión super_admin): aprueba el pago, crea la suscripción y activa la empresa.
    adminApprovePayment: async (paymentId) => adminApiCall('approvePayment', { paymentId }),

    // Admin: rechazar un pago pendiente (server-side).
    adminRejectPayment: async (paymentId) => adminApiCall('rejectPayment', { paymentId }),

    // Config global de medios de pago de suscripción (datos de transferencia / PayPal)
    fetchPaymentSettings: async () => {
        try {
            const r = await userApiCall('paymentSettingsGet', { companyId: get().activeCompanyId });
            return r?.success ? r.config : null;
        } catch (e) {
            console.error("Error fetching payment settings:", e);
            return null;
        }
    },

    // Config global de suscripción → escritura solo super_admin (endpoint admin)
    savePaymentSettings: async (config) => {
        try {
            const r = await adminApiCall('savePaymentSettings', { config });
            return r?.success ? { success: true } : (r || { success: false, error: 'Error' });
        } catch (e) {
            console.error("Error saving payment settings:", e);
            return { success: false, error: e.message };
        }
    },

    // ==========================================
    // PREORDERS (ENCARGOS) MODULE
    // ==========================================

    preorders: [],
    preorderCart: [],
    _preorderCache: { key: '', products: [], ts: 0 },
    _preorderIndexEnsured: false,

    addToPreorderCart: (product) => {
        set(state => {
            const billingUnit = product.preorder_billing_unit || 'unit';
            const useBasePrice = product.preorder_use_base_price !== 0; // default true (1)
            const effectivePrice = (product.is_offer && product.offer_price > 0)
                ? product.offer_price : product.price;

            // Resolve actual price for preorder
            const resolvedPrice = useBasePrice ? effectivePrice : (parseFloat(product.preorder_price_per_kg) || 0);

            // If billing by kg, resolvedPrice is per_kg. If unit, it's unit_price.
            const pricePerKg = billingUnit === 'kg' ? resolvedPrice : 0;
            const gramPerUnit = parseFloat(product.preorder_gram_per_unit) || 0;

            // Helper to calculate estimated line total
            const calcEstimated = (qty) => {
                if (billingUnit === 'kg') {
                    if (pricePerKg > 0 && gramPerUnit > 0) {
                        return qty * (gramPerUnit / 1000) * pricePerKg;
                    }
                    return null; // Pending calculation
                }
                return qty * (billingUnit === 'kg' ? 0 : resolvedPrice);
            };

            const existing = state.preorderCart.find(i => i.id === product.id);
            if (existing) {
                const newQty = existing.qty + 1;
                return {
                    preorderCart: state.preorderCart.map(i =>
                        i.id === product.id
                            ? { ...i, qty: newQty, line_total: calcEstimated(newQty) }
                            : i
                    )
                };
            }
            return {
                preorderCart: [...state.preorderCart, {
                    id: product.id,
                    product_id: product.id,
                    product_name: product.name,
                    qty: 1,
                    unit: product.preorder_unit || product.unit || 'Und',
                    unit_price: billingUnit === 'unit' ? resolvedPrice : effectivePrice, // display base price if billing by kg?
                    billing_unit: billingUnit,
                    price_per_kg: pricePerKg,
                    gram_per_unit: gramPerUnit,
                    line_total: calcEstimated(1),
                    note: '',
                    allow_item_notes: product.allow_item_notes
                }]
            };
        });
    },

    updatePreorderCartItem: (productId, updates) => {
        set(state => ({
            preorderCart: state.preorderCart.map(i => {
                if (i.id !== productId) return i;
                const updated = { ...i, ...updates };
                // Recalculate estimated total based on billing mode
                if (updated.billing_unit === 'kg') {
                    if (parseFloat(updated.price_per_kg) > 0 && parseFloat(updated.gram_per_unit) > 0) {
                        updated.line_total = updated.qty * (parseFloat(updated.gram_per_unit) / 1000) * parseFloat(updated.price_per_kg);
                    } else {
                        updated.line_total = null; // Pending
                    }
                } else {
                    updated.line_total = updated.qty * updated.unit_price;
                }
                return updated;
            })
        }));
    },

    removeFromPreorderCart: (productId) => {
        set(state => ({
            preorderCart: state.preorderCart.filter(i => i.id !== productId)
        }));
    },

    clearPreorderCart: () => set({ preorderCart: [] }),

    // Suma (IN) o resta (OUT) efectivo de un encargo a la caja ABIERTA del
    // momento, vía cash_movements. Así el cobro/devolución de encargos en
    // efectivo se refleja en la caja en tiempo real (igual que las ventas POS).
    // Solo aplica a efectivo; tarjeta/transferencia no tocan la caja física.
    // Si no hay caja abierta o el monto es 0, no hace nada (no se puede sumar
    // a una caja cerrada).
    /**
     * La caja abierta del usuario, volviendo a preguntarle al SERVIDOR si el estado
     * local viene vacío. El estado se queda atrás cuando la caja se abre en otra
     * pestaña o después de que se cargó la pantalla actual, y darlo por bueno sin
     * confirmar hacía que un abono en efectivo no entrara a ninguna caja.
     */
    _ensureCashRegister: async () => {
        const actual = get().cashRegister;
        if (actual?.id) return actual;
        const uid = get().currentUser?.id;
        if (!uid) return null;
        await get().checkRegisterStatus(uid);
        return get().cashRegister || null;
    },

    _registerPreorderCash: async ({ amount, reason, direction = 'IN' }) => {
        try {
            const { activeCompanyId } = get();
            const amt = Number(amount) || 0;
            if (amt <= 0) return { skipped: true };

            // Es plata que ya cambió de manos: si no hay caja donde anotarla, se
            // avisa. Antes se devolvía `skipped` en silencio y el efectivo
            // desaparecía sin que nadie se enterara hasta el arqueo.
            const cashRegister = await get()._ensureCashRegister();
            if (!cashRegister?.id) {
                console.error('Efectivo de encargo sin caja donde registrarlo:', reason, amt);
                return { success: false, noRegister: true, error: 'No tienes una caja abierta' };
            }

            const r = await userApiCall('cashMovementAdd', {
                companyId: activeCompanyId,
                registerId: cashRegister.id,
                type: direction,
                amount: amt,
                reason,
                date: new Date().toISOString(),
            });
            if (!r?.success) return { success: false, error: r?.error };
            get().refreshRegisterStats(cashRegister.id);
            return { success: true };
        } catch (e) {
            console.error('Error registrando efectivo de encargo en caja:', e);
            return { success: false, error: e.message };
        }
    },

    createPreorder: async (preorderData) => {
        const { activeCompanyId } = get();
        try {
            // Server-side (Fase 1 · Paso 15): INSERT encargo + items + abono inicial
            // La caja se resuelve ANTES de crear (consultando al servidor si el
            // estado local viene vacío): así el abono queda enlazado a ella en
            // preorder_payments.register_id y no huérfano.
            const reg = await get()._ensureCashRegister();
            const regId = reg?.id || null;
            const r = await userApiCall('preorderCreate', { companyId: activeCompanyId, preorderData, registerId: regId });
            if (!r?.success) return r || { success: false, error: 'Error creando encargo' };
            const preorderId = r.preorderId;

            // Efectivo del abono → movimiento de caja (vía API); tarjeta/transf → refresh stats
            let cashWarning = null;
            if (preorderData.deposit_amount > 0) {
                const depositMethod = preorderData.deposit_method || 'Efectivo';
                if (depositMethod === 'Efectivo') {
                    const cash = await get()._registerPreorderCash({
                        amount: preorderData.deposit_amount,
                        reason: `Abono encargo #${preorderId} - ${preorderData.client_name || 'Cliente'}`.trim()
                    });
                    // El abono es plata recibida: si no llegó a ninguna caja hay que
                    // decirlo, o la falta recién aparece al cuadrar el turno.
                    if (cash?.noRegister) {
                        cashWarning = 'El abono en efectivo NO entró a ninguna caja porque no tienes una caja abierta. Ábrela y regístralo como ingreso.';
                    }
                } else if (regId && (depositMethod === 'Tarjeta' || depositMethod === 'Transferencia')) {
                    get().refreshRegisterStats(regId);
                }
            }

            // Refresh list
            await get().fetchPreorders();
            get().fetchOrderBadges(); // nuevo encargo → actualizar contador de la pestaña
            set({ preorderCart: [] });

            // Empuje a miniveci (best-effort, no bloquea). Si el cliente tiene
            // cuenta en la web, miniveci lo asocia y este encargo aparece en
            // su historial. Si la integración no está activa o el cliente no es
            // identificable, el endpoint hace skip silencioso.
            if (typeof navigator !== 'undefined' && navigator.onLine) {
                fetch('/api/integration/push-preorder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ preorder_id: preorderId }),
                }).catch(() => { /* fire-and-forget */ });
            }

            return { success: true, preorderId, cashWarning };
        } catch (e) {
            console.error('Error creating preorder:', e);
            return { success: false, error: e.message };
        }
    },

    fetchPreorders: async (filters = {}) => {
        const { activeCompanyId } = get();
        try {
            const r = await userApiCall('preordersFetch', { companyId: activeCompanyId, filters });
            if (!r?.success) return r || { success: false, error: 'Error' };
            set({ preorders: r.preorders });
            return { success: true, preorders: r.preorders };
        } catch (e) {
            console.error('Error fetching preorders:', e);
            return { success: false, error: e.message };
        }
    },

    // ── Avisos de encargos web (miniveci) ────────────────────────────────
    // Tarjeta "Encargo amasandería" que aparece abajo a la izquierda y en la
    // campanita cuando entra un encargo desde la web. Visible para todas las
    // sesiones abiertas. La lista se reconcilia contra la DB para sobrevivir
    // recargas y caerse sola cuando alguien ya lo atendió.
    webOrders: [],                 // encargos web pendientes (toast + campanita)
    dismissedWebOrderToasts: [],   // ids cuyo toast se cerró con la X (siguen en campanita)
    orderBadges: { encargo: 0, store: 0 }, // conteo de pedidos activos por tipo (badges de pestañas)

    // Devuelve true solo si agregó un encargo NUEVO (para sonar el aviso una vez,
    // no en duplicados ni en encargos de otra empresa).
    pushWebOrder: (data) => {
        if (!data || !data.id) return false;
        const active = get().activeCompanyId;
        if (data.company_id && active && String(data.company_id) !== String(active)) return false;
        if (get().webOrders.some(o => o.id === data.id)) return false;
        const itemsSummary = Array.isArray(data.items)
            ? data.items.map(i => `${i.name} x${i.qty}`).join(', ')
            : (data.items_summary || '');
        const order = {
            id: data.id,
            public_code: data.public_code || null,
            client_name: data.client_name || 'Cliente web',
            items_summary: itemsSummary,
            due_date: data.due_date || null,
            due_time: data.due_time || null,
            total: Number(data.total ?? data.total_amount) || 0,
            order_kind: data.order_kind === 'store' ? 'store' : 'encargo',
        };
        set((state) => ({ webOrders: [order, ...state.webOrders] }));
        return true;
    },

    dismissWebOrderToast: (id) => {
        set((state) => state.dismissedWebOrderToasts.includes(id)
            ? {}
            : { dismissedWebOrderToasts: [...state.dismissedWebOrderToasts, id] });
    },

    removeWebOrder: (id) => {
        set((state) => ({
            webOrders: state.webOrders.filter(o => o.id !== id),
            dismissedWebOrderToasts: state.dismissedWebOrderToasts.filter(x => x !== id),
        }));
    },

    // Conteo de pedidos activos por tipo, para los badges de las pestañas
    // Encargos/Tienda. Se refresca en el mismo ciclo que los pedidos web (canal
    // en vivo + montaje de páginas) y tras cambios de estado.
    fetchOrderBadges: async () => {
        const { activeCompanyId } = get();
        if (!activeCompanyId) return;
        try {
            // "Hoy" en hora local (mismo criterio que la pestaña Encargos).
            const today = new Date().toLocaleDateString('en-CA');
            const r = await userApiCall('preorderActiveCounts', { companyId: activeCompanyId, today });
            if (r?.success && r.counts) set({ orderBadges: r.counts });
        } catch (e) {
            console.error('Error fetching order badges:', e);
        }
    },

    fetchPendingWebOrders: async () => {
        const { activeCompanyId } = get();
        if (!activeCompanyId) return;
        try {
            const result = await userApiCall('pendingWebOrders', { companyId: activeCompanyId });
            if (!result?.success) return;
            const rows = (result.rows || []).map(r => ({
                id: r.id,
                public_code: r.public_code || null,
                client_name: r.client_name || 'Cliente web',
                items_summary: r.items_summary || '',
                due_date: r.due_date || null,
                due_time: r.due_time || null,
                total: Number(r.total_amount) || 0,
                order_kind: r.order_kind === 'store' ? 'store' : 'encargo',
            }));
            set((state) => {
                const pendingIds = new Set(rows.map(r => r.id));
                return {
                    webOrders: rows,
                    dismissedWebOrderToasts: state.dismissedWebOrderToasts.filter(id => pendingIds.has(id)),
                };
            });
        } catch (e) {
            console.error('Error fetching pending web orders:', e);
        }
    },

    getPreorderDetails: async (preorderId) => {
        try {
            // Server-side (con guard: el encargo debe ser de la empresa)
            return await userApiCall('preorderDetails', { companyId: get().activeCompanyId, preorderId });
        } catch (e) {
            console.error('Error getting preorder details:', e);
            return { success: false, error: e.message };
        }
    },

    // Edita los productos de un pedido de tienda (agregar/quitar/cambiar cantidad).
    // Recalcula total y saldo server-side; el saldo se cobra/devuelve al entregar.
    editPreorderItems: async (preorderId, items, refetchFilters = undefined) => {
        try {
            const r = await userApiCall('preorderItemsEdit', { companyId: get().activeCompanyId, preorderId, items });
            if (r?.success) await get().fetchPreorders(refetchFilters);
            return r || { success: false, error: 'Error' };
        } catch (e) {
            console.error('Error editing preorder items:', e);
            return { success: false, error: e.message };
        }
    },

    updatePreorderStatus: async (preorderId, newStatus, reason = null, refetchFilters = undefined) => {
        try {
            // Server-side (con guard de empresa): update + cálculo de efectivo a devolver
            const r = await userApiCall('preorderStatusUpdate', { companyId: get().activeCompanyId, preorderId, newStatus, reason });
            if (!r?.success) return r || { success: false, error: 'Error' };

            // Si se canceló: devolver el efectivo desde la caja abierta del cajero
            let cashWarning = null;
            if (r.cashPaid > 0) {
                const cash = await get()._registerPreorderCash({
                    amount: r.cashPaid,
                    reason: `Devolución abono encargo #${preorderId} - ${r.clientName || ''}`.trim(),
                    direction: 'OUT'
                });
                if (cash?.noRegister) {
                    cashWarning = 'La devolución en efectivo NO quedó registrada en ninguna caja porque no tienes una caja abierta.';
                }
            }

            // refetchFilters: la pestaña Tienda pasa { kind: 'store', ... } para
            // que el refetch no pise la lista con encargos (default del server).
            await get().fetchPreorders(refetchFilters);
            get().fetchOrderBadges(); // el cambio de estado altera el conteo activo

            // Aviso saliente a miniveci si el encargo está sincronizado con la web.
            const info = { external_public_code: r.externalPublicCode };
            if (info.external_public_code) {
                fetch('/api/integration/notify-miniveci-status', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        public_code: info.external_public_code,
                        status: newStatus,
                        ...(reason && reason.trim() ? { reason: reason.trim() } : {}),
                    }),
                }).catch(err => console.warn('notify-miniveci failed', err));
            }

            return { success: true, cashWarning };
        } catch (e) {
            console.error('Error updating preorder status:', e);
            return { success: false, error: e.message };
        }
    },

    addPreorderPayment: async (preorderId, amount, method, type = 'final', { terminalId = null, bankAccountId = null, authCode = null } = {}) => {
        try {
            // Igual que al crear: se confirma la caja con el servidor antes de
            // enlazar el pago, para que no quede sin caja por estado desactualizado.
            const regId = (await get()._ensureCashRegister())?.id || null;

            // Server-side (con guard de empresa): pago + totales + delivered si corresponde
            const r = await userApiCall('preorderPaymentAdd', {
                companyId: get().activeCompanyId,
                preorderId, amount, method, type,
                registerId: regId, terminalId, bankAccountId, authCode,
            });
            if (!r?.success) return r || { success: false, error: 'Error' };

            // Si el pago fue en efectivo, sumarlo a la caja abierta.
            let cashWarning = null;
            if (method === 'Efectivo') {
                const cash = await get()._registerPreorderCash({
                    amount,
                    reason: `Pago encargo #${preorderId}`
                });
                if (cash?.noRegister) {
                    cashWarning = 'El pago en efectivo NO entró a ninguna caja porque no tienes una caja abierta. Ábrela y regístralo como ingreso.';
                }
            } else if (regId && (method === 'Tarjeta' || method === 'Transferencia')) {
                get().refreshRegisterStats(regId);
            }

            await get().fetchPreorders();
            return { success: true, cashWarning };
        } catch (e) {
            console.error('Error adding preorder payment:', e);
            return { success: false, error: e.message };
        }
    },

    getPreorderableProducts: async (searchTerm = '', category = 'Todos') => {
        const { activeCompanyId, _preorderCache } = get();
        const cacheKey = `${activeCompanyId}|${searchTerm}|${category}`;

        // Helper: filtrar+formatear desde cualquier lista de productos
        const filterAndFormat = (rows) => {
            const term = String(searchTerm || '').toLowerCase();
            let out = (rows || []).filter(p =>
                p && (p.sale_mode === 'preorder_only' || p.sale_mode === 'both')
            );
            if (category && category !== 'Todos') out = out.filter(p => p.category === category);
            if (term) out = out.filter(p =>
                (p.name && String(p.name).toLowerCase().includes(term)) ||
                (p.sku && String(p.sku).toLowerCase().includes(term))
            );
            out.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
            return out.slice(0, 50).map(p => ({
                ...p,
                price_ranges: typeof p.price_ranges === 'string'
                    ? (() => { try { return JSON.parse(p.price_ranges); } catch { return []; } })()
                    : (p.price_ranges || [])
            }));
        };

        // Refresco silencioso vía API → actualiza Dexie + caché
        const refreshFromTurso = async () => {
            if (typeof navigator !== 'undefined' && !navigator.onLine) return;
            try {
                const result = await userApiCall('preorderableProducts', { companyId: activeCompanyId });
                if (!result?.success) return;
                // Actualizar Dexie con productos preorder (upsert)
                try {
                    const stamped = result.rows.map(r => ({ ...r, companyId: activeCompanyId }));
                    await localDb.products.bulkPut(stamped);
                } catch (dexErr) {
                    console.warn('No se pudo actualizar Dexie con preorder:', dexErr.message);
                }
                // Marcar timestamp de último refresco
                try {
                    localStorage.setItem(`_preTs_${activeCompanyId}`, String(Date.now()));
                } catch { /* noop */ }
                // Si la búsqueda actual coincide, actualizar caché de UI
                const products = filterAndFormat(result.rows);
                set({ _preorderCache: { key: cacheKey, products, ts: Date.now() } });
            } catch (e) {
                console.warn('Refresh preorder Turso falló:', e?.message);
            }
        };

        // 1) Caché en memoria
        if (_preorderCache.key === cacheKey && Date.now() - _preorderCache.ts < 5 * 60 * 1000) {
            // Si la última sincronización con Turso fue hace >5min, refrescar en background
            try {
                const lastSync = parseInt(localStorage.getItem(`_preTs_${activeCompanyId}`) || '0', 10);
                if (Date.now() - lastSync > 5 * 60 * 1000) refreshFromTurso();
            } catch { /* noop */ }
            return { success: true, products: _preorderCache.products };
        }

        // 2) DEXIE PRIMERO — siempre, instantáneo
        try {
            const all = await localDb.products
                .where('companyId').equals(activeCompanyId).toArray();
            if (all.length > 0) {
                const products = filterAndFormat(all);
                set({ _preorderCache: { key: cacheKey, products, ts: Date.now() } });

                // Refrescar Turso en background si la última sync fue hace >5min
                try {
                    const lastSync = parseInt(localStorage.getItem(`_preTs_${activeCompanyId}`) || '0', 10);
                    if (Date.now() - lastSync > 5 * 60 * 1000) refreshFromTurso();
                } catch { /* noop */ }

                return { success: true, products };
            }
        } catch (e) {
            console.warn('Dexie preorder lookup falló:', e?.message);
        }

        // 3) Sin datos locales: pedir a Turso (primera vez después de login)
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            return { success: false, error: 'Sin conexión y sin catálogo local' };
        }
        try {
            const result = await userApiCall('preorderableProducts', { companyId: activeCompanyId });
            if (!result?.success) return { success: false, error: result?.error || 'Error' };
            // Guardar en Dexie para próximas veces
            try {
                const stamped = result.rows.map(r => ({ ...r, companyId: activeCompanyId }));
                await localDb.products.bulkPut(stamped);
                localStorage.setItem(`_preTs_${activeCompanyId}`, String(Date.now()));
            } catch { /* noop */ }
            const products = filterAndFormat(result.rows);
            set({ _preorderCache: { key: cacheKey, products, ts: Date.now() } });
            return { success: true, products };
        } catch (e) {
            console.error('Error fetching preorderable products:', e);
            return { success: false, error: e.message };
        }
    },

    invalidatePreorderCache: () => set({ _preorderCache: { key: '', products: [], ts: 0 } }),

    getPreorderReports: async (startDate, endDate) => {
        const { activeCompanyId } = get();
        try {
            console.log("Generando reporte de VENTAS por encargo (solo entregados):", startDate, endDate);

            // REPORTE DE VENTAS POR ENCARGO — solo cuenta encargos ENTREGADOS.
            //
            // Reglas de negocio (definidas con el usuario 2026-05-22):
            //   · Un encargo es VENTA solo cuando status = 'delivered'.
            //   · Pendientes / confirmados / en preparación / listos = pipeline,
            //     NO son venta todavía → excluidos.
            //   · Cancelados (abono devuelto) = no es venta → excluidos.
            //   · Se filtra por delivered_at (fecha de ENTREGA real), no por
            //     created_at: un encargo creado ayer y entregado hoy es venta de hoy.
            //   · Montos REALES: real_total del encargo y real_total/real_weight_kg
            //     por item (lo que efectivamente se pesó y cobró), con fallback a
            //     los estimados para datos viejos sin real_*.
            //
            // Server-side (Fase 1 · Paso 17): las 4 queries corren en el API
            const raw = await userApiCall('preorderReportsRaw', { companyId: activeCompanyId, startDate, endDate });
            if (!raw?.success) return raw || { success: false, error: 'Error' };
            const summary = raw.summary;

            // 2. Por Estado — solo hay 'delivered'. Se mantiene por compatibilidad
            //    con el componente (pie chart). Mostrará una sola porción.
            const byStatus = [{
                status: 'delivered',
                count: summary?.total_orders || 0,
                total: summary?.total_revenue || 0,
            }];

            // 3-5. Por Producto / Por Cliente / Detalles (crudos del servidor)
            const byProduct = (raw.byProduct || []).map(p => ({
                ...p,
                profit: (p.revenue || 0) - (p.approximate_cost || 0)
            }));
            const byClient = raw.byClient || [];
            const details = raw.details || [];

            return {
                success: true,
                summary,
                byStatus,
                byProduct,
                byClient,
                details
            };

        } catch (e) {
            console.error("Error generating preorder reports:", e);
            return { success: false, error: e.message };
        }
    },

    // Dashboard de inteligencia de encargos (Pedidos → Historial).
    // Eje temporal: due_date (fecha de ENTREGA del encargo) — matchea con
    // Producción y con la operativa de la panadería ("¿qué fue para hoy?").
    // Responde: cuántos encargos eran para el período, qué pasó con ellos
    // (entregado/cancelado/en proceso), cuánto se vendió, medios de pago,
    // días pico, productos/clientes top, y crecimiento vs el período anterior.
    // due_date se guarda como 'YYYY-MM-DD' → comparación directa sin SUBSTR.
    getPreorderAnalytics: async (startDate, endDate) => {
        const { activeCompanyId } = get();
        try {
            // due_date es string 'YYYY-MM-DD' → BETWEEN directo, sin SUBSTR.
            const df = '__col__ BETWEEN ? AND ?';

            // Período anterior equivalente (misma duración, justo antes) para growth.
            const sd = new Date(`${startDate}T00:00:00Z`);
            const ed = new Date(`${endDate}T00:00:00Z`);
            const days = Math.max(0, Math.round((ed - sd) / 86400000)) + 1;
            const prevEnd = new Date(sd.getTime() - 86400000);
            const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86400000);
            const iso = (d) => d.toISOString().slice(0, 10);
            const prevStartStr = iso(prevStart);
            const prevEndStr = iso(prevEnd);

            // Server-side (Fase 1 · Paso 17): las 7 queries corren en el API.
            const rawA = await userApiCall('preorderAnalyticsRaw', { companyId: activeCompanyId, startDate, endDate, prevStartStr, prevEndStr });
            if (!rawA?.success) return rawA || { success: false, error: 'Error' };
            const [statusRes, moneyRes, payRes, dailyRes, productRes, clientRes, prevRes] =
                rawA.rows.map(rows => ({ rows }));

            const money = moneyRes.rows[0] || {};
            const totalOrders = Number(money.total_orders) || 0;
            const deliveredCount = Number(money.delivered_count) || 0;
            const canceledCount = Number(money.canceled_count) || 0;
            const inprocessCount = Number(money.inprocess_count) || 0;
            const revenue = Number(money.revenue) || 0;

            // Tasas: cumplimiento = entregados / (entregados + cancelados resueltos)
            const resolved = deliveredCount + canceledCount;
            const fulfillmentRate = resolved > 0 ? (deliveredCount / resolved) * 100 : 0;
            const cancellationRate = totalOrders > 0 ? (canceledCount / totalOrders) * 100 : 0;

            // Growth vs período anterior
            const prev = prevRes.rows[0] || {};
            const prevRevenue = Number(prev.revenue) || 0;
            const prevOrders = Number(prev.total_orders) || 0;
            const pct = (cur, prv) => {
                if (prv === 0) return cur > 0 ? 100 : 0;
                return ((cur - prv) / prv) * 100;
            };

            // Día pico (más encargos)
            const daily = dailyRes.rows.map(r => ({
                day: r.day,
                orders: Number(r.orders) || 0,
                delivered: Number(r.delivered) || 0,
                revenue: Number(r.revenue) || 0
            }));
            const peakDay = daily.reduce((max, d) => (d.orders > (max?.orders || 0) ? d : max), null);

            return {
                success: true,
                summary: {
                    totalOrders,
                    deliveredCount,
                    canceledCount,
                    inprocessCount,
                    revenue,
                    pipelineValue: Number(money.pipeline_value) || 0,
                    totalDeposits: Number(money.total_deposits) || 0,
                    avgTicket: Number(money.avg_ticket) || 0,
                    fulfillmentRate,
                    cancellationRate,
                },
                byStatus: statusRes.rows.map(r => ({
                    status: r.status,
                    count: Number(r.count) || 0,
                    amount: Number(r.amount) || 0
                })),
                byPaymentMethod: payRes.rows.map(r => ({
                    method: r.method,
                    orders: Number(r.orders) || 0,
                    total: Number(r.total) || 0
                })),
                daily,
                peakDay,
                byProduct: productRes.rows.map(r => ({
                    name: r.name,
                    sku: r.sku,
                    billing_unit: r.billing_unit,
                    quantity: Number(r.quantity) || 0,
                    revenue: Number(r.revenue) || 0,
                    orders: Number(r.orders) || 0
                })),
                byClient: clientRes.rows.map(r => ({
                    client_name: r.client_name,
                    phone: r.phone,
                    orders_count: Number(r.orders_count) || 0,
                    delivered_count: Number(r.delivered_count) || 0,
                    canceled_count: Number(r.canceled_count) || 0,
                    total_spend: Number(r.total_spend) || 0
                })),
                growth: {
                    revenueChange: pct(revenue, prevRevenue),
                    ordersChange: pct(totalOrders, prevOrders),
                    prevRevenue,
                    prevOrders,
                    prevStart: prevStartStr,
                    prevEnd: prevEndStr,
                }
            };
        } catch (e) {
            console.error("Error generating preorder analytics:", e);
            return { success: false, error: e.message };
        }
    },

    deliverPreorder: async (preorderId, itemWeights, paymentMethod = 'Efectivo', { terminalId = null, bankAccountId = null, authCode = null } = {}) => {
        try {
            // Server-side (Fase 1 · Paso 16): snapshot costo/tax, items reales,
            // pago final y marca delivered. El efectivo/caja, agregaciones y
            // notificación web se mantienen aquí (ya van por API).
            const regId = (await get()._ensureCashRegister())?.id || null;
            const r = await userApiCall('preorderDeliver', {
                companyId: get().activeCompanyId,
                preorderId, itemWeights, paymentMethod,
                registerId: regId, terminalId, bankAccountId, authCode,
            });
            if (!r?.success) return r || { success: false, error: 'Error entregando encargo' };

            const { realTotal, balanceDue } = r;

            let cashWarning = null;
            if (balanceDue > 0) {
                if (paymentMethod === 'Efectivo') {
                    const cash = await get()._registerPreorderCash({
                        amount: balanceDue,
                        reason: `Cobro encargo #${preorderId}`
                    });
                    if (cash?.noRegister) {
                        cashWarning = 'El cobro en efectivo NO entró a ninguna caja porque no tienes una caja abierta. Ábrela y regístralo como ingreso.';
                    }
                } else if (regId && (paymentMethod === 'Tarjeta' || paymentMethod === 'Transferencia')) {
                    get().refreshRegisterStats(regId);
                }
            }

            // Las agregaciones (reporte de productos) las hace ahora `preorderDeliver`
            // en la misma petición que la entrega. Hacerlo acá dependía de que la
            // pestaña siguiera viva y no estaba llegando: los productos vendidos solo
            // por encargo quedaban en 0 en el reporte. Si se reactiva desde el
            // navegador, cada encargo se contaría dos veces.
            if (r.aggregationError) {
                console.error('El encargo se entregó pero no entró a los reportes:', r.aggregationError);
            }

            // Aviso a miniveci si el encargo está sincronizado con la web
            if (r.externalPublicCode && typeof navigator !== 'undefined' && navigator.onLine) {
                fetch('/api/integration/notify-miniveci-status', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ public_code: r.externalPublicCode, status: 'delivered' }),
                }).catch(() => { /* fire-and-forget */ });
            }

            await get().fetchPreorders();
            return { success: true, realTotal, balanceDue, cashWarning };
        } catch (e) {
            console.error('Error delivering preorder:', e);
            return { success: false, error: e.message };
        }
    },

    // ==========================================
    // DELIVERY (App) — repartidores, envíos, rastreo y liquidación
    // ==========================================
    // Todas pasan por /api/data/actions (sesión + membresía validadas allí).
    deliveryCall: async (action, payload = {}) => {
        const { activeCompanyId } = get();
        try {
            const r = await userApiCall(action, { companyId: activeCompanyId, ...payload });
            return r || { success: false, error: 'Sin respuesta' };
        } catch (e) {
            console.error(`Error en ${action}:`, e);
            return { success: false, error: e.message };
        }
    },

    fetchCouriers: async () => {
        const r = await get().deliveryCall('courierList');
        if (r?.success) set({ couriers: r.couriers || [] });
        return r;
    },
    saveCourier: async (courier) => {
        const r = await get().deliveryCall('courierSave', courier);
        if (r?.success) await get().fetchCouriers();
        return r;
    },
    deleteCourier: async (id) => {
        const r = await get().deliveryCall('courierDelete', { id });
        if (r?.success) await get().fetchCouriers();
        return r;
    },

    fetchDeliveryBoard: async () => {
        const r = await get().deliveryCall('deliveryBoard');
        if (r?.success) {
            set({
                deliveries: r.deliveries || [],
                deliveryCounts: r.counts || {},
                deliveryAssignMode: r.assignMode || 'manual',
            });
        }
        return r;
    },
    createDelivery: async (data) => {
        const r = await get().deliveryCall('deliveryCreate', data);
        if (r?.success) await get().fetchDeliveryBoard();
        return r;
    },
    assignDelivery: async (id, courierId) => {
        const r = await get().deliveryCall('deliveryAssign', { id, courierId });
        if (r?.success) { await get().fetchDeliveryBoard(); get().fetchCouriers(); }
        return r;
    },
    setDeliveryStatus: async (id, status, extra = {}) => {
        const r = await get().deliveryCall('deliveryStatus', { id, status, ...extra });
        if (r?.success) { await get().fetchDeliveryBoard(); get().fetchCouriers(); }
        return r;
    },
    fetchImportableOrders: async () => get().deliveryCall('deliveryImportable'),
    fetchDeliveryDetail: async (id) => get().deliveryCall('deliveryDetail', { id }),
    saveDeliverySettings: async (assignMode) => {
        const r = await get().deliveryCall('deliverySettingsSave', { assignMode });
        if (r?.success) set({ deliveryAssignMode: r.assignMode });
        return r;
    },

    // Modo Repartidor
    fetchMyDeliveries: async () => get().deliveryCall('courierMyDeliveries'),
    takeDelivery: async (id) => get().deliveryCall('courierTake', { id }),
    pingCourierLocation: async (lat, lng) => get().deliveryCall('courierPing', { lat, lng }),

    // Rastreo y liquidación
    fetchDeliveryTracking: async () => get().deliveryCall('deliveryTracking'),
    createSettlement: async (courierId, registerId, notes) =>
        get().deliveryCall('settlementCreate', { courierId, registerId, notes }),
    fetchSettlements: async () => get().deliveryCall('settlementList'),

    // ==========================================
    // PAYMENT METHODS ACTIONS
    // ==========================================
    fetchPaymentMethodsSettings: async () => {
        const { activeCompanyId } = get();
        try {
            // Server-side: config (crea default si falta) + datáfonos + cuentas
            const r = await userApiCall('paymentSettingsLoad', { companyId: activeCompanyId });
            if (!r?.success) return r || { success: false, error: 'Error' };
            set({
                paymentMethodsConfig: r.config,
                paymentTerminals: r.terminals,
                bankAccounts: r.accounts
            });
            return { success: true };
        } catch (e) {
            console.error("Error fetching payment settings:", e);
            return { success: false, error: e.message };
        }
    },

    togglePaymentMethod: async (method, isEnabled) => {
        const { activeCompanyId, paymentMethodsConfig } = get();
        try {
            const r = await userApiCall('paymentMethodToggle', { companyId: activeCompanyId, method, isEnabled });
            if (!r?.success) return r || { success: false, error: 'Error' };
            set({
                paymentMethodsConfig: { ...paymentMethodsConfig, [r.field]: isEnabled ? 1 : 0 }
            });
            return { success: true };
        } catch (e) {
            console.error("Error toggling payment method:", e);
            return { success: false, error: e.message };
        }
    },

    addPaymentTerminal: async (terminalData) => {
        const { activeCompanyId, paymentTerminals } = get();
        try {
            const r = await userApiCall('terminalCreate', { companyId: activeCompanyId, terminal: terminalData });
            if (!r?.success) return r || { success: false, error: 'Error' };
            set({ paymentTerminals: [...paymentTerminals, r.terminal] });
            return { success: true };
        } catch (e) {
            console.error("Error adding terminal:", e);
            return { success: false, error: e.message };
        }
    },

    updatePaymentTerminal: async (id, terminalData) => {
        const { activeCompanyId, paymentTerminals } = get();
        try {
            const r = await userApiCall('terminalUpdate', { companyId: activeCompanyId, id, terminal: terminalData });
            if (!r?.success) return r || { success: false, error: 'Error' };
            const commissionRate = Number(terminalData.commission_rate) || 0;
            const fixedFee = Number(terminalData.fixed_fee) || 0;
            const includesIva = terminalData.commission_includes_iva ? 1 : 0;
            set({
                paymentTerminals: paymentTerminals.map(t =>
                    t.id === id ? { ...t, name: terminalData.name, color: terminalData.color || '#3B82F6', commission_rate: commissionRate, fixed_fee: fixedFee, commission_includes_iva: includesIva } : t
                )
            });
            return { success: true };
        } catch (e) {
            console.error("Error updating terminal:", e);
            return { success: false, error: e.message };
        }
    },

    deletePaymentTerminal: async (id) => {
        const { activeCompanyId, paymentTerminals } = get();
        try {
            const r = await userApiCall('terminalDelete', { companyId: activeCompanyId, id });
            if (!r?.success) return r || { success: false, error: 'Error' };
            set({ paymentTerminals: paymentTerminals.filter(t => t.id !== id) });
            return { success: true };
        } catch (e) {
            console.error("Error deleting terminal:", e);
            return { success: false, error: e.message };
        }
    },

    addBankAccount: async (accountData) => {
        const { activeCompanyId, bankAccounts } = get();
        try {
            const r = await userApiCall('bankAccountCreate', { companyId: activeCompanyId, account: accountData });
            if (!r?.success) return r || { success: false, error: 'Error' };
            set({ bankAccounts: [...bankAccounts, r.account] });
            return { success: true };
        } catch (e) {
            console.error("Error adding bank account:", e);
            return { success: false, error: e.message };
        }
    },

    updateBankAccount: async (id, accountData) => {
        const { activeCompanyId, bankAccounts } = get();
        try {
            const r = await userApiCall('bankAccountUpdate', { companyId: activeCompanyId, id, account: accountData });
            if (!r?.success) return r || { success: false, error: 'Error' };
            set({ bankAccounts: bankAccounts.map(a => a.id === id ? { ...a, ...accountData } : a) });
            return { success: true };
        } catch (e) {
            console.error("Error updating bank account:", e);
            return { success: false, error: e.message };
        }
    },

    deleteBankAccount: async (id) => {
        const { activeCompanyId, bankAccounts } = get();
        try {
            const r = await userApiCall('bankAccountDelete', { companyId: activeCompanyId, id });
            if (!r?.success) return r || { success: false, error: 'Error' };
            set({ bankAccounts: bankAccounts.filter(a => a.id !== id) });
            return { success: true };
        } catch (e) {
            console.error("Error deleting bank account:", e);
            return { success: false, error: e.message };
        }
    },


    // ==========================================
    // 👷 GESTIÓN LABORAL: FUNCIONES
    // ==========================================

    // --- 1. Gestión de Personal (Ficha Laboral) ---

    // Obtener lista de empleados (usuarios con perfil laboral activo)
    // ── Dominio Personal (Fase 1 · Paso 9): todo corre server-side en
    // api/_lib/personalActions.js con sesión + membresía + company_id forzado. ──

    fetchStaffMembers: async () => {
        const { activeCompanyId } = get();
        try {
            const r = await userApiCall('personal.staffList', { companyId: activeCompanyId });
            if (!r?.success) throw new Error(r?.error || 'Error cargando personal');
            set({ staffMembers: r.rows });
            return r.rows;
        } catch (e) {
            console.error("Error fetching staff:", e);
            throw e;
        }
    },

    // Actualizar datos de ficha laboral y configuración de pago
    updateLaborProfile: async (userId, data) => {
        try {
            const r = await userApiCall('personal.laborProfileUpdate', { companyId: get().activeCompanyId, userId, data });
            if (!r?.success) return r || { success: false, error: 'Error actualizando ficha' };

            // Actualizar estado local si el usuario está en staffMembers
            const { staffMembers } = get();
            set({ staffMembers: staffMembers.map(u => u.id === userId ? { ...u, ...data } : u) });

            return { success: true };
        } catch (e) {
            console.error("Error updating labor profile:", e);
            return { success: false, error: e.message };
        }
    },

    // Activar/Desactivar perfil laboral (convertir usuario en empleado)
    toggleLaborProfile: async (userId, enable) => {
        try {
            const r = await userApiCall('personal.laborProfileToggle', { companyId: get().activeCompanyId, userId, enable });
            if (!r?.success) return r || { success: false, error: 'Error' };

            // Recargar lista de empleados
            get().fetchStaffMembers();

            return { success: true };
        } catch (e) {
            console.error("Error toggling labor profile:", e);
            return { success: false, error: e.message };
        }
    },

    // Buscar empleado por PIN (para Kiosco). El servidor ya no devuelve password.
    getLaborProfileByPin: async (pin, companyId = null) => {
        const targetCompany = companyId || get().activeCompanyId;
        try {
            const r = await userApiCall('personal.laborProfileByPin', { companyId: targetCompany, pin });
            return r?.success ? (r.user || null) : null;
        } catch (e) {
            console.error("Error finding user by PIN:", e);
            return null;
        }
    },

    // --- 2. Asistencia ---

    fetchAttendanceToday: async () => {
        const { activeCompanyId, currentCompanyTimezone } = get();
        // Use local date in company timezone, not UTC
        const today = formatInCompanyTime(new Date(), currentCompanyTimezone, 'yyyy-MM-dd');
        try {
            const r = await userApiCall('personal.attendanceToday', { companyId: activeCompanyId, today });
            if (!r?.success) throw new Error(r?.error || 'Error');

            // Group by user_id and pair entry/exit.
            // Las marcas anuladas por una corrección aprobada quedan fuera: si
            // siguieran contando, el panel mostraría la hora que se corrigió.
            const grouped = {};
            for (const row of r.rows.filter(x => !Number(x.is_corrected))) {
                const key = row.user_id;
                if (!grouped[key]) {
                    grouped[key] = {
                        id: row.id,
                        user_id: row.user_id,
                        username: row.username,
                        name: row.name,
                        date: row.date,
                        check_in: null,
                        check_out: null,
                        branch: row.branch || null,
                        notes: row.notes || null,
                        source: row.source,
                    };
                }
                if (row.type === 'entry' && !grouped[key].check_in) {
                    grouped[key].check_in = row.recorded_at;
                    if (row.branch) grouped[key].branch = row.branch;
                }
                if (row.type === 'exit') {
                    grouped[key].check_out = row.recorded_at;
                }
                if (row.notes) grouped[key].notes = row.notes;
            }

            set({ attendanceToday: Object.values(grouped) });
        } catch (e) {
            console.error("Error fetching attendance today:", e);
        }
    },

    fetchAttendanceByRange: async (startDate, endDate, userId = null) => {
        const { activeCompanyId } = get();
        try {
            const r = await userApiCall('personal.attendanceRange', { companyId: activeCompanyId, startDate, endDate, userId });
            if (!r?.success) throw new Error(r?.error || 'Error');
            const rows = r.rows;

            // Group by user_id + date and pair entry/exit into single records.
            // Se ignoran las marcas anuladas, igual que en el panel del día.
            const grouped = {};
            for (const row of rows.filter(x => !Number(x.is_corrected))) {
                const key = `${row.user_id}_${row.date}`;
                if (!grouped[key]) {
                    grouped[key] = {
                        id: row.id,
                        user_id: row.user_id,
                        username: row.username,
                        name: row.name,
                        date: row.date,
                        check_in: null,
                        check_out: null,
                        branch: row.branch || null,
                        notes: row.notes || null,
                        source: row.source,
                    };
                }
                if (row.type === 'entry' && !grouped[key].check_in) {
                    grouped[key].check_in = row.recorded_at;
                    if (row.branch) grouped[key].branch = row.branch;
                }
                if (row.type === 'exit' && !grouped[key].check_out) {
                    grouped[key].check_out = row.recorded_at;
                }
                if (row.notes) grouped[key].notes = row.notes;
            }

            // Convert to array sorted by date desc
            return Object.values(grouped).sort((a, b) => b.date.localeCompare(a.date));
        } catch (e) {
            console.error("Error fetching attendance range:", e);
            throw e;
        }
    },

    fetchAttendanceByRangeRaw: async (startDate, endDate, userId = null) => {
        const { activeCompanyId } = get();
        try {
            const r = await userApiCall('personal.attendanceRange', { companyId: activeCompanyId, startDate, endDate, userId });
            if (!r?.success) throw new Error(r?.error || 'Error');
            return r.rows;
        } catch (e) {
            console.error("Error fetching raw attendance range:", e);
            throw e;
        }
    },

    markAttendance: async (userId, type, deviceLabel, branch) => {
        const { activeCompanyId, currentCompanyTimezone } = get();
        // Fecha local en zona horaria de la empresa; la lógica entrada/salida corre en el servidor
        const date = formatInCompanyTime(new Date(), currentCompanyTimezone, 'yyyy-MM-dd');

        try {
            const r = await userApiCall('personal.attendanceMark', {
                companyId: activeCompanyId, userId, type, deviceLabel, branch, date,
                deviceId: getDeviceId(),
            });
            if (!r?.success) return r || { success: false, error: 'Error' };

            // Actualizar vista local si es hoy
            get().fetchAttendanceToday();

            // `receipt` trae folio y hash: es el comprobante que se le entrega al trabajador.
            return { success: true, type: r.type, recordedAt: r.recordedAt, receipt: r.receipt || null };
        } catch (e) {
            console.error("Error marking attendance:", e);
            return { success: false, error: e.message };
        }
    },

    // Comprobante de una marca ya guardada (el trabajador perdió el papel y lo pide de nuevo).
    fetchAttendanceReceipt: async ({ folio, recordId }) => {
        const { activeCompanyId } = get();
        try {
            const r = await userApiCall('personal.attendanceReceipt', { companyId: activeCompanyId, folio, recordId });
            return r?.success ? r.record : null;
        } catch (e) {
            console.error("Error fetching attendance receipt:", e);
            return null;
        }
    },

    // Verificación de la cadena de integridad: lo que se le muestra a un
    // fiscalizador para probar que las marcas no se tocaron después de guardarse.
    verifyAttendanceChain: async ({ fromSeq = 1, limit = 5000 } = {}) => {
        const { activeCompanyId } = get();
        try {
            const r = await userApiCall('personal.attendanceVerify', { companyId: activeCompanyId, fromSeq, limit });
            return r?.success ? r : { success: false, error: r?.error || 'Error', problems: [] };
        } catch (e) {
            console.error("Error verifying attendance chain:", e);
            return { success: false, error: e.message, problems: [] };
        }
    },

    registerManualAttendance: async (userId, type, datetime, notes, recordedBy) => {
        const { activeCompanyId, currentCompanyTimezone } = get();
        // Use local date in company timezone
        const date = formatInCompanyTime(new Date(datetime), currentCompanyTimezone, 'yyyy-MM-dd');

        try {
            const r = await userApiCall('personal.attendanceManual', { companyId: activeCompanyId, userId, type, datetime, date, notes, recordedBy });
            if (!r?.success) return r || { success: false, error: 'Error' };

            get().fetchAttendanceToday();
            return { success: true };
        } catch (e) {
            console.error("Error registering manual attendance:", e);
            return { success: false, error: e.message };
        }
    },

    getAttendanceStatus: async (userId) => {
        const { activeCompanyId, currentCompanyTimezone } = get();
        const today = formatInCompanyTime(new Date(), currentCompanyTimezone, 'yyyy-MM-dd');
        try {
            const r = await userApiCall('personal.attendanceStatus', { companyId: activeCompanyId, userId, today });
            return r?.success ? r.status : 'unknown';
        } catch (e) {
            console.error("Error getting status:", e);
            return 'unknown';
        }
    },

    // --- 3. Correcciones de Asistencia ---

    fetchPendingCorrections: async () => {
        const { activeCompanyId } = get();
        try {
            const r = await userApiCall('personal.correctionsPending', { companyId: activeCompanyId });
            if (r?.success) set({ pendingCorrections: r.rows });
        } catch (e) {
            console.error("Error fetching corrections:", e);
        }
    },

    fetchCorrectionsByStatus: async (status) => {
        const { activeCompanyId } = get();
        try {
            const r = await userApiCall('personal.correctionsByStatus', { companyId: activeCompanyId, status });
            return r?.success ? r.rows : [];
        } catch (e) {
            console.error("Error fetching corrections by status:", e);
            return [];
        }
    },

    requestCorrection: async (data) => {
        const { activeCompanyId, currentUser } = get();
        // data: { user_id, original_record_id, correction_type, original_at, requested_at, requested_date, reason }
        try {
            const r = await userApiCall('personal.correctionRequest', {
                companyId: activeCompanyId,
                data: { ...data, user_id: data.user_id || currentUser?.id },
            });
            return r?.success ? { success: true } : (r || { success: false, error: 'Error' });
        } catch (e) {
            console.error("Error requesting correction:", e);
            return { success: false, error: e.message };
        }
    },

    approveCorrection: async (correctionId, reviewerNotes, reviewedBy) => {
        try {
            // Toda la lógica de aplicar la corrección corre en el servidor
            const r = await userApiCall('personal.correctionApprove', { companyId: get().activeCompanyId, correctionId, reviewerNotes, reviewedBy });
            if (!r?.success) return r || { success: false, error: 'Error' };

            // Refrescar datos
            get().fetchPendingCorrections();
            get().fetchAttendanceToday(); // Por si afecta hoy

            return { success: true };
        } catch (e) {
            console.error("Error approving correction:", e);
            return { success: false, error: e.message };
        }
    },

    rejectCorrection: async (correctionId, reviewerNotes, reviewedBy) => {
        try {
            const r = await userApiCall('personal.correctionReject', { companyId: get().activeCompanyId, correctionId, reviewerNotes, reviewedBy });
            if (!r?.success) return r || { success: false, error: 'Error' };
            get().fetchPendingCorrections();
            return { success: true };
        } catch (e) {
            console.error("Error rejecting correction:", e);
            return { success: false, error: e.message };
        }
    },

    // --- 4. Turnos Planificados ---

    fetchShifts: async (weekStart, weekEnd, userId = null) => {
        const { activeCompanyId } = get();
        try {
            const startDate = String(weekStart).split('T')[0];
            const endDate = String(weekEnd).split('T')[0];
            const r = await userApiCall('personal.shiftsFetch', { companyId: activeCompanyId, startDate, endDate, userId });
            if (!r?.success) return [];
            set({ workShifts: r.rows });
            return r.rows;
        } catch (e) {
            console.error("Error fetching shifts:", e);
            return [];
        }
    },

    createShift: async (data) => {
        const { activeCompanyId } = get();
        try {
            const r = await userApiCall('personal.shiftCreate', { companyId: activeCompanyId, data });
            return r?.success ? { success: true } : (r || { success: false, error: 'Error' });
        } catch (e) {
            console.error("Error creating shift:", e);
            return { success: false, error: e.message };
        }
    },

    // Horario Fijo: graba todos los turnos generados en UNA llamada (batch server-side)
    bulkSaveShifts: async (shifts, deletes = []) => {
        const { activeCompanyId } = get();
        try {
            const r = await userApiCall('personal.shiftsBulkSave', { companyId: activeCompanyId, shifts, deletes });
            return r?.success ? r : (r || { success: false, error: 'Error' });
        } catch (e) {
            console.error("Error bulk saving shifts:", e);
            return { success: false, error: e.message };
        }
    },

    deleteShift: async (id) => {
        try {
            const r = await userApiCall('personal.shiftDelete', { companyId: get().activeCompanyId, id });
            if (!r?.success) return r || { success: false, error: 'Error' };
            // Actualizar localmente
            const { workShifts } = get();
            set({ workShifts: workShifts.filter(s => s.id !== id) });
            return { success: true };
        } catch (e) {
            console.error("Error deleting shift:", e);
            return { success: false, error: e.message };
        }
    },

    copyPreviousWeek: async (currentWeekStart, previousWeekStart, userId = null) => {
        const { activeCompanyId, currentUser } = get();
        // currentWeekStart: fecha inicio de la semana destino (Lunes)
        // previousWeekStart: fecha inicio de semana origen
        // Esto es complejo en SQL puro si las fechas cambian (obvio).
        // Lógica JS: Fetch previous -> Calculate new dates -> Insert batch
        try {
            // 1. Fetch previous week shifts
            // Calcular end dates (assuming 7 days)
            const prevEnd = new Date(new Date(previousWeekStart).getTime() + 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

            const prevRes = await userApiCall('personal.shiftsFetch', { companyId: activeCompanyId, startDate: previousWeekStart, endDate: prevEnd, userId });
            const prevShifts = prevRes?.success ? prevRes.rows : [];

            if (prevShifts.length === 0) return { success: true, count: 0 };

            // 2. Map to new dates
            // Diff en días entre semanas suele ser 7
            const dayDiff = (new Date(currentWeekStart) - new Date(previousWeekStart)) / (1000 * 60 * 60 * 24);

            const newShifts = prevShifts.map(s => {
                const oldDate = new Date(s.shift_date);
                const newDate = new Date(oldDate.getTime() + dayDiff * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

                // Update start_time and end_time
                const oldStart = new Date(s.start_time);
                const newStart = new Date(oldStart.getTime() + dayDiff * 24 * 60 * 60 * 1000).toISOString();

                const oldEnd = new Date(s.end_time);
                const newEnd = new Date(oldEnd.getTime() + dayDiff * 24 * 60 * 60 * 1000).toISOString();

                return {
                    ...s,
                    shift_date: newDate,
                    start_time: newStart,
                    end_time: newEnd
                };
            });

            // 3. Batch insert
            for (const s of newShifts) {
                await get().createShift(s, currentUser.id);
            }

            return { success: true, count: newShifts.length };

        } catch (e) {
            console.error("Error copying week:", e);
            return { success: false, error: e.message };
        }
    },

    // --- 5. Ausencias ---

    fetchAbsences: async (startDate, endDate, userId = null) => {
        const { activeCompanyId } = get();
        try {
            const r = await userApiCall('personal.absencesFetch', { companyId: activeCompanyId, startDate, endDate, userId });
            if (!r?.success) return [];
            set({ laborAbsences: r.rows });
            return r.rows;
        } catch (e) {
            console.error("Error fetching absences:", e);
            return [];
        }
    },

    createAbsence: async (data) => {
        const { activeCompanyId } = get();
        try {
            // Validaciones (duplicados, asistencia existente) y batch corren en el servidor
            const r = await userApiCall('personal.absenceCreate', { companyId: activeCompanyId, data });
            return r?.success ? { success: true, count: r.count, groupId: r.groupId } : (r || { success: false, error: 'Error' });
        } catch (e) {
            console.error("Error creating absence:", e);
            return { success: false, error: e.message };
        }
    },

    deleteAbsence: async (id) => {
        try {
            const r = await userApiCall('personal.absenceDelete', { companyId: get().activeCompanyId, id });
            if (!r?.success) return r || { success: false, error: 'Error' };
            // Actualizar local
            const { laborAbsences } = get();
            set({ laborAbsences: laborAbsences.filter(a => a.id !== id) });
            return { success: true };
        } catch (e) {
            console.error("Error deleting absence:", e);
            return { success: false, error: e.message };
        }
    },

    deleteAbsenceGroup: async (groupId) => {
        try {
            if (!groupId) return { success: false, error: 'No group_id' };
            const r = await userApiCall('personal.absenceDeleteGroup', { companyId: get().activeCompanyId, groupId });
            if (!r?.success) return r || { success: false, error: 'Error' };
            const { laborAbsences } = get();
            set({ laborAbsences: laborAbsences.filter(a => a.group_id !== groupId) });
            return { success: true };
        } catch (e) {
            console.error("Error deleting absence group:", e);
            return { success: false, error: e.message };
        }
    },

    // --- 6. Configuración de Personal ---

    fetchPersonalConfig: async () => {
        const { activeCompanyId } = get();
        try {
            const r = await userApiCall('personal.configFetch', { companyId: activeCompanyId });
            if (!r?.success) return null;
            set({ personalConfig: r.config });
            return r.config;
        } catch (e) {
            console.error("Error fetching personal config:", e);
            return null;
        }
    },

    updatePersonalConfig: async (data) => {
        const { activeCompanyId } = get();
        try {
            // Whitelist de campos aplicada en el servidor
            const r = await userApiCall('personal.configUpdate', { companyId: activeCompanyId, data });
            if (!r?.success) return r || { success: false, error: 'Error' };

            set({ personalConfig: { ...get().personalConfig, ...data } });
            return { success: true };
        } catch (e) {
            console.error("Error updating personal config:", e);
            return { success: false, error: e.message };
        }
    },

    // --- 7. Adelantos ---

    fetchAdvances: async (userId = null, startDate = null, endDate = null) => {
        const { activeCompanyId } = get();
        try {
            const r = await userApiCall('personal.advancesFetch', { companyId: activeCompanyId, userId, startDate, endDate });
            if (!r?.success) return [];
            set({ salaryAdvances: r.rows });
            return r.rows;
        } catch (e) {
            console.error("Error fetching advances:", e);
            return [];
        }
    },

    createAdvance: async (data) => {
        const { activeCompanyId } = get();
        try {
            const r = await userApiCall('personal.advanceCreate', { companyId: activeCompanyId, data });
            return r?.success ? { success: true } : (r || { success: false, error: 'Error' });
        } catch (e) {
            console.error("Error creating advance:", e);
            return { success: false, error: e.message };
        }
    },

    markAdvanceDiscounted: async (id, periodId) => {
        try {
            const r = await userApiCall('personal.advanceMarkDiscounted', { companyId: get().activeCompanyId, id, periodId });
            return r?.success ? { success: true } : (r || { success: false, error: 'Error' });
        } catch (e) {
            console.error("Error marking advance:", e);
            return { success: false, error: e.message };
        }
    },

    deleteAdvance: async (id) => {
        try {
            const r = await userApiCall('personal.advanceDelete', { companyId: get().activeCompanyId, id });
            if (!r?.success) return r || { success: false, error: 'Error' };
            const { salaryAdvances } = get();
            set({ salaryAdvances: salaryAdvances.filter(a => a.id !== id) });
            return { success: true };
        } catch (e) {
            console.error("Error deleting advance:", e);
            return { success: false, error: e.message };
        }
    },

    // --- 8. Liquidaciones (Cálculo y Gestión) ---

    fetchPayrollPeriods: async (userId = null) => {
        const { activeCompanyId } = get();
        try {
            const r = await userApiCall('personal.payrollPeriodsFetch', { companyId: activeCompanyId, userId });
            if (!r?.success) return [];
            set({ payrollPeriods: r.rows });
            return r.rows;
        } catch (e) {
            console.error("Error fetching periods:", e);
            return [];
        }
    },

    calculatePeriod: async (userId, periodStart, periodEnd) => {
        const { activeCompanyId } = get();
        try {
            // 1. User + Config (datos laborales del empleado, sin password)
            const userRes = await userApiCall('personal.staffUser', { companyId: activeCompanyId, userId });
            const user = userRes?.user;
            if (!user) throw new Error('Empleado no encontrado');
            const config = await get().fetchPersonalConfig();
            const tolerance = config?.late_tolerance_minutes || 10;
            const workingDaysMonth = config?.working_days_per_month || 30;

            // 2. Attendance, Shifts, Absences
            const attendance = await get().fetchAttendanceByRangeRaw(periodStart, periodEnd, userId);
            const shifts = await get().fetchShifts(periodStart, periodEnd, userId);
            const absencesData = await get().fetchAbsences(periodStart, periodEnd, userId);

            const shiftsMap = {};
            shifts.forEach(s => {
                if (s.notes !== 'LIBRE') shiftsMap[s.shift_date] = s;
            });

            const absencesMap = {};
            (absencesData || []).forEach(a => { absencesMap[a.absence_date] = a; });

            const daysMap = {};
            attendance.forEach(r => {
                if (!daysMap[r.date]) daysMap[r.date] = [];
                daysMap[r.date].push(r);
            });

            // 3. Process each shift day
            let hoursWorked = 0;
            let lateCount = 0;
            let lateMinutes = 0;
            let daysWorked = 0;
            let daysAbsent = 0;
            let daysVacation = 0;
            let daysMedical = 0;
            let daysPermission = 0;
            let daysUnpaidLeave = 0; // "Permiso sin Goce de Sueldo": siempre descuenta
            let daysUnjustified = 0;
            const detailDays = [];

            const shiftDates = Object.keys(shiftsMap).sort();
            for (const dateStr of shiftDates) {
                const shift = shiftsMap[dateStr];
                const records = (daysMap[dateStr] || []).sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));
                const absence = absencesMap[dateStr];

                let dayStatus = 'absent';
                let dayHours = 0;
                let dayLateMin = 0;

                // Find entry/exit pairs
                let entryTime = null;
                for (const r of records) {
                    if (r.type === 'entry') {
                        entryTime = new Date(r.recorded_at);
                        // Late check
                        const shiftStartStr = shift.start_time.includes('T') ? shift.start_time : `${dateStr}T${shift.start_time}`;
                        const shiftStart = new Date(shiftStartStr);
                        const diffMins = (entryTime - shiftStart) / (1000 * 60);
                        if (diffMins > tolerance) {
                            dayLateMin = Math.floor(diffMins);
                        }
                    } else if (r.type === 'exit' && entryTime) {
                        const exitTime = new Date(r.recorded_at);
                        dayHours += (exitTime - entryTime) / (1000 * 60 * 60);
                        entryTime = null;
                    }
                }

                if (dayHours > 0) {
                    dayStatus = dayLateMin > 0 ? 'late' : 'present';
                    hoursWorked += dayHours;
                    daysWorked++;
                    if (dayLateMin > 0) {
                        lateCount++;
                        lateMinutes += dayLateMin;
                    }
                } else if (absence) {
                    const aType = absence.type;
                    if (aType === 'vacation') { dayStatus = 'vacation'; daysVacation++; }
                    else if (aType === 'medical') { dayStatus = 'medical'; daysMedical++; }
                    else if (aType === 'permission') { dayStatus = 'permission'; daysPermission++; }
                    // "Permiso sin Goce de Sueldo": por definición se descuenta
                    // siempre, no depende del interruptor de permisos pagados.
                    // Antes caía en "otras ausencias" y se mostraba con ese nombre.
                    else if (aType === 'unpaid_leave') { dayStatus = 'unpaid_leave'; daysUnpaidLeave++; }
                    else if (aType === 'unjustified') { dayStatus = 'unjustified'; daysUnjustified++; daysAbsent++; }
                    else { dayStatus = 'absence_other'; daysAbsent++; }
                } else {
                    // Día pasado, con turno, sin marca de asistencia y sin ausencia
                    // cargada. Contarlo como falta injustificada SOLO si la empresa
                    // realmente usa el control de asistencia.
                    //
                    // Antes se daba por hecho, y en una empresa que no marca
                    // entrada/salida eso descontaba a TODOS por todos los días:
                    // medido el 10-ago-2026, a las 5 vendedoras se les descontaba
                    // entre $100.000 y $133.333 de un sueldo de $500.000 sin que
                    // hubieran faltado un solo día.
                    const today = new Date().toISOString().slice(0, 10);
                    if (config?.absence_from_missing_attendance && dateStr < today) {
                        dayStatus = 'unjustified';
                        daysUnjustified++;
                        daysAbsent++;
                    }
                }

                detailDays.push({ date: dateStr, status: dayStatus, hours: +dayHours.toFixed(2), lateMin: dayLateMin, absence: absence?.type || null });
            }

            // Also count attendance on days without shifts
            for (const dateStr of Object.keys(daysMap)) {
                if (!shiftsMap[dateStr]) {
                    const records = daysMap[dateStr].sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));
                    let entryTime = null;
                    let dayHours = 0;
                    for (const r of records) {
                        if (r.type === 'entry') entryTime = new Date(r.recorded_at);
                        else if (r.type === 'exit' && entryTime) {
                            dayHours += (new Date(r.recorded_at) - entryTime) / (1000 * 60 * 60);
                            entryTime = null;
                        }
                    }
                    if (dayHours > 0) {
                        hoursWorked += dayHours;
                        daysWorked++;
                        detailDays.push({ date: dateStr, status: 'extra', hours: +dayHours.toFixed(2), lateMin: 0, absence: null });
                    }
                }
            }

            // 4. Calculate base amount
            let baseAmount = 0;
            const payType = user.pay_type || 'monthly';
            const baseRate = user.pay_base_amount || 0;
            const hourlyRate = user.pay_hourly_rate || 0;
            // Valor de un día de trabajo, base de todos los descuentos por ausencia.
            // Depende del tipo de pago: dividir siempre por los días del MES daba
            // un valor absurdo en pago por hora (ahí `pay_base_amount` es el valor
            // de la hora, así que salía "hora ÷ 30").
            const horasDia = config?.working_hours_per_day || 8;
            const valorDia = (() => {
                if (payType === 'hourly') return baseRate * horasDia;
                if (payType === 'mixed') return (workingDaysMonth > 0 ? baseRate / workingDaysMonth : 0) + hourlyRate * horasDia;
                if (payType === 'weekly') return baseRate / 7;
                if (payType === 'biweekly') return workingDaysMonth > 0 ? baseRate / (workingDaysMonth / 2) : 0;
                return workingDaysMonth > 0 ? baseRate / workingDaysMonth : 0; // mensual
            })();

            if (payType === 'monthly') {
                baseAmount = baseRate;
            } else if (payType === 'hourly') {
                baseAmount = baseRate * hoursWorked;
            } else if (payType === 'weekly') {
                // weeks in period
                const msInRange = new Date(periodEnd) - new Date(periodStart);
                const weeksInRange = Math.max(1, Math.round(msInRange / (7 * 24 * 60 * 60 * 1000)));
                baseAmount = baseRate * weeksInRange;
            } else if (payType === 'biweekly') {
                baseAmount = baseRate; // biweekly rate is set directly per quincena
            } else if (payType === 'mixed') {
                baseAmount = baseRate + (hourlyRate * hoursWorked);
            }

            // ¿El sueldo base ya cubre el período completo?
            //
            // En mensual/quincenal/semanal el sueldo incluye TODOS los días del
            // período, trabajados o no. Ahí los días no pagados hay que
            // DESCONTARLOS, y los pagados no se suman porque ya están adentro.
            //
            // En por hora / mixto se paga lo efectivamente trabajado, así que es
            // al revés: no hay nada que descontar (el día no trabajado ya no se
            // pagó) y las ausencias pagadas sí se suman.
            //
            // Antes se sumaban las pagadas en TODOS los casos: a un mensual con 3
            // días de vacaciones se le liquidaba $550 sobre un sueldo de $500 —
            // los días iban dos veces—. Y un permiso sin goce no descontaba nada,
            // porque nunca se restaba del base.
            const baseCubrePeriodo = ['monthly', 'weekly', 'biweekly'].includes(payType);

            // 5. Discounts
            let autoDiscounts = 0;
            let discountDetails = [];

            if (baseCubrePeriodo) {
                // Días dentro del período que NO se pagan → se descuentan del sueldo.
                const noPagados = [];
                if (config?.absence_discount_enabled && daysUnjustified > 0) {
                    noPagados.push({ dias: daysUnjustified, label: 'Faltas injustificadas' });
                }
                if (!config?.vacation_paid && daysVacation > 0) {
                    noPagados.push({ dias: daysVacation, label: 'Vacaciones sin goce' });
                }
                if (!config?.medical_paid && daysMedical > 0) {
                    noPagados.push({ dias: daysMedical, label: 'Licencias sin goce' });
                }
                if (!config?.permission_paid && daysPermission > 0) {
                    noPagados.push({ dias: daysPermission, label: 'Permisos personales' });
                }
                // Este no depende de ningún interruptor: el tipo ya dice "sin goce".
                if (daysUnpaidLeave > 0) {
                    noPagados.push({ dias: daysUnpaidLeave, label: 'Permisos sin goce de sueldo' });
                }
                // Ausencias de otro tipo: se descuentan salvo que el descuento por
                // ausencia esté apagado del todo.
                const otras = Math.max(0, daysAbsent - daysUnjustified);
                if (config?.absence_discount_enabled && otras > 0) {
                    noPagados.push({ dias: otras, label: 'Otras ausencias' });
                }

                noPagados.forEach(({ dias, label }) => {
                    const monto = valorDia * dias;
                    autoDiscounts += monto;
                    discountDetails.push({ label: `${label} (${dias}d × ${Math.round(valorDia)})`, amount: monto });
                });
            }

            // Late discount
            if (config?.late_discount_enabled && lateMinutes > 0) {
                const lateDsc = (config.late_discount_per_minute || 0) * lateMinutes;
                autoDiscounts += lateDsc;
                discountDetails.push({ label: `Atrasos (${lateCount}x, ${lateMinutes}min)`, amount: lateDsc });
            }

            // 6. Ausencias pagadas — SOLO cuando el sueldo se paga por lo trabajado
            // (por hora / mixto). En mensual ya están dentro del sueldo base:
            // sumarlas las pagaría dos veces.
            let paidAbsenceAmount = 0;
            if (!baseCubrePeriodo) {
                if (config?.vacation_paid && daysVacation > 0) {
                    paidAbsenceAmount += valorDia * daysVacation;
                }
                if (config?.medical_paid && daysMedical > 0) {
                    paidAbsenceAmount += valorDia * daysMedical;
                }
                if (config?.permission_paid && daysPermission > 0) {
                    paidAbsenceAmount += valorDia * daysPermission;
                }
            }

            // 7. Automatic bonuses
            let autoBonuses = 0;
            let bonusDetails = [];

            if (config?.bonus_punctuality_enabled && lateCount === 0 && daysWorked > 0) {
                autoBonuses += config.bonus_punctuality_amount || 0;
                bonusDetails.push({ label: 'Bono puntualidad', amount: config.bonus_punctuality_amount || 0 });
            }
            if (config?.bonus_attendance_enabled && daysUnjustified === 0 && daysWorked > 0) {
                autoBonuses += config.bonus_attendance_amount || 0;
                bonusDetails.push({ label: 'Bono asistencia completa', amount: config.bonus_attendance_amount || 0 });
            }

            // 8. Advances
            const advRes = await userApiCall('personal.advancesPendingSum', { companyId: activeCompanyId, userId, until: periodEnd });
            const advancesTotal = advRes?.total || 0;

            // 9. Final calculation
            const totalBonuses = autoBonuses + (user.pay_fixed_bonus || 0);
            const totalDiscounts = autoDiscounts + (user.pay_fixed_discount || 0);
            const totalToPay = baseAmount + paidAbsenceAmount + totalBonuses - totalDiscounts - advancesTotal;

            return {
                user_id: userId,
                period_start: periodStart,
                period_end: periodEnd,
                pay_type: payType,
                hours_worked: +hoursWorked.toFixed(2),
                days_worked: daysWorked,
                days_absent: daysAbsent,
                days_vacation: daysVacation,
                days_medical: daysMedical,
                days_permission: daysPermission,
                days_unjustified: daysUnjustified,
                total_shifts: shiftDates.length,
                late_count: lateCount,
                late_minutes: lateMinutes,
                extra_hours: 0,
                base_amount: +baseAmount.toFixed(0),
                paid_absence_amount: +paidAbsenceAmount.toFixed(0),
                auto_bonuses: +autoBonuses.toFixed(0),
                manual_bonus: user.pay_fixed_bonus || 0,
                auto_discounts: +autoDiscounts.toFixed(0),
                manual_discount: user.pay_fixed_discount || 0,
                advances_discounted: advancesTotal,
                total_to_pay: +totalToPay.toFixed(0),
                bonus_details: bonusDetails,
                discount_details: discountDetails,
                detail_days: detailDays
            };

        } catch (e) {
            console.error("Error calculating period:", e);
            throw e;
        }
    },

    createPayrollPeriod: async (data, createdBy) => {
        const { activeCompanyId } = get();
        try {
            const r = await userApiCall('personal.payrollPeriodCreate', { companyId: activeCompanyId, data, createdBy });
            return r?.success ? { success: true, id: r.id } : (r || { success: false, error: 'Error' });
        } catch (e) {
            console.error("Error creating payroll period:", e);
            return { success: false, error: e.message };
        }
    },

    closePeriod: async (periodId) => {
        try {
            const r = await userApiCall('personal.payrollPeriodClose', { companyId: get().activeCompanyId, periodId });
            if (!r?.success) return r || { success: false, error: 'Error' };
            // Recargar
            get().fetchPayrollPeriods();
            return { success: true };
        } catch (e) {
            console.error("Error closing period:", e);
            return { success: false, error: e.message };
        }
    },

    updatePayrollPeriod: async (id, data) => {
        // Solo permitir si no está cerrado (validado en el servidor, con whitelist)
        try {
            const r = await userApiCall('personal.payrollPeriodUpdate', { companyId: get().activeCompanyId, id, data });
            return r?.success ? { success: true } : (r || { success: false, error: 'Error' });
        } catch (e) {
            console.error("Error updating period:", e);
            return { success: false, error: e.message };
        }
    },

    // --- 9. Pagos de Nómina (Reales) ---

    fetchPayrollPayments: async (userId = null, startDate = null, endDate = null) => {
        const { activeCompanyId } = get();
        try {
            const r = await userApiCall('personal.payrollPaymentsFetch', { companyId: activeCompanyId, userId, startDate, endDate });
            if (!r?.success) return [];
            set({ payrollPayments: r.rows });
            return r.rows;
        } catch (e) {
            console.error("Error fetching payments:", e);
            return [];
        }
    },

    createPayrollPayment: async (data, createdBy) => {
        const { activeCompanyId } = get();
        try {
            const r = await userApiCall('personal.payrollPaymentCreate', { companyId: activeCompanyId, data, createdBy });
            return r?.success ? { success: true } : (r || { success: false, error: 'Error' });
        } catch (e) {
            console.error("Error creating payment:", e);
            return { success: false, error: e.message };
        }
    },

    getPendingPayments: async () => {
        // Retorna usuarios con deuda (Liquidaciones cerradas vs Pagos realizados)
        const { activeCompanyId } = get();
        try {
            // Suma de Total a Pagar en Periodos Cerrados
            // MENOS Suma de Pagos Realizados
            // Agrupado por User

            // Esta query compleja podría simplificarse en JS si hay pocos datos, 
            // pero intentemos SQL

            const res = await userApiCall('personal.paymentsPending', { companyId: activeCompanyId });
            if (!res?.success) return [];

            return res.rows.map(r => ({
                ...r,
                balance: r.total_owed - r.total_paid
            })).filter(r => Math.abs(r.balance) > 0.01); // Solo con saldo pendiente

        } catch (e) {
            console.error("Error getting pending payments:", e);
            return [];
        }
    },

    // --- 10. Vacaciones ---

    fetchVacationRequests: async (status = null) => {
        const { activeCompanyId } = get();
        try {
            const r = await userApiCall('personal.vacationRequestsFetch', { companyId: activeCompanyId, status });
            if (!r?.success) return [];
            set({ vacationRequests: r.rows });
            return r.rows;
        } catch (e) {
            console.error("Error fetching vacation requests:", e);
            return [];
        }
    },

    fetchVacationBalances: async () => {
        const { activeCompanyId } = get();
        try {
            const r = await userApiCall('personal.vacationBalancesFetch', { companyId: activeCompanyId });
            if (!r?.success) return [];
            set({ vacationBalances: r.rows });
            return r.rows;
        } catch (e) {
            console.error("Error fetching vacation balances:", e);
            return [];
        }
    },

    createVacationRequest: async (data) => {
        const { activeCompanyId } = get();
        try {
            const r = await userApiCall('personal.vacationRequestCreate', { companyId: activeCompanyId, data });
            return r?.success ? { success: true } : (r || { success: false, error: 'Error' });
        } catch (e) {
            console.error("Error requesting vacation:", e);
            return { success: false, error: e.message };
        }
    },

    approveVacation: async (requestId, reviewedBy) => {
        // Aprobar (server-side): update status + ausencias 'vacation' por día + saldo
        try {
            const r = await userApiCall('personal.vacationApprove', { companyId: get().activeCompanyId, requestId, reviewedBy });
            if (!r?.success) return r || { success: false, error: 'Error' };

            // Reload
            get().fetchVacationRequests();
            get().fetchVacationBalances();
            return { success: true };

        } catch (e) {
            console.error("Error approving vacation:", e);
            return { success: false, error: e.message };
        }
    },

    rejectVacation: async (requestId, reviewedBy) => {
        try {
            const r = await userApiCall('personal.vacationReject', { companyId: get().activeCompanyId, requestId, reviewedBy });
            if (!r?.success) return r || { success: false, error: 'Error' };
            get().fetchVacationRequests();
            return { success: true };
        } catch (e) {
            console.error("Error rejecting vacation:", e);
            return { success: false, error: e.message };
        }
    },

    updateVacationBalance: async (userId, data) => {
        // data: { initial_balance, accrued_days, used_days } — whitelist en el servidor
        const { activeCompanyId } = get();
        try {
            const r = await userApiCall('personal.vacationBalanceUpdate', { companyId: activeCompanyId, userId, data });
            if (!r?.success) return r || { success: false, error: 'Error' };
            get().fetchVacationBalances();
            return { success: true };
        } catch (e) {
            console.error("Error updating balance:", e);
            return { success: false, error: e.message };
        }
    },

    // ═══════════════════════════════════════════
    // COMBOS / PACKS
    // ═══════════════════════════════════════════

    combos: [],

    fetchCombos: async (search = '') => {
        const { activeCompanyId } = get();
        try {
            const r = await userApiCall('combosFetch', { companyId: activeCompanyId, search });
            if (!r?.success) return [];
            set({ combos: r.combos });
            return r.combos;
        } catch (e) {
            console.error('Error fetching combos:', e);
            return [];
        }
    },

    createCombo: async (data) => {
        try {
            const r = await userApiCall('comboCreate', { companyId: get().activeCompanyId, data });
            if (!r?.success) return r || { success: false, error: 'Error' };
            await get().fetchCombos();
            return { success: true, comboId: r.comboId };
        } catch (e) {
            console.error('Error creating combo:', e);
            return { success: false, error: e.message };
        }
    },

    updateCombo: async (comboId, data) => {
        try {
            const r = await userApiCall('comboUpdate', { companyId: get().activeCompanyId, comboId, data });
            if (!r?.success) return r || { success: false, error: 'Error' };
            await get().fetchCombos();
            return { success: true };
        } catch (e) {
            console.error('Error updating combo:', e);
            return { success: false, error: e.message };
        }
    },

    deleteCombo: async (comboId) => {
        try {
            const r = await userApiCall('comboDelete', { companyId: get().activeCompanyId, comboId });
            if (!r?.success) return r || { success: false, error: 'Error' };
            await get().fetchCombos();
            return { success: true };
        } catch (e) {
            console.error('Error deleting combo:', e);
            return { success: false, error: e.message };
        }
    },

    toggleComboActive: async (comboId) => {
        try {
            const r = await userApiCall('comboToggle', { companyId: get().activeCompanyId, comboId });
            if (!r?.success) return r || { success: false, error: 'Error' };
            await get().fetchCombos();
            return { success: true };
        } catch (e) {
            console.error('Error toggling combo:', e);
            return { success: false, error: e.message };
        }
    },

    fetchCombosForPOS: async () => {
        const { activeCompanyId } = get();
        try {
            const today = new Date().toISOString().split('T')[0];
            const r = await userApiCall('combosForPos', { companyId: activeCompanyId, today });
            if (!r?.success) return [];
            set({ products: r.combos });
            return r.combos;
        } catch (e) {
            console.error('Error fetching combos for POS:', e);
            return [];
        }
    },

    // ═══════════════════════════════════════════
    // INVENTORY ALERTS SYSTEM
    // ═══════════════════════════════════════════

    inventoryAlerts: [],
    unreadAlertCount: 0,

    // ── Alert Settings CRUD ──

    fetchAlertSettings: async (productId) => {
        try {
            const r = await userApiCall('alertSettingsGet', { companyId: get().activeCompanyId, productId });
            return r?.success ? (r.settings || null) : null;
        } catch (e) {
            console.error('Error fetching alert settings:', e);
            return null;
        }
    },

    saveAlertSettings: async (productId, settings) => {
        try {
            const r = await userApiCall('alertSettingsSave', { companyId: get().activeCompanyId, productId, settings });
            return r?.success ? { success: true } : (r || { success: false, error: 'Error' });
        } catch (e) {
            console.error('Error saving alert settings:', e);
            return { success: false, error: e.message };
        }
    },

    // ── Core Alert Engine (server-side) ──

    checkInventoryAlerts: async (specificProductIds = null) => {
        const { activeCompanyId } = get();
        if (!activeCompanyId) return;
        try {
            const r = await userApiCall('alertsCheck', { companyId: activeCompanyId, specificProductIds });
            await get().fetchUnreadAlertCount();
            return r?.success ? { criticalCount: r.criticalCount, lowCount: r.lowCount } : { criticalCount: 0, lowCount: 0 };
        } catch (e) {
            console.error('Error checking inventory alerts:', e);
            return { criticalCount: 0, lowCount: 0 };
        }
    },

    // ── Prediction Engine (PRO, server-side) ──

    checkStockPredictions: async () => {
        const { activeCompanyId } = get();
        if (!activeCompanyId) return;
        try {
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
            await userApiCall('stockPredictionsCheck', { companyId: activeCompanyId, sevenDaysAgo });
        } catch (e) {
            console.error('Error checking stock predictions:', e);
        }
    },

    // ── Fetch & Manage Alerts ──

    fetchInventoryAlerts: async (limit = 50) => {
        const { activeCompanyId } = get();
        try {
            const r = await userApiCall('alertsList', { companyId: activeCompanyId, limit });
            if (!r?.success) return [];
            set({ inventoryAlerts: r.rows });
            return r.rows;
        } catch (e) {
            console.error('Error fetching alerts:', e);
            return [];
        }
    },

    fetchUnreadAlertCount: async () => {
        const { activeCompanyId } = get();
        try {
            const r = await userApiCall('alertsUnreadCount', { companyId: activeCompanyId });
            const count = r?.success ? r.count : 0;
            set({ unreadAlertCount: count });
            return count;
        } catch (e) {
            return 0;
        }
    },

    markAlertRead: async (alertId) => {
        try {
            await userApiCall('alertMarkRead', { companyId: get().activeCompanyId, alertId });
            await get().fetchUnreadAlertCount();
        } catch (e) {
            console.error('Error marking alert read:', e);
        }
    },

    markAllAlertsRead: async () => {
        try {
            const r = await userApiCall('alertsMarkAllRead', { companyId: get().activeCompanyId });
            if (r?.success) set({ unreadAlertCount: 0 });
        } catch (e) {
            console.error('Error marking all alerts read:', e);
        }
    },

    deleteOldAlerts: async (daysOld = 30) => {
        try {
            await userApiCall('alertsDeleteOld', { companyId: get().activeCompanyId, daysOld });
        } catch (e) {
            console.error('Error deleting old alerts:', e);
        }
    },

    // ── WhatsApp Placeholder ──

    sendWhatsAppNotification: async (payload) => {
        // PLACEHOLDER: Ready for future WhatsApp integration
        console.log('📱 [WhatsApp Placeholder] Would send:', payload);
        return { success: true, status: 'queued' };
    },

    // ── Dashboard Alert Summary ──

    fetchAlertSummary: async () => {
        try {
            const r = await userApiCall('alertSummary', { companyId: get().activeCompanyId });
            return r?.success
                ? { criticalProducts: r.criticalProducts, lowProducts: r.lowProducts }
                : { criticalProducts: [], lowProducts: [] };
        } catch (e) {
            console.error('Error fetching alert summary:', e);
            return { criticalProducts: [], lowProducts: [] };
        }
    },

}), {
    name: 'pos-storage',
    partialize: (state) => ({
        carts: state.carts,
        activeCartId: state.activeCartId,
        nextCartId: state.nextCartId,
        currentUser: state.currentUser,
        activeCompanyId: state.activeCompanyId,
        availableCompanies: state.availableCompanies,
        currentCompanyTimezone: state.currentCompanyTimezone,
        currentCurrency: state.currentCurrency,
        currentUserCompanyRole: state.currentUserCompanyRole,
        // Igual que los permisos de acá abajo: sin guardarlo, un arranque OFFLINE
        // lo deja en `false` aunque la empresa lo tenga prendido, porque el camino
        // offline carga el catálogo desde IndexedDB y nunca pasa por la config de
        // la empresa. Resultado: el "Modo Ajuste de Inventario" se apaga solo y el
        // POS deja de dejar vender productos en cero — con el interruptor prendido
        // en Configuración. Reportado en producción el 3-sep-2026.
        inventoryAdjustmentMode: state.inventoryAdjustmentMode,
        // Mismo motivo: sin esto, offline no sabe si la empresa bloquea o solo
        // avisa al pasarse del crédito.
        creditBlockMode: state.creditBlockMode,
        // Los permisos del rol se guardan junto con la sesión, y no es un detalle:
        // sin esto, cualquier arranque que no logre hablar con el servidor deja
        // `rolePermissions` en [] y `hasPermission` niega TODO. Al dueño y a los
        // administradores no les pasa nada —tienen bypass— pero un rol Caja queda
        // con "Acceso Denegado" en el POS: no ve productos y no puede vender.
        //
        // Pasa en dos situaciones reales, las dos reportadas en producción: abrir
        // la app sin señal (arranca por el camino offline, que carga el catálogo
        // desde IndexedDB pero nunca los permisos) y un bootstrap que se cae o se
        // pasa de los 12 segundos en una mañana cargada.
        //
        // Guardarlos convierte eso en lo que corresponde para un POS offline: los
        // permisos son los últimos conocidos hasta que el servidor diga otra cosa.
        rolePermissions: state.rolePermissions,
        // La caja abierta, por el mismo motivo que todo lo de arriba: el POS no
        // deja vender sin caja abierta, y sin guardarla una recarga sin conexión
        // dejaba a la cajera mirando "Apertura de Caja" con la caja abierta de
        // verdad, en el servidor y en el cajón. La abierta en el equipo es la
        // última conocida; el servidor la corrige apenas se lo pueda preguntar.
        cashRegister: state.cashRegister,
        darkMode: state.darkMode
    }),
    onRehydrateStorage: () => (state) => {
        // Al recargar, esta pestaña vuelve a actuar a nombre del usuario persistido.
        // Si la cookie del navegador ya es de otro, el servidor la cortará con
        // SESSION_MISMATCH en la primera llamada (ver src/lib/sessionGuard.js).
        setTabUserId(state?.currentUser?.id ?? null);
        state?.setHasHydrated(true);
    }
}));


// El 401 puede llegar por fuera del store (src/lib/dataApi.js, src/lib/db/sync.js),
// así que el aviso vive en un módulo aparte y acá se le dice qué hacer.
alExpirarSesion(() => {
    try { useStore.getState().marcarSesionExpirada(); } catch { /* noop */ }
});
