/* =============================================================
   notify.js — Aviso por correo cuando un movimiento supera el
   umbral (L 1,000 por defecto, editable en Ajustes).
   - La app hace POST a un Google Apps Script (cuenta compartida)
     que envía el correo a Héctor y Sonia con MailApp.
   - La URL y la clave viven en Firestore (config/app), tras el
     login — NUNCA en este repositorio público.
   - Sin conexión: el aviso se encola en localStorage y se envía
     al volver la red.
   ============================================================= */

(function () {

  const QUEUE_KEY = "hs_notif_queue";
  const MAX_QUEUE = 20;
  const UMBRAL_DEFAULT = 1000;

  const Notify = {
    url: "",
    secret: "",
    umbral: UMBRAL_DEFAULT,
    _flushing: false
  };

  function configRef() {
    return window.FBase.db.collection("hogar")
      .doc(window.FBase.HOGAR_ID).collection("config").doc("app");
  }

  async function init() {
    try {
      const doc = await configRef().get();
      if (doc.exists) {
        const d = doc.data();
        Notify.url = d.notifUrl || "";
        Notify.secret = d.notifSecret || "";
        Notify.umbral = Number(d.notifUmbral) > 0 ? Number(d.notifUmbral) : UMBRAL_DEFAULT;
      }
    } catch (e) { console.warn("notify config:", e); }
    window.addEventListener("online", flush);
    flush();
  }

  async function saveConfig({ umbral, url, clave }) {
    const data = {};
    if (umbral !== undefined) data.notifUmbral = Number(umbral);
    if (url !== undefined) data.notifUrl = String(url).trim();
    if (clave) data.notifSecret = String(clave).trim();
    await configRef().set(data, { merge: true });
    if (data.notifUmbral > 0) Notify.umbral = data.notifUmbral;
    if (data.notifUrl !== undefined) Notify.url = data.notifUrl;
    if (data.notifSecret) Notify.secret = data.notifSecret;
  }

  function estado() {
    return {
      configurado: !!(Notify.url && Notify.secret),
      umbral: Notify.umbral,
      url: Notify.url
    };
  }

  // tx: datos del movimiento recién guardado; tx.monto ya viene en HNL,
  // así el umbral cubre también los montos capturados en USD.
  function maybeSend(tx) {
    if (!Notify.url || !Notify.secret) return;
    if (!(Number(tx.monto) > Notify.umbral)) return;
    const payload = {
      secreto: Notify.secret,
      tipo: tx.tipo,
      monto: Number(tx.monto),
      moneda: tx.moneda || "HNL",
      montoOriginal: Number(tx.montoOriginal || tx.monto),
      categoria: tx.categoria || "",
      descripcion: tx.descripcion || "",
      banco: window.UI.bancoLabel(tx.cuenta),
      metodo: tx.metodoPago || "",
      fecha: (tx.fecha instanceof Date ? tx.fecha : new Date()).toISOString()
    };
    send(payload).catch(() => enqueue(payload));
  }

  // Envío genérico por el mismo transporte (y la misma cola offline).
  // Lo usa presupuesto.js para las alarmas de presupuesto.
  function sendCustom(data) {
    if (!Notify.url || !Notify.secret) return;
    const payload = Object.assign({ secreto: Notify.secret }, data);
    send(payload).catch(() => enqueue(payload));
  }

  async function send(payload) {
    // text/plain evita el preflight CORS; Apps Script responde con
    // Access-Control-Allow-Origin: * y se puede confirmar la entrega.
    const res = await fetch(Notify.url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const out = await res.json().catch(() => null);
    if (!out || out.ok !== true) throw new Error((out && out.error) || "sin confirmación");
  }

  function readQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; }
    catch (_) { return []; }
  }

  function enqueue(payload) {
    const q = readQueue();
    q.push(payload);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-MAX_QUEUE)));
  }

  async function flush() {
    if (Notify._flushing || !Notify.url || !Notify.secret) return;
    const q = readQueue();
    if (q.length === 0) return;
    Notify._flushing = true;
    const pendientes = [];
    for (const p of q) {
      try { await send(p); }
      catch (_) { pendientes.push(p); }
    }
    localStorage.setItem(QUEUE_KEY, JSON.stringify(pendientes));
    Notify._flushing = false;
  }

  Object.assign(Notify, { init, saveConfig, maybeSend, sendCustom, flush, estado });
  window.Notify = Notify;
})();
