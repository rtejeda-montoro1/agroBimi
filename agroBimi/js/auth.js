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

  // ------------------------------------------------------------------
  //  Bloqueo por intentos fallidos (anti fuerza bruta, lado cliente).
  //  Nota: es una disuasión de UX, no seguridad real. La protección de
  //  verdad la aplica Supabase en el servidor.
  // ------------------------------------------------------------------
  const LOGIN_MAX_FALLOS = 5;
  const LOGIN_BLOQUEO_MS = 24 * 60 * 60 * 1000; // 24 horas
  const KEY_FALLOS = "bimi_login_fallos";
  const KEY_BLOQUEO = "bimi_login_bloqueo_hasta";

  function leerFallos() {
    return parseInt(localStorage.getItem(KEY_FALLOS) || "0", 10) || 0;
  }

  function bloqueadoHasta() {
    return parseInt(localStorage.getItem(KEY_BLOQUEO) || "0", 10) || 0;
  }

  function estaBloqueado() {
    return Date.now() < bloqueadoHasta();
  }

  function resetIntentos() {
    localStorage.removeItem(KEY_FALLOS);
    localStorage.removeItem(KEY_BLOQUEO);
  }

  function textoTiempoRestante() {
    const ms = Math.max(0, bloqueadoHasta() - Date.now());
    const horas = Math.floor(ms / 3600000);
    const mins = Math.ceil((ms % 3600000) / 60000);
    return horas > 0 ? `${horas} h ${mins} min` : `${mins} min`;
  }

  // Solo contamos como fallo los errores de credenciales, no los de red.
  function esErrorCredenciales(error) {
    if (!error) return false;
    return error.status === 400 || /invalid|credential/i.test(error.message || "");
  }

  // Refleja el estado de bloqueo en el formulario. Devuelve true si bloqueado.
  function aplicarBloqueoUI() {
    const bloqueado = estaBloqueado();
    // Si había un bloqueo y ya ha expirado, empezamos de cero.
    if (!bloqueado && bloqueadoHasta() > 0) resetIntentos();
    App.$("btnLogin").disabled = bloqueado;
    App.$("email").disabled = bloqueado;
    App.$("password").disabled = bloqueado;
    if (bloqueado) {
      App.dom.loginError.textContent =
        `Acceso bloqueado por demasiados intentos fallidos. Inténtalo de nuevo en ${textoTiempoRestante()}.`;
    }
    return bloqueado;
  }

  async function initAuth() {
    const { data: { session } } = await App.db.auth.getSession();
    aplicarSesion(session);
    App.db.auth.onAuthStateChange((_evento, nuevaSesion) => aplicarSesion(nuevaSesion));
  }

  // El usuario de la báscula no tiene acceso a las tablas: si entra aquí
  // lo llevamos a su página en vez de enseñarle una app vacía.
  async function cargarDatosOIrABascula() {
    const { data: esBascula, error } = await App.db.rpc("es_bascula");
    if (!error && esBascula) {
      location.replace("bascula.html");
      return;
    }
    // Los parámetros (precios, IVA, emisor) los necesitan las
    // liquidaciones y el control de cajas.
    App.cargarParametros();
    App.cargarCampanas();
    App.cargarAgricultores();
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
    App.state.datosCargados = false;
    App.state.agricultoresTodos = [];
    App.dom.listaAgricultores.innerHTML = "";
    // Al salir se cierra todo lo que hubiera abierto: los modales no deben
    // quedar por delante de la pantalla de login con datos a la vista.
    document.querySelectorAll(".modal-backdrop.open").forEach(App.cerrarModal);
    App.mostrarVistaAgricultores();
  }

  function configurarEventosAuth() {
    App.dom.loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      App.dom.loginError.textContent = "";

      // Si ya está bloqueado, ni siquiera intentamos autenticar.
      if (aplicarBloqueoUI()) return;

      const btn = App.$("btnLogin");
      btn.disabled = true;
      btn.textContent = "Entrando...";

      const { error } = await App.db.auth.signInWithPassword({
        email: App.$("email").value.trim(),
        password: App.$("password").value,
      });

      btn.textContent = "Entrar";

      if (!error) {
        resetIntentos();
        btn.disabled = false;
        App.dom.loginForm.reset();
        return;
      }

      // Errores de red no cuentan como intento fallido.
      if (!esErrorCredenciales(error)) {
        btn.disabled = false;
        App.dom.loginError.textContent = "No se pudo conectar. Inténtalo de nuevo.";
        return;
      }

      const fallos = leerFallos() + 1;
      localStorage.setItem(KEY_FALLOS, String(fallos));

      if (fallos >= LOGIN_MAX_FALLOS) {
        localStorage.setItem(KEY_BLOQUEO, String(Date.now() + LOGIN_BLOQUEO_MS));
        aplicarBloqueoUI();
      } else if (fallos === LOGIN_MAX_FALLOS - 1) {
        btn.disabled = false;
        App.dom.loginError.textContent =
          "⚠ Credenciales incorrectas. Si vuelves a fallar, el acceso se bloqueará durante 24 horas.";
      } else {
        btn.disabled = false;
        App.dom.loginError.textContent = "Email o contraseña incorrectos.";
      }
    });

    // Solo en este navegador: salir en la oficina no debe cerrar la sesión
    // en otro equipo.
    App.$("btnLogout").addEventListener("click", async () => {
      await App.db.auth.signOut({ scope: "local" });
      App.toast("Sesion cerrada");
    });

    // Al cargar, si venimos de un bloqueo previo, reflejarlo en el formulario.
    aplicarBloqueoUI();
  }

  Object.assign(App, {
    initAuth,
    aplicarSesion,
    configurarEventosAuth,
  });
})(window.App);
