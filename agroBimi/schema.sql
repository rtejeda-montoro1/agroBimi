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
--    Cada registro pertenece a un agricultor. Salvo el agricultor, la
--    campaña y el ciclo (obligatorios, ver sección 15), todos los campos son
--    opcionales: se pueden dejar en blanco, editar o eliminar.
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
--    Todo registro, retirada de plantas y liquidación pertenece a una
--    campaña (obligatorio desde 2026-10-11, ver sección 15).
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

-- 7) PALETS
--    Las cajas se guardan en la cámara (sección 8) y allí se agrupan en
--    palets. Un palet puede llevar cajas de VARIOS agricultores: cuántas
--    de cada uno va en palet_lineas. El palet sigue ocupando sitio en la
--    cámara hasta que se le da salida (fecha_salida).
create table if not exists palets (
  id            bigint generated always as identity primary key,
  secuencia     integer     unique,        -- contador interno para numerar
  codigo        text        unique,        -- p. ej. P-000123
  campana_id    bigint      references campanas(id) on delete set null,
  ciclo         text,                      -- ya no se usa (versiones antiguas)
  fecha         date        not null,      -- fecha de paletizado
  num_cajas     integer     not null default 0,  -- suma de sus líneas (trigger)
  fecha_salida  date,                      -- null = sigue en la cámara
  comentarios   text,
  created_at    timestamptz not null default now()
);

alter table palets add column if not exists fecha_salida date;

create index if not exists palets_campana_idx on palets (campana_id);
create index if not exists palets_fecha_idx   on palets (fecha);
create index if not exists palets_salida_idx  on palets (fecha_salida);

create table if not exists palet_lineas (
  id            bigint generated always as identity primary key,
  palet_id      bigint  not null references palets(id) on delete cascade,
  agricultor_id bigint  not null references agricultores(id) on delete cascade,
  num_cajas     integer not null check (num_cajas > 0)
);

create index if not exists palet_lineas_palet_idx      on palet_lineas (palet_id);
create index if not exists palet_lineas_agricultor_idx on palet_lineas (agricultor_id);

-- El total de cajas del palet se mantiene solo a partir de sus líneas.
create or replace function public.palet_actualizar_total(p_palet_id bigint)
returns void
language sql
as $$
  update palets
  set num_cajas = coalesce((select sum(num_cajas) from palet_lineas where palet_id = p_palet_id), 0)
  where id = p_palet_id;
$$;

create or replace function public.palet_lineas_total_trg()
returns trigger
language plpgsql
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.palet_actualizar_total(new.palet_id);
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.palet_id <> new.palet_id) then
    perform public.palet_actualizar_total(old.palet_id);
  end if;
  return null;
end;
$$;

drop trigger if exists palet_lineas_total on palet_lineas;
create trigger palet_lineas_total
  after insert or update or delete on palet_lineas
  for each row execute function public.palet_lineas_total_trg();

-- Actualización desde versiones anteriores, donde cada palet era de UN
-- agricultor (palets.agricultor_id) y salía en una carta de porte:
--   - cada palet antiguo pasa a tener una línea con su agricultor;
--   - la fecha de su carta de porte pasa a ser su fecha de salida;
--   - se borran las cartas de porte (ya no se usan).
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'palets'
               and column_name = 'agricultor_id') then
    insert into palet_lineas (palet_id, agricultor_id, num_cajas)
    select p.id, p.agricultor_id, p.num_cajas
    from palets p
    where p.agricultor_id is not null and p.num_cajas > 0
      and not exists (select 1 from palet_lineas l where l.palet_id = p.id);
    alter table palets drop column agricultor_id;
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'palets'
               and column_name = 'carta_porte_id') then
    update palets p set fecha_salida = c.fecha
    from cartas_porte c
    where p.carta_porte_id = c.id and p.fecha_salida is null;
    alter table palets drop column carta_porte_id;
  end if;
end $$;

drop table if exists cartas_porte;

-- 8) CÁMARA
--    Cada vez que se guardan cajas en la cámara se apunta aquí (es un paso
--    aparte de la báscula: no todo lo pesado tiene por qué ir a la cámara).
--    Ocupación de la cámara = cajas guardadas − cajas de palets ya salidos.
--    La capacidad está en Ajustes (parámetro capacidad_camara).
create table if not exists camara_entradas (
  id            bigint generated always as identity primary key,
  agricultor_id bigint      not null references agricultores(id) on delete cascade,
  campana_id    bigint      references campanas(id) on delete set null,
  fecha         date        not null,
  num_cajas     integer     not null check (num_cajas > 0),
  comentarios   text,
  created_at    timestamptz not null default now()
);

create index if not exists camara_entradas_agricultor_idx on camara_entradas (agricultor_id);
create index if not exists camara_entradas_fecha_idx      on camara_entradas (fecha);

-- Saldo de la cámara por agricultor. Se calcula en la base de datos para
-- no tener que traer todos los movimientos a la app.
--   guardadas:   cajas que ha metido en la cámara
--   paletizadas: cajas suyas que están en algún palet (salido o no)
--   en_palets:   cajas suyas en palets que siguen en la cámara
--   sueltas:     guardadas sin paletizar todavía
-- Los palets antiguos (anteriores a la cámara) no tienen cajas guardadas
-- detrás: por eso "sueltas" nunca baja de 0.
-- (security_invoker: respeta los permisos de quien consulta.)
create or replace view camara_saldos with (security_invoker = true) as
select a.id as agricultor_id,
       coalesce(e.guardadas, 0)   as guardadas,
       coalesce(l.paletizadas, 0) as paletizadas,
       coalesce(l.en_palets, 0)   as en_palets,
       greatest(coalesce(e.guardadas, 0) - coalesce(l.paletizadas, 0), 0) as sueltas
