// =====================================================================
//  Utilidades compartidas
// =====================================================================

(function initUtils(App) {
  function actualizarContador(idElem, cantidad, singular, plural) {
    App.$(idElem).textContent = `${cantidad} ${cantidad === 1 ? singular : plural}`;
  }

  function cerrarModal(m) {
    if (m) m.classList.remove("open");
  }

  // Abre un modal dejándolo listo: topa sus calendarios en el día de hoy
  // (la pestaña puede llevar abierta desde ayer) y guarda la "foto" del
  // formulario para detectar cambios sin guardar al cerrarlo.
  function abrirModal(m) {
    if (!m) return;
    App.limitarFechasAHoy(m);
    m.classList.add("open");
    App.snapshotModal(m);
  }

  // ---- Detección de cambios sin guardar en un modal ------------------
  // Serializa los campos editables del formulario del modal para poder
  // comparar el estado actual con el que había al abrirlo.
  function serializarForm(form) {
    if (!form) return "";
    return Array.from(form.elements)
      .filter((el) =>
        el.id && !el.disabled && el.type !== "hidden" &&
        ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName))
      .map((el) => `${el.id}=${el.value}`)
      .join("");
  }

  // Guarda la "foto" del formulario. Se llama al abrir el modal (después
  // de rellenar/resetear los campos).
  function snapshotModal(modal) {
    if (modal) modal._snapshot = serializarForm(modal.querySelector("form"));
  }

  // true si el formulario del modal difiere de su foto inicial.
  function modalTieneCambios(modal) {
    if (!modal) return false;
    const form = modal.querySelector("form");
    if (!form || modal._snapshot == null) return false;
    return serializarForm(form) !== modal._snapshot;
  }

  function formatearFecha(iso) {
    if (!iso) return "—";
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  }

  // ---- Fechas: nunca se admiten días futuros -------------------------
  // Fecha de hoy en formato ISO (aaaa-mm-dd) usando la hora LOCAL. Con
  // toISOString() se usaría UTC y de madrugada podría salir el día anterior.
  function hoyISO() {
    const d = new Date();
    const mes = String(d.getMonth() + 1).padStart(2, "0");
    const dia = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mes}-${dia}`;
  }

  // Pone el tope "hoy" en todos los calendarios que haya dentro de raiz:
  // el navegador deshabilita los días futuros en el propio selector.
  // Se llama al arrancar y al abrir los modales (por si la pestaña se
  // queda abierta y cambia el día).
  function limitarFechasAHoy(raiz = document) {
    const hoy = hoyISO();
    raiz.querySelectorAll('input[type="date"]').forEach((el) => {
      el.max = hoy;
    });
  }

  function esFechaFutura(iso) {
    return Boolean(iso) && iso > hoyISO();
  }

  // Primer y último día del mes de una fecha ISO. Se usan para proponer el
  // periodo de una liquidación (por defecto, el mes en curso).
  function primerDiaMes(iso = hoyISO()) {
    return `${iso.slice(0, 7)}-01`;
  }

  function ultimoDiaMes(iso = hoyISO()) {
    const [y, m] = iso.split("-").map(Number);
    const dia = new Date(y, m, 0).getDate(); // día 0 del mes siguiente = último de este
    return `${iso.slice(0, 7)}-${String(dia).padStart(2, "0")}`;
  }

  // true si la fecha ISO está dentro del rango (extremos incluidos). Los
  // límites vacíos no filtran.
  function fechaEnRango(iso, desde, hasta) {
    if (!iso) return !desde && !hasta;
    if (desde && iso < desde) return false;
    if (hasta && iso > hasta) return false;
    return true;
  }

  // ---- Números e importes ---------------------------------------------
  // Convierte a número seguro: null, "" o texto no numérico valen 0. Así
  // las sumas nunca acaban en NaN por un campo vacío.
  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function fmtNum(v, decimales = 0) {
    if (v === null || v === undefined || v === "" || !Number.isFinite(Number(v))) return "—";
    return new Intl.NumberFormat("es-ES", {
      minimumFractionDigits: decimales,
      maximumFractionDigits: decimales,
    }).format(Number(v));
  }

  function fmtEuro(v, decimales = 2) {
    if (v === null || v === undefined || v === "" || !Number.isFinite(Number(v))) return "—";
    return new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: decimales,
      maximumFractionDigits: decimales,
    }).format(Number(v));
  }

  // Redondeo a 2 decimales sin arrastrar el error binario de los float
  // (0.1 + 0.2). Todos los importes de liquidación pasan por aquí.
  function redondear(v, decimales = 2) {
    const f = 10 ** decimales;
    return Math.round((num(v) + Number.EPSILON) * f) / f;
  }

  // ---- Numeración de documentos ---------------------------------------
  // Siguiente valor de un contador entero. Mismo criterio que el código de
  // agricultor: se lee el máximo actual y se le suma 1. Suficiente para un
  // uso de un solo puesto; la columna es UNIQUE, así que un choque daría
  // error en vez de duplicar el número.
  async function siguienteSecuencia(tabla, columna = "secuencia") {
    const { data, error } = await App.db
      .from(tabla)
      .select(columna)
      .order(columna, { ascending: false, nullsFirst: false })
      .limit(1);

    if (error) throw error;
    const max = data && data.length ? num(data[0][columna]) : 0;
    return max + 1;
  }

  function fmtDocumento(serie, secuencia, ancho = 4) {
    return `${serie || ""}-${String(secuencia).padStart(ancho, "0")}`;
  }

  // ---- Ciclo: solo 1, 2 o 3 ------------------------------------------
  // Normaliza lo que venga de la base de datos al valor del desplegable.
  // Registros antiguos escritos a mano ("Ciclo 2", " 3 ") se quedan con su
  // dígito; cualquier otro valor se deja sin seleccionar.
  function cicloValido(valor) {
    const encontrado = String(valor ?? "").match(/[123]/);
    return encontrado ? encontrado[0] : "";
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

  // Indicador de carga: como bloque (listas/tarjetas) o como fila de tabla.
  function spinner(texto = "Cargando...") {
    return `<div class="cargando"><span class="spinner"></span>${escapar(texto)}</div>`;
  }

  function spinnerFila(colspan, texto = "Cargando...") {
    return `<tr><td colspan="${colspan}">${spinner(texto)}</td></tr>`;
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

  // Etiqueta "007 Nombre" lista para pintar en una tabla.
  function etiquetaAgricultor(agricultor) {
    if (!agricultor) return "—";
    return `<span class="agricultor-codigo">${fmtCodigo(agricultor.codigo)}</span>${escapar(agricultor.nombre || "")}`;
  }

  function agricultorPorId(id) {
    return App.state.agricultoresTodos.find((a) => String(a.id) === String(id)) ||
      App.state.agricultoresActuales.find((a) => String(a.id) === String(id)) ||
      null;
  }

  // Pinta un mensaje de una sola fila (vacío, error o carga) en un tbody.
  function filaMensaje(colspan, texto, clase = "empty") {
    return `<tr><td colspan="${colspan}" class="${clase}">${escapar(texto)}</td></tr>`;
  }

  // Ejecuta una consulta y avisa por toast si falla. Devuelve [] en error,
  // así quien llama no tiene que repetir el mismo bloque de comprobación.
  async function consultar(promesa, queEs) {
    const { data, error } = await promesa;
    if (error) {
      App.toast(`Error al cargar ${queEs}: ${error.message}`);
      return null;
    }
    return data || [];
  }

  // ---- Impresión ------------------------------------------------------
  // Vuelca un documento (factura, carta de porte) en #zonaImpresion y abre
  // el diálogo de impresión. Desde ahí el navegador permite "Guardar como
  // PDF", así que no hace falta ninguna librería extra.
  function imprimirDocumento(html) {
    App.dom.zonaImpresion.innerHTML = html;
    window.print();
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
    abrirModal,
    snapshotModal,
    modalTieneCambios,
    formatearFecha,
    hoyISO,
    primerDiaMes,
    ultimoDiaMes,
    fechaEnRango,
    limitarFechasAHoy,
    esFechaFutura,
    num,
    fmtNum,
    fmtEuro,
    redondear,
    siguienteSecuencia,
    fmtDocumento,
    cicloValido,
    escapar,
    valor,
    spinner,
    spinnerFila,
    toast,
    fmtCodigo,
    campanaNombre,
    etiquetaAgricultor,
    agricultorPorId,
    filaMensaje,
    consultar,
    imprimirDocumento,
    mostrarVistaAgricultores,
    mostrarVistaRegistros,
  });
})(window.App);
