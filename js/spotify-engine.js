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
   * Call periodically (e.g. from the same 500ms poll loop used for
   * YouTube) to detect track completion. Spotify's SDK doesn't fire
   * a clean "ended" event, so we infer it: paused, with position
   * essentially at duration, and we haven't already fired for this track.
   */
  async function pollForEnd() {
    if (!player || endFired) return;
    const state = await player.getCurrentState().catch(() => null);
    if (!state || !state.duration) return;
    const remaining = state.duration - state.position;
    if (state.paused && remaining < 800) {
      endFired = true;
      onEndedCb && onEndedCb();
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
