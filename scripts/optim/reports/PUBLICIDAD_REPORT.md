# Publicidad IA — reporte de entrega (v1)

23-oct-2026. Migración 0036 aplicada en las dos bases y Blob conectado (25-oct-2026). Sin commitear ni desplegar.

## Qué hace

Menú **Publicidad** (App del Marketplace "Publicidad IA", permiso `ads.use`):

1. Se eligen productos del inventario (1 a 6 según el formato). Arriba hay un
   filtro **Categoría**: "Todas" muestra el buscador; "★ Ofertas" lista todos los
   productos con oferta vigente (las vencidas por fecha o por unidades no salen)
   con su vigencia; una categoría lista sus productos y los de sus
   subcategorías (200 por vez, "Ver más"). Un toque agrega o saca, y "Agregar N"
   llena el formato. Si la oferta tiene fecha o tope de unidades, "Poner en el
   mensaje" escribe "Válido hasta el …".
2. Se elige formato (post vertical, historia, cuadrado, horizontal, cartel A4,
   mayorista, personalizado), campaña y estilo. El estilo viene en
   **Automático**: el sistema lo elige por la fecha (Fiestas Patrias del 1 al 21
   de septiembre, Navidad en diciembre), el tipo de producto (la categoría pesa
   más que el nombre: Aguas → Verano, Carnes → Asado, Frutas → Feria…) y la
   campaña, y avisa cuál eligió y por qué. Hay 18 estilos: 7 generales, 5 por
   fecha y 6 por tipo de producto (`catalogo.js` y `ESTILOS` del servidor; una
   prueba exige que sean los mismos).
3. Fondo: **de color** (gratis, sin IA), **Fondo con IA** (gpt-image-2.5-flare)
   o **Integrar producto con IA** (gpt-image-2.5-sunburst, edita la foto real
   del inventario; solo 1 producto con foto). Cada estilo tiene 3 escenas
   escritas como dirección de arte y cada fondo elige una al azar: apretar de
   nuevo ("Otro fondo con IA") trae otra foto. Opcional: **"Tengo una idea"**,
   texto libre (300 caracteres, con ejemplos para tocar) que reemplaza la escena;
   las reglas fijas se agregan igual. Con un fondo elegido, **"Ajustar este
   fondo"** (cambios rápidos o texto libre) edita ese fondo con sunburst sin
   rehacerlo; el anterior queda en la fila. Pedido de Kevin el 25-oct-2026: el
   que no sabe de publicidad tiene que sorprenderse con solo apretar el botón.
   Con un solo producto con foto, **Integrar** es el botón principal (Kevin
   probó que es lo que mejor sale: la IA ve la foto). "Fondo con IA" usa el
   nombre para llenar la escena de ingredientes o cosas relacionadas, sin
   dibujar el producto.
   **Margen para el producto** (Kevin, 25-oct): el nombre y el precio no lo
   tapan. Con la foto real (fondo de color o "Fondo con IA") es seguro: la foto
   va en el espacio que queda arriba del precio y el nombre. En la escena
   integrada el producto lo ubica la IA, y no respetó los porcentajes del
   pedido (filas 21 y 23: el bidón ocupó casi todo el alto). Desde el 26-oct se
   le pide en lenguaje de fotógrafo (plano abierto, el producto como máximo un
   tercio del alto, un cuarto en el cuadrado, con superficie vacía delante).
   Tampoco es seguro, así que el margen lo asegura el **Encuadre del fondo**
   (gratis, sin IA): la IA entrega solo 3 medidas y cada formato recorta una
   parte, y "Mover" (subir / bajar) usa lo recortado; "Tamaño" (alejar /
   acercar) achica la escena y rellena el borde con la misma imagen
   difuminada. Se guarda con el diseño; un fondo nuevo arranca centrado y el
   ajuste conserva el encuadre. Pedido de Kevin el 25-oct-2026.
   El **cuadrado se genera vertical** (1024×1536): cuesta menos (343 tokens de
   salida contra 439) y deja un tercio de imagen para mover el encuadre.
