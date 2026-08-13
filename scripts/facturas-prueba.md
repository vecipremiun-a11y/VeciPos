# Facturas de prueba para la lectura por foto

Lo que dice el papel, transcrito a mano y verificado con las sumas. Sirve para
comparar contra lo que devuelva el modelo: sin esto, "leyó bien" es una
impresión y no un dato.

Las tres son reales, del 11-ago-2026, y cubren casos distintos a propósito.

---

## 1 · Vastus #1368365 — factura electrónica, 12 renglones

El caso normal: impresa, muchos renglones, columnas de descuento vacías salvo
una. La foto está algo rotada y con brillo arriba a la izquierda.

| Código | Cant | Descripción | P. unitario | Total |
|---|---|---|---|---|
| 187039009 | 12 | SOPA INSTANTANEA BOWL SABOR POLLO 12X94GR | 847 | 10.164 |
| 187039008 | 24 | SOPA INSTANTANEA BOWL SABOR CARNE 12X94GR | 847 | 20.328 |
| 187039010 | 12 | SOPA INSTANTANEA BOWL SABOR CAMARON 12X94GR | 847 | 10.164 |
| 154040564 | 24 | TOALLA FEM KOTEX COM&PROT NOCT C/A 24X8 | 994 | 23.856 |
| 132030703 | 12 | VINAGRE MANZANA TRAVERSO 24 X 250 CC | 730 | 8.760 |
| 186039589 | 36 | SALSA TOMATE EL VERGEL 160GRX36 ITA | 241 | 8.676 |
| 259039902 | 6 | DAILY GOTAS TRADICIONAL 35X180ML | 796 | 4.776 |
| 223038574 | 12 | MARUCHAN INSTANT LUNCH 64 GRS CARNE | 952 | 11.424 |
| 223038575 | 12 | MARUCHAN INSTANT LUNCH 64 GRS QUESO | 952 | 11.424 |
| 223038573 | 4 | MARUCHAN INSTANT LUNCH 64 GRS POLLO | 952 | 3.808 |
| 154049879 | 4 | PANAL HUGIES ACTSEC XG 8X10 RINC | 2.226 | 7.828 |
| DL000 | 1 | DISTRIBUCION Y LOGISTICA | 1 | 1 |

**Neto 121.209 · IVA 23.030 · Total 144.239.** Los doce totales suman
exactamente 121.209, así que la transcripción está verificada.

Trampas de esta factura:

- El renglón de PANAL trae `DESC1 12,08`, un porcentaje de descuento. El total
  del renglón (7.828) ya lo tiene aplicado: 4 × 2.226 daría 8.904.
- `DISTRIBUCION Y LOGISTICA` por $1 **no es un producto**. Si entra al catálogo
  como uno más, ensucia el inventario para siempre.

---

## 2 · MLM #11606 — MANUSCRITA, 2 de 28 renglones

El caso difícil, y el que más importa: un talonario con 28 productos impresos
donde solo se llenaron dos a mano, en lapicera azul.

| N° | Cant | Descripción | P. unitario | Total |
|---|---|---|---|---|
| 14 | 5 | Finesse Aroma 6x8 | 7.500 | 37.500 |
| 25 | 4 | Nova Ultra 2x6 | 6.200 | 24.800 |

**Venta total 62.300** (37.500 + 24.800 = 62.300 ✅).

Trampas:

- **Los otros 26 renglones están impresos pero VACÍOS.** Traerlos con cantidad
  cero, o peor, inventarles cantidad, sería el error más caro de todos.
- Cantidad y precio son manuscritos. El "5" y el "4" son los que más riesgo de
  confusión tienen.
- No hay IVA desglosado ni número de RUT del comprador; donde dice RUT está
  escrito "IQUIQUE".

---

## 3 · Vastus #1368466 — factura electrónica limpia, 3 renglones

El caso fácil: pocos renglones, foto derecha, buen contraste.

| Código | Cant | Descripción | P. unitario | Total |
|---|---|---|---|---|
| 12600397 | 1 | DOKO Cachorro CL 19,5KG | 23.950 | 23.950 |
| 12597560 | 1 | DOKO Perro Adulto M/G CL 19,5KG | 23.950 | 23.950 |
| 12595893 | 1 | CAT CHOW Adulto Carne CL 19,5KG | 48.939 | 48.939 |

**Neto 96.839 · IVA 18.399 · Total 115.238** (los tres suman 96.839 ✅).

Trampa: los tres renglones muestran `1.500,00` en la columna DESC3, pero el
total de cada uno es igual al precio unitario. Ese descuento **no está aplicado
al renglón** — restarlo daría un total que no cuadra con la factura.

---

## Cómo se evalúa

No alcanza con que "se parezca". Para cada factura:

1. ¿Sacó la cantidad correcta de renglones? (12, **2**, 3)
2. ¿Cada cantidad y cada costo unitario coinciden con la tabla?
3. ¿La suma de los renglones da el neto de la factura?
4. ¿Descartó lo que no es producto (distribución, renglones vacíos)?

El punto 3 es el más útil: es una verificación que el propio sistema puede hacer
solo. Si los renglones no suman el neto impreso, algo se leyó mal —y conviene
avisarlo en pantalla en vez de dejar que se guarde una compra descuadrada.
