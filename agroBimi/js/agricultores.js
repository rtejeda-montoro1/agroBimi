// =====================================================================
//  Agricultores
// =====================================================================

(function initAgricultoresModule(App) {
  async function cargarAgricultores() {
    const buscar = App.$("buscarAgricultor").value.trim();
    let filtroOr = null;
    if (buscar) {
      // Entre comillas: una coma o un paréntesis en el nombre ("García, José")
      // rompería el filtro de Supabase.
      const literal = `%${buscar}%`.replace(/["\\]/g, "\\$&");
      const filtros = [`nombre.ilike."${literal}"`];
      const num = parseInt(buscar, 10);
      if (/^\d+$/.test(buscar) && !Number.isNaN(num)) filtros.push(`codigo.eq.${num}`);
      filtroOr = filtros.join(",");
    }

    const { data, error } = await App.traerTodo(() => {
      const q = App.db.from("agricultores").select("*")
        .order("codigo", { ascending: true, nullsFirst: false }).order("id");
      return filtroOr ? q.or(filtroOr) : q;
    });
    if (error) {
      App.dom.listaAgricultores.innerHTML = `<div class="error">Error al cargar: ${App.escapar(error.message)}</div>`;
      return false;
    }

    App.state.agricultoresActuales = data || [];
    // Sin búsqueda, lo que acabamos de traer ES la lista completa: la
    // reutilizamos para los desplegables de los modales de gestión.
    if (!buscar) guardarListaCompleta(App.state.agricultoresActuales);
    pintarAgricultores(App.state.agricultoresActuales);
    return true;
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
      .order("codigo", { ascending: true, nullsFirst: false })
      .order("id");

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
    { id: "liqAgricultor",          textoVacio: "— Elige un agricultor —" },
    { id: "filtroAgriPlantas",      textoVacio: "Todos los agricultores" },
    { id: "filtroAgriCajas",        textoVacio: "Todos los agricultores" },
    { id: "filtroAgriLiq",          textoVacio: "Todos los agricultores" },
    { id: "filtroAgriPalets",       textoVacio: "Todos los agricultores" },
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
            <button class="btn-edit btn-sm" data-ver-agri="${a.id}">Ver datos</button>
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

  // ---- Ficha de solo lectura ("Ver datos") ---------------------------
  // Para revisar de un vistazo los datos fiscales que saldrán en los
  // recibos; si algo está mal, «Editar» abre el formulario ya relleno.
  const ETIQUETAS_FISCALES = {
    nif: "NIF / CIF",
    telefono: "Teléfono",
    direccion: "Dirección",
    codigo_postal: "Código postal",
    poblacion: "Población",
    provincia: "Provincia",
    email: "Email",
    iban: "IBAN",
  };

  let agricultorVisto = null;

  function filaDato(etiqueta, valor) {
    return `<div class="factura-fila"><span>${App.escapar(etiqueta)}</span><b>${App.valor(valor)}</b></div>`;
  }

  function abrirVerAgricultor(agricultor) {
    agricultorVisto = agricultor;
    App.$("verAgricultorTitulo").textContent = `Datos de ${agricultor.nombre}`;
    App.$("verAgricultorGenerales").innerHTML =
      filaDato("Código", App.fmtCodigo(agricultor.codigo)) +
      filaDato("Nombre", agricultor.nombre);
    App.$("verAgricultorFiscales").innerHTML = Object.entries(ETIQUETAS_FISCALES)
      .map(([campo, etiqueta]) => filaDato(etiqueta, agricultor[campo]))
      .join("");
    App.abrirModal(App.dom.modalVerAgricultor);
  }

  function editarDesdeVer() {
    if (!agricultorVisto) return;
    App.cerrarModal(App.dom.modalVerAgricultor);
    abrirModalAgricultor(agricultorVisto);
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

  // Un doble clic (o Enter + clic) no puede crear el agricultor dos veces:
  // el segundo pedía el mismo código y fallaba con un "duplicate key".
  let guardandoAgricultor = false;

  async function guardarAgricultor(e) {
    e.preventDefault();
    if (guardandoAgricultor) return;
    const boton = e.submitter || App.dom.formAgricultor.querySelector('[type="submit"]');
    guardandoAgricultor = true;
    if (boton) boton.disabled = true;
    try {
      await guardarAgricultorDatos();
    } finally {
      guardandoAgricultor = false;
      if (boton) boton.disabled = false;
    }
  }

  // NIF e IBAN: se guardan normalizados ("12345678Z", "ES91 2100 ...") y,
  // si no pasan el control, se pregunta antes de guardar (puede ser un
  // documento extranjero). Devuelve false si el usuario prefiere revisarlo.
  function revisarDatosFiscales(datos) {
    if (datos.nif) datos.nif = App.normalizarNif(datos.nif);
    if (datos.iban) datos.iban = App.normalizarIban(datos.iban);

    const avisos = [];
    if (datos.nif && !App.nifValido(datos.nif)) {
      avisos.push(`• El NIF/CIF «${datos.nif}» no parece válido (la letra o el dígito de control no cuadra).`);
    }
    if (datos.iban && !App.ibanValido(datos.iban)) {
      avisos.push(`• El IBAN «${datos.iban}» no parece válido (falla el dígito de control o su longitud).`);
    }
    if (!avisos.length) return true;
    return confirm(`${avisos.join("\n")}\n\nSale así en los recibos. ¿Guardar igualmente?`);
  }

  async function guardarAgricultorDatos() {
    const id = App.$("agricultorId").value;
    const nombre = App.$("nombre").value.trim();
    if (!nombre) return;

    // Datos fiscales: los vacíos se guardan como null, no como "".
    const datos = { nombre };
    App.CAMPOS_AGRICULTOR.forEach((campo) => {
      datos[campo] = App.$(`agri_${campo}`).value.trim() || null;
    });
    if (!revisarDatosFiscales(datos)) return;

    let error;

    if (id) {
      ({ error } = await App.db.from("agricultores").update(datos).eq("id", id));
    } else {
      // El código es el máximo + 1. Si otra persona crea un agricultor a la
      // vez, los dos piden el mismo y el segundo choca con el índice único
      // (23505): se vuelve a pedir el siguiente, como mucho unas veces.
      for (let intento = 0; intento < 3; intento++) {
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
        if (!(error?.code === "23505" && /codigo/.test(error.message))) break;
      }
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
    const ver = e.target.closest("[data-ver-agri]");
    const editar = e.target.closest("[data-edit-agri]");
    const eliminar = e.target.closest("[data-del-agri]");
    const abrir = e.target.closest("[data-abrir]");

    if (ver) {
      e.stopPropagation();
      const a = App.state.agricultoresActuales.find((x) => String(x.id) === ver.dataset.verAgri);
      if (a) abrirVerAgricultor(a);
      return;
    }

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
    App.$("btnEditarDesdeVer").addEventListener("click", editarDesdeVer);
  }

  Object.assign(App, {
    cargarAgricultores,
    asegurarAgricultoresTodos,
    poblarSelectAgricultores,
    pintarAgricultores,
    abrirModalAgricultor,
    abrirVerAgricultor,
    siguienteCodigo,
    configurarEventosAgricultores,
  });
})(window.App);
