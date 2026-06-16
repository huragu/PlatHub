/* ════════════════════════════════════════════════════════
   services.js — Service detection, badges, formatting
════════════════════════════════════════════════════════ */

const Services = (() => {
  const META = {
    youtube: { label: "YouTube", cssClass: "badge-youtube" },
    rss:     { label: "Podcast", cssClass: "badge-rss" },
    link:    { label: "Link",    cssClass: "badge-link" },
  };

  function detect(url) {
    if (!url) return "link";
    if (/youtube\.com\/watch|youtu\.be\//.test(url)) return "youtube";
    if (/\.(mp3|ogg|m4a|opus|wav|aac)(\?|$)/i.test(url)) return "rss";
    if (/podcast|feed|rss/i.test(url)) return "rss";
    return "link";
  }

  function extractYouTubeId(url) {
    const m = url.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
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

  return { detect, extractYouTubeId, badgeHTML, badgeEl, formatTime, META };
})();
