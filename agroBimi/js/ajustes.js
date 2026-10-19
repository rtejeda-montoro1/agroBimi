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
  // prefijado por "aj_" (ej. precio_caja -> #aj_precio_caja).
  const PREFIJO = "aj_";

  async function cargarParametros() {
    const { data, error } = await App.db.from("parametros").select("clave,valor");

    if (error) {
      // Sin parámetros la app sigue funcionando con los valores por defecto:
      // avisamos pero no bloqueamos.
      App.toast("No se pudieron cargar los ajustes: " + error.message);
      App.state.parametros = { ...App.PARAMETROS_DEFECTO };
      return;
    }

    const guardados = {};
    (data || []).forEach((p) => { guardados[p.clave] = p.valor; });
    App.state.parametros = { ...App.PARAMETROS_DEFECTO, ...guardados };
  }

  // Lectura de un parámetro como texto o como número.
  function param(clave) {
    const valor = App.state.parametros[clave];
    return valor === null || valor === undefined ? (App.PARAMETROS_DEFECTO[clave] ?? "") : valor;
  }

  function paramNum(clave) {
    return App.num(param(clave));
  }

  function abrirAjustes() {
    Object.keys(App.PARAMETROS_DEFECTO).forEach((clave) => {
      const input = App.$(PREFIJO + clave);
      if (input) input.value = param(clave);
    });
    App.abrirModal(App.dom.modalAjustes);
  }

  async function guardarAjustes(e) {
    e.preventDefault();

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
      telefono: param("emisor_telefono"),
      email: param("emisor_email"),
    };
  }

  function configurarEventosAjustes() {
    App.$("btnAjustes").addEventListener("click", abrirAjustes);
    App.dom.formAjustes.addEventListener("submit", guardarAjustes);
  }

  Object.assign(App, {
    cargarParametros,
    param,
    paramNum,
    datosEmisor,
    abrirAjustes,
    configurarEventosAjustes,
  });
})(window.App);
