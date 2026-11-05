# Finanzas H&S — PWA (v3)

App móvil (instalable como PWA) para que **Héctor Castro y Sonia Chinchilla** registren sus ingresos y egresos en segundos, conozcan el efectivo disponible y vean dashboards con indicadores del mes y del año.

Reemplaza el Excel `Ingresos y egresos Héctor & Sonia.xlsx` con una experiencia móvil sincronizada entre los dos teléfonos.

## Novedades de la v3

- **Registro automático desde los correos del banco** ⚡: las compras con tarjeta que avisan BAC («BAC Credomatic Informa») y Davivienda («Notificación de transacción») entran solas como egresos, con el comercio y la categoría (aprendida de sus correcciones o sugerida por Claude con los créditos de API). Los débitos de cuenta quedan **por confirmar** y no suman hasta que digan «Es gasto» — pueden ser traslados entre sus cuentas o pagos de tarjeta. Sin duplicados: si ya lo anotaron a mano, el aviso se enlaza al registro existente; si solo se parece, queda por confirmar; y cada noche (11 p. m.) un cierre diario quita los duplicados seguros (doble toque o anotado a mano después de que ya entró solo) y avisa los dudosos, guardando lo quitado en una papelera recuperable. Lo hace un Apps Script en el Gmail de Héctor — ver [`docs/correos-automaticos.gs`](docs/correos-automaticos.gs).
- **Inicio rediseñado**: tarjeta grande con las fotos de la familia (cambian cada 3 segundos, con barra tipo «historias»; tocar a la izquierda/derecha = anterior/siguiente; se pausan mientras escriben), resumen del mes, los dos botones de captura lado a lado y los últimos registrados. La foto actual, difuminada, es el fondo de toda la app.
- **Editar movimientos**: tocar un movimiento abre la misma hoja de captura para corregir monto, categoría, banco, fecha o descripción, o eliminarlo. Al corregir la categoría de una compra automática, la app la recuerda para ese comercio.
- **Movimientos agrupados por día** (con el neto de cada día), íconos por categoría y pestaña «⚡ Auto».
- **Correcciones**: cancelar una confirmación ya no deja la acción pendiente (antes, la siguiente confirmación ejecutaba también la cancelada); la fecha por defecto es la del teléfono (antes, desde las 6 p. m. se guardaba el día siguiente); «1,500» se lee como 1500 (antes 1.50); doble toque en Guardar ya no duplica; restaurar un respaldo funciona con más de 500 registros y conserva las fechas.

## Características

