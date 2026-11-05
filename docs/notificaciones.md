# Notificaciones por correo (Google Apps Script)

Cuando un ingreso o egreso supera el umbral (L 1,000 por defecto), la app
envía el aviso a un **Google Apps Script** desplegado en la cuenta de Gmail
de la familia, y el script manda el correo a ambos con `MailApp`. Por el
mismo canal salen las **alarmas de presupuesto mensual** (ver abajo).

- **Gratis** (no requiere plan Blaze de Firebase ni servicios de terceros).
- La **URL del script y la clave secreta NO están en este repositorio**:
  se pegan una sola vez en *Ajustes → Notificaciones por correo* y quedan
  guardadas en Firestore (`config/app`), protegidas por el login.
- Cuota de Gmail personal: 100 destinatarios/día → alcanza para ~50 avisos
  diarios (cada aviso va a 2 correos).

## Script (plantilla)

Crear un proyecto en <https://script.new>, pegar esto y **reemplazar
`PEGAR_CLAVE_AQUI`** por una clave larga aleatoria (por ejemplo, la salida
de `openssl rand -hex 16`):

```javascript
const SECRETO = "PEGAR_CLAVE_AQUI";
const DESTINOS = "hectorlcastro09@gmail.com, soniag.chinchilla@gmail.com";

function doPost(e) {
  const out = ContentService.createTextOutput()
    .setMimeType(ContentService.MimeType.JSON);
  try {
    const p = JSON.parse(e.postData.contents);
    if (!p || p.secreto !== SECRETO) {
      out.setContent(JSON.stringify({ ok: false, error: "clave inválida" }));
      return out;
    }

    // ---- Alarmas de presupuesto mensual ----
    if (p.evento === "presupuesto") {
      const fmtL = function (n) {
        return "L " + Number(n).toLocaleString("es-HN", {
          minimumFractionDigits: 2, maximumFractionDigits: 2
        });
      };
      const excedido = Number(p.restante) < 0;
      const asunto = excedido
        ? "🚨 Presupuesto excedido por " + fmtL(-p.restante) + " — Finanzas H&S"
        : "⚠️ Presupuesto: quedan " + fmtL(p.restante) + " este mes — Finanzas H&S";
      const pct = Number(p.presupuesto) > 0
        ? Math.round((Number(p.gastado) / Number(p.presupuesto)) * 100) : 0;

      const lineas = [
        "AVISO DE PRESUPUESTO — " + (p.mesLabel || ""),
        "",
        excedido
          ? "Ya se excedió el presupuesto del mes por " + fmtL(-p.restante) + "."
          : "Solo les quedan " + fmtL(p.restante) + " para gastar este mes.",
        "Gastado: " + fmtL(p.gastado) + " de " + fmtL(p.presupuesto) + " (" + pct + "%)"
      ];
      if (p.ultimo && p.ultimo.monto) {
        lineas.push("", "Último egreso: " + fmtL(p.ultimo.monto) +
          (p.ultimo.categoria ? " — " + p.ultimo.categoria : "") +
          (p.ultimo.banco ? " (" + p.ultimo.banco + ")" : ""));
      }
      lineas.push("", "— Finanzas H&S");

      MailApp.sendEmail(DESTINOS, asunto, lineas.join("\n"));
      out.setContent(JSON.stringify({ ok: true }));
      return out;
    }

    const esIngreso = p.tipo === "ingreso";
    const montoL = "L " + Number(p.monto).toLocaleString("es-HN", {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
    const usd = p.moneda === "USD"
      ? " ($" + Number(p.montoOriginal).toFixed(2) + " USD)"
      : "";

    const asunto = (esIngreso ? "💰 Ingreso" : "💸 Egreso") +
      " de " + montoL + " — Finanzas H&S";

    const lineas = [
      (esIngreso ? "Nuevo INGRESO registrado" : "Nuevo EGRESO registrado"),
      "",
      "Monto:  " + montoL + usd,
      "Banco:  " + (p.banco || "—"),
      "Categoría:  " + (p.categoria || "—")
    ];
    if (p.descripcion) lineas.push("Descripción:  " + p.descripcion);
    if (p.metodo) lineas.push("Método:  " + p.metodo);
    lineas.push("Fecha:  " + new Date(p.fecha).toLocaleString("es-HN", {
      timeZone: "America/Tegucigalpa"
    }));
    lineas.push("", "— Finanzas H&S");

    MailApp.sendEmail(DESTINOS, asunto, lineas.join("\n"));
    out.setContent(JSON.stringify({ ok: true }));
  } catch (err) {
    out.setContent(JSON.stringify({ ok: false, error: String(err) }));
  }
  return out;
}
```

