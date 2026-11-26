// =====================================================================
//  Ajustes (tabla "parametros")
//  ---------------------------------------------------------------------
//  Guarda lo que no pertenece a un registro concreto: los datos del
//  emisor de las facturas, los precios por defecto, el IVA y las series
//  de numeración de documentos. Se cargan una vez al iniciar sesión y
//  quedan en App.state.parametros.
// =====================================================================

(function initAjustesModule(App) {
  // Cada clave de "parametros" se edita en el input con el mismo id
  // prefijado por "aj_" (ej. precio_kg -> #aj_precio_kg).
  const PREFIJO = "aj_";

  async function cargarParametros() {
    const { data, error } = await App.db.from("parametros").select("clave,valor");

    if (error) {
      // Sin parámetros la app sigue funcionando con los valores por defecto:
      // avisamos pero no bloqueamos.
      App.toast("No se pudieron cargar los ajustes: " + error.message);
      App.state.parametros = { ...App.PARAMETROS_DEFECTO };
      // Lo miran Ajustes y la copia del QR: con los valores por defecto no
      // se puede guardar nada que pise o congele los datos reales.
      App.state.parametrosCargados = false;
      return false;
    }

    const guardados = {};
    (data || []).forEach((p) => { guardados[p.clave] = p.valor; });
    App.state.parametros = { ...App.PARAMETROS_DEFECTO, ...guardados };
    App.state.parametrosCargados = true;
    return true;
  }

  // Lectura de un parámetro como texto o como número.
  function param(clave) {
    const valor = App.state.parametros[clave];
    // Un ajuste vacío también toma el valor por defecto: así los datos fijos
    // del emisor salen aunque en la tabla se guardasen en blanco.
    return valor === null || valor === undefined || String(valor).trim() === ""
      ? (App.PARAMETROS_DEFECTO[clave] ?? "")
      : valor;
  }

  function paramNum(clave) {
    return App.num(param(clave));
  }

  // Si al entrar no se pudieron cargar, se vuelve a intentar. Sin los
  // ajustes reales el formulario saldría con los valores por defecto y, al
  // guardar, los escribiría encima de los de verdad (emisor, series, IVA...).
  async function asegurarParametros() {
    if (App.state.parametrosCargados) return true;
    if (await cargarParametros()) return true;
    App.toast("No se han podido cargar los ajustes. Comprueba la conexión y vuelve a intentarlo.");
    return false;
  }

  async function abrirAjustes() {
    if (!(await asegurarParametros())) return;
    Object.keys(App.PARAMETROS_DEFECTO).forEach((clave) => {
      const input = App.$(PREFIJO + clave);
      if (input) input.value = param(clave);
    });
    App.abrirModal(App.dom.modalAjustes);
  }

  async function guardarAjustes(e) {
    e.preventDefault();
    if (!App.state.parametrosCargados) {
      App.toast("No se han podido cargar los ajustes: no se guarda nada para no pisar los datos reales. Cierra y vuelve a abrir Ajustes.");
      return;
    }

    const filas = Object.keys(App.PARAMETROS_DEFECTO)
      .map((clave) => {
        const input = App.$(PREFIJO + clave);
        return input ? { clave, valor: input.value.trim(), updated_at: new Date().toISOString() } : null;
      })
      .filter(Boolean);

    const { error } = await App.db.from("parametros").upsert(filas, { onConflict: "clave" });
    if (error) {
      App.toast("Error al guardar los ajustes: " + error.message);
      return;
    }

    const anteriores = { ...App.state.parametros };
    await cargarParametros();
    App.aplicarAjustesALiquidacion(anteriores);
    App.cerrarModal(App.dom.modalAjustes);
    App.toast("Ajustes guardados");
  }

  // Datos del emisor tal y como se pintan en la factura.
  function datosEmisor() {
    return {
      nombre: param("emisor_nombre"),
      nif: param("emisor_nif"),
      direccion: param("emisor_direccion"),
      codigo_postal: param("emisor_codigo_postal"),
      poblacion: param("emisor_poblacion"),
      provincia: param("emisor_provincia"),
      registro: param("emisor_registro"),
      telefono: param("emisor_telefono"),
      email: param("emisor_email"),
    };
  }

  function configurarEventosAjustes() {
    App.$("btnAjustes").addEventListener("click", abrirAjustes);
    App.dom.formAjustes.addEventListener("submit", guardarAjustes);
    // Las secciones se pliegan: si un campo obligatorio está en una
    // plegada, el navegador no puede enfocarlo ni mostrar su aviso. Se
    // abre su sección antes ("invalid" no burbujea: va en captura).
    App.dom.formAjustes.addEventListener("invalid", abrirSeccionDe, true);
  }

  function abrirSeccionDe(e) {
    const seccion = e.target?.closest?.("details");
    if (seccion) seccion.open = true;
  }

  Object.assign(App, {
    cargarParametros,
    asegurarParametros,
    param,
    paramNum,
    datosEmisor,
    abrirAjustes,
    configurarEventosAjustes,
  });
})(window.App);
