const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement, loadModule } = require("./helpers");

test("ui wires sorting controls and confirms closing changed modals", () => {
  const ids = [
    "btnAnadirAgricultor", "btnAnadirRegistro", "btnExport", "btnOrdenFecha",
    "btnVolver", "btnLimpiar", "buscarAgricultor",
  ];
  const elements = new Map(ids.map((id) => [id, createElement()]));
  const closeButton = createElement({ dataset: { cerrar: "modalEditar" } });
  let confirms = 0;
  const app = {
    state: { agrupadoPorFactura: true, ordenFechaAsc: false },
    $: (id) => elements.get(id) || null,
    configurarEventosInterfaz: null,
    exportarExcel() {},
    mostrarVistaAgricultores() {},
    cargarAgricultores() {},
    cargarRegistros() { this.cargas = (this.cargas || 0) + 1; },
    abrirModalAgricultor() {},
    abrirModalRegistro() {},
    modalTieneCambios: () => true,
    cerrarModal: (modal) => modal.classList.remove("open"),
  };
  const modal = createElement();
  modal.classList.add("open");
  elements.set("modalEditar", modal);
  const document = { querySelectorAll: () => [closeButton] };
  const context = loadModule("ui.js", app, {
    document,
    confirm: () => ++confirms > 1,
  });
  context.window.App.configurarEventosInterfaz();

  elements.get("btnOrdenFecha").dispatch("click");
  assert.equal(app.state.agrupadoPorFactura, false);
  assert.equal(app.state.ordenFechaAsc, true);
  assert.equal(app.cargas, 1);

  closeButton.dispatch("click");
  assert.equal(modal.classList.contains("open"), true);
  closeButton.dispatch("click");
  assert.equal(modal.classList.contains("open"), false);
  assert.equal(confirms, 2);
});
