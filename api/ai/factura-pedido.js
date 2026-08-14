// Foto de factura → pedido a proveedor, de una sola vez.
//
// Es el mismo trabajo que ya hace el Asistente conversando, pero sin
// conversación: un botón en Pedidos Realizados, una foto, y el pedido queda
// creado. Va aparte del chat porque acá NO hay ida y vuelta — el prompt es
// fijo, se llama al modelo una sola vez y se ejecuta lo que devuelve.
//
// Qué NO hace: adivinar lo que no pudo emparejar. Los renglones que no
// encuentran producto en el catálogo vuelven en `sinEmparejar` con el motivo, y
// la pantalla los muestra. Con la factura de Vastus de prueba, 7 de 12 quedaron
// afuera —5 por ambigüedad real del catálogo (Maruchan Carne vs Carne Asada) y
// 2 por productos no cargados—. Crear el pedido y callarse eso dejaría al
// usuario con menos de la mitad de la factura sin enterarse.

import { createClient } from '@libsql/client';
import OpenAI from 'openai';
import { getSession, isCompanyMember } from '../_lib/guard.js';
import { ritmoExcedido, tieneAppIA, puedeUsarIA, estadoCupo, registrarConsumo, CUPO_MENSUAL } from '../_lib/aiGuards.js';
import { supplierOrderFromInvoice } from '../_lib/purchaseActions.js';

const MODELO = 'gpt-5.6-luna';

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

// Se pide el resultado con forma fija en vez de texto libre: no hay una persona
// leyendo la respuesta, la consume el código.
const ESQUEMA = {
    type: 'object',
    properties: {
        proveedor: { type: 'string', description: 'Nombre del proveedor que emite la factura' },
        numeroFactura: { type: 'string', description: 'Número o folio del documento' },
        fecha: { type: 'string', description: 'Fecha de emisión en AAAA-MM-DD, o "" si no se lee' },
        totalNeto: { type: 'number', description: 'Total neto impreso, 0 si no aparece' },
        lineas: {
            type: 'array',
            description: 'Un renglón por producto comprado',
            items: {
                type: 'object',
                properties: {
                    // El código del proveedor es el dato más valioso del renglón:
                    // no cambia aunque cambien el nombre, el gramaje o la
                    // abreviatura, así que una vez que se aprende a qué producto
                    // corresponde, esa factura entra sola para siempre.
                    codigo: { type: ['string', 'null'], description: 'El código del proveedor de la columna Código, tal cual. null si la factura no trae esa columna' },
                    descripcion: { type: 'string', description: 'El texto del producto TAL CUAL figura en la factura' },
                    cantidad: { type: 'number' },
                    costo: { type: 'number', description: 'Costo unitario SIN IVA, con el descuento ya aplicado si el total del renglón lo tiene' },
                    iva: { type: 'number', description: 'Porcentaje de IVA del renglón' },
                },
                required: ['codigo', 'descripcion', 'cantidad', 'costo', 'iva'],
                additionalProperties: false,
            },
        },
    },
    required: ['proveedor', 'numeroFactura', 'fecha', 'totalNeto', 'lineas'],
    additionalProperties: false,
};

