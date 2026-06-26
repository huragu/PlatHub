/* ════════════════════════════════════════════════════════
   spotify-engine.js — Spotify Web Playback SDK wrapper

   Requires: SpotifyAuth (login state + valid access token)
   Requires: Spotify Premium (Web Playback SDK hard requirement
   from Spotify's side — free accounts get an explicit error
   from the SDK itself, which we surface as-is).

   This engine creates ONE persistent "MIXCAST" device in the
   user's Spotify Connect device list (visible in any Spotify
   app) and controls playback on it via the Web API.
════════════════════════════════════════════════════════ */

const SpotifyEngine = (() => {
  let player = null;
  let deviceId = null;
  let ready = false;
  let pendingTrackUri = null;
  let pendingPlayState = false;
  let lastKnownState = null;
  let endFired = false;

  let onEndedCb = null;
  let onReadyCb = null;
  let onErrorCb = null;
  let onNotPremiumCb = null;

  function isSdkLoaded() {
    return !!(window.Spotify && window.Spotify.Player);
  }

  function waitForSdk() {
    return new Promise((resolve) => {
      if (isSdkLoaded()) { resolve(); return; }
      window.onSpotifyWebPlaybackSDKReady = resolve;
    });
  }

  /**
   * Initialize the SDK player. Call once after Spotify login.
   * Safe to call multiple times (no-ops if already initialized).
   */
  async function init() {
    if (player) return;
    await waitForSdk();

    player = new window.Spotify.Player({
      name: "MIXCAST",
      getOAuthToken: async (cb) => {
        const token = await SpotifyAuth.getValidAccessToken();
        cb(token || "");
      },
      volume: 0.8,
    });

    player.addListener("ready", ({ device_id }) => {
      deviceId = device_id;
      ready = true;
      onReadyCb && onReadyCb();
      if (pendingTrackUri) {
        playUri(pendingTrackUri, pendingPlayState);
        pendingTrackUri = null;
      }
    });

    player.addListener("not_ready", () => { ready = false; });

    player.addListener("initialization_error", ({ message }) => {
      onErrorCb && onErrorCb(`Spotify初期化エラー: ${message}`);
    });
    player.addListener("authentication_error", ({ message }) => {
      onErrorCb && onErrorCb(`Spotify認証エラー: ${message}（再ログインが必要な可能性があります）`);
    });
    player.addListener("account_error", ({ message }) => {
      onNotPremiumCb && onNotPremiumCb();
      onErrorCb && onErrorCb("この機能はSpotify Premiumアカウントが必要です");
    });
    player.addListener("playback_error", ({ message }) => {
      onErrorCb && onErrorCb(`再生エラー: ${message}`);
    });

    player.addListener("player_state_changed", (state) => {
      if (!state) return;
      lastKnownState = state;
      // End-detection runs here — not in a polling timer — so it fires
      // even when the tab is backgrounded and JS timers are throttled.
      checkStateForEnd(state);
    });

    await player.connect();
  }

  /**
   * Play a Spotify track by its ID.
   * @param {string} trackId - Spotify track ID (not full URI)
   */
  async function load(trackId, volume, autoplay) {
    const uri = `spotify:track:${trackId}`;
    endFired = false;
    prevPlaying = false;
    currentTrackUri = uri;
    setVolume(volume);
    if (!ready || !deviceId) {
      pendingTrackUri = uri;
      pendingPlayState = autoplay;
      await init();
      return;
    }
    await playUri(uri, autoplay);
  }

  async function playUri(uri, autoplay) {
    const token = await SpotifyAuth.getValidAccessToken();
    if (!token) { onErrorCb && onErrorCb("Spotifyにログインしていません"); return; }

    try {
      const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ uris: [uri] }),
      });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 403) {
          onNotPremiumCb && onNotPremiumCb();
          onErrorCb && onErrorCb("この機能はSpotify Premiumアカウントが必要です");
        } else {
          onErrorCb && onErrorCb(`再生開始に失敗しました（${body.error?.message || res.status}）`);
        }
        return;
      }
      if (!autoplay) await pause();
    } catch (e) {
      onErrorCb && onErrorCb(`再生開始に失敗しました: ${e.message}`);
    }
  }

  async function play() {
    if (player) await player.resume().catch(() => {});
  }
  async function pause() {
    if (player) await player.pause().catch(() => {});
  }
  async function seekTo(sec) {
    if (player) await player.seek(Math.round(sec * 1000)).catch(() => {});
  }
  async function setVolume(vol) {
    if (player) await player.setVolume(Math.max(0, Math.min(1, vol))).catch(() => {});
  }

  async function getCurrentTime() {
    if (!player) return 0;
    const state = await player.getCurrentState().catch(() => null);
    return state ? state.position / 1000 : 0;
  }
  async function getDuration() {
    if (!player) return 0;
    const state = await player.getCurrentState().catch(() => null);
    return state ? state.duration / 1000 : 0;
  }

  /**
   * Track-end detection state.
   *
   * The SDK has no clean "ended" event, so we infer it from
   * player_state_changed. Crucially, player_state_changed fires
   * via the SDK's internal WebSocket connection, NOT via JS timers,
   * so it works reliably even when the tab is in the background
   * (where setInterval/setTimeout are heavily throttled by browsers).
   *
   * Detection pattern (documented in Spotify SDK issues #35 and #85):
   *   - While playing: paused=false, position>0
   *   - At end:        paused=true,  position≈0, same track URI
   *   - Then again:    paused=true,  position≈0  (second fire, ignored by endFired)
   *
   * We detect the first "paused+position<500ms" event that arrives
   * AFTER we were in a playing state (prevPlaying=true).
   */
  let prevPlaying = false;
  let currentTrackUri = null;

  function checkStateForEnd(state) {
    if (!state || endFired) return;

    const trackUri = state.track_window?.current_track?.uri || null;

    if (
      prevPlaying &&
      state.paused &&
      state.position < 500 &&
      trackUri === currentTrackUri
    ) {
      endFired = true;
      prevPlaying = false;
      onEndedCb && onEndedCb();
      return;
    }

    prevPlaying = !state.paused;

    // Track changed externally (skip in Spotify app, etc.) — reset guards.
    if (trackUri && trackUri !== currentTrackUri) {
      currentTrackUri = trackUri;
      endFired = false;
    }
  }

  /**
   * Called from the 500ms poll loop in app.js — used only for
   * updating the progress bar (position/duration). End detection
   * now lives in player_state_changed so it works in background tabs.
   */
  async function pollForProgress() {
    if (!player) return;
    const state = await player.getCurrentState().catch(() => null);
    if (!state) return;
    return {
      position: state.position / 1000,
      duration: state.duration / 1000,
      paused:   state.paused,
    };
  }

  function disconnect() {
    if (player) { player.disconnect(); player = null; }
    ready = false;
    deviceId = null;
  }

  function onEnded(cb) { onEndedCb = cb; }
  function onReady(cb) { onReadyCb = cb; }
  function onError(cb) { onErrorCb = cb; }
  function onNotPremium(cb) { onNotPremiumCb = cb; }

  return {
    init, load, play, pause, seekTo, setVolume,
    getCurrentTime, getDuration, disconnect, pollForProgress,
    onEnded, onReady, onError, onNotPremium,
    get isReady() { return ready; },
  };
})();
