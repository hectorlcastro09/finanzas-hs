/* =============================================================
   charts.js — Gráficos del dashboard con Chart.js
   ============================================================= */

const charts = { trend: null, categories: null, person: null, accounts: null };

const PALETTE = [
  "#0a8754", "#3a86ff", "#f4a261", "#e63946", "#8338ec",
  "#ff006e", "#06ae9b", "#ffbe0b", "#118ab2", "#073b4c",
  "#118ab2", "#ef476f", "#06d6a0", "#118ab2", "#26547c"
];

function fmtL(n) {
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
    const f = t.fecha?.toDate?.() || new Date(t.fecha);
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
        y: { ticks: { color: getTextColor(), callback: v => fmtL(v) }, grid: { color: "rgba(127,127,127,0.12)" } }
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
        tooltip: { callbacks: { label: c => `${c.label}: ${fmtL(c.parsed)}` } }
      }
    }
  });
}

function renderPerson(transacciones) {
  const ctx = document.getElementById("chart-person");
  if (!ctx) return;
  const buckets = { hector: { ing: 0, eg: 0 }, sonia: { ing: 0, eg: 0 } };
  transacciones.forEach(t => {
    const b = buckets[t.persona];
    if (!b) return;
    if (t.tipo === "ingreso") b.ing += Number(t.monto);
    else b.eg += Number(t.monto);
  });
  if (charts.person) charts.person.destroy();
  charts.person = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Héctor", "Sonia"],
      datasets: [
        { label: "Ingresos", data: [buckets.hector.ing, buckets.sonia.ing], backgroundColor: "#0a8754", borderRadius: 8 },
        { label: "Egresos",  data: [buckets.hector.eg,  buckets.sonia.eg],  backgroundColor: "#e63946", borderRadius: 8 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "bottom", labels: { color: getTextColor() } } },
      scales: {
        x: { ticks: { color: getTextColor() }, grid: { display: false } },
        y: { ticks: { color: getTextColor(), callback: v => fmtL(v) }, grid: { color: "rgba(127,127,127,0.12)" } }
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
  const labels = positives.map(c => `${c.nombre} (${c.propietario === "hector" ? "H" : "S"})`);
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
        tooltip: { callbacks: { label: c => `${c.label}: ${fmtL(c.parsed.r ?? c.parsed)}` } }
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
    renderTrend(allTx);            // Trend siempre últimos 6 meses
    renderCategories(filteredTx);  // Categorías según filtro
    renderPerson(filteredTx);
    renderAccounts(cuentas);
  },
  destroyAll
};
