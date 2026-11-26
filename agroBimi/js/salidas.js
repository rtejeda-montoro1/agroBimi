// =====================================================================
//  Salidas de palets (albaranes de salida)
//  ---------------------------------------------------------------------
//  Dar salida = elegir palets de la cámara, el destinatario y el
//  transporte. Se crea un albarán numerado (serie de Ajustes) y sus palets
//  quedan con fecha de salida, todo a la vez (función albaran_crear). La
//  fecha de salida pasa también a la Fecha (CMR) de sus pesadas.
//
//  Se imprimen la carta de porte (CMR, tres ejemplares, como el impreso del
//  cliente) y el albarán, que lista cada palet con los agricultores que
//  lleva, sus cajas y la fecha de entrada de cada pesada. Las plantillas
//  están en js/documentos-salida.js; llevan un QR a la copia digital
//  (albaran.html), por si paran al transportista.
//
//  Anular un albarán devuelve sus palets a la cámara.
// =====================================================================

(function initSalidasModule(App) {
  const matriculas = (alb) => [alb.matricula, alb.matricula_remolque].filter(Boolean).join(" / ");

  // ------------------------------------------------------------------
  //  Listado de albaranes
  // ------------------------------------------------------------------
  async function abrirModalSalidas() {
    await App.asegurarAgricultoresTodos();
    App.abrirModal(App.dom.modalSalidas);
    await filtrarAlbaranes();
  }

  function salidasAbierto() {
    return App.dom.modalSalidas.classList.contains("open");
  }

  // El listado va por páginas (js/paginacion.js): los filtros se aplican
  // en el servidor y solo se traen 150 albaranes cada vez.
  function consultaAlbaranes({ contar = false } = {}) {
    const desde = App.$("filtroDesdeSalidas").value;
    const hasta = App.$("filtroHastaSalidas").value;
    const texto = App.$("filtroDestinoSalidas").value.trim();
    let q = App.db.from("albaranes_salida")
      .select("*, palets(id,num_cajas)", contar ? { count: "exact" } : undefined);
    if (desde) q = q.gte("fecha", desde);
    if (hasta) q = q.lte("fecha", hasta);
    if (texto) q = q.ilike("destinatario_nombre", App.patronContiene(texto));
    return q.order("secuencia", { ascending: false, nullsFirst: false }).order("id");
  }

  let paginadorSalidas = null;
  function paginador() {
    paginadorSalidas ||= App.crearPaginador({
      nombre: "Salidas",
      consulta: consultaAlbaranes,
      cuerpoId: "cuerpoAlbaranes",
      columnas: 7,
      texto: "los albaranes",
      contadorId: "countAlbaranes",
      alCargar: (filas, { error }) => {
        App.state.albaranesActuales = filas;
        if (!error) pintarAlbaranes();
        else App.$("btnExportSalidas").disabled = true;
      },
    });
    return paginadorSalidas;
  }

  // Tras dar salida o anular se recarga la página en la que se estaba.
  function cargarAlbaranes() {
    return paginador().cargar();
  }

  // Al cambiar un filtro se vuelve a la primera página.
  function filtrarAlbaranes() {
    return paginador().filtrar();
  }

  function pintarAlbaranes() {
    const albaranes = App.state.albaranesActuales;
    App.$("cuerpoAlbaranes").innerHTML = albaranes.length === 0
      ? App.filaMensaje(7, "No hay albaranes de salida con esos filtros.")
      : albaranes.map((a) => {
          const palets = a.palets || [];
          return `
        <tr>
          <td><b>${App.valor(a.numero)}</b></td>
          <td>${App.formatearFecha(a.fecha)}</td>
          <td>${App.valor(a.destinatario_nombre)}</td>
          <td>${App.valor(matriculas(a))}</td>
          <td class="col-num">${App.fmtNum(palets.length)}</td>
          <td class="col-num"><b>${App.fmtNum(palets.reduce((s, p) => s + App.num(p.num_cajas), 0))}</b></td>
          <td class="col-acciones">
            <button class="btn-fact btn-sm" data-imprimir-cmr="${a.id}">🖨 CMR</button>
            <button class="btn-fact btn-sm" data-imprimir-alb="${a.id}">🖨 Albarán</button>
            <button class="btn-del btn-sm" data-anular-alb="${a.id}">Anular</button>
          </td>
        </tr>`;
        }).join("");
    App.actualizarContador("countAlbaranes", paginador().total(), "albarán", "albaranes");
    App.$("btnExportSalidas").disabled = albaranes.length === 0;
  }

  // ------------------------------------------------------------------
  //  Nueva salida
  // ------------------------------------------------------------------
  // idsMarcados: palets ya elegidos en Stock en cámara. Si no viene ninguno
  // se proponen todos los palets completos.
  async function abrirModalSalida(idsMarcados = []) {
    await App.asegurarAgricultoresTodos();
    if (!(await App.cargarDatosPaletizado())) return;
    if (!(await cargarHistorialSalidas())) return;

    App.dom.formSalida.reset();
    App.$("salidaFecha").value = App.hoyISO();
    rellenarDestinatarios();
    proponerDatosSalida();

    const marcados = new Set(idsMarcados.map(String));
    const disponibles = App.state.paletsCamara
      .filter((p) => !p.fecha_salida && App.num(p.num_cajas) > 0)
      .sort((a, b) => App.num(a.secuencia) - App.num(b.secuencia));

    App.$("salidaPalets").innerHTML = disponibles.length === 0
      ? App.filaMensaje(4, "No hay palets en la cámara.")
      : disponibles.map((p) => {
          const completo = App.estadoPalet(p) === "completo";
          const marcar = marcados.size ? marcados.has(String(p.id)) : completo;
          return `
        <tr>
          <td class="col-check"><input type="checkbox" class="check-salida" data-palet="${p.id}"
            data-cajas="${App.num(p.num_cajas)}" ${marcar ? "checked" : ""} /></td>
          <td><b>${App.valor(p.codigo)}</b></td>
          <td>${completo
            ? `<span class="badge">Completo ${App.formatearFecha(p.fecha_completo)}</span>`
            : '<span class="badge badge-aviso">En progreso</span>'}</td>
          <td class="col-num"><b>${App.fmtNum(p.num_cajas)}</b></td>
        </tr>`;
        }).join("");

    actualizarResumenSalida();
    App.abrirModal(App.dom.modalSalida);
  }

  // Para proponer los datos de la nueva salida (destinatarios, transporte,
  // lugar de carga...) basta con los últimos albaranes: así no se traen
  // todos aunque haya miles.
  const ALBARANES_HISTORIAL = 500;

  async function cargarHistorialSalidas() {
    const { data, error } = await App.db.from("albaranes_salida")
      .select("destinatario_nombre,destinatario_nif,destinatario_direccion,lugar_entrega," +
        "matricula,matricula_remolque,transportista,lugar_carga,marcas,embalaje,naturaleza,temperatura")
      .order("secuencia", { ascending: false, nullsFirst: false })
      .order("id")
      .range(0, ALBARANES_HISTORIAL - 1);
    if (error) {
      App.toast(`Error al cargar los albaranes anteriores: ${error.message}`);
      return false;
    }
    App.state.albaranesHistorial = data || [];
    return true;
  }

  // Lo que en el CMR suele repetirse (lugar de carga, mercancía,
  // temperatura) sale como en la última salida; la primera vez, como en el
  // CMR de ejemplo del cliente. El peso se calcula con las cajas marcadas.
  const PROPUESTA_INICIAL = {
    lugar_carga: "Granada", marcas: "Negro", embalaje: "Plástico",
    naturaleza: "Tsb loose 8kg", temperatura: 4,
  };

  function proponerDatosSalida() {
    // Campo a campo: una salida anterior sin ese dato (p. ej. de antes del
    // CMR) no lo deja vacío, se usa el del ejemplo.
    const ultima = App.state.albaranesHistorial[0] || {};
    const poner = (id, campo) => {
      const v = ultima[campo] ?? PROPUESTA_INICIAL[campo];
      App.$(id).value = v == null ? "" : String(v);
    };
    poner("salidaLugarCarga", "lugar_carga");
    poner("salidaMarcas", "marcas");
    poner("salidaEmbalaje", "embalaje");
    poner("salidaNaturaleza", "naturaleza");
    poner("salidaTemperatura", "temperatura");
    App.$("salidaPeso").dataset.manual = "";
  }

  // Los destinatarios de albaranes anteriores se proponen al escribir y,
  // al elegir uno, se rellenan sus datos con los del último albarán.
  function rellenarDestinatarios() {
    const nombres = [...new Set(App.state.albaranesHistorial.map((a) => a.destinatario_nombre).filter(Boolean))];
    App.$("listaDestinatarios").innerHTML = nombres
      .map((n) => `<option value="${App.escapar(n)}"></option>`).join("");
  }

  function autocompletarDestinatario() {
    const nombre = App.$("salidaDestNombre").value.trim().toLowerCase();
    const previo = App.state.albaranesHistorial
      .find((a) => String(a.destinatario_nombre || "").trim().toLowerCase() === nombre);
    if (!previo) return;
    const poner = (id, v) => { if (!App.$(id).value) App.$(id).value = v || ""; };
    poner("salidaDestNif", previo.destinatario_nif);
    poner("salidaDestDireccion", previo.destinatario_direccion);
    poner("salidaLugarEntrega", previo.lugar_entrega);
    poner("salidaMatricula", previo.matricula);
    poner("salidaMatriculaRemolque", previo.matricula_remolque);
    poner("salidaTransportista", previo.transportista);
  }

  function paletsDeLaSalida() {
    return Array.from(document.querySelectorAll(".check-salida:checked"));
  }

  function actualizarResumenSalida() {
    const checks = paletsDeLaSalida();
    const cajas = checks.reduce((s, c) => s + App.num(c.dataset.cajas), 0);
    App.$("salidaResumen").textContent =
      `${checks.length} ${checks.length === 1 ? "palet" : "palets"} · ${App.fmtNum(cajas)} cajas`;

    // Peso bruto propuesto, salvo que ya se haya escrito a mano.
    const peso = App.$("salidaPeso");
    if (!peso.dataset.manual) {
      peso.value = cajas > 0 ? String(App.redondear(cajas * App.paramNum("peso_bruto_caja_kg"))) : "";
    }
  }

  let guardandoSalida = false;

  async function guardarSalida(e) {
    e.preventDefault();
    if (guardandoSalida) return;

    const fecha = App.$("salidaFecha").value;
    if (!fecha || App.esFechaFutura(fecha)) {
      App.toast("Indica la fecha de salida (no puede ser futura).");
      return;
    }
    const nombre = App.$("salidaDestNombre").value.trim();
    if (!nombre) {
      App.toast("Indica el destinatario.");
      return;
    }
    const checks = paletsDeLaSalida();
    if (checks.length === 0) {
      App.toast("Marca los palets que salen.");
      return;
    }
    const incompletos = checks.filter((c) => App.estadoPalet(
      App.state.paletsCamara.find((p) => String(p.id) === c.dataset.palet) || {}) === "formacion");
    if (incompletos.length &&
        !confirm(`${incompletos.length === 1 ? "Un palet no está completo" : `${incompletos.length} palets no están completos`}. ¿Darles salida igualmente?`)) {
      return;
    }

    guardandoSalida = true;
    try {
      const { data: id, error } = await App.db.rpc("albaran_crear", {
        p_datos: {
          fecha,
          destinatario_nombre: nombre,
          destinatario_nif: App.$("salidaDestNif").value,
          destinatario_direccion: App.$("salidaDestDireccion").value,
          matricula: App.$("salidaMatricula").value,
          matricula_remolque: App.$("salidaMatriculaRemolque").value,
          transportista: App.$("salidaTransportista").value,
          observaciones: App.$("salidaObservaciones").value,
          lugar_entrega: App.$("salidaLugarEntrega").value,
          lugar_carga: App.$("salidaLugarCarga").value,
          documentos_anexos: App.$("salidaDocumentos").value,
          marcas: App.$("salidaMarcas").value,
          embalaje: App.$("salidaEmbalaje").value,
          naturaleza: App.$("salidaNaturaleza").value,
          peso_bruto_kg: App.$("salidaPeso").value,
          temperatura: App.$("salidaTemperatura").value,
        },
        p_palets: checks.map((c) => parseInt(c.dataset.palet, 10)),
      });
      if (error) {
        App.toast("Error: " + error.message);
        return;
      }

      App.cerrarModal(App.dom.modalSalida);
      App.toast("Salida registrada");
      await App.refrescarPalets();
      await imprimirSalida(id);
    } finally {
      guardandoSalida = false;
    }
  }

  // ------------------------------------------------------------------
  //  Documentos impresos: CMR y albarán
  // ------------------------------------------------------------------
  async function cargarSalida(id) {
    const data = await App.consultar(
      App.db.from("albaranes_salida")
        .select("*, palets(id,codigo,num_cajas,fecha_completo,secuencia,palet_lineas(agricultor_id,num_cajas,registros(fecha)))")
        .eq("id", id),
      "el albarán"
    );
    if (!data || !data.length) return null;
    const alb = data[0];
    return data[0];
  }

  // La copia de la salida (js/documentos-salida.js). La primera vez que se
  // imprime se hace con los datos de ahora y se guarda; desde entonces las
  // reimpresiones y el QR salen siempre de esa misma copia. Si no se puede
  // guardar, se imprime igual (el QR mostraría «no disponible» hasta que
  // se vuelva a imprimir).
  //
  // Como la copia ya no se puede cambiar, antes de hacerla se comprueba que
  // están los datos reales: sin los ajustes (emisor, remitente, porteador)
  // o sin algún agricultor, se congelaría un CMR en blanco. En ese caso no
  // se imprime (el papel saldría igual de vacío) y se avisa.
  async function copiaDeSalida(alb) {
    if (alb.copia) return alb.copia;

    if (!(await App.asegurarParametros())) return null;

    const faltan = () => (alb.palets || [])
      .flatMap((p) => p.palet_lineas || [])
      .some((l) => !App.agricultorPorId(l.agricultor_id));
    if (faltan()) {
      await App.asegurarAgricultoresTodos(true);
      if (faltan()) {
        App.toast("No se han podido cargar los datos de los agricultores de esta salida. Comprueba la conexión y vuelve a imprimir.");
        return null;
      }
    }

    const copia = App.construirCopia(alb, {
      emisor: App.datosEmisor(),
      agricultorPorId: App.agricultorPorId,
      param: App.param,
    });
    const { error } = await App.db.from("albaranes_salida")
      .update({ copia }).eq("id", alb.id).is("copia", null);
    if (error) App.toast("No se ha guardado la copia digital del QR: " + error.message);
    return copia;
  }

  // que: { cmr, albaran }. Al dar salida se imprimen los dos en un solo
  // trabajo: los tres ejemplares del CMR y después el albarán.
  async function imprimirSalida(id, { cmr = true, albaran = true } = {}) {
    const alb = await cargarSalida(id);
    if (!alb) return;
    const copia = await copiaDeSalida(alb);
    if (!copia) return;
    // "Porte de salida ALB-0001 2026-10-20" (o "Albarán de salida ..." si
    // solo va el albarán).
    const nombre = `${cmr ? "Porte de salida" : "Albarán de salida"} ${alb.numero || ""} ${alb.fecha || ""}`;
    App.imprimirDocumento(App.htmlSalida(copia, {
      ejemplares: cmr ? App.EJEMPLARES_CMR : [],
      albaran,
      url: App.urlCopia(copia.albaran.token, window.location.href),
    }), nombre);
  }

  // ------------------------------------------------------------------
  //  Acciones del listado
  // ------------------------------------------------------------------
  async function clickAlbaranes(e) {
    const imprimir = e.target.closest("[data-imprimir-alb]");
    const cmr = e.target.closest("[data-imprimir-cmr]");
    const anular = e.target.closest("[data-anular-alb]");

    if (imprimir) {
      await imprimirSalida(imprimir.dataset.imprimirAlb, { cmr: false });
      return;
    }
    if (cmr) {
      await imprimirSalida(cmr.dataset.imprimirCmr, { albaran: false });
      return;
    }
    if (anular) {
      const a = App.state.albaranesActuales.find((x) => String(x.id) === anular.dataset.anularAlb);
      if (!a) return;
      if (!confirm(`¿Anular el albarán ${a.numero}?\n\nSus ${App.fmtNum((a.palets || []).length)} palets vuelven a la cámara sin salida. Esta acción no se puede deshacer.`)) return;
      const { error } = await App.db.rpc("albaran_anular", { p_id: a.id });
      if (error) {
        App.toast("Error: " + error.message);
        return;
      }
      App.toast(`Albarán ${a.numero} anulado`);
      await cargarAlbaranes();
      await App.refrescarPalets();
    }
  }

  // Exporta todos los que cumplen los filtros, no solo la página.
  async function exportarAlbaranes() {
    const todos = await App.consultar(App.traerTodo(() => consultaAlbaranes()), "los albaranes");
    if (todos === null) return;
    const filas = todos.map((a) => ({
      "Albarán": a.numero || "",
      "Fecha": a.fecha || "",
      "Destinatario": a.destinatario_nombre || "",
      "NIF": a.destinatario_nif || "",
      "Matrícula": [a.matricula, a.matricula_remolque].filter(Boolean).join(" / "),
      "Transportista": a.transportista || "",
      "Palets": (a.palets || []).length,
      "Cajas": (a.palets || []).reduce((s, p) => s + App.num(p.num_cajas), 0),
    }));
    if (filas.length === 0) {
      App.toast("No hay albaranes que exportar.");
      return;
    }
    App.descargarLibro(filas, "Salidas", "Salidas");
    App.toast("Excel exportado");
  }

  // ------------------------------------------------------------------
  //  Eventos
  // ------------------------------------------------------------------
  function configurarEventosSalidas() {
    App.$("btnSalidas").addEventListener("click", abrirModalSalidas);
    App.$("btnNuevaSalida").addEventListener("click", () => abrirModalSalida());
    App.$("cuerpoAlbaranes").addEventListener("click", clickAlbaranes);
    App.$("btnExportSalidas").addEventListener("click", exportarAlbaranes);
    ["filtroDesdeSalidas", "filtroHastaSalidas"].forEach((id) =>
      App.$(id).addEventListener("change", filtrarAlbaranes));
    let esperaDestino;
    App.$("filtroDestinoSalidas").addEventListener("input", () => {
      clearTimeout(esperaDestino);
      esperaDestino = setTimeout(filtrarAlbaranes, 300);
    });
    paginador().conectar();

    App.dom.formSalida.addEventListener("submit", guardarSalida);
    App.$("salidaPalets").addEventListener("change", actualizarResumenSalida);
    App.$("salidaDestNombre").addEventListener("change", autocompletarDestinatario);
    App.$("salidaPeso").addEventListener("input", () => { App.$("salidaPeso").dataset.manual = "1"; });
  }

  Object.assign(App, {
    salidasAbierto,
    cargarAlbaranes,
    abrirModalSalida,
    imprimirSalida,
    configurarEventosSalidas,
  });
})(window.App);
