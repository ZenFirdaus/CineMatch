/* ═══════════════════════════════════════════════════════════════
   CineMatch — script.js  (Bahasa Indonesia)
   SPA: navigasi, preferensi, rekomendasi, modal
   Fitur tambahan: splash+retry saat server loading, timeout handling
═══════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  // ── Konstanta ─────────────────────────────────────────────────────────────
  const LS_KEY      = "cinematch_prefs_v2";
  const API_BASE    = "";          // sama-origin
  const MAX_RETRIES = 30;          // coba max 30x (±60 detik)
  const RETRY_MS    = 2000;

  const GENRE_ICONS = {
    Action:"⚔️", Adventure:"🗺️", Animation:"🎨", Children:"🧸",
    Comedy:"😄", Crime:"🔍", Documentary:"📽️", Drama:"🎭",
    Fantasy:"🧙", "Film-Noir":"🕵️", Horror:"👻", IMAX:"🎬",
    Musical:"🎵", Mystery:"🔮", Romance:"❤️", "Sci-Fi":"🚀",
    Thriller:"😰", War:"🪖", Western:"🤠",
  };
  const MOOD_ICONS  = {
    Comedy:"😄", Emotional:"🥺", Dark:"🌑",
    Action:"💥", Thriller:"😰", Relaxing:"🌿",
  };
  const DURATION_LABELS = {
    any:"Semua Durasi", short:"Pendek (< ~90 mnt)",
    medium:"Sedang (~90–150 mnt)", long:"Panjang (> ~150 mnt)",
  };

  // ── State ─────────────────────────────────────────────────────────────────
  let metadata        = {};
  let allResults      = { top:[], best_match:[], more:[] };
  let activeGenreFilter = null;
  let hasResults      = false;

  // ── DOM helper ────────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);

  // ══════════════════════════════════════════════════════════════════════════
  // INIT — tunggu server siap dulu
  // ══════════════════════════════════════════════════════════════════════════
  init();

  async function init() {
    setupNavigation();
    await waitForServer();          // splash + retry loop
    hideSplash();
    setupSlider();
    setupForm();
    setupRecsPage();
    setupModal();
  }

  // ── Splash + retry metadata ───────────────────────────────────────────────
  async function waitForServer() {
    const progressEl = $("splash-progress");
    const msgEl      = $("splash-msg");

    for (let i = 0; i < MAX_RETRIES; i++) {
      const pct = Math.min(95, (i / MAX_RETRIES) * 100);
      if (progressEl) progressEl.style.width = pct + "%";

      try {
        const res = await fetch(API_BASE + "/api/metadata", { signal: AbortSignal.timeout(4000) });
        if (res.ok) {
          metadata = await res.json();
          if (progressEl) progressEl.style.width = "100%";
          renderGenreChips();
          renderMoodChips();
          renderDurationOptions();
          renderGenreShowcase();
          return;   // berhasil
        }
      } catch (_) {
        // server belum siap, coba lagi
      }

      const sisa = MAX_RETRIES - i;
      if (msgEl) {
        if (i < 5)       msgEl.textContent = "Memuat data film…";
        else if (i < 15) msgEl.textContent = `Memproses ${(86537).toLocaleString("id")} film… (${sisa}x lagi)`;
        else             msgEl.textContent = `Hampir selesai… (${sisa}x lagi)`;
      }
      await sleep(RETRY_MS);
    }

    // Jika masih gagal setelah semua retry
    if (msgEl) msgEl.textContent = "Server tidak merespons. Pastikan app.py sudah dijalankan.";
  }

  function hideSplash() {
    const splash = $("app-splash");
    if (!splash) return;
    splash.classList.add("hidden");
    setTimeout(() => splash.remove(), 500);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // NAVIGASI
  // ══════════════════════════════════════════════════════════════════════════
  function setupNavigation() {
    document.addEventListener("click", (e) => {
      const el = e.target.closest("[data-nav]");
      if (!el) return;
      e.preventDefault();
      navigateTo(el.dataset.nav);
    });

    const burger   = $("nav-burger");
    const navLinks = $("nav-links");
    burger?.addEventListener("click", () => navLinks?.classList.toggle("open"));
    navLinks?.addEventListener("click", () => navLinks?.classList.remove("open"));
  }

  function navigateTo(view) {
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    const target = $("view-" + view);
    if (target) { target.classList.add("active"); window.scrollTo(0, 0); }
    document.querySelectorAll(".nav-link").forEach((l) => {
      l.classList.toggle("active", l.dataset.nav === view);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER GENRE CHIPS
  // ══════════════════════════════════════════════════════════════════════════
  function renderGenreChips() {
    const likedGrid    = $("liked-genres");
    const dislikedGrid = $("disliked-genres");
    if (!likedGrid || !dislikedGrid) return;
    likedGrid.innerHTML    = "";
    dislikedGrid.innerHTML = "";
    (metadata.genres || []).forEach((g) => {
      likedGrid.appendChild(makeChip(g, "liked",    GENRE_ICONS[g] || "🎬"));
      dislikedGrid.appendChild(makeChip(g, "disliked", GENRE_ICONS[g] || "🎬"));
    });
  }

  function makeChip(label, type, icon) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = type === "disliked" ? "chip dislike" : "chip";
    btn.dataset.value = label;
    btn.dataset.type  = type;
    btn.innerHTML = `<span class="chip-icon">${icon}</span>${esc(label)}`;
    btn.addEventListener("click", () => {
      btn.classList.toggle("active");
      // Tidak boleh ada di dua sisi sekaligus
      const oppGrid = type === "liked" ? $("disliked-genres") : $("liked-genres");
      if (btn.classList.contains("active")) {
        oppGrid?.querySelector(`[data-value="${label}"]`)?.classList.remove("active");
      }
    });
    return btn;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER MOOD CHIPS
  // ══════════════════════════════════════════════════════════════════════════
  function renderMoodChips() {
    const grid = $("mood-chips");
    if (!grid) return;
    grid.innerHTML = "";
    (metadata.moods || []).forEach((m) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      btn.dataset.value = m;
      btn.dataset.type  = "mood";
      btn.innerHTML = `<span class="chip-icon">${MOOD_ICONS[m] || "🎬"}</span>${esc(m)}`;
      btn.addEventListener("click", () => btn.classList.toggle("active"));
      grid.appendChild(btn);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER DURATION OPTIONS
  // ══════════════════════════════════════════════════════════════════════════
  function renderDurationOptions() {
    const sel = $("pref-duration");
    if (!sel) return;
    sel.innerHTML = "";
    (metadata.durations || []).forEach((d) => {
      const opt = document.createElement("option");
      opt.value       = d.value;
      opt.textContent = DURATION_LABELS[d.value] || d.label;
      sel.appendChild(opt);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // GENRE SHOWCASE (Beranda)
  // ══════════════════════════════════════════════════════════════════════════
  function renderGenreShowcase() {
    const container = $("genre-showcase");
    if (!container) return;
    container.innerHTML = "";
    (metadata.genres || []).forEach((g) => {
      const card = document.createElement("div");
      card.className = "genre-card";
      card.innerHTML = `
        <div class="genre-card-icon">${GENRE_ICONS[g] || "🎬"}</div>
        <div class="genre-card-name">${esc(g)}</div>
      `;
      card.addEventListener("click", () => {
        navigateTo("preferences");
        setTimeout(() => {
          const chip = $("liked-genres")?.querySelector(`[data-value="${g}"]`);
          if (chip && !chip.classList.contains("active")) chip.click();
        }, 50);
      });
      container.appendChild(card);
    });
    renderHeroFrames();
  }

  function renderHeroFrames() {
    const el = $("hero-frames");
    if (!el) return;
    el.innerHTML = Object.values(GENRE_ICONS).slice(0, 12)
      .map((i) => `<div class="film-frame">${i}</div>`).join("");
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SLIDER
  // ══════════════════════════════════════════════════════════════════════════
  function setupSlider() {
    const slider  = $("pref-rating");
    const display = $("rating-display");
    if (!slider) return;
    const update = () => {
      if (display) display.textContent = slider.value;
      const pct = ((parseFloat(slider.value) - 0) / 5) * 100;
      slider.style.background =
        `linear-gradient(to right, var(--orange) ${pct}%, var(--border) ${pct}%)`;
    };
    slider.addEventListener("input", update);
    update();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FORM PREFERENSI
  // ══════════════════════════════════════════════════════════════════════════
  function setupForm() {
    const form = $("prefs-form");
    if (!form) return;

    // Muat preferensi tersimpan
    loadPrefsFromStorage();

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const prefs = collectPrefs();
      if (!validatePrefs(prefs)) return;
      savePrefsToStorage(prefs);
      setGenerating(true);
      navigateTo("recommendations");
      await fetchRecommendations(prefs);
      setGenerating(false);
    });

    $("reset-prefs-btn")?.addEventListener("click", () => {
      resetForm();
      localStorage.removeItem(LS_KEY);
      showToast("Preferensi direset.");
    });
  }

  function collectPrefs() {
    return {
      liked_genres:    getActiveChips("liked-genres"),
      disliked_genres: getActiveChips("disliked-genres"),
      moods:           getActiveChips("mood-chips"),
      age:             $("pref-age")?.value ? parseInt($("pref-age").value, 10) : null,
      min_rating:      parseFloat($("pref-rating")?.value || 3.5),
      year_from:       parseInt($("pref-year-from")?.value || metadata.year_min, 10),
      year_to:         parseInt($("pref-year-to")?.value   || metadata.year_max, 10),
      duration:        $("pref-duration")?.value || "any",
    };
  }

  function getActiveChips(containerId) {
    return Array.from(
      document.getElementById(containerId)?.querySelectorAll(".chip.active") || []
    ).map((c) => c.dataset.value);
  }

  function validatePrefs(prefs) {
    const errEl = $("year-error");
    if (prefs.year_from > prefs.year_to) {
      errEl.textContent = "Tahun 'Dari' harus lebih kecil atau sama dengan 'Sampai'.";
      errEl.hidden = false;
      $("pref-year-from")?.focus();
      return false;
    }
    if (errEl) errEl.hidden = true;
    return true;
  }

  function setGenerating(on) {
    const btn = $("generate-btn");
    const txt = btn?.querySelector(".btn-text");
    const spn = btn?.querySelector(".btn-spinner");
    if (!btn) return;
    btn.disabled = on;
    if (txt) txt.textContent = on ? "Mencari…" : "Cari Rekomendasi";
    if (spn) spn.hidden = !on;
  }

  function resetForm() {
    document.querySelectorAll(".chip.active").forEach((c) => c.classList.remove("active"));
    const age = $("pref-age"); if (age) age.value = "";
    const rat = $("pref-rating");
    if (rat) {
      rat.value = 3.5;
      const d = $("rating-display"); if (d) d.textContent = "3.5";
      setupSlider();
    }
    if (metadata.year_min) { const y = $("pref-year-from"); if (y) y.value = metadata.year_min; }
    if (metadata.year_max) { const y = $("pref-year-to");   if (y) y.value = metadata.year_max; }
    const dur = $("pref-duration"); if (dur) dur.value = "any";
  }

  // ── localStorage ─────────────────────────────────────────────────────────
  function savePrefsToStorage(prefs) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(prefs)); } catch (_) {}
  }

  function loadPrefsFromStorage() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      applyPrefsToForm(JSON.parse(raw));
    } catch (_) {}
  }

  function applyPrefsToForm(prefs) {
    (prefs.liked_genres    || []).forEach((g) => $("liked-genres")   ?.querySelector(`[data-value="${g}"]`)?.classList.add("active"));
    (prefs.disliked_genres || []).forEach((g) => $("disliked-genres")?.querySelector(`[data-value="${g}"]`)?.classList.add("active"));
    (prefs.moods           || []).forEach((m) => $("mood-chips")     ?.querySelector(`[data-value="${m}"]`)?.classList.add("active"));
    if (prefs.age)        { const a = $("pref-age");      if (a) a.value = prefs.age; }
    if (prefs.min_rating != null) {
      const r = $("pref-rating");
      if (r) { r.value = prefs.min_rating; setupSlider(); }
    }
    if (prefs.year_from) { const y = $("pref-year-from"); if (y) y.value = prefs.year_from; }
    if (prefs.year_to)   { const y = $("pref-year-to");   if (y) y.value = prefs.year_to;   }
    if (prefs.duration)  { const d = $("pref-duration");  if (d) d.value = prefs.duration;  }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FETCH REKOMENDASI
  // ══════════════════════════════════════════════════════════════════════════
  async function fetchRecommendations(prefs) {
    showRecsState("loading");
    updateLoadingMsg(0);

    const tick = setInterval(() => updateLoadingMsg(), 1500);

    try {
      const res = await fetch(API_BASE + "/api/recommend", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(prefs),
        signal:  AbortSignal.timeout(60000),   // max 60 detik
      });
      clearInterval(tick);

      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();

      allResults = data;
      hasResults = true;
      renderActivePrefsTags(prefs);
      buildGenreFilterBar(data);
      activeGenreFilter = null;
      flattenAndRender(null);
    } catch (err) {
      clearInterval(tick);
      showRecsState("initial");
      if (err.name === "TimeoutError") {
        showToast("Waktu habis. Coba lagi.", 5000);
      } else {
        showToast("Gagal memuat rekomendasi: " + err.message, 5000);
      }
    }
  }

  let _loadingStep = 0;
  const LOADING_MSGS = [
    ["Menganalisis preferensi…",     "Ini mungkin membutuhkan beberapa detik."],
    ["Mencocokkan genre…",           "Memproses 86.000+ film dari dataset."],
    ["Menghitung skor kecocokan…",   "Hampir selesai!"],
    ["Menyusun hasil…",              "Segera ditampilkan."],
  ];
  function updateLoadingMsg(step) {
    if (step !== undefined) _loadingStep = step;
    else _loadingStep = (_loadingStep + 1) % LOADING_MSGS.length;
    const [title, desc] = LOADING_MSGS[_loadingStep];
    const t = $("loading-title"); const d = $("loading-desc");
    if (t) t.textContent = title;
    if (d) d.textContent = desc;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HALAMAN REKOMENDASI
  // ══════════════════════════════════════════════════════════════════════════
  function setupRecsPage() {
    const searchInp   = $("recs-search");
    const searchClear = $("search-clear");
    const sortSel     = $("recs-sort");

    searchInp?.addEventListener("input", () => {
      if (searchClear) searchClear.hidden = !searchInp.value;
      applyClientFilter();
    });

    searchClear?.addEventListener("click", () => {
      if (searchInp) searchInp.value = "";
      if (searchClear) searchClear.hidden = true;
      applyClientFilter();
    });

    sortSel?.addEventListener("change", applyClientFilter);
  }

  function applyClientFilter() {
    if (!hasResults) return;
    flattenAndRender(activeGenreFilter);
  }

  function buildGenreFilterBar(data) {
    const bar = $("genre-filter-bar");
    if (!bar) return;
    bar.innerHTML = "";

    const genreSet = new Set();
    [...data.top, ...data.best_match, ...data.more].forEach((m) =>
      m.genres.forEach((g) => genreSet.add(g))
    );
    if (genreSet.size === 0) return;

    const allBtn = createGfChip("Semua", true, () => {
      activeGenreFilter = null;
      bar.querySelectorAll(".gf-chip").forEach((c) => c.classList.remove("active"));
      allBtn.classList.add("active");
      flattenAndRender(null);
    });
    bar.appendChild(allBtn);

    [...genreSet].sort().forEach((g) => {
      const btn = createGfChip(g, false, () => {
        const was = btn.classList.contains("active");
        bar.querySelectorAll(".gf-chip").forEach((c) => c.classList.remove("active"));
        if (!was) { btn.classList.add("active"); activeGenreFilter = g; }
        else       { allBtn.classList.add("active"); activeGenreFilter = null; }
        flattenAndRender(activeGenreFilter);
      });
      bar.appendChild(btn);
    });
  }

  function createGfChip(label, isActive, onClick) {
    const btn = document.createElement("button");
    btn.className = "gf-chip" + (isActive ? " active" : "");
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
  }

  function flattenAndRender(genreFilter) {
    const search = ($("recs-search")?.value || "").trim().toLowerCase();
    const sort   = $("recs-sort")?.value || "score";

    // Gabungkan semua hasil dengan tag _section (immutable copy)
    let all = [
      ...allResults.top.map((m)        => Object.assign({}, m, { _section:"top"  })),
      ...allResults.best_match.map((m) => Object.assign({}, m, { _section:"best" })),
      ...allResults.more.map((m)       => Object.assign({}, m, { _section:"more" })),
    ];

    if (genreFilter) all = all.filter((m) => m.genres.includes(genreFilter));
    if (search)      all = all.filter((m) =>
      m.title.toLowerCase().includes(search) ||
      m.genres.some((g) => g.toLowerCase().includes(search))
    );

    const isFiltered = !!(search || genreFilter);

    // Jika ada filter/search → sort ulang, tampil flat
    // Jika tidak ada filter → tetap urutan asli (berdasarkan _section)
    if (isFiltered) {
      all = sortMovies(all, sort);
    }

    renderResults(all, isFiltered);
  }

  function sortMovies(list, sort) {
    const c = list.slice();
    switch (sort) {
      case "score":     c.sort((a,b) => b.score - a.score); break;
      case "rating":    c.sort((a,b) => b.avg_rating - a.avg_rating); break;
      case "year_desc": c.sort((a,b) => (b.year||0) - (a.year||0)); break;
      case "year_asc":  c.sort((a,b) => (a.year||0) - (b.year||0)); break;
      case "title":     c.sort((a,b) => a.title.localeCompare(b.title)); break;
    }
    return c;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER HASIL
  // ══════════════════════════════════════════════════════════════════════════
  function renderResults(all, isFiltered) {
    const recsCount = $("recs-count");
    if (recsCount) recsCount.textContent = `${fmtNum(all.length)} film`;

    if (all.length === 0) { showRecsState("empty"); return; }
    showRecsState("content");

    // ── Semua bagian tersedia ─────────────────────────────────────────────
    const secTop  = $("sec-top");
    const secBest = $("sec-best");
    const secMore = $("sec-more");

    if (isFiltered) {
      // Tampil flat di satu seksi "Sangat Sesuai"
      secTop.hidden  = true;
      secBest.hidden = false;
      secMore.hidden = true;
      $("top-picks-grid").innerHTML = "";
      renderGrid($("best-match-grid"), all);
      $("more-grid").innerHTML = "";
    } else {
      const topMovies  = all.filter((m) => m._section === "top");
      const bestMovies = all.filter((m) => m._section === "best");
      const moreMovies = all.filter((m) => m._section === "more");

      secTop.hidden  = topMovies.length  === 0;
      secBest.hidden = bestMovies.length === 0;
      secMore.hidden = moreMovies.length === 0;

      renderGrid($("top-picks-grid"), topMovies,  true);
      renderGrid($("best-match-grid"), bestMovies);
      renderGrid($("more-grid"), moreMovies);
    }
  }

  function renderGrid(container, movies, isTop = false) {
    if (!container) return;
    container.innerHTML = "";
    movies.forEach((m) => container.appendChild(buildCard(m, isTop)));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BUILD CARD
  // ══════════════════════════════════════════════════════════════════════════
  function buildCard(movie, isTop) {
    const card = document.createElement("div");
    card.className = "movie-card" + (isTop ? " top-pick-card" : "");

    const matchPct  = Math.round(movie.score * 100);
    const genrePills = movie.genres.slice(0, 3)
      .map((g) => `<span class="genre-pill">${esc(g)}</span>`).join("");

    const posterHTML = movie.poster_url
      ? `<img class="card-poster" src="${esc(movie.poster_url)}" alt="${esc(movie.title)}" loading="lazy"
           onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
         <div class="card-poster-ph" style="display:none">
           <div class="ph-icon">🎬</div>
           <div class="ph-title">${esc(movie.title)}</div>
         </div>`
      : `<div class="card-poster-ph">
           <div class="ph-icon">🎬</div>
           <div class="ph-title">${esc(movie.title)}</div>
         </div>`;

    card.innerHTML = `
      ${posterHTML}
      <div class="card-body">
        <div class="card-title-row">
          <div class="card-title">${esc(movie.title)}</div>
          <div class="card-year">${movie.year || "—"}</div>
        </div>
        <div class="card-genres">${genrePills}</div>
        <div class="card-footer">
          <div class="card-rating">
            <span class="star">★</span>
            <span class="rating-num">${movie.avg_rating.toFixed(1)}</span>
            <span class="rating-cnt">(${fmtNum(movie.rating_count)})</span>
          </div>
          <span class="match-badge">${matchPct}%</span>
        </div>
      </div>
    `;
    card.addEventListener("click", () => openModal(movie));
    return card;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ACTIVE PREFS TAGS
  // ══════════════════════════════════════════════════════════════════════════
  function renderActivePrefsTags(prefs) {
    const bar = $("active-prefs-bar");
    if (!bar) return;
    const tags = [];
    (prefs.liked_genres    || []).forEach((g) => tags.push(`<span class="pref-tag orange">${esc(GENRE_ICONS[g]||"🎬")} ${esc(g)}</span>`));
    (prefs.moods           || []).forEach((m) => tags.push(`<span class="pref-tag blue">${esc(MOOD_ICONS[m]||"")} ${esc(m)}</span>`));
    (prefs.disliked_genres || []).forEach((g) => tags.push(`<span class="pref-tag red">✕ ${esc(g)}</span>`));
    if (prefs.min_rating > 0) tags.push(`<span class="pref-tag blue">★ ≥ ${prefs.min_rating}</span>`);
    if (prefs.year_from || prefs.year_to) tags.push(`<span class="pref-tag blue">📅 ${prefs.year_from}–${prefs.year_to}</span>`);
    bar.innerHTML = tags.join("");
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STATE
  // ══════════════════════════════════════════════════════════════════════════
  function showRecsState(state) {
    const initial = $("recs-initial");
    const loading = $("recs-loading");
    const content = $("recs-content");
    const empty   = $("recs-empty");

    // Set hidden dulu semua
    if (initial) initial.hidden = state !== "initial";
    if (loading) loading.hidden = state !== "loading";
    if (content) content.hidden = state !== "content";
    if (empty)   empty.hidden   = state !== "empty";

    // Hentikan animasi loader secara eksplisit
    const ring = $("recs-loading")?.querySelector(".loader-ring");
    if (ring) ring.style.animationPlayState = (state === "loading") ? "running" : "paused";
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MODAL
  // ══════════════════════════════════════════════════════════════════════════
  function setupModal() {
    $("modal-close")?.addEventListener("click", closeModal);
    $("modal-overlay")?.addEventListener("click", (e) => { if (e.target === $("modal-overlay")) closeModal(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
  }

  function openModal(movie) {
    const overlay   = $("modal-overlay");
    const posterImg = $("modal-poster");
    const posterPh  = $("modal-poster-ph");

    if (movie.poster_url) {
      posterImg.src   = movie.poster_url;
      posterImg.alt   = movie.title;
      posterImg.style.display = "block";
      posterPh.classList.remove("active");
      posterImg.onerror = () => { posterImg.style.display="none"; posterPh.innerHTML="🎬"; posterPh.classList.add("active"); };
    } else {
      posterImg.style.display = "none";
      posterPh.innerHTML = "🎬";
      posterPh.classList.add("active");
    }

    $("modal-year").textContent    = movie.year || "";
    $("modal-score").textContent   = Math.round(movie.score * 100) + "% Cocok";
    $("modal-title").textContent   = movie.title;
    $("modal-rating").textContent  = "★ " + movie.avg_rating.toFixed(1) + " / 5.0";
    $("modal-reviews").textContent = fmtNum(movie.rating_count) + " ulasan";

    $("modal-genres").innerHTML = movie.genres
      .map((g) => `<span class="modal-genre-tag">${esc(GENRE_ICONS[g]||"")} ${esc(g)}</span>`).join("");

    const linksEl = $("modal-links");
    linksEl.innerHTML = "";
    if (movie.imdb_id && movie.imdb_id !== "0000000") {
      linksEl.appendChild(makeExternalLink(`https://www.imdb.com/title/tt${movie.imdb_id}/`, "⬡ IMDb"));
    }
    if (movie.tmdb_id > 0) {
      linksEl.appendChild(makeExternalLink(`https://www.themoviedb.org/movie/${movie.tmdb_id}`, "⬡ TMDb"));
    }

    overlay.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    const overlay = $("modal-overlay");
    if (overlay) overlay.hidden = true;
    document.body.style.overflow = "";
  }

  function makeExternalLink(href, text) {
    const a = document.createElement("a");
    a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer";
    a.className = "modal-link"; a.innerHTML = text;
    return a;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TOAST
  // ══════════════════════════════════════════════════════════════════════════
  let _toastTimer;
  function showToast(msg, dur = 3000) {
    const el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { el.hidden = true; }, dur);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // UTILS
  // ══════════════════════════════════════════════════════════════════════════
  function esc(str) {
    return String(str)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }
  function fmtNum(n) {
    if (n >= 1_000_000) return (n/1_000_000).toFixed(1)+"jt";
    if (n >= 1_000)     return (n/1_000).toFixed(1)+"rb";
    return String(n);
  }
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

})();
