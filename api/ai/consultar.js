// Asistente IA — preguntarle al negocio en castellano.
//
// El modelo NO escribe SQL ni toca la base. Elige entre un puñado de reportes
// con nombre que ya existían (los mismos que alimentan la pantalla de Reportes),
// y el servidor los ejecuta con el company_id de la sesión. Esto no es una
// preferencia de estilo: es lo que hace que la seguridad multiempresa de la
// Fase 1 se aplique sola. Con SQL generado, cada consulta sería una oportunidad
// de leer datos de otra empresa o de trabar la base.
//
// Por qué es un archivo aparte y no una acción más de /api/data/actions:
// necesita un maxDuration mucho más largo (varias idas y vueltas con el modelo),
// y ese límite en Vercel se configura por ruta. El resto de la API sigue con su
// tope corto, que es lo que conviene.

import { createClient } from '@libsql/client';
import OpenAI from 'openai';
import { fromZonedTime } from 'date-fns-tz';
import { getSession, isCompanyMember } from '../_lib/guard.js';
import { reportRun } from '../_lib/reportActions.js';
import {
    ritmoExcedido, tieneAppIA, estadoCupo, registrarConsumo,
    TOPE_POR_MIN, CUPO_MENSUAL,
} from '../_lib/aiGuards.js';
import { limpiarParaIA, REPORTES_VEDADOS } from '../_lib/aiRedaccion.js';

const MODELO = 'gpt-5.6-luna';
const MAX_VUELTAS = 6;   // techo de idas y vueltas; sin esto un modelo confundido gira sin fin

let _turso = null;
function getTurso() {
    if (_turso) return _turso;
    const url = process.env.VITE_TURSO_DATABASE_URL;
    const authToken = process.env.VITE_TURSO_AUTH_TOKEN;
    if (!url || !authToken) throw new Error('Faltan variables Turso');
    _turso = createClient({ url, authToken });
    return _turso;
}

let _openai = null;
function getOpenAI() {
    if (_openai) return _openai;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('Falta OPENAI_API_KEY');
    _openai = new OpenAI({ apiKey });
    return _openai;
}

// ── Las herramientas ─────────────────────────────────────────────────────
//
// Cubren todo el sistema: ventas, compras, inventario, caja, gastos, clientes,
// mermas, personal y catálogo. Lo único que NO se expone es el menú de
// Configuración —SII, boleta, integración con la tienda—, porque ahí el
// contenido entero son credenciales y certificados: no hay una columna que
// filtrar, el reporte completo es el problema (ver REPORTES_VEDADOS).
//
// Los datos personales se cortan aparte, en api/_lib/aiRedaccion.js, y por
// nombre de campo en lugar de por reporte: así un reporte nuevo nace protegido
// sin que su autor tenga que acordarse.
//
// Casi todos los reportes toman el mismo par de fechas; se define una vez.
const RANGO = {
    from: ['string', 'Desde AAAA-MM-DD'],
    to: ['string', 'Hasta AAAA-MM-DD'],
};

