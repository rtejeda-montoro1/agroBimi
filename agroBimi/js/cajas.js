// =====================================================================
//  Control de cajas vacías (descuadres)
//  ---------------------------------------------------------------------
//  El agricultor se lleva cajas vacías y las devuelve llenas de bimi.
//  A veces devuelve alguna vacía sin usar. Lo que no vuelve es un
//  DESCUADRE y tiene que pagarlo, así que se le descuenta en la
//  liquidación:
//
//      descuadre = vacías retiradas − cajas llenas − vacías devueltas
//      pendiente = descuadre − cajas ya cobradas en liquidaciones
//
//  Las cajas son físicas, no de una campaña: el saldo se calcula por
//  agricultor. El filtro de campaña y de fechas solo limita QUÉ
//  movimientos entran en la cuenta.
// =====================================================================

(function initCajasModule(App) {
  // Campos de registro que intervienen en el saldo de cajas.
  const SELECT_MOVIMIENTOS =
    "agricultor_id,campana_id,fecha,cajas_entradas,cajas_vacias_retiradas,cajas_vacias_devueltas";

  // ------------------------------------------------------------------
  //  Cálculo
  // ------------------------------------------------------------------
  function saldoNuevo(agricultorId) {
    return {
      agricultor_id: Number(agricultorId),
      vaciasRetiradas: 0,
      llenasDevueltas: 0,
      vaciasDevueltas: 0,
      cobradas: 0,
      movimientos: 0,
    };
  }

  function completarSaldo(s, precioCaja) {
    s.descuadre = s.vaciasRetiradas - s.llenasDevueltas - s.vaciasDevueltas;
    // Solo se cobra lo que falta. Un descuadre negativo significa que ha
    // devuelto más cajas de las que se llevó (arrastre de otro periodo):
    // no se le cobra nada.
    s.pendiente = Math.max(0, s.descuadre - s.cobradas);
    s.importe = App.redondear(s.pendiente * precioCaja);
    return s;
  }

  // Agrupa los movimientos de cajas por agricultor aplicando los filtros
  // de campaña y de fechas que se le pasen.
  //
  // excluirLiquidacionId: al RECALCULAR una liquidación hay que ignorar sus
  // propias líneas de cajas perdidas. Si no, se verían como "ya cobradas"
  // y el descuadre desaparecería del recálculo.
  function agruparCajas(movimientos, cobros, {
    campanaId, desde, hasta, precioCaja, excluirLiquidacionId = null,
  }) {
    const saldos = new Map();
    const dame = (id) => {
      if (!saldos.has(id)) saldos.set(id, saldoNuevo(id));
      return saldos.get(id);
    };

    (movimientos || []).forEach((r) => {
      if (campanaId && String(r.campana_id ?? "") !== String(campanaId)) return;
      if ((desde || hasta) && !App.fechaEnRango(r.fecha, desde, hasta)) return;

      const s = dame(r.agricultor_id);
      s.vaciasRetiradas += App.num(r.cajas_vacias_retiradas);
      s.llenasDevueltas += App.num(r.cajas_entradas);
      s.vaciasDevueltas += App.num(r.cajas_vacias_devueltas);
      s.movimientos += 1;
    });

    // Las cajas ya cobradas se cuentan siempre completas (no por periodo):
    // si se cobraron en enero, siguen cobradas al mirar febrero.
    (cobros || []).forEach((linea) => {
      const agricultorId = linea.liquidaciones?.agricultor_id;
      if (!agricultorId) return;
      if (excluirLiquidacionId && String(linea.liquidacion_id) === String(excluirLiquidacionId)) return;
      dame(agricultorId).cobradas += App.num(linea.cantidad);
    });

    return Array.from(saldos.values()).map((s) => completarSaldo(s, precioCaja));
  }

  // Consulta los datos necesarios para el cálculo. La usan tanto el
  // informe como el cálculo de una liquidación.
  async function traerDatosCajas() {
    const [movimientos, cobros] = await Promise.all([
      App.consultar(App.db.from("registros").select(SELECT_MOVIMIENTOS), "los movimientos de cajas"),
      App.consultar(
        App.db.from("liquidacion_lineas")
          .select("cantidad,liquidacion_id,liquidaciones(agricultor_id,estado)")
          .eq("tipo", "cajas_perdidas"),
        "las cajas ya cobradas"
      ),
    ]);

    if (movimientos === null || cobros === null) return null;
    return { movimientos, cobros };
  }

  // Saldo de cajas de UN agricultor. La usa la liquidación para saber
  // cuántas cajas hay que cobrarle.
  async function saldoCajasAgricultor(agricultorId, {
    campanaId = "", desde = "", hasta = "", precioCaja = null, excluirLiquidacionId = null,
  } = {}) {
    const datos = await traerDatosCajas();
    if (!datos) return null;

    const precio = precioCaja === null ? App.paramNum("precio_caja_perdida") : App.num(precioCaja);
    const saldos = agruparCajas(
      datos.movimientos.filter((r) => String(r.agricultor_id) === String(agricultorId)),
      datos.cobros.filter((l) => String(l.liquidaciones?.agricultor_id) === String(agricultorId)),
      { campanaId, desde, hasta, precioCaja: precio, excluirLiquidacionId }
    );

    return saldos[0] || completarSaldo(saldoNuevo(agricultorId), precio);
  }

  // ------------------------------------------------------------------
  //  Informe
  // ------------------------------------------------------------------
  async function abrirModalCajas() {
    await App.asegurarAgricultoresTodos();
    App.$("cajasPrecioUnitario").textContent = App.fmtEuro(App.paramNum("precio_caja_perdida"));
    App.abrirModal(App.dom.modalCajas);
    await cargarCajas();
  }

  async function cargarCajas() {
    const cuerpo = App.$("cuerpoCajas");
    cuerpo.innerHTML = App.spinnerFila(8, "Calculando saldos de cajas...");

    const datos = await traerDatosCajas();
    if (!datos) {
      cuerpo.innerHTML = App.filaMensaje(8, "No se pudieron calcular los saldos de cajas.", "error");
      return;
    }

    App.state.cajasActuales = datos;
    pintarCajas();
  }

  function saldosFiltrados() {
    const datos = App.state.cajasActuales;
    if (!datos) return [];

    const saldos = agruparCajas(datos.movimientos, datos.cobros, {
      campanaId: App.$("filtroCampanaCajas").value,
      desde: App.$("filtroDesdeCajas").value,
      hasta: App.$("filtroHastaCajas").value,
      precioCaja: App.paramNum("precio_caja_perdida"),
    });

    const agri = App.$("filtroAgriCajas").value;
    const soloDescuadres = App.$("filtroSoloDescuadres").checked;

    return saldos
      .filter((s) => !agri || String(s.agricultor_id) === agri)
      .filter((s) => !soloDescuadres || s.pendiente > 0)
      .sort((a, b) => {
        // Primero los que más deben: es lo que hay que reclamar.
        if (b.pendiente !== a.pendiente) return b.pendiente - a.pendiente;
        const na = App.agricultorPorId(a.agricultor_id);
        const nb = App.agricultorPorId(b.agricultor_id);
        return (na?.nombre || "").localeCompare(nb?.nombre || "", "es");
      });
  }

  function pintarCajas() {
    const saldos = saldosFiltrados();
    const cuerpo = App.$("cuerpoCajas");

    const pendiente = saldos.reduce((s, x) => s + x.pendiente, 0);
    const importe = saldos.reduce((s, x) => s + x.importe, 0);
    App.$("cajasTotalPendiente").textContent = App.fmtNum(pendiente);
    App.$("cajasTotalImporte").textContent = App.fmtEuro(importe);
    App.$("btnExportCajas").disabled = saldos.length === 0;

    cuerpo.innerHTML = saldos.length === 0
      ? App.filaMensaje(8, "No hay movimientos de cajas con esos filtros.")
      : saldos.map((s) => {
          const a = App.agricultorPorId(s.agricultor_id);
          const clase = s.pendiente > 0 ? "descuadre" : (s.descuadre < 0 ? "descuadre-negativo" : "");
          return `
        <tr class="fila-clic ${clase}" data-agri-id="${s.agricultor_id}" title="Ver registros del agricultor">
          <td>${App.etiquetaAgricultor(a)}</td>
          <td class="col-num">${App.fmtNum(s.vaciasRetiradas)}</td>
          <td class="col-num">${App.fmtNum(s.llenasDevueltas)}</td>
          <td class="col-num">${App.fmtNum(s.vaciasDevueltas)}</td>
          <td class="col-num"><b>${App.fmtNum(s.descuadre)}</b></td>
          <td class="col-num">${App.fmtNum(s.cobradas)}</td>
          <td class="col-num"><b>${App.fmtNum(s.pendiente)}</b></td>
          <td class="col-num">${s.pendiente > 0 ? App.fmtEuro(s.importe) : "—"}</td>
        </tr>`;
        }).join("");

    App.actualizarContador("countCajas", saldos.length, "agricultor", "agricultores");
  }

  function limpiarFiltrosCajas() {
    App.$("filtroAgriCajas").value = "";
    App.$("filtroCampanaCajas").value = "";
    App.$("filtroDesdeCajas").value = "";
    App.$("filtroHastaCajas").value = "";
    App.$("filtroSoloDescuadres").checked = false;
    pintarCajas();
  }

  function exportarCajas() {
    const filas = saldosFiltrados().map((s) => {
      const a = App.agricultorPorId(s.agricultor_id) || {};
      return {
        "Código": App.fmtCodigo(a.codigo),
        "Agricultor": a.nombre || "",
        "Cajas Vacías retiradas": s.vaciasRetiradas,
        "Cajas llenas devueltas": s.llenasDevueltas,
        "Cajas Vacías devueltas": s.vaciasDevueltas,
        "Descuadre": s.descuadre,
        "Ya cobradas": s.cobradas,
        "Pendiente de cobro": s.pendiente,
        "Importe a pagar": s.importe,
      };
    });

    if (filas.length === 0) {
      App.toast("No hay saldos que exportar.");
      return;
    }

    App.descargarLibro(filas, "Cajas", "bimi_control_cajas.xlsx");
    App.toast("Excel exportado");
  }

  function configurarEventosCajas() {
    App.$("btnControlCajas").addEventListener("click", abrirModalCajas);
    App.$("btnLimpiarFiltrosCajas").addEventListener("click", limpiarFiltrosCajas);
    App.$("btnExportCajas").addEventListener("click", exportarCajas);

    ["filtroAgriCajas", "filtroCampanaCajas", "filtroDesdeCajas",
     "filtroHastaCajas", "filtroSoloDescuadres"].forEach((id) =>
      App.$(id).addEventListener("change", pintarCajas));

    App.$("cuerpoCajas").addEventListener("click", (e) => {
      const fila = e.target.closest("[data-agri-id]");
      if (!fila) return;
      const a = App.agricultorPorId(fila.dataset.agriId);
      if (!a) return;
      App.cerrarModal(App.dom.modalCajas);
      App.abrirAgricultor(a);
    });
  }

  Object.assign(App, {
    saldoCajasAgricultor,
    abrirModalCajas,
    configurarEventosCajas,
  });
})(window.App);
