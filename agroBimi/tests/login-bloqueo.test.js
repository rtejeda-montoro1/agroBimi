const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers");

function createLoginBloqueo(db) {
  const window = {};
  loadModule("login-bloqueo.js", {}, { window, LoginBloqueo: undefined });
  return window.LoginBloqueo;
}

test("login blocking stops a sign-in while the account is locked", async () => {
  const until = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const calls = [];
  const db = {
    rpc: async (...args) => { calls.push(args); return { data: until, error: null }; },
    auth: { signInWithPassword: async () => assert.fail("must not sign in while locked") },
  };
  const bloqueo = createLoginBloqueo(db);
  const message = await bloqueo.entrar(db, "user@example.test", "password");
  assert.match(message, /Acceso bloqueado/);
  assert.equal(calls.length, 1);
});

test("login blocking distinguishes bad credentials from connection failures", async () => {
  const calls = [];
  const db = {
    rpc: async (name) => {
      calls.push(name);
      if (name === "login_bloqueado") return { data: null, error: null };
      return { data: { quedan: 1 }, error: null };
    },
    auth: { signInWithPassword: async () => ({ error: { code: "invalid_credentials" } }) },
  };
  const bloqueo = createLoginBloqueo(db);
  assert.match(await bloqueo.entrar(db, "user@example.test", "bad"), /Si vuelves a fallar/);
  assert.deepEqual(calls, ["login_bloqueado", "login_fallido"]);

  calls.length = 0;
  db.auth.signInWithPassword = async () => ({ error: { message: "Failed to fetch" } });
  assert.match(await bloqueo.entrar(db, "user@example.test", "bad"), /No se pudo conectar/);
  assert.deepEqual(calls, ["login_bloqueado"]);
});

test("login blocking accepts a successful sign-in when the server resets failures", async () => {
  const calls = [];
  const db = {
    rpc: async (name) => {
      calls.push(name);
      return { data: name === "login_correcto", error: null };
    },
    auth: { signInWithPassword: async () => ({ error: null }) },
  };
  const bloqueo = createLoginBloqueo(db);
  assert.equal(await bloqueo.entrar(db, "user@example.test", "good"), "");
  assert.deepEqual(calls, ["login_bloqueado", "login_correcto"]);
});
