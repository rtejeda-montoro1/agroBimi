// =====================================================================
//  Etiquetas de palet en la impresora de pegatinas, con QZ Tray
//
//  En la tablet hay dos impresoras: la de tickets (RP-12N, predeterminada,
//  a la que va el justificante con Chrome --kiosk-printing) y la de
//  pegatinas (Toshiba TEC BV420T, que Windows llama «TOSHIBA BV400 (203
//  dpi)»). Chrome no deja elegir impresora sin diálogo, así que las
//  etiquetas van por QZ Tray, un programa instalado en la tablet que
//  imprime en la impresora que se le diga.
//
//  QZ Tray solo imprime sin preguntar si la petición va firmada con la
//  clave de nuestro certificado. El certificado (público) está aquí y,
//  como override.crt, en C:\Program Files\QZ Tray\ de la tablet. La clave
//  privada no puede estar en la web: firma la función de Supabase
//  qz-firmar (supabase/functions/qz-firmar), que solo atiende a la cuenta
//  de la báscula.
//
//  imprimir() lanza un Error con .aviso (texto para el operario) si algo
//  falla. Nunca manda la etiqueta a otra impresora.
// =====================================================================

window.QZEtiquetas = (function () {
  // Parte del nombre de la impresora de pegatinas en Windows.
  const IMPRESORA = "BV400";

  const CERTIFICADO = `-----BEGIN CERTIFICATE-----
MIIDPTCCAiWgAwIBAgIUXJ0FS2S4sbpdvSvO+Ho3Aknjs/gwDQYJKoZIhvcNAQEL
BQAwLjEZMBcGA1UEAwwQYWdyb0JpbWkgYmFzY3VsYTERMA8GA1UECgwIYWdyb0Jp
bWkwHhcNMjYxMTI1MTgwMzUwWhcNMzYxMTIyMTgwMzUwWjAuMRkwFwYDVQQDDBBh
Z3JvQmltaSBiYXNjdWxhMREwDwYDVQQKDAhhZ3JvQmltaTCCASIwDQYJKoZIhvcN
AQEBBQADggEPADCCAQoCggEBAKpmcVidMEHx8ASyV+7NBddhQhPG5Sb6B3Djq4yH
JUmcVazNvjPPkKE2pdA5evcrtCSystK/oUPsOAJrSGRqURPsp4eRY3ama07wLq6I
vEy3l3dHcV9xAFr+avgZjj3E1oCFapgEjHQ1exFRH/2UYHQ/4KFJYkkteRQF3L8X
TtQEZgkU+7V8afVog0RQ0BIChj++AxKN+pczrLKmeTC3t6cvxcsNUb6X/HNONW/L
9bsumQi2clCWEcd+RXK/tlzsm//YFuRLmO8e6Ce3Vcjym/CKmDymZaJq+u7cW2Av
2y93fYW0niKTXCrgjHc/ft0uiTdR8TE8FiUiq5s6DhCDal0CAwEAAaNTMFEwHQYD
VR0OBBYEFHUsQfyUnOkZLqHkFRSH/et79/uAMB8GA1UdIwQYMBaAFHUsQfyUnOkZ
LqHkFRSH/et79/uAMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEB
AIqqbhtqTnC+pR3VMZB62jVzv2CLhaV6pjN5m0opQcmLinySajPzmP30F6yK14WJ
wDy3xqS9SR0bN1M7WVCltr6e/HNeHPM/ow/DwSccSi948OA7lANRuYMbScNHO3l+
XG7uCYEp0gK0Cc+dPIL7/s1gROIxIcuB4zIjs4E+fru9YMEPV1h6LxkC6XKfbRvn
RG5MiXHtEiG2X50gtgkGUcEEV7MbwszKu72cMI9f9AG9KSVy/zWZgR5h5BXYnY0g
MVkAG4oHbH81q3iNyP2FMLqSM2lYjNq3My8gVwmItYnFgm9E3inb8Tjd3TvV3Ycl
tarsPV2BwvZ7X8piFXBbCaI=
-----END CERTIFICATE-----`;

  // QZ dibuja la etiqueta aparte, sin las hojas de estilo de la página:
  // los estilos van dentro. Mismo diseño que la de la oficina (styles.css,
  // .etq), pero todo en negro y el código a 9 pt: la térmica no hace
  // grises y a 8 pt casi no marca.
  const ESTILOS = `
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; }
    .etq-cabecera { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 2mm; }
    .etq-numero { font-size: 13pt; font-weight: 700; }
    .etq-fecha { margin-left: 4mm; font-size: 13pt; font-weight: 700; }
    .etq-codigo { font-size: 9pt; }
    .etq-tabla { width: 100%; border-collapse: collapse; font-size: 12pt; }
    .etq-tabla td { padding: .8mm 1mm; }
    .etq-tabla .der { text-align: right; font-weight: 700; white-space: nowrap; }`;

  function falla(aviso, causa) {
    const e = new Error(aviso);
    e.aviso = aviso;
    if (causa) e.cause = causa;
    return e;
  }

  let preparadoCon = null;
  function preparar(qz, db) {
    if (preparadoCon === db) return;
    preparadoCon = db;
    qz.security.setCertificatePromise((resolve) => resolve(CERTIFICADO));
    qz.security.setSignatureAlgorithm("SHA512");
    qz.security.setSignaturePromise((peticion) => (resolve, reject) => {
      db.functions.invoke("qz-firmar", { body: { peticion } })
        .then(({ data, error }) => (error || typeof data !== "string" ? reject(error || new Error("Firma vacía")) : resolve(data)))
        .catch(reject);
    });
  }

  // Una sola conexión aunque se pidan dos etiquetas a la vez.
  let conectando = null;
  async function conectar(qz) {
    if (qz.websocket.isActive()) return;
    if (!conectando) {
      conectando = qz.websocket.connect({ retries: 2, delay: 1 })
        .finally(() => { conectando = null; });
    }
    try {
      await conectando;
    } catch (e) {
      throw falla("QZ Tray no está abierto en la tablet. Ábrelo y vuelve a imprimir la etiqueta.", e);
    }
  }

  async function impresora(qz) {
    try {
      return await qz.printers.find(IMPRESORA);
    } catch (e) {
      throw falla("No se encuentra la impresora de etiquetas (TOSHIBA BV400). Revisa que esté encendida y conectada.", e);
    }
  }

  async function imprimir({ html, ancho = 105, alto = 75 }, db) {
    const qz = window.qz;
    if (!qz) throw falla("No se pudo cargar QZ Tray en la página. Revisa la conexión y recarga.");
    preparar(qz, db);
    await conectar(qz);
    const nombre = await impresora(qz);
    const config = qz.configs.create(nombre, {
      size: { width: ancho, height: alto },
      units: "mm",
      margins: 4,
      colorType: "blackwhite",
      copies: 1,
    });
    const datos = [{
      type: "pixel",
      format: "html",
      flavor: "plain",
      data: `<html><head><meta charset="utf-8"><style>${ESTILOS}</style></head><body>${html}</body></html>`,
      options: { pageWidth: ancho - 8, pageHeight: alto - 8 },
    }];
    try {
      await qz.print(config, datos);
    } catch (e) {
      throw falla("QZ Tray no pudo imprimir la etiqueta. Revisa la impresora de etiquetas.", e);
    }
  }

  return { imprimir, IMPRESORA };
})();