from agricultores a
left join (
  select agricultor_id, sum(num_cajas)::integer as guardadas
  from camara_entradas group by agricultor_id
) e on e.agricultor_id = a.id
left join (
  select pl.agricultor_id,
         sum(pl.num_cajas)::integer as paletizadas,
         (coalesce(sum(pl.num_cajas) filter (where p.fecha_salida is null), 0))::integer as en_palets
  from palet_lineas pl
  join palets p on p.id = pl.palet_id
  group by pl.agricultor_id
) l on l.agricultor_id = a.id;

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

-- Retención IRPF del recibo de compensación (sobre base + IVA).
alter table liquidaciones add column if not exists retencion_porcentaje numeric(5,2);
alter table liquidaciones add column if not exists retencion            numeric(12,2);

-- La factura la trae el agricultor: num_factura / fecha_factura son las de
-- SU factura (escritas a mano) y no se emite recibo de compensación ni se
-- gasta número de la serie (factura_secuencia queda vacía).
alter table liquidaciones add column if not exists factura_agricultor boolean not null default false;

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
  -- Datos del emisor: vacíos aquí (el repo es público). Se rellenan en
  -- Ajustes o con privado/datos_cliente.sql, que no está en el repo.
  ('emisor_nombre',       ''),
  ('emisor_nif',          ''),
  ('emisor_direccion',    ''),
  ('emisor_codigo_postal',''),
  ('emisor_poblacion',    ''),
  ('emisor_provincia',    ''),
  ('emisor_registro',     ''),
  ('emisor_telefono',     ''),
  ('emisor_email',        ''),
  ('precio_caja',         '0'),
  ('precio_caja_perdida', '0'),
  ('iva_porcentaje',      '12'),
  ('retencion_porcentaje','2'),
  ('serie_liquidacion',   'LIQ'),
  ('serie_factura',       'F'),
  ('serie_palet',         'P'),
  ('capacidad_camara',    '22')
on conflict (clave) do nothing;

-- Ya no hay cartas de porte.
delete from parametros where clave = 'serie_carta_porte';

-- 12) USUARIOS DE BÁSCULA
--     La tablet que está junto a la báscula entra con un usuario propio
--     (p. ej. bascula@...) cuya sesión no caduca. Ese usuario NO puede
--     leer ni escribir las tablas directamente: solo puede usar las
--     funciones bascula_* de la sección 14 (listar agricultores, apuntar
--     cajas y anular lo que apuntó hoy). Así, si alguien coge la tablet,
--     no ve facturas, IBAN ni importes.
--
--     Para dar de alta el usuario de la báscula:
--       1. Supabase -> Authentication -> Add user (email + contraseña).
--       2. Ejecutar:
--            insert into usuarios_bascula (user_id)
--            select id from auth.users where email = 'bascula@tu-dominio.com'
--            on conflict do nothing;
create table if not exists usuarios_bascula (
  user_id    uuid        primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Nadie la lee desde la app: solo la consulta es_bascula().
alter table usuarios_bascula enable row level security;
revoke all on table usuarios_bascula from anon, authenticated;

create or replace function public.es_bascula()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from usuarios_bascula where user_id = auth.uid());
$$;

revoke all on function public.es_bascula() from public, anon;
grant execute on function public.es_bascula() to authenticated;

-- Origen del registro: null = apuntado en la oficina, 'bascula' = desde
-- la tablet de la báscula.
alter table registros add column if not exists origen text;

-- Para las entradas de la báscula:
--   client_uuid: identificador que genera la tablet al apuntar. Si la red
--     falla, la tablet reenvía la entrada más tarde; con este código el
--     servidor sabe si ya la tenía y no la duplica.
--   pesada_en: momento en que se pesó (no en el que llegó al servidor,
--     que puede ser horas después si no había red).
alter table registros add column if not exists client_uuid uuid;
alter table registros add column if not exists pesada_en   timestamptz;
create unique index if not exists registros_client_uuid_key on registros (client_uuid);

-- Pesadas sueltas de la báscula. En el mismo día, las pesadas de un
-- agricultor (misma campaña y ciclo) se SUMAN en un único registro; aquí
-- queda cada pesada, ligada a ese registro, para no duplicar reenvíos sin
-- red, listarlas en la tablet y poder anular una sola.
-- En una base de datos existente, la migración correspondiente (se guarda
-- fuera del repositorio) junta además los registros que ya estaban repetidos.
create table if not exists bascula_pesadas (
  id            bigint generated always as identity primary key,
  client_uuid   uuid        not null unique,
  registro_id   bigint      not null references registros(id) on delete cascade,
  agricultor_id bigint      not null references agricultores(id) on delete cascade,
  campana_id    bigint      references campanas(id),
  ciclo         text,
  cajas         integer     not null default 0,
  vacias        integer     not null default 0,
  pesada_en     timestamptz not null,
  created_at    timestamptz not null default now()
);
create index if not exists bascula_pesadas_registro_idx on bascula_pesadas (registro_id);
create index if not exists bascula_pesadas_pesada_idx   on bascula_pesadas (pesada_en);

-- Las pesadas de antes: cada registro de la báscula era una pesada.
insert into bascula_pesadas (client_uuid, registro_id, agricultor_id, campana_id, ciclo,
                             cajas, vacias, pesada_en, created_at)
select r.client_uuid, r.id, r.agricultor_id, r.campana_id, r.ciclo,
       coalesce(r.cajas_entradas, 0), coalesce(r.cajas_vacias_retiradas, 0),
       coalesce(r.pesada_en, r.created_at), r.created_at
from registros r
where r.origen = 'bascula' and r.client_uuid is not null
on conflict (client_uuid) do nothing;

