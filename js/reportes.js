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
    "Nº Plantas",
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
  async function verCajasCamara() {
    const [agriRes, regRes] = await Promise.all([
      App.db.from("agricultores").select("id,nombre,codigo").order("nombre", { ascending: true }),
      App.db.from("registros").select("agricultor_id,cajas_entradas,cajas_salidas"),
    ]);

    if (agriRes.error || regRes.error) {
      App.toast("Error: " + (agriRes.error || regRes.error).message);
      return;
    }

    const totales = {};
    (regRes.data || []).forEach((r) => {
      const salidas = Number(r.cajas_salidas) || 0;
      const entradas = Number(r.cajas_entradas) || 0;
      totales[r.agricultor_id] = (totales[r.agricultor_id] || 0) + (salidas - entradas);
    });

    const totalGlobal = Object.values(totales).reduce((s, n) => s + n, 0);
    App.$("totalCamaraGlobal").textContent = totalGlobal;

    const agris = agriRes.data || [];
    App.state.camaraAgricultores = agris;
    App.$("cuerpoCamara").innerHTML = agris.length === 0
      ? '<tr><td colspan="3" class="empty">No hay agricultores.</td></tr>'
      : agris.map((a) => `
        <tr class="fila-clic" data-agri-id="${a.id}" title="Ver registros de ${App.escapar(a.nombre)}">
          <td><span class="agricultor-codigo">${App.fmtCodigo(a.codigo)}</span></td>
          <td>${App.escapar(a.nombre)}</td>
          <td><b>${totales[a.id] || 0}</b></td>
        </tr>`).join("");

    App.dom.modalCamara.classList.add("open");
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
    verCajasCamara,
    exportarExcel,
    exportarExcelCampana,
  });
})(window.App);
