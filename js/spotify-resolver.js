/* ════════════════════════════════════════════════════════
   spotify-resolver.js
   Parses Spotify URLs and fetches track/playlist/album data
   via the Spotify Web API (requires a logged-in user; the Web
   API itself doesn't require Premium, only actual playback does).
════════════════════════════════════════════════════════ */

const SpotifyResolver = (() => {

  class ResolveError extends Error {
    constructor(message, cause) {
      super(message);
      this.name = "ResolveError";
      this.cause = cause;
    }
  }

  /**
   * Parse a Spotify URL into { type, id }.
   * Supports open.spotify.com/{track|playlist|album}/{id} and
   * spotify:{track|playlist|album}:{id} URI form.
   */
  function parseUrl(url) {
    const httpMatch = url.match(/open\.spotify\.com\/(track|playlist|album)\/([A-Za-z0-9]+)/);
    if (httpMatch) return { type: httpMatch[1], id: httpMatch[2] };

    const uriMatch = url.match(/spotify:(track|playlist|album):([A-Za-z0-9]+)/);
    if (uriMatch) return { type: uriMatch[1], id: uriMatch[2] };

    return null;
  }

  function isSpotifyUrl(url) {
    return /open\.spotify\.com\/(track|playlist|album)\//.test(url) ||
           /spotify:(track|playlist|album):/.test(url);
  }

  async function apiFetch(path) {
    const token = await SpotifyAuth.getValidAccessToken();
    if (!token) {
      throw new ResolveError("Spotifyにログインしていません。「Spotifyでログイン」から認証してください");
    }
    const res = await fetch(`https://api.spotify.com/v1${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      if (res.status === 401) {
        throw new ResolveError("Spotifyのログインが切れました。再度ログインしてください");
      }
      const body = await res.json().catch(() => ({}));
      throw new ResolveError(`Spotify APIエラー（${res.status}）: ${body.error?.message || "不明なエラー"}`);
    }
    return res.json();
  }

  function trackToEpisode(track) {
    if (!track || !track.id) return null;
    return {
      trackId: track.id,
      title: track.name || "Unknown Track",
      artist: (track.artists || []).map((a) => a.name).join(", ") || "Unknown Artist",
      artwork: track.album?.images?.[0]?.url || null,
      durationSec: track.duration_ms ? track.duration_ms / 1000 : null,
    };
  }

  /** Resolve a single track URL/URI. */
  async function resolveTrack(id) {
    const track = await apiFetch(`/tracks/${id}`);
    const episode = trackToEpisode(track);
    if (!episode) throw new ResolveError("トラック情報の取得に失敗しました");
    return episode;
  }

  /**
   * Resolve ALL tracks of a playlist (handles pagination — Spotify
   * caps each page at 100 items).
   * @param {string} id - playlist ID
   * @param {{limit?: number}} [opts]
   */
  async function resolvePlaylist(id, opts = {}) {
    const meta = await apiFetch(`/playlists/${id}?fields=name,owner.display_name`);
    const playlistName = meta.name || "Spotify Playlist";

    const tracks = [];
    let nextPath = `/playlists/${id}/tracks?limit=100&fields=next,items(track(id,name,artists,album.images,duration_ms))`;

    while (nextPath) {
      const page = await apiFetch(nextPath);
      for (const item of page.items || []) {
        const episode = trackToEpisode(item.track);
        if (episode) tracks.push(episode);
        if (opts.limit && tracks.length >= opts.limit) break;
      }
      if (opts.limit && tracks.length >= opts.limit) break;
      // `next` from Spotify is a full URL; strip the API base to reuse apiFetch.
      nextPath = page.next ? page.next.replace("https://api.spotify.com/v1", "") : null;
    }

    if (tracks.length === 0) {
      throw new ResolveError("このプレイリストに再生可能なトラックが見つかりませんでした");
    }

    return { collectionName: playlistName, tracks, totalCount: tracks.length };
  }

  /** Resolve ALL tracks of an album. */
  async function resolveAlbum(id, opts = {}) {
    const meta = await apiFetch(`/albums/${id}?fields=name,artists`);
    const albumName = meta.name || "Spotify Album";
    const albumArtist = (meta.artists || []).map((a) => a.name).join(", ");

    const tracks = [];
    let nextPath = `/albums/${id}/tracks?limit=50`;

    while (nextPath) {
      const page = await apiFetch(nextPath);
      for (const t of page.items || []) {
        tracks.push({
          trackId: t.id,
          title: t.name || "Unknown Track",
          artist: (t.artists || []).map((a) => a.name).join(", ") || albumArtist,
          artwork: null, // track-level objects from this endpoint omit album images
          durationSec: t.duration_ms ? t.duration_ms / 1000 : null,
        });
        if (opts.limit && tracks.length >= opts.limit) break;
      }
      if (opts.limit && tracks.length >= opts.limit) break;
      nextPath = page.next ? page.next.replace("https://api.spotify.com/v1", "") : null;
    }

    if (tracks.length === 0) {
      throw new ResolveError("このアルバムにトラックが見つかりませんでした");
    }

    return { collectionName: albumName, tracks, totalCount: tracks.length };
  }

  return { parseUrl, isSpotifyUrl, resolveTrack, resolvePlaylist, resolveAlbum, ResolveError };
})();