-- 13) Seguridad a nivel de fila (RLS)
--    Activamos RLS y SOLO permitimos acceso a usuarios que han iniciado
--    sesión (rol "authenticated"). El rol "anon" (sin login) queda
--    bloqueado: alguien con la URL ve la web, pero no puede leer ni
--    escribir datos sin usuario y contraseña.
--    Todos los usuarios autenticados comparten los mismos datos, salvo
--    los usuarios de báscula, que no tienen acceso directo a ninguna tabla.
--    Se aplica igual a todas las tablas, incluidas las nuevas.
do $$
declare t text;
begin
  foreach t in array array[
    'agricultores', 'registros', 'campanas', 'retiradas_plantas',
    'palets', 'palet_lineas', 'camara_entradas', 'liquidaciones',
    'liquidacion_lineas', 'parametros', 'bascula_pesadas'
  ]::text[]
  loop
    execute format('alter table %I enable row level security', t);
    -- Quitamos la política previa para poder ejecutar este archivo las
    -- veces que haga falta sin que dé error.
    execute format('drop policy if exists "acceso_autenticados_%s" on %I', t, t);
    execute format(
      'create policy "acceso_autenticados_%s" on %I for all to authenticated '
      'using ((select not public.es_bascula())) with check ((select not public.es_bascula()))',
      t, t);
    -- RLS decide QUÉ filas ve cada rol, pero el rol necesita además
    -- permiso sobre la tabla. Acceso completo a los usuarios con sesión y
    -- nada en absoluto al rol anónimo (sin login).
    execute format('grant select, insert, update, delete on table %I to authenticated', t);
    execute format('revoke all on table %I from anon', t);
  end loop;
end $$;

-- La vista de saldos de la cámara: solo lectura y solo con sesión. Al ser
-- security_invoker, el usuario de la báscula no ve nada a través de ella.
grant select on camara_saldos to authenticated;
revoke all on camara_saldos from anon;

-- Políticas antiguas con otro nombre (versiones anteriores del esquema).
drop policy if exists "acceso_anon_ventas"         on registros;
drop policy if exists "acceso_autenticados_ventas" on registros;

-- 14) FUNCIONES DE LA BÁSCULA
--     Lo único que puede hacer la tablet de la báscula (bascula.html).
--     Son "security definer": se ejecutan con permisos del dueño, así que
--     validan aquí mismo todo lo que reciben. Las puede usar cualquier
--     usuario con sesión (también los de la oficina), nunca el anónimo.
--     La fecha del registro es el día (hora de Madrid) en que se pesó.

-- Versiones anteriores con otros parámetros o columnas: hay que borrarlas
-- porque "create or replace" no puede cambiarlas.
drop function if exists public.bascula_registrar(bigint, bigint, text, integer);
drop function if exists public.bascula_registrar(uuid, bigint, bigint, text, integer, timestamptz);
drop function if exists public.bascula_hoy();

-- Agricultores para elegir, con el último ciclo que se le apuntó en la
-- campaña indicada (para proponerlo por defecto).
create or replace function public.bascula_agricultores(p_campana_id bigint default null)
returns table (id bigint, nombre text, codigo integer, ultimo_ciclo text)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.nombre, a.codigo,
         (select r.ciclo from registros r
           where r.agricultor_id = a.id
             and r.ciclo is not null
             and (p_campana_id is null or r.campana_id = p_campana_id)
           order by r.fecha desc nulls last, r.id desc
           limit 1)
  from agricultores a
  where auth.uid() is not null
  order by a.nombre;
$$;

create or replace function public.bascula_campanas()
returns table (id bigint, nombre text)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.nombre from campanas c
  where auth.uid() is not null
  order by c.id desc;
$$;

