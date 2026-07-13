-- 0007: columnas que el código venía creando en runtime (lazy ALTER) y que
-- por eso existían en poskem pero no en demon-oficial. Se formalizan aquí para
-- que migrations/ vuelva a ser la fuente de verdad. Aditivo.
--
-- NOTA: poskem ya tiene estas columnas (creadas por el runtime), por lo que
-- esta migración se aplicó con --only=demon-oficial y en poskem solo se marcó
-- db_migration_version = 7. No re-ejecutar en poskem.

-- preorders: separa encargos ('encargo') de pedidos de la tienda web ('store').
-- Mismo default que api/_lib/preorderActions.js.
ALTER TABLE preorders ADD COLUMN order_kind TEXT DEFAULT 'encargo';

-- companies: formato de boleta + bloque de configuración de comanda/preventa.
-- Mismos defaults que api/_lib/companyActions.js.
ALTER TABLE companies ADD COLUMN receipt_format TEXT DEFAULT '58mm';
ALTER TABLE companies ADD COLUMN preventa_business_name TEXT;
ALTER TABLE companies ADD COLUMN preventa_address TEXT;
ALTER TABLE companies ADD COLUMN preventa_phone TEXT;
ALTER TABLE companies ADD COLUMN preventa_header_message TEXT;
ALTER TABLE companies ADD COLUMN preventa_footer_message TEXT;
ALTER TABLE companies ADD COLUMN preventa_show_phone INTEGER DEFAULT 1;
ALTER TABLE companies ADD COLUMN preventa_show_address INTEGER DEFAULT 1;
ALTER TABLE companies ADD COLUMN preventa_format TEXT DEFAULT '80mm';
