/* =============================================================
   ui.js — Navegación, modales, toast, tema y helpers (v3)
   ============================================================= */

const UI = {
  currentView: "inicio",
  filters: { period: "month", tx: "all" },
  toastTimer: null
};

// ---- Toast ----
function toast(msg, type = "") {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.className = "toast " + type;
  el.classList.remove("hidden");
  clearTimeout(UI.toastTimer);
  UI.toastTimer = setTimeout(() => el.classList.add("hidden"), msg.length > 70 ? 4200 : 2800);
}

// ---- Modales ----
// Cada modal se cierra solo: una confirmación encima de la hoja de
// captura no debe cerrar (ni borrar) lo que se estaba escribiendo.
function anyModalOpen() {
  return !!document.querySelector(".modal:not(.hidden)");
}
function syncModalState() {
  document.body.classList.toggle("modal-open", anyModalOpen());
  window.dispatchEvent(new CustomEvent("modal:changed"));
}
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove("hidden");
  syncModalState();
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (m && !m.classList.contains("hidden")) {
    m.classList.add("hidden");
    // cerrar la confirmación por cualquier vía que no sea "Confirmar" = cancelar
    if (id === "modal-confirm") cancelarConfirm();
  }
  syncModalState();
}
function closeAllModals() {
  document.querySelectorAll(".modal").forEach(m => closeModal(m.id));
}

// ---- Confirmación ----
// UN solo listener permanente en "Confirmar"; la acción pendiente se
// reemplaza en cada llamada y se descarta al cancelar. (Antes cada
// llamada agregaba un listener nuevo y cancelar dejaba el viejo vivo:
// la siguiente confirmación ejecutaba también la acción cancelada,
// p. ej. borraba dos movimientos.)
let confirmAccion = null;
let confirmAlCancelar = null;
let confirmAlNo = null;              // botón izquierdo con respuesta propia («No, es otro»)

// opts: okText, peligro, onCancel; cancelText + onNo cuando el botón
// izquierdo es una respuesta («No, es otro») y no solo «Cancelar».
function confirmModal(title, msg, onOk, opts = {}) {
  document.getElementById("confirm-title").textContent = title;
  document.getElementById("confirm-msg").textContent = msg;
  const ok = document.getElementById("confirm-ok");
  ok.textContent = opts.okText || "Confirmar";
  ok.className = "btn " + (opts.peligro === false ? "btn-primary" : "btn-danger");
  document.getElementById("confirm-cancel").textContent = opts.cancelText || "Cancelar";
  confirmAccion = onOk;
  confirmAlCancelar = opts.onCancel || null;
  confirmAlNo = opts.onNo || null;
  openModal("modal-confirm");
}

function cancelarConfirm() {
  const alCancelar = confirmAlCancelar;
  confirmAccion = null;
  confirmAlCancelar = null;
  confirmAlNo = null;
  if (alCancelar) {
    try { alCancelar(); } catch (e) { console.warn("onCancel:", e); }
  }
}

function initConfirm() {
  document.getElementById("confirm-ok").addEventListener("click", () => {
    const accion = confirmAccion;
    confirmAccion = null;
    confirmAlCancelar = null;          // confirmado: ya no es cancelación
    confirmAlNo = null;
    document.getElementById("modal-confirm").classList.add("hidden");
    syncModalState();
    if (accion) accion();
  });
  // Botón izquierdo: «Cancelar» de siempre, o la respuesta «No…» si se
  // pasó onNo. Tocar fuera o Escape siguen siendo cancelar.
  document.getElementById("confirm-cancel").addEventListener("click", () => {
    const alNo = confirmAlNo;
    if (!alNo) { closeModal("modal-confirm"); return; }
    confirmAccion = null;
    confirmAlCancelar = null;
    confirmAlNo = null;
    document.getElementById("modal-confirm").classList.add("hidden");
    syncModalState();
    alNo();
  });
}

