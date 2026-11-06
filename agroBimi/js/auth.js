// =====================================================================
//  Autenticacion
// =====================================================================

(function initAuthModule(App) {
  // Cierre de sesión automático tras 20 minutos sin interacción.
  //
  // La actividad es la de TODAS las pestañas de la app en este navegador:
  // cada una apunta la hora de su última actividad en localStorage y el
  // cierre solo llega cuando ninguna se ha usado en 20 minutos. Antes cada
  // pestaña contaba lo suyo: una olvidada en segundo plano cerraba la
  // sesión de la que se estaba usando.
  // El cierre es solo de este navegador (scope "local"): con el "global"
  // por defecto se cerraba también la sesión en los demás equipos.
  const INACTIVIDAD_MS = 20 * 60 * 1000;
  const EVENTOS_ACTIVIDAD = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"];
  const KEY_ACTIVIDAD = "bimi_ultima_actividad";
  let temporizadorInactividad = null;
  let ultimaActividad = 0;
  let vigilando = false;
  let generacionCarga = 0;

  // La última actividad de cualquier pestaña (la propia si no hay
  // localStorage, p. ej. en modo privado).
  function ultimaActividadCompartida() {
    let otra = 0;
    try { otra = Number(localStorage.getItem(KEY_ACTIVIDAD)) || 0; } catch { /* sin almacenamiento */ }
    return Math.max(ultimaActividad, otra);
  }

  function programarComprobacion() {
    if (!vigilando) return;
    clearTimeout(temporizadorInactividad);
    const quedan = ultimaActividadCompartida() + INACTIVIDAD_MS - Date.now();
    temporizadorInactividad = setTimeout(comprobarInactividad, Math.max(quedan, 1000));
  }

  // Al vencer el plazo se mira si otra pestaña ha tenido actividad
  // mientras tanto: si es así, se vuelve a esperar.
  function comprobarInactividad() {
    if (!vigilando) return;
    if (Date.now() - ultimaActividadCompartida() < INACTIVIDAD_MS) {
      programarComprobacion();
      return;
    }
    cerrarPorInactividad();
  }

  // Se llama en cada evento de actividad; se apunta como mucho cada 5 s
  // (mousemove dispara decenas de eventos por segundo).
  function alHaberActividad() {
    const ahora = Date.now();
    if (ahora - ultimaActividad < 5000) return;
    ultimaActividad = ahora;
    try { localStorage.setItem(KEY_ACTIVIDAD, String(ahora)); } catch { /* sin almacenamiento */ }
    programarComprobacion();
  }

  async function cerrarPorInactividad() {
    detenerVigilanciaInactividad();
    // Las demás pestañas se enteran solas: Supabase avisa del cierre a
    // todas las del mismo navegador.
    await App.db.auth.signOut({ scope: "local" });
    App.toast("Sesión cerrada por inactividad");
  }

  function iniciarVigilanciaInactividad() {
    if (vigilando) return;
    vigilando = true;
    ultimaActividad = Date.now();
    try { localStorage.setItem(KEY_ACTIVIDAD, String(ultimaActividad)); } catch { /* sin almacenamiento */ }
    EVENTOS_ACTIVIDAD.forEach((ev) =>
      document.addEventListener(ev, alHaberActividad, { passive: true }));
    programarComprobacion();
  }

  function detenerVigilanciaInactividad() {
    if (!vigilando) return;
    vigilando = false;
    clearTimeout(temporizadorInactividad);
    EVENTOS_ACTIVIDAD.forEach((ev) =>
      document.removeEventListener(ev, alHaberActividad, { passive: true }));
  }

  async function initAuth() {
    const { data: { session } } = await App.db.auth.getSession();
    aplicarSesion(session);
    App.db.auth.onAuthStateChange((_evento, nuevaSesion) => aplicarSesion(nuevaSesion));
  }

  // El usuario de la báscula no tiene acceso a las tablas: si entra aquí
  // lo llevamos a su página en vez de enseñarle una app vacía. La báscula
  // guarda su propia sesión (no comparte la de la oficina), así que allí
  // tendrá que entrar otra vez; aquí se cierra para no dejarla abierta.
  async function cargarDatosOIrABascula() {
    const generacion = generacionCarga;
    let detalle = "";
    try {
      const { data: esBascula, error } = await App.db.rpc("es_bascula");
      if (error) throw error;
      if (esBascula) {
        await App.db.auth.signOut({ scope: "local" });
        location.replace("bascula.html");
        return;
      }

      // Los parámetros (precios, IVA, emisor) los necesitan las
      // liquidaciones y el control de cajas.
      const resultados = await Promise.all([
        App.cargarParametros(),
        App.cargarCampanas(),
        App.cargarAgricultores(),
      ]);
      if (generacion !== generacionCarga || !document.body.classList.contains("authed")) return;
      if (resultados.every(Boolean)) return;
    } catch (error) {
      if (generacion !== generacionCarga || !document.body.classList.contains("authed")) return;
      detalle = error?.message || "";
    }

    if (generacion !== generacionCarga || !document.body.classList.contains("authed")) return;
    App.state.datosCargados = false;
    mostrarErrorCargaInicial(detalle);
  }

  function mostrarErrorCargaInicial(detalle = "") {
    const mensaje = detalle
      ? `<br>${App.escapar(detalle)}`
      : "";
    App.dom.listaAgricultores.innerHTML =
      `<div class="error">No se pudieron cargar todos los datos iniciales.${mensaje}<br>` +
      "Comprueba la conexión y vuelve a intentarlo." +
      '<br><button type="button" class="btn-primary" data-reintentar-carga>Reintentar carga</button></div>';
  }

  function configurarReintentoCarga() {
    App.dom.listaAgricultores.addEventListener("click", (e) => {
      const boton = e.target.closest("[data-reintentar-carga]");
      if (!boton || App.state.datosCargados) return;
      e.stopPropagation();
      App.state.datosCargados = true;
      boton.disabled = true;
      boton.textContent = "Reintentando...";
      cargarDatosOIrABascula();
    });
  }

  function aplicarSesion(session) {
    const haySesion = !!session;
    document.body.classList.toggle("authed", haySesion);

    if (haySesion) {
      iniciarVigilanciaInactividad();
      if (!App.state.datosCargados) {
        App.state.datosCargados = true;
        cargarDatosOIrABascula();
      }
      return;
    }

    detenerVigilanciaInactividad();
    generacionCarga++;
    App.state.datosCargados = false;
    App.state.agricultoresTodos = [];
    App.dom.listaAgricultores.innerHTML = "";
    // Al salir se cierra todo lo que hubiera abierto: los modales no deben
    // quedar por delante de la pantalla de login con datos a la vista.
    document.querySelectorAll(".modal-backdrop.open").forEach(App.cerrarModal);
    App.mostrarVistaAgricultores();
  }

  function configurarEventosAuth() {
    configurarReintentoCarga();

    // El bloqueo por intentos fallidos lo lleva el servidor
    // (js/login-bloqueo.js).
    App.dom.loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      App.dom.loginError.textContent = "";
      const btn = App.$("btnLogin");
      if (btn.disabled) return;
      btn.disabled = true;
      btn.textContent = "Entrando...";
      const mensaje = await LoginBloqueo.entrar(
        App.db, App.$("email").value.trim(), App.$("password").value);
      btn.disabled = false;
      btn.textContent = "Entrar";
      if (mensaje) {
        App.dom.loginError.textContent = mensaje;
        App.$("password").value = "";
        return;
      }
      App.dom.loginForm.reset();
    });

    // Solo en este navegador: salir en la oficina no debe cerrar la sesión
    // en otro equipo.
    App.$("btnLogout").addEventListener("click", async () => {
      await App.db.auth.signOut({ scope: "local" });
      App.toast("Sesion cerrada");
    });
  }

  Object.assign(App, {
    initAuth,
    aplicarSesion,
    configurarEventosAuth,
  });
})(window.App);
