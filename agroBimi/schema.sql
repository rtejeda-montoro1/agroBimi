-- =====================================================================
--  ESQUEMA DE LA BASE DE DATOS
--  Gestión de Bimi
-- =====================================================================
--  Es el esquema ACTUAL: cada tabla con todas sus columnas, y todas las
--  funciones, triggers y permisos. Se ejecuta completo en el editor SQL de
--  Supabase y se puede repetir tantas veces como haga falta:
--    - una instalación nueva queda creada entera;
--    - en una base de datos ya al día no cambia ningún dato: las tablas
--      que ya existen se dejan como están y se vuelven a poner las
--      funciones, los triggers y los permisos.
--
--  Cambios en las tablas: en una base de datos que ya existe,
--  "create table if not exists" no añade columnas nuevas. Hay que
--  añadirlas en la tabla de aquí abajo Y con un
--  "alter table ... add column if not exists ..." al final de este
--  archivo, que puede quitarse cuando todas las bases de datos lo tengan.
--  Los arreglos de datos (pasar datos antiguos al formato nuevo) no van
--  aquí: van en un script de migración aparte (ver README).
--
--  Bases de datos anteriores a noviembre de 2026: este archivo ya no
--  lleva las migraciones de entonces (columnas añadidas una a una, palets
--  de un solo agricultor, cartas de porte, pesadas antiguas...). Para
--  ponerlas al día, ejecutar antes el schema.sql del commit 4d8ce36.
-- =====================================================================


-- =====================================================================
--  TABLAS
-- =====================================================================

-- 1) AGRICULTORES
--    Lo único obligatorio es el nombre. El "codigo" es un número único de
--    3 dígitos que asigna la app al crear el agricultor; no se edita.
--    Los datos fiscales (nif ... iban) son opcionales: hacen falta para
--    emitir recibos completos.
create table if not exists agricultores (
  id            bigint generated always as identity primary key,
  nombre        text          not null,
  codigo        integer       unique,
  created_at    timestamptz   not null default now(),
  nif           text,
  direccion     text,
  codigo_postal text,
  poblacion     text,
  provincia     text,
  telefono      text,
  email         text,
  iban          text
);

create index if not exists agricultores_nombre_idx on agricultores (nombre);

-- 2) CAMPAÑAS
--    Todo registro, retirada de plantas y liquidación pertenece a una
--    campaña (ver sección 15). No puede haber dos con el mismo nombre (sin
--    distinguir mayúsculas ni espacios sobrantes): la validación de la app
--    es solo de UX, esta es la red de seguridad real.
create table if not exists campanas (
  id         bigint generated always as identity primary key,
  nombre     text          not null,
  created_at timestamptz   not null default now()
);

create unique index if not exists campanas_nombre_unico
  on campanas (lower(trim(nombre)));

-- 3) LIQUIDACIONES
--    Una liquidación agrupa los registros de un agricultor en un rango de
--    fechas, les pone precio y calcula el total. Al facturarla se le asigna
--    un nº de factura, que además se copia al campo num_factura de cada
--    registro incluido (así sigue funcionando la agrupación de la tabla).
--    retencion: IRPF del recibo de compensación (sobre base + IVA).
--    factura_agricultor: la factura la trae el agricultor; num_factura y
--    fecha_factura son las de SU factura (escritas a mano) y no se gasta
--    número de la serie (factura_secuencia queda vacía).
create table if not exists liquidaciones (
  id                   bigint generated always as identity primary key,
  secuencia            integer     unique,   -- contador interno para numerar
  numero               text        unique,   -- p. ej. LIQ-0001
  agricultor_id        bigint      not null references agricultores(id) on delete cascade,
  campana_id           bigint      references campanas(id) on delete set null,
  fecha                date        not null, -- fecha de la liquidación
  fecha_desde          date        not null, -- periodo liquidado
  fecha_hasta          date        not null,
  estado               text        not null default 'borrador',
  precio_caja          numeric(12,4),
  precio_caja_perdida  numeric(12,4),
  iva_porcentaje       numeric(5,2),
  base                 numeric(12,2),
  iva                  numeric(12,2),
  total                numeric(12,2),
  factura_secuencia    integer     unique,
  num_factura          text,
  fecha_factura        date,
  observaciones        text,
  created_at           timestamptz not null default now(),
  retencion_porcentaje numeric(5,2),
  retencion            numeric(12,2),
  factura_agricultor   boolean     not null default false,
  constraint liquidaciones_estado_check
    check (estado in ('borrador', 'cerrada', 'facturada')),
  constraint liquidaciones_campana_obligatoria
    check (campana_id is not null)
);

create index if not exists liquidaciones_agricultor_idx on liquidaciones (agricultor_id);
create index if not exists liquidaciones_fecha_idx      on liquidaciones (fecha);
create index if not exists liquidaciones_periodo_idx    on liquidaciones (fecha_desde, fecha_hasta);

