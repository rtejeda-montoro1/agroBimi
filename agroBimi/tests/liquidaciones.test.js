const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement, fakeQuery, loadModule } = require("./helpers");

function createLiquidacionesHarness() {
  const ids = [
    "liqId", "liqPrecioKg", "liqKgPorCaja", "liqPrecioCajaPerdida", "liqIva", "liqRetencion",
    "cuerpoLiqLineas", "liqResumenRegistros", "liqBase", "liqIvaEtiqueta",
    "liqIvaImporte", "liqRetencionEtiqueta", "liqRetencionImporte", "liqTotal",
    "btnGuardarLiquidacion",
  ];
  const elements = new Map(ids.map((id) => [id, createElement()]));
  const app = {
    state: { liquidacionPrevia: { total: 10 } },
    dom: { modalLiquidacion: createElement() },
    PARAMETROS_DEFECTO: { precio_kg: "1", kg_por_caja: "8", precio_caja_perdida: "2", iva_porcentaje: "12", retencion_porcentaje: "2" },
    $: (id) => elements.get(id) || null,
    num: (value) => Number(value) || 0,
    param: (key) => ({ precio_kg: "1.5", kg_por_caja: "8", precio_caja_perdida: "3", iva_porcentaje: "10", retencion_porcentaje: "2" })[key],
    filaMensaje: (columns, text) => `${columns}:${text}`,
  };
  const module = loadModule("liquidaciones.js", app).window.App;
  return { app, elements, module };
}

test("liquidaciones refreshes only adjustment-derived values on an open new draft", () => {
  const { app, elements, module } = createLiquidacionesHarness();
  app.dom.modalLiquidacion.classList.add("open");
  elements.get("liqPrecioKg").value = "1";
  elements.get("liqPrecioCajaPerdida").value = "2";
  elements.get("liqIva").value = "12";
  elements.get("liqRetencion").value = "4";

  module.aplicarAjustesALiquidacion({
    precio_kg: "1",
    precio_caja_perdida: "2",
    iva_porcentaje: "12",
    retencion_porcentaje: "2",
  });

  assert.equal(elements.get("liqPrecioKg").value, "1.5");
  assert.equal(elements.get("liqPrecioCajaPerdida").value, "3");
  assert.equal(elements.get("liqIva").value, "10");
  assert.equal(elements.get("liqRetencion").value, "4");
  assert.equal(app.state.liquidacionPrevia, null);
  assert.equal(elements.get("btnGuardarLiquidacion").disabled, true);
  assert.match(elements.get("cuerpoLiqLineas").innerHTML, /Pulsa «Calcular»/);
});

test("liquidaciones do not overwrite a saved draft or a closed modal", () => {
  const { app, elements, module } = createLiquidacionesHarness();
  elements.get("liqPrecioKg").value = "1";
  app.dom.modalLiquidacion.classList.add("open");
  elements.get("liqId").value = "22";
  module.aplicarAjustesALiquidacion({});
  assert.equal(elements.get("liqPrecioKg").value, "1");

  elements.get("liqId").value = "";
  app.dom.modalLiquidacion.classList.remove("open");
  module.aplicarAjustesALiquidacion({});
  assert.equal(elements.get("liqPrecioKg").value, "1");
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

  // Cambiar un dato del cálculo lo invalida ya al escribir, no al salir
  // del campo (si no, el primer clic en «Calcular» se perdía).
  app.state.liquidacionPrevia = { total: 1 };
  getElement("btnGuardarLiquidacion").disabled = false;
  getElement("liqPrecioKg").dispatch("input");
  assert.equal(app.state.liquidacionPrevia, null);
  assert.equal(getElement("btnGuardarLiquidacion").disabled, true);
});

// El cálculo con las utilidades de verdad (redondeo, números y fechas).
function crearCalculo() {
  const app = { state: { agricultoresTodos: [], agricultoresActuales: [] } };
  loadModule("utils.js", app, { document: { createElement: () => ({}) } });
  return loadModule("liquidaciones.js", app).window.App.calcularLiquidacion;
}

const datosLiq = (extra = {}) => ({
  desde: "2026-11-01", hasta: "2026-11-15",
  precioKg: 0.3575, kgPorCaja: 1, precioCajaPerdida: 1.2, iva: 10, retencion: 2,
  incluirDescuento: true, otroConcepto: null, otraCantidad: 0, otroPrecio: 0,
  ...extra,
});

