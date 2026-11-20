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
  loadModule("paginacion.js", app);
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

test("palets loads only what is in the camera: pallets without exit and boxes still there", async () => {
  const calls = [];
  const responses = {
    palets: { data: [{ id: 1, num_cajas: 60 }], error: null },
    paletizado_entradas: { data: [{ registro_id: 8, disponible: 5 }], error: null },
  };
  const app = {
    state: { paletsActuales: [], paletsCamara: [], entradasPaletizado: [] },
    db: { from: (table) => {
      calls.push(table);
      return fakeQuery(responses[table], (method, args) => calls.push([table, method, ...args]));
    } },
    traerTodo: (createQuery) => createQuery(),
    consultar: async (promise) => (await promise).data,
    paramNum: () => 60,
    num: (value) => Number(value) || 0,
  };
  const module = loadModule("palets.js", app).window.App;

  assert.equal(await module.cargarDatosPaletizado(), true);
  assert.equal(module.cajasPorPalet(), 60);
  assert.equal(module.estadoPalet(app.state.paletsCamara[0]), "completo");
  assert.equal(app.state.entradasPaletizado[0].registro_id, 8);
  assert.deepEqual(calls.filter((c) => typeof c === "string"), ["palets", "paletizado_entradas"]);
  assert.ok(calls.some((c) => c[0] === "palets" && c[1] === "is" && c[2] === "fecha_salida" && c[3] === null));
  assert.ok(calls.some((c) => c[0] === "paletizado_entradas" && c[1] === "or" && c[2] === "en_formacion.gt.0,sin_palet.gt.0"));
});

