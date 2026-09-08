-- Personal dado de baja: que quien deja de trabajar salga de Usuarios sin que
-- se pierda nada de lo suyo.
--
-- EL PROBLEMA. Cuando alguien se va, el dueño quiere sacarlo del sistema. Hoy
-- tiene dos caminos y los dos están mal:
--
--   · Borrarlo. La base lo impide si tiene registros laborales —y hace bien,
--     son legales—. Y aunque no los tuviera, el historial saca el nombre del
--     vendedor de `users` con un LEFT JOIN: borrar la fila dejaría las 20.033
--     ventas de una cajera sin nombre, para siempre.
--   · Renombrar el usuario y reusarlo para la persona nueva. Es lo que pasó
--     con "Katy" → "Chelo" (user_id 7) y "deyli" → "Isaura" (user_id 10), y
--     deja el historial contando dos versiones distintas: el 1-ago-2026 las
--     MISMAS 115 ventas figuran como de "Katy" en el reporte por vendedor
--     (que guarda el nombre del día) y como de "Chelo" en el historial (que
--     lo saca de la ficha actual). Peor: las marcas de asistencia de la que
--     se fue quedan a nombre de la que entró, y eso es un registro del Art. 33.
--
-- LA SALIDA. Una baja de verdad: se registra cuándo terminó y por qué, se le
-- quita el acceso, y la persona sale de la lista de Usuarios para aparecer en
-- "Ex personal", con sus fechas y su historial a mano.
--
-- La fila de `users` se queda —es el ancla del nombre en ventas, cajas y
-- asistencia— pero deja de ser un usuario: pasa a ser un legajo.
--
-- Aditivo puro: agregar columnas no toca ninguna fila existente. Rollback:
-- revertir el commit; las columnas quedan sin usar y nada las lee.

-- Cuándo dejó de trabajar. `labor_start_date` ya existía; faltaba el otro
-- extremo, que es lo que convierte a la ficha en un legajo con principio y fin.
ALTER TABLE users ADD COLUMN labor_end_date TEXT;

-- Por qué se fue. Renuncia, despido, fin de contrato, lo que sea: es el único
-- dato de una baja que el sistema no puede deducir solo de los movimientos.
ALTER TABLE users ADD COLUMN labor_end_reason TEXT;

-- Quién la dio de baja y cuándo quedó registrada. No es lo mismo que
-- `labor_end_date`: una salida del 2 de septiembre puede cargarse el 7.
ALTER TABLE users ADD COLUMN labor_end_by INTEGER;
ALTER TABLE users ADD COLUMN labor_end_at TEXT;

-- Para listar el ex personal de una empresa sin recorrer toda la tabla.
CREATE INDEX IF NOT EXISTS idx_users_company_end_date
    ON users(company_id, labor_end_date);
