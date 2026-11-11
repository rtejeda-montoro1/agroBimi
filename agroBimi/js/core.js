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
    modalVerAgricultor: $("modalVerAgricultor"),
    modalRegistro: $("modalRegistro"),
    modalFactura: $("modalFactura"),
    modalFacturar: $("modalFacturar"),
    modalCampana: $("modalCampana"),
    modalBuscarCampana: $("modalBuscarCampana"),
    modalPlantas: $("modalPlantas"),
    modalPlanta: $("modalPlanta"),
    modalCajas: $("modalCajas"),
    modalLiquidaciones: $("modalLiquidaciones"),
    modalLiquidacion: $("modalLiquidacion"),
    modalAjustes: $("modalAjustes"),
    modalPalets: $("modalPalets"),
    modalPalet: $("modalPalet"),
    modalSalidas: $("modalSalidas"),
    modalSalida: $("modalSalida"),
    formAgricultor: $("formAgricultor"),
    formRegistro: $("formRegistro"),
    formCampana: $("formCampana"),
    formPlanta: $("formPlanta"),
    formLiquidacion: $("formLiquidacion"),
    formAjustes: $("formAjustes"),
    formPalet: $("formPalet"),
    formSalida: $("formSalida"),
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
    paletsActuales: [],
    entradasPaletizado: [],    // vista paletizado_entradas
    albaranesActuales: [],
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
    { id: "comentarios", tipo: "texto" },
  ];

  // Campos de datos fiscales del agricultor (modal de agricultor y facturas).
  const CAMPOS_AGRICULTOR = [
    "nif", "direccion", "codigo_postal", "poblacion",
    "provincia", "telefono", "email", "iban",
  ];

  // Claves de la tabla "parametros" con su valor por defecto.
  const PARAMETROS_DEFECTO = {
    // Emisor de los recibos: se rellena en Ajustes. Los datos reales del
    // cliente no van en el código (el repo es público): están en
    // privado/datos_cliente.sql, fuera del repositorio.
    emisor_nombre: "",
    emisor_nif: "",
    emisor_direccion: "",
    emisor_codigo_postal: "",
    emisor_poblacion: "",
    emisor_provincia: "",
    emisor_registro: "",
    emisor_telefono: "",
    emisor_email: "",
    precio_caja: "0",
    precio_caja_perdida: "0",
    iva_porcentaje: "12",
    retencion_porcentaje: "2",
    serie_liquidacion: "LIQ",
    serie_factura: "F",
    // Paletización: el reparto lo hace la base de datos al pesar.
    cajas_por_palet: "60",
    serie_palet: "P",
    serie_albaran: "ALB",
    paletizado_desde: "",
    // Tamaño de la etiqueta del palet (impresora de pegatinas).
    etiqueta_ancho_mm: "105",
    etiqueta_alto_mm: "75",
    // Carta de porte (CMR): remitente y porteador se rellenan en Ajustes
    // (igual que el emisor, los reales están en privado/datos_cliente.sql).
    cmr_remitente: "",
    cmr_porteador: "",
    cmr_tipo_palet: "palet industrial de madera 100 x 120",
    // Para proponer el peso bruto: cajas × kg por caja (300 cajas = 2.775 kg).
    peso_bruto_caja_kg: "9.25",
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