test("palets preserve current data if either camera query fails", async () => {
  const oldPalets = [{ id: 99 }];
  const app = {
    state: { paletsActuales: [], paletsCamara: oldPalets, entradasPaletizado: [] },
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
  assert.equal(app.state.paletsCamara, oldPalets);
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

function createListadoHarness({ total = 0, pagina = [] } = {}) {
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, createElement());
    return elements.get(id);
  };
  getElement("filtroEstadoPalets").value = "pendientes";
  const calls = [];
  const app = {
    state: { paletsActuales: [], paletsCamara: [], entradasPaletizado: [] },
    dom: { modalPalets: createElement(), formPalet: createElement() },
    $: getElement,
    db: { from: (table) => {
      const call = [table];
      calls.push(call);
      const response = table === "palets"
        ? { data: pagina, error: null, count: total }
        : { data: [], error: null };
      return fakeQuery(response, (method, args) => call.push([method, ...args]));
    } },
    traerTodo: (createQuery) => createQuery(),
    consultar: async (promise) => (await promise).data,
    paramNum: () => 60,
    num: (value) => Number(value) || 0,
    fmtNum: String,
    valor: String,
    escapar: String,
    formatearFecha: String,
    etiquetaAgricultor: () => "",
    agricultorPorId: () => null,
    spinnerFila: () => "<tr>cargando</tr>",
    filaMensaje: (_span, message) => `<tr><td>${message}</td></tr>`,
    actualizarContador: (_id, count) => { app.count = count; },
    toast: (message) => { app.lastToast = message; },
  };
  loadModule("paginacion.js", app);
  const module = loadModule("palets.js", app, {
    document: { querySelectorAll: () => [] },
  }).window.App;
  // Las llamadas de la consulta del listado (la última a "palets").
  const listado = () => calls.filter((c) => c[0] === "palets").at(-1).slice(1);
  return { app, elements: { get: getElement }, module, listado };
}

test("palets list asks the server for one page of 150 and shows the total", async () => {
  const pagina = Array.from({ length: 150 }, (_, i) => ({ id: i + 1, codigo: `P-${i + 1}`, num_cajas: 60 }));
  const { app, elements, module, listado } = createListadoHarness({ total: 400, pagina });
  // Los palets con salida no están en la cámara: van al servidor.
  elements.get("filtroEstadoPalets").value = "salido";

  await module.cargarPalets();

  assert.ok(listado().some((c) => c[0] === "range" && c[1] === 0 && c[2] === 149));
  assert.ok(listado().some((c) => c[0] === "select" && c[2]?.count === "exact"));
  assert.ok(listado().some((c) => c[0] === "not" && c[1] === "fecha_salida"));
  assert.equal(app.count, 400);
  assert.equal(elements.get("paginaPalets").textContent, "1–150 · página 1 de 3");
  assert.equal(elements.get("paginacionPalets").hidden, false);
  assert.equal(elements.get("btnPaginaAnteriorPalets").disabled, true);
  assert.equal(elements.get("btnPaginaSiguientePalets").disabled, false);
  assert.equal(elements.get("btnExportPalets").disabled, false);
  // La misma paginación debajo de la tabla.
  assert.equal(elements.get("paginaPaletsAbajo").textContent, "1–150 · página 1 de 3");
  assert.equal(elements.get("paginacionPaletsAbajo").hidden, false);
  assert.equal(elements.get("btnPaginaAnteriorPaletsAbajo").disabled, true);
  assert.equal(elements.get("btnPaginaSiguientePaletsAbajo").disabled, false);
});

test("palets bottom pager moves to the next page and scrolls back to the top of the list", async () => {
  const pagina = Array.from({ length: 150 }, (_, i) => ({ id: i + 1, num_cajas: 60 }));
  const { elements, module, listado } = createListadoHarness({ total: 400, pagina });
  elements.get("filtroEstadoPalets").value = "salido";
  let subido = false;
  elements.get("countPalets").scrollIntoView = () => { subido = true; };
  module.configurarEventosPalets();
  await module.cargarPalets();

  await elements.get("btnPaginaSiguientePaletsAbajo").listeners.get("click")[0]();

  assert.ok(listado().some((c) => c[0] === "range" && c[1] === 150 && c[2] === 299));
  // Solo se pasa de página: el total ya se sabe y no se vuelve a contar.
  assert.ok(listado().some((c) => c[0] === "select" && c[2] === undefined));
  assert.equal(subido, true);
  assert.equal(elements.get("paginaPaletsAbajo").textContent, "151–300 · página 2 de 3");
  assert.equal(elements.get("btnPaginaAnteriorPaletsAbajo").disabled, false);
});

test("palets list hides the pager when everything fits in one page", async () => {
  const { elements, module } = createListadoHarness({ total: 2, pagina: [{ id: 1 }, { id: 2 }] });
  await module.cargarPalets();
  assert.equal(elements.get("paginacionPalets").hidden, true);
  assert.equal(elements.get("paginacionPaletsAbajo").hidden, true);
});

test("palets filters by state, farmer and dates on the server", async () => {
  const { elements, module, listado } = createListadoHarness();
  elements.get("filtroEstadoPalets").value = "salido";
  elements.get("filtroAgriPalets").value = "7";
  elements.get("filtroDesdePalets").value = "2026-03-01";
  elements.get("filtroHastaPalets").value = "2026-03-31";

  await module.filtrarPalets();

  const q = listado();
  assert.ok(q.some((c) => c[0] === "not" && c[1] === "fecha_salida" && c[2] === "is"));
  // El agricultor se filtra con otra unión de las líneas, para no recortar las del palet.
  assert.ok(q.some((c) => c[0] === "select" && /palet_lineas\(id,/.test(c[1]) && /filtro_agri:palet_lineas!inner/.test(c[1])));
  assert.ok(q.some((c) => c[0] === "eq" && c[1] === "filtro_agri.agricultor_id" && c[2] === "7"));
  assert.ok(q.some((c) => c[0] === "or" &&
    c[1] === "and(fecha_completo.gte.2026-03-01,fecha_completo.lte.2026-03-31),and(fecha_completo.is.null,fecha.gte.2026-03-01,fecha.lte.2026-03-31)"));
});

test("palets search by pallet number looks in every pallet, ignoring the other filters", async () => {
  const { elements, module, listado } = createListadoHarness({ total: 1, pagina: [{ id: 12, secuencia: 12 }] });
  elements.get("filtroAgriPalets").value = "7";
  elements.get("filtroNumeroPalets").value = "P-000012";

  await module.filtrarPalets();

  const q = listado();
  assert.ok(q.some((c) => c[0] === "eq" && c[1] === "secuencia" && c[2] === 12));
  assert.ok(!q.some((c) => c[0] === "is" || c[0] === "lt" || c[0] === "gte" || c[0] === "or"));
  assert.ok(!q.some((c) => c[0] === "eq" && c[1] === "filtro_agri.agricultor_id"));
});

test("palets without exit are paged from the camera data, without asking again", async () => {
  // La cámara trae los 400 palets sin salida; el listado sale de ahí.
  const camara = Array.from({ length: 400 }, (_, i) => ({ id: i + 1, num_cajas: 60 }));
  const { app, elements, module } = createListadoHarness({ total: 400, pagina: camara });
  const pedidas = [];
  const from = app.db.from;
  app.db.from = (table) => { pedidas.push(table); return from(table); };
  module.configurarEventosPalets();

  await module.cargarPalets();

  // Solo la cámara: palets + paletizado_entradas, sin una página aparte.
  assert.deepEqual(pedidas, ["palets", "paletizado_entradas"]);
  assert.equal(app.state.paletsActuales.length, 150);
  assert.equal(app.count, 400);
  assert.equal(elements.get("paginaPalets").textContent, "1–150 · página 1 de 3");

  await elements.get("btnPaginaSiguientePalets").listeners.get("click")[0]();
  assert.equal(app.state.paletsActuales[0].id, 151);
  assert.equal(pedidas.length, 2);
});

test("palets filter the camera locally by state, farmer and dates, like the server", async () => {
  const camara = [
    { id: 1, num_cajas: 60, fecha: "2026-02-20", fecha_completo: "2026-03-05", palet_lineas: [{ agricultor_id: 7 }] },
    { id: 2, num_cajas: 30, fecha: "2026-03-10", fecha_completo: null, palet_lineas: [{ agricultor_id: 7 }, { agricultor_id: 8 }] },
    { id: 3, num_cajas: 30, fecha: "2026-03-10", fecha_completo: null, palet_lineas: [{ agricultor_id: 8 }] },
    { id: 4, num_cajas: 60, fecha: "2026-03-10", fecha_completo: "2026-04-02", palet_lineas: [{ agricultor_id: 7 }] },
  ];
  const { app, elements, module } = createListadoHarness({ total: 4, pagina: camara });
  await module.cargarPalets();
  const pedidas = [];
  app.db.from = (table) => { pedidas.push(table); return fakeQuery({ data: [], error: null }); };
  const ids = () => app.state.paletsActuales.map((p) => p.id);

  elements.get("filtroAgriPalets").value = "7";
  elements.get("filtroDesdePalets").value = "2026-03-01";
  elements.get("filtroHastaPalets").value = "2026-03-31";
  await module.filtrarPalets();
  // Las fechas miran cuándo se llenó, o cuándo se abrió si sigue en formación.
  assert.deepEqual(ids(), [1, 2]);

  elements.get("filtroEstadoPalets").value = "formacion";
  await module.filtrarPalets();
  assert.deepEqual(ids(), [2]);

  elements.get("filtroEstadoPalets").value = "completo";
  await module.filtrarPalets();
  assert.deepEqual(ids(), [1]);
  assert.deepEqual(pedidas, []);
});

test("palets asks for the camera and the list page at the same time", async () => {
  const { app, elements, module } = createListadoHarness();
  // "Todos" incluye los que ya salieron: no están en la cámara.
  elements.get("filtroEstadoPalets").value = "";
  const enCurso = [];
  app.db = { from: (table) => {
    let responder;
    const respuesta = new Promise((resolve) => { responder = resolve; });
    enCurso.push({ table, responder });
    return fakeQuery(respuesta);
  } };

  const carga = module.cargarPalets();
  await new Promise((resolve) => setImmediate(resolve));
  // Cámara (palets + paletizado_entradas) y la página del listado, sin
  // esperar a que vuelva ninguna.
  assert.equal(enCurso.length, 3);

  enCurso.forEach(({ responder }) => responder({ data: [], error: null, count: 0 }));
  await carga;
});
