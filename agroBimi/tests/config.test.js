const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("configuration defines the Supabase URL and anonymous key as strings", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "config.js"), "utf8");
  const [url, key] = vm.runInNewContext(
    `${source}\n;[SUPABASE_URL, SUPABASE_ANON_KEY]`,
    {},
    { filename: "config.js" }
  );
  assert.equal(typeof url, "string");
  assert.equal(typeof key, "string");
});
