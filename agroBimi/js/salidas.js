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
//  lleva, sus cajas y la fecha de entrada de cada pesada.
//
//  Anular un albarán devuelve sus palets a la cámara.
// =====================================================================

(function initSalidasModule(App) {
  // ------------------------------------------------------------------
  //  Listado de albaranes
  // ------------------------------------------------------------------
  async function abrirModalSalidas() {
    await App.asegurarAgricultoresTodos();
    App.abrirModal(App.dom.modalSalidas);
    await cargarAlbaranes();
  }

  function salidasAbierto() {
    return App.dom.modalSalidas.classList.contains("open");
  }

  async function cargarAlbaranes() {
    const cuerpo = App.$("cuerpoAlbaranes");
    cuerpo.innerHTML = App.spinnerFila(7, "Cargando albaranes...");

    const data = await App.consultar(
      App.traerTodo(() => App.db.from("albaranes_salida")
        .select("*, palets(id,num_cajas)")
        .order("secuencia", { ascending: false, nullsFirst: false })
        .order("id")),
      "los albaranes"
    );
    if (data === null) {
      cuerpo.innerHTML = App.filaMensaje(7, "No se pudieron cargar los albaranes.", "error");
      return;
    }
    App.state.albaranesActuales = data;
    pintarAlbaranes();
  }

  function albaranesFiltrados() {
    const desde = App.$("filtroDesdeSalidas").value;
    const hasta = App.$("filtroHastaSalidas").value;
    const texto = App.$("filtroDestinoSalidas").value.trim().toLowerCase();
    return App.state.albaranesActuales.filter((a) => {
      if ((desde || hasta) && !App.fechaEnRango(a.fecha, desde, hasta)) return false;
      if (texto && !String(a.destinatario_nombre || "").toLowerCase().includes(texto)) return false;
      return true;
    });
  }

  function pintarAlbaranes() {
    const albaranes = albaranesFiltrados();
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
    App.actualizarContador("countAlbaranes", albaranes.length, "albarán", "albaranes");
  }

  // ------------------------------------------------------------------
  //  Nueva salida
  // ------------------------------------------------------------------
  // idsMarcados: palets ya elegidos en Paletización. Si no viene ninguno
  // se proponen todos los palets completos.
  async function abrirModalSalida(idsMarcados = []) {
    await App.asegurarAgricultoresTodos();
    if (!(await App.cargarDatosPaletizado())) return;
    if (App.state.albaranesActuales.length === 0 && !(await cargarAlbaranesSilencioso())) return;

    App.dom.formSalida.reset();
    App.$("salidaFecha").value = App.hoyISO();
    rellenarDestinatarios();
    proponerDatosSalida();

    const marcados = new Set(idsMarcados.map(String));
    const disponibles = App.state.paletsActuales
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

  async function cargarAlbaranesSilencioso() {
    const { data, error } = await App.traerTodo(() => App.db.from("albaranes_salida")
      .select("*, palets(id,num_cajas)")
      .order("secuencia", { ascending: false, nullsFirst: false })
      .order("id"));
    if (error) {
      App.toast(`Error al cargar los albaranes anteriores: ${error.message}`);
      return false;
    }
    App.state.albaranesActuales = data || [];
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
    const ultima = App.state.albaranesActuales[0] || {};
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
    const nombres = [...new Set(App.state.albaranesActuales.map((a) => a.destinatario_nombre).filter(Boolean))];
    App.$("listaDestinatarios").innerHTML = nombres
      .map((n) => `<option value="${App.escapar(n)}"></option>`).join("");
  }

  function autocompletarDestinatario() {
    const nombre = App.$("salidaDestNombre").value.trim().toLowerCase();
    const previo = App.state.albaranesActuales
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
      App.state.paletsActuales.find((p) => String(p.id) === c.dataset.palet) || {}) === "formacion");
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
      if (!salidasAbierto()) await cargarAlbaranesSilencioso();
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
    alb.palets = [...(alb.palets || [])].sort((a, b) => App.num(a.secuencia) - App.num(b.secuencia));
    alb.totalCajas = alb.palets.reduce((s, p) => s + App.num(p.num_cajas), 0);
    return alb;
  }

  const esc = (v) => App.escapar(v == null ? "" : String(v));
  const matriculas = (alb) => [alb.matricula, alb.matricula_remolque].filter(Boolean).join(" / ");

  // Peso como en el CMR en papel: «2.775 kg».
  function fmtPeso(kg) {
    if (kg == null || kg === "") return "";
    const n = App.num(kg);
    return `${App.fmtNum(n, Number.isInteger(n) ? 0 : 2)} kg`;
  }

  function htmlAlbaran(alb) {
    const e = App.datosEmisor();
    const palets = alb.palets;

    // Detalle: una fila por agricultor y pesada de cada palet.
    const detalle = palets.map((p) => {
      const ls = [...(p.palet_lineas || [])]
        .sort((x, y) => String(x.registros?.fecha || "").localeCompare(String(y.registros?.fecha || "")));
      return ls.map((l, i) => {
        const a = App.agricultorPorId(l.agricultor_id) || {};
        return `
          <tr>
            ${i === 0 ? `<td rowspan="${ls.length}" class="alb-palet"><b>${esc(p.codigo)}</b><br>${App.fmtNum(p.num_cajas)} cajas</td>` : ""}
            <td>${esc(a.nombre)}</td>
            <td>${l.registros?.fecha ? App.formatearFecha(l.registros.fecha) : "—"}</td>
            <td class="der">${App.fmtNum(l.num_cajas)}</td>
          </tr>`;
      }).join("");
    }).join("");

    // Resumen por agricultor.
    const porAgri = {};
    palets.forEach((p) => (p.palet_lineas || []).forEach((l) => {
      porAgri[l.agricultor_id] = (porAgri[l.agricultor_id] || 0) + App.num(l.num_cajas);
    }));
    const resumen = Object.entries(porAgri)
      .map(([idAgri, cajas]) => ({ a: App.agricultorPorId(idAgri) || {}, cajas }))
      .sort((x, y) => String(x.a.nombre || "").localeCompare(String(y.a.nombre || ""), "es"))
      .map(({ a, cajas }) => `
        <tr>
          <td>${esc(a.nombre)}</td>
          <td>${esc(a.nif)}</td>
          <td class="der">${App.fmtNum(cajas)}</td>
        </tr>`).join("");

    const lineaEmisor = [e.direccion, e.codigo_postal ? `CP: ${e.codigo_postal}` : ""].filter(Boolean).join(" - ");
    const lugarEmisor = [e.poblacion, e.provincia ? `(${e.provincia})` : ""].filter(Boolean).join(" ");

    return `
      <div class="rec alb">
        <div class="rec-cab">
          <div class="rec-emisor">
            <b>${esc(e.nombre)}</b>
            ${e.nif ? `<div>CIF: ${esc(e.nif)}</div>` : ""}
            ${lineaEmisor ? `<div>${esc(lineaEmisor)}</div>` : ""}
            ${lugarEmisor ? `<div>${esc(lugarEmisor)}</div>` : ""}
            ${e.registro ? `<div>Reg. establecimiento: ${esc(e.registro)}</div>` : ""}
          </div>
          <table class="rec-tabla alb-doc">
            <tr><th>DOCUMENTO</th><th>NÚMERO</th><th>FECHA</th></tr>
            <tr><td>ALBARÁN DE SALIDA</td><td><b>${esc(alb.numero)}</b></td><td>${App.formatearFecha(alb.fecha)}</td></tr>
          </table>
        </div>

        <div class="rec-fila">
          <div class="rec-agricultor alb-caja">
            <div class="alb-etiqueta">Destinatario</div>
            <b>${esc(alb.destinatario_nombre)}</b>
            ${alb.destinatario_nif ? `<div>CIF: ${esc(alb.destinatario_nif)}</div>` : ""}
            ${alb.destinatario_direccion ? `<div class="alb-multilinea">${esc(alb.destinatario_direccion)}</div>` : ""}
          </div>
          <div class="rec-agricultor alb-caja">
            <div class="alb-etiqueta">Transporte</div>
            <div>Matrícula: <b>${esc(matriculas(alb)) || "—"}</b></div>
            <div>Transportista: <b>${esc(alb.transportista) || "—"}</b></div>
            <div>Palets: <b>${App.fmtNum(palets.length)}</b> · Cajas: <b>${App.fmtNum(alb.totalCajas)}</b></div>
          </div>
        </div>

        <table class="rec-tabla alb-detalle">
          <thead>
            <tr><th>PALET</th><th>PROVEEDOR</th><th>FECHA ENTRADA</th><th class="der">CAJAS</th></tr>
          </thead>
          <tbody>${detalle}</tbody>
          <tfoot>
            <tr><th colspan="3" class="der">TOTAL</th><th class="der">${App.fmtNum(alb.totalCajas)}</th></tr>
          </tfoot>
        </table>

        <h3 class="alb-subtitulo">Resumen por proveedor</h3>
        <table class="rec-tabla alb-resumen">
          <thead><tr><th>PROVEEDOR</th><th>NIF</th><th class="der">CAJAS</th></tr></thead>
          <tbody>${resumen}</tbody>
        </table>

        ${alb.observaciones ? `<div class="rec-obs"><b>Observaciones:</b> ${esc(alb.observaciones)}</div>` : ""}

        <div class="alb-firmas">
          <div>Expedidor</div>
          <div>Transportista</div>
          <div>Destinatario</div>
        </div>
      </div>`;
  }

  // Carta de porte internacional (CMR): misma disposición y casillas que el
  // impreso del cliente. Lo fijo (remitente, porteador) sale de Ajustes; lo
  // que en papel va a bolígrafo, de la salida.
  const EJEMPLARES_CMR = [
    ["1", "Ejemplar para el REMITENTE", "Copy for SENDER"],
    ["2", "Ejemplar para el DESTINATARIO", "Copy for CONSIGNEE"],
    ["3", "Ejemplar para el PORTEADOR", "Copy for CARRIER"],
  ];

  function casilla(num, etiqueta, contenido = "", clase = "") {
    return `
      <div class="cmr-c ${clase}">
        <div class="cmr-l">${num ? `<b>${num}</b> ` : ""}${etiqueta}</div>
        <div class="cmr-v">${contenido}</div>
      </div>`;
  }

  function htmlCmr(alb, [numEjemplar, ejemplar, copia]) {
    const remitente = esc(App.param("cmr_remitente"));
    const porteador = esc(App.param("cmr_porteador"));
    const nPalets = alb.palets.length;
    const destinatario = [
      alb.destinatario_nombre,
      alb.destinatario_nif ? `CIF: ${alb.destinatario_nif}` : "",
      alb.destinatario_direccion,
    ].filter(Boolean).map(esc).join("\n");
    const temperatura = alb.temperatura == null ? "&nbsp;&nbsp;&nbsp;&nbsp;" : esc(App.fmtNum(App.num(alb.temperatura), Number.isInteger(App.num(alb.temperatura)) ? 0 : 1));

    return `
      <div class="cmr">
        <div class="cmr-cab">
          <div class="cmr-ejemplar"><span>${numEjemplar}</span><div>${ejemplar}<br>${copia}</div></div>
          <div class="cmr-tipo"><span class="cmr-check">X</span><span class="cmr-sello">CMR</span>
            <span class="cmr-check"></span><b>CARTA DE PORTE NACIONAL</b></div>
        </div>

        <div class="cmr-fila">
          ${casilla(1, "Remitente (nombre, dirección, país) / Sender (name, address, country)",
            `<div class="cmr-fijo">${remitente}</div>`, "cmr-a")}
          <div class="cmr-c cmr-a cmr-titulo">
            <div class="cmr-titulo-cab">
              <b>CARTA DE PORTE INTERNACIONAL<br>INTERNATIONAL CONSIGNMENT NOTE</b>
              <span class="cmr-sello">CMR</span>
            </div>
            <p>Este transporte queda sometido, no obstante toda cláusula contraria, al Convenio sobre
              el Contrato de Transporte Internacional de Mercancías por Carretera (CMR).</p>
            <p>This carriage is subject, notwithstanding any clause to the contrary, to the Convention
              on the Contract for the international Carriage of Goods by Road (CMR).</p>
          </div>
        </div>

        <div class="cmr-fila">
          ${casilla(2, "Destinatario (nombre, dirección, país) / Consignee (name, address, country)",
            `<div class="cmr-dato">${destinatario}</div>`, "cmr-b")}
          ${casilla(16, "Porteador (nombre, dirección, país) / Carrier (name, address, country)",
            `<div class="cmr-porteador"><div class="cmr-fijo cmr-peq">${porteador}</div>
              <div class="cmr-dato cmr-matriculas">${[alb.matricula, alb.matricula_remolque].filter(Boolean).map(esc).join("\n")}</div></div>`,
            "cmr-b")}
        </div>

        <div class="cmr-fila">
          ${casilla(3, "Lugar de entrega de la mercancía / Place of delivery of the goods",
            `<div class="cmr-dato">${esc(alb.lugar_entrega)}</div>`, "cmr-c3")}
          ${casilla(17, "Porteadores sucesivos / Successive Carriers", "", "cmr-c3")}
        </div>

        <div class="cmr-fila">
          <div class="cmr-col">
            ${casilla(4, "Lugar de carga de la mercancía / Loading place of the goods",
              `<div class="cmr-dato cmr-centro">${esc(alb.lugar_carga)}</div>`, "cmr-c4")}
            ${casilla(5, "Documentos anexos / Documents attached",
              `<div class="cmr-dato">${esc(alb.documentos_anexos)}</div>`, "cmr-c5")}
          </div>
          ${casilla(18, "Reservas y observaciones del porteador / Carrier's reservations and observations", "", "cmr-c18")}
        </div>

        <table class="cmr-mercancia">
          <thead>
            <tr>
              <th><b>6</b> Marca y números<br>Marks and numbers</th>
              <th><b>7</b> Número de bultos<br>Number of packages</th>
              <th><b>8</b> Modo de embalaje<br>Method of packing</th>
              <th><b>9</b> Naturaleza de la mercancía<br>Nature of the goods</th>
              <th><b>10</b> Nº estadístico<br>Statistical Nº</th>
              <th><b>11</b> Peso bruto, kg.<br>Gross weight, kg.</th>
              <th><b>12</b> Volumen m³<br>Volume in m³</th>
            </tr>
          </thead>
          <tbody>
            <tr class="cmr-mercancia-datos">
              <td>${esc(alb.marcas)}</td>
              <td>${App.fmtNum(alb.totalCajas)}</td>
              <td>${esc(alb.embalaje)}</td>
              <td>${esc(alb.naturaleza)}</td>
              <td></td>
              <td>${esc(fmtPeso(alb.peso_bruto_kg))}</td>
              <td>Total ${App.fmtNum(nPalets)} ${nPalets === 1 ? "palet" : "palets"}</td>
            </tr>
            <tr class="cmr-mercancia-palets">
              <td></td>
              <td colspan="5">${App.fmtNum(nPalets)}x ${esc(App.param("cmr_tipo_palet"))}</td>
              <td></td>
            </tr>
          </tbody>
        </table>

        <div class="cmr-fila">
          <div class="cmr-col">
            ${casilla(13, "Instrucciones del remitente / Sender's instructions",
              `<div class="cmr-fijo cmr-instrucciones">ORIGEN: ESPAÑA
SE DEBE MANTENER UNA TEMPERATURA CONSTANTE
EN FRIGORÍFICO DE <u class="cmr-dato">&nbsp;${temperatura}&nbsp;</u> ºC</div>`, "cmr-c13")}
            ${casilla(14, "Forma de pago / Instructions as to payment for carriage", "", "cmr-c14")}
          </div>
          <div class="cmr-col">
            ${casilla(19, "Estipulaciones particulares / Special agreements", "", "cmr-c19")}
            <table class="cmr-pagar">
              <tr><th><b>20</b> A pagar por:<br>To be paid by:</th><th>Remitente / Senders</th><th>Destinatario / Consignee</th></tr>
              ${["Precio del transporte:<br>Carriage charges:", "Descuentos:<br>Reductions:", "Neto:<br>Balance:",
                 "Suplementos:<br>Supplements charges:", "Otros cargos:<br>Other charges:", "Seguro:<br>Insurance:", "TOTAL:"]
                .map((t) => `<tr><td>${t}</td><td></td><td></td></tr>`).join("")}
            </table>
          </div>
        </div>

        <div class="cmr-fila">
          ${casilla(21, "", `<div class="cmr-formalizado"><span class="cmr-l">Formalizado en<br>Established in</span>
              <span class="cmr-dato">${esc(alb.lugar_carga)}</span>
              <span class="cmr-l">a<br>on</span>
              <span class="cmr-dato">${App.formatearFecha(alb.fecha)}</span></div>`, "cmr-c21")}
          ${casilla(15, "Reembolso a cobrar en destino / Cash on delivery", "", "cmr-c21")}
        </div>

        <div class="cmr-fila">
          ${casilla(22, "", `<div class="cmr-fijo cmr-centro">${remitente}</div>
            <div class="cmr-firma">Firma y sello del remitente<br>Signature and stamp of the sender</div>`, "cmr-firmas")}
          ${casilla(23, "", `<div class="cmr-fijo cmr-centro cmr-peq">${porteador}</div>
            <div class="cmr-firma">Firma y sello del porteador<br>Signature and stamp of the carrier</div>`, "cmr-firmas")}
          ${casilla(24, "Mercancías recibidas / Goods received", `
            <div class="cmr-recibidas"><span class="cmr-l">Lugar<br>Place</span><span class="cmr-l">a<br>on</span></div>
            <div class="cmr-firma">Firma y sello del destinatario<br>Signature and stamp of the consignee</div>`, "cmr-firmas")}
        </div>
      </div>`;
  }

  // que: { cmr, albaran }. Al dar salida se imprimen los dos en un solo
  // trabajo: los tres ejemplares del CMR y después el albarán.
  async function imprimirSalida(id, { cmr = true, albaran = true } = {}) {
    const alb = await cargarSalida(id);
    if (!alb) return;
    // "Porte de salida ALB-0001 2026-10-20" (o "Albarán de salida ..." si
    // solo va el albarán).
    const nombre = `${cmr ? "Porte de salida" : "Albarán de salida"} ${alb.numero || ""} ${alb.fecha || ""}`;
    App.imprimirDocumento([
      ...(cmr ? EJEMPLARES_CMR.map((ej) => htmlCmr(alb, ej)) : []),
      ...(albaran ? [htmlAlbaran(alb)] : []),
    ].join(""), nombre);
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

  function exportarAlbaranes() {
    const filas = albaranesFiltrados().map((a) => ({
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
      App.$(id).addEventListener("change", pintarAlbaranes));
    App.$("filtroDestinoSalidas").addEventListener("input", pintarAlbaranes);

    App.dom.formSalida.addEventListener("submit", guardarSalida);
    App.$("salidaPalets").addEventListener("change", actualizarResumenSalida);
    App.$("salidaDestNombre").addEventListener("change", autocompletarDestinatario);
    App.$("salidaPeso").addEventListener("input", () => { App.$("salidaPeso").dataset.manual = "1"; });
  }

  Object.assign(App, {
    salidasAbierto,
    cargarAlbaranes,
    abrirModalSalida,
    configurarEventosSalidas,
  });
})(window.App);