4. El navegador dibuja encima la foto real (con el fondo blanco quitado), el
   nombre exacto, el precio, la unidad o caja, el precio anterior tachado, la
   etiqueta y los textos. Cambiar cualquiera de esas cosas **no vuelve a llamar
   a la IA**.
   **Editor en la vista previa** (Kevin, 26-oct-2026). Se puede elegir el título,
   el mensaje y el pie; con un producto, también el nombre, el precio, la
   etiqueta y la foto.
   - **Elegir:** se toca o se hace clic en la pieza, que queda con un marco y
     cuatro esquinas.
   - **Mover:** se arrastra la pieza con el dedo o el mouse.
   - **Cambiar el tamaño:** se tira de una esquina, en proporción y desde el
     centro. También desde la barra que aparece debajo: A−, deslizador, A+ y
     el %, más "A su lugar" y "Listo".
   - **En la PC:** las flechas corren la pieza (con Shift, más) y Esc la suelta.
   - **Soltar:** un toque en la imagen fuera de los textos.
   - **El pie** ocupa todo el ancho; achicado, también se mueve a los lados.
   - **La foto** usa su posición y tamaño de siempre (los mismos deslizadores).
   - **Límites:** nada se sale de la imagen, y lo movido queda encima de los
     productos.
   - **Imagen final:** el marco y las esquinas solo se ven en la vista previa.
     Guardar, la miniatura y Descargar dibujan la imagen sin ellos.
   - **Celular:** un dedo sobre un texto (o sobre una esquina del elegido) lo
     toma; en cualquier otra parte, la página se desliza como siempre.
   - **Volver atrás:** "Textos a su lugar" los devuelve todos, y una
     publicidad nueva arranca con todo en su lugar.
   - **Guardado:** en `layout.mover` (`{ x, y, escala }` por pieza, en
     fracciones de la imagen), así que sirve al cambiar de formato.
   - **Encuadre del fondo:** también se mueve a los lados.
   **Tipo de letra**: 7 diseños (Clásica, Impacto, Moderna, Amigable, A mano,
   Elegante, Divertida). Cada uno define la letra del título y la etiqueta, la
   del precio y la del resto (`LETRAS` en `catalogo.js`). Las fuentes vienen de
   Google Fonts, que la PWA ya guardaba para usarlas sin internet; si no llegan,
   sale la letra del sistema. Se guarda en `layout.letras`.
5. Guardar borrador / final, descargar (JPG), historial con miniatura, editar,
   duplicar (para actualizar un precio sin tocar la original) y borrar.
6. **Imprimir el cartel A4** (Kevin, 26-oct-2026). El botón "Imprimir cartel A4"
   aparece solo con el formato Cartel, en el editor y en el Historial.
   - **Resolución:** se dibuja al doble (2480×3508, 300 ppp en la hoja) para que
     las letras salgan nítidas. Todo se mide en proporción al lado, así que el
     dibujo es el mismo que la vista previa: una vez achicado, la diferencia
     media es de 0,9 sobre 255.
   - **Web y PWA:** la imagen se pone en la misma página y, al imprimir, se
     esconde todo lo demás. No usa ventana aparte, que el bloqueador frena y que
     la PWA del iPhone no abre.
   - **La hoja:** A4 sin márgenes, para que el navegador no agregue la fecha ni
     la dirección, con un borde blanco de 5 mm para la impresora. Al terminar
     (`afterprint`) la imagen se quita.
   - **APK:** el WebView no imprime, así que usa un plugin nativo
     (`ImprimirImagenPlugin`) que abre el diálogo de impresión de Android: Wi-Fi,
     Mopria o guardar como PDF. La imagen va centrada y entera, con el mismo
     borde de 5 mm. Un APK anterior contesta UNIMPLEMENTED y la pantalla pide
     actualizar.
