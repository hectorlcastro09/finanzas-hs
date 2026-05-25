/* =============================================================
   firebase.js — Inicialización de Firebase + Auth + Firestore
   PEGA AQUÍ la configuración de tu proyecto Firebase Console.
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

// Credenciales de la cuenta compartida que usarán Héctor y Sonia
// Crea este usuario en Firebase Console → Authentication → Email/Password
const SHARED_ACCOUNT = {
  email: "hectorlcastro09+finanzas@gmail.com",
  password: "HS880907"
};

// Hogar lógico — un solo documento raíz, ambos teléfonos comparten
const HOGAR_ID = "principal";

// -------- Init Firebase ----------
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

  // Persistencia offline
  db.enablePersistence({ synchronizeTabs: true })
    .catch(err => console.warn("Persistencia offline no activada:", err.code));

  firebaseReady = true;
}

// Inicia sesión con la cuenta compartida tras validar contraseña local
async function signInShared(password) {
  if (password !== SHARED_ACCOUNT.password) {
    throw new Error("PASSWORD_INCORRECTO");
  }
  initFirebase();
  try {
    await auth.signInWithEmailAndPassword(SHARED_ACCOUNT.email, SHARED_ACCOUNT.password);
  } catch (err) {
    // Si no existe la cuenta, intenta crearla (primera vez)
    if (err.code === "auth/user-not-found") {
      await auth.createUserWithEmailAndPassword(SHARED_ACCOUNT.email, SHARED_ACCOUNT.password);
    } else {
      throw err;
    }
  }
  return auth.currentUser;
}

async function signOutShared() {
  if (auth) await auth.signOut();
}

function onAuthChange(callback) {
  initFirebase();
  return auth.onAuthStateChanged(callback);
}

// Exporta al global para los demás módulos
window.FBase = {
  init: initFirebase,
  signInShared,
  signOutShared,
  onAuthChange,
  get auth() { return auth; },
  get db() { return db; },
  HOGAR_ID
};
