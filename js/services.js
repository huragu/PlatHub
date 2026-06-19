/* ════════════════════════════════════════════════════════
   services.js — Service detection, badges, formatting
════════════════════════════════════════════════════════ */

const Services = (() => {
  const META = {
    youtube:        { label: "YouTube",  cssClass: "badge-youtube" },
    direct_audio:   { label: "Podcast",  cssClass: "badge-rss" },
    podcast_feed:   { label: "Podcast",  cssClass: "badge-rss" }, // RSS feed -> resolved to direct_audio
    apple_podcast:  { label: "Podcast",  cssClass: "badge-rss" }, // resolves via iTunes Lookup -> RSS
    link:           { label: "Link",     cssClass: "badge-link" },
  };

  /**
   * Decide how to handle a pasted URL.
   *
   * Order matters: most specific first.
   *   1. YouTube           -> play directly via IFrame API
   *   2. Apple Podcasts    -> resolve via iTunes Lookup API
   *   3. Direct audio file -> play directly via <audio>
   *   4. Anything else     -> try as a podcast/RSS feed URL.
   *      This is deliberately broad: Omny (*.omnycontent.com/.../podcast.rss),
   *      Spotify show pages, Anchor, Buzzsprout, Libsyn, self-hosted feeds,
   *      etc. all end up here. We don't try to enumerate every podcast
   *      host by domain name (an endless, fragile list) — instead we
   *      attempt to fetch+parse the URL as RSS/Atom XML when the track is
   *      added, and only fall back to a plain "link" if that fails.
   */
  function detect(url) {
    if (!url) return "link";
    if (/youtube\.com\/watch|youtu\.be\//.test(url)) return "youtube";
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

  function extractYouTubeId(url) {
    const m = url.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
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
    detect, isDirectAudioUrl, extractYouTubeId, extractApplePodcastIds,
    badgeHTML, badgeEl, formatTime, META,
  };
})();
