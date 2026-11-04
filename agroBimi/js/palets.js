// =====================================================================
//  Paletización
//  ---------------------------------------------------------------------
//  Todas las cajas que pasan por la báscula van a la cámara y, al pesar,
//  la base de datos las reparte sola en palets de 60 (Ajustes → cajas por
//  palet): rellena el palet abierto y lo que sobra abre el siguiente.
//  Cada línea de palet está ligada a su pesada (registro), así se sabe de
//  qué agricultor es y qué día entró.
//
//      en formación  palet que aún no llega a 60: sus cajas están "en cámara"
//      completo      llegó a 60: tiene fecha de llenado y etiqueta, espera salida
//      con salida    va en un albarán de salida (js/salidas.js)
//
//  El reparto está en schema.sql (sección 16). Aquí solo se consulta, se
//  corrige a mano un palet (palet_guardar_lineas) y se imprimen etiquetas.
// =====================================================================

(function initPaletsModule(App) {
  function cajasPorPalet() {
    return App.paramNum("cajas_por_palet") || 60;
  }

  // ------------------------------------------------------------------
  //  Carga de datos
  // ------------------------------------------------------------------
  async function abrirModalPalets() {
    await App.asegurarAgricultoresTodos();
    App.abrirModal(App.dom.modalPalets);
    await cargarPalets();
  }

  function paletsAbierto() {
    return App.dom.modalPalets.classList.contains("open");
  }

  async function cargarDatosPaletizado() {
    const [palets, entradas] = await Promise.all([
      App.consultar(
        App.traerTodo(() => App.db.from("palets")
          .select("*, albaranes_salida(numero), palet_lineas(id,agricultor_id,registro_id,num_cajas,registros(fecha))")
          .order("secuencia", { ascending: false, nullsFirst: false })
          .order("id")),
        "los palets"
      ),
      App.consultar(
        App.traerTodo(() => App.db.from("paletizado_entradas").select("*").order("registro_id")),
        "las cajas en cámara"
      ),
    ]);
    if (palets === null || entradas === null) return false;
    App.state.paletsActuales = palets;
    App.state.entradasPaletizado = entradas;
    return true;
  }

  async function cargarPalets() {
    const cuerpo = App.$("cuerpoPalets");
    cuerpo.innerHTML = App.spinnerFila(7, "Cargando palets...");
    if (!(await cargarDatosPaletizado())) {
      cuerpo.innerHTML = App.filaMensaje(7, "No se pudieron cargar los palets.", "error");
      return;
    }
    pintarPalets();
  }

  // Tras cualquier cambio: refrescar lo que esté abierto.
  async function refrescarPalets() {
    if (paletsAbierto()) await cargarPalets();
    if (App.salidasAbierto()) await App.cargarAlbaranes();
  }

  // ------------------------------------------------------------------
  //  Estado de un palet
  // ------------------------------------------------------------------
  function lineas(p) {
    return p.palet_lineas || [];
  }

  function estadoPalet(p) {
    if (p.fecha_salida) return "salido";
    return App.num(p.num_cajas) >= cajasPorPalet() ? "completo" : "formacion";
  }

  function badgeEstado(p) {
    const estado = estadoPalet(p);
    if (estado === "salido") {
      const alb = p.albaranes_salida?.numero;
      return `<span class="badge badge-ok">Salida ${App.formatearFecha(p.fecha_salida)}${alb ? ` · ${App.escapar(alb)}` : ""}</span>`;
    }
    if (estado === "completo") return '<span class="badge">Completo · listo para salir</span>';
    return '<span class="badge badge-aviso">En progreso (en cámara)</span>';
  }

  function fechaEntrada(l) {
    return l.registros?.fecha || null;
  }

  // ------------------------------------------------------------------
  //  Listado
  // ------------------------------------------------------------------
  function paletsFiltrados() {
    const agri = App.$("filtroAgriPalets").value;
    const estado = App.$("filtroEstadoPalets").value;
    const desde = App.$("filtroDesdePalets").value;
    const hasta = App.$("filtroHastaPalets").value;

    return App.state.paletsActuales.filter((p) => {
      const e = estadoPalet(p);
      if (estado === "pendientes" && e === "salido") return false;
      if (estado && estado !== "pendientes" && e !== estado) return false;
      if (agri && !lineas(p).some((l) => String(l.agricultor_id) === agri)) return false;
      // Las fechas miran cuándo se llenó (o se abrió, si sigue en formación).
      if ((desde || hasta) && !App.fechaEnRango(p.fecha_completo || p.fecha, desde, hasta)) return false;
      return true;
    });
  }

  function textoLineas(p) {
    const ls = lineas(p);
    if (ls.length === 0) return '<span class="nota-liq">Vacío</span>';
    return ls.map((l) => `
      <div>${App.etiquetaAgricultor(App.agricultorPorId(l.agricultor_id))}
        · <b>${App.fmtNum(l.num_cajas)}</b>
        ${fechaEntrada(l) ? `<span class="nota-liq">· entrada ${App.formatearFecha(fechaEntrada(l))}</span>` : ""}</div>`
    ).join("");
  }

  function pintarResumenCamara() {
    const entradas = App.state.entradasPaletizado;
    const enCamara = entradas.reduce((s, x) => s + App.num(x.en_formacion) + App.num(x.sin_palet), 0);
    const completos = App.state.paletsActuales.filter((p) => estadoPalet(p) === "completo");

    App.$("paletsEnCamara").textContent = App.fmtNum(enCamara);
    App.$("paletsCompletos").textContent = App.fmtNum(completos.length);
    App.$("paletsCajasListas").textContent =
      App.fmtNum(completos.reduce((s, p) => s + App.num(p.num_cajas), 0));

    // Cámara por agricultor: lo que no está en un palet completo ni salido.
    const porAgri = {};
    entradas.forEach((x) => {
      const fila = porAgri[x.agricultor_id] ||= { formacion: 0, sueltas: 0 };
      fila.formacion += App.num(x.en_formacion);
      fila.sueltas += App.num(x.sin_palet);
    });
    const filas = Object.entries(porAgri)
      .map(([id, f]) => ({ id, ...f, total: f.formacion + f.sueltas }))
      .filter((f) => f.total > 0)
      .sort((a, b) => b.total - a.total);

    App.$("cuerpoCamaraPalets").innerHTML = filas.length === 0
      ? App.filaMensaje(4, "No hay cajas en cámara: todo está en palets completos.")
      : filas.map((f) => `
        <tr>
          <td>${App.etiquetaAgricultor(App.agricultorPorId(f.id))}</td>
          <td class="col-num">${App.fmtNum(f.formacion)}</td>
          <td class="col-num">${App.fmtNum(f.sueltas)}</td>
          <td class="col-num"><b>${App.fmtNum(f.total)}</b></td>
        </tr>`).join("");
  }

  function pintarPalets() {
    pintarResumenCamara();

    const palets = paletsFiltrados();
    const cap = cajasPorPalet();
    App.$("btnExportPalets").disabled = palets.length === 0;

    App.$("cuerpoPalets").innerHTML = palets.length === 0
      ? App.filaMensaje(7, "No hay palets con esos filtros.")
      : palets.map((p) => {
          const estado = estadoPalet(p);
          const salido = estado === "salido";
          return `
        <tr class="palet-${estado}">
          <td class="col-check">
            <input type="checkbox" class="check-palet" data-palet="${p.id}"
              ${salido ? "disabled title='Ya tiene salida'" : ""} />
          </td>
          <td><b>${App.valor(p.codigo)}</b></td>
          <td>${p.fecha_completo ? App.formatearFecha(p.fecha_completo) : "—"}</td>
          <td class="col-lineas">${textoLineas(p)}</td>
          <td class="col-num"><b>${App.fmtNum(p.num_cajas)}</b> / ${App.fmtNum(cap)}</td>
          <td>${badgeEstado(p)}</td>
          <td class="col-acciones">
            <button class="btn-ghost btn-sm" data-etiqueta-palet="${p.id}">🏷 Etiqueta</button>
            ${salido ? "" : `<button class="btn-edit btn-sm" data-edit-palet="${p.id}">Editar</button>`}
            ${salido ? "" : `<button class="btn-del btn-sm" data-del-palet="${p.id}">Eliminar</button>`}
          </td>
        </tr>`;
        }).join("");

    App.actualizarContador("countPalets", palets.length, "palet", "palets");
    actualizarBotonesSeleccion();
  }

  function paletsSeleccionados() {
    return Array.from(document.querySelectorAll(".check-palet:checked")).map((c) => c.dataset.palet);
  }

  function actualizarBotonesSeleccion() {
    const n = paletsSeleccionados().length;
    App.$("btnEtiquetasPalets").disabled = n === 0;
    App.$("btnEtiquetasPalets").textContent = n === 0 ? "🏷 Imprimir etiquetas" : `🏷 Imprimir etiquetas (${n})`;
    App.$("btnSalidaPalets").disabled = n === 0;
    App.$("btnSalidaPalets").textContent = n === 0 ? "🚚 Dar salida" : `🚚 Dar salida (${n})`;
  }

  function paletPorId(id) {
    return App.state.paletsActuales.find((p) => String(p.id) === String(id));
  }

  // ------------------------------------------------------------------
  //  Editar un palet: quitar cajas o completarlo con cajas de la cámara
  // ------------------------------------------------------------------
  // Filas: las pesadas que ya van en el palet y las que tienen cajas en
  // cámara. Disponible = sin palet + en otros palets en formación (de ahí
  // las toma la base de datos al guardar).
  function filasEditor(palet) {
    const enEste = {};
    lineas(palet).forEach((l) => {
      if (l.registro_id) enEste[l.registro_id] = App.num(l.num_cajas);
    });
    const esteEnFormacion = estadoPalet(palet) === "formacion";

    return App.state.entradasPaletizado
      .map((x) => {
        const propias = enEste[x.registro_id] || 0;
        const disponible = App.num(x.sin_palet) + App.num(x.en_formacion) - (esteEnFormacion ? propias : 0);
        return { ...x, propias, disponible };
      })
      .filter((x) => x.propias > 0 || x.disponible > 0)
      .sort((a, b) => (b.propias > 0) - (a.propias > 0) ||
        String(b.fecha).localeCompare(String(a.fecha)) || b.registro_id - a.registro_id);
  }

  // Sin palet: nuevo palet. No se crea nada hasta pulsar «Guardar palet».
  async function abrirModalPalet(palet = null) {
    if (!(await cargarDatosPaletizado())) return;
    const p = (palet && paletPorId(palet.id)) || palet || { id: null, num_cajas: 0, palet_lineas: [] };

    App.dom.formPalet.reset();
    App.$("paletId").value = p.id ?? "";
    App.$("modalPaletTitulo").textContent = p.id ? `Editar palet ${p.codigo || ""}`.trim() : "Nuevo palet";

    const antiguas = lineas(p).filter((l) => !l.registro_id);
    App.$("paletAvisoAntiguo").hidden = antiguas.length === 0;

    const filas = filasEditor(p);
    App.$("paletLineas").innerHTML = filas.length === 0
      ? App.filaMensaje(5, "No hay cajas en cámara para añadir a este palet.")
      : filas.map((f) => `
        <tr class="${f.propias > 0 ? "fila-en-palet" : ""}">
          <td>${App.formatearFecha(f.fecha)}</td>
          <td>${App.etiquetaAgricultor(App.agricultorPorId(f.agricultor_id))}</td>
          <td class="col-num">${App.fmtNum(f.disponible)}</td>
          <td class="col-num col-linea-palet">
            <input type="number" class="input-linea-palet" data-registro="${f.registro_id}"
              data-max-fila="${f.propias + f.disponible}"
              min="0" max="${f.propias + f.disponible}" step="1" value="${f.propias || ""}" placeholder="0" />
          </td>
          <td><button type="button" class="btn-ghost btn-sm" data-completar="${f.registro_id}">Completar</button></td>
        </tr>`).join("");

    App.$("paletTotalFijo").value = antiguas.reduce((s, l) => s + App.num(l.num_cajas), 0);
    actualizarTotalPalet();
    App.abrirModal(App.dom.modalPalet);
  }

  function lineasDelEditor() {
    return Array.from(document.querySelectorAll(".input-linea-palet"))
      .map((input) => ({
        registro_id: parseInt(input.dataset.registro, 10),
        num_cajas: parseInt(input.value, 10) || 0,
        max: maxFila(input),
      }));
  }

  // Lo que esa pesada puede llegar a poner en el palet: lo que ya lleva más
  // lo que tiene en cámara.
  function maxFila(input) {
    return parseInt(input.dataset.maxFila, 10) || 0;
  }

  function totalEditor() {
    return App.num(App.$("paletTotalFijo").value) +
      lineasDelEditor().reduce((s, l) => s + l.num_cajas, 0);
  }

  // No deja pasarse: una pesada no pone más cajas de las que tiene en
  // cámara y el palet no pasa de sus 60. Lo escrito de más se corrige al
  // vuelo, y cada casilla y su «Completar» se topan con el hueco que queda:
  // con el palet lleno solo se pueden quitar cajas.
  function limitarEditor(editado = null) {
    const cap = cajasPorPalet();
    const valor = (input) => Math.max(0, parseInt(input.value, 10) || 0);

    if (editado?.classList.contains("input-linea-palet")) {
      const otros = totalEditor() - valor(editado);
      const tope = Math.max(0, Math.min(maxFila(editado), cap - otros));
      if ((parseInt(editado.value, 10) || 0) < 0) editado.value = "";
      if (valor(editado) > tope) {
        editado.value = tope > 0 ? String(tope) : "";
        App.toast(tope === maxFila(editado)
          ? `Esa pesada solo tiene ${App.fmtNum(tope)} cajas en cámara.`
          : `En el palet solo caben ${App.fmtNum(tope)} cajas más de esa pesada.`);
      }
    }

    const hueco = Math.max(0, cap - totalEditor());
    document.querySelectorAll(".input-linea-palet").forEach((input) => {
      const max = Math.min(maxFila(input), valor(input) + hueco);
      input.max = String(max);
      const boton = input.closest("tr")?.querySelector("[data-completar]");
      if (boton) boton.disabled = valor(input) >= max;
    });
  }

  function actualizarTotalPalet(e = null) {
    limitarEditor(e?.target || null);
    const total = totalEditor();
    const cap = cajasPorPalet();
    App.$("paletTotal").textContent = `${App.fmtNum(total)} / ${App.fmtNum(cap)}`;
    App.$("paletTotal").classList.toggle("negativo", total > cap);
    App.$("paletFaltan").textContent = total < cap
      ? `Faltan ${App.fmtNum(cap - total)} cajas para completarlo`
      : total === cap ? "Palet completo: solo se pueden quitar cajas" : `Sobran ${App.fmtNum(total - cap)} cajas`;
  }

  // «Completar»: pone de esa pesada lo que falte hasta 60 (o lo que tenga).
  function completarDesde(registroId) {
    const input = document.querySelector(`.input-linea-palet[data-registro="${registroId}"]`);
    if (!input) return;
    const actual = parseInt(input.value, 10) || 0;
    const falta = cajasPorPalet() - totalEditor();
    if (falta <= 0) {
      App.toast("El palet ya está completo.");
      return;
    }
    input.value = Math.min(maxFila(input), actual + falta);
    actualizarTotalPalet();
  }

  // Un doble clic en «Guardar» no puede crear dos palets con las mismas cajas.
  let guardandoPalet = false;

  async function guardarPalet(e) {
    e.preventDefault();
    if (guardandoPalet) return;
    const boton = e.submitter || App.$("formPalet")?.querySelector('[type="submit"]');
    guardandoPalet = true;
    if (boton) boton.disabled = true;
    try {
      await guardarPaletDatos();
    } finally {
      guardandoPalet = false;
      if (boton) boton.disabled = false;
    }
  }

  async function guardarPaletDatos() {

    const ls = lineasDelEditor();
    const mal = ls.find((l) => l.num_cajas < 0 || l.num_cajas > l.max);
    if (mal) {
      App.toast(`Una de las entradas solo tiene ${App.fmtNum(mal.max)} cajas disponibles.`);
      return;
    }
    const cap = cajasPorPalet();
    if (totalEditor() > cap) {
      App.toast(`Un palet lleva como mucho ${App.fmtNum(cap)} cajas.`);
      return;
    }

    const id = App.$("paletId").value;
    const conCajas = ls.filter((l) => l.num_cajas > 0);
    if (!id && conCajas.length === 0) {
      App.toast("Indica las cajas que lleva el palet.");
      return;
    }

    // Al crear, la base de datos numera el palet y le pone sus cajas a la
    // vez: si algo falla no queda un palet vacío.
    const { error } = await App.db.rpc("palet_guardar_lineas", {
      p_palet_id: id ? parseInt(id, 10) : null,
      p_lineas: conCajas.map(({ registro_id, num_cajas }) => ({ registro_id, num_cajas })),
    });
    if (error) {
      App.toast("Error: " + error.message);
      return;
    }

    App.cerrarModal(App.dom.modalPalet);
    App.toast(id ? "Palet actualizado" : "Palet creado");
    await refrescarPalets();
  }

  // ------------------------------------------------------------------
  //  Etiqueta del palet (impresora de pegatinas)
  // ------------------------------------------------------------------
  // El tamaño sale de Ajustes (por defecto 105 × 75 mm). Cada etiqueta
  // va en su propia página de ese tamaño.
  // Como la etiqueta en papel del cliente: cada agricultor con sus cajas
  // (sumando sus pesadas) y la fecha de llenado. Arriba, el número del
  // palet bien visible a la izquierda (para distinguir las etiquetas
  // sueltas antes de pegarlas) y el código pequeño a la derecha.
  function etiquetaHTML(p) {
    const numero = p.secuencia ?? String(p.codigo || "").replace(/\D+/g, "").replace(/^0+(?=\d)/, "");
    const porAgri = new Map();
    lineas(p).forEach((l) => {
      porAgri.set(l.agricultor_id, (porAgri.get(l.agricultor_id) || 0) + App.num(l.num_cajas));
    });
    const filas = [...porAgri].map(([id, cajas]) => `
        <tr>
          <td>${App.escapar(App.agricultorPorId(id)?.nombre || "")}</td>
          <td class="der">${App.fmtNum(cajas)}</td>
        </tr>`).join("");

    return `
      <div class="etq">
        <div class="etq-cabecera">
          <span class="etq-numero">${numero ? `Palet nº ${App.escapar(String(numero))}` : ""}</span>
          <span class="etq-codigo">${App.escapar(p.codigo || "")}</span>
        </div>
        <table class="etq-tabla"><tbody>${filas}</tbody></table>
        <div class="etq-fecha">${p.fecha_completo ? App.formatearFecha(p.fecha_completo) : "En progreso"}</div>
      </div>`;
  }

  function imprimirEtiquetas(ids) {
    const palets = ids.map(paletPorId).filter(Boolean);
    if (palets.length === 0) return;

    const incompletos = palets.filter((p) => estadoPalet(p) === "formacion");
    if (incompletos.length &&
        !confirm(`${incompletos.map((p) => p.codigo).join(", ")} todavía no ${incompletos.length === 1 ? "está completo" : "están completos"}. ¿Imprimir la etiqueta igualmente?`)) {
      return;
    }

    const ancho = App.paramNum("etiqueta_ancho_mm") || 105;
    const alto = App.paramNum("etiqueta_alto_mm") || 75;
    // Nombre del PDF: "Etiqueta P-000012"; con varias, la primera y la
    // última ("Etiquetas P-000012 a P-000015").
    const codigos = palets.map((p) => p.codigo || "").filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
    const nombre = codigos.length <= 1
      ? `Etiqueta ${codigos[0] || "palet"}`
      : `Etiquetas ${codigos[0]} a ${codigos[codigos.length - 1]}`;
    // Toda la impresión pasa a ser del tamaño de la pegatina (este @page va
    // después de la hoja de estilos, así que manda sobre el A4). Con una
    // página con nombre, el navegador añadía una hoja en blanco al final.
    App.imprimirDocumento(`
      <style>@page { size: ${ancho}mm ${alto}mm; margin: 4mm; }</style>
      ${palets.map(etiquetaHTML).join("")}`, nombre);
  }

  // ------------------------------------------------------------------
  //  Acciones del listado
  // ------------------------------------------------------------------
  async function clickPalets(e) {
    if (e.target.classList.contains("check-palet")) {
      actualizarBotonesSeleccion();
      return;
    }

    const etiqueta = e.target.closest("[data-etiqueta-palet]");
    const editar = e.target.closest("[data-edit-palet]");
    const eliminar = e.target.closest("[data-del-palet]");

    if (etiqueta) {
      imprimirEtiquetas([etiqueta.dataset.etiquetaPalet]);
      return;
    }
    if (editar) {
      const p = paletPorId(editar.dataset.editPalet);
      if (p) await abrirModalPalet(p);
      return;
    }
    if (eliminar) {
      const p = paletPorId(eliminar.dataset.delPalet);
      if (!p) return;
      if (!confirm(`¿Eliminar el palet ${p.codigo || ""}?\n\nSus ${App.fmtNum(p.num_cajas)} cajas vuelven a la cámara sin palet. Esta acción no se puede deshacer.`)) return;
      const { data: borrados, error } = await App.db.from("palets").delete()
        .eq("id", p.id).is("fecha_salida", null).select("id");
      if (error) {
        App.toast("Error: " + error.message);
        return;
      }
      // Si ya tenía salida (otra pestaña, la lista estaba vieja) no se borra.
      App.toast((borrados || []).length ? "Palet eliminado" : "No se ha eliminado: el palet ya tiene salida.");
      await refrescarPalets();
    }
  }

  // ------------------------------------------------------------------
  //  Export: una fila por agricultor y palet
  // ------------------------------------------------------------------
  const ESTADO_TEXTO = { formacion: "En progreso", completo: "Completo", salido: "Con salida" };

  function exportarPalets() {
    const filas = [];
    paletsFiltrados().forEach((p) => {
      const ls = lineas(p).length ? lineas(p) : [{ agricultor_id: null, num_cajas: 0 }];
      ls.forEach((l) => {
        const a = App.agricultorPorId(l.agricultor_id) || {};
        filas.push({
          "Palet": p.codigo || "",
          "Fecha llenado": p.fecha_completo || "",
          "Código": a.codigo == null ? "" : App.fmtCodigo(a.codigo),
          "Agricultor": a.nombre || "",
          "Fecha entrada": fechaEntrada(l) || "",
          "Nº Cajas": App.num(l.num_cajas),
          "Total palet": App.num(p.num_cajas),
          "Estado": ESTADO_TEXTO[estadoPalet(p)],
          "Fecha salida": p.fecha_salida || "",
          "Albarán": p.albaranes_salida?.numero || "",
        });
      });
    });

    if (filas.length === 0) {
      App.toast("No hay palets que exportar.");
      return;
    }
    App.descargarLibro(filas, "Palets", "Palets");
    App.toast("Excel exportado");
  }

  // ------------------------------------------------------------------
  //  Eventos
  // ------------------------------------------------------------------
  function configurarEventosPalets() {
    App.$("btnPaletizacion").addEventListener("click", abrirModalPalets);
    App.$("btnNuevoPalet").addEventListener("click", () => abrirModalPalet());
    App.dom.formPalet.addEventListener("submit", guardarPalet);
    App.$("cuerpoPalets").addEventListener("click", clickPalets);
    App.$("btnExportPalets").addEventListener("click", exportarPalets);

    App.$("paletLineas").addEventListener("input", actualizarTotalPalet);
    App.$("paletLineas").addEventListener("click", (e) => {
      const b = e.target.closest("[data-completar]");
      if (b) completarDesde(b.dataset.completar);
    });

    ["filtroAgriPalets", "filtroEstadoPalets", "filtroDesdePalets", "filtroHastaPalets"].forEach((id) =>
      App.$(id).addEventListener("change", pintarPalets));

    App.$("btnMarcarTodosPalets").addEventListener("click", () => {
      const checks = Array.from(document.querySelectorAll(".check-palet:not(:disabled)"));
      const marcarTodos = checks.some((c) => !c.checked);
      checks.forEach((c) => { c.checked = marcarTodos; });
      actualizarBotonesSeleccion();
    });

    App.$("btnEtiquetasPalets").addEventListener("click", () => imprimirEtiquetas(paletsSeleccionados()));
    App.$("btnSalidaPalets").addEventListener("click", () => App.abrirModalSalida(paletsSeleccionados()));
  }

  Object.assign(App, {
    cajasPorPalet,
    estadoPalet,
    cargarDatosPaletizado,
    refrescarPalets,
    configurarEventosPalets,
  });
})(window.App);
