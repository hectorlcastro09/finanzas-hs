/* =====================================================================
   Reporte.gs — Reporte mensual en Google Sheet (Finanzas H&S)

   El día 6 de cada mes (trigger DIARIO 7-8am, hora de Honduras) genera
   un Google Sheet con el detalle del mes que acaba de cerrar, lo deja
   en la carpeta de Drive compartida con Sonia y envía a ambos correos
   el resumen (ingresos, egresos, balance), el desglose por categoría y
   el detalle completo de los movimientos, con el enlace al Sheet.

   ¿Por qué el día 6 y no el 1? Sonia calcula y anota sus ingresos del
   mes durante los primeros cinco días del mes siguiente; con el corte
   el día 1 el reporte salía incompleto.

   - Lee Firestore por REST con el token OAuth del dueño (IAM, las
     security rules no aplican a este camino).
   - Idempotente: la Script Property "ultimoReporte" evita duplicados y
     hace que un fallo el día 6 se reintente solo el día 7, 8, ...
   - No toca el doPost ni el deployment del Web App (el trigger corre
     la versión Head del código guardado).

   Utilidades (ejecutar desde el editor):
     1) pruebaConexionFirestore()  -> solo consulta y loguea (sin correo)
     2) pruebaCorreoSoloHector()   -> correo SOLO a Héctor con asunto
                                      [PRUEBA]; no marca el mes ni
                                      modifica un Sheet ya existente
     3) pruebaReporteManual()      -> flujo completo REAL a ambos, hoy
                                      mismo (no espera al día 6)
     4) reiniciarMarcaReporte()    -> borra la marca: el mes pasado se
                                      vuelve a generar y enviar en la
                                      próxima corrida del trigger (día ≥ 6)
   ===================================================================== */

const RPT_PROYECTO = "flujo-matrimonial";
const RPT_TZ = "America/Tegucigalpa";            // UTC-6 fijo, sin DST
const RPT_DIA_ENVIO = 6;                         // día del mes en que sale el reporte
const RPT_CORREO_HECTOR = "hectorlcastro09@gmail.com";
const RPT_CORREO_SONIA = "soniag.chinchilla@gmail.com";
const RPT_DESTINOS = RPT_CORREO_HECTOR + ", " + RPT_CORREO_SONIA;
const RPT_CORREO_ERRORES = RPT_CORREO_HECTOR;
const RPT_REMITENTE = "Finanzas H&S";            // nombre que muestra Gmail como remitente
const RPT_NOMBRE_CARPETA = "Finanzas H&S — Reportes";
const RPT_PROP_ULTIMO = "ultimoReporte";         // "yyyy-MM" del último mes reportado
const RPT_PROP_CARPETA_ID = "carpetaReportesId"; // cache del id de la carpeta
const RPT_MAX_FILAS_CORREO = 400;                // más movimientos que esto: detalle solo en el Sheet
const RPT_FORMATO_L = '"L" #,##0.00';
const RPT_MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const RPT_BASE = "https://firestore.googleapis.com/v1/projects/" +
  RPT_PROYECTO + "/databases/(default)/documents";

/* ------------------------------------------------------------------ */
/* Función principal (la apunta el trigger diario de tiempo)          */
/* ------------------------------------------------------------------ */

function reporteMensual() {
  const ahora = new Date();

  // Días 1-5: todavía se están anotando los ingresos del mes anterior.
  // El trigger diario sigue corriendo, pero no hace nada hasta el día 6.
  const dia = Number(Utilities.formatDate(ahora, RPT_TZ, "d"));
  if (dia < RPT_DIA_ENVIO) return;

  // Mes cerrado = mes anterior al actual EN HORA LOCAL de Honduras
  const mes = rptMesAnterior_(Utilities.formatDate(ahora, RPT_TZ, "yyyy-MM"));

  // Si ya se envió, no hace nada (así el trigger diario solo actúa el
  // día 6, y si ese día falló, se auto-repara los días siguientes).
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(RPT_PROP_ULTIMO) === mes.clave) return;

  rptGenerarYEnviar_(mes);
}

