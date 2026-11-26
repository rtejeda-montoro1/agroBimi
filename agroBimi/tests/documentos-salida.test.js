const test = require("node:test");
const assert = require("node:assert/strict");
const { fakeQuery, loadModule, flush } = require("./helpers");

// Los objetos creados dentro de vm son de otro contexto: se comparan en plano.
const plano = (v) => JSON.parse(JSON.stringify(v));

// QR de mentira: guarda lo que se le pide y devuelve un SVG reconocible.
function qrFalso(registro) {
  return (version, nivel) => {
    const qr = { version, nivel };
    registro.push(qr);
    return {
      addData: (texto) => { qr.texto = texto; },
      make: () => {},
      createSvgTag: () => `<svg data-qr="${qr.texto}"></svg>`,
    };
  };
}

// Las plantillas con las utilidades de verdad (escapado, números, fechas).
function crearDocumentos(window = {}) {
  const app = { state: {} };
  window.App = app;
  loadModule("utils.js", app, { window, document: { createElement: () => ({}) } });
  loadModule("documentos-salida.js", app, { window });
  return app;
}

const SALIDA = {
  id: 7,
  numero: "ALB-0003",
  fecha: "2026-11-25",
  destinatario_nombre: "Destino SL",
  matricula: "1234-ABC",
  lugar_carga: "Almacén",
  token: "bbec1a05-0c67-40ce-9de9-6080170f754c",
  copia: null,
  palets: [
    { codigo: "P000002", num_cajas: 30, secuencia: 2, palet_lineas: [
      { agricultor_id: 2, num_cajas: 30, registros: { fecha: "2026-11-24" } }] },
    { codigo: "P000001", num_cajas: 60, secuencia: 1, palet_lineas: [
      { agricultor_id: 1, num_cajas: 60, registros: { fecha: "2026-11-23" } }] },
  ],
};

const AGRICULTORES = { 1: { nombre: "<Pepe & Hijos>", nif: "12345678Z", telefono: "600" }, 2: { nombre: "Ana", nif: "X" } };
const fuentes = () => ({
  emisor: { nombre: "Almacén Bimi", nif: "B1" },
  agricultorPorId: (id) => AGRICULTORES[id],
  param: (k) => ({ cmr_remitente: "Remitente", cmr_porteador: "Porteador", cmr_tipo_palet: "palet 100x120", kg_por_caja: "8" })[k],
});

test("documentos: the copy freezes the shipment, its farmers and the settings it needs", () => {
  const app = crearDocumentos();
  const copia = app.construirCopia(SALIDA, fuentes());

  assert.equal(copia.version, 1);
  assert.equal(copia.albaran.numero, "ALB-0003");
  assert.equal(copia.albaran.token, SALIDA.token);
  assert.equal("copia" in copia.albaran, false);
  assert.deepEqual(plano(copia.albaran.palets.map((p) => p.codigo)), ["P000001", "P000002"]);
  assert.deepEqual(plano(copia.albaran.palets[0].palet_lineas), [{ agricultor_id: 1, num_cajas: 60, fecha: "2026-11-23" }]);
  // Solo lo que sale en el documento: ni teléfono ni otros datos del agricultor.
  assert.deepEqual(plano(copia.agricultores), { 1: { nombre: "<Pepe & Hijos>", nif: "12345678Z" }, 2: { nombre: "Ana", nif: "X" } });
  assert.deepEqual(plano(copia.ajustes), { cmr_remitente: "Remitente", cmr_porteador: "Porteador", cmr_tipo_palet: "palet 100x120", kg_por_caja: "8" });
  assert.equal(JSON.parse(JSON.stringify(copia)).albaran.numero, "ALB-0003", "se puede guardar como jsonb");
});

