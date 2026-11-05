/* =============================================================
   store.js — Acceso a datos en Firestore (v3)
   Estructura:
     /hogar/{HOGAR_ID}/transacciones/{id}
     /hogar/{HOGAR_ID}/pendientes/{id}    ← débitos de cuenta leídos del
                                            correo, esperando "es gasto / no"
     /hogar/{HOGAR_ID}/reglas/{clave}     ← comercio → categoría aprendida
     /hogar/{HOGAR_ID}/cuentas/{id}       (archivo legado)
     /hogar/{HOGAR_ID}/categorias/{id}
     /hogar/{HOGAR_ID}/config/app | alertas | auto
   ============================================================= */

const Store = {
  transacciones: [],
  cuentas: [],
  categorias: [],
  pendientes: [],
  autoEstado: null,          // config/auto: lo escribe el script de los correos
  _listeners: {},
  _subscribers: []
};

// Campos extra permitidos al crear un movimiento (origen automático, o
// anotado a mano y enlazado con el aviso del banco: vinculadoCorreo)
const CAMPOS_ORIGEN = ["origen", "fuente", "comercio", "tarjeta", "gmailId", "detalle", "categoriaVia", "vinculadoCorreo"];

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

  Store._listeners.pendientes = ref.collection("pendientes")
    .orderBy("fecha", "desc")
    .onSnapshot(snap => {
      Store.pendientes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      emit();
    }, err => console.error("listener pendientes:", err));

  Store._listeners.auto = ref.collection("config").doc("auto")
    .onSnapshot(doc => {
      Store.autoEstado = doc.exists ? doc.data() : null;
      emit();
    }, err => console.error("listener config/auto:", err));
}

