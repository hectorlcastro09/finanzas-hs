/* =============================================================
   exchange.js — Tasa de cambio USD → HNL
   - API pública open.er-api.com (sin key, gratuita)
   - Override manual editable en Configuración
   ============================================================= */

const EXCHANGE_API = "https://open.er-api.com/v6/latest/USD";

const ExchangeRate = {
  rate: 24.6,           // valor de respaldo razonable
  date: null,
  source: "default"
};

async function fetchRateFromApi() {
  try {
    const res = await fetch(EXCHANGE_API);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const hnl = data?.rates?.HNL;
    if (!hnl || hnl <= 0) throw new Error("HNL no encontrado");
    return {
      rate: hnl,
      date: new Date(),
      source: "api"
    };
  } catch (err) {
    console.warn("No se pudo obtener tasa de API:", err);
    return null;
  }
}

async function loadRateFromFirestore() {
  const db = window.FBase?.db;
  if (!db) return null;
  try {
    const doc = await db.collection("hogar").doc(window.FBase.HOGAR_ID)
      .collection("config").doc("app").get();
    if (doc.exists) {
      const d = doc.data();
      if (d.tasaCambioActual) {
        return {
          rate: d.tasaCambioActual,
          date: d.tasaCambioFecha?.toDate?.() || new Date(),
          source: d.tasaCambioFuente || "manual"
        };
      }
    }
  } catch (e) { console.warn("loadRate firestore:", e); }
  return null;
}

async function saveRateToFirestore(rate, source) {
  const db = window.FBase?.db;
  if (!db) return;
  await db.collection("hogar").doc(window.FBase.HOGAR_ID)
    .collection("config").doc("app").set({
      tasaCambioActual: rate,
      tasaCambioFecha: firebase.firestore.FieldValue.serverTimestamp(),
      tasaCambioFuente: source
    }, { merge: true });
}

async function initExchange() {
  const saved = await loadRateFromFirestore();
  if (saved) {
    Object.assign(ExchangeRate, saved);
  }
  // Si tiene más de 24h y la fuente no es manual, refrescar
  const ageMs = ExchangeRate.date ? (Date.now() - ExchangeRate.date.getTime()) : Infinity;
  if (ExchangeRate.source !== "manual" && ageMs > 24 * 60 * 60 * 1000) {
    await refreshFromApi();
  }
}

async function refreshFromApi() {
  const fresh = await fetchRateFromApi();
  if (fresh) {
    Object.assign(ExchangeRate, fresh);
    await saveRateToFirestore(fresh.rate, "api");
    return true;
  }
  return false;
}

async function setManualRate(rate) {
  if (!rate || rate <= 0) throw new Error("Tasa inválida");
  ExchangeRate.rate = rate;
  ExchangeRate.date = new Date();
  ExchangeRate.source = "manual";
  await saveRateToFirestore(rate, "manual");
}

function convertToHNL(amount, currency) {
  if (currency === "HNL") return amount;
  return amount * ExchangeRate.rate;
}

window.Exchange = {
  init: initExchange,
  refreshFromApi,
  setManualRate,
  convertToHNL,
  get current() { return { ...ExchangeRate }; }
};
