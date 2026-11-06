const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement, escapeHtml, loadModule } = require("./helpers");

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