function stopListeners() {
  Object.values(Store._listeners).forEach(u => u && u());
  Store._listeners = {};
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

// ---- Cuentas (legado) ----
async function addCuenta({ propietario = "hs", nombre, saldoInicial = 0 }) {
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
  const cuenta = Store.cuentas.find(c => c.id === id);
  if (!cuenta) throw new Error("Cuenta no existe");
  const txs = Store.transacciones.filter(t => t.cuenta === id);
  const delta = txs.reduce((acc, t) => acc + (t.tipo === "ingreso" ? Number(t.monto) : -Number(t.monto)), 0);
  await hogarRef().collection("cuentas").doc(id).update({
    saldoInicial: Number(nuevoSaldoInicial),
    saldoActual: Number(nuevoSaldoInicial) + delta,
    fechaSaldoInicial: firebase.firestore.FieldValue.serverTimestamp()
  });
}

async function deleteCuenta(id) {
  await hogarRef().collection("cuentas").doc(id).delete();
}

// ---- Transacciones ----
// El campo "cuenta" guarda el nombre del banco (catálogo fijo). Las
// transacciones antiguas guardaban el id de un doc de "cuentas"; solo
// esas llevaban saldo — los bancos son etiquetas y no tocan saldos.
function armarTransaccion(tx) {
  const monto = Number(tx.monto);
  if (!monto || monto <= 0) throw new Error("Monto inválido");

  const moneda = tx.moneda || "HNL";
  const tasa = Number(tx.tasaCambio) > 0 ? Number(tx.tasaCambio) : window.Exchange.current.rate;
  const montoHNL = moneda === "USD" ? monto * tasa : monto;

  const data = {
    tipo: tx.tipo,
    persona: tx.persona || "hs",
    monto: montoHNL,
    montoOriginal: monto,
    moneda,
    tasaCambio: moneda === "USD" ? tasa : null,
    categoria: tx.categoria || null,
    descripcion: tx.descripcion || "",
    metodoPago: tx.metodoPago || "transferencia",
    cuenta: tx.cuenta || "Efectivo",
    fecha: firebase.firestore.Timestamp.fromDate(tx.fecha || new Date()),
    creadoPor: tx.persona || "hs",
    creadoEn: firebase.firestore.FieldValue.serverTimestamp()
  };
  CAMPOS_ORIGEN.forEach(k => {
    if (tx[k] !== undefined && tx[k] !== null && tx[k] !== "") data[k] = tx[k];
  });
  return { data, montoHNL };
}

async function addTransaccion(tx, opts = {}) {
  const { data, montoHNL } = armarTransaccion(tx);
  const batch = window.FBase.db.batch();
  // Al confirmar un pendiente, el egreso toma el MISMO id del pendiente
  // (auto_<idDelCorreo>): si los dos teléfonos lo confirman, o uno estaba
  // sin conexión, se escribe dos veces el mismo documento y queda uno solo.
  const col = hogarRef().collection("transacciones");
  const txRef = opts.borrarPendienteId ? col.doc(opts.borrarPendienteId) : col.doc();
  batch.set(txRef, data);

  // Solo si apunta a una cuenta legacy real se ajusta su saldo
  if (Store.cuentas.some(c => c.id === tx.cuenta)) {
    const delta = tx.tipo === "ingreso" ? montoHNL : -montoHNL;
    batch.update(hogarRef().collection("cuentas").doc(tx.cuenta), {
      saldoActual: firebase.firestore.FieldValue.increment(delta)
    });
  }
  // Confirmar un pendiente del correo = crear el egreso y quitar el
  // pendiente en la MISMA escritura (no queda huérfano)
  if (opts.borrarPendienteId) {
    batch.delete(hogarRef().collection("pendientes").doc(opts.borrarPendienteId));
  }
  await batch.commit();
  return txRef.id;
}

// Editar un movimiento existente. Recalcula el monto en lempiras si es
// en dólares (con la tasa que ya tenía, para no mover el pasado).
async function updateTransaccion(id, cambios) {
  const actual = Store.transacciones.find(t => t.id === id);
  if (!actual) throw new Error("El movimiento ya no existe");
  if (Store.cuentas.some(c => c.id === actual.cuenta)) {
    throw new Error("Este registro antiguo no se puede editar; elimínalo y créalo de nuevo");
  }
  const monto = Number(cambios.monto);
  if (!monto || monto <= 0) throw new Error("Monto inválido");
  const moneda = cambios.moneda || actual.moneda || "HNL";
  const tasa = moneda === "USD"
    ? (Number(actual.tasaCambio) > 0 && actual.moneda === "USD" ? Number(actual.tasaCambio) : window.Exchange.current.rate)
    : null;
  const data = {
    tipo: cambios.tipo || actual.tipo,
    monto: moneda === "USD" ? monto * tasa : monto,
    montoOriginal: monto,
    moneda,
    tasaCambio: tasa,
    categoria: cambios.categoria || null,
    descripcion: cambios.descripcion || "",
    metodoPago: cambios.metodoPago || actual.metodoPago || "transferencia",
    cuenta: cambios.cuenta || actual.cuenta || "Efectivo",
    editadoEn: firebase.firestore.FieldValue.serverTimestamp()
  };
  if (cambios.fecha instanceof Date) data.fecha = firebase.firestore.Timestamp.fromDate(cambios.fecha);
  await hogarRef().collection("transacciones").doc(id).update(data);
}

async function deleteTransaccion(id) {
  const tx = Store.transacciones.find(t => t.id === id);
  if (!tx) return;
  const batch = window.FBase.db.batch();
  batch.delete(hogarRef().collection("transacciones").doc(id));
  // Revertir saldo solo si era una cuenta legacy con doc real (un banco
  // del catálogo no tiene doc y el update lo haría fallar todo)
  if (tx.cuenta && Store.cuentas.some(c => c.id === tx.cuenta)) {
    const delta = tx.tipo === "ingreso" ? -Number(tx.monto) : Number(tx.monto);
    batch.update(hogarRef().collection("cuentas").doc(tx.cuenta), {
      saldoActual: firebase.firestore.FieldValue.increment(delta)
    });
  }
  await batch.commit();
}

// ---- Pendientes del correo (débitos de cuenta por confirmar) ----
async function descartarPendiente(id) {
  await hogarRef().collection("pendientes").doc(id).delete();
}

// ---- Reglas comercio → categoría ----
// Misma normalización que el script de los correos (Correos.gs):
// mayúsculas, sin tildes, sin números ni signos.
function claveComercio(comercio) {
  return String(comercio || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ /g, "_")
    .slice(0, 120);
}

async function guardarRegla(comercio, categoria) {
  const clave = claveComercio(comercio);
  if (!clave || !categoria) return;
  await hogarRef().collection("reglas").doc(clave).set({
    comercio: String(comercio),
    categoria,
    origen: "usuario",
    actualizado: firebase.firestore.FieldValue.serverTimestamp()
  });
}

// ---- Export / Import ----
// Nota: las fotos de fondo (colección "fondos") NO se incluyen en el
// respaldo — son imágenes grandes y se administran desde Ajustes.
async function exportData() {
  return {
    exportedAt: new Date().toISOString(),
    transacciones: Store.transacciones,
    cuentas: Store.cuentas,
    categorias: Store.categorias,
    config: window.Exchange.current
  };
}

// El JSON del respaldo trae las fechas como {seconds, nanoseconds}:
// hay que volverlas Timestamp o quedarían como mapas sin fecha.
function revivirFechas(v) {
  if (Array.isArray(v)) return v.map(revivirFechas);
  if (v && typeof v === "object") {
    const k = Object.keys(v);
    if (k.length === 2 && typeof v.seconds === "number" && typeof v.nanoseconds === "number") {
      return new firebase.firestore.Timestamp(v.seconds, v.nanoseconds);
    }
    const o = {};
    k.forEach(key => { o[key] = revivirFechas(v[key]); });
    return o;
  }
  return v;
}

// Firestore admite máximo 500 escrituras por lote: se parte en tandas.
// Primero se escribe todo lo del respaldo y al final se borra lo que
// sobra, así un corte a medias nunca deja la base con menos datos.
async function importData(data) {
  if (!data || !Array.isArray(data.transacciones)) throw new Error("JSON inválido");
  const ref = hogarRef();
  const db = window.FBase.db;
  const ops = [];
  const conservar = { transacciones: new Set(), cuentas: new Set(), categorias: new Set() };

  ["cuentas", "categorias", "transacciones"].forEach(col => {
    (data[col] || []).forEach(item => {
      const { id, ...rest } = item;
      const docRef = id ? ref.collection(col).doc(id) : ref.collection(col).doc();
      conservar[col].add(docRef.id);
      ops.push(b => b.set(docRef, revivirFechas(rest)));
    });
  });
  for (const col of ["transacciones", "cuentas", "categorias"]) {
    const snap = await ref.collection(col).get();
    snap.forEach(d => { if (!conservar[col].has(d.id)) ops.push(b => b.delete(d.ref)); });
  }
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch();
    ops.slice(i, i + 400).forEach(op => op(batch));
    await batch.commit();
  }
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
  updateTransaccion,
  deleteTransaccion,
  descartarPendiente,
  claveComercio,
  guardarRegla,
  exportData,
  importData
});
window.Store = Store;
