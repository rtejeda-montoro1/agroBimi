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

test("cajas sort by farmer code by default and by name A→Z / Z→A from the header", () => {
  const agricultores = {
    1: { id: 1, codigo: 12, nombre: "Ana" },
    2: { id: 2, codigo: 3, nombre: "Zoe" },
    3: { id: 3, codigo: null, nombre: "Bruno" },
    4: { id: 4, codigo: 7, nombre: "álvaro" },
  };
  const app = {
    state: {},
    agricultorPorId: (id) => agricultores[id],
    $: () => createElement(),
  };
  const module = loadModule("cajas.js", app).window.App;
  const saldos = [1, 2, 3, 4].map((id) => ({ agricultor_id: id }));
  const ordenar = (orden) => [...saldos].sort(module.compararSaldos(orden)).map((s) => s.agricultor_id);

  assert.deepEqual(ordenar(), [2, 4, 1, 3]);         // por código, sin código al final
  assert.deepEqual(ordenar("codigo"), [2, 4, 1, 3]);
  assert.deepEqual(ordenar("az"), [4, 1, 3, 2]);     // álvaro, Ana, Bruno, Zoe
  assert.deepEqual(ordenar("za"), [2, 3, 1, 4]);
});
