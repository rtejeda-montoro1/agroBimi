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
  // Se redondea el valor absoluto y se le devuelve el signo: así -0,375
  // da -0,38 igual que 0,375 da 0,38 (Math.round sube los .5 hacia +∞).
  //
  // Ojo: sumar Number.EPSILON no basta. 6 × 0,3625 da 2,1749999999999998
  // en binario y se quedaba en 2,17 (debe ser 2,18). Por eso primero se
  // limpia el ruido binario con 15 cifras significativas (2,175) y luego
  // se redondea moviendo la coma en el texto ("2.175e2" = 217,5 exacto).
  function redondear(v, decimales = 2) {
    const n = num(v);
    const limpio = Number(Math.abs(n).toPrecision(15));
    const txt = String(limpio);
    const r = txt.includes("e") // números minúsculos o enormes: sin truco
      ? Math.round(limpio * 10 ** decimales) / 10 ** decimales
      : Number(Math.round(Number(`${txt}e${decimales}`)) + `e-${decimales}`);
    // + 0 convierte -0 en 0 (si no, se mostraría «-0,00 €»).
    return Math.sign(n) * r + 0;
  }

  // Precio de una línea: 2 decimales, salvo que tenga más (hasta 4). Si se
  // mostrase 0,36 € un precio de 0,3575 €, la cantidad × precio impresa no
  // daría el importe de la línea.
  function fmtPrecio(v) {
    const n = Number(v);
    if (v === null || v === undefined || v === "" || !Number.isFinite(n)) return "—";
    const dec = redondear(n, 2) === n ? 2 : redondear(n, 3) === n ? 3 : 4;
    return fmtEuro(n, dec);
  }

  // Cantidad de una línea: sin decimales si es entera (cajas), con 2 si no.
  function fmtCantidad(v) {
    return fmtNum(v, Number.isInteger(num(v)) ? 0 : 2);
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
    // Si sale otro aviso antes de que se cierre este, cuenta desde el nuevo.
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove("show"), 2500);
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

  // Trae TODAS las filas de una consulta, en bloques. Supabase devuelve
  // como mucho 1000 filas por consulta (max-rows) y corta el resto sin
  // avisar: con una campaña entera de registros, las listas, los totales y
  // el Excel salían incompletos.
  //
  // `crear` es una función que construye la consulta desde cero (una
  // consulta de Supabase no se puede reutilizar para pedir otro bloque).
  // Debe llevar un orden ÚNICO (p. ej. terminar en .order("id")): si no,
  // entre bloque y bloque podrían repetirse o saltarse filas.
  // Devuelve { data, error } como una consulta normal, así que sirve igual
  // con consultar() que con el patrón const { data, error } = await ...
  // TAM_BLOQUE debe coincidir con el max-rows del proyecto (1000 por
  // defecto): un bloque más corto se toma como el último.
  const TAM_BLOQUE = 1000;
  async function traerTodo(crear) {
    const filas = [];
    for (let desde = 0; ; desde += TAM_BLOQUE) {
      const { data, error } = await crear().range(desde, desde + TAM_BLOQUE - 1);
      if (error) return { data: null, error };
      filas.push(...(data || []));
      if (!data || data.length < TAM_BLOQUE) return { data: filas, error: null };
    }
  }

  // ---- Impresión ------------------------------------------------------
  // Vuelca un documento (factura) en #zonaImpresion y abre
  // el diálogo de impresión. Desde ahí el navegador permite "Guardar como
  // PDF", así que no hace falta ninguna librería extra.
  // Al "Guardar como PDF" el navegador propone el título de la página como
  // nombre del archivo: con nombreArchivo se cambia mientras dura la
  // impresión (si no, saldría "Gestión de Bimi").
  function imprimirDocumento(html, nombreArchivo = "") {
    App.dom.zonaImpresion.innerHTML = html;
    if (nombreArchivo) {
      const tituloOriginal = document.title;
      // Fuera los caracteres que Windows no admite en un nombre de archivo.
      document.title = nombreArchivo.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
      window.addEventListener("afterprint", () => { document.title = tituloOriginal; }, { once: true });
    }
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
    traerTodo,
    limitarFechasAHoy,
    esFechaFutura,
    num,
    fmtNum,
    fmtEuro,
    fmtPrecio,
    fmtCantidad,
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
