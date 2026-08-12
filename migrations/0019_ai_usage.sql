-- Consumo de la App de IA, por sucursal.
--
-- La App se vende a US$ 10 mensuales por sucursal con un cupo de 2.000
-- consultas. Esta tabla es la que hace cumplir ese cupo, y no es un detalle
-- administrativo: cada consulta le cuesta plata real a POSVECI en OpenAI, así
-- que sin un contador confiable el gasto no tiene techo.
--
-- Dos cosas que se resuelven acá y no en el código:
--
--   · `period` guarda el mes YA calculado en horario de Santiago. El servidor
--     corre en UTC, así que una consulta de las 22:00 del 31 de agosto en Chile
--     es 1 de septiembre en UTC: contarla por la fecha cruda le regalaría al
--     cliente consultas del mes siguiente, o le cobraría de más, según el caso.
--     Guardar el período resuelto de una vez evita que cada consulta tenga que
--     acordarse de convertir.
--
--   · `credits` existe porque no todas las consultas cuestan lo mismo. Una
--     pregunta de texto es 1; una foto de factura consume bastante más y cuenta
--     como 3. Sin esta columna, el cupo mediría cantidad de clics en vez de
--     gasto, que es lo que en realidad hay que limitar.
--
-- Los tokens y el costo se guardan para poder revisar el margen con datos
-- reales en vez de estimaciones — la tabla de costos del plan es un cálculo,
-- esto va a ser el hecho.

CREATE TABLE IF NOT EXISTS ai_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL,
    user_id INTEGER,
    kind TEXT NOT NULL DEFAULT 'consulta',
    credits INTEGER NOT NULL DEFAULT 1,
    period TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    cached_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

-- El cupo del mes: SUM(credits) WHERE company_id = ? AND period = ?.
-- Corre en CADA consulta antes de llamar a OpenAI, así que tiene que ser barato.
CREATE INDEX IF NOT EXISTS idx_ai_usage_cupo
    ON ai_usage(company_id, period);

-- El tope por minuto, que es la capa que frena un bucle descontrolado mientras
-- está pasando. Un script suelto sin este índice haría un escaneo completo de la
-- tabla en cada intento, justo cuando más golpes por segundo está dando.
CREATE INDEX IF NOT EXISTS idx_ai_usage_ritmo
    ON ai_usage(company_id, created_at);
