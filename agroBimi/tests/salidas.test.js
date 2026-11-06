const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement, escapeHtml, fakeQuery, loadModule } = require("./helpers");

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
