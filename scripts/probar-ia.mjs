// Verificador de la llave de OpenAI: separa "¿la llave sirve?" de "¿mi código
// funciona?". Si algo falla en el asistente, correr esto primero ahorra buscar
// el problema en el lugar equivocado.
//
//   node scripts/probar-ia.mjs
//
// Prueba tres cosas, en orden de menos a más:
//   1. La llave existe y el modelo responde.
//   2. El modelo sabe pedir una herramienta (la base de todo el asistente).
//   3. El precio real de esa consulta, contra lo que dice el plan.

import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config({ path: '.env.local' });
dotenv.config();

const MODELO = 'gpt-5.6-luna';

if (!process.env.OPENAI_API_KEY) {
    console.error('\n❌ No hay OPENAI_API_KEY.');
    console.error('   Agregala a .env.local así:\n');
    console.error('   OPENAI_API_KEY=sk-proj-...\n');
    process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

console.log(`\nProbando ${MODELO}…\n`);

// ── 1. ¿Responde? ────────────────────────────────────────────────────────
try {
    const r = await openai.responses.create({
        model: MODELO,
        input: [{ role: 'user', content: 'Respondé solo con la palabra: listo' }],
    });
    console.log('1. La llave funciona y el modelo responde ✅');
    console.log(`   dijo: "${r.output_text.trim()}"`);
} catch (e) {
    console.error('1. ❌ Falló la llamada básica');
    if (e.status === 401) {
        console.error('   La llave es inválida o está mal copiada.');
    } else if (e.status === 429) {
        console.error('   Sin crédito o sin cupo. Cargá crédito en platform.openai.com → Billing.');
    } else if (e.status === 404) {
        console.error(`   El modelo "${MODELO}" no está disponible en esta cuenta.`);
    } else {
        console.error('  ', e.message);
    }
    process.exit(1);
}

// ── 2. ¿Sabe pedir una herramienta? ──────────────────────────────────────
// Es lo que hace andar al asistente: si el modelo no pide el reporte, no hay
// datos que mostrar.
try {
    const r = await openai.responses.create({
        model: MODELO,
        instructions: 'Sos el asistente de un punto de venta. Usá las herramientas para obtener datos; nunca inventes cifras.',
        tools: [{
            type: 'function',
            name: 'todaySales',
            description: 'Ventas de HOY: total, cantidad de boletas y ticket promedio.',
            parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
            strict: true,
        }],
        input: [{ role: 'user', content: '¿Cuánto vendí hoy?' }],
    });

    const llamadas = (r.output || []).filter(o => o.type === 'function_call');
    if (llamadas.length > 0) {
        console.log('\n2. Sabe pedir el reporte correcto ✅');
        console.log(`   pidió: ${llamadas.map(l => l.name).join(', ')}`);
    } else {
        console.log('\n2. ⚠️  No pidió ninguna herramienta; contestó de memoria:');
        console.log(`   "${(r.output_text || '').trim().slice(0, 120)}"`);
        console.log('   Habría que ajustar las instrucciones en api/ai/consultar.js');
    }

    // ── 3. Costo real ────────────────────────────────────────────────────
    const u = r.usage || {};
    const inp = u.input_tokens || 0;
    const cache = u.input_tokens_details?.cached_tokens || 0;
    const out = u.output_tokens || 0;
    const costo = ((cache * 0.02) + ((inp - cache) * 0.20) + (out * 1.20)) / 1e6;

    console.log('\n3. Costo real de esa consulta');
    console.log(`   entrada ${inp} tokens (${cache} cacheados) · salida ${out}`);
    console.log(`   = $${costo.toFixed(6)} USD  (~$${(costo * 950).toFixed(2)} CLP)`);
    console.log(`   con 2.000 al mes: $${(costo * 2000).toFixed(2)} de los $10 del complemento`);

    console.log('\n✅ Todo listo. Ya podés activar la App y probar el asistente.\n');
} catch (e) {
    console.error('\n2. ❌ Falló la prueba de herramientas:', e.message);
    process.exit(1);
}
