/* =============================================================
   fondos.js — Fotos de la familia (v3)
   - Viven en Firestore (hogar/{id}/fondos) como data-URLs JPEG,
     privadas tras el login; enablePersistence las cachea offline.
     NUNCA en el repositorio (es público).
   - Inicio: tarjeta grande de fotos que cambia cada ~3 s, con barra
     de progreso tipo "historias" y acercamiento suave hacia las caras
     (campo opcional foco = {x, y} en fracciones; si no, 50 % / 40 %).
     Tocar la foto: lado izquierdo = anterior, derecho = siguiente.
   - Fondo de toda la app: la misma foto muy difuminada (se hace con
     una miniatura de 48 px, así no pesa).
   - Se pausa sola mientras se escribe, con una hoja/modal abierta o
     con la app en segundo plano: no distrae al capturar.
   ============================================================= */

(function () {

  const MAX_FONDOS = 16;
  const MAX_DATAURL_CHARS = 680000;   // ~510 KB binarios; límite Firestore 1 MiB/doc
  const SLIDE_MS = 3000;              // pedido: cambiar cada 2–3 segundos
  const SLIDE_MS_SUAVE = 7000;        // con "reducir movimiento" del teléfono
  const FOCO_DEFAULT = { x: 0.5, y: 0.4 };

  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");

  const F = {
    items: [],
    unsub: null,
    timer: null,
    idx: -1,
    hero: 0,          // capa visible del hero (0|1)
    bg: 0,            // capa visible del fondo (0|1)
    pausado: false,
    pintada: false,   // ¿ya se ve una foto del conjunto actual?
    miniaturas: new Map()
  };

  const heroEl = document.getElementById("hero");
  const heroCapas = [document.getElementById("hero-a"), document.getElementById("hero-b")];
  const bgCapas = [document.getElementById("bg-a"), document.getElementById("bg-b")];
  const progresoEl = document.getElementById("hero-progress");

  function col() {
    return window.FBase.db.collection("hogar")
      .doc(window.FBase.HOGAR_ID).collection("fondos");
  }

  function duracion() {
    return reduceMotion?.matches ? SLIDE_MS_SUAVE : SLIDE_MS;
  }

  // ---------- Ciclo de vida ----------
  function start() {
    if (F.unsub) return;
    F.unsub = col().orderBy("orden").onSnapshot(snap => {
      const antes = F.items.map(f => f.id).join(",");
      F.items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderGrid();
      // re-arrancar solo si cambió el conjunto (no por un cambio de foco)
      if (F.items.map(f => f.id).join(",") !== antes) reiniciar();
    }, err => console.warn("fondos listener:", err));

    document.addEventListener("visibilitychange", evaluarPausa);
    document.addEventListener("focusin", evaluarPausa);
    document.addEventListener("focusout", () => setTimeout(evaluarPausa, 50));
    window.addEventListener("modal:changed", evaluarPausa);
    window.addEventListener("view:changed", evaluarPausa);
  }

  function stop() {
    if (F.unsub) { F.unsub(); F.unsub = null; }
    clearTimeout(F.timer);
    F.items = [];
    F.idx = -1;
    F.pintada = false;
    [...heroCapas, ...bgCapas].forEach(l => {
      if (!l) return;
      l.classList.remove("visible", "kb");
      l.style.backgroundImage = "";
      delete l.dataset.src;
    });
    if (progresoEl) progresoEl.innerHTML = "";
    heroEl?.classList.add("sin-fotos");
    document.removeEventListener("visibilitychange", evaluarPausa);
    document.removeEventListener("focusin", evaluarPausa);
    window.removeEventListener("modal:changed", evaluarPausa);
    window.removeEventListener("view:changed", evaluarPausa);
  }

  // ---------- Pausa (no distraer al escribir) ----------
  function escribiendo() {
    const a = document.activeElement;
    return !!a && a.matches?.("input:not([type=radio]):not([type=checkbox]):not([type=file]), textarea, select");
  }

  function debePausar() {
    return document.hidden || window.UI?.anyModalOpen?.() || escribiendo();
  }

  function evaluarPausa() {
    const pausar = debePausar();
    if (pausar === F.pausado) return;
    F.pausado = pausar;
    heroEl?.classList.toggle("pausado", pausar);
    clearTimeout(F.timer);
    if (pausar) return;
    // las fotos llegaron mientras estaba en pausa: todavía no se pintó
    // ninguna, mostrarla ya (con una sola foto no hay ciclo que la traiga)
    if (!F.pintada) { avanzar(1); return; }
    if (F.items.length > 1) {
      // al volver: la foto actual se queda un ciclo completo
      reiniciarProgreso(F.idx);
      programar(duracion());
    }
  }

  function programar(ms) {
    clearTimeout(F.timer);
    F.timer = setTimeout(() => avanzar(1), ms);
  }

  function reiniciar() {
    clearTimeout(F.timer);
    F.pintada = false;
    const n = F.items.length;
    heroEl?.classList.toggle("sin-fotos", n === 0);
    if (n === 0) {
      [...heroCapas, ...bgCapas].forEach(l => l && l.classList.remove("visible"));
      if (progresoEl) progresoEl.innerHTML = "";
      return;
    }
    renderProgreso();
    // cada vez que se abre la app empieza en una foto distinta
    F.idx = Math.floor(Math.random() * n) - 1;
    avanzar(1);
  }

  // ---------- Miniatura difuminada para el fondo ----------
  function miniatura(item) {
    if (F.miniaturas.has(item.id)) return Promise.resolve(F.miniaturas.get(item.id));
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        try {
          const w = 48;
          const h = Math.max(1, Math.round(w * img.naturalHeight / img.naturalWidth));
          const c = document.createElement("canvas");
          c.width = w; c.height = h;
          c.getContext("2d").drawImage(img, 0, 0, w, h);
          const url = c.toDataURL("image/jpeg", 0.7);
          F.miniaturas.set(item.id, url);
          resolve(url);
        } catch (_) { resolve(item.data); }
      };
      img.onerror = () => resolve(item.data);
      img.src = item.data;
    });
  }

  function foco(item) {
    const f = item.foco || {};
    const x = Number(f.x), y = Number(f.y);
    return {
      x: isFinite(x) && x >= 0 && x <= 1 ? x : FOCO_DEFAULT.x,
      y: isFinite(y) && y >= 0 && y <= 1 ? y : FOCO_DEFAULT.y
    };
  }

  // ---------- Cambio de foto ----------
  function avanzar(dir) {
    const n = F.items.length;
    if (n === 0) return;
    if (debePausar()) { F.pausado = false; evaluarPausa(); return; }

    const sig = ((F.idx + dir) % n + n) % n;
    const item = F.items[sig];
    if (!item?.data) { F.idx = sig; programar(800); return; }

    // precargar y decodificar antes del crossfade (evita "saltos" en iOS)
    const img = new Image();
    img.src = item.data;
    const lista = img.decode ? img.decode().catch(() => {}) : Promise.resolve();
    Promise.all([lista, miniatura(item)]).then(([, mini]) => {
      if (!F.unsub) return;                       // se cerró sesión mientras tanto
      const p = foco(item);
      const pos = `${(p.x * 100).toFixed(1)}% ${(p.y * 100).toFixed(1)}%`;

      // Hero (foto nítida)
      const entra = heroCapas[1 - F.hero];
      const sale = heroCapas[F.hero];
      if (entra && sale) {
        entra.style.backgroundImage = `url("${item.data}")`;
        entra.style.backgroundPosition = pos;
        entra.style.transformOrigin = pos;
        entra.classList.remove("kb");
        void entra.offsetWidth;                   // reinicia el acercamiento
        entra.classList.add("visible", "kb");
        if (n > 1) sale.classList.remove("visible");
        F.hero = 1 - F.hero;
      }

      // Fondo (misma foto, difuminada)
      const bgEntra = bgCapas[1 - F.bg];
      const bgSale = bgCapas[F.bg];
      if (bgEntra && bgSale) {
        bgEntra.style.backgroundImage = `url("${mini}")`;
        bgEntra.style.backgroundPosition = pos;
        bgEntra.classList.add("visible");
        if (n > 1) bgSale.classList.remove("visible");
        F.bg = 1 - F.bg;
      }

      F.idx = sig;
      F.pintada = true;
      reiniciarProgreso(sig);
      if (n > 1) programar(duracion());
    });
  }

  // ---------- Barra de progreso tipo "historias" ----------
  function renderProgreso() {
    if (!progresoEl) return;
    const n = F.items.length;
    progresoEl.innerHTML = n > 1
      ? Array.from({ length: n }, () => '<span class="seg"><i></i></span>').join("")
      : "";
    progresoEl.style.setProperty("--slide-ms", duracion() + "ms");
  }

  function reiniciarProgreso(actual) {
    if (!progresoEl) return;
    const segs = progresoEl.querySelectorAll(".seg");
    // con una sola foto no hay barra (0 segmentos): comparar con eso, no con
    // la cantidad de fotos, o se llamaba a sí misma sin fin
    const esperados = F.items.length > 1 ? F.items.length : 0;
    if (segs.length !== esperados) { renderProgreso(); return reiniciarProgreso(actual); }
    progresoEl.style.setProperty("--slide-ms", duracion() + "ms");
    segs.forEach((s, i) => {
      s.classList.toggle("lleno", i < actual);
      s.classList.remove("ahora");
    });
    const seg = segs[actual];
    if (seg) { void seg.offsetWidth; seg.classList.add("ahora"); }
  }

  // Tocar la foto: izquierda = anterior, derecha = siguiente
  heroEl?.addEventListener("click", (e) => {
    if (F.items.length < 2) return;
    const r = heroEl.getBoundingClientRect();
    clearTimeout(F.timer);
    avanzar(e.clientX - r.left < r.width * 0.35 ? -1 : 1);
  });

  // ---------- Administración (Ajustes → Fotos) ----------
  function renderGrid() {
    const grid = document.getElementById("fondos-grid");
    const hint = document.getElementById("fondos-hint");
    if (!grid) return;
    grid.innerHTML = "";
    F.items.forEach(f => {
      const div = document.createElement("div");
      div.className = "fondo-thumb";
      const p = foco(f);
      div.innerHTML = `
        <img src="${f.data}" alt="" loading="lazy" style="object-position:${(p.x * 100).toFixed(1)}% ${(p.y * 100).toFixed(1)}%" />
        <button type="button" class="fondo-del" title="Quitar foto" aria-label="Quitar foto">✕</button>`;
      div.querySelector(".fondo-del").addEventListener("click", () => {
        window.UI.confirmModal("Quitar foto", "¿Quitar esta foto de la app en ambos teléfonos?", async () => {
          try { await col().doc(f.id).delete(); window.UI.toast("Foto quitada", "success"); }
          catch (e) { window.UI.toast("Error: " + e.message, "error"); }
        }, { okText: "Quitar" });
      });
      grid.appendChild(div);
    });
    if (hint) hint.textContent = `${F.items.length} de ${MAX_FONDOS} fotos`;
  }

  function compressFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        try {
          const attempts = [
            [1600, 0.82], [1400, 0.8], [1400, 0.7], [1200, 0.7], [1200, 0.6], [1000, 0.6], [1000, 0.5]
          ];
          for (const [maxSide, q] of attempts) {
            const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
            const w = Math.max(1, Math.round(img.naturalWidth * scale));
            const h = Math.max(1, Math.round(img.naturalHeight * scale));
            const canvas = document.createElement("canvas");
            canvas.width = w; canvas.height = h;
            canvas.getContext("2d").drawImage(img, 0, 0, w, h);
            const dataUrl = canvas.toDataURL("image/jpeg", q);
            if (dataUrl.length <= MAX_DATAURL_CHARS) return resolve(dataUrl);
          }
          reject(new Error("La foto es demasiado pesada"));
        } catch (e) { reject(e); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Formato de imagen no soportado")); };
      img.src = url;
    });
  }

  async function onFilesSelected(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    const room = MAX_FONDOS - F.items.length;
    if (room <= 0) { window.UI.toast(`Máximo ${MAX_FONDOS} fotos — quita alguna primero`, "error"); return; }

    const batch = files.slice(0, room);
    let orden = F.items.reduce((m, f) => Math.max(m, Number(f.orden) || 0), 0);
    let subidas = 0;
    window.UI.toast("Procesando fotos…");
    for (const file of batch) {
      try {
        const dataUrl = await compressFile(file);
        orden += 1;
        await col().add({
          data: dataUrl,
          orden,
          creadoEn: firebase.firestore.FieldValue.serverTimestamp()
        });
        subidas += 1;
      } catch (e) {
        console.warn("foto no subida:", e);
        window.UI.toast(`Una foto no se pudo subir: ${e.message}`, "error");
      }
    }
    if (subidas > 0) {
      window.UI.toast(`${subidas} foto${subidas > 1 ? "s" : ""} agregada${subidas > 1 ? "s" : ""}`, "success");
    }
    if (files.length > room) {
      window.UI.toast(`Solo caben ${MAX_FONDOS} fotos; se omitieron ${files.length - room}`, "error");
    }
  }

  // input de archivos (el DOM ya existe: scripts van al final del body)
  const input = document.getElementById("file-fondos");
  if (input) {
    input.addEventListener("change", async (e) => {
      await onFilesSelected(e.target.files);
      e.target.value = "";
    });
  }

  window.Fondos = { start, stop, get cantidad() { return F.items.length; } };
})();