-- Apunta una pesada y la SUMA al registro del día de ese agricultor
-- (misma campaña y ciclo, de la báscula y sin liquidar); si no hay, lo
-- crea. Se puede llamar varias veces con el mismo p_client_uuid
-- (reintentos sin red): solo la primera suma, las demás devuelven el id
-- del registro. Devuelve el id del registro del día.
create or replace function public.bascula_registrar(
  p_client_uuid   uuid,
  p_agricultor_id bigint,
  p_campana_id    bigint,
  p_ciclo         text,
  p_cajas         integer,
  p_pesada_en     timestamptz,
  p_vacias        integer default 0
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_registro   bigint;
  v_campana_id bigint;
  v_fecha      date;
begin
  if auth.uid() is null then
    raise exception 'Sesión no iniciada';
  end if;
  if p_client_uuid is null then
    raise exception 'Falta el identificador de la entrada';
  end if;

  -- Un solo envío de cada pesada a la vez (dos reintentos simultáneos).
  perform pg_advisory_xact_lock(hashtext('bascula_pesada:' || p_client_uuid::text));

  select registro_id into v_registro from bascula_pesadas where client_uuid = p_client_uuid;
  if found then
    return v_registro;
  end if;
  -- Pesada enviada con la versión anterior (un registro por pesada).
  select id into v_registro from registros where client_uuid = p_client_uuid;
  if found then
    return v_registro;
  end if;

  if p_ciclo is null or p_ciclo not in ('1', '2', '3') then
    raise exception 'Ciclo no válido';
  end if;
  if p_cajas is null or p_cajas < 0 or p_cajas > 5000 then
    raise exception 'Número de cajas no válido';
  end if;
  if p_vacias is null or p_vacias < 0 or p_vacias > 5000 then
    raise exception 'Número de cajas vacías no válido';
  end if;
  if p_cajas = 0 and p_vacias = 0 then
    raise exception 'Indica las cajas que entran o las vacías que se lleva';
  end if;
  -- Unos minutos de margen por si el reloj de la tablet va adelantado;
  -- y como mucho una semana de retraso sin red.
  if p_pesada_en is null
     or p_pesada_en > now() + interval '10 minutes'
     or p_pesada_en < now() - interval '7 days' then
    raise exception 'Fecha de la pesada no válida (revisa la hora de la tablet)';
  end if;
  if not exists (select 1 from agricultores where id = p_agricultor_id) then
    raise exception 'Agricultor no encontrado';
  end if;
  -- Nada va sin campaña. Una entrada que se quedó en la tablet sin campaña
  -- (versiones anteriores) va a la más reciente, la misma que propone la báscula.
  v_campana_id := coalesce(p_campana_id, (select max(id) from campanas));
  if v_campana_id is null
     or not exists (select 1 from campanas where id = v_campana_id) then
    raise exception 'Campaña no encontrada';
  end if;

  -- least(): nunca un día futuro aunque el reloj de la tablet se adelante.
  v_fecha := least((p_pesada_en at time zone 'Europe/Madrid')::date,
                   (now() at time zone 'Europe/Madrid')::date);

  -- Dos tablets pesando al mismo agricultor a la vez no pueden crear dos
  -- registros del mismo día.
  perform pg_advisory_xact_lock(hashtext(format('bascula_dia:%s:%s:%s:%s',
    p_agricultor_id, v_campana_id, v_fecha, p_ciclo)));

  select id into v_registro from registros
  where agricultor_id = p_agricultor_id
    and campana_id = v_campana_id
    and fecha = v_fecha
    and ciclo = p_ciclo
    and origen = 'bascula'
    and liquidacion_id is null
  order by id
  limit 1
  for update;

  if found then
    -- El aumento de cajas_entradas se paletiza solo (trigger registros_paletizar).
    update registros set
      cajas_entradas         = coalesce(cajas_entradas, 0) + p_cajas,
      cajas_vacias_retiradas = coalesce(cajas_vacias_retiradas, 0) + p_vacias,
      pesada_en              = greatest(coalesce(pesada_en, p_pesada_en), p_pesada_en)
    where id = v_registro;
  else
    insert into registros (agricultor_id, campana_id, fecha, ciclo, cajas_entradas,
                           cajas_vacias_retiradas, origen, pesada_en)
    values (p_agricultor_id, v_campana_id, v_fecha, p_ciclo, p_cajas, p_vacias,
            'bascula', p_pesada_en)
    returning id into v_registro;
  end if;

  insert into bascula_pesadas (client_uuid, registro_id, agricultor_id, campana_id, ciclo,
                               cajas, vacias, pesada_en)
  values (p_client_uuid, v_registro, p_agricultor_id, v_campana_id, p_ciclo,
          p_cajas, p_vacias, p_pesada_en);

  return v_registro;
end;
$$;

-- Pesadas de hoy en la báscula (las más recientes primero). Una línea por
-- pesada, aunque en la oficina se vea un único registro del día.
create or replace function public.bascula_hoy()
returns table (id bigint, client_uuid uuid, creado timestamptz, agricultor_id bigint,
               nombre text, codigo integer, campana text, ciclo text, cajas integer,
               vacias integer, liquidado boolean)
language sql
stable
security definer
set search_path = public
as $$
  select bp.id, bp.client_uuid, bp.pesada_en, a.id, a.nombre, a.codigo, c.nombre,
         bp.ciclo, bp.cajas, bp.vacias, r.liquidacion_id is not null
  from bascula_pesadas bp
  join registros r on r.id = bp.registro_id
  join agricultores a on a.id = bp.agricultor_id
  left join campanas c on c.id = bp.campana_id
  where auth.uid() is not null
    and r.fecha = (now() at time zone 'Europe/Madrid')::date
  order by bp.pesada_en desc, bp.id desc;
$$;

-- Nombre del emisor (Ajustes), para la cabecera del justificante impreso.
create or replace function public.bascula_emisor()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select valor from parametros
  where clave = 'emisor_nombre' and auth.uid() is not null;
$$;

-- Anula UNA pesada de hoy (p_id = id de bascula_pesadas): se resta del
-- registro del día y, si se queda sin cajas ni vacías, el registro se
-- borra. Solo lo de hoy y sin liquidar; lo anterior se corrige desde la
-- oficina.
create or replace function public.bascula_anular(p_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  bp bascula_pesadas%rowtype;
  r  registros%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sesión no iniciada';
  end if;

  select * into bp from bascula_pesadas where id = p_id;
  if not found then return false; end if;

  select * into r from registros
  where id = bp.registro_id
    and origen = 'bascula'
    and liquidacion_id is null
    and fecha = (now() at time zone 'Europe/Madrid')::date
  for update;
  if not found then return false; end if;

  delete from bascula_pesadas where id = bp.id;

  if not exists (select 1 from bascula_pesadas where registro_id = r.id) then
    delete from registros where id = r.id;
  else
    -- Si la oficina ya bajó las cajas a mano, no se queda en negativo.
    update registros set
      cajas_entradas         = greatest(coalesce(cajas_entradas, 0) - bp.cajas, 0),
      cajas_vacias_retiradas = greatest(coalesce(cajas_vacias_retiradas, 0) - bp.vacias, 0),
      pesada_en              = (select max(pesada_en) from bascula_pesadas where registro_id = r.id)
    where id = r.id;
  end if;
  return true;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'bascula_agricultores(bigint)', 'bascula_campanas()',
    'bascula_registrar(uuid, bigint, bigint, text, integer, timestamptz, integer)',
    'bascula_hoy()', 'bascula_anular(bigint)', 'bascula_emisor()'
  ]::text[]
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- 15) CAMPAÑA Y CICLO OBLIGATORIOS
--    Ningún registro, retirada de plantas ni liquidación puede quedar sin
--    campaña, y registros y retiradas siempre llevan ciclo 1, 2 o 3.
--    Consecuencia: una campaña que todavía se usa no se puede borrar (el
--    "on delete set null" de la clave foránea chocaría con esta regla).
--
--    Se añaden "not valid": se aplican a todo lo que se cree o modifique a
--    partir de ahora, sin fallar si quedan datos antiguos. La migración de la
--    campaña 26/27 (se guarda fuera del repositorio) arregla esos datos y
--    las valida contra todo. Ejecútala ANTES que este archivo: si no, los
--    datos antiguos sin campaña no se podrán editar ni liquidar.
do $$ begin
  alter table registros add constraint registros_campana_obligatoria
    check (campana_id is not null) not valid;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table registros add constraint registros_ciclo_valido
    check (ciclo is not null and ciclo in ('1', '2', '3')) not valid;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table retiradas_plantas add constraint retiradas_campana_obligatoria
    check (campana_id is not null) not valid;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table retiradas_plantas add constraint retiradas_ciclo_valido
    check (ciclo is not null and ciclo in ('1', '2', '3')) not valid;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table liquidaciones add constraint liquidaciones_campana_obligatoria
    check (campana_id is not null) not valid;
