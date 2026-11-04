# AgroBimi

Aplicaciones web de gestion agricola. Cada modulo es una app independiente
dentro de su propia carpeta.

## Estructura de la raiz

- index.html: punto de entrada. Hoy redirige a agroBimi/. En el futuro sera
  el login comun y el selector de modulo.
- agroBimi/: modulo de gestion de Bimi (agricultores y registros de produccion).
- agroPepper/: modulo de gestion de pimientos (pendiente de crear).

## Modulo agroBimi

- agroBimi/GUIA.md: guia de usuario (que hace cada boton y como se usa).
- agroBimi/index.html: estructura principal de la interfaz.
- agroBimi/styles.css: estilos de la aplicacion (incluye los estilos de
  impresion de facturas).
- agroBimi/config.js: constantes de configuracion (Supabase URL y anon key).
- agroBimi/schema.sql: esquema SQL de la base de datos.
- agroBimi/app.js: punto de entrada de la aplicacion.
- agroBimi/logo_web.png: logo usado en la cabecera, el login y el favicon.
- agroBimi/bascula.html + bascula.css: puesto de la bascula (tablet junto al
  peso para apuntar cajas). Pagina independiente de la app principal.

### Modulos JavaScript

- agroBimi/js/core.js: estado global, referencias DOM y cliente de base de datos.
- agroBimi/js/utils.js: utilidades compartidas (fechas, numeros, importes,
  numeracion de documentos, modales, impresion).
- agroBimi/js/ajustes.js: parametros globales (emisor de facturas, precios,
  IVA y series de numeracion).
- agroBimi/js/auth.js: autenticacion y sesion.
- agroBimi/js/agricultores.js: logica CRUD de agricultores y sus datos fiscales.
- agroBimi/js/campanas.js: logica de campanas y filtro por campana.
- agroBimi/js/registros.js: logica CRUD de registros.
- agroBimi/js/plantas.js: retiradas de plantas por ciclo y calculo de rendimiento.
- agroBimi/js/cajas.js: control de cajas vacias y descuadres.
- agroBimi/js/palets.js: paletizacion (camara, palets y etiquetas).
- agroBimi/js/salidas.js: salidas de palets y albaranes de salida.
- agroBimi/js/liquidaciones.js: liquidaciones por fechas y generacion de facturas.
- agroBimi/js/facturas.js: documento de liquidacion / factura e impresion.
- agroBimi/js/reportes.js: exportacion a Excel.
- agroBimi/js/ui.js: eventos de interfaz e inicializacion.
- agroBimi/js/bascula.js: logica del puesto de la bascula (no usa App).

## Puesta en marcha / actualizacion

Ejecuta `agroBimi/schema.sql` completo en el editor SQL de Supabase. Es
idempotente: se puede volver a ejecutar tantas veces como haga falta, crea
solo lo que falte y no borra datos.

`schema.sql` es el esquema actual: cada tabla con todas sus columnas, mas
las funciones, triggers y permisos. Ya no lleva los pasos para actualizar
bases de datos antiguas (desde noviembre de 2026). Si una base de datos es
anterior, ejecuta antes el `schema.sql` del commit `4d8ce36`. Si cambias una
tabla, anade la columna en su `create table` y tambien con un
`alter table ... add column if not exists` al final del archivo (las
instrucciones estan en su cabecera).

**Datos del cliente:** el repositorio es publico, asi que los datos reales
del emisor de los recibos (nombre, NIF, direccion, registro de
establecimiento) y del CMR (remitente y porteador) no estan en el codigo
ni en `schema.sql`: salen vacios. Viven en `agroBimi/privado/datos_cliente.sql`,
que esta en `.gitignore` y se guarda aparte (por ejemplo, en el repositorio
privado de backups). En una instalacion nueva, ejecutalo despues de
`schema.sql` o rellena esos datos en Ajustes. No subas al repo documentos
reales (recibos, facturas en PDF) ni datos de agricultores.

**Migraciones:** los scripts SQL que actualizan una base de datos que ya
tiene datos (pasar datos antiguos al formato nuevo, juntar registros, etc.)
no estan en el repositorio: se guardan aparte, junto a los datos privados.
Cada cambio de este README que necesita una lo indica con "requiere
migracion". Leela antes de ejecutarla en Supabase. La de la campana 26/27
(deja esa campana como unica y pone ciclo 1 a lo que no tenia) va **una
sola vez, antes de `schema.sql`**.

### Campana y ciclo obligatorios

