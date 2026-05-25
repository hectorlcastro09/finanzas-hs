# Finanzas H&S — PWA

App móvil (instalable como PWA) para que **Héctor Castro y Sonia Chinchilla** registren sus ingresos y egresos en tiempo real, conozcan el efectivo disponible en cada momento y vean dashboards con indicadores mensuales.

Reemplaza el Excel `Ingresos y egresos Héctor & Sonia .xlsx` con una experiencia móvil, sincronizada entre los dos teléfonos.

## Características

- **Login con contraseña compartida**: `HS880907`
- **Sincronización en tiempo real** entre los teléfonos de Héctor y Sonia (Firebase Firestore)
- **Funciona offline** y sincroniza al volver la conexión
- **Categorías editables**: si eliges "Otros", puedes crear una nueva al instante
- **Conversión automática USD → HNL** usando una API pública (open.er-api.com) con override manual
- **Dashboard con gráficos**: tendencia ingresos vs egresos, distribución por categoría, por persona y por cuenta
- **Indicadores mensuales**: efectivo disponible, ingresos, egresos, % beneficio/pérdida
- **Doble confirmación** al ajustar el saldo inicial de una cuenta
- **Respaldo en JSON** (exportar/importar)
- **Instalable** en el teléfono (PWA) — sin ir a Play Store ni App Store
- **Modo claro/oscuro**

## Stack

- HTML + CSS + JavaScript vanilla (sin build step)
- [Firebase Authentication + Firestore](https://firebase.google.com/) — plan gratuito Spark
- [Chart.js](https://www.chartjs.org/) por CDN
- Service Worker para offline + manifest para PWA
- Hospedado en **GitHub Pages** (HTTPS gratis, requerido por PWA)

## Costos

**Cero.** El plan Spark de Firebase incluye 1 GB de almacenamiento, 50k lecturas, 20k escrituras y 20k borrados por día — *órdenes de magnitud* arriba de lo que dos personas registrando transacciones consumen. GitHub Pages es gratis para repositorios públicos (y para privados con cuenta Pro).

---

## Setup (una sola vez)

### 1. Crear el proyecto en Firebase

1. Entra a https://console.firebase.google.com/ con cualquier cuenta Google.
2. Click **"Agregar proyecto"** → nómbralo `finanzas-hs` (o lo que quieras) → siguiente → desactiva Analytics → **Crear proyecto**.
3. Una vez creado, en el menú lateral:
   - **Build → Authentication** → "Comenzar" → en *Sign-in method* habilita **Email/Password** (solo el primero).
   - **Build → Firestore Database** → "Crear base de datos" → modo de producción → ubicación más cercana (ej. `nam5 (us-central)`) → Habilitar.
4. En **Authentication → Users** → "Agregar usuario":
   - Email: `finanzas-hs@local.app`
   - Contraseña: `HS880907`
5. En **Firestore → Rules**, pega esto y publica:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read, write: if request.auth != null;
       }
     }
   }
   ```
6. En el ⚙️ junto a *Project Overview* → **Configuración del proyecto** → bajo "Tus apps" elige el ícono web `</>` → registra una app llamada `Finanzas H&S` (sin Hosting) → copia el objeto `firebaseConfig` que aparece.

### 2. Configurar el código

Abre `assets/js/firebase.js` y reemplaza el bloque `FIREBASE_CONFIG` con los valores que copiaste:

```js
const FIREBASE_CONFIG = {
  apiKey: "AIzaSy...",
  authDomain: "finanzas-hs.firebaseapp.com",
  projectId: "finanzas-hs",
  storageBucket: "finanzas-hs.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123...:web:..."
};
```

> ⚠️ Los valores anteriores son *públicos por diseño* (van en el cliente). La seguridad real viene de las reglas de Firestore y la cuenta compartida con contraseña. No publiques la contraseña `HS880907` en el repo si el repo es público.

### 3. Subir a GitHub Pages

```bash
cd ~/Documents/finanzas-hs
git init
git add .
git commit -m "Finanzas H&S — primer commit"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/finanzas-hs.git
git push -u origin main
```

Luego en GitHub:
1. Ve a `Settings → Pages`
2. *Source*: **Deploy from a branch**
3. *Branch*: `main` / `/(root)` → **Save**
4. Espera ~1 minuto. La URL será `https://TU-USUARIO.github.io/finanzas-hs/`

> Si quieres el repo privado pero gratis: necesitas cuenta GitHub Pro (US$4/mes). Alternativa gratuita: usa **Netlify** (drag-and-drop la carpeta) o **Cloudflare Pages** — ambos permiten privacidad gratis.

### 4. Instalar en el teléfono