-- 4) REGISTROS
--    Cada registro pertenece a un agricultor. Salvo el agricultor, la
--    campaña y el ciclo (obligatorios, ver sección 15), todos los campos son
--    opcionales: se pueden dejar en blanco, editar o eliminar.
--    Cajas vacías: el agricultor se lleva vacías (cajas_vacias_retiradas)
--    y las devuelve llenas (cajas_entradas) o sin usar
--    (cajas_vacias_devueltas). Descuadre = retiradas − llenas − vacías.
--    liquidacion_id: marca el registro como ya liquidado para que no entre
--    en otra liquidación.
--    De la báscula: origen = 'bascula' (null = apuntado en la oficina);
--    client_uuid, el identificador que genera la tablet (si la red falla
--    y reenvía, el servidor sabe que ya lo tenía); pesada_en, cuándo se
--    pesó (no cuándo llegó al servidor, que puede ser horas después).
create table if not exists registros (
  id                     bigint  generated always as identity primary key,
  agricultor_id          bigint  not null references agricultores(id) on delete cascade,
  fecha                  date,                       -- Fecha
  ciclo                  text,                       -- Ciclo
  cajas_entradas         integer,                    -- Nº Cajas Entradas
  fecha_cmr              date,                       -- Fecha (CMR)
  cajas_salidas          integer,                    -- Nº Cajas Salidas
  descuento_cajas        integer,                    -- Descuento Cajas
  num_factura            text,                       -- Nº Factura
  cajas_vacias_retiradas integer,                    -- Cajas Vacías retiradas
  num_plantas            integer,                    -- sin uso (ahora en retiradas_plantas)
  fecha_retirada         date,                       -- sin uso (ahora en retiradas_plantas)
  comentarios            text,                       -- Comentarios
  created_at             timestamptz not null default now(),
  campana_id             bigint  references campanas(id) on delete set null,
  cajas_vacias_devueltas integer,                    -- Cajas Vacías devueltas
  liquidacion_id         bigint  references liquidaciones(id) on delete set null,
  origen                 text,
  client_uuid            uuid,
  pesada_en              timestamptz,
  constraint registros_campana_obligatoria check (campana_id is not null),
  constraint registros_ciclo_valido check (ciclo is not null and ciclo in ('1', '2', '3'))
);

create index if not exists registros_agricultor_idx  on registros (agricultor_id);
create index if not exists registros_fecha_idx       on registros (fecha);
create index if not exists registros_campana_idx     on registros (campana_id);
create index if not exists registros_liquidacion_idx on registros (liquidacion_id);
create unique index if not exists registros_client_uuid_key on registros (client_uuid);

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
  created_at    timestamptz not null default now(),
  constraint retiradas_campana_obligatoria check (campana_id is not null),
  constraint retiradas_ciclo_valido check (ciclo is not null and ciclo in ('1', '2', '3'))
);

create index if not exists retiradas_agricultor_idx on retiradas_plantas (agricultor_id);
create index if not exists retiradas_campana_idx    on retiradas_plantas (campana_id);
create index if not exists retiradas_fecha_idx      on retiradas_plantas (fecha);

-- 6) ALBARANES DE SALIDA
--    Los palets salen de la cámara con un albarán. Lleva además los datos
--    de la carta de porte (CMR) que cambian en cada salida (el número de
--    cada columna es su casilla del CMR); los fijos (remitente, porteador)
--    están en Ajustes.
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
  created_at             timestamptz not null default now(),
  matricula_remolque     text,            -- 16
  lugar_entrega          text,            -- 3
  lugar_carga            text,            -- 4 y 21
  documentos_anexos      text,            -- 5
  marcas                 text,            -- 6
  embalaje               text,            -- 8
  naturaleza             text,            -- 9
  peso_bruto_kg          numeric(12,2),   -- 11
  temperatura            numeric(5,1)     -- 13
);

-- 7) PALETS
--    Las cajas de la báscula se reparten solas en palets (sección 16). Un
--    palet puede llevar cajas de VARIOS agricultores: cuántas de cada
--    pesada va en palet_lineas. El palet sigue en la cámara hasta que se
--    le da salida (fecha_salida, con su albarán).
create table if not exists palets (
  id             bigint generated always as identity primary key,
  secuencia      integer     unique,        -- contador interno para numerar
  codigo         text        unique,        -- p. ej. P-000123
  campana_id     bigint      references campanas(id) on delete set null,
  ciclo          text,                      -- sin uso (versiones antiguas)
  fecha          date        not null,      -- fecha de paletizado
  num_cajas      integer     not null default 0,  -- suma de sus líneas (trigger)
  fecha_salida   date,                      -- null = sigue en la cámara
  comentarios    text,
  created_at     timestamptz not null default now(),
  fecha_completo date,                      -- cuándo llegó a las cajas por palet
  albaran_id     bigint      references albaranes_salida(id) on delete set null
);

create index if not exists palets_campana_idx on palets (campana_id);
create index if not exists palets_fecha_idx   on palets (fecha);
create index if not exists palets_salida_idx  on palets (fecha_salida);
create index if not exists palets_albaran_idx on palets (albaran_id);

-- registro_id: la pesada de la que salen las cajas (null en palets de
-- versiones antiguas).
create table if not exists palet_lineas (
  id            bigint generated always as identity primary key,
  palet_id      bigint  not null references palets(id) on delete cascade,
  agricultor_id bigint  not null references agricultores(id) on delete cascade,
  num_cajas     integer not null check (num_cajas > 0),
  registro_id   bigint  references registros(id) on delete cascade
);

create index if not exists palet_lineas_palet_idx      on palet_lineas (palet_id);
create index if not exists palet_lineas_agricultor_idx on palet_lineas (agricultor_id);
create index if not exists palet_lineas_registro_idx   on palet_lineas (registro_id);
create unique index if not exists palet_lineas_palet_registro_key
  on palet_lineas (palet_id, registro_id) where registro_id is not null;

