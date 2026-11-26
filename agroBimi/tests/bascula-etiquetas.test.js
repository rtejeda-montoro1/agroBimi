const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement, loadModule, flush } = require("./helpers");

// Etiquetas automáticas de palet: la tablet con su localStorage (que se
// conserva entre "recargas") y un QZ Tray falso que imprime o falla.
const hoy = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

const PALET = { id: 9, codigo: "P-9", secuencia: 9, num_cajas: 60, fecha_completo: hoy,
  lineas: [{ nombre: "Ana", cajas: 60 }] };

async function cargarBascula({ almacen, palets, qz, alRegistrar = () => {} }) {
  const elements = new Map();
  const $ = (id) => {
    if (!elements.has(id)) elements.set(id, createElement());
    return elements.get(id);
  };
  const intervalos = [];
  const bodyClasses = new Set();
  const db = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "operario" } } } }),
      onAuthStateChange() {},
      signOut: async () => ({ error: null }),
    },
    rpc: async (nombre) => {
      if (nombre === "bascula_palets") return { data: { cajas_por_palet: 60, palets: palets() }, error: null };
      if (nombre === "bascula_campanas") return { data: [{ id: 1, nombre: "26/27" }], error: null };
      if (nombre === "bascula_emisor") return { data: "", error: null };
      if (nombre === "bascula_registrar") { alRegistrar(); return { data: 7, error: null }; }
      return { data: [], error: null };
    },
  };
  loadModule("bascula.js", {}, {
    window: {
      addEventListener() {}, print() {}, BASCULA_ETIQUETAS: true,
      QZEtiquetas: { imprimir: async (trabajo) => qz(trabajo) },
    },
    document: {
      title: "Báscula",
      visibilityState: "hidden",
      body: { classList: {
        toggle(n, on) { if (on) bodyClasses.add(n); else bodyClasses.delete(n); },
        contains: (n) => bodyClasses.has(n),
      } },
      getElementById: $,
      addEventListener() {},
      querySelectorAll: () => [],
      querySelector: (sel) => (sel === ".bascula-main" ? $("bascula-main") : null),
    },
    navigator: { onLine: true },
    supabase: { createClient: () => db },
    crypto: { randomUUID: () => "uuid-nuevo" },
    setInterval: (f) => { intervalos.push(f); return intervalos.length; },
    localStorage: {
      getItem: (k) => (almacen.has(k) ? almacen.get(k) : null),
      setItem: (k, v) => almacen.set(k, String(v)),
      removeItem: (k) => almacen.delete(k),
    },
    console: { error() {} },
  });
  for (let i = 0; i < 12; i++) await flush();
  return {
    $,
    async cadaMinuto() {
      intervalos.forEach((f) => f());
      for (let i = 0; i < 12; i++) await flush();
    },
  };
}

const leer = (almacen, k) => JSON.parse(almacen.get(k) || "null");
const pesadaPendiente = { uuid: "u1", agricultor_id: 1, nombre: "Ana", campana_id: 1, ciclo: "1",
  cajas: 5, vacias: 0, pesada_en: new Date().toISOString() };

test("bascula keeps a failed automatic label pending and prints it after a reload", async () => {
  // La tablet ya conocía la lista (vacía); la pesada pendiente completa el palet 9.
  const almacen = new Map([
    ["bascula_palets_completos", "[]"],
    ["bascula_pendientes", JSON.stringify([pesadaPendiente])],
  ]);
  let enviada = false;
  const pedidas = [];
  await cargarBascula({
    almacen,
    palets: () => (enviada ? [PALET] : []),
    alRegistrar: () => { enviada = true; },
    qz: async (t) => {
      pedidas.push(t);
      throw Object.assign(new Error("ws"), { aviso: "QZ Tray no está abierto en la tablet." });
    },
  });

  assert.equal(pedidas.length, 1, "lo intentó");
  assert.deepEqual(leer(almacen, "bascula_palets_completos"), [], "no se da por impresa");
  assert.deepEqual(leer(almacen, "bascula_etiquetas_pendientes"), [9]);

  // Se recarga la página con QZ ya abierto: al entrar sale la pendiente.
  const impresas = [];
  await cargarBascula({ almacen, palets: () => [PALET], qz: async (t) => { impresas.push(t); } });
  assert.equal(impresas.length, 1);
  assert.match(impresas[0].html, /P-9/);
  assert.deepEqual(leer(almacen, "bascula_palets_completos"), [9]);
  assert.deepEqual(leer(almacen, "bascula_etiquetas_pendientes"), []);

  // Y ya no se vuelve a imprimir.
  const otra = [];
  await cargarBascula({ almacen, palets: () => [PALET], qz: async (t) => { otra.push(t); } });
  assert.equal(otra.length, 0);
});

test("bascula retries a pending label every minute until it prints", async () => {
  const almacen = new Map([
    ["bascula_palets_completos", "[]"],
    ["bascula_etiquetas_pendientes", "[9]"],
  ]);
  let falla = true;
  let intentos = 0;
  const b = await cargarBascula({
    almacen,
    palets: () => [PALET],
    qz: async () => { intentos++; if (falla) throw new Error("apagada"); },
  });
  assert.equal(intentos, 1);
  assert.deepEqual(leer(almacen, "bascula_etiquetas_pendientes"), [9]);

  falla = false;
  await b.cadaMinuto();
  assert.equal(intentos, 2);
  assert.deepEqual(leer(almacen, "bascula_etiquetas_pendientes"), []);
  assert.deepEqual(leer(almacen, "bascula_palets_completos"), [9]);

  await b.cadaMinuto();
  assert.equal(intentos, 2, "sin pendientes no pregunta más");
});

test("bascula on first use only notes the complete pallets, without printing old labels", async () => {
  const almacen = new Map();
  const impresas = [];
  await cargarBascula({ almacen, palets: () => [PALET], qz: async (t) => { impresas.push(t); } });
  assert.equal(impresas.length, 0);
  assert.deepEqual(leer(almacen, "bascula_palets_completos"), [9]);
});

test("bascula manual label of an unfinished pallet does not stop its automatic label", async () => {
  const almacen = new Map([["bascula_palets_completos", "[]"]]);
  const enProgreso = { ...PALET, num_cajas: 30, fecha_completo: null };
  const impresas = [];
  const b = await cargarBascula({ almacen, palets: () => [enProgreso], qz: async (t) => { impresas.push(t); } });

  b.$("listaPalets").dispatch("click", { target: { closest: () => ({ dataset: { etiqueta: "9" } }) } });
  for (let i = 0; i < 12; i++) await flush();
  assert.equal(impresas.length, 1);
  assert.deepEqual(leer(almacen, "bascula_palets_completos"), [], "uno en progreso no se apunta");
});