test("liquidaciones calculate lines, VAT, withholding and total with euro rounding", () => {
  const calcular = crearCalculo();
  const r = calcular(
    datosLiq({ otroConcepto: "Transporte", otraCantidad: 1, otroPrecio: 15.5 }),
    [
      { cajas_entradas: 100, descuento_kg: 2 },
      { cajas_entradas: 250, descuento_kg: 3 },
      { cajas_entradas: 37, descuento_kg: null },
    ],
    { pendiente: 4 },
  );

  assert.deepEqual([...r.lineas].map((l) => [l.tipo, l.cantidad, l.importe]), [
    ["bimi", 387, 138.35],          // 387 × 0,3575 = 138,3525
    ["descuento", 5, -1.79],        // −5 × 0,3575 = −1,7875
    ["cajas_perdidas", 4, -4.8],
    ["otro", 1, 15.5],
  ]);
  assert.equal(r.cajas, 387);
  assert.equal(r.base, 147.26);
  assert.equal(r.ivaImporte, 14.73);       // 10 % de 147,26 = 14,726
  assert.equal(r.retencionImporte, 3.24);  // 2 % de 161,99 = 3,2398
  assert.equal(r.total, 158.75);
  // Lo que comprueba el servidor al guardar (liquidacion_guardar).
  assert.equal(Math.round(r.lineas.reduce((s, l) => s + l.importe, 0) * 100) / 100, r.base);
  assert.equal(Math.round((r.base + r.ivaImporte - r.retencionImporte) * 100) / 100, r.total);
});

test("liquidaciones round half cents up, as on paper, not down by floating point", () => {
  const calcular = crearCalculo();
  // 3 × 0,335 = 1,005 en papel, 1,00499999… en coma flotante.
  const r = calcular(datosLiq({ precioKg: 0.335, iva: 0, retencion: 0 }), [{ cajas_entradas: 3 }], null);
  assert.equal(r.lineas[0].importe, 1.01);
  assert.equal(r.total, 1.01);
});

test("liquidaciones pay by kg: boxes × kg per box × price per kg, discount in kg", () => {
  const calcular = crearCalculo();
  const r = calcular(
    datosLiq({ precioKg: 0.5, kgPorCaja: 8, iva: 0, retencion: 0 }),
    [{ cajas_entradas: 100, descuento_kg: 10 }, { cajas_entradas: 20, descuento_kg: 6 }],
    null,
  );
  assert.deepEqual([...r.lineas].map((l) => [l.tipo, l.cantidad, l.precio, l.importe]), [
    ["bimi", 960, 0.5, 480],        // 120 cajas × 8 kg = 960 kg × 0,50
    ["descuento", 16, 0.5, -8],     // 16 kg × 0,50
  ]);
  assert.match(r.lineas[0].concepto, /120 cajas × 8 kg/);
  assert.equal(r.cajas, 120);
  assert.equal(r.kg, 960);
  assert.equal(r.total, 472);
});

test("liquidaciones only add discount and empty-box lines when there is something to charge", () => {
  const calcular = crearCalculo();
  const registros = [{ cajas_entradas: 10, descuento_kg: 4 }];
  const tipos = (r) => [...r.lineas].map((l) => l.tipo);
  assert.deepEqual(tipos(calcular(datosLiq({ incluirDescuento: false }), registros, null)), ["bimi"]);
  assert.deepEqual(tipos(calcular(datosLiq(), registros, { pendiente: 0 })), ["bimi", "descuento"]);
  assert.deepEqual(tipos(calcular(datosLiq(), [{ cajas_entradas: 10 }], { pendiente: 2 })), ["bimi", "cajas_perdidas"]);
});

test("liquidaciones do not calculate or allow saving without the farmer's box balance", async () => {
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, createElement());
    return elements.get(id);
  };
  const app = { state: { agricultoresTodos: [], agricultoresActuales: [] }, dom: {} };
  loadModule("utils.js", app, { document: { createElement: () => ({}) } });
  Object.assign(app, {
    $: getElement,
    db: { from: () => fakeQuery({ data: [{ id: 1, cajas_entradas: 10, liquidacion_id: null }], error: null }) },
    traerTodo: (crear) => crear(),
    consultar: async (q) => (await q).data,
    saldoCajasAgricultor: async () => null,   // falló la consulta de cajas
    toast() {},
  });
  loadModule("paginacion.js", app);
  const module = loadModule("liquidaciones.js", app).window.App;
  app.dom.formLiquidacion = createElement();
  getElement("formFacturar").querySelectorAll = () => [];
  module.configurarEventosLiquidaciones();

  Object.entries({ liqAgricultor: "3", liqDesde: "2026-11-01", liqHasta: "2026-11-15",
    liqCampana: "1", liqKgPorCaja: "1", liqPrecioKg: "0.5" })
    .forEach(([id, v]) => { getElement(id).value = v; });
  getElement("liqIncluirCajas").checked = true;
  getElement("btnGuardarLiquidacion").disabled = false;

  await getElement("btnCalcularLiquidacion").listeners.get("click")[0]();
  assert.equal(app.state.liquidacionPrevia ?? null, null);
  assert.equal(getElement("btnGuardarLiquidacion").disabled, true);
  assert.match(getElement("cuerpoLiqLineas").innerHTML, /No se han podido cargar las cajas/);
});
