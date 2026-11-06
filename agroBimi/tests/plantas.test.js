const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement, loadModule } = require("./helpers");

function createPlantaSaveHarness(numPlantas) {
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, createElement());
    return elements.get(id);
  };
  getElement("plantaAgricultor").value = "5";
  getElement("plantaCampana").value = "4";
  getElement("plantaCiclo").value = "1";
  getElement("plantaFecha").value = "2026-03-01";
  getElement("plantaNumPlantas").value = numPlantas;
  const button = createElement();
  const form = createElement({ querySelector: () => button });
  const body = createElement();
  let inserted = null;
  const app = {
    state: { agricultorAbierto: null, plantasActuales: [] },
    dom: { formPlanta: form, modalPlanta: createElement() },
    $: getElement,
    db: { from: () => ({ insert: (row) => { inserted = row; return Promise.resolve({ error: null }); } }) },
    traerTodo: async () => ({ data: [], error: null }),
    consultar: async (promise) => (await promise).data,
    esFechaFutura: () => false,
    num: (value) => Number(value) || 0,
    fmtNum: String,
    spinnerFila: (span, message) => `<tr><td colspan="${span}">${message}</td></tr>`,
    filaMensaje: (span, message) => `<tr><td colspan="${span}">${message}</td></tr>`,
    actualizarContador() {},
    cerrarModal: (modal) => modal.classList.remove("open"),
    toast: (message) => { app.lastToast = message; },
  };
  const module = loadModule("plantas.js", app).window.App;
  module.configurarEventosPlantas();
  return {
    app,
    form,
    button,
    get inserted() { return inserted; },
  };
}

test("plantas groups harvest performance by farmer, season, and normalized cycle", () => {
  const app = {
    state: {},
    cicloValido: (value) => String(value || "").match(/[123]/)?.[0] || "",
    num: (value) => Number(value) || 0,
    campanaNombre: (id) => String(id),
    agricultorPorId: (id) => ({ nombre: String(id) }),
  };
  const module = loadModule("plantas.js", app).window.App;
  const groups = module.agruparRendimiento(
    [
      { agricultor_id: 5, campana_id: 2, ciclo: "Ciclo 1", num_plantas: 100, fecha: "2026-01-02" },
      { agricultor_id: 5, campana_id: 2, ciclo: "1", num_plantas: 50, fecha: "2026-01-01" },
    ],
    [
      { agricultor_id: 5, campana_id: 2, ciclo: "1", cajas_entradas: 30, descuento_cajas: 3, fecha: "2026-01-05" },
      { agricultor_id: 8, campana_id: 2, ciclo: "2", cajas_entradas: 4, fecha: "2026-01-06" },
      { agricultor_id: 9, campana_id: 2, ciclo: "3", cajas_entradas: 0, fecha: null },
    ]
  );

  assert.equal(groups.length, 2);
  const combined = groups.find((group) => group.agricultor_id === 5);
  assert.equal(combined.ciclo, "1");
  assert.equal(combined.plantas, 150);
  assert.equal(combined.cajasNetas, 27);
  assert.equal(combined.rendimiento, 0.2);
  assert.equal(combined.rendimientoNeto, 0.18);
  assert.equal(combined.dias, 4);
  assert.equal(groups.find((group) => group.agricultor_id === 8).rendimiento, null);
});

test("plantas save exponential notation as the full plant count", async () => {
  const harness = createPlantaSaveHarness("1e3");
  await harness.form.listeners.get("submit")[0]({
    preventDefault() {},
  });
  assert.equal(harness.inserted.num_plantas, 1000);
});

test("plantas reject fractional counts rather than saving a truncated number", async () => {
  const harness = createPlantaSaveHarness("1.5");
  await harness.form.listeners.get("submit")[0]({
    preventDefault() {},
  });
  assert.equal(harness.inserted, null);
  assert.match(harness.app.lastToast, /número entero positivo/);
});
