/* ════════════════════════════════════════════════════════
   app.js — Main application logic
════════════════════════════════════════════════════════ */

(() => {
  "use strict";

  /* ─── State ─── */
  let state = Storage.load();
  const _prefs = Storage.loadPrefs();
  let mobileTab = "tracks"; // "playlists" | "tracks" | "player"

  let currentTrackId = null;
  let playing = false;
  let volume = _prefs.volume;
  let shuffleMode = _prefs.shuffle;
  let repeatMode = _prefs.repeat; // "none" | "one" | "all"
  let radioMode = false;
  let position = 0;
  let duration = 0;
  let playerError = "";

  // Shuffle order cache — rebuilt when shuffle is toggled or playlist changes
  let shuffleQueue = [];

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
  const plListCountEl = $("#plListCount");

  // Mobile new-playlist form
  const toggleNewPlaylistFormBtn = $("#toggleNewPlaylistForm");
  const newPlaylistForm = $("#newPlaylistForm");
  const newPlaylistInput = $("#newPlaylistInput");
  const createPlaylistBtn = $("#createPlaylistBtn");

  // Desktop new-playlist form
  const toggleNewPlaylistFormDesktopBtn = $("#toggleNewPlaylistFormDesktop");
  const newPlaylistFormDesktop = $("#newPlaylistFormDesktop");
  const newPlaylistInputDesktop = $("#newPlaylistInputDesktop");
  const createPlaylistBtnDesktop = $("#createPlaylistBtnDesktop");

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
  const dbShuffleBtn = $("#dbShuffleBtn");
  const dbRepeatBtn = $("#dbRepeatBtn");
  const dbVolumeSlider = $("#dbVolumeSlider");

  const tabBtns = $$(".tab-btn");

  // Bulk import preview modal
  const bulkImportModalEl = $("#bulkImportModal");
  const bulkImportTitleEl = $("#bulkImportTitle");
  const bulkImportSubtitleEl = $("#bulkImportSubtitle");
  const bulkImportSelectAllCheckbox = $("#bulkImportSelectAll");
  const bulkImportListEl = $("#bulkImportList");
  const bulkImportCountEl = $("#bulkImportCount");
  const bulkImportAddBtn = $("#bulkImportAddBtn");
  const bulkImportCancelBtn = $("#bulkImportCancelBtn");
  const bulkImportCloseBtn = $("#bulkImportCloseBtn");

  // Toast
  const toastEl = $("#toast");

  // Spotify auth UI
  const spotifyAuthBtn = $("#spotifyAuthBtn");

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
  function persistPlayerPrefs() {
    Storage.savePrefs({ volume, shuffle: shuffleMode, repeat: repeatMode });
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
    if (t.service === "direct_audio") return "audio";
    if (t.service === "spotify_track") return "spotify";
    return null;
  }

  function stopAllEngines() {
    YouTubeEngine.pause();
    AudioEngine.pause();
    if (SpotifyEngine.isReady) SpotifyEngine.pause();
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
      if (SpotifyEngine.isReady) SpotifyEngine.pause();
      if (ytHostEl) {
        YouTubeEngine.load(ytHostEl, t.sourceId, volume, playing);
      }
    } else if (t.service === "direct_audio") {
      YouTubeEngine.destroy();
      if (SpotifyEngine.isReady) SpotifyEngine.pause();
      AudioEngine.load(t.sourceId, volume, playing);
    } else if (t.service === "spotify_track") {
      YouTubeEngine.destroy();
      AudioEngine.pause();
      if (!SpotifyAuth.isLoggedIn()) {
        playerError = "Spotifyにログインしていません。ヘッダーの「Spotifyでログイン」から認証してください";
        renderPlayerPanels();
        return;
      }
      SpotifyEngine.load(t.sourceId, volume, playing);
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

  SpotifyEngine.onEnded(() => handleTrackEnded());
  SpotifyEngine.onError((msg) => { playerError = msg; renderPlayerPanels(); });
  SpotifyEngine.onNotPremium(() => { renderSpotifyAuthUI(); });

  /* Position polling — both YouTube and Spotify SDKs require polling
     (neither fires a native timeupdate-style event). */
  let ytPollTimer = null;
  function startYtPoll() {
    clearInterval(ytPollTimer);
    ytPollTimer = setInterval(() => {
      const engine = activeEngine();
      if (engine === "youtube" && playing) {
        position = YouTubeEngine.getCurrentTime();
        duration = YouTubeEngine.getDuration() || duration;
        renderTransport();
      } else if (engine === "spotify" && playing) {
        Promise.all([SpotifyEngine.getCurrentTime(), SpotifyEngine.getDuration()]).then(([pos, dur]) => {
          position = pos;
          duration = dur || duration;
          renderTransport();
        });
        SpotifyEngine.pollForEnd();
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
    const engine = activeEngine();
    if (engine === "youtube") {
      playing ? YouTubeEngine.play() : YouTubeEngine.pause();
    } else if (engine === "audio") {
      playing ? AudioEngine.play() : AudioEngine.pause();
    } else if (engine === "spotify") {
      playing ? SpotifyEngine.play() : SpotifyEngine.pause();
    }
    renderTransport();
  }

  /* ── Shuffle queue ──────────────────────────────────────── */
  function buildShuffleQueue() {
    const tracks = getTracks();
    const ids = tracks.map((t) => t.id);
    // Fisher-Yates shuffle, keeping currentTrackId first
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    // Move currentTrackId to front if present
    const ci = ids.indexOf(currentTrackId);
    if (ci > 0) { ids.splice(ci, 1); ids.unshift(currentTrackId); }
    shuffleQueue = ids;
  }

  function nextTrack(forceNext = false) {
    const tracks = getTracks();
    if (!tracks.length) return null;

    // 1曲リピート（forceNext=trueは⏭ボタンで明示的にスキップ）
    if (repeatMode === "one" && !forceNext) return getCurrentTrack() || null;

    if (shuffleMode) {
      if (!shuffleQueue.length) buildShuffleQueue();
      const ci = shuffleQueue.indexOf(currentTrackId);
      const ni = (ci + 1) % shuffleQueue.length;
      const nextId = shuffleQueue[ni];
      // リピートなし+最後まで行ったら止まる
      if (!radioMode && repeatMode === "none" && ci === shuffleQueue.length - 1) return null;
      return tracks.find((t) => t.id === nextId) || null;
    }

    const idx = getCurrentIndex();
    const next = tracks[idx + 1] || null;
    if (next) return next;
    if (radioMode || repeatMode === "all") return tracks[0];
    return null;
  }

  function skipPrev() {
    // ⏮ボタン: 再生位置が3秒超なら先頭へ戻す、3秒以内なら前のトラックへ
    if (position > 3) {
      seekTo(0);
      return;
    }
    const tracks = getTracks();
    if (shuffleMode && shuffleQueue.length) {
      const ci = shuffleQueue.indexOf(currentTrackId);
      const pi = (ci - 1 + shuffleQueue.length) % shuffleQueue.length;
      const prev = tracks.find((t) => t.id === shuffleQueue[pi]);
      if (prev) playTrack(prev);
    } else {
      const idx = getCurrentIndex();
      if (idx > 0) playTrack(tracks[idx - 1]);
    }
  }

  function skipNext() {
    const next = nextTrack(true); // forceNext=true → 1曲リピートでも次へ
    if (next) playTrack(next);
  }

  function handleTrackEnded() {
    const next = nextTrack(false);
    if (next) {
      playTrack(next);
    } else {
      playing = false;
      position = 0;
      renderTransport();
    }
  }

  function toggleShuffle() {
    shuffleMode = !shuffleMode;
    if (shuffleMode) buildShuffleQueue();
    else shuffleQueue = [];
    persistPlayerPrefs();
    renderPlaybackModeUI();
  }

  function cycleRepeat() {
    // none → one → all → none
    repeatMode = repeatMode === "none" ? "one" : repeatMode === "one" ? "all" : "none";
    persistPlayerPrefs();
    renderPlaybackModeUI();
  }

  function toggleRadioMode() {
    radioMode = !radioMode;
    renderRadioUI();
    renderOnAir();
  }

  function seekTo(sec) {
    if (!isFinite(sec) || sec < 0) return;
    const engine = activeEngine();
    if (engine === "youtube") YouTubeEngine.seekTo(sec);
    else if (engine === "audio") AudioEngine.seekTo(sec);
    else if (engine === "spotify") SpotifyEngine.seekTo(sec);
    position = sec;
    renderTransport();
  }

  function setVolumeValue(v) {
    volume = Math.max(0, Math.min(1, v));
    YouTubeEngine.setVolume(volume);
    AudioEngine.setVolume(volume);
    if (SpotifyEngine.isReady) SpotifyEngine.setVolume(volume);
    persistPlayerPrefs();
    renderVolumeUI();
  }

  /* ════════════════════════════════════════════
     Track / Playlist CRUD
  ════════════════════════════════════════════ */

  async function addTrack() {
    addErrorEl.hidden = true;
    const url = addUrlInput.value.trim();
    if (!url) { showAddError("URLを入力してください"); return; }

    const service = Services.detect(url);

    if (service === "youtube") {
      const vid = Services.extractYouTubeId(url);
      if (!vid) { showAddError("YouTubeのURLを確認してください（例: youtube.com/watch?v=XXXXX）"); return; }
      commitNewTrack({ service: "youtube", sourceId: vid, url, title: addTitleInput.value.trim() || `YouTube: ${vid}`, artist: "" });
      return;
    }

    if (service === "spotify_track") {
      if (!SpotifyAuth.isLoggedIn()) { showAddError("先にヘッダーの「Spotifyでログイン」から認証してください"); return; }
      const id = Services.extractSpotifyTrackId(url);
      if (!id) { showAddError("SpotifyのトラックURLを確認してください"); return; }

      setAddTrackLoading(true, "Spotifyからトラック情報を取得中…");
      try {
        const track = await SpotifyResolver.resolveTrack(id);
        commitNewTrack({
          service: "spotify_track",
          sourceId: track.trackId,
          url,
          title: addTitleInput.value.trim() || track.title,
          artist: track.artist || "",
        });
      } catch (e) {
        showAddError(e.message || "Spotifyトラックの取得に失敗しました");
      } finally {
        setAddTrackLoading(false);
      }
      return;
    }

    if (service === "spotify_collection") {
      if (!SpotifyAuth.isLoggedIn()) { showAddError("先にヘッダーの「Spotifyでログイン」から認証してください"); return; }
      const parsed = SpotifyResolver.parseUrl(url);
      if (!parsed) { showAddError("SpotifyのプレイリストURLを確認してください"); return; }

      setAddTrackLoading(true, "Spotifyからリストを取得中…");
      try {
        const result = parsed.type === "playlist"
          ? await SpotifyResolver.resolvePlaylist(parsed.id)
          : await SpotifyResolver.resolveAlbum(parsed.id);
        setAddTrackLoading(false);
        openBulkImportPreview({
          collectionName: result.collectionName,
          serviceLabel: "Spotify",
          sourceUrl: url,
          items: result.tracks.map((t) => ({
            service: "spotify_track",
            sourceId: t.trackId,
            url: `https://open.spotify.com/track/${t.trackId}`,
            title: t.title,
            artist: t.artist,
          })),
        });
      } catch (e) {
        setAddTrackLoading(false);
        showAddError(e.message || "Spotifyリストの取得に失敗しました");
      }
      return;
    }

    if (service === "apple_podcast") {
      const ids = Services.extractApplePodcastIds(url);
      if (!ids) { showAddError("Apple PodcastsのURLを確認してください"); return; }

      // No episode ID in the URL => this is a show-level link, not a
      // single-episode link. Offer the bulk "番組をまるごと追加" flow
      // instead of silently grabbing just the latest episode.
      if (!ids.episodeId) {
        setAddTrackLoading(true, "Apple Podcastsから番組情報を取得中…");
        try {
          const result = await ApplePodcastResolver.resolveAllEpisodes(ids.podcastId);
          setAddTrackLoading(false);
          openBulkImportPreview({
            collectionName: result.showTitle,
            serviceLabel: "Podcast",
            sourceUrl: url,
            items: result.episodes.map((ep) => ({
              service: "direct_audio",
              sourceId: ep.audioUrl,
              url: ep.audioUrl,
              title: ep.title,
              artist: ep.artist,
            })),
          });
        } catch (e) {
          setAddTrackLoading(false);
          showAddError(e.message || "Apple Podcastsの取得に失敗しました");
        }
        return;
      }

      setAddTrackLoading(true, "Apple Podcastsからエピソードを検索中…");
      try {
        const resolved = await ApplePodcastResolver.resolve(ids);
        commitNewTrack({
          service: "direct_audio",
          sourceId: resolved.audioUrl,
          url,
          title: addTitleInput.value.trim() || resolved.title,
          artist: resolved.artist || "",
        });
        if (resolved.note) showAddInfo(resolved.note);
      } catch (e) {
        showAddError(e.message || "Apple Podcastsの解決に失敗しました");
      } finally {
        setAddTrackLoading(false);
      }
      return;
    }

    if (service === "direct_audio") {
      commitNewTrack({
        service: "direct_audio",
        sourceId: url,
        url,
        title: addTitleInput.value.trim() || (url.split("/").pop() || url),
        artist: "",
      });
      return;
    }

    // service === "podcast_feed" — anything not recognized above.
    // Covers Omny (*.omnycontent.com/.../podcast.rss), Buzzsprout,
    // Libsyn, Anchor/Spotify-for-Podcasters, self-hosted RSS, etc.
    // A feed URL always represents an entire show, so we always offer
    // the bulk-import preview rather than silently grabbing one episode.
    setAddTrackLoading(true, "フィードを取得中…");
    try {
      const result = await PodcastFeedResolver.resolveAll(url);
      setAddTrackLoading(false);
      openBulkImportPreview({
        collectionName: result.showTitle,
        serviceLabel: "Podcast",
        sourceUrl: url,
        items: result.episodes.map((ep) => ({
          service: "direct_audio",
          sourceId: ep.audioUrl,
          url: ep.audioUrl,
          title: ep.title,
          artist: ep.artist,
        })),
      });
    } catch (e) {
      setAddTrackLoading(false);
      showAddError(
        (e.message || "フィードの解析に失敗しました") + "　— 「リンクとして追加」も選べます"
      );
      offerLinkFallback(url);
    }
  }

  /**
   * When feed parsing fails, show a small inline action letting the
   * user add the URL as a plain Link track instead of losing the input.
   */
  function offerLinkFallback(url) {
    const existing = $("#addLinkFallbackBtn");
    if (existing) existing.remove();

    const btn = document.createElement("button");
    btn.id = "addLinkFallbackBtn";
    btn.className = "btn-outline";
    btn.style.marginTop = "8px";
    btn.textContent = "🔗 リンクとして追加する";
    btn.addEventListener("click", () => {
      commitNewTrack({
        service: "link",
        sourceId: url,
        url,
        title: addTitleInput.value.trim() || (url.split("/").pop() || url),
        artist: "",
      });
    });
    addErrorEl.insertAdjacentElement("afterend", btn);
  }

  /* ════════════════════════════════════════════
     Bulk import preview modal
     Used for: Spotify playlists/albums, Apple Podcasts shows,
     and any podcast RSS/Atom feed — anywhere a single pasted
     URL can expand into many tracks at once.
  ════════════════════════════════════════════ */

  let bulkImportState = null; // { collectionName, serviceLabel, sourceUrl, items, selected: Set<number> }

  function openBulkImportPreview({ collectionName, serviceLabel, sourceUrl, items }) {
    bulkImportState = {
      collectionName, serviceLabel, sourceUrl, items,
      selected: new Set(items.map((_, i) => i)), // all selected by default
    };
    renderBulkImportModal();
    bulkImportModalEl.hidden = false;

    // The add-form's job is done; the modal takes over from here.
    addUrlInput.value = "";
    addTitleInput.value = "";
    addForm.hidden = true;
    toggleAddFormBtn.classList.remove("active");
    toggleAddFormBtn.textContent = "+ 追加";
    removeLinkFallbackBtn();
  }

  function closeBulkImportModal() {
    bulkImportModalEl.hidden = true;
    bulkImportState = null;
  }

  function renderBulkImportModal() {
    if (!bulkImportState) return;
    const { collectionName, serviceLabel, items, selected } = bulkImportState;

    bulkImportTitleEl.textContent = collectionName;
    bulkImportSubtitleEl.textContent = `${serviceLabel} ・ ${items.length} 件のトラックが見つかりました`;
    bulkImportSelectAllCheckbox.checked = selected.size === items.length;
    bulkImportCountEl.textContent = `${selected.size} / ${items.length} 件を追加`;
    bulkImportAddBtn.disabled = selected.size === 0;

    bulkImportListEl.innerHTML = "";
    items.forEach((item, i) => {
      const row = document.createElement("label");
      row.className = "bulk-import-row";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selected.has(i);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.add(i); else selected.delete(i);
        renderBulkImportModal();
      });

      const num = document.createElement("span");
      num.className = "bulk-import-num";
      num.textContent = i + 1;

      const meta = document.createElement("div");
      meta.className = "bulk-import-meta";
      const titleEl = document.createElement("div");
      titleEl.className = "bulk-import-title";
      titleEl.textContent = item.title;
      meta.appendChild(titleEl);
      if (item.artist) {
        const artistEl = document.createElement("div");
        artistEl.className = "bulk-import-artist";
        artistEl.textContent = item.artist;
        meta.appendChild(artistEl);
      }

      row.appendChild(checkbox);
      row.appendChild(num);
      row.appendChild(meta);
      bulkImportListEl.appendChild(row);
    });
  }

  function toggleBulkImportSelectAll() {
    if (!bulkImportState) return;
    const { items, selected } = bulkImportState;
    if (selected.size === items.length) {
      selected.clear();
    } else {
      items.forEach((_, i) => selected.add(i));
    }
    renderBulkImportModal();
  }

  function commitBulkImport() {
    if (!bulkImportState) return;
    const { items, selected } = bulkImportState;
    const pl = getActivePlaylist();
    const toAdd = items.filter((_, i) => selected.has(i));

    toAdd.forEach((item) => {
      pl.tracks.push({
        id: `t${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        title: item.title,
        artist: item.artist || "",
        service: item.service,
        sourceId: item.sourceId,
        url: item.url,
      });
    });
    persist();
    closeBulkImportModal();
    removeLinkFallbackBtn();
    renderAll();
    showToast(`${toAdd.length} 件のトラックを追加しました`);
  }

  /**
   * Brief, self-dismissing notification — used for confirmations that
   * happen after the add-form has already been closed (e.g. bulk import),
   * where the inline #addError banner inside the form isn't visible.
   */
  let toastTimer = null;
  function showToast(message) {
    clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.hidden = false;
    requestAnimationFrame(() => toastEl.classList.add("visible"));
    toastTimer = setTimeout(() => {
      toastEl.classList.remove("visible");
      setTimeout(() => { toastEl.hidden = true; }, 250);
    }, 3000);
  }

  function commitNewTrack({ service, sourceId, url, title, artist }) {
    const track = { id: `t${Date.now()}`, title, artist, service, sourceId, url };
    const pl = getActivePlaylist();
    pl.tracks.push(track);
    persist();

    addUrlInput.value = "";
    addTitleInput.value = "";
    addForm.hidden = true;
    toggleAddFormBtn.classList.remove("active");
    toggleAddFormBtn.textContent = "+ 追加";
    removeLinkFallbackBtn();

    renderAll();
  }

  function removeLinkFallbackBtn() {
    const existing = $("#addLinkFallbackBtn");
    if (existing) existing.remove();
  }

  function showAddError(msg) {
    removeLinkFallbackBtn();
    addErrorEl.textContent = msg;
    addErrorEl.className = "add-error";
    addErrorEl.hidden = false;
  }

  function showAddInfo(msg) {
    addErrorEl.textContent = msg;
    addErrorEl.className = "add-error add-info";
    addErrorEl.hidden = false;
  }

  function setAddTrackLoading(isLoading, message) {
    addTrackBtn.disabled = isLoading;
    addUrlInput.disabled = isLoading;
    addTitleInput.disabled = isLoading;
    if (isLoading) {
      addTrackBtn.dataset.originalText = addTrackBtn.dataset.originalText || addTrackBtn.textContent;
      addTrackBtn.textContent = "検索中…";
      showAddInfo(message || "処理中…");
    } else {
      addTrackBtn.textContent = addTrackBtn.dataset.originalText || "追加";
    }
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

  function createPlaylist(inputEl) {
    const name = inputEl.value.trim();
    if (!name) return;
    const id = `pl${Date.now()}`;
    state.playlists.push({ id, name, tracks: [] });
    state.activePlaylistId = id;
    inputEl.value = "";
    closeNewPlaylistForms();
    persist();
    if (isMobile()) setMobileTab("tracks");
    renderAll();
  }

  function closeNewPlaylistForms() {
    newPlaylistForm.hidden = true;
    toggleNewPlaylistFormBtn.classList.remove("active");
    toggleNewPlaylistFormBtn.textContent = "+ 新規作成";
    newPlaylistFormDesktop.hidden = true;
    toggleNewPlaylistFormDesktopBtn.classList.remove("active");
    toggleNewPlaylistFormDesktopBtn.textContent = "+ 新規";
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
    renderPlaybackModeUI();
    renderVolumeUI();
    renderOnAir();
    renderSpotifyAuthUI();
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
    if (plListCountEl) plListCountEl.textContent = `${state.playlists.length} 件`;
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
    if (pp.shuffleBtn) pp.shuffleBtn.addEventListener("click", toggleShuffle);
    pp.prevBtn.addEventListener("click", skipPrev);
    pp.nextBtn.addEventListener("click", skipNext);
    pp.playBtn.addEventListener("click", togglePlayPause);
    if (pp.repeatBtn) pp.repeatBtn.addEventListener("click", cycleRepeat);
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
    pp.waveformEl.hidden = !(t && t.service === "direct_audio");

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

  function renderPlaybackModeUI() {
    // Shuffle button
    const shuffleText = shuffleMode ? "🔀 ON" : "🔀";
    [dbShuffleBtn, ...$$(".pp-shuffle")].forEach((el) => {
      if (!el) return;
      el.textContent = shuffleText;
      el.classList.toggle("active", shuffleMode);
    });

    // Repeat button
    const repeatMap = { none: "🔁", one: "🔂 1", all: "🔁 ALL" };
    const repeatText = repeatMap[repeatMode] || "🔁";
    [dbRepeatBtn, ...$$(".pp-repeat")].forEach((el) => {
      if (!el) return;
      el.textContent = repeatText;
      el.classList.toggle("active", repeatMode !== "none");
      el.title = repeatMode === "none" ? "繰り返しなし"
               : repeatMode === "one" ? "1曲繰り返し"
               : "全曲繰り返し";
    });
  }

  function renderVolumeUI() {
    dbVolumeSlider.value = volume;
    [ppDesktop, ppMobile].forEach((pp) => { if (pp) pp.volumeSlider.value = volume; });
  }

  function renderSpotifyAuthUI() {
    if (!spotifyAuthBtn) return;
    if (!SpotifyAuth.isConfigured()) {
      spotifyAuthBtn.textContent = "Spotify未設定";
      spotifyAuthBtn.disabled = true;
      spotifyAuthBtn.title = "js/spotify-auth.js に Client ID を設定してください";
      return;
    }
    if (SpotifyAuth.isLoggedIn()) {
      spotifyAuthBtn.textContent = "🟢 Spotify連携中";
      spotifyAuthBtn.classList.add("connected");
    } else {
      spotifyAuthBtn.textContent = "Spotifyでログイン";
      spotifyAuthBtn.classList.remove("connected");
    }
  }

  /* ════════════════════════════════════════════
     Waveform animation loop (only while a podcast plays)
  ════════════════════════════════════════════ */
  let waveT = 0;
  function waveformLoop() {
    waveT += 0.12;
    const t = getCurrentTrack();
    const isPodcastPlaying = t?.service === "direct_audio" && playing;
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

  toggleNewPlaylistFormBtn.addEventListener("click", () => {
    const willShow = newPlaylistForm.hidden;
    closeNewPlaylistForms();
    if (willShow) {
      newPlaylistForm.hidden = false;
      toggleNewPlaylistFormBtn.classList.add("active");
      toggleNewPlaylistFormBtn.textContent = "✕ 閉じる";
      newPlaylistInput.focus();
    }
  });
  createPlaylistBtn.addEventListener("click", () => createPlaylist(newPlaylistInput));
  newPlaylistInput.addEventListener("keydown", (e) => { if (e.key === "Enter") createPlaylist(newPlaylistInput); });

  toggleNewPlaylistFormDesktopBtn.addEventListener("click", () => {
    const willShow = newPlaylistFormDesktop.hidden;
    closeNewPlaylistForms();
    if (willShow) {
      newPlaylistFormDesktop.hidden = false;
      toggleNewPlaylistFormDesktopBtn.classList.add("active");
      toggleNewPlaylistFormDesktopBtn.textContent = "✕";
      newPlaylistInputDesktop.focus();
    }
  });
  createPlaylistBtnDesktop.addEventListener("click", () => createPlaylist(newPlaylistInputDesktop));
  newPlaylistInputDesktop.addEventListener("keydown", (e) => { if (e.key === "Enter") createPlaylist(newPlaylistInputDesktop); });

  dbPrevBtn.addEventListener("click", skipPrev);
  dbNextBtn.addEventListener("click", skipNext);
  dbPlayBtn.addEventListener("click", togglePlayPause);
  dbRadioBtn.addEventListener("click", toggleRadioMode);
  if (dbShuffleBtn) dbShuffleBtn.addEventListener("click", toggleShuffle);
  if (dbRepeatBtn)  dbRepeatBtn.addEventListener("click", cycleRepeat);
  dbVolumeSlider.addEventListener("input", (e) => setVolumeValue(+e.target.value));
  wireSeekableTrack(dbProgressTrack, () => duration, seekTo);

  miniBarPlayBtn.addEventListener("click", (e) => { e.stopPropagation(); togglePlayPause(); });
  miniBarNextBtn.addEventListener("click", (e) => { e.stopPropagation(); skipNext(); });
  miniBar.addEventListener("click", () => setMobileTab("player"));

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => setMobileTab(btn.dataset.tab));
  });

  if (spotifyAuthBtn) {
    spotifyAuthBtn.addEventListener("click", async () => {
      if (SpotifyAuth.isLoggedIn()) {
        SpotifyEngine.disconnect();
        SpotifyAuth.logout();
        renderSpotifyAuthUI();
        showToast("Spotifyからログアウトしました");
        return;
      }
      try {
        await SpotifyAuth.login();
      } catch (e) {
        showToast(e.message || "Spotifyログインを開始できませんでした");
      }
    });
  }

  if (bulkImportSelectAllCheckbox) {
    bulkImportSelectAllCheckbox.addEventListener("change", toggleBulkImportSelectAll);
  }
  if (bulkImportAddBtn) bulkImportAddBtn.addEventListener("click", commitBulkImport);
  if (bulkImportCancelBtn) bulkImportCancelBtn.addEventListener("click", closeBulkImportModal);
  if (bulkImportCloseBtn) bulkImportCloseBtn.addEventListener("click", closeBulkImportModal);
  if (bulkImportModalEl) {
    bulkImportModalEl.addEventListener("click", (e) => {
      if (e.target === bulkImportModalEl) closeBulkImportModal();
    });
  }

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

    // If the user is already logged into Spotify from a previous
    // session (token still valid in sessionStorage), warm up the
    // Web Playback SDK in the background so playback starts faster
    // on the first click.
    if (SpotifyAuth.isLoggedIn()) {
      SpotifyEngine.init().catch(() => {});
    }
  }

  init();
})();
