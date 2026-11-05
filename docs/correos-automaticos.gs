/* =====================================================================
   Correos.gs — Registro automático desde los avisos de los bancos
   (Finanzas H&S · vive en el MISMO proyecto de Apps Script que las
   notificaciones y el reporte mensual)

   Cada 5 minutos (trigger de tiempo) revisa el Gmail de Héctor:
     · Compras con tarjeta → EGRESO directo en la app:
         - BAC:        notificacion_hn@baccredomatic.com
                       «BAC Credomatic Informa» (solo Estado = Aprobada)
         - Davivienda: honduras.alertastarjetas@davivienda.com.hn
                       «Notificación de transacción»
       Categoría: 1) regla aprendida para ese comercio (las que ustedes
       corrigen en la app), 2) si no hay, la sugiere Claude (créditos de
       API, ~US$ 0.005 por comercio nuevo; se recuerda), 3) si no hay
       llave o no está seguro: «Sin categoría» → «Por clasificar».
     · Débitos de cuenta → colección «pendientes» (NO suman hasta que en
       la app se toque «Es gasto»): pueden ser traslados entre sus
       cuentas o pagos de tarjeta, y contarlos dos veces sería un error.
         - BAC:        alerta@baccredomatic.com «Notificación Movimiento
                       Monetario» (Monto enviado)
         - Davivienda: notificaciones.banco@davivienda.com.hn «Débito a
                       Cuenta»
   Sin duplicados:
     · cada correo se procesa una sola vez (ids en Script Properties) y
       el documento se crea con id «auto_<idCorreo>» (crear dos veces
       el mismo da 409 y no pasa nada);
     · si ya anotaron ese gasto a mano (mismo monto exacto y mismo banco,
       ±2 días), NO se crea otro: se enlaza el correo al registro existente
       y se aprende la categoría que le pusieron para ese comercio;
     · si se PARECE a algo anotado (monto con ±L 1 de diferencia u otro
       banco), no se suma solo: queda «por confirmar» con la pista
       «parece que ya lo anotaron» (mejor preguntar que contar doble).
   Además, igual que si lo anotaran en el teléfono:
     · aviso por correo a ambos si supera el umbral de la app;
     · alarmas del presupuesto mensual (20 %, 10 %, 5 %… una vez por mes).

   Requisitos del proyecto:
     · Servicio avanzado «Gmail API» agregado (identificador «Gmail»).
     · appsscript.json con los scopes de abajo (gmail.readonly = solo
       lectura del correo; nunca envía ni borra desde Gmail).
     · Llave del API de Claude (opcional) en Propiedades del script:
       ANTHROPIC_API_KEY. Nunca en el código ni en el repositorio.

   Utilidades (ejecutar desde el editor):
     1) probarLecturaCorreos()    → lee los últimos avisos de cada banco y
                                    muestra en el registro lo que entendió.
                                    NO escribe nada.
     2) probarClasificador()      → pregunta a Claude por 3 comercios de
                                    ejemplo (necesita la llave). NO escribe.
     3) activarRegistroAutomatico() → instala el trigger cada 5 min y
                                    toma como inicio AHORA (no importa
                                    correos viejos).
     4) importarDesde("2026-11-01") → mueve el inicio a esa fecha para
                                    recuperar avisos recientes (máx. 10
                                    días); lo ya anotado a mano se enlaza.
        recuperarDesdeInicioDeMes() → lo mismo desde el día 1 del mes en
                                    curso (sirve con el botón Ejecutar).
     5) desactivarRegistroAutomatico() → quita el trigger.
     6) clasificarSinCategoria()  → con la llave ya puesta, le pide a Claude
                                    la categoría de las compras automáticas
                                    que quedaron «Sin categoría».
     7) cierreDiario()            → corre sola cada noche (11 p. m.): quita
                                    duplicados seguros (doble toque; lo anotado
                                    a mano que repite un cargo que ya entró
                                    solo) y avisa los dudosos. Lo borrado va a
                                    la colección «papelera» (recuperable).
   ===================================================================== */

const COR_PROYECTO = "flujo-matrimonial";
const COR_BASE = "https://firestore.googleapis.com/v1/projects/" + COR_PROYECTO +
  "/databases/(default)/documents/hogar/principal";
const COR_TZ = "America/Tegucigalpa";               // UTC-6 fijo, sin horario de verano
const COR_DESTINOS = "hectorlcastro09@gmail.com, soniag.chinchilla@gmail.com";
const COR_CORREO_ERRORES = "hectorlcastro09@gmail.com";
const COR_REMITENTE = "Finanzas H&S";
const COR_MODELO = "claude-opus-5-5";
const COR_VENTANA_DIAS = 10;                       // solo se miran avisos de los últimos 10 días
const COR_DUP_MS = 2 * 86400000;                   // ± 2 días = "el mismo gasto"
const COR_TOLERANCIA_L = 1.0;                      // redondeos al anotar a mano (464.11 → 464)
const COR_FRESCO_MS = 6 * 3600000;                 // solo se avisa por correo lo de las últimas 6 h
const COR_CIERRE_DIAS = 10;                        // el cierre diario revisa los últimos 10 días
const COR_DOBLE_TOQUE_MS = 120000;                 // mismos datos con ≤ 2 min de diferencia = doble registro
const COR_MAX_IDS = 400;                           // ids procesados que se recuerdan
const COR_TIEMPO_MAX_MS = 4 * 60000;               // Apps Script corta a los 6 min: parar antes y seguir en la próxima corrida
const COR_PROP_DESDE = "corDesde";                 // epoch ms: desde cuándo se leen avisos
const COR_PROP_IDS = "corProcesados";              // JSON [ids de Gmail ya procesados]
const COR_PROP_AVISO_ERROR = "corUltimoAvisoError"; // "yyyy-MM-dd": 1 correo de error por día
const COR_PROP_ESTADO = "corUltimoEstado";         // epoch ms de la última escritura de config/auto
const COR_MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
  "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const COR_ESCALERA_PCT = [20, 10, 5, 4, 3, 2, 1];
const COR_PRESUPUESTO_DEFAULT = 100000;
const COR_UMBRAL_DEFAULT = 1000;

const COR_FUENTES = [
  { id: "bac-tarjeta", nombre: "BAC tarjeta", banco: "BAC Credomatic", tipo: "tarjeta",
    remitente: "notificacion_hn@baccredomatic.com",
    q: 'from:notificacion_hn@baccredomatic.com subject:"BAC Credomatic Informa"' },
  { id: "davi-tarjeta", nombre: "Davivienda tarjeta", banco: "Davivienda", tipo: "tarjeta",
    remitente: "honduras.alertastarjetas@davivienda.com.hn",
    q: 'from:honduras.alertastarjetas@davivienda.com.hn subject:"Notificación de transacción"' },
  { id: "bac-cuenta", nombre: "BAC cuenta", banco: "BAC Credomatic", tipo: "cuenta",
    remitente: "alerta@baccredomatic.com",
    q: 'from:alerta@baccredomatic.com subject:"Notificación Movimiento Monetario"' },
  { id: "davi-cuenta", nombre: "Davivienda cuenta", banco: "Davivienda", tipo: "cuenta",
    remitente: "notificaciones.banco@davivienda.com.hn",
    q: 'from:notificaciones.banco@davivienda.com.hn subject:"Débito a Cuenta"' }
];