// Flujo completo de un mes: consulta + Sheet + correo a ambos + marca.
function rptGenerarYEnviar_(mes) {
  const props = PropertiesService.getScriptProperties();
  try {
    const txs = rptConsultarMes_(mes);
    const resumen = rptResumen_(txs);
    const url = rptConstruirSheet_(mes, txs, resumen);
    rptEnviarCorreo_(mes, resumen, url, txs, null);
    props.setProperty(RPT_PROP_ULTIMO, mes.clave); // marcar SOLO tras el envío
  } catch (err) {
    try {
      MailApp.sendEmail(RPT_CORREO_ERRORES,
        "⚠️ Falló el reporte mensual de " + mes.label + " — Finanzas H&S",
        "El reporte falló y se reintentará mañana con el trigger diario.\n\n" +
        "Error:\n" + (err && err.stack ? err.stack : String(err)));
    } catch (_) { /* si ni el correo sale, queda el log de ejecuciones */ }
    throw err; // que la ejecución quede como fallida en el panel
  }
}

/* ------------------------------------------------------------------ */
/* Fechas y formato                                                    */
/* ------------------------------------------------------------------ */

// "2026-08" -> datos del mes ANTERIOR con límites [ini, fin) en UTC.
// 00:00 hora de Honduras = 06:00Z del mismo día (UTC-6 fijo).
function rptMesAnterior_(mesActualClave) {
  const partes = mesActualClave.split("-");
  let anio = Number(partes[0]);
  let mes = Number(partes[1]) - 1;              // mes anterior
  if (mes === 0) { mes = 12; anio -= 1; }       // enero -> diciembre del año previo
  const sigAnio = mes === 12 ? anio + 1 : anio;
  const sigMes = mes === 12 ? 1 : mes + 1;
  return {
    clave: anio + "-" + (mes < 10 ? "0" + mes : String(mes)),  // "2026-07"
    label: RPT_MESES[mes - 1] + " " + anio,                    // "Julio 2026"
    iniUTC: new Date(Date.UTC(anio, mes - 1, 1, 6, 0, 0)),
    finUTC: new Date(Date.UTC(sigAnio, sigMes - 1, 1, 6, 0, 0))
  };
}

// 130793.13 -> "L 130,793.13"; -26796.37 -> "-L 26,796.37".
// Formato propio: toLocaleString en Apps Script no siempre pone los
// separadores de miles.
function rptFmtL_(n) {
  const num = Number(n) || 0;
  const partes = Math.abs(num).toFixed(2).split(".");
  partes[0] = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (num < 0 ? "-L " : "L ") + partes[0] + "." + partes[1];
}

