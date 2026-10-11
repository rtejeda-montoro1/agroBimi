// =====================================================================
//  Núcleo compartido de la app
// =====================================================================

(function initCore(global) {
  const $ = (id) => document.getElementById(id);

  const dom = {
    vistaAgricultores: $("vistaAgricultores"),
    vistaRegistros: $("vistaRegistros"),
    listaAgricultores: $("listaAgricultores"),
    cuerpoRegistros: $("cuerpoRegistros"),
    modalAgricultor: $("modalAgricultor"),
    modalRegistro: $("modalRegistro"),
    modalFactura: $("modalFactura"),
    modalCampana: $("modalCampana"),
    modalBuscarCampana: $("modalBuscarCampana"),
    modalPlantas: $("modalPlantas"),
    modalPlanta: $("modalPlanta"),
    modalCajas: $("modalCajas"),
    modalLiquidaciones: $("modalLiquidaciones"),
    modalLiquidacion: $("modalLiquidacion"),
    modalAjustes: $("modalAjustes"),
    formAgricultor: $("formAgricultor"),
    formRegistro: $("formRegistro"),
    formCampana: $("formCampana"),
    formPlanta: $("formPlanta"),
    formLiquidacion: $("formLiquidacion"),
    formAjustes: $("formAjustes"),
    loginForm: $("loginForm"),
    loginError: $("loginError"),
    zonaImpresion: $("zonaImpresion"),
  };

  // Comprobación temprana de configuración.
  if (SUPABASE_URL.startsWith("PON_AQUI") || SUPABASE_ANON_KEY.startsWith("PON_AQUI")) {
    dom.listaAgricultores.innerHTML =
      '<div class="error">Falta configurar Supabase.<br>' +
      'Edita el archivo <b>config.js</b> con tu URL y tu clave anon (ver README.md).</div>';
  }

  const state = {
    agricultoresActuales: [],
    // Lista completa (sin el filtro del buscador). La usan los desplegables
    // de agricultor de los modales de gestión.
    agricultoresTodos: [],
    registrosActuales: [],
    campanasActuales: [],
    registrosCampanaActuales: [],
    campanaBuscadaNombre: "",
    agricultorAbierto: null,
    ordenFechaAsc: false,
    agrupadoPorFactura: true,
    datosCargados: false,
    // Retiradas de plantas del agricultor abierto (resumen por ciclo).
    retiradasAgricultor: [],
    // Listados cargados en cada modal de gestión.
    plantasActuales: [],
    cajasActuales: [],
    liquidacionesActuales: [],
    liquidacionPrevia: null,   // borrador calculado antes de guardar
    parametros: {},
  };

  const CAMPOS_REGISTRO = [
    { id: "fecha", tipo: "fecha" },
    { id: "ciclo", tipo: "texto" },
    { id: "cajas_entradas", tipo: "num" },
    { id: "fecha_cmr", tipo: "fecha" },
    { id: "cajas_salidas", tipo: "num" },
    { id: "descuento_cajas", tipo: "num" },
    { id: "num_factura", tipo: "texto" },
    { id: "cajas_vacias_retiradas", tipo: "num" },
    { id: "cajas_vacias_devueltas", tipo: "num" },
    { id: "num_plantas", tipo: "num" },
    { id: "fecha_retirada", tipo: "fecha" },
    { id: "comentarios", tipo: "texto" },
  ];

  // Campos de datos fiscales del agricultor (modal de agricultor y facturas).
  const CAMPOS_AGRICULTOR = [
    "nif", "direccion", "codigo_postal", "poblacion",
    "provincia", "telefono", "email", "iban",
  ];

  // Claves de la tabla "parametros" con su valor por defecto.
  const PARAMETROS_DEFECTO = {
    emisor_nombre: "",
    emisor_nif: "",
    emisor_direccion: "",
    emisor_codigo_postal: "",
    emisor_poblacion: "",
    emisor_provincia: "",
    emisor_telefono: "",
    emisor_email: "",
    precio_caja: "0",
    precio_caja_perdida: "0",
    iva_porcentaje: "0",
    serie_liquidacion: "LIQ",
    serie_factura: "F",
  };

  const CICLOS = ["1", "2", "3"];

  const COLORES_FACTURA = [
    "rgba(37,99,235,.14)",
    "rgba(22,163,74,.16)",
    "rgba(217,119,6,.18)",
    "rgba(219,39,119,.15)",
    "rgba(139,92,246,.16)",
    "rgba(13,148,136,.16)",
  ];

  global.App = {
    db: supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY),
    $, dom, state,
    CAMPOS_REGISTRO,
    CAMPOS_AGRICULTOR,
    PARAMETROS_DEFECTO,
    CICLOS,
    COLORES_FACTURA,
  };
})(window);
