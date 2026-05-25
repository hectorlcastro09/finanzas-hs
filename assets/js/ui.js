/* =============================================================
   ui.js — Navegación, modales, toast, helpers
   ============================================================= */

const UI = {
  currentView: "dashboard",
  filters: { period: "month", personIngresos: "all", personEgresos: "all" },
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

// ---- Tema ----
function applyTheme(theme) {
  if (theme === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
  localStorage.setItem("theme", theme);
}
function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next);
}

function initTheme() {
  const saved = localStorage.getItem("theme");
  if (saved && saved !== "system") {
    document.documentElement.setAttribute("data-theme", saved);
  } else if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
}

window.UI = {
  toast, openModal, closeModal, closeAllModals, confirmModal,
  showView, fmtL, fmtDate, fmtShortDate, filterByPeriod,
  toggleTheme, initTheme,
  state: UI
};
