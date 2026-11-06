const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement, fakeQuery, loadModule } = require("./helpers");

function createPaletSaveHarness(cantidad) {
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, createElement());
    return elements.get(id);
  };
  const input = createElement({
    value: cantidad,
    dataset: { registro: "12", maxFila: "2000" },
  });
  const button = createElement();
  const form = createElement();
  let rpcArgs = null;
  let toast = "";
  const app = {
    state: {},
    dom: {
      formPalet: form,
      modalPalet: createElement(),
      modalPalets: createElement(),
    },
    $: getElement,
    db: { rpc: async (_name, args) => { rpcArgs = args; return { data: 4, error: null }; } },
    paramNum: () => 2000,
    num: (value) => Number(value) || 0,
    fmtNum: String,
    toast: (message) => { toast = message; },
    cerrarModal() {},
    salidasAbierto: () => false,
  };
  const module = loadModule("palets.js", app, {
    document: { querySelectorAll: () => [input] },
  }).window.App;
  module.configurarEventosPalets();
  return {
    app,
    form,
    button,
    input,
    get rpcArgs() { return rpcArgs; },
    get toast() { return toast; },
  };
}

test("palets loads both camera datasets and determines pallet completion", async () => {
  const calls = [];
  const responses = {
    palets: { data: [{ id: 1, num_cajas: 60 }], error: null },
    paletizado_entradas: { data: [{ registro_id: 8, disponible: 5 }], error: null },
  };
  const app = {
    state: { paletsActuales: [], entradasPaletizado: [] },
    db: { from: (table) => { calls.push(table); return fakeQuery(responses[table]); } },
    traerTodo: (createQuery) => createQuery(),
    consultar: async (promise) => (await promise).data,
    paramNum: () => 60,
    num: (value) => Number(value) || 0,
  };
  const module = loadModule("palets.js", app).window.App;

  assert.equal(await module.cargarDatosPaletizado(), true);
  assert.equal(module.cajasPorPalet(), 60);
  assert.equal(module.estadoPalet(app.state.paletsActuales[0]), "completo");
  assert.equal(app.state.entradasPaletizado[0].registro_id, 8);
  assert.deepEqual(calls, ["palets", "paletizado_entradas"]);
});

test("palets preserve current data if either camera query fails", async () => {
  const oldPalets = [{ id: 99 }];
  const app = {
    state: { paletsActuales: oldPalets, entradasPaletizado: [] },
    db: { from: (table) => fakeQuery({
      data: table === "palets" ? [{ id: 1 }] : null,
      error: table === "paletizado_entradas" ? { message: "offline" } : null,
    }) },
    traerTodo: (createQuery) => createQuery(),
    consultar: async (promise) => {
      const { data, error } = await promise;
      return error ? null : data;
    },
    paramNum: () => 60,
    num: Number,
  };
  const module = loadModule("palets.js", app).window.App;
  assert.equal(await module.cargarDatosPaletizado(), false);
  assert.equal(app.state.paletsActuales, oldPalets);
});

test("palets preserve exponential notation as its full integer quantity", async () => {
  const harness = createPaletSaveHarness("1e3");
  await harness.form.listeners.get("submit")[0]({
    preventDefault() {},
    submitter: harness.button,
  });
  assert.equal(harness.rpcArgs.p_lineas[0].num_cajas, 1000);
});

test("palets reject fractional quantities instead of truncating them", async () => {
  const harness = createPaletSaveHarness("1.5");
  await harness.form.listeners.get("submit")[0]({
    preventDefault() {},
    submitter: harness.button,
  });
  assert.equal(harness.rpcArgs, null);
  assert.match(harness.toast, /número entero/);
});