/* ------------------------------------------------------------------ */
/* Función principal (la apunta el trigger de cada 5 minutos)          */
/* ------------------------------------------------------------------ */

function revisarCorreos() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return;                 // otra corrida en curso
  const inicio = Date.now();
  const props = PropertiesService.getScriptProperties();
  const desde = Number(props.getProperty(COR_PROP_DESDE)) || 0;
  if (!desde) { lock.releaseLock(); return; }       // no activado
  const r = { nuevos: 0, pendientes: 0, enlazados: 0, ignorados: 0, errores: [], cortado: false };
  try {
    const hechos = corLeerIds_(props);
    const piso = Math.max(desde, Date.now() - COR_VENTANA_DIAS * 86400000);
    let ctx = null;                                 // config, reglas, etc.: solo si hay algo nuevo

    COR_FUENTES.forEach(function (f) {
      if (r.cortado) return;
      corListarMensajes_(f.q + " after:" + Math.floor(piso / 1000)).forEach(function (ref) {
        if (r.cortado || hechos.has(ref.id)) return;
        // cerca del límite de Apps Script (p. ej. al recuperar varios días):
        // lo que falte sigue en la próxima corrida, sin perder lo hecho
        if (Date.now() - inicio > COR_TIEMPO_MAX_MS) { r.cortado = true; return; }
        let msg;
        try { msg = corLeerMensaje_(ref.id); }
        catch (err) { r.errores.push(f.nombre + ": no se pudo leer el correo (" + err + ")"); return; }
        if (msg.fecha.getTime() < desde) return;    // anterior a la activación: no se toca
        if (msg.de.indexOf(f.remitente) < 0) { hechos.add(ref.id); r.ignorados++; return; }
        try {
          const mov = corInterpretar_(f, msg);
          if (!mov) { hechos.add(ref.id); r.ignorados++; return; }   // rechazada, crédito, retención…
          ctx = ctx || corContexto_();
          const res = corRegistrar_(f, mov, msg, ctx, r.errores);
          r[res] = (r[res] || 0) + 1;
          hechos.add(ref.id);
          corGuardarIds_(props, hechos);            // ya escribió en Firestore: anotarlo enseguida
        } catch (err) {
          if (err && err.formato) {                 // el banco cambió el formato: avisar y no reintentar
            hechos.add(ref.id);
            r.errores.push(f.nombre + " (" + Utilities.formatDate(msg.fecha, COR_TZ, "dd/MM HH:mm") + "): " + err.message);
          } else {                                  // red / Firestore: se reintenta en la próxima corrida
            r.errores.push(f.nombre + ": " + (err && err.message ? err.message : err));
          }
        }
      });
    });
    corGuardarIds_(props, hechos);
  } catch (err) {
    r.errores.push(String(err && err.message ? err.message : err));
  } finally {
    try { corGuardarEstado_(r, props); } catch (_) { /* el estado es informativo */ }
    if (r.errores.length) corAvisarError_(props, r.errores);
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/* Gmail (servicio avanzado, solo lectura)                             */
/* ------------------------------------------------------------------ */

function corListarMensajes_(q) {
  const out = [];
  let token = null;
  do {
    const res = Gmail.Users.Messages.list("me", { q: q, maxResults: 100, pageToken: token || undefined });
    (res.messages || []).forEach(function (m) { out.push(m); });
    token = res.nextPageToken;
  } while (token && out.length < 300);
  return out.reverse();                             // del más viejo al más nuevo
}

function corLeerMensaje_(id) {
  const m = Gmail.Users.Messages.get("me", id, { format: "full" });
  const headers = {};
  ((m.payload && m.payload.headers) || []).forEach(function (h) { headers[h.name.toLowerCase()] = h.value; });
  const partes = { plain: [], html: [] };
  corRecorrerPartes_(m.payload, partes);
  const html = partes.html.join("\n");
  const texto = html ? corHtmlATexto_(html) : partes.plain.join("\n");
  return {
    id: id,
    fecha: new Date(Number(m.internalDate)),
    de: String(headers["from"] || "").toLowerCase(),
    asunto: String(headers["subject"] || ""),
    texto: texto
  };
}

function corRecorrerPartes_(p, acc) {
  if (!p) return;
  const tipo = String(p.mimeType || "").toLowerCase();
  if (p.body && p.body.data && (tipo === "text/plain" || tipo === "text/html")) {
    const ct = ((p.headers || []).filter(function (h) { return /^content-type$/i.test(h.name); })[0] || {}).value || "";
    const charset = ((ct.match(/charset="?([^";]+)"?/i) || [])[1] || "UTF-8").trim();
    const txt = corDecodificar_(p.body.data, charset);
    (tipo === "text/html" ? acc.html : acc.plain).push(txt);
  }
  (p.parts || []).forEach(function (h) { corRecorrerPartes_(h, acc); });
}

// El servicio avanzado entrega el cuerpo como bytes; por si llegara en
// base64url, también se decodifica.
function corDecodificar_(data, charset) {
  let bytes = data;
  if (typeof data === "string") {
    let s = data.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    bytes = Utilities.base64Decode(s);
  }
  try { return Utilities.newBlob(bytes).getDataAsString(charset); }
  catch (_) { return Utilities.newBlob(bytes).getDataAsString("UTF-8"); }
}

function corHtmlATexto_(html) {
  const ent = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
    aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", uuml: "ü",
    Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", Uuml: "Ü" };
  return String(html)
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|td|th|li|h\d|pre|table|center)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|[a-z]+);/gi, function (m, e) {
      if (e.charAt(0) === "#") return String.fromCharCode(Number(e.slice(1)));
      return ent.hasOwnProperty(e) ? ent[e] : m;
    })
    .replace(/[ \t\r ]+/g, " ")
    .split("\n").map(function (s) { return s.trim(); }).filter(Boolean).join("\n");
}

/* ------------------------------------------------------------------ */
/* Interpretación de cada aviso                                        */
/* ------------------------------------------------------------------ */

function corErrorFormato_(msg) {
  const e = new Error(msg);
  e.formato = true;
  return e;
}

// → { monto, moneda, fecha, comercio?, tarjeta?, detalle } o null si no es un gasto
function corInterpretar_(f, msg) {
  if (f.id === "bac-tarjeta") return corBacTarjeta_(msg);
  if (f.id === "davi-tarjeta") return corDaviTarjeta_(msg);
  if (f.id === "bac-cuenta") return corBacCuenta_(msg);
  if (f.id === "davi-cuenta") return corDaviCuenta_(msg);
  return null;
}

// "L 2220", "L 7902.04", "USD 12.99", "$ 5.00", "LPS 1,234.50"
function corMonto_(txt) {
  const m = String(txt || "").replace(/\s+/g, " ").trim()
    .match(/^(L|LPS|HNL|USD|US\$|\$)\.?\s*([\d,]+(?:\.\d{1,2})?)$/i);
  if (!m) return null;
  const valor = Number(m[2].replace(/,/g, ""));
  if (!(valor > 0)) return null;
  return { valor: valor, moneda: /^(USD|US\$|\$)$/i.test(m[1]) ? "USD" : "HNL" };
}

