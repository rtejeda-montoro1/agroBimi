const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement, loadModule, fakeQuery, escapeHtml } = require("./helpers");

function createAgricultoresHarness(response) {
  const calls = [];
  const elements = new Map();
  for (const id of [
    "buscarAgricultor", "listaAgricultores", "countAgricultores",
    "plantaAgricultor", "liqAgricultor", "filtroAgriPlantas",
    "filtroAgriCajas", "filtroAgriLiq", "filtroAgriPalets",
  ]) elements.set(id, createElement());
  const app = {
    state: { agricultoresActuales: [], agricultoresTodos: [] },
    dom: { listaAgricultores: elements.get("listaAgricultores") },
    db: {
      from(table) {
        calls.push(["from", table]);
        return fakeQuery(response, (method, args) => calls.push([method, ...args]));
      },
    },
    $: (id) => elements.get(id),
    traerTodo: async (build) => { build(); return response; },
    escapar: escapeHtml,
    fmtCodigo: (value) => String(value).padStart(3, "0"),
    actualizarContador: (...args) => { app.count = args; },
  };
  const context = loadModule("agricultores.js", app);
  return { app, module: context.window.App, elements, calls };
}

test("agricultores load and render complete results safely", async () => {
  const { app, module, elements } = createAgricultoresHarness({
    data: [{ id: 1, codigo: 7, nombre: "<Proveedor & Asociado>" }],
    error: null,
  });
  assert.equal(await module.cargarAgricultores(), true);
  assert.equal(app.state.agricultoresTodos[0].id, 1);
  assert.match(elements.get("listaAgricultores").innerHTML, /&lt;Proveedor &amp; Asociado&gt;/);
  assert.match(elements.get("liqAgricultor").innerHTML, /007 · &lt;Proveedor/);
  assert.deepEqual(app.count, ["countAgricultores", 1, "agricultor", "agricultores"]);
});

test("agricultores search escapes filter syntax and matches numeric codes", async () => {
  const { module, elements, calls } = createAgricultoresHarness({ data: [], error: null });
  elements.get("buscarAgricultor").value = "007";
  await module.cargarAgricultores();

  const orCall = calls.find(([name]) => name === "or");
  assert.deepEqual(orCall, ["or", 'nombre.ilike."%007%",codigo.in.(7)']);
});

test("agricultores search by a code prefix matches every code that starts with it", async () => {
  const { module, elements, calls } = createAgricultoresHarness({ data: [], error: null });
  elements.get("buscarAgricultor").value = "01";
  await module.cargarAgricultores();

  const orCall = calls.find(([name]) => name === "or");
  assert.deepEqual(orCall, ["or", 'nombre.ilike."%01%",codigo.in.(1,10,11,12,13,14,15,16,17,18,19)']);
});

test("agricultores load failure returns false and escapes the error", async () => {
  const { module, elements } = createAgricultoresHarness({
    data: null,
    error: { message: "<sin conexión>" },
  });
  assert.equal(await module.cargarAgricultores(), false);
  assert.match(elements.get("listaAgricultores").innerHTML, /&lt;sin conexión&gt;/);
});

test("agricultores list and dropdowns are ordered by farmer code", async () => {
  const { module, calls } = createAgricultoresHarness({ data: [], error: null });
  const orderBy = { codigo: ["order", "codigo", { ascending: true, nullsFirst: false }], id: ["order", "id"] };

  await module.cargarAgricultores();
  assert.deepEqual(JSON.parse(JSON.stringify(calls.filter(([name]) => name === "order"))), [orderBy.codigo, orderBy.id]);

  calls.length = 0;
  await module.asegurarAgricultoresTodos(true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.filter(([name]) => name === "order"))), [orderBy.codigo, orderBy.id]);
});

const CAMPOS_AGRICULTOR = ["nif", "direccion", "codigo_postal", "poblacion", "provincia", "telefono", "email", "iban"];

