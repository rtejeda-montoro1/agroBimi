# Guía de uso — Gestión de Bimi

Guía breve de las funciones: plantas y rendimiento, control de cajas, y
liquidaciones y facturas.

Los nombres entre comillas son los botones tal y como salen en la app.

Versión maquetada, más cómoda de leer y de pasar a quien la vaya a usar:
<https://claude.ai/code/artifact/3f9b1f29-a845-44e4-96cd-287958080ebb>
(privada hasta que la compartas desde el menú de la propia página).

---

## Antes de empezar (una sola vez)

**Quien lo instala:** ejecutar `schema.sql` completo en el editor SQL de
Supabase. Se puede volver a ejecutar cuando haga falta: solo crea lo que
falte y no borra nada. Los datos del emisor y del CMR no están en el
repositorio (es público): se rellenan en Ajustes o con el fichero privado
`privado/datos_cliente.sql`, que se guarda aparte.

**Quien lo usa:** entrar en «⚙ Ajustes» y rellenar

1. **Emisor de los recibos:** nombre, CIF, dirección y registro de
   establecimiento. Quien lo instala los deja rellenos; solo hay que
   tocarlos si cambian.
2. **Precios por defecto:** precio por caja de bimi y precio de la caja vacía
   perdida. Son los que propone cada liquidación (se pueden cambiar en cada
   una).
3. **IVA / compensación (%)** (12 %) y **retención IRPF (%)** (2 %). La
   retención se calcula sobre base + IVA, como en el recibo en papel.
4. **Series de numeración:** las iniciales de cada documento (LIQ, F).
   Cámbialas antes de crear el primero; luego es mejor no tocarlas.

Y en cada agricultor, «Editar» → **Datos fiscales**: NIF, dirección e IBAN.
Sin ellos la factura sale incompleta.

---

## 1. Plantas retiradas y rendimiento

El rendimiento se calcula así:

    rendimiento = cajas de bimi entradas ÷ plantas retiradas

**Anotar una retirada:** «🌱 Plantas retiradas» → «+ Nueva retirada» →
agricultor, campaña, ciclo, fecha y nº de plantas.

Si el agricultor retira plantas en varias veces dentro del mismo ciclo,
anota cada una: se suman solas.

**Ver el rendimiento:** en la ficha del agricultor, en el panel
«📈 Rendimiento por ciclo»: una tarjeta por ciclo con plantas, cajas,
cajas/planta, días de ciclo y fechas.

---

## 2. Control de cajas vacías

El agricultor se lleva cajas vacías y las devuelve llenas de bimi. Lo que no
vuelve tiene que pagarlo.

    descuadre = vacías retiradas − cajas llenas devueltas − vacías devueltas
    pendiente = descuadre − cajas ya cobradas en liquidaciones

**Qué apuntar en el registro:**

- **Cajas Vacías retiradas:** las que se lleva.
- **Nº Cajas Entradas:** las que trae llenas de bimi.
- **Cajas Vacías devueltas:** las que devuelve vacías, sin usar.

Para cambiar solo las cajas sin abrir el registro entero, pulsa el icono 📦
de la fila y luego «✏ Editar».

**Ver los descuadres:** «⚖ Control de cajas». Filtra por agricultor, campaña
y fechas, y marca **«Solo descuadres»** para ver únicamente a quien debe
cajas. La lista sale ordenada por lo que más debe.

- Las filas en **rojo** tienen cajas pendientes de cobro.
- Las filas en **azul** han devuelto más cajas de las que se llevaron
  (arrastre de otro periodo): a esos no se les cobra nada.
- **«Ya cobradas»** cuenta todas las liquidaciones, sin filtro de fechas: es
  lo que ya se le descontó alguna vez.

Las cajas son físicas, así que el saldo se lleva por agricultor. Los filtros
de campaña y fechas solo limitan qué movimientos entran en la cuenta.

No hay que cobrarlas a mano: al hacer la liquidación se descuentan solas.

---

## 3. Liquidaciones y facturas