// Horario de BAC: "2026/11/01-15:05:24" (hora de Honduras)
function corFechaBac_(txt) {
  const m = String(txt || "").match(/(\d{4})\/(\d{2})\/(\d{2})-(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + 6, +m[5], +(m[6] || 0)));
}

function corBacTarjeta_(msg) {
  const L = msg.texto.split("\n");
  const iMonto = L.indexOf("Monto");
  if (iMonto < 0) throw corErrorFormato_("aviso de tarjeta BAC sin el campo «Monto»");
  let iValor = -1;
  for (let i = iMonto + 1; i < Math.min(L.length, iMonto + 6); i++) {
    if (corMonto_(L[i])) { iValor = i; break; }
  }
  if (iValor < 0) throw corErrorFormato_("aviso de tarjeta BAC con monto ilegible");
  const monto = corMonto_(L[iValor]);
  const comercio = L.slice(iMonto + 1, iValor).join(" ").trim();
  const iEstado = L.indexOf("Estado");
  const estado = iEstado >= 0
    ? (L.slice(iEstado + 1, iEstado + 4).filter(function (s) {
        return /^(aprobad|rechazad|denegad|declinad|revers|anulad)/i.test(s);
      })[0] || "")
    : "";
  if (!/^aprobad/i.test(estado)) return null;       // solo compras aprobadas
  // En el correo de BAC es una tabla: primero los encabezados «Tipo de compra |
  // Estado» y después los valores «Tarjeta Presente | Aprobada». Por eso el tipo
  // va justo después de «Estado» (verificado con correos reales; NO es iTipo + 1).
  const iTipo = L.indexOf("Tipo de compra");
  const tipoCompra = iEstado >= 0 && iTipo >= 0 ? (L[iEstado + 1] || "") : "";
  const iHor = L.indexOf("Horario");
  const fecha = (iHor >= 0 && corFechaBac_(L[iHor + 1])) || msg.fecha;
  const tarjeta = (msg.texto.match(/\b(MASTERCARD|VISA|AMEX|AMERICAN EXPRESS)\s+(\d{4})\b/i) || []);
  return {
    monto: monto.valor, moneda: monto.moneda, fecha: fecha,
    comercio: comercio || "Compra con tarjeta",
    tarjeta: tarjeta[1] ? tarjeta[1].toUpperCase() + " " + tarjeta[2] : "",
    detalle: tipoCompra
  };
}

function corDaviTarjeta_(msg) {
  const t = msg.texto.replace(/\s+/g, " ");
  const m = t.match(/tarjeta Davivienda No\.?\s*(\d{4}) fue utilizada recientemente en (.+?)\s*,\s*por un monto de ([\d,]+(?:\.\d+)?)\s+(Lempiras?|D[oó]lares)/i);
  if (!m) throw corErrorFormato_("aviso de tarjeta Davivienda con formato desconocido");
  const crudo = m[2];
  if (/TEMPORARY HOLD|AUTHORIZATION HOLD|VERIFICACI[OÓ]N/i.test(crudo)) return null;  // retención de prueba, no es gasto
  const comercio = crudo
    .replace(/\s*\+?\d[\d\- ]{6,}\d/g, " ")     // teléfonos
    .replace(/\s+[A-Z]{2}\s*$/, "")             // país al final ("US", "HN")
    .replace(/\s+/g, " ").trim();
  return {
    monto: Number(m[3].replace(/,/g, "")),
    moneda: /^d/i.test(m[4]) ? "USD" : "HNL",
    fecha: msg.fecha,
    comercio: comercio || "Compra con tarjeta",
    tarjeta: "Davivienda " + m[1],
    detalle: ""
  };
}

function corBacCuenta_(msg) {
  const t = msg.texto.replace(/\s+/g, " ");
  if (!/monto enviado/i.test(t)) return null;      // solo salidas de dinero
  const m = t.match(/por un monto de\s+([\d,]+\.\d{2})\s*(LPS|USD|US\$)/i);
  if (!m) throw corErrorFormato_("aviso de cuenta BAC con monto ilegible");
  const f = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+a las\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/i);
  const fecha = f ? new Date(Date.UTC(+f[3], +f[2] - 1, +f[1], +f[4] + 6, +f[5], +(f[6] || 0))) : msg.fecha;
  const cuenta = (t.match(/n[uú]mero\s+\*+(\d{3,4})/i) || [])[1] || "";
  return {
    monto: Number(m[1].replace(/,/g, "")), moneda: /^L/i.test(m[2]) ? "HNL" : "USD", fecha: fecha,
    detalle: "Débito de la cuenta" + (cuenta ? " ****" + cuenta : "") + " (monto enviado)"
  };
}

function corDaviCuenta_(msg) {
  const t = msg.texto.replace(/\s+/g, " ");
  const m = t.match(/debito de su cuenta\s+(\d{3,4}),?\s*por un monto de\s+(L|\$|USD)?\s*([\d,]+\.\d{2}),?\s*transacci[oó]n realizada en\s+([A-Za-z ]+)/i);
  if (!m) throw corErrorFormato_("aviso de débito Davivienda con formato desconocido");
  return {
    monto: Number(m[3].replace(/,/g, "")), moneda: m[2] && /\$|USD/i.test(m[2]) ? "USD" : "HNL",
    fecha: msg.fecha,
    detalle: "Débito de la cuenta ****" + m[1] + " (" + m[4].trim() + ")"
  };
}

/* ------------------------------------------------------------------ */
/* Registro en Firestore                                                */
/* ------------------------------------------------------------------ */

// Datos que se leen una sola vez por corrida (y solo si hay algo nuevo)
function corContexto_() {
  const app = corLeerDoc_("/config/app") || {};
  const categorias = corListarColeccion_("/categorias").map(function (d) { return d.nombre; })
    .filter(function (n) { return n; });
  const reglas = {};
  corListarColeccion_("/reglas").forEach(function (d) {
    if (d.__id && d.categoria) reglas[d.__id] = { categoria: d.categoria, origen: d.origen || "", comercio: d.comercio || "" };
  });
  const tasa = Number(app.tasaCambioActual) > 0 ? Number(app.tasaCambioActual) : 24.6;
  return {
    tasa: tasa,
    umbral: Number(app.notifUmbral) > 0 ? Number(app.notifUmbral) : COR_UMBRAL_DEFAULT,
    avisosActivos: !!(app.notifUrl && app.notifSecret),
    presupuesto: app.presupuestoMensual === undefined || app.presupuestoMensual === null
      ? COR_PRESUPUESTO_DEFAULT : (Number(app.presupuestoMensual) || 0),
    categorias: categorias,
    reglas: reglas
  };
}

