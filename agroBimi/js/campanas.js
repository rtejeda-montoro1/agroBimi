// =====================================================================
//  Campanas
// =====================================================================

(function initCampanasModule(App) {
  // Todos los desplegables de campaña de la app. Los de filtro llevan
  // "Todas las campañas" y siguen usables aunque no haya ninguna creada.
  // Los "obligatorios" no tienen opción vacía: nada se guarda sin campaña,
  // así que salen con la campaña por defecto elegida (y se deshabilitan si
  // no hay ninguna).
  const SELECTS_CAMPANA = [
    { id: "campana_id",           obligatorio: true },
    { id: "selBuscarCampana",     obligatorio: true },
    { id: "plantaCampana",        obligatorio: true },
    { id: "liqCampana",           obligatorio: true },
    { id: "filtroCampanaPlantas", textoVacio: "Todas las campañas" },
    { id: "filtroCampanaCajas",   textoVacio: "Todas las campañas" },
    { id: "filtroCampanaLiq",     textoVacio: "Todas las campañas" },
    { id: "filtroCampanaReg",     textoVacio: "Todas las campañas" },
  ];

  async function cargarCampanas() {
    const { data, error } = await App.db
      .from("campanas")
      .select("*")
      .order("nombre", { ascending: true });

    if (error) {
      App.toast("Error al cargar campanas: " + error.message);
      return false;
    }

    App.state.campanasActuales = data || [];
    SELECTS_CAMPANA.forEach((cfg) => poblarSelectCampanas(App.$(cfg.id), cfg));
    return true;
  }

  // Campaña que se propone por defecto: la más reciente (la de mayor id,
  // el mismo criterio que la báscula). "" si no hay ninguna.
  function campanaPorDefecto() {
    const ids = App.state.campanasActuales.map((c) => c.id);
    return ids.length ? String(Math.max(...ids)) : "";
  }

  // Elige una campaña en un desplegable obligatorio; si no existe (o no se
  // indica), deja la campaña por defecto.
  function ponerCampana(sel, campanaId) {
    if (!sel) return;
    sel.value = campanaId == null ? "" : String(campanaId);
    if (!sel.value) sel.value = campanaPorDefecto();
  }

  function poblarSelectCampanas(sel, { textoVacio, obligatorio = false } = {}) {
    if (!sel) return;

    const hay = App.state.campanasActuales.length > 0;
    // Conservamos la selección: recargar las campañas no debe perder el
    // filtro que el usuario tenía puesto.
    const anterior = sel.value;
    const opciones = App.state.campanasActuales
      .map((c) => `<option value="${c.id}">${App.escapar(c.nombre)}</option>`)
      .join("");

    if (obligatorio) {
      sel.innerHTML = hay ? opciones : '<option value="">No hay campañas</option>';
      sel.disabled = !hay;
      ponerCampana(sel, anterior);
      return;
    }

    const etiquetaVacia = hay ? (textoVacio || "Todas las campañas") : "No hay campañas";
    sel.innerHTML = `<option value="">${App.escapar(etiquetaVacia)}</option>` + opciones;
    if (anterior) sel.value = anterior;
  }

  function abrirModalCampana(campana = null) {
    App.dom.formCampana.reset();
    const esEdicion = Boolean(campana && campana.id);
    App.$("modalCampanaTitulo").textContent = esEdicion ? "Editar campaña" : "Añadir campaña";
    App.$("campanaId").value = esEdicion ? campana.id : "";
    App.$("nombreCampana").value = esEdicion ? campana.nombre : "";
    App.$("avisoEditarCampana").hidden = !esEdicion;
    App.dom.modalCampana.classList.add("open");
    App.snapshotModal(App.dom.modalCampana);
    App.$("nombreCampana").focus();
  }

  // Un doble clic no puede mandar dos altas: la segunda chocaba con el
  // índice único y decía «Esa campaña ya existe» justo después de crearla.
  let guardandoCampana = false;

  async function guardarCampana(e) {
    e.preventDefault();
    if (guardandoCampana) return;
    const boton = e.submitter || App.dom.formCampana.querySelector('[type="submit"]');
    guardandoCampana = true;
    if (boton) boton.disabled = true;
    try {
      await guardarCampanaDatos();
    } finally {
      guardandoCampana = false;
      if (boton) boton.disabled = false;
    }
  }

  async function guardarCampanaDatos() {
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
      // 23505 = violación de índice único (la BD también impide duplicados,
      // por si el estado en cliente estaba desactualizado al validar).
      App.toast(error.code === "23505" ? "Esa campaña ya existe." : "Error: " + error.message);
      return;
    }

    App.cerrarModal(App.dom.modalCampana);
    App.toast(id ? "Campaña actualizada" : "Campaña añadida");
    await cargarCampanas();

    // Si editamos desde el buscador, conservamos la campaña seleccionada.
    if (id && App.dom.modalBuscarCampana.classList.contains("open")) {
      App.$("selBuscarCampana").value = id;
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
      "Solo se puede eliminar si no la usa ningún registro, retirada de plantas " +
      "ni liquidación. Esta acción no se puede deshacer."
    );
    if (!ok) return;

    const { error } = await App.db.from("campanas").delete().eq("id", campana.id);
    if (error) {
      // 23514: la BD no admite datos sin campaña, así que no deja borrar
      // una campaña que todavía se usa.
      App.toast(error.code === "23514"
        ? "No se puede eliminar: hay datos en esta campaña."
        : "Error: " + error.message);
      return;
    }

    App.toast("Campaña eliminada");
    await mostrarCampanaPorDefecto();
  }

  function resetearBuscador() {
    App.$("cuerpoBuscarCampana").innerHTML = "";
    App.actualizarContador("countBuscarCampana", 0, "registro", "registros");
    App.state.registrosCampanaActuales = [];
    App.state.campanaBuscadaNombre = "";
    App.$("btnExportCampana").disabled = true;
    App.$("btnEditarCampana").disabled = true;
    App.$("btnEliminarCampana").disabled = true;
    ocultarBotoneras();
    cerrarMenuExport();
  }

  function ocultarBotoneras() {
    App.$("paginacionCampana").hidden = true;
    App.$("paginacionCampanaAbajo").hidden = true;
  }

  // El buscador abre directamente con la campaña por defecto ya buscada.
  async function mostrarCampanaPorDefecto() {
    resetearBuscador();
    await cargarCampanas();
    const sel = App.$("selBuscarCampana");
    ponerCampana(sel, campanaPorDefecto());
    await buscarPorCampana({ target: sel });
  }

  async function abrirBuscarCampana() {
    App.dom.modalBuscarCampana.classList.add("open");
    App.$("filtroAgriCampana").value = "";
    // El filtro por agricultor busca en la lista completa.
    await App.asegurarAgricultoresTodos();
    // Refrescamos las campañas por si la carga inicial (al iniciar sesión)
    // fue lenta o falló y el select quedó sin opciones.
    await mostrarCampanaPorDefecto();
  }

  // Es la ventana con más filas (todas las pesadas de una campaña), así
  // que va por páginas (js/paginacion.js): campaña y agricultor se filtran
  // en el servidor y solo se traen 150 registros cada vez.
  function consultaCampana({ contar = false } = {}) {
    let q = App.db.from("registros")
      .select("*, agricultores(nombre,codigo)", contar ? { count: "exact" } : undefined)
      .eq("campana_id", App.$("selBuscarCampana").value);
    const texto = App.$("filtroAgriCampana").value.trim();
    if (texto) {
      const ids = App.agricultoresQueCoinciden(texto).map((a) => a.id);
      // Ningún agricultor encaja: -1 no es un id, así la consulta sale vacía.
      q = q.in("agricultor_id", ids.length ? ids : [-1]);
    }
    return q
      .order("agricultor_id", { ascending: true })
      .order("fecha", { ascending: false, nullsFirst: false })
      .order("id");
  }

  let paginadorCampana = null;
  function paginador() {
    paginadorCampana ||= App.crearPaginador({
      nombre: "Campana",
      consulta: consultaCampana,
      cuerpoId: "cuerpoBuscarCampana",
      columnas: 8,
      texto: "los registros",
      contadorId: "countBuscarCampana",
      alCargar: (filas, { error }) => {
        App.state.registrosCampanaActuales = filas;
        if (!error) pintarRegistrosCampana();
        else App.$("btnExportCampana").disabled = true;
      },
    });
    return paginadorCampana;
  }

  async function buscarPorCampana(e) {
    const sel = e.target;
    const id = sel.value;
    const hayCampana = Boolean(id);
    App.$("btnEditarCampana").disabled = !hayCampana;
    App.$("btnEliminarCampana").disabled = !hayCampana;
    cerrarMenuExport();

    if (!id) {
      App.$("cuerpoBuscarCampana").innerHTML = "";
      App.actualizarContador("countBuscarCampana", 0, "registro", "registros");
      App.state.registrosCampanaActuales = [];
      App.state.campanaBuscadaNombre = "";
      App.$("btnExportCampana").disabled = true;
      ocultarBotoneras();
      return;
    }

    App.state.campanaBuscadaNombre = sel.options?.[sel.selectedIndex]?.text || "";
    await paginador().filtrar();
  }

  // Escribiendo en el filtro de agricultor no se consulta en cada tecla.
  let esperaAgri = null;
  function filtrarPorAgricultor() {
    clearTimeout(esperaAgri);
    esperaAgri = setTimeout(() => buscarPorCampana({ target: App.$("selBuscarCampana") }), 300);
  }

  function pintarRegistrosCampana() {
    const regs = App.state.registrosCampanaActuales;
    const filtrando = Boolean(App.$("filtroAgriCampana").value.trim());
    App.$("btnExportCampana").disabled = regs.length === 0;
    App.$("cuerpoBuscarCampana").innerHTML = regs.length === 0
      ? App.filaMensaje(8, filtrando
        ? "No hay registros de ese agricultor en esta campaña."
        : "No hay registros para esta campaña.")
      : regs.map((r) => {
          const a = r.agricultores || {};
          const cajasBtn = App.botonCajas(r);
          return `
        <tr class="fila-clic" data-agri-id="${r.agricultor_id}" title="Ver registros del agricultor">
          <td><span class="agricultor-codigo">${App.fmtCodigo(a.codigo)}</span></td>
          <td>${App.valor(a.nombre)}</td>
          <td>${App.formatearFecha(r.fecha)}</td>
          <td>${App.valor(r.ciclo)}</td>
          <td class="col-cajas">${cajasBtn}</td>
          <td>${App.formatearFecha(r.fecha_cmr)}</td>
          <td>${App.valor(r.num_factura)}</td>
          <td class="col-coment">${App.valor(r.comentarios)}</td>
        </tr>`;
        }).join("");

    App.actualizarContador("countBuscarCampana", paginador().total(), "registro", "registros");
  }

  // -------------------------------------------------------------------
  //  Export: la página que se ve o todos los registros de la búsqueda
  // -------------------------------------------------------------------
  function cerrarMenuExport() {
    const menu = App.$("menuExportCampana");
    if (menu) menu.hidden = true;
  }

  // Si todo cabe en una página no hay nada que elegir: se exporta directamente.
  function pulsarExportCampana(e) {
    e?.stopPropagation(); // que el clic fuera del menú no lo cierre al abrirlo
    const enPagina = App.state.registrosCampanaActuales.length;
    const total = paginador().total();
    if (total <= enPagina) {
      App.exportarExcelCampana(App.state.registrosCampanaActuales);
      return;
    }
    const menu = App.$("menuExportCampana");
    if (!menu.hidden) {
      menu.hidden = true;
      return;
    }
    App.$("btnExportCampanaPagina").textContent = `Vista actual (${App.fmtNum(enPagina)} registros)`;
    App.$("btnExportCampanaTodo").textContent = `Todos los registros (${App.fmtNum(total)})`;
    menu.hidden = false;
  }

  function exportarPaginaCampana() {
    cerrarMenuExport();
    App.exportarExcelCampana(App.state.registrosCampanaActuales);
  }

  async function exportarTodoCampana() {
    cerrarMenuExport();
    const boton = App.$("btnExportCampana");
    boton.disabled = true;
    try {
      const { data, error } = await App.traerTodo(() => consultaCampana());
      if (error) {
        App.toast("Error al exportar: " + error.message);
        return;
      }
      App.exportarExcelCampana(data || []);
    } finally {
      boton.disabled = App.state.registrosCampanaActuales.length === 0;
    }
  }

  // Clic en la tabla de resultados: el icono abre el popover de cajas;
  // el resto de la fila navega a los registros de ese agricultor.
  function clickBuscarCampana(e) {
    const cajas = e.target.closest("[data-cajas]");
    if (cajas) {
      e.stopPropagation(); // evita que el listener global cierre el popover al instante
      App.alternarPopoverCajas(cajas);
      return;
    }

    const fila = e.target.closest("[data-agri-id]");
    if (!fila) return;
    const reg = App.state.registrosCampanaActuales.find(
      (r) => String(r.agricultor_id) === fila.dataset.agriId
    );
    if (!reg) return;

    const a = reg.agricultores || {};
    App.cerrarModal(App.dom.modalBuscarCampana);
    App.abrirAgricultor({ id: reg.agricultor_id, nombre: a.nombre, codigo: a.codigo });
  }

  function configurarEventosCampanas() {
    App.$("btnAnadirCampanaBuscar").addEventListener("click", () => abrirModalCampana());
    App.$("btnEditarCampana").addEventListener("click", editarCampanaSeleccionada);
    App.$("btnEliminarCampana").addEventListener("click", eliminarCampanaSeleccionada);
    App.dom.formCampana.addEventListener("submit", guardarCampana);
    App.$("btnBuscarCampana").addEventListener("click", abrirBuscarCampana);
    App.$("selBuscarCampana").addEventListener("change", buscarPorCampana);
    App.$("filtroAgriCampana").addEventListener("input", filtrarPorAgricultor);
    App.$("btnExportCampana").addEventListener("click", pulsarExportCampana);
    App.$("btnExportCampanaPagina").addEventListener("click", exportarPaginaCampana);
    App.$("btnExportCampanaTodo").addEventListener("click", exportarTodoCampana);
    App.$("cuerpoBuscarCampana").addEventListener("click", clickBuscarCampana);
    paginador().conectar();
    // El menú de export se cierra al pulsar fuera o con Escape.
    document.addEventListener("click", (e) => {
      if (!e.target.closest?.("#menuExportCampana")) cerrarMenuExport();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") cerrarMenuExport();
    });
  }

  Object.assign(App, {
    cargarCampanas,
    poblarSelectCampanas,
    campanaPorDefecto,
    ponerCampana,
    configurarEventosCampanas,
  });
})(window.App);