exception when duplicate_object then null;
end $$;

-- 16) PALETIZACIÓN AUTOMÁTICA Y ALBARANES DE SALIDA
--     Todas las cajas que pasan por la báscula van a la cámara y, al pesar,
--     se reparten solas en palets de 60 (cajas_por_palet). Las que aún no
--     forman un palet completo están "en cámara". Los palets salen con un
--     albarán de salida. La migración correspondiente (fuera del
--     repositorio) lleva este mismo código.

-- ---------------------------------------------------------------------
-- 1) Ajustes
-- ---------------------------------------------------------------------
insert into parametros (clave, valor) values
  ('cajas_por_palet',  '60'),
  ('serie_palet',      'P'),
  ('serie_albaran',    'ALB'),
  -- «FECHA DE INICIO» (formato AAAA-MM-DD):
  ('paletizado_desde', to_char((now() at time zone 'Europe/Madrid')::date, 'YYYY-MM-DD'))
on conflict (clave) do nothing;

-- Si la fecha se guardó vacía (p. ej. desde Ajustes antes de esta
-- migración) se pone la de hoy: vacía significaría paletizar TODAS las
-- pesadas de la historia.
update parametros
set valor = to_char((now() at time zone 'Europe/Madrid')::date, 'YYYY-MM-DD')
where clave = 'paletizado_desde' and coalesce(trim(valor), '') = '';

create or replace function public.cajas_por_palet()
returns integer
language sql
stable
as $$
  select coalesce(
    (select nullif(trim(valor), '')::integer from parametros where clave = 'cajas_por_palet'),
    60);
$$;

create or replace function public.paletizado_desde()
returns date
language sql
stable
as $$
  select nullif(trim(valor), '')::date from parametros where clave = 'paletizado_desde';
$$;

-- Número de documento: serie, guion y secuencia rellena con ceros
-- (P-000123, ALB-0001). Si la secuencia tiene más cifras que el ancho
-- se escribe entera: lpad() a secas la RECORTARÍA (el palet 1.000.000
-- saldría P-100000 y chocaría con el que ya existe).
create or replace function public.numero_documento(p_serie text, p_sec integer, p_ancho integer)
returns text
language sql
immutable
as $$
  select p_serie || '-' || lpad(p_sec::text, greatest(p_ancho, length(p_sec::text)), '0');
$$;

-- ---------------------------------------------------------------------
-- 2) Albaranes de salida
-- ---------------------------------------------------------------------
create table if not exists albaranes_salida (
  id                     bigint generated always as identity primary key,
  secuencia              integer     unique,
  numero                 text        unique,   -- p. ej. ALB-0001
  fecha                  date        not null,
  destinatario_nombre    text        not null,
  destinatario_nif       text,
  destinatario_direccion text,
  matricula              text,
  transportista          text,
  observaciones          text,
  created_at             timestamptz not null default now()
);

-- Datos de la carta de porte (CMR) que se escriben en cada salida. Los
-- fijos (remitente, porteador) están en Ajustes.
alter table albaranes_salida add column if not exists matricula_remolque text;   -- casilla 16
alter table albaranes_salida add column if not exists lugar_entrega      text;   -- 3
alter table albaranes_salida add column if not exists lugar_carga        text;   -- 4 y 21
alter table albaranes_salida add column if not exists documentos_anexos  text;   -- 5
alter table albaranes_salida add column if not exists marcas             text;   -- 6
alter table albaranes_salida add column if not exists embalaje           text;   -- 8
alter table albaranes_salida add column if not exists naturaleza         text;   -- 9
alter table albaranes_salida add column if not exists peso_bruto_kg      numeric(12,2); -- 11
alter table albaranes_salida add column if not exists temperatura        numeric(5,1);  -- 13

alter table albaranes_salida enable row level security;
drop policy if exists "acceso_autenticados_albaranes_salida" on albaranes_salida;
create policy "acceso_autenticados_albaranes_salida" on albaranes_salida
  for all to authenticated
  using ((select not public.es_bascula())) with check ((select not public.es_bascula()));
grant select, insert, update, delete on table albaranes_salida to authenticated;
revoke all on table albaranes_salida from anon;

-- ---------------------------------------------------------------------
-- 3) Palets ligados a las pesadas
-- ---------------------------------------------------------------------
alter table palets add column if not exists fecha_completo date;   -- cuándo llegó a 60
alter table palets add column if not exists albaran_id bigint
  references albaranes_salida(id) on delete set null;
create index if not exists palets_albaran_idx on palets (albaran_id);

alter table palet_lineas add column if not exists registro_id bigint
  references registros(id) on delete cascade;
