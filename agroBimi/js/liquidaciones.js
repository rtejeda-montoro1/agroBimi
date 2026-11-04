// =====================================================================
//  Liquidaciones
//  ---------------------------------------------------------------------
//  Una liquidación agrupa los registros de UN agricultor dentro de un
//  rango de fechas, les pone precio y calcula el total a pagarle:
//
//      + cajas de bimi entradas        × precio por caja
//      − descuento de cajas            × precio por caja
//      − cajas vacías no devueltas     × precio de caja perdida
//      ± concepto libre
//      = base  →  + IVA / compensación  →  − retención IRPF  →  total
//
//  La retención se aplica sobre base + IVA, igual que en los recibos de
//  compensación en papel del cliente.
//
//  Las líneas se guardan calculadas, así que una liquidación ya cerrada
//  no cambia de importe si después se editan los registros.
//
//  Un registro solo puede entrar en UNA liquidación (columna
//  registros.liquidacion_id): así no se paga dos veces lo mismo.
//  Al facturar, el nº de factura se copia también al campo num_factura
//  de cada registro incluido.
// =====================================================================

(function initLiquidacionesModule(App) {
  const ANCHO_NUMERO = 4;

  const ESTADOS = {
    borrador:  { texto: "Borrador",  clase: "badge" },
    cerrada:   { texto: "Cerrada",   clase: "badge badge-aviso" },
    facturada: { texto: "Facturada", clase: "badge badge-ok" },
  };

  // ------------------------------------------------------------------
  //  Listado
  // ------------------------------------------------------------------
  async function abrirModalLiquidaciones(agricultorId = null) {
    await App.asegurarAgricultoresTodos();
    App.$("filtroAgriLiq").value = agricultorId ? String(agricultorId) : "";
    App.abrirModal(App.dom.modalLiquidaciones);
    await cargarLiquidaciones();
  }

  async function cargarLiquidaciones() {
    const cuerpo = App.$("cuerpoLiquidaciones");
    cuerpo.innerHTML = App.spinnerFila(10, "Cargando liquidaciones...");

    const data = await App.consultar(
      App.traerTodo(() => App.db.from("liquidaciones")
        .select("*, liquidacion_lineas(*)")
        .order("fecha", { ascending: false })
        .order("secuencia", { ascending: false, nullsFirst: false })
        .order("id")),
      "las liquidaciones"
    );

    if (data === null) {
      cuerpo.innerHTML = App.filaMensaje(10, "No se pudieron cargar las liquidaciones.", "error");
      return;
    }

    App.state.liquidacionesActuales = data;
    pintarLiquidaciones();
  }

  function liquidacionesFiltradas() {
    const agri = App.$("filtroAgriLiq").value;
    const campana = App.$("filtroCampanaLiq").value;
    const estado = App.$("filtroEstadoLiq").value;
    const desde = App.$("filtroDesdeLiq").value;
    const hasta = App.$("filtroHastaLiq").value;

    return App.state.liquidacionesActuales.filter((l) => {
      if (agri && String(l.agricultor_id) !== agri) return false;
      if (campana && String(l.campana_id ?? "") !== campana) return false;
      if (estado && l.estado !== estado) return false;
      // El filtro de fechas mira el periodo liquidado: entra cualquier
      // liquidación que se solape con el rango buscado.
      if (desde && l.fecha_hasta < desde) return false;
      if (hasta && l.fecha_desde > hasta) return false;
      return true;
    });
  }

  function cajasDeLiquidacion(l) {
    const linea = (l.liquidacion_lineas || []).find((x) => x.tipo === "bimi");
    return linea ? App.num(linea.cantidad) : 0;
  }

  function pintarLiquidaciones() {
    const filas = liquidacionesFiltradas();
    const cuerpo = App.$("cuerpoLiquidaciones");

    App.$("liqTotalBase").textContent = App.fmtEuro(filas.reduce((s, l) => s + App.num(l.base), 0));
    App.$("liqTotalTotal").textContent = App.fmtEuro(filas.reduce((s, l) => s + App.num(l.total), 0));
    App.$("btnExportLiquidaciones").disabled = filas.length === 0;

    cuerpo.innerHTML = filas.length === 0
      ? App.filaMensaje(10, "No hay liquidaciones con esos filtros.")
      : filas.map((l) => {
          const a = App.agricultorPorId(l.agricultor_id);
          const estado = ESTADOS[l.estado] || ESTADOS.borrador;
          const esBorrador = l.estado === "borrador";
          return `
        <tr>
          <td><b>${App.valor(l.numero)}</b></td>
          <td>${App.formatearFecha(l.fecha)}</td>
          <td>${App.etiquetaAgricultor(a)}</td>
          <td>${App.formatearFecha(l.fecha_desde)} → ${App.formatearFecha(l.fecha_hasta)}</td>
          <td class="col-num">${App.fmtNum(cajasDeLiquidacion(l))}</td>
          <td class="col-num">${App.fmtEuro(l.base)}</td>
          <td class="col-num"><b>${App.fmtEuro(l.total)}</b></td>
          <td><span class="${estado.clase}">${estado.texto}</span></td>
          <td>${App.valor(l.num_factura)}${l.factura_agricultor
            ? ' <span class="badge badge-mini" title="Factura que trajo el agricultor">del agricultor</span>' : ""}</td>
          <td class="col-acciones">
            <button class="btn-ghost btn-sm" data-ver-liq="${l.id}">Ver</button>
            ${esBorrador ? `<button class="btn-edit btn-sm" data-edit-liq="${l.id}">Editar</button>` : ""}
            ${esBorrador ? `<button class="btn-ghost btn-sm" data-cerrar-liq="${l.id}">Cerrar</button>` : ""}
            ${l.estado !== "facturada"
              ? `<button class="btn-fact btn-sm" data-facturar-liq="${l.id}">🧾 Facturar</button>`
              : `<button class="btn-fact btn-sm" data-ver-liq="${l.id}">🧾 Factura</button>`}
            ${tieneReciboPropio(l)
              ? `<button class="btn-del btn-sm" disabled title="Tiene recibo emitido (${App.escapar(l.num_factura || "")}): no se puede eliminar">Eliminar</button>`
              : `<button class="btn-del btn-sm" data-del-liq="${l.id}">Eliminar</button>`}
          </td>
        </tr>`;
        }).join("");

    App.actualizarContador("countLiquidaciones", filas.length, "liquidación", "liquidaciones");
  }

  // ------------------------------------------------------------------
  //  Alta / edición: formulario y cálculo
  // ------------------------------------------------------------------
  async function abrirModalLiquidacion(liquidacion = null, prefijos = {}) {
    await App.asegurarAgricultoresTodos();
    App.dom.formLiquidacion.reset();
    App.state.liquidacionPrevia = null;
    limpiarCalculo();

    if (liquidacion) {
      App.$("modalLiquidacionTitulo").textContent = `Editar liquidación ${liquidacion.numero || ""}`.trim();
      App.$("liqId").value = liquidacion.id;
      App.$("liqAgricultor").value = liquidacion.agricultor_id ?? "";
      App.ponerCampana(App.$("liqCampana"), liquidacion.campana_id);
      App.$("liqDesde").value = liquidacion.fecha_desde ?? "";
      App.$("liqHasta").value = liquidacion.fecha_hasta ?? "";
      App.$("liqPrecioCaja").value = liquidacion.precio_caja ?? "";
      App.$("liqPrecioCajaPerdida").value = liquidacion.precio_caja_perdida ?? "";
      App.$("liqIva").value = liquidacion.iva_porcentaje ?? "";
      App.$("liqRetencion").value = liquidacion.retencion_porcentaje ?? "";
      App.$("liqObservaciones").value = liquidacion.observaciones ?? "";
      // Las cajas vacías se descuentan normalmente a final de campaña: al
      // editar se respeta si esta liquidación ya las llevaba.
      const lineasGuardadas = liquidacion.liquidacion_lineas || [];
      App.$("liqIncluirCajas").checked = lineasGuardadas.some((l) => l.tipo === "cajas_perdidas");
      // Igual con el descuento y la línea libre (anticipos, etc.): si no se
      // recuperan aquí, al recalcular y guardar desaparecerían del borrador.
      App.$("liqIncluirDescuento").checked = lineasGuardadas.some((l) => l.tipo === "descuento");
      const otra = lineasGuardadas.find((l) => l.tipo === "otro");
      if (otra) {
        App.$("liqOtroConcepto").value = otra.concepto ?? "";
        App.$("liqOtraCantidad").value = otra.cantidad ?? "";
        App.$("liqOtroPrecio").value = otra.precio ?? "";
        App.$("liqOtroConcepto").closest("details").open = true;
      }
      // El agricultor no se cambia al editar: los registros ya están
      // vinculados a esta liquidación.
      App.$("liqAgricultor").disabled = true;
    } else {
      App.$("modalLiquidacionTitulo").textContent = "Nueva liquidación";
      App.$("liqId").value = "";
      App.$("liqAgricultor").disabled = false;
      App.$("liqAgricultor").value = prefijos.agricultorId ? String(prefijos.agricultorId) : "";
      App.ponerCampana(App.$("liqCampana"), prefijos.campanaId);
      App.$("liqDesde").value = prefijos.desde || App.primerDiaMes();
      App.$("liqHasta").value = prefijos.hasta || App.hoyISO();
      // Precios e IVA por defecto vienen de Ajustes; se pueden cambiar aquí
      // solo para esta liquidación.
      App.$("liqPrecioCaja").value = App.param("precio_caja");
      App.$("liqPrecioCajaPerdida").value = App.param("precio_caja_perdida");
      App.$("liqIva").value = App.param("iva_porcentaje");
      App.$("liqRetencion").value = App.param("retencion_porcentaje");
      App.$("liqIncluirCajas").checked = false;
      App.$("liqIncluirDescuento").checked = true;
    }

    App.abrirModal(App.dom.modalLiquidacion);
  }

  // Si se cambian los Ajustes con una liquidación NUEVA abierta, sus
  // precios e IVA pasan a los nuevos valores. Solo se tocan los campos que
  // seguían con el valor anterior de Ajustes: lo escrito a mano se respeta.
  function aplicarAjustesALiquidacion(anteriores) {
    if (!App.dom.modalLiquidacion.classList.contains("open") || App.$("liqId").value) return;

    let cambiado = false;
    [["liqPrecioCaja", "precio_caja"],
     ["liqPrecioCajaPerdida", "precio_caja_perdida"],
     ["liqIva", "iva_porcentaje"],
     ["liqRetencion", "retencion_porcentaje"]].forEach(([id, clave]) => {
      const input = App.$(id);
      const previo = anteriores[clave] ?? App.PARAMETROS_DEFECTO[clave] ?? "";
      const nuevo = App.param(clave);
      if (App.num(input.value) === App.num(previo) && App.num(nuevo) !== App.num(previo)) {
        input.value = nuevo;
        cambiado = true;
      }
    });

    if (cambiado) {
      App.state.liquidacionPrevia = null;
      limpiarCalculo();
    }
  }

  function limpiarCalculo() {
    App.$("cuerpoLiqLineas").innerHTML =
      App.filaMensaje(4, "Pulsa «Calcular» para ver las líneas de la liquidación.");
    App.$("liqResumenRegistros").textContent = "—";
    App.$("liqBase").textContent = "—";
    App.$("liqIvaEtiqueta").textContent = "IVA / compensación";
    App.$("liqIvaImporte").textContent = "—";
    App.$("liqRetencionEtiqueta").textContent = "Retención IRPF";
    App.$("liqRetencionImporte").textContent = "—";
    App.$("liqTotal").textContent = "—";
    App.$("btnGuardarLiquidacion").disabled = true;
  }

  function leerFormulario() {
    const agricultorId = App.$("liqAgricultor").value;
    const desde = App.$("liqDesde").value;
    const hasta = App.$("liqHasta").value;

    if (!agricultorId) {
      App.toast("Elige el agricultor que se va a liquidar.");
      return null;
    }
    if (!desde || !hasta) {
      App.toast("Indica el periodo (desde y hasta) que se liquida.");
      return null;
    }
    if (desde > hasta) {
      App.toast("La fecha «desde» no puede ser posterior a la fecha «hasta».");
      return null;
    }

    const campana = App.$("liqCampana").value;
    if (!campana) {
      App.toast("Crea primero una campaña: la liquidación se hace por campaña.");
      return null;
    }

    // Sin texto en «Concepto» la línea libre no se añade: si hay cantidad
    // o precio, se avisa en vez de ignorarlos sin decir nada.
    const otroConcepto = App.$("liqOtroConcepto").value.trim();
    const hayOtraLinea = App.$("liqOtraCantidad").value.trim() !== ""
      || App.$("liqOtroPrecio").value.trim() !== "";
    if (!otroConcepto && hayOtraLinea) {
      App.$("liqOtroConcepto").closest("details").open = true;
      App.$("liqOtroConcepto").focus();
      App.toast("Escribe el concepto de la línea libre, o borra su cantidad y precio.");
      return null;
    }

    return {
      id: App.$("liqId").value || null,
      agricultorId: parseInt(agricultorId, 10),
      campanaId: parseInt(campana, 10),
      desde,
      hasta,
      precioCaja: App.num(App.$("liqPrecioCaja").value),
      precioCajaPerdida: App.num(App.$("liqPrecioCajaPerdida").value),
      iva: App.num(App.$("liqIva").value),
      retencion: App.num(App.$("liqRetencion").value),
      incluirCajas: App.$("liqIncluirCajas").checked,
      incluirDescuento: App.$("liqIncluirDescuento").checked,
      otroConcepto,
      otraCantidad: App.num(App.$("liqOtraCantidad").value),
      otroPrecio: App.num(App.$("liqOtroPrecio").value),
      observaciones: App.$("liqObservaciones").value.trim() || null,
    };
  }

  // Registros del agricultor dentro del periodo que todavía no están
  // liquidados (o que ya pertenecen a ESTA liquidación, al reeditarla).
  async function registrosDelPeriodo(datos) {
    const data = await App.consultar(App.traerTodo(() => {
      const q = App.db.from("registros")
        .select("id,fecha,cajas_entradas,descuento_cajas,liquidacion_id,campana_id")
        .eq("agricultor_id", datos.agricultorId)
        .gte("fecha", datos.desde)
        .lte("fecha", datos.hasta)
        .order("id");
      return datos.campanaId ? q.eq("campana_id", datos.campanaId) : q;
    }), "los registros del periodo");
    if (data === null) return null;

    return data.filter((r) =>
      r.liquidacion_id === null || String(r.liquidacion_id) === String(datos.id));
  }

  async function calcular() {
    const datos = leerFormulario();
    if (!datos) return;

    App.$("cuerpoLiqLineas").innerHTML = App.spinnerFila(4, "Calculando...");

    const registros = await registrosDelPeriodo(datos);
    if (registros === null) {
      limpiarCalculo();
      return;
    }

    // Descuadre de cajas vacías del agricultor (todo el histórico, menos lo
    // que ya se le haya cobrado en otras liquidaciones).
    let saldoCajas = null;
    if (datos.incluirCajas) {
      // Sin filtro de campaña: las cajas son físicas y lo ya cobrado se
      // cuenta de todas las campañas. Si solo se mirasen los movimientos
      // de esta campaña, lo cobrado en campañas anteriores taparía los
      // descuadres nuevos y no se cobrarían.
      saldoCajas = await App.saldoCajasAgricultor(datos.agricultorId, {
        // El precio de esta liquidación manda sobre el de Ajustes.
        precioCaja: datos.precioCajaPerdida,
        // Al reeditar, sus propias cajas ya cobradas no cuentan.
        excluirLiquidacionId: datos.id,
      });
    }

    const cajas = registros.reduce((s, r) => s + App.num(r.cajas_entradas), 0);
    const descuento = registros.reduce((s, r) => s + App.num(r.descuento_cajas), 0);
    const lineas = [];

    lineas.push({
      tipo: "bimi",
      concepto: `Cajas de bimi (${App.formatearFecha(datos.desde)} — ${App.formatearFecha(datos.hasta)})`,
      cantidad: cajas,
      precio: datos.precioCaja,
      importe: App.redondear(cajas * datos.precioCaja),
      orden: 1,
    });

    if (datos.incluirDescuento && descuento > 0) {
      lineas.push({
        tipo: "descuento",
        concepto: "Descuento de cajas",
        cantidad: descuento,
        precio: datos.precioCaja,
        importe: App.redondear(-descuento * datos.precioCaja),
        orden: 2,
      });
    }

    if (saldoCajas && saldoCajas.pendiente > 0) {
      lineas.push({
        tipo: "cajas_perdidas",
        concepto: "Cajas vacías no devueltas (descuadre)",
        cantidad: saldoCajas.pendiente,
        precio: datos.precioCajaPerdida,
        importe: App.redondear(-saldoCajas.pendiente * datos.precioCajaPerdida),
        orden: 3,
      });
    }

    if (datos.otroConcepto) {
      lineas.push({
        tipo: "otro",
        concepto: datos.otroConcepto,
        cantidad: datos.otraCantidad,
        precio: datos.otroPrecio,
        importe: App.redondear(datos.otraCantidad * datos.otroPrecio),
        orden: 4,
      });
    }

    const base = App.redondear(lineas.reduce((s, l) => s + l.importe, 0));
    const ivaImporte = App.redondear(base * datos.iva / 100);
    const retencionImporte = App.redondear((base + ivaImporte) * datos.retencion / 100);
    const total = App.redondear(base + ivaImporte - retencionImporte);

    App.state.liquidacionPrevia = {
      datos,
      lineas,
      registrosIds: registros.map((r) => r.id),
      base,
      ivaImporte,
      retencionImporte,
      total,
      cajas,
    };

    pintarCalculo(registros.length, cajas);
  }

  function pintarCalculo(numRegistros, cajas) {
    const previa = App.state.liquidacionPrevia;

    App.$("cuerpoLiqLineas").innerHTML = previa.lineas.map((l) => `
      <tr>
        <td>${App.escapar(l.concepto)}</td>
        <td class="col-num">${App.fmtCantidad(l.cantidad)}</td>
        <td class="col-num">${App.fmtPrecio(l.precio)}</td>
        <td class="col-num ${l.importe < 0 ? "negativo" : ""}"><b>${App.fmtEuro(l.importe)}</b></td>
      </tr>`).join("");

    App.$("liqResumenRegistros").textContent = numRegistros === 0
      ? "Ningún registro sin liquidar en este periodo"
      : `${numRegistros} registro/s · ${App.fmtNum(cajas)} cajas`;

    App.$("liqBase").textContent = App.fmtEuro(previa.base);
    App.$("liqIvaEtiqueta").textContent =
      `IVA / compensación (${App.fmtNum(previa.datos.iva, 2)} %)`;
    App.$("liqIvaImporte").textContent = App.fmtEuro(previa.ivaImporte);
    App.$("liqRetencionEtiqueta").textContent =
      `Retención IRPF (${App.fmtNum(previa.datos.retencion, 2)} %)`;
    App.$("liqRetencionImporte").textContent = App.fmtEuro(-previa.retencionImporte);
    App.$("liqTotal").textContent = App.fmtEuro(previa.total);
    // Sin registros y sin líneas con importe no hay nada que liquidar.
    App.$("btnGuardarLiquidacion").disabled =
      numRegistros === 0 && previa.lineas.every((l) => l.importe === 0);
  }

  // Evita guardar dos veces a la vez (doble clic, Enter + clic): cada
  // guardado borra e inserta las líneas, y dos en paralelo las duplicarían.
  let guardando = false;

  async function guardarLiquidacion(e) {
    e.preventDefault();
    if (guardando) return;

    const previa = App.state.liquidacionPrevia;
    if (!previa) {
      App.toast("Pulsa «Calcular» antes de guardar.");
      return;
    }

    const boton = App.$("btnGuardarLiquidacion");
    guardando = true;
    boton.disabled = true;
    try {
      await guardarPrevia(previa);
    } finally {
      guardando = false;
      // Si el modal sigue abierto (hubo un error) se puede reintentar.
      if (App.state.liquidacionPrevia) boton.disabled = false;
    }
  }

  async function guardarPrevia(previa) {
    const { datos, lineas } = previa;
    const cabecera = {
      agricultor_id: datos.agricultorId,
      campana_id: datos.campanaId,
      // A propósito también al reeditar un borrador: la fecha de la
      // liquidación es la del último cambio, no la de su creación.
      fecha: App.hoyISO(),
      fecha_desde: datos.desde,
      fecha_hasta: datos.hasta,
      precio_caja: datos.precioCaja,
      precio_caja_perdida: datos.precioCajaPerdida,
      iva_porcentaje: datos.iva,
      base: previa.base,
      iva: previa.ivaImporte,
      retencion_porcentaje: datos.retencion,
      retencion: previa.retencionImporte,
      total: previa.total,
      observaciones: datos.observaciones,
      // No se guarda como columna: liquidacion_guardar lo usa para comprobar
      // que no ha aparecido un descuento nuevo desde el cálculo.
      incluir_descuento: datos.incluirDescuento,
    };

    // Todo en una transacción (liquidacion_guardar, schema.sql sección 18):
    // número, cabecera, líneas y registros, o nada si algo falla.
    const { error } = await App.db.rpc("liquidacion_guardar", {
      p_id: datos.id ? Number(datos.id) : null,
      p_datos: cabecera,
      p_lineas: lineas,
      p_registros: previa.registrosIds,
    });

    if (error) {
      App.toast("No se ha guardado: " + error.message);
      // Si otra persona ha liquidado alguno de los registros, o han cambiado
      // las cajas desde el cálculo (la báscula sigue apuntando), el cálculo
      // ya no vale: hay que volver a calcular antes de guardar.
      if (/otra liquidación|ya no es un borrador|Calcular/.test(error.message)) {
        App.state.liquidacionPrevia = null;
        App.$("btnGuardarLiquidacion").disabled = true;
      }
      return;
    }

    App.state.liquidacionPrevia = null;
    App.cerrarModal(App.dom.modalLiquidacion);
    App.toast(datos.id ? "Liquidación actualizada" : "Liquidación creada");
    await cargarLiquidaciones();
    if (App.state.agricultorAbierto) await App.cargarRegistros();
  }

  // ------------------------------------------------------------------
  //  Cerrar, facturar y eliminar
  // ------------------------------------------------------------------
  async function cerrarLiquidacion(id) {
    if (!confirm("¿Cerrar esta liquidación? Ya no se podrá editar, solo facturarla o eliminarla.")) return;

    const { error } = await App.db.from("liquidaciones").update({ estado: "cerrada" }).eq("id", id);
    if (error) {
      App.toast("Error: " + error.message);
      return;
    }
    App.toast("Liquidación cerrada");
    await cargarLiquidaciones();
  }

  // Facturar abre una ventana con dos opciones: generar nuestro recibo de
  // compensación (nº automático de la serie) o apuntar la factura que trae
  // el agricultor (su nº y su fecha, a mano, sin gastar nº de la serie).
  async function abrirModalFacturar(id) {
    const l = App.state.liquidacionesActuales.find((x) => String(x.id) === String(id));
    if (!l) return;

    let secuencia;
    try {
      secuencia = await App.siguienteSecuencia("liquidaciones", "factura_secuencia");
    } catch (err) {
      App.toast("Error al numerar la factura: " + err.message);
      return;
    }

    const form = App.$("formFacturar");
    form.reset();
    App.$("facturarLiqId").value = l.id;
    App.$("modalFacturarTitulo").textContent = `🧾 Facturar ${l.numero || "liquidación"}`;
    App.$("facturarResumen").textContent =
      `${App.agricultorPorId(l.agricultor_id)?.nombre || ""} · Total: ${App.fmtEuro(l.total)}`;
    App.$("facturarNumPropio").textContent =
      `(${App.fmtDocumento(App.param("serie_factura"), secuencia, ANCHO_NUMERO)})`;
    App.$("facturarFechaAgricultor").value = App.hoyISO();
    mostrarDatosFacturaAgricultor();
    App.abrirModal(App.dom.modalFacturar);
  }

  function tipoFacturaElegido() {
    return App.$("formFacturar").querySelector('input[name="facturarTipo"]:checked')?.value || "propia";
  }

  function mostrarDatosFacturaAgricultor() {
    const deAgricultor = tipoFacturaElegido() === "agricultor";
    App.$("facturarDatosAgricultor").hidden = !deAgricultor;
    App.$("facturarNumAgricultor").required = deAgricultor;
    App.$("facturarFechaAgricultor").required = deAgricultor;
  }

  // Un doble clic no puede pedir dos números de recibo: el segundo
  // sobrescribiría al primero y dejaría un hueco en la serie.
  let facturando = false;

  async function guardarFacturar(e) {
    e.preventDefault();
    if (facturando) return;
    const boton = e.submitter || App.$("formFacturar").querySelector('[type="submit"]');
    facturando = true;
    if (boton) boton.disabled = true;
    try {
      await facturar();
    } finally {
      facturando = false;
      if (boton) boton.disabled = false;
    }
  }

  async function facturar() {
    const l = App.state.liquidacionesActuales.find((x) => String(x.id) === App.$("facturarLiqId").value);
    if (!l) return;

    const deAgricultor = tipoFacturaElegido() === "agricultor";
    let cambios;

    if (deAgricultor) {
      const numFactura = App.$("facturarNumAgricultor").value.trim();
      const fecha = App.$("facturarFechaAgricultor").value;
      if (!numFactura || !fecha) {
        App.toast("Escribe el nº y la fecha de la factura del agricultor.");
        return;
      }
      // El mismo nº ya apuntado a otra liquidación de este agricultor suele
      // ser un error al teclear.
      const repetida = App.state.liquidacionesActuales.find((x) =>
        x.id !== l.id && x.agricultor_id === l.agricultor_id &&
        (x.num_factura || "").trim().toLowerCase() === numFactura.toLowerCase());
      if (repetida &&
          !confirm(`La factura ${numFactura} ya está apuntada en la liquidación ${repetida.numero}. ¿Apuntarla también aquí?`)) {
        return;
      }
      cambios = {
        estado: "facturada",
        factura_agricultor: true,
        factura_secuencia: null,
        num_factura: numFactura,
        fecha_factura: fecha,
      };
    } else {
      // Se vuelve a pedir el nº al guardar: otra persona puede haber
      // facturado mientras la ventana estaba abierta.
      let secuencia;
      try {
        secuencia = await App.siguienteSecuencia("liquidaciones", "factura_secuencia");
      } catch (err) {
        App.toast("Error al numerar la factura: " + err.message);
        return;
      }
      cambios = {
        estado: "facturada",
        factura_agricultor: false,
        factura_secuencia: secuencia,
        num_factura: App.fmtDocumento(App.param("serie_factura"), secuencia, ANCHO_NUMERO),
        fecha_factura: App.hoyISO(),
      };
    }

    const numFactura = cambios.num_factura;
    const { error } = await App.db.from("liquidaciones").update(cambios).eq("id", l.id);

    if (error) {
      App.toast("Error al facturar: " + error.message);
      return;
    }
    App.cerrarModal(App.dom.modalFacturar);

    // El nº de factura también va a los registros: así la tabla del
    // agricultor sigue agrupándolos por factura como hasta ahora.
    const { error: errorRegs } = await App.db.from("registros")
      .update({ num_factura: numFactura })
      .eq("liquidacion_id", l.id);

    if (errorRegs) {
      App.toast("Factura creada, pero no se pudo copiar el nº a los registros: " + errorRegs.message);
    } else {
      App.toast(deAgricultor
        ? `Factura del agricultor ${numFactura} apuntada`
        : `Recibo ${numFactura} generado`);
    }

    await cargarLiquidaciones();
    if (App.state.agricultorAbierto) await App.cargarRegistros();

    // Solo el recibo propio se abre para imprimirlo: la factura del
    // agricultor ya la tiene él en papel.
    const actualizada = App.state.liquidacionesActuales.find((x) => String(x.id) === String(l.id));
    if (actualizada && !deAgricultor) App.abrirModalFactura(actualizada);
  }

  // Recibo de compensación emitido por nosotros (con nº de nuestra serie).
  // La factura que trae el agricultor no gasta número y sí se puede borrar.
  function tieneReciboPropio(l) {
    return l.factura_secuencia !== null && l.factura_secuencia !== undefined;
  }

  async function eliminarLiquidacion(id) {
    const l = App.state.liquidacionesActuales.find((x) => String(x.id) === String(id));
    if (!l) return;

    // Con recibo propio no se borra: su número podría volver a darse a otro
    // recibo. La base de datos también lo impide.
    if (tieneReciboPropio(l)) {
      alert(`La liquidación ${l.numero} no se puede eliminar: ya se emitió el recibo ${l.num_factura}.\n\n` +
        "Los números de recibo son correlativos y no se pueden reutilizar.");
      return;
    }

    const aviso = l.estado === "facturada"
      ? `\n\n⚠ Esta liquidación ya está FACTURADA (${l.num_factura}). Al eliminarla se borra también el nº de factura de sus registros.`
      : "";

    if (!confirm(
      `¿Eliminar la liquidación ${l.numero}?${aviso}\n\n` +
      "Sus registros volverán a quedar pendientes de liquidar. Esta acción no se puede deshacer."
    )) return;

    // Soltar los registros y borrar, todo en una transacción
    // (liquidacion_eliminar, schema.sql sección 19): si algo falla, los
    // registros siguen en su liquidación y no se pueden pagar dos veces.
    const { error } = await App.db.rpc("liquidacion_eliminar", { p_id: l.id });
    if (error) {
      App.toast("Error: " + error.message);
      return;
    }

    App.toast("Liquidación eliminada");
    await cargarLiquidaciones();
    if (App.state.agricultorAbierto) await App.cargarRegistros();
  }

  async function clickLiquidaciones(e) {
    const ver = e.target.closest("[data-ver-liq]");
    const editar = e.target.closest("[data-edit-liq]");
    const cerrar = e.target.closest("[data-cerrar-liq]");
    const facturar = e.target.closest("[data-facturar-liq]");
    const eliminar = e.target.closest("[data-del-liq]");

    if (ver) {
      const l = App.state.liquidacionesActuales.find((x) => String(x.id) === ver.dataset.verLiq);
      if (l) App.abrirModalFactura(l);
      return;
    }
    if (editar) {
      const l = App.state.liquidacionesActuales.find((x) => String(x.id) === editar.dataset.editLiq);
      if (l) await abrirModalLiquidacion(l);
      return;
    }
    if (cerrar) return cerrarLiquidacion(cerrar.dataset.cerrarLiq);
    if (facturar) return abrirModalFacturar(facturar.dataset.facturarLiq);
    if (eliminar) return eliminarLiquidacion(eliminar.dataset.delLiq);
  }

  // ------------------------------------------------------------------
  //  Atajo desde un registro: ver su liquidación o crear una nueva
  // ------------------------------------------------------------------
  // Si el registro ya está liquidado se abre su liquidación; si no, se
  // propone una nueva para ese agricultor y el mes de ese registro.
  async function liquidarRegistro(registro) {
    if (!registro) return;

    if (registro.liquidacion_id) {
      const data = await App.consultar(
        App.db.from("liquidaciones").select("*, liquidacion_lineas(*)").eq("id", registro.liquidacion_id),
        "la liquidación"
      );
      if (data && data.length) {
        App.abrirModalFactura(data[0]);
        return;
      }
    }

    const fecha = registro.fecha || App.hoyISO();
    await abrirModalLiquidacion(null, {
      agricultorId: registro.agricultor_id,
      campanaId: registro.campana_id,
      desde: App.primerDiaMes(fecha),
      hasta: App.ultimoDiaMes(fecha) > App.hoyISO() ? App.hoyISO() : App.ultimoDiaMes(fecha),
    });
  }

  // ------------------------------------------------------------------
  //  Export
  // ------------------------------------------------------------------
  function exportarLiquidaciones() {
    const filas = liquidacionesFiltradas().map((l) => {
      const a = App.agricultorPorId(l.agricultor_id) || {};
      const linea = (tipo) => (l.liquidacion_lineas || []).find((x) => x.tipo === tipo);
      return {
        "Nº Liquidación": l.numero || "",
        "Fecha": l.fecha || "",
        "Código": App.fmtCodigo(a.codigo),
        "Agricultor": a.nombre || "",
        "Campaña": l.campana_id ? App.campanaNombre(l.campana_id) : "",
        "Desde": l.fecha_desde || "",
        "Hasta": l.fecha_hasta || "",
        "Nº Cajas": App.num(linea("bimi")?.cantidad),
        "Precio caja": App.num(l.precio_caja),
        "Cajas perdidas": App.num(linea("cajas_perdidas")?.cantidad),
        "Base": App.num(l.base),
        "IVA %": App.num(l.iva_porcentaje),
        "IVA": App.num(l.iva),
        "Retención %": App.num(l.retencion_porcentaje),
        "Retención": App.num(l.retencion),
        "Total": App.num(l.total),
        "Estado": ESTADOS[l.estado]?.texto || l.estado,
        "Nº Factura": l.num_factura || "",
        "Fecha Factura": l.fecha_factura || "",
        "Factura del agricultor": l.factura_agricultor ? "Sí" : "No",
      };
    });

    if (filas.length === 0) {
      App.toast("No hay liquidaciones que exportar.");
      return;
    }

    App.descargarLibro(filas, "Liquidaciones", "Liquidaciones");
    App.toast("Excel exportado");
  }

  // ------------------------------------------------------------------
  //  Eventos
  // ------------------------------------------------------------------
  function configurarEventosLiquidaciones() {
    App.$("btnLiquidaciones").addEventListener("click", () => abrirModalLiquidaciones());
    App.$("btnLiquidarAgricultor").addEventListener("click", () =>
      abrirModalLiquidaciones(App.state.agricultorAbierto?.id));

    App.$("btnNuevaLiquidacion").addEventListener("click", () =>
      abrirModalLiquidacion(null, { agricultorId: App.$("filtroAgriLiq").value || null }));

    App.$("btnCalcularLiquidacion").addEventListener("click", calcular);
    App.dom.formLiquidacion.addEventListener("submit", guardarLiquidacion);
    App.$("cuerpoLiquidaciones").addEventListener("click", clickLiquidaciones);
    App.$("formFacturar").addEventListener("submit", guardarFacturar);
    App.$("formFacturar").querySelectorAll('input[name="facturarTipo"]').forEach((r) =>
      r.addEventListener("change", mostrarDatosFacturaAgricultor));
    App.$("btnExportLiquidaciones").addEventListener("click", exportarLiquidaciones);

    ["filtroAgriLiq", "filtroCampanaLiq", "filtroEstadoLiq",
     "filtroDesdeLiq", "filtroHastaLiq"].forEach((id) =>
      App.$(id).addEventListener("change", pintarLiquidaciones));

    // Cambiar cualquier dato del cálculo invalida el resultado anterior:
    // hay que volver a pulsar «Calcular».
    ["liqAgricultor", "liqCampana", "liqDesde", "liqHasta", "liqPrecioCaja",
     "liqPrecioCajaPerdida", "liqIva", "liqRetencion", "liqIncluirCajas", "liqIncluirDescuento",
     "liqOtroConcepto", "liqOtraCantidad", "liqOtroPrecio"].forEach((id) =>
      App.$(id).addEventListener("change", () => {
        App.state.liquidacionPrevia = null;
        limpiarCalculo();
      }));
  }

  Object.assign(App, {
    abrirModalLiquidaciones,
    abrirModalLiquidacion,
    aplicarAjustesALiquidacion,
    liquidarRegistro,
    cargarLiquidaciones,
    configurarEventosLiquidaciones,
  });
})(window.App);
