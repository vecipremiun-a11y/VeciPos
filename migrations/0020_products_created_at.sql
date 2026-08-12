-- Fecha de creación de cada producto.
--
-- Salió de una pregunta al Asistente IA: "qué productos hace más de 3 meses que
-- no tienen movimiento". La respuesta no podía ser del todo confiable porque sin
-- fecha de alta no hay forma de distinguir un producto DETENIDO de uno que se
-- cargó la semana pasada y todavía no vendió nada. Los dos se ven igual.
--
-- Además arregla un bug: api/external/products.js viene insertando `created_at`
-- e `is_active`, columnas que nunca existieron. Esa ruta —la que usa la tienda
-- para dar de alta productos— falla con "no such column" en cada intento.
-- Verificado contra la base antes de escribir esto.

ALTER TABLE products ADD COLUMN created_at TEXT;
ALTER TABLE products ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;

-- ── Recuperar el pasado ──────────────────────────────────────────────────
--
-- Los 4.996 productos que ya existen no tienen fecha, y dejarlos todos en NULL
-- desperdicia información que la base ya tiene: si un producto se compró en
-- marzo de 2025, con certeza existía en marzo de 2025.
--
-- Lo que se guarda es la PRIMERA EVIDENCIA de que el producto existía, no la
-- fecha de alta real (que nadie registró). Es un piso, no un dato exacto: el
-- producto pudo crearse antes. Para lo que importa —distinguir "nuevo" de
-- "detenido"— un piso alcanza y sobra: si la primera evidencia es de hace dos
-- años, nuevo no es.
--
-- Cobertura medida: 3.063 de 4.996 productos (61%). El resto queda en NULL,
-- que es lo honesto: no hay ningún dato del que deducirla, y una fecha inventada
-- sería peor que ninguna.

UPDATE products
   SET created_at = (
       SELECT MIN(f) FROM (
           SELECT MIN(pi.purchase_date) AS f
             FROM purchase_items pi
            WHERE pi.product_id = products.id
              AND pi.purchase_date IS NOT NULL AND pi.purchase_date != ''
           UNION ALL
           SELECT MIN(si.sale_date) AS f
             FROM sale_items si
            WHERE si.product_id = products.id
              AND si.sale_date IS NOT NULL AND si.sale_date != ''
       )
   )
 WHERE created_at IS NULL;

-- Los reportes van a filtrar por empresa + fecha (productos nuevos del mes,
-- altas por período, y el reporte de detenidos que motivó todo esto).
CREATE INDEX IF NOT EXISTS idx_products_created
    ON products(company_id, created_at);
