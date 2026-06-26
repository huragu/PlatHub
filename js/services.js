/* ════════════════════════════════════════════════════════
   services.js — Service detection, badges, formatting
════════════════════════════════════════════════════════ */

const Services = (() => {
  const META = {
    youtube:            { label: "YouTube",  cssClass: "badge-youtube" },
    youtube_playlist:   { label: "YouTube",  cssClass: "badge-youtube" }, // playlist-only URL → bulk import
    spotify_track:      { label: "Spotify",  cssClass: "badge-spotify" },
    spotify_collection: { label: "Spotify",  cssClass: "badge-spotify" },
    direct_audio:       { label: "Podcast",  cssClass: "badge-rss" },
    podcast_feed:       { label: "Podcast",  cssClass: "badge-rss" },
    apple_podcast:      { label: "Podcast",  cssClass: "badge-rss" },
    link:               { label: "Link",     cssClass: "badge-link" },
  };

  /**
   * Decide how to handle a pasted URL.
   *
   * Order matters: most specific first.
   *   1. YouTube           -> play directly via IFrame API
   *   2. Spotify track     -> play directly via Web Playback SDK
   *      (Spotify playlist/album URLs are NOT handled here — they
   *      go through the dedicated "番組/リストをまるごと追加" bulk
   *      flow in app.js, since a single Track row can only represent
   *      one playable item, not a collection.)
   *   3. Apple Podcasts    -> resolve via iTunes Lookup API
   *   4. Direct audio file -> play directly via <audio>
   *   5. Anything else     -> try as a podcast/RSS feed URL.
   *      This is deliberately broad: Omny (*.omnycontent.com/.../podcast.rss),
   *      Anchor, Buzzsprout, Libsyn, self-hosted feeds, etc. all end up
   *      here. We don't try to enumerate every podcast host by domain
   *      name (an endless, fragile list) — instead we attempt to
   *      fetch+parse the URL as RSS/Atom XML when the track is added,
   *      and only fall back to a plain "link" if that fails.
   */
  function detect(url) {
    if (!url) return "link";
    // YouTube: watch, short URL, playlist-only URL (youtube.com/playlist?list=...)
    if (/youtube\.com\/(watch|playlist|shorts)|youtu\.be\//.test(url)) {
      // Has a video ID → single video. Has only list= → playlist collection.
      const hasVideoId = /[?&]v=([A-Za-z0-9_-]{11})/.test(url) || /youtu\.be\/([A-Za-z0-9_-]{11})/.test(url);
      const hasListId  = /[?&]list=([A-Za-z0-9_-]+)/.test(url);
      if (!hasVideoId && hasListId) return "youtube_playlist";
      return "youtube";
    }
    if (/open\.spotify\.com\/track\/|spotify:track:/.test(url)) return "spotify_track";
    if (/open\.spotify\.com\/(playlist|album)\/|spotify:(playlist|album):/.test(url)) return "spotify_collection";
    if (/podcasts\.apple\.com\/.+\/podcast\//.test(url)) return "apple_podcast";
    if (isDirectAudioUrl(url)) return "direct_audio";
    return "podcast_feed";
  }

  function isDirectAudioUrl(url) {
    // Strip query string before checking the extension, since many CDNs
    // append signed tokens (?Expires=...&Signature=...) after the file ext.
    const path = url.split("?")[0].split("#")[0];
    return /\.(mp3|m4a|aac|ogg|opus|wav|flac)$/i.test(path);
  }

  /**
   * Extract a YouTube video ID from a URL.
   */
  function extractYouTubeId(url) {
    const m = url.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  /**
   * Extract a YouTube playlist ID (list= parameter) from a URL.
   */
  function extractYouTubePlaylistId(url) {
    const m = url.match(/[?&]list=([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  }

  /**
   * Extract { podcastId, episodeId } from an Apple Podcasts URL.
   * e.g. https://podcasts.apple.com/jp/podcast/.../id1550243290?i=1000762668663
   * podcastId is required; episodeId is optional (absent = show-level link).
   */
  function extractApplePodcastIds(url) {
    const podcastMatch = url.match(/\/id(\d+)/);
    const episodeMatch = url.match(/[?&]i=(\d+)/);
    if (!podcastMatch) return null;
    return {
      podcastId: podcastMatch[1],
      episodeId: episodeMatch ? episodeMatch[1] : null,
    };
  }

  /**
   * Extract a Spotify track ID from a track URL/URI.
   * For playlist/album URLs, use SpotifyResolver.parseUrl instead.
   */
  function extractSpotifyTrackId(url) {
    const m = url.match(/open\.spotify\.com\/track\/([A-Za-z0-9]+)|spotify:track:([A-Za-z0-9]+)/);
    return m ? (m[1] || m[2]) : null;
  }

  function badgeHTML(service) {
    const meta = META[service] || META.link;
    return `<span class="badge ${meta.cssClass}">${meta.label}</span>`;
  }

  function badgeEl(service) {
    const meta = META[service] || META.link;
    const span = document.createElement("span");
    span.className = `badge ${meta.cssClass}`;
    span.textContent = meta.label;
    return span;
  }

  function formatTime(s) {
    if (!s || isNaN(s) || s <= 0) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  }

  return {
    detect, isDirectAudioUrl, extractYouTubeId, extractYouTubePlaylistId,
    extractApplePodcastIds, extractSpotifyTrackId,
    badgeHTML, badgeEl, formatTime, META,
  };
})();
