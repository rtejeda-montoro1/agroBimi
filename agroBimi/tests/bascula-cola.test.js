const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement, loadModule, flush } = require("./helpers");

// Báscula con una tablet "de verdad": localStorage en memoria (con lo que
// se le pase) y un servidor falso que responde según `rpc(nombre, args)`.
async function cargarBascula({ guardado = {}, rpc = () => null } = {}) {
  const elements = new Map();
  const $ = (id) => {
    if (!elements.has(id)) elements.set(id, createElement());
    return elements.get(id);
  };
  const almacen = new Map(Object.entries(guardado).map(([k, v]) => [k, JSON.stringify(v)]));
  const llamadas = [];
  const bodyClasses = new Set();
  const document = {
    title: "Báscula",
    visibilityState: "hidden",
    body: {
      classList: {
        toggle(name, on) { if (on) bodyClasses.add(name); else bodyClasses.delete(name); },
        contains: (name) => bodyClasses.has(name),
      },
    },
    getElementById: $,
    addEventListener() {},
    querySelectorAll: () => [],
    querySelector: (sel) => (sel === ".bascula-main" ? $("bascula-main") : null),
  };
  const db = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "operario" } } } }),
      onAuthStateChange() {},
      signOut: async () => ({ error: null }),
    },
    rpc: async (nombre, args) => {
      llamadas.push({ nombre, args });
      const r = rpc(nombre, args);
      if (r) return r;
      if (nombre === "bascula_campanas") return { data: [{ id: 1, nombre: "26/27" }], error: null };
      if (nombre === "bascula_emisor") return { data: "", error: null };
      if (nombre === "bascula_palets") return { data: { palets: [] }, error: null };
      return { data: [], error: null };
    },
  };
  loadModule("bascula.js", {}, {
    window: { addEventListener() {}, print() {}, BASCULA_ETIQUETAS: false },
    document,
    navigator: { onLine: true },
    supabase: { createClient: () => db },
    crypto: { randomUUID: () => "uuid-nuevo" },
    localStorage: {
      getItem: (k) => (almacen.has(k) ? almacen.get(k) : null),
      setItem: (k, v) => almacen.set(k, String(v)),
      removeItem: (k) => almacen.delete(k),
    },
    console: { error() {} },
  });
  for (let i = 0; i < 6; i++) await flush();
  return {
    $,
    llamadas,
    cola: () => JSON.parse(almacen.get("bascula_pendientes") || "[]"),
    async pulsarEnHoy(dataset) {
      $("hoyLista").dispatch("click", { target: { closest: () => ({ dataset }) } });
      for (let i = 0; i < 6; i++) await flush();
    },
  };
}

const haceDias = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
const pendiente = (extra = {}) => ({
  uuid: "u-antigua", agricultor_id: 1, nombre: "Ana", campana_id: 1, ciclo: "1",
  cajas: 5, vacias: 0, pesada_en: haceDias(9), ...extra,
});
const rechazoPorFecha = {
  data: null,
  error: { code: "P0001", message: "Fecha de la pesada no válida (revisa la hora de la tablet)" },
};

test("bascula lists pending entries from earlier days, not just a count", async () => {
  const b = await cargarBascula({
    guardado: { bascula_pendientes: [pendiente({ pesada_en: haceDias(2) })] },
    // Sin red: la entrada sigue pendiente, sin error.
    rpc: (n) => (n === "bascula_registrar" ? { data: null, error: { message: "Failed to fetch" } } : null),
  });
  const html = b.$("hoyLista").innerHTML;
  assert.match(html, /días anteriores/);
  assert.match(html, /data-descartar="u-antigua"/);
  assert.match(html, /Ana/);
});

