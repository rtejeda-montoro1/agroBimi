const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement, loadModule, fakeQuery } = require("./helpers");

const SELECT_IDS = [
  "campana_id", "selBuscarCampana", "plantaCampana", "liqCampana",
  "filtroCampanaPlantas", "filtroCampanaCajas", "filtroCampanaLiq",
];

function createCampanasHarness(response) {
  const calls = [];
  const elements = new Map(SELECT_IDS.map((id) => [id, createElement()]));
  const app = {
    state: { campanasActuales: [] },
    db: {
      from(table) {
        calls.push(["from", table]);
        return fakeQuery(response, (method, args) => calls.push([method, ...args]));
      },
    },
    $: (id) => elements.get(id) || null,
    escapar: (value) => String(value).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])),
    toast: (message) => { app.lastToast = message; },
  };
  const context = loadModule("campanas.js", app);
  return { app, module: context.window.App, elements, calls };
}

test("campanas populate selectors and choose the greatest id by default", async () => {
  const { app, module, elements } = createCampanasHarness({
    data: [{ id: 4, nombre: "2025/26" }, { id: 8, nombre: "<2026/27>" }],
    error: null,
  });
  assert.equal(await module.cargarCampanas(), true);
  assert.equal(module.campanaPorDefecto(), "8");
  assert.match(elements.get("campana_id").innerHTML, /&lt;2026\/27&gt;/);
  assert.equal(elements.get("campana_id").disabled, false);
  assert.equal(elements.get("filtroCampanaCajas").innerHTML.startsWith(
    '<option value="">Todas las campañas</option>'), true);

  module.ponerCampana(elements.get("liqCampana"), null);
  assert.equal(elements.get("liqCampana").value, "8");
});

test("campanas load failure preserves current state and reports failure", async () => {
  const { app, module } = createCampanasHarness({
    data: null,
    error: { message: "offline" },
  });
  app.state.campanasActuales = [{ id: 2, nombre: "Anterior" }];
  assert.equal(await module.cargarCampanas(), false);
  assert.equal(app.state.campanasActuales[0].nombre, "Anterior");
  assert.match(app.lastToast, /offline/);
});