export const HERRAMIENTAS = [
    ['todaySales', 'Ventas de HOY: total, cantidad de boletas y ticket promedio.', {}],
    ['salesSummaryByDate', 'Resumen de ventas de UN día concreto.', { date: ['string', 'Fecha AAAA-MM-DD'] }],
    ['salesSummaryByRange', 'Resumen de ventas entre dos fechas.', { from: ['string', 'Desde AAAA-MM-DD'], to: ['string', 'Hasta AAAA-MM-DD'] }],
    ['monthlyStats', 'Estadísticas del mes en curso: ventas, ganancia y comparación.', {}],
    ['topProducts', 'Productos MÁS vendidos por cantidad en un rango.', { from: ['string', 'Desde AAAA-MM-DD'], to: ['string', 'Hasta AAAA-MM-DD'] }],
    ['slowMovingProducts', 'Productos de rotación BAJA (venden menos de 1 por día en promedio). Ojo: no significa que estén detenidos — un producto que vende todos los días puede aparecer acá. Para "sin movimiento" usá productosDetenidos.', {}],
    ['productosDetenidos',
        'Productos DETENIDOS de verdad: sin ninguna venta Y sin ninguna compra desde la fecha indicada. Ordenados por plata inmovilizada (stock × costo). Devuelve `datos` con la lista y `resumen.total` con cuántos hay en total — si el total es mayor que la lista, decilo.',
        { desde: ['string', 'Fecha de corte AAAA-MM-DD. Para "hace 3 meses", restale 3 meses a hoy.'] },
        'stalledProducts',
        { desde: 'since' }],
    ['bestMarginProducts', 'Productos que dejan más ganancia, no los que más se venden.', { from: ['string', 'Desde AAAA-MM-DD'], to: ['string', 'Hasta AAAA-MM-DD'] }],
    ['productSalesStats', 'Historial de ventas de UN producto puntual.', { productId: ['number', 'ID del producto'] }],
    ['lowStockProducts', 'Productos por agotarse, bajo su stock mínimo.', {}],
    ['inventoryProducts', 'Inventario: stock y valorización.', {}],
    ['vendorRanking', 'Ranking de vendedores por ventas en un rango.', { from: ['string', 'Desde AAAA-MM-DD'], to: ['string', 'Hasta AAAA-MM-DD'] }],
    ['vendorSalesSummary', 'Detalle de ventas de UN vendedor.', { userId: ['number', 'ID del vendedor'], from: ['string', 'Desde AAAA-MM-DD'], to: ['string', 'Hasta AAAA-MM-DD'] }],
    ['salesByPaymentMethod', 'Cómo pagaron los clientes: efectivo, tarjeta, transferencia.', { from: ['string', 'Desde AAAA-MM-DD'], to: ['string', 'Hasta AAAA-MM-DD'] }],
    ['peakHours', 'Horarios de mayor venta, para decidir turnos.', RANGO],
    ['clientSales', 'Compras de UN cliente.', { clientId: ['number', 'ID del cliente'] }],
    ['invoicesPending', 'Facturas de proveedor pendientes de pago.', {}],
    ['pedidosProveedor', 'Pedidos hechos a proveedores y su estado.', RANGO],
    ['comprasDetalle',
        'RENGLONES de las facturas de compra: qué producto, cuánta cantidad, a qué costo unitario, con qué IVA, de qué proveedor y en qué factura. Usá esto para saber a cuánto se compró algo.',
        { ...RANGO, buscar: ['string', 'Texto para filtrar por producto o proveedor. Mandá "" para traer todo.'] }],
    ['costoHistorico',
        'A cuánto se viene comprando UN producto a lo largo del tiempo y a qué proveedor. Devuelve `datos` con cada compra y `resumen` con una fila POR PRODUCTO (costo mín/prom/máx y unidades). La búsqueda es amplia, así que el resumen puede traer productos parecidos: elegí el que corresponde por nombre y usá SU promedio, nunca mezcles varios.',
        { buscar: ['string', 'Palabras sueltas del producto y/o proveedor, ej. "huevo ariztia". No hace falta el nombre exacto ni el orden correcto: busca por palabra y ordena por cuántas coinciden.'] }],
    ['comprasPorProveedor', 'Cuánto se le compró a cada proveedor en el período.', RANGO],
    ['proveedoresLista', 'Con qué proveedores se trabaja, cuánto se les compró y cuándo fue la última vez. Usalo si no estás seguro de cómo se escribe el nombre de un proveedor.', {}],
    ['devoluciones', 'Devoluciones de venta y su motivo.', RANGO],

    // ── Caja ──
    ['cajasResumen', 'Aperturas y cierres de caja: monto inicial, final, DIFERENCIA (descuadre) y quién la manejó.', RANGO],
    ['cajaMovimientos', 'Entradas y salidas de dinero de la caja con su motivo.', RANGO],

    // ── Gastos ──
    ['gastosPorPeriodo', 'Gastos del negocio (arriendo, luz, servicios). Devuelve `datos` con el detalle y `resumen` por categoría.', RANGO],
    ['gastosRecurrentes', 'Gastos fijos configurados y si están activos.', {}],

    // ── Clientes ──
    ['clientesDeudores', 'Clientes que deben plata, cuánto y cuántas ventas vencidas. Devuelve `datos` y `resumen` con el total.', {}],

    // ── Pérdidas de inventario ──
    ['mermas', 'Productos perdidos (vencidos, rotos, robados): cuánto y por qué. Devuelve `datos` y `resumen` por motivo.', RANGO],
    ['ajustesStock', 'Correcciones manuales de stock: quién, cuánto y por qué.', RANGO],
    ['lotesPorVencer', 'Lotes con vencimiento próximo y cuánta plata representan.', { hasta: ['string', 'Vencen hasta esta fecha AAAA-MM-DD'] }],

    // ── Personal ──
    ['personalPlantilla', 'Quiénes trabajan: cargo, sucursal, fecha de ingreso y tipo de pago. Sin datos bancarios ni personales.', {}],
    ['asistenciaResumen', 'Marcas de asistencia por persona en un período.', RANGO],
    ['ausenciasPorPeriodo', 'Faltas, permisos y licencias por persona. Devuelve `datos` y `resumen` por tipo.', RANGO],
    ['nominaPeriodos', 'Liquidaciones: base, bonos, descuentos, anticipos y total a pagar por persona.', RANGO],
    ['anticipos', 'Adelantos de sueldo entregados.', RANGO],
    ['vacaciones', 'Vacaciones pedidas y saldo de días por persona.', {}],

    // ── Catálogo ──
    ['productosNuevos', 'Productos dados de alta en un período. Devuelve `datos` y `resumen.total`.', RANGO],
    // Gasto en compras por mes. El reporte se llama invoiceMonthly y su parámetro
    // interno es `sixMonthsAgo`, un nombre que al modelo lo confundiría (pensaría
    // que tiene que mandar la fecha de hace seis meses aunque le pregunten por
    // junio). Se expone con nombre claro y se traduce abajo.
    ['comprasPorMes',
        'Gasto en COMPRAS a proveedores agrupado por mes, con total, contado y crédito. Sirve para comparar un mes con otro.',
        { desde: ['string', 'Traer desde este mes en adelante, AAAA-MM-DD (usá el día 1 del mes más antiguo que necesites)'] },
        'invoiceMonthly',
        { desde: 'sixMonthsAgo' }],
];