test("bascula offers to resend an entry the server rejects as too old, with today's date", async () => {
  let aceptar = false;
  const b = await cargarBascula({
    guardado: { bascula_pendientes: [pendiente()] },
    rpc: (n) => (n === "bascula_registrar" ? (aceptar ? { data: 7, error: null } : rechazoPorFecha) : null),
  });
  assert.match(b.cola()[0].error, /Fecha de la pesada/);
  assert.match(b.$("hoyLista").innerHTML, /data-reenviar-hoy="u-antigua"/);

  aceptar = true;
  const antes = Date.now();
  await b.pulsarEnHoy({ reenviarHoy: "u-antigua" });

  const envio = b.llamadas.filter((l) => l.nombre === "bascula_registrar").at(-1);
  assert.equal(envio.args.p_client_uuid, "u-antigua");
  assert.ok(new Date(envio.args.p_pesada_en).getTime() >= antes - 1000);
  assert.deepEqual(b.cola(), []);
});

test("bascula treats a missing server function as a rejection, not as no connection", async () => {
  const b = await cargarBascula({
    guardado: { bascula_pendientes: [pendiente({ pesada_en: new Date().toISOString() })] },
    rpc: (n) => (n === "bascula_registrar"
      ? { data: null, error: { code: "42883", message: "function bascula_registrar does not exist" } }
      : null),
  });
  assert.match(b.cola()[0].error, /does not exist/);
});

test("bascula keeps the farmers on screen when only today's entries fail to load", async () => {
  const b = await cargarBascula({
    rpc: (n) => {
      if (n === "bascula_agricultores") return { data: [{ id: 1, nombre: "Ana", codigo: 101 }], error: null };
      if (n === "bascula_hoy") return { data: null, error: { code: "P0001", message: "boom" } };
      return null;
    },
  });
  const lista = b.$("sugerencias").innerHTML;
  assert.match(lista, /Ana/);
  assert.doesNotMatch(lista, /No se pudieron cargar/);
});

// Busca, elige al agricultor 1 y teclea 12 cajas.
function prepararEntrada(b) {
  b.$("buscar").value = "ana";
  b.$("buscar").dispatch("input");
  b.$("sugerencias").dispatch("click", { target: { closest: () => ({ dataset: { agri: "1" } }) } });
  b.$("teclado").dispatch("click", { target: { closest: () => ({ dataset: { tecla: "1" } }) } });
  b.$("teclado").dispatch("click", { target: { closest: () => ({ dataset: { tecla: "2" } }) } });
}

const conAna = (n) =>
  (n === "bascula_agricultores" ? { data: [{ id: 1, nombre: "Ana", codigo: 101 }], error: null } : null);

test("bascula search with the magnifier filters farmers, picks one and shows it instead of the search", async () => {
  const b = await cargarBascula({
    rpc: (n) => (n === "bascula_agricultores"
      ? { data: [{ id: 1, nombre: "Ana", codigo: 101 }, { id: 2, nombre: "Pablo", codigo: 7 }], error: null }
      : null),
  });
  b.$("buscar").value = "7";
  b.$("buscar").dispatch("input");
  assert.equal(b.$("sugerencias").hidden, false);
  assert.match(b.$("sugerencias").innerHTML, /Pablo/);
  assert.doesNotMatch(b.$("sugerencias").innerHTML, /Ana/);

  b.$("sugerencias").dispatch("click", { target: { closest: () => ({ dataset: { agri: "2" } }) } });
  assert.equal(b.$("sugerencias").hidden, true);
  assert.equal(b.$("agriBuscador").hidden, true);
  assert.equal(b.$("agriElegido").hidden, false);
  assert.match(b.$("agriElegido").innerHTML, /Pablo/);

  // «Cambiar» vuelve a enseñar el buscador.
  b.$("agriElegido").dispatch("click", { target: { closest: (sel) => (sel === "[data-cambiar]" ? {} : null) } });
  assert.equal(b.$("agriBuscador").hidden, false);
  assert.equal(b.$("agriElegido").hidden, true);
});