-- 8) CÁMARA (versión antigua, SIN USO en la app)
--    Entradas en cámara apuntadas a mano, de antes de la paletización
--    automática. Se mantienen para no perder sus datos.
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

-- Saldo de la cámara por agricultor (sin uso en la app).
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

-- 9) LÍNEAS DE LIQUIDACIÓN
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

-- 10) PARÁMETROS
--     Ajustes globales de la app: datos del emisor, precios por defecto,
--     IVA, series de numeración y paletización. Aquí solo los valores por
--     defecto de una instalación nueva; los que ya existen no se tocan.
--     Los datos del emisor van vacíos (el repo es público): se rellenan en
--     Ajustes o con privado/datos_cliente.sql, que no está en el repo.
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
  ('serie_albaran',       'ALB'),
  ('capacidad_camara',    '22'),   -- sin uso en la app
  ('cajas_por_palet',     '60'),
  -- «FECHA DE INICIO» de la paletización automática (AAAA-MM-DD): las
  -- pesadas anteriores no se paletizan. Vacía = todas.
  ('paletizado_desde',    to_char((now() at time zone 'Europe/Madrid')::date, 'YYYY-MM-DD'))
on conflict (clave) do nothing;

-- 11) CONTADORES DE NUMERACIÓN
--     Último número dado de cada serie (palet, albaran, liquidacion,
--     recibo). NUNCA bajan: así no se reutiliza el número de un documento
--     borrado o anulado. Los usa siguiente_numero() (sección 16).
create table if not exists contadores (
  clave  text    primary key,
  ultimo integer not null
);

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

-- Pesadas sueltas de la báscula. En el mismo día, las pesadas de un
-- agricultor (misma campaña y ciclo) se SUMAN en un único registro; aquí
-- queda cada pesada, ligada a ese registro, para no duplicar reenvíos sin
-- red, listarlas en la tablet y poder anular una sola.
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

-- Protección del recibo emitido (ver también la sección 20).
-- Un recibo propio emitido no se puede borrar ni perder su número: la
-- numeración es max + 1 y, si desapareciera el último, su número se
-- volvería a dar a otro recibo (dos documentos fiscales con el mismo nº).
-- Esto también para el borrado en cascada al eliminar un agricultor.
create or replace function public.liquidaciones_proteger_recibo_trg()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.factura_secuencia is not null then
    if tg_op = 'DELETE' then
      raise exception 'No se puede eliminar la liquidación %: ya tiene emitido el recibo %.',
        old.numero, old.num_factura;
    elsif new.factura_secuencia is distinct from old.factura_secuencia then
      raise exception 'No se puede cambiar el nº del recibo % de la liquidación %.',
        old.num_factura, old.numero;
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists liquidaciones_proteger_recibo on liquidaciones;
create trigger liquidaciones_proteger_recibo
  before delete or update of factura_secuencia on liquidaciones
  for each row execute function public.liquidaciones_proteger_recibo_trg();


-- =====================================================================
--  PERMISOS Y FUNCIONES
-- =====================================================================

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
    'liquidacion_lineas', 'parametros', 'bascula_pesadas', 'albaranes_salida',
    'contadores'
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

-- 14) FUNCIONES DE LA BÁSCULA
--     Lo único que puede hacer la tablet de la báscula (bascula.html).
--     Son "security definer": se ejecutan con permisos del dueño, así que
--     validan aquí mismo todo lo que reciben. Las puede usar cualquier
--     usuario con sesión (también los de la oficina), nunca el anónimo.
--     La fecha del registro es el día (hora de Madrid) en que se pesó.

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
-- Si para quitar sus cajas hay que tocar un palet COMPLETO (con su
-- etiqueta ya impresa, seguramente), no se anula: se devuelve un error con
-- hint 'palet_completo' y los códigos de esos palets en el detalle, para
-- que la tablet lo pregunte. Con p_forzar = true se anula igualmente.
-- La versión anterior, sin p_forzar, se quita: con las dos, la llamada
-- con un solo parámetro sería ambigua. (Esta línea se puede quitar cuando
-- todas las bases de datos tengan la nueva.)
drop function if exists public.bascula_anular(bigint);
create or replace function public.bascula_anular(p_id bigint, p_forzar boolean default false)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  bp        bascula_pesadas%rowtype;
  r         registros%rowtype;
  v_ultima  boolean;
  v_codigos text;
