// =====================================================================
//  Retiradas de plantas y RENDIMIENTO
//  ---------------------------------------------------------------------
//  Cada agricultor retira plantas en cada ciclo (puede hacerlo en varias
//  veces: se suman). Con eso y las cajas de bimi que va metiendo se
//  calcula el rendimiento del ciclo:
//
//      rendimiento = cajas de bimi / plantas retiradas
//
//  Se muestra como resumen por ciclo en la ficha del agricultor.
// =====================================================================

(function initPlantasModule(App) {
  const SIN_CICLO = "(Sin ciclo)";
  const SIN_CAMPANA = "(Sin campaña)";

  // ------------------------------------------------------------------
  //  Agrupación: la base del cálculo
  // ------------------------------------------------------------------
  // Clave de agrupación de un ciclo concreto de un agricultor concreto:
  // agricultor + campaña + ciclo. Se normaliza el ciclo para que valores
  // antiguos escritos a mano ("Ciclo 2") caigan en el grupo correcto.
  function clave(agricultorId, campanaId, ciclo) {
    return `${agricultorId}|${campanaId ?? ""}|${App.cicloValido(ciclo)}`;
  }

  function grupoNuevo(agricultorId, campanaId, ciclo) {
    return {
      agricultor_id: Number(agricultorId),
      campana_id: campanaId ?? null,
      ciclo: App.cicloValido(ciclo),
      plantas: 0,
      cajas: 0,
      descuento: 0,
      primeraRetirada: null,
      ultimaRetirada: null,
      primeraEntrada: null,
      ultimaEntrada: null,
      numRetiradas: 0,
      numRegistros: 0,
    };
  }

  function minFecha(a, b) {
    if (!b) return a;
    return !a || b < a ? b : a;
  }

  function maxFecha(a, b) {
    if (!b) return a;
    return !a || b > a ? b : a;
  }

  // Cruza retiradas de plantas con registros de cajas y devuelve un grupo
  // por (agricultor, campaña, ciclo). Aparecen también los grupos que solo
  // tienen plantas (aún sin cajas) o solo cajas (falta anotar las plantas):
  // así se ve de un vistazo lo que falta por completar.
  function agruparRendimiento(retiradas, registros) {
    const grupos = new Map();

    const dame = (agricultorId, campanaId, ciclo) => {
      const k = clave(agricultorId, campanaId, ciclo);
      if (!grupos.has(k)) grupos.set(k, grupoNuevo(agricultorId, campanaId, ciclo));
      return grupos.get(k);
    };

    (retiradas || []).forEach((r) => {
      const g = dame(r.agricultor_id, r.campana_id, r.ciclo);
      g.plantas += App.num(r.num_plantas);
      g.numRetiradas += 1;
      g.primeraRetirada = minFecha(g.primeraRetirada, r.fecha);
      g.ultimaRetirada = maxFecha(g.ultimaRetirada, r.fecha);
    });

    (registros || []).forEach((r) => {
      // Un registro sin cajas ni fecha no aporta nada al rendimiento.
      if (!App.num(r.cajas_entradas) && !r.fecha) return;
      const g = dame(r.agricultor_id, r.campana_id, r.ciclo);
      g.cajas += App.num(r.cajas_entradas);
      g.descuento += App.num(r.descuento_cajas);
      g.numRegistros += 1;
      g.primeraEntrada = minFecha(g.primeraEntrada, r.fecha);
      g.ultimaEntrada = maxFecha(g.ultimaEntrada, r.fecha);
    });

    return Array.from(grupos.values()).map(calcularRendimiento);
  }

  // Añade al grupo las métricas derivadas. Sin plantas no hay rendimiento
  // posible: se deja en null para pintar "—" en vez de un 0 engañoso.
  function calcularRendimiento(g) {
    g.cajasNetas = g.cajas - g.descuento;
    g.rendimiento = g.plantas > 0 ? g.cajas / g.plantas : null;
    g.rendimientoNeto = g.plantas > 0 ? g.cajasNetas / g.plantas : null;
    g.plantasPorCaja = g.cajas > 0 ? g.plantas / g.cajas : null;
    g.dias = diasEntre(g.primeraRetirada, g.ultimaEntrada);
    return g;
  }

  function diasEntre(desde, hasta) {
    if (!desde || !hasta) return null;
    const ms = new Date(`${hasta}T00:00:00`) - new Date(`${desde}T00:00:00`);
    return Math.round(ms / 86400000);
  }

  function etiquetaCiclo(ciclo) {
    return ciclo ? `Ciclo ${ciclo}` : SIN_CICLO;
  }

  function etiquetaCampana(campanaId) {
    const nombre = App.campanaNombre(campanaId);
    return nombre === "—" ? SIN_CAMPANA : nombre;
  }

  // Ordena por agricultor, campaña y ciclo para que el informe se lea
  // igual siempre.
  function ordenarGrupos(grupos) {
    return grupos.sort((a, b) => {
      const na = App.agricultorPorId(a.agricultor_id);
      const nb = App.agricultorPorId(b.agricultor_id);
      const cmp = (na?.nombre || "").localeCompare(nb?.nombre || "", "es");
      if (cmp !== 0) return cmp;
      const camp = etiquetaCampana(a.campana_id).localeCompare(etiquetaCampana(b.campana_id), "es");
      if (camp !== 0) return camp;
      return (a.ciclo || "9").localeCompare(b.ciclo || "9");
    });
  }

  // ------------------------------------------------------------------
  //  Resumen por ciclo en la ficha del agricultor
  // ------------------------------------------------------------------
  async function cargarRetiradasAgricultor() {
    const agricultor = App.state.agricultorAbierto;
    if (!agricultor) return;

    const data = await App.consultar(
      App.traerTodo(() => App.db.from("retiradas_plantas").select("*")
        .eq("agricultor_id", agricultor.id)
        .order("fecha", { ascending: true })
        .order("id")),
      "las retiradas de plantas"
    );

    App.state.retiradasAgricultor = data || [];
    pintarResumenCiclos();
  }

  function pintarResumenCiclos() {
    const caja = App.$("resumenCiclos");
    if (!caja) return;

    const grupos = ordenarGrupos(
      agruparRendimiento(App.state.retiradasAgricultor, App.state.registrosActuales)
    );

    if (grupos.length === 0) {
      caja.innerHTML =
        '<p class="resumen-vacio">Todavía no hay plantas retiradas ni cajas registradas para calcular el rendimiento.</p>';
      return;
    }

    caja.innerHTML = grupos.map((g) => `
      <div class="ciclo-card">
        <div class="ciclo-card-cab">
          <b>${App.escapar(etiquetaCiclo(g.ciclo))}</b>
          <span>${App.escapar(etiquetaCampana(g.campana_id))}</span>
        </div>
        <div class="ciclo-card-datos">
          <div><span>Plantas</span><b>${App.fmtNum(g.plantas)}</b></div>
          <div><span>Cajas</span><b>${App.fmtNum(g.cajas)}</b></div>
          <div><span>Rendimiento</span><b class="destaca">${
            g.rendimiento === null ? "—" : `${App.fmtNum(g.rendimiento, 3)} cajas/planta`
          }</b></div>
          <div><span>Plantas por caja</span><b>${g.plantasPorCaja === null ? "—" : App.fmtNum(g.plantasPorCaja, 2)}</b></div>
          <div><span>1ª retirada</span><b>${App.formatearFecha(g.primeraRetirada)}</b></div>
          <div><span>Última entrada</span><b>${App.formatearFecha(g.ultimaEntrada)}</b></div>
          <div><span>Días de ciclo</span><b>${g.dias === null ? "—" : App.fmtNum(g.dias)}</b></div>
          <div><span>Cajas netas</span><b>${App.fmtNum(g.cajasNetas)}</b></div>
        </div>
      </div>`).join("");
  }

  // ------------------------------------------------------------------
  //  Listado de retiradas de plantas (CRUD)
  // ------------------------------------------------------------------
  async function abrirModalPlantas(agricultorId = null) {
    await App.asegurarAgricultoresTodos();
    App.$("filtroAgriPlantas").value = agricultorId ? String(agricultorId) : "";
    App.abrirModal(App.dom.modalPlantas);
    await cargarPlantas();
  }

  async function cargarPlantas() {
    const cuerpo = App.$("cuerpoPlantas");
    cuerpo.innerHTML = App.spinnerFila(8, "Cargando retiradas de plantas...");

    const data = await App.consultar(
      App.traerTodo(() => App.db.from("retiradas_plantas").select("*")
        .order("fecha", { ascending: false }).order("id")),
      "las retiradas de plantas"
    );

    if (data === null) {
      cuerpo.innerHTML = App.filaMensaje(8, "No se pudieron cargar las retiradas.", "error");
      return;
    }

    App.state.plantasActuales = data;
    pintarPlantas();
  }

  function plantasFiltradas() {
    const agri = App.$("filtroAgriPlantas").value;
    const campana = App.$("filtroCampanaPlantas").value;
    const ciclo = App.$("filtroCicloPlantas").value;

    return App.state.plantasActuales.filter((r) => {
      if (agri && String(r.agricultor_id) !== agri) return false;
      if (campana && String(r.campana_id ?? "") !== campana) return false;
      if (ciclo && App.cicloValido(r.ciclo) !== ciclo) return false;
      return true;
    });
  }

  function pintarPlantas() {
    const filas = plantasFiltradas();
    const cuerpo = App.$("cuerpoPlantas");
    const totalPlantas = filas.reduce((s, r) => s + App.num(r.num_plantas), 0);

    App.$("totalPlantasFiltro").textContent = App.fmtNum(totalPlantas);
    App.$("btnExportPlantas").disabled = filas.length === 0;

    cuerpo.innerHTML = filas.length === 0
      ? App.filaMensaje(8, "No hay retiradas de plantas con esos filtros.")
      : filas.map((r) => {
          const a = App.agricultorPorId(r.agricultor_id);
          return `
        <tr>
          <td>${App.formatearFecha(r.fecha)}</td>
          <td>${App.etiquetaAgricultor(a)}</td>
          <td>${App.escapar(etiquetaCampana(r.campana_id))}</td>
          <td>${App.escapar(etiquetaCiclo(App.cicloValido(r.ciclo)))}</td>
          <td class="col-num"><b>${App.fmtNum(r.num_plantas)}</b></td>
          <td>${App.valor(r.variedad)}</td>
          <td class="col-coment">${App.valor(r.comentarios)}</td>
          <td class="col-acciones">
            <button class="btn-edit btn-sm" data-edit-planta="${r.id}">Editar</button>
            <button class="btn-del btn-sm" data-del-planta="${r.id}">Eliminar</button>
          </td>
        </tr>`;
        }).join("");

    App.actualizarContador("countPlantas", filas.length, "retirada", "retiradas");
  }

  function abrirModalPlanta(retirada = null) {
    App.dom.formPlanta.reset();

    if (retirada) {
      App.$("modalPlantaTitulo").textContent = "Editar retirada de plantas";
      App.$("plantaId").value = retirada.id;
      App.$("plantaAgricultor").value = retirada.agricultor_id ?? "";
      App.ponerCampana(App.$("plantaCampana"), retirada.campana_id);
      App.$("plantaCiclo").value = App.cicloValido(retirada.ciclo) || "1";
      App.$("plantaFecha").value = retirada.fecha ?? "";
      App.$("plantaNumPlantas").value = retirada.num_plantas ?? "";
      App.$("plantaVariedad").value = retirada.variedad ?? "";
      App.$("plantaComentarios").value = retirada.comentarios ?? "";
    } else {
      App.$("modalPlantaTitulo").textContent = "Nueva retirada de plantas";
      App.$("plantaId").value = "";
      App.$("plantaFecha").value = App.hoyISO();
      // Si el listado está filtrado por un agricultor, lo damos por elegido.
      App.$("plantaAgricultor").value = App.$("filtroAgriPlantas").value || "";
      App.ponerCampana(App.$("plantaCampana"), App.$("filtroCampanaPlantas").value);
      App.$("plantaCiclo").value = App.$("filtroCicloPlantas").value || "1";
    }

    App.abrirModal(App.dom.modalPlanta);
  }

  // Evita guardar dos veces a la vez (doble clic, Enter + clic): el
  // segundo envío llegaba antes de cerrar el modal y duplicaba la retirada.
  let guardandoPlanta = false;

  async function guardarPlanta(e) {
    e.preventDefault();
    if (guardandoPlanta) return;

    const boton = App.dom.formPlanta.querySelector('button[type="submit"]');
    guardandoPlanta = true;
    boton.disabled = true;
    try {
      await guardarPlantaValidada();
    } finally {
      guardandoPlanta = false;
      boton.disabled = false;
    }
  }

  async function guardarPlantaValidada() {
    const agricultorId = App.$("plantaAgricultor").value;
    if (!agricultorId) {
      App.toast("Elige el agricultor que ha retirado las plantas.");
      return;
    }

    const fecha = App.$("plantaFecha").value;
    if (!fecha) {
      App.toast("La fecha de retirada es obligatoria.");
      return;
    }
    if (App.esFechaFutura(fecha)) {
      App.toast("La fecha de retirada no puede ser futura.");
      return;
    }

    const plantas = parseInt(App.$("plantaNumPlantas").value, 10);
    if (!Number.isFinite(plantas) || plantas <= 0) {
      App.toast("Indica cuántas plantas se han retirado.");
      return;
    }

    const campana = App.$("plantaCampana").value;
    if (!campana) {
      App.toast("Crea primero una campaña: ninguna retirada puede ir sin campaña.");
      return;
    }
    const fila = {
      agricultor_id: parseInt(agricultorId, 10),
      campana_id: parseInt(campana, 10),
      ciclo: App.$("plantaCiclo").value,
      fecha,
      num_plantas: plantas,
      variedad: App.$("plantaVariedad").value.trim() || null,
      comentarios: App.$("plantaComentarios").value.trim() || null,
    };

    const id = App.$("plantaId").value;
    const { error } = id
      ? await App.db.from("retiradas_plantas").update(fila).eq("id", id)
      : await App.db.from("retiradas_plantas").insert(fila);

    if (error) {
      App.toast("Error: " + error.message);
      return;
    }

    App.cerrarModal(App.dom.modalPlanta);
    App.toast(id ? "Retirada actualizada" : "Retirada anotada");
    await cargarPlantas();
    // La ficha abierta puede ser justo la de este agricultor: refrescamos
    // su resumen de rendimiento.
    if (App.state.agricultorAbierto) await cargarRetiradasAgricultor();
  }

  async function clickPlantas(e) {
    const editar = e.target.closest("[data-edit-planta]");
    const eliminar = e.target.closest("[data-del-planta]");

    if (editar) {
      const r = App.state.plantasActuales.find((x) => String(x.id) === editar.dataset.editPlanta);
      if (r) abrirModalPlanta(r);
      return;
    }

    if (eliminar) {
      if (!confirm("¿Eliminar esta retirada de plantas? Esta acción no se puede deshacer.")) return;

      const { error } = await App.db.from("retiradas_plantas").delete().eq("id", eliminar.dataset.delPlanta);
      if (error) {
        App.toast("Error: " + error.message);
        return;
      }

      App.toast("Retirada eliminada");
      await cargarPlantas();
      if (App.state.agricultorAbierto) await cargarRetiradasAgricultor();
    }
  }

  // ------------------------------------------------------------------
  //  Exportaciones a Excel
  // ------------------------------------------------------------------
  function exportarPlantas() {
    const filas = plantasFiltradas().map((r) => {
      const a = App.agricultorPorId(r.agricultor_id) || {};
      return {
        "Código": App.fmtCodigo(a.codigo),
        "Agricultor": a.nombre || "",
        "Campaña": App.campanaNombre(r.campana_id) === "—" ? "" : App.campanaNombre(r.campana_id),
        "Ciclo": App.cicloValido(r.ciclo),
        "Fecha de Retirada": r.fecha || "",
        "Nº Plantas": App.num(r.num_plantas),
        "Variedad": r.variedad || "",
        "Comentarios": r.comentarios || "",
      };
    });

    if (filas.length === 0) {
      App.toast("No hay retiradas que exportar.");
      return;
    }

    App.descargarLibro(filas, "Plantas", "Plantas retiradas");
    App.toast("Excel exportado");
  }

  // ------------------------------------------------------------------
  //  Eventos
  // ------------------------------------------------------------------
  function configurarEventosPlantas() {
    App.$("btnPlantas").addEventListener("click", () => abrirModalPlantas());
    // Desde la ficha del agricultor, ya filtrado por él.
    App.$("btnPlantasAgricultor").addEventListener("click", () =>
      abrirModalPlantas(App.state.agricultorAbierto?.id));

    App.$("btnNuevaPlanta").addEventListener("click", () => abrirModalPlanta());
    App.dom.formPlanta.addEventListener("submit", guardarPlanta);
    App.$("cuerpoPlantas").addEventListener("click", clickPlantas);
    App.$("btnExportPlantas").addEventListener("click", exportarPlantas);

    ["filtroAgriPlantas", "filtroCampanaPlantas", "filtroCicloPlantas"].forEach((id) =>
      App.$(id).addEventListener("change", pintarPlantas));
  }

  Object.assign(App, {
    agruparRendimiento,
    cargarRetiradasAgricultor,
    pintarResumenCiclos,
    abrirModalPlantas,
    configurarEventosPlantas,
  });
})(window.App);
