// =====================================================================
//  Copia digital de una salida (albaran.html)
//  ---------------------------------------------------------------------
//  Es lo que se abre al escanear el QR del CMR o del albarán: por si paran
//  al transportista, la autoridad ve la carta de porte y el albarán tal y
//  como se imprimieron. No hace falta iniciar sesión: la base de datos solo
//  devuelve la copia del albarán cuyo código va en el enlace
//  (albaran_copia, schema.sql sección 23). Un albarán anulado ya no se ve.
// =====================================================================

(function initAlbaranPublico(App) {
  // El código va en «?t=»: 32 caracteres hexadecimales (con o sin guiones).
  function codigoDeEnlace(search) {
    const m = String(search || "").match(/[?&]t=([0-9a-fA-F-]{32,36})(?:&|$)/);
    if (!m) return null;
    const codigo = m[1].replace(/-/g, "");
    return /^[0-9a-fA-F]{32}$/.test(codigo) ? codigo.toLowerCase() : null;
  }

  function mostrarAviso(estado, texto) {
    estado.textContent = texto;
    estado.hidden = false;
  }

  // Del CMR se enseña el ejemplar del porteador (el que lleva el camión) y
  // después el albarán, con el mismo QR que en el papel.
  async function mostrarCopia({ db, search, href, documento, estado, barra }) {
    const codigo = codigoDeEnlace(search);
    if (!codigo) {
      mostrarAviso(estado, "El enlace no es válido: vuelve a escanear el código QR.");
      return false;
    }

    const { data, error } = await db.rpc("albaran_copia", { p_token: codigo });
    if (error) {
      mostrarAviso(estado, "No se ha podido cargar el albarán. Comprueba la conexión y vuelve a intentarlo.");
      return false;
    }
    if (!data || !data.albaran) {
      mostrarAviso(estado, "Este albarán no existe o ha sido anulado.");
      return false;
    }

    estado.hidden = true;
    documento.innerHTML = App.htmlSalida(data, {
      ejemplares: [App.EJEMPLARES_CMR[2]],
      url: App.urlCopia(data.albaran.token, href),
    });
    if (barra) barra.hidden = false;
    return data;
  }

  App.codigoDeEnlace = codigoDeEnlace;
  App.mostrarCopia = mostrarCopia;

  const documento = document.getElementById && document.getElementById("documento");
  if (!documento) return;

  const estado = document.getElementById("estado");
  const barra = document.getElementById("barra");
  document.getElementById("btnImprimir").addEventListener("click", () => window.print());

  const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  mostrarCopia({ db, search: location.search, href: location.href, documento, estado, barra })
    .then((datos) => {
      if (datos) document.title = `Albarán ${datos.albaran.numero || ""} · copia digital`.trim();
    })
    .catch(() => mostrarAviso(estado, "No se ha podido cargar el albarán. Vuelve a intentarlo."));
})(window.App);
