// =====================================================================
//  Utilidades compartidas
// =====================================================================

(function initUtils(App) {
  function actualizarContador(idElem, cantidad, singular, plural) {
    App.$(idElem).textContent = `${cantidad} ${cantidad === 1 ? singular : plural}`;
  }

  function cerrarModal(m) {
    m.classList.remove("open");
  }

  function formatearFecha(iso) {
    if (!iso) return "—";
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  }

  function escapar(txt) {
    const div = document.createElement("div");
    div.textContent = txt;
    return div.innerHTML;
  }

  function valor(v) {
    if (v === null || v === undefined || v === "") return "—";
    return escapar(String(v));
  }

  function toast(msg) {
    const t = App.$("toast");
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2500);
  }

  function fmtCodigo(codigo) {
    return codigo == null ? "—" : String(codigo).padStart(3, "0");
  }

  function campanaNombre(id) {
    if (!id) return "—";
    const c = App.state.campanasActuales.find((x) => x.id === id);
    return c ? c.nombre : "—";
  }

  function mostrarVistaAgricultores() {
    App.state.agricultorAbierto = null;
    App.dom.vistaRegistros.hidden = true;
    App.dom.vistaAgricultores.hidden = false;
  }

  function mostrarVistaRegistros() {
    App.dom.vistaAgricultores.hidden = true;
    App.dom.vistaRegistros.hidden = false;
  }

  Object.assign(App, {
    actualizarContador,
    cerrarModal,
    formatearFecha,
    escapar,
    valor,
    toast,
    fmtCodigo,
    campanaNombre,
    mostrarVistaAgricultores,
    mostrarVistaRegistros,
  });
})(window.App);
