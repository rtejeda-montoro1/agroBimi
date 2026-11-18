const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement, fakeQuery, loadModule } = require("./helpers");

function createLiquidacionesHarness() {
  const ids = [
    "liqId", "liqPrecioCaja", "liqPrecioCajaPerdida", "liqIva", "liqRetencion",
    "cuerpoLiqLineas", "liqResumenRegistros", "liqBase", "liqIvaEtiqueta",
    "liqIvaImporte", "liqRetencionEtiqueta", "liqRetencionImporte", "liqTotal",
    "btnGuardarLiquidacion",
  ];
  const elements = new Map(ids.map((id) => [id, createElement()]));
  const app = {
    state: { liquidacionPrevia: { total: 10 } },
    dom: { modalLiquidacion: createElement() },
    PARAMETROS_DEFECTO: { precio_caja: "1", precio_caja_perdida: "2", iva_porcentaje: "12", retencion_porcentaje: "2" },
    $: (id) => elements.get(id) || null,
    num: (value) => Number(value) || 0,
    param: (key) => ({ precio_caja: "1.5", precio_caja_perdida: "3", iva_porcentaje: "10", retencion_porcentaje: "2" })[key],
    filaMensaje: (columns, text) => `${columns}:${text}`,
  };
  const module = loadModule("liquidaciones.js", app).window.App;
  return { app, elements, module };
}

test("liquidaciones refreshes only adjustment-derived values on an open new draft", () => {
  const { app, elements, module } = createLiquidacionesHarness();
  app.dom.modalLiquidacion.classList.add("open");
  elements.get("liqPrecioCaja").value = "1";
  elements.get("liqPrecioCajaPerdida").value = "2";
  elements.get("liqIva").value = "12";
  elements.get("liqRetencion").value = "4";

  module.aplicarAjustesALiquidacion({
    precio_caja: "1",
    precio_caja_perdida: "2",
    iva_porcentaje: "12",
    retencion_porcentaje: "2",
  });

  assert.equal(elements.get("liqPrecioCaja").value, "1.5");
  assert.equal(elements.get("liqPrecioCajaPerdida").value, "3");
  assert.equal(elements.get("liqIva").value, "10");
  assert.equal(elements.get("liqRetencion").value, "4");
  assert.equal(app.state.liquidacionPrevia, null);
  assert.equal(elements.get("btnGuardarLiquidacion").disabled, true);
  assert.match(elements.get("cuerpoLiqLineas").innerHTML, /Pulsa «Calcular»/);
});

test("liquidaciones do not overwrite a saved draft or a closed modal", () => {
  const { app, elements, module } = createLiquidacionesHarness();
  elements.get("liqPrecioCaja").value = "1";
  app.dom.modalLiquidacion.classList.add("open");
  elements.get("liqId").value = "22";
  module.aplicarAjustesALiquidacion({});
  assert.equal(elements.get("liqPrecioCaja").value, "1");

  elements.get("liqId").value = "";
  app.dom.modalLiquidacion.classList.remove("open");
  module.aplicarAjustesALiquidacion({});
  assert.equal(elements.get("liqPrecioCaja").value, "1");
});

test("liquidaciones list one page filtered on the server and total every matching one", async () => {
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, createElement());
    return elements.get(id);
  };
  const pagina = Array.from({ length: 150 }, (_, i) => ({ id: i + 1, estado: "cerrada", base: 1, total: 1 }));
  const todas = [{ base: 100, total: 90 }, { base: 50.5, total: 40 }];
  const consultas = [];
  const app = {
    state: { liquidacionesActuales: [] },
    dom: { modalLiquidaciones: createElement() },
    $: getElement,
    db: { from: (table) => {
      assert.equal(table, "liquidaciones");
      const llamadas = [];
      consultas.push(llamadas);
      const respuesta = {
        error: null,
        // La consulta de totales solo pide base y total.
        get data() { return llamadas[0][1] === "base,total" ? todas : pagina; },
        count: 320,
      };
      return fakeQuery(respuesta, (method, args) => llamadas.push([method, ...args]));
    } },
    traerTodo: (createQuery) => createQuery(),
    consultar: async (promise) => (await promise).data,
    num: (value) => Number(value) || 0,
    fmtNum: String,
    fmtEuro: (value) => `${value} €`,
    valor: String,
    escapar: String,
    formatearFecha: String,
    etiquetaAgricultor: () => "",
    agricultorPorId: () => null,
    asegurarAgricultoresTodos: async () => {},
    abrirModal() {},
    spinnerFila: () => "",
    filaMensaje: (_columns, text) => text,
    actualizarContador: (_id, count) => { app.count = count; },
    toast() {},
  };
  loadModule("paginacion.js", app);
  const module = loadModule("liquidaciones.js", app).window.App;
  getElement("filtroEstadoLiq").value = "cerrada";
  getElement("filtroDesdeLiq").value = "2026-03-01";
  getElement("filtroHastaLiq").value = "2026-03-31";

  await module.abrirModalLiquidaciones(7);

  const listado = consultas.find((q) => q[0][1] !== "base,total");
  const totales = consultas.find((q) => q[0][1] === "base,total");
  for (const q of [listado, totales]) {
    assert.ok(q.some((c) => c[0] === "eq" && c[1] === "agricultor_id" && c[2] === "7"));
    assert.ok(q.some((c) => c[0] === "eq" && c[1] === "estado" && c[2] === "cerrada"));
    // Se solapa con el rango: acaba después del "desde" y empieza antes del "hasta".
    assert.ok(q.some((c) => c[0] === "gte" && c[1] === "fecha_hasta" && c[2] === "2026-03-01"));
    assert.ok(q.some((c) => c[0] === "lte" && c[1] === "fecha_desde" && c[2] === "2026-03-31"));
  }
  assert.ok(listado.some((c) => c[0] === "range" && c[1] === 0 && c[2] === 149));
  assert.ok(!totales.some((c) => c[0] === "range"));
  assert.equal(app.count, 320);
  assert.equal(app.state.liquidacionesActuales.length, 150);
  assert.equal(getElement("liqTotalBase").textContent, "150.5 €");
  assert.equal(getElement("liqTotalTotal").textContent, "130 €");
  assert.equal(getElement("paginaLiquidaciones").textContent, "1–150 · página 1 de 3");
  assert.equal(getElement("paginacionLiquidacionesAbajo").hidden, false);

  // «Ver» abre la liquidación de la página que se ve.
  let vista = null;
  app.abrirModalFactura = (l) => { vista = l; };
  app.dom.formLiquidacion = createElement();
  getElement("formFacturar").querySelectorAll = () => [];
  module.configurarEventosLiquidaciones();
  const boton = { dataset: { verLiq: "42" } };
  await getElement("cuerpoLiquidaciones").listeners.get("click")[0]({
    target: { closest: (selector) => (selector === "[data-ver-liq]" ? boton : null) },
  });
  assert.equal(vista, pagina[41]);
});
