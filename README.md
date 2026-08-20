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
  impresion de facturas y cartas de porte).
- agroBimi/config.js: constantes de configuracion (Supabase URL y anon key).
- agroBimi/schema.sql: esquema SQL de la base de datos.
- agroBimi/app.js: punto de entrada de la aplicacion.
- agroBimi/logo_web.png: logo usado en la cabecera, el login y el favicon.

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
- agroBimi/js/palets.js: palets y cartas de porte (salidas de mercancia).
- agroBimi/js/liquidaciones.js: liquidaciones por fechas y generacion de facturas.
- agroBimi/js/facturas.js: documento de liquidacion / factura e impresion.
- agroBimi/js/reportes.js: exportacion a Excel y cajas en camara.
- agroBimi/js/ui.js: eventos de interfaz e inicializacion.

## Puesta en marcha / actualizacion

Ejecuta `agroBimi/schema.sql` completo en el editor SQL de Supabase. Es
idempotente: se puede volver a ejecutar tantas veces como haga falta, crea
solo lo que falte y no borra datos.

Despues, en la app, entra en **⚙ Ajustes** y rellena:

- los datos del emisor de las facturas,
- el precio por caja de bimi y el precio de la caja vacia perdida,
- el IVA / compensacion,
- las series de numeracion (liquidaciones, facturas, palets, cartas de porte).

## Como funciona cada cosa

### Rendimiento por ciclo

Las plantas que retira cada agricultor se anotan en **🌱 Plantas retiradas**
(tabla `retiradas_plantas`). Puede haber varias retiradas dentro del mismo
ciclo: se suman. Con eso y las cajas de los registros se calcula:

    rendimiento = cajas de bimi entradas / plantas retiradas

Se ve en dos sitios: el panel *Rendimiento por ciclo* de la ficha del
agricultor y el informe global **📈 Rendimientos**, filtrable por campana,
ciclo y agricultor.

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

### Palets y cartas de porte

Un palet se crea con el agricultor, la fecha de paletizado y el numero de
cajas, y nace **pendiente de carga**. Al paletizar salen varios palets
iguales de golpe, asi que el formulario permite crear N a la vez, cada uno
con su codigo.

Para dar salida: se marcan los palets en el listado y se pulsa
**🚚 Dar salida**, eligiendo (o creando) la carta de porte. Una carta de
porte puede llevar palets de varios agricultores y se imprime como documento
de transporte, agrupada por agricultor.

En **📦 Cajas en camara** se ven por separado las salidas anotadas a mano en
el registro y las salidas por carta de porte, para que se vea de donde sale
el total y no se descuente nada dos veces.

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

## Notas

- Todas las rutas dentro de un modulo son relativas, asi que la carpeta se
  puede mover o renombrar sin tocar el codigo.
- El proyecto usa Supabase y una estructura modular en JavaScript para separar
  responsabilidades.
- Ninguna fecha de la app admite dias futuros.
- Al crear agroPepper habra que decidir que se comparte entre modulos
  (config de Supabase, login, estilos base) para no duplicarlo.
