// =====================================================================
//  Autenticacion
// =====================================================================

(function initAuthModule(App) {
  // Cierre de sesión automático tras 5 minutos sin interacción en la UI.
  const INACTIVIDAD_MS = 5 * 60 * 1000;
  const EVENTOS_ACTIVIDAD = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"];
  let temporizadorInactividad = null;
  let ultimaActividad = 0;
  let vigilando = false;

  function reiniciarTemporizador() {
    if (!vigilando) return;
    clearTimeout(temporizadorInactividad);
    temporizadorInactividad = setTimeout(cerrarPorInactividad, INACTIVIDAD_MS);
  }

  // Se llama en cada evento de actividad; limita el reinicio a 1/seg.
  function alHaberActividad() {
    const ahora = Date.now();
    if (ahora - ultimaActividad < 1000) return;
    ultimaActividad = ahora;
    reiniciarTemporizador();
  }

  async function cerrarPorInactividad() {
    detenerVigilanciaInactividad();
    await App.db.auth.signOut();
    App.toast("Sesión cerrada por inactividad");
  }

  function iniciarVigilanciaInactividad() {
    if (vigilando) return;
    vigilando = true;
    ultimaActividad = Date.now();
    EVENTOS_ACTIVIDAD.forEach((ev) =>
      document.addEventListener(ev, alHaberActividad, { passive: true }));
    reiniciarTemporizador();
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

  function aplicarSesion(session) {
    const haySesion = !!session;
    document.body.classList.toggle("authed", haySesion);

    if (haySesion) {
      iniciarVigilanciaInactividad();
      if (!App.state.datosCargados) {
        App.state.datosCargados = true;
        App.cargarCampanas();
        App.cargarAgricultores();
      }
      return;
    }

    detenerVigilanciaInactividad();
    App.state.datosCargados = false;
    App.dom.listaAgricultores.innerHTML = "";
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

    App.$("btnLogout").addEventListener("click", async () => {
      await App.db.auth.signOut();
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
