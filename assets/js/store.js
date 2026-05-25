/* =============================================================
   store.js — Acceso a datos en Firestore
   Estructura:
     /hogar/{HOGAR_ID}/transacciones/{id}
     /hogar/{HOGAR_ID}/cuentas/{id}
     /hogar/{HOGAR_ID}/categorias/{id}
     /hogar/{HOGAR_ID}/config/app
   ============================================================= */

const Store = {
  transacciones: [],
  cuentas: [],
  categorias: [],
  _listeners: { transacciones: null, cuentas: null, categorias: null },
  _subscribers: []
};

function hogarRef() {
  return window.FBase.db.collection("hogar").doc(window.FBase.HOGAR_ID);
}

function emit() {
  Store._subscribers.forEach(fn => {
    try { fn(); } catch (e) { console.error("subscriber:", e); }
  });
}

function subscribe(fn) {
  Store._subscribers.push(fn);
  return () => {
    Store._subscribers = Store._subscribers.filter(f => f !== fn);
  };
}

// ---- Realtime listeners ----
function startListeners() {
  const ref = hogarRef();

  Store._listeners.transacciones = ref.collection("transacciones")
    .orderBy("fecha", "desc")
    .onSnapshot(snap => {
      Store.transacciones = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      emit();
    }, err => console.error("listener transacciones:", err));

  Store._listeners.cuentas = ref.collection("cuentas")
    .onSnapshot(snap => {
      Store.cuentas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      emit();
    }, err => console.error("listener cuentas:", err));

  Store._listeners.categorias = ref.collection("categorias")
    .onSnapshot(snap => {
      Store.categorias = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      emit();
    }, err => console.error("listener categorias:", err));
}

function stopListeners() {
  Object.values(Store._listeners).forEach(u => u && u());
  Store._listeners = { transacciones: null, cuentas: null, categorias: null };
}

