const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createElement(initial = {}) {
  const listeners = new Map();
  const classes = new Set();
  return Object.assign({
    value: "",
    innerHTML: "",
    textContent: "",
    disabled: false,
    hidden: false,
    listeners,
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle(name, force) {
        const add = force === undefined ? !classes.has(name) : force;
        if (add) classes.add(name);
        else classes.delete(name);
        return add;
      },
    },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    dispatch(type, event = {}) {
      for (const handler of listeners.get(type) || []) handler(event);
    },
  }, initial);
}

function loadModule(filename, app, globals = {}) {
  const context = {
    window: globals.window || { App: app },
    document: globals.document || {},
    navigator: globals.navigator || {},
    supabase: globals.supabase,
    crypto: globals.crypto,
    SUPABASE_URL: globals.SUPABASE_URL || "https://example.supabase.co",
    SUPABASE_ANON_KEY: globals.SUPABASE_ANON_KEY || "test-anon-key",
    setTimeout: globals.setTimeout || (() => 1),
    clearTimeout: globals.clearTimeout || (() => {}),
    setInterval: globals.setInterval || (() => 1),
    clearInterval: globals.clearInterval || (() => {}),
    localStorage: globals.localStorage || {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
    location: globals.location || { replace: () => {} },
    LoginBloqueo: globals.LoginBloqueo || { entrar: async () => "" },
    confirm: globals.confirm || (() => true),
    alert: globals.alert || (() => {}),
    console,
  };
  if (globals.XLSX) context.XLSX = globals.XLSX;
  if (globals.console) context.console = globals.console;
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "..", "js", filename), "utf8"),
    context,
    { filename }
  );
  return context;
}

function fakeQuery(response, onCall = () => {}) {
  const query = {
    select(...args) { onCall("select", args); return this; },
    order(...args) { onCall("order", args); return this; },
    or(...args) { onCall("or", args); return this; },
    upsert(...args) { onCall("upsert", args); return this; },
    update(...args) { onCall("update", args); return this; },
    insert(...args) { onCall("insert", args); return this; },
    delete(...args) { onCall("delete", args); return this; },
    eq(...args) { onCall("eq", args); return this; },
    then(resolve, reject) { return Promise.resolve(response).then(resolve, reject); },
  };
  return query;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

module.exports = { createElement, loadModule, fakeQuery, escapeHtml, flush };
