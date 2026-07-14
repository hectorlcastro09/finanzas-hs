/* =============================================================
   firebase.js — Inicialización de Firebase + Auth + Firestore
   La contraseña NO vive en el código: se valida contra Firebase
   al iniciar sesión. La sesión persiste en el dispositivo
   (funciona offline una vez iniciada).
   ============================================================= */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDG8VjBlK0hjrfOpZlWN7omE_4iu1MYIcw",
  authDomain: "flujo-matrimonial.firebaseapp.com",
  projectId: "flujo-matrimonial",
  storageBucket: "flujo-matrimonial.firebasestorage.app",
  messagingSenderId: "1081689079883",
  appId: "1:1081689079883:web:a162ee05eab8489980cdce",
  measurementId: "G-D6EMLN7B8T"
};

// Cuenta compartida de Héctor y Sonia (la contraseña la sabe solo el matrimonio)
const SHARED_EMAIL = "hectorlcastro09+finanzas@gmail.com";

// Hogar lógico — un solo documento raíz, ambos teléfonos comparten
const HOGAR_ID = "principal";

let firebaseReady = false;
let auth = null;
let db = null;

function initFirebase() {
  if (firebaseReady) return;
  if (typeof firebase === "undefined") {
    console.error("Firebase SDK no cargó.");
    return;
  }
  firebase.initializeApp(FIREBASE_CONFIG);
  auth = firebase.auth();
  db = firebase.firestore();

  // Persistencia offline de Firestore
  db.enablePersistence({ synchronizeTabs: true })
    .catch(err => console.warn("Persistencia offline no activada:", err.code));

  firebaseReady = true;
}
initFirebase();

function mapAuthError(err) {
  const code = err?.code || "";
  if (code.includes("wrong-password") || code.includes("invalid-credential") ||
      code.includes("invalid-login-credentials") || code.includes("user-not-found")) {
    return "Contraseña incorrecta";
  }
  if (code.includes("network-request-failed")) {
    return "Sin conexión. La primera vez en un dispositivo se necesita internet.";
  }
  if (code.includes("too-many-requests")) {
    return "Demasiados intentos. Espera unos minutos e intenta de nuevo.";
  }
  return "No se pudo iniciar sesión" + (code ? ` (${code})` : "");
}

// Inicia sesión con la cuenta compartida; Firebase valida la contraseña.
// remember=true → la sesión sobrevive reinicios (LOCAL); si no, solo la pestaña (SESSION).
async function signInShared(password, remember = true) {
  const mode = remember
    ? firebase.auth.Auth.Persistence.LOCAL
    : firebase.auth.Auth.Persistence.SESSION;
  await auth.setPersistence(mode);
  try {
    await auth.signInWithEmailAndPassword(SHARED_EMAIL, password);
  } catch (err) {
    console.warn("signIn:", err?.code);
    throw new Error(mapAuthError(err));
  }
  return auth.currentUser;
}

// Cambia la contraseña compartida (requiere la actual para re-autenticar).
async function changePassword(actual, nueva) {
  const user = auth.currentUser;
  if (!user) throw new Error("Sesión no activa");
  if (!nueva || nueva.length < 6) throw new Error("La nueva contraseña debe tener al menos 6 caracteres");
  const cred = firebase.auth.EmailAuthProvider.credential(SHARED_EMAIL, actual);
  try {
    await user.reauthenticateWithCredential(cred);
  } catch (err) {
    throw new Error(mapAuthError(err));
  }
  await user.updatePassword(nueva);
}

async function signOutShared() {
  if (auth) await auth.signOut();
}

// callback recibe user|null; Firebase restaura la sesión guardada sin red
function onAuthChange(callback) {
  initFirebase();
  return auth.onAuthStateChanged(callback);
}

window.FBase = {
  init: initFirebase,
  signInShared,
  signOutShared,
  changePassword,
  onAuthChange,
  get auth() { return auth; },
  get db() { return db; },
  HOGAR_ID
};