Una liquidación coge los registros de **un** agricultor entre dos fechas que
todavía no se le han pagado, y calcula:

    + cajas de bimi entradas       × precio por caja
    − descuento de cajas           × precio por caja
    − cajas vacías no devueltas    × precio de caja perdida
    ± concepto libre
    = base  →  + IVA / compensación  →  total

**Crearla:** «🧾 Liquidaciones» → «+ Nueva liquidación»

1. Agricultor y periodo (**desde** / **hasta**).
2. Campaña, si quieres limitarla a una sola.
3. Revisa los precios y el IVA: vienen de Ajustes, pero aquí valen solo para
   esta liquidación.
4. Decide si descuentas las cajas no devueltas y las cajas con descuento.
   Las cajas vacías no devueltas vienen **sin marcar**: se suelen descontar
   en la liquidación de final de campaña.
5. Si hay que añadir algo (anticipo, portes...), rellena el
   **concepto libre**. Con precio negativo se descuenta.
6. Pulsa «🧮 Calcular»: aparecen las líneas, los totales y cuántos registros
   entran.
7. «Guardar liquidación».

Si cambias cualquier dato después de calcular, el resultado se borra y hay
que volver a pulsar «🧮 Calcular». Es a propósito: así no se guarda un total
que no corresponde a los datos que hay en pantalla.

**Estados:**

| Estado | Qué se puede hacer |
| --- | --- |
| **Borrador** | Editar, recalcular, cerrar, facturar o eliminar |
| **Cerrada** | Ya no se edita. Facturar o eliminar |
| **Facturada** | Tiene nº de factura. Ver, imprimir o eliminar |

«Cerrar» es opcional: sirve para dejarla fija mientras no se factura.

**Facturar:** en el listado, «🧾 Facturar». Se abre una ventana con el total
y dos opciones:

- **Generar recibo de compensación** (lo normal): se le asigna el siguiente
  nº de la serie, que se ve al lado, y se abre el recibo para imprimirlo.
- **El agricultor trae su propia factura:** escribe el **nº y la fecha de su
  factura**. No se genera recibo ni se gasta nº de la serie. En el listado
  sale el nº con la marca «del agricultor», y al imprimir sale la
  liquidación con su nº de factura. Comprueba que los importes de su factura
  coinciden con la liquidación (el IVA y la retención se ajustan al crear
  la liquidación).

En los dos casos, el nº se copia también al campo **Nº Factura** de todos los
registros incluidos, así que la tabla del agricultor los sigue agrupando por
factura como siempre, sin tener que escribirlo a mano registro a registro.

**Sacar el PDF:** abre la liquidación o la factura y pulsa «🖨 Imprimir». En
el diálogo del navegador, elige **«Guardar como PDF»** en vez de una
impresora.

**Un registro solo entra en una liquidación.** En la tabla del agricultor los
ya liquidados salen marcados como **Liquidado** y su botón pasa a
«🧾 Ver liq.», que abre la liquidación a la que pertenecen. Si borras una
liquidación, sus registros vuelven a quedar pendientes (y pierden el nº de
factura).

---

## 4. Paletización y salidas

**Para qué:** saber cuántas cajas hay en la cámara, formar los palets de 60
cajas, imprimir su etiqueta y darles salida con un albarán.

**Cómo funciona (no hay que hacer nada):** todas las cajas que pasan por la
báscula van a la cámara y **se reparten solas en palets** al pesar. Ejemplo:
el agricultor 1 trae 30 cajas y el 2 trae 40: el palet 1 se llena con 30 + 30
y las 10 que sobran abren el palet 2.

- Un palet que aún no llega a 60 está **en progreso**: sus cajas cuentan
  como **en cámara**.
- Cuando llega a 60 queda **completo**, con su **fecha de llenado**, listo
  para la etiqueta y la salida.
- Si se corrige una pesada (menos cajas) o se borra, sus cajas se quitan de
  sus palets; si un palet completo baja de 60, vuelve a estar en progreso y
  la siguiente pesada lo rellena primero.

**«🧱 Paletización»**

