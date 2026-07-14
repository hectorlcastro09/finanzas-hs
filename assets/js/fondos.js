/* =============================================================
   fondos.js — Fotos de fondo (slideshow + administración)
   - Viven en Firestore (hogar/{id}/fondos) como data-URLs JPEG,
     privadas tras el login; enablePersistence las cachea offline.
   - Listener propio, independiente de Store.emit() (las fotos son
     pesadas y no deben disparar re-render de charts/listas).
   - Slideshow: 2 capas fijas con crossfade; Ken Burns solo se
     aplica vía CSS cuando la vista activa es Inicio.
   ============================================================= */

(function () {

  const MAX_FONDOS = 8;
  const MAX_DATAURL_CHARS = 680000;   // ~510 KB binarios; límite Firestore 1 MiB/doc
  const SLIDE_MS = 15000;
  const RETRY_MS = 4000;

  const Fondos = {
    items: [],
    _unsub: null,
    _timer: null,
    _idx: -1,
    _active: 0            // capa visible (0|1)
  };

  const layers = [
    document.getElementById("bg-a"),
    document.getElementById("bg-b")
  ];

  function col() {
    return window.FBase.db.collection("hogar")
      .doc(window.FBase.HOGAR_ID).collection("fondos");
  }

  // ---------- Slideshow ----------
  function start() {
    if (Fondos._unsub) return;
    Fondos._unsub = col().orderBy("orden").onSnapshot(snap => {
      Fondos.items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderGrid();
      restartShow();
    }, err => console.warn("fondos listener:", err));

    document.addEventListener("visibilitychange", onVisibility);
  }

  function stop() {
    if (Fondos._unsub) { Fondos._unsub(); Fondos._unsub = null; }
    clearTimeout(Fondos._timer);
    Fondos.items = [];
    Fondos._idx = -1;
    layers.forEach(l => { if (l) { l.classList.remove("visible"); l.style.backgroundImage = ""; delete l.dataset.src; } });
    document.removeEventListener("visibilitychange", onVisibility);
  }

  function onVisibility() {
    clearTimeout(Fondos._timer);
    // al volver a la app, reanudar casi de inmediato
    if (!document.hidden && Fondos.items.length > 0) schedule(600);
  }

  function restartShow() {
    clearTimeout(Fondos._timer);
    if (Fondos.items.length === 0) {
      layers.forEach(l => l && l.classList.remove("visible"));
      return;
    }
    Fondos._idx = -1;
    advance();
  }

  function schedule(ms) {
    clearTimeout(Fondos._timer);
    Fondos._timer = setTimeout(advance, ms);
  }

  function sheetOpen() {
    const m = document.getElementById("modal-quick");
    return m && !m.classList.contains("hidden");
  }

  function advance() {
    if (Fondos.items.length === 0) return;
    if (document.hidden) return;                      // visibilitychange reanuda
    if (sheetOpen()) { schedule(RETRY_MS); return; }

    const next = (Fondos._idx + 1) % Fondos.items.length;
    const item = Fondos.items[next];
    if (!item?.data) { Fondos._idx = next; schedule(RETRY_MS); return; }

    // precargar y decodificar antes del crossfade (evita "pop" en iOS)
    const img = new Image();
    img.src = item.data;
    const ready = img.decode ? img.decode().catch(() => {}) : Promise.resolve();
    ready.then(() => {
      const incoming = layers[1 - Fondos._active];
      const outgoing = layers[Fondos._active];
      if (!incoming || !outgoing) return;
      if (incoming.dataset.src !== item.id) {
        incoming.style.backgroundImage = `url("${item.data}")`;
        incoming.dataset.src = item.id;
      }
      incoming.classList.add("visible");
      // con una sola foto no hay crossfade que hacer
      if (Fondos.items.length > 1 || outgoing !== incoming) {
        outgoing.classList.remove("visible");
      }
      Fondos._active = 1 - Fondos._active;
      Fondos._idx = next;
      if (Fondos.items.length > 1) schedule(SLIDE_MS);
    });
  }

  // ---------- Administración (Ajustes → Fotos de fondo) ----------
  function renderGrid() {
    const grid = document.getElementById("fondos-grid");
    const hint = document.getElementById("fondos-hint");
    if (!grid) return;
    grid.innerHTML = "";
    Fondos.items.forEach(f => {
      const div = document.createElement("div");
      div.className = "fondo-thumb";
      div.innerHTML = `
        <img src="${f.data}" alt="" loading="lazy" />
        <button type="button" class="fondo-del" title="Quitar foto" aria-label="Quitar foto">✕</button>`;
      div.querySelector(".fondo-del").addEventListener("click", () => {
        window.UI.confirmModal("Quitar foto", "¿Quitar esta foto del fondo en ambos teléfonos?", async () => {
          try { await col().doc(f.id).delete(); window.UI.toast("Foto eliminada", "success"); }
          catch (e) { window.UI.toast("Error: " + e.message, "error"); }
        });
      });
      grid.appendChild(div);
    });
    if (hint) hint.textContent = `${Fondos.items.length} de ${MAX_FONDOS} fotos`;
  }

  function compressFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        try {
          const attempts = [
            [1400, 0.8], [1400, 0.7], [1200, 0.7], [1200, 0.6], [1000, 0.6], [1000, 0.5]
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
    const room = MAX_FONDOS - Fondos.items.length;
    if (room <= 0) { window.UI.toast(`Máximo ${MAX_FONDOS} fotos — elimina alguna primero`, "error"); return; }

    const batch = files.slice(0, room);
    let orden = Fondos.items.reduce((m, f) => Math.max(m, Number(f.orden) || 0), 0);
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
        console.warn("fondo no subido:", e);
        window.UI.toast(`Una foto no se pudo subir: ${e.message}`, "error");
      }
    }
    if (subidas > 0) {
      window.UI.toast(`${subidas} foto${subidas > 1 ? "s" : ""} de fondo agregada${subidas > 1 ? "s" : ""}`, "success");
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

  window.Fondos = { start, stop };
})();
