/* ════════════════════════════════════════════════════════
   app.js — Main application logic
════════════════════════════════════════════════════════ */

/**
 * Page-scope icon helper — defined outside the IIFE so that
 * settings.js and other modules loaded before app.js can also call it.
 */
function iconMarkup(name, cls = "icon") {
  return `<svg class="${cls}" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
}

(() => {
  "use strict";

  /* Load the shared icon sprite (assets/icons.svg) and inject it inline,
     so <use href="#icon-xxx"> references throughout the app resolve.
     SVG <use> elements auto-update once their target symbol appears in
     the DOM, so this can safely run in parallel with the rest of init. */
  fetch("assets/icons.svg")
    .then((res) => res.text())
    .then((svgText) => {
      const host = document.getElementById("iconSpriteHost");
      if (host) host.innerHTML = svgText;
    })
    .catch((e) => console.warn("Icon sprite failed to load:", e));

  /* ─── State ─── */
  let state = Storage.load();
  const _prefs = Storage.loadPrefs();
  let mobileTab = "tracks"; // "playlists" | "tracks" | "player" | "settings"

  let currentTrackId = null;

  // viewPlaylistId  → which playlist is shown in the track list (UI)
  // playingPlaylistId → which playlist owns the currently playing track
  // They start equal but diverge when the user browses other playlists
  // while something is playing.
  let viewPlaylistId    = state.activePlaylistId || state.playlists[0]?.id;
  let playingPlaylistId = viewPlaylistId;

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

  // App settings (per-platform volume, radio behaviour, etc.)
  let appSettings = Settings.load();

  let waveformTimer = null;

  /* ─── DOM refs (static) ─── */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  /**
   * Icon helpers — build/replace inline <svg><use> references.
   * iconMarkup() is defined page-scope above; setIcon() and escapeHtmlText()
   * are IIFE-local helpers that build on it.
   */
  function setIcon(el, name, label = "", cls = "icon") {
    if (!el) return;
    el.innerHTML = iconMarkup(name, cls) + (label ? `<span class="icon-label">${label}</span>` : "");
  }
  /**
   * Escape user-provided text (playlist names, track titles, etc.) before
   * mixing it into innerHTML alongside icon markup. Plain textContent
   * assignment is preferred wherever icon+text aren't combined in one node.
   */
  function escapeHtmlText(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
  }

  /**
   * Applies a temporary scrolling "marquee" reveal to a now-playing title/
   * artist element, but ONLY when its text actually overflows the element's
   * width. Loops continuously for as long as the same overflowing text is
   * displayed — short text that already fits is completely unaffected
   * (no DOM restructuring happens at all in that case).
   *
   * Safe to call on every render, including from code that runs on a
   * polling timer (e.g. the position-update tick): it no-ops immediately
   * if `text` is unchanged from the last call for this element, so it
   * never restarts an in-progress marquee for the same title. Skips
   * animation entirely for prefers-reduced-motion users (unless the
   * force_marquee setting explicitly overrides that).
   *
   * Hidden-element safe: if the element is currently invisible (e.g. an
   * inactive mobile tab, or a panel not yet mounted into visible layout),
   * scrollWidth/clientWidth would both read as 0 and incorrectly look
   * like "no overflow". To avoid permanently mis-measuring in that case,
   * this deliberately does NOT record the text as "settled" while the
   * element is hidden — so the very next call for the same text (the next
   * poll tick, or a render triggered once the element becomes visible,
   * e.g. after switching mobile tabs) retries the measurement properly.
   *
   * @param {HTMLElement} el - the display element (must allow overflow:hidden;
   *   white-space:nowrap in its base CSS — used as-is when not overflowing)
   * @param {string} text
   */
  function isMeasurable(el) {
    return el.offsetParent !== null && el.clientWidth > 0;
  }
  function applyMarqueeIfNeeded(el, text) {
    if (!el) return;
    text = text || "";

    if (!isMeasurable(el)) {
      // Can't reliably measure while hidden — show plain text but leave
      // dataset.marqueeKey UNSET so a future call (once visible) retries.
      if (el.dataset.marqueeText === text) return; // already showing this, nothing to do
      el.classList.remove("marquee-active");
      el.textContent = text;
      el.dataset.marqueeText = text;
      delete el.dataset.marqueeKey;
      return;
    }

    // Cache key includes the container width, not just the text, so
    // resizing the window (which can change whether the SAME text
    // overflows) also triggers a fresh check — not just track changes.
    const key = `${text}::${el.clientWidth}`;
    if (el.dataset.marqueeKey === key) return; // already settled for this text+width
    el.dataset.marqueeKey = key;

    el.dataset.marqueeText = text;
    el.classList.remove("marquee-active");
    el.textContent = text;
    if (!text) return;

    // Respect the OS/browser's reduced-motion signal by default (protects
    // people who could be genuinely bothered by scrolling text). The
    // in-app "長い曲名・アーティスト名をスクロール表示" setting is an
    // explicit, informed opt-in that overrides this for people who want
    // the animation despite their OS-level default.
    if (!appSettings.force_marquee && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    requestAnimationFrame(() => {
      if (el.dataset.marqueeKey !== key) return; // superseded by a newer change
      if (!isMeasurable(el)) {
        // Became hidden between the sync check and this frame — don't
        // commit a possibly-wrong "no overflow" conclusion; let it retry.
        delete el.dataset.marqueeKey;
        return;
      }
      const overflowPx = el.scrollWidth - el.clientWidth;
      if (overflowPx <= 4) return; // fits fine as-is — leave plain ellipsis truncation

      const inner = document.createElement("span");
      inner.className = "marquee-inner";
      inner.textContent = text;
      el.textContent = "";
      el.appendChild(inner);
      el.classList.add("marquee-active");

      // Scale duration with distance so long titles scroll at a roughly
      // consistent reading speed rather than all taking the same time.
      // Divisor tuned for a leisurely, easy-to-read pace.
      const duration = Math.min(20, Math.max(7, overflowPx / 34));
      el.style.setProperty("--marquee-distance", `-${overflowPx}px`);
      el.style.setProperty("--marquee-duration", `${duration}s`);
      inner.style.animationIterationCount = "infinite";
    });
  }

  const trackCountEl = $("#trackCount");
  const onairLamp = $("#onairLamp");
  const dbOnairLamp = $("#dbOnairLamp");

  const sidebarView = $("#sidebarView");
  const tracksView = $("#tracksView");
  const playerPanelDesktop = $("#playerPanelDesktop");
  const mobilePlaylistsView = $("#mobilePlaylistsView");
  const mobilePlayerView = $("#mobilePlayerView");
  const mobileSettingsView = $("#mobileSettingsView");

  const playlistsListDesktop = $("#playlistsListDesktop");
  const playlistsListMobile = $("#playlistsListMobile");

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
  const importSourcesPanel = $("#importSourcesPanel");
  const trackListEl = $("#trackList");

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
  const dbShuffleBtn = $("#dbShuffleBtn");
  const dbRepeatBtn = $("#dbRepeatBtn");
  const dbVolumeSlider = $("#dbVolumeSlider");
  const headerRadioBtn = $("#headerRadioBtn");
  const headerRadioBtnLabel = $("#headerRadioBtnLabel");

  const tabBtns = $$(".tab-btn");

  // Settings panel (desktop drawer + mobile view)
  const settingsBtn      = $("#settingsBtn");
  const settingsPanel    = $("#settingsPanel");
  const settingsOverlay  = $("#settingsOverlay");
  const settingsCloseBtn = $("#settingsCloseBtn");
  const settingsContentDesktop = $("#settingsContentDesktop");
  const settingsContentMobile  = $("#settingsContentMobile");

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
  // ── Playlist / track accessors ───────────────────────────
  // "view" = what the user is currently browsing/editing
  // "playing" = what is actually producing sound

  function getViewPlaylist() {
    return state.playlists.find((p) => p.id === viewPlaylistId)
      || state.playlists[0];
  }
  function getViewTracks() {
    return getViewPlaylist()?.tracks || [];
  }

  // Kept for backwards-compat with code that adds/edits tracks in
  // the visible list (commitNewTrack, removeTrack, renameTrack, etc.)
  function getActivePlaylist() { return getViewPlaylist(); }

  function getPlayingPlaylist() {
    return state.playlists.find((p) => p.id === playingPlaylistId)
      || state.playlists[0];
  }
  function getTracks() {
    // Playback logic always operates on the playing playlist.
    return getPlayingPlaylist()?.tracks || [];
  }
  function getCurrentTrack() {
    return getTracks().find((t) => t.id === currentTrackId) || null;
  }
  function getCurrentIndex() {
    return getTracks().findIndex((t) => t.id === currentTrackId);
  }
  let _lastPersistFailed = false;
  function persist() {
    state.activePlaylistId = viewPlaylistId; // backwards compat with stored JSON key
    const ok = Storage.save(state);
    if (!ok && !_lastPersistFailed) {
      // Only notify on the *first* failure in a streak, so a persistent
      // quota-exceeded condition doesn't spam a toast on every action.
      showToast(
        "保存容量の上限に達したため変更を保存できませんでした。不要なトラックやプレイリストを削除してください。",
        { duration: 6000, icon: "warning" }
      );
    }
    _lastPersistFailed = !ok;
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
    if (t.service === "spotify_track" || t.service === "spotify_episode") return "spotify";
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

    // Compute per-platform effective volume
    const volYT      = Math.min(1, volume * (appSettings.vol_youtube ?? 1));
    const volAudio   = Math.min(1, volume * (appSettings.vol_podcast ?? 1));
    const volSpotify = Math.min(1, volume * (appSettings.vol_spotify ?? 1));

    if (t.service === "youtube") {
      AudioEngine.pause();
      if (SpotifyEngine.isReady) SpotifyEngine.pause();
      if (ytHostEl) {
        YouTubeEngine.load(ytHostEl, t.sourceId, volYT, playing);
      }
    } else if (t.service === "direct_audio") {
      YouTubeEngine.destroy();
      if (SpotifyEngine.isReady) SpotifyEngine.pause();
      AudioEngine.load(t.sourceId, volAudio, playing);
    } else if (t.service === "spotify_track" || t.service === "spotify_episode") {
      YouTubeEngine.destroy();
      AudioEngine.pause();
      if (!SpotifyAuth.isLoggedIn()) {
        showToast("Spotifyにログインしていません。ヘッダーの「Spotifyでログイン」から認証してください");
        return;
      }
      const spotifyType = t.service === "spotify_episode" ? "episode" : "track";
      SpotifyEngine.load(t.sourceId, volSpotify, playing, spotifyType);
    }
  }

  YouTubeEngine.onEnded(() => handleTrackEnded());
  YouTubeEngine.onError((msg) => showToast(msg, { duration: 5000, icon: "warning" }));
  AudioEngine.onEnded(() => handleTrackEnded());
  AudioEngine.onError((msg) => showToast(msg, { duration: 5000, icon: "warning" }));
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
  SpotifyEngine.onError((msg) => showToast(msg, { duration: 5000, icon: "warning" }));
  SpotifyEngine.onNotPremium(() => { renderSpotifyAuthUI(); showToast("Spotify Premiumアカウントが必要です", { duration: 5000, icon: "warning" }); });

  AudioEngine.onPlayBlocked(() => {
    // play() was rejected (autoplay policy, likely backgrounded tab).
    // Set a flag so visibilitychange can resume when the user returns.
    if (document.hidden) {
      wasPlayingBeforeHide = true;
    }
  });

  /* Position polling — used to update the progress bar UI.
     YouTube has no timeupdate event, so we poll.
     Spotify end-detection is handled in player_state_changed (event-driven,
     works in background tabs). We still poll here for the progress bar. */
  let ytPollTimer = null;
  function startYtPoll() {
    clearInterval(ytPollTimer);
    ytPollTimer = setInterval(() => {
      const engine = activeEngine();
      if (engine === "youtube" && playing && !popoutActive) {
        position = YouTubeEngine.getCurrentTime();
        duration = YouTubeEngine.getDuration() || duration;
        renderTransport();
      } else if (engine === "spotify" && playing) {
        SpotifyEngine.pollForProgress().then((s) => {
          if (!s) return;
          position = s.position;
          duration = s.duration || duration;
          renderTransport();
        });
      }
    }, 500);
  }
  startYtPoll();

  /**
   * Fetch all videos in a YouTube playlist via the Cloudflare Worker proxy.
   * Worker endpoint:  GET {workerUrl}/playlist?id={playlistId}
   * Response JSON:    { playlistTitle, videos: [{id, title, channelTitle}] }
   */
  async function fetchYouTubePlaylist(playlistId, workerUrl) {
    const base = workerUrl.replace(/\/$/, "");
    const endpoint = `${base}/playlist?id=${encodeURIComponent(playlistId)}`;
    let res;
    try {
      res = await fetch(endpoint);
    } catch (e) {
      throw new Error(`Workerへの接続に失敗しました（${e.message}）`);
    }
    if (!res.ok) {
      let detail = "";
      try { const j = await res.json(); detail = j.error || ""; } catch {}
      throw new Error(`Worker エラー（HTTP ${res.status}）${detail ? ": " + detail : ""}`);
    }
    const data = await res.json();
    if (!data.videos?.length) {
      throw new Error("プレイリストに動画が見つかりませんでした（非公開の可能性があります）");
    }
    return data;
  }

  /**
   * Fetch all uploaded videos for a YouTube channel via the Cloudflare
   * Worker proxy.
   * Worker endpoint:  GET {workerUrl}/channel?handle={handle}  OR  ?id={channelId}
   * Response JSON:    { channelId, channelTitle, videos: [{id, title, channelTitle}] }
   */
  async function fetchYouTubeChannel(channelRef, workerUrl) {
    const base = workerUrl.replace(/\/$/, "");
    const param = channelRef.type === "id"
      ? `id=${encodeURIComponent(channelRef.value)}`
      : `handle=${encodeURIComponent(channelRef.value)}`;
    const endpoint = `${base}/channel?${param}`;
    let res;
    try {
      res = await fetch(endpoint);
    } catch (e) {
      throw new Error(`Workerへの接続に失敗しました（${e.message}）`);
    }
    if (!res.ok) {
      let detail = "";
      try { const j = await res.json(); detail = j.error || ""; } catch {}
      throw new Error(`Worker エラー（HTTP ${res.status}）${detail ? ": " + detail : ""}`);
    }
    const data = await res.json();
    if (!data.videos?.length) {
      throw new Error("チャンネルに動画が見つかりませんでした");
    }
    return data;
  }

  /* ════════════════════════════════════════════
     Import-source update checking
     ─────────────────────────────────────────
     Re-fetches the current full item list for a tracked import source
     (YouTube playlist / Spotify playlist, album, or show) and returns
     it in the same { collectionName, items: [{sourceId, title, artist,
     service, url}] } shape used by the bulk-import preview, so new
     items can be diffed against source.knownSourceIds.
  ════════════════════════════════════════════ */

  async function fetchCurrentSourceItems(source) {
    switch (source.sourceType) {
      case "youtube_playlist": {
        const workerUrl = appSettings.yt_worker_url || "";
        if (!workerUrl) {
          throw new Error("YouTube Worker URLが未設定です（設定画面で確認してください）");
        }
        const playlistId = source.sourceMeta?.playlistId || Services.extractYouTubePlaylistId(source.sourceUrl);
        const result = await fetchYouTubePlaylist(playlistId, workerUrl);
        return {
          collectionName: result.playlistTitle,
          items: result.videos.map((v) => ({
            service: "youtube",
            sourceId: v.id,
            url: `https://www.youtube.com/watch?v=${v.id}`,
            title: v.title,
            artist: v.channelTitle || "",
          })),
        };
      }
      case "youtube_channel": {
        const workerUrl = appSettings.yt_worker_url || "";
        if (!workerUrl) {
          throw new Error("YouTube Worker URLが未設定です（設定画面で確認してください）");
        }
        // Prefer the stored channelId (stable) over re-parsing the handle
        // from the URL (a handle could theoretically be changed by the
        // channel owner, whereas the channel ID never changes).
        const channelRef = source.sourceMeta?.channelId
          ? { type: "id", value: source.sourceMeta.channelId }
          : Services.extractYouTubeChannelRef(source.sourceUrl);
        if (!channelRef) throw new Error("チャンネルURLを解釈できませんでした");
        const result = await fetchYouTubeChannel(channelRef, workerUrl);
        return {
          collectionName: result.channelTitle,
          items: result.videos.map((v) => ({
            service: "youtube",
            sourceId: v.id,
            url: `https://www.youtube.com/watch?v=${v.id}`,
            title: v.title,
            artist: v.channelTitle || result.channelTitle || "",
          })),
        };
      }
      case "spotify_playlist": {
        if (!SpotifyAuth.isLoggedIn()) throw new Error("Spotifyにログインしていません");
        const id = source.sourceMeta?.spotifyId || SpotifyResolver.parseUrl(source.sourceUrl)?.id;
        const result = await SpotifyResolver.resolvePlaylist(id);
        return {
          collectionName: result.collectionName,
          items: result.tracks.map((t) => ({
            service: "spotify_track",
            sourceId: t.trackId,
            url: `https://open.spotify.com/track/${t.trackId}`,
            title: t.title,
            artist: t.artist,
          })),
        };
      }
      case "spotify_album": {
        if (!SpotifyAuth.isLoggedIn()) throw new Error("Spotifyにログインしていません");
        const id = source.sourceMeta?.spotifyId || SpotifyResolver.parseUrl(source.sourceUrl)?.id;
        const result = await SpotifyResolver.resolveAlbum(id);
        return {
          collectionName: result.collectionName,
          items: result.tracks.map((t) => ({
            service: "spotify_track",
            sourceId: t.trackId,
            url: `https://open.spotify.com/track/${t.trackId}`,
            title: t.title,
            artist: t.artist,
          })),
        };
      }
      case "spotify_show": {
        if (!SpotifyAuth.isLoggedIn()) throw new Error("Spotifyにログインしていません");
        const id = source.sourceMeta?.spotifyId || SpotifyResolver.parseUrl(source.sourceUrl)?.id;
        const result = await SpotifyResolver.resolveShow(id);
        return {
          collectionName: result.collectionName,
          items: result.episodes.map((ep) => ({
            service: "spotify_episode",
            sourceId: ep.episodeId,
            url: `https://open.spotify.com/episode/${ep.episodeId}`,
            title: ep.title,
            artist: ep.artist,
          })),
        };
      }
      default:
        throw new Error(`未対応のソース種別です（${source.sourceType}）`);
    }
  }

  /**
   * Check ONE import source for new items.
   * Returns { hasNew: boolean, newItems: [...] } — does not mutate state.
   */
  async function checkImportSourceForUpdates(source) {
    const current = await fetchCurrentSourceItems(source);
    const known = new Set((source.knownSourceIds || []).map(String));
    const newItems = current.items.filter((it) => !known.has(String(it.sourceId)));
    return { hasNew: newItems.length > 0, newItems, collectionName: current.collectionName };
  }

  /**
   * Check ALL import sources across ALL playlists for updates.
   * Used both for the automatic startup/login check and could be reused
   * for a future "check all" button. Errors on individual sources are
   * swallowed (logged) so one broken source doesn't block the others.
   * Returns an array of { playlist, source, newItems, collectionName }
   * for every source that has new items.
   */
  async function checkAllImportSourcesForUpdates() {
    const results = [];
    for (const pl of state.playlists) {
      for (const source of pl.importSources || []) {
        try {
          const { hasNew, newItems, collectionName } = await checkImportSourceForUpdates(source);
          if (hasNew) {
            results.push({ playlist: pl, source, newItems, collectionName });
          }
        } catch (e) {
          console.warn(`Update check failed for "${source.collectionName}":`, e.message);
        }
      }
    }
    return results;
  }

  /**
   * Manual "🔄 更新を確認" button handler for a single import source.
   * Fetches the source, and if new items are found, opens the bulk-import
   * preview modal (pre-filtered to only the new items) so the user can
   * pick which ones to add. If nothing new, shows a toast and does nothing else.
   */
  async function checkSingleSourceManually(playlist, source) {
    showToast(`「${source.collectionName}」を確認中…`);
    try {
      const { hasNew, newItems, collectionName } = await checkImportSourceForUpdates(source);
      if (!hasNew) {
        showToast(`「${source.collectionName}」に新しいトラックはありませんでした`);
        return;
      }
      openBulkImportPreview({
        collectionName: collectionName || source.collectionName,
        serviceLabel: source.serviceLabel || "更新",
        sourceUrl: source.sourceUrl,
        sourceType: source.sourceType,
        sourceMeta: source.sourceMeta,
        items: newItems,
        targetPlaylistId: playlist.id,
        isUpdateCheck: true,
      });
    } catch (e) {
      showToast(`確認に失敗しました: ${e.message || "不明なエラー"}`, { duration: 5000, icon: "warning" });
    }
  }

  /**
   * Automatic startup/login check across all tracked sources.
   * Runs silently in the background; if anything new is found, shows a
   * single toast summarizing the results rather than interrupting the
   * user with a modal immediately. Clicking the toast-triggered banner
   * (via the playlist's own "🔄" button, which will now show a badge)
   * lets the user review and add at their own pace.
   *
   * We deliberately do NOT auto-open the bulk-import modal here — with
   * multiple sources each needing their own confirmation, stacking modals
   * on startup would be intrusive. Instead we surface a single summary
   * and let renderPlaylists() show a "●N" badge next to each updated
   * source so the user can drill in via the manual button.
   */
  let pendingSourceUpdates = []; // [{ playlistId, sourceUrl, newItems, collectionName }]

  async function runAutoUpdateCheck() {
    if (!appSettings.auto_update_check) return; // ユーザー設定でオフ
    if (!state.playlists.some((p) => (p.importSources || []).length > 0)) return; // nothing tracked
    try {
      const results = await checkAllImportSourcesForUpdates();
      pendingSourceUpdates = results.map((r) => ({
        playlistId: r.playlist.id,
        sourceUrl: r.source.sourceUrl,
        newItems: r.newItems,
        collectionName: r.collectionName,
      }));
      if (results.length === 0) return;

      const totalNew = results.reduce((sum, r) => sum + r.newItems.length, 0);
      const sourceWord = results.length === 1
        ? `「${results[0].collectionName}」`
        : `${results.length}件のソース`;
      showToast(`${sourceWord}に新しいトラックが ${totalNew} 件見つかりました（プレイリスト画面の更新ボタンから追加）`, { duration: 6000, icon: "broadcast" });

      renderPlaylists();          // refresh sidebar (in case future use needs it there)
      renderImportSourcesPanel(); // refresh the badge in the import-sources panel
    } catch (e) {
      console.warn("Auto update check failed:", e);
    }
  }

  /** How many new items are pending for a given source, if any. */
  function pendingUpdateCountFor(sourceUrl) {
    const entry = pendingSourceUpdates.find((u) => u.sourceUrl === sourceUrl);
    return entry ? entry.newItems.length : 0;
  }

  /* ════════════════════════════════════════════
     Tab visibility change handling
     ─────────────────────────────────────────
     Problem: when the user switches away from the tab, two things happen:
       1. YouTube's IFrame API auto-pauses. Community reports (e.g.
          https://github.com/katzer/cordova-plugin-background-mode/issues/562)
          indicate this is a Chromium ENGINE-level background-media policy
          for iframed video specifically — not something either PlatHub or
          YouTube's own script can override via JavaScript. Reportedly,
          Firefox/Gecko browsers and Samsung Internet do not enforce this
          the same way, so background continuation may already work there
          without any special handling.
       2. When a track ends and the next track's play() is called while
          backgrounded, the browser may reject it with NotAllowedError
          (browser autoplay policy on background tabs).

     Solution:
       - When the tab becomes HIDDEN: note that we were "playing", and (for
         YouTube specifically) start a periodic "nudge" that keeps calling
         play() once a second. This is a best-effort measure based on a
         community report of partial success — it's a harmless no-op if
         the engine ignores it, but costs nothing to try.
       - When the tab becomes VISIBLE again: if we were playing before
         hiding, resume playback. This works because the visibilitychange
         event fires as a direct result of the user's tab-switch gesture,
         so it counts as user interaction and bypasses autoplay policy.

     Note: Podcast/<audio> playback continues uninterrupted in the background
     by default (HTML5 audio doesn't pause on tab hide). Only YouTube pauses.
  ════════════════════════════════════════════ */
  let wasPlayingBeforeHide = false;
  let pendingNextTrack = null;   // set when next-track play() was rejected while backgrounded
  let backgroundNudgeTimer = null;

  function startBackgroundNudge() {
    stopBackgroundNudge();
    backgroundNudgeTimer = setInterval(() => {
      if (!document.hidden) { stopBackgroundNudge(); return; }
      if (popoutActive) return; // popout has its own independent tab/window — nothing to nudge here
      if (activeEngine() === "youtube" && playing) {
        try { YouTubeEngine.play(); } catch (_) {}
      }
    }, 1000);
  }
  function stopBackgroundNudge() {
    if (backgroundNudgeTimer) { clearInterval(backgroundNudgeTimer); backgroundNudgeTimer = null; }
  }

  document.addEventListener("visibilitychange", () => {
    // While a popout is handling YouTube playback, the MAIN tab's own
    // visibility is irrelevant — the popout is a separate browsing
    // context with its own Page Visibility state. Acting on it here
    // would call play()/pause() on the orphaned main-window iframe,
    // which can create double audio alongside the popout.
    if (popoutActive) return;

    if (document.hidden) {
      // Tab going to background.
      // Always capture the playing state — we need it on return
      // because YouTube will auto-pause itself while backgrounded.
      wasPlayingBeforeHide = playing;
      if (activeEngine() === "youtube" && playing) startBackgroundNudge();
    } else {
      // Tab returning to foreground.
      stopBackgroundNudge();
      if (wasPlayingBeforeHide) {
        // If there's a queued next-track that couldn't start while
        // backgrounded, play it now (this counts as a user gesture).
        if (pendingNextTrack) {
          const track = pendingNextTrack;
          pendingNextTrack = null;
          wasPlayingBeforeHide = false;
          playTrack(track);
          return;
        }

        // YouTube auto-pauses while backgrounded — resume it.
        // (Audio/<audio> keeps playing; Spotify manages via SDK.)
        const engine = activeEngine();
        if (engine === "youtube" && playing) {
          YouTubeEngine.play();
        } else if (engine === "audio" && playing) {
          // In case audio was also blocked (rare but possible)
          AudioEngine.play();
        }
      }
      wasPlayingBeforeHide = false;
    }
  });

  /* ════════════════════════════════════════════
     YouTube "ポップアウト" — background playback workaround
     ─────────────────────────────────────────
     Problem: YouTube's embedded iframe shares the SAME Page Visibility
     state as the tab it's embedded in (per the Page Visibility spec).
     When the main PlatHub tab is backgrounded, the iframe sees itself as
     hidden too, and — independent of anything PlatHub's own code does —
     may stop producing sound. Because this happens inside YouTube's own
     cross-origin iframe, PlatHub cannot detect or override that decision.

     Workaround: play the SAME video in a genuinely separate browsing
     context, which has its OWN, independent Page Visibility state. Two
     mechanisms, tried in order:

       1. Document Picture-in-Picture (Chrome/Edge only) — an always-on-
          top floating window that stays visible over other apps with no
          window-management effort from the user. Preferred when available.
       2. A plain popup window (window.open) — works in every browser,
          but the user has to keep it visible themselves (it doesn't
          float on top automatically).

     Both paths build a FRESH YT.Player inside the new context rather
     than moving the existing, already-playing iframe there. This is a
     deliberate choice: <video>/<audio> elements are documented to keep
     playing when relocated in the DOM, but <iframe> elements are a
     different kind of thing (a nested browsing context) and are well
     documented to reload when moved — so moving the LIVE iframe risks
     an unwanted restart-from-zero. A fresh embed seeked to the current
     position sidesteps that risk entirely, at the cost of a brief
     reload moment when popping out.

     Either way, this is a handoff, not a mirrored sync: while active,
     the MAIN window's YouTube engine is paused (to avoid double audio),
     and the popped-out context becomes the source of truth for playback
     until it's closed or the video ends there.
  ════════════════════════════════════════════ */
  let popoutWindowRef = null;   // window.open() popup, OR the PiP Window instance
  let popoutActive = false;
  let popoutIsPip = false;

  function toggleYoutubePopout() {
    if (popoutActive) {
      closeActivePopout();
      return;
    }

    const t = getCurrentTrack();
    if (!t || t.service !== "youtube") return;

    // NOTE: Document Picture-in-Picture is NOT used here, even though the
    // infrastructure for it exists below (openYoutubePip). Testing showed
    // it's architecturally incompatible with YouTube embeds specifically:
    // YouTube now requires a Referer header to identify the embedding page
    // (see https://developers.google.com/youtube/terms/required-minimum-functionality),
    // but a Document PiP window's document can never be navigated (per
    // spec) — it stays at about:blank forever — so there is no real
    // referring URL for the browser to derive a Referer from, no matter
    // what origin/referrerpolicy values are set on the embedded iframe.
    // This surfaces as YouTube's "Error 153: Video player configuration
    // error" every time, regardless of environment. The popup window path
    // below performs a real navigation and has a valid origin, so it
    // doesn't hit this problem.
    openYoutubePopupWindow(t);
  }

  function closeActivePopout() {
    if (!popoutWindowRef) return;
    try { popoutWindowRef.close(); } catch (_) {}
    // 'pagehide' (PiP) / poll fallback (popup) handles the rest of cleanup.
  }

  /** Path 1: Document Picture-in-Picture (Chrome/Edge). */
  async function openYoutubePip(t) {
    const volYT = Math.min(1, volume * (appSettings.vol_youtube ?? 1));
    const startPosition = Math.floor(position);

    let pipWindow;
    try {
      pipWindow = await documentPictureInPicture.requestWindow({ width: 420, height: 280 });
    } catch (e) {
      showToast("Picture-in-Pictureを開けませんでした。別ウィンドウで開きます。", { duration: 4000, icon: "warning" });
      openYoutubePopupWindow(t);
      return;
    }

    // YouTube's embed requires a Referer header to identify the embedding
    // page (missing it causes "Error 153: embedder.identity.missing.referrer").
    // Since this window is populated via direct DOM injection rather than a
    // normal navigation, its default referrer behavior isn't guaranteed —
    // set an explicit policy up front, before anything else loads.
    const referrerMeta = pipWindow.document.createElement("meta");
    referrerMeta.name = "referrer";
    referrerMeta.content = "strict-origin-when-cross-origin";
    pipWindow.document.head.appendChild(referrerMeta);

    const style = pipWindow.document.createElement("style");
    style.textContent = `
      * { margin:0; padding:0; box-sizing:border-box; }
      html, body { background:#000; height:100%; overflow:hidden; }
      #pipHost { width:100%; height:100%; }
      #pipHost iframe { width:100%; height:100%; border:none; }
    `;
    pipWindow.document.head.appendChild(style);

    const hostDiv = pipWindow.document.createElement("div");
    hostDiv.id = "pipHost";
    pipWindow.document.body.appendChild(hostDiv);

    // Build the <iframe> ourselves (with referrerpolicy/allow set before
    // insertion) rather than letting YT.Player create it — same reasoning
    // as youtube-engine.js: attributes set AFTER the player is ready are
    // too late, since the initial embed request has already gone out.
    const params = new URLSearchParams({
      enablejsapi: "1",
      autoplay: "1",
      controls: "1",
      rel: "0",
      playsinline: "1",
      // NOTE: pipWindow.location.origin is unreliable here — the PiP
      // window is an about:blank document populated via direct DOM
      // injection (never actually navigated; the spec explicitly says
      // Document PiP windows "cannot be navigated"), so its own origin
      // serializes to the string "null". Use the REAL opener page's
      // origin instead, since that's PlatHub's actual, valid origin —
      // passing origin=null was almost certainly the cause of Error 153.
      origin: window.location.origin,
    });
    const iframeEl = pipWindow.document.createElement("iframe");
    iframeEl.src = `https://www.youtube.com/embed/${t.sourceId}?${params.toString()}`;
    iframeEl.width = "100%";
    iframeEl.height = "100%";
    iframeEl.frameBorder = "0";
    iframeEl.allow = "autoplay; encrypted-media; picture-in-picture";
    iframeEl.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    hostDiv.appendChild(iframeEl);

    // Load a FRESH copy of the YouTube IFrame API inside the PiP window's
    // own document, so it gets its own independent `YT` global bound to
    // that window — avoids any cross-window API-object ambiguity.
    pipWindow.onYouTubeIframeAPIReady = () => {
      new pipWindow.YT.Player(iframeEl, {
        events: {
          onReady(e) {
            try { e.target.setVolume(Math.round(volYT * 100)); } catch (_) {}
            if (startPosition > 0) { try { e.target.seekTo(startPosition, true); } catch (_) {} }
            try { e.target.playVideo(); } catch (_) {}
          },
          onStateChange(e) {
            if (e.data === pipWindow.YT.PlayerState.ENDED) {
              closeActivePopout();
              handleTrackEnded();
            }
          },
          onError(e) {
            showToast(`PiP側で再生エラーが発生しました（コード ${e.data}）`, { duration: 5000, icon: "warning" });
          },
        },
      });
    };
    const script = pipWindow.document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    pipWindow.document.body.appendChild(script);

    pipWindow.addEventListener("pagehide", () => {
      handlePopoutClosed(null); // exact resume position isn't tracked back from PiP; safe default
    });

    popoutWindowRef = pipWindow;
    popoutActive = true;
    popoutIsPip = true;
    pauseMainForPopout();
  }

  /** Path 2: plain popup window (window.open) — universal fallback. */
  function openYoutubePopupWindow(t) {
    const volYT = Math.min(1, volume * (appSettings.vol_youtube ?? 1));
    const params = new URLSearchParams({
      v: t.sourceId,
      t: String(Math.floor(position)),
      vol: String(volYT),
      title: t.title || "",
      artist: t.artist || "",
    });
    const popup = window.open(
      `popout.html?${params.toString()}`,
      "plathub_popout",
      "width=340,height=560,popup=1"
    );
    if (!popup) {
      showToast("ポップアウトウィンドウを開けませんでした（ポップアップブロックの可能性があります）", { duration: 5000, icon: "warning" });
      return;
    }

    // Some browsers return a non-null Window synchronously from
    // window.open() even when a popup blocker will silently close it a
    // moment later, without ever actually showing it. Verify it's still
    // genuinely open a beat later, BEFORE committing to popoutActive
    // (hiding the main video, disabling controls, etc.) — otherwise
    // PlatHub's state gets stuck believing a popout is active/visible
    // when nothing ever actually appeared on screen.
    setTimeout(() => {
      if (popup.closed) {
        showToast("ポップアウトウィンドウが開けませんでした（ポップアップブロックの可能性があります）。ブラウザのアドレスバー付近に表示されるブロック通知をご確認ください。", { duration: 6000, icon: "warning" });
        return;
      }

      popoutWindowRef = popup;
      popoutActive = true;
      popoutIsPip = false;
      pauseMainForPopout();

      // Fallback in case the 'closed' message doesn't arrive (e.g. the
      // popup was closed in a way that skips beforeunload in some browsers).
      const closedPoll = setInterval(() => {
        if (!popoutWindowRef || popoutWindowRef.closed) {
          clearInterval(closedPoll);
          handlePopoutClosed(null);
        }
      }, 1000);
    }, 250);
  }

  function pauseMainForPopout() {
    // Pause the main window's copy so we don't hear the same audio twice.
    YouTubeEngine.pause();
    playing = false;
    renderTransport();
    renderPlayerPanels();  // hides the video area, shows the "playing elsewhere" note, dims transport
    renderPlaybackModeUI();
    updateMediaSessionPlaybackState();
    renderPopoutButtonState();
  }

  function handlePopoutClosed(finalPosition) {
    if (!popoutActive) return;
    popoutActive = false;
    popoutIsPip = false;
    popoutWindowRef = null;
    if (finalPosition != null && finalPosition > 0) {
      position = finalPosition;
      try { YouTubeEngine.seekTo(finalPosition); } catch (_) {}
    }
    renderPlayerPanels();  // restores the video area, hides the "playing elsewhere" note
    renderPopoutButtonState();
    showToast("ポップアウトを終了しました。メイン画面から再生を続けられます。");
  }

  function renderPopoutButtonState() {
    [ppDesktop, ppMobile].forEach((pp) => {
      if (!pp || !pp.popoutBtn) return;
      pp.popoutBtn.classList.toggle("active", popoutActive);
      const label = pp.popoutBtn.querySelector("span");
      if (label) label.textContent = popoutActive ? (popoutIsPip ? "PiP再生中…" : "再生中…") : "ポップアウト";
    });
  }

  /**
   * Advances PlatHub's "now playing" state to `track` and routes actual
   * playback to the ALREADY-OPEN popout window (via loadVideoById, so it
   * keeps playing continuously) instead of loading it into the main
   * window's own iframe. Mirrors the relevant parts of playTrack() —
   * state bookkeeping, UI refresh, Media Session — without the parts that
   * would load into (and thus create double audio with) the main iframe,
   * or close the very popout this is meant to keep alive.
   */
  function advancePopoutToTrack(track) {
    currentTrackId = track.id;
    playing = true;
    position = 0; duration = 0; playerError = "";
    pendingNextTrack = null;

    const owningPlaylist = state.playlists.find(
      (p) => p.tracks.some((t) => t.id === track.id)
    );
    if (owningPlaylist) playingPlaylistId = owningPlaylist.id;
    // Don't force the view to follow, same as normal auto-advance —
    // the user may be deliberately browsing a different playlist.

    if (popoutWindowRef && !popoutWindowRef.closed) {
      const volYT = Math.min(1, volume * (appSettings.vol_youtube ?? 1));
      try {
        popoutWindowRef.postMessage({
          source: "plathub-main",
          type: "loadTrack",
          videoId: track.sourceId,
          volume: volYT,
          title: track.title,
          artist: track.artist || "",
        }, window.location.origin);
      } catch (_) {}
    }

    renderAll();
    updateMediaSession(track);
  }

  window.addEventListener("message", (e) => {
    if (e.origin !== window.location.origin) return;
    const data = e.data;
    if (!data || data.source !== "plathub-popout") return;

    if (data.type === "closed") {
      handlePopoutClosed(data.position);
    } else if (data.type === "ended") {
      // The popped-out video finished. Figure out what's next exactly
      // once (nextTrack() advances the shuffle cursor as a side effect,
      // so it must not be called more than once per "ended" event).
      const next = nextTrack(false);
      if (!next) {
        // End of playlist (repeat off, not radio mode) — stop.
        closeActivePopout();
        playing = false;
        position = 0;
        renderTransport();
        updateMediaSessionPlaybackState();
      } else if (next.service === "youtube") {
        // Keep playing continuously in the SAME popout window.
        advancePopoutToTrack(next);
      } else {
        // Next track uses a different engine (Podcast/Spotify/etc.) —
        // the popout can't help with that, so close it and resume
        // normal playback in the main window. closeActivePopout() (not
        // handlePopoutClosed) is used here because it actually calls
        // .close() — handlePopoutClosed only resets state on the
        // assumption the window is already closing, which would also
        // wrongly short-circuit playTrack()'s own popup-closing check.
        closeActivePopout();
        playTrack(next, { syncView: false });
      }
    } else if (data.type === "requestNext") {
      // User pressed Next inside the popout — same lookup as skipNext().
      const next = nextTrack(true);
      if (!next) return;
      if (next.service === "youtube") {
        advancePopoutToTrack(next);
      } else {
        closeActivePopout();
        playTrack(next, { syncView: false });
      }
    } else if (data.type === "requestPrev") {
      // User pressed Prev inside the popout — same "restart if far into
      // the track, else go to the actual previous track" as skipPrev().
      if (typeof data.position === "number" && data.position > 3) {
        if (popoutWindowRef && !popoutWindowRef.closed) {
          try {
            popoutWindowRef.postMessage({ source: "plathub-main", type: "seekLocal" }, window.location.origin);
          } catch (_) {}
        }
        position = 0;
        renderTransport();
        return;
      }
      const prev = computePrevTrack();
      if (!prev) return;
      if (prev.service === "youtube") {
        advancePopoutToTrack(prev);
      } else {
        closeActivePopout();
        playTrack(prev, { syncView: false });
      }
    } else if (data.type === "position") {
      // Keep the main window's (visually inert, but still informative)
      // progress bar and play-state in sync with what's actually
      // audible in the popout. Also defensively re-assert the "video
      // hidden, main engine paused" state on every report — this
      // self-heals within 500ms if anything manages to disturb it.
      if (popoutActive) {
        position = data.position || 0;
        duration = data.duration || 0;
        playing = !!data.playing;
        try { YouTubeEngine.pause(); } catch (_) {}
        renderTransport();
        renderPlayerPanels();
      }
    } else if (data.type === "error") {
      showToast(`ポップアウト側で再生エラーが発生しました（コード ${data.code}）`, { duration: 5000, icon: "warning" });
    }
    // 'ready' is informational only.
  });

  /* ════════════════════════════════════════════
     Media Session API
     ─────────────────────────────────────────
     Registers PlatHub as a proper media player with the browser and OS.
     Benefits:
       1. Keyboard media keys (play/pause/next/prev) work from any tab.
       2. OS notification center shows what's playing (Android, macOS).
       3. Most importantly: accumulates Chrome's Media Engagement Index
          (MEI) score for this origin, which progressively relaxes the
          autoplay policy over time for returning users.
  ════════════════════════════════════════════ */
  function updateMediaSession(track) {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track?.title || "PlatHub",
      artist: track?.artist || "",
      album: "PlatHub",
    });
    navigator.mediaSession.setActionHandler("play",           () => { if (!playing) togglePlayPause(); });
    navigator.mediaSession.setActionHandler("pause",          () => { if (playing)  togglePlayPause(); });
    navigator.mediaSession.setActionHandler("nexttrack",      () => skipNext());
    navigator.mediaSession.setActionHandler("previoustrack",  () => skipPrev());
    navigator.mediaSession.setActionHandler("seekto",         (d) => { if (d.seekTime != null) seekTo(d.seekTime); });
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }

  function updateMediaSessionPlaybackState() {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    if (duration > 0) {
      try {
        navigator.mediaSession.setPositionState({ duration, playbackRate: 1, position });
      } catch (_) {}
    }
  }

  /* ════════════════════════════════════════════
     Playback control actions
  ════════════════════════════════════════════ */

  function playTrack(track, { syncView = true } = {}) {
    // If a YouTube popout is active, it's tied to the PREVIOUS track —
    // close it now that playback is moving on, so it doesn't keep playing
    // a mismatched video in the background.
    if (popoutActive && popoutWindowRef && !popoutWindowRef.closed) {
      popoutWindowRef.close();
      popoutActive = false;
      popoutIsPip = false;
      popoutWindowRef = null;
    }

    currentTrackId = track.id;
    playing = true;
    position = 0; duration = 0; playerError = "";
    pendingNextTrack = null;

    // Find which playlist owns this track and make that the playing playlist.
    const owningPlaylist = state.playlists.find(
      (p) => p.tracks.some((t) => t.id === track.id)
    );
    if (owningPlaylist) {
      playingPlaylistId = owningPlaylist.id;
      // Also sync the view to the playing playlist so the user can
      // immediately see which track is playing in the list.
      // This happens for both user-initiated and auto-started playback.
      if (syncView) viewPlaylistId = owningPlaylist.id;
    }

    if (isMobile()) setMobileTab("player");
    renderAll();
    updateMediaSession(track);

    requestAnimationFrame(() => {
      const hostEl = getVisibleYtHost();
      loadCurrentTrackIntoEngine(hostEl);
    });
  }

  function togglePlayPause() {
    if (!getCurrentTrack()) return;
    // While a popout is actively playing YouTube, it has its own
    // play/pause button — the main window's button is inert to avoid
    // double-controlling the (paused, hidden) main-window iframe.
    if (popoutActive && activeEngine() === "youtube") return;
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
  // We keep an explicit integer cursor (shuffleQueueIndex) into shuffleQueue
  // rather than using indexOf() on every step. This avoids the -1 trap
  // that previously caused constant queue rebuilds and always returning
  // shuffleQueue[1].
  //
  // buildShuffleQueue() uses pure Fisher-Yates — no front-pinning of
  // currentTrackId. Front-pinning (shuffle first, then splice current
  // track to position 0) statistically elevates the probability of the
  // track that happened to land at index 1 after the splice, creating
  // audible bias. Without pinning every slot has exactly equal probability.
  //
  // Cursor starts at -1 ("before the first track"). nextTrack() advances
  // it to 0 on the very first call, so shuffleQueue[0] is the first song.
  let shuffleQueueIndex = -1;

  function buildShuffleQueue() {
    const ids = getTracks().map((t) => t.id);
    // Pure Fisher-Yates — unbiased, every permutation equally likely
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    shuffleQueue = ids;
    // Cursor reset: -1 means "call nextTrack() to get the first song".
    // This is intentional: the caller (toggleRadioMode autostart, or
    // the user pressing ⏭ while shuffle is off then turning it on)
    // will always go through nextTrack() before playing anything.
    shuffleQueueIndex = -1;
  }

  function nextTrack(forceNext = false) {
    const tracks = getTracks();
    if (!tracks.length) return null;

    if (repeatMode === "one" && !forceNext) return getCurrentTrack() || null;

    if (shuffleMode) {
      if (!shuffleQueue.length) buildShuffleQueue();

      const isBeforeStart = shuffleQueueIndex === -1;
      const isLast        = shuffleQueueIndex === shuffleQueue.length - 1;

      if (!isBeforeStart && !radioMode && repeatMode === "none" && isLast) return null;

      if (!isBeforeStart && isLast && (radioMode || repeatMode === "all")) {
        // Full loop done — re-shuffle for a fresh random order.
        const justPlayedId = shuffleQueue[shuffleQueueIndex];
        buildShuffleQueue(); // resets cursor to -1
        // Avoid starting the new loop with the same track that just finished.
        if (shuffleQueue.length > 1 && shuffleQueue[0] === justPlayedId) {
          [shuffleQueue[0], shuffleQueue[1]] = [shuffleQueue[1], shuffleQueue[0]];
        }
        shuffleQueueIndex = 0;
      } else {
        shuffleQueueIndex = Math.max(0, shuffleQueueIndex + 1);
      }

      return tracks.find((t) => t.id === shuffleQueue[shuffleQueueIndex]) || null;
    }

    const idx = getCurrentIndex();
    const next = tracks[idx + 1] || null;
    if (next) return next;
    if (radioMode || repeatMode === "all") return tracks[0];
    return null;
  }

  /** Shared "what's the previous track" lookup (shuffle-aware), used by
   *  both skipPrev() and the popout's requestPrev handler. Does NOT
   *  handle the "restart if position > 3s" case — callers check that first. */
  function computePrevTrack() {
    const tracks = getTracks();
    if (shuffleMode && shuffleQueue.length) {
      const ci = shuffleQueue.indexOf(currentTrackId);
      const pi = (ci - 1 + shuffleQueue.length) % shuffleQueue.length;
      return tracks.find((t) => t.id === shuffleQueue[pi]) || null;
    }
    const idx = getCurrentIndex();
    return idx > 0 ? tracks[idx - 1] : null;
  }

  function skipPrev() {
    if (position > 3) { seekTo(0); return; }
    const prev = computePrevTrack();
    if (prev) playTrack(prev, { syncView: true });
  }

  function skipNext() {
    const next = nextTrack(true);
    if (next) playTrack(next, { syncView: true }); // user pressed skip-next -> sync view
  }

  function handleTrackEnded() {
    const next = nextTrack(false);
    if (!next) {
      playing = false;
      position = 0;
      renderTransport();
      updateMediaSessionPlaybackState();
      return;
    }

    if (document.hidden) {
      pendingNextTrack = next;
      currentTrackId = next.id;
      renderAll();
      updateMediaSession(next);
    } else {
      // Auto-advance: don't force the view to follow — the user may be
      // deliberately browsing another playlist. Only update playingPlaylistId.
      playTrack(next, { syncView: false });
    }
  }

  function toggleShuffle() {
    shuffleMode = !shuffleMode;
    if (shuffleMode) {
      buildShuffleQueue();
    } else {
      shuffleQueue = [];
      shuffleQueueIndex = -1;
    }
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
    // The button's meaning depends on the RELATIONSHIP between what's
    // playing and what's being viewed — not a blind flip of radioMode.
    // See renderRadioUI() for the matching display logic.
    const isActiveForView = radioMode && playingPlaylistId === viewPlaylistId;

    if (isActiveForView) {
      // Genuinely broadcasting the list I'm looking at → turn it off entirely.
      radioMode = false;
      renderRadioUI();
      renderPlaybackModeUI();
      renderOnAir();
      return;
    }

    // Otherwise: (re)start broadcasting the list I'm CURRENTLY VIEWING,
    // regardless of whether something else was already playing/radio-ing.
    // This covers both "RADIO was fully off" and "RADIO was on for a
    // different list" — both cases redirect to the viewed list the same way.
    const viewTracks = getViewTracks();
    if (viewTracks.length === 0) {
      showToast("このリストにはトラックがありません");
      return;
    }

    const switchingList = playingPlaylistId !== viewPlaylistId;
    radioMode = true;
    playingPlaylistId = viewPlaylistId;

    // シャッフル開始設定
    if (appSettings.radio_shuffle_on_start && !shuffleMode) {
      shuffleMode = true;
      persistPlayerPrefs();
    }
    // リストが切り替わった場合はキューを必ず再構築
    if (shuffleMode) {
      buildShuffleQueue(); // cursor → -1
    } else if (switchingList) {
      shuffleQueue = [];
      shuffleQueueIndex = -1;
    }

    // 再生していない、または別リストを再生していた場合は
    // 表示中リストの先頭（シャッフル時はランダム）から開始
    if (!playing || switchingList) {
      const firstTrack = shuffleMode ? nextTrack(false) : viewTracks[0];
      if (firstTrack) playTrack(firstTrack, { syncView: false });
    }

    renderRadioUI();
    renderPlaybackModeUI();
    renderOnAir();
  }

  function seekTo(sec) {
    if (!isFinite(sec) || sec < 0) return;
    const engine = activeEngine();
    if (popoutActive && engine === "youtube") return; // popout has its own seek bar
    if (engine === "youtube") YouTubeEngine.seekTo(sec);
    else if (engine === "audio") AudioEngine.seekTo(sec);
    else if (engine === "spotify") SpotifyEngine.seekTo(sec);
    position = sec;
    renderTransport();
  }

  function setVolumeValue(v) {
    volume = Math.max(0, Math.min(1, v));
    applyPlatformVolumes();
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

    // YouTube プレイリストのみのURL (playlist?list=... で v= なし)
    if (service === "youtube_playlist") {
      const playlistId = Services.extractYouTubePlaylistId(url);
      if (!playlistId) { showAddError("YouTubeプレイリストのURLを確認してください"); return; }
      const workerUrl = appSettings.yt_worker_url || "";
      if (!workerUrl) {
        showAddError(
          "YouTubeプレイリストの一括追加にはCloudflare Workerの設定が必要です。設定画面の「YOUTUBE」→「プレイリスト取得 Worker URL」を入力してください。"
        );
        return;
      }
      setAddTrackLoading(true, "YouTubeプレイリストを取得中…");
      try {
        const result = await fetchYouTubePlaylist(playlistId, workerUrl);
        setAddTrackLoading(false);
        openBulkImportPreview({
          collectionName: result.playlistTitle,
          serviceLabel: "YouTube",
          sourceUrl: url,
          sourceType: "youtube_playlist",
          sourceMeta: { playlistId },
          items: result.videos.map((v) => ({
            service: "youtube",
            sourceId: v.id,
            url: `https://www.youtube.com/watch?v=${v.id}`,
            title: v.title,
            artist: v.channelTitle || "",
          })),
        });
      } catch (e) {
        setAddTrackLoading(false);
        showAddError(e.message || "プレイリストの取得に失敗しました");
      }
      return;
    }

    if (service === "youtube_channel") {
      const channelRef = Services.extractYouTubeChannelRef(url);
      if (!channelRef) { showAddError("YouTubeチャンネルのURLを確認してください"); return; }
      const workerUrl = appSettings.yt_worker_url || "";
      if (!workerUrl) {
        showAddError(
          "YouTubeチャンネルの一括追加にはCloudflare Workerの設定が必要です。設定画面の「YOUTUBE」→「プレイリスト取得 Worker URL」を入力してください。"
        );
        return;
      }
      setAddTrackLoading(true, "YouTubeチャンネルの動画一覧を取得中…");
      try {
        const result = await fetchYouTubeChannel(channelRef, workerUrl);
        setAddTrackLoading(false);
        openBulkImportPreview({
          collectionName: result.channelTitle,
          serviceLabel: "YouTube",
          sourceUrl: url,
          sourceType: "youtube_channel",
          sourceMeta: { channelId: result.channelId },
          items: result.videos.map((v) => ({
            service: "youtube",
            sourceId: v.id,
            url: `https://www.youtube.com/watch?v=${v.id}`,
            title: v.title,
            artist: v.channelTitle || result.channelTitle || "",
          })),
        });
      } catch (e) {
        setAddTrackLoading(false);
        showAddError(e.message || "チャンネルの取得に失敗しました");
      }
      return;
    }

    if (service === "youtube") {
      const vid = Services.extractYouTubeId(url);
      if (!vid) { showAddError("YouTubeのURLを確認してください（例: youtube.com/watch?v=XXXXX）"); return; }

      const manualTitle = addTitleInput.value.trim();
      if (manualTitle) {
        commitNewTrack({ service: "youtube", sourceId: vid, url, title: manualTitle, artist: "" });
        return;
      }

      setAddTrackLoading(true, "YouTubeからタイトルを取得中…");
      try {
        const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
        const res = await fetch(oembedUrl);
        if (res.ok) {
          const data = await res.json();
          commitNewTrack({
            service: "youtube",
            sourceId: vid,
            url,
            title: data.title || `YouTube: ${vid}`,
            artist: data.author_name || "",
          });
        } else {
          commitNewTrack({ service: "youtube", sourceId: vid, url, title: `YouTube: ${vid}`, artist: "" });
        }
      } catch {
        commitNewTrack({ service: "youtube", sourceId: vid, url, title: `YouTube: ${vid}`, artist: "" });
      } finally {
        setAddTrackLoading(false);
      }
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

    if (service === "spotify_episode") {
      if (!SpotifyAuth.isLoggedIn()) { showAddError("先にヘッダーの「Spotifyでログイン」から認証してください"); return; }
      const id = Services.extractSpotifyEpisodeId(url);
      if (!id) { showAddError("Spotifyのエピソード URLを確認してください"); return; }

      setAddTrackLoading(true, "Spotifyからエピソード情報を取得中…");
      try {
        const ep = await SpotifyResolver.resolveEpisode(id);
        commitNewTrack({
          service: "spotify_episode",
          sourceId: ep.episodeId,
          url,
          title: addTitleInput.value.trim() || ep.title,
          artist: ep.artist || "",
        });
      } catch (e) {
        showAddError(e.message || "Spotifyエピソードの取得に失敗しました");
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
        if (parsed.type === "show") {
          // Podcast show — bulk-import all episodes
          const result = await SpotifyResolver.resolveShow(parsed.id);
          setAddTrackLoading(false);
          openBulkImportPreview({
            collectionName: result.collectionName,
            serviceLabel: "Spotify",
            sourceUrl: url,
            sourceType: "spotify_show",
            sourceMeta: { spotifyId: parsed.id },
            items: result.episodes.map((ep) => ({
              service: "spotify_episode",
              sourceId: ep.episodeId,
              url: `https://open.spotify.com/episode/${ep.episodeId}`,
              title: ep.title,
              artist: ep.artist,
            })),
          });
          return;
        }

        const result = parsed.type === "playlist"
          ? await SpotifyResolver.resolvePlaylist(parsed.id)
          : await SpotifyResolver.resolveAlbum(parsed.id);
        setAddTrackLoading(false);
        openBulkImportPreview({
          collectionName: result.collectionName,
          serviceLabel: "Spotify",
          sourceUrl: url,
          sourceType: parsed.type === "playlist" ? "spotify_playlist" : "spotify_album",
          sourceMeta: { spotifyId: parsed.id },
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
    setIcon(btn, "link", "リンクとして追加する");
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

  let bulkImportState = null; // { collectionName, serviceLabel, sourceUrl, sourceType, sourceMeta, items, selected: Set<number> }

  function openBulkImportPreview({ collectionName, serviceLabel, sourceUrl, sourceType, sourceMeta, items, targetPlaylistId, isUpdateCheck = false }) {
    bulkImportState = {
      collectionName, serviceLabel, sourceUrl, sourceType, sourceMeta, items, targetPlaylistId, isUpdateCheck,
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
    const { collectionName, serviceLabel, items, selected, isUpdateCheck } = bulkImportState;

    bulkImportTitleEl.textContent = collectionName;
    bulkImportSubtitleEl.textContent = isUpdateCheck
      ? `${serviceLabel} ・ 新しいトラックが ${items.length} 件あります`
      : `${serviceLabel} ・ ${items.length} 件のトラックが見つかりました`;
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
    const { items, selected, sourceUrl, sourceType, sourceMeta, collectionName, serviceLabel, targetPlaylistId, isUpdateCheck } = bulkImportState;
    const pl = targetPlaylistId
      ? state.playlists.find((p) => p.id === targetPlaylistId) || getActivePlaylist()
      : getActivePlaylist();

    // Skip items that already exist in the target playlist (same service +
    // sourceId), so re-importing an overlapping channel/playlist/show
    // doesn't create duplicate rows for tracks the user already has.
    const existingKeys = new Set(pl.tracks.map((t) => `${t.service}:${t.sourceId}`));
    const toAddAll = items.filter((_, i) => selected.has(i));
    const toAdd = toAddAll.filter((item) => !existingKeys.has(`${item.service}:${item.sourceId}`));
    const skippedCount = toAddAll.length - toAdd.length;

    const newTrackIds = [];
    toAdd.forEach((item) => {
      const trackId = `t${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      pl.tracks.push({
        id: trackId,
        title: item.title,
        artist: item.artist || "",
        service: item.service,
        sourceId: item.sourceId,
        url: item.url,
      });
      newTrackIds.push(trackId);
    });

    // Record (or update) the import source so we can check for new items later.
    // Only trackable sources (YouTube playlist, Spotify playlist/album/show)
    // get a sourceType; ad-hoc podcast feeds etc. are not tracked for now.
    if (sourceUrl && sourceType) {
      registerImportSource(pl, {
        sourceUrl, sourceType, sourceMeta, collectionName, serviceLabel,
        importedTrackIds: newTrackIds,
        // Remember every sourceId we've ever pulled in from this source —
        // including ones the user deselected this time — so a future
        // "check for updates" doesn't re-offer items the user already saw.
        knownSourceIds: items.map((it) => String(it.sourceId)),
      });
    }

    persist();
    closeBulkImportModal();
    removeLinkFallbackBtn();
    renderAll();
    const skippedNote = skippedCount > 0 ? `（${skippedCount}件は既存のため除外）` : "";
    showToast(
      isUpdateCheck
        ? `「${pl.name}」に新しいトラックを ${toAdd.length} 件追加しました${skippedNote}`
        : `${toAdd.length} 件のトラックを追加しました`
    );
  }

  /**
   * Add or merge an import-source record on a playlist.
   * If a record for this sourceUrl already exists (e.g. user re-pasted the
   * same playlist URL), merge the track-id lists rather than duplicating.
   */
  function registerImportSource(playlist, { sourceUrl, sourceType, sourceMeta, collectionName, serviceLabel, importedTrackIds, knownSourceIds }) {
    if (!playlist.importSources) playlist.importSources = [];
    const existing = playlist.importSources.find((s) => s.sourceUrl === sourceUrl);
    if (existing) {
      existing.collectionName = collectionName;
      existing.trackIds = [...new Set([...(existing.trackIds || []), ...importedTrackIds])];
      existing.knownSourceIds = [...new Set([...(existing.knownSourceIds || []), ...knownSourceIds])];
      existing.lastCheckedAt = Date.now();
    } else {
      playlist.importSources.push({
        sourceUrl, sourceType, sourceMeta, collectionName, serviceLabel,
        trackIds: importedTrackIds,
        knownSourceIds,
        lastCheckedAt: Date.now(),
      });
    }
  }

  /**
   * Brief, self-dismissing notification — used for confirmations that
   * happen after the add-form has already been closed (e.g. bulk import),
   * where the inline #addError banner inside the form isn't visible.
   */
  let toastTimer = null;
  function showToast(message, { duration = 3000, icon = null } = {}) {
    clearTimeout(toastTimer);
    if (icon) {
      toastEl.innerHTML = iconMarkup(icon, "icon toast-icon") + `<span>${escapeHtmlText(message)}</span>`;
    } else {
      toastEl.textContent = message;
    }
    toastEl.hidden = false;
    requestAnimationFrame(() => toastEl.classList.add("visible"));
    toastTimer = setTimeout(() => {
      toastEl.classList.remove("visible");
      setTimeout(() => { toastEl.hidden = true; }, 250);
    }, duration);
  }

  function commitNewTrack({ service, sourceId, url, title, artist }) {
    const pl = getActivePlaylist();

    // Warn on exact duplicates (same service + sourceId already in this
    // playlist) — most often an accidental double-paste of the same URL.
    const isDuplicate = pl.tracks.some((t) => t.service === service && t.sourceId === sourceId);
    if (isDuplicate) {
      const ok = window.confirm(`「${title}」は既にこのリストにあります。それでも追加しますか？`);
      if (!ok) return;
    }

    const track = { id: `t${Date.now()}`, title, artist, service, sourceId, url };
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
    const pl = getActivePlaylist();
    if (appSettings.confirm_track_delete) {
      const track = pl.tracks.find((t) => t.id === trackId);
      const ok = window.confirm(`「${track?.title || "このトラック"}」をリストから削除しますか？`);
      if (!ok) return;
    }
    if (currentTrackId === trackId) {
      playing = false;
      currentTrackId = null;
      stopAllEngines();
    }
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
    if (viewPlaylistId === id) return; // already viewing this list

    // Only change what's displayed — never interrupt playback.
    // The playing playlist (playingPlaylistId) and radioMode itself stay
    // untouched here, so a list already broadcasting in the background
    // keeps looping correctly even while the user browses elsewhere.
    // (The RADIO button's displayed ON/OFF state is computed separately
    // in renderRadioUI() based on whether the viewed list matches the
    // playing list — see that function for details.)
    viewPlaylistId = id;
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
    const fallbackId = state.playlists[0].id;

    // If we were viewing the deleted playlist, switch the view
    if (viewPlaylistId === id) viewPlaylistId = fallbackId;

    // If the deleted playlist was playing, stop playback cleanly
    if (playingPlaylistId === id) {
      stopAllEngines();
      playing = false;
      currentTrackId = null;
      playingPlaylistId = fallbackId;
      shuffleQueue = [];
      shuffleQueueIndex = -1;
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
    mobileSettingsView.hidden = tab !== "settings";
    miniBar.hidden = !getCurrentTrack() || tab === "player" || tab === "settings";

    // Keep a YouTube video visible as a small floating box (instead of
    // fully hidden) when browsing a different mobile tab — see the CSS
    // comment on .mini-video-float for why this never moves the iframe.
    const t = getCurrentTrack();
    const showMiniVideo = tab !== "player" && t?.service === "youtube" && !popoutActive;
    mobilePlayerView.classList.toggle("mini-video-float", showMiniVideo);
    // The mini box overlaps the minibar's usual spot — hide the minibar
    // while the floating video is showing so they don't visually collide.
    if (showMiniVideo) miniBar.hidden = true;

    if (tab === "player") {
      ensureMobilePanelMounted();
      renderPlayerPanels();
    }
    if (tab === "settings") {
      renderSettingsPanel();
    }
  }

  /* ── Settings panel (desktop drawer) ── */

  function openSettingsPanel() {
    settingsPanel.hidden = false;
    settingsOverlay.hidden = false;
    // Render after unhiding so the guard in renderSettingsPanel sees the panel as visible
    Settings.render(settingsContentDesktop, { ...appSettings }, (prefs) => {
      appSettings = prefs;
      Settings.save(prefs);
      applyPlatformVolumes();
      invalidateMarqueeCaches();
    });
  }

  function closeSettingsPanel() {
    settingsPanel.hidden = true;
    settingsOverlay.hidden = true;
  }

  function renderSettingsPanel() {
    const onPrefsChange = (prefs) => {
      appSettings = prefs;
      Settings.save(prefs);
      applyPlatformVolumes();
      invalidateMarqueeCaches();
    };
    // Desktop drawer
    if (settingsContentDesktop && !settingsPanel.hidden) {
      Settings.render(settingsContentDesktop, { ...appSettings }, onPrefsChange);
    }
    // Mobile settings tab
    if (settingsContentMobile && !mobileSettingsView.hidden) {
      Settings.render(settingsContentMobile, { ...appSettings }, onPrefsChange);
    }
  }

  /**
   * Apply per-platform volume offsets on top of the master volume.
   * Called whenever master volume changes OR settings are saved.
   */
  function applyPlatformVolumes() {
    const masterVol = volume;
    YouTubeEngine.setVolume(Math.min(1, masterVol * (appSettings.vol_youtube ?? 1)));
    AudioEngine.setVolume(Math.min(1, masterVol * (appSettings.vol_podcast ?? 1)));
    if (SpotifyEngine.isReady) {
      SpotifyEngine.setVolume(Math.min(1, masterVol * (appSettings.vol_spotify ?? 1)));
    }
  }

  /**
   * Clears the cached "already checked" marquee state on all now-playing
   * title/artist display elements. Needed after a settings change that
   * could affect whether a marquee SHOULD be active (currently: the
   * "force_marquee" override) — otherwise applyMarqueeIfNeeded's cache
   * (keyed on text+width) would keep skipping re-evaluation since neither
   * the text nor the element width actually changed.
   */
  function invalidateMarqueeCaches() {
    const els = [dbTitle, dbMetaArtistEl, miniBarTitle];
    if (ppDesktop) els.push(ppDesktop.titleEl, ppDesktop.artistEl);
    if (ppMobile) els.push(ppMobile.titleEl, ppMobile.artistEl);
    els.forEach((el) => {
      if (!el) return;
      delete el.dataset.marqueeKey;
      delete el.dataset.marqueeText;
    });
    renderAll();
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
    // Show the count of the currently playing playlist for context
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
    const isViewing = pl.id === viewPlaylistId;
    const isPlaying = pl.id === playingPlaylistId && currentTrackId;
    const item = document.createElement("div");
    item.className = `playlist-item${isViewing ? " active" : ""}`;

    const info = document.createElement("div");
    info.className = "playlist-info";
    const nameEl = document.createElement("div");
    nameEl.className = "playlist-name";
    if (isPlaying) {
      nameEl.innerHTML = iconMarkup("play", "icon icon-playlist-playing") + escapeHtmlText(pl.name);
    } else {
      nameEl.textContent = pl.name;
    }
    const countEl = document.createElement("div");
    countEl.className = "playlist-count";
    countEl.textContent = `${pl.tracks.length} トラック`;
    info.appendChild(nameEl);
    info.appendChild(countEl);

    item.appendChild(info);

    const editBtn = document.createElement("button");
    editBtn.className = "playlist-icon-btn";
    setIcon(editBtn, "edit");
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      startRenamePlaylist(item, pl, info);
    });
    item.appendChild(editBtn);

    if (state.playlists.length > 1) {
      const delBtn = document.createElement("button");
      delBtn.className = "playlist-icon-btn";
      setIcon(delBtn, "trash");
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
    const pl = getViewPlaylist();
    activePlNameEl.textContent = pl?.name || "";
    activePlCountEl.textContent = `${getViewTracks().length} トラック`;
    renderImportSourcesPanel();
  }

  /**
   * Shows the list of tracked import sources (YouTube playlist / Spotify
   * playlist, album, show) for the currently VIEWED playlist, each with
   * a "🔄 更新を確認" button. If a source has pending updates from the
   * automatic startup check, shows a "●N" badge instead of requiring
   * another fetch.
   */
  function renderImportSourcesPanel() {
    if (!importSourcesPanel) return;
    const pl = getViewPlaylist();
    const sources = pl?.importSources || [];

    if (sources.length === 0) {
      importSourcesPanel.hidden = true;
      importSourcesPanel.innerHTML = "";
      return;
    }

    importSourcesPanel.hidden = false;
    importSourcesPanel.innerHTML = "";

    sources.forEach((source) => {
      const row = document.createElement("div");
      row.className = "import-source-row";

      const info = document.createElement("div");
      info.className = "import-source-info";
      const nameEl = document.createElement("span");
      nameEl.className = "import-source-name";
      nameEl.textContent = source.collectionName;
      const metaEl = document.createElement("span");
      metaEl.className = "import-source-meta";
      metaEl.textContent = `${source.serviceLabel} ・ ${source.trackIds?.length || 0} 件取込済み`;
      info.appendChild(nameEl);
      info.appendChild(metaEl);
      row.appendChild(info);

      const pendingCount = pendingUpdateCountFor(source.sourceUrl);
      if (pendingCount > 0) {
        const badge = document.createElement("span");
        badge.className = "import-source-badge";
        badge.textContent = `+${pendingCount}`;
        badge.title = `新しいトラックが${pendingCount}件あります`;
        row.appendChild(badge);
      }

      const checkBtn = document.createElement("button");
      checkBtn.className = "btn-outline btn-sm import-source-check-btn";
      setIcon(checkBtn, "refresh", "更新を確認");
      checkBtn.addEventListener("click", () => checkSingleSourceManually(pl, source));
      row.appendChild(checkBtn);

      importSourcesPanel.appendChild(row);
    });
  }

  function renderTrackList() {
    const tracks = getViewTracks();
    trackListEl.innerHTML = "";

    if (tracks.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = `<div class="empty-icon">${iconMarkup("radio", "icon icon-empty-state")}</div><div>「+ 追加」からトラックを追加しよう</div>`;
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
    if (active && playing) {
      num.innerHTML = iconMarkup("play", "icon icon-track-playing");
    } else {
      num.textContent = String(idx + 1);
    }
    item.appendChild(num);

    const meta = document.createElement("div");
    meta.className = "track-meta";

    const titleEl = document.createElement("div");
    titleEl.className = "track-title";
    titleEl.textContent = t.title;
    titleEl.title = "ダブルクリックでタイトルを編集";

    // The rename gesture lives on titleEl only.
    // We block click→play by stopping propagation from titleEl on dblclick.
    let renaming = false;
    titleEl.addEventListener("dblclick", (e) => {
      e.stopPropagation(); // prevent item's click handler from firing
      renaming = true;
      startInlineRename(titleEl, t, () => { renaming = false; });
    });

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
    setIcon(removeBtn, "close");
    removeBtn.addEventListener("click", (e) => { e.stopPropagation(); removeTrack(t.id); });
    item.appendChild(removeBtn);

    // Single click on the item plays the track.
    // The rename input's own click handler stops propagation, so
    // clicking inside an active input does NOT re-trigger playback.
    item.addEventListener("click", (e) => {
      if (e.target.classList.contains("track-title-input")) return;
      if (renaming) return; // dblclick in progress — don't play
      playTrack(t);
    });
    return item;
  }

  /**
   * Replace a track title <div> with an <input>, commit on Enter/blur,
   * cancel on Escape.
   */
  function startInlineRename(titleEl, track, onDone) {
    const original = track.title;

    const input = document.createElement("input");
    input.type = "text";
    input.value = original;
    input.className = "track-title-input";

    input.addEventListener("click", (e) => e.stopPropagation());

    let cancelled = false;

    const commit = () => {
      if (cancelled) return;
      onDone && onDone();
      const newTitle = input.value.trim();
      if (newTitle && newTitle !== original) {
        renameTrack(track.id, newTitle);
      } else {
        renderAll();
      }
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter")  { e.preventDefault(); commit(); }
      if (e.key === "Escape") {
        e.preventDefault();
        cancelled = true;
        onDone && onDone();
        renderAll();
      }
    });
    input.addEventListener("blur", commit);

    titleEl.replaceWith(input);
    input.focus();
    input.select();
  }

  function renameTrack(trackId, newTitle) {
    const pl = getActivePlaylist();
    const track = pl.tracks.find((t) => t.id === trackId);
    if (!track) return;
    track.title = newTitle;
    persist();
    renderAll();
    // If this is the currently playing track, update the MediaSession title
    if (trackId === currentTrackId) updateMediaSession(track);
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
    pp.volumeSlider.addEventListener("input", (e) => setVolumeValue(+e.target.value));
    wireSeekableTrack(pp.progressTrack, () => duration, seekTo);
    PlayerPanel.buildWaveform(pp.waveformEl);
    if (pp.popoutBtn) pp.popoutBtn.addEventListener("click", toggleYoutubePopout);

    // Tapping the mini floating video (mobile, non-player tab) jumps back
    // to the full player view. No-op on desktop or when already on the
    // player tab, since there's no float mode to "expand" from there.
    if (pp.ytWrap) {
      pp.ytWrap.addEventListener("click", () => {
        if (pp === ppMobile && mobileTab !== "player") setMobileTab("player");
      });
    }
  }

  function renderPlayerPanels() {
    ensureDesktopPanelMounted();
    if (isMobile() && mobileTab === "player") ensureMobilePanelMounted();

    [ppDesktop, ppMobile].forEach((pp) => {
      if (!pp) return;
      renderPlayerPanelContent(pp);
    });
    renderPopoutButtonState();
  }

  function renderPlayerPanelContent(pp) {
    const t = getCurrentTrack();

    // pp-error is kept hidden — errors are now routed to the toast notification
    pp.errorEl.hidden = true;

    const isYoutubeTrack = !!(t && t.service === "youtube");
    pp.ytWrap.hidden = !isYoutubeTrack || popoutActive;
    pp.waveformEl.hidden = !(t && t.service === "direct_audio");
    if (pp.pipHintEl) pp.pipHintEl.hidden = !isYoutubeTrack || popoutActive;
    if (pp.popoutActiveNote) pp.popoutActiveNote.hidden = !(isYoutubeTrack && popoutActive);

    pp.badgeRow.innerHTML = "";
    if (t) pp.badgeRow.appendChild(Services.badgeEl(t.service));

    applyMarqueeIfNeeded(pp.titleEl, t ? t.title : "トラックを選択して再生");
    applyMarqueeIfNeeded(pp.artistEl, t?.artist || "");

    setIcon(pp.playBtn, playing ? "pause" : "play");
    pp.volumeSlider.value = volume;

    const transportInert = isYoutubeTrack && popoutActive;
    pp.playBtn.classList.toggle("transport-inert", transportInert);
    pp.progressTrack.classList.toggle("transport-inert", transportInert);

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
      // The mobile panel's video is now ALWAYS visually rendered when a
      // YouTube track is active — full-size on the "player" tab, or as a
      // small floating box (.mini-video-float, see CSS) on any other tab.
      // It's never truly display:none anymore, so there's no need to fall
      // back to the desktop panel's hidden host to "keep the iframe alive"
      // — and using the mobile host here ensures the floating box actually
      // shows the playing video, instead of an empty/stale element.
      return ppMobile.ytHost;
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
    updateMediaSessionPlaybackState();
  }

  // Persistent dbMeta children — created once and reused, so their state
  // (including any in-progress marquee animation on the artist span) isn't
  // destroyed by the 500ms position-poll tick calling renderTransportShared()
  // far more often than the track itself actually changes.
  let dbMetaBadgeEl = null;
  let dbMetaArtistEl = null;
  let dbMetaLastService = undefined;

  function renderTransportShared() {
    const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

    // Desktop bottom bar
    dbProgressFill.style.width = `${pct}%`;
    dbProgressHandle.style.left = `${pct}%`;
    dbProgressHandle.classList.toggle("visible", pct > 0);
    dbCurrentTime.textContent = Services.formatTime(position);
    dbDuration.textContent = Services.formatTime(duration);
    setIcon(dbPlayBtn, playing ? "pause" : "play");

    const t = getCurrentTrack();
    applyMarqueeIfNeeded(dbTitle, t ? t.title : "未選択");

    if (!t) {
      dbMeta.innerHTML = "";
      dbMetaBadgeEl = null;
      dbMetaArtistEl = null;
      dbMetaLastService = undefined;
    } else {
      // Only rebuild the badge when the service actually changes —
      // avoids recreating DOM nodes (and disrupting the artist marquee)
      // on every poll tick.
      if (dbMetaLastService !== t.service || !dbMetaBadgeEl || !dbMeta.contains(dbMetaBadgeEl)) {
        dbMeta.innerHTML = "";
        dbMetaBadgeEl = Services.badgeEl(t.service);
        dbMeta.appendChild(dbMetaBadgeEl);
        dbMetaArtistEl = document.createElement("span");
        dbMetaArtistEl.className = "db-meta-artist";
        dbMeta.appendChild(dbMetaArtistEl);
        dbMetaLastService = t.service;
      }
      dbMetaArtistEl.hidden = !t.artist;
      if (t.artist) applyMarqueeIfNeeded(dbMetaArtistEl, t.artist);
    }

    // Mobile minibar — also stays hidden while the floating mini-video is
    // showing (it would otherwise visually overlap the same corner area).
    const isFloatingVideo = mobilePlayerView.classList.contains("mini-video-float");
    miniBar.hidden = !t || (isMobile() && mobileTab === "player") || isFloatingVideo;
    if (t) {
      applyMarqueeIfNeeded(miniBarTitle, t.title);
      miniBarProgressFill.style.width = `${pct}%`;
      setIcon(miniBarPlayBtn, playing ? "pause" : "play");
    }
  }

  function renderTransportInto(pp) {
    const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
    pp.progressFill.style.width = `${pct}%`;
    pp.progressHandle.style.left = `${pct}%`;
    pp.progressHandle.classList.toggle("visible", pct > 0);
    pp.currentTimeEl.textContent = Services.formatTime(position);
    pp.durationEl.textContent = Services.formatTime(duration);
    setIcon(pp.playBtn, playing ? "pause" : "play");
  }

  function renderTrackListActiveMarker() {
    // Lightweight: just re-render the play-icon/number column without full rebuild
    $$(".track-item").forEach((el, i) => {
      const tracks = getViewTracks();
      const t = tracks[i];
      if (!t) return;
      const numEl = el.querySelector(".track-num");
      if (!numEl) return;
      if (t.id === currentTrackId && playing) {
        numEl.innerHTML = iconMarkup("play", "icon icon-track-playing");
      } else {
        numEl.textContent = String(i + 1);
      }
    });
  }

  function renderRadioUI() {
    // The button's displayed state is relative to what's being VIEWED, not
    // just the raw radioMode flag. If RADIO is broadcasting playlist A in
    // the background but the user is currently looking at playlist B, the
    // button shows its default "RADIO" (off-looking) state — pressing it
    // will redirect the broadcast to B (see toggleRadioMode()). This never
    // touches radioMode itself, so A keeps looping correctly in the
    // background the whole time the user is browsing elsewhere.
    const isActiveForView = radioMode && playingPlaylistId === viewPlaylistId;
    if (headerRadioBtnLabel) headerRadioBtnLabel.textContent = isActiveForView ? "ON" : "RADIO";
    if (headerRadioBtn) headerRadioBtn.classList.toggle("active", isActiveForView);

    // Show "◆◆ から連続再生中" hint in the player panels when RADIO is on,
    // so it's clear which playlist is being broadcast even if the user
    // has scrolled or is looking at the mini player. This uses the raw
    // radioMode (not view-relative) since it's meant to reflect the actual
    // background broadcast regardless of what's currently being viewed.
    const playingPl = state.playlists.find((p) => p.id === playingPlaylistId);
    [ppDesktop, ppMobile].forEach((pp) => {
      if (!pp || !pp.playingFromEl) return;
      if (radioMode && playingPl) {
        pp.playingFromEl.hidden = false;
        pp.playingFromLabel.textContent = `「${playingPl.name}」を連続再生中`;
      } else {
        pp.playingFromEl.hidden = true;
      }
    });
  }

  function renderPlaybackModeUI() {
    // Shuffle button — state communicated via the "active" class (accent
    // color), so the icon itself doesn't need an "ON" text suffix.
    [dbShuffleBtn, ...$$(".pp-shuffle")].forEach((el) => {
      if (!el) return;
      setIcon(el, "shuffle");
      el.classList.toggle("active", shuffleMode);
    });

    // Repeat button — three states use three distinct icons rather than
    // appending text, so "repeat one" reads as a single glyph (with a
    // small "1" baked into the icon) instead of an icon + text label.
    const repeatIconMap = { none: "repeat", one: "repeat-one", all: "repeat" };
    [dbRepeatBtn, ...$$(".pp-repeat")].forEach((el) => {
      if (!el) return;
      setIcon(el, repeatIconMap[repeatMode] || "repeat");
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
    // Always enabled — even when not configured, clicking opens the setup dialog.
    spotifyAuthBtn.disabled = false;

    if (!SpotifyAuth.isConfigured()) {
      setIcon(spotifyAuthBtn, "music-note", "Spotify設定");
      spotifyAuthBtn.classList.remove("connected");
      spotifyAuthBtn.title = "クリックしてSpotify Client IDを設定";
      return;
    }
    if (SpotifyAuth.isLoggedIn()) {
      setIcon(spotifyAuthBtn, "dot-filled", "Spotify連携中", "icon icon-connected-dot");
      spotifyAuthBtn.classList.add("connected");
      spotifyAuthBtn.title = "クリックしてログアウト";
    } else {
      setIcon(spotifyAuthBtn, "music-note", "Spotifyでログイン");
      spotifyAuthBtn.classList.remove("connected");
      spotifyAuthBtn.title = "Spotify Premiumアカウントでログイン";
    }
  }

  /** Show a dialog letting the user enter their Spotify Client ID at runtime. */
  function promptForClientId() {
    const current = escapeHtmlText(SpotifyAuth.getClientId());
    const redirectUriSafe = escapeHtmlText(SpotifyAuth.redirectUri());
    const modal = document.createElement("div");
    modal.style.cssText = `
      position:fixed; inset:0; background:rgba(5,5,10,.75); backdrop-filter:blur(3px);
      display:flex; align-items:center; justify-content:center;
      z-index:9000; padding:20px;
    `;
    modal.innerHTML = `
      <div style="background:#0f0f1a; border:1px solid #2a2a3a; border-radius:14px;
                  width:100%; max-width:440px; padding:24px; font-family:Inter,sans-serif;">
        <div style="font-family:'Space Grotesk',sans-serif; font-size:17px; font-weight:700;
                    color:#F5F5F0; margin-bottom:8px;">Spotify Client ID を設定</div>
        <p style="font-size:13px; color:#888; margin:0 0 16px; line-height:1.6;">
          <a href="https://developer.spotify.com/dashboard" target="_blank"
             style="color:#1DB954;">developer.spotify.com/dashboard</a>
          でアプリを作成し、Client ID をコピーして貼り付けてください。<br>
          Redirect URI に <code style="font-size:11px; color:#aaa;">${redirectUriSafe}</code> を登録してください。
        </p>
        <input id="clientIdInput" type="text" placeholder="例: a1b2c3d4e5f6..." value="${current}"
          style="background:#1a1a2a; border:1px solid #2a2a3a; border-radius:8px;
                 color:#F5F5F0; font-size:14px; padding:10px 12px; width:100%;
                 box-sizing:border-box; outline:none; margin-bottom:8px; font-family:Inter,sans-serif;">
        <p id="clientIdError" style="font-size:12px; color:#E94560; margin:0 0 14px; min-height:16px;"></p>
        <div style="display:flex; gap:8px; justify-content:flex-end;">
          <button id="clientIdCancelBtn"
            style="background:none; border:1px solid #2a2a3a; border-radius:8px;
                   color:#888; font-size:13px; padding:8px 16px; cursor:pointer;
                   font-family:'Space Grotesk',sans-serif; font-weight:600;">
            キャンセル
          </button>
          <button id="clientIdSaveBtn"
            style="background:#E94560; border:none; border-radius:8px;
                   color:#fff; font-size:13px; padding:8px 16px; cursor:pointer;
                   font-family:'Space Grotesk',sans-serif; font-weight:600;">
            保存してログイン
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const input = modal.querySelector("#clientIdInput");
    const errEl = modal.querySelector("#clientIdError");

    input.focus();
    input.select();

    const close = () => { modal.remove(); };
    modal.querySelector("#clientIdCancelBtn").addEventListener("click", close);
    modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

    modal.querySelector("#clientIdSaveBtn").addEventListener("click", async () => {
      const val = input.value.trim();
      if (!val) { errEl.textContent = "Client IDを入力してください"; return; }
      // Basic format check: Spotify Client IDs are 32-character hex strings
      if (!/^[0-9a-f]{32}$/i.test(val)) {
        errEl.textContent = "Spotify Client IDは32文字の英数字です。Dashboardからコピーした値をそのまま貼り付けてください";
        return;
      }
      SpotifyAuth.setClientId(val);
      close();
      renderSpotifyAuthUI();
      // Save playback state before leaving the page for OAuth
      savePlaybackSessionIfNeeded();
      try {
        await SpotifyAuth.login();
      } catch (e) {
        showToast(e.message || "ログインを開始できませんでした");
      }
    });

    // Allow Enter key to submit
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") modal.querySelector("#clientIdSaveBtn").click();
      if (e.key === "Escape") close();
    });
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
    if (willShow) {
      setIcon(toggleAddFormBtn, "close", "閉じる");
      addUrlInput.focus();
    } else {
      toggleAddFormBtn.textContent = "+ 追加";
    }
  });
  addTrackBtn.addEventListener("click", addTrack);
  addUrlInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addTrack(); });

  toggleNewPlaylistFormBtn.addEventListener("click", () => {
    const willShow = newPlaylistForm.hidden;
    closeNewPlaylistForms();
    if (willShow) {
      newPlaylistForm.hidden = false;
      toggleNewPlaylistFormBtn.classList.add("active");
      setIcon(toggleNewPlaylistFormBtn, "close", "閉じる");
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
      setIcon(toggleNewPlaylistFormDesktopBtn, "close");
      newPlaylistInputDesktop.focus();
    }
  });
  createPlaylistBtnDesktop.addEventListener("click", () => createPlaylist(newPlaylistInputDesktop));
  newPlaylistInputDesktop.addEventListener("keydown", (e) => { if (e.key === "Enter") createPlaylist(newPlaylistInputDesktop); });

  dbPrevBtn.addEventListener("click", skipPrev);
  dbNextBtn.addEventListener("click", skipNext);
  dbPlayBtn.addEventListener("click", togglePlayPause);
  headerRadioBtn.addEventListener("click", toggleRadioMode);
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

  if (settingsBtn) settingsBtn.addEventListener("click", openSettingsPanel);
  if (settingsCloseBtn) settingsCloseBtn.addEventListener("click", closeSettingsPanel);
  if (settingsOverlay) settingsOverlay.addEventListener("click", closeSettingsPanel);

  if (spotifyAuthBtn) {
    spotifyAuthBtn.addEventListener("click", async () => {
      if (SpotifyAuth.isLoggedIn()) {
        // ログアウト
        SpotifyEngine.disconnect();
        SpotifyAuth.logout();
        renderSpotifyAuthUI();
        showToast("Spotifyからログアウトしました");
        return;
      }
      if (!SpotifyAuth.isConfigured()) {
        // Client ID未設定 → 設定ダイアログを開く
        promptForClientId();
        return;
      }
      // Save playback state before leaving the page for OAuth
      savePlaybackSessionIfNeeded();
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
    if (!popoutActive && getCurrentTrack()?.service === "youtube") {
      const hostEl = getVisibleYtHost();
      if (hostEl && !hostEl.querySelector("iframe")) {
        YouTubeEngine.load(hostEl, getCurrentTrack().sourceId, volume, playing);
      }
    }
  });

  /**
   * Persist just enough state to resume playback after a page navigation
   * (e.g. Spotify OAuth redirect).  Uses sessionStorage so it's cleared
   * automatically when the browser tab is closed.
   */
  function savePlaybackSessionIfNeeded() {
    if (!currentTrackId) return; // nothing to save
    Storage.savePlaybackSession({
      playingPlaylistId,
      currentTrackId,
      position: Math.floor(position),
      wasPlaying: playing,
      shuffleMode,
      repeatMode,
      shuffleQueue,
      shuffleQueueIndex,
    });
  }

  /**
   * Called once on startup.  If we arrive here from a Spotify OAuth
   * callback, restore the track that was playing before the redirect
   * and resume from the saved position.
   */
  function restorePlaybackSession() {
    const session = Storage.loadPlaybackSession();
    if (!session) return;

    // Validate: the playlist and track must still exist
    const pl = state.playlists.find((p) => p.id === session.playingPlaylistId);
    if (!pl) return;
    const track = pl.tracks.find((t) => t.id === session.currentTrackId);
    if (!track) return;

    // Restore state
    playingPlaylistId = session.playingPlaylistId;
    shuffleMode       = session.shuffleMode ?? shuffleMode;
    repeatMode        = session.repeatMode  ?? repeatMode;
    shuffleQueue      = session.shuffleQueue ?? [];
    shuffleQueueIndex = session.shuffleQueueIndex ?? -1;

    // Start playback from the saved position
    currentTrackId = track.id;
    playing        = !!session.wasPlaying;
    position       = session.position || 0;

    renderAll();
    updateMediaSession(track);

    requestAnimationFrame(() => {
      const hostEl = getVisibleYtHost();
      loadCurrentTrackIntoEngine(hostEl);
      // Seek to the saved position after a short delay (engine needs to load)
      if (position > 2) {
        setTimeout(() => seekTo(position), 1500);
      }
    });

    showToast("Spotifyログイン完了。再生を再開します");
  }

  function init() {
    ensureDesktopPanelMounted();
    setMobileTab("tracks");
    renderAll();
    applyPlatformVolumes();

    if (SpotifyAuth.isLoggedIn()) {
      // Warm up the Web Playback SDK, then attempt session restore
      SpotifyEngine.init()
        .then(() => restorePlaybackSession())
        .catch(() => restorePlaybackSession()); // restore even if SDK init fails
    } else {
      restorePlaybackSession(); // non-Spotify session (shouldn't happen, but safe)
    }

    // Check tracked import sources (YouTube playlists, Spotify
    // playlists/albums/shows) for new items. Delayed slightly so it
    // doesn't compete with the initial render and session-restore calls.
    setTimeout(() => { runAutoUpdateCheck(); }, 2000);
  }

  init();
})();
