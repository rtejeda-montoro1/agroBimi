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

-- Impedir campañas duplicadas por nombre (sin distinguir mayúsculas ni
-- espacios sobrantes). Es la red de seguridad real: la validación en la app
-- es solo de UX y puede fallar si su estado está desactualizado.
--
-- Paso 1: si ya hubiera duplicados de una versión anterior, los unificamos.
--   a) Reapuntamos los registros a la campaña de MENOR id de cada nombre.
update registros r
set campana_id = (
  select min(c2.id) from campanas c2
  where lower(trim(c2.nombre)) = lower(trim(c1.nombre))
)
from campanas c1
where r.campana_id = c1.id;

--   b) Borramos las campañas duplicadas sobrantes (conservando la de menor id).
delete from campanas c
where exists (
  select 1 from campanas c2
  where lower(trim(c2.nombre)) = lower(trim(c.nombre))
    and c2.id < c.id
);

-- Paso 2: índice único que impide crear el mismo nombre de nuevo.
create unique index if not exists campanas_nombre_unico
  on campanas (lower(trim(nombre)));

-- 4) Datos fiscales del AGRICULTOR
--    Necesarios para poder emitir facturas completas. Todos opcionales:
--    un agricultor sigue siendo válido solo con el nombre.
alter table agricultores add column if not exists nif           text;
alter table agricultores add column if not exists direccion     text;
alter table agricultores add column if not exists codigo_postal text;
alter table agricultores add column if not exists poblacion     text;
alter table agricultores add column if not exists provincia     text;
alter table agricultores add column if not exists telefono      text;
alter table agricultores add column if not exists email         text;
alter table agricultores add column if not exists iban          text;

-- 5) RETIRADAS DE PLANTAS
--    Cada agricultor retira plantas (plantones) en cada ciclo. El número de
--    plantas y la fecha de retirada son la base del RENDIMIENTO:
--        rendimiento = cajas de bimi entregadas / plantas retiradas
--    Puede haber varias retiradas dentro del mismo ciclo: se suman.
create table if not exists retiradas_plantas (
  id            bigint generated always as identity primary key,
  agricultor_id bigint      not null references agricultores(id) on delete cascade,
  campana_id    bigint      references campanas(id) on delete set null,
  ciclo         text,                       -- 1, 2 o 3 (mismo criterio que registros)
  fecha         date        not null,       -- fecha de retirada de las plantas
  num_plantas   integer     not null default 0,
  variedad      text,
  comentarios   text,
  created_at    timestamptz not null default now()
);

create index if not exists retiradas_agricultor_idx on retiradas_plantas (agricultor_id);
create index if not exists retiradas_campana_idx    on retiradas_plantas (campana_id);
create index if not exists retiradas_fecha_idx      on retiradas_plantas (fecha);

-- 6) CONTROL DE CAJAS VACÍAS
--    El agricultor se lleva cajas vacías y las devuelve llenas de bimi.
--    Con las columnas que ya existen (cajas_vacias_retiradas y
--    cajas_entradas) faltaba una: las vacías que devuelve sin usar.
--    El descuadre es: retiradas − devueltas llenas − devueltas vacías.
alter table registros add column if not exists cajas_vacias_devueltas integer;

-- 7) CARTAS DE PORTE
--    Documento de salida: cuando se cargan los palets en el camión se les
--    da salida en una carta de porte.
create table if not exists cartas_porte (
  id            bigint generated always as identity primary key,
  secuencia     integer     unique,         -- contador interno para numerar
  numero        text        unique,         -- p. ej. CP-0001
  fecha         date        not null,
  transportista text,
  matricula     text,
  remolque      text,
  destino       text,
  observaciones text,
  created_at    timestamptz not null default now()
);

create index if not exists cartas_porte_fecha_idx on cartas_porte (fecha);

-- 8) PALETS
--    Las cajas que traen los agricultores se paletizan en su finca (varios
--    palets por agricultor). Cada palet queda "pendiente de carga" hasta
--    que se asigna a una carta de porte: ahí es cuando tiene salida.
create table if not exists palets (
  id             bigint generated always as identity primary key,
  secuencia      integer     unique,        -- contador interno para numerar
  codigo         text        unique,        -- p. ej. P-000123
  agricultor_id  bigint      not null references agricultores(id) on delete cascade,
  campana_id     bigint      references campanas(id) on delete set null,
  ciclo          text,
  fecha          date        not null,      -- fecha de paletizado
  num_cajas      integer     not null default 0,
  carta_porte_id bigint      references cartas_porte(id) on delete set null,
  comentarios    text,
  created_at     timestamptz not null default now()
);

create index if not exists palets_agricultor_idx  on palets (agricultor_id);
create index if not exists palets_campana_idx     on palets (campana_id);
create index if not exists palets_carta_idx       on palets (carta_porte_id);
create index if not exists palets_fecha_idx       on palets (fecha);

