const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement, fakeQuery, loadModule } = require("./helpers");

test("cajas calculates outstanding empty-box charges for one farmer", async () => {
  const calls = [];
  const responses = {
    registros: {
      data: [
        { agricultor_id: 7, campana_id: 3, fecha: "2026-03-01", cajas_vacias_retiradas: 10, cajas_entradas: 6, cajas_vacias_devueltas: 1 },
        { agricultor_id: 7, campana_id: 4, fecha: "2026-03-02", cajas_vacias_retiradas: 100, cajas_entradas: 0, cajas_vacias_devueltas: 0 },
      ],
      error: null,
    },
    liquidacion_lineas: {
      data: [{ cantidad: 2, liquidacion_id: 9, liquidaciones: { agricultor_id: 7, estado: "cerrada" } }],
      error: null,
    },
  };
  const app = {
    state: {},
    db: { from: (table) => fakeQuery(responses[table], (method, args) => calls.push([table, method, ...args])) },
    traerTodo: (createQuery) => createQuery(),
    consultar: async (promise) => (await promise).data,
    num: (value) => Number(value) || 0,
    redondear: (value) => Math.round(value * 100) / 100,
    fechaEnRango: (fecha, desde, hasta) => (!desde || fecha >= desde) && (!hasta || fecha <= hasta),
    paramNum: () => 1.5,
    $: () => createElement(),
  };
  const module = loadModule("cajas.js", app).window.App;
  const saldo = await module.saldoCajasAgricultor(7, { campanaId: 3, desde: "2026-03-01", hasta: "2026-03-31" });

  assert.equal(saldo.descuadre, 3);
  assert.equal(saldo.cobradas, 2);
  assert.equal(saldo.pendiente, 1);
  assert.equal(saldo.importe, 1.5);
  assert.ok(calls.some((call) => call[0] === "registros" && call[1] === "eq" && call[2] === "agricultor_id" && call[3] === 7));
});
