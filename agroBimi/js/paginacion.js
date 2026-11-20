// =====================================================================
//  Listados por páginas
//  ---------------------------------------------------------------------
//  Para los listados que crecen sin límite con los años (palets,
//  liquidaciones, albaranes de salida, registros de una campaña): los filtros se aplican en el
//  servidor y solo se traen 150 filas cada vez, así la ventana abre igual
//  de rápido con 100 filas que con 100.000.
//
//  Cada listado tiene dos botoneras iguales, encima y debajo de la tabla,
//  con estos ids (nombre = "Palets", "Liquidaciones"...):
//      paginacion<nombre>, pagina<nombre>,
//      btnPaginaAnterior<nombre>, btnPaginaSiguiente<nombre>
//  y los mismos terminados en "Abajo" para la de debajo.
// =====================================================================

(function initPaginacionModule(App) {
  const FILAS_POR_PAGINA = 150;
  const BOTONERAS = ["", "Abajo"];

  // opciones:
  //   nombre       sufijo de los ids de las botoneras
  //   consulta     ({ contar }) => consulta de Supabase con filtros y orden
  //   cuerpoId     tbody del listado
  //   columnas     columnas de la tabla (para la fila de "cargando")
  //   texto        qué se carga, para los mensajes ("los palets")
  //   contadorId   el contador de encima de la tabla: al pasar de página
  //                desde abajo se sube hasta él
  //   alCargar     (filas, { total, error }) => pinta la página
  //   local        opcional: () => todas las filas ya filtradas y ordenadas,
  //                o null. Si da filas, las páginas salen de ahí sin
  //                preguntar al servidor (p. ej. palets: lo que hay en cámara
  //                ya está descargado entero).
  function crearPaginador({ nombre, consulta, cuerpoId, columnas, texto, contadorId, alCargar,
                            local = null, porPagina = FILAS_POR_PAGINA }) {
    let pagina = 0;      // empieza en 0
    let total = 0;
    let filas = [];
    let peticion = 0;    // descarta respuestas de filtros o páginas ya cambiados

    const paginas = () => Math.max(1, Math.ceil(total / porPagina));

    function pintarBotoneras() {
      const primero = pagina * porPagina + 1;
      const textoPagina = filas.length > 0
        ? `${App.fmtNum(primero)}–${App.fmtNum(primero + filas.length - 1)} · página ${pagina + 1} de ${paginas()}`
        : "";
      BOTONERAS.forEach((sufijo) => {
        App.$(`pagina${nombre}${sufijo}`).textContent = textoPagina;
        App.$(`btnPaginaAnterior${nombre}${sufijo}`).disabled = pagina === 0;
        App.$(`btnPaginaSiguiente${nombre}${sufijo}`).disabled = pagina >= paginas() - 1;
        App.$(`paginacion${nombre}${sufijo}`).hidden = paginas() <= 1;
      });
    }

    // contar: pedir también el total. Al solo pasar de página no hace falta
    // (los filtros son los mismos) y contar todas las filas cuesta.
    async function cargar({ contar = true } = {}) {
      const id = ++peticion;
      const todas = local?.();
      if (todas) {
        total = todas.length;
        pagina = Math.min(pagina, paginas() - 1);
        const inicio = pagina * porPagina;
        filas = todas.slice(inicio, inicio + porPagina);
        pintarBotoneras();
        alCargar(filas, { total, error: null });
        return true;
      }
      App.$(cuerpoId).innerHTML = App.spinnerFila(columnas, `Cargando ${texto}...`);

      const desde = pagina * porPagina;
      const { data, error, count } = await consulta({ contar }).range(desde, desde + porPagina - 1);
      if (id !== peticion) return false;

      if (error) {
        App.toast(`Error al cargar ${texto}: ${error.message}`);
        filas = [];
        total = 0;
        pintarBotoneras();
        alCargar(filas, { total, error });
        App.$(cuerpoId).innerHTML = App.filaMensaje(columnas, `No se pudieron cargar ${texto}.`, "error");
        return false;
      }

      filas = data || [];
      if (contar) total = count ?? filas.length;
      // Si al borrar o anular la página se queda vacía, se va a la última.
      if (filas.length === 0 && pagina > 0 && total > 0) {
        pagina = paginas() - 1;
        return cargar();
      }
      pintarBotoneras();
      alCargar(filas, { total, error: null });
      return true;
    }

    // Al cambiar un filtro se vuelve a la primera página.
    function filtrar() {
      pagina = 0;
      return cargar();
    }

    // Desde la botonera de abajo, la página nueva se enseña desde su
    // primera fila: si no, se quedaría mostrando el final de la tabla.
    async function irA(delta, { subir = false } = {}) {
      const nueva = Math.min(Math.max(pagina + delta, 0), paginas() - 1);
      if (nueva === pagina) return;
      pagina = nueva;
      if (subir) App.$(contadorId).scrollIntoView?.({ block: "start", behavior: "smooth" });
      await cargar({ contar: false });
    }

    function conectar() {
      BOTONERAS.forEach((sufijo) => {
        const subir = sufijo === "Abajo";
        App.$(`btnPaginaAnterior${nombre}${sufijo}`).addEventListener("click", () => irA(-1, { subir }));
        App.$(`btnPaginaSiguiente${nombre}${sufijo}`).addEventListener("click", () => irA(1, { subir }));
      });
    }

    return {
      cargar,
      filtrar,
      irA,
      conectar,
      filas: () => filas,
      total: () => total,
    };
  }

  // Texto escrito por el usuario dentro de un ilike: % y _ son comodines.
  function patronContiene(texto) {
    return `%${String(texto).replace(/[\\%_]/g, "\\$&")}%`;
  }

  Object.assign(App, { crearPaginador, patronContiene, FILAS_POR_PAGINA });
})(window.App);
