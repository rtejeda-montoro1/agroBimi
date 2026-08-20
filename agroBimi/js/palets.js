// =====================================================================
//  Palets y cartas de porte
//  ---------------------------------------------------------------------
//  Las cajas que traen los agricultores se paletizan en su finca (varios
//  palets por agricultor). Un palet nace PENDIENTE DE CARGA; cuando se
//  carga en el camión se le da salida asignándolo a una CARTA DE PORTE.
//  La carta de porte puede llevar palets de varios agricultores y se
//  imprime como documento de transporte.
// =====================================================================

(function initPaletsModule(App) {
  const ANCHO_CODIGO_PALET = 6;
  const ANCHO_NUMERO_CARTA = 4;

  // ------------------------------------------------------------------
  //  Carga de datos
  // ------------------------------------------------------------------
  async function abrirModalPalets({ agricultorId = null, cartaPorteId = null } = {}) {
    await App.asegurarAgricultoresTodos();
    App.$("filtroAgriPalets").value = agricultorId ? String(agricultorId) : "";
    App.$("filtroCartaPalets").value = cartaPorteId ? String(cartaPorteId) : "";
    App.$("filtroEstadoPalets").value = "";
    App.abrirModal(App.dom.modalPalets);
    await cargarCartasPorte();
    await cargarPalets();
  }

  async function cargarPalets() {
    const cuerpo = App.$("cuerpoPalets");
    cuerpo.innerHTML = App.spinnerFila(9, "Cargando palets...");

    const data = await App.consultar(
      App.db.from("palets")
        .select("*, cartas_porte(numero,fecha)")
        .order("fecha", { ascending: false })
        .order("secuencia", { ascending: false, nullsFirst: false }),
      "los palets"
    );

    if (data === null) {
      cuerpo.innerHTML = App.filaMensaje(9, "No se pudieron cargar los palets.", "error");
      return;
    }

    App.state.paletsActuales = data;
    pintarPalets();
  }

  async function cargarCartasPorte() {
    const data = await App.consultar(
      App.db.from("cartas_porte").select("*").order("fecha", { ascending: false }),
      "las cartas de porte"
    );

    if (data === null) return;

    App.state.cartasPorteActuales = data;
    poblarSelectCartas(App.$("filtroCartaPalets"), "Todas las cartas de porte");
    poblarSelectCartas(App.$("selAsignarCarta"), "— Elige una carta de porte —");
  }

  function poblarSelectCartas(sel, textoVacio) {
    if (!sel) return;
    const anterior = sel.value;
    sel.innerHTML =
      `<option value="">${App.escapar(textoVacio)}</option>` +
      App.state.cartasPorteActuales.map((c) => {
        const extra = [App.formatearFecha(c.fecha), c.destino].filter(Boolean).join(" · ");
        return `<option value="${c.id}">${App.escapar(c.numero || `#${c.id}`)} — ${App.escapar(extra)}</option>`;
      }).join("");
    if (anterior) sel.value = anterior;
  }

  // ------------------------------------------------------------------
  //  Listado de palets
  // ------------------------------------------------------------------
  function paletsFiltrados() {
    const agri = App.$("filtroAgriPalets").value;
    const campana = App.$("filtroCampanaPalets").value;
    const estado = App.$("filtroEstadoPalets").value;
    const carta = App.$("filtroCartaPalets").value;
    const desde = App.$("filtroDesdePalets").value;
    const hasta = App.$("filtroHastaPalets").value;

    return App.state.paletsActuales.filter((p) => {
      if (agri && String(p.agricultor_id) !== agri) return false;
      if (campana && String(p.campana_id ?? "") !== campana) return false;
      if (estado === "pendiente" && p.carta_porte_id) return false;
      if (estado === "cargado" && !p.carta_porte_id) return false;
      if (carta && String(p.carta_porte_id ?? "") !== carta) return false;
      if ((desde || hasta) && !App.fechaEnRango(p.fecha, desde, hasta)) return false;
      return true;
    });
  }

  function pintarPalets() {
    const palets = paletsFiltrados();
    const cuerpo = App.$("cuerpoPalets");

    const cajas = palets.reduce((s, p) => s + App.num(p.num_cajas), 0);
    const pendientes = palets.filter((p) => !p.carta_porte_id);
    App.$("paletsTotalPalets").textContent = App.fmtNum(palets.length);
    App.$("paletsTotalCajas").textContent = App.fmtNum(cajas);
    App.$("paletsPendientes").textContent = App.fmtNum(pendientes.length);
    App.$("btnExportPalets").disabled = palets.length === 0;

    cuerpo.innerHTML = palets.length === 0
      ? App.filaMensaje(9, "No hay palets con esos filtros.")
      : palets.map((p) => {
          const a = App.agricultorPorId(p.agricultor_id);
          const carta = p.cartas_porte;
          const cargado = Boolean(p.carta_porte_id);
          return `
        <tr class="${cargado ? "palet-cargado" : "palet-pendiente"}">
          <td class="col-check">
            <input type="checkbox" class="check-palet" data-palet="${p.id}"
              ${cargado ? "disabled title='Ya tiene salida en una carta de porte'" : ""} />
          </td>
          <td><b>${App.valor(p.codigo)}</b></td>
          <td>${App.formatearFecha(p.fecha)}</td>
          <td>${App.etiquetaAgricultor(a)}</td>
          <td>${App.valor(App.campanaNombre(p.campana_id))}</td>
          <td>${App.valor(App.cicloValido(p.ciclo))}</td>
          <td class="col-num"><b>${App.fmtNum(p.num_cajas)}</b></td>
          <td>${cargado
            ? `<span class="badge badge-ok">${App.escapar(carta?.numero || "Cargado")}</span>`
            : '<span class="badge">Pendiente de carga</span>'}</td>
          <td class="col-acciones">
            <button class="btn-edit btn-sm" data-edit-palet="${p.id}">Editar</button>
            ${cargado
              ? `<button class="btn-ghost btn-sm" data-quitar-palet="${p.id}">Quitar de la carta</button>`
              : ""}
            <button class="btn-del btn-sm" data-del-palet="${p.id}">Eliminar</button>
          </td>
        </tr>`;
        }).join("");

    App.actualizarContador("countPalets", palets.length, "palet", "palets");
    actualizarBotonAsignar();
  }

  function paletsSeleccionados() {
    return Array.from(document.querySelectorAll(".check-palet:checked"))
      .map((c) => c.dataset.palet);
  }

  function actualizarBotonAsignar() {
    const n = paletsSeleccionados().length;
    const btn = App.$("btnAsignarCarta");
    btn.disabled = n === 0;
    btn.textContent = n === 0 ? "🚚 Dar salida" : `🚚 Dar salida (${n})`;
  }

  // ------------------------------------------------------------------
  //  Alta / edición de un palet
  // ------------------------------------------------------------------
  function abrirModalPalet(palet = null) {
    App.dom.formPalet.reset();

    if (palet) {
      App.$("modalPaletTitulo").textContent = `Editar palet ${palet.codigo || ""}`.trim();
      App.$("paletId").value = palet.id;
      App.$("paletAgricultor").value = palet.agricultor_id ?? "";
      App.$("paletCampana").value = palet.campana_id ?? "";
      App.$("paletCiclo").value = App.cicloValido(palet.ciclo);
      App.$("paletFecha").value = palet.fecha ?? "";
      App.$("paletCajas").value = palet.num_cajas ?? "";
      App.$("paletComentarios").value = palet.comentarios ?? "";
      App.$("paletRepetir").value = "1";
      App.$("campoPaletRepetir").hidden = true;
    } else {
      App.$("modalPaletTitulo").textContent = "Nuevo palet";
      App.$("paletId").value = "";
      App.$("paletFecha").value = App.hoyISO();
      App.$("paletAgricultor").value = App.$("filtroAgriPalets").value || "";
      App.$("paletCampana").value = App.$("filtroCampanaPalets").value || "";
      App.$("paletRepetir").value = "1";
      // Al paletizar en la finca salen varios palets iguales de golpe:
      // se pueden crear todos a la vez.
      App.$("campoPaletRepetir").hidden = false;
    }

    App.abrirModal(App.dom.modalPalet);
  }

  async function guardarPalet(e) {
    e.preventDefault();

    const agricultorId = App.$("paletAgricultor").value;
    if (!agricultorId) {
      App.toast("Elige el agricultor del palet.");
      return;
    }

    const fecha = App.$("paletFecha").value;
    if (!fecha) {
      App.toast("La fecha de paletizado es obligatoria.");
      return;
    }
    if (App.esFechaFutura(fecha)) {
      App.toast("La fecha de paletizado no puede ser futura.");
      return;
    }

    const cajas = parseInt(App.$("paletCajas").value, 10);
    if (!Number.isFinite(cajas) || cajas <= 0) {
      App.toast("Indica cuántas cajas lleva el palet.");
      return;
    }

    const campana = App.$("paletCampana").value;
    const base = {
      agricultor_id: parseInt(agricultorId, 10),
      campana_id: campana ? parseInt(campana, 10) : null,
      ciclo: App.$("paletCiclo").value || null,
      fecha,
      num_cajas: cajas,
      comentarios: App.$("paletComentarios").value.trim() || null,
    };

    const id = App.$("paletId").value;

    if (id) {
      const { error } = await App.db.from("palets").update(base).eq("id", id);
      if (error) {
        App.toast("Error: " + error.message);
        return;
      }
      App.cerrarModal(App.dom.modalPalet);
      App.toast("Palet actualizado");
      await cargarPalets();
      return;
    }

    // Alta: uno o varios palets iguales, cada uno con su propio código.
    const repetir = Math.max(1, Math.min(50, parseInt(App.$("paletRepetir").value, 10) || 1));
    const serie = App.param("serie_palet");

    let secuencia;
    try {
      secuencia = await App.siguienteSecuencia("palets");
    } catch (err) {
      App.toast("Error al numerar el palet: " + err.message);
      return;
    }

    const nuevos = Array.from({ length: repetir }, (_, i) => ({
      ...base,
      secuencia: secuencia + i,
      codigo: App.fmtDocumento(serie, secuencia + i, ANCHO_CODIGO_PALET),
    }));

    const { error } = await App.db.from("palets").insert(nuevos);
    if (error) {
      App.toast("Error: " + error.message);
      return;
    }

    App.cerrarModal(App.dom.modalPalet);
    App.toast(repetir === 1 ? "Palet añadido" : `${repetir} palets añadidos`);
    await cargarPalets();
  }

  async function clickPalets(e) {
    if (e.target.classList.contains("check-palet")) {
      actualizarBotonAsignar();
      return;
    }

    const editar = e.target.closest("[data-edit-palet]");
    const eliminar = e.target.closest("[data-del-palet]");
    const quitar = e.target.closest("[data-quitar-palet]");

    if (editar) {
      const p = App.state.paletsActuales.find((x) => String(x.id) === editar.dataset.editPalet);
      if (p) abrirModalPalet(p);
      return;
    }

    if (quitar) {
      if (!confirm("¿Quitar este palet de su carta de porte? Volverá a quedar pendiente de carga.")) return;
      const { error } = await App.db.from("palets")
        .update({ carta_porte_id: null }).eq("id", quitar.dataset.quitarPalet);
      if (error) {
        App.toast("Error: " + error.message);
        return;
      }
      App.toast("Palet devuelto a pendiente de carga");
      await cargarPalets();
      return;
    }

    if (eliminar) {
      if (!confirm("¿Eliminar este palet? Esta acción no se puede deshacer.")) return;
      const { error } = await App.db.from("palets").delete().eq("id", eliminar.dataset.delPalet);
      if (error) {
        App.toast("Error: " + error.message);
        return;
      }
      App.toast("Palet eliminado");
      await cargarPalets();
    }
  }

  // ------------------------------------------------------------------
  //  Dar salida: asignar los palets marcados a una carta de porte
  // ------------------------------------------------------------------
  function abrirAsignarCarta() {
    const ids = paletsSeleccionados();
    if (ids.length === 0) return;

    const cajas = App.state.paletsActuales
      .filter((p) => ids.includes(String(p.id)))
      .reduce((s, p) => s + App.num(p.num_cajas), 0);

    App.$("asignarResumen").textContent =
      `${ids.length} palet/s · ${App.fmtNum(cajas)} cajas`;
    App.$("selAsignarCarta").value = App.$("filtroCartaPalets").value || "";
    App.abrirModal(App.dom.modalAsignarCarta);
  }

  async function confirmarAsignarCarta() {
    const cartaId = App.$("selAsignarCarta").value;
    if (!cartaId) {
      App.toast("Elige la carta de porte en la que salen los palets.");
      return;
    }

    const ids = paletsSeleccionados();
    if (ids.length === 0) {
      App.toast("No hay palets marcados.");
      return;
    }

    const { error } = await App.db.from("palets")
      .update({ carta_porte_id: parseInt(cartaId, 10) })
      .in("id", ids);

    if (error) {
      App.toast("Error: " + error.message);
      return;
    }

    App.cerrarModal(App.dom.modalAsignarCarta);
    App.toast(`${ids.length} palet/s con salida en la carta de porte`);
    await cargarPalets();
  }

  // ------------------------------------------------------------------
  //  Cartas de porte
  // ------------------------------------------------------------------
  async function abrirModalCartasPorte() {
    await App.asegurarAgricultoresTodos();
    App.abrirModal(App.dom.modalCartasPorte);
    await cargarCartasPorte();
    await pintarCartasPorte();
  }

  // Para el listado necesitamos, por cada carta, cuántos palets y cajas
  // lleva. Se trae de una sola consulta y se agrupa en cliente.
  async function pintarCartasPorte() {
    const cuerpo = App.$("cuerpoCartasPorte");
    cuerpo.innerHTML = App.spinnerFila(8, "Cargando cartas de porte...");

    const palets = await App.consultar(
      App.db.from("palets").select("carta_porte_id,num_cajas").not("carta_porte_id", "is", null),
      "los palets"
    );

    if (palets === null) {
      cuerpo.innerHTML = App.filaMensaje(8, "No se pudieron cargar las cartas de porte.", "error");
      return;
    }

    const totales = {};
    palets.forEach((p) => {
      const t = totales[p.carta_porte_id] || (totales[p.carta_porte_id] = { palets: 0, cajas: 0 });
      t.palets += 1;
      t.cajas += App.num(p.num_cajas);
    });

    const cartas = App.state.cartasPorteActuales;
    cuerpo.innerHTML = cartas.length === 0
      ? App.filaMensaje(8, "Todavía no hay cartas de porte.")
      : cartas.map((c) => {
          const t = totales[c.id] || { palets: 0, cajas: 0 };
          return `
        <tr>
          <td><b>${App.valor(c.numero)}</b></td>
          <td>${App.formatearFecha(c.fecha)}</td>
          <td>${App.valor(c.transportista)}</td>
          <td>${App.valor([c.matricula, c.remolque].filter(Boolean).join(" / "))}</td>
          <td>${App.valor(c.destino)}</td>
          <td class="col-num">${App.fmtNum(t.palets)}</td>
          <td class="col-num"><b>${App.fmtNum(t.cajas)}</b></td>
          <td class="col-acciones">
            <button class="btn-ghost btn-sm" data-palets-carta="${c.id}">📦 Palets</button>
            <button class="btn-edit btn-sm" data-edit-carta="${c.id}">Editar</button>
            <button class="btn-fact btn-sm" data-print-carta="${c.id}">🖨 Imprimir</button>
            <button class="btn-del btn-sm" data-del-carta="${c.id}">Eliminar</button>
          </td>
        </tr>`;
        }).join("");

    App.actualizarContador("countCartasPorte", cartas.length, "carta de porte", "cartas de porte");
  }

  function abrirModalCartaPorte(carta = null) {
    App.dom.formCartaPorte.reset();

    if (carta) {
      App.$("modalCartaPorteTitulo").textContent = `Editar carta de porte ${carta.numero || ""}`.trim();
      App.$("cartaId").value = carta.id;
      App.$("cartaFecha").value = carta.fecha ?? "";
      App.$("cartaTransportista").value = carta.transportista ?? "";
      App.$("cartaMatricula").value = carta.matricula ?? "";
      App.$("cartaRemolque").value = carta.remolque ?? "";
      App.$("cartaDestino").value = carta.destino ?? "";
      App.$("cartaObservaciones").value = carta.observaciones ?? "";
    } else {
      App.$("modalCartaPorteTitulo").textContent = "Nueva carta de porte";
      App.$("cartaId").value = "";
      App.$("cartaFecha").value = App.hoyISO();
    }

    App.abrirModal(App.dom.modalCartaPorte);
  }

  async function guardarCartaPorte(e) {
    e.preventDefault();

    const fecha = App.$("cartaFecha").value;
    if (!fecha) {
      App.toast("La fecha de la carta de porte es obligatoria.");
      return;
    }
    if (App.esFechaFutura(fecha)) {
      App.toast("La fecha de la carta de porte no puede ser futura.");
      return;
    }

    const base = {
      fecha,
      transportista: App.$("cartaTransportista").value.trim() || null,
      matricula: App.$("cartaMatricula").value.trim().toUpperCase() || null,
      remolque: App.$("cartaRemolque").value.trim().toUpperCase() || null,
      destino: App.$("cartaDestino").value.trim() || null,
      observaciones: App.$("cartaObservaciones").value.trim() || null,
    };

    const id = App.$("cartaId").value;
    let nuevaId = null;

    if (id) {
      const { error } = await App.db.from("cartas_porte").update(base).eq("id", id);
      if (error) {
        App.toast("Error: " + error.message);
        return;
      }
    } else {
      let secuencia;
      try {
        secuencia = await App.siguienteSecuencia("cartas_porte");
      } catch (err) {
        App.toast("Error al numerar la carta de porte: " + err.message);
        return;
      }

      const { data, error } = await App.db.from("cartas_porte").insert({
        ...base,
        secuencia,
        numero: App.fmtDocumento(App.param("serie_carta_porte"), secuencia, ANCHO_NUMERO_CARTA),
      }).select("id").single();

      if (error) {
        App.toast("Error: " + error.message);
        return;
      }
      nuevaId = data?.id ?? null;
    }

    App.cerrarModal(App.dom.modalCartaPorte);
    App.toast(id ? "Carta de porte actualizada" : "Carta de porte creada");
    await cargarCartasPorte();

    // Si veníamos de dar salida a unos palets, dejamos ya elegida la carta
    // que se acaba de crear.
    if (nuevaId && App.dom.modalAsignarCarta.classList.contains("open")) {
      App.$("selAsignarCarta").value = String(nuevaId);
    }
    if (App.dom.modalCartasPorte.classList.contains("open")) await pintarCartasPorte();
    if (App.dom.modalPalets.classList.contains("open")) pintarPalets();
  }

  async function clickCartasPorte(e) {
    const verPalets = e.target.closest("[data-palets-carta]");
    const editar = e.target.closest("[data-edit-carta]");
    const imprimir = e.target.closest("[data-print-carta]");
    const eliminar = e.target.closest("[data-del-carta]");

    if (verPalets) {
      App.cerrarModal(App.dom.modalCartasPorte);
      await abrirModalPalets({ cartaPorteId: verPalets.dataset.paletsCarta });
      return;
    }

    if (editar) {
      const c = App.state.cartasPorteActuales.find((x) => String(x.id) === editar.dataset.editCarta);
      if (c) abrirModalCartaPorte(c);
      return;
    }

    if (imprimir) {
      await imprimirCartaPorte(imprimir.dataset.printCarta);
      return;
    }

    if (eliminar) {
      if (!confirm(
        "¿Eliminar esta carta de porte?\n\n" +
        "Sus palets volverán a quedar pendientes de carga. Esta acción no se puede deshacer."
      )) return;

      const { error } = await App.db.from("cartas_porte").delete().eq("id", eliminar.dataset.delCarta);
      if (error) {
        App.toast("Error: " + error.message);
        return;
      }
      App.toast("Carta de porte eliminada");
      await cargarCartasPorte();
      await pintarCartasPorte();
    }
  }

  // ------------------------------------------------------------------
  //  Impresión de la carta de porte
  // ------------------------------------------------------------------
  async function imprimirCartaPorte(cartaId) {
    const carta = App.state.cartasPorteActuales.find((c) => String(c.id) === String(cartaId));
    if (!carta) return;

    const palets = await App.consultar(
      App.db.from("palets").select("*").eq("carta_porte_id", carta.id).order("secuencia", { ascending: true }),
      "los palets de la carta de porte"
    );

    if (palets === null) return;
    if (palets.length === 0) {
      App.toast("Esta carta de porte no tiene palets asignados.");
      return;
    }

    // Se agrupa por agricultor: es como se revisa la carga en el muelle.
    const porAgricultor = new Map();
    palets.forEach((p) => {
      if (!porAgricultor.has(p.agricultor_id)) porAgricultor.set(p.agricultor_id, []);
      porAgricultor.get(p.agricultor_id).push(p);
    });

    const emisor = App.datosEmisor();
    const totalCajas = palets.reduce((s, p) => s + App.num(p.num_cajas), 0);

    const filas = Array.from(porAgricultor.entries()).map(([agricultorId, lista]) => {
      const a = App.agricultorPorId(agricultorId) || {};
      const cajas = lista.reduce((s, p) => s + App.num(p.num_cajas), 0);
      return `
        <tr>
          <td>${App.fmtCodigo(a.codigo)}</td>
          <td>${App.escapar(a.nombre || "")}</td>
          <td>${App.escapar(lista.map((p) => p.codigo || `#${p.id}`).join(", "))}</td>
          <td class="der">${App.fmtNum(lista.length)}</td>
          <td class="der">${App.fmtNum(cajas)}</td>
        </tr>`;
    }).join("");

    App.imprimirDocumento(`
      <div class="doc">
        <div class="doc-cab">
          <div>
            <h1>Carta de porte</h1>
            <p class="doc-num">${App.escapar(carta.numero || "")}</p>
          </div>
          <div class="doc-emisor">
            <b>${App.escapar(emisor.nombre || "—")}</b>
            ${emisor.nif ? `<div>NIF: ${App.escapar(emisor.nif)}</div>` : ""}
            ${emisor.direccion ? `<div>${App.escapar(emisor.direccion)}</div>` : ""}
            <div>${App.escapar([emisor.codigo_postal, emisor.poblacion, emisor.provincia].filter(Boolean).join(" "))}</div>
            ${emisor.telefono ? `<div>Tel.: ${App.escapar(emisor.telefono)}</div>` : ""}
          </div>
        </div>

        <div class="doc-datos">
          <div><span>Fecha</span><b>${App.formatearFecha(carta.fecha)}</b></div>
          <div><span>Transportista</span><b>${App.escapar(carta.transportista || "—")}</b></div>
          <div><span>Matrícula</span><b>${App.escapar(carta.matricula || "—")}</b></div>
          <div><span>Remolque</span><b>${App.escapar(carta.remolque || "—")}</b></div>
          <div><span>Destino</span><b>${App.escapar(carta.destino || "—")}</b></div>
          <div><span>Mercancía</span><b>Bimi</b></div>
        </div>

        <table class="doc-tabla">
          <thead>
            <tr>
              <th>Código</th><th>Agricultor</th><th>Palets</th>
              <th class="der">Nº palets</th><th class="der">Nº cajas</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
          <tfoot>
            <tr>
              <th colspan="3">Total</th>
              <th class="der">${App.fmtNum(palets.length)}</th>
              <th class="der">${App.fmtNum(totalCajas)}</th>
            </tr>
          </tfoot>
        </table>

        ${carta.observaciones
          ? `<div class="doc-obs"><b>Observaciones:</b> ${App.escapar(carta.observaciones)}</div>`
          : ""}

        <div class="doc-firmas">
          <div>Firma del cargador</div>
          <div>Firma del transportista</div>
          <div>Firma del destinatario</div>
        </div>
      </div>`);
  }

  // ------------------------------------------------------------------
  //  Export
  // ------------------------------------------------------------------
  function exportarPalets() {
    const filas = paletsFiltrados().map((p) => {
      const a = App.agricultorPorId(p.agricultor_id) || {};
      return {
        "Palet": p.codigo || "",
        "Fecha": p.fecha || "",
        "Código": App.fmtCodigo(a.codigo),
        "Agricultor": a.nombre || "",
        "Campaña": App.campanaNombre(p.campana_id) === "—" ? "" : App.campanaNombre(p.campana_id),
        "Ciclo": App.cicloValido(p.ciclo),
        "Nº Cajas": App.num(p.num_cajas),
        "Carta de porte": p.cartas_porte?.numero || "",
        "Estado": p.carta_porte_id ? "Cargado" : "Pendiente de carga",
        "Comentarios": p.comentarios || "",
      };
    });

    if (filas.length === 0) {
      App.toast("No hay palets que exportar.");
      return;
    }

    App.descargarLibro(filas, "Palets", "bimi_palets.xlsx");
    App.toast("Excel exportado");
  }

  // ------------------------------------------------------------------
  //  Eventos
  // ------------------------------------------------------------------
  function configurarEventosPalets() {
    App.$("btnPalets").addEventListener("click", () => abrirModalPalets());
    App.$("btnPaletsAgricultor").addEventListener("click", () =>
      abrirModalPalets({ agricultorId: App.state.agricultorAbierto?.id }));
    App.$("btnCartasPorte").addEventListener("click", abrirModalCartasPorte);
    App.$("btnCartasPorteDesdePalets").addEventListener("click", abrirModalCartasPorte);

    App.$("btnNuevoPalet").addEventListener("click", () => abrirModalPalet());
    App.dom.formPalet.addEventListener("submit", guardarPalet);
    App.$("cuerpoPalets").addEventListener("click", clickPalets);
    App.$("btnExportPalets").addEventListener("click", exportarPalets);

    ["filtroAgriPalets", "filtroCampanaPalets", "filtroEstadoPalets",
     "filtroCartaPalets", "filtroDesdePalets", "filtroHastaPalets"].forEach((id) =>
      App.$(id).addEventListener("change", pintarPalets));

    App.$("btnMarcarTodosPalets").addEventListener("click", () => {
      const checks = Array.from(document.querySelectorAll(".check-palet:not(:disabled)"));
      const marcarTodos = checks.some((c) => !c.checked);
      checks.forEach((c) => { c.checked = marcarTodos; });
      actualizarBotonAsignar();
    });

    App.$("btnAsignarCarta").addEventListener("click", abrirAsignarCarta);
    App.$("btnConfirmarAsignar").addEventListener("click", confirmarAsignarCarta);
    App.$("btnNuevaCartaDesdeAsignar").addEventListener("click", () => abrirModalCartaPorte());

    App.$("btnNuevaCartaPorte").addEventListener("click", () => abrirModalCartaPorte());
    App.dom.formCartaPorte.addEventListener("submit", guardarCartaPorte);
    App.$("cuerpoCartasPorte").addEventListener("click", clickCartasPorte);
  }

  Object.assign(App, {
    abrirModalPalets,
    abrirModalCartasPorte,
    configurarEventosPalets,
  });
})(window.App);
