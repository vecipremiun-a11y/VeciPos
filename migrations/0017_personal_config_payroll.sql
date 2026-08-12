-- Columnas de nómina que faltaban en personal_config.
--
-- La pantalla Personal → Configuración ofrece todos estos ajustes y el cálculo
-- de liquidaciones los lee, pero las columnas nunca se crearon. Resultado
-- (verificado el 10-ago-2026 contra producción):
--
--   · Guardar la configuración fallaba con "no such column".
--   · Como la config llegaba vacía, TODOS los `if` del cálculo daban falso: no
--     se descontaban faltas ni atrasos, no se pagaban vacaciones ni médicas, y
--     no se aplicaba ningún bono. A un empleado mensual se le liquidaba
--     sueldo base + bono fijo − descuento fijo − anticipos, y nada más.
--
-- Los valores por defecto son los que ya asumía la pantalla
-- (src/components/personal/payroll/PayrollConfig.jsx), para que al abrirla no
-- cambie de comportamiento respecto de lo que el usuario venía viendo.
--
-- Aditivo: agregar columnas no toca los datos existentes.

ALTER TABLE personal_config ADD COLUMN late_discount_enabled INTEGER DEFAULT 0;
ALTER TABLE personal_config ADD COLUMN late_discount_per_minute REAL DEFAULT 0;
ALTER TABLE personal_config ADD COLUMN absence_discount_enabled INTEGER DEFAULT 1;
ALTER TABLE personal_config ADD COLUMN vacation_paid INTEGER DEFAULT 1;
ALTER TABLE personal_config ADD COLUMN medical_paid INTEGER DEFAULT 1;
ALTER TABLE personal_config ADD COLUMN permission_paid INTEGER DEFAULT 0;
ALTER TABLE personal_config ADD COLUMN bonus_punctuality_enabled INTEGER DEFAULT 0;
ALTER TABLE personal_config ADD COLUMN bonus_punctuality_amount REAL DEFAULT 0;
ALTER TABLE personal_config ADD COLUMN bonus_attendance_enabled INTEGER DEFAULT 0;
ALTER TABLE personal_config ADD COLUMN bonus_attendance_amount REAL DEFAULT 0;

-- Base del "valor del día": sueldo base ÷ días. 30 es lo habitual en Chile para
-- el sueldo mensual y es lo que el cálculo ya usaba como respaldo.
ALTER TABLE personal_config ADD COLUMN working_days_per_month INTEGER DEFAULT 30;
ALTER TABLE personal_config ADD COLUMN working_hours_per_day REAL DEFAULT 8;