test("bascula registers without palletizing: the server is told not to put the boxes in pallets", async () => {
  const b = await cargarBascula({ rpc: conAna });
  prepararEntrada(b);
  assert.equal(b.$("btnRegistrarSinPalet").disabled, false);
  b.$("btnRegistrarSinPalet").dispatch("click");
  for (let i = 0; i < 6; i++) await flush();

  const envio = b.llamadas.filter((l) => l.nombre === "bascula_registrar").at(-1);
  assert.equal(envio.args.p_cajas, 12);
  assert.equal(envio.args.p_paletizar, false);
  assert.match(b.$("toast").textContent, /sin paletizar/);
});

test("bascula plain register palletizes, also for entries queued before this change", async () => {
  const b = await cargarBascula({
    guardado: { bascula_pendientes: [pendiente({ uuid: "u-vieja", pesada_en: new Date().toISOString() })] },
    rpc: conAna,
  });
  prepararEntrada(b);
  b.$("btnRegistrar").dispatch("click");
  for (let i = 0; i < 6; i++) await flush();

  const envios = b.llamadas.filter((l) => l.nombre === "bascula_registrar");
  assert.equal(envios.find((l) => l.args.p_client_uuid === "u-vieja").args.p_paletizar, true);
  assert.equal(envios.find((l) => l.args.p_client_uuid === "uuid-nuevo").args.p_paletizar, true);
});

test("bascula keeps the farmer and cycle selected after registering, with the boxes back to 0", async () => {
  const b = await cargarBascula({ rpc: conAna });
  prepararEntrada(b);
  b.$("ciclos").dispatch("click", { target: { closest: () => ({ dataset: { ciclo: "2" } }) } });
  b.$("btnRegistrar").dispatch("click");
  for (let i = 0; i < 6; i++) await flush();

  assert.equal(b.$("agriBuscador").hidden, true);
  assert.equal(b.$("agriElegido").hidden, false);
  assert.match(b.$("agriElegido").innerHTML, /Ana/);
  assert.equal(b.$("cajasValor").textContent, "0");
  // Listo para otra entrada del mismo agricultor y ciclo.
  b.$("teclado").dispatch("click", { target: { closest: () => ({ dataset: { tecla: "5" } }) } });
  assert.equal(b.$("btnRegistrar").disabled, false);
  b.$("btnRegistrar").dispatch("click");
  for (let i = 0; i < 6; i++) await flush();
  const ultimo = b.llamadas.filter((l) => l.nombre === "bascula_registrar").at(-1).args;
  assert.equal(ultimo.p_agricultor_id, 1);
  assert.equal(ultimo.p_ciclo, "2");
  assert.equal(ultimo.p_cajas, 5);
});

test("bascula keypad does not type until a farmer is selected", async () => {
  const b = await cargarBascula({ rpc: conAna });
  const tecla = (t) => b.$("teclado").dispatch("click", { target: { closest: () => ({ dataset: { tecla: t } }) } });
  assert.equal(b.$("teclado").classList.contains("bloqueado"), true);
  tecla("7");
  assert.equal(b.$("cajasValor").textContent, "0");

  b.$("buscar").value = "ana";
  b.$("buscar").dispatch("input");
  b.$("sugerencias").dispatch("click", { target: { closest: () => ({ dataset: { agri: "1" } }) } });
  assert.equal(b.$("teclado").classList.contains("bloqueado"), false);
  tecla("7");
  assert.equal(b.$("cajasValor").textContent, "7");
});

test("bascula marks today's entries registered without palletizing", async () => {
  const b = await cargarBascula({
    rpc: (n) => (n === "bascula_hoy"
      ? { data: [
        { id: 1, client_uuid: "a", creado: new Date().toISOString(), nombre: "Ana", ciclo: "1", cajas: 5, paletizar: false },
        { id: 2, client_uuid: "b", creado: new Date().toISOString(), nombre: "Luis", ciclo: "1", cajas: 7, paletizar: true },
      ], error: null }
      : null),
  });
  const html = b.$("hoyLista").innerHTML;
  assert.equal((html.match(/hoy-sin-palet/g) || []).length, 1);
  assert.match(html, /Ana[\s\S]*sin palet[\s\S]*Luis/);
});
