# Guía de uso — Gestión de Bimi

Guía breve de las funciones nuevas: plantas y rendimiento, control de cajas,
palets y cartas de porte, y liquidaciones y facturas.

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
4. **Series de numeración:** las iniciales de cada documento (LIQ, F, P, CP).
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

**Ver el rendimiento:**

- En la ficha del agricultor, en el panel «📈 Rendimiento por ciclo»: una
  tarjeta por ciclo con plantas, cajas, cajas/planta, días de ciclo y fechas.
- En «📈 Rendimientos», el informe de todos, filtrable por agricultor,
  campaña y ciclo. Las filas en **ámbar** son ciclos a los que les falta un
  lado del cálculo: o no tienen plantas anotadas, o todavía no han metido
  cajas.

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

## 3. Palets y cartas de porte

**Paletizar en la finca:** «🧱 Palets» → «+ Nuevo palet» → agricultor,
fecha, ciclo y nº de cajas. Si salen varios palets iguales, pon cuántos en
**«Crear varios palets iguales»** y se crean todos de golpe, cada uno con su
código.

Un palet nace **pendiente de carga**: sigue contando como stock en cámara.

**Dar salida al cargar el camión:**

1. En «🧱 Palets», marca los palets que se cargan (o usa
   «☑ Marcar / desmarcar»). Los que ya tienen salida salen bloqueados.
2. Pulsa «🚚 Dar salida». Arriba se ve cuántos palets y cuántas cajas son.
3. Elige la carta de porte, o créala ahí mismo con
   «+ Nueva carta de porte» (fecha, transportista, matrícula, remolque y
   destino).

Una carta de porte puede llevar palets de **varios agricultores**.

**Imprimir la carta de porte:** «🚚 Cartas de porte» → «🖨 Imprimir». Sale
agrupada por agricultor, con el detalle de palets, los totales y los huecos
de firma.

**Corregir un error:** en el listado de palets, «Quitar de la carta» devuelve
el palet a pendiente de carga. Si borras una carta de porte, todos sus palets
vuelven a pendientes.

**Cajas en cámara:** «📦 Cajas en cámara» muestra por separado las salidas
apuntadas a mano en el registro y las salidas por carta de porte:

    en cámara = entradas − salidas del registro − salidas por carta de porte

Si empiezas a usar cartas de porte, deja de rellenar «Nº Cajas Salidas» a
mano para no descontar dos veces lo mismo.

---

## 4. Liquidaciones y facturas

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
impresora. Funciona igual con las cartas de porte.

**Un registro solo entra en una liquidación.** En la tabla del agricultor los
ya liquidados salen marcados como **Liquidado** y su botón pasa a
«🧾 Ver liq.», que abre la liquidación a la que pertenecen. Si borras una
liquidación, sus registros vuelven a quedar pendientes (y pierden el nº de
factura).

---

## Referencia rápida

| Botón | Para qué |
| --- | --- |
| 📈 Rendimientos | Cajas por planta de todos los agricultores y ciclos |
| 🌱 Plantas retiradas | Anotar y consultar las plantas de cada ciclo |
| 📦 Cajas en cámara | Stock pendiente de salida por agricultor |
| ⚖ Control de cajas | Descuadres de cajas vacías y lo que hay que cobrar |
| 🧱 Palets | Paletizar y dar salida a los palets |
| 🚚 Cartas de porte | Documentos de salida, imprimibles |
| 🧾 Liquidaciones | Liquidar por fechas y generar facturas |
| ⚙ Ajustes | Emisor, precios, IVA y series de numeración |
| 🔎 Buscar campaña | Registros de todos los agricultores de una campaña |

En la ficha de un agricultor, «🌱 Plantas retiradas», «🧱 Palets» y
«🧾 Liquidaciones» abren lo mismo pero ya filtrado por él.

Todos los listados tienen «⬇ Export» para bajarlos a Excel con los filtros
que tengas puestos.

---

## Cosas que conviene saber

- **Ninguna fecha admite días futuros.** El calendario los bloquea y, si se
  escriben a mano, la app avisa y no guarda.
- **La sesión se cierra a los 20 minutos sin actividad.** Es normal tener que
  volver a entrar después de comer.
- **Cinco intentos fallidos de contraseña bloquean el acceso 24 horas.**
- **Al cerrar un formulario con datos escritos sin guardar, pregunta antes de
  descartarlos.**
- **Eliminar un agricultor borra todos sus registros.** No se puede deshacer.
- **Eliminar una campaña no borra registros:** solo les deja el campo Campaña
  en blanco.
