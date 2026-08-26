/* =====================================================================
   Reporte.gs — Reporte mensual en Google Sheet (Finanzas H&S)

   El día 1 de cada mes (trigger DIARIO 7-8am, hora de Honduras) genera
   un Google Sheet con el detalle del mes que acaba de cerrar, lo deja
   en la carpeta de Drive compartida con Sonia y envía el resumen con el
   enlace a ambos correos.

   - Lee Firestore por REST con el token OAuth del dueño (IAM, las
     security rules no aplican a este camino).
   - Idempotente: la Script Property "ultimoReporte" evita duplicados y
     hace que un fallo el día 1 se reintente solo el día 2, 3, ...
   - No toca el doPost ni el deployment del Web App (el trigger corre
     la versión Head del código guardado).

   Pruebas manuales:
     1) pruebaConexionFirestore()  -> solo consulta y loguea (sin correo)
     2) pruebaReporteManual()      -> flujo completo REAL (Sheet + correo)
   ===================================================================== */

const RPT_PROYECTO = "flujo-matrimonial";
const RPT_TZ = "America/Tegucigalpa";            // UTC-6 fijo, sin DST
const RPT_DESTINOS = "hectorlcastro09@gmail.com, soniag.chinchilla@gmail.com";
const RPT_CORREO_SONIA = "soniag.chinchilla@gmail.com";
const RPT_CORREO_ERRORES = "hectorlcastro09@gmail.com";
const RPT_NOMBRE_CARPETA = "Finanzas H&S — Reportes";
const RPT_PROP_ULTIMO = "ultimoReporte";         // "yyyy-MM" del último mes reportado
const RPT_PROP_CARPETA_ID = "carpetaReportesId"; // cache del id de la carpeta
const RPT_FORMATO_L = '"L" #,##0.00';
const RPT_MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const RPT_BASE = "https://firestore.googleapis.com/v1/projects/" +
  RPT_PROYECTO + "/databases/(default)/documents";

/* ------------------------------------------------------------------ */
/* Función principal (la apunta el trigger diario de tiempo)          */
/* ------------------------------------------------------------------ */

function reporteMensual() {
  // Mes cerrado = mes anterior al actual EN HORA LOCAL de Honduras
  const mesActual = Utilities.formatDate(new Date(), RPT_TZ, "yyyy-MM");
  const mes = rptMesAnterior_(mesActual);

  // Si ya se envió, no hace nada (así el trigger diario solo actúa el
  // día 1, y si ese día falló, se auto-repara los días siguientes).
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(RPT_PROP_ULTIMO) === mes.clave) return;

  try {
    const txs = rptConsultarMes_(mes);
    const resumen = rptResumen_(txs);
    const url = rptConstruirSheet_(mes, txs, resumen);
    rptEnviarCorreo_(mes, resumen, url, txs.length);
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
/* Fechas                                                              */
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

function rptConstruirSheet_(mes, txs, resumen) {
  const nombre = "Finanzas H&S — " + mes.label;
  const carpeta = rptCarpetaReportes_();

  // Idempotencia: si un intento anterior dejó el archivo, se reutiliza
  // (limpiándolo) en vez de duplicarlo.
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
/* Correo                                                              */
/* ------------------------------------------------------------------ */

function rptEnviarCorreo_(mes, resumen, url, nMovs) {
  const fmtL = function (n) {
    return "L " + Number(n).toLocaleString("es-HN", {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
  };
  const lineas = [
    "REPORTE MENSUAL — " + mes.label,
    "",
    "Ingresos:  " + fmtL(resumen.ingresos) + " (" + resumen.nIngresos + " movimientos)",
    "Egresos:   " + fmtL(resumen.egresos) + " (" + resumen.nEgresos + " movimientos)",
    "Balance:   " + fmtL(resumen.balance),
    ""
  ];
  if (resumen.egresosPorCategoria.length > 0) {
    lineas.push("Top egresos por categoría:");
    resumen.egresosPorCategoria.slice(0, 5).forEach(function (c) {
      lineas.push("  · " + c.categoria + ": " + fmtL(c.monto));
    });
    lineas.push("");
  }
  lineas.push("Detalle completo (" + nMovs + " movimientos) en el Sheet:");
  lineas.push(url);
  lineas.push("", "— Finanzas H&S");

  MailApp.sendEmail(RPT_DESTINOS,
    "📊 Reporte de " + mes.label + " — Finanzas H&S",
    lineas.join("\n"));
}

/* ------------------------------------------------------------------ */
/* Pruebas manuales (ejecutar desde el editor)                         */
/* ------------------------------------------------------------------ */

// 1) Smoke test: consulta el mes pasado y escribe en el log.
//    NO crea Sheet ni envía correos. Úsala para el flujo de OAuth y
//    para detectar el 403 de proyecto GCP si llegara a aparecer.
function pruebaConexionFirestore() {
  const mesActual = Utilities.formatDate(new Date(), RPT_TZ, "yyyy-MM");
  const mes = rptMesAnterior_(mesActual);
  const txs = rptConsultarMes_(mes);
  console.log("Mes " + mes.clave + " (" + mes.label + "): " +
    txs.length + " transacciones");
  if (txs.length > 0) console.log("Primera: " + JSON.stringify(txs[0]));
}

// 2) Prueba completa REAL: borra la marca y ejecuta el flujo entero
//    (genera el Sheet del mes pasado y ENVÍA el correo a ambos).
function pruebaReporteManual() {
  PropertiesService.getScriptProperties().deleteProperty(RPT_PROP_ULTIMO);
  reporteMensual();
}
