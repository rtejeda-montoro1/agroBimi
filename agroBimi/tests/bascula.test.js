const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement, loadModule, flush } = require("./helpers");

async function loadBasculaWithLabelError(labelError, rejectLabelQuery = false, rpcOverrides = {}, { etiquetas = true, rpcCalls = [], windowExtra = {} } = {}) {
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, createElement());
    return elements.get(id);
  };
  const bodyClasses = new Set();
  const logs = [];
  const windowListeners = new Map();
  const window = {
    addEventListener(type, handler) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(handler);
    },
    print() {},
    BASCULA_ETIQUETAS: etiquetas,
    ...windowExtra,
  };
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
      getSession: async () => ({ data: { session: { user: { id: "operator" } } } }),
      onAuthStateChange() {},
      signOut: async () => ({ error: null }),
    },
    rpc: async (name) => {
      rpcCalls.push(name);
      if (rpcOverrides[name]) return rpcOverrides[name]();
      if (name === "bascula_palets") {
        if (rejectLabelQuery) throw labelError;
        return { data: null, error: labelError };
      }
      if (name === "bascula_emisor") return { data: "", error: null };
      return { data: [], error: null };
    },
  };
  loadModule("bascula.js", {}, {
    window,
    document,
    navigator: { onLine: true },
    supabase: { createClient: () => db },
    crypto: { randomUUID: () => "uuid" },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    console: { error: (...args) => logs.push(args) },
  });
  await flush();
  await flush();
  return { elements, logs, windowListeners, db };
}

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

test("bascula reports an automatic label lookup error", async () => {
  const { elements, logs } = await loadBasculaWithLabelError({ message: "offline", code: "NETWORK" });
  assert.match(elements.get("toast").textContent, /No se pudieron comprobar los palets completos/);
  assert.equal(logs.length, 1);
  assert.match(logs[0][0], /comprobar los palets completos/);
});

test("bascula reports a rejected automatic label lookup", async () => {
  const { elements, logs } = await loadBasculaWithLabelError(
    new Error("request rejected"),
    true
  );
  assert.match(elements.get("toast").textContent, /No se pudieron comprobar los palets completos/);
  assert.equal(logs.length, 1);
  assert.match(logs[0][1].message, /request rejected/);
});

test("bascula reports a rejected farmer refresh and preserves its last data", async () => {
  let farmerCalls = 0;
  const error = new Error("refresh rejected");
  const { elements, logs } = await loadBasculaWithLabelError(null, false, {
    bascula_palets: async () => ({ data: { cajas_por_palet: 60, palets: [] }, error: null }),
    bascula_agricultores: async () => {
      farmerCalls++;
      if (farmerCalls === 1) return { data: [{ id: 5, nombre: "Anterior" }], error: null };
      throw error;
    },
  });

  elements.get("selCampana").dispatch("change");
  await flush();
  await flush();

  assert.match(elements.get("toast").textContent, /No se pudieron actualizar los agricultores/);
  assert.match(elements.get("toast").textContent, /puede estar desactualizada/);
  assert.match(elements.get("sugerencias").innerHTML, /Anterior/);
  assert.equal(logs.length, 1);
  assert.match(logs[0][0], /actualizar los agricultores/);
});

test("bascula reports a rejected today refresh", async () => {
  let todayCalls = 0;
  const error = new Error("today refresh rejected");
  const { elements, logs, windowListeners } = await loadBasculaWithLabelError(null, false, {
    bascula_palets: async () => ({ data: { cajas_por_palet: 60, palets: [] }, error: null }),
    bascula_hoy: async () => {
      todayCalls++;
      if (todayCalls === 1) return { data: [], error: null };
      throw error;
    },
  });

  (windowListeners.get("online") || []).forEach((handler) => handler());
  await flush();
  await flush();

  assert.match(elements.get("toast").textContent, /No se pudieron actualizar las entradas de hoy/);
  assert.equal(logs.length, 1);
  assert.match(logs[0][0], /actualizar las entradas de hoy/);
});

test("bascula shows farmers ordered by code, with uncoded farmers last", async () => {
  const { elements } = await loadBasculaWithLabelError(null, false, {
    bascula_palets: async () => ({ data: { cajas_por_palet: 60, palets: [] }, error: null }),
    bascula_agricultores: async () => ({
      data: [
        { id: 1, codigo: 12, nombre: "Alba" },
        { id: 2, codigo: null, nombre: "Bravo" },
        { id: 3, codigo: 3, nombre: "Zeta" },
        { id: 4, codigo: 7, nombre: "Marta" },
      ],
      error: null,
    }),
  });

  const html = elements.get("sugerencias").innerHTML;
  const orden = [...html.matchAll(/data-agri="(\d+)"/g)].map((m) => m[1]);
  assert.deepEqual(orden, ["3", "4", "1", "2"]);
});

