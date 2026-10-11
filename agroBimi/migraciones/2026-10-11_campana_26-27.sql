-- =====================================================================
--  MIGRACIÓN ÚNICA (2026-10-11): solo la campaña 26/27 y ciclos 1, 2 o 3
--  ---------------------------------------------------------------------
--  Lo pide el cliente: nada puede quedar "sin campaña" ni "sin ciclo", y
--  por ahora la única campaña es la 26/27.
--
--  Qué hace, todo en una transacción (si algo falla, no cambia nada):
--    1. Crea la campaña "26/27" si no existe.
--    2. Pasa a 26/27 TODO lo que esté en otra campaña o sin campaña:
--       registros, retiradas de plantas, liquidaciones, palets y entradas
--       en cámara. No se borra ningún dato.
--    3. Normaliza los ciclos: "Ciclo 2" -> 2; vacío o raro -> 1.
--    4. Borra las demás campañas (ya no las usa nada).
--    5. Obliga a partir de ahora a que registros, retiradas y liquidaciones
--       tengan campaña, y registros y retiradas un ciclo 1, 2 o 3.
--
--  ORDEN: ejecutar ESTE archivo primero y después schema.sql completo.
--
--  Antes de ejecutarlo, conviene mirar qué hay:
--    select c.id, c.nombre, count(r.id) as registros
--    from campanas c left join registros r on r.campana_id = c.id
--    group by c.id, c.nombre order by c.id;
--  Si la campaña ya existe con otro nombre (p. ej. "Campaña 26/27"),
--  cámbiale el nombre a 26/27 desde la app antes de ejecutar esto: así se
--  conserva esa misma campaña en lugar de crear otra.
-- =====================================================================

begin;

do $$
declare v_id bigint;
begin
  insert into campanas (nombre) values ('26/27') on conflict do nothing;
  select id into v_id from campanas where lower(trim(nombre)) = '26/27';

  update registros         set campana_id = v_id where campana_id is distinct from v_id;
  update retiradas_plantas set campana_id = v_id where campana_id is distinct from v_id;
  update liquidaciones     set campana_id = v_id where campana_id is distinct from v_id;
  update palets            set campana_id = v_id where campana_id is distinct from v_id;
  update camara_entradas   set campana_id = v_id where campana_id is distinct from v_id;

  -- Mismo criterio que cicloValido() de la app: se queda el primer 1, 2
  -- o 3 que aparezca; si no hay ninguno, ciclo 1.
  update registros set ciclo = coalesce(substring(ciclo from '[123]'), '1')
  where ciclo is null or ciclo not in ('1', '2', '3');
  update retiradas_plantas set ciclo = coalesce(substring(ciclo from '[123]'), '1')
  where ciclo is null or ciclo not in ('1', '2', '3');

  delete from campanas where id <> v_id;
end $$;

-- Las mismas reglas que añade schema.sql (sección 15), aquí ya validadas
-- contra todos los datos.
do $$ begin
  alter table registros add constraint registros_campana_obligatoria
    check (campana_id is not null);
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table registros add constraint registros_ciclo_valido
    check (ciclo is not null and ciclo in ('1', '2', '3'));
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table retiradas_plantas add constraint retiradas_campana_obligatoria
    check (campana_id is not null);
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table retiradas_plantas add constraint retiradas_ciclo_valido
    check (ciclo is not null and ciclo in ('1', '2', '3'));
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table liquidaciones add constraint liquidaciones_campana_obligatoria
    check (campana_id is not null);
exception when duplicate_object then null;
end $$;

alter table registros         validate constraint registros_campana_obligatoria;
alter table registros         validate constraint registros_ciclo_valido;
alter table retiradas_plantas validate constraint retiradas_campana_obligatoria;
alter table retiradas_plantas validate constraint retiradas_ciclo_valido;
alter table liquidaciones     validate constraint liquidaciones_campana_obligatoria;

commit;

-- Comprobación: debe salir una sola fila, 26/27, con todos los registros.
select c.id, c.nombre, count(r.id) as registros
from campanas c left join registros r on r.campana_id = c.id
group by c.id, c.nombre;
