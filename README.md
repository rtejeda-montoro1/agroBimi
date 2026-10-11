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
- agroBimi/js/camara.js y agroBimi/js/palets.js: camara y palets. **Fuera de
  la web por ahora** (ver "Camara y palets").
- agroBimi/js/liquidaciones.js: liquidaciones por fechas y generacion de facturas.
- agroBimi/js/facturas.js: documento de liquidacion / factura e impresion.
- agroBimi/js/reportes.js: exportacion a Excel.
- agroBimi/js/ui.js: eventos de interfaz e inicializacion.
- agroBimi/js/bascula.js: logica del puesto de la bascula (no usa App).

## Puesta en marcha / actualizacion

Ejecuta `agroBimi/schema.sql` completo en el editor SQL de Supabase. Es
idempotente: se puede volver a ejecutar tantas veces como haga falta, crea
solo lo que falte y no borra datos.

**Una sola vez, antes de `schema.sql`:** ejecuta
`agroBimi/migraciones/2026-10-11_campana_26-27.sql`. Deja la campana 26/27
como unica (pasa a ella todo lo de las demas campanas y lo que no tenia
campana, y borra las otras) y pone ciclo 1 a lo que no tenia ciclo. Lee la
cabecera del archivo antes de ejecutarlo.

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

Las plantas que ya estaban anotadas en los registros antiguos (columnas
`num_plantas` y `fecha_retirada`) se pasan a la tabla nueva con el boton
*⬆ Importar de los registros*, que no duplica lo ya importado. Esas dos
columnas del registro se conservan por compatibilidad, pero el calculo usa
la tabla nueva.

### Control de cajas vacias

    descuadre = cajas vacias retiradas - cajas llenas devueltas - cajas vacias devueltas
    pendiente = descuadre - cajas ya cobradas en liquidaciones

Las cajas son fisicas, asi que el saldo se lleva por agricultor; los filtros
de campana y de fechas solo limitan que movimientos entran en la cuenta. Lo
que no vuelve se le descuenta al hacer su liquidacion, al precio de *caja
vacia perdida* de Ajustes.

Se anota en el propio registro: *Cajas Vacias retiradas* (lo que se lleva) y
*Cajas Vacias devueltas* (lo que devuelve sin usar).

### Camara y palets

**Fuera de la web por ahora.** Para simplificar la vista a lo que pide el
cliente (cajas de la bascula, descuentos, liquidaciones y plantas por ciclo)
se quitaron de `index.html` los botones y modales de Camara y Palets y no se
cargan `camara.js` ni `palets.js`. El codigo, las tablas y la vista
`camara_saldos` siguen ahi: para recuperarlo basta con volver a poner en
`index.html` lo que hay en `respaldo/2026-10-10/index.html`, los dos
`<script>` y las llamadas en `ui.js`. Lo que sigue describe como funcionaba.

Ya no hay cartas de porte ni datos de transportista: `schema.sql` borra la
tabla `cartas_porte`. Los palets que ya habian salido en una carta conservan
la fecha de esa carta como `fecha_salida`.

Flujo: las cajas se guardan en la camara (`camara_entradas`, paso aparte de
la bascula), se agrupan en palets y los palets salen.

- Un palet puede llevar cajas de varios agricultores: lo de cada uno va en
  `palet_lineas`. `palets.num_cajas` es la suma de sus lineas y lo mantiene
  un trigger. Al crearlo recibe su codigo (serie `serie_palet` + contador).
- Solo se paletizan cajas sueltas: por agricultor, lo paletizado no puede
  pasar de lo guardado en camara.
- El palet sigue en la camara hasta que se le da salida (`fecha_salida`).

      ocupacion = cajas guardadas - cajas de palets con salida
                = cajas sueltas + cajas en palets sin salida

  La vista `camara_saldos` lo calcula por agricultor. La capacidad es el
  parametro `capacidad_camara` (22 por defecto); pasarse avisa pero no
  bloquea, porque la app tiene que reflejar lo que hay de verdad.

Los palets anteriores a este cambio (uno por agricultor) se pasan solos a
lineas. Como no tienen cajas guardadas en camara detras, "sueltas" nunca
baja de 0.

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

El PDF se obtiene imprimiendo y eligiendo "Guardar como PDF" en el dialogo
del navegador: no hace falta ninguna libreria externa.

### Puesto de la bascula

La bascula no exporta los pesos, asi que junto a ella se pone una tablet u
ordenador con `agroBimi/bascula.html`. Ahi se elige el agricultor, el ciclo
el numero de cajas y las cajas vacias que se lleva (0 por defecto), y cada
entrada crea un registro con fecha de hoy, `cajas_entradas`,
`cajas_vacias_retiradas` y `origen = 'bascula'`. A partir de ahi cuenta como
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
(`registros.client_uuid`, unico), asi que un reintento nunca la duplica.
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