test("documentos: CMR and delivery note come from the copy, escaped, with kg and the QR", () => {
  const qrs = [];
  const app = crearDocumentos({ qrcode: qrFalso(qrs) });
  const copia = app.construirCopia(SALIDA, fuentes());
  // Lo de la copia manda aunque luego cambien los Ajustes.
  copia.ajustes.kg_por_caja = "10";

  const url = app.urlCopia(SALIDA.token, "https://ejemplo.github.io/agroBimi/agroBimi/index.html?x=1#y");
  assert.equal(url, "https://ejemplo.github.io/agroBimi/agroBimi/albaran.html?t=bbec1a050c6740ce9de96080170f754c");
  assert.equal(app.urlCopia(SALIDA.token, "https://ejemplo.github.io/agroBimi/agroBimi/"),
    "https://ejemplo.github.io/agroBimi/agroBimi/albaran.html?t=bbec1a050c6740ce9de96080170f754c");

  const html = app.htmlSalida(copia, { url });
  assert.equal((html.match(/class="cmr"/g) || []).length, 3, "tres ejemplares del CMR");
  assert.equal((html.match(/class="rec alb"/g) || []).length, 1, "y el albarán");
  assert.equal(qrs.length, 1, "un solo QR para todo el documento");
  assert.equal(qrs[0].texto, url);
  assert.equal(qrs[0].nivel, "M");
  assert.equal((html.match(/data-qr=/g) || []).length, 4, "QR en cada CMR y en el albarán");
  assert.match(html, /&lt;Pepe &amp; Hijos&gt;/);
  assert.doesNotMatch(html, /<Pepe/);
  // 90 cajas × 10 kg de la copia.
  assert.match(html, /Kg: <b>900<\/b>/);
  assert.match(html, /Remitente/);
});

test("documentos: without the QR library or a code the documents print without QR", () => {
  const app = crearDocumentos();
  const copia = app.construirCopia(SALIDA, fuentes());
  const html = app.htmlSalida(copia, { url: "https://x/albaran.html?t=1", ejemplares: [], albaran: true });
  assert.doesNotMatch(html, /doc-qr/);
  assert.equal(app.urlCopia(null, "https://x/"), "");
});

// --- Oficina: la copia se guarda la primera vez que se imprime ----------
function crearSalidas(fila, { ajustes = true, agricultores = true } = {}) {
  const app = { state: {} };
  const window = { App: app, location: { href: "https://ejemplo.github.io/agroBimi/agroBimi/" } };
  loadModule("utils.js", app, { window, document: { createElement: () => ({}) } });
  loadModule("documentos-salida.js", app, { window });
  const llamadas = [];
  Object.assign(app, {
    db: { from: (tabla) => fakeQuery(
      { data: [fila], error: null },
      (metodo, args) => llamadas.push([tabla, metodo, ...args])) },
    consultar: async (q) => (await q).data,
    datosEmisor: () => ({ nombre: "Almacén Bimi" }),
    agricultorPorId: (id) => (agricultores ? AGRICULTORES[id] : null),
    asegurarParametros: async () => ajustes,
    asegurarAgricultoresTodos: async () => { app.agricultoresRecargados = true; return []; },
    param: fuentes().param,
    toast: (m) => { app.ultimoToast = m; },
    imprimirDocumento: (html, nombre) => { app.impreso = { html, nombre }; },
  });
  loadModule("salidas.js", app, { window, document: { querySelectorAll: () => [] } });
  return { app, llamadas };
}

test("salidas save the copy the first time they print and reuse it afterwards", async () => {
  const { app, llamadas } = crearSalidas({ ...SALIDA });
  await app.imprimirSalida(7);

  const update = llamadas.find((l) => l[1] === "update");
  assert.ok(update, "guarda la copia");
  assert.equal(update[2].copia.albaran.numero, "ALB-0003");
  assert.ok(llamadas.some((l) => l[1] === "is" && l[2] === "copia" && l[3] === null), "solo si no tenía");
  assert.match(app.impreso.html, /&lt;Pepe &amp; Hijos&gt;/);
  assert.match(app.impreso.nombre, /Porte de salida ALB-0003/);

  // Ya con copia: no se vuelve a guardar y sale lo guardado aunque los
  // datos del agricultor hayan cambiado.
  const guardada = update[2].copia;
  const otra = crearSalidas({ ...SALIDA, copia: guardada });
  AGRICULTORES[1].nombre = "Nombre nuevo";
  try {
    await otra.app.imprimirSalida(7, { cmr: false });
    assert.equal(otra.llamadas.some((l) => l[1] === "update"), false);
    assert.match(otra.app.impreso.html, /&lt;Pepe &amp; Hijos&gt;/);
    assert.doesNotMatch(otra.app.impreso.html, /Nombre nuevo/);
    assert.doesNotMatch(otra.app.impreso.html, /class="cmr"/);
  } finally {
    AGRICULTORES[1].nombre = "<Pepe & Hijos>";
  }
});

