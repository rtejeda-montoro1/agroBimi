// =====================================================================
//  Eventos globales de interfaz y arranque
// =====================================================================

(function initUiModule(App) {
  function configurarEventosInterfaz() {
    App.$("btnAnadirAgricultor").addEventListener("click", () => App.abrirModalAgricultor());
    App.$("btnAnadirRegistro").addEventListener("click", () => App.abrirModalRegistro());
    App.$("btnExport").addEventListener("click", App.exportarExcel);

    App.$("btnOrdenFecha").addEventListener("click", () => {
      // Al ordenar por fecha se desagrupan las facturas.
      App.state.agrupadoPorFactura = false;
      App.state.ordenFechaAsc = !App.state.ordenFechaAsc;
      App.cargarRegistros();
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
      btn.addEventListener("click", () => {
        const modal = App.$(btn.dataset.cerrar);
        // Si hay datos escritos sin guardar, pedimos confirmación antes de cerrar.
        if (App.modalTieneCambios(modal) &&
            !confirm("Tienes cambios sin guardar. ¿Cerrar y descartarlos?")) {
          return;
        }
        App.cerrarModal(modal);
      });
    });
    // Los modales solo se cierran con su botón "Cerrar/Cancelar";
    // pulsar fuera (en el fondo) ya no los cierra.
  }

  // ------------------------------------------------------------------
  //  Scroll horizontal siempre a mano en las tablas anchas
  //  La barra de scroll de una tabla ancha está al final de la tabla: con
  //  muchos registros había que bajar del todo para moverse a los lados.
  //  Debajo de cada tabla se pone una barra propia, pegada al borde de
  //  abajo de la pantalla (o del modal) mientras la tabla se ve. Solo
  //  aparece si la tabla no cabe a lo ancho, y la de la tabla se oculta
  //  para no ver dos (con el dedo o con Mayús + rueda se sigue moviendo).
  //  No es la barra del navegador: en Chrome el tirador apenas se
  //  distinguía del carril. Es un carril y un tirador dibujados aquí:
  //    - el tirador se arrastra (ratón o dedo);
  //    - un clic en el carril lleva la tabla a ese punto.
  // ------------------------------------------------------------------
  function prepararScrollFlotante(wrap) {
    const barra = document.createElement("div");
    barra.className = "scroll-flotante";
    barra.setAttribute("aria-hidden", "true");
    const tirador = document.createElement("div");
    tirador.className = "scroll-flotante-tirador";
    barra.appendChild(tirador);
    wrap.after(barra);
    wrap.classList.add("con-scroll-flotante");

    // Medidas: cuánto se puede desplazar la tabla y cuánto el tirador.
    const medidas = () => {
      const recorridoTabla = wrap.scrollWidth - wrap.clientWidth;
      const ancho = barra.clientWidth;
      const anchoTirador = Math.max(60, Math.round(ancho * (wrap.clientWidth / wrap.scrollWidth)));
      return { recorridoTabla, ancho, anchoTirador, recorridoTirador: Math.max(1, ancho - anchoTirador) };
    };

    const pintar = () => {
      const m = medidas();
      const sobra = m.recorridoTabla > 1;
      barra.hidden = !sobra;
      if (!sobra) return;
      tirador.style.width = `${m.anchoTirador}px`;
      const x = (wrap.scrollLeft / m.recorridoTabla) * m.recorridoTirador;
      tirador.style.transform = `translateX(${Math.round(x)}px)`;
    };

    // La posición del tirador (en px dentro del carril) → scroll de la tabla.
    const irA = (xTirador) => {
      const m = medidas();
      const x = Math.min(Math.max(xTirador, 0), m.recorridoTirador);
      wrap.scrollLeft = (x / m.recorridoTirador) * m.recorridoTabla;
    };

    let arrastre = null; // { inicioX, inicioTirador }
    tirador.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const m = medidas();
      arrastre = {
        inicioX: e.clientX,
        inicioTirador: (wrap.scrollLeft / m.recorridoTabla) * m.recorridoTirador,
      };
      try { tirador.setPointerCapture(e.pointerId); } catch { /* sin captura: sigue funcionando sobre el tirador */ }
      barra.classList.add("arrastrando");
    });
    tirador.addEventListener("pointermove", (e) => {
      if (!arrastre) return;
      irA(arrastre.inicioTirador + (e.clientX - arrastre.inicioX));
    });
    const soltar = () => {
      arrastre = null;
      barra.classList.remove("arrastrando");
    };
    tirador.addEventListener("pointerup", soltar);
    tirador.addEventListener("pointercancel", soltar);

    // Clic en el carril: el tirador se centra donde se ha pulsado.
    barra.addEventListener("pointerdown", (e) => {
      if (e.target !== barra) return;
      e.preventDefault();
      const m = medidas();
      irA(e.clientX - barra.getBoundingClientRect().left - m.anchoTirador / 2);
    });

    wrap.addEventListener("scroll", pintar, { passive: true });
    // Cambia al cargar filas, al abrir un modal o al cambiar la ventana.
    const observador = new ResizeObserver(pintar);
    observador.observe(wrap);
    observador.observe(barra);
    if (wrap.firstElementChild) observador.observe(wrap.firstElementChild);
    pintar();
  }

  function inicializarApp() {
    if ("ResizeObserver" in window) {
      document.querySelectorAll(".tabla-wrap").forEach(prepararScrollFlotante);
    }
    App.$("copyYear").textContent = new Date().getFullYear();
    // Todos los calendarios de la app quedan topados en el día de hoy.
    App.limitarFechasAHoy();
    App.configurarEventosAuth();
    App.configurarEventosAgricultores();
    App.configurarEventosCampanas();
    App.configurarEventosRegistros();
    App.configurarEventosPlantas();
    App.configurarEventosCajas();
    App.configurarEventosLiquidaciones();
    App.configurarEventosFacturas();
    App.configurarEventosPalets();
    App.configurarEventosSalidas();
    App.configurarEventosAjustes();
    configurarEventosInterfaz();
    App.initAuth();
  }

  Object.assign(App, {
    configurarEventosInterfaz,
    inicializarApp,
  });
})(window.App);
