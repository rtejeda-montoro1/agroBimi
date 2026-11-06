const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement, loadModule, flush } = require("./helpers");

test("bascula reports a print error and continues with the next queued job", async () => {
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, createElement());
    return elements.get(id);
  };
  const bodyClasses = new Set();
  const windowListeners = new Map();
  const logs = [];
  let printCalls = 0;
  const window = {
    addEventListener(type, handler) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(handler);
    },
    print() {
      printCalls++;
      if (printCalls === 1) throw new Error("printer unavailable");
      const callbacks = windowListeners.get("afterprint") || [];
      windowListeners.delete("afterprint");
      callbacks.forEach((handler) => handler());
    },
  };
  const pending = [{
    uuid: "entry-1",
    nombre: "Proveedor",
    ciclo: "1",
    cajas: 4,
    vacias: 0,
    pesada_en: "2026-11-06T09:00:00.000Z",
  }];
  const storage = new Map([["bascula_pendientes", JSON.stringify(pending)]]);
  const document = {
    title: "Báscula",
    visibilityState: "hidden",
    body: {
      classList: {
        toggle(name, enabled) {
          if (enabled) bodyClasses.add(name);
          else bodyClasses.delete(name);
        },
        contains: (name) => bodyClasses.has(name),
      },
    },
    getElementById: getElement,
    addEventListener() {},
    querySelectorAll: () => [],
    querySelector: (selector) => selector === ".bascula-main" ? getElement("bascula-main") : null,
  };
  const db = {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange() {},
      signOut: async () => ({ error: null }),
    },
    rpc: async () => ({ data: null, error: null }),
  };

  loadModule("bascula.js", {}, {
    window,
    document,
    navigator: { onLine: true },
    supabase: { createClient: () => db },
    crypto: { randomUUID: () => "new-uuid" },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    console: { error: (...args) => logs.push(args) },
  });
  await flush();

  const lista = getElement("hoyLista");
  const clickImprimir = () => lista.dispatch("click", {
    target: { closest: () => ({ dataset: { imprimir: "entry-1" } }) },
  });
  clickImprimir();
  clickImprimir();
  await flush();

  assert.equal(printCalls, 2);
  assert.equal(logs.length, 1);
  assert.match(logs[0][0], /justificante/);
  assert.match(getElement("toast").textContent, /No se pudo imprimir el justificante/);
});
