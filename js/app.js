/* ════════════════════════════════════════════════════════
   app.js — Main application logic
════════════════════════════════════════════════════════ */

(() => {
  "use strict";

  /* ─── State ─── */
  let state = Storage.load();
  let mobileTab = "tracks"; // "playlists" | "tracks" | "player"

  let currentTrackId = null;
  let playing = false;
  let volume = 0.8;
  let radioMode = false;
  let position = 0;
  let duration = 0;
  let playerError = "";

  let waveformTimer = null;

  /* ─── DOM refs (static) ─── */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const trackCountEl = $("#trackCount");
  const onairLamp = $("#onairLamp");
  const dbOnairLamp = $("#dbOnairLamp");

  const sidebarView = $("#sidebarView");
  const tracksView = $("#tracksView");
  const playerPanelDesktop = $("#playerPanelDesktop");
  const mobilePlaylistsView = $("#mobilePlaylistsView");
  const mobilePlayerView = $("#mobilePlayerView");

  const playlistsListDesktop = $("#playlistsListDesktop");
  const playlistsListMobile = $("#playlistsListMobile");

  const activePlNameEl = $("#activePlName");
  const activePlCountEl = $("#activePlCount");
  const toggleAddFormBtn = $("#toggleAddForm");
  const addForm = $("#addForm");
  const addTitleInput = $("#addTitleInput");
  const addUrlInput = $("#addUrlInput");
  const addTrackBtn = $("#addTrackBtn");
  const addErrorEl = $("#addError");
  const trackListEl = $("#trackList");
  const emptyStateEl = $("#emptyState");

  const newPlaylistInput = $("#newPlaylistInput");
  const createPlaylistBtn = $("#createPlaylistBtn");

  const miniBar = $("#miniBar");
  const miniBarTitle = $("#miniBarTitle");
  const miniBarProgressFill = $("#miniBarProgressFill");
  const miniBarPlayBtn = $("#miniBarPlayBtn");
  const miniBarNextBtn = $("#miniBarNextBtn");

  const desktopBar = $("#desktopBar");
  const dbTitle = $("#dbTitle");
  const dbMeta = $("#dbMeta");
  const dbPrevBtn = $("#dbPrevBtn");
  const dbPlayBtn = $("#dbPlayBtn");
  const dbNextBtn = $("#dbNextBtn");
  const dbCurrentTime = $("#dbCurrentTime");
  const dbDuration = $("#dbDuration");
  const dbProgressTrack = $("#dbProgressTrack");
  const dbProgressFill = $("#dbProgressFill");
  const dbProgressHandle = $("#dbProgressHandle");
  const dbRadioBtn = $("#dbRadioBtn");
  const dbVolumeSlider = $("#dbVolumeSlider");

  const tabBtns = $$(".tab-btn");

  /* ─── Player panel instances ─── */
  let ppDesktop = null;
  let ppMobile = null;

  /* ════════════════════════════════════════════
     Derived state helpers
  ════════════════════════════════════════════ */
  function getActivePlaylist() {
    return state.playlists.find((p) => p.id === state.activePlaylistId) || state.playlists[0];
  }
  function getTracks() {
    return getActivePlaylist()?.tracks || [];
  }
  function getCurrentTrack() {
    return getTracks().find((t) => t.id === currentTrackId) || null;
  }
  function getCurrentIndex() {
    return getTracks().findIndex((t) => t.id === currentTrackId);
  }
  function persist() {
    Storage.save(state);
  }

  /* ════════════════════════════════════════════
     Playback engine glue
     - Active engine depends on current track's service
     - Both engines stay loaded; we just route play/pause
       to whichever one matches the current track.
  ════════════════════════════════════════════ */

  function activeEngine() {
    const t = getCurrentTrack();
    if (!t) return null;
    if (t.service === "youtube") return "youtube";
    if (t.service === "rss") return "audio";
    return null;
  }

  function stopAllEngines() {
    YouTubeEngine.pause();
    AudioEngine.pause();
  }

  /**
   * Load the current track into the correct engine and
   * (re)render the YouTube host element if needed.
   * `ytHostEl` is the *currently visible* YT container
   * (desktop panel or mobile panel, whichever is active).
   */
  function loadCurrentTrackIntoEngine(ytHostEl) {
    const t = getCurrentTrack();
    playerError = "";
    if (!t) { stopAllEngines(); return; }

    if (t.service === "youtube") {
      AudioEngine.pause();
      if (ytHostEl) {
        YouTubeEngine.load(ytHostEl, t.sourceId, volume, playing);
      }
    } else if (t.service === "rss") {
      YouTubeEngine.destroy();
      AudioEngine.load(t.sourceId, volume, playing);
    }
  }

  YouTubeEngine.onEnded(() => handleTrackEnded());
  YouTubeEngine.onError((msg) => { playerError = msg; renderPlayerPanels(); });
  AudioEngine.onEnded(() => handleTrackEnded());
  AudioEngine.onError((msg) => { playerError = msg; renderPlayerPanels(); });
  AudioEngine.onTime((cur, dur) => {
    if (activeEngine() === "audio") {
      position = cur; duration = dur || duration;
      renderTransport();
    }
  });
  AudioEngine.onDuration((dur) => {
    if (activeEngine() === "audio") { duration = dur; renderTransport(); }
  });

  /* YouTube position polling (YT API has no timeupdate event) */
  let ytPollTimer = null;
  function startYtPoll() {
    clearInterval(ytPollTimer);
    ytPollTimer = setInterval(() => {
      if (activeEngine() === "youtube" && playing) {
        position = YouTubeEngine.getCurrentTime();
        duration = YouTubeEngine.getDuration() || duration;
        renderTransport();
      }
    }, 500);
  }
  startYtPoll();

  /* ════════════════════════════════════════════
     Playback control actions
  ════════════════════════════════════════════ */

  function playTrack(track) {
    currentTrackId = track.id;
    playing = true;
    position = 0; duration = 0; playerError = "";
    if (isMobile()) setMobileTab("player");
    renderAll();
    // renderAll() re-mounts player panel(s) -> grab fresh host el
    requestAnimationFrame(() => {
      const hostEl = getVisibleYtHost();
      loadCurrentTrackIntoEngine(hostEl);
    });
  }

  function togglePlayPause() {
    if (!getCurrentTrack()) return;
    playing = !playing;
    if (activeEngine() === "youtube") {
      playing ? YouTubeEngine.play() : YouTubeEngine.pause();
    } else if (activeEngine() === "audio") {
      playing ? AudioEngine.play() : AudioEngine.pause();
    }
    renderTransport();
  }

  function skipPrev() {
    const idx = getCurrentIndex();
    const tracks = getTracks();
    if (idx > 0) playTrack(tracks[idx - 1]);
  }

  function skipNext() {
    const idx = getCurrentIndex();
    const tracks = getTracks();
    const next = tracks[idx + 1] || (radioMode ? tracks[0] : null);
    if (next) playTrack(next);
  }

  function handleTrackEnded() {
    const idx = getCurrentIndex();
    const tracks = getTracks();
    const next = tracks[idx + 1] || (radioMode ? tracks[0] : null);
    if (next) {
      playTrack(next);
    } else {
      playing = false;
      position = 0;
      renderTransport();
    }
  }

  function seekTo(sec) {
    if (!isFinite(sec) || sec < 0) return;
    if (activeEngine() === "youtube") YouTubeEngine.seekTo(sec);
    else if (activeEngine() === "audio") AudioEngine.seekTo(sec);
    position = sec;
    renderTransport();
  }

  function setVolumeValue(v) {
    volume = Math.max(0, Math.min(1, v));
    YouTubeEngine.setVolume(volume);
    AudioEngine.setVolume(volume);
    renderVolumeUI();
  }

  function toggleRadioMode() {
    radioMode = !radioMode;
    renderRadioUI();
    renderOnAir();
  }

  /* ════════════════════════════════════════════
     Track / Playlist CRUD
  ════════════════════════════════════════════ */

  function addTrack() {
    addErrorEl.hidden = true;
    const url = addUrlInput.value.trim();
    if (!url) { showAddError("URLを入力してください"); return; }

    const service = Services.detect(url);
    let sourceId = url;
    if (service === "youtube") {
      const vid = Services.extractYouTubeId(url);
      if (!vid) { showAddError("YouTubeのURLを確認してください（例: youtube.com/watch?v=XXXXX）"); return; }
      sourceId = vid;
    }

    const track = {
      id: `t${Date.now()}`,
      title: addTitleInput.value.trim() || (service === "youtube" ? `YouTube: ${sourceId}` : url.split("/").pop() || url),
      artist: "",
      service, sourceId, url,
    };

    const pl = getActivePlaylist();
    pl.tracks.push(track);
    persist();

    addUrlInput.value = "";
    addTitleInput.value = "";
    addForm.hidden = true;
    toggleAddFormBtn.classList.remove("active");
    toggleAddFormBtn.textContent = "+ 追加";

    renderAll();
  }

  function showAddError(msg) {
    addErrorEl.textContent = msg;
    addErrorEl.hidden = false;
  }

  function removeTrack(trackId) {
    if (currentTrackId === trackId) {
      playing = false;
      currentTrackId = null;
      stopAllEngines();
    }
    const pl = getActivePlaylist();
    pl.tracks = pl.tracks.filter((t) => t.id !== trackId);
    persist();
    renderAll();
  }

  function createPlaylist() {
    const name = newPlaylistInput.value.trim();
    if (!name) return;
    const id = `pl${Date.now()}`;
    state.playlists.push({ id, name, tracks: [] });
    state.activePlaylistId = id;
    newPlaylistInput.value = "";
    persist();
    if (isMobile()) setMobileTab("tracks");
    renderAll();
  }

  function selectPlaylist(id) {
    state.activePlaylistId = id;
    persist();
    if (isMobile()) setMobileTab("tracks");
    renderAll();
  }

  function renamePlaylist(id, name) {
    const pl = state.playlists.find((p) => p.id === id);
    if (pl && name.trim()) pl.name = name.trim();
    persist();
    renderAll();
  }

  function deletePlaylist(id) {
    if (state.playlists.length <= 1) return;
    state.playlists = state.playlists.filter((p) => p.id !== id);
    if (state.activePlaylistId === id) {
      state.activePlaylistId = state.playlists[0].id;
    }
    persist();
    renderAll();
  }

  /* ════════════════════════════════════════════
     Responsive helpers
  ════════════════════════════════════════════ */
  function isMobile() { return window.innerWidth < 640; }

  function setMobileTab(tab) {
    mobileTab = tab;
    tabBtns.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tab));
    tracksView.classList.toggle("tab-hidden", tab !== "tracks");
    mobilePlaylistsView.hidden = tab !== "playlists";
    mobilePlayerView.hidden = tab !== "player";
    miniBar.hidden = !getCurrentTrack() || tab === "player";

    // When switching to player tab, mount/refresh the mobile panel
    // and migrate the YT host so playback continues uninterrupted.
    if (tab === "player") {
      ensureMobilePanelMounted();
      renderPlayerPanels();
    }
  }

  /* ════════════════════════════════════════════
     RENDERING
  ════════════════════════════════════════════ */

  function renderAll() {
    renderHeader();
    renderPlaylists();
    renderTracksHeader();
    renderTrackList();
    renderPlayerPanels();
    renderTransport();
    renderRadioUI();
    renderVolumeUI();
    renderOnAir();
  }

  function renderHeader() {
    trackCountEl.textContent = `${getTracks().length} tracks`;
  }

  function renderOnAir() {
    const active = playing && radioMode;
    [onairLamp, dbOnairLamp].forEach((el) => el && el.classList.toggle("active", active));
    if (ppDesktop?.onairEl) ppDesktop.onairEl.classList.toggle("active", active);
    if (ppMobile?.onairEl) ppMobile.onairEl.classList.toggle("active", active);
  }

  function renderPlaylists() {
    [playlistsListDesktop, playlistsListMobile].forEach((container) => {
      if (!container) return;
      container.innerHTML = "";
      state.playlists.forEach((pl) => {
        container.appendChild(buildPlaylistItem(pl));
      });
    });
  }

  function buildPlaylistItem(pl) {
    const active = pl.id === state.activePlaylistId;
    const item = document.createElement("div");
    item.className = `playlist-item${active ? " active" : ""}`;

    const info = document.createElement("div");
    info.className = "playlist-info";
    const nameEl = document.createElement("div");
    nameEl.className = "playlist-name";
    nameEl.textContent = pl.name;
    const countEl = document.createElement("div");
    countEl.className = "playlist-count";
    countEl.textContent = `${pl.tracks.length} トラック`;
    info.appendChild(nameEl);
    info.appendChild(countEl);

    item.appendChild(info);

    const editBtn = document.createElement("button");
    editBtn.className = "playlist-icon-btn";
    editBtn.textContent = "✏";
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      startRenamePlaylist(item, pl, info);
    });
    item.appendChild(editBtn);

    if (state.playlists.length > 1) {
      const delBtn = document.createElement("button");
      delBtn.className = "playlist-icon-btn";
      delBtn.textContent = "🗑";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        deletePlaylist(pl.id);
      });
      item.appendChild(delBtn);
    }

    item.addEventListener("click", () => selectPlaylist(pl.id));
    return item;
  }

  function startRenamePlaylist(item, pl, infoEl) {
    const input = document.createElement("input");
    input.className = "input playlist-rename-input";
    input.value = pl.name;
    infoEl.replaceWith(input);
    input.focus();
    input.select();

    const commit = () => renamePlaylist(pl.id, input.value);
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commit();
      if (e.key === "Escape") renderAll();
    });
    input.addEventListener("click", (e) => e.stopPropagation());
  }

  function renderTracksHeader() {
    const pl = getActivePlaylist();
    activePlNameEl.textContent = pl?.name || "";
    activePlCountEl.textContent = `${getTracks().length} トラック`;
  }

  function renderTrackList() {
    const tracks = getTracks();
    trackListEl.innerHTML = "";

    if (tracks.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = `<div class="empty-icon">📻</div><div>「+ 追加」からトラックを追加しよう</div>`;
      trackListEl.appendChild(empty);
      return;
    }

    tracks.forEach((t, i) => {
      trackListEl.appendChild(buildTrackItem(t, i));
    });
  }

  function buildTrackItem(t, idx) {
    const active = t.id === currentTrackId;
    const item = document.createElement("div");
    item.className = `track-item${active ? " active" : ""}`;

    const num = document.createElement("span");
    num.className = "track-num";
    num.textContent = active && playing ? "▶" : String(idx + 1);
    item.appendChild(num);

    const meta = document.createElement("div");
    meta.className = "track-meta";
    const titleEl = document.createElement("div");
    titleEl.className = "track-title";
    titleEl.textContent = t.title;
    meta.appendChild(titleEl);
    if (t.artist) {
      const artistEl = document.createElement("div");
      artistEl.className = "track-artist";
      artistEl.textContent = t.artist;
      meta.appendChild(artistEl);
    }
    item.appendChild(meta);

    item.appendChild(Services.badgeEl(t.service));

    const removeBtn = document.createElement("button");
    removeBtn.className = "track-remove-btn";
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", (e) => { e.stopPropagation(); removeTrack(t.id); });
    item.appendChild(removeBtn);

    item.addEventListener("click", () => playTrack(t));
    return item;
  }

  /* ── Player panels (desktop + mobile share same builder) ── */
  function ensureDesktopPanelMounted() {
    if (!ppDesktop) {
      ppDesktop = PlayerPanel.mount($("#playerPanelContentDesktop"));
      wirePlayerPanel(ppDesktop);
    }
  }
  function ensureMobilePanelMounted() {
    if (!ppMobile) {
      ppMobile = PlayerPanel.mount($("#playerPanelContentMobile"));
      wirePlayerPanel(ppMobile);
    }
  }

  function wirePlayerPanel(pp) {
    pp.prevBtn.addEventListener("click", skipPrev);
    pp.nextBtn.addEventListener("click", skipNext);
    pp.playBtn.addEventListener("click", togglePlayPause);
    pp.radioBtn.addEventListener("click", toggleRadioMode);
    pp.volumeSlider.addEventListener("input", (e) => setVolumeValue(+e.target.value));
    wireSeekableTrack(pp.progressTrack, () => duration, seekTo);
    PlayerPanel.buildWaveform(pp.waveformEl);
  }

  function renderPlayerPanels() {
    ensureDesktopPanelMounted();
    if (isMobile() && mobileTab === "player") ensureMobilePanelMounted();

    [ppDesktop, ppMobile].forEach((pp) => {
      if (!pp) return;
      renderPlayerPanelContent(pp);
    });
  }

  function renderPlayerPanelContent(pp) {
    const t = getCurrentTrack();

    pp.errorEl.hidden = !playerError;
    pp.errorEl.textContent = playerError ? `⚠ ${playerError}` : "";

    pp.ytWrap.hidden = !(t && t.service === "youtube");
    pp.waveformEl.hidden = !(t && t.service === "rss");

    pp.badgeRow.innerHTML = "";
    if (t) pp.badgeRow.appendChild(Services.badgeEl(t.service));

    pp.titleEl.textContent = t ? t.title : "トラックを選択して再生";
    pp.artistEl.textContent = t?.artist || "";

    pp.playBtn.textContent = playing ? "⏸" : "▶";
    pp.volumeSlider.value = volume;

    renderTransportInto(pp);
  }

  /**
   * Returns the currently-visible YouTube host element
   * (desktop panel if on desktop, mobile panel if mobile
   * player tab is active). This is where YouTubeEngine
   * should attach its iframe.
   */
  function getVisibleYtHost() {
    if (isMobile()) {
      ensureMobilePanelMounted();
      return mobileTab === "player" ? ppMobile.ytHost : null;
    }
    ensureDesktopPanelMounted();
    return ppDesktop.ytHost;
  }

  /* ── Transport (progress bar + time labels), pushed to all surfaces ── */
  function renderTransport() {
    renderTransportShared();
    if (ppDesktop) renderTransportInto(ppDesktop);
    if (ppMobile) renderTransportInto(ppMobile);
    renderTrackListActiveMarker();
  }

  function renderTransportShared() {
    const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

    // Desktop bottom bar
    dbProgressFill.style.width = `${pct}%`;
    dbProgressHandle.style.left = `${pct}%`;
    dbProgressHandle.classList.toggle("visible", pct > 0);
    dbCurrentTime.textContent = Services.formatTime(position);
    dbDuration.textContent = Services.formatTime(duration);
    dbPlayBtn.textContent = playing ? "⏸" : "▶";

    const t = getCurrentTrack();
    dbTitle.textContent = t ? t.title : "未選択";
    dbMeta.innerHTML = "";
    if (t) {
      dbMeta.appendChild(Services.badgeEl(t.service));
      if (t.artist) {
        const span = document.createElement("span");
        span.textContent = t.artist;
        dbMeta.appendChild(span);
      }
    }

    // Mobile minibar
    miniBar.hidden = !t || (isMobile() && mobileTab === "player");
    if (t) {
      miniBarTitle.textContent = t.title;
      miniBarProgressFill.style.width = `${pct}%`;
      miniBarPlayBtn.textContent = playing ? "⏸" : "▶";
    }
  }

  function renderTransportInto(pp) {
    const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
    pp.progressFill.style.width = `${pct}%`;
    pp.progressHandle.style.left = `${pct}%`;
    pp.progressHandle.classList.toggle("visible", pct > 0);
    pp.currentTimeEl.textContent = Services.formatTime(position);
    pp.durationEl.textContent = Services.formatTime(duration);
    pp.playBtn.textContent = playing ? "⏸" : "▶";
  }

  function renderTrackListActiveMarker() {
    // Lightweight: just re-render the ▶/number column without full rebuild
    $$(".track-item").forEach((el, i) => {
      const tracks = getTracks();
      const t = tracks[i];
      if (!t) return;
      const numEl = el.querySelector(".track-num");
      if (numEl) numEl.textContent = t.id === currentTrackId && playing ? "▶" : String(i + 1);
    });
  }

  function renderRadioUI() {
    dbRadioBtn.textContent = `📻 ${radioMode ? "ON" : "OFF"}`;
    dbRadioBtn.classList.toggle("active", radioMode);
    [ppDesktop, ppMobile].forEach((pp) => {
      if (!pp) return;
      pp.radioBtn.textContent = radioMode
        ? "📻 RADIO ON — 自動連続再生中"
        : "📻 RADIO — タップで連続再生";
      pp.radioBtn.classList.toggle("active", radioMode);
    });
  }

  function renderVolumeUI() {
    dbVolumeSlider.value = volume;
    [ppDesktop, ppMobile].forEach((pp) => { if (pp) pp.volumeSlider.value = volume; });
  }

  /* ════════════════════════════════════════════
     Waveform animation loop (only while a podcast plays)
  ════════════════════════════════════════════ */
  let waveT = 0;
  function waveformLoop() {
    waveT += 0.12;
    const t = getCurrentTrack();
    const isPodcastPlaying = t?.service === "rss" && playing;
    [ppDesktop, ppMobile].forEach((pp) => {
      if (pp && !pp.waveformEl.hidden) {
        PlayerPanel.animateWaveform(pp.waveformEl, isPodcastPlaying, waveT);
      }
    });
    requestAnimationFrame(waveformLoop);
  }
  requestAnimationFrame(waveformLoop);

  /* ════════════════════════════════════════════
     Seekable progress track (generic, reusable)
  ════════════════════════════════════════════ */
  function wireSeekableTrack(trackEl, getDuration, onSeek) {
    if (!trackEl) return;
    const seek = (clientX) => {
      const dur = getDuration();
      if (!dur) return;
      const rect = trackEl.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      onSeek(pct * dur);
    };
    trackEl.addEventListener("click", (e) => seek(e.clientX));
  }

  /* ════════════════════════════════════════════
     Static event wiring
  ════════════════════════════════════════════ */

  toggleAddFormBtn.addEventListener("click", () => {
    const willShow = addForm.hidden;
    addForm.hidden = !willShow;
    toggleAddFormBtn.classList.toggle("active", willShow);
    toggleAddFormBtn.textContent = willShow ? "✕ 閉じる" : "+ 追加";
    if (willShow) addUrlInput.focus();
  });
  addTrackBtn.addEventListener("click", addTrack);
  addUrlInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addTrack(); });

  createPlaylistBtn.addEventListener("click", createPlaylist);
  newPlaylistInput.addEventListener("keydown", (e) => { if (e.key === "Enter") createPlaylist(); });

  dbPrevBtn.addEventListener("click", skipPrev);
  dbNextBtn.addEventListener("click", skipNext);
  dbPlayBtn.addEventListener("click", togglePlayPause);
  dbRadioBtn.addEventListener("click", toggleRadioMode);
  dbVolumeSlider.addEventListener("input", (e) => setVolumeValue(+e.target.value));
  wireSeekableTrack(dbProgressTrack, () => duration, seekTo);

  miniBarPlayBtn.addEventListener("click", (e) => { e.stopPropagation(); togglePlayPause(); });
  miniBarNextBtn.addEventListener("click", (e) => { e.stopPropagation(); skipNext(); });
  miniBar.addEventListener("click", () => setMobileTab("player"));

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => setMobileTab(btn.dataset.tab));
  });

  window.addEventListener("resize", () => {
    // Re-evaluate which YT host should be "live" when crossing
    // the mobile/desktop breakpoint, since the visible container
    // physically changes.
    renderAll();
    if (getCurrentTrack()?.service === "youtube") {
      const hostEl = getVisibleYtHost();
      if (hostEl && !hostEl.querySelector("iframe")) {
        YouTubeEngine.load(hostEl, getCurrentTrack().sourceId, volume, playing);
      }
    }
  });

  /* ════════════════════════════════════════════
     Init
  ════════════════════════════════════════════ */
  function init() {
    ensureDesktopPanelMounted();
    setMobileTab("tracks");
    renderAll();
  }

  init();
})();
