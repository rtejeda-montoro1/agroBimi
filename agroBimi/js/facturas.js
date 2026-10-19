// =====================================================================
//  Liquidación / factura: documento
//  ---------------------------------------------------------------------
//  El mismo modal sirve para las dos cosas: mientras la liquidación no
//  está facturada se ve como "Liquidación", y en cuanto se le asigna un
//  nº de factura pasa a verse como "Factura".
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
    const facturada = liquidacion.estado === "facturada";
    const agricultor = App.agricultorPorId(liquidacion.agricultor_id) || {};
    const emisor = App.datosEmisor();

    App.$("modalFacturaTitulo").textContent = facturada
      ? `🧾 Factura ${liquidacion.num_factura || ""}`.trim()
      : `📄 Liquidación ${liquidacion.numero || ""}`.trim();

    App.$("facturaAviso").hidden = facturada;
    App.$("facturaRegistroId").value = liquidacion.id;

    pintarDatos("facturaEmisor", {
      "Nombre": emisor.nombre,
      "NIF / CIF": emisor.nif,
      "Dirección": direccionCompleta(emisor),
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
      "Nº Factura": liquidacion.num_factura,
      "Fecha Factura": App.formatearFecha(liquidacion.fecha_factura),
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
    App.$("facturaTotal").textContent = App.fmtEuro(liquidacion.total);
    App.$("facturaObservaciones").textContent = liquidacion.observaciones || "";
    App.$("facturaObservacionesBloque").hidden = !liquidacion.observaciones;

    App.$("btnImprimirFactura").textContent = facturada ? "🖨 Imprimir factura" : "🖨 Imprimir liquidación";

    App.dom.modalFactura.classList.add("open");
  }

  // ------------------------------------------------------------------
  //  Documento imprimible
  // ------------------------------------------------------------------
  function bloqueParte(titulo, datos) {
    return `
      <div class="doc-parte">
        <h2>${App.escapar(titulo)}</h2>
        <b>${App.escapar(datos.nombre || "—")}</b>
        ${datos.nif ? `<div>NIF: ${App.escapar(datos.nif)}</div>` : ""}
        ${datos.direccion ? `<div>${App.escapar(datos.direccion)}</div>` : ""}
        <div>${App.escapar([datos.codigo_postal, datos.poblacion, datos.provincia].filter(Boolean).join(" "))}</div>
        ${datos.telefono ? `<div>Tel.: ${App.escapar(datos.telefono)}</div>` : ""}
        ${datos.email ? `<div>${App.escapar(datos.email)}</div>` : ""}
        ${datos.iban ? `<div>IBAN: ${App.escapar(datos.iban)}</div>` : ""}
      </div>`;
  }

  function imprimirFactura() {
    const l = liquidacionVista;
    if (!l) return;

    const facturada = l.estado === "facturada";
    const agricultor = App.agricultorPorId(l.agricultor_id) || {};
    const emisor = App.datosEmisor();

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
            <h1>${facturada ? "Factura" : "Liquidación"}</h1>
            <p class="doc-num">${App.escapar((facturada ? l.num_factura : l.numero) || "")}</p>
          </div>
          <div class="doc-datos-cab">
            <div><span>Fecha</span><b>${App.formatearFecha(facturada ? l.fecha_factura : l.fecha)}</b></div>
            <div><span>Periodo</span><b>${App.formatearFecha(l.fecha_desde)} — ${App.formatearFecha(l.fecha_hasta)}</b></div>
            ${l.campana_id ? `<div><span>Campaña</span><b>${App.escapar(App.campanaNombre(l.campana_id))}</b></div>` : ""}
            ${facturada && l.numero ? `<div><span>Liquidación</span><b>${App.escapar(l.numero)}</b></div>` : ""}
          </div>
        </div>

        <div class="doc-partes">
          ${bloqueParte("Emisor", emisor)}
          ${bloqueParte("Agricultor", {
            nombre: `${App.fmtCodigo(agricultor.codigo)} · ${agricultor.nombre || ""}`,
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
          <div><span>IVA / compensación (${App.fmtNum(l.iva_porcentaje, 2)} %)</span><b>${App.fmtEuro(l.iva)}</b></div>
          <div class="doc-total"><span>Total</span><b>${App.fmtEuro(l.total)}</b></div>
        </div>

        ${l.observaciones
          ? `<div class="doc-obs"><b>Observaciones:</b> ${App.escapar(l.observaciones)}</div>`
          : ""}

        ${!facturada
          ? '<p class="doc-pie">Documento de liquidación: todavía no tiene número de factura.</p>'
          : ""}
      </div>`);
  }

  function configurarEventosFacturas() {
    App.$("btnImprimirFactura").addEventListener("click", imprimirFactura);
  }

  Object.assign(App, {
    abrirModalFactura,
    configurarEventosFacturas,
  });
})(window.App);
