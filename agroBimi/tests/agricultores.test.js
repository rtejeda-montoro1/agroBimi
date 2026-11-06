const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement, loadModule, fakeQuery, escapeHtml } = require("./helpers");

function createAgricultoresHarness(response) {
  const calls = [];
  const elements = new Map();
  for (const id of [
    "buscarAgricultor", "listaAgricultores", "countAgricultores",
    "plantaAgricultor", "liqAgricultor", "filtroAgriPlantas",
    "filtroAgriCajas", "filtroAgriLiq", "filtroAgriPalets",
  ]) elements.set(id, createElement());
  const app = {
    state: { agricultoresActuales: [], agricultoresTodos: [] },
    dom: { listaAgricultores: elements.get("listaAgricultores") },
    db: {
      from(table) {
        calls.push(["from", table]);
        return fakeQuery(response, (method, args) => calls.push([method, ...args]));
      },
    },
    $: (id) => elements.get(id),
    traerTodo: async (build) => { build(); return response; },
    escapar: escapeHtml,
    fmtCodigo: (value) => String(value).padStart(3, "0"),
    actualizarContador: (...args) => { app.count = args; },
  };
  const context = loadModule("agricultores.js", app);
  return { app, module: context.window.App, elements, calls };
}

test("agricultores load and render complete results safely", async () => {
  const { app, module, elements } = createAgricultoresHarness({
    data: [{ id: 1, codigo: 7, nombre: "<Proveedor & Asociado>" }],
    error: null,
  });
  assert.equal(await module.cargarAgricultores(), true);
  assert.equal(app.state.agricultoresTodos[0].id, 1);
  assert.match(elements.get("listaAgricultores").innerHTML, /&lt;Proveedor &amp; Asociado&gt;/);
  assert.match(elements.get("liqAgricultor").innerHTML, /007 · &lt;Proveedor/);
  assert.deepEqual(app.count, ["countAgricultores", 1, "agricultor", "agricultores"]);
});

test("agricultores search escapes filter syntax and matches numeric codes", async () => {
  const { module, elements, calls } = createAgricultoresHarness({ data: [], error: null });
  elements.get("buscarAgricultor").value = "007";
  await module.cargarAgricultores();

  const orCall = calls.find(([name]) => name === "or");
  assert.deepEqual(orCall, ["or", 'nombre.ilike."%007%",codigo.eq.7']);
});

test("agricultores load failure returns false and escapes the error", async () => {
  const { module, elements } = createAgricultoresHarness({
    data: null,
    error: { message: "<sin conexión>" },
  });
  assert.equal(await module.cargarAgricultores(), false);
  assert.match(elements.get("listaAgricultores").innerHTML, /&lt;sin conexión&gt;/);
});
