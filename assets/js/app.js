/* =============================================================
   app.js — Bootstrap principal y wiring (v2)
   - Boot con onAuthStateChanged (la sesión restaura sin red)
   - Captura rápida unificada (persona: "hs")
   - Chip de balance mes/año siempre visible
   - Dictado por voz (Web Speech API, es-HN)
   ============================================================= */

(function () {

  const TIPO_INGRESO = "ingreso";
  const TIPO_EGRESO = "egreso";
  const LS_CUENTA = "hs_last_cuenta";
  const LS_METODO = "hs_last_metodo";
  const LS_CAT_EGRESO = "hs_last_cat_egreso";
  const LS_CAT_INGRESO = "hs_last_cat_ingreso";

  // Catálogo fijo de bancos de Honduras — vive en el código para estar
  // disponible al instante (sin depender de Firestore) y es compartido:
  // un solo "BAC Credomatic" para ambos. "Efectivo" cubre lo que no
  // pasa por banco.
  const BANCOS = [
    "Efectivo",
    "BAC Credomatic",
    "BANADESA",
    "Banco Atlántida",
    "Banco Azteca",
    "Banco de Honduras",
    "Banco de los Trabajadores",
    "Banco de Occidente",
    "Banco Popular",
    "Banco Promerica",
    "Banhcafé",
    "Banpaís",
    "Banrural",
    "Davivienda",
    "Ficensa",
    "Ficohsa",
    "Lafise"
  ];

  let unsubscribe = null;
  let authBooted = false;
  const quick = { tipo: TIPO_EGRESO, cat: null, otra: false };

  // ============ Boot ============
  document.addEventListener("DOMContentLoaded", () => {
    UI.initTheme();
    syncThemeMeta();
    initThemeControls();
    registerServiceWorker();
    bindStaticUI();
    initVoice();

    updateConnectionStatus();
    window.addEventListener("online", updateConnectionStatus);
    window.addEventListener("offline", updateConnectionStatus);

    // limpieza de flags de la v1 (ya no se usan)
    localStorage.removeItem("hs_authenticated");
    sessionStorage.removeItem("hs_authenticated");

    // Puerta de entrada: Firebase restaura la sesión guardada (offline OK)
    window.FBase.onAuthChange(async (user) => {
      document.getElementById("splash").classList.add("hidden");
      if (user) {
        document.getElementById("view-login").classList.remove("active");
        if (!authBooted) {
          authBooted = true;
          await onAuthed();
        }
      } else {
        authBooted = false;
        teardown();
        document.getElementById("app").classList.add("hidden");
        document.getElementById("view-login").classList.add("active");
      }
    });
  });

  // ============ Login ============
  document.getElementById("form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = document.getElementById("login-password").value;
    const remember = document.getElementById("remember-device").checked;
    const errEl = document.getElementById("login-error");
    errEl.classList.add("hidden");
    try {
      await window.FBase.signInShared(pw, remember);
      document.getElementById("login-password").value = "";
      // onAuthChange se encarga del resto
    } catch (err) {
      errEl.textContent = err.message || "No se pudo iniciar sesión";
      errEl.classList.remove("hidden");
    }
  });

  document.getElementById("toggle-pw").addEventListener("click", () => {
    const input = document.getElementById("login-password");
    input.type = input.type === "password" ? "text" : "password";
  });

  // ============ Tras autenticarse ============
  async function onAuthed() {
    document.getElementById("app").classList.remove("hidden");
    try {
      await window.Exchange.init();
      await window.Store.bootstrapIfEmpty();
    } catch (e) {
      console.warn("init:", e);
    }
    window.Store.startListeners();
    window.Notify.init().then(renderNotifAjustes).catch(() => {});
    window.Presupuesto.init().then(renderAll).catch(() => {});
    unsubscribe = window.Store.subscribe(renderAll);
    renderAll();
    UI.showView("inicio");
    // las fotos de fondo cargan después del primer render (no bloquean nada)
    setTimeout(() => window.Fondos.start(), 400);
  }

  function teardown() {
    window.Store.stopListeners();
    window.Fondos.stop();
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  }

  // ============ Render principal ============
  function renderAll() {
    renderChip();
    renderPresupuesto();
    renderResumen();
    renderMovimientos();
    renderNotifAjustes();
    renderTasaConfig();
  }

  // ============ Chip de balance (mes + año) ============
  function renderChip() {
    const now = new Date();
    let mes = 0, anio = 0;
    window.Store.transacciones.forEach(t => {
      const f = t.fecha?.toDate?.() || new Date(t.fecha);
      if (f.getFullYear() !== now.getFullYear()) return;
      const delta = (t.tipo === TIPO_INGRESO ? 1 : -1) * Number(t.monto);
      anio += delta;
      if (f.getMonth() === now.getMonth()) mes += delta;
    });
    const mesEl = document.getElementById("chip-mes");
    const anioEl = document.getElementById("chip-anio");
    const mesLbl = now.toLocaleDateString("es-HN", { month: "short" }).replace(".", "");
    mesEl.textContent = `${mesLbl} ${UI.fmtSigned(mes)}`;
    mesEl.classList.toggle("pos", mes >= 0);
    mesEl.classList.toggle("neg", mes < 0);
    anioEl.textContent = `${now.getFullYear()} ${UI.fmtSigned(anio)}`;
  }

  // ============ Banda de presupuesto (segunda fila del header) ============
  function renderPresupuesto() {
    const bar = document.getElementById("budget-bar");
    if (!bar || !window.Presupuesto) return;
    const est = window.Presupuesto.estado();
    const visible = est.activo && est.restante <= est.maxUmbral;
    bar.classList.toggle("hidden", !visible);
    document.body.classList.toggle("has-budget", visible);
    if (!visible) return;
    const cincoPct = est.presupuesto * 0.05;
    bar.classList.toggle("warn", est.restante > cincoPct);
    bar.classList.toggle("danger", est.restante <= cincoPct && est.restante >= 0);
    bar.classList.toggle("over", est.restante < 0);
    bar.textContent = est.restante < 0
      ? "Presupuesto excedido por " + UI.fmtLShort(-est.restante)
      : "Quedan " + UI.fmtLShort(est.restante) + " para gastar este mes";
  }

  // ============ Resumen ============
  function renderResumen() {
    const period = UI.state.filters.period;
    const filtered = UI.filterByPeriod(window.Store.transacciones, period);
    const ingresos = filtered.filter(t => t.tipo === TIPO_INGRESO).reduce((a, t) => a + Number(t.monto), 0);
    const egresos = filtered.filter(t => t.tipo === TIPO_EGRESO).reduce((a, t) => a + Number(t.monto), 0);
    const balance = ingresos - egresos;
    const profit = ingresos > 0 ? ((ingresos - egresos) / ingresos) * 100 : 0;

    // la tarjeta kpi-primary es verde con texto blanco (no colorear aquí)
    const cashEl = document.getElementById("kpi-cash");
    cashEl.textContent = (balance >= 0 ? "+" : "−") + UI.fmtL(Math.abs(balance));
    document.getElementById("kpi-income").textContent = UI.fmtL(ingresos);
    document.getElementById("kpi-expense").textContent = UI.fmtL(egresos);

    const profitEl = document.getElementById("kpi-profit");
    profitEl.textContent = (profit >= 0 ? "+" : "") + profit.toFixed(1) + "%";
    profitEl.style.color = profit >= 0 ? "var(--color-income)" : "var(--color-expense)";
    document.getElementById("kpi-profit-sub").textContent =
      profit >= 0 ? "beneficio del período" : "pérdida del período";

    window.Charts.renderAll(filtered, window.Store.transacciones);
  }

  document.getElementById("filter-period").addEventListener("change", (e) => {
    UI.state.filters.period = e.target.value;
    renderResumen();
  });

  // ============ Movimientos (lista unificada) ============
  function renderMovimientos() {
    const list = document.getElementById("list-movimientos");
    const filter = UI.state.filters.tx;
    let items = window.Store.transacciones;
    if (filter !== "all") items = items.filter(t => t.tipo === filter);

    list.innerHTML = "";
    if (items.length === 0) {
      list.innerHTML = `<li class="empty">Aún no hay movimientos registrados.</li>`;
    } else {
      items.forEach(t => list.appendChild(renderTxItem(t)));
    }

    const totalEl = document.getElementById("movs-total");
    const labelEl = document.getElementById("movs-total-label");
    if (filter === "all") {
      const neto = items.reduce((a, t) => a + (t.tipo === TIPO_INGRESO ? 1 : -1) * Number(t.monto), 0);
      labelEl.textContent = "Neto mostrado";
      totalEl.textContent = (neto >= 0 ? "+" : "−") + UI.fmtL(Math.abs(neto));
      totalEl.style.color = neto >= 0 ? "var(--color-income)" : "var(--color-expense)";
    } else {
      labelEl.textContent = filter === TIPO_INGRESO ? "Total ingresos" : "Total egresos";
      const total = items.reduce((a, t) => a + Number(t.monto), 0);
      totalEl.textContent = UI.fmtL(total);
      totalEl.style.color = "";
    }
  }

  function renderTxItem(t) {
    const legacy = t.persona === "hector" ? "Héctor · " : t.persona === "sonia" ? "Sonia · " : "";
    const titulo = t.tipo === TIPO_INGRESO
      ? (t.descripcion || (t.categoria ? t.categoria : "Salario"))
      : (t.categoria || "Sin categoría");
    const subt = `${legacy}${UI.bancoLabel(t.cuenta)} · ${UI.fmtShortDate(t.fecha)}`;
    const li = document.createElement("li");
    li.className = "tx-item";
    li.dataset.id = t.id;
    li.innerHTML = `
      <div class="tx-icon ${t.tipo}">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4">
          ${t.tipo === TIPO_INGRESO
            ? '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>'
            : '<path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/>'}
        </svg>
      </div>
      <div class="tx-main">
        <span class="tx-title">${escapeHtml(titulo)}${t.descripcion && t.categoria && t.tipo === TIPO_EGRESO ? ` <span class="muted small">— ${escapeHtml(t.descripcion)}</span>` : ""}</span>
        <span class="tx-meta">${escapeHtml(subt)}</span>
      </div>
      <div class="tx-amount ${t.tipo}">
        ${t.tipo === TIPO_INGRESO ? "+" : "−"}${UI.fmtL(t.monto)}
        ${t.moneda === "USD" ? `<div class="muted small">$${Number(t.montoOriginal).toFixed(2)}</div>` : ""}
      </div>
    `;
    li.addEventListener("click", () => promptDeleteTx(t));
    return li;
  }

  document.querySelectorAll("[data-tx-filter]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-tx-filter]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      UI.state.filters.tx = btn.dataset.txFilter;
      renderMovimientos();
    });
  });

  function promptDeleteTx(t) {
    UI.confirmModal(
      "Eliminar registro",
      `¿Eliminar este ${t.tipo} de ${UI.fmtL(t.monto)}? Desaparecerá del historial y de los totales.`,
      async () => {
        try {
          await window.Store.deleteTransaccion(t.id);
          UI.toast("Registro eliminado", "success");
        } catch (e) { UI.toast("Error: " + e.message, "error"); }
      }
    );
  }

  // ============ Captura rápida ============
  document.getElementById("btn-quick-ingreso").addEventListener("click", () => openQuick(TIPO_INGRESO));
  document.getElementById("btn-quick-egreso").addEventListener("click", () => openQuick(TIPO_EGRESO));

  function openQuick(tipo) {
    quick.tipo = tipo;
    quick.otra = false;
    const form = document.getElementById("form-quick");
    form.reset();
    document.getElementById("q-tipo").value = tipo;
    document.getElementById("quick-title").textContent = tipo === TIPO_INGRESO ? "Nuevo ingreso" : "Nuevo egreso";
    document.getElementById("q-mon-hnl").checked = true;
    document.getElementById("q-simbolo").textContent = "L";
    document.getElementById("q-conversion").classList.add("hidden");
    document.getElementById("q-otra-block").classList.add("hidden");
    document.getElementById("q-nueva-label").classList.add("hidden");
    document.getElementById("q-detalles").removeAttribute("open");
    document.getElementById("q-fecha").value = new Date().toISOString().slice(0, 10);

    // método por defecto: el último usado en este teléfono
    const metodo = localStorage.getItem(LS_METODO);
    if (metodo) document.getElementById("q-metodo").value = metodo;

    populateQuickBancos();
    buildChips();
    UI.openModal("modal-quick");
    setTimeout(() => document.getElementById("q-monto").focus(), 120);
  }

  function populateQuickBancos() {
    const sel = document.getElementById("q-cuenta");
    sel.innerHTML = BANCOS
      .map(b => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`)
      .join("");
    const last = localStorage.getItem(LS_CUENTA);
    sel.value = BANCOS.includes(last) ? last : "Efectivo";
  }

  function topCategoriasEgreso() {
    const since = Date.now() - 90 * 86400000;
    const freq = {};
    window.Store.transacciones.forEach(t => {
      if (t.tipo !== TIPO_EGRESO || !t.categoria) return;
      const f = t.fecha?.toDate?.() || new Date(t.fecha);
      if (f.getTime() < since) return;
      freq[t.categoria] = (freq[t.categoria] || 0) + 1;
    });
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).map(e => e[0]);
    if (top.length < 6) {
      for (const c of window.Store.categorias.map(c => c.nombre)) {
        if (top.length >= 6) break;
        if (!top.includes(c) && c !== "Otros") top.push(c);
      }
    }
    return top.slice(0, 6);
  }

  function buildChips() {
    const cont = document.getElementById("q-chips");
    const label = document.getElementById("q-chips-label");
    cont.innerHTML = "";
    quick.cat = null;

    const addChip = (text, value, onSelect) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = text;
      b.dataset.value = value;
      b.addEventListener("click", () => {
        cont.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
        b.classList.add("active");
        onSelect(value);
      });
      cont.appendChild(b);
      return b;
    };

    if (quick.tipo === TIPO_INGRESO) {
      label.textContent = "Tipo de ingreso";
      const last = localStorage.getItem(LS_CAT_INGRESO) || "Salario";
      const sal = addChip("Salario", "Salario", v => { quick.cat = v; quick.otra = false; });
      const otr = addChip("Otros", "Otros", v => {
        quick.cat = v; quick.otra = false;
        // "Otros" pide una pequeña descripción de qué ingreso es
        document.getElementById("q-detalles").setAttribute("open", "");
        document.getElementById("q-descripcion").focus();
      });
      (last === "Otros" ? otr : sal).classList.add("active");
      quick.cat = last === "Otros" ? "Otros" : "Salario";
      document.getElementById("q-otra-block").classList.add("hidden");
    } else {
      label.textContent = "Categoría";
      const top = topCategoriasEgreso();
      const last = localStorage.getItem(LS_CAT_EGRESO);
      top.forEach(cat => {
        const chip = addChip(cat, cat, v => {
          quick.cat = v; quick.otra = false;
          document.getElementById("q-otra-block").classList.add("hidden");
        });
        if (cat === last) { chip.classList.add("active"); quick.cat = cat; }
      });
      addChip("Otra…", "__otra", () => {
        quick.otra = true; quick.cat = null;
        populateQCategoriaFull();
        document.getElementById("q-otra-block").classList.remove("hidden");
      });
    }
  }

  function populateQCategoriaFull() {
    const sel = document.getElementById("q-categoria");
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

  document.getElementById("q-categoria").addEventListener("change", (e) => {
    document.getElementById("q-nueva-label").classList.toggle("hidden", e.target.value !== "Otros");
  });

  // Conversión en vivo
  function updateConversionPreview() {
    const monto = parseMonto();
    const moneda = document.querySelector("input[name='q-moneda']:checked")?.value || "HNL";
    document.getElementById("q-simbolo").textContent = moneda === "USD" ? "$" : "L";
    const el = document.getElementById("q-conversion");
    if (moneda === "USD" && monto > 0) {
      const tasa = window.Exchange.current.rate;
      el.textContent = `≈ ${UI.fmtL(monto * tasa)} (tasa: ${Number(tasa).toFixed(4)})`;
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  }
  document.getElementById("q-monto").addEventListener("input", updateConversionPreview);
  document.querySelectorAll("input[name='q-moneda']").forEach(r => r.addEventListener("change", updateConversionPreview));

  function parseMonto() {
    const raw = document.getElementById("q-monto").value
      .replace(/,/g, ".")
      .replace(/[^0-9.]/g, "");
    return parseFloat(raw) || 0;
  }

  document.getElementById("form-quick").addEventListener("submit", async (e) => {
    e.preventDefault();
    const tipo = document.getElementById("q-tipo").value;
    const monto = parseMonto();
    const moneda = document.querySelector("input[name='q-moneda']:checked")?.value || "HNL";
    const descripcion = document.getElementById("q-descripcion").value.trim();
    const metodoPago = document.getElementById("q-metodo").value;
    const cuenta = document.getElementById("q-cuenta").value;
    const fechaStr = document.getElementById("q-fecha").value;

    if (!monto || monto <= 0) { UI.toast("Escribe el monto", "error"); return; }

    let categoria = quick.cat;
    if (tipo === TIPO_EGRESO) {
      if (quick.otra) {
        categoria = document.getElementById("q-categoria").value || "";
        if (categoria === "Otros") {
          const nueva = document.getElementById("q-categoria-nueva").value.trim();
          if (nueva) {
            try { await window.Store.addCategoria(nueva, "Otros"); categoria = nueva; }
            catch (err) { console.warn(err); }
          }
        }
      }
      if (!categoria) categoria = "Sin categoría";
    } else {
      categoria = categoria || "Salario";
      if (categoria === "Otros" && !descripcion) {
        document.getElementById("q-detalles").setAttribute("open", "");
        UI.toast("Describe de qué es el ingreso", "error");
        return;
      }
    }

    const fecha = fechaStr ? new Date(fechaStr + "T12:00:00") : new Date();

    try {
      const txId = await window.Store.addTransaccion({
        tipo, persona: "hs", monto, moneda,
        categoria, descripcion, metodoPago, cuenta, fecha
      });

      // aviso por correo si supera el umbral (no bloquea el guardado)
      const tasaNow = window.Exchange.current.rate;
      window.Notify.maybeSend({
        tipo,
        monto: moneda === "USD" ? monto * tasaNow : monto,
        moneda,
        montoOriginal: monto,
        categoria, descripcion, metodoPago, cuenta, fecha
      });

      // alarmas de presupuesto mensual (solo en el teléfono que crea el egreso)
      if (tipo === TIPO_EGRESO) {
        window.Presupuesto.onEgresoCreado({
          id: txId,
          montoHNL: moneda === "USD" ? monto * tasaNow : monto,
          fecha, categoria, cuenta
        });
      }

      // recordar preferencias de este teléfono
      localStorage.setItem(LS_CUENTA, cuenta);
      localStorage.setItem(LS_METODO, metodoPago);
      if (tipo === TIPO_EGRESO && categoria !== "Sin categoría") localStorage.setItem(LS_CAT_EGRESO, categoria);
      if (tipo === TIPO_INGRESO) localStorage.setItem(LS_CAT_INGRESO, quick.cat || "Salario");

      UI.closeModal("modal-quick");
      UI.toast(tipo === TIPO_INGRESO ? "Ingreso registrado ✓" : "Egreso registrado ✓", "success");
    } catch (err) {
      UI.toast("Error: " + err.message, "error");
    }
  });

  // ============ Dictado por voz ============
  function initVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const micMonto = document.getElementById("q-mic");
    const micDesc = document.getElementById("q-mic-desc");
    if (!SR) {
      micMonto.classList.add("hidden");
      micDesc.classList.add("hidden");
      return;
    }
    let activo = null;

    function dictate(btn, onText) {
      if (activo) { try { activo.abort(); } catch (_) {} activo = null; return; }
      const rec = new SR();
      rec.lang = "es-HN";
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      activo = rec;
      btn.classList.add("listening");
      rec.onresult = (ev) => {
        const transcript = ev.results?.[0]?.[0]?.transcript || "";
        if (transcript) onText(transcript);
      };
      rec.onerror = (ev) => {
        if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
          UI.toast("Permiso de micrófono denegado", "error");
        } else if (ev.error !== "aborted" && ev.error !== "no-speech") {
          UI.toast("No se pudo escuchar, intenta de nuevo", "error");
        }
      };
      rec.onend = () => {
        btn.classList.remove("listening");
        activo = null;
      };
      try { rec.start(); } catch (_) { btn.classList.remove("listening"); activo = null; }
    }

    micMonto.addEventListener("click", () => dictate(micMonto, (texto) => {
      const t = texto.toLowerCase();
      // moneda dictada: "veinte dólares" → USD; "lempiras" → HNL
      if (/d[oó]lar|usd/.test(t)) {
        document.getElementById("q-mon-usd").checked = true;
      } else if (/lempira/.test(t)) {
        document.getElementById("q-mon-hnl").checked = true;
      }
      // el STT normaliza los números en español a dígitos ("trescientos" → 300)
      const m = t.replace(/,/g, ".").match(/(\d+(?:\.\d+)?)/);
      if (m) {
        document.getElementById("q-monto").value = m[1];
        updateConversionPreview();
      } else {
        UI.toast(`No entendí el monto ("${texto}")`, "error");
      }
    }));

    micDesc.addEventListener("click", () => dictate(micDesc, (texto) => {
      const input = document.getElementById("q-descripcion");
      input.value = (input.value + " " + texto).trim();
    }));
  }

  // ============ Notificaciones por correo (en Ajustes) ============
  function renderNotifAjustes() {
    const badge = document.getElementById("notif-estado");
    if (!badge || !window.Notify) return;
    const est = window.Notify.estado();
    badge.textContent = est.configurado ? "✓ Activas" : "Sin configurar";
    badge.className = "notif-badge " + (est.configurado ? "ok" : "off");

    const umbral = document.getElementById("notif-umbral");
    if (umbral && document.activeElement !== umbral) umbral.value = est.umbral;
    const url = document.getElementById("notif-url");
    if (url && document.activeElement !== url) url.value = est.url || "";

    const presu = document.getElementById("presu-mensual");
    if (presu && window.Presupuesto && document.activeElement !== presu) {
      presu.value = window.Presupuesto.mensual || "";
    }
  }

  document.getElementById("btn-notif-save").addEventListener("click", async () => {
    const umbral = parseFloat(document.getElementById("notif-umbral").value);
    const url = document.getElementById("notif-url").value.trim();
    const clave = document.getElementById("notif-clave").value.trim();
    if (!umbral || umbral <= 0) { UI.toast("Umbral inválido", "error"); return; }
    if (url && !/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) {
      UI.toast("La URL debe ser la del script de Google (termina en /exec)", "error");
      return;
    }
    const presuRaw = document.getElementById("presu-mensual").value.trim();
    const presu = presuRaw === "" ? 0 : parseFloat(presuRaw);
    if (isNaN(presu) || presu < 0) { UI.toast("Presupuesto inválido", "error"); return; }
    try {
      await window.Notify.saveConfig({ umbral, url, clave });
      await window.Presupuesto.saveConfig(presu);
      document.getElementById("notif-clave").value = "";
      renderNotifAjustes();
      renderPresupuesto();
      UI.toast("Notificaciones guardadas ✓", "success");
    } catch (e) { UI.toast("Error: " + e.message, "error"); }
  });

  // ============ Tema ============
  function initThemeControls() {
    const mode = UI.getThemeMode();
    const radio = document.querySelector(`input[name='tema'][value='${mode}']`);
    if (radio) radio.checked = true;
    document.querySelectorAll("input[name='tema']").forEach(r => {
      r.addEventListener("change", () => UI.applyTheme(r.value));
    });
    window.addEventListener("theme:changed", () => {
      syncThemeMeta();
      // los charts leen los colores del CSS al renderizar
      if (!document.getElementById("app").classList.contains("hidden")) renderResumen();
    });
  }

  function syncThemeMeta() {
    const meta = document.getElementById("meta-theme");
    if (meta) meta.setAttribute("content", UI.isDarkNow() ? "#0b1310" : "#f6f8f7");
  }

  // ============ Contraseña ============
  document.getElementById("form-password").addEventListener("submit", (e) => {
    e.preventDefault();
    const actual = document.getElementById("pw-actual").value;
    const nueva = document.getElementById("pw-nueva").value;
    const confirma = document.getElementById("pw-confirma").value;
    if (nueva !== confirma) { UI.toast("La confirmación no coincide", "error"); return; }
    UI.confirmModal(
      "Cambiar contraseña",
      "El otro teléfono se desconectará dentro de ~1 hora y deberá entrar con la nueva contraseña. ¿Continuar?",
      async () => {
        try {
          await window.FBase.changePassword(actual, nueva);
          document.getElementById("form-password").reset();
          UI.toast("Contraseña actualizada ✓", "success");
        } catch (err) {
          UI.toast(err.message, "error");
        }
      }
    );
  });

  // ============ Configuración: tasa ============
  function renderTasaConfig() {
    const cur = window.Exchange.current;
    const input = document.getElementById("tasa-input");
    if (document.activeElement !== input) input.value = Number(cur.rate).toFixed(4);
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

  // ============ Respaldo ============
  document.getElementById("btn-export").addEventListener("click", async () => {
    const data = await window.Store.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `finanzas-hs-${new Date().toISOString().slice(0, 10)}.json`;
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
      teardown();
      await window.FBase.signOutShared();
      // onAuthChange muestra el login
    });
  });

  // ============ UI bindings ============
  function bindStaticUI() {
    document.querySelectorAll(".nav-btn").forEach(btn => {
      btn.addEventListener("click", () => UI.showView(btn.dataset.view));
    });
    document.querySelectorAll("[data-close-modal]").forEach(el => {
      el.addEventListener("click", () => UI.closeAllModals());
    });
    document.getElementById("chip-balance").addEventListener("click", () => UI.showView("resumen"));
    document.getElementById("budget-bar").addEventListener("click", () => {
      const est = window.Presupuesto.estado();
      UI.toast(`Gastado ${UI.fmtL(est.gastado)} de ${UI.fmtL(est.presupuesto)} este mes`);
    });
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

  // ============ Service worker + aviso de actualización ============
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    const banner = document.getElementById("update-banner");
    banner.addEventListener("click", () => location.reload());

    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").then(reg => {
        reg.addEventListener("updatefound", () => {
          const nuevo = reg.installing;
          if (!nuevo) return;
          nuevo.addEventListener("statechange", () => {
            if (nuevo.state === "installed" && navigator.serviceWorker.controller) {
              banner.classList.remove("hidden");
            }
          });
        });
        // iOS mantiene la PWA viva por días: buscar actualización al volver
        document.addEventListener("visibilitychange", () => {
          if (!document.hidden) reg.update().catch(() => {});
        });
      }).catch(err => console.warn("SW reg failed:", err));
    });
  }

  // ============ Helpers ============
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[m]);
  }

})();
