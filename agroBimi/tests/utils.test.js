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
