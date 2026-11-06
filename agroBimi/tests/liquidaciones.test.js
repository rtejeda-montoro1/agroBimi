const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement, loadModule } = require("./helpers");

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
