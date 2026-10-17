-- Reglas de la oferta: hasta cuándo y cuántas unidades.
--
-- EL PROBLEMA. La oferta de un producto era solo prendida/apagada con su precio
-- y no vencía nunca: había que acordarse de apagarla a mano, en el POS y en la
-- tienda.
--
-- CÓMO SE RESUELVE (definido con Kevin el 6-oct-2026):
--   · offer_until       la oferta vale hasta esa fecha y hora (instante ISO,
--                       UTC). El POS deja de aplicarla sola a esa hora, y la
--                       misma fecha viaja a miniveci.cl para que allá se apague
--                       a la misma hora sin esperar a nadie.
--   · offer_units_limit cuántas unidades se venden a precio de oferta. Se cuentan
--                       en los renglones de venta (sale_items) a precio de
--                       oferta desde offer_started_at; al llegar, se apaga. La
--                       venta que cruza el límite lleva todo a precio de oferta.
--   · offer_units_sold  la cuenta, guardada para que el POS sepa cuántas quedan.
--   · offer_started_at  desde cuándo se cuenta: se fija al prender la oferta.
--
-- Si están las dos reglas, se apaga con la que se cumpla primero. Sin reglas,
-- la oferta funciona como siempre.
--
-- Aditivo puro. Rollback: revertir el commit; las columnas quedan sin usar.

ALTER TABLE products ADD COLUMN offer_until TEXT;
ALTER TABLE products ADD COLUMN offer_units_limit REAL;
ALTER TABLE products ADD COLUMN offer_units_sold REAL NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN offer_started_at TEXT;

CREATE INDEX IF NOT EXISTS idx_products_offer_active
    ON products (company_id)
    WHERE is_offer = 1;