// → "nuevos" | "pendientes" | "enlazados" | "ignorados" (este correo ya estaba registrado)
// (errores: lista de la corrida, para lo que falle DESPUÉS de guardar)
function corRegistrar_(f, mov, msg, ctx, errores) {
  errores = errores || [];
  const tasa = mov.moneda === "USD" ? ctx.tasa : null;
  const montoHNL = mov.moneda === "USD" ? Math.round(mov.monto * ctx.tasa * 100) / 100 : mov.monto;

  // ¿ya lo anotaron a mano? (o este mismo correo ya quedó registrado)
  const previo = corBuscarManual_(f.banco, mov, msg.id);
  if (previo && previo.yaRegistrado) return "ignorados";   // no se registra ni se enlaza otra vez
  if (previo && previo.exacto) {
    // mismo monto exacto y mismo banco → es el mismo: se enlaza (no se duplica)
    corPatch_("/transacciones/" + previo.id, {
      gmailId: msg.id, vinculadoCorreo: true, fuente: f.nombre,
      comercio: mov.comercio || "", tarjeta: mov.tarjeta || ""
    });
    // y se aprende la categoría que le pusieron a ese comercio
    if (mov.comercio && previo.categoria && previo.categoria !== "Sin categoría") {
      corAprender_(mov.comercio, previo.categoria, ctx);
    }
    return "enlazados";
  }

  const cat = f.tipo === "tarjeta" ? corCategoria_(mov.comercio, mov, ctx) : null;
  if (f.tipo === "cuenta" || previo) {
    // débito de cuenta, o compra que se PARECE a algo ya anotado: por confirmar
    const pend = {
      monto: montoHNL, montoOriginal: mov.monto, moneda: mov.moneda, tasaCambio: tasa,
      cuenta: f.banco, fecha: mov.fecha, fuente: f.nombre, detalle: mov.detalle || "",
      gmailId: msg.id, creadoEn: new Date()
    };
    if (mov.comercio) pend.comercio = mov.comercio;
    if (mov.tarjeta) pend.tarjeta = mov.tarjeta;
    if (cat && cat.categoria !== "Sin categoría") pend.categoriaSugerida = cat.categoria;
    if (previo) {
      pend.posibleDuplicadoDe = previo.id;
      pend.pista = "Parece que ya lo anotaron: " + (previo.categoria || "egreso") + " " +
        corFmtL_(previo.monto) + " en " + (previo.cuenta || "—") + " (" +
        Utilities.formatDate(previo.fecha, COR_TZ, "dd/MM") + ")";
    }
    corCrear_("/pendientes", "auto_" + msg.id, pend);
    return "pendientes";
  }

  const tx = {
    tipo: "egreso", persona: "hs",
    monto: montoHNL, montoOriginal: mov.monto, moneda: mov.moneda, tasaCambio: tasa,
    categoria: cat.categoria, descripcion: mov.comercio,
    metodoPago: "tarjeta_credito",
    cuenta: f.banco, fecha: mov.fecha,
    creadoPor: "correo", creadoEn: new Date(),
    origen: "correo", fuente: f.nombre, comercio: mov.comercio,
    tarjeta: mov.tarjeta || "", gmailId: msg.id, categoriaVia: cat.via,
    detalle: mov.detalle || ""
  };
  const creado = corCrear_("/transacciones", "auto_" + msg.id, tx);
  if (creado) {
    // El egreso ya quedó guardado: si falla el aviso o el presupuesto se
    // reporta, pero el correo cuenta como procesado.
    try { corAvisoMovimiento_(tx, ctx); }
    catch (err) { errores.push(f.nombre + ": no se envió el aviso del movimiento (" + (err && err.message ? err.message : err) + ")"); }
    try { corRevisarPresupuesto_(tx, ctx); }
    catch (err) { errores.push(f.nombre + ": no se revisó el presupuesto (" + (err && err.message ? err.message : err) + ")"); }
  }
  return "nuevos";
}

// Egreso anotado a mano que corresponde a este aviso:
//   { id, yaRegistrado: true } → ESTE correo ya está en un movimiento
//                                (corrida anterior cortada, o confirmado en la app)
//   { id, exacto: true }  → mismo monto exacto y mismo banco (es el mismo)
//   { id, exacto: false } → se parece (±L 1 o en otro banco): preguntar
//   null                  → no hay nada parecido
function corBuscarManual_(banco, mov, gmailId) {
  const ini = new Date(mov.fecha.getTime() - COR_DUP_MS);
  const fin = new Date(mov.fecha.getTime() + COR_DUP_MS);
  const filas = corFetch_(":runQuery", "post", {
    structuredQuery: {
      from: [{ collectionId: "transacciones" }],
      where: { compositeFilter: { op: "AND", filters: [
        { fieldFilter: { field: { fieldPath: "fecha" }, op: "GREATER_THAN_OR_EQUAL", value: { timestampValue: ini.toISOString() } } },
        { fieldFilter: { field: { fieldPath: "fecha" }, op: "LESS_THAN_OR_EQUAL", value: { timestampValue: fin.toISOString() } } }
      ] } },
      orderBy: [{ field: { fieldPath: "fecha" }, direction: "ASCENDING" }],
      limit: 300
    }
  }) || [];
  let exacto = null, parecido = null, ya = null, distE = Infinity, distP = Infinity;
  filas.forEach(function (fila) {
    if (!fila.document) return;
    const d = corDocAObjeto_(fila.document);
    if (gmailId && d.gmailId === gmailId) { ya = { id: d.__id, yaRegistrado: true }; return; }
    if (d.tipo !== "egreso" || d.origen === "correo" || d.gmailId) return;
    const original = (d.moneda || "HNL") === mov.moneda
      ? Number(d.montoOriginal != null ? d.montoOriginal : d.monto) : NaN;
    const diff = Math.abs(original - mov.monto);
    if (!(diff <= COR_TOLERANCIA_L)) return;
    const dist = Math.abs(d.fecha.getTime() - mov.fecha.getTime());
    const info = { id: d.__id, categoria: d.categoria || "", monto: Number(d.monto) || 0,
      cuenta: d.cuenta || "", fecha: d.fecha };
    if (diff < 0.011 && d.cuenta === banco) {
      if (dist < distE) { exacto = info; distE = dist; }
    } else if (dist < distP) { parecido = info; distP = dist; }
  });
  if (ya) return ya;
  if (exacto) { exacto.exacto = true; return exacto; }
  if (parecido) { parecido.exacto = false; return parecido; }
  return null;
}

/* ------------------------------------------------------------------ */
/* Categoría: regla aprendida → Claude → «Sin categoría»               */
/* ------------------------------------------------------------------ */

// Misma normalización que Store.claveComercio() en la app
function corClave_(comercio) {
  return String(comercio || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ /g, "_")
    .slice(0, 120);
}

function corCategoria_(comercio, mov, ctx) {
  const clave = corClave_(comercio);
  const regla = clave && ctx.reglas[clave];
  if (regla && ctx.categorias.indexOf(regla.categoria) >= 0) return { categoria: regla.categoria, via: "regla" };

  const llave = PropertiesService.getScriptProperties().getProperty("ANTHROPIC_API_KEY");
  if (!llave || !clave) return { categoria: "Sin categoría", via: "ninguna" };
  try {
    const cat = corPreguntarClaude_(llave, comercio, mov, ctx);
    if (cat && cat !== "Sin categoría" && ctx.categorias.indexOf(cat) >= 0) {
      ctx.reglas[clave] = { categoria: cat, origen: "ia", comercio: comercio };
      try {
        corPatch_("/reglas/" + clave, { comercio: comercio, categoria: cat, origen: "ia", actualizado: new Date() });
      } catch (_) { /* recordar es opcional */ }
      return { categoria: cat, via: "ia" };
    }
  } catch (err) {
    console.warn("clasificador: " + err);
  }
  return { categoria: "Sin categoría", via: "ninguna" };
}

