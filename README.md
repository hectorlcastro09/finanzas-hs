# Finanzas H&S — PWA (v2)

App móvil (instalable como PWA) para que **Héctor Castro y Sonia Chinchilla** registren sus ingresos y egresos en segundos, conozcan el efectivo disponible y vean dashboards con indicadores del mes y del año.

Reemplaza el Excel `Ingresos y egresos Héctor & Sonia.xlsx` con una experiencia móvil sincronizada entre los dos teléfonos.

## Características

- **Captura rápida**: al abrir la app solo hay dos botones — *Ingreso* y *Egreso* — monto, moneda y guardar. La descripción, el método de pago, la cuenta y la fecha son opcionales con valores recordados por teléfono.
- **Dictado por voz** 🎤: el monto se puede dictar en español ("trescientos cincuenta", "veinte dólares" — detecta la moneda sola). También la descripción.
- **Finanzas unificadas**: todo ingreso y egreso es del matrimonio; ya no se separa por persona (los registros históricos se conservan intactos).
- **Balance siempre visible**: chip en la esquina superior con el neto del mes y del año.
- **Dashboard**: ingresos vs egresos por mes del año en curso, tendencia de 6 meses, egresos por categoría y saldo por cuenta.
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
    │   ├── store.js        # CRUD Firestore (transacciones, cuentas, categorías)
    │   ├── charts.js       # Gráficos Chart.js
    │   ├── fondos.js       # Fotos de fondo: slideshow + administración
    │   ├── ui.js           # Navegación, modales, tema, helpers
    │   └── app.js          # Bootstrap, captura rápida, dictado por voz
    ├── img/                # Íconos Just Smile (any/maskable/apple) + logo login
    └── data/categorias.json# Catálogo semilla (solo primera vez)
```

## Modelo de datos (Firestore)

```
/hogar/principal/
  ├── transacciones/{id}    {tipo, persona ("hs"; legado: hector/sonia), monto (HNL),
  │                          montoOriginal, moneda, tasaCambio, categoria, descripcion,
  │                          metodoPago, cuenta, fecha, creadoEn}
  ├── cuentas/{id}          {propietario ("hs"; legado: hector/sonia), nombre,
  │                          saldoInicial, saldoActual}
  ├── categorias/{id}       {nombre, grupo, esEgreso}
  ├── fondos/{id}           {data (JPEG data-URL ≤ ~500 KB), orden, creadoEn}
  └── config/app            {tasaCambioActual, tasaCambioFecha, tasaCambioFuente}
```

Cada transacción actualiza el `saldoActual` de su cuenta en el mismo batch atómico. Los registros antiguos con `persona: hector|sonia` se conservan tal cual; la UI ya no separa por persona.

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
