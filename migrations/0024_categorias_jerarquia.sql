-- Categorías con jerarquía: categoría → subcategoría → sub-subcategoría.
--
-- Hasta acá las categorías eran una lista plana y los productos se ataban a
-- ellas POR NOMBRE (`products.category` es texto suelto). Eso alcanzaba mientras
-- la lista era plana, pero con jerarquía se rompe: "Granel" tiene que poder
-- existir colgando de Mascotas y también de Abarrotes, y con el nombre solo no
-- hay forma de saber de cuál cuelga cada producto.
--
-- Por eso se agregan DOS columnas:
--   categories.parent_id  → de qué categoría cuelga (NULL = es de primer nivel)
--   products.category_id  → a qué categoría pertenece el producto, por id
--
-- La columna `products.category` (el nombre) NO se elimina y se sigue
-- manteniendo al día. No es redundancia por descuido: hay 19 consultas SQL y 12
-- pantallas que la usan hoy —reportes, WooCommerce, encargos, etiquetas—, y
-- migrarlas todas de golpe sería cambiar 31 cosas a la vez para arreglar una.
-- El id pasa a ser la verdad; el nombre queda como copia sincronizada.

ALTER TABLE categories ADD COLUMN parent_id INTEGER;
ALTER TABLE products ADD COLUMN category_id INTEGER;

-- ── Las categorías fantasma ─────────────────────────────────────────────
--
-- Medido antes de escribir esto: 1.484 productos de la empresa `default` tienen
-- una categoría que NO existe en la tabla `categories` — 1.479 de ellos en
-- "General". Como la barra del POS se arma leyendo esa tabla, esos productos
-- hoy no aparecen bajo NINGÚN botón de categoría: solo se llega a ellos
-- buscándolos por nombre.
--
-- Si no se crean acá, esos productos quedarían con category_id en NULL y fuera
-- de la jerarquía para siempre. Se crean OCULTAS (show_in_pos = 0) a propósito:
-- el objetivo de esta migración es que nada cambie de lugar en el POS. Quedan
-- listas para que el dueño las active cuando quiera, con un clic.

INSERT INTO categories (name, color, status, company_id, show_in_pos, show_in_preorders, created_at, updated_at)
SELECT DISTINCT
       p.category,
       '#64748b',
       'active',
       p.company_id,
       0,
       0,
       datetime('now'),
       datetime('now')
  FROM products p
 WHERE p.category IS NOT NULL
   AND TRIM(p.category) <> ''
   AND NOT EXISTS (
       SELECT 1 FROM categories c
        WHERE c.company_id = p.company_id
          AND c.name = p.category
   );

-- ── Atar cada producto a su categoría por id ────────────────────────────
--
-- Después del INSERT de arriba, todo producto con categoría no vacía tiene a
-- quién apuntar. Los que tengan la categoría en blanco quedan en NULL, que es
-- lo honesto: no están en ninguna.

UPDATE products
   SET category_id = (
       SELECT c.id
         FROM categories c
        WHERE c.company_id = products.company_id
          AND c.name = products.category
        LIMIT 1
   )
 WHERE category_id IS NULL;

-- ── Índices ─────────────────────────────────────────────────────────────
--
-- El primero arma el árbol (los hijos de una categoría). El segundo es el que
-- usa el POS al tocar una categoría con descendientes: trae los productos de
-- toda la rama de una.

CREATE INDEX IF NOT EXISTS idx_categories_company_parent
    ON categories(company_id, parent_id);

CREATE INDEX IF NOT EXISTS idx_products_company_category_id
    ON products(company_id, category_id);