function rptEsc_(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ------------------------------------------------------------------ */
/* Firestore REST                                                      */
/* ------------------------------------------------------------------ */

function rptFetchFS_(ruta, opciones) {
  const params = {
    method: (opciones && opciones.method) || "get",
    headers: {
      Authorization: "Bearer " + ScriptApp.getOAuthToken(),
      // Proyecto de cuota: evita el 403 SERVICE_DISABLED del proyecto GCP
      // oculto de Apps Script; el dueño (Owner de flujo-matrimonial) tiene
      // el permiso serviceusage.services.use que este header exige.
      "x-goog-user-project": RPT_PROYECTO
    },
    muteHttpExceptions: true
  };
  if (opciones && opciones.payload) {
    params.contentType = "application/json";
    params.payload = JSON.stringify(opciones.payload);
  }
  const res = UrlFetchApp.fetch(RPT_BASE + ruta, params);
  const codigo = res.getResponseCode();
  const texto = res.getContentText();
  if (codigo < 200 || codigo >= 300) {
    // El body de Google explica la causa (p.ej. SERVICE_DISABLED con el
    // proyecto que hay que cambiar): se incluye truncado en el error.
    throw new Error("Firestore REST " + codigo + " en " + ruta + ": " +
      texto.slice(0, 600));
  }
  return JSON.parse(texto);
}

function rptConsultarMes_(mes) {
  const consulta = {
    structuredQuery: {
      from: [{ collectionId: "transacciones" }],
      where: {
        compositeFilter: {
          op: "AND",
          filters: [
            { fieldFilter: { field: { fieldPath: "fecha" },
                op: "GREATER_THAN_OR_EQUAL",
                value: { timestampValue: mes.iniUTC.toISOString() } } },
            { fieldFilter: { field: { fieldPath: "fecha" },
                op: "LESS_THAN",
                value: { timestampValue: mes.finUTC.toISOString() } } }
          ]
        }
      },
      // Rango sobre un solo campo + orderBy por ese campo: basta el
      // índice single-field automático (sin índice compuesto).
      orderBy: [{ field: { fieldPath: "fecha" }, direction: "ASCENDING" }],
      limit: 2000
    }
  };
  // runQuery devuelve UN array JSON completo (sin paginación); algunos
  // elementos traen solo readTime y no "document": se saltan.
  const filas = rptFetchFS_("/hogar/principal:runQuery",
    { method: "post", payload: consulta });
  const cuentasLegacy = rptMapaCuentasLegacy_();
  const txs = [];
  (filas || []).forEach(function (fila) {
    if (!fila || !fila.document) return;
    const t = rptParsearTx_(fila.document, cuentasLegacy);
    // Red de seguridad: mes local EXACTO, además del rango de la query
    if (t && Utilities.formatDate(t.fecha, RPT_TZ, "yyyy-MM") === mes.clave) {
      txs.push(t);
    }
  });
  return txs;
}

// Valor tipado de Firestore -> valor JS plano.
// Ojo: integerValue llega como STRING; monto puede venir como
// integerValue o doubleValue según cómo lo guardó el SDK.
function rptValor_(v) {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("integerValue" in v) return Number(v.integerValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return new Date(v.timestampValue);
  if ("nullValue" in v) return null;
  if ("mapValue" in v) {
    const obj = {};
    const fields = v.mapValue.fields || {};
    Object.keys(fields).forEach(function (k) { obj[k] = rptValor_(fields[k]); });
    return obj;
  }
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(rptValor_);
  return null;
}

function rptParsearTx_(doc, cuentasLegacy) {
  const f = doc.fields || {};
  const g = function (nombre) { return rptValor_(f[nombre]); };

  const fecha = g("fecha");
  if (!(fecha instanceof Date) || isNaN(fecha.getTime())) return null; // sin fecha: se descarta

  const monto = Number(g("monto"));
  const montoOk = isNaN(monto) ? 0 : monto;
  const montoOriginal = g("montoOriginal");
  const cuentaCruda = g("cuenta") || "";

  return {
    id: String(doc.name || "").split("/").pop(),
    tipo: g("tipo") === "ingreso" ? "ingreso" : "egreso",
    monto: montoOk,                                            // siempre en HNL
    montoOriginal: montoOriginal != null ? Number(montoOriginal) : montoOk,
    moneda: g("moneda") || "HNL",
    tasaCambio: g("tasaCambio"),                               // null si HNL
    categoria: g("categoria") || "Sin categoría",              // puede venir null
    descripcion: g("descripcion") || "",                       // opcional
    metodoPago: g("metodoPago") || "",                         // opcional
    banco: cuentasLegacy[cuentaCruda] || cuentaCruda || "—",
    persona: g("persona") || "",
    fecha: fecha
  };
}

// Transacciones viejas guardan en "cuenta" el ID de un doc de la
// colección "cuentas"; hoy se guarda el nombre del banco. Mapa
// id -> nombre (mismo criterio que bancoLabel() en la PWA).
// Si esta lectura falla, el reporte sigue con el valor crudo.
function rptMapaCuentasLegacy_() {
  try {
    const res = rptFetchFS_("/hogar/principal/cuentas?pageSize=300");
    const docs = res.documents || [];
    const repetidos = {};
    docs.forEach(function (d) {
      const n = rptValor_((d.fields || {}).nombre) || "";
      repetidos[n] = (repetidos[n] || 0) + 1;
    });
    const mapa = {};
    docs.forEach(function (d) {
      const id = String(d.name || "").split("/").pop();
      const nombre = rptValor_((d.fields || {}).nombre) || id;
      const prop = rptValor_((d.fields || {}).propietario) || "";
      let etiqueta = nombre;
      if (repetidos[nombre] > 1) {
        if (prop === "hector") etiqueta += " · H";
        else if (prop === "sonia") etiqueta += " · S";
      }
      mapa[id] = etiqueta;
    });
    return mapa;
  } catch (err) {
    console.warn("cuentas legacy no disponibles: " + err);
    return {};
  }
}

/* ------------------------------------------------------------------ */
/* Resumen                                                             */
/* ------------------------------------------------------------------ */

function rptResumen_(txs) {
  const r = { ingresos: 0, egresos: 0, nIngresos: 0, nEgresos: 0 };
  const egrCat = {};
  const ingCat = {};
  txs.forEach(function (t) {
    if (t.tipo === "ingreso") {
      r.ingresos += t.monto;
      r.nIngresos++;
      ingCat[t.categoria] = (ingCat[t.categoria] || 0) + t.monto;
    } else {
      r.egresos += t.monto;
      r.nEgresos++;
      egrCat[t.categoria] = (egrCat[t.categoria] || 0) + t.monto;
    }
  });
  r.balance = r.ingresos - r.egresos;
  const aListaOrdenada = function (obj) {
    return Object.keys(obj)
      .map(function (k) { return { categoria: k, monto: obj[k] }; })
      .sort(function (a, b) { return b.monto - a.monto; });
  };
  r.egresosPorCategoria = aListaOrdenada(egrCat);
  r.ingresosPorCategoria = aListaOrdenada(ingCat);
  return r;
}

/* ------------------------------------------------------------------ */
/* Google Sheet                                                        */
/* ------------------------------------------------------------------ */

// Carpeta de reportes: por ID cacheado -> por nombre -> crearla.
// Se comparte con Sonia UNA sola vez (al crearla); los Sheets de
// adentro heredan el acceso de lectura.
function rptCarpetaReportes_() {
  const props = PropertiesService.getScriptProperties();
  const idGuardado = props.getProperty(RPT_PROP_CARPETA_ID);
  if (idGuardado) {
    try {
      const c = DriveApp.getFolderById(idGuardado);
      if (!c.isTrashed()) return c;
    } catch (_) { /* id inválido o borrado: seguir */ }
  }
  const it = DriveApp.getFoldersByName(RPT_NOMBRE_CARPETA);
  while (it.hasNext()) {
    const c = it.next();
    if (!c.isTrashed()) {
      props.setProperty(RPT_PROP_CARPETA_ID, c.getId());
      return c;
    }
  }
  const nueva = DriveApp.createFolder(RPT_NOMBRE_CARPETA);
  props.setProperty(RPT_PROP_CARPETA_ID, nueva.getId());
  try {
    nueva.addViewer(RPT_CORREO_SONIA); // Drive puede mandarle 1 notificación (única vez)
  } catch (err) {
    console.warn("No se pudo compartir la carpeta con Sonia: " + err);
  }
  return nueva;
}

// URL del Sheet del mes si ya existe en la carpeta (sin tocarlo);
// null si no hay. Lo usa la prueba de correo para no regenerar nada.
function rptUrlSheetExistente_(mes) {
  const it = rptCarpetaReportes_().getFilesByName("Finanzas H&S — " + mes.label);
  while (it.hasNext()) {
    const f = it.next();
    if (!f.isTrashed()) return f.getUrl();
  }
  return null;
}

function rptConstruirSheet_(mes, txs, resumen) {
  const nombre = "Finanzas H&S — " + mes.label;
  const carpeta = rptCarpetaReportes_();

  // Idempotencia: si un intento anterior dejó el archivo, se reutiliza
  // (limpiándolo) en vez de duplicarlo. Así también se refresca el
  // Sheet cuando el mes se vuelve a generar.
  let ss = null;
  const existentes = carpeta.getFilesByName(nombre);
  while (existentes.hasNext()) {
    const f = existentes.next();
    if (!f.isTrashed()) { ss = SpreadsheetApp.openById(f.getId()); break; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create(nombre);                 // nace en Mi unidad
    DriveApp.getFileById(ss.getId()).moveTo(carpeta);   // hereda el acceso de la carpeta
  }
  ss.setSpreadsheetTimeZone(RPT_TZ);

  const hojaResumen = ss.getSheetByName("Resumen") || ss.insertSheet("Resumen");
  const hojaDetalle = ss.getSheetByName("Detalle") || ss.insertSheet("Detalle");
  ss.getSheets().forEach(function (h) {                 // fuera la "Hoja 1" por defecto
    const n = h.getName();
    if (n !== "Resumen" && n !== "Detalle") ss.deleteSheet(h);
  });
  hojaResumen.clear();
  hojaDetalle.clear();

  rptLlenarDetalle_(hojaDetalle, txs);
  rptLlenarResumen_(hojaResumen, mes, resumen);

  ss.setActiveSheet(hojaResumen);                       // Resumen como primera pestaña
  ss.moveActiveSheet(1);
  SpreadsheetApp.flush();
  return ss.getUrl();
}

function rptLlenarDetalle_(hoja, txs) {
  const encabezado = ["Fecha", "Tipo", "Categoría", "Descripción", "Banco",
    "Método", "Monto (L)", "Divisa original", "Persona"];
  hoja.getRange(1, 1, 1, encabezado.length)
    .setValues([encabezado])
    .setFontWeight("bold");

  if (txs.length > 0) {
    const filas = txs.map(function (t) {
      const divisa = t.moneda === "USD"
        ? "USD " + Number(t.montoOriginal).toFixed(2) +
          (t.tasaCambio ? " @ " + t.tasaCambio : "")
        : "";
      return [
        Utilities.formatDate(t.fecha, RPT_TZ, "dd/MM/yyyy"),
        t.tipo === "ingreso" ? "Ingreso" : "Egreso",
        t.categoria,
        t.descripcion,
        t.banco,
        t.metodoPago,
        t.monto,
        divisa,
        t.persona
      ];
    });
    hoja.getRange(2, 1, filas.length, encabezado.length).setValues(filas);
    hoja.getRange(2, 7, filas.length, 1).setNumberFormat(RPT_FORMATO_L);
  } else {
    hoja.getRange(2, 1).setValue("(Sin movimientos este mes)");
  }
  hoja.setFrozenRows(1);
  hoja.autoResizeColumns(1, encabezado.length);
}

function rptLlenarResumen_(hoja, mes, resumen) {
  const filas = [];
  filas.push(["Finanzas H&S — Resumen de " + mes.label, ""]);
  filas.push(["", ""]);
  filas.push(["Ingresos", resumen.ingresos]);          // fila 3
  filas.push(["Egresos", resumen.egresos]);            // fila 4
  filas.push(["Balance", resumen.balance]);            // fila 5
  filas.push(["Movimientos", (resumen.nIngresos + resumen.nEgresos) +
    " (" + resumen.nIngresos + " ingresos, " + resumen.nEgresos + " egresos)"]);
  filas.push(["", ""]);
  filas.push(["EGRESOS POR CATEGORÍA", ""]);           // fila 8
  resumen.egresosPorCategoria.forEach(function (c) { filas.push([c.categoria, c.monto]); });
  filas.push(["", ""]);
  filas.push(["INGRESOS POR CATEGORÍA", ""]);          // fila 10 + nE
  resumen.ingresosPorCategoria.forEach(function (c) { filas.push([c.categoria, c.monto]); });

  hoja.getRange(1, 1, filas.length, 2).setValues(filas);

  const nE = resumen.egresosPorCategoria.length;
  const nI = resumen.ingresosPorCategoria.length;
  hoja.getRange(1, 1).setFontWeight("bold").setFontSize(12);
  hoja.getRange(3, 1, 4, 1).setFontWeight("bold");
  hoja.getRange(3, 2, 3, 1).setNumberFormat(RPT_FORMATO_L);
  hoja.getRange(8, 1).setFontWeight("bold");
  if (nE > 0) hoja.getRange(9, 2, nE, 1).setNumberFormat(RPT_FORMATO_L);
  hoja.getRange(10 + nE, 1).setFontWeight("bold");
  if (nI > 0) hoja.getRange(11 + nE, 2, nI, 1).setNumberFormat(RPT_FORMATO_L);
  hoja.setFrozenRows(1);
  hoja.autoResizeColumns(1, 2);
}

/* ------------------------------------------------------------------ */
/* Correo: resumen + desglose por categoría + detalle completo         */
/* ------------------------------------------------------------------ */

// opciones (solo para pruebas): { destinos, prefijoAsunto }
function rptEnviarCorreo_(mes, resumen, url, txs, opciones) {
  const destinos = (opciones && opciones.destinos) || RPT_DESTINOS;
  const prefijo = (opciones && opciones.prefijoAsunto) || "";
  MailApp.sendEmail({
    to: destinos,
    name: RPT_REMITENTE,
    subject: prefijo + "📊 Reporte de " + mes.label + " — Finanzas H&S",
    body: rptCorreoTexto_(mes, resumen, url, txs),      // respaldo texto plano
    htmlBody: rptCorreoHtml_(mes, resumen, url, txs)
  });
}

function rptCorreoTexto_(mes, resumen, url, txs) {
  const L = [];
  L.push("REPORTE MENSUAL — " + mes.label);
  L.push("Datos al " + Utilities.formatDate(new Date(), RPT_TZ, "dd/MM/yyyy HH:mm"));
  L.push("");
  L.push("Ingresos:  " + rptFmtL_(resumen.ingresos) + " (" + resumen.nIngresos + " movimientos)");
  L.push("Egresos:   " + rptFmtL_(resumen.egresos) + " (" + resumen.nEgresos + " movimientos)");
  L.push("Balance:   " + rptFmtL_(resumen.balance));
  L.push("");
  L.push("EGRESOS POR CATEGORÍA");
  if (resumen.egresosPorCategoria.length === 0) L.push("  (sin egresos)");
  resumen.egresosPorCategoria.forEach(function (c) {
    L.push("  · " + c.categoria + ": " + rptFmtL_(c.monto));
  });
  L.push("");
  L.push("INGRESOS POR CATEGORÍA");
  if (resumen.ingresosPorCategoria.length === 0) L.push("  (sin ingresos)");
  resumen.ingresosPorCategoria.forEach(function (c) {
    L.push("  · " + c.categoria + ": " + rptFmtL_(c.monto));
  });
  L.push("");
  L.push("DETALLE DE MOVIMIENTOS (" + txs.length + ")");
  if (txs.length === 0) {
    L.push("  (sin movimientos este mes)");
  } else if (txs.length > RPT_MAX_FILAS_CORREO) {
    L.push("  Demasiados movimientos para el correo: ver la pestaña Detalle del Sheet.");
  } else {
    txs.forEach(function (t) {
      L.push("  " + Utilities.formatDate(t.fecha, RPT_TZ, "dd/MM") +
        "  " + (t.tipo === "ingreso" ? "INGRESO " : "Egreso  ") +
        rptFmtL_(t.monto) + "  " + t.categoria +
        (t.descripcion ? " — " + t.descripcion : "") +
        (t.banco ? " (" + t.banco + ")" : ""));
    });
  }
  L.push("");
  L.push("Google Sheet del mes (pestañas Resumen y Detalle):");
  L.push(url);
  L.push("", "— Finanzas H&S");
  return L.join("\n");
}

function rptCorreoHtml_(mes, resumen, url, txs) {
  const VERDE = "#1b7f3b";
  const ROJO = "#c0392b";
  const GRIS = "#777777";
  const colorBalance = resumen.balance >= 0 ? VERDE : ROJO;
  const generado = Utilities.formatDate(new Date(), RPT_TZ, "dd/MM/yyyy HH:mm");

  const celda = function (html, estilo) {
    return "<td style='padding:5px 8px;border-bottom:1px solid #e6e6e6;" +
      "vertical-align:top;" + (estilo || "") + "'>" + html + "</td>";
  };
  const cab = function (texto, estilo) {
    return "<th style='padding:6px 8px;border-bottom:2px solid #999;" +
      "text-align:left;font-size:12px;color:#555;white-space:nowrap;" +
      (estilo || "") + "'>" + texto + "</th>";
  };
  const num = "text-align:right;white-space:nowrap;";
  const tabla = function (contenido, estilo) {
    return "<table cellspacing='0' cellpadding='0' style='border-collapse:collapse;" +
      "font-size:13px;" + (estilo || "") + "'>" + contenido + "</table>";
  };
  const titulo = function (texto) {
    return "<h3 style='margin:22px 0 6px;font-size:15px;color:#333'>" + texto + "</h3>";
  };

  // --- Cabecera y totales -------------------------------------------
  let h = "<div style='font-family:Arial,Helvetica,sans-serif;font-size:14px;" +
    "color:#222;max-width:720px'>";
  h += "<h2 style='margin:0;font-size:20px'>📊 Reporte mensual — " +
    rptEsc_(mes.label) + "</h2>";
  h += "<div style='color:" + GRIS + ";margin:2px 0 14px'>Finanzas H&amp;S · datos al " +
    generado + "</div>";

  const filaTotal = function (etiqueta, monto, color, nota, tam) {
    return "<tr>" +
      celda("<b>" + etiqueta + "</b>", "padding:8px 12px 8px 0;border-bottom:0") +
      celda("<b style='color:" + color + ";font-size:" + tam + "px'>" + rptFmtL_(monto) + "</b>",
        num + "padding:8px 12px 8px 0;border-bottom:0") +
      celda("<span style='color:" + GRIS + "'>" + nota + "</span>", "border-bottom:0") +
      "</tr>";
  };
  h += tabla(
    filaTotal("Ingresos", resumen.ingresos, VERDE, resumen.nIngresos + " movimientos", 16) +
    filaTotal("Egresos", resumen.egresos, ROJO, resumen.nEgresos + " movimientos", 16) +
    filaTotal("Balance", resumen.balance, colorBalance,
      resumen.balance >= 0 ? "ahorro del mes" : "el mes cerró en negativo", 18),
    "font-size:14px");

  // --- Desglose por categoría ----------------------------------------
  const tablaCategorias = function (lista, total, vacio) {
    if (lista.length === 0) {
      return "<div style='color:" + GRIS + "'>" + vacio + "</div>";
    }
    let filas = "<tr>" + cab("Categoría") + cab("Monto", num) + cab("%", num) + "</tr>";
    lista.forEach(function (c) {
      const pct = total > 0 ? Math.round((c.monto / total) * 100) : 0;
      filas += "<tr>" + celda(rptEsc_(c.categoria)) +
        celda(rptFmtL_(c.monto), num) +
        celda("<span style='color:" + GRIS + "'>" + pct + "%</span>", num) + "</tr>";
    });
    filas += "<tr>" + celda("<b>Total</b>", "border-bottom:0") +
      celda("<b>" + rptFmtL_(total) + "</b>", num + "border-bottom:0") +
      celda("", "border-bottom:0") + "</tr>";
    return tabla(filas, "min-width:320px");
  };
  h += titulo("Egresos por categoría");
  h += tablaCategorias(resumen.egresosPorCategoria, resumen.egresos, "(sin egresos)");
  h += titulo("Ingresos por categoría");
  h += tablaCategorias(resumen.ingresosPorCategoria, resumen.ingresos, "(sin ingresos)");

  // --- Detalle completo de movimientos -------------------------------
  h += titulo("Detalle de movimientos (" + txs.length + ")");
  if (txs.length === 0) {
    h += "<div style='color:" + GRIS + "'>(sin movimientos este mes)</div>";
  } else if (txs.length > RPT_MAX_FILAS_CORREO) {
    h += "<div style='color:" + GRIS + "'>Demasiados movimientos para el correo: " +
      "el detalle completo está en la pestaña <b>Detalle</b> del Sheet.</div>";
  } else {
    let filas = "<tr>" + cab("Fecha") + cab("Tipo") + cab("Categoría") +
      cab("Descripción") + cab("Banco") + cab("Monto", num) + "</tr>";
    txs.forEach(function (t, i) {
      const esIng = t.tipo === "ingreso";
      const fondo = i % 2 === 1 ? "background:#f7f7f7;" : "";
      const divisa = t.moneda === "USD"
        ? "<br><span style='color:" + GRIS + ";font-size:11px;font-weight:normal'>USD " +
          Number(t.montoOriginal).toFixed(2) +
          (t.tasaCambio ? " @ " + rptEsc_(t.tasaCambio) : "") + "</span>"
        : "";
      filas += "<tr style='" + fondo + "'>" +
        celda(Utilities.formatDate(t.fecha, RPT_TZ, "dd/MM"), "white-space:nowrap") +
        celda(esIng ? "<span style='color:" + VERDE + "'>Ingreso</span>" : "Egreso") +
        celda(rptEsc_(t.categoria)) +
        celda(rptEsc_(t.descripcion) || "<span style='color:#bbb'>—</span>") +
        celda(rptEsc_(t.banco), "white-space:nowrap") +
        celda("<b style='color:" + (esIng ? VERDE : "#222") + "'>" +
          (esIng ? "+" : "") + rptFmtL_(t.monto) + "</b>" + divisa, num) +
        "</tr>";
    });
    h += tabla(filas, "width:100%;font-size:12px");
  }

  // --- Enlace y pie ----------------------------------------------------
  h += "<p style='margin-top:22px'><a href='" + rptEsc_(url) + "' style='color:#1a5fb4'>" +
    "Abrir el Google Sheet de " + rptEsc_(mes.label) + "</a> — pestañas <b>Resumen</b> y " +
    "<b>Detalle</b>, en la carpeta de Drive «" + rptEsc_(RPT_NOMBRE_CARPETA) + "».</p>";
  h += "<p style='color:#999;font-size:12px'>— Finanzas H&amp;S · reporte automático " +
    "del día " + RPT_DIA_ENVIO + " de cada mes</p>";
  h += "</div>";
  return h;
}

/* ------------------------------------------------------------------ */
/* Utilidades (ejecutar desde el editor)                               */
/* ------------------------------------------------------------------ */

// 1) Smoke test: consulta el mes pasado y escribe en el log.
//    NO crea Sheet ni envía correos. Úsala para el flujo de OAuth y
//    para detectar el 403 de proyecto GCP si llegara a aparecer.
function pruebaConexionFirestore() {
  const mes = rptMesAnterior_(Utilities.formatDate(new Date(), RPT_TZ, "yyyy-MM"));
  const txs = rptConsultarMes_(mes);
  console.log("Mes " + mes.clave + " (" + mes.label + "): " +
    txs.length + " transacciones");
  if (txs.length > 0) console.log("Primera: " + JSON.stringify(txs[0]));
}

// 2) Prueba del correo SOLO a Héctor (asunto con [PRUEBA]) con los
//    datos de hoy del mes pasado. Si el Sheet del mes ya existe lo
//    enlaza tal cual (no lo modifica); si no existe, lo crea. NO marca
//    el mes como enviado.
function pruebaCorreoSoloHector() {
  const mes = rptMesAnterior_(Utilities.formatDate(new Date(), RPT_TZ, "yyyy-MM"));
  const txs = rptConsultarMes_(mes);
  const resumen = rptResumen_(txs);
  const url = rptUrlSheetExistente_(mes) || rptConstruirSheet_(mes, txs, resumen);
  rptEnviarCorreo_(mes, resumen, url, txs,
    { destinos: RPT_CORREO_HECTOR, prefijoAsunto: "[PRUEBA] " });
  console.log("Prueba enviada a " + RPT_CORREO_HECTOR + ": " + mes.label +
    ", " + txs.length + " movimientos, balance " + rptFmtL_(resumen.balance));
}

// 3) Envío REAL a ambos, hoy mismo, sin esperar al día 6: borra la
//    marca y ejecuta el flujo completo del mes pasado (si el Sheet ya
//    existe se reutiliza y se refresca, no se duplica).
function pruebaReporteManual() {
  PropertiesService.getScriptProperties().deleteProperty(RPT_PROP_ULTIMO);
  const mes = rptMesAnterior_(Utilities.formatDate(new Date(), RPT_TZ, "yyyy-MM"));
  rptGenerarYEnviar_(mes);
}

// 4) Solo borra la marca, sin enviar nada ahora: el trigger diario
//    volverá a generar y enviar el mes pasado en su próxima corrida
//    a partir del día 6.
function reiniciarMarcaReporte() {
  PropertiesService.getScriptProperties().deleteProperty(RPT_PROP_ULTIMO);
  console.log("Marca borrada: el mes pasado se volverá a generar y enviar " +
    "en la próxima corrida del trigger (día " + RPT_DIA_ENVIO + " o después).");
}