// Regla aprendida de lo que ustedes anotaron a mano (no pisa una corrección
// hecha en la app: esas ya tienen origen "usuario").
function corAprender_(comercio, categoria, ctx) {
  const clave = corClave_(comercio);
  if (!clave || ctx.categorias.indexOf(categoria) < 0) return;
  const actual = ctx.reglas[clave];
  if (actual && actual.origen === "usuario") return;
  ctx.reglas[clave] = { categoria: categoria, origen: "usuario", comercio: comercio };
  try {
    corPatch_("/reglas/" + clave, { comercio: comercio, categoria: categoria, origen: "usuario", actualizado: new Date() });
  } catch (_) { /* recordar es opcional */ }
}

function corPreguntarClaude_(llave, comercio, mov, ctx) {
  const ejemplos = Object.keys(ctx.reglas)
    .filter(function (k) { return ctx.reglas[k].origen === "usuario"; })
    .slice(0, 40)
    .map(function (k) { return "- " + (ctx.reglas[k].comercio || k) + " → " + ctx.reglas[k].categoria; });
  const sistema =
    "Clasificas compras con tarjeta de una familia de San Pedro Sula, Honduras, en UNA de sus categorías de gastos. " +
    "Pistas: restaurantes, cafeterías, heladerías y comida rápida → Restaurante; supermercados, despensas y pulperías → Supermercado; " +
    "gasolineras → Combustible; farmacias → Farmacéutico; compras por internet, suscripciones digitales y apps → Online; " +
    "envíos y paquetería → Logística; tiendas de ropa, calzado, hogar y departamentales → Tiendas & departamentos. " +
    "Si el comercio no permite saberlo con razonable seguridad, responde \"Sin categoría\"." +
    (ejemplos.length ? "\n\nAsí ha clasificado la familia otros comercios:\n" + ejemplos.join("\n") : "");
  const cuerpo = {
    model: COR_MODELO,
    max_tokens: 2048,
    fallbacks: "default",
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: {
        type: "object",
        properties: { categoria: { type: "string", enum: ctx.categorias.concat(["Sin categoría"]) } },
        required: ["categoria"],
        additionalProperties: false
      } }
    },
    system: sistema,
    messages: [{ role: "user", content:
      "Comercio: " + comercio + "\nMonto: " + (mov.moneda === "USD" ? "US$ " : "L ") + mov.monto +
      (mov.detalle ? "\nTipo de compra: " + mov.detalle : "") }]
  };
  const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "post",
    contentType: "application/json",
    headers: {
      "x-api-key": llave,
      "anthropic-version": "2026-10-21",
      "anthropic-beta": "server-side-fallback-2026-07-01"
    },
    payload: JSON.stringify(cuerpo),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error("API de Claude " + res.getResponseCode() + ": " + res.getContentText().slice(0, 300));
  }
  const r = JSON.parse(res.getContentText());
  if (r.stop_reason === "refusal") return null;     // declinó: queda «Sin categoría»
  const texto = (r.content || []).filter(function (b) { return b.type === "text"; })
    .map(function (b) { return b.text; }).join("");
  return JSON.parse(texto).categoria;
}

/* ------------------------------------------------------------------ */
/* Avisos por correo (mismas reglas que la app)                        */
/* ------------------------------------------------------------------ */

function corFmtL_(n) {
  const num = Number(n) || 0;
  const p = Math.abs(num).toFixed(2).split(".");
  p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (num < 0 ? "-L " : "L ") + p[0] + "." + p[1];
}

function corAvisoMovimiento_(tx, ctx) {
  if (!ctx.avisosActivos || !(tx.monto > ctx.umbral)) return;
  if (Date.now() - tx.fecha.getTime() > COR_FRESCO_MS) return;   // recuperados de días atrás: sin correo
  const usd = tx.moneda === "USD" ? " ($" + Number(tx.montoOriginal).toFixed(2) + " USD)" : "";
  const lineas = [
    "Nuevo EGRESO registrado (automático, desde el aviso del banco)",
    "",
    "Monto:  " + corFmtL_(tx.monto) + usd,
    "Banco:  " + tx.cuenta,
    "Categoría:  " + tx.categoria + (tx.categoria === "Sin categoría" ? " (por clasificar en la app)" : ""),
    "Comercio:  " + tx.comercio
  ];
  if (tx.tarjeta) lineas.push("Tarjeta:  " + tx.tarjeta);
  lineas.push("Fecha:  " + Utilities.formatDate(tx.fecha, COR_TZ, "dd/MM/yyyy HH:mm"));
  lineas.push("", "— Finanzas H&S");
  MailApp.sendEmail({
    to: COR_DESTINOS, name: COR_REMITENTE,
    subject: "💸 Egreso de " + corFmtL_(tx.monto) + " — Finanzas H&S",
    body: lineas.join("\n")
  });
}

// Port de presupuesto.js → onEgresoCreado (una alarma por umbral y por mes)
function corRevisarPresupuesto_(tx, ctx) {
  const p = ctx.presupuesto;
  if (!(p > 0) || !ctx.avisosActivos) return;
  const mes = Utilities.formatDate(new Date(), COR_TZ, "yyyy-MM");
  if (Utilities.formatDate(tx.fecha, COR_TZ, "yyyy-MM") !== mes) return;

  const partes = mes.split("-");
  const ini = new Date(Date.UTC(+partes[0], +partes[1] - 1, 1, 6, 0, 0));
  const fin = new Date(Date.UTC(+partes[0], +partes[1], 1, 6, 0, 0));
  const filas = corFetch_(":runQuery", "post", {
    structuredQuery: {
      from: [{ collectionId: "transacciones" }],
      where: { compositeFilter: { op: "AND", filters: [
        { fieldFilter: { field: { fieldPath: "fecha" }, op: "GREATER_THAN_OR_EQUAL", value: { timestampValue: ini.toISOString() } } },
        { fieldFilter: { field: { fieldPath: "fecha" }, op: "LESS_THAN", value: { timestampValue: fin.toISOString() } } }
      ] } },
      orderBy: [{ field: { fieldPath: "fecha" }, direction: "ASCENDING" }],
      limit: 2000
    }
  }) || [];
  let gastado = 0;
  filas.forEach(function (fila) {
    if (!fila.document) return;
    const d = corDocAObjeto_(fila.document);
    if (d.tipo === "egreso") gastado += Number(d.monto) || 0;
  });
  const restante = p - gastado;

  const alertas = corLeerDoc_("/config/alertas") || {};
  const mismoMes = alertas.mes === mes;
  const enviadas = mismoMes && Array.isArray(alertas.enviadas) ? alertas.enviadas.map(Number) : [];
  const nuevas = COR_ESCALERA_PCT.filter(function (pct) {
    return restante <= p * pct / 100 && enviadas.indexOf(pct) < 0;
  });
  if (nuevas.length === 0) return;
  // marcar ANTES de enviar (igual que la app)
  corPatch_("/config/alertas", { mes: mes, enviadas: enviadas.concat(nuevas) });

  const excedido = restante < 0;
  const mesLabel = COR_MESES[Number(partes[1]) - 1] + " de " + partes[0];
  const pct = Math.round((gastado / p) * 100);
  const lineas = [
    "AVISO DE PRESUPUESTO — " + mesLabel,
    "",
    excedido
      ? "Ya se excedió el presupuesto del mes por " + corFmtL_(-restante) + "."
      : "Solo les quedan " + corFmtL_(restante) + " para gastar este mes.",
    "Gastado: " + corFmtL_(gastado) + " de " + corFmtL_(p) + " (" + pct + "%)",
    "",
    "Último egreso: " + corFmtL_(tx.monto) + " — " + tx.categoria + " (" + tx.cuenta + ", " + tx.comercio + ")",
    "",
    "— Finanzas H&S"
  ];
  MailApp.sendEmail({
    to: COR_DESTINOS, name: COR_REMITENTE,
    subject: excedido
      ? "🚨 Presupuesto excedido por " + corFmtL_(-restante) + " — Finanzas H&S"
      : "⚠️ Presupuesto: quedan " + corFmtL_(restante) + " este mes — Finanzas H&S",
    body: lineas.join("\n")
  });
}

