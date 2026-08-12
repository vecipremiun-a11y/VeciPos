-- ¿Un día sin marca de asistencia cuenta como falta injustificada?
--
-- El cálculo de liquidaciones daba eso por hecho: todo día pasado con turno
-- asignado, sin marca de entrada y sin ausencia cargada, se contaba como falta
-- injustificada y se descontaba del sueldo.
--
-- Eso solo tiene sentido si la empresa realmente usa el kiosco de asistencia.
-- Medido el 10-ago-2026 en producción: la empresa no registra marcas desde el
-- 5-abr (0 en todo agosto), así que a las 5 vendedoras se les estaba
-- descontando entre $100.000 y $133.333 de un sueldo de $500.000 sin que
-- hubieran faltado un solo día. Cerrar el período así habría pagado de menos.
--
-- Por eso el valor por defecto es 0 (apagado): solo descuentan las ausencias
-- que alguien cargó explícitamente. Quien use el control de asistencia lo
-- activa desde Personal → Configuración.

ALTER TABLE personal_config ADD COLUMN absence_from_missing_attendance INTEGER DEFAULT 0;