begin
  if auth.uid() is null then
    raise exception 'Sesión no iniciada';
  end if;

  -- Bloqueada: si dos tablets anulan la misma pesada a la vez, la segunda
  -- espera, ya no la encuentra y no resta las cajas otra vez.
  select * into bp from bascula_pesadas where id = p_id for update;
  if not found then return false; end if;

  select * into r from registros
  where id = bp.registro_id
    and origen = 'bascula'
    and liquidacion_id is null
    and fecha = (now() at time zone 'Europe/Madrid')::date
  for update;
  if not found then return false; end if;

  -- ¿De qué palets saldrían sus cajas? Si es la última pesada del registro,
  -- se borra el registro y salen todas.
  v_ultima := not exists (select 1 from bascula_pesadas
                          where registro_id = r.id and id <> bp.id);
  v_codigos := public.palets_completos_afectados(r.id,
    case when v_ultima then 0 else greatest(coalesce(r.cajas_entradas, 0) - bp.cajas, 0) end);
  if v_codigos is not null and not coalesce(p_forzar, false) then
    raise exception 'Las cajas de esta pesada ya están en el palet completo %. Si la anulas, ese palet se queda con menos cajas y su etiqueta deja de valer.',
      v_codigos
      using hint = 'palet_completo', detail = v_codigos;
  end if;

  delete from bascula_pesadas where id = bp.id;

  if v_ultima then
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
    'bascula_hoy()', 'bascula_anular(bigint, boolean)', 'bascula_emisor()'
  ]::text[]
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- 15) CAMPAÑA Y CICLO OBLIGATORIOS
--    Ningún registro, retirada de plantas ni liquidación puede quedar sin
--    campaña, y registros y retiradas siempre llevan ciclo 1, 2 o 3. Son
--    las restricciones *_campana_obligatoria y *_ciclo_valido de cada tabla.
--    Consecuencia: una campaña que todavía se usa no se puede borrar (el
--    "on delete set null" de la clave foránea chocaría con esta regla).

-- 16) PALETIZACIÓN AUTOMÁTICA Y ALBARANES DE SALIDA
--     Todas las cajas que pasan por la báscula van a la cámara y, al pesar,
--     se reparten solas en palets de 60 (cajas_por_palet). Las que aún no
--     forman un palet completo están "en cámara". Los palets salen con un
--     albarán de salida.

-- ---------------------------------------------------------------------
-- Ajustes y numeración
-- ---------------------------------------------------------------------
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

-- Contadores de numeración: guardan el último número dado y NUNCA bajan.
-- Antes el siguiente número era max(secuencia) + 1: al borrar el último
-- palet o anular el último albarán, su número se volvía a dar a otro
-- documento (dos etiquetas o dos CMR con el mismo número).
-- siguiente_numero() bloquea la fila del contador hasta el final de la
-- transacción: dos personas a la vez se ponen en fila y no chocan. Si la
-- transacción falla, el contador vuelve atrás y no queda hueco.
-- p_minimo (el máximo actual de la tabla) cubre la primera vez y los
-- números puestos a mano: nunca se da uno que ya exista.
create or replace function public.siguiente_numero(p_clave text, p_minimo integer)
returns integer
language sql
set search_path = public
as $$
  insert into contadores (clave, ultimo) values (p_clave, coalesce(p_minimo, 0) + 1)
  on conflict (clave) do update
    set ultimo = greatest(contadores.ultimo, coalesce(p_minimo, 0)) + 1
  returning ultimo;
$$;

-- ---------------------------------------------------------------------
-- Total de cada palet
-- ---------------------------------------------------------------------
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

-- Al cambiar las cajas por palet en Ajustes, los palets que siguen en la
-- cámara pasan a medirse con la nueva cifra: si sube, los que estaban
-- completos vuelven a "en formación" (pierden la fecha de llenado) y se
-- siguen llenando con las próximas pesadas; si baja, los que ya llegan
-- quedan completos. Los palets con salida ya están en destino: no se tocan.
create or replace function public.parametros_cajas_por_palet_trg()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform public.palet_actualizar_total(p.id)
  from palets p
  where p.fecha_salida is null;
  return null;
end;
$$;

drop trigger if exists parametros_cajas_por_palet on parametros;
create trigger parametros_cajas_por_palet
  after update of valor on parametros
  for each row
  when (new.clave = 'cajas_por_palet' and old.valor is distinct from new.valor)
  execute function public.parametros_cajas_por_palet_trg();

-- El total del palet se recalcula al cambiar sus líneas.
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

-- ---------------------------------------------------------------------
-- Reparto automático
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
      v_sec := public.siguiente_numero('palet', (select max(secuencia) from palets));
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

-- Códigos de los palets COMPLETOS (sin salida) de los que habría que quitar
-- cajas si el registro pasa a tener p_cajas_nuevas. Null si no se toca
-- ninguno. Mismo orden que registros_paletizar_trg (abajo).
create or replace function public.palets_completos_afectados(
  p_registro_id bigint, p_cajas_nuevas integer)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_cap     integer := public.cajas_por_palet();
  v_exceso  integer;
  v_linea   record;
  v_codigos text[] := '{}';
begin
  v_exceso := coalesce((select sum(num_cajas) from palet_lineas where registro_id = p_registro_id), 0)
            - coalesce(p_cajas_nuevas, 0);
  for v_linea in
    select l.num_cajas, p.codigo, p.num_cajas >= v_cap as completo
    from palet_lineas l join palets p on p.id = l.palet_id
    where l.registro_id = p_registro_id and p.fecha_salida is null
    order by (p.num_cajas >= v_cap), p.secuencia desc nulls first, l.id desc
  loop
    exit when v_exceso <= 0;
    if v_linea.completo and not v_linea.codigo = any(v_codigos) then
      v_codigos := v_codigos || v_linea.codigo;
    end if;
    v_exceso := v_exceso - least(v_exceso, v_linea.num_cajas);
  end loop;
  return nullif(array_to_string(v_codigos, ', '), '');
end;
$$;

revoke all on function public.palets_completos_afectados(bigint, integer) from public, anon;
grant execute on function public.palets_completos_afectados(bigint, integer) to authenticated;