- **Captura rápida**: al abrir la app solo hay dos botones — *Ingreso* y *Egreso* — monto, moneda y guardar. La descripción, el método de pago, el banco y la fecha son opcionales con valores recordados por teléfono.
- **Bancos de Honduras**: el selector de banco es un catálogo fijo (los 16 bancos CNBS + Efectivo) que vive en el código — siempre disponible, sin esperar la red — y es **compartido**: un solo "BAC Credomatic" para ambos.
- **Notificaciones por correo** 📧: cuando un movimiento supera el umbral (L 1,000 por defecto, editable), les llega un correo a los dos. Ver [`docs/notificaciones.md`](docs/notificaciones.md).
- **Presupuesto mensual con alarmas** ⚠️: presupuesto de egresos del mes (L 100,000 por defecto, editable en Ajustes). Al quedar el 20% aparece un contador en la parte superior con lo que falta por gastar, y llegan correos a ambos cuando queda el 20%, 10%, 5%, 4%, 3%, 2% y 1% del presupuesto (cada aviso una sola vez por mes; también avisa si se excede).
- **Reporte mensual en Google Sheet** 📊: el día 6 de cada mes llega a ambos un correo con el cierre del mes anterior — ingresos, egresos y balance, el desglose por categoría y el detalle completo de los movimientos (fecha, categoría, descripción, banco, monto) — más el enlace a un Google Sheet con lo mismo, guardado en la carpeta de Drive "Finanzas H&S — Reportes". Sale el día 6 (no el 1) para dar los primeros cinco días del mes a registrar los ingresos que se calculan a mes vencido. No vive en la app sino en el mismo Apps Script de las notificaciones — ver [`docs/notificaciones.md`](docs/notificaciones.md).
- **Dictado por voz** 🎤: el monto se puede dictar en español ("trescientos cincuenta", "veinte dólares" — detecta la moneda sola). También la descripción.
- **Finanzas unificadas**: todo ingreso y egreso es del matrimonio; ya no se separa por persona ni por dueño de cuenta (el historial se consolidó en los bancos unificados conservando montos, fechas y quién lo registró).
- **Balance siempre visible**: chip en la esquina superior con el neto del mes y del año.
- **Dashboard**: ingresos vs egresos por mes del año en curso, tendencia de 6 meses, egresos por categoría e ingresos/egresos por banco (para saber en qué banco se mueve más el dinero).
- **Fotos de la familia**: tarjeta grande en Inicio y fondo difuminado; **privadas** (viven en Firestore tras el login, nunca en este repositorio). Se administran en *Ajustes → Fotos de la familia* (hasta 16). Cada foto acepta un campo opcional `foco: {x, y}` (fracciones) para centrar las caras; si no, 50 % / 40 %.
- **Tema claro / oscuro / sistema** (sistema sigue el modo del teléfono: de día claro, de noche oscuro).
- **Sincronización en tiempo real** entre teléfonos (Firebase Firestore) y **funciona offline** (incluida la sesión: solo el primer inicio en un dispositivo necesita internet).
- **Conversión USD → HNL** automática (open.er-api.com) con override manual.
- **Cambio de contraseña desde la app** (*Ajustes → Contraseña*).
- **Respaldo en JSON** (exportar/importar).
- **Instalable** (PWA) — sin tiendas de aplicaciones. **Costo: cero** (Firebase Spark + GitHub Pages).

## Stack

- HTML + CSS + JavaScript vanilla (sin build step)
- Firebase Authentication + Firestore — plan gratuito Spark
- Chart.js por CDN · Service Worker offline-first · GitHub Pages (HTTPS)

## Seguridad

- La contraseña compartida **no existe en este código ni en este README**: Firebase la valida al iniciar sesión. Cámbienla cuando quieran desde *Ajustes → Contraseña* (el otro teléfono se desconecta en ~1 hora y vuelve a entrar con la nueva).
- Las reglas de Firestore están fijadas al **UID** de la cuenta compartida — aunque alguien lea la configuración pública de Firebase, no puede leer ni escribir datos:

  ```
  rules_version = '2';
  service cloud.firestore {
    match /databases/{database}/documents {
      match /{document=**} {
        allow read, write: if request.auth.uid == "<UID-de-la-cuenta-compartida>";
      }
    }
  }
  ```

- Las fotos de fondo se guardan en Firestore (colección `fondos`) como JPEG comprimidos, visibles solo con sesión iniciada.

## Estructura

```
finanzas-hs/
├── index.html              # App shell (login, inicio, resumen, movimientos, ajustes)
├── manifest.json           # PWA (íconos any + maskable)
├── sw.js                   # Service worker (cachea shell + CDN)
├── README.md
└── assets/
    ├── css/style.css       # Temas claro/oscuro/sistema + glass + slideshow
    ├── js/
    │   ├── firebase.js     # Config Firebase + auth (sin contraseña en código)
    │   ├── exchange.js     # Tasa USD/HNL
    │   ├── store.js        # CRUD Firestore (transacciones, categorías)
    │   ├── charts.js       # Gráficos Chart.js
    │   ├── fondos.js       # Fotos: tarjeta de Inicio + fondo difuminado + administración
    │   ├── notify.js       # Avisos por correo al superar el umbral
    │   ├── presupuesto.js  # Presupuesto mensual: contador + alarmas escalonadas
    │   ├── auto.js         # Registro automático: pendientes, duplicados, estado
    │   ├── ui.js           # Navegación, modales, tema, fechas y montos
    │   └── app.js          # Bootstrap, Inicio, captura/edición, dictado por voz
    ├── img/                # Íconos Just Smile (any/maskable/apple) + logo login
    └── data/categorias.json# Catálogo semilla (solo primera vez)

docs/notificaciones.md      # Guía del script de correo (sin claves)
docs/reporte-mensual.gs     # Plantilla del reporte mensual (Apps Script)
docs/correos-automaticos.gs # Plantilla del registro automático desde los bancos (Apps Script)
```