create index if not exists palet_lineas_registro_idx on palet_lineas (registro_id);
create unique index if not exists palet_lineas_palet_registro_key
  on palet_lineas (palet_id, registro_id) where registro_id is not null;

-- Total del palet y fecha de llenado: cuando llega a las cajas por palet
-- se le pone la fecha de la última pesada que entró; si después baja (se
-- corrige una pesada), vuelve a estar "en formación". Los palets ya
-- salidos no cambian.
create or replace function public.palet_actualizar_total(p_palet_id bigint)
returns void
language sql
as $$
  update palets p
  set num_cajas = t.total,
      fecha_completo = case
        when p.fecha_salida is not null then p.fecha_completo
        when t.total >= public.cajas_por_palet()
          then coalesce(p.fecha_completo, t.ultima, (now() at time zone 'Europe/Madrid')::date)
        else null
      end
  from (
    select coalesce(sum(l.num_cajas), 0)::integer as total, max(r.fecha) as ultima
    from palet_lineas l
    left join registros r on r.id = l.registro_id
    where l.palet_id = p_palet_id
  ) t
  where p.id = p_palet_id;
$$;

-- ---------------------------------------------------------------------
-- 4) Reparto automático
-- ---------------------------------------------------------------------
-- Mete en palets las cajas de una pesada que todavía no tienen palet
-- (como mucho p_max, si se indica). Rellena primero el palet abierto más
-- antiguo de su campaña y, si no cabe, abre palets nuevos.
create or replace function public.paletizar_registro(p_registro_id bigint, p_max integer default null)
returns void
language plpgsql
set search_path = public
as $$
declare
  r           registros%rowtype;
  v_cap       integer := public.cajas_por_palet();
  v_desde     date    := public.paletizado_desde();
  v_pendiente integer;
  v_palet     palets%rowtype;
  v_poner     integer;
  v_sec       integer;
  v_serie     text;
begin
  -- Un solo reparto a la vez: dos pesadas simultáneas no pueden llenar el
  -- mismo hueco del palet abierto.
  perform pg_advisory_xact_lock(hashtext('agrobimi_paletizar'));

  select * into r from registros where id = p_registro_id;
  if not found or r.fecha is null then return; end if;
  if v_desde is not null and r.fecha < v_desde then return; end if;

  v_pendiente := coalesce(r.cajas_entradas, 0)
    - coalesce((select sum(num_cajas) from palet_lineas where registro_id = r.id), 0);
  if p_max is not null then v_pendiente := least(v_pendiente, p_max); end if;

  while v_pendiente > 0 loop
    select * into v_palet from palets p
    where p.fecha_salida is null
      and p.num_cajas < v_cap
      and p.campana_id is not distinct from r.campana_id
      -- Los palets de la versión anterior (sin pesadas) no se rellenan.
      and (v_desde is null or (p.created_at at time zone 'Europe/Madrid')::date >= v_desde)
    order by p.secuencia nulls last, p.id
    limit 1
    for update;

    if not found then
      select coalesce(max(secuencia), 0) + 1 into v_sec from palets;
      v_serie := coalesce((select nullif(trim(valor), '') from parametros where clave = 'serie_palet'), 'P');
      insert into palets (secuencia, codigo, campana_id, fecha, num_cajas)
      values (v_sec, public.numero_documento(v_serie, v_sec, 6), r.campana_id, r.fecha, 0)
      returning * into v_palet;
    end if;

    v_poner := least(v_pendiente, v_cap - v_palet.num_cajas);

    update palet_lineas set num_cajas = num_cajas + v_poner
    where palet_id = v_palet.id and registro_id = r.id;
    if not found then
      insert into palet_lineas (palet_id, agricultor_id, registro_id, num_cajas)
      values (v_palet.id, r.agricultor_id, r.id, v_poner);
    end if;

    v_pendiente := v_pendiente - v_poner;
  end loop;
end;
$$;

-- Al apuntar una pesada se paletiza. Al corregirla:
--   - más cajas: las nuevas se paletizan;
--   - menos cajas: se quitan de sus palets sin salida, del más reciente al
--     más antiguo (si ya salieron, no se deja corregir);
--   - otro agricultor: sus líneas de palet pasan al nuevo agricultor.
create or replace function public.registros_paletizar_trg()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_exceso integer;
  v_linea  record;
  v_quita  integer;
begin
  if tg_op = 'INSERT' then
    perform public.paletizar_registro(new.id);
    return null;
  end if;

  if new.agricultor_id is distinct from old.agricultor_id then
    update palet_lineas set agricultor_id = new.agricultor_id where registro_id = new.id;
  end if;

  v_exceso := coalesce((select sum(num_cajas) from palet_lineas where registro_id = new.id), 0)
            - coalesce(new.cajas_entradas, 0);

  for v_linea in
    select l.id, l.num_cajas
    from palet_lineas l join palets p on p.id = l.palet_id
    where l.registro_id = new.id and p.fecha_salida is null
    order by p.secuencia desc nulls first, l.id desc
  loop
    exit when v_exceso <= 0;
    v_quita := least(v_exceso, v_linea.num_cajas);
    if v_quita = v_linea.num_cajas then
      delete from palet_lineas where id = v_linea.id;
    else
      update palet_lineas set num_cajas = num_cajas - v_quita where id = v_linea.id;
    end if;
    v_exceso := v_exceso - v_quita;
  end loop;

  if v_exceso > 0 then
    raise exception 'No se puede: % cajas de esta entrada ya han salido en un palet. Anula antes el albarán de salida.', v_exceso;
  end if;

  if coalesce(new.cajas_entradas, 0) > coalesce(old.cajas_entradas, 0) then
    perform public.paletizar_registro(new.id, new.cajas_entradas - coalesce(old.cajas_entradas, 0));
  end if;
  return null;
end;
$$;