## Despliegue

1. En el editor: **Implementar → Nueva implementación → Aplicación web**.
2. *Ejecutar como:* **Yo** · *Quién tiene acceso:* **Cualquier usuario**.
3. **Autorizar** los permisos cuando Google los pida (envío de correo).
4. Copiar la **URL de la aplicación web** (termina en `/exec`).
5. En la app: *Ajustes → Notificaciones por correo → Conexión con el
   script de Google* → pegar URL y clave → **Guardar**. Con guardarlo en
   un teléfono basta: queda en Firestore para ambos.

## Alarmas de presupuesto mensual

La app lleva un **presupuesto mensual de egresos** (L 100,000 por defecto,
editable en *Ajustes → Notificaciones*; vacío o 0 lo apaga). Cuando queda
poco por gastar envía correos a ambos, con una escalera **en porcentaje
del presupuesto restante**: 20% → 10% → 5% → 4% → 3% → 2% → 1%.

- Cada umbral avisa **una sola vez por mes calendario**; el control vive
  en Firestore (`config/alertas`: `{ mes, enviadas: [20, 10, …] }`) y se
  re-arma solo el día 1. Un egreso grande que cruce varios umbrales de
  golpe manda **un solo correo** con el restante real.
- Además, al quedar ≤ 20% aparece un contador en la parte superior de la
  app ("Quedan L X para gastar este mes"), que pasa a rojo al 5% y avisa
  si el presupuesto se excede.
- El chequeo corre en el teléfono que registra el egreso; sin conexión,
  el correo se encola igual que los avisos por movimiento.

## Reporte mensual en Google Sheet

El **día 6 de cada mes por la mañana (7–8 am)** llega a ambos correos el
cierre del **mes anterior**: ingresos, egresos y balance, el desglose por
categoría (con % del total) y el **detalle completo de los movimientos**
(fecha, tipo, categoría, descripción, banco y monto), más el enlace a un
**Google Sheet** con lo mismo (pestañas *Resumen* y *Detalle*). Los
Sheets quedan en la carpeta de Drive **"Finanzas H&S — Reportes"**
(compartida como lectura con el segundo correo).

**¿Por qué el día 6 y no el 1?** Parte de los ingresos se calcula y se
anota durante los primeros cinco días del mes siguiente; con el corte
el día 1 el reporte salía incompleto. Los días 1–5 el trigger corre
pero no hace nada.

Vive en el **mismo proyecto de Apps Script**, en un archivo aparte
(`Reporte.gs`, plantilla completa en [`reporte-mensual.gs`](reporte-mensual.gs)):

- **Lee Firestore directamente por REST** con el token OAuth del dueño
  del proyecto (vía IAM; no usa la contraseña de la app ni service
  accounts, y las reglas de seguridad de la app cliente no cambian).
- Lo dispara un **trigger de tiempo DIARIO** (7:00–8:00, implementación
  **Head**) con dos guardias: el día del mes (`RPT_DIA_ENVIO = 6`) y la
  Script Property `ultimoReporte` (`"yyyy-MM"`), que evita duplicados —
  así el trigger solo actúa el día 6, y si ese día falla, se
  auto-repara los días siguientes (además llega un correo de aviso del
  fallo).
- El correo se manda con `MailApp` en HTML (con respaldo en texto
  plano) desde la misma cuenta, con remitente "Finanzas H&S".
- El manifest `appsscript.json` declara los **scopes explícitos**
  (`script.send_mail`, `script.external_request`, `datastore`,
  `spreadsheets`, `drive`): al declararlos hay que listar TODOS los que
  el proyecto usa, o el `doPost` dejaría de poder enviar correos.
- Guardar código nuevo **no afecta** al Web App desplegado (sirve su
  versión congelada); el trigger sí corre siempre el código guardado.

**Utilidades** (ejecutar desde el editor):

- `pruebaConexionFirestore` — solo consulta y escribe el conteo en el
  log, sin correos (diagnóstico).
- `pruebaCorreoSoloHector` — manda el correo del mes pasado **solo al
  primer correo** con asunto `[PRUEBA]`, con los datos de hoy; no marca
  el mes ni modifica un Sheet que ya exista.
