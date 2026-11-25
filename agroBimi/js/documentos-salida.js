// =====================================================================
//  Documentos de una salida: carta de porte (CMR) y albarán
//  ---------------------------------------------------------------------
//  Los usan la oficina (js/salidas.js), al imprimir, y la página pública
//  del QR (albaran.html). Todo sale de la «copia»: la foto de la salida que
//  se guarda la primera vez que se imprime (albaranes_salida.copia). Así
//  el papel, las reimpresiones y lo que se ve al escanear el QR son
//  siempre lo mismo, aunque después cambien los datos de un agricultor,
//  del emisor o los Ajustes.
//
//  copia = {
//    version: 1,
//    albaran: { numero, fecha, destinatario_*, matricula, ..., token,
//               palets: [{ codigo, num_cajas, secuencia,
//                          palet_lineas: [{ agricultor_id, num_cajas, fecha }] }] },
//    emisor: { nombre, nif, direccion, ... },
//    agricultores: { [id]: { nombre, nif } },
//    ajustes: { cmr_remitente, cmr_porteador, cmr_tipo_palet, kg_por_caja },
//  }
// =====================================================================

(function initDocumentosSalida(App) {
  const AJUSTES_COPIA = ["cmr_remitente", "cmr_porteador", "cmr_tipo_palet", "kg_por_caja"];

  // La copia de una salida tal como está ahora. alb: la fila de
  // albaranes_salida con palets(..., palet_lineas(..., registros(fecha))).
  function construirCopia(alb, { emisor, agricultorPorId, param }) {
    const { palets = [], copia: _copia, ...cabecera } = alb;
    const agricultores = {};
    const paletsCopia = [...palets]
      .sort((a, b) => App.num(a.secuencia) - App.num(b.secuencia))
      .map((p) => ({
        codigo: p.codigo,
        num_cajas: p.num_cajas,
        secuencia: p.secuencia,
        fecha_completo: p.fecha_completo,
        palet_lineas: (p.palet_lineas || []).map((l) => {
          const a = agricultorPorId(l.agricultor_id) || {};
          agricultores[l.agricultor_id] = { nombre: a.nombre ?? null, nif: a.nif ?? null };
          return { agricultor_id: l.agricultor_id, num_cajas: l.num_cajas, fecha: l.registros?.fecha ?? null };
        }),
      }));
    return {
      version: 1,
      albaran: { ...cabecera, palets: paletsCopia },
      emisor: { ...emisor },
      agricultores,
      ajustes: Object.fromEntries(AJUSTES_COPIA.map((k) => [k, param(k) ?? ""])),
    };
  }

  function conTotales(c) {
    const alb = { ...c.albaran, palets: c.albaran.palets || [] };
    alb.totalCajas = alb.palets.reduce((s, p) => s + App.num(p.num_cajas), 0);
    alb.totalKg = kgDeCajas(c, alb.totalCajas);
    return alb;
  }

  // Enlace de la copia digital. El código va sin guiones (Postgres lo
  // acepta igual) para que el QR sea más pequeño y se lea mejor.
  function urlCopia(token, base) {
    if (!token) return "";
    // albaran.html está junto a la página desde la que se imprime.
    const carpeta = String(base || "").split(/[?#]/)[0].replace(/[^/]*$/, "");
    return `${carpeta}albaran.html?t=${String(token).replace(/-/g, "")}`;
  }

  // QR en SVG (librería qrcode-generator, cargada en la página). Sin la
  // librería o sin enlace, el documento sale igual pero sin QR.
  function qrSvg(url) {
    if (!url || typeof window.qrcode !== "function") return "";
    const qr = window.qrcode(0, "M");
    qr.addData(url);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }

  function bloqueQr(qr, clase) {
    if (!qr) return "";
    return `<div class="doc-qr ${clase}">${qr}<span>Copia digital<br>Digital copy</span></div>`;
  }

  const esc = (v) => App.escapar(v == null ? "" : String(v));
  // Kg de bimi (netos): cajas × kg por caja de cuando se hizo la copia.
  const kgDeCajas = (c, cajas) => App.redondear(App.num(cajas) * (App.num(c.ajustes.kg_por_caja) || 8));
  const matriculas = (alb) => [alb.matricula, alb.matricula_remolque].filter(Boolean).join(" / ");

  // Peso como en el CMR en papel: «2.775 kg».
  function fmtPeso(kg) {
    if (kg == null || kg === "") return "";
    const n = App.num(kg);
    return `${App.fmtNum(n, Number.isInteger(n) ? 0 : 2)} kg`;
  }

  function htmlAlbaran(c, qr = "") {
    const alb = conTotales(c);
    const e = c.emisor || {};
    const palets = alb.palets;

    // Detalle: una fila por agricultor y pesada de cada palet.
    const detalle = palets.map((p) => {
      const ls = [...(p.palet_lineas || [])]
        .sort((x, y) => String(x.fecha || "").localeCompare(String(y.fecha || "")));
      return ls.map((l, i) => {
        const a = c.agricultores[l.agricultor_id] || {};
        return `
          <tr>
            ${i === 0 ? `<td rowspan="${ls.length}" class="alb-palet"><b>${esc(p.codigo)}</b><br>${App.fmtNum(p.num_cajas)} cajas</td>` : ""}
            <td>${esc(a.nombre)}</td>
            <td>${l.fecha ? App.formatearFecha(l.fecha) : "—"}</td>
            <td class="der">${App.fmtNum(l.num_cajas)}</td>
            <td class="der">${App.fmtCantidad(kgDeCajas(c, l.num_cajas))}</td>
          </tr>`;
      }).join("");
    }).join("");

    // Resumen por agricultor.
    const porAgri = {};
    palets.forEach((p) => (p.palet_lineas || []).forEach((l) => {
      porAgri[l.agricultor_id] = (porAgri[l.agricultor_id] || 0) + App.num(l.num_cajas);
    }));
    const resumen = Object.entries(porAgri)
      .map(([idAgri, cajas]) => ({ a: c.agricultores[idAgri] || {}, cajas }))
      .sort((x, y) => String(x.a.nombre || "").localeCompare(String(y.a.nombre || ""), "es"))
      .map(({ a, cajas }) => `
        <tr>
          <td>${esc(a.nombre)}</td>
          <td>${esc(a.nif)}</td>
          <td class="der">${App.fmtNum(cajas)}</td>
          <td class="der">${App.fmtCantidad(kgDeCajas(c, cajas))}</td>
        </tr>`).join("");

    const lineaEmisor = [e.direccion, e.codigo_postal ? `CP: ${e.codigo_postal}` : ""].filter(Boolean).join(" - ");
    const lugarEmisor = [e.poblacion, e.provincia ? `(${e.provincia})` : ""].filter(Boolean).join(" ");

    return `
      <div class="rec alb">
        <div class="rec-cab">
          <div class="rec-emisor">
            <b>${esc(e.nombre)}</b>
            ${e.nif ? `<div>CIF: ${esc(e.nif)}</div>` : ""}
            ${lineaEmisor ? `<div>${esc(lineaEmisor)}</div>` : ""}
            ${lugarEmisor ? `<div>${esc(lugarEmisor)}</div>` : ""}
            ${e.registro ? `<div>Reg. establecimiento: ${esc(e.registro)}</div>` : ""}
          </div>
          <table class="rec-tabla alb-doc">
            <tr><th>DOCUMENTO</th><th>NÚMERO</th><th>FECHA</th></tr>
            <tr><td>ALBARÁN DE SALIDA</td><td><b>${esc(alb.numero)}</b></td><td>${App.formatearFecha(alb.fecha)}</td></tr>
          </table>
          ${bloqueQr(qr, "alb-qr")}
        </div>

        <div class="rec-fila">
          <div class="rec-agricultor alb-caja">
            <div class="alb-etiqueta">Destinatario</div>
            <b>${esc(alb.destinatario_nombre)}</b>
            ${alb.destinatario_nif ? `<div>CIF: ${esc(alb.destinatario_nif)}</div>` : ""}
            ${alb.destinatario_direccion ? `<div class="alb-multilinea">${esc(alb.destinatario_direccion)}</div>` : ""}
          </div>
          <div class="rec-agricultor alb-caja">
            <div class="alb-etiqueta">Transporte</div>
            <div>Matrícula: <b>${esc(matriculas(alb)) || "—"}</b></div>
            <div>Transportista: <b>${esc(alb.transportista) || "—"}</b></div>
            <div>Palets: <b>${App.fmtNum(palets.length)}</b> · Cajas: <b>${App.fmtNum(alb.totalCajas)}</b> · Kg: <b>${App.fmtCantidad(alb.totalKg)}</b></div>
          </div>
        </div>

        <table class="rec-tabla alb-detalle">
          <thead>
            <tr><th>PALET</th><th>PROVEEDOR</th><th>FECHA ENTRADA</th><th class="der">CAJAS</th><th class="der">KG</th></tr>
          </thead>
          <tbody>${detalle}</tbody>
          <tfoot>
            <tr><th colspan="3" class="der">TOTAL</th><th class="der">${App.fmtNum(alb.totalCajas)}</th><th class="der">${App.fmtCantidad(alb.totalKg)}</th></tr>
          </tfoot>
        </table>

        <h3 class="alb-subtitulo">Resumen por proveedor</h3>
        <table class="rec-tabla alb-resumen">
          <thead><tr><th>PROVEEDOR</th><th>NIF</th><th class="der">CAJAS</th><th class="der">KG</th></tr></thead>
          <tbody>${resumen}</tbody>
        </table>

        ${alb.observaciones ? `<div class="rec-obs"><b>Observaciones:</b> ${esc(alb.observaciones)}</div>` : ""}

        <div class="alb-firmas">
          <div>Expedidor</div>
          <div>Transportista</div>
          <div>Destinatario</div>
        </div>
      </div>`;
  }

  // Carta de porte internacional (CMR): misma disposición y casillas que el
  // impreso del cliente. Lo fijo (remitente, porteador) sale de Ajustes; lo
  // que en papel va a bolígrafo, de la salida.
  const EJEMPLARES_CMR = [
    ["1", "Ejemplar para el REMITENTE", "Copy for SENDER"],
    ["2", "Ejemplar para el DESTINATARIO", "Copy for CONSIGNEE"],
    ["3", "Ejemplar para el PORTEADOR", "Copy for CARRIER"],
  ];

  function casilla(num, etiqueta, contenido = "", clase = "") {
    return `
      <div class="cmr-c ${clase}">
        <div class="cmr-l">${num ? `<b>${num}</b> ` : ""}${etiqueta}</div>
        <div class="cmr-v">${contenido}</div>
      </div>`;
  }

  function htmlCmr(c, [numEjemplar, ejemplar, copia], qr = "") {
    const alb = conTotales(c);
    const remitente = esc(c.ajustes.cmr_remitente);
    const porteador = esc(c.ajustes.cmr_porteador);
    const nPalets = alb.palets.length;
    const destinatario = [
      alb.destinatario_nombre,
      alb.destinatario_nif ? `CIF: ${alb.destinatario_nif}` : "",
      alb.destinatario_direccion,
    ].filter(Boolean).map(esc).join("\n");
    const temperatura = alb.temperatura == null ? "&nbsp;&nbsp;&nbsp;&nbsp;" : esc(App.fmtNum(App.num(alb.temperatura), Number.isInteger(App.num(alb.temperatura)) ? 0 : 1));

    return `
      <div class="cmr">
        <div class="cmr-cab">
          <div class="cmr-ejemplar"><span>${numEjemplar}</span><div>${ejemplar}<br>${copia}</div></div>
          <div class="cmr-tipo"><span class="cmr-check">X</span><span class="cmr-sello">CMR</span>
            <span class="cmr-check"></span><b>CARTA DE PORTE NACIONAL</b></div>
        </div>

        <div class="cmr-fila">
          ${casilla(1, "Remitente (nombre, dirección, país) / Sender (name, address, country)",
            `<div class="cmr-fijo">${remitente}</div>`, "cmr-a")}
          <div class="cmr-c cmr-a cmr-titulo">
            <div class="cmr-titulo-cab">
              <b>CARTA DE PORTE INTERNACIONAL<br>INTERNATIONAL CONSIGNMENT NOTE</b>
              <span class="cmr-sello">CMR</span>
            </div>
            <p>Este transporte queda sometido, no obstante toda cláusula contraria, al Convenio sobre
              el Contrato de Transporte Internacional de Mercancías por Carretera (CMR).</p>
            <p>This carriage is subject, notwithstanding any clause to the contrary, to the Convention
              on the Contract for the international Carriage of Goods by Road (CMR).</p>
          </div>
        </div>

        <div class="cmr-fila">
          ${casilla(2, "Destinatario (nombre, dirección, país) / Consignee (name, address, country)",
            `<div class="cmr-dato">${destinatario}</div>`, "cmr-b")}
          ${casilla(16, "Porteador (nombre, dirección, país) / Carrier (name, address, country)",
            `<div class="cmr-porteador"><div class="cmr-fijo cmr-peq">${porteador}</div>
              <div class="cmr-dato cmr-matriculas">${[alb.matricula, alb.matricula_remolque].filter(Boolean).map(esc).join("\n")}</div></div>`,
            "cmr-b")}
        </div>

        <div class="cmr-fila">
          ${casilla(3, "Lugar de entrega de la mercancía / Place of delivery of the goods",
            `<div class="cmr-dato">${esc(alb.lugar_entrega)}</div>`, "cmr-c3")}
          ${casilla(17, "Porteadores sucesivos / Successive Carriers", "", "cmr-c3")}
        </div>

        <div class="cmr-fila">
          <div class="cmr-col">
            ${casilla(4, "Lugar de carga de la mercancía / Loading place of the goods",
              `<div class="cmr-dato cmr-centro">${esc(alb.lugar_carga)}</div>`, "cmr-c4")}
            ${casilla(5, "Documentos anexos / Documents attached",
              `<div class="cmr-anexos"><div class="cmr-dato">${esc(alb.documentos_anexos)}</div>${bloqueQr(qr, "cmr-qr")}</div>`, "cmr-c5")}
          </div>
          ${casilla(18, "Reservas y observaciones del porteador / Carrier's reservations and observations", "", "cmr-c18")}
        </div>

        <table class="cmr-mercancia">
          <thead>
            <tr>
              <th><b>6</b> Marca y números<br>Marks and numbers</th>
              <th><b>7</b> Número de bultos<br>Number of packages</th>
              <th><b>8</b> Modo de embalaje<br>Method of packing</th>
              <th><b>9</b> Naturaleza de la mercancía<br>Nature of the goods</th>
              <th><b>10</b> Nº estadístico<br>Statistical Nº</th>
              <th><b>11</b> Peso bruto, kg.<br>Gross weight, kg.</th>
              <th><b>12</b> Volumen m³<br>Volume in m³</th>
            </tr>
          </thead>
          <tbody>
            <tr class="cmr-mercancia-datos">
              <td>${esc(alb.marcas)}</td>
              <td>${App.fmtNum(alb.totalCajas)}</td>
              <td>${esc(alb.embalaje)}</td>
              <td>${esc(alb.naturaleza)}</td>
              <td></td>
              <td>${esc(fmtPeso(alb.peso_bruto_kg))}</td>
              <td>Total ${App.fmtNum(nPalets)} ${nPalets === 1 ? "palet" : "palets"}</td>
            </tr>
            <tr class="cmr-mercancia-palets">
              <td></td>
              <td colspan="5">${App.fmtNum(nPalets)}x ${esc(c.ajustes.cmr_tipo_palet)}</td>
              <td></td>
            </tr>
          </tbody>
        </table>

        <div class="cmr-fila">
          <div class="cmr-col">
            ${casilla(13, "Instrucciones del remitente / Sender's instructions",
              `<div class="cmr-fijo cmr-instrucciones">ORIGEN: ESPAÑA
SE DEBE MANTENER UNA TEMPERATURA CONSTANTE
EN FRIGORÍFICO DE <u class="cmr-dato">&nbsp;${temperatura}&nbsp;</u> ºC</div>`, "cmr-c13")}
            ${casilla(14, "Forma de pago / Instructions as to payment for carriage", "", "cmr-c14")}
          </div>
          <div class="cmr-col">
            ${casilla(19, "Estipulaciones particulares / Special agreements", "", "cmr-c19")}
            <table class="cmr-pagar">
              <tr><th><b>20</b> A pagar por:<br>To be paid by:</th><th>Remitente / Senders</th><th>Destinatario / Consignee</th></tr>
              ${["Precio del transporte:<br>Carriage charges:", "Descuentos:<br>Reductions:", "Neto:<br>Balance:",
                 "Suplementos:<br>Supplements charges:", "Otros cargos:<br>Other charges:", "Seguro:<br>Insurance:", "TOTAL:"]
                .map((t) => `<tr><td>${t}</td><td></td><td></td></tr>`).join("")}
            </table>
          </div>
        </div>

        <div class="cmr-fila">
          ${casilla(21, "", `<div class="cmr-formalizado"><span class="cmr-l">Formalizado en<br>Established in</span>
              <span class="cmr-dato">${esc(alb.lugar_carga)}</span>
              <span class="cmr-l">a<br>on</span>
              <span class="cmr-dato">${App.formatearFecha(alb.fecha)}</span></div>`, "cmr-c21")}
          ${casilla(15, "Reembolso a cobrar en destino / Cash on delivery", "", "cmr-c21")}
        </div>

        <div class="cmr-fila">
          ${casilla(22, "", `<div class="cmr-fijo cmr-centro">${remitente}</div>
            <div class="cmr-firma">Firma y sello del remitente<br>Signature and stamp of the sender</div>`, "cmr-firmas")}
          ${casilla(23, "", `<div class="cmr-fijo cmr-centro cmr-peq">${porteador}</div>
            <div class="cmr-firma">Firma y sello del porteador<br>Signature and stamp of the carrier</div>`, "cmr-firmas")}
          ${casilla(24, "Mercancías recibidas / Goods received", `
            <div class="cmr-recibidas"><span class="cmr-l">Lugar<br>Place</span><span class="cmr-l">a<br>on</span></div>
            <div class="cmr-firma">Firma y sello del destinatario<br>Signature and stamp of the consignee</div>`, "cmr-firmas")}
        </div>
      </div>`;
  }


  // Lo que se imprime (o se ve en la copia digital): los ejemplares del
  // CMR que se pidan y el albarán, con el QR de la copia en cada uno.
  function htmlSalida(c, { ejemplares = EJEMPLARES_CMR, albaran = true, url = "" } = {}) {
    const qr = qrSvg(url);
    return [
      ...ejemplares.map((ej) => htmlCmr(c, ej, qr)),
      ...(albaran ? [htmlAlbaran(c, qr)] : []),
    ].join("");
  }

  Object.assign(App, {
    EJEMPLARES_CMR,
    construirCopia,
    urlCopia,
    htmlSalida,
  });
})(window.App);