drop trigger if exists registros_paletizar on registros;
create trigger registros_paletizar
  after insert or update of cajas_entradas, agricultor_id on registros
  for each row execute function public.registros_paletizar_trg();

-- No se puede borrar una pesada cuyas cajas ya salieron en un palet.
create or replace function public.registros_borrar_paletizado_trg()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from palet_lineas l join palets p on p.id = l.palet_id
             where l.registro_id = old.id and p.fecha_salida is not null) then
    raise exception 'No se puede borrar: las cajas de esta entrada ya han salido en un palet. Anula antes el albarán de salida.';
  end if;
  return old;
end;
$$;

drop trigger if exists registros_borrar_paletizado on registros;
create trigger registros_borrar_paletizado
  before delete on registros
  for each row execute function public.registros_borrar_paletizado_trg();

-- ---------------------------------------------------------------------
-- Edición manual de un palet (oficina)
-- ---------------------------------------------------------------------
-- p_lineas: [{"registro_id": 12, "num_cajas": 10}, ...] con lo que debe
-- llevar el palet. Las cajas salen primero de lo que esa pesada tenga sin
-- palet y, si no llega, de otros palets suyos todavía en formación (sin
-- completar ni salida). Los palets completos o salidos no se tocan.
-- Con p_palet_id null se crea un palet nuevo con esas cajas (todo o nada:
-- si algo falla no queda un palet vacío). Devuelve el id del palet.
drop function if exists public.palet_guardar_lineas(bigint, jsonb);
create or replace function public.palet_guardar_lineas(p_palet_id bigint, p_lineas jsonb)
returns bigint
language plpgsql
set search_path = public
as $$
declare
  v_cap   integer := public.cajas_por_palet();
  v_palet palets%rowtype;
  v_item  record;
  v_libre integer;
  v_falta integer;
  v_linea record;
  v_quita integer;
  v_total integer;
  v_id    bigint := p_palet_id;
  v_sec   integer;
  v_serie text;
begin
  perform pg_advisory_xact_lock(hashtext('agrobimi_paletizar'));

  if v_id is null then
    if not exists (select 1 from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) x
                   where (x->>'num_cajas')::integer > 0) then
      raise exception 'Indica las cajas que lleva el palet.';
    end if;
    select coalesce(max(secuencia), 0) + 1 into v_sec from palets;
    v_serie := coalesce((select nullif(trim(valor), '') from parametros where clave = 'serie_palet'), 'P');
    insert into palets (secuencia, codigo, campana_id, fecha, num_cajas)
    values (v_sec, public.numero_documento(v_serie, v_sec, 6),
            -- La campaña de la primera pesada que lleva.
            (select r.campana_id from registros r
              where r.id = (p_lineas->0->>'registro_id')::bigint),
            (now() at time zone 'Europe/Madrid')::date, 0)
    returning id into v_id;
  end if;

  select * into v_palet from palets where id = v_id for update;
  if not found then
    raise exception 'Palet no encontrado';
  end if;
  if v_palet.fecha_salida is not null then
    raise exception 'Ese palet ya ha salido: no se puede cambiar.';
  end if;

  delete from palet_lineas where palet_id = v_id and registro_id is not null;

  for v_item in
    select (x->>'registro_id')::bigint as registro_id, (x->>'num_cajas')::integer as n
    from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) x
  loop
    continue when v_item.n is null or v_item.n <= 0;

    select coalesce(r.cajas_entradas, 0)
         - coalesce((select sum(num_cajas) from palet_lineas where registro_id = r.id), 0)
    into v_libre
    from registros r where r.id = v_item.registro_id;
    if v_libre is null then
      raise exception 'Entrada % no encontrada', v_item.registro_id;
    end if;

    v_falta := v_item.n - v_libre;
    for v_linea in
      select l.id, l.num_cajas
      from palet_lineas l join palets p on p.id = l.palet_id
      where l.registro_id = v_item.registro_id
        and p.fecha_salida is null and p.num_cajas < v_cap
      order by p.secuencia desc nulls first, l.id desc
    loop
      exit when v_falta <= 0;
      v_quita := least(v_falta, v_linea.num_cajas);
      if v_quita = v_linea.num_cajas then
        delete from palet_lineas where id = v_linea.id;
      else
        update palet_lineas set num_cajas = num_cajas - v_quita where id = v_linea.id;
      end if;
      v_falta := v_falta - v_quita;
    end loop;
    if v_falta > 0 then
      raise exception 'Una de las entradas no tiene tantas cajas en cámara (faltan %).', v_falta;
    end if;

    insert into palet_lineas (palet_id, agricultor_id, registro_id, num_cajas)
    select v_id, r.agricultor_id, r.id, v_item.n from registros r where r.id = v_item.registro_id;
  end loop;

  select coalesce(sum(num_cajas), 0) into v_total from palet_lineas where palet_id = v_id;
  if v_total > v_cap then
    raise exception 'Un palet lleva como mucho % cajas (este tendría %).', v_cap, v_total;
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Albarán de salida: se crea y se da salida a sus palets a la vez
-- ---------------------------------------------------------------------
-- Además, la fecha de salida pasa a la Fecha (CMR) de las pesadas que van
-- en esos palets.
create or replace function public.albaran_crear(p_datos jsonb, p_palets bigint[])
returns bigint
language plpgsql
set search_path = public
as $$
declare
  v_id    bigint;
  v_sec   integer;
  v_serie text;
  v_fecha date := (p_datos->>'fecha')::date;
  v_n     integer;
