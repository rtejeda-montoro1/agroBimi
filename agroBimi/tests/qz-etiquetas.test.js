const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers");

// QZ Tray falso: apunta lo que se le pide y falla donde se le diga.
function qzFalso({ conecta = true, impresora = "TOSHIBA BV400 (203 dpi)", imprime = true } = {}) {
  const r = { conexiones: 0, buscada: null, config: null, datos: null, seguridad: {} };
  let activo = false;
  r.qz = {
    security: {
      setCertificatePromise: (f) => { r.seguridad.certificado = f; },
      setSignatureAlgorithm: (a) => { r.seguridad.algoritmo = a; },
      setSignaturePromise: (f) => { r.seguridad.firma = f; },
    },
    websocket: {
      isActive: () => activo,
      connect: async () => {
        r.conexiones++;
        if (!conecta) throw new Error("Unable to establish connection with QZ");
        activo = true;
      },
    },
    printers: {
      find: async (q) => {
        r.buscada = q;
        if (!impresora) throw new Error(`Specified printer could not be found.`);
        return impresora;
      },
    },
    configs: { create: (nombre, opciones) => ({ nombre, ...opciones }) },
    print: async (config, datos) => {
      if (!imprime) throw new Error("Printer offline");
      r.config = config;
      r.datos = datos;
    },
  };
  return r;
}

function cargar(qz) {
  const window = { qz };
  loadModule("qz-etiquetas.js", {}, { window });
  return window.QZEtiquetas;
}

const db = (firma = { data: "FIRMA==", error: null }) => {
  const llamadas = [];
  return {
    llamadas,
    functions: { invoke: async (nombre, opciones) => { llamadas.push({ nombre, opciones }); return firma; } },
  };
};

test("QZ labels go to the BV400 at the label size, in black and white, as HTML with its own styles", async () => {
  const f = qzFalso();
  await cargar(f.qz).imprimir({ html: "<div class=\"etq\">P-9</div>", ancho: 105, alto: 75 }, db());

  assert.equal(f.buscada, "BV400");
  assert.equal(f.config.nombre, "TOSHIBA BV400 (203 dpi)");
  assert.equal(JSON.stringify(f.config.size), JSON.stringify({ width: 105, height: 75 }));
  assert.equal(f.config.units, "mm");
  assert.equal(f.config.colorType, "blackwhite");
  assert.equal(f.datos[0].type, "pixel");
  assert.equal(f.datos[0].format, "html");
  assert.match(f.datos[0].data, /<style>[\s\S]*\.etq-tabla[\s\S]*<\/style>[\s\S]*P-9/);
  // Nada en gris: la térmica no los imprime bien.
  assert.doesNotMatch(f.datos[0].data, /#333|#444|#555|#666/);
});

test("QZ requests are signed by the qz-firmar Supabase function with SHA512 and our certificate", async () => {
  const f = qzFalso();
  const cliente = db();
  await cargar(f.qz).imprimir({ html: "x" }, cliente);

  assert.equal(f.seguridad.algoritmo, "SHA512");
  const certificado = await new Promise((resolve) => f.seguridad.certificado(resolve));
  assert.match(certificado, /^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----$/);
  assert.doesNotMatch(certificado, /PRIVATE KEY/);

  const firma = await new Promise((resolve, reject) => f.seguridad.firma("hash-123")(resolve, reject));
  assert.equal(firma, "FIRMA==");
  assert.equal(JSON.stringify(cliente.llamadas),
    JSON.stringify([{ nombre: "qz-firmar", opciones: { body: { peticion: "hash-123" } } }]));
});

test("QZ signature errors reject instead of signing with nothing", async () => {
  const f = qzFalso();
  await cargar(f.qz).imprimir({ html: "x" }, db({ data: null, error: new Error("403") }));
  await assert.rejects(
    new Promise((resolve, reject) => f.seguridad.firma("hash")(resolve, reject)), /403/);
});

test("QZ connects once and reuses the connection for the next label", async () => {
  const f = qzFalso();
  const qz = cargar(f.qz);
  await qz.imprimir({ html: "1" }, db());
  await qz.imprimir({ html: "2" }, db());
  assert.equal(f.conexiones, 1);
});

test("QZ failures give the operator a reason and never print elsewhere", async () => {
  await assert.rejects(cargar(qzFalso({ conecta: false }).qz).imprimir({ html: "x" }, db()),
    (e) => /QZ Tray no está abierto/.test(e.aviso));

  const sinImpresora = qzFalso({ impresora: null });
  await assert.rejects(cargar(sinImpresora.qz).imprimir({ html: "x" }, db()),
    (e) => /No se encuentra la impresora de etiquetas/.test(e.aviso));
  assert.equal(sinImpresora.datos, null);

  await assert.rejects(cargar(qzFalso({ imprime: false }).qz).imprimir({ html: "x" }, db()),
    (e) => /no pudo imprimir la etiqueta/.test(e.aviso));

  await assert.rejects(cargar(undefined).imprimir({ html: "x" }, db()),
    (e) => /No se pudo cargar QZ Tray/.test(e.aviso));
});

test("QZ that never answers fails after a time limit instead of blocking the print queue", async () => {
  const f = qzFalso();
  let desconectado = 0;
  f.qz.print = () => new Promise(() => {});           // p. ej. esperando «Allow»
  f.qz.websocket.disconnect = async () => { desconectado++; };
  const window = { qz: f.qz };
  loadModule("qz-etiquetas.js", {}, { window, setTimeout, clearTimeout });

  await assert.rejects(window.QZEtiquetas.imprimir({ html: "x" }, db(), { limite: 20 }),
    (e) => /QZ Tray no responde/.test(e.aviso));
  assert.equal(desconectado, 1, "cierra la conexión para empezar de cero");
});
