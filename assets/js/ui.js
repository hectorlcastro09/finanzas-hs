/* =============================================================
   ui.js — Navegación, modales, toast, tema, helpers
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
  UI.toastTimer = setTimeout(() => el.classList.add("hidden"), 2800);
}

// ---- Modales ----
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove("hidden");
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add("hidden");
}
function closeAllModals() {
  document.querySelectorAll(".modal").forEach(m => m.classList.add("hidden"));
}

// Confirm helper
function confirmModal(title, msg, onOk) {
  document.getElementById("confirm-title").textContent = title;
  document.getElementById("confirm-msg").textContent = msg;
  const btn = document.getElementById("confirm-ok");
  const handler = () => {
    btn.removeEventListener("click", handler);
    closeModal("modal-confirm");
    onOk();
  };
  btn.addEventListener("click", handler);
  openModal("modal-confirm");
}

// ---- Vista ----
function showView(view) {
  UI.currentView = view;
  document.body.dataset.view = view;
  document.querySelectorAll(".view-content").forEach(v => v.classList.remove("active"));
  document.getElementById("view-" + view)?.classList.add("active");
  document.querySelectorAll(".nav-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.view === view);
  });
  window.dispatchEvent(new CustomEvent("view:changed", { detail: view }));
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
    const f = t.fecha?.toDate?.() || new Date(t.fecha);
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
  toast, openModal, closeModal, closeAllModals, confirmModal,
  showView, fmtL, fmtLShort, fmtSigned, fmtDate, fmtShortDate,
  cuentaLabel, bancoLabel, filterByPeriod,
  getThemeMode, isDarkNow, applyTheme, initTheme
});
UI.state = UI;        // backward compat para UI.state.filters
window.UI = UI;
