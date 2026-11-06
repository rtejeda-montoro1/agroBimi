const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement, escapeHtml, loadModule } = require("./helpers");

test("facturas render an ordered, escaped compensation receipt preview", () => {
  const ids = [
    "modalFacturaTitulo", "facturaAviso", "facturaRegistroId", "facturaEmisor",
    "facturaCliente", "facturaRegistro", "cuerpoFacturaLineas", "facturaBase",
    "facturaIvaEtiqueta", "facturaIva", "facturaRetencionEtiqueta",
    "facturaRetencion", "facturaTotal", "facturaObservaciones",
    "facturaObservacionesBloque", "btnImprimirFactura",
  ];
  const elements = new Map(ids.map((id) => [id, createElement()]));
  const app = {
    dom: { modalFactura: createElement() },
    $: (id) => elements.get(id) || null,
    agricultorPorId: () => ({
      nombre: "<Proveedor>",
      codigo: 9,
      direccion: "Calle 1",
      codigo_postal: "12345",
      poblacion: "Pueblo",
      provincia: "Provincia",
      nif: "NIF",
      telefono: "123",
      iban: "ES00",
    }),
    datosEmisor: () => ({ nombre: "Almacén", nif: "X", direccion: "Av. 1", codigo_postal: "00000", poblacion: "Ciudad" }),
    fmtCodigo: (value) => String(value).padStart(3, "0"),
    formatearFecha: (value) => value || "—",
    campanaNombre: () => "2026/27",
    escapar: escapeHtml,
    fmtCantidad: String,
    fmtPrecio: String,
    fmtEuro: (value) => `${Number(value).toFixed(2)} €`,
    fmtNum: (value) => String(value),
    num: (value) => Number(value) || 0,
    valor: (value) => escapeHtml(value ?? "—"),
  };
  const module = loadModule("facturas.js", app).window.App;
  module.abrirModalFactura({
    id: 17,
    estado: "facturada",
    agricultor_id: 3,
    numero: "LIQ-0001",
    num_factura: "RC-0001",
    fecha: "2026-03-31",
    fecha_desde: "2026-03-01",
    fecha_hasta: "2026-03-31",
    fecha_factura: "2026-04-01",
    campana_id: 2,
    iva_porcentaje: 12,
    retencion_porcentaje: 2,
    retencion: 3,
    base: 100,
    iva: 12,
    total: 109,
    observaciones: "<revisar>",
    liquidacion_lineas: [
      { orden: 2, concepto: "Segundo", cantidad: 1, precio: 2, importe: 2 },
      { orden: 1, concepto: "<Primero>", cantidad: 1, precio: 1, importe: 1 },
    ],
  });

  assert.match(elements.get("modalFacturaTitulo").innerHTML, /RECIBO DE COMPENSACIÓN - FACTURA/);
  assert.match(elements.get("modalFacturaTitulo").innerHTML, /RC-0001/);
  assert.equal(elements.get("facturaRegistroId").value, 17);
  assert.equal(elements.get("facturaAviso").hidden, true);
  assert.ok(elements.get("cuerpoFacturaLineas").innerHTML.indexOf("&lt;Primero&gt;") <
    elements.get("cuerpoFacturaLineas").innerHTML.indexOf("Segundo"));
  assert.match(elements.get("facturaCliente").innerHTML, /&lt;Proveedor&gt;/);
  assert.equal(elements.get("facturaObservacionesBloque").hidden, false);
  assert.equal(app.dom.modalFactura.classList.contains("open"), true);
});