// ---- Vista ----
function showView(view) {
  UI.currentView = view;
  document.body.dataset.view = view;
  document.querySelectorAll(".view-content").forEach(v => v.classList.remove("active"));
  document.getElementById("view-" + view)?.classList.add("active");
  document.querySelectorAll(".nav-btn").forEach(b => {
    const activo = b.dataset.view === view;
    b.classList.toggle("active", activo);
    if (activo) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  window.scrollTo({ top: 0 });
  window.dispatchEvent(new CustomEvent("view:changed", { detail: view }));
}

// ---- Fechas ----
function txDate(t) {
  const f = t?.fecha;
  return f?.toDate?.() || (f instanceof Date ? f : new Date(f));
}

// "YYYY-MM-DD" en la hora LOCAL del teléfono. (toISOString() da la fecha
// en UTC: en Honduras, desde las 6 p. m. ya es "mañana" y así se guardaban
// los movimientos de la noche con la fecha del día siguiente.)
function fechaLocalISO(d = new Date()) {
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

function mismoDia(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Encabezado de día para la lista: "Hoy", "Ayer", "lunes 2 nov"
function fmtDia(d) {
  const hoy = new Date();
  const ayer = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1);
  if (mismoDia(d, hoy)) return "Hoy";
  if (mismoDia(d, ayer)) return "Ayer";
  const opts = { weekday: "long", day: "numeric", month: "short" };
  if (d.getFullYear() !== hoy.getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("es-HN", opts).replace(".", "");
}

function saludo(d = new Date()) {
  const h = d.getHours();
  if (h >= 5 && h < 12) return "Buenos días";
  if (h >= 12 && h < 19) return "Buenas tardes";
  return "Buenas noches";
}

// ---- Montos ----
// Interpreta lo que se escribe o se dicta: "1,500" y "1500" = 1500;
// "1,5" o "12,50" (coma decimal) = 1.5 / 12.5; "1,234.56" = 1234.56.
// (Antes toda coma se volvía punto y "1,500" se guardaba como 1.50.)
function parseMontoTexto(raw) {
  let s = String(raw ?? "").trim().replace(/[^\d.,]/g, "");
  if (!s) return 0;
  const ultPunto = s.lastIndexOf(".");
  const ultComa = s.lastIndexOf(",");
  if (ultPunto >= 0 && ultComa >= 0) {
    const dec = ultPunto > ultComa ? "." : ",";
    s = s.split(dec === "." ? "," : ".").join("");
    if (dec === ",") s = s.replace(",", ".");
  } else if (ultComa >= 0) {
    const partes = s.split(",");
    const sonMiles = partes.slice(1).every(p => p.length === 3);
    s = sonMiles
      ? partes.join("")
      : partes.slice(0, -1).join("") + "." + partes[partes.length - 1];
  } else if (ultPunto >= 0) {
    const partes = s.split(".");
    if (partes.length > 2) {
      const sonMiles = partes.slice(1).every(p => p.length === 3);
      s = sonMiles
        ? partes.join("")
        : partes.slice(0, -1).join("") + "." + partes[partes.length - 1];
    }
  }
  const n = parseFloat(s);
  return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

// ---- Formato ----
function fmtL(n) {
  return "L. " + Number(n || 0).toLocaleString("es-HN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtLShort(n) {
  return "L " + Number(n || 0).toLocaleString("es-HN", { maximumFractionDigits: 0 });
}
function fmtSigned(n) {
  const v = Number(n || 0);
  return (v >= 0 ? "+" : "−") + fmtLShort(Math.abs(v));
}
function fmtDate(d) {
  const dt = d?.toDate?.() || (typeof d === "string" ? new Date(d) : d);
  if (!dt || isNaN(dt)) return "—";
  return dt.toLocaleDateString("es-HN", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtShortDate(d) {
  const dt = d?.toDate?.() || (typeof d === "string" ? new Date(d) : d);
  if (!dt || isNaN(dt)) return "—";
  return dt.toLocaleDateString("es-HN", { day: "2-digit", month: "short" });
}
function fmtHora(d) {
  return d.toLocaleTimeString("es-HN", { hour: "numeric", minute: "2-digit" });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[m]);
}

// Ícono por categoría (lista más fácil de leer de un vistazo)
const ICONOS_CATEGORIA = {
  "Restaurante": "🍽️", "Supermercado": "🛒", "Combustible": "⛽", "Farmacéutico": "💊",
  "Online": "🛍️", "Celebraciones": "🎉", "Inversión bebé Elízabeth": "👶",
  "Trabajadora": "🧹", "Gastos médicos": "🩺", "Gastos ortodoncia": "🦷",
  "Internet": "📶", "Electricidad": "💡", "Servicio de agua": "💧",
  "Seguro vehículo": "🛡️", "Seguro médico": "🛡️", "Seguro se Vida": "🛡️", "Seguro vivienda": "🛡️",
  "Mantenimiento vehículo": "🔧", "Cambio aceite vehículo": "🔧", "Cuota mensual vehículo": "🚗",
  "Cuota vehículo": "🚗", "Pago prima vehículo": "🚗", "Pago matrícula vehículo": "🚗",
  "Tiendas & departamentos": "🛍️", "Patronato El Barrial": "🏘️", "Logística": "📦",
  "Renta": "🏠", "Renta Lorena": "🏠", "Capital vivienda": "🏠", "Intereses vivienda": "🏠",
  "Imp. Bienes inmuebles": "🏛️", "Impuestos": "🏛️", "Imp. Servicios públicos": "🏛️",
  "Viajes": "✈️", "Cine": "🎬", "Libros": "📚", "Gastos educativos": "🎓",
  "Pastelería y similares": "🧁", "Barbería": "💈", "Fotografía": "📷", "Álbum fotografía": "📷",
  "Colegio dentistas": "🦷", "Cuota especialidad": "🎓", "Préstamo": "🏦", "Extrafinanciamientos": "🏦",
  "Membresía TC": "💳", "HRE TC": "💳", "Tasa Seguridad TC": "💳", "Seguro deuda TC": "💳",
  "Salario": "💼"
};
function iconoCategoria(cat, tipo) {
  return ICONOS_CATEGORIA[cat] || (tipo === "ingreso" ? "💰" : "💸");
}

// Etiqueta de cuenta: agrega " · H"/" · S" solo si el nombre está repetido
// entre cuentas heredadas de la época por-persona.
function cuentaLabel(cuenta, cuentas) {
  if (!cuenta) return "?";
  const dup = (cuentas || []).filter(c => c.nombre === cuenta.nombre).length > 1;
  if (!dup) return cuenta.nombre;
  if (cuenta.propietario === "hector") return cuenta.nombre + " · H";
  if (cuenta.propietario === "sonia") return cuenta.nombre + " · S";
  return cuenta.nombre;
}

// Valor del campo "cuenta" de una transacción → etiqueta visible.
// Hoy se guarda el nombre del banco directo; red de seguridad para
// registros que aún apunten al id de una cuenta legacy.
function bancoLabel(valor) {
  if (!valor) return "—";
  const legacy = (window.Store?.cuentas || []).find(c => c.id === valor);
  if (legacy) return cuentaLabel(legacy, window.Store.cuentas);
  return valor;
}

// ---- Filtro por período ----
function filterByPeriod(transacciones, period) {
  const now = new Date();
  return transacciones.filter(t => {
    const f = txDate(t);
    if (period === "all") return true;
    if (period === "year") return f.getFullYear() === now.getFullYear();
    if (period === "month") return f.getFullYear() === now.getFullYear() && f.getMonth() === now.getMonth();
    if (period === "prev") {
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return f.getFullYear() === prev.getFullYear() && f.getMonth() === prev.getMonth();
    }
    return true;
  });
}

// ---- Tema (claro / oscuro / sistema) ----
const THEME_KEY = "theme";
const mediaDark = window.matchMedia?.("(prefers-color-scheme: dark)");

function getThemeMode() {
  const saved = localStorage.getItem(THEME_KEY);
  return saved === "light" || saved === "dark" ? saved : "system";
}

function isDarkNow() {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr) return attr === "dark";
  return !!mediaDark?.matches;
}

function applyTheme(mode) {
  if (mode === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", mode);
  }
  localStorage.setItem(THEME_KEY, mode);
  window.dispatchEvent(new CustomEvent("theme:changed"));
}

function initTheme() {
  applyTheme(getThemeMode());
  // En modo sistema, seguir los cambios del teléfono en vivo (día/noche)
  mediaDark?.addEventListener?.("change", () => {
    if (getThemeMode() === "system") {
      window.dispatchEvent(new CustomEvent("theme:changed"));
    }
  });
}

// Adjuntamos métodos al MISMO objeto UI y lo exponemos como window.UI
// para evitar problemas de scope entre <script> clásicos.
Object.assign(UI, {
  toast, openModal, closeModal, closeAllModals, anyModalOpen, confirmModal, initConfirm,
  showView, txDate, fechaLocalISO, mismoDia, fmtDia, saludo, parseMontoTexto,
  fmtL, fmtLShort, fmtSigned, fmtDate, fmtShortDate, fmtHora, escapeHtml, iconoCategoria,
  cuentaLabel, bancoLabel, filterByPeriod,
  getThemeMode, isDarkNow, applyTheme, initTheme
});
UI.state = UI;        // backward compat para UI.state.filters
window.UI = UI;