// ── Traducción de parámetros ─────────────────────────────────────────────
//
// Al modelo se le pide siempre lo mismo: `from` y `to` en AAAA-MM-DD. Los
// reportes, en cambio, cada uno pide lo suyo — `start`/`end`, `startDate`/
// `endDate`, `utcStart`/`utcEnd` — y unos esperan el día suelto mientras otros
// esperan la marca de tiempo UTC del comienzo y el fin de ese día en Chile.
//
// Esa diferencia no puede quedar del lado del modelo: sería pedirle que
// adivine, en cada llamada, cuál de las tres convenciones usa cada reporte. Se
// traduce acá, donde es determinístico.
//
// Descubierto ejecutando las 35 herramientas contra la base: diez fallaban con
// "Unsupported type of value" porque les llegaba `undefined`. Nunca se habían
// llegado a ejecutar — las pruebas anteriores solo miraban qué reporte PEDÍA el
// modelo, no qué devolvía.

const TZ = 'America/Santiago';
const dia = (f = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(f);
const desdeUTC = (d) => fromZonedTime(`${d}T00:00:00`, TZ).toISOString();
const hastaUTC = (d) => fromZonedTime(`${d}T23:59:59.999`, TZ).toISOString();
const restarMeses = (n) => { const f = new Date(); f.setMonth(f.getMonth() - n); return dia(f); };

// nombre de herramienta → cómo armar los parámetros reales del reporte
const AJUSTES = {
    // El servidor sabe qué día es hoy; no hace falta que el modelo lo calcule.
    todaySales:   () => ({ start: desdeUTC(dia()), end: hastaUTC(dia()) }),
    monthlyStats: () => ({ start: desdeUTC(dia().slice(0, 8) + '01'), end: hastaUTC(dia()) }),
    productSalesStats: (p) => ({ productId: p.productId, thirtyDaysAgo: restarMeses(1), today: dia() }),
    // Día suelto (AAAA-MM-DD): consultan tablas ya agregadas por día local.
    salesSummaryByRange: (p) => ({ startDate: p.from, endDate: p.to }),
    topProducts:         (p) => ({ startDate: p.from, endDate: p.to }),
    bestMarginProducts:  (p) => ({ startDate: p.from, endDate: p.to }),
    vendorRanking:       (p) => ({ startDate: p.from, endDate: p.to }),
    peakHours:           (p) => ({ startDate: p.from, endDate: p.to }),
    // Marca de tiempo UTC: consultan la tabla de ventas cruda.
    vendorSalesSummary:   (p) => ({ utcStart: desdeUTC(p.from), utcEnd: hastaUTC(p.to), userId: p.userId }),
    salesByPaymentMethod: (p) => ({ utcStart: desdeUTC(p.from), utcEnd: hastaUTC(p.to) }),
};

// nombre que ve el modelo → nombre real del reporte (cuando difieren)
const REPORTE_DE = Object.fromEntries(HERRAMIENTAS.map(h => [h[0], h[3] || h[0]]));
// nombre de parámetro que ve el modelo → el que espera el reporte
const MAPEO_PARAMS = Object.fromEntries(HERRAMIENTAS.filter(h => h[4]).map(h => [h[0], h[4]]));

const REPORTES_PERMITIDOS = new Set(HERRAMIENTAS.map(h => h[0]));

export function definirHerramientas() {
    return HERRAMIENTAS.map(([name, description, params]) => {
        const properties = {};
        for (const [k, [type, desc]] of Object.entries(params)) {
            properties[k] = { type, description: desc };
        }
        return {
            type: 'function',
            name,
            description,
            parameters: {
                type: 'object',
                properties,
                required: Object.keys(properties),
                additionalProperties: false,
            },
            strict: true,
        };
    });
}

export function instrucciones(hoy, moneda) {
    return [
        'Sos el asistente de POSVECI, un punto de venta chileno. Respondés al dueño o encargado del local.',
        `Hoy es ${hoy}. La moneda es ${moneda}.`,
        '',
        'Respondé SOLO con datos que hayas obtenido de las herramientas. Si una herramienta no devuelve el dato, decí que no lo tenés — nunca lo estimes ni lo inventes: quien pregunta va a tomar decisiones de plata con lo que respondas.',
        'Si la pregunta necesita varios reportes, pedilos todos antes de responder.',
        '',
        'Escribí como le hablarías a un comerciante, no como un informe: la cifra primero, breve, en castellano de Chile. Los montos con separador de miles.',
        'Si la pregunta es ambigua (no dice de qué fecha, de qué producto), asumí lo más razonable y decí qué asumiste, en vez de preguntar de vuelta.',
    ].join('\n');
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const session = getSession(req);
    if (!session) return res.status(401).json({ success: false, error: 'No autenticado' });

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        const { companyId, pregunta, historial = [], imagen = null } = body;

        if (!companyId) return res.status(400).json({ success: false, error: 'Falta companyId' });
        if (!pregunta || typeof pregunta !== 'string' || !pregunta.trim()) {
            return res.status(400).json({ success: false, error: 'Falta la pregunta' });
        }

        const turso = getTurso();

        // Miembro de la empresa (mismo control que el resto de la API).
        if (!(await isCompanyMember(turso, session.uid, companyId))) {
            return res.status(403).json({ success: false, error: 'Sin acceso a esta empresa' });
        }

        // ── Candado 1: ritmo. Primero porque es el más barato y es el que corta
        // un bucle descontrolado sin cargar la base justo cuando está bajo golpes.
        if (await ritmoExcedido(turso, companyId)) {
            return res.status(429).json({
                success: false, error: 'RITMO',
                message: `Demasiadas consultas seguidas. Esperá un momento (máximo ${TOPE_POR_MIN} por minuto).`,
            });
        }

        // ── Candado 2: licencia. Server-side a propósito. hasApp() en el cliente
        // alcanza para las Apps que solo desbloquean pantallas; esta desbloquea
        // gasto real, y ahí el navegador no es una fuente confiable.
        if (!(await tieneAppIA(turso, companyId))) {
            return res.status(403).json({
                success: false, error: 'SIN_APP',
                message: 'El Asistente IA es un complemento aparte. Podés activarlo desde el Marketplace con 30 días de prueba.',
            });
        }

        // ── Candado 3: cupo del mes. Tope duro en el número que se vendió.
        const cupo = await estadoCupo(turso, companyId);
        if (cupo.agotado) {
            return res.status(200).json({
                success: false, error: 'CUPO',
                message: `Llegaste a las ${CUPO_MENSUAL.toLocaleString('es-CL')} consultas de este mes. El cupo se renueva el 1º. Si necesitás más, escribinos.`,
                cupo,
            });
        }

        // ── El ciclo con el modelo ───────────────────────────────────────
        const hoy = new Intl.DateTimeFormat('es-CL', {
            timeZone: 'America/Santiago', dateStyle: 'full',
        }).format(new Date());

        const openai = getOpenAI();
        const tools = definirHerramientas();
        const uso = { input: 0, cached: 0, output: 0 };

        // Con imagen, el turno del usuario deja de ser texto suelto y pasa a ser
        // una lista de bloques. La imagen viaja como data URL; el navegador ya la
        // achicó antes de mandarla, porque una foto de teléfono sin reducir son
        // varios MB y el costo en tokens crece con el tamaño.
        const turnoUsuario = imagen
            ? {
                role: 'user',
                content: [
                    { type: 'input_text', text: pregunta.trim() },
                    { type: 'input_image', image_url: imagen, detail: 'auto' },
                ],
            }
            : { role: 'user', content: pregunta.trim() };

        let input = [
            ...historial.slice(-6),   // memoria corta: alcanza para repreguntar sin inflar el prompt
            turnoUsuario,
        ];

        let respuesta = null;
        const consultados = [];
        const camposQuitados = new Set();

        for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
            const r = await openai.responses.create({
                model: MODELO,
                instructions: instrucciones(hoy, body.currency || 'CLP'),
                tools,
                input,
            });

            uso.input  += r.usage?.input_tokens || 0;
            uso.output += r.usage?.output_tokens || 0;
            uso.cached += r.usage?.input_tokens_details?.cached_tokens || 0;

            const llamadas = (r.output || []).filter(o => o.type === 'function_call');
            if (llamadas.length === 0) { respuesta = r.output_text; break; }

            input.push(...r.output);

            for (const llamada of llamadas) {
                let salida;
                try {
                    // Segunda barrera además del schema: el nombre tiene que estar en
                    // la lista blanca. Sin esto, un nombre inventado por el modelo
                    // llegaría directo al catálogo de reportes.
                    // Doble cierre: lista blanca de herramientas Y reportes vedados
                    // (Configuracion: SII, boleta, integracion).
                    if (!REPORTES_PERMITIDOS.has(llamada.name) || REPORTES_VEDADOS.has(REPORTE_DE[llamada.name])) {
                        salida = { error: 'Reporte no disponible' };
                    } else {
                        const crudos = JSON.parse(llamada.arguments || '{}');
                        // Traducir los nombres de parámetro que el modelo ve a los
                        // que espera el reporte (ver MAPEO_PARAMS arriba).
                        const ajuste = AJUSTES[llamada.name];
                        const mapa = MAPEO_PARAMS[llamada.name];
                        const params = ajuste
                            ? ajuste(crudos)
                            : (mapa
                                ? Object.fromEntries(Object.entries(crudos).map(([k, v]) => [mapa[k] || k, v]))
                                : crudos);
                        // companyId NO viene del modelo: sale de la sesión validada.
                        const r2 = await reportRun(turso, companyId, session, { name: REPORTE_DE[llamada.name], params });
                        if (!r2?.success) {
                            salida = { error: r2?.error || 'El reporte no devolvió datos' };
                        } else {
                            consultados.push(llamada.name);
                            // Algunos reportes devuelven más de un resultado (la lista
                            // y el total real, por ejemplo). Si se mandara solo el
                            // primero, el modelo diría "estos son" mostrando 40 de 445
                            // sin que nadie sepa que faltan.
                            const sets = r2.rows || [];
                            const crudo = sets.length > 1
                                ? { datos: sets[0], resumen: sets[1]?.[0] ?? null }
                                : (sets[0] ?? []);
                            // Último filtro antes de salir del servidor: saca
                            // contraseñas, PIN, datos bancarios, RUT, teléfonos,
                            // correos y direcciones vengan de donde vengan. Un
                            // solo lugar en vez de acertar en cada reporte.
                            const limpio = limpiarParaIA(crudo);
                            limpio.quitados.forEach(c => camposQuitados.add(c));
                            salida = limpio.datos;
                        }
                    }
                } catch (e) {
                    // El error vuelve al modelo para que lo explique o pruebe otra
                    // cosa, en vez de romper la respuesta entera.
                    salida = { error: e.message };
                }
                input.push({
                    type: 'function_call_output',
                    call_id: llamada.call_id,
                    output: JSON.stringify(salida).slice(0, 24000),
                });
            }
        }

        if (respuesta == null) {
            respuesta = 'No pude terminar de resolver esa consulta. Probá preguntándolo de otra forma o más acotado.';
        }

        // Se registra al final y solo si se llamó al modelo: si algún candado
        // cortó antes, no se gastó nada y no corresponde descontar del cupo.
        const { creditos } = await registrarConsumo(turso, {
            // Una foto consume bastante más que una pregunta de texto, así que
            // descuenta 3 créditos del cupo en vez de 1: el tope tiene que medir
            // gasto, no cantidad de clics.
            companyId, userId: session.uid, kind: imagen ? 'foto' : 'consulta', uso,
        });

        return res.status(200).json({
            success: true,
            respuesta,
            reportes: consultados,
            cupo: {
                ...cupo,
                usados: cupo.usados + creditos,
                restantes: Math.max(0, cupo.restantes - creditos),
                avisar: (cupo.usados + creditos) >= CUPO_MENSUAL * 0.8,
            },
        });
    } catch (e) {
        console.error('[ai/consultar]', e);
        return res.status(500).json({ success: false, error: 'Error del asistente: ' + e.message });
    }
}
