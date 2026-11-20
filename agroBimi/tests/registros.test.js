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
    fmtNum: String,
    cicloValido: (v) => String(v ?? "").match(/[123]/)?.[0] || "",
  };
  loadModule("paginacion.js", app);
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

// La ficha de un agricultor con sus registros ya cargados.
async function createFichaHarness(registros) {
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, createElement());
    return elements.get(id);
  };
  const body = createElement();
  const exportados = [];
  const app = {
    state: { agricultorAbierto: { id: 5, nombre: "Ana" }, registrosActuales: [], agrupadoPorFactura: false, ordenFechaAsc: false },
    dom: { cuerpoRegistros: body, formRegistro: createElement() },
    COLORES_FACTURA: [],
    $: getElement,
    traerTodo: async () => ({ data: registros, error: null }),
    spinner: () => "Cargando",
    botonCajas: () => "",
    formatearFecha: (value) => value || "—",
    valor: (value) => String(value ?? "—"),
    campanaNombre: () => "Campaña",
    actualizarContador: (_id, count) => { app.count = count; },
    pintarResumenCiclos() {},
    fmtNum: String,
    cicloValido: (v) => String(v ?? "").match(/[123]/)?.[0] || "",
    exportarExcel: (regs) => exportados.push(regs),
    mostrarVistaRegistros() {},
    cargarRetiradasAgricultor: async () => {},
    fmtCodigo: String,
    escapar: String,
  };
  loadModule("paginacion.js", app);
  const module = loadModule("registros.js", app, {
    document: { addEventListener() {}, querySelector: () => null },
    window: { App: app, addEventListener() {} },
  }).window.App;
  module.configurarEventosRegistros();
  await module.abrirAgricultor(app.state.agricultorAbierto);
  const filas = () => (body.innerHTML.match(/data-edit-reg="(\d+)"/g) || [])
    .map((m) => Number(m.match(/\d+/)[0]));
  return { app, elements: { get: getElement }, module, filas, exportados };
}

test("registros of a farmer are shown 150 per page, from the loaded data", async () => {
  const registros = Array.from({ length: 400 }, (_, i) => ({ id: i + 1, fecha: "2026-03-01" }));
  const { app, elements, filas } = await createFichaHarness(registros);

  assert.equal(app.count, 400);
  assert.equal(filas().length, 150);
  assert.equal(filas()[0], 1);
  assert.equal(elements.get("paginaRegistros").textContent, "1–150 · página 1 de 3");
  assert.equal(elements.get("paginacionRegistrosAbajo").hidden, false);

  await elements.get("btnPaginaSiguienteRegistros").listeners.get("click")[0]();
  assert.equal(filas()[0], 151);
  assert.equal(elements.get("paginaRegistros").textContent, "151–300 · página 2 de 3");
});

test("registros filter by campaign and cycle and go back to the first page", async () => {
  const registros = [
    ...Array.from({ length: 200 }, (_, i) => ({ id: i + 1, campana_id: 4, ciclo: "1" })),
    { id: 301, campana_id: 5, ciclo: "Ciclo 2" },
    { id: 302, campana_id: 5, ciclo: "1" },
    { id: 303, campana_id: 4, ciclo: "2" },
  ];
  const { app, elements, filas } = await createFichaHarness(registros);
  await elements.get("btnPaginaSiguienteRegistros").listeners.get("click")[0]();

  elements.get("filtroCampanaReg").value = "5";
  elements.get("filtroCampanaReg").dispatch("change");
  assert.deepEqual(filas(), [301, 302]);
  assert.equal(app.count, 2);
  assert.equal(elements.get("paginacionRegistros").hidden, true);

  elements.get("filtroCicloReg").value = "2";
  elements.get("filtroCicloReg").dispatch("change");
  assert.deepEqual(filas(), [301]);

  elements.get("btnLimpiarFiltrosReg").dispatch("click");
  assert.equal(app.count, 203);
  assert.equal(elements.get("filtroCampanaReg").value, "");
  assert.equal(elements.get("paginaRegistros").textContent, "1–150 · página 1 de 2");
});

test("registros export asks for the filtered view or everything only when filtering", async () => {
  const registros = [
    { id: 1, campana_id: 4, ciclo: "1" },
    { id: 2, campana_id: 5, ciclo: "1" },
    { id: 3, campana_id: 5, ciclo: "2" },
  ];
  const { elements, module, exportados } = await createFichaHarness(registros);
  const menu = elements.get("menuExportReg");
  menu.hidden = true;

  // Sin filtros: todo, sin preguntar.
  module.pulsarExportRegistros();
  assert.deepEqual([...exportados.at(-1)].map((r) => r.id), [1, 2, 3]);
  assert.equal(menu.hidden, true);

  elements.get("filtroCampanaReg").value = "5";
  elements.get("filtroCampanaReg").dispatch("change");
  module.pulsarExportRegistros();
  assert.equal(menu.hidden, false);
  assert.match(elements.get("btnExportRegFiltrados").textContent, /2 registros/);
  assert.match(elements.get("btnExportRegTodo").textContent, /\(3\)/);
  assert.equal(exportados.length, 1);

  elements.get("btnExportRegFiltrados").dispatch("click");
  assert.deepEqual([...exportados.at(-1)].map((r) => r.id), [2, 3]);
  assert.equal(menu.hidden, true);

  module.pulsarExportRegistros();
  elements.get("btnExportRegTodo").dispatch("click");
  assert.deepEqual([...exportados.at(-1)].map((r) => r.id), [1, 2, 3]);
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

test("registros do not save an edit when the settled check fails", async () => {
  const harness = createRegistroSaveHarness("10");
  harness.app.$("registroId").value = "7";
  let updated = false;
  harness.app.db = {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: "offline" } }) }),
      }),
      update: () => { updated = true; return { eq: () => Promise.resolve({ error: null }) }; },
    }),
  };
  await harness.form.listeners.get("submit")[0]({
    preventDefault() {},
    submitter: harness.button,
  });
  assert.equal(updated, false);
  assert.match(harness.app.lastToast, /No se pudo comprobar/);
});