test("bascula does not look up or print pallet labels while they are disabled", async () => {
  const rpcCalls = [];
  const { elements, logs } = await loadBasculaWithLabelError(
    { message: "offline", code: "NETWORK" }, false, {}, { etiquetas: false, rpcCalls });

  // Solo la carga para pintar los palets de abajo, no la de las etiquetas.
  assert.equal(rpcCalls.filter((n) => n === "bascula_palets").length, 1);
  assert.doesNotMatch(elements.get("toast")?.textContent || "", /palets completos/);
  assert.equal(logs.length, 0);
});

async function tarjetasDePalets(etiquetas, extra = {}) {
  const palets = {
    cajas_por_palet: 60,
    en_camara: 0,
    palets: [{ id: 9, codigo: "P-9", secuencia: 9, num_cajas: 20, lineas: [] }],
    ...extra,
  };
  const { elements } = await loadBasculaWithLabelError(null, false, {
    bascula_palets: async () => ({ data: palets, error: null }),
  }, { etiquetas });
  await flush();
  return { html: elements.get("listaPalets").innerHTML, resumen: elements.get("paletsResumen").innerHTML };
}

test("bascula hides the pallet label button while labels are disabled", async () => {
  const { html } = await tarjetasDePalets(false);
  assert.match(html, /P-9/);
  assert.doesNotMatch(html, /Imprimir etiqueta/);
});

test("bascula shows the pallet label button when labels are enabled", async () => {
  assert.match((await tarjetasDePalets(true)).html, /data-etiqueta="9"/);
});

test("bascula shows the pallets on the same screen without a separate view, and boxes outside any pallet", async () => {
  const sin = await tarjetasDePalets(false, { sin_palet: 0 });
  assert.match(sin.html, /P-9/);
  assert.doesNotMatch(sin.resumen, /"palets-dato dato-sin-palet"/);

  const con = await tarjetasDePalets(false, { sin_palet: 14 });
  assert.match(con.resumen, /"palets-dato dato-sin-palet"[\s\S]*<b>14<\/b><span>sin palet/);
});

// Etiqueta por QZ Tray: la pide el botón del palet y no pasa por
// window.print (que va a la impresora de tickets).
async function etiquetaPorQZ(qzImprimir) {
  const pedidas = [];
  let prints = 0;
  const palets = {
    cajas_por_palet: 60, en_camara: 0, etiqueta_ancho_mm: "105", etiqueta_alto_mm: "75",
    palets: [{ id: 9, codigo: "P-9", secuencia: 9, num_cajas: 60, fecha_completo: "2026-11-25",
      lineas: [{ nombre: "Ana <b>", cajas: 60 }] }],
  };
  const { elements, db } = await loadBasculaWithLabelError(null, false, {
    bascula_palets: async () => ({ data: palets, error: null }),
  }, {
    windowExtra: {
      print() { prints++; },
      QZEtiquetas: { imprimir: async (trabajo, cliente) => { pedidas.push({ trabajo, cliente }); return qzImprimir(); } },
    },
  });
  await flush();
  elements.get("listaPalets").dispatch("click", { target: { closest: () => ({ dataset: { etiqueta: "9" } }) } });
  for (let i = 0; i < 6; i++) await flush();
  return { pedidas, prints, toast: elements.get("toast")?.textContent || "", db };
}

test("bascula prints the pallet label through QZ Tray at the label size, not with window.print", async () => {
  const { pedidas, prints, db } = await etiquetaPorQZ(async () => {});
  assert.equal(pedidas.length, 1);
  assert.equal(prints, 0);
  assert.equal(pedidas[0].trabajo.ancho, 105);
  assert.equal(pedidas[0].trabajo.alto, 75);
  assert.match(pedidas[0].trabajo.html, /P-9/);
  assert.match(pedidas[0].trabajo.html, /Ana &lt;b&gt;/);
  // Firma con la sesión de la báscula.
  assert.equal(pedidas[0].cliente, db);
});

test("bascula tells the operator why QZ Tray could not print the label", async () => {
  const { toast } = await etiquetaPorQZ(async () => {
    throw Object.assign(new Error("ws"), { aviso: "QZ Tray no está abierto en la tablet." });
  });
  assert.match(toast, /No se pudo imprimir la etiqueta del palet P-9: QZ Tray no está abierto/);
});