Ningun registro, retirada de plantas ni liquidacion puede ir sin campana, y
registros y retiradas siempre llevan ciclo 1, 2 o 3 (`schema.sql`, seccion
15). En la app los desplegables no tienen opcion vacia: salen con la campana
mas reciente y el ciclo 1. Por eso una campana con datos no se puede borrar.

Despues, en la app, entra en **⚙ Ajustes** y rellena:

- los datos del emisor de las facturas,
- el precio por caja de bimi y el precio de la caja vacia perdida,
- el IVA / compensacion,
- las series de numeracion (liquidaciones y facturas).

## Como funciona cada cosa

### Rendimiento por ciclo

Las plantas que retira cada agricultor se anotan en **🌱 Plantas retiradas**
(tabla `retiradas_plantas`). Puede haber varias retiradas dentro del mismo
ciclo: se suman. Con eso y las cajas de los registros se calcula:

    rendimiento = cajas de bimi entradas / plantas retiradas

Se ve en el panel *Rendimiento por ciclo* de la ficha del agricultor. (El
informe global de rendimientos se quito de la web para simplificarla; si se
vuelve a pedir, esta en `respaldo/2026-10-10/`.)

Las plantas que se anotaban en los registros antiguos (columnas
`num_plantas` y `fecha_retirada` de `registros`) ya no se usan: el calculo
usa solo la tabla nueva. La migracion `2026-11-04_quitar_sin_uso.sql` quita
esas columnas si estan vacias.

### Control de cajas vacias

    descuadre = cajas vacias retiradas - cajas llenas devueltas - cajas vacias devueltas
    pendiente = descuadre - cajas ya cobradas en liquidaciones

Las cajas son fisicas, asi que el saldo se lleva por agricultor; los filtros
de campana y de fechas solo limitan que movimientos entran en la cuenta. Lo
que no vuelve se le descuenta al hacer su liquidacion, al precio de *caja
vacia perdida* de Ajustes.

Se anota en el propio registro: *Cajas Vacias retiradas* (lo que se lleva) y
*Cajas Vacias devueltas* (lo que devuelve sin usar).

### Camara, paletizacion y salidas

Todas las cajas que pasan por la bascula van a la camara y **la base de datos
las reparte sola en palets** de `cajas_por_palet` (60) al apuntar la pesada
(trigger `registros_paletizar`, `schema.sql` seccion 16; requiere
migracion en una base de datos existente). Rellena el palet abierto mas
antiguo de la campana y lo que sobra abre el siguiente. Al estar en la base de
datos vale igual para la bascula (tambien al sincronizar sin red) y para la
oficina.

- Cada linea de palet esta ligada a su pesada (`palet_lineas.registro_id`):
  de ahi salen el agricultor y la fecha de entrada.
- Estados: *en formacion* (menos de 60, sus cajas estan "en camara"),
  *completo* (`fecha_completo`, etiqueta y salida) y *con salida*
  (`fecha_salida` + `albaran_id`).
- Corregir una pesada a la baja o borrarla quita sus cajas de sus palets sin
  salida (del mas reciente al mas antiguo). Si ya salieron, la base de datos
  lo impide.
- Edicion manual: `palet_guardar_lineas(palet, lineas)` toma las cajas de lo
  que la pesada tenga sin palet o en otros palets en formacion.
- Salida: `albaran_crear(datos, palets)` numera el albaran (`serie_albaran`),
  da salida a los palets y pone la fecha de salida en `registros.fecha_cmr`
  de sus pesadas, todo a la vez; `albaran_anular` los devuelve y deja en
  `fecha_cmr` la de otra salida suya (o vacia).
- Se imprime la carta de porte (CMR, 3 ejemplares) y el albaran. Los datos
  fijos del CMR son parametros (`cmr_remitente`, `cmr_porteador`,
  `cmr_tipo_palet`, `peso_bruto_caja_kg`); lo variable va en
  `albaranes_salida`.
- La vista `paletizado_entradas` dice, por pesada, cuantas cajas estan en
  palets en formacion, sin palet, en palets completos o ya salidas.
- Solo se paletizan las pesadas desde `paletizado_desde` (Ajustes). Los palets
  de la version anterior (sin pesadas detras) no se rellenan.

La etiqueta se imprime con un `@page` (sin nombre) del tamano de Ajustes
(`etiqueta_ancho_mm` x `etiqueta_alto_mm`, 105 x 75 por defecto). La tabla
`camara_entradas` y la vista `camara_saldos` (guardar cajas en camara a mano)
ya no estan en `schema.sql`: la migracion `2026-11-04_quitar_sin_uso.sql` las
quita de una base de datos existente si estan vacias.

### Liquidaciones y facturas

