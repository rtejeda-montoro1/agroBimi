const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement, loadModule, fakeQuery } = require("./helpers");

function createAjustesHarness(responses, defaults = { precio_kg: "0", emisor_nombre: "" }) {
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
    data: [{ clave: "precio_kg", valor: "1.25" }, { clave: "emisor_nombre", valor: "" }],
    error: null,
  }], { precio_kg: "0", emisor_nombre: "", iva_porcentaje: "12" });
  assert.equal(await module.cargarParametros(), true);
  assert.equal(module.param("precio_kg"), "1.25");
  assert.equal(module.param("emisor_nombre"), "");
  assert.equal(module.param("iva_porcentaje"), "12");
});

test("ajustes load failure keeps defaults and reports failure", async () => {
  const { app, module } = createAjustesHarness([{
    data: null,
    error: { message: "offline" },
  }], { precio_kg: "2.50" });
  assert.equal(await module.cargarParametros(), false);
  assert.equal(app.state.parametros.precio_kg, "2.50");
  assert.match(app.lastToast, /offline/);
});

test("ajustes open the collapsed section of a field that fails validation", () => {
  const { app, module, elements } = createAjustesHarness([]);
  app.dom.formAjustes = createElement();
  elements.set("btnAjustes", createElement());
  module.configurarEventosAjustes();

  const seccion = { open: false };
  const campo = { closest: (sel) => (sel === "details" ? seccion : null) };
  app.dom.formAjustes.dispatch("invalid", { target: campo });
  assert.equal(seccion.open, true);

  // Un campo fuera de cualquier sección no falla.
  app.dom.formAjustes.dispatch("invalid", { target: { closest: () => null } });
});

test("ajustes sections are collapsible and all start closed", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const form = html.slice(html.indexOf('<form id="formAjustes"'), html.indexOf("</form>", html.indexOf('<form id="formAjustes"')));
  const secciones = form.match(/<details class="bloque-plegable"[^>]*>/g) || [];
  assert.equal(secciones.length, 5);
  assert.equal(secciones.filter((s) => / open\b/.test(s)).length, 0);
  assert.doesNotMatch(form, /factura-bloque/);
});

test("ajustes do not open or save over the real values when they could not be loaded", async () => {
  const { app, module, elements, calls } = createAjustesHarness([
    { data: null, error: { message: "offline" } },   // al entrar
    { data: null, error: { message: "offline" } },   // al abrir Ajustes
    { data: [{ clave: "precio_kg", valor: "1.25" }], error: null },
  ]);
  elements.set("aj_precio_kg", createElement());
  assert.equal(await module.cargarParametros(), false);

  await module.abrirAjustes();
  assert.equal(app.dom.modalAjustes.classList.contains("open"), false);
  assert.match(app.lastToast, /No se han podido cargar los ajustes/);

  app.dom.formAjustes = createElement();
  elements.set("btnAjustes", createElement());
  module.configurarEventosAjustes();
  app.dom.formAjustes.dispatch("submit", { preventDefault() {} });
  await new Promise((r) => setImmediate(r));
  assert.match(app.lastToast, /no se guarda nada/);
  assert.equal(calls.some((c) => c[0] === "upsert"), false);

  // Al volver a intentarlo con red, se abre con los valores reales.
  await module.abrirAjustes();
  assert.equal(app.dom.modalAjustes.classList.contains("open"), true);
  assert.equal(elements.get("aj_precio_kg").value, "1.25");
});
