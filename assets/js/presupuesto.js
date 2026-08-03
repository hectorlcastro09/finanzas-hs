/* =============================================================
   presupuesto.js — Presupuesto mensual de egresos con alarmas
   escalonadas por correo.
   - Presupuesto editable en Ajustes (config/app.presupuestoMensual,
     compartido entre los dos teléfonos); 0 o vacío = apagado.
   - Escalera de avisos en % del presupuesto RESTANTE:
     20% → 10% → 5% → 4% → 3% → 2% → 1% (última alarma).
     Con L 100,000: quedan L 20,000 → 10,000 → 5,000 → … → 1,000.
   - Cada umbral avisa una sola vez por mes calendario; el estado
     vive en Firestore (config/alertas) compartido entre teléfonos.
     El chequeo corre solo en el teléfono que CREA el egreso (si
     corriera en los listeners, ambos duplicarían correos); el
     correo sale por el canal de notify.js (misma cola offline).
   ============================================================= */

(function () {

  const ESCALERA_PCT = [20, 10, 5, 4, 3, 2, 1];
  const PRESUPUESTO_DEFAULT = 100000;

  const Presupuesto = {
    // 0 hasta que init() carga el valor real (la banda queda oculta mientras)
    mensual: 0
  };

  function configRef() {
    return window.FBase.db.collection("hogar")
      .doc(window.FBase.HOGAR_ID).collection("config").doc("app");
  }

  function alertasRef() {
    return window.FBase.db.collection("hogar")
      .doc(window.FBase.HOGAR_ID).collection("config").doc("alertas");
  }

  function mesId(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }

  function umbralL(pct) {
    return Presupuesto.mensual * pct / 100;
  }

  // Suma de egresos del mes calendario actual (montos ya en HNL)
  function gastadoMes(now) {
    let total = 0;
    (window.Store?.transacciones || []).forEach(t => {
      if (t.tipo !== "egreso") return;
      const f = t.fecha?.toDate?.() || new Date(t.fecha);
      if (f.getFullYear() !== now.getFullYear() || f.getMonth() !== now.getMonth()) return;
      total += Number(t.monto) || 0;
    });
    return total;
  }

  async function init() {
    try {
      const doc = await configRef().get();
      const d = doc.exists ? doc.data() : {};
      Presupuesto.mensual = d.presupuestoMensual === undefined
        ? PRESUPUESTO_DEFAULT
        : Number(d.presupuestoMensual) || 0;
    } catch (e) {
      console.warn("presupuesto config:", e);
      Presupuesto.mensual = PRESUPUESTO_DEFAULT;
    }
  }

  async function saveConfig(valor) {
    const v = Number(valor) || 0;
    await configRef().set({ presupuestoMensual: v }, { merge: true });
    Presupuesto.mensual = v;
  }

  // Estado síncrono para la banda del header y el toast de detalle
  function estado() {
    const p = Presupuesto.mensual;
    const gastado = gastadoMes(new Date());
    return {
      activo: p > 0,
      presupuesto: p,
      gastado,
      restante: p - gastado,
      maxUmbral: umbralL(ESCALERA_PCT[0])
    };
  }

  // Corre SOLO en el teléfono que crea el egreso (submit de captura
  // rápida en app.js). Marca en Firestore los umbrales alcanzados y
  // envía UN solo correo con el restante real (un egreso grande que
  // cruce varios umbrales no manda varios correos).
  async function onEgresoCreado(tx) {
    try {
      const p = Presupuesto.mensual;
      if (!(p > 0)) return;
      // sin transporte configurado no se marca nada: el siguiente
      // egreso con Notify ya listo recupera los umbrales pendientes
      if (!window.Notify.estado().configurado) return;

      const now = new Date();
      const f = tx.fecha instanceof Date ? tx.fecha : new Date(tx.fecha);
      if (f.getFullYear() !== now.getFullYear() || f.getMonth() !== now.getMonth()) return;

      // total del mes; si el listener local aún no trae la tx nueva se suma una vez
      let gastado = gastadoMes(now);
      if (!(window.Store?.transacciones || []).some(t => t.id === tx.id)) {
        gastado += Number(tx.montoHNL) || 0;
      }

      const restante = p - gastado;
      const mes = mesId(now);

      const snap = await alertasRef().get();
      const d = snap.exists ? snap.data() : null;
      const mismoMes = !!(d && d.mes === mes);
      // un doc de otro mes cuenta como vacío (el reset mensual es implícito)
      const enviadas = mismoMes && Array.isArray(d.enviadas) ? d.enviadas : [];
      const pendientes = ESCALERA_PCT.filter(pct => restante <= umbralL(pct) && !enviadas.includes(pct));
      if (pendientes.length === 0) return;

      // marcar ANTES de enviar: si el correo falla queda en la cola offline;
      // al revés, un write fallido repetiría el correo en cada egreso
      if (mismoMes) {
        await alertasRef().set({
          mes,
          enviadas: firebase.firestore.FieldValue.arrayUnion(...pendientes)
        }, { merge: true });
      } else {
        // overwrite sin merge: mes + enviadas nuevos en una sola escritura atómica
        await alertasRef().set({ mes, enviadas: pendientes });
      }

      window.Notify.sendCustom({
        evento: "presupuesto",
        presupuesto: p,
        gastado,
        restante,
        mesLabel: now.toLocaleDateString("es-HN", { month: "long", year: "numeric" }),
        ultimo: {
          monto: Number(tx.montoHNL) || 0,
          categoria: tx.categoria || "",
          banco: window.UI.bancoLabel(tx.cuenta)
        }
      });
    } catch (e) { console.warn("presupuesto:", e); }
  }

  Object.assign(Presupuesto, { init, saveConfig, estado, onEgresoCreado });
  window.Presupuesto = Presupuesto;
})();
