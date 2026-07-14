/* =============================================================
   charts.js — Gráficos del dashboard con Chart.js
   ============================================================= */

const charts = { monthly: null, trend: null, categories: null, accounts: null };

const PALETTE = [
  "#0a8754", "#3a86ff", "#f4a261", "#e63946", "#8338ec",
  "#ff006e", "#06ae9b", "#ffbe0b", "#118ab2", "#073b4c",
  "#ef476f", "#06d6a0", "#26547c", "#e8b33d", "#5e548e"
];

function fmtTick(n) {
  return "L. " + Number(n).toLocaleString("es-HN", { maximumFractionDigits: 0 });
}

function pickPalette(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(PALETTE[i % PALETTE.length]);
  return out;
}

function getTextColor() {
  return getComputedStyle(document.body).getPropertyValue("--text").trim() || "#15201b";
}

function destroyAll() {
  Object.keys(charts).forEach(k => {
    if (charts[k]) { charts[k].destroy(); charts[k] = null; }
  });
}

function txDate(t) {
  return t.fecha?.toDate?.() || new Date(t.fecha);
}

// Ingresos y egresos totales por mes del año en curso
function renderMonthly(transacciones) {
  const ctx = document.getElementById("chart-monthly");
  if (!ctx) return;
  const year = new Date().getFullYear();
  const title = document.getElementById("chart-monthly-title");
  if (title) title.textContent = `Por mes (${year})`;

  const labels = [];
  for (let m = 0; m < 12; m++) {
    labels.push(new Date(year, m, 1).toLocaleDateString("es-HN", { month: "short" }));
  }
  const ingresos = new Array(12).fill(0);
  const egresos = new Array(12).fill(0);
  transacciones.forEach(t => {
    const f = txDate(t);
    if (f.getFullYear() !== year) return;
    if (t.tipo === "ingreso") ingresos[f.getMonth()] += Number(t.monto);
    else egresos[f.getMonth()] += Number(t.monto);
  });

  if (charts.monthly) charts.monthly.destroy();
  charts.monthly = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Ingresos", data: ingresos, backgroundColor: "#0a8754", borderRadius: 5, maxBarThickness: 18 },
        { label: "Egresos",  data: egresos,  backgroundColor: "#e63946", borderRadius: 5, maxBarThickness: 18 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { color: getTextColor(), boxWidth: 12 } },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmtTick(c.parsed.y)}` } }
      },
      scales: {
        x: { ticks: { color: getTextColor(), font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { color: getTextColor(), callback: v => fmtTick(v) }, grid: { color: "rgba(127,127,127,0.12)" } }
      }
    }
  });
}

function renderTrend(transacciones) {
  const ctx = document.getElementById("chart-trend");
  if (!ctx) return;
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ y: d.getFullYear(), m: d.getMonth(), label: d.toLocaleDateString("es-HN", { month: "short" }) });
  }
  const ingresos = months.map(() => 0);
  const egresos = months.map(() => 0);
  transacciones.forEach(t => {
    const f = txDate(t);
    const idx = months.findIndex(m => m.y === f.getFullYear() && m.m === f.getMonth());
    if (idx === -1) return;
    if (t.tipo === "ingreso") ingresos[idx] += Number(t.monto);
    else egresos[idx] += Number(t.monto);
  });

  if (charts.trend) charts.trend.destroy();
  charts.trend = new Chart(ctx, {
    type: "line",
    data: {
      labels: months.map(m => m.label),
      datasets: [
        { label: "Ingresos", data: ingresos, borderColor: "#0a8754", backgroundColor: "rgba(10,135,84,0.12)", tension: 0.35, fill: true },
        { label: "Egresos",  data: egresos,  borderColor: "#e63946", backgroundColor: "rgba(230,57,70,0.12)", tension: 0.35, fill: true }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "bottom", labels: { color: getTextColor() } } },
      scales: {
        x: { ticks: { color: getTextColor() }, grid: { display: false } },
        y: { ticks: { color: getTextColor(), callback: v => fmtTick(v) }, grid: { color: "rgba(127,127,127,0.12)" } }
      }
    }
  });
}

function renderCategories(transacciones) {
  const ctx = document.getElementById("chart-categories");
  if (!ctx) return;
  const acc = {};
  transacciones.filter(t => t.tipo === "egreso").forEach(t => {
    const k = t.categoria || "Sin categoría";
    acc[k] = (acc[k] || 0) + Number(t.monto);
  });
  const entries = Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (charts.categories) charts.categories.destroy();
  charts.categories = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: entries.map(e => e[0]),
      datasets: [{ data: entries.map(e => e[1]), backgroundColor: pickPalette(entries.length), borderWidth: 0 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "60%",
      plugins: {
        legend: { position: "bottom", labels: { color: getTextColor(), boxWidth: 12 } },
        tooltip: { callbacks: { label: c => `${c.label}: ${fmtTick(c.parsed)}` } }
      }
    }
  });
}

function renderAccounts(cuentas) {
  const ctx = document.getElementById("chart-accounts");
  if (!ctx) return;
  const positives = cuentas.filter(c => Number(c.saldoActual) > 0);
  if (charts.accounts) charts.accounts.destroy();
  if (positives.length === 0) return;
  const labels = positives.map(c => window.UI.cuentaLabel(c, cuentas));
  charts.accounts = new Chart(ctx, {
    type: "polarArea",
    data: {
      labels,
      datasets: [{ data: positives.map(c => Number(c.saldoActual)), backgroundColor: pickPalette(positives.length).map(c => c + "cc") }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { color: getTextColor(), boxWidth: 12 } },
        tooltip: { callbacks: { label: c => `${c.label}: ${fmtTick(c.parsed.r ?? c.parsed)}` } }
      },
      scales: {
        r: {
          ticks: { display: false },
          grid: { color: "rgba(127,127,127,0.18)" },
          angleLines: { color: "rgba(127,127,127,0.18)" }
        }
      }
    }
  });
}

window.Charts = {
  renderAll(filteredTx, allTx, cuentas) {
    renderMonthly(allTx);          // Barras del año en curso — siempre todo el año
    renderTrend(allTx);            // Trend siempre últimos 6 meses
    renderCategories(filteredTx);  // Categorías según filtro
    renderAccounts(cuentas);
  },
  destroyAll
};
