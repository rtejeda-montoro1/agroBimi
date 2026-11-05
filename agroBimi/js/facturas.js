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

  // Lo que se ve en la vista previa y lo que se imprime sale de aquí: el
  // cliente quiere el papel igual que la pantalla.
  function documento(liquidacion) {
    // Con factura del agricultor no hay recibo propio: se ve como
    // liquidación, con el nº de su factura en los datos del documento.
    const deAgricultor = liquidacion.estado === "facturada" && liquidacion.factura_agricultor;
    const facturada = liquidacion.estado === "facturada" && !deAgricultor;
    const agricultor = App.agricultorPorId(liquidacion.agricultor_id) || {};
    const emisor = App.datosEmisor();
    return {
      deAgricultor,
      facturada,
      agricultor,
      titulo: facturada
        ? "RECIBO DE COMPENSACIÓN - FACTURA"
        : `Liquidación ${liquidacion.numero || ""}`.trim(),
      // El nº del recibo va debajo del título, en letra más pequeña.
      numeroTitulo: facturada ? (liquidacion.num_factura || "") : "",
      emisor: {
        "Nombre": emisor.nombre,
        "NIF / CIF": emisor.nif,
        "Dirección": direccionCompleta(emisor),
        "Registro de establecimiento": emisor.registro,
        "Teléfono": emisor.telefono,
        "Email": emisor.email,
      },
      // En dos columnas: Nombre, Dirección y Teléfono a la izquierda, como
      // en el emisor; Código, NIF e IBAN a la derecha.
      proveedor: {
        "Nombre": agricultor.nombre,
        "Código": App.fmtCodigo(agricultor.codigo),
        "Dirección": direccionCompleta(agricultor),
        "NIF": agricultor.nif,
        "Teléfono": agricultor.telefono,
        "IBAN": agricultor.iban,
      },
      registro: {
        "Nº Liquidación": liquidacion.numero,
        "Fecha": App.formatearFecha(liquidacion.fecha),
        "Periodo": `${App.formatearFecha(liquidacion.fecha_desde)} — ${App.formatearFecha(liquidacion.fecha_hasta)}`,
        "Campaña": liquidacion.campana_id ? App.campanaNombre(liquidacion.campana_id) : "—",
        [deAgricultor ? "Nº Factura del proveedor" : "Nº Recibo"]: liquidacion.num_factura,
        [deAgricultor ? "Fecha de su factura" : "Fecha Recibo"]: App.formatearFecha(liquidacion.fecha_factura),
      },
      filasLineas: lineasOrdenadas(liquidacion).map((l) => `
        <tr>
          <td>${App.escapar(l.concepto)}</td>
          <td class="col-num">${App.fmtCantidad(l.cantidad)}</td>
          <td class="col-num">${App.fmtPrecio(l.precio)}</td>
          <td class="col-num ${App.num(l.importe) < 0 ? "negativo" : ""}"><b>${App.fmtEuro(l.importe)}</b></td>
        </tr>`).join(""),
      ivaEtiqueta: `IVA / compensación (${App.fmtNum(liquidacion.iva_porcentaje, 2)} %)`,
      retencionEtiqueta: `Retención IRPF (${App.fmtNum(App.num(liquidacion.retencion_porcentaje), 2)} %)`,
      retencion: -App.num(liquidacion.retencion),
    };
  }

  function filasDatos(datos) {
    return Object.entries(datos).map(([etiqueta, valor]) => `
      <div class="factura-fila">
        <span>${App.escapar(etiqueta)}</span>
        <b>${App.valor(valor)}</b>
      </div>`).join("");
  }

  function abrirModalFactura(liquidacion) {
    if (!liquidacion) return;

    liquidacionVista = liquidacion;
    const d = documento(liquidacion);

    App.$("modalFacturaTitulo").innerHTML = `${d.facturada ? "🧾" : "📄"} ${App.escapar(d.titulo)}` +
      (d.numeroTitulo ? `<span class="titulo-numero">${App.escapar(d.numeroTitulo)}</span>` : "");
    App.$("facturaAviso").hidden = d.facturada || d.deAgricultor;
    App.$("facturaRegistroId").value = liquidacion.id;

    App.$("facturaEmisor").innerHTML = filasDatos(d.emisor);
    App.$("facturaCliente").innerHTML = filasDatos(d.proveedor);
    App.$("facturaRegistro").innerHTML = filasDatos(d.registro);
    App.$("cuerpoFacturaLineas").innerHTML = d.filasLineas;

    App.$("facturaBase").textContent = App.fmtEuro(liquidacion.base);
    App.$("facturaIvaEtiqueta").textContent = d.ivaEtiqueta;
    App.$("facturaIva").textContent = App.fmtEuro(liquidacion.iva);
    App.$("facturaRetencionEtiqueta").textContent = d.retencionEtiqueta;
    App.$("facturaRetencion").textContent = App.fmtEuro(d.retencion);
    App.$("facturaTotal").textContent = App.fmtEuro(liquidacion.total);
    App.$("facturaObservaciones").textContent = liquidacion.observaciones || "";
    App.$("facturaObservacionesBloque").hidden = !liquidacion.observaciones;

    App.$("btnImprimirFactura").textContent = d.facturada ? "🖨 Imprimir recibo" : "🖨 Imprimir liquidación";

    App.dom.modalFactura.classList.add("open");
  }

  // ------------------------------------------------------------------
  //  Documento imprimible
  // ------------------------------------------------------------------
  //  Igual que la vista previa del modal: mismos bloques (Emisor/Cliente,
  //  Agricultor/Proveedor, Datos del documento, Conceptos con los totales
  //  y Observaciones), en el mismo orden y con los mismos textos. Antes se
  //  imprimía con otro formato, tipo factura. Los estilos de papel están
  //  en styles.css (.recibo-vista, dentro de @media print).
  //  Salen dos copias, cada una en su página: «Copia para el proveedor» y
  //  «Copia para el almacén». La del proveedor lleva, en el hueco libre a
  //  la izquierda de los totales, el recuadro «Firma del proveedor».
  function imprimirFactura() {
    const l = liquidacionVista;
    if (!l) return;
    const d = documento(l);
    App.imprimirDocumento(
      copiaRecibo(l, d, "Copia para el proveedor", true) +
      copiaRecibo(l, d, "Copia para el almacén", false),
      nombreArchivo(l, d.agricultor, d.facturada));
  }

  function copiaRecibo(l, d, copia, conFirma) {
    const bloque = (titulo, contenido) => `
      <div class="factura-bloque">
        <h3 class="factura-titulo">${titulo}</h3>
        ${contenido}
      </div>`;
    return `
      <div class="recibo-vista">
        <div class="recibo-cab">
          <h1>${App.escapar(d.titulo)}${d.numeroTitulo
            ? `<span class="titulo-numero">${App.escapar(d.numeroTitulo)}</span>` : ""}</h1>
          <span class="recibo-copia">${App.escapar(copia)}</span>
        </div>
        ${bloque("Emisor / Cliente", `<div class="factura-datos">${filasDatos(d.emisor)}</div>`)}
        ${bloque("Agricultor / Proveedor", `<div class="factura-datos">${filasDatos(d.proveedor)}</div>`)}
        ${bloque("Datos del documento", `<div class="factura-datos">${filasDatos(d.registro)}</div>`)}
        ${bloque("Conceptos", `
          <table class="recibo-tabla">
            <thead>
              <tr>
                <th>Concepto</th>
                <th class="col-num">Cantidad</th>
                <th class="col-num">Precio</th>
                <th class="col-num">Importe</th>
              </tr>
            </thead>
            <tbody>${d.filasLineas}</tbody>
          </table>
          <div class="recibo-pie-conceptos">
            ${conFirma
              ? '<div class="recibo-firma"><div class="recibo-firma-hueco"></div><div>Firma del proveedor</div></div>'
              : "<div></div>"}
            <div class="totales-doc">
              <div><span>Base</span><b>${App.fmtEuro(l.base)}</b></div>
              <div><span>${App.escapar(d.ivaEtiqueta)}</span><b>${App.fmtEuro(l.iva)}</b></div>
              <div><span>${App.escapar(d.retencionEtiqueta)}</span><b>${App.fmtEuro(d.retencion)}</b></div>
              <div class="total-final"><span>Total</span><b>${App.fmtEuro(l.total)}</b></div>
            </div>
          </div>`)}
        ${l.observaciones ? bloque("Observaciones", `<p>${App.escapar(l.observaciones)}</p>`) : ""}
        ${!d.facturada && !d.deAgricultor
          ? '<p class="recibo-pie">Documento de liquidación: todavía no tiene número de recibo.</p>'
          : ""}
      </div>`;
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