- Arriba: cajas en cámara, palets completos sin salida y cajas listas para
  salir. «Cajas en cámara por agricultor» lo desglosa.
- **🏷 Etiqueta** en cada palet (o marca varios y «🏷 Imprimir etiquetas»):
  sale en la impresora de pegatinas, una etiqueta por palet, con cada
  agricultor y sus cajas y la fecha de llenado. Arriba a la izquierda va
  el número del palet («Palet nº 3») para reconocer las etiquetas sueltas
  antes de pegarlas, y a la derecha su código en pequeño. El tamaño de la
  pegatina se cambia en Ajustes (por defecto 105 × 75 mm). En el diálogo
  de impresión elige la impresora de pegatinas.
- **Editar** un palet: cambia cuántas cajas lleva de cada pesada. Para
  completar uno al que le faltan cajas, pon cajas de una pesada en cámara o
  pulsa «Completar» en esa pesada. Lo que quites queda en la cámara sin palet.
- **+ Nuevo palet**: un palet hecho a mano con cajas que estén en cámara.
  No se crea hasta pulsar «Guardar palet»; si cancelas, no queda nada.

**«🚚 Salidas»** (o marca palets en Paletización y «🚚 Dar salida»)

1. «+ Nueva salida»: fecha, **destinatario** (los anteriores se proponen al
   escribir y rellenan sus datos), lugar de entrega, matrículas (tractora y
   remolque), temperatura y la mercancía (marcas, embalaje, naturaleza,
   peso). Lo que se repite sale como en la última salida; el peso se
   calcula con las cajas × el peso por caja de Ajustes.
2. Marca los palets que salen (vienen marcados los completos).
3. «Dar salida e imprimir CMR y albarán»: salen la **carta de porte (CMR)**,
   en tres ejemplares (remitente, destinatario y porteador), y el **albarán
   de salida** numerado (ALB-0001...) con cada palet, sus agricultores, las
   cajas y la fecha de entrada.
4. La fecha de salida se apunta sola como **Fecha (CMR)** en las pesadas que
   van en esos palets.

Los datos fijos del CMR (remitente, porteador y tipo de palet) están en
«⚙ Ajustes → Carta de porte (CMR)».

Desde el listado de salidas se puede volver a imprimir un albarán o
**anularlo** (sus palets vuelven a la cámara). Una pesada cuyas cajas ya han
salido no se puede borrar ni rebajar: hay que anular antes el albarán.

---

## 5. Puesto de la báscula

Junto a la báscula hay una tablet (u ordenador) con la página
**bascula.html** (la misma dirección de la app, cambiando el final por
`bascula.html`). Sirve para apuntar las cajas en el momento en que se pesan.

**La primera vez:** entrar con el usuario de la báscula. La sesión se queda
abierta: no se cierra a los 20 minutos ni al apagar la pantalla. Conviene
añadirla a la pantalla de inicio de la tablet.

**Apuntar una entrada:**

1. Arriba, comprueba la **campaña** (se queda recordada en la tablet).
2. Toca el **agricultor**, o escribe su código o nombre en el buscador
   (con el código y «Intro» se elige directamente).
3. Toca el **ciclo**. Se propone el último que se le apuntó.
4. Teclea las **cajas entradas**. Si se lleva cajas vacías, toca el
   recuadro **«Vacías que se lleva»** y teclea cuántas (si no, se queda en 0).
   El teclado escribe en el recuadro marcado en azul. Se puede apuntar solo
   vacías, sin cajas entradas.
5. Pulsa «✓ Registrar», o «🖨 Registrar e imprimir» si el agricultor
   tiene que firmar el justificante. Sale un aviso verde y la pantalla
   queda lista para el siguiente.

**Justificante:** salen **dos copias**, cada una en su página (en la
impresora de tickets, dos tickets seguidos, sin cortar nada): la 1 es la
«Copia para el agricultor» y la 2 la «Copia para la empresa». Cada una lleva
el nombre del agricultor, el ciclo, las cajas entradas, las cajas vacías
retiradas, la fecha y hora, y el hueco para la firma. Para volver a
imprimir uno, pulsa 🖨 en su línea de la columna **Hoy**. Si se guarda como
PDF, el archivo ya se llama con el agricultor, la fecha y la hora (por
ejemplo «Justificante José Pérez 2026-10-08 10.32.pdf»). La primera vez,
en el diálogo de impresión elige la impresora y que se recuerde.

