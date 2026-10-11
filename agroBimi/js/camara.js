// =====================================================================
//  Cámara
//  ---------------------------------------------------------------------
//  Las cajas se GUARDAN en la cámara (tabla camara_entradas: es un paso
//  aparte de la báscula) y allí se agrupan en palets (js/palets.js). Un
//  palet sigue ocupando sitio hasta que se le da salida.
//
//      ocupación = cajas guardadas − cajas de palets ya salidos
//                = cajas sueltas + cajas en palets sin salida
//
//  El saldo por agricultor lo calcula la vista camara_saldos (schema.sql,
//  sección 8). La capacidad está en Ajustes (capacidad_camara).
// =====================================================================

(function initCamaraModule(App) {
  const LIMITE_ENTRADAS = 500;

  // ------------------------------------------------------------------
  //  Saldos (los usa también el formulario de palets)
  // ------------------------------------------------------------------
  function capacidadCamara() {
    return App.paramNum("capacidad_camara") || 22;
  }

  async function cargarSaldosCamara() {
    const [saldos, palets] = await Promise.all([
      App.db.from("camara_saldos").select("*"),
      App.db.from("palets").select("id", { count: "exact", head: true }).is("fecha_salida", null),
    ]);
    const error = saldos.error || palets.error;
    if (error) {
      App.toast("Error al cargar la cámara: " + error.message);
      return false;
    }
    App.state.camaraSaldos = saldos.data || [];
    App.state.camaraPaletsDentro = palets.count || 0;
    return true;
  }

  function saldoCamara(agricultorId) {
    return App.state.camaraSaldos.find((s) => String(s.agricultor_id) === String(agricultorId)) ||
      { agricultor_id: agricultorId, guardadas: 0, paletizadas: 0, en_palets: 0, sueltas: 0 };
  }

  function ocupacionCamara() {
    return App.state.camaraSaldos.reduce((s, x) => s + App.num(x.sueltas) + App.num(x.en_palets), 0);
  }

  function textoHueco(ocupadas = ocupacionCamara()) {
    const cap = capacidadCamara();
    const libres = cap - ocupadas;
    if (libres > 0) return `En la cámara hay ${App.fmtNum(ocupadas)} de ${App.fmtNum(cap)} cajas: quedan ${App.fmtNum(libres)} libres.`;
    if (libres === 0) return `La cámara está llena (${App.fmtNum(cap)} cajas).`;
    return `La cámara está ${App.fmtNum(-libres)} cajas por encima de su capacidad (${App.fmtNum(cap)}).`;
  }

  // ------------------------------------------------------------------
  //  Modal de la cámara
  // ------------------------------------------------------------------
  async function abrirModalCamara() {
    await App.asegurarAgricultoresTodos();
    App.abrirModal(App.dom.modalCamara);
    await recargarCamara();
  }

  function camaraAbierta() {
    return App.dom.modalCamara.classList.contains("open");
  }

  // Tras guardar cajas, paletizar o dar salida, para que la cámara (si
  // está abierta) refleje el cambio.
  async function recargarCamara() {
    App.$("cuerpoCamara").innerHTML = App.spinnerFila(4, "Calculando la cámara...");
    if (await cargarSaldosCamara()) pintarCamara();
    else App.$("cuerpoCamara").innerHTML = App.filaMensaje(4, "No se pudo cargar la cámara.", "error");
    await cargarEntradas();
  }

  function pintarCamara() {
    const cap = capacidadCamara();
    const ocupadas = ocupacionCamara();
    const pct = cap > 0 ? (ocupadas / cap) * 100 : 0;

    App.$("camaraOcupadas").textContent = App.fmtNum(ocupadas);
    App.$("camaraCapacidad").textContent = App.fmtNum(cap);
    App.$("camaraBarra").style.width = `${Math.min(100, pct)}%`;
    const barra = App.$("camaraBarraWrap");
    barra.setAttribute("aria-valuemax", String(cap));
    barra.setAttribute("aria-valuenow", String(ocupadas));

    const caja = App.$("camaraOcupacion");
    caja.classList.toggle("casi-llena", pct >= 80 && pct < 100);
    caja.classList.toggle("llena", pct >= 100);
    const libres = cap - ocupadas;
    App.$("camaraLibres").textContent = libres > 0
      ? `${App.fmtNum(libres)} libres`
      : libres === 0 ? "Llena" : `${App.fmtNum(-libres)} por encima`;

    const saldos = App.state.camaraSaldos;
    App.$("camaraSueltas").textContent = App.fmtNum(saldos.reduce((s, x) => s + App.num(x.sueltas), 0));
    App.$("camaraEnPalets").textContent = App.fmtNum(saldos.reduce((s, x) => s + App.num(x.en_palets), 0));
    App.$("camaraPalets").textContent = App.fmtNum(App.state.camaraPaletsDentro);

    const filas = saldos
      .map((x) => ({ ...x, total: App.num(x.sueltas) + App.num(x.en_palets) }))
      .filter((x) => x.total > 0)
      .sort((a, b) => b.total - a.total);

    App.$("cuerpoCamara").innerHTML = filas.length === 0
      ? App.filaMensaje(4, "La cámara está vacía.")
      : filas.map((x) => `
        <tr>
          <td>${App.etiquetaAgricultor(App.agricultorPorId(x.agricultor_id))}</td>
          <td class="col-num">${App.fmtNum(x.sueltas)}</td>
          <td class="col-num">${App.fmtNum(x.en_palets)}</td>
          <td class="col-num"><b>${App.fmtNum(x.total)}</b></td>
        </tr>`).join("");
  }

  // ------------------------------------------------------------------
  //  Entradas en cámara (listado)
  // ------------------------------------------------------------------
  async function cargarEntradas() {
    const cuerpo = App.$("cuerpoCamaraEntradas");
    cuerpo.innerHTML = App.spinnerFila(6, "Cargando entradas...");

    const agri = App.$("filtroAgriCamara").value;
    const desde = App.$("filtroDesdeCamara").value;
    const hasta = App.$("filtroHastaCamara").value;

    let consulta = App.db.from("camara_entradas").select("*")
      .order("fecha", { ascending: false })
      .order("id", { ascending: false })
      .limit(LIMITE_ENTRADAS);
    if (agri) consulta = consulta.eq("agricultor_id", agri);
    if (desde) consulta = consulta.gte("fecha", desde);
    if (hasta) consulta = consulta.lte("fecha", hasta);

    const data = await App.consultar(consulta, "las entradas en cámara");
    if (data === null) {
      cuerpo.innerHTML = App.filaMensaje(6, "No se pudieron cargar las entradas.", "error");
      return;
    }
    App.state.camaraEntradas = data;
    pintarEntradas();
  }

  function pintarEntradas() {
    const entradas = App.state.camaraEntradas;
    App.$("btnExportCamara").disabled = entradas.length === 0;
    App.$("cuerpoCamaraEntradas").innerHTML = entradas.length === 0
      ? App.filaMensaje(6, "No hay entradas en cámara con esos filtros.")
      : entradas.map((e) => `
        <tr>
          <td>${App.formatearFecha(e.fecha)}</td>
          <td>${App.etiquetaAgricultor(App.agricultorPorId(e.agricultor_id))}</td>
          <td>${App.valor(App.campanaNombre(e.campana_id))}</td>
          <td class="col-num"><b>${App.fmtNum(e.num_cajas)}</b></td>
          <td class="col-coment">${App.valor(e.comentarios)}</td>
          <td class="col-acciones">
            <button class="btn-edit btn-sm" data-edit-entrada="${e.id}">Editar</button>
            <button class="btn-del btn-sm" data-del-entrada="${e.id}">Eliminar</button>
          </td>
        </tr>`).join("");

    const n = entradas.length;
    App.$("countCamaraEntradas").textContent = n >= LIMITE_ENTRADAS
      ? `Últimas ${LIMITE_ENTRADAS} entradas (filtra por fechas para ver otras)`
      : `${n} ${n === 1 ? "entrada" : "entradas"}`;
  }

  // ------------------------------------------------------------------
  //  Guardar / editar una entrada en cámara
  // ------------------------------------------------------------------
  function campanaMasReciente() {
    const ids = App.state.campanasActuales.map((c) => c.id);
    return ids.length ? String(Math.max(...ids)) : "";
  }

  function abrirModalEntrada(entrada = null) {
    App.dom.formCamaraEntrada.reset();
    App.$("camaraHueco").textContent = textoHueco();

    if (entrada) {
      App.$("modalCamaraEntradaTitulo").textContent = "Editar entrada en cámara";
      App.$("camaraEntradaId").value = entrada.id;
      App.$("camaraAgricultor").value = entrada.agricultor_id ?? "";
      App.$("camaraCampana").value = entrada.campana_id ?? "";
      App.$("camaraFecha").value = entrada.fecha ?? "";
      App.$("camaraCajas").value = entrada.num_cajas ?? "";
      App.$("camaraComentarios").value = entrada.comentarios ?? "";
    } else {
      App.$("modalCamaraEntradaTitulo").textContent = "Guardar en cámara";
      App.$("camaraEntradaId").value = "";
      App.$("camaraAgricultor").value = App.$("filtroAgriCamara").value || "";
      App.$("camaraCampana").value = campanaMasReciente();
      App.$("camaraFecha").value = App.hoyISO();
    }
    App.abrirModal(App.dom.modalCamaraEntrada);
  }

  // Quitar cajas de la cámara (editar a la baja o borrar una entrada) no
  // puede dejar al agricultor con más cajas paletizadas que guardadas.
  function puedeQuitar(agricultorId, cajas) {
    const sueltas = App.num(saldoCamara(agricultorId).sueltas);
    if (cajas <= sueltas) return true;
    App.toast(`Ese agricultor solo tiene ${App.fmtNum(sueltas)} cajas sueltas: el resto ya está en palets. Corrige antes los palets.`);
    return false;
  }

  async function guardarEntrada(e) {
    e.preventDefault();

    const agricultorId = App.$("camaraAgricultor").value;
    if (!agricultorId) {
      App.toast("Elige el agricultor.");
      return;
    }
    const fecha = App.$("camaraFecha").value;
    if (!fecha) {
      App.toast("La fecha es obligatoria.");
      return;
    }
    if (App.esFechaFutura(fecha)) {
      App.toast("La fecha no puede ser futura.");
      return;
    }
    const cajas = parseInt(App.$("camaraCajas").value, 10);
    if (!Number.isFinite(cajas) || cajas <= 0) {
      App.toast("Indica cuántas cajas se guardan.");
      return;
    }

    // Saldos al día antes de comprobar nada.
    if (!(await cargarSaldosCamara())) return;

    const id = App.$("camaraEntradaId").value;
    const anterior = id ? App.state.camaraEntradas.find((x) => String(x.id) === id) : null;

    if (anterior) {
      const mismoAgri = String(anterior.agricultor_id) === agricultorId;
      const quita = mismoAgri ? App.num(anterior.num_cajas) - cajas : App.num(anterior.num_cajas);
      if (quita > 0 && !puedeQuitar(anterior.agricultor_id, quita)) return;
    }

    const ocupadas = ocupacionCamara() - App.num(anterior?.num_cajas) + cajas;
    if (ocupadas > capacidadCamara() &&
        !confirm(`Con estas cajas la cámara tendría ${App.fmtNum(ocupadas)} de ${App.fmtNum(capacidadCamara())}: se pasa de su capacidad.\n¿Guardar de todas formas?`)) {
      return;
    }

    const campana = App.$("camaraCampana").value;
    const datos = {
      agricultor_id: parseInt(agricultorId, 10),
      campana_id: campana ? parseInt(campana, 10) : null,
      fecha,
      num_cajas: cajas,
      comentarios: App.$("camaraComentarios").value.trim() || null,
    };

    const { error } = id
      ? await App.db.from("camara_entradas").update(datos).eq("id", id)
      : await App.db.from("camara_entradas").insert(datos);
    if (error) {
      App.toast("Error: " + error.message);
      return;
    }

    App.cerrarModal(App.dom.modalCamaraEntrada);
    App.toast(id ? "Entrada actualizada" : `${App.fmtNum(cajas)} cajas guardadas en cámara`);
    if (camaraAbierta()) await recargarCamara();
  }

  async function clickEntradas(e) {
    const editar = e.target.closest("[data-edit-entrada]");
    const eliminar = e.target.closest("[data-del-entrada]");
    const entrada = (btn, campo) =>
      App.state.camaraEntradas.find((x) => String(x.id) === btn.dataset[campo]);

    if (editar) {
      const x = entrada(editar, "editEntrada");
      if (x) {
        await cargarSaldosCamara();
        abrirModalEntrada(x);
      }
      return;
    }

    if (eliminar) {
      const x = entrada(eliminar, "delEntrada");
      if (!x) return;
      if (!(await cargarSaldosCamara())) return;
      if (!puedeQuitar(x.agricultor_id, App.num(x.num_cajas))) return;
      if (!confirm(`¿Eliminar esta entrada de ${App.fmtNum(x.num_cajas)} cajas? Esta acción no se puede deshacer.`)) return;
      const { error } = await App.db.from("camara_entradas").delete().eq("id", x.id);
      if (error) {
        App.toast("Error: " + error.message);
        return;
      }
      App.toast("Entrada eliminada");
      await recargarCamara();
    }
  }

  // ------------------------------------------------------------------
  //  Export
  // ------------------------------------------------------------------
  function exportarCamara() {
    const filas = App.state.camaraEntradas.map((e) => {
      const a = App.agricultorPorId(e.agricultor_id) || {};
      const campana = App.campanaNombre(e.campana_id);
      return {
        "Fecha": e.fecha || "",
        "Código": App.fmtCodigo(a.codigo),
        "Agricultor": a.nombre || "",
        "Campaña": campana === "—" ? "" : campana,
        "Nº Cajas": App.num(e.num_cajas),
        "Comentarios": e.comentarios || "",
      };
    });
    if (filas.length === 0) {
      App.toast("No hay entradas que exportar.");
      return;
    }
    App.descargarLibro(filas, "Entradas en cámara", "bimi_camara.xlsx");
    App.toast("Excel exportado");
  }

  // ------------------------------------------------------------------
  //  Eventos
  // ------------------------------------------------------------------
  function configurarEventosCamara() {
    App.$("btnCajasCamara").addEventListener("click", abrirModalCamara);
    App.$("btnGuardarCamara").addEventListener("click", async () => {
      await cargarSaldosCamara();
      abrirModalEntrada();
    });
    App.$("btnPaletizar").addEventListener("click", () => App.abrirModalPalet());
    App.$("btnVerPaletsCamara").addEventListener("click", () =>
      App.abrirModalPalets({ estado: "camara" }));
    App.dom.formCamaraEntrada.addEventListener("submit", guardarEntrada);
    App.$("cuerpoCamaraEntradas").addEventListener("click", clickEntradas);
    App.$("btnExportCamara").addEventListener("click", exportarCamara);
    ["filtroAgriCamara", "filtroDesdeCamara", "filtroHastaCamara"].forEach((id) =>
      App.$(id).addEventListener("change", cargarEntradas));
  }

  Object.assign(App, {
    capacidadCamara,
    cargarSaldosCamara,
    saldoCamara,
    ocupacionCamara,
    textoHueco,
    campanaMasReciente,
    camaraAbierta,
    recargarCamara,
    abrirModalCamara,
    configurarEventosCamara,
  });
})(window.App);