- `pruebaReporteManual` — envío **real a ambos, hoy mismo** (no espera
  al día 6): borra la marca y repite el flujo completo del mes pasado;
  si el Sheet del mes ya existe se reutiliza y se refresca, no se
  duplica.
- `reiniciarMarcaReporte` — solo borra la marca: el mes pasado se
  vuelve a generar y enviar en la próxima corrida del trigger (día 6 o
  después).

## Registro automático desde los correos de los bancos

Vive en el **mismo proyecto**, en `Correos.gs` (plantilla completa en
[`correos-automaticos.gs`](correos-automaticos.gs)). Un trigger de
tiempo **cada 5 minutos** (`revisarCorreos`) lee el Gmail del dueño del
proyecto **solo en lectura** (`gmail.readonly`, servicio avanzado
«Gmail API») y:

- **Compras con tarjeta** (BAC «BAC Credomatic Informa» con Estado
  Aprobada; Davivienda «Notificación de transacción») → egreso directo,
  con comercio, tarjeta y categoría: regla aprendida (colección
  `reglas`, la escriben sus correcciones en la app) → si no hay, Claude
  (`ANTHROPIC_API_KEY` en *Propiedades del script*; créditos de API,
  ~US$ 0.005 por comercio nuevo y se recuerda) → si no, «Sin categoría»
  (en la app: «Por clasificar»).
- **Débitos de cuenta** (BAC «Notificación Movimiento Monetario» con
  Monto enviado; Davivienda «Débito a Cuenta») → colección `pendientes`.
  No suman hasta que en la app toquen «Es gasto»; pueden ser traslados
  entre sus cuentas o pagos de tarjeta.
- **Sin duplicados**: cada correo se procesa una vez (ids en Script
  Properties, ventana de 10 días) y el documento lleva id
  `auto_<idDelCorreo>`; si ya lo anotaron a mano (mismo monto y banco,
  ±2 días) se enlaza en vez de crear otro, y un correo que ya está en un
  movimiento (enlazado o confirmado) no se registra de nuevo. Lo que
  borren en la app no vuelve a entrar. Si anotan a mano algo que se
  parece a un movimiento por confirmar, la app pregunta «¿Es el mismo
  movimiento?»: si sí, se enlaza y deja de estar pendiente; si no, el
  pendiente se queda.
- Igual que desde el teléfono: aviso por correo si supera el umbral y
  alarmas del presupuesto mensual.
- Estado en `config/auto` (la app lo muestra en *Ajustes → Registro
  automático*). Si algo falla, llega a Héctor un correo de aviso (máximo
  uno por día). Cada corrida trabaja hasta ~4 minutos (Apps Script corta
  a los 6): si quedan avisos, por ejemplo al usar `importarDesde`, siguen
  en la corrida siguiente sin perder lo ya hecho.
- **Cierre diario (11 p. m., `cierreDiario`)**: revisa los últimos 10
  días y quita los duplicados seguros — doble toque (mismos datos
  guardados con ≤ 2 min de diferencia) y el egreso anotado a mano que
  repite un cargo que ya entró solo (monto exacto, mismo banco, ±2 días:
  se deja el de mano, con los datos del banco). Los parecidos (±L 1 u
  otro banco) no se tocan: van en un correo a Héctor. Todo lo quitado se
  copia antes a la colección `papelera` con el motivo (recuperable). Si
  algo falla a mitad, sigue con el resto y el correo del cierre dice qué
  no se pudo terminar (se intenta otra vez la noche siguiente).

**Puesta en marcha (una sola vez):** agregar el servicio «Gmail API»;
manifest con los scopes `gmail.readonly` y `script.scriptapp` además de
los cinco anteriores; ejecutar `probarLecturaCorreos` (solo lee y
muestra; aquí Google pide autorizar — marcar **todas** las casillas);
opcional `probarClasificador`; y `activarRegistroAutomatico`, que toma
como inicio el momento de activarlo (no importa avisos viejos;
`importarDesde("AAAA-MM-DD")` recupera hasta 10 días atrás).

## Notas

- La app solo avisa al **crear** un registro (no al eliminar ni al
  importar respaldos). Si el teléfono está sin conexión, el aviso se
  encola y sale al volver la red.
- Para cambiar el umbral: *Ajustes → Notificaciones por correo → Umbral*.
- Para actualizar el **código** del script sin cambiar la URL:
  *Implementar → Administrar implementaciones → ✏️ → Versión: Nueva
  versión → Implementar*. Solo una **implementación nueva** genera otra
  URL (y habría que actualizarla en Ajustes).