const INSTRUCCIONES = [
    'Leé esta factura de compra de un comercio chileno y devolvé sus datos.',
    '',
    'Transcribí lo que ves, sin corregir ni completar. Si un dato está borroso, dejalo vacío en vez de suponerlo.',
    'Si la factura trae una columna de código de producto, copiala EXACTA en `codigo`. Es lo que después permite reconocer el producto sin depender del nombre.',
    'La descripción va tal cual está impresa, con sus abreviaturas: no la expandas ni la corrijas. "DINAMITA FH 100" se transcribe así, no como "Doritos Dinamita Flamin Hot".',
    'Los renglones sin cantidad ni precio son formulario en blanco, NO compras: no los incluyas. Un talonario preimpreso puede traer decenas de líneas vacías.',
    'No incluyas renglones que no son productos: fletes, "distribución y logística", redondeos.',
    'Si un renglón trae descuento, fijate si el TOTAL de esa línea ya lo tiene aplicado. El costo unitario que devuelvas tiene que ser el que, multiplicado por la cantidad, da ese total.',
    'Si la factura no desglosa IVA, poné 19 (el general en Chile) salvo que el documento diga otra cosa.',
].join('\n');

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const session = getSession(req);
    if (!session) return res.status(401).json({ success: false, error: 'No autenticado' });

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        const { companyId, imagen } = body;
        if (!companyId) return res.status(400).json({ success: false, error: 'Falta companyId' });
        if (!imagen) return res.status(400).json({ success: false, error: 'Falta la imagen de la factura' });

        const turso = getTurso();
        if (!(await isCompanyMember(turso, session.uid, companyId))) {
            return res.status(403).json({ success: false, error: 'Sin acceso a esta empresa' });
        }

        // Los mismos candados que el chat, y en el mismo orden: cuesta plata
        // igual, así que se protege igual.
        if (await ritmoExcedido(turso, companyId)) {
            return res.status(429).json({ success: false, error: 'RITMO', message: 'Muchas cargas seguidas. Esperá un momento.' });
        }
        if (!(await puedeUsarIA(turso, session.uid, companyId))) {
            return res.status(403).json({
                success: false, error: 'SIN_ROL',
                message: 'No tenés habilitada la carga de facturas con IA. El dueño puede activarla desde Roles.',
            });
        }
        if (!(await tieneAppIA(turso, companyId))) {
            return res.status(403).json({
                success: false, error: 'SIN_APP',
                message: 'Leer facturas por foto es parte del Asistente IA. Activalo desde el Marketplace.',
            });
        }
        const cupo = await estadoCupo(turso, companyId);
        if (cupo.agotado) {
            return res.status(200).json({
                success: false, error: 'CUPO',
                message: `Llegaste a las ${CUPO_MENSUAL.toLocaleString('es-CL')} consultas del mes. Se renueva el 1º.`,
            });
        }

        // ── Leer la factura ──────────────────────────────────────────────
        const openai = getOpenAI();
        const r = await openai.responses.create({
            model: MODELO,
            instructions: INSTRUCCIONES,
            input: [{
                role: 'user',
                content: [
                    { type: 'input_text', text: 'Leé esta factura.' },
                    { type: 'input_image', image_url: imagen, detail: 'auto' },
                ],
            }],
            text: { format: { type: 'json_schema', name: 'factura', schema: ESQUEMA, strict: true } },
        });

        // Se cobra apenas la lectura vuelve, antes de mirar qué trajo. Una foto
        // que no era factura igual se pagó en OpenAI; si solo se descontara
        // cuando sale bien, mandar fotos cualquiera saldría gratis y además no
        // contaría para el tope por minuto, que se calcula sobre esta misma tabla.
        const uso = {
            input: r.usage?.input_tokens || 0,
            output: r.usage?.output_tokens || 0,
            cached: r.usage?.input_tokens_details?.cached_tokens || 0,
        };
        await registrarConsumo(turso, { companyId, userId: session.uid, kind: 'foto', uso });

        let leido;
        try { leido = JSON.parse(r.output_text); }
        catch { return res.status(200).json({ success: false, error: 'No pude leer la factura. Probá con una foto más nítida.' }); }

        if (!leido?.lineas?.length) {
            return res.status(200).json({
                success: false,
                error: 'No encontré productos en esa imagen. ¿Es una factura de compra?',
            });
        }

        // ── ¿Esta factura ya se cargó? ───────────────────────────────────
        //
        // Se avisa en vez de bloquear: puede haber dos documentos con el mismo
        // número de proveedores distintos, y el dueño sabrá.
        let yaCargada = null;
        if (leido.numeroFactura) {
            const dup = await turso.execute({
                sql: `SELECT id, created_at FROM supplier_orders
                      WHERE company_id = ? AND invoice_number = ? LIMIT 1`,
                args: [companyId, String(leido.numeroFactura)],
            });
            if (dup.rows[0]) yaCargada = { pedidoId: Number(dup.rows[0].id), fecha: dup.rows[0].created_at };
        }

        // ── Emparejar y crear ────────────────────────────────────────────
        const resultado = await supplierOrderFromInvoice(turso, companyId, session, {
            proveedor: leido.proveedor,
            lineas: leido.lineas,
            numeroFactura: leido.numeroFactura,
        });

        if (!resultado.success) {
            return res.status(200).json({
                success: false,
                error: resultado.error,
                leido: { proveedor: leido.proveedor, numeroFactura: leido.numeroFactura, renglones: leido.lineas.length },
                sinEmparejar: resultado.sinEmparejar || [],
            });
        }

        // El neto impreso contra el neto de lo que entró: si no coinciden, algo
        // quedó afuera y conviene decirlo con números, no solo con una lista.
        // Se compara neto contra neto — el total del pedido va con IVA.
        const diferencia = leido.totalNeto > 0 ? Math.round(leido.totalNeto - resultado.totalNeto) : null;

        return res.status(200).json({
            success: true,
            ...resultado,
            factura: {
                numero: leido.numeroFactura || null,
                fecha: leido.fecha || null,
                proveedor: leido.proveedor,
                renglones: leido.lineas.length,
                totalImpreso: leido.totalNeto || null,
                diferencia,
            },
            yaCargada,
        });
    } catch (e) {
        console.error('[ai/factura-pedido]', e);
        return res.status(500).json({ success: false, error: 'Error leyendo la factura: ' + e.message });
    }
}