-- Al apuntar una pesada se paletiza. Al corregirla:
--   - más cajas: las nuevas se paletizan;
--   - menos cajas: se quitan primero de lo que esté sin palet, luego de sus
--     palets EN FORMACIÓN y solo al final de los completos (que ya tienen
--     la etiqueta impresa), cada grupo del más reciente al más antiguo. Si
--     ya salieron, no se deja corregir. palets_completos_afectados() sigue
--     este mismo orden: si se cambia aquí, cámbialo también allí;
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
  v_cap    integer := public.cajas_por_palet();
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
    order by (p.num_cajas >= v_cap), p.secuencia desc nulls first, l.id desc
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
  elsif old.fecha is null and new.fecha is not null then
    -- Sin fecha no se paletiza: al ponérsela, entran ahora sus cajas.
    perform public.paletizar_registro(new.id);
  end if;
  return null;
end;
$$;

drop trigger if exists registros_paletizar on registros;
create trigger registros_paletizar
  after insert or update of cajas_entradas, agricultor_id, fecha on registros
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
    v_sec := public.siguiente_numero('palet', (select max(secuencia) from palets));
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

  -- El contador también pone en fila dos salidas simultáneas.
  v_sec := public.siguiente_numero('albaran', (select max(secuencia) from albaranes_salida));
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
    'siguiente_numero(text, integer)',
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

-- 17) PALETS EN LA BÁSCULA
--     La tablet de la báscula no puede leer las tablas de palets (ver
--     sección 13): esta función le da lo que necesita para verlos e
--     imprimir sus etiquetas. Solo lectura y solo palets sin salida
--     (en formación y completos), con las cajas de cada agricultor
--     sumadas como en la etiqueta. Devuelve además las cajas por palet,
--     el tamaño de la etiqueta (Ajustes) y las cajas en cámara.
create or replace function public.bascula_palets()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'cajas_por_palet', public.cajas_por_palet(),
    'etiqueta_ancho_mm', (select trim(valor)::numeric from parametros
                          where clave = 'etiqueta_ancho_mm' and trim(valor) ~ '^\d+(\.\d+)?$'),
    'etiqueta_alto_mm',  (select trim(valor)::numeric from parametros
                          where clave = 'etiqueta_alto_mm' and trim(valor) ~ '^\d+(\.\d+)?$'),
    'en_camara', (select coalesce(sum(en_formacion + sin_palet), 0) from paletizado_entradas),
    'palets', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id,
               'secuencia', p.secuencia,
               'codigo', p.codigo,
               'num_cajas', p.num_cajas,
               'fecha_completo', p.fecha_completo,
               'lineas', coalesce((
                 select jsonb_agg(jsonb_build_object('nombre', a.nombre, 'codigo', a.codigo, 'cajas', x.cajas)
                                  order by x.primera)
                 from (select l.agricultor_id, sum(l.num_cajas)::integer as cajas, min(l.id) as primera
                       from palet_lineas l
                       where l.palet_id = p.id
                       group by l.agricultor_id) x
                 join agricultores a on a.id = x.agricultor_id), '[]'::jsonb))
             order by p.secuencia desc nulls last, p.id desc)
      from palets p
      where p.fecha_salida is null), '[]'::jsonb))
  where auth.uid() is not null;
$$;

revoke all on function public.bascula_palets() from public, anon;
grant execute on function public.bascula_palets() to authenticated;

-- 18) GUARDAR UNA LIQUIDACIÓN DE UNA VEZ
--     Cabecera, número, líneas y registros en una sola transacción: si algo
--     falla no se guarda nada (antes podía quedar una liquidación sin líneas
--     o con sus registros sin marcar). Solo se marcan registros libres: si
--     otra persona los liquidó mientras tanto, no se guarda.
--     p_id null = nueva; si no, reedición de un borrador.
--     Sin security definer: la báscula sigue sin poder usarla (RLS).
create or replace function public.liquidacion_guardar(
  p_id bigint, p_datos jsonb, p_lineas jsonb, p_registros bigint[])
returns bigint
language plpgsql
set search_path = public
as $$
declare
  v_id    bigint := p_id;
  v_sec   integer;
  v_serie text;
  v_regs  bigint[] := array(select distinct x from unnest(coalesce(p_registros, '{}')) x);
  v_n     integer;
  v_fuera         integer;
  v_cajas         numeric;
  v_descuento     numeric;
  v_lin_cajas     numeric;
  v_lin_descuento numeric;
  v_lin_base      numeric;
