const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("app entry point initializes the shared application once", () => {
  let calls = 0;
  const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  vm.runInNewContext(source, {
    window: { App: { inicializarApp: () => { calls += 1; } } },
  }, { filename: "app.js" });
  assert.equal(calls, 1);
});