**Si se va la red:** se puede seguir apuntando (e imprimiendo) igual. Arriba
sale un aviso naranja y las entradas aparecen en **Hoy** como
«⏳ pendiente de envío». Al volver la conexión se envían solas, sin hacer
nada. Mientras haya pendientes, **no cierres la sesión ni borres los datos
del navegador** de la tablet: es donde están guardadas. Si alguna entrada
no se puede guardar (por ejemplo, la tablet tiene mal la hora), sale en rojo
con «Reintentar» y «Descartar».

Si por error se apunta lo mismo dos veces seguidas al mismo agricultor, la
tablet pregunta antes de guardar.

**Corregir:** en la columna **Hoy** está todo lo apuntado en el día, con
«Anular» en cada línea. Solo se puede anular lo del mismo día y que no esté
liquidado; lo demás se corrige desde la oficina, en la ficha del agricultor,
donde esos registros salen marcados con **⚖ Báscula**.

**Un registro por día:** las entradas del mismo día de un agricultor, con la
misma campaña y el mismo ciclo, se **suman en un único registro**. Por
ejemplo, si el 21/10 un agricultor pasa 10 cajas (ciclo 1) y dos horas
después 26, en la oficina se ve un solo registro del 21/10 con 36 cajas. En
la tablet, la columna **Hoy** sigue enseñando cada entrada por separado (con
su hora y su justificante); «Anular» en una de ellas la resta del total del
día. Si el registro del día ya está liquidado, lo siguiente que se pese ese
día abre un registro nuevo.

Ese registro es un registro normal (fecha de hoy, ciclo, nº de cajas
entradas y cajas vacías retiradas), así que cuenta para el rendimiento y las liquidaciones sin hacer
nada más; las vacías cuentan en el control de cajas vacías. **No vuelvas a apuntar a mano en la oficina
lo que ya se metió en la báscula**, o se contará dos veces.

El usuario de la báscula solo puede hacer esto: no ve facturas, importes ni
datos de los agricultores.

---

## Referencia rápida

| Botón | Para qué |
| --- | --- |
| 🌱 Plantas retiradas | Anotar y consultar las plantas de cada ciclo |
| ⚖ Control de cajas | Descuadres de cajas vacías y lo que hay que cobrar |
| 🧱 Paletización | Cajas en cámara, palets, etiquetas |
| 🚚 Salidas | Dar salida a palets y albaranes de salida |
| 🧾 Liquidaciones | Liquidar por fechas y generar facturas |
| ⚙ Ajustes | Emisor, precios, IVA y series de numeración |
| 🔎 Buscar campaña | Registros de todos los agricultores de una campaña |

En la ficha de un agricultor, «🌱 Plantas retiradas» y «🧾 Liquidaciones» abren lo mismo pero ya filtrado por él.

Todos los listados tienen «⬇ Export» para bajarlos a Excel con los filtros
que tengas puestos.

---

## Cosas que conviene saber

- **Ninguna fecha admite días futuros.** El calendario los bloquea y, si se
  escriben a mano, la app avisa y no guarda.
- **La sesión se cierra a los 20 minutos sin actividad.** Es normal tener que
  volver a entrar después de comer. (La tablet de la báscula no se cierra.)
- **Cinco intentos fallidos de contraseña bloquean el acceso 24 horas.**
- **Al cerrar un formulario con datos escritos sin guardar, pregunta antes de
  descartarlos.**
- **Eliminar un agricultor borra todos sus registros.** No se puede deshacer.
- **Todo va con campaña y ciclo.** Al anotar algo sale elegida la campaña
  más reciente (ahora la 26/27) y el ciclo 1; cámbialos si no son esos.
- **Una campaña con datos no se puede eliminar.** Solo se borran campañas
  vacías.