## Modelo de datos (Firestore)

```
/hogar/principal/
  ├── transacciones/{id}    {tipo, persona ("hs"; legado: hector/sonia), monto (HNL),
  │                          montoOriginal, moneda, tasaCambio, categoria, descripcion,
  │                          metodoPago, cuenta (nombre del banco), fecha, creadoEn,
  │                          editadoEn?; automáticos: origen "correo", fuente,
  │                          comercio, tarjeta, gmailId, categoriaVia; enlazados a
  │                          mano: vinculadoCorreo, gmailId}
  ├── pendientes/{auto_id}  {monto, montoOriginal, moneda, cuenta, fecha, fuente,
  │                          detalle, gmailId} ← débitos de cuenta por confirmar
  ├── reglas/{CLAVE}        {comercio, categoria, origen "usuario"|"ia"}
  │                          ← comercio → categoría (lo que corrigen en la app manda)
  ├── cuentas/{id}          (archivo legado: ya no se usa ni se actualiza)
  ├── categorias/{id}       {nombre, grupo, esEgreso}
  ├── fondos/{id}           {data (JPEG data-URL ≤ ~500 KB), orden, foco?, creadoEn}
  ├── config/app            {tasaCambio*, notifUrl, notifSecret, notifUmbral,
  │                          presupuestoMensual}
  ├── config/alertas        {mes: "2026-08", enviadas: [20, 10, …]}
  │                         ← umbrales (%) de presupuesto ya avisados en el mes
  ├── config/auto           {ultimaRevision, ultimoResumen, ultimoError,
  │                          cierreUltimo, cierreResumen}
  │                         ← estado del registro automático y del cierre diario
  └── papelera/{id}         copia de lo que el cierre diario (o una limpieza)
                            quitó, con _motivo y _eliminadoEn (recuperable)
```

El campo `cuenta` guarda el **nombre del banco** del catálogo fijo (el historial se migró una sola vez fusionando las cuentas por persona en su banco). Ya no se llevan saldos por cuenta: los totales salen de sumar ingresos y egresos. Los registros antiguos con `persona: hector|sonia` conservan ese campo y la lista lo muestra.

Notas del presupuesto: el respaldo JSON **no incluye** la configuración ni el estado de alarmas (`config/*`) — es estado efímero que se re-arma cada mes. Un cambio de presupuesto o umbral hecho en un teléfono se ve en el otro al **recargar** la app (la configuración se lee al arrancar).

## Probar localmente

```bash
cd ~/Documents/finanzas-hs
python3 -m http.server 8000
# abre http://localhost:8000
```

> El service worker requiere HTTPS o `localhost`. No funciona abriendo `index.html` con doble click.

## Actualizaciones en los teléfonos

Al abrir la app instalada, el service worker descarga la nueva versión y muestra el aviso *"Nueva versión disponible — toca para actualizar"*. 

**Para que cambie el ícono** de la pantalla de inicio hay que **quitar la app y volver a agregarla** (iOS no refresca íconos ya instalados; Android puede tardar días en hacerlo solo). No se pierde nada: los datos viven en Firebase — solo hay que volver a iniciar sesión.
