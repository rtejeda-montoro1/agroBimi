// =====================================================================
//  Reportes y utilidades de salida
// =====================================================================

(function initReportesModule(App) {
  // -------------------------------------------------------------------
  //  Estilos para los Excel (requiere xlsx-js-style)
  // -------------------------------------------------------------------
  const COLOR = {
    cabecera: "15803D",   // verde Bimi
    cabeceraTexto: "FFFFFF",
    filaPar: "F1F8F4",    // verde muy claro
    filaImpar: "FFFFFF",
    borde: "D0D7DE",
    numero: "1F2937",
  };

  const BORDE = { style: "thin", color: { rgb: COLOR.borde } };
  const BORDES = { top: BORDE, bottom: BORDE, left: BORDE, right: BORDE };

  // Columnas que contienen números (se alinean a la derecha).
  const COLUMNAS_NUMERICAS = new Set([
    "Nº Cajas Entradas",
    "Nº Cajas Salidas",
    "Descuento Cajas",
    "Cajas Vacías retiradas",
    "Cajas Vacías devueltas",
    "Cajas llenas devueltas",
    "Descuadre",
    "Ya cobradas",
    "Pendiente de cobro",
    "Importe a pagar",
    "Nº Plantas",
    "Nº Cajas",
    "Nº palets",
    "Cajas netas",
    "Días de ciclo",
    "Cajas por planta",
    "Plantas por caja",
    "Precio caja",
    "Cajas perdidas",
    "Base",
    "IVA %",
    "IVA",
    "Total",
    "En cámara",
    "Salidas (registro)",
    "Salidas (carta de porte)",
    "Palets pendientes",
  ]);

  function anchoColumnas(columnas, filas) {
    return columnas.map((col) => {
      const largos = filas.map((f) => (f[col] == null ? 0 : String(f[col]).length));
      const max = Math.max(col.length, ...largos);
      return { wch: Math.min(Math.max(max + 2, 10), 45) };
    });
  }

  // Construye una hoja de cálculo con cabecera coloreada, bordes y filas
  // alternadas para que se lea de un vistazo.
  function construirHojaEstilizada(filas) {
    const hoja = XLSX.utils.json_to_sheet(filas);
    const columnas = Object.keys(filas[0] || {});
    const rango = XLSX.utils.decode_range(hoja["!ref"]);

    for (let R = rango.s.r; R <= rango.e.r; R++) {
      const filaPar = R % 2 === 0;
      for (let C = rango.s.c; C <= rango.e.c; C++) {
        const ref = XLSX.utils.encode_cell({ r: R, c: C });
        const celda = hoja[ref];
        if (!celda) continue;

        if (R === 0) {
          celda.s = {
            font: { bold: true, color: { rgb: COLOR.cabeceraTexto }, sz: 12 },
            fill: { fgColor: { rgb: COLOR.cabecera } },
            alignment: { horizontal: "center", vertical: "center", wrapText: true },
            border: BORDES,
          };
        } else {
          const nombreCol = columnas[C];
          const esNumero = COLUMNAS_NUMERICAS.has(nombreCol);
          celda.s = {
            font: { color: { rgb: COLOR.numero }, sz: 11 },
            fill: { fgColor: { rgb: filaPar ? COLOR.filaPar : COLOR.filaImpar } },
            alignment: {
              horizontal: esNumero ? "right" : "left",
              vertical: "center",
            },
            border: BORDES,
          };
        }
      }
    }

    hoja["!cols"] = anchoColumnas(columnas, filas);
    hoja["!rows"] = [{ hpt: 26 }]; // alto de la cabecera
    // Congela la fila de cabecera al hacer scroll.
    hoja["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft" };
    return hoja;
  }

  function descargarLibro(filas, nombreHoja, nombreArchivo) {
    const hoja = construirHojaEstilizada(filas);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, nombreHoja);
    XLSX.writeFile(libro, nombreArchivo);
  }

  function limpiarNombre(txt) {
    return String(txt || "").replace(/[^\w\-]+/g, "_").slice(0, 40);
  }

  // -------------------------------------------------------------------
  //  Cajas en cámara
  // -------------------------------------------------------------------
  // Hay dos formas de dar salida a las cajas: a mano (columna Nº Cajas
  // Salidas del registro) y por carta de porte (palets ya cargados). Se
  // muestran las dos por separado para que se vea de dónde sale el total
  // y no se descuente nada dos veces sin darse cuenta.
  async function verCajasCamara() {
    // Abrimos el modal ya, con spinner, para dar feedback mientras se calcula.
    App.$("totalCamaraGlobal").textContent = "…";
    App.$("cuerpoCamara").innerHTML = App.spinnerFila(7, "Calculando cajas en cámara...");
    App.dom.modalCamara.classList.add("open");

    const [agriRes, regRes, paletRes] = await Promise.all([
      App.db.from("agricultores").select("id,nombre,codigo").order("nombre", { ascending: true }),
      App.db.from("registros").select("agricultor_id,cajas_entradas,cajas_salidas"),
      App.db.from("palets").select("agricultor_id,num_cajas,carta_porte_id"),
    ]);

    const error = agriRes.error || regRes.error || paletRes.error;
    if (error) {
      App.$("totalCamaraGlobal").textContent = "0";
      App.$("cuerpoCamara").innerHTML = App.filaMensaje(7, "Error al cargar: " + error.message, "error");
      return;
    }

    const saldo = (id, totales) => totales[id] || (totales[id] = {
      entradas: 0, salidas: 0, salidasCarta: 0, paletsPendientes: 0, cajasPendientes: 0,
    });

    const totales = {};
    (regRes.data || []).forEach((r) => {
      const t = saldo(r.agricultor_id, totales);
      t.entradas += App.num(r.cajas_entradas);
      t.salidas += App.num(r.cajas_salidas);
    });

    (paletRes.data || []).forEach((p) => {
      const t = saldo(p.agricultor_id, totales);
      if (p.carta_porte_id) {
        t.salidasCarta += App.num(p.num_cajas);
      } else {
        t.paletsPendientes += 1;
        t.cajasPendientes += App.num(p.num_cajas);
      }
    });

    Object.values(totales).forEach((t) => {
      t.camara = t.entradas - t.salidas - t.salidasCarta;
    });

    App.$("totalCamaraGlobal").textContent = App.fmtNum(
      Object.values(totales).reduce((s, t) => s + t.camara, 0)
    );

    const agris = agriRes.data || [];
    App.state.camaraAgricultores = agris;
    App.$("cuerpoCamara").innerHTML = agris.length === 0
      ? App.filaMensaje(7, "No hay agricultores.")
      : agris.map((a) => {
          const t = totales[a.id] || { entradas: 0, salidas: 0, salidasCarta: 0, paletsPendientes: 0, cajasPendientes: 0, camara: 0 };
          return `
        <tr class="fila-clic" data-agri-id="${a.id}" title="Ver registros de ${App.escapar(a.nombre)}">
          <td><span class="agricultor-codigo">${App.fmtCodigo(a.codigo)}</span></td>
          <td>${App.escapar(a.nombre)}</td>
          <td class="col-num">${App.fmtNum(t.entradas)}</td>
          <td class="col-num">${App.fmtNum(t.salidas)}</td>
          <td class="col-num">${App.fmtNum(t.salidasCarta)}</td>
          <td class="col-num">${t.paletsPendientes
            ? `${App.fmtNum(t.paletsPendientes)} (${App.fmtNum(t.cajasPendientes)} cajas)`
            : "—"}</td>
          <td class="col-num"><b>${App.fmtNum(t.camara)}</b></td>
        </tr>`;
        }).join("");
  }

  // -------------------------------------------------------------------
  //  Export: registros de un agricultor
  // -------------------------------------------------------------------
  function exportarExcel() {
    if (!App.state.agricultorAbierto) return;
    if (App.state.registrosActuales.length === 0) {
      App.toast("No hay registros que exportar.");
      return;
    }

    const codigo = App.fmtCodigo(App.state.agricultorAbierto.codigo);
    const filas = App.state.registrosActuales.map((r) => ({
      "Código": codigo,
      "Agricultor": App.state.agricultorAbierto.nombre,
      "Campaña": App.campanaNombre(r.campana_id) === "—" ? "" : App.campanaNombre(r.campana_id),
      "Fecha Entrada": r.fecha || "",
      "Ciclo": r.ciclo || "",
      "Nº Cajas Entradas": r.cajas_entradas ?? "",
      "Fecha (CMR)": r.fecha_cmr || "",
      "Nº Cajas Salidas": r.cajas_salidas ?? "",
      "Descuento Cajas": r.descuento_cajas ?? "",
      "Nº Factura": r.num_factura || "",
      "Cajas Vacías retiradas": r.cajas_vacias_retiradas ?? "",
      "Cajas Vacías devueltas": r.cajas_vacias_devueltas ?? "",
      "Nº Plantas": r.num_plantas ?? "",
      "Fecha de Retirada": r.fecha_retirada || "",
      "Comentarios": r.comentarios || "",
    }));

    descargarLibro(
      filas,
      "Registros",
      `bimi_${codigo}_${limpiarNombre(App.state.agricultorAbierto.nombre)}.xlsx`
    );
    App.toast("Excel exportado");
  }

  // -------------------------------------------------------------------
  //  Export: registros filtrados por campaña
  // -------------------------------------------------------------------
  function exportarExcelCampana() {
    const regs = App.state.registrosCampanaActuales;
    if (!regs || regs.length === 0) {
      App.toast("No hay registros que exportar.");
      return;
    }

    const nombreCampana = App.state.campanaBuscadaNombre;
    const filas = regs.map((r) => {
      const a = r.agricultores || {};
      return {
        "Código": App.fmtCodigo(a.codigo),
        "Agricultor": a.nombre || "",
        "Campaña": nombreCampana || "",
        "Fecha Entrada": r.fecha || "",
        "Ciclo": r.ciclo || "",
        "Nº Cajas Entradas": r.cajas_entradas ?? "",
        "Fecha (CMR)": r.fecha_cmr || "",
        "Nº Cajas Salidas": r.cajas_salidas ?? "",
        "Descuento Cajas": r.descuento_cajas ?? "",
        "Nº Factura": r.num_factura || "",
        "Cajas Vacías retiradas": r.cajas_vacias_retiradas ?? "",
        "Cajas Vacías devueltas": r.cajas_vacias_devueltas ?? "",
        "Nº Plantas": r.num_plantas ?? "",
        "Fecha de Retirada": r.fecha_retirada || "",
        "Comentarios": r.comentarios || "",
      };
    });

    descargarLibro(
      filas,
      "Campaña",
      `bimi_campana_${limpiarNombre(nombreCampana) || "sin_nombre"}.xlsx`
    );
    App.toast("Excel exportado");
  }

  Object.assign(App, {
    // Los módulos de plantas, cajas, palets y liquidaciones reutilizan el
    // mismo generador de Excel para que todos los informes salgan iguales.
    descargarLibro,
    limpiarNombre,
    verCajasCamara,
    exportarExcel,
    exportarExcelCampana,
  });
})(window.App);