/* ------------------------------------------------------------------ */
/* Estado (lo muestra la app en Ajustes) y avisos de error              */
/* ------------------------------------------------------------------ */

// Se escribe si pasó algo o cada ~25 min (la app lo usa para mostrar
// "Activo"); así los teléfonos no se refrescan cada 5 minutos por nada.
function corGuardarEstado_(r, props) {
  const huboAlgo = r.nuevos || r.pendientes || r.enlazados || r.errores.length || r.cortado;
  const ultima = Number(props.getProperty(COR_PROP_ESTADO)) || 0;
  if (!huboAlgo && Date.now() - ultima < 25 * 60000) return;
  const partes = [];
  if (r.nuevos) partes.push(r.nuevos + " nuevo(s)");
  if (r.pendientes) partes.push(r.pendientes + " por confirmar");
  if (r.enlazados) partes.push(r.enlazados + " ya anotado(s)");
  if (r.cortado) partes.push("quedan avisos: siguen en la próxima revisión");
  corPatch_("/config/auto", {
    ultimaRevision: new Date(),
    ultimoResumen: partes.join(", "),
    ultimoError: r.errores.length ? r.errores.join(" | ").slice(0, 500) : "",
    version: 1
  });
  props.setProperty(COR_PROP_ESTADO, String(Date.now()));
}

function corAvisarError_(props, errores) {
  const hoy = Utilities.formatDate(new Date(), COR_TZ, "yyyy-MM-dd");
  if (props.getProperty(COR_PROP_AVISO_ERROR) === hoy) return;   // máximo uno por día
  props.setProperty(COR_PROP_AVISO_ERROR, hoy);
  try {
    MailApp.sendEmail(COR_CORREO_ERRORES,
      "⚠️ Registro automático del banco: hubo un problema — Finanzas H&S",
      "El registro automático encontró esto (se reintenta solo cada 5 minutos):\n\n- " +
      errores.join("\n- ") + "\n\nSi el banco cambió el formato de sus avisos, hay que ajustar Correos.gs.");
  } catch (_) { /* queda en el registro de ejecuciones */ }
}

/* ------------------------------------------------------------------ */
/* Ids ya procesados                                                    */
/* ------------------------------------------------------------------ */

function corLeerIds_(props) {
  try { return new Set(JSON.parse(props.getProperty(COR_PROP_IDS) || "[]")); }
  catch (_) { return new Set(); }
}

function corGuardarIds_(props, set) {
  const lista = Array.from(set);
  props.setProperty(COR_PROP_IDS, JSON.stringify(lista.slice(-COR_MAX_IDS)));
}

/* ------------------------------------------------------------------ */
/* Firestore REST (token del dueño del proyecto, vía IAM)              */
/* ------------------------------------------------------------------ */

function corFetch_(ruta, metodo, payload) {
  const params = {
    method: metodo || "get",
    headers: {
      Authorization: "Bearer " + ScriptApp.getOAuthToken(),
      "x-goog-user-project": COR_PROYECTO
    },
    muteHttpExceptions: true
  };
  if (payload !== undefined) {
    params.contentType = "application/json";
    params.payload = JSON.stringify(payload);
  }
  const res = UrlFetchApp.fetch(COR_BASE + ruta, params);
  const codigo = res.getResponseCode();
  if (codigo === 404) return null;
  if (codigo === 409) { const e = new Error("ya existe"); e.existe = true; throw e; }
  if (codigo < 200 || codigo >= 300) {
    throw new Error("Firestore " + codigo + " en " + ruta + ": " + res.getContentText().slice(0, 300));
  }
  return JSON.parse(res.getContentText() || "{}");
}

function corTipado_(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(corTipado_) } };
  if (typeof v === "object") {
    const fields = {};
    Object.keys(v).forEach(function (k) { fields[k] = corTipado_(v[k]); });
    return { mapValue: { fields: fields } };
  }
  return { stringValue: String(v) };
}

// Los montos siempre como double (igual que los guarda el teléfono)
function corCampos_(obj) {
  const fields = {};
  Object.keys(obj).forEach(function (k) {
    const v = obj[k];
    fields[k] = (k === "monto" || k === "montoOriginal" || k === "tasaCambio") && typeof v === "number"
      ? { doubleValue: v } : corTipado_(v);
  });
  return { fields: fields };
}

