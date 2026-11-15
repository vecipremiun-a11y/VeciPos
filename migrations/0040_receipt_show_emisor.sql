-- "Mostrar" de razón social, giro y dirección en la boleta.
--
-- EL PEDIDO. Kevin (10-nov-2026) quiere ver en Configuración → Boleta la razón
-- social y el giro, como el resto de los datos que se imprimen. El 13-nov-2026
-- fijó lo que sale por defecto: nombre de fantasía, RUT y dirección. Razón
-- social y giro salen solo si el cliente los marca.
--
-- LO QUE DICE EL SII. Formato Boletas Electrónicas v4.2 (8-sep-2025): del
-- emisor, solo el RUT va impreso sí o sí. Razón social, giro y dirección son
-- "dato opcional" (columna I = N) desde los cambios del 1-jun-2024 y el
-- 31-dic-2024. El RUT no tiene "Mostrar": en la boleta electrónica sale siempre.
-- En la factura electrónica los tres son obligatorios: ahí estos "Mostrar" no
-- se aplican (lo resuelve emisorParaImprimir en src/lib/boletaA4.js).
--
-- LAS COLUMNAS.
--   receipt_show_razon_social  0 por defecto: sale solo si el cliente la marca.
--   receipt_show_giro          0 por defecto, igual.
--   receipt_show_address       1 por defecto: la dirección sigue saliendo donde
--                              ya salía. Sin dirección escrita no sale nada.
--
-- Al desplegar: el servidor lee estas columnas con respaldo (si no existen,
-- lee las de antes y la app usa los mismos valores por defecto).
--
-- Aditivo. Rollback: revertir el commit; las columnas quedan sin usar.

ALTER TABLE companies ADD COLUMN receipt_show_razon_social INTEGER DEFAULT 0;
ALTER TABLE companies ADD COLUMN receipt_show_giro INTEGER DEFAULT 0;
ALTER TABLE companies ADD COLUMN receipt_show_address INTEGER DEFAULT 1;
