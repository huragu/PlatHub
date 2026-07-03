/* ════════════════════════════════════════════════════════
   storage.js — LocalStorage persistence layer
════════════════════════════════════════════════════════ */

const Storage = (() => {
  const KEY       = "mixcast_playlists_v1";
  const PREFS_KEY = "mixcast_prefs_v1";

  const SAMPLE_TRACKS = [
    {
      id: "s1", service: "youtube", sourceId: "jfKfPfyJRdk",
      title: "Lo-Fi Study Beats", artist: "ChilledCow",
      url: "https://www.youtube.com/watch?v=jfKfPfyJRdk",
    },
    {
      id: "s2", service: "youtube", sourceId: "4xDzrJKXOOY",
      title: "Synthwave Mix 2025", artist: "Nightwave Plaza",
      url: "https://www.youtube.com/watch?v=4xDzrJKXOOY",
    },
    {
      id: "s3", service: "direct_audio",
      sourceId: "https://www.w3schools.com/html/horse.mp3",
      title: "Sample Podcast Episode", artist: "Demo Feed",
      url: "https://www.w3schools.com/html/horse.mp3",
    },
  ];

  const DEFAULT_STATE = {
    playlists: [
      { id: "pl1", name: "My Mix", tracks: SAMPLE_TRACKS },
      { id: "pl2", name: "Work BGM", tracks: [] },
    ],
    activePlaylistId: "pl1",
  };

  const DEFAULT_PREFS = {
    volume: 0.8,
    shuffle: false,
    repeat: "none",
  };

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return structuredClone(DEFAULT_STATE);
      const parsed = JSON.parse(raw);
      if (!parsed.playlists || !Array.isArray(parsed.playlists)) {
        return structuredClone(DEFAULT_STATE);
      }
      return parsed;
    } catch (e) {
      console.warn("Storage load failed, using defaults:", e);
      return structuredClone(DEFAULT_STATE);
    }
  }

  function save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      console.warn("Storage save failed:", e);
      return false;
    }
  }

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return { ...DEFAULT_PREFS };
      return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
    } catch (e) {
      return { ...DEFAULT_PREFS };
    }
  }

  function savePrefs(prefs) {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (e) {
      console.warn("Prefs save failed:", e);
    }
  }

  /* ── Playback session (sessionStorage) ──
     Saved just before Spotify OAuth redirect so the app can
     resume playback when callback.html redirects back.
     sessionStorage is cleared automatically when the tab closes. */
  const SESSION_KEY = "plathub_playback_session_v1";

  function savePlaybackSession(session) {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {}
  }

  function loadPlaybackSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      sessionStorage.removeItem(SESSION_KEY); // consume once
      return JSON.parse(raw);
    } catch { return null; }
  }

  return { load, save, loadPrefs, savePrefs, savePlaybackSession, loadPlaybackSession };
})();
