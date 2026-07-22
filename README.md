# Finanzas H&S — PWA (v2)

App móvil (instalable como PWA) para que **Héctor Castro y Sonia Chinchilla** registren sus ingresos y egresos en segundos, conozcan el efectivo disponible y vean dashboards con indicadores del mes y del año.

Reemplaza el Excel `Ingresos y egresos Héctor & Sonia.xlsx` con una experiencia móvil sincronizada entre los dos teléfonos.

## Características

- **Captura rápida**: al abrir la app solo hay dos botones — *Ingreso* y *Egreso* — monto, moneda y guardar. La descripción, el método de pago, el banco y la fecha son opcionales con valores recordados por teléfono.
- **Bancos de Honduras**: el selector de banco es un catálogo fijo (los 16 bancos CNBS + Efectivo) que vive en el código — siempre disponible, sin esperar la red — y es **compartido**: un solo "BAC Credomatic" para ambos.
- **Notificaciones por correo** 📧: cuando un movimiento supera el umbral (L 1,000 por defecto, editable), les llega un correo a los dos. Ver [`docs/notificaciones.md`](docs/notificaciones.md).
- **Dictado por voz** 🎤: el monto se puede dictar en español ("trescientos cincuenta", "veinte dólares" — detecta la moneda sola). También la descripción.
- **Finanzas unificadas**: todo ingreso y egreso es del matrimonio; ya no se separa por persona ni por dueño de cuenta (el historial se consolidó en los bancos unificados conservando montos, fechas y quién lo registró).
- **Balance siempre visible**: chip en la esquina superior con el neto del mes y del año.
- **Dashboard**: ingresos vs egresos por mes del año en curso, tendencia de 6 meses, egresos por categoría e ingresos/egresos por banco (para saber en qué banco se mueve más el dinero).
- **Fotos familiares de fondo**: rotan suavemente detrás de la app; **privadas** (viven en Firestore tras el login, no en este repositorio). Se administran en *Ajustes → Fotos de fondo*.
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
    │   ├── fondos.js       # Fotos de fondo: slideshow + administración
    │   ├── notify.js       # Avisos por correo al superar el umbral
    │   ├── ui.js           # Navegación, modales, tema, helpers
    │   └── app.js          # Bootstrap, captura rápida, dictado por voz
    ├── img/                # Íconos Just Smile (any/maskable/apple) + logo login
    └── data/categorias.json# Catálogo semilla (solo primera vez)

docs/notificaciones.md      # Guía del script de correo (sin claves)
```

## Modelo de datos (Firestore)

```
/hogar/principal/
  ├── transacciones/{id}    {tipo, persona ("hs"; legado: hector/sonia), monto (HNL),
  │                          montoOriginal, moneda, tasaCambio, categoria, descripcion,
  │                          metodoPago, cuenta (nombre del banco), fecha, creadoEn}
  ├── cuentas/{id}          (archivo legado: ya no se usa ni se actualiza)
  ├── categorias/{id}       {nombre, grupo, esEgreso}
  ├── fondos/{id}           {data (JPEG data-URL ≤ ~500 KB), orden, creadoEn}
  └── config/app            {tasaCambio*, notifUrl, notifSecret, notifUmbral}
```

El campo `cuenta` guarda el **nombre del banco** del catálogo fijo (el historial se migró una sola vez fusionando las cuentas por persona en su banco). Ya no se llevan saldos por cuenta: los totales salen de sumar ingresos y egresos. Los registros antiguos con `persona: hector|sonia` conservan ese campo y la lista lo muestra.

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