function createFichaHarness(agricultores) {
  const elements = new Map();
  for (const id of [
    "buscarAgricultor", "listaAgricultores", "countAgricultores",
    "verAgricultorTitulo", "verAgricultorGenerales", "verAgricultorFiscales",
    "btnEditarDesdeVer", "modalAgricultorTitulo", "agricultorId", "nombre",
    "codigoAgricultor", "campoCodigoAgricultor",
    ...CAMPOS_AGRICULTOR.map((c) => `agri_${c}`),
  ]) elements.set(id, createElement({ focus() {} }));
  const modalVerAgricultor = createElement();
  const modalAgricultor = createElement();
  const abiertos = new Set();
  const app = {
    state: { agricultoresActuales: agricultores, agricultoresTodos: agricultores },
    dom: {
      listaAgricultores: elements.get("listaAgricultores"),
      formAgricultor: createElement({ reset() {} }),
      modalVerAgricultor,
      modalAgricultor,
    },
    db: { from: () => fakeQuery({ data: [], error: null }) },
    $: (id) => elements.get(id),
    CAMPOS_AGRICULTOR,
    escapar: escapeHtml,
    valor: (v) => (v === null || v === undefined || v === "" ? "—" : escapeHtml(v)),
    fmtCodigo: (value) => String(value).padStart(3, "0"),
    actualizarContador() {},
    abrirModal: (m) => abiertos.add(m),
    cerrarModal: (m) => abiertos.delete(m),
  };
  const context = loadModule("agricultores.js", app);
  const module = context.window.App;
  module.configurarEventosAgricultores();
  return { module, elements, abiertos, modalVerAgricultor, modalAgricultor };
}

function clickEn(lista, atributo, id) {
  lista.dispatch("click", {
    target: { closest: (selector) => (selector === `[${atributo}]` ? { dataset: datasetDe(atributo, id) } : null) },
    stopPropagation() {},
  });
}

function datasetDe(atributo, id) {
  const clave = atributo.replace(/^data-/, "").replace(/-(\w)/g, (_, c) => c.toUpperCase());
  return { [clave]: String(id) };
}

const AGRICULTOR = {
  id: 3, codigo: 12, nombre: "<Pepe & Hijos>",
  nif: "12345678Z", direccion: "C/ Mayor 1", codigo_postal: "18001",
  poblacion: "Granada", provincia: "Granada", telefono: null, email: "", iban: "ES91 2100 0418 4502 0005 1332",
};

test("agricultores list offers a 'Ver datos' button next to Editar", () => {
  const { module, elements } = createFichaHarness([AGRICULTOR]);
  module.pintarAgricultores([AGRICULTOR]);
  const html = elements.get("listaAgricultores").innerHTML;
  assert.match(html, /data-ver-agri="3">Ver datos</);
  assert.match(html, /data-edit-agri="3">Editar</);
});

test("agricultores 'Ver datos' shows general and fiscal data read-only and escaped", () => {
  const { elements, abiertos, modalVerAgricultor } = createFichaHarness([AGRICULTOR]);
  clickEn(elements.get("listaAgricultores"), "data-ver-agri", 3);

  assert.equal(abiertos.has(modalVerAgricultor), true);
  assert.equal(elements.get("verAgricultorTitulo").textContent, "Datos de <Pepe & Hijos>");
  const generales = elements.get("verAgricultorGenerales").innerHTML;
  assert.match(generales, /Código<\/span><b>012</);
  assert.match(generales, /&lt;Pepe &amp; Hijos&gt;/);
  const fiscales = elements.get("verAgricultorFiscales").innerHTML;
  assert.match(fiscales, /NIF \/ CIF<\/span><b>12345678Z</);
  assert.match(fiscales, /IBAN<\/span><b>ES91 2100 0418 4502 0005 1332</);
  assert.match(fiscales, /Teléfono<\/span><b>—</, "empty values show a dash");
  assert.match(fiscales, /Email<\/span><b>—</);
});

test("agricultores 'Editar' from the data view opens the edit form already filled in", () => {
  const { elements, abiertos, modalVerAgricultor, modalAgricultor } = createFichaHarness([AGRICULTOR]);
  clickEn(elements.get("listaAgricultores"), "data-ver-agri", 3);
  elements.get("btnEditarDesdeVer").dispatch("click");

  assert.equal(abiertos.has(modalVerAgricultor), false);
  assert.equal(abiertos.has(modalAgricultor), true);
  assert.equal(elements.get("modalAgricultorTitulo").textContent, "Editar agricultor");
  assert.equal(elements.get("agricultorId").value, 3);
  assert.equal(elements.get("nombre").value, "<Pepe & Hijos>");
  assert.equal(elements.get("agri_nif").value, "12345678Z");
  assert.equal(elements.get("agri_telefono").value, "");
});