Una liquidacion agrupa los registros de UN agricultor en un rango de fechas
que todavia no se le han pagado, y calcula:

    + cajas de bimi entradas       x precio por caja
    - descuento de cajas           x precio por caja
    - cajas vacias no devueltas    x precio de caja perdida
    +- concepto libre
    = base -> + IVA / compensacion -> total

Un registro solo puede entrar en UNA liquidacion (columna
`registros.liquidacion_id`): asi no se paga dos veces lo mismo. En la tabla
del agricultor los registros ya liquidados salen marcados.

Las lineas se guardan calculadas, de forma que una liquidacion cerrada no
cambia de importe si despues se editan los registros o los precios.

Estados: **borrador** (se puede recalcular y editar) -> **cerrada** (ya no se
edita) -> **facturada** (tiene numero de factura). Al facturar, el numero se
copia tambien al campo `num_factura` de cada registro incluido, asi que la
agrupacion por factura de la tabla del agricultor sigue funcionando igual.

Si el agricultor trae su propia factura, al facturar se elige esa opcion y
se escriben su numero y su fecha: quedan en `num_factura` / `fecha_factura`
con `factura_agricultor = true` y `factura_secuencia` vacia (no gasta numero
de la serie). El documento se imprime como liquidacion, no como recibo de
compensacion. Requiere migracion (columna `factura_agricultor`).

El PDF se obtiene imprimiendo y eligiendo "Guardar como PDF" en el dialogo
del navegador: no hace falta ninguna libreria externa.

### Puesto de la bascula

La bascula no exporta los pesos, asi que junto a ella se pone una tablet u
ordenador con `agroBimi/bascula.html`. Ahi se elige el agricultor, el ciclo
el numero de cajas y las cajas vacias que se lleva (0 por defecto). Las
pesadas del mismo dia de un agricultor (misma campana y ciclo) se suman en
un unico registro con fecha de hoy, `cajas_entradas`,
`cajas_vacias_retiradas` y `origen = 'bascula'`; si ese registro ya esta
liquidado se abre otro. Cada pesada suelta queda en `bascula_pesadas`
(ligada a su registro): la tablet lista las de hoy y `bascula_anular` resta
una sola del registro del dia (si se queda a 0, lo borra). Requiere
migracion: crea `bascula_pesadas` y junta los registros que ya estaban
repetidos. A partir de ahi cuenta como
cualquier otro registro: rendimiento y liquidaciones. Guardar las cajas en
la camara es un paso aparte (ver "Camara y palets").

Seguridad: la tablet entra con un usuario propio dado de alta en la tabla
`usuarios_bascula` (instrucciones en `schema.sql`, seccion 12). Su sesion
no caduca (no hay cierre por inactividad), pero ese usuario no puede leer
ni escribir ninguna tabla: solo usar las funciones `bascula_*`, que
listan agricultores y campanas, apuntan cajas y anulan lo apuntado hoy
que no este liquidado. Si se intenta usar en la app principal, se le
redirige a la bascula. No se ha hecho sin login porque la web es publica:
cualquiera con la URL podria apuntar cajas a un agricultor.

Sin red: cada entrada se guarda primero en la tablet (localStorage) y
despues se envia; si no hay conexion se queda en cola y se reintenta sola
al volver la red. Cada entrada lleva un uuid generado en la tablet
(`bascula_pesadas.client_uuid`, unico; antes `registros.client_uuid`), asi
que un reintento nunca la suma dos veces.
Tambien guarda la hora de la pesada (`registros.pesada_en`): la fecha del
registro es el dia en que se peso (hora de Madrid), aunque llegue al
servidor despues. El servidor rechaza pesadas futuras o de hace mas de 7
dias; las rechazadas se quedan en la tablet a la vista para revisarlas.

Justificante: cada entrada se imprime (navegador -> imprimir) en dos copias,
cada una en su pagina: 1 "Copia para el agricultor", 2 "Copia para la
empresa", con nombre del
agricultor, ciclo, cajas entradas, cajas vacias retiradas, fecha y hora y
hueco para la firma. El tamano del papel esta pendiente de la impresora: se
ajusta en `bascula.css` con `--ticket-ancho` y el margen de `@page` (ahora
72 mm, valido para tickets de 80 mm y para A4).

## Notas

- Todas las rutas dentro de un modulo son relativas, asi que la carpeta se
  puede mover o renombrar sin tocar el codigo.
- El proyecto usa Supabase y una estructura modular en JavaScript para separar
  responsabilidades.
- Ninguna fecha de la app admite dias futuros.
- Al crear agroPepper habra que decidir que se comparte entre modulos
  (config de Supabase, login, estilos base) para no duplicarlo.