begin
  if p_id is not null then
    perform 1 from liquidaciones where id = p_id and estado = 'borrador' for update;
    if not found then
      raise exception 'Esta liquidación ya no es un borrador (o se ha eliminado): no se puede editar.';
    end if;

    update liquidaciones set
      agricultor_id        = (p_datos->>'agricultor_id')::bigint,
      campana_id           = (p_datos->>'campana_id')::bigint,
      fecha                = (p_datos->>'fecha')::date,
      fecha_desde          = (p_datos->>'fecha_desde')::date,
      fecha_hasta          = (p_datos->>'fecha_hasta')::date,
      precio_caja          = (p_datos->>'precio_caja')::numeric,
      precio_caja_perdida  = (p_datos->>'precio_caja_perdida')::numeric,
      iva_porcentaje       = (p_datos->>'iva_porcentaje')::numeric,
      base                 = (p_datos->>'base')::numeric,
      iva                  = (p_datos->>'iva')::numeric,
      retencion_porcentaje = (p_datos->>'retencion_porcentaje')::numeric,
      retencion            = (p_datos->>'retencion')::numeric,
      total                = (p_datos->>'total')::numeric,
      observaciones        = p_datos->>'observaciones'
    where id = p_id;

    delete from liquidacion_lineas where liquidacion_id = p_id;
    update registros set liquidacion_id = null where liquidacion_id = p_id;
  else
    -- Dos personas a la vez no pueden sacar el mismo número, y el de una
    -- liquidación eliminada no se vuelve a dar.
    v_sec := public.siguiente_numero('liquidacion', (select max(secuencia) from liquidaciones));
    v_serie := coalesce((select nullif(trim(valor), '') from parametros where clave = 'serie_liquidacion'), 'LIQ');

    insert into liquidaciones (
      secuencia, numero, estado, agricultor_id, campana_id, fecha, fecha_desde, fecha_hasta,
      precio_caja, precio_caja_perdida, iva_porcentaje, base, iva,
      retencion_porcentaje, retencion, total, observaciones)
    values (
      v_sec, public.numero_documento(v_serie, v_sec, 4), 'borrador',
      (p_datos->>'agricultor_id')::bigint, (p_datos->>'campana_id')::bigint,
      (p_datos->>'fecha')::date, (p_datos->>'fecha_desde')::date, (p_datos->>'fecha_hasta')::date,
      (p_datos->>'precio_caja')::numeric, (p_datos->>'precio_caja_perdida')::numeric,
      (p_datos->>'iva_porcentaje')::numeric, (p_datos->>'base')::numeric, (p_datos->>'iva')::numeric,
      (p_datos->>'retencion_porcentaje')::numeric, (p_datos->>'retencion')::numeric,
      (p_datos->>'total')::numeric, p_datos->>'observaciones')
    returning id into v_id;
  end if;

  insert into liquidacion_lineas (liquidacion_id, tipo, concepto, cantidad, precio, importe, orden)
  select v_id, l.tipo, l.concepto, coalesce(l.cantidad, 0), coalesce(l.precio, 0),
         coalesce(l.importe, 0), coalesce(l.orden, 0)
  from jsonb_to_recordset(coalesce(p_lineas, '[]'::jsonb))
       as l(tipo text, concepto text, cantidad numeric, precio numeric, importe numeric, orden integer);

  if cardinality(v_regs) > 0 then
    perform 1 from registros where id = any(v_regs) for update;
    update registros set liquidacion_id = v_id
    where id = any(v_regs) and liquidacion_id is null;
    get diagnostics v_n = row_count;
    if v_n <> cardinality(v_regs) then
      raise exception 'Algunos registros ya están en otra liquidación (o se han borrado). Vuelve a pulsar «Calcular».';
    end if;
  end if;

  -- Lo guardado tiene que cuadrar con los registros TAL Y COMO ESTÁN AHORA
  -- (ya bloqueados). Si entre «Calcular» y «Guardar» la báscula ha sumado
  -- cajas o ha entrado un registro nuevo en el periodo, el cálculo ya no
  -- vale: sin esto, esas cajas quedaban liquidadas sin pagarse.
  select count(*) filter (where r.agricultor_id is distinct from (p_datos->>'agricultor_id')::bigint
                            or r.campana_id is distinct from (p_datos->>'campana_id')::bigint
                            or r.fecha is null
                            or r.fecha not between (p_datos->>'fecha_desde')::date
                                               and (p_datos->>'fecha_hasta')::date),
         coalesce(sum(coalesce(r.cajas_entradas, 0)), 0),
         coalesce(sum(coalesce(r.descuento_cajas, 0)), 0)
  into v_fuera, v_cajas, v_descuento
  from registros r where r.liquidacion_id = v_id;

  if v_fuera > 0 then
    raise exception 'Algunos registros no son de este agricultor, campaña o periodo. Vuelve a pulsar «Calcular».';
  end if;

  if exists (select 1 from registros r
             where r.liquidacion_id is null
               and r.agricultor_id = (p_datos->>'agricultor_id')::bigint
               and r.campana_id = (p_datos->>'campana_id')::bigint
               and r.fecha between (p_datos->>'fecha_desde')::date and (p_datos->>'fecha_hasta')::date) then
    raise exception 'Han entrado registros nuevos en el periodo mientras tanto. Vuelve a pulsar «Calcular».';
  end if;

  select coalesce(sum(cantidad) filter (where tipo = 'bimi'), 0),
         coalesce(sum(cantidad) filter (where tipo = 'descuento'), 0),
         count(*) filter (where tipo = 'descuento'),
         coalesce(sum(importe), 0)
  into v_lin_cajas, v_lin_descuento, v_n, v_lin_base
  from liquidacion_lineas where liquidacion_id = v_id;

  if v_lin_cajas <> v_cajas
     or (v_n > 0 and v_lin_descuento <> v_descuento)
     or (v_n = 0 and v_descuento > 0 and coalesce((p_datos->>'incluir_descuento')::boolean, false)) then
    raise exception 'Las cajas de los registros han cambiado desde el cálculo (ahora % cajas y % de descuento). Vuelve a pulsar «Calcular».',
      v_cajas, v_descuento;
  end if;

  -- Importes: la base es la suma de las líneas y el total, base + IVA − retención.
  if abs(v_lin_base - coalesce((p_datos->>'base')::numeric, 0)) > 0.005
     or abs(coalesce((p_datos->>'base')::numeric, 0) + coalesce((p_datos->>'iva')::numeric, 0)
            - coalesce((p_datos->>'retencion')::numeric, 0)
            - coalesce((p_datos->>'total')::numeric, 0)) > 0.005 then
    raise exception 'Los importes no cuadran con las líneas. Vuelve a pulsar «Calcular».';
  end if;

  return v_id;
