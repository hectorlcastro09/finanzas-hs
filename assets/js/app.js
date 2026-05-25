/* =============================================================
   app.js — Bootstrap principal y wiring
   ============================================================= */

(function () {

  const TIPO_INGRESO = "ingreso";
  const TIPO_EGRESO = "egreso";

  let unsubscribe = null;

  // ============ Boot ============
  document.addEventListener("DOMContentLoaded", async () => {
    UI.initTheme();
    registerServiceWorker();
    bindStaticUI();

    updateConnectionStatus();
    window.addEventListener("online", updateConnectionStatus);
    window.addEventListener("offline", updateConnectionStatus);

    // Si hay sesión guardada en este dispositivo, intentar entrar
    const remembered = localStorage.getItem("hs_authenticated") === "1";
    if (remembered) {
      try {
        await window.FBase.signInShared("HS880907");
        await onAuthed();
      } catch (err) {
        console.warn("Auto-login falló:", err);
      }
    }
  });

  // ============ Login ============
  document.getElementById("form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = document.getElementById("login-password").value;
    const remember = document.getElementById("remember-device").checked;
    const errEl = document.getElementById("login-error");
    errEl.classList.add("hidden");

    try {
      await window.FBase.signInShared(pw);
      if (remember) localStorage.setItem("hs_authenticated", "1");
      else sessionStorage.setItem("hs_authenticated", "1");
      await onAuthed();
    } catch (err) {
      console.error(err);
      if (err.message === "PASSWORD_INCORRECTO") {
        errEl.textContent = "Contraseña incorrecta";
      } else {
        errEl.textContent = "Error: " + (err.message || "no se pudo iniciar sesión");
      }
      errEl.classList.remove("hidden");
    }
  });

  document.getElementById("toggle-pw").addEventListener("click", () => {
    const input = document.getElementById("login-password");
    input.type = input.type === "password" ? "text" : "password";
  });

  // ============ Tras autenticarse ============
  async function onAuthed() {
    document.getElementById("view-login").classList.remove("active");
    document.getElementById("app").classList.remove("hidden");

    await window.Exchange.init();
    await window.Store.bootstrapIfEmpty();
    window.Store.startListeners();

    unsubscribe = window.Store.subscribe(renderAll);
    renderAll();
    renderTasaConfig();
    UI.showView("dashboard");
  }

  // ============ Render principal ============
  function renderAll() {
    populateCuentasSelect();
    populateCategoriasSelect();
    renderDashboard();
    renderIngresos();
    renderEgresos();
    renderBalance();
    renderTasaConfig();
  }

  // ============ Dashboard ============
  function renderDashboard() {
    const period = UI.state.filters.period;
    const filtered = UI.filterByPeriod(window.Store.transacciones, period);
    const ingresos = filtered.filter(t => t.tipo === TIPO_INGRESO).reduce((a, t) => a + Number(t.monto), 0);
    const egresos = filtered.filter(t => t.tipo === TIPO_EGRESO).reduce((a, t) => a + Number(t.monto), 0);
    const cashTotal = window.Store.cuentas.reduce((a, c) => a + Number(c.saldoActual || 0), 0);
    const profit = ingresos > 0 ? ((ingresos - egresos) / ingresos) * 100 : 0;

    document.getElementById("kpi-cash").textContent = UI.fmtL(cashTotal);
    document.getElementById("kpi-income").textContent = UI.fmtL(ingresos);
    document.getElementById("kpi-expense").textContent = UI.fmtL(egresos);

    const profitEl = document.getElementById("kpi-profit");
    profitEl.textContent = (profit >= 0 ? "+" : "") + profit.toFixed(1) + "%";
    profitEl.style.color = profit >= 0 ? "var(--color-income)" : "var(--color-expense)";

    document.getElementById("kpi-profit-sub").textContent =
      profit >= 0 ? "beneficio del período" : "pérdida del período";

    // Charts
    window.Charts.renderAll(filtered, window.Store.transacciones, window.Store.cuentas);
  }

  document.getElementById("filter-period").addEventListener("change", (e) => {
    UI.state.filters.period = e.target.value;
    renderDashboard();
  });

  // ============ Ingresos ============
  function renderIngresos() {
    const list = document.getElementById("list-ingresos");
    const filter = UI.state.filters.personIngresos;
    let items = window.Store.transacciones.filter(t => t.tipo === TIPO_INGRESO);
    if (filter !== "all") items = items.filter(t => t.persona === filter);
    renderTxList(list, items, "ingreso");

    const total = items.reduce((a, t) => a + Number(t.monto), 0);
    document.getElementById("ingresos-total").textContent = UI.fmtL(total);
  }

  document.querySelectorAll("[data-person-filter]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-person-filter]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      UI.state.filters.personIngresos = btn.dataset.personFilter;
      renderIngresos();
    });
  });

  // ============ Egresos ============
  function renderEgresos() {
    const list = document.getElementById("list-egresos");
    const filter = UI.state.filters.personEgresos;
    let items = window.Store.transacciones.filter(t => t.tipo === TIPO_EGRESO);
    if (filter !== "all") items = items.filter(t => t.persona === filter);
    renderTxList(list, items, "egreso");

    const total = items.reduce((a, t) => a + Number(t.monto), 0);
    document.getElementById("egresos-total").textContent = UI.fmtL(total);
  }

  document.querySelectorAll("[data-person-filter-eg]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-person-filter-eg]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      UI.state.filters.personEgresos = btn.dataset.personFilterEg;
      renderEgresos();
    });
  });

  function renderTxList(ul, items, tipo) {
    ul.innerHTML = "";
    if (items.length === 0) {
      ul.innerHTML = `<li class="empty">Aún no hay ${tipo === "ingreso" ? "ingresos" : "egresos"} registrados.</li>`;
      return;
    }
    items.forEach(t => {
      const cuenta = window.Store.cuentas.find(c => c.id === t.cuenta);
      const personaLbl = t.persona === "hector" ? "Héctor" : "Sonia";
      const titulo = tipo === "ingreso"
        ? (t.descripcion || (t.categoria ? t.categoria : "Salario"))
        : (t.categoria || "Sin categoría");
      const subt = `${personaLbl} · ${cuenta?.nombre || "?"} · ${UI.fmtShortDate(t.fecha)}`;
      const li = document.createElement("li");
      li.className = "tx-item";
      li.dataset.id = t.id;
      li.innerHTML = `
        <div class="tx-icon ${tipo}">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4">
            ${tipo === "ingreso"
              ? '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>'
              : '<path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/>'}
          </svg>
        </div>
        <div class="tx-main">
          <span class="tx-title">${escapeHtml(titulo)}${t.descripcion && t.categoria ? ` <span class="muted small">— ${escapeHtml(t.descripcion)}</span>` : ""}</span>
          <span class="tx-meta">${escapeHtml(subt)}</span>
        </div>
        <div class="tx-amount ${tipo}">
          ${tipo === "ingreso" ? "+" : "−"}${UI.fmtL(t.monto)}
          ${t.moneda === "USD" ? `<div class="muted small">$${Number(t.montoOriginal).toFixed(2)}</div>` : ""}
        </div>
      `;
      li.addEventListener("click", () => promptDeleteTx(t));
      ul.appendChild(li);
    });
  }

  function promptDeleteTx(t) {
    UI.confirmModal(
      "Eliminar registro",
      `¿Eliminar este ${t.tipo} de ${UI.fmtL(t.monto)}? El saldo de la cuenta se ajustará automáticamente.`,
      async () => {
        try {
          await window.Store.deleteTransaccion(t.id);
          UI.toast("Registro eliminado", "success");
        } catch (e) { UI.toast("Error: " + e.message, "error"); }
      }
    );
  }

  // ============ Balance ============
  function renderBalance() {
    const cuentas = window.Store.cuentas;
    const totalH = cuentas.filter(c => c.propietario === "hector").reduce((a, c) => a + Number(c.saldoActual || 0), 0);
    const totalS = cuentas.filter(c => c.propietario === "sonia").reduce((a, c) => a + Number(c.saldoActual || 0), 0);
    document.getElementById("balance-total").textContent = UI.fmtL(totalH + totalS);
    document.getElementById("balance-total-hector").textContent = UI.fmtL(totalH);
    document.getElementById("balance-total-sonia").textContent = UI.fmtL(totalS);

    renderAccountList("cuentas-hector", cuentas.filter(c => c.propietario === "hector"));
    renderAccountList("cuentas-sonia", cuentas.filter(c => c.propietario === "sonia"));
  }

  function renderAccountList(id, list) {
    const ul = document.getElementById(id);
    ul.innerHTML = "";
    if (list.length === 0) {
      ul.innerHTML = `<li class="muted small">Sin cuentas. Agrega una.</li>`;
      return;
    }
    list.sort((a, b) => a.nombre.localeCompare(b.nombre));
    list.forEach(c => {
      const li = document.createElement("li");
      li.className = "account-item";
      li.innerHTML = `
        <span class="acc-name">${escapeHtml(c.nombre)}</span>
        <span class="acc-saldo">${UI.fmtL(c.saldoActual)}</span>
        <button class="acc-edit" data-id="${c.id}" title="Editar">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
        </button>
      `;
      li.querySelector(".acc-edit").addEventListener("click", () => openCuentaModal(c));
      ul.appendChild(li);
    });
  }

  document.getElementById("btn-add-account").addEventListener("click", () => openCuentaModal(null));

  // ============ Modal Cuenta ============
  function openCuentaModal(cuenta) {
    const form = document.getElementById("form-cuenta");
    form.reset();
    document.getElementById("cuenta-id").value = cuenta?.id || "";
    document.getElementById("modal-cuenta-title").textContent = cuenta ? "Editar cuenta" : "Nueva cuenta";
    document.getElementById("cuenta-propietario").value = cuenta?.propietario || "hector";
    document.getElementById("cuenta-nombre").value = cuenta?.nombre || "";
    document.getElementById("cuenta-saldo").value = cuenta ? Number(cuenta.saldoInicial || 0).toFixed(2) : "0.00";
    const delBtn = document.getElementById("btn-cuenta-delete");
    delBtn.hidden = !cuenta;
    UI.openModal("modal-cuenta");
  }

  document.getElementById("form-cuenta").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("cuenta-id").value;
    const propietario = document.getElementById("cuenta-propietario").value;
    const nombre = document.getElementById("cuenta-nombre").value.trim();
    const saldo = parseFloat(document.getElementById("cuenta-saldo").value) || 0;

    if (!nombre) { UI.toast("Nombre requerido", "error"); return; }

    try {
      if (id) {
        // Si cambió el saldo inicial, doble confirmación
        const cuenta = window.Store.cuentas.find(c => c.id === id);
        if (cuenta && Number(cuenta.saldoInicial) !== saldo) {
          UI.confirmModal(
            "¿Ajustar saldo inicial?",
            `Vas a cambiar el saldo inicial de "${nombre}" a ${UI.fmtL(saldo)}. El saldo actual se recalculará considerando todos los ingresos y egresos. ¿Continuar?`,
            async () => {
              await window.Store.updateCuenta(id, { propietario, nombre });
              await window.Store.setSaldoInicial(id, saldo);
              UI.closeModal("modal-cuenta");
              UI.toast("Cuenta actualizada", "success");
            }
          );
        } else {
          await window.Store.updateCuenta(id, { propietario, nombre });
          UI.closeModal("modal-cuenta");
          UI.toast("Cuenta actualizada", "success");
        }
      } else {
        await window.Store.addCuenta({ propietario, nombre, saldoInicial: saldo });
        UI.closeModal("modal-cuenta");
        UI.toast("Cuenta creada", "success");
      }
    } catch (e) {
      UI.toast("Error: " + e.message, "error");
    }
  });

  document.getElementById("btn-cuenta-delete").addEventListener("click", () => {
    const id = document.getElementById("cuenta-id").value;
    if (!id) return;
    UI.confirmModal(
      "Eliminar cuenta",
      "¿Eliminar esta cuenta? Las transacciones existentes no se borrarán, pero quedarán sin cuenta asociada.",
      async () => {
        await window.Store.deleteCuenta(id);
        UI.closeModal("modal-cuenta");
        UI.toast("Cuenta eliminada", "success");
      }
    );
  });

  // ============ Modal Transacción ============
  document.querySelectorAll("[data-open-modal='modal-tx']").forEach(btn => {
    btn.addEventListener("click", () => openTxModal(btn.dataset.tipo));
  });

  function openTxModal(tipo) {
    const form = document.getElementById("form-tx");
    form.reset();
    document.getElementById("tx-id").value = "";
    document.getElementById("tx-tipo").value = tipo;
    document.getElementById("modal-tx-title").textContent = tipo === "ingreso" ? "Nuevo ingreso" : "Nuevo egreso";

    document.getElementById("lbl-tipo-ingreso").classList.toggle("hidden", tipo !== "ingreso");
    document.getElementById("lbl-categoria").classList.toggle("hidden", tipo !== "egreso");
    document.getElementById("lbl-categoria-nueva").classList.add("hidden");
    document.getElementById("tx-conversion").classList.add("hidden");

    document.getElementById("p-hector").checked = true;
    document.getElementById("tx-moneda").value = "HNL";
    document.getElementById("tx-fecha").value = new Date().toISOString().slice(0, 10);

    populateCuentasSelect();
    populateCategoriasSelect();
    UI.openModal("modal-tx");
  }

  function populateCuentasSelect() {
    const sel = document.getElementById("tx-cuenta");
    if (!sel) return;
    const personSel = document.querySelector("input[name='persona']:checked")?.value || "hector";
    const cuentas = window.Store.cuentas
      .filter(c => c.propietario === personSel)
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    sel.innerHTML = cuentas.length
      ? cuentas.map(c => `<option value="${c.id}">${escapeHtml(c.nombre)}</option>`).join("")
      : `<option value="">— sin cuentas; agrega una en Balance —</option>`;
  }

  function populateCategoriasSelect() {
    const sel = document.getElementById("tx-categoria");
    if (!sel) return;
    const grupos = {};
    window.Store.categorias.forEach(c => {
      const g = c.grupo || "Otros";
      (grupos[g] = grupos[g] || []).push(c);
    });
    let html = `<option value="">Selecciona...</option>`;
    Object.entries(grupos).forEach(([grupo, cats]) => {
      cats.sort((a, b) => a.nombre.localeCompare(b.nombre));
      html += `<optgroup label="${escapeHtml(grupo)}">`;
      cats.forEach(c => { html += `<option value="${escapeHtml(c.nombre)}">${escapeHtml(c.nombre)}</option>`; });
      html += `</optgroup>`;
    });
    sel.innerHTML = html;
  }

  document.querySelectorAll("input[name='persona']").forEach(r => {
    r.addEventListener("change", populateCuentasSelect);
  });

  document.getElementById("tx-categoria").addEventListener("change", (e) => {
    const lbl = document.getElementById("lbl-categoria-nueva");
    lbl.classList.toggle("hidden", e.target.value !== "Otros");
  });

  function updateConversionPreview() {
    const monto = parseFloat(document.getElementById("tx-monto").value) || 0;
    const moneda = document.getElementById("tx-moneda").value;
    const el = document.getElementById("tx-conversion");
    if (moneda === "USD" && monto > 0) {
      const tasa = window.Exchange.current.rate;
      const hnl = monto * tasa;
      el.textContent = `≈ ${UI.fmtL(hnl)} (tasa: ${tasa.toFixed(4)})`;
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  }
  document.getElementById("tx-monto").addEventListener("input", updateConversionPreview);
  document.getElementById("tx-moneda").addEventListener("change", updateConversionPreview);

  document.getElementById("form-tx").addEventListener("submit", async (e) => {
    e.preventDefault();
    const tipo = document.getElementById("tx-tipo").value;
    const persona = document.querySelector("input[name='persona']:checked").value;
    const monto = parseFloat(document.getElementById("tx-monto").value) || 0;
    const moneda = document.getElementById("tx-moneda").value;
    const descripcion = document.getElementById("tx-descripcion").value.trim();
    const metodoPago = document.getElementById("tx-metodo").value;
    const cuenta = document.getElementById("tx-cuenta").value;
    const fechaStr = document.getElementById("tx-fecha").value;

    if (!monto || monto <= 0) { UI.toast("Monto inválido", "error"); return; }
    if (!cuenta) { UI.toast("Selecciona o crea una cuenta", "error"); return; }

    let categoria = null;
    let descFinal = descripcion;
    if (tipo === "egreso") {
      categoria = document.getElementById("tx-categoria").value;
      if (!categoria) { UI.toast("Selecciona una categoría", "error"); return; }
      if (categoria === "Otros") {
        const nueva = document.getElementById("tx-categoria-nueva").value.trim();
        if (nueva) {
          await window.Store.addCategoria(nueva, "Otros");
          categoria = nueva;
        }
      }
    } else {
      const tipoIng = document.getElementById("tx-tipo-ingreso").value;
      categoria = tipoIng === "salario" ? "Salario" : "Otros";
      if (tipoIng === "otros" && !descripcion) {
        UI.toast("Describe el tipo de ingreso", "error"); return;
      }
    }

    const fecha = fechaStr ? new Date(fechaStr + "T12:00:00") : new Date();

    try {
      await window.Store.addTransaccion({
        tipo, persona, monto, moneda,
        categoria, descripcion: descFinal,
        metodoPago, cuenta, fecha
      });
      UI.closeModal("modal-tx");
      UI.toast(tipo === "ingreso" ? "Ingreso registrado" : "Egreso registrado", "success");
    } catch (err) {
      UI.toast("Error: " + err.message, "error");
    }
  });

  // ============ Configuración ============
  function renderTasaConfig() {
    const cur = window.Exchange.current;
    document.getElementById("tasa-input").value = Number(cur.rate).toFixed(4);
    document.getElementById("tasa-fuente").textContent =
      cur.source === "api" ? "API automática" : cur.source === "manual" ? "Manual" : "Por defecto";
    document.getElementById("tasa-fecha").textContent = cur.date ? UI.fmtDate(cur.date) : "—";
  }

  document.getElementById("btn-tasa-api").addEventListener("click", async () => {
    const ok = await window.Exchange.refreshFromApi();
    if (ok) { renderTasaConfig(); UI.toast("Tasa actualizada desde API", "success"); }
    else { UI.toast("No se pudo obtener la tasa", "error"); }
  });

  document.getElementById("btn-tasa-save").addEventListener("click", async () => {
    const rate = parseFloat(document.getElementById("tasa-input").value);
    if (!rate || rate <= 0) { UI.toast("Tasa inválida", "error"); return; }
    try {
      await window.Exchange.setManualRate(rate);
      renderTasaConfig();
      UI.toast("Tasa guardada", "success");
    } catch (e) { UI.toast("Error: " + e.message, "error"); }
  });

  // Export / Import
  document.getElementById("btn-export").addEventListener("click", async () => {
    const data = await window.Store.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `finanzas-hs-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    UI.toast("Respaldo exportado", "success");
  });

  document.getElementById("file-import").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    UI.confirmModal(
      "Importar respaldo",
      "Esto reemplazará TODOS los datos actuales por los del archivo. ¿Continuar?",
      async () => {
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          await window.Store.importData(data);
          UI.toast("Respaldo importado", "success");
        } catch (err) {
          UI.toast("Error: " + err.message, "error");
        } finally {
          e.target.value = "";
        }
      }
    );
  });

  document.getElementById("btn-logout").addEventListener("click", () => {
    UI.confirmModal("Cerrar sesión", "¿Salir de la app en este dispositivo?", async () => {
      localStorage.removeItem("hs_authenticated");
      sessionStorage.removeItem("hs_authenticated");
      window.Store.stopListeners();
      await window.FBase.signOutShared();
      document.getElementById("app").classList.add("hidden");
      document.getElementById("view-login").classList.add("active");
      document.getElementById("login-password").value = "";
    });
  });

  // ============ UI bindings ============
  function bindStaticUI() {
    // Bottom nav
    document.querySelectorAll(".nav-btn").forEach(btn => {
      btn.addEventListener("click", () => UI.showView(btn.dataset.view));
    });
    // Cerrar modales
    document.querySelectorAll("[data-close-modal]").forEach(el => {
      el.addEventListener("click", () => UI.closeAllModals());
    });
    // Theme toggle
    document.getElementById("btn-theme").addEventListener("click", UI.toggleTheme);
  }

  function updateConnectionStatus() {
    const dot = document.getElementById("connection-status");
    if (!dot) return;
    if (navigator.onLine) {
      dot.classList.add("online"); dot.classList.remove("offline");
      dot.title = "En línea";
    } else {
      dot.classList.add("offline"); dot.classList.remove("online");
      dot.title = "Sin conexión — los datos se sincronizarán cuando vuelva";
    }
  }

  // ============ Service worker ============
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(err => console.warn("SW reg failed:", err));
    });
  }

  // ============ Helpers ============
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[m]);
  }

})();
