# Gestion de Bimi

Mini app web para gestionar agricultores y registros de produccion.

## Estructura del proyecto

- index.html: estructura principal de la interfaz.
- styles.css: estilos de la aplicacion.
- config.js: constantes de configuracion (Supabase URL y anon key).
- schema.sql: esquema SQL de la base de datos.
- app.js: punto de entrada de la aplicacion.

## Modulos JavaScript

- js/core.js: estado global, referencias DOM y cliente de base de datos.
- js/utils.js: utilidades compartidas.
- js/auth.js: autenticacion y sesion.
- js/agricultores.js: logica CRUD de agricultores.
- js/campanas.js: logica de campanas y filtro por campana.
- js/registros.js: logica CRUD de registros.
- js/reportes.js: exportacion y resumenes.
- js/ui.js: eventos de interfaz e inicializacion.

## Nota

El proyecto usa Supabase y una estructura modular en JavaScript para separar responsabilidades.
