// =====================================================================
//  Eventos globales de interfaz y arranque
// =====================================================================

(function initUiModule(App) {
  function configurarEventosInterfaz() {
    App.$("btnAnadirAgricultor").addEventListener("click", () => App.abrirModalAgricultor());
    App.$("btnAnadirRegistro").addEventListener("click", () => App.abrirModalRegistro());
    App.$("btnCajasCamara").addEventListener("click", App.verCajasCamara);
    App.$("btnExport").addEventListener("click", App.exportarExcel);

    App.$("btnOrdenFecha").addEventListener("click", () => {
      // Al ordenar por fecha se desagrupan las facturas.
      App.state.agrupadoPorFactura = false;
      App.state.ordenFechaAsc = !App.state.ordenFechaAsc;
      App.cargarRegistros();
    });

    App.$("cuerpoCamara").addEventListener("click", (e) => {
      const fila = e.target.closest("[data-agri-id]");
      if (!fila) return;
      const a = App.state.camaraAgricultores.find(
        (x) => String(x.id) === fila.dataset.agriId
      );
      if (!a) return;
      App.cerrarModal(App.dom.modalCamara);
      App.abrirAgricultor(a);
    });

    App.$("btnVolver").addEventListener("click", () => {
      App.mostrarVistaAgricultores();
      App.cargarAgricultores();
    });

    App.$("btnLimpiar").addEventListener("click", () => {
      App.$("buscarAgricultor").value = "";
      App.cargarAgricultores();
    });

    let debounce;
    App.$("buscarAgricultor").addEventListener("input", () => {
      clearTimeout(debounce);
      debounce = setTimeout(App.cargarAgricultores, 300);
    });

    document.querySelectorAll("[data-cerrar]").forEach((btn) => {
      btn.addEventListener("click", () => App.cerrarModal(App.$(btn.dataset.cerrar)));
    });
    // Los modales solo se cierran con su botón "Cerrar/Cancelar";
    // pulsar fuera (en el fondo) ya no los cierra.
  }

  function inicializarApp() {
    App.$("copyYear").textContent = new Date().getFullYear();
    App.configurarEventosAuth();
    App.configurarEventosAgricultores();
    App.configurarEventosCampanas();
    App.configurarEventosRegistros();
    configurarEventosInterfaz();
    App.initAuth();
  }

  Object.assign(App, {
    configurarEventosInterfaz,
    inicializarApp,
  });
})(window.App);
