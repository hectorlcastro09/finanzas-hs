# Notificaciones por correo (Google Apps Script)

Cuando un ingreso o egreso supera el umbral (L 1,000 por defecto), la app
envía el aviso a un **Google Apps Script** desplegado en la cuenta de Gmail
de la familia, y el script manda el correo a ambos con `MailApp`.

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

## Notas

- La app solo avisa al **crear** un registro (no al eliminar ni al
  importar respaldos). Si el teléfono está sin conexión, el aviso se
  encola y sale al volver la red.
- Para cambiar el umbral: *Ajustes → Notificaciones por correo → Umbral*.
- Si se vuelve a desplegar el script (URL nueva), hay que actualizar la
  URL en Ajustes.