7. **Editor reordenado** (Kevin, 26-oct-2026: "compactar… que se vea ordenado").
   - **Arriba de todo, a todo el ancho:** el buscador de productos. La categoría
     u Ofertas abren su lista en 3 columnas.
   - **Barra sobre la vista previa:** menús de **Formato** (con el dibujo de la
     proporción y la medida; en el celular dice 4:5, A4…), **Tipo de letra** y
     **Colores**. Colores trae 8 combinaciones listas (`PALETAS`) y los tres
     colores a mano. Al lado van "Textos a su lugar" y un "?" que explica cómo
     editar.
   - **Columna izquierda:**
     1. **Fondo con IA** primero: los botones, cada uno con su "?"; Campaña y
        Estilo uno al lado del otro; la idea; los fondos; y Encuadre / Ajustar
        con IA como paneles que se abren.
     2. Productos.
     3. Textos.
   - **Los textos explicativos** pasaron a un "?" (`Ayuda`). Con el mouse se
     abre al pasar por encima; en el celular, con un toque. Va en un portal
     para que ninguna tarjeta lo tape.
   - **Se sacaron** los deslizadores de tamaño y posición de la foto: eso ya se
     hace tocándola en la vista previa. `ajustes` se sigue guardando igual.

La IA nunca escribe precios ni nombres: el prompt le prohíbe texto, y lo
comercial lo pone `src/lib/publicidad/componer.js`.

## Archivos

Nuevos:
- `migrations/0036_publicidad.sql` — tablas `ad_designs` y `ad_backgrounds`.
- `api/_lib/publicidadActions.js` — lógica (candados, prompt, IA, Blob, CRUD).
- `api/ai/publicidad.js` — endpoint (sesión → empresa → rol → App → ritmo → cupo).
- `src/pages/Publicidad.jsx` — pantalla (Crear / Historial).
- `src/lib/publicidad/catalogo.js`, `componer.js`, `api.js`.
- `android/.../GuardarImagenPlugin.java` — "Descargar" en el APK guarda en la
  galería (Imágenes › POSVECI); el WebView ignora `<a download>`.
- `android/.../ImprimirImagenPlugin.java` — "Imprimir cartel A4" en el APK
  (PrintManager + PDF de una página; solo APIs de Android, sin dependencias).
- `scripts/optim/test-publicidad.mjs` — 95 pruebas, sin red ni costo.

Modificados: `server.js` (ruta local), `src/App.jsx` (ruta), `MainLayout.jsx`
(menú), `Marketplace.jsx` (ícono), `constants/apps.js`, `modules.js`,
`permissions.js`, `api/_lib/appActions.js` (App `publicidad`), `MainActivity.java`
(registra el plugin), `package.json` (`@vercel/blob` 2.8.1).

No se tocó: `products`, ventas, checkout, SII, WooCommerce, impresión, sync.

## Base de datos

`0036_publicidad.sql`, aditiva. Se aplica con
`npm run migrate-all -- --apply` + `npm run verify-all`.
Rollback: revertir el commit; las tablas quedan sin usar.

## Variables de entorno

| Variable | Dónde | Para qué |
|---|---|---|
| `BLOB_READ_WRITE_TOKEN` | Vercel (veci-pos y veci-pos-demo) y `.env.local` | Guardar fondos, fotos subidas e imagen final. Store `posveci-publicidad` (privado, iad1), conectado el 25-oct a veci-pos y veci-pos-demo (production, preview, development) y copiado a `.env.local`. |
| `OPENAI_API_KEY` | ya existe | Generar fondos |
| `PUBLICIDAD_BLOB_ACCESS` | opcional | `public` para guardar público; por defecto `private` |

Sin `BLOB_READ_WRITE_TOKEN` la pantalla avisa: no genera con IA ni guarda la
imagen final; el fondo de color, la descarga y el historial con miniatura sí
funcionan.

