const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement, loadModule, flush } = require("./helpers");

function createAuthHarness(
  loaders,
  rpc = async () => ({ data: false, error: null }),
  { sesionGuardada = null, storage = new Map() } = {},
) {
  const signOuts = [];
  const listeners = new Map();
  const bodyClasses = new Set();
  const list = createElement();
  const elements = new Map([
    ["btnLogin", createElement()],
    ["btnLogout", createElement()],
    ["email", createElement()],
    ["password", createElement()],
  ]);
  const app = {
    state: { datosCargados: false, agricultoresTodos: [] },
    dom: {
      listaAgricultores: list,
      loginForm: createElement({ reset() { this.wasReset = true; } }),
      loginError: createElement(),
    },
    db: {
      rpc,
      auth: {
        signOut: async (opts) => { signOuts.push(opts); return { error: null }; },
        getSession: async () => ({ data: { session: sesionGuardada } }),
        onAuthStateChange: () => {},
      },
    },
    $: (id) => elements.get(id),
    escapar: (value) => String(value).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])),
    cerrarModal: () => {},
    mostrarVistaAgricultores: () => {},
    toast: () => {},
    ...loaders,
  };
  const document = {
    body: {
      classList: {
        toggle(name, enabled) {
          if (enabled) bodyClasses.add(name);
          else bodyClasses.delete(name);
        },
        contains: (name) => bodyClasses.has(name),
      },
    },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener() {},
    querySelectorAll: () => [],
  };
  const localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  const context = loadModule("auth.js", app, { document, localStorage });
  return { app, auth: context.window.App, list, bodyClasses, signOuts, storage };
}

const LOADERS_OK = {
  cargarParametros: async () => true,
  cargarCampanas: async () => true,
  cargarAgricultores: async () => true,
};
const MINUTO = 60 * 1000;

test("initAuth closes a stored session whose last activity is older than 20 minutes", async () => {
  const storage = new Map([["bimi_ultima_actividad", String(Date.now() - 21 * MINUTO)]]);
  const { auth, bodyClasses, signOuts } = createAuthHarness(LOADERS_OK, undefined, {
    sesionGuardada: { user: { id: "user-1" } },
    storage,
  });

  await auth.initAuth();
  assert.equal(signOuts.length, 1);
  assert.equal(signOuts[0].scope, "local");
  assert.equal(bodyClasses.has("authed"), false);
});

test("initAuth closes a stored session with no recorded activity", async () => {
  const { auth, bodyClasses, signOuts } = createAuthHarness(LOADERS_OK, undefined, {
    sesionGuardada: { user: { id: "user-1" } },
  });

  await auth.initAuth();
  assert.equal(signOuts.length, 1);
  assert.equal(bodyClasses.has("authed"), false);
});

test("initAuth keeps a stored session with recent activity", async () => {
  const storage = new Map([["bimi_ultima_actividad", String(Date.now() - 5 * MINUTO)]]);
  const { auth, bodyClasses, signOuts } = createAuthHarness(LOADERS_OK, undefined, {
    sesionGuardada: { user: { id: "user-1" } },
    storage,
  });

  await auth.initAuth();
  await flush();
  assert.equal(signOuts.length, 0);
  assert.equal(bodyClasses.has("authed"), true);
});

test("auth marks initial data loaded only when all loaders succeed", async () => {
  const calls = [];
  const { app, auth, list } = createAuthHarness({
    cargarParametros: async () => { calls.push("parametros"); return false; },
    cargarCampanas: async () => { calls.push("campanas"); return true; },
    cargarAgricultores: async () => { calls.push("agricultores"); return true; },
  });

  auth.aplicarSesion({ user: { id: "user-1" } });
  await flush();
  assert.deepEqual(calls.sort(), ["agricultores", "campanas", "parametros"]);
  assert.equal(app.state.datosCargados, false);
  assert.match(list.innerHTML, /data-reintentar-carga/);
});

test("auth retry reloads data after an initial failure", async () => {
  let parameterLoads = 0;
  const { app, auth, list } = createAuthHarness({
    cargarParametros: async () => ++parameterLoads > 1,
    cargarCampanas: async () => true,
    cargarAgricultores: async () => {
      if (parameterLoads > 1) list.innerHTML = "Agricultores cargados";
      return true;
    },
  });
  auth.configurarEventosAuth();
  auth.aplicarSesion({ user: { id: "user-1" } });
  await flush();
  assert.equal(app.state.datosCargados, false);

  const retryButton = createElement();
  list.dispatch("click", {
    target: { closest: (selector) => selector === "[data-reintentar-carga]" ? retryButton : null },
    stopPropagation() {},
  });
  await flush();
  assert.equal(app.state.datosCargados, true);
  assert.equal(parameterLoads, 2);
  assert.equal(list.innerHTML, "Agricultores cargados");
});

test("auth ignores an initial-load response after sign-out", async () => {
  let finishLoad;
  const pending = new Promise((resolve) => { finishLoad = resolve; });
  const { app, auth, list } = createAuthHarness({
    cargarParametros: () => pending,
    cargarCampanas: async () => true,
    cargarAgricultores: async () => true,
  });
  auth.aplicarSesion({ user: { id: "user-1" } });
  auth.aplicarSesion(null);
  finishLoad(false);
  await flush();

  assert.equal(app.state.datosCargados, false);
  assert.equal(list.innerHTML, "");
});
