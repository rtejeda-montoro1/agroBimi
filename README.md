# 🧾 Recuento de Ventas — mini-app web

App web (móvil + escritorio) para registrar las ventas de tu tienda, sustituyendo el Excel.
Búsqueda por fechas y por texto, y botones para **añadir / editar / eliminar**.
Los datos se guardan en **Supabase** (gratis), así que los ves iguales desde cualquier dispositivo.

---

## 1) Crear la base de datos en Supabase (5 min)

1. Entra en <https://supabase.com> y crea una cuenta gratis.
2. Pulsa **New project**. Ponle nombre (ej. `tienda`) y una contraseña. Espera ~1 min a que arranque.
3. Ve al menú **SQL Editor** → **New query**, pega el contenido de `schema.sql` y pulsa **Run**.
   Esto crea la tabla `ventas`.
4. Ve a **Project Settings** (icono engranaje) → **API** y copia:
   - **Project URL**
   - En **Project API keys**, la clave **`anon` `public`**

## 2) Configurar la app

Abre `config.js` y pega esos dos valores:

```js
const SUPABASE_URL = "https://xxxxxxxx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOi...";
```

## 3) Probarla en tu ordenador

Abre `index.html` directamente en el navegador. Ya deberías poder añadir ventas.
> Si tu navegador bloquea algo, sirve la carpeta con un servidor local:
> `python -m http.server 8000` y entra en <http://localhost:8000>.

## 4) Publicarla gratis en internet (para usarla desde el móvil)

Cualquiera de estas opciones sirve; **Netlify Drop** es la más rápida:

- **Netlify Drop**: ve a <https://app.netlify.com/drop> y arrastra la carpeta `tienda-ventas`.
  Te da una URL pública al instante. Guárdala como acceso directo en el móvil.
- **Vercel**: <https://vercel.com> → importa la carpeta.
- **GitHub Pages**: sube la carpeta a un repositorio y actívalo en Settings → Pages.

En el móvil, abre la URL y usa "Añadir a pantalla de inicio" para tenerla como una app.

---

## Migrar tus datos actuales del Excel (opcional)

1. En Excel, ordena las columnas como: `fecha`, `producto`, `precio`, `factura`.
   La fecha debe estar en formato `AAAA-MM-DD` (ej. `2026-07-17`).
2. Guarda como **CSV**.
3. En Supabase → **Table Editor** → tabla `ventas` → botón **Insert** → **Import data from CSV**.

---

## Acceso con usuario y contraseña

La app está protegida con **login** (Supabase Auth). Al abrirla, pide email y contraseña, y
sin iniciar sesión no se puede ver ni editar ninguna venta. Todos los usuarios que entren
comparten **las mismas ventas**.

### Crear usuarios (solo tú)

No hay registro público: los usuarios se crean a mano desde Supabase.

1. Entra en Supabase → **Authentication** → **Users** → botón **Add user** → **Create new user**.
2. Pon el **email** y una **contraseña**, y marca **Auto Confirm User** (para que pueda entrar sin verificar el correo).
3. Repite por cada persona a la que quieras dar acceso. Pásale su email y contraseña.

> Si actualizas desde una versión anterior de la app, vuelve a ejecutar `schema.sql` en el
> **SQL Editor** para aplicar las nuevas reglas de seguridad (bloquean el acceso sin login).

## Seguridad — nota

La clave `anon` sigue yendo incrustada en la web (es normal en apps de navegador), pero **por sí
sola ya no da acceso a los datos**: las reglas RLS solo permiten leer/escribir a usuarios con
sesión iniciada. Para bloquear del todo el acceso, basta con no crear usuarios de más y usar
contraseñas fuertes.

## Archivos

| Archivo       | Qué es                                    |
|---------------|-------------------------------------------|
| `index.html`  | Estructura de la página                   |
| `styles.css`  | Estilos (responsive, modo claro/oscuro)   |
| `app.js`      | Lógica: cargar, buscar, añadir, editar…   |
| `config.js`   | Tus claves de Supabase                     |
| `schema.sql`  | SQL para crear la tabla                    |
