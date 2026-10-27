// =====================================================================
//  Liquidación / recibo de compensación: documento
//  ---------------------------------------------------------------------
//  El mismo modal sirve para las dos cosas: mientras la liquidación no
//  está facturada se ve como "Liquidación", y en cuanto se le asigna un
//  nº pasa a verse como "Recibo de compensación" (el documento que el
//  cliente entrega al agricultor, con IVA de compensación y retención).
//
//  La descarga en PDF se hace con el propio navegador: al imprimir se
//  puede elegir "Guardar como PDF", así que no hace falta ninguna
//  librería externa.
// =====================================================================

(function initFacturasModule(App) {
  // Liquidación que se está viendo (la necesita el botón de imprimir).
  let liquidacionVista = null;

  // Pinta un bloque de la plantilla como pares etiqueta / valor.
  function pintarDatos(idContenedor, datos) {
    App.$(idContenedor).innerHTML = Object.entries(datos).map(([etiqueta, valor]) => `
      <div class="factura-fila">
        <span>${App.escapar(etiqueta)}</span>
        <b>${App.valor(valor)}</b>
      </div>`).join("");
  }

  function lineasOrdenadas(liquidacion) {
    return [...(liquidacion.liquidacion_lineas || [])]
      .sort((a, b) => App.num(a.orden) - App.num(b.orden));
  }

  function direccionCompleta(datos) {
    return [
      datos.direccion,
      [datos.codigo_postal, datos.poblacion].filter(Boolean).join(" "),
      datos.provincia,
    ].filter(Boolean).join(" · ");
  }

  function abrirModalFactura(liquidacion) {
    if (!liquidacion) return;

    liquidacionVista = liquidacion;
    // Con factura del agricultor no hay recibo propio: se ve como
    // liquidación, con el nº de su factura en los datos del documento.
    const deAgricultor = liquidacion.estado === "facturada" && liquidacion.factura_agricultor;
    const facturada = liquidacion.estado === "facturada" && !deAgricultor;
    const agricultor = App.agricultorPorId(liquidacion.agricultor_id) || {};
    const emisor = App.datosEmisor();

    App.$("modalFacturaTitulo").textContent = facturada
      ? `🧾 Recibo de compensación ${liquidacion.num_factura || ""}`.trim()
      : `📄 Liquidación ${liquidacion.numero || ""}`.trim();

    App.$("facturaAviso").hidden = facturada || deAgricultor;
    App.$("facturaRegistroId").value = liquidacion.id;

    pintarDatos("facturaEmisor", {
      "Nombre": emisor.nombre,
      "NIF / CIF": emisor.nif,
      "Dirección": direccionCompleta(emisor),
      "Registro de establecimiento": emisor.registro,
      "Teléfono": emisor.telefono,
      "Email": emisor.email,
    });

    pintarDatos("facturaCliente", {
      "Código": App.fmtCodigo(agricultor.codigo),
      "Agricultor": agricultor.nombre,
      "NIF": agricultor.nif,
      "Dirección": direccionCompleta(agricultor),
      "Teléfono": agricultor.telefono,
      "IBAN": agricultor.iban,
    });

    pintarDatos("facturaRegistro", {
      "Nº Liquidación": liquidacion.numero,
      "Fecha": App.formatearFecha(liquidacion.fecha),
      "Periodo": `${App.formatearFecha(liquidacion.fecha_desde)} — ${App.formatearFecha(liquidacion.fecha_hasta)}`,
      "Campaña": liquidacion.campana_id ? App.campanaNombre(liquidacion.campana_id) : "—",
      [deAgricultor ? "Nº Factura del agricultor" : "Nº Recibo"]: liquidacion.num_factura,
      [deAgricultor ? "Fecha de su factura" : "Fecha Recibo"]: App.formatearFecha(liquidacion.fecha_factura),
    });

    App.$("cuerpoFacturaLineas").innerHTML = lineasOrdenadas(liquidacion).map((l) => `
      <tr>
        <td>${App.escapar(l.concepto)}</td>
        <td class="col-num">${App.fmtNum(l.cantidad, 0)}</td>
        <td class="col-num">${App.fmtEuro(l.precio)}</td>
        <td class="col-num ${App.num(l.importe) < 0 ? "negativo" : ""}"><b>${App.fmtEuro(l.importe)}</b></td>
      </tr>`).join("");

    App.$("facturaBase").textContent = App.fmtEuro(liquidacion.base);
    App.$("facturaIvaEtiqueta").textContent =
      `IVA / compensación (${App.fmtNum(liquidacion.iva_porcentaje, 2)} %)`;
    App.$("facturaIva").textContent = App.fmtEuro(liquidacion.iva);
    App.$("facturaRetencionEtiqueta").textContent =
      `Retención IRPF (${App.fmtNum(App.num(liquidacion.retencion_porcentaje), 2)} %)`;
    App.$("facturaRetencion").textContent = App.fmtEuro(-App.num(liquidacion.retencion));
    App.$("facturaTotal").textContent = App.fmtEuro(liquidacion.total);
    App.$("facturaObservaciones").textContent = liquidacion.observaciones || "";
    App.$("facturaObservacionesBloque").hidden = !liquidacion.observaciones;

    App.$("btnImprimirFactura").textContent = facturada ? "🖨 Imprimir recibo" : "🖨 Imprimir liquidación";

    App.dom.modalFactura.classList.add("open");
  }

  // ------------------------------------------------------------------
  //  Documento imprimible
  // ------------------------------------------------------------------
  //  Formato de la factura de siempre (cabecera con título y nº, emisor y
  //  agricultor en dos recuadros, tabla de conceptos y totales a la
  //  derecha), pero titulado "Recibo de compensación" y con la retención
  //  IRPF restada antes del total.
  function bloqueParte(titulo, datos) {
    return `
      <div class="doc-parte">
        <h2>${App.escapar(titulo)}</h2>
        <b>${App.escapar(datos.nombre || "—")}</b>
        ${datos.nif ? `<div>NIF: ${App.escapar(datos.nif)}</div>` : ""}
        ${datos.direccion ? `<div>${App.escapar(datos.direccion)}</div>` : ""}
        <div>${App.escapar([datos.codigo_postal, datos.poblacion, datos.provincia].filter(Boolean).join(" "))}</div>
        ${datos.registro ? `<div>Reg. establecimiento: ${App.escapar(datos.registro)}</div>` : ""}
        ${datos.telefono ? `<div>Tel.: ${App.escapar(datos.telefono)}</div>` : ""}
        ${datos.email ? `<div>${App.escapar(datos.email)}</div>` : ""}
        ${datos.iban ? `<div>IBAN: ${App.escapar(datos.iban)}</div>` : ""}
      </div>`;
  }

  function imprimirFactura() {
    const l = liquidacionVista;
    if (!l) return;

    // Con factura del agricultor se imprime la liquidación (el documento
    // fiscal es su factura), indicando su nº y su fecha.
    const deAgricultor = l.estado === "facturada" && l.factura_agricultor;
    const facturada = l.estado === "facturada" && !deAgricultor;
    const agricultor = App.agricultorPorId(l.agricultor_id) || {};
    const emisor = App.datosEmisor();
    // 12 % y no 12,00 %, pero sin perder decimales si los hay (2,5 %).
    const pct = (v) => App.fmtNum(App.num(v), Number.isInteger(App.num(v)) ? 0 : 2);

    const filas = lineasOrdenadas(l).map((linea) => `
      <tr>
        <td>${App.escapar(linea.concepto)}</td>
        <td class="der">${App.fmtNum(linea.cantidad, 0)}</td>
        <td class="der">${App.fmtEuro(linea.precio)}</td>
        <td class="der">${App.fmtEuro(linea.importe)}</td>
      </tr>`).join("");

    App.imprimirDocumento(`
      <div class="doc">
        <div class="doc-cab">
          <div>
            <h1>${facturada ? "Recibo de compensación" : "Liquidación"}</h1>
            <p class="doc-num">${App.escapar((facturada ? l.num_factura : l.numero) || "")}</p>
          </div>
          <div class="doc-datos-cab">
            <div><span>Fecha</span><b>${App.formatearFecha(facturada ? l.fecha_factura : l.fecha)}</b></div>
            <div><span>Periodo</span><b>${App.formatearFecha(l.fecha_desde)} — ${App.formatearFecha(l.fecha_hasta)}</b></div>
            ${l.campana_id ? `<div><span>Campaña</span><b>${App.escapar(App.campanaNombre(l.campana_id))}</b></div>` : ""}
            ${facturada && l.numero ? `<div><span>Liquidación</span><b>${App.escapar(l.numero)}</b></div>` : ""}
            ${deAgricultor ? `<div><span>Factura del agricultor</span><b>${App.escapar(l.num_factura || "")}</b></div>` : ""}
            ${deAgricultor && l.fecha_factura ? `<div><span>Fecha de su factura</span><b>${App.formatearFecha(l.fecha_factura)}</b></div>` : ""}
          </div>
        </div>

        <div class="doc-partes">
          ${bloqueParte("Emisor", emisor)}
          ${bloqueParte("Agricultor", {
            nombre: agricultor.nombre,
            nif: agricultor.nif,
            direccion: agricultor.direccion,
            codigo_postal: agricultor.codigo_postal,
            poblacion: agricultor.poblacion,
            provincia: agricultor.provincia,
            telefono: agricultor.telefono,
            email: agricultor.email,
            iban: agricultor.iban,
          })}
        </div>

        <table class="doc-tabla">
          <thead>
            <tr>
              <th>Concepto</th><th class="der">Cantidad</th>
              <th class="der">Precio</th><th class="der">Importe</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>

        <div class="doc-totales">
          <div><span>Base</span><b>${App.fmtEuro(l.base)}</b></div>
          <div><span>IVA / compensación (${pct(l.iva_porcentaje)} %)</span><b>${App.fmtEuro(l.iva)}</b></div>
          <div><span>Retención IRPF (${pct(l.retencion_porcentaje)} %)</span><b>${App.fmtEuro(-App.num(l.retencion))}</b></div>
          <div class="doc-total"><span>Total</span><b>${App.fmtEuro(l.total)}</b></div>
        </div>

        ${l.observaciones
          ? `<div class="doc-obs"><b>Observaciones:</b> ${App.escapar(l.observaciones)}</div>`
          : ""}

        ${!facturada && !deAgricultor
          ? '<p class="doc-pie">Documento de liquidación: todavía no tiene número de recibo.</p>'
          : ""}
      </div>`, nombreArchivo(l, agricultor, facturada));
  }

  // "Recibo de compensación RC-0001 José Pérez 2026-10-20" (o
  // "Liquidación ..." con su número si todavía no está facturada).
  function nombreArchivo(l, a, facturada) {
    return [
      facturada ? "Recibo de compensación" : "Liquidación",
      facturada ? l.num_factura : l.numero,
      a.nombre,
      facturada ? l.fecha_factura : l.fecha,
    ].filter(Boolean).join(" ");
  }

  function configurarEventosFacturas() {
    App.$("btnImprimirFactura").addEventListener("click", imprimirFactura);
  }

  Object.assign(App, {
    abrirModalFactura,
    configurarEventosFacturas,
  });
})(window.App);
