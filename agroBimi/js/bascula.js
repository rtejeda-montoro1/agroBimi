// =====================================================================
//  Puesto de la báscula (bascula.html)
//  Página independiente de la app principal: solo apunta las cajas que
//  entra cada agricultor y las vacías que se lleva.
//  Toda la escritura pasa por las funciones bascula_* de schema.sql
//  (sección 14), que validan los datos.
//  Cada entrada es una pesada; en el servidor, las del mismo día de un
//  agricultor (misma campaña y ciclo) se suman en un único registro.
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
  // La báscula guarda su sesión aparte (storageKey propio). Con la clave
  // por defecto compartía la de la oficina: con la oficina abierta en el
  // mismo navegador, bascula.html entraba sin pedir contraseña y con el
  // usuario de la oficina.
  const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { storageKey: "bimi-bascula-auth" },
  });

  const KEY_CAMPANA = "bascula_campana";
  const KEY_PENDIENTES = "bascula_pendientes";
  const KEY_CACHE = "bascula_cache";
  // Palets completos que la tablet ya conoce: los que no estén aquí se
  // acaban de completar y se imprime su etiqueta sola.
  const KEY_ETIQUETAS = "bascula_palets_completos";
  const MAX_CAJAS = 5000;
  // Si se apunta lo mismo al mismo agricultor en este margen, se pregunta
  // antes: casi siempre es un doble toque.
  const MARGEN_DUPLICADO_MS = 2 * 60 * 1000;
  const REFRESCO_HOY_MS = 60 * 1000;
  const REFRESCO_AGRICULTORES_MS = 10 * 60 * 1000;
  const REINTENTO_ENVIO_MS = 20 * 1000;
  // «Registrar e imprimir» espera como mucho esto a que la oficina
  // confirme la entrada antes de imprimir el justificante.
  const ESPERA_IMPRIMIR_MS = 6 * 1000;

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
    falloRedEn: 0,     // cuándo falló la red por última vez (Date.now())
    datosDeCache: false,
    vista: "bascula",  // "bascula" o "palets"
    palets: null,      // lo último que devolvió bascula_palets()
    paletsJSON: "",    // el mismo dato en texto, para no repintar si no cambia
    paletsHora: null,  // cuándo se recibieron
    paletsFallo: false, // la última carga falló (sin red o error)
    paletsReq: 0,      // nº de la última carga pedida: las viejas se ignoran
    paletsFiltro: "progreso", // "progreso" o "hoy" (completados hoy)
    cargaFallida: false, // la primera carga falló sin datos guardados: se reintenta
  };

  let temporizadores = [];
  const actualizacionesConError = new Set();

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

  // El estado de la red se decide por lo que pasa con el servidor, no solo
  // por los eventos online/offline del navegador. Antes «Sin conexión» solo
  // se quitaba al enviar una entrada pendiente: tras un corte de un segundo
  // sin nada en la cola, el aviso se quedaba puesto para siempre.
  function marcarEnLinea() {
    if (!state.sinRed) return;
    state.sinRed = false;
    pintarEstadoRed();
  }

  function marcarSinRed() {
    state.sinRed = true;
    state.falloRedEn = Date.now();
    pintarEstadoRed();
  }

  // Tras una llamada al servidor: si ha respondido (aunque sea con un
  // rechazo), hay red; si no ha llegado, no.
  function anotarRed(error) {
    if (error && !esRechazo(error)) marcarSinRed();
    else marcarEnLinea();
  }

  function notificarErrorActualizacion(datos, error) {
    anotarRed(error);
    console.error(`Error al actualizar ${datos}:`, error);
    if (actualizacionesConError.has(datos)) return;
    actualizacionesConError.add(datos);
    toast(`No se pudieron actualizar ${datos}. La información mostrada puede estar desactualizada.`);
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

  // La cola guardada en la tablet es la buena: puede haber otra pestaña de
  // la báscula abierta que también apunta y envía entradas. Cada cambio la
  // vuelve a leer y toca solo su entrada; así una pestaña no borra lo que
  // apuntó la otra al guardar su copia vieja.
  function leerCola() {
    if (!almacen.disponible) return state.pendientes;
    let raw;
    try { raw = localStorage.getItem(KEY_PENDIENTES); } catch { return state.pendientes; }
    if (raw == null) return [];
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return v;
    } catch { /* se guarda abajo */ }
    // Algo ilegible: se aparta una copia antes de que se sobrescriba, por
    // si hubiera que recuperar entradas a mano.
    try { localStorage.setItem(`${KEY_PENDIENTES}_ilegible_${Date.now()}`, raw); } catch { /* sin sitio */ }
    return [];
  }

  function modificarCola(cambio) {
    state.pendientes = cambio(leerCola());
    guardarPendientes();
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
    anotarRed(error);
    if (error) throw error;
    actualizacionesConError.delete("los agricultores");
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
    anotarRed(error);
    if (error) throw error;
    actualizacionesConError.delete("las entradas de hoy");
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
      state.cargaFallida = false;
    } catch (error) {
      if (esRechazo(error) || !usarCache()) {
        // Sin nada con lo que trabajar: se reintenta al volver la red y
        // cada minuto, para no tener que recargar la página a mano.
        state.cargaFallida = true;
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
  // Con varias pestañas abiertas, solo una envía a la vez (si el navegador
  // lo permite; si no, el servidor ya ignora un uuid repetido).
  function enviarPendientes() {
    if (state.enviando || !document.body.classList.contains("authed")) return;
    if (!state.pendientes.some((p) => !p.error)) return;
    if (navigator.locks) {
      return navigator.locks.request("bascula_envio", { ifAvailable: true },
        (lock) => (lock ? enviarCola() : undefined));
    }
    return enviarCola();
  }

  async function enviarCola() {
    if (state.enviando) return;

    state.enviando = true;
    pintarEstadoRed();
    let enviadas = 0;

    try {
      // Renueva el token si ha caducado mientras no había red.
      const { data: { session } } = await db.auth.getSession();
      if (!session) return;

      for (const p of leerCola()) {
        if (p.error) continue;
        // Otra pestaña puede haberla enviado o descartado mientras tanto.
        if (!leerCola().some((x) => x.uuid === p.uuid)) continue;
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
          marcarSinRed();
          break;
        }
        state.sinRed = false;
        if (error) {
          // Rechazada: se queda a la vista para que alguien decida.
          modificarCola((cola) => cola.map((x) => (x.uuid === p.uuid ? { ...x, error: error.message } : x)));
        } else {
          modificarCola((cola) => cola.filter((x) => x.uuid !== p.uuid));
          enviadas++;
        }
      }
    } finally {
      state.enviando = false;
      pintarEstadoRed();
      pintarHoy();
    }

    if (enviadas) {
      if (state.datosDeCache) cargarTodo();
      else cargarHoy().catch((error) => notificarErrorActualizacion("las entradas de hoy", error));
      etiquetasDePaletsCompletados().catch(notificarErrorEtiquetas);
      // Lo que se apuntó mientras se enviaba sale ya, sin esperar al
      // siguiente reintento (fuera de este envío, que aún tiene el turno).
      if (state.pendientes.some((p) => !p.error)) setTimeout(enviarPendientes, 0);
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
  // paraEmpresa: el aviso «PENDIENTE DE ENVÍO» solo va en la copia de la
  // empresa; al agricultor no le aporta nada en su justificante.
  // Textos del cliente: arriba «BIMI» y «Almacén Hortofrutícola»; el
  // almacén receptor es el emisor de Ajustes (emisor_nombre).
  // La fecha va debajo de las cajas. Sin referencia de la entrada: el
  // cliente no quiere entregarla.
  function ticket(e, copia, paraEmpresa = false) {
    return `
      <div class="ticket">
        <div class="ticket-emisor">BIMI</div>
        <h1>Almacén Hortofrutícola</h1>

        <dl class="ticket-datos">
          ${state.emisor ? `<dt class="ticket-receptor">Almacén receptor</dt>
            <dd class="ticket-receptor"><b>${escapar(state.emisor)}</b></dd>
            <div class="ticket-separador"></div>` : ""}
          <dt>Proveedor</dt><dd><b>${escapar(e.nombre)}</b></dd>
          <dt>Cultivo</dt><dd>Bimi</dd>
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

        <div class="ticket-fecha">${escapar(fechaLarga(e.creado))} · ${hora(e.creado)}</div>

        ${e.pendiente && paraEmpresa ? `<div class="ticket-pendiente">PENDIENTE DE ENVÍO<br>
          <small>Guardada en la tablet sin red: aún no consta en la oficina.</small></div>` : ""}

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
    encolarImpresion(() => justificanteParaImprimir(e), "el justificante");
  }

  function justificanteParaImprimir(e) {
    return {
      html: ticket(e, "Copia para el proveedor") + ticket(e, "Copia para el almacén", true),
      titulo: nombreArchivoJustificante(e),
    };
  }

  // ------------------------------------------------------------------
  //  Cola de impresión
  //  Justificantes y etiquetas se imprimen de uno en uno y en el orden en
  //  que se pidieron: la etiqueta de un palet que se completa con una
  //  pesada de «Registrar e imprimir» sale DESPUÉS de su justificante,
  //  aunque se sepa antes. preparar() puede ser async (el justificante
  //  espera a la oficina) y devolver null si al final no hay que imprimir.
  // ------------------------------------------------------------------
  let colaImpresion = Promise.resolve();

  function encolarImpresion(preparar, descripcion = "el documento") {
    colaImpresion = colaImpresion
      .then(preparar)
      .then((trabajo) => (trabajo ? imprimirAhora(trabajo) : undefined))
      .catch((error) => {
        console.error(`Error al imprimir ${descripcion}`, error);
        toast(`No se pudo imprimir ${descripcion}. Vuelve a intentarlo.`);
      });
    return colaImpresion;
  }

  function imprimirAhora({ html, titulo }) {
    return new Promise((resolve) => {
      $("zonaImpresion").innerHTML = html;
      // Al "Guardar como PDF" el navegador propone el título de la página
      // como nombre del archivo: lo cambiamos mientras dura la impresión.
      const tituloOriginal = document.title;
      document.title = titulo;
      let hecho = false;
      const fin = () => {
        if (hecho) return;
        hecho = true;
        document.title = tituloOriginal;
        resolve();
      };
      window.addEventListener("afterprint", fin, { once: true });
      window.print();
      // Por si el navegador no avisa del final (afterprint): que la cola
      // no se quede parada.
      setTimeout(fin, 60 * 1000);
    });
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
  //  Palets (vista aparte, solo lectura)
  //  Los palets sin salida, para ver cómo van y pegar su etiqueta. Se
  //  corrigen desde la oficina (js/palets.js). La etiqueta es la misma
  //  que allí: sus estilos .etq están en styles.css.
  // ------------------------------------------------------------------
  function fechaCorta(iso) {
    if (!iso) return "—";
    const [y, m, d] = String(iso).split("-");
    return `${d}/${m}/${y}`;
  }

  function cajasPorPalet() {
    return state.palets?.cajas_por_palet || 60;
  }

  function paletCompleto(p) {
    return (p.num_cajas || 0) >= cajasPorPalet();
  }

  // «Actualizado a las 10:42», y si no hay red, que se vea que es de antes.
  function pintarActualizado() {
    const sinRed = state.paletsFallo || !navigator.onLine;
    $("paletsActualizado").textContent = state.paletsHora
      ? `Actualizado a las ${hora(state.paletsHora)}${sinRed ? " · sin conexión" : ""}`
      : sinRed ? "Sin conexión" : "";
    $("paletsActualizado").classList.toggle("sin-red", sinRed);
  }

  // manual = lo ha pedido alguien (botón o entrar en la vista). El refresco
  // automático no avisa de fallos ni lo intenta sin red: no llenaría la
  // pantalla de avisos cada minuto.
  async function cargarPalets(manual = false) {
    if (!manual && !navigator.onLine) { pintarActualizado(); return; }
    if (!state.palets) $("listaPalets").innerHTML = '<div class="empty">Cargando palets…</div>';
    // Si se piden dos cargas a la vez (botón, minuto, vuelta de la red), solo
    // vale la última; y nada que llegue después de cerrar la sesión.
    const n = ++state.paletsReq;
    const { data, error } = await db.rpc("bascula_palets");
    if (n !== state.paletsReq || !document.body.classList.contains("authed")) return;
    state.paletsFallo = !!error;
    if (error) {
      // Si ya había palets a la vista se dejan: solo se avisa.
      if (state.palets) {
        if (manual) toast("No se han podido actualizar los palets.");
        pintarActualizado();
      } else {
        $("listaPalets").innerHTML =
          `<div class="error">No se pudieron cargar los palets.<br>${escapar(error.message)}<br>` +
          "¿Hay conexión? ¿Se ha ejecutado el último schema.sql en Supabase?</div>";
        pintarActualizado();
      }
      return;
    }
    const nuevo = data || { palets: [] };
    const json = JSON.stringify(nuevo);
    state.paletsHora = new Date().toISOString();
    // Si nada ha cambiado no se repinta: así no se pierde un toque en
    // «Imprimir etiqueta» ni se mueven las tarjetas bajo el dedo.
    if (json !== state.paletsJSON) {
      state.palets = nuevo;
      state.paletsJSON = json;
      pintarPalets();
    }
    pintarActualizado();
  }

  function tarjetaPalet(p) {
    const cap = cajasPorPalet();
    const completo = paletCompleto(p);
    const pct = Math.min(100, Math.round(((p.num_cajas || 0) / cap) * 100));
    const agris = (p.lineas || []).map((l) => `
        <li><span>${escapar(l.nombre)}</span><b>${l.cajas}</b></li>`).join("");
    return `
      <article class="palet-card${completo ? " completo" : " incompleto"}">
        ${completo ? "" : '<div class="palet-card-estado">⏳ En progreso · Incompleto</div>'}
        <div class="palet-card-cab">
          <span class="palet-card-num">Palet nº ${escapar(p.secuencia ?? "—")}</span>
          <span class="palet-card-cod">${escapar(p.codigo || "")}</span>
        </div>
        <div class="palet-barra-cajas"><span style="width:${pct}%"></span></div>
        <div class="palet-card-total">
          <span><b>${p.num_cajas || 0}</b> / ${cap} cajas</span>
          ${completo
            ? `<span class="badge badge-ok">Completo · ${fechaCorta(p.fecha_completo)}</span>`
            : `<span class="badge badge-aviso">Faltan ${cap - (p.num_cajas || 0)}</span>`}
        </div>
        <ul class="palet-card-agris">${agris || '<li><span>Vacío</span></li>'}</ul>
        <button type="button" class="btn-etiqueta" data-etiqueta="${p.id}">🏷 Imprimir etiqueta</button>
      </article>`;
  }

  // Se ven los palets en progreso o, con el botón, los completados hoy
  // (los de días anteriores se ven en la oficina).
  function pintarPalets() {
    const palets = state.palets?.palets || [];
    const hoy = diaLocal();
    const enCurso = palets.filter((p) => !paletCompleto(p));
    const completosHoy = palets.filter((p) => paletCompleto(p) && p.fecha_completo === hoy);
    const completos = palets.filter(paletCompleto);
    const cajasCompletos = completos.reduce((s, p) => s + (p.num_cajas || 0), 0);

    const dato = (clase, icono, numero, texto) => `
      <div class="palets-dato ${clase}">
        <span class="palets-dato-icono" aria-hidden="true">${icono}</span>
        <div><b>${numero}</b><span>${texto}</span></div>
      </div>`;
    $("paletsResumen").innerHTML =
      dato("dato-completos", "✔", completos.length,
        completos.length === 1 ? "palet completo" : "palets completos") +
      dato("dato-paletizadas", "▦", cajasCompletos, "cajas en cámara paletizadas pendientes de salir") +
      dato("dato-sueltas", "⏳", state.palets?.en_camara ?? 0, "cajas en cámara sin palet completo");

    const verHoy = state.paletsFiltro === "hoy";
    document.querySelectorAll("#paletsFiltro [data-filtro]").forEach((b) => {
      const activo = b.dataset.filtro === state.paletsFiltro;
      b.classList.toggle("activo", activo);
      b.setAttribute("aria-selected", String(activo));
      const n = b.dataset.filtro === "hoy" ? completosHoy.length : enCurso.length;
      b.textContent = `${b.dataset.filtro === "hoy" ? "Completos hoy" : "En progreso"} (${n})`;
    });

    const lista = verHoy ? completosHoy : enCurso;
    $("listaPalets").innerHTML = lista.length
      ? `<div class="palets-grid">${lista.map(tarjetaPalet).join("")}</div>`
      : `<div class="empty">${verHoy ? "Hoy no se ha completado ningún palet." : "No hay palets en progreso."}</div>`;
  }

  // Igual que la etiqueta de la oficina (js/palets.js, etiquetaHTML).
  function etiquetaHTML(p) {
    const filas = (p.lineas || []).map((l) => `
        <tr>
          <td>${escapar(l.nombre)}</td>
          <td class="der">${l.cajas}</td>
        </tr>`).join("");
    return `
      <div class="etq">
        <div class="etq-cabecera">
          <span class="etq-numero">${p.secuencia != null ? `Palet nº ${escapar(p.secuencia)}` : ""}<span
            class="etq-fecha">${p.fecha_completo ? fechaCorta(p.fecha_completo) : "En progreso"}</span></span>
          <span class="etq-codigo">${escapar(p.codigo || "")}</span>
        </div>
        <table class="etq-tabla"><tbody>${filas}</tbody></table>
      </div>`;
  }

  function imprimirEtiqueta(id) {
    const p = (state.palets?.palets || []).find((x) => String(x.id) === String(id));
    if (!p) return;
    if (!paletCompleto(p) &&
        !confirm(`El palet ${p.codigo || ""} todavía no está completo. ¿Imprimir la etiqueta igualmente?`)) {
      return;
    }
    encolarImpresion(() => etiquetaParaImprimir(p, state.palets), `la etiqueta del palet ${p.codigo || ""}`.trim());
  }

  function etiquetaParaImprimir(p, datos) {
    const ancho = datos?.etiqueta_ancho_mm || 105;
    const alto = datos?.etiqueta_alto_mm || 75;
    // Este @page va después de bascula.css: manda sobre el del justificante.
    return {
      html: `<style>@page { size: ${ancho}mm ${alto}mm; margin: 4mm; }</style>${etiquetaHTML(p)}`,
      titulo: `Etiqueta ${p.codigo || "palet"}`,
    };
  }

  // Tras enviar pesadas: si con ellas se ha completado algún palet, se
  // imprime su etiqueta sin que nadie lo pida. La tablet recuerda qué
  // palets completos conoce; uno que no conocía y se ha completado hoy es
  // nuevo. Si un palet vuelve a «en progreso» (se anula una pesada) y se
  // completa otra vez, su etiqueta vuelve a salir.
  // soloAnotar: al entrar solo se apuntan los que ya hay, para no
  // imprimir de golpe los de antes.
  async function etiquetasDePaletsCompletados({ soloAnotar = false } = {}) {
    const { data, error } = await db.rpc("bascula_palets");
    if (error) {
      anotarRed(error);
      notificarErrorEtiquetas(error);
      return;
    }
    if (!data) {
      notificarErrorEtiquetas(new Error("Respuesta vacía al consultar los palets."), false);
      return;
    }
    const cap = data.cajas_por_palet || 60;
    const completos = (data.palets || []).filter((p) => (p.num_cajas || 0) >= cap);
    const conocidos = almacen.leer(KEY_ETIQUETAS, null);
    almacen.guardar(KEY_ETIQUETAS, completos.map((p) => p.id));
    if (soloAnotar || !Array.isArray(conocidos)) return;

    const hoy = diaLocal();
    const nuevos = completos
      .filter((p) => !conocidos.includes(p.id) && p.fecha_completo === hoy)
      .sort((a, b) => (a.secuencia ?? 0) - (b.secuencia ?? 0));
    if (!nuevos.length) return;
    toast(nuevos.length === 1
      ? `Palet ${nuevos[0].codigo} completo: imprimiendo su etiqueta`
      : `${nuevos.length} palets completos: imprimiendo sus etiquetas`);
    nuevos.forEach((p) =>
      encolarImpresion(() => etiquetaParaImprimir(p, data), `la etiqueta del palet ${p.codigo || ""}`.trim()));
  }

  function notificarErrorEtiquetas(error, actualizarRed = true) {
    if (actualizarRed && error) anotarRed(error);
    console.error("No se pudieron comprobar los palets completos:", error);
    toast("No se pudieron comprobar los palets completos. Revisa la conexión.");
  }

  function cambiarVista(vista) {
    state.vista = vista;
    const palets = vista === "palets";
    document.querySelector(".bascula-main").hidden = palets;
    $("vistaPalets").hidden = !palets;
    $("btnVista").textContent = palets ? "⚖ Báscula" : "📦 Palets";
    // Al entrar se empieza siempre por los que están en progreso.
    if (palets) {
      state.paletsFiltro = "progreso";
      if (state.palets) pintarPalets();
      cargarPalets(true);
    }
  }

  // ------------------------------------------------------------------
  //  Acciones
  // ------------------------------------------------------------------
  function elegirAgricultor(id) {
    const a = state.agricultores.find((x) => x.id === id);
    if (!a) return;
    // Si ya había otro agricultor elegido es que se está corrigiendo la
    // selección: se mantiene el ciclo marcado (igual que las cajas tecleadas).
    // Si se empieza de cero, proponemos el último ciclo que se le apuntó en
    // esta campaña; si no tiene ninguno, el ciclo 1.
    if (!state.elegido) {
      state.ciclo = ["1", "2", "3"].includes(a.ultimo_ciclo) ? a.ultimo_ciclo : "1";
    }
    state.elegido = a;
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
    modificarCola((cola) => [...cola, entrada]);

    a.ultimo_ciclo = state.ciclo;
    // Las pesadas del mismo día se suman en un único registro: se enseña
    // también lo que lleva hoy en total.
    const totalHoy = cajasHoyDe(a.id);
    toast(`✓ ${a.nombre} · Ciclo ${state.ciclo} · ${resumenCajas({ cajas, vacias })}` +
      (totalHoy !== cajas ? ` · hoy ${totalHoy} cajas` : ""));
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

    enviarPendientes();
    if (imprimir) imprimirTrasEnvio(entrada);
  }

  // Espera a que la entrada llegue a la oficina (o se rechace), como mucho
  // ESPERA_IMPRIMIR_MS. Devuelve "enviada", "rechazada" o "pendiente" (sin
  // red, o el servidor tarda: sigue en la cola y se enviará sola).
  async function esperarEnvio(uuid) {
    const inicio = Date.now();
    while (Date.now() - inicio < ESPERA_IMPRIMIR_MS) {
      const p = leerCola().find((x) => x.uuid === uuid);
      if (!p) return "enviada";
      if (p.error) return "rechazada";
      // Sin red no tiene sentido esperar.
      if (!navigator.onLine || (state.falloRedEn >= inicio && !state.enviando)) return "pendiente";
      if (!state.enviando) enviarPendientes();
      await new Promise((r) => setTimeout(r, 300));
    }
    return "pendiente";
  }

  // Antes el justificante se imprimía al momento: si luego el servidor
  // rechazaba la entrada, el agricultor se iba con un papel firmado de algo
  // que no estaba en la oficina. Ahora:
  //  - aceptada: justificante normal;
  //  - rechazada: no se imprime y se avisa;
  //  - sin confirmar (sin red): se imprime marcado «PENDIENTE DE ENVÍO» y
  //    con la referencia, para poder cuadrarlo después.
  // Coge su turno en la cola de impresión ya, antes de esperar: así la
  // etiqueta de un palet que complete esta pesada sale detrás.
  function imprimirTrasEnvio(entrada) {
    toast("Enviando a la oficina…");
    encolarImpresion(async () => {
      const estado = await esperarEnvio(entrada.uuid);
      if (estado === "rechazada") {
        const p = leerCola().find((x) => x.uuid === entrada.uuid);
        alert(`No se ha impreso el justificante: la oficina no ha aceptado la entrada de ${entrada.nombre}.\n\n` +
          `${p?.error || ""}\n\nRevísala en la lista de hoy.`);
        return null;
      }
      return justificanteParaImprimir({ ...entrada, creado: entrada.pesada_en, pendiente: estado !== "enviada" });
    }, `el justificante de ${entrada.nombre}`);
  }

  async function anular(id) {
    const h = state.hoy.find((x) => x.id === id);
    if (!h) return;
    if (!confirm(`¿Anular la entrada de las ${hora(h.creado)}?\n${h.nombre} · Ciclo ${h.ciclo} · ${resumenCajas(h)}\n\nSe resta del total del día.`)) return;

    let { data, error } = await db.rpc("bascula_anular", { p_id: id });

    // Sus cajas ya están en un palet completo (con la etiqueta pegada,
    // seguramente): se pregunta antes de tocarlo.
    let paletTocado = null;
    if (error?.hint === "palet_completo") {
      if (!confirm(`${error.message}\n\n¿Anularla igualmente? Después habrá que corregir ese palet y volver a imprimir su etiqueta.`)) return;
      paletTocado = error.details;
      ({ data, error } = await db.rpc("bascula_anular", { p_id: id, p_forzar: true }));
    }
    if (error) {
      toast(esRechazo(error) ? error.message : "Sin conexión: no se puede anular ahora.");
      return;
    }
    if (data && paletTocado) {
      alert(`Entrada anulada.\n\nEl palet ${paletTocado} tiene ahora menos cajas: vuelve a imprimir su etiqueta.`);
    } else {
      toast(data ? "Entrada anulada" : "No se puede anular: corrígela desde la oficina");
    }
    cargarHoy().catch((error) => notificarErrorActualizacion("las entradas de hoy", error));
  }

  function descartarPendiente(uuid) {
    const p = state.pendientes.find((x) => x.uuid === uuid);
    if (!p) return;
    if (state.enviando && !p.error) {
      toast("Se está enviando: espera un momento y vuelve a intentarlo.");
      return;
    }
    if (!confirm(`¿Anular esta entrada sin enviar?\n${p.nombre} · Ciclo ${p.ciclo} · ${resumenCajas(p)}`)) return;
    const quitar = () => {
      modificarCola((cola) => cola.filter((x) => x.uuid !== uuid));
      pintarHoy();
      pintarEntrada();
      pintarEstadoRed();
    };
    // Si otra pestaña la está enviando justo ahora, descartarla aquí no la
    // pararía: llegaría a la oficina igualmente.
    if (navigator.locks && !p.error) {
      navigator.locks.request("bascula_envio", { ifAvailable: true }, (lock) => {
        if (lock) quitar();
        else toast("Se está enviando: espera un momento y vuelve a intentarlo.");
      });
      return;
    }
    quitar();
  }

  function reintentarPendiente(uuid) {
    const p = state.pendientes.find((x) => x.uuid === uuid);
    if (!p) return;
    modificarCola((cola) => cola.map((x) => (x.uuid === uuid ? { ...x, error: null } : x)));
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
      state.palets = null;
      state.paletsJSON = "";
      state.paletsHora = null;
      state.paletsFallo = false;
      state.paletsReq++;
      state.cargaFallida = false;
      cambiarVista("bascula");
      return;
    }
    if (!state.cargado) {
      state.cargado = true;
      // Primero se apuntan los palets completos que ya hay (no se
      // imprimen) y después se envía lo pendiente.
      cargarTodo()
        .then(() => etiquetasDePaletsCompletados({ soloAnotar: true }).catch(notificarErrorEtiquetas))
        .then(enviarPendientes);
    }
    temporizadores.push(
      setInterval(() => {
        if (state.cargaFallida || state.datosDeCache) cargarTodo().then(enviarPendientes);
        else cargarHoy().catch((error) => notificarErrorActualizacion("las entradas de hoy", error));
      }, REFRESCO_HOY_MS),
      setInterval(() => cargarAgricultores().catch((error) =>
        notificarErrorActualizacion("los agricultores", error)), REFRESCO_AGRICULTORES_MS),
      setInterval(enviarPendientes, REINTENTO_ENVIO_MS),
      setInterval(pintarFecha, REFRESCO_HOY_MS),
      setInterval(() => { if (state.vista === "palets") cargarPalets(); }, REFRESCO_HOY_MS),
    );
  }

  function configurarEventos() {
    $("loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      $("loginError").textContent = "";
      const btn = $("btnLogin");
      if (btn.disabled) return;
      btn.disabled = true;
      btn.textContent = "Entrando...";
      // Con el mismo bloqueo por intentos fallidos que la oficina.
      const mensaje = await LoginBloqueo.entrar(
        db, $("email").value.trim(), $("password").value);
      btn.disabled = false;
      btn.textContent = "Entrar";
      if (mensaje) {
        $("loginError").textContent = mensaje;
        $("password").value = "";
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
      cargarAgricultores().catch((error) => notificarErrorActualizacion("los agricultores", error));
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
      // En la vista de palets el teclado no apunta nada.
      if (state.vista !== "bascula") return;
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
        if (entrada?.error) {
          alert("Esta entrada no se ha guardado en la oficina: no se puede imprimir su justificante.");
        } else if (entrada) {
          imprimirJustificante(entrada);
        }
      }
    });

    $("btnVista").addEventListener("click", () =>
      cambiarVista(state.vista === "palets" ? "bascula" : "palets"));
    $("btnRecargarPalets").addEventListener("click", () => cargarPalets(true));
    $("paletsFiltro").addEventListener("click", (e) => {
      const b = e.target.closest("[data-filtro]");
      if (!b || b.dataset.filtro === state.paletsFiltro) return;
      state.paletsFiltro = b.dataset.filtro;
      pintarPalets();
    });
    $("listaPalets").addEventListener("click", (e) => {
      const b = e.target.closest("[data-etiqueta]");
      if (b) imprimirEtiqueta(b.dataset.etiqueta);
    });

    window.addEventListener("online", () => {
      pintarEstadoRed();
      // cargarHoy confirma que de verdad hay red y quita el aviso.
      if (state.cargaFallida || state.datosDeCache) cargarTodo().then(enviarPendientes);
      else {
        enviarPendientes();
        cargarHoy().catch((error) => notificarErrorActualizacion("las entradas de hoy", error));
      }
      if (state.vista === "palets") cargarPalets();
    });
    window.addEventListener("offline", () => {
      marcarSinRed();
      if (state.vista === "palets") pintarActualizado();
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
        cargarHoy().catch((error) => notificarErrorActualizacion("las entradas de hoy", error));
      }
    });
    // Si se intenta cerrar la pestaña con entradas sin enviar, avisamos.
    // (No se pierden, pero así nadie cree que ya están en la oficina.)
    // Otra pestaña ha cambiado la cola: se ve aquí también. Si ha enviado
    // algo, se trae el día para que no "desaparezca" de la lista.
    window.addEventListener("storage", (e) => {
      if (e.key !== KEY_PENDIENTES && e.key !== null) return;
      const antes = state.pendientes.length;
      state.pendientes = leerCola();
      pintarHoy();
      pintarEntrada();
      pintarEstadoRed();
      if (state.pendientes.length < antes && document.body.classList.contains("authed")) {
        cargarHoy().catch((error) => notificarErrorActualizacion("las entradas de hoy", error));
      }
    });
    window.addEventListener("beforeunload", (e) => {
      if (state.pendientes.length) e.preventDefault();
    });
  }

  async function iniciar() {
    state.pendientes = leerCola();
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
