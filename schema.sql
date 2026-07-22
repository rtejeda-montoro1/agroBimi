-- =====================================================================
--  ESQUEMA DE LA BASE DE DATOS
--  Gestión de Bimi
-- =====================================================================

-- 1) Tabla de AGRICULTORES
--    Lo único obligatorio es el nombre. El "codigo" es un número único de
--    3 dígitos que asigna la app al crear el agricultor; no se edita.
create table if not exists agricultores (
  id         bigint generated always as identity primary key,
  nombre     text          not null,
  codigo     integer       unique,
  created_at timestamptz   not null default now()
);

-- Si actualizas desde una versión anterior, añade la columna que falte:
alter table agricultores add column if not exists codigo integer;
do $$ begin
  alter table agricultores add constraint agricultores_codigo_key unique (codigo);
exception when duplicate_table or duplicate_object then null;
end $$;

create index if not exists agricultores_nombre_idx on agricultores (nombre);

-- 2) Tabla de REGISTROS
--    Cada registro pertenece a un agricultor. Todos los campos (salvo el
--    vínculo con el agricultor) son opcionales: se pueden dejar en blanco,
--    editar o eliminar.
create table if not exists registros (
  id                     bigint generated always as identity primary key,
  agricultor_id          bigint  not null references agricultores(id) on delete cascade,
  fecha                  date,                       -- Fecha
  ciclo                  text,                       -- Ciclo
  cajas_entradas         integer,                    -- Nº Cajas Entradas
  fecha_cmr              date,                       -- Fecha (CMR)
  cajas_salidas          integer,                    -- Nº Cajas Salidas
  descuento_cajas        integer,                    -- Descuento Cajas
  num_factura            text,                       -- Nº Factura
  cajas_vacias_retiradas integer,                    -- Cajas Vacías retiradas
  num_plantas            integer,                    -- Nº Plantas
  fecha_retirada         date,                       -- Fecha de Retirada
  comentarios            text,                       -- Comentarios
  created_at             timestamptz not null default now()
);

create index if not exists registros_agricultor_idx on registros (agricultor_id);
create index if not exists registros_fecha_idx on registros (fecha);

-- 3) Tabla de CAMPAÑAS
--    Cada registro puede pertenecer (opcionalmente) a una campaña.
create table if not exists campanas (
  id         bigint generated always as identity primary key,
  nombre     text          not null,
  created_at timestamptz   not null default now()
);

-- Vínculo registro -> campaña (se añade también al actualizar versiones antiguas).
alter table registros add column if not exists campana_id bigint references campanas(id) on delete set null;
create index if not exists registros_campana_idx on registros (campana_id);

-- 4) Seguridad a nivel de fila (RLS)
--    Activamos RLS y SOLO permitimos acceso a usuarios que han iniciado
--    sesión (rol "authenticated"). El rol "anon" (sin login) queda
--    bloqueado: alguien con la URL ve la web, pero no puede leer ni
--    escribir datos sin usuario y contraseña.
--    Todos los usuarios autenticados comparten los mismos datos.
alter table agricultores enable row level security;
alter table registros    enable row level security;
alter table campanas     enable row level security;

-- Quitamos políticas previas para poder ejecutar este archivo las veces
-- que haga falta sin que dé error.
drop policy if exists "acceso_anon_ventas"          on registros;
drop policy if exists "acceso_autenticados_ventas"  on registros;
drop policy if exists "acceso_autenticados_agricultores" on agricultores;
drop policy if exists "acceso_autenticados_registros"    on registros;
drop policy if exists "acceso_autenticados_campanas"     on campanas;

create policy "acceso_autenticados_agricultores"
  on agricultores
  for all
  to authenticated
  using (true)
  with check (true);

create policy "acceso_autenticados_registros"
  on registros
  for all
  to authenticated
  using (true)
  with check (true);

create policy "acceso_autenticados_campanas"
  on campanas
  for all
  to authenticated
  using (true)
  with check (true);

-- 5) Permisos de tabla (GRANT)
--    RLS decide QUÉ filas ve cada rol, pero el rol necesita además
--    permiso sobre la tabla. Damos acceso completo a los usuarios con
--    sesión y se lo quitamos por completo al rol anónimo (sin login).
grant select, insert, update, delete on table agricultores to authenticated;
grant select, insert, update, delete on table registros    to authenticated;
grant select, insert, update, delete on table campanas     to authenticated;
revoke all on table agricultores from anon;
revoke all on table registros    from anon;
revoke all on table campanas     from anon;
