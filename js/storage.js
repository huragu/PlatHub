/* ════════════════════════════════════════════════════════
   storage.js — LocalStorage persistence layer
════════════════════════════════════════════════════════ */

const Storage = (() => {
  const KEY = "mixcast_playlists_v1";

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
      id: "s3", service: "rss",
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
    } catch (e) {
      console.warn("Storage save failed:", e);
    }
  }

  return { load, save };
})();