begin
  if coalesce(array_length(p_palets, 1), 0) = 0 then
    raise exception 'Elige al menos un palet.';
  end if;
  if v_fecha is null or v_fecha > (now() at time zone 'Europe/Madrid')::date then
    raise exception 'Fecha de salida no válida.';
  end if;
  if coalesce(trim(p_datos->>'destinatario_nombre'), '') = '' then
    raise exception 'Indica el destinatario.';
  end if;

  perform 1 from palets where id = any(p_palets) for update;
  select count(*) into v_n from palets
  where id = any(p_palets) and fecha_salida is null and num_cajas > 0;
  if v_n <> array_length(p_palets, 1) then
    raise exception 'Algún palet ya tiene salida o está vacío. Recarga la lista.';
  end if;

  select coalesce(max(secuencia), 0) + 1 into v_sec from albaranes_salida;
  v_serie := coalesce((select nullif(trim(valor), '') from parametros where clave = 'serie_albaran'), 'ALB');

  insert into albaranes_salida (secuencia, numero, fecha, destinatario_nombre, destinatario_nif,
                                destinatario_direccion, matricula, matricula_remolque,
                                transportista, observaciones, lugar_entrega, lugar_carga,
                                documentos_anexos, marcas, embalaje, naturaleza,
                                peso_bruto_kg, temperatura)
  values (v_sec, public.numero_documento(v_serie, v_sec, 4), v_fecha,
          trim(p_datos->>'destinatario_nombre'),
          nullif(trim(p_datos->>'destinatario_nif'), ''),
          nullif(trim(p_datos->>'destinatario_direccion'), ''),
          nullif(trim(p_datos->>'matricula'), ''),
          nullif(trim(p_datos->>'matricula_remolque'), ''),
          nullif(trim(p_datos->>'transportista'), ''),
          nullif(trim(p_datos->>'observaciones'), ''),
          nullif(trim(p_datos->>'lugar_entrega'), ''),
          nullif(trim(p_datos->>'lugar_carga'), ''),
          nullif(trim(p_datos->>'documentos_anexos'), ''),
          nullif(trim(p_datos->>'marcas'), ''),
          nullif(trim(p_datos->>'embalaje'), ''),
          nullif(trim(p_datos->>'naturaleza'), ''),
          nullif(trim(p_datos->>'peso_bruto_kg'), '')::numeric,
          nullif(trim(p_datos->>'temperatura'), '')::numeric)
  returning id into v_id;

  update palets set fecha_salida = v_fecha, albaran_id = v_id where id = any(p_palets);

  update registros set fecha_cmr = v_fecha
  where id in (select registro_id from palet_lineas
               where palet_id = any(p_palets) and registro_id is not null);
  return v_id;
end;
$$;

-- Anular un albarán: sus palets vuelven a la cámara y sus pesadas
-- recuperan la Fecha (CMR) de otra salida suya, si la hay (o se queda vacía).
create or replace function public.albaran_anular(p_id bigint)
returns void
language plpgsql
set search_path = public
as $$
begin
  update registros r
  set fecha_cmr = (
    select max(p.fecha_salida)
    from palet_lineas l join palets p on p.id = l.palet_id
    where l.registro_id = r.id and p.albaran_id is distinct from p_id and p.fecha_salida is not null)
  where r.id in (select l.registro_id from palet_lineas l join palets p on p.id = l.palet_id
                 where p.albaran_id = p_id and l.registro_id is not null);

  update palets set fecha_salida = null, albaran_id = null where albaran_id = p_id;
  delete from albaranes_salida where id = p_id;
  -- Al volver, cada palet recalcula si está completo o en formación.
  perform public.palet_actualizar_total(id) from palets where albaran_id is null and fecha_salida is null;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'cajas_por_palet()', 'paletizado_desde()',
    'numero_documento(text, integer, integer)',
    'paletizar_registro(bigint, integer)',
    'palet_guardar_lineas(bigint, jsonb)',
    'albaran_crear(jsonb, bigint[])', 'albaran_anular(bigint)'
  ]::text[]
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Vista: cada pesada y dónde están sus cajas
-- ---------------------------------------------------------------------
--   en_formacion: en un palet que todavía no llega a 60 (cuentan como cámara)
--   sin_palet:    sin palet (cuentan como cámara)
--   en_completos: en palets completos esperando salida
--   salidas:      en palets que ya salieron
create or replace view paletizado_entradas with (security_invoker = true) as
select r.id as registro_id,
       r.agricultor_id,
       r.campana_id,
       r.fecha,
       coalesce(r.cajas_entradas, 0) as cajas,
       coalesce(sum(l.num_cajas) filter (where p.fecha_salida is not null), 0)::integer as salidas,
       coalesce(sum(l.num_cajas) filter (where p.fecha_salida is null and p.num_cajas >= c.cap), 0)::integer as en_completos,
       coalesce(sum(l.num_cajas) filter (where p.fecha_salida is null and p.num_cajas < c.cap), 0)::integer as en_formacion,
       (coalesce(r.cajas_entradas, 0) - coalesce(sum(l.num_cajas), 0))::integer as sin_palet
from registros r
cross join (select public.cajas_por_palet() as cap, public.paletizado_desde() as desde) c
left join palet_lineas l on l.registro_id = r.id
left join palets p on p.id = l.palet_id
where coalesce(r.cajas_entradas, 0) > 0
  and (c.desde is null or r.fecha >= c.desde)
group by r.id, c.cap;

grant select on paletizado_entradas to authenticated;
revoke all on paletizado_entradas from anon;

-- ---------------------------------------------------------------------
-- 5) Paletizar las pesadas que ya haya desde la fecha de inicio
-- ---------------------------------------------------------------------
do $$
declare v_id bigint;
begin
  for v_id in
    select id from registros
    where fecha >= coalesce(public.paletizado_desde(), fecha)
      and coalesce(cajas_entradas, 0) > 0
    order by fecha, coalesce(pesada_en, created_at), id
  loop
    perform public.paletizar_registro(v_id);
  end loop;
end $$;
