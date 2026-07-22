// =====================================================================
//  Campanas
// =====================================================================

(function initCampanasModule(App) {
  async function cargarCampanas() {
    const { data, error } = await App.db
      .from("campanas")
      .select("*")
      .order("nombre", { ascending: true });

    if (error) {
      App.toast("Error al cargar campanas: " + error.message);
      return;
    }

    App.state.campanasActuales = data || [];
    poblarSelectCampanas(App.$("campana_id"), { conVacia: true });
    poblarSelectCampanas(App.$("selBuscarCampana"), { conVacia: false, placeholder: "— Elige una campaña —" });
  }

  function poblarSelectCampanas(sel, { conVacia, placeholder } = {}) {
    if (!sel) return;

    const hay = App.state.campanasActuales.length > 0;
    let html = "";

    if (conVacia) {
      html += `<option value="">${hay ? "(Sin campana)" : "No hay campanas"}</option>`;
    } else {
      html += `<option value="">${hay ? (placeholder || "-") : "No hay campanas"}</option>`;
    }

    html += App.state.campanasActuales
      .map((c) => `<option value="${c.id}">${App.escapar(c.nombre)}</option>`)
      .join("");

    sel.innerHTML = html;
    sel.disabled = !hay;
  }

  function abrirModalCampana(campana = null) {
    App.dom.formCampana.reset();
    const esEdicion = Boolean(campana && campana.id);
    App.$("modalCampanaTitulo").textContent = esEdicion ? "Editar campaña" : "Añadir campaña";
    App.$("campanaId").value = esEdicion ? campana.id : "";
    App.$("nombreCampana").value = esEdicion ? campana.nombre : "";
    App.$("avisoEditarCampana").hidden = !esEdicion;
    App.dom.modalCampana.classList.add("open");
    App.$("nombreCampana").focus();
  }

  async function guardarCampana(e) {
    e.preventDefault();

    const id = App.$("campanaId").value;
    const nombre = App.$("nombreCampana").value.trim();
    if (!nombre) return;

    const yaExiste = App.state.campanasActuales.some(
      (c) => String(c.id) !== id && (c.nombre || "").trim().toLowerCase() === nombre.toLowerCase()
    );
    if (yaExiste) {
      App.toast("Esa campaña ya existe.");
      return;
    }

    const { error } = id
      ? await App.db.from("campanas").update({ nombre }).eq("id", id)
      : await App.db.from("campanas").insert({ nombre });
    if (error) {
      App.toast("Error: " + error.message);
      return;
    }

    App.cerrarModal(App.dom.modalCampana);
    App.toast(id ? "Campaña actualizada" : "Campaña añadida");
    await cargarCampanas();

    // Si editamos desde el buscador, conservamos la campaña seleccionada.
    if (id && App.dom.modalBuscarCampana.classList.contains("open")) {
      App.$("selBuscarCampana").value = id;
      const hay = Boolean(App.$("selBuscarCampana").value);
      App.$("btnEditarCampana").disabled = !hay;
      App.$("btnEliminarCampana").disabled = !hay;
      App.state.campanaBuscadaNombre = nombre; // refleja el nombre nuevo en el export
    }
  }

  function campanaSeleccionada() {
    const id = App.$("selBuscarCampana").value;
    if (!id) return null;
    return App.state.campanasActuales.find((c) => String(c.id) === id) || null;
  }

  function editarCampanaSeleccionada() {
    const campana = campanaSeleccionada();
    if (campana) abrirModalCampana(campana);
  }

  async function eliminarCampanaSeleccionada() {
    const campana = campanaSeleccionada();
    if (!campana) return;

    const ok = confirm(
      `¿Eliminar la campaña "${campana.nombre}"?\n\n` +
      "El campo Campaña quedará en blanco en todos los registros que la usaban. " +
      "Esta acción no se puede deshacer."
    );
    if (!ok) return;

    const { error } = await App.db.from("campanas").delete().eq("id", campana.id);
    if (error) {
      App.toast("Error: " + error.message);
      return;
    }

    App.toast("Campaña eliminada");
    await cargarCampanas();
    resetearBuscador();
  }

  function resetearBuscador() {
    App.$("cuerpoBuscarCampana").innerHTML = "";
    App.actualizarContador("countBuscarCampana", 0, "registro", "registros");
    App.$("selBuscarCampana").value = "";
    App.state.registrosCampanaActuales = [];
    App.state.campanaBuscadaNombre = "";
    App.$("btnExportCampana").disabled = true;
    App.$("btnEditarCampana").disabled = true;
    App.$("btnEliminarCampana").disabled = true;
  }

  function abrirBuscarCampana() {
    resetearBuscador();
    App.dom.modalBuscarCampana.classList.add("open");
  }

  async function buscarPorCampana(e) {
    const id = e.target.value;
    const cuerpo = App.$("cuerpoBuscarCampana");
    const hayCampana = Boolean(id);
    App.$("btnEditarCampana").disabled = !hayCampana;
    App.$("btnEliminarCampana").disabled = !hayCampana;

    if (!id) {
      cuerpo.innerHTML = "";
      App.actualizarContador("countBuscarCampana", 0, "registro", "registros");
      App.state.registrosCampanaActuales = [];
      App.state.campanaBuscadaNombre = "";
      App.$("btnExportCampana").disabled = true;
      return;
    }

    const { data, error } = await App.db
      .from("registros")
      .select("*, agricultores(nombre,codigo)")
      .eq("campana_id", id)
      .order("agricultor_id", { ascending: true })
      .order("fecha", { ascending: false, nullsFirst: false });

    if (error) {
      cuerpo.innerHTML = `<tr><td colspan="13" class="error">Error: ${error.message}</td></tr>`;
      App.state.registrosCampanaActuales = [];
      App.$("btnExportCampana").disabled = true;
      return;
    }

    const regs = data || [];
    App.state.registrosCampanaActuales = regs;
    App.state.campanaBuscadaNombre =
      e.target.options[e.target.selectedIndex]?.text || "";
    App.$("btnExportCampana").disabled = regs.length === 0;
    cuerpo.innerHTML = regs.length === 0
      ? '<tr><td colspan="13" class="empty">No hay registros para esta campana.</td></tr>'
      : regs.map((r) => {
          const a = r.agricultores || {};
          return `
        <tr>
          <td><span class="agricultor-codigo">${App.fmtCodigo(a.codigo)}</span></td>
          <td>${App.valor(a.nombre)}</td>
          <td>${App.formatearFecha(r.fecha)}</td>
          <td>${App.valor(r.ciclo)}</td>
          <td>${App.valor(r.cajas_entradas)}</td>
          <td>${App.formatearFecha(r.fecha_cmr)}</td>
          <td>${App.valor(r.cajas_salidas)}</td>
          <td>${App.valor(r.descuento_cajas)}</td>
          <td>${App.valor(r.num_factura)}</td>
          <td>${App.valor(r.cajas_vacias_retiradas)}</td>
          <td>${App.valor(r.num_plantas)}</td>
          <td>${App.formatearFecha(r.fecha_retirada)}</td>
          <td class="col-coment">${App.valor(r.comentarios)}</td>
        </tr>`;
        }).join("");

    App.actualizarContador("countBuscarCampana", regs.length, "registro", "registros");
  }

  function configurarEventosCampanas() {
    App.$("btnAnadirCampana").addEventListener("click", () => abrirModalCampana());
    App.$("btnAnadirCampanaBuscar").addEventListener("click", () => abrirModalCampana());
    App.$("btnEditarCampana").addEventListener("click", editarCampanaSeleccionada);
    App.$("btnEliminarCampana").addEventListener("click", eliminarCampanaSeleccionada);
    App.dom.formCampana.addEventListener("submit", guardarCampana);
    App.$("btnBuscarCampana").addEventListener("click", abrirBuscarCampana);
    App.$("selBuscarCampana").addEventListener("change", buscarPorCampana);
    App.$("btnExportCampana").addEventListener("click", App.exportarExcelCampana);
  }

  Object.assign(App, {
    cargarCampanas,
    poblarSelectCampanas,
    configurarEventosCampanas,
  });
})(window.App);