test("salidas do not freeze or print a blank copy when settings or farmers failed to load", async () => {
  const sinAjustes = crearSalidas({ ...SALIDA }, { ajustes: false });
  await sinAjustes.app.imprimirSalida(7);
  assert.equal(sinAjustes.llamadas.some((l) => l[1] === "update"), false, "no guarda la copia");
  assert.equal(sinAjustes.app.impreso, undefined, "ni imprime un CMR sin emisor");

  const sinAgricultores = crearSalidas({ ...SALIDA }, { agricultores: false });
  await sinAgricultores.app.imprimirSalida(7);
  assert.equal(sinAgricultores.app.agricultoresRecargados, true, "vuelve a pedirlos");
  assert.equal(sinAgricultores.llamadas.some((l) => l[1] === "update"), false);
  assert.equal(sinAgricultores.app.impreso, undefined);
  assert.match(sinAgricultores.app.ultimoToast, /agricultores/);

  // Una copia ya guardada se reimprime aunque ahora fallen los ajustes.
  const guardada = crearSalidas({ ...SALIDA }).app;
  await guardada.imprimirSalida(7);
  const conCopia = crearSalidas({ ...SALIDA, copia: { albaran: { token: null, palets: [] }, emisor: {}, agricultores: {}, ajustes: {} } }, { ajustes: false });
  await conCopia.app.imprimirSalida(7);
  assert.ok(conCopia.app.impreso);
});

// --- Página pública del QR ---------------------------------------------
function crearPublica() {
  const app = { state: {} };
  const window = { App: app };
  loadModule("utils.js", app, { window, document: { createElement: () => ({}) } });
  loadModule("documentos-salida.js", app, { window });
  loadModule("albaran-publico.js", app, { window, document: {} });
  const el = () => ({ innerHTML: "", textContent: "", hidden: true });
  return { app, documento: el(), estado: el(), barra: el() };
}

test("public copy accepts only a 32-hex code from the link", () => {
  const { app } = crearPublica();
  assert.equal(app.codigoDeEnlace("?t=BBEC1A050C6740CE9DE96080170F754C"), "bbec1a050c6740ce9de96080170f754c");
  assert.equal(app.codigoDeEnlace("?x=1&t=bbec1a05-0c67-40ce-9de9-6080170f754c"), "bbec1a050c6740ce9de96080170f754c");
  assert.equal(app.codigoDeEnlace("?t=nope"), null);
  assert.equal(app.codigoDeEnlace("?t=bbec1a050c6740ce9de96080170f754c'--"), null);
  assert.equal(app.codigoDeEnlace(""), null);
});

test("public copy shows the carrier's CMR and the delivery note, or says why it cannot", async () => {
  const { app, documento, estado, barra } = crearPublica();
  const copia = app.construirCopia(SALIDA, fuentes());
  const pedidos = [];
  const db = (respuesta) => ({ rpc: async (fn, args) => { pedidos.push([fn, args]); return respuesta; } });
  const base = { search: "?t=bbec1a050c6740ce9de96080170f754c", href: "https://x/agroBimi/albaran.html?t=bbec1a050c6740ce9de96080170f754c", documento, estado, barra };

  assert.ok(await app.mostrarCopia({ ...base, db: db({ data: copia, error: null }) }));
  assert.deepEqual(plano(pedidos[0]), ["albaran_copia", { p_token: "bbec1a050c6740ce9de96080170f754c" }]);
  assert.equal((documento.innerHTML.match(/class="cmr"/g) || []).length, 1);
  assert.match(documento.innerHTML, /Ejemplar para el PORTEADOR/);
  assert.match(documento.innerHTML, /ALBARÁN DE SALIDA/);
  assert.equal(estado.hidden, true);
  assert.equal(barra.hidden, false);

  const fallo = crearPublica();
  assert.equal(await fallo.app.mostrarCopia({ ...base, ...fallo, db: db({ data: null, error: null }) }), false);
  assert.match(fallo.estado.textContent, /no existe o ha sido anulado/);
  assert.equal(fallo.documento.innerHTML, "");

  const red = crearPublica();
  assert.equal(await red.app.mostrarCopia({ ...base, ...red, db: db({ data: null, error: { message: "x" } }) }), false);
  assert.match(red.estado.textContent, /Comprueba la conexión/);

  const malo = crearPublica();
  const antes = pedidos.length;
  assert.equal(await malo.app.mostrarCopia({ ...base, ...malo, search: "?t=1", db: db({}) }), false);
  assert.equal(pedidos.length, antes, "con un enlace mal formado ni pregunta");
  assert.match(malo.estado.textContent, /no es válido/);
  await flush();
});
