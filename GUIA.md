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
falte y no borra nada.

**Quien lo usa:** entrar en «⚙ Ajustes» y rellenar

1. **Emisor de las facturas:** nombre, NIF, dirección, teléfono y email.
2. **Precios por defecto:** precio por caja de bimi y precio de la caja vacía
   perdida. Son los que propone cada liquidación (se pueden cambiar en cada
   una).
3. **IVA / compensación (%).**
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

**Datos antiguos:** las plantas que ya estaban apuntadas en los registros se
pasan de golpe con «⬆ Importar de los registros». No duplica lo ya importado,
así que se puede pulsar sin miedo. Solo importa los registros que tengan
fecha de retirada; si alguno no la tiene, avisa de cuántos han quedado fuera.

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

**Facturar:** en el listado, «🧾 Facturar». Pide confirmación mostrando el
número que va a asignar y el total. Al aceptar, el nº de factura se copia
también al campo **Nº Factura** de todos los registros incluidos, así que la
tabla del agricultor los sigue agrupando por factura como siempre.

**Sacar el PDF:** abre la liquidación o la factura y pulsa «🖨 Imprimir». En
el diálogo del navegador, elige **«Guardar como PDF»** en vez de una
impresora.

**Un registro solo entra en una liquidación.** En la tabla del agricultor los
ya liquidados salen marcados como **Liquidado** y su botón pasa a
«🧾 Ver liq.», que abre la liquidación a la que pertenecen. Si borras una
liquidación, sus registros vuelven a quedar pendientes (y pierden el nº de
factura).

---

## 4. Puesto de la báscula

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

Cada entrada es un registro normal (fecha de hoy, ciclo, nº de cajas
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