1. Abre la URL en Chrome/Safari del teléfono.
2. Ingresa contraseña `HS880907`.
3. En Chrome (Android): menú → **"Agregar a pantalla de inicio"** o aparecerá un banner automático.
4. En Safari (iOS): botón compartir → **"Añadir a pantalla de inicio"**.
5. Ya tienes la app con su ícono. Ábrela como cualquier app.

Repetir en el otro teléfono. Los datos se sincronizan automáticamente.

---

## Uso

### Primera vez

1. **Balance general** → ajusta el saldo inicial de cada cuenta de Héctor y Sonia con el dinero que tienen *hoy* (en lempiras). Las cuentas vienen pre-creadas con base en tu Excel: Atlántida, BAC, Promerica, Banrural, Davivienda, CASH, BANPAIS, Occidente, FICOHSA. Puedes agregar, editar o eliminar las que no usen.
2. **Configuración → Tasa de cambio** → toca "Desde API" para obtener la tasa actual. Si difiere de la del BCH, edítala manualmente y guarda.

### Día a día

- **Nuevo ingreso** (botón verde en pestaña Ingresos): elige persona, tipo (salario u otros + descripción), monto, moneda, método de pago, cuenta destino, fecha.
- **Nuevo egreso** (pestaña Egresos): igual, pero eliges la categoría. Si no aparece, elige *"Otros"* y escribe el nombre — la categoría queda disponible para siempre.
- Al elegir **USD**, ves la conversión a lempiras en vivo bajo el monto.
- **Eliminar** un registro: toca el registro en la lista → confirma. El saldo de la cuenta se ajusta automáticamente.
- **Ajustar saldo inicial** de una cuenta: en Balance, toca el ícono de lápiz → cambia el saldo → confirma. El saldo actual se recalcula considerando todas las transacciones existentes.

### Respaldo

- **Configuración → Exportar JSON** → guarda un archivo `finanzas-hs-AAAA-MM-DD.json` (compartelo por WhatsApp o correo para tener una copia).
- **Configuración → Importar JSON** → reemplaza todos los datos por los del archivo. Pide doble confirmación.

---

## Estructura

```
finanzas-hs/
├── index.html              # App shell
├── manifest.json           # PWA
├── sw.js                   # Service worker
├── README.md               # Este archivo
└── assets/
    ├── css/style.css       # Estilos
    ├── js/
    │   ├── firebase.js     # Config Firebase (← ajusta tu config aquí)
    │   ├── exchange.js     # Tasa USD/HNL
    │   ├── store.js        # CRUD Firestore
    │   ├── charts.js       # Gráficos Chart.js
    │   ├── ui.js           # Navegación, modales, toasts
    │   └── app.js          # Bootstrap principal
    ├── img/
    │   ├── icon-192.png    # PWA icon
    │   ├── icon-512.png    # PWA icon
    │   └── logo.svg
    └── data/
        └── categorias.json # Catálogo inicial (extraído del Excel)
```

## Modelo de datos (Firestore)

```
/hogar/principal/
  ├── transacciones/{id}    {tipo, persona, monto, moneda, tasaCambio, categoria,
  │                          descripcion, metodoPago, cuenta, fecha, ...}
  ├── cuentas/{id}          {propietario, nombre, saldoInicial, saldoActual, ...}
  ├── categorias/{id}       {nombre, grupo, esEgreso}
  └── config/app            {tasaCambioActual, tasaCambioFecha, tasaCambioFuente}
```

Cada transacción dispara una actualización atómica del `saldoActual` de la cuenta afectada (Firestore batch).

## Probar localmente

```bash
cd ~/Documents/finanzas-hs
python3 -m http.server 8000
# abre http://localhost:8000
```

> Nota: el service worker requiere HTTPS o `localhost`. No funciona si abres el `index.html` con doble click (`file://`).

## Cambiar la contraseña

Edita en `assets/js/firebase.js` la constante `SHARED_ACCOUNT.password`, y en Firebase Console actualiza la contraseña del usuario `finanzas-hs@local.app`. Ambas deben coincidir.

---

## Limitaciones honestas

- La contraseña vive en el JS del cliente (es necesario para que la PWA inicie sesión sola en Firebase con la cuenta compartida). Cualquiera con acceso al código puede leerla. La seguridad **real** depende de no compartir la URL/cuenta con personas no autorizadas y de las reglas de Firestore.
- La conversión USD→HNL usa `open.er-api.com`. El Banco Central de Honduras no expone una API pública, pero puedes editar la tasa manualmente desde **Configuración** cada vez que la oficial difiera.
- Si en un futuro Héctor y Sonia quieren cuentas separadas (sin compartir todo), habría que reestructurar Firestore (no es lo que pidió este sprint).
