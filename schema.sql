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
    'liquidacion_lineas', 'parametros'
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

-- Apunta una entrada: cajas llenas que trae (p_cajas) y cajas vacías que
-- se lleva (p_vacias, 0 si no se indica). Se puede llamar varias veces con el mismo
-- p_client_uuid (reintentos sin red): solo la primera crea el registro, las
-- demás devuelven el id del que ya existe.
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
  nuevo_id     bigint;
  v_campana_id bigint;
begin
  if auth.uid() is null then
    raise exception 'Sesión no iniciada';
  end if;
  if p_client_uuid is null then
    raise exception 'Falta el identificador de la entrada';
  end if;

  select id into nuevo_id from registros where client_uuid = p_client_uuid;
  if found then
    return nuevo_id;
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

  insert into registros (agricultor_id, campana_id, fecha, ciclo, cajas_entradas,
                         cajas_vacias_retiradas, origen, client_uuid, pesada_en)
  values (p_agricultor_id, v_campana_id,
          -- least(): nunca un día futuro aunque el reloj de la tablet se adelante.
          least((p_pesada_en at time zone 'Europe/Madrid')::date,
                (now() at time zone 'Europe/Madrid')::date),
          p_ciclo, p_cajas, p_vacias, 'bascula', p_client_uuid, p_pesada_en)
  on conflict (client_uuid) do nothing
  returning id into nuevo_id;

  -- Dos envíos simultáneos de la misma entrada: el otro ya la insertó.
  if nuevo_id is null then
    select id into nuevo_id from registros where client_uuid = p_client_uuid;
  end if;

  return nuevo_id;
end;
$$;

-- Entradas apuntadas hoy desde la báscula (las más recientes primero).
create or replace function public.bascula_hoy()
returns table (id bigint, client_uuid uuid, creado timestamptz, agricultor_id bigint,
               nombre text, codigo integer, campana text, ciclo text, cajas integer,
               vacias integer, liquidado boolean)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.client_uuid, coalesce(r.pesada_en, r.created_at), a.id, a.nombre,
         a.codigo, c.nombre, r.ciclo, coalesce(r.cajas_entradas, 0),
         coalesce(r.cajas_vacias_retiradas, 0), r.liquidacion_id is not null
  from registros r
  join agricultores a on a.id = r.agricultor_id
  left join campanas c on c.id = r.campana_id
  where auth.uid() is not null
    and r.origen = 'bascula'
    and r.fecha = (now() at time zone 'Europe/Madrid')::date
  order by coalesce(r.pesada_en, r.created_at) desc, r.id desc;
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

-- Anula (borra) una entrada de la báscula. Solo las de hoy y que todavía
-- no estén en una liquidación; lo anterior se corrige desde la oficina.
create or replace function public.bascula_anular(p_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sesión no iniciada';
  end if;
  delete from registros
  where id = p_id
    and origen = 'bascula'
    and liquidacion_id is null
    and fecha = (now() at time zone 'Europe/Madrid')::date;
  return found;
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
--    partir de ahora, sin fallar si quedan datos antiguos. La migración
--    migraciones/2026-10-11_campana_26-27.sql arregla esos datos y las
--    valida contra todo. Ejecútala ANTES que este archivo: si no, los
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
