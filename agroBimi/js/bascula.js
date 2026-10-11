// =====================================================================
//  Puesto de la báscula (bascula.html)
//  Página independiente de la app principal: solo apunta las cajas que
//  entra cada agricultor y las vacías que se lleva.
//  Toda la escritura pasa por las funciones bascula_* de schema.sql
//  (sección 14), que validan los datos.
//
//  Sin red:
//  Cada entrada se guarda PRIMERO en la tablet (cola de "pendientes" en
//  localStorage) y después se envía. Si no hay red se queda en la cola y
//  se reintenta sola al volver la conexión. Cada entrada lleva un código
//  único (uuid) generado aquí: si un envío llega al servidor pero se
//  pierde la respuesta, el reintento no la duplica.
//  Los agricultores, campañas y lo apuntado hoy también se guardan en la
//  tablet, para poder seguir trabajando aunque se recargue sin red.
// =====================================================================

(function initBascula() {
  const $ = (id) => document.getElementById(id);
  const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const KEY_CAMPANA = "bascula_campana";
  const KEY_PENDIENTES = "bascula_pendientes";
  const KEY_CACHE = "bascula_cache";
  const MAX_CAJAS = 5000;
  // Si se apunta lo mismo al mismo agricultor en este margen, se pregunta
  // antes: casi siempre es un doble toque.
  const MARGEN_DUPLICADO_MS = 2 * 60 * 1000;
  const REFRESCO_HOY_MS = 60 * 1000;
  const REFRESCO_AGRICULTORES_MS = 10 * 60 * 1000;
  const REINTENTO_ENVIO_MS = 20 * 1000;

  const state = {
    agricultores: [],
    campanas: [],
    emisor: "",
    hoy: [],           // entradas de hoy ya guardadas en el servidor
    pendientes: [],    // entradas guardadas en la tablet sin enviar todavía
    elegido: null,     // agricultor seleccionado
    ciclo: "1",        // nunca vacío: por defecto el ciclo 1
    cajas: "",       // cajas entradas (texto del teclado)
    vacias: "",        // cajas vacías que se lleva ("" = 0)
    campo: "cajas",    // contador en el que escribe el teclado
    cargado: false,
    enviando: false,
    sinRed: !navigator.onLine,
    datosDeCache: false,
  };

  let temporizadores = [];

  // ------------------------------------------------------------------
  //  Utilidades
  // ------------------------------------------------------------------
  function escapar(texto) {
    return String(texto ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function fmtCodigo(codigo) {
    return codigo == null ? "—" : String(codigo).padStart(3, "0");
  }

  // Sin tildes ni mayúsculas, para que "jose" encuentre "José".
  function normalizar(texto) {
    return String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  }

  function hora(iso) {
    return new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  }

  function fechaLarga(iso) {
    return new Date(iso).toLocaleDateString("es-ES", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    });
  }

  // Fecha local AAAA-MM-DD, para saber si algo es "de hoy".
  function diaLocal(fecha = new Date()) {
    const d = new Date(fecha);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function nuevoUuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    // Navegadores antiguos o página sin https.
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove("show"), 3000);
  }

  // El servidor ha rechazado los datos (no es un fallo de red): reintentar
  // no sirve de nada. P0001 = "raise exception" de las funciones bascula_*;
  // 22xxx / 23xxx = datos no válidos.
  function esRechazo(error) {
    return /^(P0001|22|23)/.test(error?.code || "");
  }

  // ------------------------------------------------------------------
  //  Almacenamiento en la tablet
  // ------------------------------------------------------------------
  const almacen = {
    disponible: (() => {
      try {
        localStorage.setItem("bascula_prueba", "1");
        localStorage.removeItem("bascula_prueba");
        return true;
      } catch { return false; }
    })(),
    leer(clave, defecto) {
      try {
        const v = localStorage.getItem(clave);
        return v == null ? defecto : JSON.parse(v);
      } catch { return defecto; }
    },
    guardar(clave, valor) {
      try { localStorage.setItem(clave, JSON.stringify(valor)); return true; } catch { return false; }
    },
  };

  function guardarPendientes() {
    if (!almacen.guardar(KEY_PENDIENTES, state.pendientes)) almacen.disponible = false;
  }

  function guardarCache() {
    almacen.guardar(KEY_CACHE, {
      agricultores: state.agricultores,
      campanas: state.campanas,
      emisor: state.emisor,
      hoy: state.hoy,
      dia: diaLocal(),
      guardado: new Date().toISOString(),
    });
  }

  function usarCache() {
    const c = almacen.leer(KEY_CACHE, null);
    if (!c) return false;
    state.agricultores = c.agricultores || [];
    state.campanas = c.campanas || [];
    state.emisor = c.emisor || "";
    // Lo de "hoy" solo vale si es del mismo día.
    state.hoy = c.dia === diaLocal() ? (c.hoy || []) : [];
    state.datosDeCache = true;
    return state.agricultores.length > 0;
  }

  // ------------------------------------------------------------------
  //  Carga de datos
  // ------------------------------------------------------------------
  function campanaId() {
    const v = $("selCampana").value;
    return v ? parseInt(v, 10) : null;
  }

  function pintarCampanas() {
    const guardada = almacen.leer(KEY_CAMPANA, null);
    const sel = $("selCampana");
    // Sin opción vacía: nada se apunta sin campaña.
    sel.innerHTML = state.campanas.length
      ? state.campanas.map((c) => `<option value="${c.id}">${escapar(c.nombre)}</option>`).join("")
      : '<option value="">No hay campañas</option>';
    sel.disabled = state.campanas.length === 0;
    // Por defecto la última que se eligió en esta tablet; si no, la más reciente.
    const existe = state.campanas.some((c) => String(c.id) === String(guardada));
    sel.value = existe ? String(guardada) : String(state.campanas[0]?.id ?? "");
  }

  async function cargarCampanas() {
    const { data, error } = await db.rpc("bascula_campanas");
    if (error) throw error;
    state.campanas = data || [];
    pintarCampanas();
  }

  async function cargarEmisor() {
    const { data, error } = await db.rpc("bascula_emisor");
    if (!error) state.emisor = data || "";
  }

  async function cargarAgricultores() {
    const { data, error } = await db.rpc("bascula_agricultores", { p_campana_id: campanaId() });
    if (error) throw error;
    state.agricultores = data || [];
    // Los ciclos de las entradas sin enviar son más recientes que los del servidor.
    state.pendientes.forEach((p) => {
      const a = state.agricultores.find((x) => x.id === p.agricultor_id);
      if (a && p.campana_id === campanaId()) a.ultimo_ciclo = p.ciclo;
    });
    if (state.elegido) {
      state.elegido = state.agricultores.find((a) => a.id === state.elegido.id) || null;
    }
    state.datosDeCache = false;
    guardarCache();
    pintarAgricultores();
    pintarEntrada();
  }

  async function cargarHoy() {
    const { data, error } = await db.rpc("bascula_hoy");
    if (error) throw error;
    state.hoy = data || [];
    guardarCache();
    pintarHoy();
    pintarEntrada();
  }

  async function cargarTodo() {
    try {
      await cargarCampanas();
      await Promise.all([cargarAgricultores(), cargarHoy(), cargarEmisor()]);
      state.sinRed = false;
    } catch (error) {
      if (esRechazo(error) || !usarCache()) {
        $("gridAgricultores").innerHTML =
          `<div class="error">No se pudieron cargar los datos.<br>${escapar(error.message)}<br>` +
          "¿Hay conexión? ¿Se ha ejecutado el último schema.sql en Supabase?</div>";
        return;
      }
      // Sin red pero con datos guardados en la tablet: se puede seguir.
      state.sinRed = true;
      pintarCampanas();
      pintarAgricultores();
      pintarHoy();
      pintarEntrada();
    }
    pintarEstadoRed();
  }

  // ------------------------------------------------------------------
  //  Envío de la cola de pendientes
  // ------------------------------------------------------------------
  async function enviarPendientes() {
    if (state.enviando || !document.body.classList.contains("authed")) return;
    if (!state.pendientes.some((p) => !p.error)) return;

    state.enviando = true;
    pintarEstadoRed();
    let enviadas = 0;

    try {
      // Renueva el token si ha caducado mientras no había red.
      const { data: { session } } = await db.auth.getSession();
      if (!session) return;

      for (const p of [...state.pendientes]) {
        if (p.error) continue;
        const { error } = await db.rpc("bascula_registrar", {
          p_client_uuid: p.uuid,
          p_agricultor_id: p.agricultor_id,
          p_campana_id: p.campana_id,
          p_ciclo: p.ciclo,
          p_cajas: p.cajas,
          p_vacias: p.vacias || 0,
          p_pesada_en: p.pesada_en,
        });

        if (error && !esRechazo(error)) {
          // Sin red (o sesión caducada): paramos y se reintenta más tarde.
          state.sinRed = true;
          break;
        }
        state.sinRed = false;
        if (error) {
          // Rechazada: se queda a la vista para que alguien decida.
          p.error = error.message;
        } else {
          state.pendientes = state.pendientes.filter((x) => x.uuid !== p.uuid);
          enviadas++;
        }
        guardarPendientes();
      }
    } finally {
      state.enviando = false;
      pintarEstadoRed();
      pintarHoy();
    }

    if (enviadas) {
      if (state.datosDeCache) cargarTodo();
      else cargarHoy().catch(() => {});
      // Lo que se apuntó mientras se enviaba sale ya, sin esperar al
      // siguiente reintento.
      if (state.pendientes.some((p) => !p.error)) enviarPendientes();
    }
  }

  // ------------------------------------------------------------------
  //  Pintado
  // ------------------------------------------------------------------
  function agricultoresFiltrados() {
    const q = normalizar($("buscar").value);
    if (!q) return state.agricultores;
    // Si escriben números, buscamos por código (con o sin ceros delante).
    if (/^\d+$/.test(q)) {
      const n = parseInt(q, 10);
      return state.agricultores.filter((a) =>
        a.codigo === n || fmtCodigo(a.codigo).startsWith(q) || String(a.codigo ?? "").startsWith(q));
    }
    return state.agricultores.filter((a) => normalizar(a.nombre).includes(q));
  }

  function pintarAgricultores() {
    const lista = agricultoresFiltrados();
    const grid = $("gridAgricultores");
    if (!lista.length) {
      grid.innerHTML = '<div class="empty">Ningún agricultor coincide con la búsqueda.</div>';
      return;
    }
    grid.innerHTML = lista.map((a) => `
      <button type="button" class="agri-tile${state.elegido?.id === a.id ? " activo" : ""}" data-agri="${a.id}">
        <span class="agri-tile-cod">${fmtCodigo(a.codigo)}</span>
        <span class="agri-tile-nombre">${escapar(a.nombre)}</span>
      </button>`).join("");
  }

  // Entradas de hoy: las enviadas y las que siguen en la tablet. Durante un
  // envío una misma entrada puede estar en las dos listas: manda la cola.
  function entradasHoy() {
    const hoy = diaLocal();
    const enCola = new Set(state.pendientes.map((p) => p.uuid));
    const pendientes = state.pendientes
      .filter((p) => diaLocal(p.pesada_en) === hoy)
      .map((p) => ({ ...p, creado: p.pesada_en, pendiente: true }));
    const enviadas = state.hoy.filter((h) => !enCola.has(h.client_uuid));
    return [...pendientes, ...enviadas]
      .sort((x, y) => new Date(y.creado) - new Date(x.creado));
  }

  // "34 cajas" o "34 cajas · 10 vacías" (las vacías solo si hay).
  function resumenCajas(e) {
    const vacias = e.vacias || 0;
    return `${e.cajas || 0} cajas${vacias ? ` · ${vacias} vacías` : ""}`;
  }

  function cajasHoyDe(agricultorId) {
    return entradasHoy()
      .filter((h) => h.agricultor_id === agricultorId)
      .reduce((s, h) => s + (h.cajas || 0), 0);
  }

  function pintarEntrada() {
    const a = state.elegido;
    $("agriElegido").innerHTML = a
      ? `<span class="agri-elegido-cod">${fmtCodigo(a.codigo)}</span>
         <span class="agri-elegido-nombre">${escapar(a.nombre)}</span>
         <span class="agri-elegido-hoy">Hoy: ${cajasHoyDe(a.id)} cajas</span>`
      : '<span class="agri-elegido-vacio">Elige un agricultor</span>';

    document.querySelectorAll(".ciclo-btn").forEach((b) => {
      const activo = b.dataset.ciclo === state.ciclo;
      b.classList.toggle("activo", activo);
      b.setAttribute("aria-checked", activo ? "true" : "false");
    });

    $("cajasValor").textContent = state.cajas || "0";
    $("vaciasValor").textContent = state.vacias || "0";
    document.querySelectorAll("#contadores [data-campo]").forEach((b) => {
      const activo = b.dataset.campo === state.campo;
      b.classList.toggle("activo", activo);
      b.classList.toggle("vacio", !state[b.dataset.campo]);
      b.setAttribute("aria-pressed", activo ? "true" : "false");
    });

    // Vale con cajas entradas, con vacías o con las dos.
    const n = (parseInt(state.cajas, 10) || 0) + (parseInt(state.vacias, 10) || 0);
    const listo = Boolean(a && state.ciclo && campanaId() && n >= 1);
    $("btnRegistrar").disabled = !listo;
    $("btnRegistrarImprimir").disabled = !listo;
  }

  function lineaHoy(h) {
    const cab = `
      <span class="hoy-hora">${hora(h.creado)}</span>
      <span class="hoy-agri"><b>${fmtCodigo(h.codigo)}</b> ${escapar(h.nombre)}</span>
      <span class="hoy-ciclo">C${escapar(h.ciclo ?? "—")}</span>
      <span class="hoy-cajas">${h.cajas || 0}${h.vacias
        ? `<small class="hoy-vacias" title="Vacías que se lleva">−${h.vacias} vacías</small>` : ""}</span>
      <button type="button" class="btn-edit btn-sm" data-imprimir="${escapar(h.uuid || h.client_uuid || h.id)}"
        title="Imprimir justificante" aria-label="Imprimir justificante">🖨</button>`;

    if (h.pendiente && h.error) {
      return `
        <li class="hoy-item hoy-rechazada">${cab}
          <button type="button" class="btn-del btn-sm" data-descartar="${h.uuid}">Descartar</button>
          <div class="hoy-nota">⚠ No se ha podido guardar: ${escapar(h.error)}
            <button type="button" class="btn-ghost btn-sm" data-reintentar="${h.uuid}">Reintentar</button>
          </div>
        </li>`;
    }
    if (h.pendiente) {
      return `
        <li class="hoy-item hoy-pendiente">${cab}
          <button type="button" class="btn-del btn-sm" data-descartar="${h.uuid}">Anular</button>
          <div class="hoy-nota">⏳ Guardada en la tablet, pendiente de envío</div>
        </li>`;
    }
    return `
      <li class="hoy-item">${cab}
        ${h.liquidado
          ? '<span class="badge badge-ok badge-mini" title="Ya liquidado: se corrige desde la oficina">Liquidado</span>'
          : `<button type="button" class="btn-del btn-sm" data-anular="${h.id}">Anular</button>`}
      </li>`;
  }

  function pintarHoy() {
    const lista = entradasHoy();
    const total = lista.reduce((s, h) => s + (h.cajas || 0), 0);
    const vacias = lista.reduce((s, h) => s + (h.vacias || 0), 0);
    $("hoyTotal").textContent = lista.length
      ? `${lista.length} ${lista.length === 1 ? "entrada" : "entradas"} · ${resumenCajas({ cajas: total, vacias })}`
      : "";

    // Pendientes de otros días (la tablet estuvo días sin red): se avisan
    // aparte para que no queden escondidas.
    const antiguas = state.pendientes.filter((p) => diaLocal(p.pesada_en) !== diaLocal());
    const extra = antiguas.length
      ? `<li class="hoy-nota hoy-antiguas">⏳ Además hay ${antiguas.length} ${antiguas.length === 1 ? "entrada" : "entradas"} de días anteriores pendientes de envío.</li>` +
        antiguas.filter((p) => p.error).map((p) => lineaHoy({ ...p, creado: p.pesada_en, pendiente: true })).join("")
      : "";

    $("hoyLista").innerHTML = lista.length || extra
      ? lista.map(lineaHoy).join("") + extra
      : '<li class="empty">Todavía no se ha apuntado nada hoy.</li>';
  }

  function pintarFecha() {
    $("fechaHoy").textContent = fechaLarga(new Date());
  }

  function pintarEstadoRed() {
    const n = state.pendientes.filter((p) => !p.error).length;
    const rechazadas = state.pendientes.length - n;
    const sinRed = state.sinRed || !navigator.onLine;

    const el = $("estadoRed");
    el.classList.toggle("sin-red", sinRed);
    el.textContent = state.enviando
      ? `⟳ Enviando ${n}…`
      : sinRed
        ? `● Sin conexión${n ? ` · ${n} sin enviar` : ""}`
        : `● En línea${n ? ` · ${n} sin enviar` : ""}`;

    const avisos = [];
    if (!almacen.disponible) {
      avisos.push("⚠ Este navegador no deja guardar datos en la tablet: si se va la red, las entradas no se podrán guardar. Sal del modo incógnito.");
    }
    if (sinRed) {
      avisos.push(n
        ? `Sin conexión. Hay ${n} ${n === 1 ? "entrada guardada" : "entradas guardadas"} en la tablet: se enviarán solas al volver la red. No cierres sesión ni borres los datos del navegador.`
        : "Sin conexión. Puedes seguir apuntando: las entradas se guardan en la tablet y se envían solas al volver la red.");
    }
    if (rechazadas) {
      avisos.push(`⚠ ${rechazadas} ${rechazadas === 1 ? "entrada no se ha podido guardar" : "entradas no se han podido guardar"}: revísalas en la lista de hoy.`);
    }
    const aviso = $("avisoRed");
    aviso.hidden = !avisos.length;
    aviso.classList.toggle("aviso-grave", !almacen.disponible || rechazadas > 0);
    aviso.innerHTML = avisos.map((t) => `<div>${escapar(t)}</div>`).join("");
  }

  // ------------------------------------------------------------------
  //  Justificante impreso
  // ------------------------------------------------------------------
  function ticket(e, copia) {
    return `
      <div class="ticket">
        ${state.emisor ? `<div class="ticket-emisor">${escapar(state.emisor)}</div>` : ""}
        <h1>Justificante</h1>
        <div class="ticket-fecha">${escapar(fechaLarga(e.creado))} · ${hora(e.creado)}</div>

        <dl class="ticket-datos">
          <dt>Agricultor</dt><dd><b>${escapar(e.nombre)}</b></dd>
          <dt>Ciclo</dt><dd>${escapar(e.ciclo)}</dd>
        </dl>

        <div class="ticket-cajas">
          <span>Cajas entradas</span>
          <b>${e.cajas || 0}</b>
        </div>
        <div class="ticket-cajas">
          <span>Cajas vacías retiradas</span>
          <b>${e.vacias || 0}</b>
        </div>

        <div class="ticket-firma">
          <div class="ticket-firma-hueco"></div>
          <div>${escapar(copia)}</div>
        </div>
      </div>`;
  }

  // Dos copias iguales, cada una en su página (en la impresora de tickets,
  // dos tickets seguidos): no hay que cortar nada. El tamaño del papel se
  // ajusta en bascula.css.
  function imprimirJustificante(e) {
    $("zonaImpresion").innerHTML =
      ticket(e, "Copia para el agricultor") +
      ticket(e, "Copia para la empresa");

    // Al "Guardar como PDF" el navegador propone el título de la página como
    // nombre del archivo: lo cambiamos mientras dura la impresión.
    const tituloOriginal = document.title;
    document.title = nombreArchivoJustificante(e);
    window.addEventListener("afterprint", () => { document.title = tituloOriginal; }, { once: true });
    window.print();
  }

  // "Justificante José Pérez 2026-10-08 10.32". La hora evita que dos
  // entradas del mismo agricultor en el mismo día se llamen igual.
  function nombreArchivoJustificante(e) {
    const nombre = String(e.nombre || "agricultor")
      .replace(/[\\/:*?"<>|]+/g, " ")   // caracteres que no admite Windows
      .replace(/\s+/g, " ")
      .trim();
    const hhmm = hora(e.creado).replace(":", ".");
    return `Justificante ${nombre} ${diaLocal(e.creado)} ${hhmm}`;
  }

  // ------------------------------------------------------------------
  //  Acciones
  // ------------------------------------------------------------------
  function elegirAgricultor(id) {
    const a = state.agricultores.find((x) => x.id === id);
    if (!a) return;
    state.elegido = a;
    // Proponemos el último ciclo que se le apuntó en esta campaña; si no
    // tiene ninguno, el ciclo 1.
    state.ciclo = ["1", "2", "3"].includes(a.ultimo_ciclo) ? a.ultimo_ciclo : "1";
    state.campo = "cajas";
    $("errorEntrada").textContent = "";
    pintarAgricultores();
    pintarEntrada();
    $("panelEntrada").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function pulsarTecla(tecla) {
    const actual = state[state.campo];
    let nuevo = actual;
    if (tecla === "C") nuevo = "";
    else if (tecla === "⌫") nuevo = actual.slice(0, -1);
    else if (/^\d$/.test(tecla)) {
      const candidato = (actual + tecla).replace(/^0+/, "");
      if ((parseInt(candidato, 10) || 0) <= MAX_CAJAS) nuevo = candidato;
    }
    state[state.campo] = nuevo;
    $("errorEntrada").textContent = "";
    pintarEntrada();
  }

  function pareceDuplicado(agricultorId, cajas, vacias) {
    const ahora = Date.now();
    return entradasHoy().some((h) =>
      h.agricultor_id === agricultorId && (h.cajas || 0) === cajas && (h.vacias || 0) === vacias &&
      ahora - new Date(h.creado).getTime() < MARGEN_DUPLICADO_MS);
  }

  function registrar({ imprimir = false } = {}) {
    const a = state.elegido;
    const cajas = parseInt(state.cajas, 10) || 0;
    const vacias = parseInt(state.vacias, 10) || 0;
    if (!a || !state.ciclo || !campanaId() || cajas + vacias < 1) return;

    if (pareceDuplicado(a.id, cajas, vacias) &&
        !confirm(`Hace un momento ya se apuntó lo mismo a ${a.nombre} (${resumenCajas({ cajas, vacias })}).\n¿Apuntarlo otra vez?`)) {
      return;
    }

    const entrada = {
      uuid: nuevoUuid(),
      agricultor_id: a.id,
      nombre: a.nombre,
      codigo: a.codigo,
      campana_id: campanaId(),
      ciclo: state.ciclo,
      cajas,
      vacias,
      pesada_en: new Date().toISOString(),
      error: null,
    };

    // Primero a la tablet; el envío viene después y puede fallar sin
    // que se pierda nada.
    state.pendientes.push(entrada);
    guardarPendientes();

    a.ultimo_ciclo = state.ciclo;
    toast(`✓ ${a.nombre} · Ciclo ${state.ciclo} · ${resumenCajas({ cajas, vacias })}`);
    // Listo para el siguiente agricultor.
    state.elegido = null;
    state.ciclo = "1";
    state.cajas = "";
    state.vacias = "";
    state.campo = "cajas";
    $("buscar").value = "";
    pintarAgricultores();
    pintarEntrada();
    pintarHoy();
    pintarEstadoRed();

    // Primero se lanza el envío: el diálogo de impresión puede bloquear la página.
    enviarPendientes();
    if (imprimir) imprimirJustificante({ ...entrada, creado: entrada.pesada_en, pendiente: true });
  }

  async function anular(id) {
    const h = state.hoy.find((x) => x.id === id);
    if (!h) return;
    if (!confirm(`¿Anular la entrada de las ${hora(h.creado)}?\n${h.nombre} · Ciclo ${h.ciclo} · ${resumenCajas(h)}`)) return;

    const { data, error } = await db.rpc("bascula_anular", { p_id: id });
    if (error) {
      toast(esRechazo(error) ? error.message : "Sin conexión: no se puede anular ahora.");
      return;
    }
    toast(data ? "Entrada anulada" : "No se puede anular: corrígela desde la oficina");
    cargarHoy().catch(() => {});
  }

  function descartarPendiente(uuid) {
    const p = state.pendientes.find((x) => x.uuid === uuid);
    if (!p) return;
    if (state.enviando && !p.error) {
      toast("Se está enviando: espera un momento y vuelve a intentarlo.");
      return;
    }
    if (!confirm(`¿Anular esta entrada sin enviar?\n${p.nombre} · Ciclo ${p.ciclo} · ${resumenCajas(p)}`)) return;
    state.pendientes = state.pendientes.filter((x) => x.uuid !== uuid);
    guardarPendientes();
    pintarHoy();
    pintarEntrada();
    pintarEstadoRed();
  }

  function reintentarPendiente(uuid) {
    const p = state.pendientes.find((x) => x.uuid === uuid);
    if (!p) return;
    p.error = null;
    guardarPendientes();
    pintarHoy();
    enviarPendientes();
  }

  function buscarEntrada(clave) {
    const p = state.pendientes.find((x) => x.uuid === clave);
    if (p) return { ...p, creado: p.pesada_en, pendiente: true };
    return state.hoy.find((h) => h.client_uuid === clave || String(h.id) === clave) || null;
  }

  // La pantalla no debe apagarse mientras se usa la báscula.
  async function mantenerPantallaEncendida() {
    if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
    try { await navigator.wakeLock.request("screen"); } catch { /* no soportado */ }
  }

  // ------------------------------------------------------------------
  //  Sesión
  //  Sin cierre por inactividad: supabase-js guarda la sesión y renueva el
  //  token solo, así que la tablet sigue dentro aunque pasen días.
  // ------------------------------------------------------------------
  function aplicarSesion(session) {
    document.body.classList.toggle("authed", !!session);
    temporizadores.forEach(clearInterval);
    temporizadores = [];

    if (!session) {
      state.cargado = false;
      state.elegido = null;
      return;
    }
    if (!state.cargado) {
      state.cargado = true;
      cargarTodo().then(enviarPendientes);
    }
    temporizadores.push(
      setInterval(() => cargarHoy().catch(() => {}), REFRESCO_HOY_MS),
      setInterval(() => cargarAgricultores().catch(() => {}), REFRESCO_AGRICULTORES_MS),
      setInterval(enviarPendientes, REINTENTO_ENVIO_MS),
      setInterval(pintarFecha, REFRESCO_HOY_MS),
    );
  }

  function configurarEventos() {
    $("loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      $("loginError").textContent = "";
      const btn = $("btnLogin");
      btn.disabled = true;
      btn.textContent = "Entrando...";
      const { error } = await db.auth.signInWithPassword({
        email: $("email").value.trim(),
        password: $("password").value,
      });
      btn.disabled = false;
      btn.textContent = "Entrar";
      if (error) {
        $("loginError").textContent = error.status === 400
          ? "Email o contraseña incorrectos."
          : "No se pudo conectar. Inténtalo de nuevo.";
        return;
      }
      $("loginForm").reset();
    });

    $("btnSalir").addEventListener("click", async () => {
      const n = state.pendientes.length;
      const aviso = n
        ? `Hay ${n} ${n === 1 ? "entrada" : "entradas"} sin enviar. Se quedan guardadas en la tablet y se enviarán al volver a entrar.\n\n`
        : "";
      if (!confirm(`${aviso}¿Cerrar la sesión de la báscula? Habrá que volver a meter la contraseña.`)) return;
      // Solo esta tablet: no echamos a otras que usen el mismo usuario.
      await db.auth.signOut({ scope: "local" });
    });

    $("selCampana").addEventListener("change", () => {
      almacen.guardar(KEY_CAMPANA, $("selCampana").value);
      cargarAgricultores().catch(() => {});
    });

    $("buscar").addEventListener("input", pintarAgricultores);
    $("buscar").addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const lista = agricultoresFiltrados();
      if (lista.length === 1) {
        elegirAgricultor(lista[0].id);
        $("buscar").blur();
      }
    });

    $("gridAgricultores").addEventListener("click", (e) => {
      const tile = e.target.closest("[data-agri]");
      if (tile) elegirAgricultor(parseInt(tile.dataset.agri, 10));
    });

    $("ciclos").addEventListener("click", (e) => {
      const b = e.target.closest("[data-ciclo]");
      if (!b) return;
      state.ciclo = b.dataset.ciclo;
      pintarEntrada();
    });

    $("contadores").addEventListener("click", (e) => {
      const b = e.target.closest("[data-campo]");
      if (!b) return;
      state.campo = b.dataset.campo;
      pintarEntrada();
    });

    $("teclado").addEventListener("click", (e) => {
      const b = e.target.closest("[data-tecla]");
      if (b) pulsarTecla(b.dataset.tecla);
    });

    // Con teclado físico (ordenador): números, borrar, flechas para cambiar
    // de contador y Enter para registrar.
    document.addEventListener("keydown", (e) => {
      if (!document.body.classList.contains("authed")) return;
      if (e.target.matches("input, select, textarea")) return;
      if (/^\d$/.test(e.key)) pulsarTecla(e.key);
      else if (e.key === "Backspace") pulsarTecla("⌫");
      else if (e.key === "Escape") pulsarTecla("C");
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        // Flechas: cambiar entre cajas entradas y vacías.
        state.campo = state.campo === "cajas" ? "vacias" : "cajas";
        pintarEntrada();
      }
      else if (e.key === "Enter") registrar();
      else return;
      e.preventDefault();
    });

    $("btnRegistrar").addEventListener("click", () => registrar());
    $("btnRegistrarImprimir").addEventListener("click", () => registrar({ imprimir: true }));

    $("hoyLista").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.anular) anular(parseInt(b.dataset.anular, 10));
      else if (b.dataset.descartar) descartarPendiente(b.dataset.descartar);
      else if (b.dataset.reintentar) reintentarPendiente(b.dataset.reintentar);
      else if (b.dataset.imprimir) {
        const entrada = buscarEntrada(b.dataset.imprimir);
        if (entrada) imprimirJustificante(entrada);
      }
    });

    window.addEventListener("online", () => {
      pintarEstadoRed();
      enviarPendientes();
    });
    window.addEventListener("offline", () => {
      state.sinRed = true;
      pintarEstadoRed();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      mantenerPantallaEncendida();
      pintarFecha();
      pintarHoy();
      // Al volver de reposo: enviar lo pendiente y refrescar (puede haber
      // cambiado el día).
      if (document.body.classList.contains("authed")) {
        enviarPendientes();
        cargarHoy().catch(() => {});
      }
    });
    // Si se intenta cerrar la pestaña con entradas sin enviar, avisamos.
    // (No se pierden, pero así nadie cree que ya están en la oficina.)
    window.addEventListener("beforeunload", (e) => {
      if (state.pendientes.length) e.preventDefault();
    });
  }

  async function iniciar() {
    state.pendientes = almacen.leer(KEY_PENDIENTES, []);
    pintarFecha();
    pintarEstadoRed();
    pintarEntrada();
    configurarEventos();
    mantenerPantallaEncendida();
    const { data: { session } } = await db.auth.getSession();
    aplicarSesion(session);
    db.auth.onAuthStateChange((evento, nuevaSesion) => {
      // La renovación del token no debe recargar ni reiniciar nada.
      if (evento === "TOKEN_REFRESHED") return;
      aplicarSesion(nuevaSesion);
    });
  }

  iniciar();
})();
