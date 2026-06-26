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
   * Track-end detection for Spotify Web Playback SDK.
   *
   * The SDK has no clean "ended" event (open issue since 2018, still
   * unfixed in 2025). The most reliable documented pattern is:
   *
   *   1. Immediately before ending, state.paused === false AND
   *      state.position is close to state.duration.
   *   2. On end: state.paused === true AND state.position === 0.
   *      The current_track URI in track_window stays the same.
   *   3. Shortly after: a second paused+position=0 event fires.
   *
   * We detect "step 2" by watching for paused=true + position<500ms
   * AND we know we were previously playing (prevPlaying flag), AND
   * the current track URI hasn't changed to a new song (which would
   * mean the user skipped, not that the track naturally ended).
   *
   * endFired guards against the double-fire from the two events.
   */
  let prevPlaying = false;
  let currentTrackUri = null;

  async function pollForEnd() {
    if (!player || endFired) return;
    const state = await player.getCurrentState().catch(() => null);
    if (!state) return;

    const trackUri = state.track_window?.current_track?.uri || null;

    // Detect natural end: we were playing, now paused at position ≈ 0,
    // and the track URI is still the one we started (not a user-initiated skip).
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

    // Update tracking state.
    prevPlaying = !state.paused;
    if (trackUri && trackUri !== currentTrackUri) {
      // Track changed externally (user skipped in Spotify app, etc.) —
      // reset end-detection state but don't fire onEnded.
      currentTrackUri = trackUri;
      endFired = false;
    }
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
    getCurrentTime, getDuration, disconnect, pollForEnd,
    onEnded, onReady, onError, onNotPremium,
    get isReady() { return ready; },
  };
})();
