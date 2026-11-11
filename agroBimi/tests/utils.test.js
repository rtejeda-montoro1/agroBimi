const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers");

function createUtils() {
  const app = { state: { agricultoresTodos: [], agricultoresActuales: [] } };
  const document = {
    createElement() {
      return {
        set textContent(value) {
          this.innerHTML = String(value).replace(/[&<>"']/g, (char) => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
          }[char]));
        },
      };
    },
  };
  loadModule("utils.js", app, { document });
  return app;
}

test("utils normalize documents, validate identifiers, and round money", () => {
  const app = createUtils();
  assert.equal(app.cicloValido(" Ciclo 2 "), "2");
  assert.equal(app.cicloValido("ciclo 4"), "");
  assert.equal(app.normalizarNif("12.345.678-z"), "12345678Z");
  assert.equal(app.nifValido("12.345.678-z"), true);
  assert.equal(app.nifValido("12345678A"), false);
  assert.equal(app.normalizarIban("es91 2100-0418 4502 0005 1332"), "ES91 2100 0418 4502 0005 1332");
  assert.equal(app.ibanValido("ES91 2100 0418 4502 0005 1332"), true);
  assert.equal(app.ibanValido("ES00 2100 0418 4502 0005 1332"), false);
  assert.equal(app.redondear(-0.375), -0.38);
  assert.equal(app.fmtCantidad(2.5), "2,50");
});

test("utils safely escapes values and finds inclusive month boundaries", () => {
  const app = createUtils();
  assert.equal(app.valor("<b>dato</b>"), "&lt;b&gt;dato&lt;/b&gt;");
  assert.equal(app.ultimoDiaMes("2024-02-13"), "2024-02-29");
  assert.equal(app.fechaEnRango("2024-02-01", "2024-02-01", "2024-02-29"), true);
  assert.equal(app.fechaEnRango("2024-03-01", "2024-02-01", "2024-02-29"), false);
});

test("utils fetch all pages and return query failures unchanged", async () => {
  const app = createUtils();
  const rangos = [];
  const rows = await app.traerTodo(() => ({
    range(desde, hasta) {
      rangos.push([desde, hasta]);
      return Promise.resolve({
        data: Array.from({ length: desde === 0 ? 1000 : 1 }, (_, i) => desde + i),
        error: null,
      });
    },
  }));
  assert.equal(rows.data.length, 1001);
  assert.deepEqual(rangos, [[0, 999], [1000, 1999]]);

  const error = { message: "offline" };
  const failed = await app.traerTodo(() => ({
    range: async () => ({ data: null, error }),
  }));
  assert.equal(failed.error, error);
});

function createFakeModal({ marcado = true, campos }) {
  const listeners = new Map();
  const submit = { type: "submit", disabled: false };
  const form = {
    elements: campos,
    hasAttribute: (name) => marcado && name === "data-guardar-con-cambios",
    querySelectorAll: (selector) => (selector === '[type="submit"]' ? [submit] : []),
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    dispatch(type) { (listeners.get(type) || []).forEach((h) => h({})); },
  };
  const modal = { querySelector: (selector) => (selector === "form" ? form : null) };
  return { modal, form, submit, listeners };
}

test("utils keep the save button disabled until the form differs from its snapshot", () => {
  const app = createUtils();
  const nombre = { tagName: "INPUT", type: "text", id: "nombre", value: "Ana" };
  const { modal, form, submit } = createFakeModal({ campos: [nombre] });

  app.snapshotModal(modal);
  assert.equal(submit.disabled, true);

  nombre.value = "Ana María";
  form.dispatch("input");
  assert.equal(submit.disabled, false);

  nombre.value = "Ana";
  form.dispatch("input");
  assert.equal(submit.disabled, true, "undoing the change locks the button again");
});

test("utils track checkboxes and fields without id, and attach listeners only once", () => {
  const app = createUtils();
  const casilla = { tagName: "INPUT", type: "checkbox", id: "liqIncluirCajas", value: "on", checked: false };
  const linea = { tagName: "INPUT", type: "number", value: "", dataset: { registro: "7" } };
  const { modal, form, submit, listeners } = createFakeModal({ campos: [casilla, linea] });

  app.snapshotModal(modal);
  app.snapshotModal(modal);
  assert.equal(listeners.get("input").length, 1);

  casilla.checked = true;
  form.dispatch("change");
  assert.equal(submit.disabled, false);

  casilla.checked = false;
  form.dispatch("change");
  assert.equal(submit.disabled, true);

  // Cambio hecho por código al pulsar un botón (p. ej. «Completar»).
  linea.value = "12";
  form.dispatch("click");
  assert.equal(submit.disabled, false);
});

test("utils leave the submit button alone in forms that are not marked", () => {
  const app = createUtils();
  const campo = { tagName: "INPUT", type: "text", id: "facturarNumAgricultor", value: "" };
  const { modal, submit, listeners } = createFakeModal({ marcado: false, campos: [campo] });

  app.snapshotModal(modal);
  assert.equal(submit.disabled, false);
  assert.equal(listeners.size, 0);
});