end;
$$;

revoke all on function public.liquidacion_guardar(bigint, jsonb, jsonb, bigint[]) from public, anon;
grant execute on function public.liquidacion_guardar(bigint, jsonb, jsonb, bigint[]) to authenticated;

-- 19) ELIMINAR UNA LIQUIDACIÓN DE UNA VEZ
--     Suelta sus registros (liquidacion_id y num_factura) y borra la
--     liquidación en una sola transacción. Antes eran dos pasos desde el
--     navegador: si el borrado fallaba (p. ej. otra persona acababa de
--     emitir el recibo), los registros quedaban sueltos y se podían
--     volver a liquidar, pagándolos dos veces.
--     Sin security definer: la báscula sigue sin poder usarla (RLS).
create or replace function public.liquidacion_eliminar(p_id bigint)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_liq liquidaciones%rowtype;
begin
  select * into v_liq from liquidaciones where id = p_id for update;
  if not found then
    raise exception 'La liquidación ya no existe (¿se ha eliminado en otra pestaña?).';
  end if;
  if v_liq.factura_secuencia is not null then
    raise exception 'No se puede eliminar la liquidación %: ya tiene emitido el recibo %.',
      v_liq.numero, v_liq.num_factura;
  end if;

  -- Primero se sueltan los registros: el ON DELETE SET NULL dejaría el
  -- num_factura antiguo pegado. El aviso a registros_proteger_trg
  -- (sección 20) permite soltarlos aunque la liquidación esté cerrada o
  -- facturada con la factura del agricultor. Solo dura esta transacción.
  perform set_config('agrobimi.eliminando_liquidacion', p_id::text, true);
  update registros set
    liquidacion_id = null,
    num_factura    = case when v_liq.num_factura is not null then null else num_factura end
  where liquidacion_id = p_id;

  delete from liquidaciones where id = p_id;
end;
$$;

revoke all on function public.liquidacion_eliminar(bigint) from public, anon;
grant execute on function public.liquidacion_eliminar(bigint) to authenticated;

-- 20) LO LIQUIDADO NO SE CAMBIA
--     Cuando una liquidación sale de borrador (cerrada o facturada), lo que
--     se pagó queda fijo. Antes solo se avisaba con un confirm() en el
--     navegador y el recibo podía dejar de cuadrar con los registros.
--
--     a) Liquidaciones: solo se puede pasar de borrador a cerrada, y de
--        borrador o cerrada a facturada. Una vez fuera de borrador no
--        cambia nada más (importes, fechas, nº de recibo...). Para
--        corregir, se elimina y se rehace (si no tiene recibo propio).
create or replace function public.liquidaciones_proteger_trg()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.estado = 'borrador' then
    return new;  -- el borrador se edita libremente (liquidacion_guardar)
  end if;

  if old.estado = 'cerrada' and new.estado = 'facturada' then
    -- Facturar: solo se rellenan los datos de la factura.
    if (new.agricultor_id, new.campana_id, new.fecha, new.fecha_desde, new.fecha_hasta,
        new.precio_caja, new.precio_caja_perdida, new.iva_porcentaje, new.base, new.iva,
        new.retencion_porcentaje, new.retencion, new.total, new.observaciones,
        new.numero, new.secuencia)
       is distinct from
       (old.agricultor_id, old.campana_id, old.fecha, old.fecha_desde, old.fecha_hasta,
        old.precio_caja, old.precio_caja_perdida, old.iva_porcentaje, old.base, old.iva,
        old.retencion_porcentaje, old.retencion, old.total, old.observaciones,
        old.numero, old.secuencia) then
      raise exception 'La liquidación % está cerrada: al facturarla no se pueden cambiar sus importes ni sus datos.',
        old.numero;
    end if;
    return new;
  end if;

  if row(new.*) is distinct from row(old.*) then
    raise exception 'La liquidación % está %: ya no se puede modificar. Si hay que corregirla, elimínala y vuelve a hacerla.',
      old.numero, old.estado;
  end if;
  return new;
end;
$$;

drop trigger if exists liquidaciones_proteger on liquidaciones;
create trigger liquidaciones_proteger
  before update on liquidaciones
  for each row execute function public.liquidaciones_proteger_trg();

--     b) Líneas: solo se tocan mientras la liquidación es un borrador. Si
--        la liquidación ya no existe es un borrado en cascada: se deja.
create or replace function public.liquidacion_lineas_proteger_trg()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_liq liquidaciones%rowtype;
begin
  select * into v_liq from liquidaciones
  where id = case when tg_op = 'INSERT' then new.liquidacion_id else old.liquidacion_id end;
  if found and v_liq.estado <> 'borrador' then
    raise exception 'La liquidación % está %: sus líneas ya no se pueden cambiar.',
      v_liq.numero, v_liq.estado;
  end if;
  if tg_op = 'UPDATE' and new.liquidacion_id is distinct from old.liquidacion_id then
    select * into v_liq from liquidaciones where id = new.liquidacion_id;
    if found and v_liq.estado <> 'borrador' then
      raise exception 'La liquidación % está %: sus líneas ya no se pueden cambiar.',
        v_liq.numero, v_liq.estado;
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists liquidacion_lineas_proteger on liquidacion_lineas;
create trigger liquidacion_lineas_proteger
  before insert or update or delete on liquidacion_lineas
  for each row execute function public.liquidacion_lineas_proteger_trg();

