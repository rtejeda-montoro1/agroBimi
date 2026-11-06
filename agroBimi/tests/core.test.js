const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement, loadModule } = require("./helpers");

function createCore(config = {}) {
  const ids = ["listaAgricultores"];
  const elements = new Map(ids.map((id) => [id, createElement()]));
  const client = { auth: {} };
  const document = { getElementById: (id) => elements.get(id) || null };
  const window = {};
  loadModule("core.js", {}, {
    window,
    document,
    supabase: { createClient: (...args) => ({ client, args }) },
    SUPABASE_URL: config.url || "https://example.supabase.co",
    SUPABASE_ANON_KEY: config.key || "test-anon-key",
  });
  return { app: window.App, elements };
}

test("core creates the shared app state and default settings", () => {
  const { app } = createCore();
  assert.deepEqual(Array.from(app.CICLOS), ["1", "2", "3"]);
  assert.equal(app.state.agricultoresActuales.length, 0);
  assert.equal(app.state.datosCargados, false);
  assert.equal(app.PARAMETROS_DEFECTO.cajas_por_palet, "60");
  assert.equal(app.PARAMETROS_DEFECTO.iva_porcentaje, "12");
  assert.deepEqual(app.db.args, ["https://example.supabase.co", "test-anon-key"]);
});

test("core reports missing Supabase configuration in the app", () => {
  const { elements } = createCore({ url: "PON_AQUI_URL", key: "PON_AQUI_CLAVE" });
  assert.match(elements.get("listaAgricultores").innerHTML, /Falta configurar Supabase/);
});
