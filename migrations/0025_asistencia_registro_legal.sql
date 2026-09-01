-- Asistencia: de "kiosco interno" a registro auditable (Fase 1 del plan legal).
--
-- Contexto: el Art. 33 del Código del Trabajo (texto de la Ley 21.561) permite
-- tres registros válidos —libro de papel, reloj control y sistema electrónico—,
-- y los sistemas electrónicos quedaron regulados por la Resolución Exenta N°38
-- de la Dirección del Trabajo (26-abr-2024). Esta migración NO nos vuelve un
-- sistema autorizado —eso exige certificación externa, es la Fase 4—, pero
-- cierra los huecos que hoy hacen que `attendance_records` no sirva ni como
-- prueba interna:
--
--   · No había forma de saber DE QUIÉN es una marca ante un tercero: `users`
--     no guarda RUT. Un registro laboral identifica al trabajador por nombre
--     + RUT, no por un `user_id` de nuestra base.
--   · No había folio ni encadenamiento: cualquiera con acceso a la base podía
--     borrar o mover una marca y no quedaba rastro.
--   · No se guardaba desde qué dispositivo se marcó.
--   · Las anulaciones por corrección aprobada solo prendían `is_corrected = 1`,
--     sin quién, cuándo ni por qué.
--
-- Aditivo puro: agregar columnas e índices no toca los datos existentes.

-- ── Identidad legal y jornada pactada del trabajador ────────────────────

ALTER TABLE users ADD COLUMN rut TEXT;

-- Horas semanales del contrato. Por defecto 42: es la jornada ordinaria máxima
-- vigente en Chile desde el 26-abr-2026 según el calendario de la Ley 21.561
-- (45 → 44 el 26-abr-2024 → 42 el 26-abr-2026 → 40 el 26-abr-2028). Se guarda
-- por trabajador porque un part-time pacta menos y el informe de horas compara
-- contra lo PACTADO, no contra el máximo legal.
ALTER TABLE users ADD COLUMN labor_weekly_hours REAL DEFAULT 42;

-- Trabajador excluido de la limitación de jornada (Art. 22 inc. 2°). A estos
-- no se les exige registro de asistencia ni se les calculan horas extra, pero
-- hay que poder marcarlos para que no aparezcan como incumplimiento.
ALTER TABLE users ADD COLUMN labor_exempt_art22 INTEGER DEFAULT 0;

-- ── Marcas: folio, cadena de integridad y trazabilidad ──────────────────

-- Correlativo por empresa. Es el folio que ve el trabajador en su comprobante.
ALTER TABLE attendance_records ADD COLUMN seq INTEGER;

-- Encadenamiento tipo bitácora: hash = SHA-256(prev_hash + campos inmutables).
-- Si alguien edita o borra una marca en la base, la cadena deja de cuadrar y
-- `personal.attendanceVerify` lo detecta. No impide el cambio: lo delata.
ALTER TABLE attendance_records ADD COLUMN hash TEXT;
ALTER TABLE attendance_records ADD COLUMN prev_hash TEXT;

-- Copia de la identidad al momento de marcar. Si mañana se corrige el nombre o
-- el RUT del trabajador, el registro histórico sigue diciendo lo que decía
-- cuando se firmó. Por eso es copia y no un JOIN.
ALTER TABLE attendance_records ADD COLUMN user_rut TEXT;
ALTER TABLE attendance_records ADD COLUMN user_name TEXT;

ALTER TABLE attendance_records ADD COLUMN device_id TEXT;
ALTER TABLE attendance_records ADD COLUMN origin_ip TEXT;

-- Cuándo se GUARDÓ la fila, distinto de `recorded_at` (cuándo ocurrió la marca).
-- En una marca de kiosco son iguales; en una manual o una corrección no, y esa
-- diferencia es exactamente lo que mira un fiscalizador.
ALTER TABLE attendance_records ADD COLUMN created_at TEXT;

-- Anulación documentada. `is_corrected` ya existía como bandera; faltaba el
-- quién/cuándo/por qué y el puntero al registro que la reemplaza.
ALTER TABLE attendance_records ADD COLUMN voided_at TEXT;
ALTER TABLE attendance_records ADD COLUMN voided_by INTEGER;
ALTER TABLE attendance_records ADD COLUMN void_reason TEXT;
ALTER TABLE attendance_records ADD COLUMN replaced_by_record_id INTEGER;

-- El correlativo no se puede repetir dentro de una empresa: si dos marcas
-- simultáneas leen el mismo último seq, la segunda falla y se reintenta.
-- En SQLite un índice UNIQUE admite varios NULL, así que las filas históricas
-- (seq NULL) conviven sin problema.
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_company_seq
    ON attendance_records(company_id, seq);

-- La cadena arranca en 0 y las marcas anteriores a esta migración quedan con
-- seq NULL a propósito: rellenarlas ahora sería fabricar una cadena hacia atrás
-- y darle una garantía de integridad que esos datos no tienen.
UPDATE attendance_records SET created_at = recorded_at WHERE created_at IS NULL;

-- ── Parámetros legales de jornada (por empresa) ─────────────────────────

ALTER TABLE personal_config ADD COLUMN legal_weekly_hours REAL DEFAULT 42;
ALTER TABLE personal_config ADD COLUMN legal_daily_max_hours REAL DEFAULT 10;
ALTER TABLE personal_config ADD COLUMN legal_max_overtime_daily REAL DEFAULT 2;
