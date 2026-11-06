const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement, escapeHtml, fakeQuery, loadModule } = require("./helpers");

function createSalidaHarness(queryResponse) {
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) {
      elements.set(id, createElement(id === "salidaPeso" ? { dataset: {} } : {}));
    }
    return elements.get(id);
  };
  const modal = createElement();
  const form = createElement({ reset() { this.resetCount = (this.resetCount || 0) + 1; } });
  const app = {
    state: { albaranesActuales: [], paletsActuales: [] },
    dom: { modalSalida: modal, formSalida: form },
    db: { from: () => fakeQuery(queryResponse) },
    $: getElement,
    asegurarAgricultoresTodos: async () => {},
    cargarDatosPaletizado: async () => true,
    traerTodo: (createQuery) => createQuery(),
    hoyISO: () => "2026-03-01",
    escapar: escapeHtml,
    filaMensaje: (span, message) => `<tr><td colspan="${span}">${message}</td></tr>`,
    abrirModal: (element) => element.classList.add("open"),
    toast: (message) => { app.lastToast = message; },
    num: (value) => Number(value) || 0,
    fmtNum: String,
    redondear: (value) => Math.round(value * 100) / 100,
    paramNum: () => 9.25,
  };
  const context = loadModule("salidas.js", app, {
    document: { querySelectorAll: () => [] },
  });
  return { app, elements, form, modal, module: context.window.App };
}

test("salidas loads and filters albaranes, safely rendering totals and destinations", async () => {
  const ids = ["cuerpoAlbaranes", "filtroDesdeSalidas", "filtroHastaSalidas", "filtroDestinoSalidas", "countAlbaranes"];
  const elements = new Map(ids.map((id) => [id, createElement()]));
  const modal = createElement();
  modal.classList.add("open");
  const rows = [
    { id: 1, numero: "ALB-1", fecha: "2026-03-01", destinatario_nombre: "<Tienda>", matricula: "AA-1", palets: [{ num_cajas: 60 }, { num_cajas: 10 }] },
    { id: 2, numero: "ALB-2", fecha: "2026-04-01", destinatario_nombre: "Otro", palets: [] },
  ];
  const app = {
    state: { albaranesActuales: [] },
    dom: { modalSalidas: modal },
    db: { from: (table) => {
      assert.equal(table, "albaranes_salida");
      return fakeQuery({ data: rows, error: null });
    } },
    $: (id) => elements.get(id) || null,
    traerTodo: (createQuery) => createQuery(),
    consultar: async (promise) => (await promise).data,
    spinnerFila: () => "<tr>loading</tr>",
    filaMensaje: (span, message) => `<tr><td colspan="${span}">${message}</td></tr>`,
    actualizarContador: (id, count, singular, plural) => { app.count = `${count} ${count === 1 ? singular : plural}`; },
    fechaEnRango: (date, from, to) => (!from || date >= from) && (!to || date <= to),
    valor: (value) => escapeHtml(value ?? "—"),
    formatearFecha: (value) => value,
    fmtNum: String,
    num: (value) => Number(value) || 0,
  };
  const module = loadModule("salidas.js", app).window.App;
  elements.get("filtroDestinoSalidas").value = "tienda";
  await module.cargarAlbaranes();

  assert.equal(module.salidasAbierto(), true);
  assert.equal(app.state.albaranesActuales.length, 2);
  assert.equal(app.count, "1 albarán");
  assert.match(elements.get("cuerpoAlbaranes").innerHTML, /&lt;Tienda&gt;/);
  assert.match(elements.get("cuerpoAlbaranes").innerHTML, /AA-1/);
  assert.match(elements.get("cuerpoAlbaranes").innerHTML, />70</);
  assert.doesNotMatch(elements.get("cuerpoAlbaranes").innerHTML, /ALB-2/);
});

test("salidas report history errors and do not open an incomplete form", async () => {
  const error = { message: "offline" };
  const { app, form, modal, module } = createSalidaHarness({ data: null, error });

  await module.abrirModalSalida();

  assert.match(app.lastToast, /Error al cargar los albaranes anteriores: offline/);
  assert.equal(form.resetCount || 0, 0);
  assert.equal(modal.classList.contains("open"), false);
  assert.equal(app.state.albaranesActuales.length, 0);
});

test("salidas use the latest history when opening a new form", async () => {
  const previous = {
    destinatario_nombre: "Cliente habitual",
    lugar_carga: "Granada",
    marcas: "Verde",
    naturaleza: "Bimi",
  };
  const { app, elements, form, modal, module } = createSalidaHarness({
    data: [previous],
    error: null,
  });

  await module.abrirModalSalida();

  assert.equal(form.resetCount, 1);
  assert.equal(app.state.albaranesActuales[0], previous);
  assert.match(elements.get("listaDestinatarios").innerHTML, /Cliente habitual/);
  assert.equal(elements.get("salidaLugarCarga").value, "Granada");
  assert.equal(elements.get("salidaMarcas").value, "Verde");
  assert.equal(modal.classList.contains("open"), true);
});
