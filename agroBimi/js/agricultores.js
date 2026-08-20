// =====================================================================
//  Agricultores
// =====================================================================

(function initAgricultoresModule(App) {
  async function cargarAgricultores() {
    let query = App.db.from("agricultores").select("*").order("nombre", { ascending: true });

    const buscar = App.$("buscarAgricultor").value.trim();
    if (buscar) {
      const filtros = [`nombre.ilike.%${buscar}%`];
      const num = parseInt(buscar, 10);
      if (/^\d+$/.test(buscar) && !Number.isNaN(num)) filtros.push(`codigo.eq.${num}`);
      query = query.or(filtros.join(","));
    }

    const { data, error } = await query;
    if (error) {
      App.dom.listaAgricultores.innerHTML = `<div class="error">Error al cargar: ${error.message}</div>`;
      return;
    }

    App.state.agricultoresActuales = data || [];
    // Sin búsqueda, lo que acabamos de traer ES la lista completa: la
    // reutilizamos para los desplegables de los modales de gestión.
    if (!buscar) guardarListaCompleta(App.state.agricultoresActuales);
    pintarAgricultores(App.state.agricultoresActuales);
  }

  function guardarListaCompleta(agricultores) {
    App.state.agricultoresTodos = agricultores;
    SELECTS_AGRICULTOR.forEach((cfg) => poblarSelectAgricultores(App.$(cfg.id), cfg));
  }

  // Se llama antes de abrir cualquier modal de gestión: si el usuario tenía
  // una búsqueda escrita, la lista completa puede no estar cargada todavía.
  // Con forzar=true se recarga aunque ya hubiera algo (tras crear, editar o
  // eliminar un agricultor).
  async function asegurarAgricultoresTodos(forzar = false) {
    if (!forzar && App.state.agricultoresTodos.length > 0) return App.state.agricultoresTodos;

    const { data, error } = await App.db
      .from("agricultores")
      .select("*")
      .order("nombre", { ascending: true });

    if (error) {
      App.toast("Error al cargar agricultores: " + error.message);
      return [];
    }

    guardarListaCompleta(data || []);
    return App.state.agricultoresTodos;
  }

  // Desplegables de agricultor de la app (formularios y filtros).
  const SELECTS_AGRICULTOR = [
    { id: "plantaAgricultor",       textoVacio: "— Elige un agricultor —" },
    { id: "paletAgricultor",        textoVacio: "— Elige un agricultor —" },
    { id: "liqAgricultor",          textoVacio: "— Elige un agricultor —" },
    { id: "filtroAgriPlantas",      textoVacio: "Todos los agricultores" },
    { id: "filtroAgriRend",         textoVacio: "Todos los agricultores" },
    { id: "filtroAgriCajas",        textoVacio: "Todos los agricultores" },
    { id: "filtroAgriPalets",       textoVacio: "Todos los agricultores" },
    { id: "filtroAgriLiq",          textoVacio: "Todos los agricultores" },
  ];

  function poblarSelectAgricultores(sel, { textoVacio } = {}) {
    if (!sel) return;

    const anterior = sel.value;
    sel.innerHTML =
      `<option value="">${App.escapar(textoVacio || "— Elige un agricultor —")}</option>` +
      App.state.agricultoresTodos
        .map((a) => `<option value="${a.id}">${App.fmtCodigo(a.codigo)} · ${App.escapar(a.nombre)}</option>`)
        .join("");

    if (anterior) sel.value = anterior;
  }

  function pintarAgricultores(agricultores) {
    if (agricultores.length === 0) {
      const buscar = App.$("buscarAgricultor").value.trim();
      App.dom.listaAgricultores.innerHTML = `<div class="empty">${
        buscar ? "No hay agricultores que coincidan con la busqueda." : "Todavia no hay agricultores. Pulsa + Anadir agricultor."
      }</div>`;
    } else {
      App.dom.listaAgricultores.innerHTML = agricultores.map((a) => `
        <div class="agricultor" data-abrir="${a.id}">
          <div class="agricultor-nombre"><span class="agricultor-codigo">${App.fmtCodigo(a.codigo)}</span> ${App.escapar(a.nombre)}</div>
          <div class="acciones">
            <button class="btn-edit btn-sm" data-edit-agri="${a.id}">Editar</button>
            <button class="btn-del btn-sm" data-del-agri="${a.id}">Eliminar</button>
            <span class="chevron">></span>
          </div>
        </div>`).join("");
    }

    App.actualizarContador("countAgricultores", agricultores.length, "agricultor", "agricultores");
  }

  function abrirModalAgricultor(agricultor = null) {
    App.dom.formAgricultor.reset();
    const campoCodigo = App.$("campoCodigoAgricultor");

    if (agricultor) {
      App.$("modalAgricultorTitulo").textContent = "Editar agricultor";
      App.$("agricultorId").value = agricultor.id;
      App.$("nombre").value = agricultor.nombre;
      App.$("codigoAgricultor").value = App.fmtCodigo(agricultor.codigo);
      App.CAMPOS_AGRICULTOR.forEach((campo) => {
        App.$(`agri_${campo}`).value = agricultor[campo] ?? "";
      });
      campoCodigo.hidden = false;
    } else {
      App.$("modalAgricultorTitulo").textContent = "Anadir agricultor";
      App.$("agricultorId").value = "";
      campoCodigo.hidden = true;
    }

    App.abrirModal(App.dom.modalAgricultor);
    App.$("nombre").focus();
  }

  async function siguienteCodigo() {
    const { data, error } = await App.db
      .from("agricultores")
      .select("codigo")
      .order("codigo", { ascending: false, nullsFirst: false })
      .limit(1);

    if (error) throw error;

    const max = data && data.length && data[0].codigo ? data[0].codigo : 0;
    return max + 1;
  }

  async function guardarAgricultor(e) {
    e.preventDefault();

    const id = App.$("agricultorId").value;
    const nombre = App.$("nombre").value.trim();
    if (!nombre) return;

    // Datos fiscales: los vacíos se guardan como null, no como "".
    const datos = { nombre };
    App.CAMPOS_AGRICULTOR.forEach((campo) => {
      datos[campo] = App.$(`agri_${campo}`).value.trim() || null;
    });

    let error;

    if (id) {
      ({ error } = await App.db.from("agricultores").update(datos).eq("id", id));
    } else {
      let codigo;
      try {
        codigo = await siguienteCodigo();
      } catch (err) {
        App.toast("Error al generar el codigo: " + err.message);
        return;
      }

      if (codigo > 999) {
        App.toast("No quedan codigos libres de 3 digitos.");
        return;
      }

      ({ error } = await App.db.from("agricultores").insert({ ...datos, codigo }));
    }

    if (error) {
      App.toast("Error: " + error.message);
      return;
    }

    App.cerrarModal(App.dom.modalAgricultor);
    App.toast(id ? "Agricultor actualizado" : "Agricultor anadido");
    cargarAgricultores();
    // La lista de los desplegables no se refresca sola si hay una búsqueda
    // escrita en el buscador: la forzamos.
    asegurarAgricultoresTodos(true);
  }

  async function clickListaAgricultores(e) {
    const editar = e.target.closest("[data-edit-agri]");
    const eliminar = e.target.closest("[data-del-agri]");
    const abrir = e.target.closest("[data-abrir]");

    if (editar) {
      e.stopPropagation();
      const a = App.state.agricultoresActuales.find((x) => String(x.id) === editar.dataset.editAgri);
      if (a) abrirModalAgricultor(a);
      return;
    }

    if (eliminar) {
      e.stopPropagation();
      if (!confirm("Eliminar este agricultor y todos sus registros? Esta accion no se puede deshacer.")) return;

      const { error } = await App.db.from("agricultores").delete().eq("id", eliminar.dataset.delAgri);
      if (error) {
        App.toast("Error: " + error.message);
        return;
      }

      App.toast("Agricultor eliminado");
      cargarAgricultores();
      asegurarAgricultoresTodos(true);
      return;
    }

    if (abrir) {
      const a = App.state.agricultoresActuales.find((x) => String(x.id) === abrir.dataset.abrir);
      if (a) App.abrirAgricultor(a);
    }
  }

  function configurarEventosAgricultores() {
    App.dom.listaAgricultores.addEventListener("click", clickListaAgricultores);
    App.dom.formAgricultor.addEventListener("submit", guardarAgricultor);
  }

  Object.assign(App, {
    cargarAgricultores,
    asegurarAgricultoresTodos,
    poblarSelectAgricultores,
    pintarAgricultores,
    abrirModalAgricultor,
    siguienteCodigo,
    configurarEventosAgricultores,
  });
})(window.App);
