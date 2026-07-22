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
    pintarAgricultores(App.state.agricultoresActuales);
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
      campoCodigo.hidden = false;
    } else {
      App.$("modalAgricultorTitulo").textContent = "Anadir agricultor";
      App.$("agricultorId").value = "";
      campoCodigo.hidden = true;
    }

    App.dom.modalAgricultor.classList.add("open");
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

    let error;

    if (id) {
      ({ error } = await App.db.from("agricultores").update({ nombre }).eq("id", id));
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

      ({ error } = await App.db.from("agricultores").insert({ nombre, codigo }));
    }

    if (error) {
      App.toast("Error: " + error.message);
      return;
    }

    App.cerrarModal(App.dom.modalAgricultor);
    App.toast(id ? "Agricultor actualizado" : "Agricultor anadido");
    cargarAgricultores();
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
    pintarAgricultores,
    abrirModalAgricultor,
    siguienteCodigo,
    configurarEventosAgricultores,
  });
})(window.App);
