const test = require("node:test");
const assert = require("node:assert/strict");
const { fakeQuery, loadModule } = require("./helpers");

test("palets loads both camera datasets and determines pallet completion", async () => {
  const calls = [];
  const responses = {
    palets: { data: [{ id: 1, num_cajas: 60 }], error: null },
    paletizado_entradas: { data: [{ registro_id: 8, disponible: 5 }], error: null },
  };
  const app = {
    state: { paletsActuales: [], entradasPaletizado: [] },
    db: { from: (table) => { calls.push(table); return fakeQuery(responses[table]); } },
    traerTodo: (createQuery) => createQuery(),
    consultar: async (promise) => (await promise).data,
    paramNum: () => 60,
    num: (value) => Number(value) || 0,
  };
  const module = loadModule("palets.js", app).window.App;

  assert.equal(await module.cargarDatosPaletizado(), true);
  assert.equal(module.cajasPorPalet(), 60);
  assert.equal(module.estadoPalet(app.state.paletsActuales[0]), "completo");
  assert.equal(app.state.entradasPaletizado[0].registro_id, 8);
  assert.deepEqual(calls, ["palets", "paletizado_entradas"]);
});

test("palets preserve current data if either camera query fails", async () => {
  const oldPalets = [{ id: 99 }];
  const app = {
    state: { paletsActuales: oldPalets, entradasPaletizado: [] },
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
  assert.equal(app.state.paletsActuales, oldPalets);
});