Para crearlo: Vercel → Storage → Create → Blob, acceso **Private**, conectarlo a
los dos proyectos. Vercel agrega la variable sola.

## Costo y control

Medido de verdad contra OpenAI (las 5 imágenes autorizadas por Kevin, 3 de ellas
por el código final `generarFondo`; el ajuste, el 25-oct con Vercel Blob real):

| Modo | Tiempo | Tokens (entrada / salida) | Costo estimado |
|---|---|---|---|
| Fondo (flare, 1024×1536, medium) | 11,5 s | 190 / 343 | US$ 0,011 |
| Integrado (sunburst, con la foto) | 19,2 s | 1.252 / 343 | US$ 0,020 |
| Ajuste (sunburst, sobre un fondo 1024×1536) | 17,8 s | 1.656 / 343 | US$ 0,023 |

La salida fue 343 tokens en los 5 casos: el costo lo fija el tamaño y la
calidad, no el largo del pedido (100 palabras más suman unos US$ 0,0007). El
1024×1024 sale 439 tokens (filas 19-21 de Kevin, 25-oct: US$ 0,015 el fondo y
US$ 0,023 la integrada); por eso el cuadrado ahora se genera vertical.

Precios: texto entrada US$5/M, imagen entrada US$8/M, imagen salida US$30/M
(developers.openai.com/api/docs/models/gpt-image-2.5-flare y
…/gpt-image-2.5-sunburst; platform.openai.com/docs/pricing).

Controles: la IA se llama solo con el botón; cupo 200 imágenes/mes por sucursal
(las fallidas no cuentan); 5 por minuto por empresa; 1 a la vez por usuario;
clave única por pedido (doble clic o reintento tras un corte no cobra dos
veces); sin reintentos automáticos; la IA se corta a los 50 s (la función tiene
60 s). Cada imagen queda en `ai_usage` (kind `imagen`, 0 créditos del
Asistente) con tokens y costo.

**Precio y cupo (Kevin, 25-oct-2026):** 7.990 CLP / US$ 8 al mes por sucursal,
200 imágenes. Costo de IA si se usa entero: US$ 2,2 (solo fondos) a US$ 4
(solo integradas), unos $2.100 a $3.800; el cupo es el techo del gasto.

## Seguridad

- Clave de OpenAI y token de Blob solo en el servidor.
- Cada acción valida sesión y que el usuario sea de la empresa; los productos,
  fondos, cajas y diseños se leen siempre filtrando por `company_id`.
- Las imágenes se guardan privadas en `publicidad/{empresa}/…` y el navegador
  las recibe por el servidor, que verifica que sean de su empresa.
- Errores sin detalles internos al usuario ni en los logs.

## Pruebas hechas

- `node scripts/optim/test-publicidad.mjs` → 101 OK (diseños de letras completos y cada fuente en la hoja que se pide; zonas libres para título, nombre y precio en el pedido, encuadre de fotógrafo en la integrada, cuadrado y casi cuadrado generados verticales; estilos iguales en navegador
  y servidor, elección automática por fecha y producto, idea propia, ajuste:
  solo fondos de la empresa, sigue integrado si lo era, sin IA si no se puede
  leer la base; permisos, App, aislamiento
  entre empresas, copia de precios, inventario intacto, idempotencia, ritmo,
  cupo, borrado de archivos, orden de los candados del endpoint, lista de
  ofertas: solo vigentes, aislada por empresa, sin App igual que el buscador).
- Lista "En oferta" medida contra poskem-db (solo lectura, 25-oct-2026): 10
  ofertas vigentes, 145 ms, 2,2 KB. Categoría (reporte categoryProducts, 200
  filas): "General" 344 ms / 56 KB, "Estantería" 998 ms / 77 KB.
