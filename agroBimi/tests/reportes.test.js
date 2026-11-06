const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers");

test("reportes sanitize workbook names and style exported spreadsheet columns", () => {
  const cells = {
    A1: { v: "Agricultor" }, B1: { v: "Nº Cajas Entradas" },
    A2: { v: "Bimi" }, B2: { v: 4 },
  };
  const writes = [];
  const XLSX = {
    utils: {
      json_to_sheet: () => Object.assign({ "!ref": "A1:B2" }, cells),
      decode_range: () => ({ s: { r: 0, c: 0 }, e: { r: 1, c: 1 } }),
      encode_cell: ({ r, c }) => `${String.fromCharCode(65 + c)}${r + 1}`,
      book_new: () => ({ sheets: [] }),
      book_append_sheet: (book, sheet, name) => book.sheets.push({ sheet, name }),
    },
    writeFile: (book, name) => writes.push({ book, name }),
  };
  const app = { hoyISO: () => "2026-11-06" };
  const module = loadModule("reportes.js", app, { XLSX }).window.App;

  assert.equal(module.limpiarNombre("Campaña 26/27: * test?.xlsx"), "Campaña 26-27 test .xlsx");
  module.descargarLibro(
    [{ Agricultor: "Bimi", "Nº Cajas Entradas": 4 }],
    "Registros",
    "Campaña 26/27"
  );

  const { book, name } = writes[0];
  const sheet = book.sheets[0].sheet;
  assert.equal(book.sheets[0].name, "Registros");
  assert.equal(name, "Campaña 26-27 2026-11-06.xlsx");
  assert.equal(sheet.A1.s.fill.fgColor.rgb, "15803D");
  assert.equal(sheet.B2.s.alignment.horizontal, "right");
  assert.equal(sheet["!freeze"].xSplit, 0);
  assert.equal(sheet["!freeze"].ySplit, 1);
  assert.equal(sheet["!freeze"].topLeftCell, "A2");
  assert.equal(sheet["!freeze"].activePane, "bottomLeft");
});
