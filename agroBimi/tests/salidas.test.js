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
    state: { albaranesActuales: [], albaranesHistorial: [], paletsActuales: [], paletsCamara: [] },
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

test("salidas loads one page filtered on the server, safely rendering totals and destinations", async () => {
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, createElement());
    return elements.get(id);
  };
  const modal = createElement();
  modal.classList.add("open");
  const rows = [
    { id: 1, numero: "ALB-1", fecha: "2026-03-01", destinatario_nombre: "<Tienda>", matricula: "AA-1", palets: [{ num_cajas: 60 }, { num_cajas: 10 }] },
    { id: 2, numero: "ALB-2", fecha: "2026-04-01", destinatario_nombre: "Otro", palets: [] },
  ];
  // Servidor de mentira: aplica el ilike del destinatario como Supabase.
  const consultas = [];
  const app = {
    state: { albaranesActuales: [] },
    dom: { modalSalidas: modal },
    db: { from: (table) => {
      assert.equal(table, "albaranes_salida");
      const llamadas = [];
      consultas.push(llamadas);
      const respuesta = {
        error: null,
        get data() {
          const ilike = llamadas.find((c) => c[0] === "ilike");
          const texto = ilike ? ilike[2].replace(/%/g, "").toLowerCase() : "";
          return rows.filter((r) => r.destinatario_nombre.toLowerCase().includes(texto));
        },
        get count() { return this.data.length; },
      };
      return fakeQuery(respuesta, (method, args) => llamadas.push([method, ...args]));
    } },
    $: getElement,
    toast: (message) => { app.lastToast = message; },
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
  loadModule("paginacion.js", app);
  const module = loadModule("salidas.js", app).window.App;
  getElement("filtroDestinoSalidas").value = "tienda";
  getElement("filtroDesdeSalidas").value = "2026-01-01";
  await module.cargarAlbaranes();

  const q = consultas.at(-1);
  assert.ok(q.some((c) => c[0] === "ilike" && c[1] === "destinatario_nombre" && c[2] === "%tienda%"));
  assert.ok(q.some((c) => c[0] === "gte" && c[1] === "fecha" && c[2] === "2026-01-01"));
  assert.ok(q.some((c) => c[0] === "range" && c[1] === 0 && c[2] === 149));
  assert.equal(module.salidasAbierto(), true);
  assert.equal(app.state.albaranesActuales.length, 1);
  assert.equal(app.count, "1 albarán");
  assert.match(getElement("cuerpoAlbaranes").innerHTML, /&lt;Tienda&gt;/);
  assert.match(getElement("cuerpoAlbaranes").innerHTML, /AA-1/);
  assert.match(getElement("cuerpoAlbaranes").innerHTML, />70</);
  assert.doesNotMatch(getElement("cuerpoAlbaranes").innerHTML, /ALB-2/);
  assert.equal(getElement("btnExportSalidas").disabled, false);
  assert.equal(getElement("paginacionSalidas").hidden, true);

  // Sin albaranes que mostrar no hay nada que exportar.
  getElement("filtroDestinoSalidas").value = "nadie";
  await module.cargarAlbaranes();
  assert.equal(app.count, "0 albaranes");
  assert.equal(getElement("btnExportSalidas").disabled, true);
});

test("salidas report history errors and do not open an incomplete form", async () => {
  const error = { message: "offline" };
  const { app, form, modal, module } = createSalidaHarness({ data: null, error });

  await module.abrirModalSalida();

  assert.match(app.lastToast, /Error al cargar los albaranes anteriores: offline/);
  assert.equal(form.resetCount || 0, 0);
  assert.equal(modal.classList.contains("open"), false);
  assert.equal(app.state.albaranesHistorial.length, 0);
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
  assert.equal(app.state.albaranesHistorial[0], previous);
  assert.match(elements.get("listaDestinatarios").innerHTML, /Cliente habitual/);
  assert.equal(elements.get("salidaLugarCarga").value, "Granada");
  assert.equal(elements.get("salidaMarcas").value, "Verde");
  assert.equal(modal.classList.contains("open"), true);
});

test("salidas search a destination with % or _ literally, not as wildcards", async () => {
  const llamadas = [];
  const app = {
    state: { albaranesActuales: [] },
    dom: { modalSalidas: createElement() },
    db: { from: () => fakeQuery({ data: [], error: null, count: 0 }, (method, args) => llamadas.push([method, ...args])) },
    $: (() => { const m = new Map(); return (id) => { if (!m.has(id)) m.set(id, createElement()); return m.get(id); }; })(),
    spinnerFila: () => "",
    filaMensaje: () => "",
    actualizarContador() {},
    fmtNum: String,
    toast() {},
  };
  loadModule("paginacion.js", app);
  const module = loadModule("salidas.js", app).window.App;
  app.$("filtroDestinoSalidas").value = "50%_ofertas";
  await module.cargarAlbaranes();
  assert.ok(llamadas.some((c) => c[0] === "ilike" && c[2] === "%50\\%\\_ofertas%"));
});