--     c) Registros de una liquidación cerrada o facturada: no se borran ni
--        se cambia lo que cuenta para el pago (agricultor, campaña, fecha,
--        cajas, descuento y cajas vacías) ni de qué liquidación son. Sí se
--        pueden cambiar el resto (comentarios, ciclo, fecha CMR, salidas...).
--        Excepciones: copiar a los registros el nº de la factura de su
--        liquidación (al facturar) y soltarlos desde liquidacion_eliminar.
--        En un borrador se puede todo: al recalcularlo, se coge lo nuevo.
create or replace function public.registros_proteger_trg()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_liq liquidaciones%rowtype;
begin
  if old.liquidacion_id is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select * into v_liq from liquidaciones where id = old.liquidacion_id;
  if not found or v_liq.estado = 'borrador' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if current_setting('agrobimi.eliminando_liquidacion', true) = old.liquidacion_id::text then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'No se puede eliminar el registro del %: está en la liquidación % (%).',
      to_char(old.fecha, 'DD/MM/YYYY'), v_liq.numero, v_liq.estado;
  end if;

  if (new.agricultor_id, new.campana_id, new.fecha, new.cajas_entradas, new.descuento_cajas,
      new.cajas_vacias_retiradas, new.cajas_vacias_devueltas, new.liquidacion_id)
     is distinct from
     (old.agricultor_id, old.campana_id, old.fecha, old.cajas_entradas, old.descuento_cajas,
      old.cajas_vacias_retiradas, old.cajas_vacias_devueltas, old.liquidacion_id) then
    raise exception 'El registro del % está en la liquidación % (%): no se pueden cambiar su fecha, campaña ni cajas. Solo comentarios, ciclo y datos de salida.',
      to_char(old.fecha, 'DD/MM/YYYY'), v_liq.numero, v_liq.estado;
  end if;

  if new.num_factura is distinct from old.num_factura
     and new.num_factura is distinct from v_liq.num_factura then
    raise exception 'El registro del % está en la liquidación % (%): su nº de factura es el de la liquidación.',
      to_char(old.fecha, 'DD/MM/YYYY'), v_liq.numero, v_liq.estado;
  end if;

  return new;
end;
$$;

drop trigger if exists registros_proteger on registros;
create trigger registros_proteger
  before update or delete on registros
  for each row execute function public.registros_proteger_trg();

-- 21) FACTURAR UNA LIQUIDACIÓN DE UNA VEZ
--     Numera el recibo, marca la liquidación como facturada y copia el nº a
--     sus registros en una sola transacción. Antes eran dos escrituras desde
--     el navegador con el nº calculado allí (max + 1): dos personas a la vez
--     chocaban, y si fallaba la segunda escritura los registros se quedaban
--     sin nº de factura.
--     p_agricultor = true: la factura la trae el agricultor; se apuntan su
--     nº y su fecha (p_num, p_fecha) y no se gasta nº de la serie.
--     Devuelve el nº de factura o recibo.
--     Sin security definer: la báscula sigue sin poder usarla (RLS).
create or replace function public.liquidacion_facturar(
  p_id bigint, p_agricultor boolean, p_num text, p_fecha date)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_liq   liquidaciones%rowtype;
  v_sec   integer;
  v_num   text;
  v_fecha date;
begin
  select * into v_liq from liquidaciones where id = p_id for update;
  if not found then
    raise exception 'La liquidación ya no existe (¿se ha eliminado en otra pestaña?).';
  end if;
  if v_liq.estado = 'facturada' then
    raise exception 'La liquidación % ya está facturada (%).', v_liq.numero, v_liq.num_factura;
  end if;

  if coalesce(p_agricultor, false) then
    v_num := nullif(trim(p_num), '');
    v_fecha := p_fecha;
    if v_num is null or v_fecha is null then
      raise exception 'Escribe el nº y la fecha de la factura del agricultor.';
    end if;
  else
    -- La fecha del recibo es la del servidor (hora de España), no la del
    -- reloj del ordenador.
    v_fecha := (now() at time zone 'Europe/Madrid')::date;
    v_sec := public.siguiente_numero('recibo',
      (select max(factura_secuencia) from liquidaciones));
    v_num := public.numero_documento(
      coalesce((select nullif(trim(valor), '') from parametros where clave = 'serie_factura'), 'F'),
      v_sec, 4);
  end if;

  update liquidaciones set
    estado             = 'facturada',
    factura_agricultor = coalesce(p_agricultor, false),
    factura_secuencia  = v_sec,
    num_factura        = v_num,
    fecha_factura      = v_fecha
  where id = p_id;

  -- El nº también va a los registros: la tabla del agricultor los agrupa
  -- por factura.
  update registros set num_factura = v_num where liquidacion_id = p_id;

  return v_num;
end;
$$;

revoke all on function public.liquidacion_facturar(bigint, boolean, text, date) from public, anon;
grant execute on function public.liquidacion_facturar(bigint, boolean, text, date) to authenticated;