-- 9) LIQUIDACIONES
--    Una liquidación agrupa los registros de un agricultor en un rango de
--    fechas, les pone precio y calcula el total. Al facturarla se le asigna
--    un nº de factura, que además se copia al campo num_factura de cada
--    registro incluido (así sigue funcionando la agrupación de la tabla).
create table if not exists liquidaciones (
  id                  bigint generated always as identity primary key,
  secuencia           integer     unique,   -- contador interno para numerar
  numero              text        unique,   -- p. ej. LIQ-0001
  agricultor_id       bigint      not null references agricultores(id) on delete cascade,
  campana_id          bigint      references campanas(id) on delete set null,
  fecha               date        not null, -- fecha de la liquidación
  fecha_desde         date        not null, -- periodo liquidado
  fecha_hasta         date        not null,
  estado              text        not null default 'borrador',
  precio_caja         numeric(12,4),
  precio_caja_perdida numeric(12,4),
  iva_porcentaje      numeric(5,2),
  base                numeric(12,2),
  iva                 numeric(12,2),
  total               numeric(12,2),
  factura_secuencia   integer     unique,
  num_factura         text,
  fecha_factura       date,
  observaciones       text,
  created_at          timestamptz not null default now()
);

do $$ begin
  alter table liquidaciones add constraint liquidaciones_estado_check
    check (estado in ('borrador', 'cerrada', 'facturada'));
exception when duplicate_object then null;
end $$;

create index if not exists liquidaciones_agricultor_idx on liquidaciones (agricultor_id);
create index if not exists liquidaciones_fecha_idx      on liquidaciones (fecha);
create index if not exists liquidaciones_periodo_idx    on liquidaciones (fecha_desde, fecha_hasta);

-- Vínculo registro -> liquidación: marca el registro como ya liquidado para
-- que no se vuelva a incluir en otra liquidación.
alter table registros add column if not exists liquidacion_id bigint
  references liquidaciones(id) on delete set null;
create index if not exists registros_liquidacion_idx on registros (liquidacion_id);

-- 10) LÍNEAS DE LIQUIDACIÓN
--     Se guardan calculadas ("congeladas") para que una liquidación cerrada
--     no cambie de importe si después se editan los registros o los precios.
--     tipo: bimi | descuento | cajas_perdidas | otro
create table if not exists liquidacion_lineas (
  id             bigint generated always as identity primary key,
  liquidacion_id bigint       not null references liquidaciones(id) on delete cascade,
  tipo           text         not null default 'otro',
  concepto       text         not null,
  cantidad       numeric(12,2) not null default 0,
  precio         numeric(12,4) not null default 0,
  importe        numeric(12,2) not null default 0,
  orden          integer      not null default 0
);

create index if not exists liquidacion_lineas_liq_idx on liquidacion_lineas (liquidacion_id);

-- 11) PARÁMETROS
--     Ajustes globales de la app: datos del emisor de las facturas, precios
--     por defecto, IVA y series de numeración.
create table if not exists parametros (
  clave      text        primary key,
  valor      text,
  updated_at timestamptz not null default now()
);

insert into parametros (clave, valor) values
  ('emisor_nombre',       ''),
  ('emisor_nif',          ''),
  ('emisor_direccion',    ''),
  ('emisor_codigo_postal',''),
  ('emisor_poblacion',    ''),
  ('emisor_provincia',    ''),
  ('emisor_telefono',     ''),
  ('emisor_email',        ''),
  ('precio_caja',         '0'),
  ('precio_caja_perdida', '0'),
  ('iva_porcentaje',      '0'),
  ('serie_liquidacion',   'LIQ'),
  ('serie_factura',       'F'),
  ('serie_palet',         'P'),
  ('serie_carta_porte',   'CP')
on conflict (clave) do nothing;

-- 12) Seguridad a nivel de fila (RLS)
--    Activamos RLS y SOLO permitimos acceso a usuarios que han iniciado
--    sesión (rol "authenticated"). El rol "anon" (sin login) queda
--    bloqueado: alguien con la URL ve la web, pero no puede leer ni
--    escribir datos sin usuario y contraseña.
--    Todos los usuarios autenticados comparten los mismos datos.
--    Se aplica igual a todas las tablas, incluidas las nuevas.
do $$
declare t text;
begin
  foreach t in array array[
    'agricultores', 'registros', 'campanas', 'retiradas_plantas',
    'cartas_porte', 'palets', 'liquidaciones', 'liquidacion_lineas',
    'parametros'
  ]::text[]
  loop
    execute format('alter table %I enable row level security', t);
    -- Quitamos la política previa para poder ejecutar este archivo las
    -- veces que haga falta sin que dé error.
    execute format('drop policy if exists "acceso_autenticados_%s" on %I', t, t);
    execute format(
      'create policy "acceso_autenticados_%s" on %I for all to authenticated using (true) with check (true)',
      t, t);
    -- RLS decide QUÉ filas ve cada rol, pero el rol necesita además
    -- permiso sobre la tabla. Acceso completo a los usuarios con sesión y
    -- nada en absoluto al rol anónimo (sin login).
    execute format('grant select, insert, update, delete on table %I to authenticated', t);
    execute format('revoke all on table %I from anon', t);
  end loop;
end $$;

-- Políticas antiguas con otro nombre (versiones anteriores del esquema).
drop policy if exists "acceso_anon_ventas"         on registros;
drop policy if exists "acceso_autenticados_ventas" on registros;
