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

test("campanas are only added from the campaign search, and every wired button exists", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const js = fs.readFileSync(path.join(__dirname, "..", "js", "campanas.js"), "utf8");

  const vistaAgricultor = html.match(/<section id="vistaRegistros"[\s\S]*?<\/section>/)[0];
  assert.doesNotMatch(vistaAgricultor, /Añadir campaña/);
  assert.doesNotMatch(html, /id="btnAnadirCampana"/);
  assert.match(html, /id="btnAnadirCampanaBuscar"/);

  const eventos = js.match(/function configurarEventosCampanas\(\) \{[\s\S]*?\n  \}/)[0];
  const ids = [...eventos.matchAll(/App\.\$\("([^"]+)"\)\.addEventListener/g)].map((m) => m[1]);
  assert.ok(ids.length > 0);
  for (const id of ids) assert.match(html, new RegExp(`id="${id}"`), `falta #${id} en index.html`);
});

test("campaign search lists one page filtered by campaign and farmer, and Export asks what to export", async () => {
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, createElement());
    return elements.get(id);
  };
  const pagina = Array.from({ length: 150 }, (_, i) => ({ id: i + 1, agricultor_id: 3, agricultores: { nombre: "Ana", codigo: 3 } }));
  const consultas = [];
  const exportados = [];
  const app = {
    state: { campanasActuales: [{ id: 8, nombre: "2026/27" }], registrosCampanaActuales: [] },
    dom: { modalBuscarCampana: createElement(), formCampana: createElement() },
    $: getElement,
    db: { from: (table) => {
      assert.equal(table, "registros");
      const llamadas = [];
      consultas.push(llamadas);
      return fakeQuery({ data: pagina, error: null, count: 400 }, (method, args) => llamadas.push([method, ...args]));
    } },
    traerTodo: async (createQuery) => {
      const r = await createQuery();
      return { data: [...r.data, ...r.data], error: null };
    },
    agricultoresQueCoinciden: (texto) => (texto === "ana" ? [{ id: 3 }, { id: 9 }] : []),
    escapar: String,
    valor: String,
    fmtNum: String,
    fmtCodigo: String,
    formatearFecha: String,
    botonCajas: () => "",
    spinnerFila: () => "",
    filaMensaje: (_columns, text) => text,
    actualizarContador: (_id, count) => { app.count = count; },
    exportarExcelCampana: (regs) => exportados.push(regs),
    toast() {},
  };
  loadModule("paginacion.js", app);
  const module = loadModule("campanas.js", app, { document: { addEventListener() {} } }).window.App;
  module.configurarEventosCampanas();
  const sel = getElement("selBuscarCampana");
  sel.value = "8";
  getElement("filtroAgriCampana").value = "ana";

  sel.dispatch("change", { target: sel });
  await new Promise((resolve) => setImmediate(resolve));

  const q = consultas.at(-1);
  assert.ok(q.some((c) => c[0] === "eq" && c[1] === "campana_id" && c[2] === "8"));
  assert.ok(q.some((c) => c[0] === "in" && c[1] === "agricultor_id" && c[2].join() === "3,9"));
  assert.ok(q.some((c) => c[0] === "range" && c[1] === 0 && c[2] === 149));
  assert.equal(app.count, 400);
  assert.equal(getElement("paginaCampana").textContent, "1–150 · página 1 de 3");
  assert.equal(getElement("paginacionCampanaAbajo").hidden, false);
  assert.equal(getElement("btnExportCampana").disabled, false);

  // Hay más registros que los de la página: Export pregunta.
  getElement("btnExportCampana").dispatch("click", { stopPropagation() {} });
  assert.equal(getElement("menuExportCampana").hidden, false);
  assert.match(getElement("btnExportCampanaTodo").textContent, /400/);

  getElement("btnExportCampanaPagina").dispatch("click");
  assert.equal(exportados.at(-1).length, 150);
  assert.equal(getElement("menuExportCampana").hidden, true);

  getElement("btnExportCampanaTodo").dispatch("click");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(exportados.at(-1).length, 300);
  assert.ok(!consultas.at(-1).some((c) => c[0] === "range"));
  assert.ok(consultas.at(-1).some((c) => c[0] === "in"));

  // Ningún agricultor encaja con el texto: la consulta sale vacía.
  getElement("filtroAgriCampana").value = "zzz";
  sel.dispatch("change", { target: sel });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(consultas.at(-1).some((c) => c[0] === "in" && c[2].join() === "-1"));
});

test("farmers match the campaign filter by name without accents or by code", () => {
  const app = {
    state: { agricultoresTodos: [
      { id: 1, nombre: "José Pérez", codigo: 7 },
      { id: 2, nombre: "Ana", codigo: 12 },
      { id: 3, nombre: "Luis", codigo: 120 },
    ] },
  };
  const module = loadModule("agricultores.js", app).window.App;
  assert.deepEqual(module.agricultoresQueCoinciden("jose").map((a) => a.id), [1]);
  assert.deepEqual(module.agricultoresQueCoinciden("007").map((a) => a.id), [1]);
  assert.deepEqual(module.agricultoresQueCoinciden("12").map((a) => a.id), [2, 3]);
});
