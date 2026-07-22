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
    modalCamara: $("modalCamara"),
    modalCampana: $("modalCampana"),
    modalBuscarCampana: $("modalBuscarCampana"),
    formAgricultor: $("formAgricultor"),
    formRegistro: $("formRegistro"),
    formCampana: $("formCampana"),
    loginForm: $("loginForm"),
    loginError: $("loginError"),
  };

  // Comprobación temprana de configuración.
  if (SUPABASE_URL.startsWith("PON_AQUI") || SUPABASE_ANON_KEY.startsWith("PON_AQUI")) {
    dom.listaAgricultores.innerHTML =
      '<div class="error">Falta configurar Supabase.<br>' +
      'Edita el archivo <b>config.js</b> con tu URL y tu clave anon (ver README.md).</div>';
  }

  const state = {
    agricultoresActuales: [],
    registrosActuales: [],
    campanasActuales: [],
    registrosCampanaActuales: [],
    campanaBuscadaNombre: "",
    camaraAgricultores: [],
    agricultorAbierto: null,
    ordenFechaAsc: false,
    agrupadoPorFactura: true,
    datosCargados: false,
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
    { id: "num_plantas", tipo: "num" },
    { id: "fecha_retirada", tipo: "fecha" },
    { id: "comentarios", tipo: "texto" },
  ];

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
    COLORES_FACTURA,
  };
})(window);
