const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers");

test("plantas groups harvest performance by farmer, season, and normalized cycle", () => {
  const app = {
    state: {},
    cicloValido: (value) => String(value || "").match(/[123]/)?.[0] || "",
    num: (value) => Number(value) || 0,
    campanaNombre: (id) => String(id),
    agricultorPorId: (id) => ({ nombre: String(id) }),
  };
  const module = loadModule("plantas.js", app).window.App;
  const groups = module.agruparRendimiento(
    [
      { agricultor_id: 5, campana_id: 2, ciclo: "Ciclo 1", num_plantas: 100, fecha: "2026-01-02" },
      { agricultor_id: 5, campana_id: 2, ciclo: "1", num_plantas: 50, fecha: "2026-01-01" },
    ],
    [
      { agricultor_id: 5, campana_id: 2, ciclo: "1", cajas_entradas: 30, descuento_cajas: 3, fecha: "2026-01-05" },
      { agricultor_id: 8, campana_id: 2, ciclo: "2", cajas_entradas: 4, fecha: "2026-01-06" },
      { agricultor_id: 9, campana_id: 2, ciclo: "3", cajas_entradas: 0, fecha: null },
    ]
  );

  assert.equal(groups.length, 2);
  const combined = groups.find((group) => group.agricultor_id === 5);
  assert.equal(combined.ciclo, "1");
  assert.equal(combined.plantas, 150);
  assert.equal(combined.cajasNetas, 27);
  assert.equal(combined.rendimiento, 0.2);
  assert.equal(combined.rendimientoNeto, 0.18);
  assert.equal(combined.dias, 4);
  assert.equal(groups.find((group) => group.agricultor_id === 8).rendimiento, null);
});
