const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement, escapeHtml, loadModule } = require("./helpers");

function createRegistroSaveHarness(cajas) {
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, createElement());
    return elements.get(id);
  };
  getElement("fecha").value = "2026-03-01";
  getElement("cajas_entradas").value = cajas;
  getElement("campana_id").value = "3";
  const button = createElement();
  const form = createElement({ querySelector: () => button });
  let inserted = null;
  const body = createElement();
  const app = {
    state: { agricultorAbierto: { id: 5 }, registrosActuales: [], agrupadoPorFactura: false },
    dom: { formRegistro: form, cuerpoRegistros: body, modalRegistro: createElement() },
    CAMPOS_REGISTRO: [{ id: "fecha", tipo: "fecha" }, { id: "cajas_entradas", tipo: "num" }],
    COLORES_FACTURA: [],
    $: getElement,
    db: { from: () => ({ insert: (row) => { inserted = row; return Promise.resolve({ error: null }); } }) },
    traerTodo: async () => ({ data: [], error: null }),
    esFechaFutura: () => false,
    num: (value) => Number(value) || 0,
    spinner: () => "Cargando",
    botonCajas: () => "",
    formatearFecha: (value) => value || "—",
    valor: (value) => String(value ?? "—"),
    campanaNombre: () => "Campaña",
    actualizarContador() {},
    pintarResumenCiclos() {},
    toast: (message) => { app.lastToast = message; },
    cerrarModal: (modal) => modal.classList.remove("open"),
  };
  const context = loadModule("registros.js", app, {
    document: { addEventListener() {}, querySelector: () => null },
    window: { App: app, addEventListener() {} },
  });
  context.window.App.configurarEventosRegistros();
  return {
    app,
    form,
    button,
    get inserted() { return inserted; },
  };
}

test("registros render shared invoice groups and mark settled entries", () => {
  const ids = [
    "cajasPopover", "filtroFacturaReg", "filtroFechaDesde", "filtroFechaHasta",
    "tablaRegistros", "registrosVacio", "btnExport", "ordenFechaIcono",
  ];
  const elements = new Map(ids.map((id) => [id, createElement()]));
  const body = createElement();
  const app = {
    state: {
      registrosActuales: [
        { id: 1, fecha: "2026-03-01", num_factura: " F-1 ", cajas_entradas: 10, comentarios: "<nota>" },
        { id: 2, fecha: "2026-03-02", num_factura: "F-1", cajas_entradas: 5, liquidacion_id: 4, origen: "bascula" },
      ],
      agrupadoPorFactura: true,
      ordenFechaAsc: false,
    },
    dom: { cuerpoRegistros: body },
    COLORES_FACTURA: ["#abc"],
    $: (id) => elements.get(id) || null,
    botonCajas: (registro) => `<button>${registro.cajas_entradas}</button>`,
    formatearFecha: (value) => value || "—",
    valor: (value) => escapeHtml(value ?? "—"),
    campanaNombre: () => "Campaña",
    actualizarContador: (id, count, singular, plural) => { app.count = `${count} ${count === 1 ? singular : plural}`; },
  };
  const module = loadModule("registros.js", app).window.App;
  module.pintarRegistros(app.state.registrosActuales);

  assert.equal(elements.get("tablaRegistros").hidden, false);
  assert.equal(elements.get("btnExport").disabled, false);
  assert.match(body.innerHTML, /factura-grupo/);
  assert.match(body.innerHTML, /Liquidado/);
  assert.match(body.innerHTML, /Báscula/);
  assert.match(body.innerHTML, /&lt;nota&gt;/);
  assert.equal(app.count, "2 registros");
});

test("registros save exponential notation as its full integer value", async () => {
  const harness = createRegistroSaveHarness("1e3");
  await harness.form.listeners.get("submit")[0]({
    preventDefault() {},
    submitter: harness.button,
  });
  assert.equal(harness.inserted.cajas_entradas, 1000);
});

test("registros reject non-integer numeric values instead of truncating them", async () => {
  const harness = createRegistroSaveHarness("1.5");
  await harness.form.listeners.get("submit")[0]({
    preventDefault() {},
    submitter: harness.button,
  });
  assert.equal(harness.inserted, null);
  assert.match(harness.app.lastToast, /número entero/);
});
