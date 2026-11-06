const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement, loadModule, fakeQuery } = require("./helpers");

function createAjustesHarness(responses, defaults = { precio_caja: "0", emisor_nombre: "" }) {
  const calls = [];
  const elements = new Map();
  const app = {
    PARAMETROS_DEFECTO: defaults,
    state: { parametros: {} },
    dom: { modalAjustes: createElement() },
    db: {
      from(table) {
        calls.push(["from", table]);
        const response = responses.shift();
        return fakeQuery(response, (method, args) => calls.push([method, ...args]));
      },
    },
    $: (id) => elements.get(id) || null,
    num: (value) => Number(value) || 0,
    toast: (message) => { app.lastToast = message; },
    abrirModal: (modal) => modal.classList.add("open"),
    cerrarModal: (modal) => modal.classList.remove("open"),
    aplicarAjustesALiquidacion: (previous) => { app.previousSettings = previous; },
  };
  const context = loadModule("ajustes.js", app);
  return { app, module: context.window.App, elements, calls };
}

test("ajustes merge saved values with defaults and use defaults for blanks", async () => {
  const { app, module } = createAjustesHarness([{
    data: [{ clave: "precio_caja", valor: "1.25" }, { clave: "emisor_nombre", valor: "" }],
    error: null,
  }], { precio_caja: "0", emisor_nombre: "", iva_porcentaje: "12" });
  assert.equal(await module.cargarParametros(), true);
  assert.equal(module.param("precio_caja"), "1.25");
  assert.equal(module.param("emisor_nombre"), "");
  assert.equal(module.param("iva_porcentaje"), "12");
});

test("ajustes load failure keeps defaults and reports failure", async () => {
  const { app, module } = createAjustesHarness([{
    data: null,
    error: { message: "offline" },
  }], { precio_caja: "2.50" });
  assert.equal(await module.cargarParametros(), false);
  assert.equal(app.state.parametros.precio_caja, "2.50");
  assert.match(app.lastToast, /offline/);
});
