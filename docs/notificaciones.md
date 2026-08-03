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

## Notas

- La app solo avisa al **crear** un registro (no al eliminar ni al
  importar respaldos). Si el teléfono está sin conexión, el aviso se
  encola y sale al volver la red.
- Para cambiar el umbral: *Ajustes → Notificaciones por correo → Umbral*.
- Para actualizar el **código** del script sin cambiar la URL:
  *Implementar → Administrar implementaciones → ✏️ → Versión: Nueva
  versión → Implementar*. Solo una **implementación nueva** genera otra
  URL (y habría que actualizarla en Ajustes).