function corValor_(v) {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("integerValue" in v) return Number(v.integerValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return new Date(v.timestampValue);
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(corValor_);
  if ("mapValue" in v) {
    const o = {};
    const f = v.mapValue.fields || {};
    Object.keys(f).forEach(function (k) { o[k] = corValor_(f[k]); });
    return o;
  }
  return null;
}

function corDocAObjeto_(doc) {
  const o = { __id: String(doc.name || "").split("/").pop() };
  const f = doc.fields || {};
  Object.keys(f).forEach(function (k) { o[k] = corValor_(f[k]); });
  return o;
}

function corLeerDoc_(ruta) {
  const d = corFetch_(ruta, "get");
  return d && d.fields ? corDocAObjeto_(d) : null;
}

function corListarColeccion_(ruta) {
  const out = [];
  let token = "";
  do {
    const d = corFetch_(ruta + "?pageSize=300" + (token ? "&pageToken=" + encodeURIComponent(token) : ""), "get") || {};
    (d.documents || []).forEach(function (doc) { out.push(corDocAObjeto_(doc)); });
    token = d.nextPageToken || "";
  } while (token);
  return out;
}

// true si lo creó; false si ya existía (mismo correo procesado antes)
function corCrear_(coleccion, id, obj) {
  try {
    corFetch_(coleccion + "?documentId=" + encodeURIComponent(id), "post", corCampos_(obj));
    return true;
  } catch (err) {
    if (err && err.existe) return false;
    throw err;
  }
}

// Actualiza SOLO los campos dados (el resto del documento queda igual)
function corPatch_(ruta, obj) {
  const mascara = Object.keys(obj).map(function (k) {
    return "updateMask.fieldPaths=" + encodeURIComponent(k);
  }).join("&");
  return corFetch_(ruta + "?" + mascara, "patch", corCampos_(obj));
}

/* ------------------------------------------------------------------ */
/* Cierre diario (11 p. m.): limpieza de duplicados                    */
/* ------------------------------------------------------------------ */

// Revisa los movimientos de los últimos 10 días:
//  1) DOBLE TOQUE: anotados a mano con los mismos datos y guardados con
//     ≤ 2 minutos de diferencia → se deja uno.
//  2) A MANO + DEL BANCO: un egreso anotado a mano que repite un cargo que
//     ya entró solo (monto exacto, mismo banco, ± 2 días) → se deja el de
//     mano (con la categoría que ustedes eligieron), se le pasan los datos
//     del banco y se quita el automático.
//  3) PARECIDOS (±L 1 u otro banco): NO se borran; van en el correo del
//     cierre para que decidan en la app.
// Lo borrado se copia antes a «papelera» con el motivo (recuperable). Si no
// hubo nada, no llega ningún correo.
function cierreDiario() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  const res = { borrados: [], revisar: [], errores: [] };
  // Un fallo (p. ej. Firestore 429/5xx) en un movimiento no detiene el resto,
  // y lo que ya se quitó igual sale en el correo del cierre.
  const fallo = function (que, err) {
    res.errores.push(que + ": " + (err && err.message ? err.message : err));
  };
  let ctx = null;
  try {
    const ahora = Date.now();
    const filas = corFetch_(":runQuery", "post", { structuredQuery: {
      from: [{ collectionId: "transacciones" }],
      where: { fieldFilter: { field: { fieldPath: "fecha" }, op: "GREATER_THAN_OR_EQUAL",
        value: { timestampValue: new Date(ahora - COR_CIERRE_DIAS * 86400000).toISOString() } } },
      orderBy: [{ field: { fieldPath: "fecha" }, direction: "ASCENDING" }],
      limit: 1000
    } }) || [];
    const txs = filas.filter(function (f) { return f.document; })
      .map(function (f) { return corDocAObjeto_(f.document); });
    const borrados = {};
    const creado = function (t) { return t.creadoEn instanceof Date ? t.creadoEn.getTime() : 0; };
    const aMano = function (t) { return t.origen !== "correo" && !t.gmailId && !borrados[t.__id]; };
    const original = function (t) { return Number(t.montoOriginal != null ? t.montoOriginal : t.monto); };

    // 1) doble toque (solo lo anotado a mano: cada cargo del banco es único)
    const grupos = {};
    txs.filter(aMano).forEach(function (t) {
      const k = [t.tipo, Number(t.monto).toFixed(2), t.categoria || "", t.cuenta || "",
        String(t.descripcion || "").trim(), t.moneda || "HNL",
        Utilities.formatDate(t.fecha, COR_TZ, "yyyy-MM-dd")].join("|");
      (grupos[k] = grupos[k] || []).push(t);
    });
    Object.keys(grupos).forEach(function (k) {
      const g = grupos[k].sort(function (a, b) { return creado(a) - creado(b); });
      for (let i = 1; i < g.length; i++) {
        const seg = (creado(g[i]) - creado(g[i - 1])) / 1000;
        if (creado(g[i]) && creado(g[i - 1]) && seg <= COR_DOBLE_TOQUE_MS / 1000) {
          try {
            corAPapelera_(g[i], "Doble registro: mismos datos guardados con " + Math.round(seg) + " s de diferencia");
            borrados[g[i].__id] = true;
            res.borrados.push({ t: g[i], motivo: "doble registro" });
          } catch (err) { fallo("Doble registro " + corFilaCierre_(g[i]), err); }
        }
      }
    });

    // 2) y 3) cargos que entraron solos contra lo anotado a mano
    txs.filter(function (a) { return a.origen === "correo" && a.tipo === "egreso" && !borrados[a.__id]; })
      .forEach(function (a) {
        try {
          const cerca = function (m) {
            return aMano(m) && m.tipo === "egreso" && (m.moneda || "HNL") === (a.moneda || "HNL") &&
              Math.abs(m.fecha.getTime() - a.fecha.getTime()) <= COR_DUP_MS;
          };
          const exactos = txs.filter(function (m) {
            return cerca(m) && Math.abs(original(m) - original(a)) < 0.011 && m.cuenta === a.cuenta;
          }).sort(function (x, y) {
            return Math.abs(x.fecha.getTime() - a.fecha.getTime()) - Math.abs(y.fecha.getTime() - a.fecha.getTime());
          });
          if (exactos.length) {
            const m = exactos[0];
            // Primero se quita el automático y después se enlaza el de mano:
            // si algo falla a mitad, el gasto sigue contado una sola vez.
            corAPapelera_(a, "Repetía un egreso anotado a mano (mismo monto y banco): se dejó el anotado a mano, con los datos del banco");
            borrados[a.__id] = true;
            res.borrados.push({ t: a, motivo: "ya estaba anotado a mano" });
            // El de mano ya es ESTE cargo: no se usa contra otro cargo igual
            // (p. ej. dos cafés de L 85 el mismo día y solo uno anotado a mano).
            m.gmailId = a.gmailId || a.__id;
            corPatch_("/transacciones/" + m.__id, {
              gmailId: a.gmailId || "", vinculadoCorreo: true, fuente: a.fuente || "",
              comercio: a.comercio || "", tarjeta: a.tarjeta || ""
            });
            if (a.comercio && m.categoria && m.categoria !== "Sin categoría") {
              try {
                ctx = ctx || corContexto_();
                corAprender_(a.comercio, m.categoria, ctx);
              } catch (_) { /* aprender es opcional */ }
            }
            return;
          }
          // parecidos: solo avisar, y solo si alguno de los dos es de las últimas 26 h
          txs.filter(function (m) {
            return cerca(m) && Math.abs(original(m) - original(a)) <= COR_TOLERANCIA_L &&
              Math.max(creado(m), creado(a)) >= ahora - 26 * 3600000;
          }).forEach(function (m) { res.revisar.push({ a: a, m: m }); });
        } catch (err) { fallo(corFilaCierre_(a), err); }
      });
  } catch (err) {
    fallo("Cierre", err);                             // p. ej. no se pudo leer la lista
  } finally {
    try {
      corPatch_("/config/auto", {
        cierreUltimo: new Date(),
        cierreResumen: res.borrados.length + " duplicado(s) eliminado(s)" +
          (res.revisar.length ? ", " + res.revisar.length + " para revisar" : "") +
          (res.errores.length ? ", " + res.errores.length + " con error" : "")
      });
    } catch (err) { fallo("Estado del cierre", err); }
    try {
      if (res.borrados.length || res.revisar.length || res.errores.length) corCorreoCierre_(res);
    } catch (err) { console.error("Correo del cierre: " + err); }
    lock.releaseLock();
  }
}

