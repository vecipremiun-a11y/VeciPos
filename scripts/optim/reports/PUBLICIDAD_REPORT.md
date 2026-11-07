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
2. Se elige formato (post vertical, historia, cuadrado, horizontal, mayorista,
   cartel A4 vertical u horizontal, pantalla del local horizontal o vertical,
   personalizado), campaña y estilo. El estilo viene en
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
6. **Imprimir** (Kevin, 26-oct-2026 para el cartel; el 27-oct pidió "toda
   debería decir imprimir"). El botón está en todos los formatos: en los dos
   editores y en cada publicidad del Historial. Con el Cartel es el botón
   principal ("Imprimir cartel A4"); con los demás, uno común ("Imprimir").
   - **Orientación:** la imagen va entera y centrada en una A4. La apaisada
     (1,91:1) va en la hoja acostada: parada ocuparía un tercio de la hoja. Lo
     que ocupa de la hoja: cartel 91 %, 4:5 80 %, 9:16 74 %, 1,91:1 69 % (acostada)
     y 1:1 64 %.
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
     borde de 5 mm. La apaisada arranca con la hoja acostada (en el diálogo se
     puede cambiar). Un APK anterior contesta UNIMPLEMENTED y la pantalla pide
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
8. **Con chat** (Kevin, 27-oct-2026: "que solo aparezca el chat y el botón
   generar, nada de conversación").
   - **Pestañas:** Rápida / Con chat / Historial.
   - **Pantalla:** el cliente escribe y aprieta Generar. Opcionalmente elige el
     formato, agrega hasta 3 productos del inventario (foto real y precio) y sube
     hasta 2 imágenes (logo o foto). Hay ideas de ejemplo para empezar.
   - **Fotos de los productos** (Kevin, 27-oct-2026: "cómo sé si ese producto
     tiene imagen"):
     - **Buscador:** cada resultado muestra su foto, y los que no tienen dicen
       "sin foto". Vale también para el buscador de la Rápida.
     - **Adjuntos del chat:** muestran la foto; si un producto no tiene, se
       avisa que la IA lo dibuja por el nombre y que se puede subir con «Imagen».
     - **Carga:** primero las que ya están en el equipo; las que faltan van en
       un solo pedido (`productImages`), sin repetir la que ya viene en camino.
   - **Lo que se pidió:** queda en una lista con miniaturas. Tocar una versión
     vuelve a ella, y el próximo pedido parte de esa.
   - **La IA hace la publicidad entera, textos y precios incluidos.** Lo eligió
     Kevin; la pantalla avisa que se revise antes de publicar.
   - **Cambiar o crear otra:** lo decide un director de arte (`gpt-5.6-luna`,
     JSON estricto, tope de 15 s), que además escribe el pedido a la IA de
     imágenes. Si falla, se sigue con el texto del cliente tal cual: cambiar si
     hay imagen, crear si no.
   - **Modelos:** sin referencias, flare (generar); con la imagen actual, fotos
     de productos o lo subido, sunburst (editar).
   - **Tamaño a la medida del formato** (Kevin, 27-oct-2026: pasada a 1200×628,
     salió 1536×1024 "con relleno nublado"; no llenaba la medida pedida).
     - Los modelos aceptan medidas a pedido: lados múltiplos de 16, proporción
       entre 1:3 y 3:1 y de 655.360 a 8,3 millones de píxeles (documentación de
       OpenAI, guía de generación de imágenes).
     - `sizeChat` pide la proporción del formato con los mismos píxeles que
       1024×1536, para que el costo no cambie: 4:5 → 1120×1408, 9:16 → 944×1680,
       1,91:1 → 1728×912, A4 → 1056×1488. El cuadrado sigue en 1024×1024. Un
       personalizado más extremo que 3:1 queda en 3:1.
     - Como la proporción coincide (a menos de 1 %), `zoomEntera` la muestra
       llena, sin relleno.
     - «Pasarla a…» ahora aparece cuando la imagen no llena el formato, aunque
       los dos sean verticales (4:5 → 9:16). Las de antes, hechas en 3 medidas,
       lo ofrecen para rearmarse a la medida exacta.
     - Si la proporción ya coincide (4:5 → mayorista), no se ofrece y el
       servidor lo rechaza sin gastar (`mismaProporcion`).
   - **Recorte (antes de la medida exacta):** la IA deja los textos pegados al
     borde aunque se le pida margen, así que una imagen que no coincide se
     muestra **entera** (`zoomEntera`, con relleno difuminado), y "Llenar todo"
     la recorta si se quiere.
   - **Guardar:** en el Historial con `layout.modo = 'chat'`, los pedidos y las
     versiones (que quedan ligadas al diseño y se borran con él). Puede no tener
     productos. Imprimir el cartel A4, descargar y abrir desde el Historial
     funcionan igual.
   - **Otro formato sin escribir** (Kevin, 27-oct-2026: "si la imagen la quiero
     para otro formato, ¿tendría que escribirlo?"; antes había tenido que
     escribir "ahora para esa dimensión" y después pedir que usara el ancho):
     - **Misma forma** (4:5, 9:16 y A4 son verticales): basta con elegir el
       formato. La IA solo hace imágenes verticales, horizontales o cuadradas,
       así que generar otra daría la misma; no se ofrece y el servidor la
       rechaza (`MISMA_FORMA`) sin gastar.
     - **Otra forma** (vertical → horizontal o cuadrada): aparece «Pasarla a
       1,91:1». Manda `adaptar: true`, sin texto ni adjuntos y sin director de
       arte (0,5 a 5 s menos y sin su costo). El pedido le dice a la IA que use
       todo el ancho o el alto, con el producto grande, y sin franjas de fondo
       vacío. Lo mismo se agregó cuando el cambio de formato se pide escribiendo:
       antes decía "composición exactamente igual".
     - **Solo acomodar, sin agregar** (Kevin, 28-oct-2026): un arroz solo sobre
       fondo blanco, pasado a 800×800, volvió con granos, una cuchara y un sello
       "PESO NETO 1 kg." que nunca pidió (fila 42, US$0,0257). El pedido decía
       "una publicidad terminada", "el precio bien visible" y "nada de franjas
       de fondo vacío", así que la IA inventó un precio y llenó el blanco. Ahora
       dice: pasala a esta forma y acomodá lo que ya tiene, sin agregar ningún
       elemento, adorno, sello, texto ni precio; si tiene textos, se reparten
       para usar el ancho o el alto; si es solo un producto, se agranda sin
       cortarlo; un fondo liso sigue liso. Al pasarla ya no lleva "colores
       ricos" ni "textos entre comillas". Escrito a mano con un cambio de forma
       usa el mismo acomodo, "sin agregar nada más que el cambio pedido".
       Rollback: revertir el commit, sin migración.
     - **Guardar:** como cualquier cambio (punto 9), guardarla en otro formato
       crea otra publicidad, así quedan las dos en el Historial (la del post y la
       del cartel).
     - **Borrar:** las dos comparten versiones. Al borrar una, las que usa la
       otra pasan a esa y se borran cuando se borre la última. Antes se perdían:
       también le pasaba a una copia hecha con «Duplicar».
9. **Cada guardado es otra publicidad** (Kevin, 27-oct-2026: "guardo, borro y
   cambio a otro fondo sin iniciar en Nueva, y el segundo se guarda encima del
   primero… cada guardado debería guardarse independiente y, si no se cambió el
   nombre, decir oferta del día #1 o #2").
   - **Con cambios desde que se guardó o se abrió** (productos, precios, fondo,
     textos, formato, colores, encuadre, versión del chat), guardar crea otra.
     La anterior queda igual, y debajo de los botones se avisa antes de guardar.
   - **Sin cambios** actualiza la misma, para no duplicar: pasar el borrador a
     final, apretar Guardar dos veces, o cambiarle solo el nombre. Se compara una
     firma de lo que se ve (`firmaDiseno` / `firmaChat`), sin el nombre y sin las
     fotos mientras se cargan.
   - **Nombre:** el que ya está se numera (`tituloLibre`, por empresa). La
     primera queda "OFERTA DEL DÍA", las siguientes "#2", "#3"… Una abierta
     ("#2") y guardada con cambios sigue la cuenta de su base. Un nombre que no
     está queda tal cual, aunque termine en "#". Los `%` y `_` no son comodines.
     Al actualizar sin nombre se conserva el que tenía (con su número).
   - **Elegí que la primera no lleve "#1"** (Kevin dijo "#1 o #2"): renombrar
     la primera al guardar la segunda sería tocar una ya guardada.
   - **Duplicar** ahora abre la copia sin guardar nada; al guardarla queda otra,
     numerada. Antes creaba un borrador "(copia)" que, editado y guardado con
     esta regla, dejaba tres. La acción `duplicar` del servidor sigue y también
     numera.
   - **Rollback:** revertir el commit. No hay migración: la columna `title` ya
     existía.
   - **Servidor:** `generarChat` en `publicidadActions.js`, acción `generarChat`
     con el mismo ritmo y cupo. La reserva y el cierre de cada generación pasaron
     a funciones compartidas con `generarFondo`, con el mismo comportamiento: lo
     cubren las mismas pruebas.
10. **Hoja acostada y pantallas del local** (Kevin, 28-oct-2026: "formato de
    hoja… y para pantallas de 32 pulgadas"; eligió hoja A4 horizontal y
    pantalla horizontal y vertical).
    - **Formatos nuevos:**

      | Formato | Medida | El chat la pide en |
      |---|---|---|
      | Cartel A4 horizontal | 1754×1240 | 1488×1056 |
      | Pantalla horizontal (televisor 16:9) | 1920×1080 | 1680×944 |
      | Pantalla vertical (televisor parado) | 1080×1920 | 944×1680 |

      Las pantallas van en Full HD, que es lo que muestran los televisores de
      32". El fondo de la rápida sale de 1536×1024 (los acostados) o de
      1024×1536 (la parada), como los demás.
    - **Cartel:** el que ya estaba pasó a llamarse **Cartel A4 vertical** («Hoja
      para imprimir, parada»). Kevin pidió la hoja vertical y ya estaba como
      «Cartel para imprimir»: con el nombre nuevo se reconoce. Las dos hojas (`hoja: true` en
      `catalogo.js`) tienen «Imprimir cartel A4» como botón principal, y la
      acostada sale en hoja acostada.
    - **Chat:** el nombre que lee la IA dice que la pantalla «se mira de lejos».
      La pantalla vertical tiene la medida de la historia: pasar de una a otra
      no gasta una imagen.
    - **Varios productos en un formato acostado:** con 5 o 6 productos van en
      dos filas parejas (3 + 2, 3 + 3), ya no 4 + 1 o 4 + 2. Antes solo los
      tenía el personalizado ancho: el horizontal admite 4.
    - **Una prueba exige** que el navegador y el servidor tengan los mismos
      formatos y que el chat pida cada uno en su proporción. El servidor guarda
      aparte la proporción de cada formato (`RELACION`): sin ella, la
      generación con chat de un formato nuevo saldría en 4:5.
    - **APK vieja:** una publicidad guardada en un formato nuevo se abre ahí como
      publicación vertical, hasta actualizar la app.
    - **Rollback:** revertir el commit. No hay migración: `format` es texto
      libre.
11. **«Agregar imagen»: un complemento encima, no un producto** (Kevin,
    28-oct-2026: "al lado del buscador pone agregar imagen de archivos"; el
    29-oct lo cambió: "todo lo que se agregue que entre como un elemento
    recortando el fondo blanco… poner logos o más cosas; solo con productos
    registrados se arma la oferta de 2 o 3 o más; si se agrega una imagen, que
    solo sea como complemento").
    - **Dónde:** en la Rápida, «Agregar imagen» («Imagen» en el celular) junto
      al buscador, y también junto a la lista de una categoría o de las
      ofertas. JPG, PNG o WebP, achicada a 1000 px (un PNG con transparencia la
      conserva).
    - **Qué hace:** la imagen entra **sin su fondo blanco** (el mismo recorte
      sin IA de las fotos de productos: borra el blanco que toca los bordes),
      al centro y encima de todo, y queda elegida. Se arrastra, se agranda
      desde las esquinas o con A−/A+, y se borra con «Quitar» o con Supr en la
      PC. Hasta 4 por publicidad; cada una entra un poco corrida de la
      anterior.
    - **No es un producto:** no lleva nombre ni precio, no cuenta en
      «Productos (n/6)» y no cambia la grilla de la oferta, que se arma solo
      con los productos del inventario. La IA (fondo e integrar) no la ve.
    - **Lista «Imágenes agregadas»**, bajo «Productos»: miniatura, «Quitar
      fondo blanco» (por si la imagen tiene blanco que importa) y borrar.
    - **Solo imágenes y textos** (un logo y un aviso, sin productos) también se
      guarda, se baja y se imprime. La IA de fondo sigue pidiendo un producto.
    - **Guardado:** se mandan aparte (`imagenes`: `foto` nueva o `fotoUrl` ya
      guardada). El servidor sube las nuevas a Blob (`imagenes/…`) y las anota
      él mismo en `layout.imagenes` (`{ id, fotoUrl, quitarFondo }`); lo que
      venga en el layout con ese nombre se descarta. Su lugar y tamaño van en
      `layout.mover` con su id, como los textos.
    - **Seguridad:** el id tiene que ser `img-…` (no se pisa con el título u
      otra pieza) y no repetido. Una `fotoUrl` que vuelve tiene que estar ya en
      una publicidad de **esta** empresa (la misma o la original de una copia).
      Leerla (`imagen`) también exige eso.
    - **Borrado:** al borrar la publicidad o actualizarla sin una imagen, el
      archivo se borra si ninguna otra publicidad lo usa (una copia comparte
      los de su original).
    - **Cambio de diseño:** el 28-oct esto era un producto más, con nombre y
      precio escritos (`libre: true`). Se reemplazó antes de desplegarse;
      ninguna publicidad guardada lo usaba (revisado en la base).
    - **De paso:** al tocar una pieza de la imagen se suelta el foco del
      buscador. Antes las flechas no la corrían si se acababa de buscar.
    - **Rollback:** revertir el commit. No hay migración.
12. **Recortar: el producto solo, sobre fondo blanco** (Kevin, 30-oct-2026:
    "recortar con la IA en el mismo menú de publicidad y luego guardarlo para
    el historial o asignarlo a un producto que no tiene foto… y mandar
    actualizar la página de MiniVeci, solo la imagen").
    - **Dónde:** cuarta pestaña, «Recortar» (en el celular las cuatro van a
      todo el ancho, sin ícono).
    - **Cómo:** (1) el producto, si la foto es para uno del inventario (el
      buscador dice cuáles no tienen foto); (2) la foto: «Tomar foto» abre la
      cámara (`accept="image/*" capture="environment"`, como la app del
      repartidor), «Subir foto», o «Usar la foto que ya tiene» para limpiar
      una fea. Opcional: qué dejar («solo la botella de la izquierda»).
      «Recortar con IA» = 1 imagen del cupo.
    - **La IA:** `gpt-image-2.5-sunburst` (edición) a 1024×1024, con la foto
      achicada a 1024 px; pide fondo blanco puro, sin sombra, el producto
      entero, derecho y centrado, y el envase EXACTAMENTE igual. Igual lo
      vuelve a dibujar: la pantalla muestra el «Antes» y pide revisar la
      etiqueta. El navegador pasa a blanco puro lo casi blanco que toca el
      borde (`quitarFondoBlanco` sobre blanco): el blanco del producto no se
      toca.
    - **Ponerla en un producto:** «Ponerla en «X»» (el elegido) o «Ponerla en
      otro producto» (buscador). Si ya tiene foto, pregunta antes de
      reemplazarla. Va al servidor (`asignarFoto`), no por `updateProduct`
      del navegador: así el código del producto sale de la base aunque el
      producto no esté cargado en pantalla, y se sabe si la tienda la recibió.
      - Inventario: `UPDATE products SET image, updated_at` (updated_at para
        que los otros equipos bajen el producto de nuevo) + registro en
        `audit_logs` (`origen: publicidad_recorte`, con el recorte).
      - Tienda (MiniVeci): `syncProductToStore` **sin tocarlo**, con
        `{ id, sku, image }`: lo mismo que manda la ficha cuando solo se
        cambia la foto. Precio, stock y oferta no viajan. Se espera hasta
        8 s; la pantalla dice si llegó, si está tardando, si falló o si el
        producto no tiene código (sin código no va).
      - En el equipo: la foto nueva queda para usar sin internet
        (`reemplazarImagen`, nueva en `imagenesLocal.js`: `guardarImagenes`
        no pisa las que ya están) y en la lista de productos.
      - Formato: como la ficha, JPEG de hasta 800 px y ~150 KB (las de más de
        220 KB no se guardan para sin internet).
    - **La medida** (Kevin, 31-oct-2026: "pasarlo a otras medidas, o antes de
      cortar escoger la medida"): los mismos formatos de la publicidad
      (personalizado arranca en 800×800). Se elige antes de recortar (paso 3)
      o después, arriba de la foto. **No usa la IA:** el fondo es blanco liso,
      así que el navegador busca el rectángulo del producto (lo que no es
      blanco) y lo centra sobre blanco al 88 % del lado que manda. Cambiarla no
      gasta imágenes. Descargar y Guardar van en esa medida; en el producto va
      siempre cuadrada (800×800), como las fotos de la tienda. En las medidas
      grandes (A4, pantallas) el producto se agranda desde 1024 px: puede
      verse un poco blando. Se guarda `format` (y `layout.personalizado`); al
      abrirla del Historial vuelve en esa medida, y guardarla en otra medida
      deja otra.
    - **Quitar la foto** (31-oct): tachito junto a la miniatura; deja el
      producto elegido.
    - **Tamaño, fondo y PNG sin fondo** (Kevin, 31-oct-2026: "agrandar y
      achicar, tenerlo en PNG y cambiarle el color de fondo o guardarlo sin
      fondo"). Sin IA, al instante:
      - El recorte con transparencia sale de la imagen de la IA (`sinFondo`):
        se toma el color del fondo de los bordes (mediana) y se borra lo que se
        le parece (±18) y toca el borde. Lo claro del producto que no es tan
        parecido (una tapa gris) queda; el contorno queda a medias y sin el
        blanco mezclado (sin halo sobre fondo oscuro). Antes era
        `quitarFondoBlanco` (≥229), que con fondo de color se comía lo claro.
      - «Tamaño del producto» de 30 % a 120 % (88 % de entrada). Si el
        producto toca un borde de la foto (un busto cortado abajo), queda
        pegado a ese borde en vez de flotar.
      - Fondo: 9 colores, «Otro color» (selector) o «Sin fondo (PNG)», que se
        ve con tablero. Sin fondo, Descargar y Guardar van en PNG (o WebP si
        el PNG pasa de ~2,8 MB, para que entre en el pedido); con fondo, en
        JPG. La miniatura del Historial va sobre blanco; «Bajar» del Historial
        respeta la extensión.
      - Se guarda en `layout.tamano` y `layout.fondo`; al abrirla vuelve igual.
        Cambiar medida, tamaño o fondo de una guardada deja guardar otra.
      - Al producto del inventario va igual que siempre: cuadrada, 800×800,
        sobre blanco y al 88 %.
      - La vista previa es un lienzo (mover el tamaño no arma un archivo en
        cada paso); el archivo se arma solo al bajar o guardar.
      - Límite: una sombra que la IA deje igual (se le pide sin sombra) queda
        como parte del producto sobre un fondo de color.
    - **Guardar en el Historial:** una publicidad más con `layout.modo:
      'recorte'`, sin productos, con la foto ya sobre blanco. En el Historial
      dice «Foto recortada», se abre con «Abrir» (vuelve a la pestaña, listo
      para ponérselo a un producto) y no tiene «Duplicar».
    - **Seguridad:** la foto del inventario solo de un producto de la
      empresa; poner la foto solo en un producto de la empresa, con los
      mismos candados de Publicidad (rol `ads.use` y la App activa).
    - **OJO con MiniVeci:** si el producto no existiera en la tienda, ella
      lo crea con lo que llega («Producto {código}» a $0). Pasa igual hoy al
      cambiar solo la foto en la ficha.
    - **Medido (30-oct-2026, solo lectura en `default`):** 2.772 de 4.523
      productos no tienen foto (542 con NULL y el resto con texto vacío).
      Listarlos cuesta ~700 ms por la columna `image`, así que no se hizo una
      lista «Sin foto»: se busca el producto, y el buscador dice si tiene.
    - **Rollback:** revertir el commit. No hay migración (`ad_backgrounds.mode`
      es texto libre).
13. **Capas y texto que se acomoda, como en Photoroom** (Kevin, 3-nov-2026:
    "ponerlo detrás o sacar al frente"; "cambiar el tamaño de letras y alargar
    el alto o el ancho… la oración se contrae o se expande o sube a unirse con la
    fila de arriba"). En la Rápida.
    - **Capas:** la barra de la pieza elegida trae «Al frente» y «Atrás».
      `componer.js` arma una lista de capas, de atrás hacia adelante, y las
      dibuja en el orden de `d.orden` (se guarda en `layout.orden`). Un id que ya
      no está se ignora, lo que falta cae junto al que tiene antes en el orden de
      siempre, y una imagen nueva va arriba. Con varios productos, las tarjetas
      son una sola capa (`tarjetas`): no se eligen, pero una imagen puede ir
      detrás de ellas.
    - **Llegar a una pieza tapada:** un toque elige lo de adelante; otro toque en
      el mismo lugar, la de abajo (da la vuelta). La pieza elegida se puede
      arrastrar aunque tenga otra encima.
    - **Letra:** en los textos (título, mensaje, nombre, precio, etiqueta y pie)
      la barra cambia el tamaño de la letra (`mover[id].letra`, de 40 % a 300 %),
      no el de la pieza: la oración se reacomoda dentro de su ancho. Las esquinas
      siguen agrandando toda la pieza (`escala`).
    - **Ancho y alto de la caja:** título, mensaje, nombre y precio tienen puntos
      en los cuatro lados (`mover[id].ancho` y `alto`, en fracciones del lienzo).
      Con más ancho, las palabras suben a la fila de arriba; con menos, bajan. El
      lado de enfrente queda quieto. Una caja nunca es más angosta que la palabra
      más larga (el número, en el precio) ni más baja que su texto. Si estaba
      agrandada por las esquinas, ese tamaño pasa a su letra y a su caja al tirar
      de un lado.
    - **No deforma las letras:** "alargar" cambia la caja, no el dibujo de la
      letra (ni la estira ni la aplasta). Así se entendió el pedido.
    - **Lo guardado no cambia:** sin `letra`, `ancho`, `alto` ni `orden`, todo se
      dibuja igual. Comprobado píxel por píxel contra el `componer.js` de la v3.0
      en 12 casos (formatos, varios productos, sin foto, piezas ya movidas).
    - **Fuera de la imagen** (Kevin, 3-nov-2026: "que la mitad esté adentro y la
      otra afuera del cuadro"): lo que se arrastra (textos, foto e imágenes) puede
      salirse. Siempre queda adentro la cuarta parte de la pieza, y no menos del 6 %
      del lado corto, para poder volver a tomarla con el dedo. Lo de afuera no se
      ve ni sale en lo que se guarda, se baja o se imprime. Un texto queda marcado
      con `mover[id].fuera` al arrastrarlo; sin esa marca sigue adentro, como todo
      lo guardado antes y al agrandarlo sin moverlo. La foto ya no tiene el tope
      de 15 % a 85 %. Los puntos que queden afuera no se pueden tomar: para esos,
      A−/A+ o traerla un poco de vuelta.
    - **La imagen saltaba bajo el dedo:** en el celular, la primera vez que se movía
      una pieza aparecía «Textos a su lugar», la fila de arriba pasaba a dos
      líneas y la imagen bajaba 42 px en pleno arrastre. Ahora ese botón siempre
      ocupa su lugar y en el celular la fila no se parte.
    - **«Textos a su lugar»** vuelve también las capas al orden de siempre. «A su
      lugar» de una pieza deja su capa.
    - **Rollback:** revertir el commit. No hay migración: va en el JSON de `layout`.
14. **Descargas e impresión que avisan, en todo el sistema** (Kevin, 4-nov-2026:
    "no sale ningún mensaje que se descargó… la boleta no se puede descargar…
    un mensaje visible que se note que esa acción se hizo").
    - **Causa 1, no había descarga:** en la app, el WebView ignora `<a download>`,
      así que `doc.save()`, `XLSX.writeFile()` y los enlaces no guardaban nada, sin
      error. Capacitor 8 no maneja descargas. Pasaba con la boleta del pedido
      entregado, la del Historial, el comprobante del paquete y los reportes.
    - **Causa 2, no se veía el aviso:** Publicidad avisaba en una franja arriba de
      la página, fuera de la vista en el celular cuando se aprieta Descargar.
      Ahora todos sus avisos van a los del sistema (`avisar` → `toast`).
    - **`src/lib/descargas.js`** (nuevo): por ahí pasa todo lo que se baja, y avisa.
      En la app, al plugin nativo: archivos a **Descargas/POSVECI**
      (`GuardarImagen.guardarArchivo`, MediaStore.Downloads, Android 10 o más) e
      imágenes a la galería, como antes. En el navegador, el enlace de siempre.
      Lo usan los 15 lugares que armaban la descarga (PDF, Excel y CSV). Queda
      afuera el enlace al comprobante de pago del panel de administración. La
      boleta de la venta recién hecha (checkout, zona protegida) tampoco se tocó.
    - **Aviso:** `avisoHecho` en `toast.js`: verde lleno, letra más grande, 6 s,
      encima de los modales y debajo de la barra del teléfono.
    - **Imprimir:** `printSaleReceipt`, `printThermalReceipt` e
      `imprimirComprobanteEnvio` **no se tocaron**. Se agregó el aviso según lo que
      devuelven (`avisarImpresion`). Sin impresora en la app, lo dice y ofrece
      Descargar. El contenido de los PDF tampoco cambió: solo cómo se guardan.
    - **Rollback:** revertir el commit. Sin migración. Una APK sin el plugin nuevo
      recibe UNIMPLEMENTED y pide actualizarla.
    - **Probado:** 39 OK con Chrome, Vite y Capacitor simulado: los bytes que
      llegan al plugin, los PDF de verdad, el aviso en pantalla y encima del modal,
      y las fallas. El Java solo se compiló (`compileReleaseJavaWithJavac`):
      **falta guardar de verdad en un teléfono**. El Historial de ventas y los
      reportes no se abrieron en esa prueba: cambian solo la línea que baja el
      archivo. Un iPhone tampoco se probó.

15. **Recortar: girar el producto** (Kevin, 7-nov-2026: "que se pueda rotar para
    ponerlo parado, acostado o en otro ángulo… un producto que no está bien parejo").
    - **En pantalla:** debajo de «Tamaño del producto» hay dos controles más.
      - **↺ 90°** y **↻ 90°** giran de a cuarto de vuelta.
      - **Enderezar** va de −45° a 45°, de a medio grado.
      - **Como vino** lo deja como lo devolvió la IA.
    - **Sin IA:** no gasta imágenes del cupo.
    - **Dónde aplica el giro:** en la vista, en lo que se baja y en lo que se guarda en el Historial.
      - También en la foto que se pone en un producto: sigue siendo cuadrada y sobre blanco, pero derecha.
      - Va en `layout.giro` y `layout.inclinacion`. Al abrirla desde el Historial vuelve girada.
      - Las guardadas antes no tienen esos campos y vuelven derechas.
    - **Cómo:** el tamaño se mide sobre el producto ya girado, así que un 88 % sigue siendo un 88 %.
      - Los cuartos de vuelta giran la foto sin fondo entera, una vez por clic.
      - Si el producto tocaba un borde (un busto cortado abajo), el borde gira con él y el corte sigue pegado al lado que le toca.
      - Enderezar dibuja el producto inclinado directo en cada paso del deslizador. Lo que ocupa sale del contorno del producto (el primer y el último punto de cada fila), calculado una sola vez.
      - Inclinado, el producto queda siempre centrado.
    - **Medido (Chrome, foto de 1024 px):**
      - Girar la foto y recorrerla de nuevo le sumaba ~76 ms a cada paso del deslizador.
      - Dibujándolo directo, un paso de Enderezar tarda lo mismo que uno de Tamaño: 33 ms contra 34 ms en la prueba, contando los dos cuadros de pantalla.
    - **Probado (Puppeteer, PC y celular de 360 px):** 25/25.
      - Un paquete inclinado 12° queda derecho y llena su rectángulo, a 88 % del ancho.
      - El cuarto de vuelta lo pone parado.
      - Se guardan el giro y la inclinación, y el archivo guardado sale derecho.
      - «Como vino» lo deja exacto.
      - Sin scroll a lo ancho y sin errores.
      - **Falta:** un teléfono real.
    - **Rollback:** revertir el commit. No hay migración: va en el JSON de `layout`.

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
- `android/.../ImprimirImagenPlugin.java` — "Imprimir" en el APK
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
- Imprimir en todos los formatos (27-oct, puppeteer, PC y celular):
  - El PDF de cada formato es 1 página A4: parada para cartel, 4:5, 1:1 y
    9:16, acostada (842×595 pt) para 1,91:1.
  - En el Historial hay un Imprimir por publicidad (6 de 6, todos los
    formatos). Los botones quedan dentro de cada tarjeta y en el mismo número
    de filas en todas.
  - El editor rápido y el chat lo muestran en Publicación vertical.
  - Imprimir una vertical desde el Historial baja su imagen final y abre la
    impresión.
  - Nada se sale a lo ancho y no hay errores en la consola.
- `vite build` OK, ESLint sin errores, `MainActivity` y los dos plugins compilan
  (`compileReleaseJavaWithJavac`).
- **Con chat, suite:** `test-publicidad.mjs` llega a 126 OK. Cubre validaciones,
  aislamiento entre empresas, cambiar o crear según el director, el respaldo si
  el director falla, productos con precios formateados, el cuadrado 1024×1024,
  la zona segura, la doble llamada, el cupo y guardar o borrar con sus
  versiones.
- **Con chat, pantalla:** 20 de 20 en PC y celular, con la pantalla real y el
  servidor simulado: adjuntar un producto, generar, cambiar con Enter, volver a
  una versión y guardar.
- **Medida exacta:** `test-publicidad.mjs` llega a 145 OK.
  - Todas las medidas quedan dentro de lo que acepta la IA, con la proporción
    de cada formato a menos de 1 % y los píxeles a ±2 % de 1024×1536.
  - 4:5 y mayorista tienen la misma proporción; 4:5 e historia no.
  - Pantalla (30 de 30 en PC y celular):
    - La imagen hecha a la medida llena el lienzo sin relleno, comprobado con
      una franja de color en el borde.
    - 4:5 → mayorista no ofrece nada; 4:5 → 9:16 sí.
    - La pasada a 1728×912 llena 1200×628 completa.
  - **IA real** (27-oct, 2 imágenes más que autorizó Kevin): las dos aceptan
    las medidas a pedido y la imagen llena el formato (`zoomEntera` = 1):

    | Pedido | Medida | Tiempo | Costo | Tokens de salida |
    |---|---|---|---|---|
    | Nueva en 4:5 (flare) | 1120×1408 | 16,6 s | US$0,0139 | 408 (343 en 1024×1536) |
    | La horizontal 1536×1024 pasada a 1200×628 (sunburst) | 1728×912 | 19,5 s | US$0,0215 | 279 |

    - Textos y precios bien en las dos. En la del plátano escribió "Antes:
      $1,800" con coma: es el error de un número que el aviso pide revisar.
- **Cada guardado es otra:** `test-publicidad.mjs` llega a 141 OK.
  - Numeración: "PROMO FINDE", "#2", "#3"; una abierta "#2" sigue con "#4".
  - Actualizar sin cambios conserva el "#2"; un nombre único queda tal cual.
  - Sin comodines con `%` y `_`; por empresa; duplicar también numera.
  - Pantalla (Rápida, 28 de 28 en PC y celular):
    - Guardar dos veces sin cambios: una sola.
    - Cambiar el precio sin «Nueva» y guardar: otra, con el aviso del nombre
      numerado.
    - Agregar un producto: otra más.
    - Borrador → final: la misma.
    - Abierta del Historial: sin cambios actualiza; con cambios crea otra.
    - «Duplicar» no guarda hasta que se guarda.
  - Chat (24 de 24): el formato cambiado avisa y guarda otra; guardar de nuevo
    actualiza esa y conserva su "#2".
- **Otro formato:** `test-publicidad.mjs` llega a 134 OK. Las pruebas nuevas:
  - La misma forma no gasta, y sin imagen se rechaza.
  - Adaptar edita la actual, sin director, sin adjuntos y en horizontal.
  - Aprovecha el ancho y su costo no incluye el del director.
  - Escrito a mano, un cambio de forma ya no pide "composición igual".
  - Guardada en dos formatos, borrar una deja la versión compartida a la otra,
    y borrar la última se lleva todas.
  - Pantalla: 24 de 24 en PC y celular. Vertical → historia no ofrece nada;
    vertical → horizontal avisa y «Pasarla» manda `adaptar` sin texto.
    «Guardar aparte» crea otra, y guardar de nuevo actualiza esa.
- **Otro formato, IA real** (la 6ª autorizada): la vertical del atún pasada a
  horizontal con «Pasarla», sin escribir nada. Tardó 19,6 s y costó US$0,0235,
  sin director. Quedó la lata grande a la izquierda y «OFERTA DE ATÚN / ESTA
  SEMANA / $1.290» a la derecha, con los mismos textos y precio. Recortada a
  1,91:1 no pierde nada.
- **Con chat, IA real** (27-oct-2026, autorizadas 6, usadas 5, base local y
  almacenamiento en memoria):

  | Pedido | Acción | Tiempo | Costo |
  |---|---|---|---|
  | Nueva, pan 2x1 | crear (flare) | 16,6 s | US$0,012 |
  | "el precio más grande y en amarillo" | cambiar (sunburst) | 17,0 s | US$0,024 |
  | "ahora una para bebidas energéticas" | crear | 15,6 s | US$0,012 |
  | Nueva con el atún del inventario | crear (sunburst, foto real) | 20,1 s | US$0,021 |
  | Cuadrado con horario | crear 1024×1024 | 15,2 s | US$0,015 |

  - **Director:** 2,5 a 5 s.
  - **Textos y precios:** salieron bien en las 5, incluido el precio de oferta
    del inventario ($1.290) con el envase real.
  - **Recorte:** al recortar a 4:5 o 9:16 se cortaban títulos. Por eso la imagen
    se muestra entera por defecto.
- Vercel Blob real (25-oct): subir, leer por `imagenDeLaEmpresa` y borrar, en
  la prueba del ajuste.
- **No probado:** imprimir en una impresora de verdad (PC, Android e iPhone) y
  el diálogo nativo del APK; el arrastre con el dedo en un teléfono de verdad (APK y PWA);
  la pantalla de punta a punta en el navegador y en el APK
  (falta activar la App en una sucursal), ni las escenas nuevas de cada estilo
  contra la IA real (solo se probó el ajuste; las 5 imágenes autorizadas ya se
  usaron). Del chat ya se usaron las 6 autorizadas.
- **Recortar (30-oct-2026):** `test-publicidad.mjs` suma 31 pruebas (200 OK):
  prompt, cupo, clave repetida, foto de otra empresa, guardar y abrir del
  Historial, y poner la foto: solo `{ id, sku, image }` a la tienda, nada más
  del producto cambia, `updated_at`, registro, sin código, otra empresa, foto
  inválida o pesada, tienda apagada, caída, que falla o que tarda (no se
  espera más del tope). En la pantalla real (Vite, servidor simulado), 70 OK
  en PC y celular: las 4 pestañas entran en 390 px, la cámara, el blanco puro
  en las esquinas (también donde la IA dejó gris) con la etiqueta blanca del
  producto intacta, la foto a 800 px, la pregunta antes de reemplazar, la
  lista del buscador encima de la otra tarjeta y el Historial.
  **Falta:** la IA real (sin autorización todavía) y la cámara en el APK.
- **Capas, texto que se acomoda y fuera de la imagen (3-nov-2026):** 89 OK con
  Chrome (Vite, servidor simulado): 12 casos idénticos píxel por píxel a la v3.0,
  capas, reflujo, mínimos, doble tamaño para imprimir y, en la pantalla real en PC
  y con el dedo en celular, A+, tirar de los cuatro lados, Al frente, Atrás, el
  toque repetido, sacar un texto y la foto, el pedazo que queda, traerlo de vuelta,
  que la imagen no salte y abrir del Historial. Siguen bien las pruebas anteriores de la pantalla (arrastre, imágenes,
  guardar, formatos, recorte) y `test-publicidad.mjs`. **Falta:** un teléfono real.

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
