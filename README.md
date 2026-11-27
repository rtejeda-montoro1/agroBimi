# AgroBimi

Aplicación web de gestión agrícola para un almacén de bimi: agricultores,
entradas de producción, cámara y palets, salidas con CMR y albarán,
liquidaciones y recibos. Funciona en el navegador con
[Supabase](https://supabase.com) como base de datos y se publica con
GitHub Pages.

La guía de uso (qué hace cada botón) está en
[agroBimi/GUIA.md](agroBimi/GUIA.md).

## Estructura

- `index.html`: punto de entrada; redirige a `agroBimi/`.
- `agroBimi/`: la aplicación.
  - `index.html`, `styles.css`, `app.js`: la app de la oficina.
  - `bascula.html`, `bascula.css`: el puesto de la báscula (tablet junto al
    peso para apuntar las cajas que entran).
  - `albaran.html`: copia digital de una salida, la que abre el QR del CMR
    y del albarán.
  - `documentos.css`: estilos del CMR y del albarán.
  - `config.js`: URL del proyecto de Supabase y su clave pública (anon).
  - `schema.sql`: esquema completo de la base de datos (tablas, funciones,
    triggers y permisos).
  - `js/`: un módulo por área (agricultores, registros, campañas, plantas,
    cajas, palets, salidas, liquidaciones, facturas, ajustes, báscula...).
  - `tests/`: pruebas unitarias.
- `supabase/functions/`: funciones Edge de Supabase.

## Pruebas

Con Node.js 18 o posterior, desde la raíz:

    npm --prefix agroBimi test

No hace falta instalar dependencias (usa el test runner de Node.js).

Para que no se pueda hacer commit en `main` con las pruebas fallando,
activa el hook una vez en cada clon:

    git config core.hooksPath .githooks

## Puesta en marcha

1. Crea un proyecto en Supabase y pon su URL y su clave anon en
   `agroBimi/config.js`.
2. Ejecuta `agroBimi/schema.sql` completo en el editor SQL de Supabase. Se
   puede volver a ejecutar sin perder datos: solo crea lo que falte. Los
   cambios que transforman datos existentes van en scripts de migración
   aparte, fuera del repositorio.
3. Da de alta los usuarios en Supabase (Authentication) con el registro
   público desactivado.
4. Entra en la app y rellena **⚙ Ajustes** (datos del emisor, precios, IVA
   y series de numeración).

## Datos privados

El repositorio es público: aquí no van datos del cliente ni de los
agricultores, documentos reales, copias de seguridad ni claves. Todo eso se
guarda fuera del repositorio (la carpeta `agroBimi/privado/` está en
`.gitignore`).
