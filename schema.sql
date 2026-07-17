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
--    Activamos RLS y permitimos acceso con la clave "anon".
--    NOTA: la clave anon va incrustada en la web, así que cualquiera
--    con la URL de tu app podría leer/escribir. Para uso personal es
--    suficiente; si quieres proteger con usuario y contraseña, dímelo
--    y añadimos login (Supabase Auth).
alter table ventas enable row level security;

create policy "acceso_anon_ventas"
  on ventas
  for all
  to anon
  using (true)
  with check (true);