// ---- Bootstrap inicial (semilla) ----
async function bootstrapIfEmpty() {
  const ref = hogarRef();

  // categorías
  const catSnap = await ref.collection("categorias").limit(1).get();
  if (catSnap.empty) {
    const seed = await fetch("assets/data/categorias.json").then(r => r.json());
    const batch = window.FBase.db.batch();
    seed.egresos.forEach(c => {
      const docRef = ref.collection("categorias").doc();
      batch.set(docRef, { nombre: c.nombre, grupo: c.grupo, esEgreso: true });
    });
    await batch.commit();
  }

  // cuentas
  const ctaSnap = await ref.collection("cuentas").limit(1).get();
  if (ctaSnap.empty) {
    const seed = await fetch("assets/data/categorias.json").then(r => r.json());
    const batch = window.FBase.db.batch();
    seed.cuentas.forEach(c => {
      const docRef = ref.collection("cuentas").doc();
      batch.set(docRef, {
        propietario: c.propietario,
        nombre: c.nombre,
        moneda: c.moneda || "HNL",
        saldoInicial: 0,
        saldoActual: 0,
        fechaSaldoInicial: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
    await batch.commit();
  }
}

// ---- Categorías ----
async function addCategoria(nombre, grupo = "Otros") {
  if (!nombre) return null;
  const existing = Store.categorias.find(c => c.nombre.toLowerCase() === nombre.toLowerCase());
  if (existing) return existing.id;
  const docRef = await hogarRef().collection("categorias").add({
    nombre, grupo, esEgreso: true
  });
  return docRef.id;
}

// ---- Cuentas ----
async function addCuenta({ propietario, nombre, saldoInicial = 0 }) {
  const docRef = await hogarRef().collection("cuentas").add({
    propietario,
    nombre,
    moneda: "HNL",
    saldoInicial: Number(saldoInicial),
    saldoActual: Number(saldoInicial),
    fechaSaldoInicial: firebase.firestore.FieldValue.serverTimestamp()
  });
  return docRef.id;
}

async function updateCuenta(id, data) {
  await hogarRef().collection("cuentas").doc(id).update(data);
}

async function setSaldoInicial(id, nuevoSaldoInicial) {
  // Reajusta el saldoActual considerando todas las transacciones existentes
  const cuenta = Store.cuentas.find(c => c.id === id);
  if (!cuenta) throw new Error("Cuenta no existe");

  const txs = Store.transacciones.filter(t => t.cuenta === id);
  const delta = txs.reduce((acc, t) => {
    return acc + (t.tipo === "ingreso" ? Number(t.monto) : -Number(t.monto));
  }, 0);

  const nuevoActual = Number(nuevoSaldoInicial) + delta;
  await hogarRef().collection("cuentas").doc(id).update({
    saldoInicial: Number(nuevoSaldoInicial),
    saldoActual: nuevoActual,
    fechaSaldoInicial: firebase.firestore.FieldValue.serverTimestamp()
  });
}

async function deleteCuenta(id) {
  await hogarRef().collection("cuentas").doc(id).delete();
}

// ---- Transacciones ----
async function addTransaccion(tx) {
  const monto = Number(tx.monto);
  if (!monto || monto <= 0) throw new Error("Monto inválido");
  if (!tx.cuenta) throw new Error("Selecciona una cuenta");

  // Convertir si es USD
  const moneda = tx.moneda || "HNL";
  const tasa = window.Exchange.current.rate;
  const montoHNL = moneda === "USD" ? monto * tasa : monto;

  const data = {
    tipo: tx.tipo,
    persona: tx.persona,
    monto: montoHNL,
    montoOriginal: monto,
    moneda,
    tasaCambio: moneda === "USD" ? tasa : null,
    categoria: tx.categoria || null,
    descripcion: tx.descripcion || "",
    metodoPago: tx.metodoPago || "transferencia",
    cuenta: tx.cuenta,
    fecha: firebase.firestore.Timestamp.fromDate(tx.fecha || new Date()),
    creadoPor: tx.persona,
    creadoEn: firebase.firestore.FieldValue.serverTimestamp()
  };

  const batch = window.FBase.db.batch();
  const txRef = hogarRef().collection("transacciones").doc();
  batch.set(txRef, data);

  // Actualizar saldoActual de la cuenta
  const ctaRef = hogarRef().collection("cuentas").doc(tx.cuenta);
  const delta = tx.tipo === "ingreso" ? montoHNL : -montoHNL;
  batch.update(ctaRef, {
    saldoActual: firebase.firestore.FieldValue.increment(delta)
  });

  await batch.commit();
  return txRef.id;
}

async function deleteTransaccion(id) {
  const tx = Store.transacciones.find(t => t.id === id);
  if (!tx) return;
  const batch = window.FBase.db.batch();
  batch.delete(hogarRef().collection("transacciones").doc(id));
  // Revertir el saldo
  const delta = tx.tipo === "ingreso" ? -Number(tx.monto) : Number(tx.monto);
  if (tx.cuenta) {
    batch.update(hogarRef().collection("cuentas").doc(tx.cuenta), {
      saldoActual: firebase.firestore.FieldValue.increment(delta)
    });
  }
  await batch.commit();
}

// ---- Export / Import ----
async function exportData() {
  return {
    exportedAt: new Date().toISOString(),
    transacciones: Store.transacciones,
    cuentas: Store.cuentas,
    categorias: Store.categorias,
    config: window.Exchange.current
  };
}

async function importData(data) {
  if (!data || !Array.isArray(data.transacciones)) throw new Error("JSON inválido");
  const ref = hogarRef();
  const batch = window.FBase.db.batch();

  // Limpia y reemplaza
  const existingTx = await ref.collection("transacciones").get();
  existingTx.forEach(d => batch.delete(d.ref));
  const existingCta = await ref.collection("cuentas").get();
  existingCta.forEach(d => batch.delete(d.ref));
  const existingCat = await ref.collection("categorias").get();
  existingCat.forEach(d => batch.delete(d.ref));

  (data.cuentas || []).forEach(c => {
    const { id, ...rest } = c;
    batch.set(ref.collection("cuentas").doc(id || undefined), rest);
  });
  (data.categorias || []).forEach(c => {
    const { id, ...rest } = c;
    batch.set(ref.collection("categorias").doc(id || undefined), rest);
  });
  (data.transacciones || []).forEach(t => {
    const { id, ...rest } = t;
    batch.set(ref.collection("transacciones").doc(id || undefined), rest);
  });
  await batch.commit();
}

// Adjuntamos métodos al MISMO objeto Store y lo exponemos como window.Store
// para evitar problemas de scope (const Store es lexical entre scripts).
Object.assign(Store, {
  subscribe,
  startListeners,
  stopListeners,
  bootstrapIfEmpty,
  addCategoria,
  addCuenta,
  updateCuenta,
  setSaldoInicial,
  deleteCuenta,
  addTransaccion,
  deleteTransaccion,
  exportData,
  importData
});
window.Store = Store;
