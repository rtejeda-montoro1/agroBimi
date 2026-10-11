// =====================================================================
//  Palets
//  ---------------------------------------------------------------------
//  Un palet agrupa cajas sueltas de la cámara (js/camara.js), de uno o
//  varios agricultores: cuántas de cada uno va en palet_lineas. Al crearlo
//  recibe su número (serie de Ajustes + contador). Sigue ocupando sitio
//  en la cámara hasta que se marca y se le da salida (fecha_salida).
// =====================================================================

(function initPaletsModule(App) {
  const ANCHO_CODIGO_PALET = 6;

  // ------------------------------------------------------------------
  //  Carga de datos
  // ------------------------------------------------------------------
  async function abrirModalPalets({ agricultorId = null, estado = "" } = {}) {
    await App.asegurarAgricultoresTodos();
    App.$("filtroAgriPalets").value = agricultorId ? String(agricultorId) : "";
    App.$("filtroEstadoPalets").value = estado;
    App.abrirModal(App.dom.modalPalets);
    await cargarPalets();
  }

  function paletsAbierto() {
    return App.dom.modalPalets.classList.contains("open");
  }

  async function cargarPalets() {
    const cuerpo = App.$("cuerpoPalets");
    cuerpo.innerHTML = App.spinnerFila(8, "Cargando palets...");

    const data = await App.consultar(
      App.db.from("palets")
        .select("*, palet_lineas(id,agricultor_id,num_cajas)")
        .order("fecha", { ascending: false })
        .order("secuencia", { ascending: false, nullsFirst: false }),
      "los palets"
    );

    if (data === null) {
      cuerpo.innerHTML = App.filaMensaje(8, "No se pudieron cargar los palets.", "error");
      return;
    }

    App.state.paletsActuales = data;
    pintarPalets();
  }

  // ------------------------------------------------------------------
  //  Listado de palets
  // ------------------------------------------------------------------
  function lineas(p) {
    return p.palet_lineas || [];
  }

  function paletsFiltrados() {
    const agri = App.$("filtroAgriPalets").value;
    const campana = App.$("filtroCampanaPalets").value;
    const estado = App.$("filtroEstadoPalets").value;
    const desde = App.$("filtroDesdePalets").value;
    const hasta = App.$("filtroHastaPalets").value;

    return App.state.paletsActuales.filter((p) => {
      if (agri && !lineas(p).some((l) => String(l.agricultor_id) === agri)) return false;
      if (campana && String(p.campana_id ?? "") !== campana) return false;
      if (estado === "camara" && p.fecha_salida) return false;
      if (estado === "salido" && !p.fecha_salida) return false;
      if ((desde || hasta) && !App.fechaEnRango(p.fecha, desde, hasta)) return false;
      return true;
    });
  }

  function textoLineas(p) {
    const ls = lineas(p);
    if (ls.length === 0) return "—";
    return ls.map((l) =>
      `<div>${App.etiquetaAgricultor(App.agricultorPorId(l.agricultor_id))} · <b>${App.fmtNum(l.num_cajas)}</b></div>`
    ).join("");
  }

  function pintarPalets() {
    const palets = paletsFiltrados();
    const cuerpo = App.$("cuerpoPalets");

    const cajas = palets.reduce((s, p) => s + App.num(p.num_cajas), 0);
    App.$("paletsTotalPalets").textContent = App.fmtNum(palets.length);
    App.$("paletsTotalCajas").textContent = App.fmtNum(cajas);
    App.$("paletsEnCamara").textContent = App.fmtNum(palets.filter((p) => !p.fecha_salida).length);
    App.$("btnExportPalets").disabled = palets.length === 0;

    cuerpo.innerHTML = palets.length === 0
      ? App.filaMensaje(8, "No hay palets con esos filtros.")
      : palets.map((p) => {
          const salido = Boolean(p.fecha_salida);
          return `
        <tr class="${salido ? "palet-salido" : "palet-pendiente"}">
          <td class="col-check">
            <input type="checkbox" class="check-palet" data-palet="${p.id}"
              ${salido ? "disabled title='Ya tiene salida'" : ""} />
          </td>
          <td><b>${App.valor(p.codigo)}</b></td>
          <td>${App.formatearFecha(p.fecha)}</td>
          <td class="col-lineas">${textoLineas(p)}</td>
          <td>${App.valor(App.campanaNombre(p.campana_id))}</td>
          <td class="col-num"><b>${App.fmtNum(p.num_cajas)}</b></td>
          <td>${salido
            ? `<span class="badge badge-ok">Salida ${App.formatearFecha(p.fecha_salida)}</span>`
            : '<span class="badge">En cámara</span>'}</td>
          <td class="col-acciones">
            ${salido
              ? `<button class="btn-ghost btn-sm" data-devolver-palet="${p.id}">Devolver a cámara</button>`
              : `<button class="btn-edit btn-sm" data-edit-palet="${p.id}">Editar</button>`}
            <button class="btn-del btn-sm" data-del-palet="${p.id}">Eliminar</button>
          </td>
        </tr>`;
        }).join("");

    App.actualizarContador("countPalets", palets.length, "palet", "palets");
    actualizarBotonSalida();
  }

  function paletsSeleccionados() {
    return Array.from(document.querySelectorAll(".check-palet:checked"))
      .map((c) => c.dataset.palet);
  }

  function actualizarBotonSalida() {
    const n = paletsSeleccionados().length;
    const btn = App.$("btnDarSalida");
    btn.disabled = n === 0;
    btn.textContent = n === 0 ? "🚚 Dar salida" : `🚚 Dar salida (${n})`;
  }

  // Tras cualquier cambio en palets: refrescar lo que esté abierto.
  async function refrescar() {
    if (paletsAbierto()) await cargarPalets();
    if (App.camaraAbierta()) await App.recargarCamara();
  }

  // ------------------------------------------------------------------
  //  Paletizar / editar un palet
  // ------------------------------------------------------------------
  // Filas del formulario: los agricultores con cajas sueltas en la cámara
  // y, al editar, también los que ya van en el palet. Lo disponible de
  // cada uno es lo suelto más lo que ya lleva este palet.
  function filasFormulario(palet) {
    const propias = {};
    (palet ? lineas(palet) : []).forEach((l) => {
      propias[l.agricultor_id] = (propias[l.agricultor_id] || 0) + App.num(l.num_cajas);
    });

    const ids = new Set([
      ...App.state.camaraSaldos.filter((s) => App.num(s.sueltas) > 0).map((s) => String(s.agricultor_id)),
      ...Object.keys(propias),
    ]);

    return [...ids]
      .map((id) => {
        const a = App.agricultorPorId(id);
        const enPalet = propias[id] || 0;
        return {
          id,
          agricultor: a,
          disponible: App.num(App.saldoCamara(id).sueltas) + enPalet,
          enPalet,
        };
      })
      .sort((x, y) => String(x.agricultor?.nombre || "").localeCompare(String(y.agricultor?.nombre || ""), "es"));
  }

  async function abrirModalPalet(palet = null) {
    await App.asegurarAgricultoresTodos();
    if (!(await App.cargarSaldosCamara())) return;

    App.dom.formPalet.reset();
    App.$("paletId").value = palet?.id ?? "";
    App.$("modalPaletTitulo").textContent = palet ? `Editar palet ${palet.codigo || ""}`.trim() : "Paletizar";
    App.$("paletFecha").value = palet?.fecha ?? App.hoyISO();
    App.$("paletCampana").value = palet ? (palet.campana_id ?? "") : App.campanaMasReciente();
    App.$("paletComentarios").value = palet?.comentarios ?? "";

    const filas = filasFormulario(palet);
    App.$("paletLineas").innerHTML = filas.length === 0
      ? App.filaMensaje(3, "No hay cajas sueltas en la cámara. Guarda primero las cajas en la cámara.")
      : filas.map((f) => `
        <tr>
          <td>${App.etiquetaAgricultor(f.agricultor)}</td>
          <td class="col-num">${App.fmtNum(f.disponible)}</td>
          <td class="col-num col-linea-palet">
            <input type="number" class="input-linea-palet" data-linea-agri="${f.id}"
              min="0" max="${f.disponible}" step="1" value="${f.enPalet || ""}" placeholder="0" />
            <button type="button" class="btn-ghost btn-sm" data-todas="${f.id}" data-max="${f.disponible}">Todas</button>
          </td>
        </tr>`).join("");

    actualizarTotalPalet();
    App.abrirModal(App.dom.modalPalet);
  }

  function lineasDelFormulario() {
    return Array.from(document.querySelectorAll(".input-linea-palet"))
      .map((input) => ({
        agricultor_id: parseInt(input.dataset.lineaAgri, 10),
        num_cajas: parseInt(input.value, 10) || 0,
        max: parseInt(input.max, 10) || 0,
      }))
      .filter((l) => l.num_cajas !== 0);
  }

  function actualizarTotalPalet() {
    const total = lineasDelFormulario().reduce((s, l) => s + l.num_cajas, 0);
    App.$("paletTotal").textContent = App.fmtNum(total);
  }

  async function guardarPalet(e) {
    e.preventDefault();

    const fecha = App.$("paletFecha").value;
    if (!fecha) {
      App.toast("La fecha de paletizado es obligatoria.");
      return;
    }
    if (App.esFechaFutura(fecha)) {
      App.toast("La fecha de paletizado no puede ser futura.");
      return;
    }

    const ls = lineasDelFormulario();
    const mal = ls.find((l) => l.num_cajas < 0 || l.num_cajas > l.max);
    if (mal) {
      const a = App.agricultorPorId(mal.agricultor_id);
      App.toast(`${a?.nombre || "Un agricultor"}: puedes poner entre 0 y ${App.fmtNum(mal.max)} cajas.`);
      return;
    }
    const total = ls.reduce((s, l) => s + l.num_cajas, 0);
    if (total <= 0) {
      App.toast("Indica cuántas cajas de cada agricultor van en el palet.");
      return;
    }

    const campana = App.$("paletCampana").value;
    const datos = {
      campana_id: campana ? parseInt(campana, 10) : null,
      fecha,
      comentarios: App.$("paletComentarios").value.trim() || null,
    };
    const nuevasLineas = (paletId) => ls.map((l) => ({
      palet_id: paletId, agricultor_id: l.agricultor_id, num_cajas: l.num_cajas,
    }));

    const id = App.$("paletId").value;

    if (id) {
      const palet = App.state.paletsActuales.find((p) => String(p.id) === id);
      const viejas = lineas(palet || {}).map((l) => l.id);

      const { error } = await App.db.from("palets").update(datos).eq("id", id);
      if (error) {
        App.toast("Error: " + error.message);
        return;
      }
      // Primero las líneas nuevas y después se borran las viejas: si algo
      // falla a medias, el palet no se queda vacío.
      const ins = await App.db.from("palet_lineas").insert(nuevasLineas(parseInt(id, 10)));
      if (ins.error) {
        App.toast("Error al guardar las cajas del palet: " + ins.error.message);
        return;
      }
      if (viejas.length) {
        const del = await App.db.from("palet_lineas").delete().in("id", viejas);
        if (del.error) App.toast("Aviso: revisa el palet, no se pudieron quitar las líneas anteriores.");
      }
      App.cerrarModal(App.dom.modalPalet);
      App.toast("Palet actualizado");
      await refrescar();
      return;
    }

    let secuencia;
    try {
      secuencia = await App.siguienteSecuencia("palets");
    } catch (err) {
      App.toast("Error al numerar el palet: " + err.message);
      return;
    }
    const codigo = App.fmtDocumento(App.param("serie_palet"), secuencia, ANCHO_CODIGO_PALET);

    const { data: creado, error } = await App.db.from("palets")
      .insert({ ...datos, secuencia, codigo, num_cajas: total })
      .select("id")
      .single();
    if (error) {
      App.toast("Error: " + error.message);
      return;
    }

    const ins = await App.db.from("palet_lineas").insert(nuevasLineas(creado.id));
    if (ins.error) {
      // Sin líneas el palet no vale: lo quitamos para no dejar uno vacío.
      await App.db.from("palets").delete().eq("id", creado.id);
      App.toast("Error al guardar las cajas del palet: " + ins.error.message);
      return;
    }

    App.cerrarModal(App.dom.modalPalet);
    App.toast(`Palet ${codigo} creado · ${App.fmtNum(total)} cajas`);
    await refrescar();
  }

  // ------------------------------------------------------------------
  //  Acciones del listado
  // ------------------------------------------------------------------
  async function clickPalets(e) {
    if (e.target.classList.contains("check-palet")) {
      actualizarBotonSalida();
      return;
    }

    const editar = e.target.closest("[data-edit-palet]");
    const eliminar = e.target.closest("[data-del-palet]");
    const devolver = e.target.closest("[data-devolver-palet]");
    const buscar = (btn, campo) =>
      App.state.paletsActuales.find((x) => String(x.id) === btn.dataset[campo]);

    if (editar) {
      const p = buscar(editar, "editPalet");
      if (p) abrirModalPalet(p);
      return;
    }

    if (devolver) {
      const p = buscar(devolver, "devolverPalet");
      if (!p) return;
      if (!confirm(`¿Devolver el palet ${p.codigo || ""} a la cámara? Se le quita la fecha de salida.`)) return;
      const { error } = await App.db.from("palets").update({ fecha_salida: null }).eq("id", p.id);
      if (error) {
        App.toast("Error: " + error.message);
        return;
      }
      App.toast("Palet devuelto a la cámara");
      await refrescar();
      return;
    }

    if (eliminar) {
      const p = buscar(eliminar, "delPalet");
      if (!p) return;
      const aviso = p.fecha_salida
        ? "Ya tenía salida: se borra también del histórico."
        : "Sus cajas vuelven a quedar sueltas en la cámara.";
      if (!confirm(`¿Eliminar el palet ${p.codigo || ""}? ${aviso}\nEsta acción no se puede deshacer.`)) return;
      const { error } = await App.db.from("palets").delete().eq("id", p.id);
      if (error) {
        App.toast("Error: " + error.message);
        return;
      }
      App.toast("Palet eliminado");
      await refrescar();
    }
  }

  // ------------------------------------------------------------------
  //  Dar salida a los palets marcados
  // ------------------------------------------------------------------
  function abrirSalida() {
    const ids = paletsSeleccionados();
    if (ids.length === 0) return;

    const cajas = App.state.paletsActuales
      .filter((p) => ids.includes(String(p.id)))
      .reduce((s, p) => s + App.num(p.num_cajas), 0);

    App.$("salidaResumen").textContent =
      `${ids.length} ${ids.length === 1 ? "palet" : "palets"} · ${App.fmtNum(cajas)} cajas`;
    App.$("salidaFecha").value = App.hoyISO();
    App.abrirModal(App.dom.modalSalidaPalets);
  }

  async function confirmarSalida() {
    const fecha = App.$("salidaFecha").value;
    if (!fecha) {
      App.toast("Indica la fecha de salida.");
      return;
    }
    if (App.esFechaFutura(fecha)) {
      App.toast("La fecha de salida no puede ser futura.");
      return;
    }

    const ids = paletsSeleccionados();
    if (ids.length === 0) {
      App.toast("No hay palets marcados.");
      return;
    }

    const { error } = await App.db.from("palets")
      .update({ fecha_salida: fecha })
      .in("id", ids)
      .is("fecha_salida", null);
    if (error) {
      App.toast("Error: " + error.message);
      return;
    }

    App.cerrarModal(App.dom.modalSalidaPalets);
    App.toast(`${ids.length} ${ids.length === 1 ? "palet ha salido" : "palets han salido"} de la cámara`);
    await refrescar();
  }

  // ------------------------------------------------------------------
  //  Export: una fila por agricultor y palet (para poder rastrear)
  // ------------------------------------------------------------------
  function exportarPalets() {
    const filas = [];
    paletsFiltrados().forEach((p) => {
      const campana = App.campanaNombre(p.campana_id);
      const comun = {
        "Palet": p.codigo || "",
        "Fecha": p.fecha || "",
      };
      const resto = {
        "Campaña": campana === "—" ? "" : campana,
        "Total palet": App.num(p.num_cajas),
        "Estado": p.fecha_salida ? "Con salida" : "En cámara",
        "Fecha salida": p.fecha_salida || "",
        "Comentarios": p.comentarios || "",
      };
      const ls = lineas(p).length ? lineas(p) : [{ agricultor_id: null, num_cajas: 0 }];
      ls.forEach((l) => {
        const a = App.agricultorPorId(l.agricultor_id) || {};
        filas.push({
          ...comun,
          "Código": a.codigo == null ? "" : App.fmtCodigo(a.codigo),
          "Agricultor": a.nombre || "",
          "Nº Cajas": App.num(l.num_cajas),
          ...resto,
        });
      });
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

    App.$("btnNuevoPalet").addEventListener("click", () => abrirModalPalet());
    App.dom.formPalet.addEventListener("submit", guardarPalet);
    App.$("cuerpoPalets").addEventListener("click", clickPalets);
    App.$("btnExportPalets").addEventListener("click", exportarPalets);

    App.$("paletLineas").addEventListener("input", actualizarTotalPalet);
    App.$("paletLineas").addEventListener("click", (e) => {
      const b = e.target.closest("[data-todas]");
      if (!b) return;
      const input = document.querySelector(`.input-linea-palet[data-linea-agri="${b.dataset.todas}"]`);
      if (input) input.value = b.dataset.max;
      actualizarTotalPalet();
    });

    ["filtroAgriPalets", "filtroCampanaPalets", "filtroEstadoPalets",
     "filtroDesdePalets", "filtroHastaPalets"].forEach((id) =>
      App.$(id).addEventListener("change", pintarPalets));

    App.$("btnMarcarTodosPalets").addEventListener("click", () => {
      const checks = Array.from(document.querySelectorAll(".check-palet:not(:disabled)"));
      const marcarTodos = checks.some((c) => !c.checked);
      checks.forEach((c) => { c.checked = marcarTodos; });
      actualizarBotonSalida();
    });

    App.$("btnDarSalida").addEventListener("click", abrirSalida);
    App.$("btnConfirmarSalida").addEventListener("click", confirmarSalida);
  }

  Object.assign(App, {
    abrirModalPalets,
    abrirModalPalet,
    configurarEventosPalets,
  });
})(window.App);
