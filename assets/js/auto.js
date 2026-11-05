/* =============================================================
   auto.js — Registro automático desde los correos de los bancos
   El trabajo pesado lo hace el Apps Script del Gmail de Héctor
   (Correos.gs, plantilla en docs/correos-automaticos.gs):
     · compras con tarjeta (BAC / Davivienda) → egreso directo
       (origen "correo"; categoría aprendida o sugerida por Claude)
     · débitos de cuenta → colección "pendientes": no suman hasta
       que aquí se toca "Es gasto" (o se descartan con "No es gasto")
   Aquí: aviso en Inicio, hoja de pendientes, estado en Ajustes y la
   detección de duplicados al anotar a mano.
   ============================================================= */

(function () {

  const DIA_MS = 86400000;
  const VENTANA_DUP_MS = 2 * DIA_MS;      // ± 2 días para considerar "el mismo gasto"
  const TOLERANCIA_L = 1.0;               // al anotar a mano se redondea (464.11 → 464)

  function esAuto(t) {
    return t?.origen === "correo";
  }

  function parecida(a, b) {
    return Math.abs(Number(a) - Number(b)) <= TOLERANCIA_L;
  }

  // ¿Ya entró solo (desde el correo) un egreso igual al que se va a anotar?
  function buscarDuplicado({ tipo, monto, moneda, fecha }) {
    if (tipo !== "egreso") return null;
    const f = fecha instanceof Date ? fecha.getTime() : Date.now();
    return (window.Store.transacciones || []).find(t => {
      if (!esAuto(t) || t.tipo !== "egreso") return false;
      const original = (t.moneda || "HNL") === (moneda || "HNL") ? Number(t.montoOriginal ?? t.monto) : NaN;
      if (!parecida(original, monto)) return false;
      return Math.abs(UI.txDate(t).getTime() - f) <= VENTANA_DUP_MS;
    }) || null;
  }

  // Pendiente del banco que podría ser lo que se está anotando a mano. No
  // se exige el mismo banco (a veces se anota en otro), por eso la app
  // PREGUNTA antes de enlazarlo: puede ser otro gasto del mismo monto.
  // Si hay varios, primero el del mismo banco y el más parecido.
  function pendienteQueCoincide({ monto, moneda, fecha, cuenta }) {
    const f = fecha instanceof Date ? fecha.getTime() : Date.now();
    const puntaje = p => [
      p.cuenta === cuenta ? 0 : 1,
      Math.abs(Number(p.montoOriginal ?? p.monto) - Number(monto)),
      Math.abs(UI.txDate(p).getTime() - f)
    ];
    return (window.Store.pendientes || []).filter(p => {
      if ((p.moneda || "HNL") !== (moneda || "HNL")) return false;
      if (!parecida(p.montoOriginal ?? p.monto, monto)) return false;
      return Math.abs(UI.txDate(p).getTime() - f) <= VENTANA_DUP_MS;
    }).sort((a, b) => {
      const x = puntaje(a), y = puntaje(b);
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
    })[0] || null;
  }

  function describirOrigen(t) {
    const partes = [];
    if (t.fuente) partes.push(t.fuente);
    if (t.tarjeta) partes.push(t.tarjeta);
    if (t.comercio) partes.push(t.comercio);
    return partes.join(" · ");
  }

  function etiquetaPendiente(p) {
    const f = UI.txDate(p);
    return `${UI.fmtDia(f)} · ${UI.fmtHora(f)}`;
  }

  function montoPendiente(p) {
    return p.moneda === "USD"
      ? "$" + Number(p.montoOriginal).toFixed(2)
      : UI.fmtL(p.montoOriginal ?? p.monto);
  }

  // ---------- Inicio: aviso de pendientes y compras por clasificar ----------
  function porClasificar() {
    return (window.Store.transacciones || []).filter(t =>
      esAuto(t) && t.tipo === "egreso" && (!t.categoria || t.categoria === "Sin categoría"));
  }

  function renderBanner() {
    const el = document.getElementById("auto-banner");
    if (!el) return;
    const nPend = (window.Store.pendientes || []).length;
    const nClas = porClasificar().length;
    if (nPend === 0 && nClas === 0) { el.classList.add("hidden"); return; }
    const partes = [];
    if (nPend) partes.push(`${nPend} movimiento${nPend > 1 ? "s" : ""} de cuenta por confirmar`);
    if (nClas) partes.push(`${nClas} compra${nClas > 1 ? "s" : ""} por clasificar`);
    el.querySelector(".ab-texto").textContent = partes.join(" · ");
    el.dataset.destino = nPend ? "pendientes" : "clasificar";
    el.classList.remove("hidden");
  }

  // ---------- Hoja de pendientes ----------
  function abrirPendientes() {
    renderPendientes();
    UI.openModal("modal-pendientes");
  }

  function renderPendientes() {
    const ul = document.getElementById("lista-pendientes");
    if (!ul) return;
    const items = window.Store.pendientes || [];
    if (items.length === 0) {
      ul.innerHTML = `<li class="empty">No hay movimientos por confirmar ✓</li>`;
      return;
    }
    ul.innerHTML = "";
    items.forEach(p => {
      const li = document.createElement("li");
      li.className = "pend-item";
      li.innerHTML = `
        <div class="pend-top">
          <div class="pend-main">
            <strong class="pend-monto">${UI.escapeHtml(montoPendiente(p))}</strong>
            ${p.comercio ? `<span class="pend-comercio">${UI.escapeHtml(p.comercio)}</span>` : ""}
            <span class="pend-meta">${UI.escapeHtml(UI.bancoLabel(p.cuenta))}${p.tarjeta ? " · tarjeta " + UI.escapeHtml(String(p.tarjeta).replace(/^\D+/, "")) : ""} · ${UI.escapeHtml(etiquetaPendiente(p))}</span>
            ${p.detalle && !p.comercio ? `<span class="pend-det">${UI.escapeHtml(p.detalle)}</span>` : ""}
            ${p.pista ? `<span class="pend-pista">⚠️ ${UI.escapeHtml(p.pista)}</span>` : ""}
          </div>
        </div>
        <div class="pend-acciones">
          <button type="button" class="btn btn-sm btn-outline" data-accion="no">${p.posibleDuplicadoDe ? "Ya está anotado" : "No es gasto"}</button>
          <button type="button" class="btn btn-sm btn-primary" data-accion="si">Es gasto →</button>
        </div>`;
      li.querySelector('[data-accion="si"]').addEventListener("click", () => {
        UI.closeModal("modal-pendientes");
        window.App?.abrirDesdePendiente(p);
      });
      li.querySelector('[data-accion="no"]').addEventListener("click", () => {
        UI.confirmModal(
          p.posibleDuplicadoDe ? "Ya está anotado" : "No es gasto",
          p.posibleDuplicadoDe
            ? `${montoPendiente(p)} no se registrará otra vez: ya lo tenían anotado.`
            : `${montoPendiente(p)} de ${UI.bancoLabel(p.cuenta)} no se registrará (por ejemplo, un traslado entre sus cuentas o el pago de una tarjeta).`,
          async () => {
            try {
              await window.Store.descartarPendiente(p.id);
              UI.toast("Listo, no se registró", "success");
              renderPendientes();
            } catch (e) { UI.toast("Error: " + e.message, "error"); }
          },
          { okText: "No registrar", peligro: false }
        );
      });
      ul.appendChild(li);
    });
  }

  // ---------- Ajustes: estado del registro automático ----------
  function renderEstadoAjustes() {
    const badge = document.getElementById("auto-estado");
    if (!badge) return;
    const est = window.Store.autoEstado;
    const ultima = est?.ultimaRevision?.toDate?.() || null;
    const activo = !!ultima && (Date.now() - ultima.getTime()) < 30 * 60000;
    const conError = !!est?.ultimoError;
    badge.textContent = !ultima ? "Sin activar" : conError ? "Con error" : activo ? "✓ Activo" : "Detenido";
    badge.className = "notif-badge " + (!ultima ? "off" : conError ? "err" : activo ? "ok" : "off");

    const ahora = new Date();
    const delMes = (window.Store.transacciones || []).filter(t => {
      if (!esAuto(t)) return false;
      const f = UI.txDate(t);
      return f.getFullYear() === ahora.getFullYear() && f.getMonth() === ahora.getMonth();
    });
    const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    set("auto-ultima", ultima ? `${UI.fmtDia(ultima)}, ${UI.fmtHora(ultima)}` : "—");
    set("auto-mes", `${delMes.length} (${UI.fmtL(delMes.reduce((a, t) => a + Number(t.monto || 0), 0))})`);
    set("auto-pend", String((window.Store.pendientes || []).length));
    const cierre = est?.cierreUltimo?.toDate?.() || null;
    set("auto-cierre", cierre ? `${UI.fmtDia(cierre)}: ${est.cierreResumen || "sin novedades"}` : "Esta noche");
    const errEl = document.getElementById("auto-error");
    if (errEl) {
      errEl.textContent = conError ? "Último error: " + est.ultimoError : "";
      errEl.classList.toggle("hidden", !conError);
    }
  }

  window.Auto = {
    esAuto, buscarDuplicado, pendienteQueCoincide, describirOrigen, montoPendiente,
    porClasificar, renderBanner, abrirPendientes, renderPendientes, renderEstadoAjustes
  };
})();
