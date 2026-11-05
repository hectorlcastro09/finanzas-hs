/* =============================================================
   app.js — Bootstrap principal y wiring (v3)
   - Boot con onAuthStateChanged (la sesión restaura sin red)
   - Inicio: fotos de la familia, resumen del mes, captura rápida
     y últimos movimientos
   - Captura rápida unificada (persona: "hs"); la misma hoja sirve
     para editar un movimiento y para confirmar un pendiente del banco
   - Dictado por voz (Web Speech API, es-HN)
   ============================================================= */

(function () {

  const TIPO_INGRESO = "ingreso";
  const TIPO_EGRESO = "egreso";
  const LS_CUENTA = "hs_last_cuenta";
  const LS_METODO = "hs_last_metodo";
  const LS_CAT_EGRESO = "hs_last_cat_egreso";
  const LS_CAT_INGRESO = "hs_last_cat_ingreso";
  const PASO_LISTA = 150;                 // movimientos que se pintan por tanda

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
  let limiteMovs = PASO_LISTA;
  // modo: "nuevo" | "editar" | "pendiente" (confirmar un débito leído del correo)
  const quick = {
    tipo: TIPO_EGRESO, cat: null, otra: false,
    modo: "nuevo", tx: null, pendiente: null,
    guardando: false, dupConfirmado: false,
    coincide: null      // respuesta a «¿Es el mismo movimiento?»: id del pendiente | "no"
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => UI.escapeHtml(s);
  function setText(id, txt) { const el = $(id); if (el) el.textContent = txt; }

  // ============ Boot ============
  document.addEventListener("DOMContentLoaded", () => {
    UI.initTheme();
    syncThemeMeta();
    initThemeControls();
    UI.initConfirm();
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
      $("splash").classList.add("hidden");
      if (user) {
        $("view-login").classList.remove("active");
        if (!authBooted) {
          authBooted = true;
          await onAuthed();
        }
      } else {
        authBooted = false;
        teardown();
        $("app").classList.add("hidden");
        $("view-login").classList.add("active");
      }
    });
  });

  // ============ Login ============
  $("form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = $("login-password").value;
    const remember = $("remember-device").checked;
    const errEl = $("login-error");
    errEl.classList.add("hidden");
    try {
      await window.FBase.signInShared(pw, remember);
      $("login-password").value = "";
      // onAuthChange se encarga del resto
    } catch (err) {
      errEl.textContent = err.message || "No se pudo iniciar sesión";
      errEl.classList.remove("hidden");
    }
  });

  $("toggle-pw").addEventListener("click", () => {
    const input = $("login-password");
    input.type = input.type === "password" ? "text" : "password";
  });

  // ============ Tras autenticarse ============
  async function onAuthed() {
    $("app").classList.remove("hidden");
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
    // las fotos cargan después del primer render (no bloquean nada)
    setTimeout(() => window.Fondos.start(), 300);
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
    renderInicio();
    renderMovimientos();
    renderNotifAjustes();
    renderTasaConfig();
    window.Auto.renderBanner();
    window.Auto.renderEstadoAjustes();
    // los gráficos solo se dibujan si Resumen está a la vista
    if (UI.currentView === "resumen") renderResumen();
    if (!$("modal-pendientes").classList.contains("hidden")) window.Auto.renderPendientes();
  }

  window.addEventListener("view:changed", (e) => {
    if (e.detail === "resumen") renderResumen();
    if (e.detail === "inicio") renderInicio();
  });

  // ============ Chip de balance (mes + año) ============
  function totalesMes(fechaRef) {
    let ingresos = 0, egresos = 0;
    window.Store.transacciones.forEach(t => {
      const f = UI.txDate(t);
      if (f.getFullYear() !== fechaRef.getFullYear() || f.getMonth() !== fechaRef.getMonth()) return;
      if (t.tipo === TIPO_INGRESO) ingresos += Number(t.monto);
      else egresos += Number(t.monto);
    });
    return { ingresos, egresos, balance: ingresos - egresos };
  }

  function renderChip() {
    const now = new Date();
    let anio = 0;
    window.Store.transacciones.forEach(t => {
      const f = UI.txDate(t);
      if (f.getFullYear() !== now.getFullYear()) return;
      anio += (t.tipo === TIPO_INGRESO ? 1 : -1) * Number(t.monto);
    });
    const mes = totalesMes(now).balance;
    const mesEl = $("chip-mes");
    const mesLbl = now.toLocaleDateString("es-HN", { month: "short" }).replace(".", "");
    mesEl.textContent = `${mesLbl} ${UI.fmtSigned(mes)}`;
    mesEl.classList.toggle("pos", mes >= 0);
    mesEl.classList.toggle("neg", mes < 0);
    $("chip-anio").textContent = `${now.getFullYear()} ${UI.fmtSigned(anio)}`;
  }

  // ============ Banda de presupuesto (segunda fila del header) ============
  function renderPresupuesto() {
    const bar = $("budget-bar");
    if (!bar || !window.Presupuesto) return;
    const est = window.Presupuesto.estado();
    const visible = est.activo && est.restante <= est.maxUmbral;
    bar.classList.toggle("hidden", !visible);
    if (!visible) return;
    const cincoPct = est.presupuesto * 0.05;
    bar.classList.toggle("warn", est.restante > cincoPct);
    bar.classList.toggle("danger", est.restante <= cincoPct && est.restante >= 0);
    bar.classList.toggle("over", est.restante < 0);
    bar.textContent = est.restante < 0
      ? "Presupuesto excedido por " + UI.fmtLShort(-est.restante)
      : "Quedan " + UI.fmtLShort(est.restante) + " para gastar este mes";
  }

  // ============ Inicio ============
  function renderInicio() {
    const ahora = new Date();
    setText("hero-saludo", UI.saludo(ahora));
    setText("hero-fecha", ahora.toLocaleDateString("es-HN", { weekday: "long", day: "numeric", month: "long" }));

    const t = totalesMes(ahora);
    setText("ms-mes", ahora.toLocaleDateString("es-HN", { month: "long" }));
    setText("ms-ing", UI.fmtLShort(t.ingresos));
    setText("ms-egr", UI.fmtLShort(t.egresos));
    const bal = $("ms-bal");
    bal.textContent = UI.fmtSigned(t.balance);
    bal.classList.toggle("neg", t.balance < 0);
    bal.classList.toggle("pos", t.balance >= 0);

    // los 4 registrados más recientemente (no por fecha del gasto)
    const orden = (x) => x.creadoEn?.toMillis?.() ?? Date.now();
    const recientes = [...window.Store.transacciones].sort((a, b) => orden(b) - orden(a)).slice(0, 4);
    const ul = $("list-recientes");
    ul.innerHTML = "";
    if (recientes.length === 0) {
      ul.innerHTML = `<li class="empty">Aún no hay movimientos.</li>`;
    } else {
      recientes.forEach(tx => ul.appendChild(renderTxItem(tx)));
    }
  }

  // ============ Resumen ============
  function renderResumen() {
    const period = UI.state.filters.period;
    const filtered = UI.filterByPeriod(window.Store.transacciones, period);
    const ingresos = filtered.filter(t => t.tipo === TIPO_INGRESO).reduce((a, t) => a + Number(t.monto), 0);
    const egresos = filtered.filter(t => t.tipo === TIPO_EGRESO).reduce((a, t) => a + Number(t.monto), 0);
    const balance = ingresos - egresos;

    // la tarjeta kpi-primary es verde con texto blanco (no colorear aquí)
    $("kpi-cash").textContent = (balance >= 0 ? "+" : "−") + UI.fmtL(Math.abs(balance));
    $("kpi-income").textContent = UI.fmtL(ingresos);
    $("kpi-expense").textContent = UI.fmtL(egresos);

    const profitEl = $("kpi-profit");
    if (ingresos > 0) {
      const profit = (balance / ingresos) * 100;
      profitEl.textContent = (profit >= 0 ? "+" : "") + profit.toFixed(1) + "%";
      profitEl.style.color = profit >= 0 ? "var(--color-income)" : "var(--color-expense)";
      $("kpi-profit-sub").textContent = profit >= 0 ? "ahorro del período" : "pérdida del período";
    } else {
      // sin ingresos no hay porcentaje que calcular (antes mostraba +0.0 %)
      profitEl.textContent = "—";
      profitEl.style.color = "";
      $("kpi-profit-sub").textContent = "sin ingresos en el período";
    }

    window.Charts.renderAll(filtered, window.Store.transacciones);
  }

  $("filter-period").addEventListener("change", (e) => {
    UI.state.filters.period = e.target.value;
    renderResumen();
  });

  // ============ Movimientos (lista agrupada por día) ============
  function renderMovimientos() {
    const list = $("list-movimientos");
    const filter = UI.state.filters.tx;
    let items = window.Store.transacciones;
    if (filter === TIPO_INGRESO || filter === TIPO_EGRESO) items = items.filter(t => t.tipo === filter);
    else if (filter === "auto") items = items.filter(t => window.Auto.esAuto(t));

    list.innerHTML = "";
    if (items.length === 0) {
      list.innerHTML = `<li class="empty">${filter === "auto"
        ? "Aún no hay movimientos que hayan entrado solos desde los correos del banco."
        : "Aún no hay movimientos registrados."}</li>`;
    } else {
      const frag = document.createDocumentFragment();
      const netoDia = {};
      items.forEach(t => {
        const k = UI.fechaLocalISO(UI.txDate(t));
        netoDia[k] = (netoDia[k] || 0) + (t.tipo === TIPO_INGRESO ? 1 : -1) * Number(t.monto);
      });
      let diaActual = null;
      items.slice(0, limiteMovs).forEach(t => {
        const f = UI.txDate(t);
        const k = UI.fechaLocalISO(f);
        if (k !== diaActual) {
          diaActual = k;
          const li = document.createElement("li");
          li.className = "day-head";
          const neto = netoDia[k];
          li.innerHTML = `<span>${esc(UI.fmtDia(f))}</span><span class="day-total ${neto < 0 ? "neg" : "pos"}">${esc(UI.fmtSigned(neto))}</span>`;
          frag.appendChild(li);
        }
        frag.appendChild(renderTxItem(t));
      });
      if (items.length > limiteMovs) {
        const mas = document.createElement("li");
        mas.className = "mas";
        mas.innerHTML = `<button type="button" class="btn btn-outline btn-block">Ver ${Math.min(PASO_LISTA, items.length - limiteMovs)} anteriores</button>`;
        mas.querySelector("button").addEventListener("click", () => { limiteMovs += PASO_LISTA; renderMovimientos(); });
        frag.appendChild(mas);
      }
      list.appendChild(frag);
    }

    const totalEl = $("movs-total");
    const labelEl = $("movs-total-label");
    if (filter === "all" || filter === "auto") {
      const neto = items.reduce((a, t) => a + (t.tipo === TIPO_INGRESO ? 1 : -1) * Number(t.monto), 0);
      labelEl.textContent = filter === "auto" ? "Neto automático" : "Neto mostrado";
      totalEl.textContent = (neto >= 0 ? "+" : "−") + UI.fmtL(Math.abs(neto));
      totalEl.style.color = neto >= 0 ? "var(--color-income)" : "var(--color-expense)";
    } else {
      labelEl.textContent = filter === TIPO_INGRESO ? "Total ingresos" : "Total egresos";
      totalEl.textContent = UI.fmtL(items.reduce((a, t) => a + Number(t.monto), 0));
      totalEl.style.color = "";
    }
    setText("movs-count", `${items.length} movimiento${items.length === 1 ? "" : "s"}`);
  }

  function renderTxItem(t) {
    const legacy = t.persona === "hector" ? "Héctor · " : t.persona === "sonia" ? "Sonia · " : "";
    const esIngreso = t.tipo === TIPO_INGRESO;
    const auto = window.Auto.esAuto(t);
    const sinClasificar = auto && !esIngreso && (!t.categoria || t.categoria === "Sin categoría");
    // una compra automática sin categoría se reconoce mejor por su comercio
    const titulo = esIngreso
      ? (t.descripcion || t.categoria || "Salario")
      : sinClasificar ? (t.comercio || t.descripcion || "Compra con tarjeta")
      : (t.categoria || "Sin categoría");
    const detalle = !esIngreso && !sinClasificar && t.descripcion ? t.descripcion : "";
    const meta = `${legacy}${UI.bancoLabel(t.cuenta)} · ${UI.fmtShortDate(t.fecha)}`;

    const li = document.createElement("li");
    li.className = "tx-item" + (sinClasificar ? " revisar" : "");
    li.dataset.id = t.id;
    li.innerHTML = `
      <div class="tx-icon ${t.tipo}" aria-hidden="true">${UI.iconoCategoria(t.categoria, t.tipo)}</div>
      <div class="tx-main">
        <span class="tx-title">${esc(titulo)}${detalle ? ` <span class="tx-desc">· ${esc(detalle)}</span>` : ""}</span>
        <span class="tx-meta">${auto ? '<span class="badge badge-auto" title="Entró solo desde el correo del banco">⚡ Auto</span>' : ""}${sinClasificar ? '<span class="badge badge-revisar">Por clasificar</span>' : ""}${esc(meta)}</span>
      </div>
      <div class="tx-amount ${t.tipo}">
        ${esIngreso ? "+" : "−"}${UI.fmtL(t.monto)}
        ${t.moneda === "USD" ? `<div class="tx-usd">$${Number(t.montoOriginal).toFixed(2)}</div>` : ""}
      </div>
    `;
    li.addEventListener("click", () => openQuick(t.tipo, { tx: t }));
    return li;
  }

  document.querySelectorAll("[data-tx-filter]").forEach(btn => {
    btn.addEventListener("click", () => setFiltroMovs(btn.dataset.txFilter));
  });

  function setFiltroMovs(filtro) {
    document.querySelectorAll("[data-tx-filter]").forEach(b => b.classList.toggle("active", b.dataset.txFilter === filtro));
    UI.state.filters.tx = filtro;
    limiteMovs = PASO_LISTA;
    renderMovimientos();
  }

  // ============ Captura rápida / edición / confirmar pendiente ============
  $("btn-quick-ingreso").addEventListener("click", () => openQuick(TIPO_INGRESO));
  $("btn-quick-egreso").addEventListener("click", () => openQuick(TIPO_EGRESO));

  function openQuick(tipo, opciones = {}) {
    const tx = opciones.tx || null;
    const pend = opciones.pendiente || null;
    Object.assign(quick, {
      tipo, otra: false, cat: null, tx, pendiente: pend,
      modo: tx ? "editar" : pend ? "pendiente" : "nuevo",
      guardando: false, dupConfirmado: false, coincide: null
    });

    $("form-quick").reset();
    $("q-tipo").value = tipo;
    const nombre = tipo === TIPO_INGRESO ? "ingreso" : "egreso";
    $("quick-title").textContent = quick.modo === "editar" ? `Editar ${nombre}`
      : quick.modo === "pendiente" ? "Confirmar egreso" : `Nuevo ${nombre}`;
    $("modal-quick").dataset.tipo = tipo;

    const base = tx || pend;
    const moneda = base?.moneda === "USD" ? "USD" : "HNL";
    $(moneda === "USD" ? "q-mon-usd" : "q-mon-hnl").checked = true;
    $("q-monto").value = base ? String(Number(base.montoOriginal ?? base.monto)) : "";
    $("q-otra-block").classList.add("hidden");
    $("q-nueva-label").classList.add("hidden");
    $("q-fecha").value = base ? UI.fechaLocalISO(UI.txDate(base)) : UI.fechaLocalISO();
    $("q-descripcion").value = tx ? (tx.descripcion || "") : pend ? (pend.comercio || pend.detalle || "") : "";

    // método por defecto: el último usado en este teléfono
    const metodo = tx ? tx.metodoPago
      : pend ? (pend.tarjeta ? "tarjeta_credito" : "transferencia")
      : localStorage.getItem(LS_METODO);
    if (metodo) $("q-metodo").value = metodo;

    populateQuickBancos(tx ? UI.bancoLabel(tx.cuenta) : pend ? pend.cuenta : null);
    buildChips(tx ? tx.categoria : pend ? (pend.categoriaSugerida || null) : null);
    updateConversionPreview();

    // de dónde vino (correo del banco)
    const origen = $("q-origen");
    if ((tx && window.Auto.esAuto(tx)) || pend) {
      const desc = window.Auto.describirOrigen(base) || "aviso del banco";
      origen.textContent = `⚡ Entró solo desde el correo: ${desc}`;
      origen.classList.remove("hidden");
    } else {
      origen.classList.add("hidden");
    }

    if (quick.modo === "editar") $("q-detalles").setAttribute("open", "");
    else $("q-detalles").removeAttribute("open");
    $("q-eliminar").classList.toggle("hidden", quick.modo !== "editar");
    $("q-guardar").textContent = quick.modo === "editar" ? "Guardar cambios"
      : quick.modo === "pendiente" ? "Registrar egreso" : "Guardar";
    $("q-guardar").disabled = false;

    UI.openModal("modal-quick");
    if (quick.modo === "nuevo") setTimeout(() => $("q-monto").focus(), 120);
  }

  function populateQuickBancos(seleccion) {
    const sel = $("q-cuenta");
    const opciones = [...BANCOS];
    if (seleccion && !opciones.includes(seleccion)) opciones.push(seleccion);
    sel.innerHTML = opciones.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join("");
    const last = localStorage.getItem(LS_CUENTA);
    sel.value = seleccion || (BANCOS.includes(last) ? last : "Efectivo");
  }

  function topCategoriasEgreso() {
    const since = Date.now() - 90 * 86400000;
    const freq = {};
    window.Store.transacciones.forEach(t => {
      if (t.tipo !== TIPO_EGRESO || !t.categoria || t.categoria === "Sin categoría") return;
      if (UI.txDate(t).getTime() < since) return;
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

  function buildChips(seleccion) {
    const cont = $("q-chips");
    const label = $("q-chips-label");
    cont.innerHTML = "";
    quick.cat = null;

    const addChip = (text, value, onSelect, conIcono) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.innerHTML = (conIcono ? `<span aria-hidden="true">${UI.iconoCategoria(value, quick.tipo)}</span> ` : "") + esc(text);
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
      const last = seleccion || localStorage.getItem(LS_CAT_INGRESO) || "Salario";
      const sal = addChip("Salario", "Salario", v => { quick.cat = v; }, true);
      const otr = addChip("Otros", "Otros", v => {
        quick.cat = v;
        // "Otros" pide una pequeña descripción de qué ingreso es
        $("q-detalles").setAttribute("open", "");
        $("q-descripcion").focus();
      }, true);
      const esOtros = last !== "Salario";
      (esOtros ? otr : sal).classList.add("active");
      quick.cat = esOtros ? (seleccion && seleccion !== "Salario" ? seleccion : "Otros") : "Salario";
      $("q-otra-block").classList.add("hidden");
    } else {
      label.textContent = "Categoría";
      const top = topCategoriasEgreso();
      const elegida = seleccion && seleccion !== "Sin categoría" ? seleccion
        : (quick.modo === "nuevo" ? localStorage.getItem(LS_CAT_EGRESO) : null);
      if (elegida && !top.includes(elegida)) top.unshift(elegida);
      top.forEach(cat => {
        const chip = addChip(cat, cat, v => {
          quick.cat = v; quick.otra = false;
          $("q-otra-block").classList.add("hidden");
        }, true);
        if (cat === elegida) { chip.classList.add("active"); quick.cat = cat; }
      });
      addChip("Otra…", "__otra", () => {
        quick.otra = true; quick.cat = null;
        populateQCategoriaFull();
        $("q-otra-block").classList.remove("hidden");
      });
    }
  }

  function populateQCategoriaFull() {
    const sel = $("q-categoria");
    const grupos = {};
    window.Store.categorias.forEach(c => {
      const g = c.grupo || "Otros";
      (grupos[g] = grupos[g] || []).push(c);
    });
    let html = `<option value="">Selecciona...</option>`;
    Object.entries(grupos).forEach(([grupo, cats]) => {
      cats.sort((a, b) => a.nombre.localeCompare(b.nombre));
      html += `<optgroup label="${esc(grupo)}">`;
      cats.forEach(c => { html += `<option value="${esc(c.nombre)}">${esc(c.nombre)}</option>`; });
      html += `</optgroup>`;
    });
    sel.innerHTML = html;
  }

  $("q-categoria").addEventListener("change", (e) => {
    $("q-nueva-label").classList.toggle("hidden", e.target.value !== "Otros");
  });

  // Conversión en vivo
  function updateConversionPreview() {
    const monto = UI.parseMontoTexto($("q-monto").value);
    const moneda = document.querySelector("input[name='q-moneda']:checked")?.value || "HNL";
    $("q-simbolo").textContent = moneda === "USD" ? "$" : "L";
    const el = $("q-conversion");
    if (moneda === "USD" && monto > 0) {
      const tasa = window.Exchange.current.rate;
      el.textContent = `≈ ${UI.fmtL(monto * tasa)} (tasa: ${Number(tasa).toFixed(4)})`;
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  }
  $("q-monto").addEventListener("input", updateConversionPreview);
  document.querySelectorAll("input[name='q-moneda']").forEach(r => r.addEventListener("change", updateConversionPreview));

  $("form-quick").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (quick.guardando) return;            // doble toque en "Guardar" = un solo registro

    const tipo = $("q-tipo").value;
    const monto = UI.parseMontoTexto($("q-monto").value);
    const moneda = document.querySelector("input[name='q-moneda']:checked")?.value || "HNL";
    const descripcion = $("q-descripcion").value.trim();
    const metodoPago = $("q-metodo").value;
    const cuenta = $("q-cuenta").value;
    const fechaStr = $("q-fecha").value;

    if (!monto || monto <= 0) { UI.toast("Escribe el monto", "error"); return; }

    // Desde aquí un segundo toque ya no hace nada. (Antes la marca se ponía
    // después de esperar a guardar la categoría nueva, y en ese hueco un
    // doble toque registraba dos veces.)
    quick.guardando = true;
    $("q-guardar").disabled = true;
    const soltar = () => { quick.guardando = false; $("q-guardar").disabled = false; };

    let categoria = quick.cat;
    let categoriaNueva = null;
    if (tipo === TIPO_EGRESO) {
      if (quick.otra) {
        categoria = $("q-categoria").value || "";
        if (categoria === "Otros") {
          const nueva = $("q-categoria-nueva").value.trim();
          if (nueva) { categoria = nueva; categoriaNueva = nueva; }
        }
      }
      if (!categoria) categoria = "Sin categoría";
    } else {
      categoria = categoria || "Salario";
      if (categoria === "Otros" && !descripcion) {
        $("q-detalles").setAttribute("open", "");
        UI.toast("Describe de qué es el ingreso", "error");
        soltar();
        return;
      }
    }

    // Fecha: si no se tocó, se conserva la hora original (la de la compra
    // en los automáticos); si se cambió, mediodía del día elegido.
    const base = quick.tx || quick.pendiente;
    let fecha;
    if (base && fechaStr === UI.fechaLocalISO(UI.txDate(base))) fecha = UI.txDate(base);
    else fecha = fechaStr ? new Date(fechaStr + "T12:00:00") : new Date();

    // ¿Ya entró solo desde el correo? (evita anotar dos veces la misma compra)
    if (quick.modo === "nuevo" && !quick.dupConfirmado) {
      const dup = window.Auto.buscarDuplicado({ tipo, monto, moneda, fecha });
      if (dup) {
        soltar();
        const quien = window.Auto.describirOrigen(dup) || "el correo del banco";
        UI.confirmModal(
          "¿Ya está registrado?",
          `Este gasto parece haber entrado solo desde el correo: ${quien}, ${UI.fmtL(dup.monto)} el ${UI.fmtShortDate(dup.fecha)}. ¿Registrarlo de todos modos?`,
          () => { quick.dupConfirmado = true; $("form-quick").requestSubmit(); },
          { okText: "Registrar igual", peligro: false }
        );
        return;
      }
    }

    // ¿Es un movimiento del banco que espera confirmación? Puede ser otro
    // gasto del mismo monto, o de otro banco: se pregunta antes de enlazarlo.
    let coincide = null;
    if (quick.modo === "nuevo" && tipo === TIPO_EGRESO && quick.coincide !== "no") {
      coincide = window.Auto.pendienteQueCoincide({ monto, moneda, fecha, cuenta });
      if (coincide && quick.coincide !== coincide.id) {
        soltar();
        const p = coincide;
        const donde = p.comercio ? ` en ${p.comercio}` : "";
        UI.confirmModal(
          "¿Es el mismo movimiento?",
          `${UI.bancoLabel(p.cuenta)} avisó ${window.Auto.montoPendiente(p)}${donde} el ${UI.fmtShortDate(p.fecha)} y está por confirmar. ¿Es este mismo gasto?`,
          () => { quick.coincide = p.id; $("form-quick").requestSubmit(); },
          {
            okText: "Sí, es el mismo", cancelText: "No, es otro", peligro: false,
            onNo: () => { quick.coincide = "no"; $("form-quick").requestSubmit(); }
          }
        );
        return;
      }
    }

    try {
      if (categoriaNueva) {
        // sin esperar al servidor: sin conexión esa promesa no termina
        // hasta que vuelve la señal, y el movimiento no se guardaba
        window.Store.addCategoria(categoriaNueva, "Otros").catch(err => console.warn("categoría:", err));
      }
      if (quick.modo === "editar") {
        const tx = quick.tx;
        await window.Store.updateTransaccion(tx.id, {
          tipo, monto, moneda, categoria, descripcion, metodoPago, cuenta, fecha
        });
        // aprender: la próxima compra en este comercio ya entra con esta categoría
        if (window.Auto.esAuto(tx) && tx.comercio && tipo === TIPO_EGRESO &&
            categoria !== "Sin categoría" && categoria !== tx.categoria) {
          window.Store.guardarRegla(tx.comercio, categoria).catch(err => console.warn("regla:", err));
        }
        UI.closeModal("modal-quick");
        UI.toast("Cambios guardados ✓", "success");
        return;
      }

      const pend = quick.pendiente;
      // Confirmar un pendiente: el egreso es el del banco. Enlazar lo anotado
      // a mano: se le pasan los datos del aviso, igual que hace el script,
      // para que ese correo no se use después contra otro gasto.
      const extra = pend ? {
        origen: "correo", fuente: pend.fuente, gmailId: pend.gmailId, detalle: pend.detalle,
        comercio: pend.comercio, tarjeta: pend.tarjeta
      } : coincide ? {
        gmailId: coincide.gmailId, vinculadoCorreo: true, fuente: coincide.fuente,
        comercio: coincide.comercio, tarjeta: coincide.tarjeta
      } : {};
      const txId = await window.Store.addTransaccion(
        { tipo, persona: "hs", monto, moneda, categoria, descripcion, metodoPago, cuenta, fecha, ...extra },
        { borrarPendienteId: pend?.id || coincide?.id || null }
      );

      // aviso por correo si supera el umbral (no bloquea el guardado)
      const tasaNow = window.Exchange.current.rate;
      const montoHNL = moneda === "USD" ? monto * tasaNow : monto;
      window.Notify.maybeSend({
        tipo, monto: montoHNL, moneda, montoOriginal: monto,
        categoria, descripcion, metodoPago, cuenta, fecha
      });

      // alarmas de presupuesto mensual (solo en el teléfono que crea el egreso)
      if (tipo === TIPO_EGRESO) {
        window.Presupuesto.onEgresoCreado({ id: txId, montoHNL, fecha, categoria, cuenta });
      }

      // recordar preferencias de este teléfono
      if (quick.modo === "nuevo") {
        localStorage.setItem(LS_CUENTA, cuenta);
        localStorage.setItem(LS_METODO, metodoPago);
        if (tipo === TIPO_EGRESO && categoria !== "Sin categoría") localStorage.setItem(LS_CAT_EGRESO, categoria);
        if (tipo === TIPO_INGRESO) localStorage.setItem(LS_CAT_INGRESO, quick.cat || "Salario");
      }

      UI.closeModal("modal-quick");
      UI.toast(
        (tipo === TIPO_INGRESO ? "Ingreso registrado ✓" : "Egreso registrado ✓") +
        (coincide ? " · enlazado con el aviso del banco" : ""),
        "success"
      );
    } catch (err) {
      UI.toast("Error: " + err.message, "error");
    } finally {
      quick.guardando = false;
      quick.dupConfirmado = false;
      quick.coincide = null;
      $("q-guardar").disabled = false;
    }
  });

  $("q-eliminar").addEventListener("click", () => {
    const tx = quick.tx;
    if (!tx) return;
    const extra = window.Auto.esAuto(tx) ? " Como entró desde el correo del banco, no volverá a entrar solo." : "";
    UI.confirmModal(
      "Eliminar movimiento",
      `¿Eliminar este ${tx.tipo} de ${UI.fmtL(tx.monto)}? Desaparecerá del historial y de los totales.${extra}`,
      async () => {
        try {
          await window.Store.deleteTransaccion(tx.id);
          UI.closeModal("modal-quick");
          UI.toast("Movimiento eliminado", "success");
        } catch (e) { UI.toast("Error: " + e.message, "error"); }
      },
      { okText: "Eliminar" }
    );
  });

  // Desde la hoja de pendientes del banco ("Es gasto →")
  function abrirDesdePendiente(p) {
    openQuick(TIPO_EGRESO, { pendiente: p });
  }

  // ============ Dictado por voz ============
  function initVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const micMonto = $("q-mic");
    const micDesc = $("q-mic-desc");
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
        $("q-mon-usd").checked = true;
      } else if (/lempira/.test(t)) {
        $("q-mon-hnl").checked = true;
      }
      // el STT normaliza los números a dígitos ("mil quinientos" → 1,500)
      const m = t.match(/\d[\d.,]*/);
      const valor = m ? UI.parseMontoTexto(m[0]) : 0;
      if (valor > 0) {
        $("q-monto").value = String(valor);
        updateConversionPreview();
      } else {
        UI.toast(`No entendí el monto ("${texto}")`, "error");
      }
    }));

    micDesc.addEventListener("click", () => dictate(micDesc, (texto) => {
      const input = $("q-descripcion");
      input.value = (input.value + " " + texto).trim();
    }));
  }

  // ============ Notificaciones por correo (en Ajustes) ============
  function renderNotifAjustes() {
    const badge = $("notif-estado");
    if (!badge || !window.Notify) return;
    const est = window.Notify.estado();
    badge.textContent = est.configurado ? "✓ Activas" : "Sin configurar";
    badge.className = "notif-badge " + (est.configurado ? "ok" : "off");

    const umbral = $("notif-umbral");
    if (umbral && document.activeElement !== umbral) umbral.value = est.umbral;
    const url = $("notif-url");
    if (url && document.activeElement !== url) url.value = est.url || "";

    const presu = $("presu-mensual");
    if (presu && window.Presupuesto && document.activeElement !== presu) {
      presu.value = window.Presupuesto.mensual || "";
    }
  }

  $("btn-notif-save").addEventListener("click", async () => {
    const umbral = parseFloat($("notif-umbral").value);
    const url = $("notif-url").value.trim();
    const clave = $("notif-clave").value.trim();
    if (!umbral || umbral <= 0) { UI.toast("Umbral inválido", "error"); return; }
    if (url && !/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) {
      UI.toast("La URL debe ser la del script de Google (termina en /exec)", "error");
      return;
    }
    const presuRaw = $("presu-mensual").value.trim();
    const presu = presuRaw === "" ? 0 : parseFloat(presuRaw);
    if (isNaN(presu) || presu < 0) { UI.toast("Presupuesto inválido", "error"); return; }
    try {
      await window.Notify.saveConfig({ umbral, url, clave });
      await window.Presupuesto.saveConfig(presu);
      $("notif-clave").value = "";
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
      if (!$("app").classList.contains("hidden") && UI.currentView === "resumen") renderResumen();
    });
  }

  function syncThemeMeta() {
    const meta = $("meta-theme");
    if (meta) meta.setAttribute("content", UI.isDarkNow() ? "#0b1310" : "#f4f6f3");
  }

  // ============ Contraseña ============
  $("form-password").addEventListener("submit", (e) => {
    e.preventDefault();
    const actual = $("pw-actual").value;
    const nueva = $("pw-nueva").value;
    const confirma = $("pw-confirma").value;
    if (nueva !== confirma) { UI.toast("La confirmación no coincide", "error"); return; }
    UI.confirmModal(
      "Cambiar contraseña",
      "El otro teléfono se desconectará dentro de ~1 hora y deberá entrar con la nueva contraseña. ¿Continuar?",
      async () => {
        try {
          await window.FBase.changePassword(actual, nueva);
          $("form-password").reset();
          UI.toast("Contraseña actualizada ✓", "success");
        } catch (err) {
          UI.toast(err.message, "error");
        }
      },
      { okText: "Cambiar", peligro: false }
    );
  });

  // ============ Configuración: tasa ============
  function renderTasaConfig() {
    const cur = window.Exchange.current;
    const input = $("tasa-input");
    if (document.activeElement !== input) input.value = Number(cur.rate).toFixed(4);
    $("tasa-fuente").textContent =
      cur.source === "api" ? "API automática" : cur.source === "manual" ? "Manual" : "Por defecto";
    $("tasa-fecha").textContent = cur.date ? UI.fmtDate(cur.date) : "—";
  }

  $("btn-tasa-api").addEventListener("click", async () => {
    const ok = await window.Exchange.refreshFromApi();
    if (ok) { renderTasaConfig(); UI.toast("Tasa actualizada desde API", "success"); }
    else { UI.toast("No se pudo obtener la tasa", "error"); }
  });

  $("btn-tasa-save").addEventListener("click", async () => {
    const rate = parseFloat($("tasa-input").value);
    if (!rate || rate <= 0) { UI.toast("Tasa inválida", "error"); return; }
    try {
      await window.Exchange.setManualRate(rate);
      renderTasaConfig();
      UI.toast("Tasa guardada", "success");
    } catch (e) { UI.toast("Error: " + e.message, "error"); }
  });

  // ============ Respaldo ============
  $("btn-export").addEventListener("click", async () => {
    const data = await window.Store.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `finanzas-hs-${UI.fechaLocalISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    UI.toast("Respaldo exportado", "success");
  });

  $("file-import").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    UI.confirmModal(
      "Importar respaldo",
      "Esto reemplazará TODOS los datos actuales por los del archivo. ¿Continuar?",
      async () => {
        try {
          const data = JSON.parse(await file.text());
          await window.Store.importData(data);
          UI.toast("Respaldo importado", "success");
        } catch (err) {
          UI.toast("Error: " + err.message, "error");
        } finally {
          e.target.value = "";
        }
      },
      { okText: "Reemplazar todo", onCancel: () => { e.target.value = ""; } }
    );
  });

  $("btn-logout").addEventListener("click", () => {
    UI.confirmModal("Cerrar sesión", "¿Salir de la app en este dispositivo?", async () => {
      teardown();
      await window.FBase.signOutShared();
      // onAuthChange muestra el login
    }, { okText: "Salir" });
  });

  // ============ UI bindings ============
  function bindStaticUI() {
    document.querySelectorAll(".nav-btn").forEach(btn => {
      btn.addEventListener("click", () => UI.showView(btn.dataset.view));
    });
    // cada botón/fondo con data-close-modal cierra SOLO su propio modal
    document.querySelectorAll("[data-close-modal]").forEach(el => {
      el.addEventListener("click", () => {
        const modal = el.closest(".modal");
        if (modal) UI.closeModal(modal.id);
      });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const abiertos = [...document.querySelectorAll(".modal:not(.hidden)")];
      const ultimo = abiertos[abiertos.length - 1];
      if (ultimo) UI.closeModal(ultimo.id);
    });
    $("chip-balance").addEventListener("click", () => UI.showView("resumen"));
    $("mes-strip").addEventListener("click", () => UI.showView("resumen"));
    $("ver-todos").addEventListener("click", () => UI.showView("movimientos"));
    $("budget-bar").addEventListener("click", () => {
      const est = window.Presupuesto.estado();
      UI.toast(`Gastado ${UI.fmtL(est.gastado)} de ${UI.fmtL(est.presupuesto)} este mes`);
    });
    $("auto-banner").addEventListener("click", () => {
      if ($("auto-banner").dataset.destino === "pendientes") {
        window.Auto.abrirPendientes();
      } else {
        UI.showView("movimientos");
        setFiltroMovs("auto");
      }
    });
    $("btn-ver-pendientes").addEventListener("click", () => window.Auto.abrirPendientes());
  }

  function updateConnectionStatus() {
    const dot = $("connection-status");
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
    const banner = $("update-banner");
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

  window.App = { abrirDesdePendiente };
})();
