-- =====================================================================
--  ESQUEMA DE LA BASE DE DATOS  (ejecútalo en Supabase → SQL Editor)
-- =====================================================================

-- 1) Tabla de ventas
create table if not exists ventas (
  id         bigint generated always as identity primary key,
  fecha      date          not null,               -- fecha de venta
  producto   text          not null,               -- nombre / descripción
  precio     numeric(10,2) not null default 0,      -- importe
  factura    text,                                  -- número de factura
  created_at timestamptz   not null default now()
);

-- Índice para acelerar las búsquedas por fecha
create index if not exists ventas_fecha_idx on ventas (fecha);

-- 2) Seguridad a nivel de fila (RLS)
--    Activamos RLS y SOLO permitimos acceso a usuarios que han iniciado
--    sesión (rol "authenticated"). El rol "anon" (sin login) queda
--    bloqueado: alguien con la URL ve la web, pero no puede leer ni
--    escribir datos sin usuario y contraseña.
--    Todos los usuarios autenticados comparten las mismas ventas.
alter table ventas enable row level security;

-- Quitamos políticas previas (la antigua de anon y la actual) para poder
-- ejecutar este archivo las veces que haga falta sin que dé error.
drop policy if exists "acceso_anon_ventas" on ventas;
drop policy if exists "acceso_autenticados_ventas" on ventas;

create policy "acceso_autenticados_ventas"
  on ventas
  for all
  to authenticated
  using (true)
  with check (true);

-- 3) Permisos de tabla (GRANT)
--    RLS decide QUÉ filas ve cada rol, pero el rol necesita además
--    permiso sobre la tabla. Damos acceso completo a los usuarios con
--    sesión y se lo quitamos por completo al rol anónimo (sin login).
grant select, insert, update, delete on table ventas to authenticated;
revoke all on table ventas from anon;
