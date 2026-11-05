// =====================================================================
//  Bloqueo del login por intentos fallidos (oficina y báscula)
//  El contador está en el servidor, por email (schema.sql, sección 22):
//  5 contraseñas incorrectas seguidas bloquean ese email 24 horas en
//  cualquier navegador o equipo.
//
//  entrar() hace todo el login: mira el bloqueo, intenta entrar, apunta
//  el fallo o pone el contador a cero, y devuelve el mensaje a mostrar
//  (vacío si ha entrado).
// =====================================================================

window.LoginBloqueo = (function () {
  // Antes el contador se guardaba en el navegador: se borra lo que quede.
  try {
    localStorage.removeItem("bimi_login_fallos");
    localStorage.removeItem("bimi_login_bloqueo_hasta");
  } catch { /* sin almacenamiento */ }

  function tiempoRestante(hasta) {
    const total = Math.max(1, Math.ceil((new Date(hasta).getTime() - Date.now()) / 60000));
    const horas = Math.floor(total / 60);
    const mins = total % 60;
    if (!horas) return `${mins} min`;
    return mins ? `${horas} h ${mins} min` : `${horas} h`;
  }

  function textoBloqueado(hasta) {
    return "Acceso bloqueado por demasiados intentos fallidos. " +
      `Inténtalo de nuevo en ${tiempoRestante(hasta)}.`;
  }

  // Solo cuentan las contraseñas incorrectas, no los fallos de red.
  function esErrorCredenciales(error) {
    return error.code === "invalid_credentials" || error.status === 400 ||
      /invalid|credential/i.test(error.message || "");
  }

  // Si el servidor no responde, no se bloquea a nadie: el login de
  // Supabase dirá si hay red o no.
  async function bloqueadoHasta(db, email) {
    const { data, error } = await db.rpc("login_bloqueado", { p_email: email });
    return error ? null : data;
  }

  async function entrar(db, email, password) {
    const hasta = await bloqueadoHasta(db, email);
    if (hasta) return textoBloqueado(hasta);

    const { error } = await db.auth.signInWithPassword({ email, password });

    if (!error) {
      const { data: ok, error: e2 } = await db.rpc("login_correcto");
      if (e2 || ok !== false) return "";
      // Se bloqueó mientras tanto (p. ej. fallos desde otro equipo).
      await db.auth.signOut({ scope: "local" });
      return textoBloqueado((await bloqueadoHasta(db, email)) || Date.now() + 60000);
    }

    if (!esErrorCredenciales(error)) return "No se pudo conectar. Inténtalo de nuevo.";

    const { data: r } = await db.rpc("login_fallido", { p_email: email });
    if (r?.bloqueado_hasta) return textoBloqueado(r.bloqueado_hasta);
    if (r?.quedan === 1) {
      return "⚠ Email o contraseña incorrectos. Si vuelves a fallar, " +
        "el acceso se bloqueará durante 24 horas.";
    }
    return "Email o contraseña incorrectos.";
  }

  return { entrar };
})();
