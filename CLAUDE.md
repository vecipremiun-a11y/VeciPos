# POSVECI — reglas del proyecto

## Versiones: una sola, continua, para los tres destinos

POSVECI se entrega en **tres formas** y las tres tienen que decir la **misma
versión**:

| Destino | Qué es | Dónde se despliega |
|---|---|---|
| **Web** | `app.posveci.com` y `demo.posveci.com` | Vercel, con cada `git push origin main` (dos proyectos, dos bases: `poskem` y `demon-oficial`) |
| **PWA** | La misma web instalada en escritorio de PC y en el navegador del celular | Sale del mismo build web; el service worker se genera solo para web |
| **App** | El APK Android (Capacitor) | `android/app/build.gradle` + el archivo `POSVECI-vNN` |

### La regla

**Antes de subir algo a producción o de generar un APK, hay que verificar que
los tres estén en la misma versión.** No se despacha nada con las versiones
desalineadas.

**La versión es continua: sigue a la anterior.** No se inventa un número nuevo,
no se reinicia, y no se le pone una versión distinta a cada destino. Si la app
va en `v47`, la siguiente es `v48` — y esa misma es la de la web y la de la PWA.

**Nunca subir ni cambiar un número de versión sin que Kevin diga el número
exacto.** Un APK se instala en teléfonos de clientes: qué versión lleva es
decisión suya, no de Claude. Ante la duda, preguntar antes de compilar.

### Dónde vive la versión hoy

Estos son los lugares que tienen que coincidir. Revisarlos **todos** en el
chequeo previo:

- `package.json` → campo `version`
- `android/app/build.gradle` → `versionName` (la versión visible) y
  `versionCode` (entero que solo sube; Play Store rechaza uno repetido)
- El nombre del archivo del APK: `POSVECI-vNN…apk` en el Escritorio de Kevin
- `src/pages/Settings.jsx` → lo que la pantalla le muestra al usuario

> **Defecto conocido, sin arreglar:** en `src/pages/Settings.jsx` la versión
> está escrita a mano (`1.2.1 (Futuristic Build)`). No sale del `package.json`
> ni de ningún lado, así que la pantalla muestra siempre lo mismo por más que se
> despliegue. Mientras siga así, esa pantalla **no** sirve para saber qué
> versión está corriendo.

### Verificar qué versión hay puesta de verdad

No confiar en la pantalla de Ajustes ni en el nombre del archivo. La versión
real de un APK se lee del archivo:

```
aapt2 dump badging <archivo.apk>     # imprime versionCode y versionName
```

Un APK puede llamarse `POSVECI-v47` por fuera y declararse `1.0` por dentro:
ya pasó, y por eso no había forma de distinguir un build de otro.

## Compilar el APK

```
npm run build:app          # NO 'npm run build': inyecta VITE_API_BASE_URL y lo verifica
npx cap sync android
cd android && ./gradlew assembleRelease --no-daemon
```

- Hay que exportar `JAVA_HOME` a mano: no está en el entorno.
  `export JAVA_HOME="C:/Program Files/Android/Android Studio/jbr"`
- El repo vive en OneDrive, que deshidrata los assets viejos a marcadores de
  nube y hace fallar a Gradle con *"Cannot snapshot …: not a regular file"*.
  Solución: `rm -rf android/app/src/main/assets/public && npx cap sync android`
  (es salida generada, no está en git).
- El APK sale en `C:\AndroidBuilds\poskem\app\outputs\apk\release\` y se copia
  al Escritorio con el nombre `POSVECI-vNN…apk`.

## Producción

Las **dos** bases Turso son producción, con clientes reales: `poskem` y
`demon-oficial`. `databases.json` las rotula al revés — no fiarse de ese rótulo.
Cada `git push origin main` despliega los dos sitios.

Migraciones: `npm run migrate-all -- --apply` y después `npm run verify-all`.

## Permisos

No commitear, no pushear, no aplicar migraciones y no generar APKs sin
aprobación explícita de Kevin **en cada caso**. Un push es un despliegue a
producción.

## Qué NO se toca sin permiso

Estas zonas están en producción estable y pasaron QA real. Un cambio mal hecho
acá se traduce en ventas perdidas, un problema legal con el SII o la tienda
online desincronizada. **Si algo que hay que hacer obliga a tocar una de estas,
hay que parar y preguntar primero**, y proponer una alternativa que no las toque:

- El núcleo de `addSale` (la venta principal, en `src/store/useStore.js`)
- La integración con el **SII** (boletas y facturas electrónicas, CAFs)
- La integración con **WooCommerce** (sync con la tienda)
- La **impresión** (recibos, tickets, preventas)
- El flujo de **checkout**
- Las **APIs externas** en general
- El núcleo del **sync offline**: `syncPendingOpsToServer` y la cola `pendingOps`
  en `src/lib/db/sync.js`
- El JSON que es fuente de verdad en los mirrors
  (`src/lib/itemNormalization.js`)

Todo cambio tiene que ser compatible hacia atrás y con un rollback simple. No
romper: offline, cola de pendientes, restauración offline, multiempresa, Dexie.

## Cómo trabajar acá

1. **No asumir: medir primero.** Antes de optimizar, medir el flujo real con el
   código actual — nada de estimaciones. Y medir de nuevo después.
2. **Validar el estado real del repo** antes de un trabajo grande: ramas,
   archivos en disco, commits. No confiar en lo que dice un reporte —incluido
   uno mío— sin verificarlo. Ya pasó que otro agente escribió el reporte de una
   fase que nunca llegó a escribir los archivos.
3. **Un commit por fase lógica.** No mezclar cosas distintas en un commit.
4. **Rollback documentado** para cada cambio (revertir el commit, un
   kill-switch, una bandera).
5. **Nada de overengineering ni mega refactors.** Incremental y compatible.
6. **Reporte por fase** en `scripts/optim/reports/FASE{N}_REPORT.md` cuando el
   trabajo venga organizado en fases.

## Cuando Kevin dice que algo pasaba

Su experiencia con el sistema pesa más que cualquier deducción a partir del
código. Antes de contradecirlo, buscar la prueba en la historia:

```
git log -S "<texto o símbolo>" -- <archivo>
```

Ya pasó: le afirmé que el gesto de tirar-para-actualizar "nunca funcionó en el
APK", deducido de que no hay `SwipeRefreshLayout` en el layout Android. Estaba
mal — su commit `71fa2ed` documenta que el gesto recargaba la app y le borraba
el pedido a medio cargar. Un `git log -S` lo habría encontrado en segundos.