// Copia el movimiento a «papelera» (con el motivo) y lo borra.
function corAPapelera_(t, motivo) {
  const copia = {};
  Object.keys(t).forEach(function (k) { if (k !== "__id") copia[k] = t[k]; });
  copia._coleccion = "transacciones";
  copia._motivo = motivo;
  copia._eliminadoEn = new Date();
  corCrear_("/papelera", t.__id, copia);
  corFetch_("/transacciones/" + t.__id, "delete");
}

// «03/11  L 85.00  Comida · CAFÉ X (BAC Credomatic)»
function corFilaCierre_(t) {
  return Utilities.formatDate(t.fecha, COR_TZ, "dd/MM") + "  " + corFmtL_(t.monto) + "  " +
    (t.categoria || "—") + (t.comercio ? " · " + t.comercio : (t.descripcion ? " · " + t.descripcion : "")) +
    " (" + (t.cuenta || "—") + ")";
}

function corCorreoCierre_(res) {
  const fila = function (t) { return "  · " + corFilaCierre_(t); };
  const L = ["CIERRE DEL DÍA — " + Utilities.formatDate(new Date(), COR_TZ, "dd/MM/yyyy"), ""];
  if (res.borrados.length) {
    L.push("Quité " + res.borrados.length + " registro(s) duplicado(s); quedaron en la papelera por si hay que recuperarlos:");
    res.borrados.forEach(function (b) { L.push(fila(b.t) + " — " + b.motivo); });
    L.push("");
  }
  if (res.revisar.length) {
    L.push("Para revisar en la app (NO los toqué; si es el mismo gasto, borren uno):");
    res.revisar.forEach(function (r) {
      L.push(fila(r.a) + " ← del banco");
      L.push(fila(r.m) + " ← anotado a mano");
    });
    L.push("");
  }
  if (res.errores.length) {
    L.push("No pude terminar con esto (se intenta otra vez en el próximo cierre):");
    res.errores.forEach(function (e) { L.push("  · " + e); });
    L.push("");
  }
  L.push("— Finanzas H&S");
  MailApp.sendEmail({
    to: COR_CORREO_ERRORES, name: COR_REMITENTE,
    subject: (res.errores.length ? "⚠️ " : "🧹 ") + "Cierre del día: " + res.borrados.length + " duplicado(s) quitado(s)" +
      (res.revisar.length ? ", " + res.revisar.length + " para revisar" : "") +
      (res.errores.length ? ", " + res.errores.length + " con error" : "") + " — Finanzas H&S",
    body: L.join("\n")
  });
}

/* ------------------------------------------------------------------ */
/* Utilidades (ejecutar desde el editor)                               */
/* ------------------------------------------------------------------ */

// 1) Lee los últimos avisos de cada banco y muestra lo que entendió. NO escribe nada.
function probarLecturaCorreos() {
  COR_FUENTES.forEach(function (f) {
    const refs = corListarMensajes_(f.q + " newer_than:60d").slice(-3);
    console.log("== " + f.nombre + ": " + refs.length + " aviso(s) recientes ==");
    refs.forEach(function (ref) {
      const msg = corLeerMensaje_(ref.id);
      let r;
      try { r = corInterpretar_(f, msg); } catch (err) { r = "ERROR: " + err.message; }
      console.log(Utilities.formatDate(msg.fecha, COR_TZ, "dd/MM HH:mm") + " → " +
        (r === null ? "(no es gasto: se ignora)" : JSON.stringify(r)));
    });
  });
}

// 2) Prueba el clasificador con 3 comercios. NO escribe nada.
function probarClasificador() {
  const llave = PropertiesService.getScriptProperties().getProperty("ANTHROPIC_API_KEY");
  if (!llave) { console.log("Falta ANTHROPIC_API_KEY en Propiedades del script."); return; }
  const ctx = corContexto_();
  ["DENNYS 3", "ESPRESSO A PLAZA MODER", "DHL DE HONDURAS WORLDP"].forEach(function (c) {
    console.log(c + " → " + corPreguntarClaude_(llave, c, { monto: 100, moneda: "HNL", detalle: "" }, ctx));
  });
}

// 3) Instala el trigger (cada 5 min) y empieza a leer desde AHORA.
function activarRegistroAutomatico() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty(COR_PROP_DESDE)) props.setProperty(COR_PROP_DESDE, String(Date.now()));
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const h = t.getHandlerFunction();
    if (h === "revisarCorreos" || h === "cierreDiario") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("revisarCorreos").timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger("cierreDiario").timeBased().everyDays(1).atHour(23).inTimezone(COR_TZ).create();
  revisarCorreos();
  console.log("Registro automático ACTIVO desde " +
    Utilities.formatDate(new Date(Number(props.getProperty(COR_PROP_DESDE))), COR_TZ, "dd/MM/yyyy HH:mm"));
}

// 4) Recupera avisos desde una fecha (máximo los últimos 10 días).
function importarDesde(fechaISO) {
  const d = new Date((fechaISO || "") + "T00:00:00-06:00");
  if (isNaN(d.getTime())) throw new Error('Usa el formato "2026-11-01"');
  PropertiesService.getScriptProperties().setProperty(COR_PROP_DESDE, String(d.getTime()));
  revisarCorreos();
}

// 6) Con la llave puesta: clasifica las compras automáticas «Sin categoría».
function clasificarSinCategoria() {
  const llave = PropertiesService.getScriptProperties().getProperty("ANTHROPIC_API_KEY");
  if (!llave) { console.log("Falta ANTHROPIC_API_KEY en Propiedades del script."); return; }
  const ctx = corContexto_();
  const filas = corFetch_(":runQuery", "post", { structuredQuery: {
    from: [{ collectionId: "transacciones" }],
    where: { fieldFilter: { field: { fieldPath: "origen" }, op: "EQUAL", value: { stringValue: "correo" } } },
    limit: 500
  } }) || [];
  let n = 0;
  filas.forEach(function (fila) {
    if (!fila.document) return;
    const d = corDocAObjeto_(fila.document);
    if (d.categoria && d.categoria !== "Sin categoría") return;
    const cat = corCategoria_(d.comercio || d.descripcion, { monto: d.montoOriginal, moneda: d.moneda, detalle: d.detalle }, ctx);
    if (cat.categoria !== "Sin categoría") {
      corPatch_("/transacciones/" + d.__id, { categoria: cat.categoria, categoriaVia: cat.via });
      n++;
      console.log((d.comercio || d.descripcion) + " → " + cat.categoria);
    }
  });
  console.log(n + " compra(s) clasificada(s).");
}

// 4b) Igual, desde el día 1 del mes en curso (el botón Ejecutar no pasa argumentos).
function recuperarDesdeInicioDeMes() {
  importarDesde(Utilities.formatDate(new Date(), COR_TZ, "yyyy-MM") + "-01");
}

// 5) Quita los triggers (deja de registrar y de limpiar; lo ya registrado no cambia).
function desactivarRegistroAutomatico() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const h = t.getHandlerFunction();
    if (h === "revisarCorreos" || h === "cierreDiario") ScriptApp.deleteTrigger(t);
  });
  console.log("Registro automático desactivado.");
}