- Composición en Chrome headless: 8 casos (1 producto vertical/horizontal, 3, 4
  y 6 productos, mayorista por caja, escena integrada, cartel sin textos) y 8
  de encuadre con la escena integrada real (subir, bajar y alejar en post,
  cuadrado, historia y horizontal), también sin `filter` del canvas (Safari
  viejo). El difuminado se calcula una vez por fondo: redibujar al mover el
  deslizador tarda 0 a 3 ms.
- Letras y arrastre en Chrome headless (26-oct): los 7 diseños con sus fuentes
  bajadas de Google; las cajas para tomar cada pieza calzan con lo dibujado;
  piezas movidas, agrandadas y achicadas, sin salirse y encima de las tarjetas.
  Con puppeteer, en una página de prueba con el mismo manejo de eventos que la
  pantalla y un celular emulado, 14 casos OK:
  - Tocar el precio lo elige, y arrastrarlo lo mueve sin deslizar la página.
  - Sus esquinas lo agrandan y lo achican sin correrlo de lugar.
  - Un toque fuera de los textos lo suelta.
  - El pie se achica desde su esquina y achicado va a los lados.
  - Deslizar fuera de los textos mueve la página.
  - El mouse elige y arrastra; las flechas corren y Esc suelta.
  - Nada se sale de la imagen.

  Una captura de esa prueba mostró un error que se corrigió antes de entregar:
  el título decía "undefined" por un nombre de variable repetido.

  **Arreglo del 26-oct-2026** (lo encontró Kevin):
  - **Problema:** al volver del Historial, la vista previa quedaba en blanco
    hasta tocarla. La pestaña Historial desarma el lienzo, y el nuevo nacía sin
    dibujo porque el dibujo solo se repetía al cambiar los datos.
  - **Arreglo:** ahora también se dibuja al cambiar de pestaña.
  - **De paso:** al cambiar de pestaña se suelta la pieza elegida. Con una
    elegida, las flechas en el Historial intentaban mover una pieza sin lienzo.
- Imprimir (puppeteer, con los módulos reales servidos por Vite):
  - Al doble sale igual que normal, con una diferencia media de 0,89/255 (solo
    los bordes del texto).
  - El PDF de la impresión es 1 página A4 (595×842 pt) con la imagen; en
    pantalla la hoja no se ve.
  - Al imprimir solo queda visible la hoja, con la imagen centrada y 5 mm de
    borde.
  - `afterprint` la quita.
- `vite build` OK, ESLint sin errores, `MainActivity` y los dos plugins compilan
  (`compileReleaseJavaWithJavac`).
- Vercel Blob real (25-oct): subir, leer por `imagenDeLaEmpresa` y borrar, en
  la prueba del ajuste.
- **No probado:** imprimir en una impresora de verdad (PC, Android e iPhone) y
  el diálogo nativo del APK; el arrastre con el dedo en un teléfono de verdad (APK y PWA);
  la pantalla de punta a punta en el navegador y en el APK
  (falta activar la App en una sucursal), ni las escenas nuevas de cada estilo
  contra la IA real (solo se probó el ajuste; las 5 imágenes autorizadas ya se
  usaron).

## Cómo probar después de desplegar

1. Crear el Blob store y conectarlo; aplicar la migración.
2. Marketplace → activar "Publicidad IA" en una sucursal.
3. Publicidad → agregar un producto con foto → "Fondo con IA" → cambiar el
   precio y los textos (no debe gastar otra imagen) → Guardar final →
   Descargar.
4. Historial → Duplicar → cambiar el precio → Guardar: la original no cambia.
5. En el APK: Descargar → la imagen aparece en la galería, carpeta POSVECI.

## Pendiente / límites de la v1

- En la escena integrada, que el producto salga chico depende de la IA; si sale grande, se corrige a mano con el Encuadre del fondo (con la foto real el margen es automático). El pedido nuevo (plano abierto) todavía no se probó contra la IA real.
- El fondo con IA a veces dibuja estanterías con productos genéricos (sin
  marcas legibles).
- Sin logo ni colores propios del negocio (no existen en la base todavía).
