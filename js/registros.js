// =====================================================================
//  Registros
// =====================================================================

(function initRegistrosModule(App) {
  async function abrirAgricultor(agricultor) {
    App.state.agricultorAbierto = agricultor;
    App.state.agrupadoPorFactura = true; // al abrir siempre se muestra agrupado
    App.$("filtroFacturaReg").value = "";
    App.$("filtroFechaDesde").value = "";
    App.$("filtroFechaHasta").value = "";
    App.$("nombreAgricultor").innerHTML =
      `<span class="agricultor-codigo">${App.fmtCodigo(agricultor.codigo)}</span>${App.escapar(agricultor.nombre)}`;

    App.mostrarVistaRegistros();
    await cargarRegistros();
  }

  // Reordena los registros agrupando los que comparten Nº de factura,
  // sin tener en cuenta la fecha de entrada. Conserva el orden de
  // aparición del primer registro de cada grupo (que viene por fecha).
  function agruparPorFactura(registros) {
    const grupos = [];
    const indicePorFactura = new Map();

    registros.forEach((r) => {
      const factura = (r.num_factura || "").trim();
      if (factura && indicePorFactura.has(factura)) {
        grupos[indicePorFactura.get(factura)].push(r);
      } else {
        if (factura) indicePorFactura.set(factura, grupos.length);
        grupos.push([r]);
      }
    });

    return grupos.flat();
  }

  function actualizarIconoOrden() {
    App.$("ordenFechaIcono").textContent = App.state.agrupadoPorFactura
      ? "≡"
      : App.state.ordenFechaAsc ? "↑" : "↓";
  }

  async function cargarRegistros() {
    if (!App.state.agricultorAbierto) return;

    const { data, error } = await App.db
      .from("registros")
      .select("*")
      .eq("agricultor_id", App.state.agricultorAbierto.id)
      .order("fecha", { ascending: App.state.ordenFechaAsc, nullsFirst: false });

    if (error) {
      App.dom.cuerpoRegistros.innerHTML = `<tr><td colspan="10" class="error">Error al cargar: ${error.message}</td></tr>`;
      return;
    }

    App.state.registrosActuales = data || [];
    refrescarVista();
  }

  function hayFiltrosActivos() {
    return Boolean(
      App.$("filtroFacturaReg").value.trim() ||
      App.$("filtroFechaDesde").value ||
      App.$("filtroFechaHasta").value
    );
  }

  // Filtra los registros cargados por Nº de factura (texto) y por rango
  // de fecha de entrada. Todo en cliente sobre registrosActuales.
  function registrosFiltrados() {
    const texto = App.$("filtroFacturaReg").value.trim().toLowerCase();
    const desde = App.$("filtroFechaDesde").value;
    const hasta = App.$("filtroFechaHasta").value;

    return App.state.registrosActuales.filter((r) => {
      if (texto && !(r.num_factura || "").toLowerCase().includes(texto)) return false;
      const fecha = r.fecha || "";
      if (desde && (!fecha || fecha < desde)) return false;
      if (hasta && (!fecha || fecha > hasta)) return false;
      return true;
    });
  }

  function limpiarFiltros() {
    App.$("filtroFacturaReg").value = "";
    App.$("filtroFechaDesde").value = "";
    App.$("filtroFechaHasta").value = "";
    refrescarVista();
  }

  // Aplica filtros + agrupación (si procede) y repinta.
  function refrescarVista() {
    const filtrados = registrosFiltrados();
    const paraPintar = App.state.agrupadoPorFactura
      ? agruparPorFactura(filtrados)
      : filtrados;
    pintarRegistros(paraPintar);
    actualizarIconoOrden();
  }

  function pintarRegistros(registros) {
    ocultarPopoverCajas(); // el repintado invalida los botones actuales
    const vacio = registros.length === 0;
    const hayTotal = App.state.registrosActuales.length > 0;
    App.$("tablaRegistros").hidden = vacio;
    App.$("registrosVacio").hidden = !vacio;
    // El export descarga todos los registros del agricultor: se habilita si hay alguno.
    App.$("btnExport").disabled = !hayTotal;

    if (vacio) {
      App.$("registrosVacio").textContent = hayTotal && hayFiltrosActivos()
        ? "No hay registros que coincidan con la búsqueda."
        : "Este agricultor todavía no tiene registros.";
    }

    if (!vacio) {
      const conteo = {};
      registros.forEach((r) => {
        const f = (r.num_factura || "").trim();
        if (f) conteo[f] = (conteo[f] || 0) + 1;
      });

      const colorPorFactura = {};
      let i = 0;
      Object.keys(conteo).forEach((f) => {
        if (conteo[f] > 1) colorPorFactura[f] = App.COLORES_FACTURA[i++ % App.COLORES_FACTURA.length];
      });

      App.dom.cuerpoRegistros.innerHTML = registros.map((r) => {
        const f = (r.num_factura || "").trim();
        const color = colorPorFactura[f];
        const attrs = color ? ` class="factura-grupo" style="--factura-bg:${color}"` : "";
        const factCell = color ? "fact-cell" : "";

        const cajasBtn = `
          <button type="button" class="cajas-btn" title="Ver detalle de cajas"
            data-cajas
            data-entradas="${r.cajas_entradas ?? ""}"
            data-salidas="${r.cajas_salidas ?? ""}"
            data-descuento="${r.descuento_cajas ?? ""}"
            data-vacias="${r.cajas_vacias_retiradas ?? ""}">📦</button>`;

        return `
        <tr${attrs}>
          <td>${App.formatearFecha(r.fecha)}</td>
          <td>${App.valor(App.campanaNombre(r.campana_id))}</td>
          <td>${App.valor(r.ciclo)}</td>
          <td class="col-cajas">${cajasBtn}</td>
          <td>${App.formatearFecha(r.fecha_cmr)}</td>
          <td class="${factCell}">${App.valor(r.num_factura)}</td>
          <td>${App.valor(r.num_plantas)}</td>
          <td>${App.formatearFecha(r.fecha_retirada)}</td>
          <td class="col-coment">${App.valor(r.comentarios)}</td>
          <td class="col-acciones">
            <button class="btn-edit btn-sm" data-edit-reg="${r.id}">Editar</button>
            <button class="btn-del btn-sm" data-del-reg="${r.id}">Eliminar</button>
          </td>
        </tr>`;
      }).join("");
    }

    App.actualizarContador("countRegistros", registros.length, "registro", "registros");
  }

  function abrirModalRegistro(registro = null) {
    App.dom.formRegistro.reset();

    if (registro) {
      App.$("modalRegistroTitulo").textContent = "Editar registro";
      App.$("registroId").value = registro.id;
      App.CAMPOS_REGISTRO.forEach(({ id }) => {
        App.$(id).value = registro[id] ?? "";
      });
      App.$("campana_id").value = registro.campana_id ?? "";
    } else {
      App.$("modalRegistroTitulo").textContent = "Anadir registro";
      App.$("registroId").value = "";
      App.$("fecha").value = new Date().toISOString().slice(0, 10);
      App.$("campana_id").value = "";
    }

    App.dom.modalRegistro.classList.add("open");
  }

  function leerValor(campo, tipo) {
    const raw = App.$(campo).value.trim();
    if (raw === "") return null;

    if (tipo === "num") {
      const n = parseInt(raw, 10);
      return Number.isNaN(n) ? null : n;
    }

    return raw;
  }

  async function guardarRegistro(e) {
    e.preventDefault();
    if (!App.state.agricultorAbierto) return;

    const id = App.$("registroId").value;
    const registro = { agricultor_id: App.state.agricultorAbierto.id };

    App.CAMPOS_REGISTRO.forEach(({ id: campo, tipo }) => {
      registro[campo] = leerValor(campo, tipo);
    });

    const campanaSel = App.$("campana_id").value;
    registro.campana_id = campanaSel ? parseInt(campanaSel, 10) : null;

    let error;
    if (id) {
      ({ error } = await App.db.from("registros").update(registro).eq("id", id));
    } else {
      ({ error } = await App.db.from("registros").insert(registro));
    }

    if (error) {
      App.toast("Error: " + error.message);
      return;
    }

    App.cerrarModal(App.dom.modalRegistro);
    App.toast(id ? "Registro actualizado" : "Registro anadido");
    App.state.agrupadoPorFactura = true; // reagrupa al añadir/editar facturas
    cargarRegistros();
  }

  async function clickRegistros(e) {
    const cajas = e.target.closest("[data-cajas]");
    if (cajas) {
      e.stopPropagation(); // evita que el listener global lo cierre al instante
      alternarPopoverCajas(cajas);
      return;
    }

    const editar = e.target.closest("[data-edit-reg]");
    const eliminar = e.target.closest("[data-del-reg]");

    if (editar) {
      const r = App.state.registrosActuales.find((x) => String(x.id) === editar.dataset.editReg);
      if (r) abrirModalRegistro(r);
      return;
    }

    if (eliminar) {
      if (!confirm("Eliminar este registro? Esta accion no se puede deshacer.")) return;

      const { error } = await App.db.from("registros").delete().eq("id", eliminar.dataset.delReg);
      if (error) {
        App.toast("Error: " + error.message);
        return;
      }

      App.toast("Registro eliminado");
      cargarRegistros();
    }
  }

  // ------------------------------------------------------------------
  //  Popover de cajas (entradas / salidas / descuento)
  // ------------------------------------------------------------------
  let popoverBtnActivo = null;

  function ocultarPopoverCajas() {
    const pop = App.$("cajasPopover");
    if (pop) pop.classList.remove("open");
    popoverBtnActivo = null;
  }

  function mostrarPopoverCajas(btn) {
    const pop = App.$("cajasPopover");
    const val = (v) => (v === "" || v == null ? "—" : v);
    pop.innerHTML = `
      <div class="cajas-fila"><span>Nº Cajas Entradas</span><b>${val(btn.dataset.entradas)}</b></div>
      <div class="cajas-fila"><span>Nº Cajas Salidas</span><b>${val(btn.dataset.salidas)}</b></div>
      <div class="cajas-fila"><span>Descuento Cajas</span><b>${val(btn.dataset.descuento)}</b></div>
      <div class="cajas-fila"><span>Cajas Vacías retiradas</span><b>${val(btn.dataset.vacias)}</b></div>`;

    // Posición fija anclada al icono (así no lo recorta el scroll de la tabla).
    pop.classList.add("open");
    const r = btn.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    let left = r.left + r.width / 2 - w / 2;
    let top = r.bottom + 8;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    if (top + h > window.innerHeight - 8) top = r.top - h - 8; // si no cabe abajo, arriba
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    popoverBtnActivo = btn;
  }

  function alternarPopoverCajas(btn) {
    if (popoverBtnActivo === btn) ocultarPopoverCajas();
    else mostrarPopoverCajas(btn);
  }

  function configurarEventosRegistros() {
    App.dom.cuerpoRegistros.addEventListener("click", clickRegistros);
    App.dom.formRegistro.addEventListener("submit", guardarRegistro);

    let debounce;
    App.$("filtroFacturaReg").addEventListener("input", () => {
      clearTimeout(debounce);
      debounce = setTimeout(refrescarVista, 200);
    });
    App.$("filtroFechaDesde").addEventListener("change", refrescarVista);
    App.$("filtroFechaHasta").addEventListener("change", refrescarVista);
    App.$("btnLimpiarFiltrosReg").addEventListener("click", limpiarFiltros);

    // Cierre del popover de cajas: clic fuera, scroll, resize o Escape.
    document.addEventListener("click", (e) => {
      if (popoverBtnActivo && !e.target.closest("#cajasPopover")) ocultarPopoverCajas();
    });
    window.addEventListener("scroll", ocultarPopoverCajas, true);
    window.addEventListener("resize", ocultarPopoverCajas);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") ocultarPopoverCajas();
    });
  }

  Object.assign(App, {
    abrirAgricultor,
    cargarRegistros,
    pintarRegistros,
    abrirModalRegistro,
    configurarEventosRegistros,
  });
})(window.App);
