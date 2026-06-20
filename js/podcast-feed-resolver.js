/* ════════════════════════════════════════════════════════
   podcast-feed-resolver.js
   Generic resolver for "paste any podcast link" support.

   Handles:
   - Direct RSS 2.0 feed URLs (Omny: .../podcast.rss, Buzzsprout,
     Libsyn, Anchor/Spotify-for-Podcasters, self-hosted feeds, etc.)
   - Atom feeds (rare for podcasts, but some hosts emit them)

   Two entry points:
   - resolve(url)     -> latest single episode (used by "+ 追加")
   - resolveAll(url)  -> every episode in the feed (used by the
                          "番組をまるごと追加" bulk-import feature)

   Strategy:
   1. Fetch the URL as text.
   2. Parse as XML. If it's not parseable XML at all, the URL
      probably isn't a feed -> surface a clear error so the
      track can be added as a plain "Link" instead.
   3. RSS 2.0: look for <item><enclosure url="...">.
      Atom:    look for <entry><link rel="enclosure" href="...">
               or <link type="audio/*">.

   This module is also reused by apple-podcast-resolver.js for
   its own RSS-fallback step, so feed-parsing logic lives in
   exactly one place.
════════════════════════════════════════════════════════ */

const PodcastFeedResolver = (() => {

  class ResolveError extends Error {
    constructor(message, cause) {
      super(message);
      this.name = "ResolveError";
      this.cause = cause;
    }
  }

  /**
   * Fetch + parse a feed URL, returning only the latest playable episode.
   * @param {string} feedUrl
   * @returns {Promise<{audioUrl, title, artist, artwork, note}>}
   */
  async function resolve(feedUrl) {
    const all = await resolveAll(feedUrl, { limit: 1 });
    return { ...all.episodes[0], note: all.episodes.length > 0 && all.totalCount > 1 ? "フィード内の最新エピソードを追加しました" : null };
  }

  /**
   * Fetch + parse a feed URL, returning ALL playable episodes.
   * Used for the "番組をまるごと追加" (add entire show) bulk-import feature.
   * @param {string} feedUrl
   * @param {{limit?: number}} [opts] - optional cap on episode count (newest-first)
   * @returns {Promise<{showTitle, episodes: Array<{audioUrl,title,artist,artwork}>, totalCount}>}
   */
  async function resolveAll(feedUrl, opts = {}) {
    const xmlText = await fetchText(feedUrl);
    const doc = parseXml(xmlText);
    const root = doc.documentElement;

    if (!root) {
      throw new ResolveError("このURLはRSS/Atomフィードとして認識できませんでした");
    }

    const tag = root.tagName.toLowerCase();
    if (tag === "rss" || root.querySelector("channel")) {
      return extractAllRss2(doc, opts);
    }
    if (tag === "feed") {
      return extractAllAtom(doc, opts);
    }
    throw new ResolveError("未対応のフィード形式です（RSS 2.0 / Atom のみ対応）");
  }

  async function fetchText(url) {
    let res;
    try {
      res = await fetch(url, { headers: { Accept: "application/rss+xml, application/xml, text/xml, */*" } });
    } catch (e) {
      throw new ResolveError(
        "フィードの取得に失敗しました（ネットワークエラー、またはCORSで配信元にブロックされた可能性があります）",
        e
      );
    }
    if (!res.ok) {
      throw new ResolveError(`フィードの取得に失敗しました（HTTP ${res.status}）`);
    }
    return res.text();
  }

  function parseXml(xmlText) {
    let doc;
    try {
      doc = new DOMParser().parseFromString(xmlText, "text/xml");
    } catch (e) {
      throw new ResolveError("フィードの解析に失敗しました（不正なXML）", e);
    }
    if (doc.querySelector("parsererror")) {
      throw new ResolveError("フィードの解析に失敗しました（不正なXML、またはこのURLはフィードではありません）");
    }
    return doc;
  }

  /* ── RSS 2.0: extract all episodes ── */
  function extractAllRss2(doc, opts) {
    const channel = doc.querySelector("channel");
    const showTitle = textOf(channel, "title") || "Podcast";
    const items = Array.from(doc.querySelectorAll("item"));
    if (items.length === 0) {
      throw new ResolveError("このフィードにエピソードが見つかりませんでした");
    }

    const limited = opts.limit ? items.slice(0, opts.limit) : items;
    const episodes = [];
    for (const item of limited) {
      const enclosure = item.querySelector("enclosure[url]");
      const audioUrl = enclosure?.getAttribute("url");
      if (!audioUrl) continue; // skip episodes without playable audio (rare, but happens)
      episodes.push({
        audioUrl,
        title: textOf(item, "title") || "Untitled Episode",
        artist: showTitle,
        artwork: findArtwork(channel, item),
      });
    }

    if (episodes.length === 0) {
      throw new ResolveError("再生可能なエピソード（enclosure付き）が見つかりませんでした");
    }

    return { showTitle, episodes, totalCount: items.length };
  }

  /* ── Atom: extract all episodes ── */
  function extractAllAtom(doc, opts) {
    const feedTitle = textOf(doc, "feed > title") || "Podcast";
    const entries = Array.from(doc.querySelectorAll("entry"));
    if (entries.length === 0) {
      throw new ResolveError("このフィードにエピソードが見つかりませんでした");
    }

    const limited = opts.limit ? entries.slice(0, opts.limit) : entries;
    const episodes = [];
    for (const entry of limited) {
      const audioLink =
        entry.querySelector('link[rel="enclosure"]') ||
        Array.from(entry.querySelectorAll("link")).find((l) =>
          (l.getAttribute("type") || "").startsWith("audio/")
        );
      const audioUrl = audioLink?.getAttribute("href");
      if (!audioUrl) continue;
      episodes.push({
        audioUrl,
        title: textOf(entry, "title") || "Untitled Episode",
        artist: feedTitle,
        artwork: null,
      });
    }

    if (episodes.length === 0) {
      throw new ResolveError("再生可能なエピソード（音声リンク付き）が見つかりませんでした");
    }

    return { showTitle: feedTitle, episodes, totalCount: entries.length };
  }

  /* ── helpers ── */
  function textOf(scope, selector) {
    if (!scope) return null;
    const el = selector ? scope.querySelector(selector) : scope;
    return el?.textContent?.trim() || null;
  }

  function findArtwork(channel, item) {
    // iTunes-namespaced <itunes:image href="..."> on item, then channel.
    const itemImg = item.querySelector('image, [*|image]');
    const itemHref = itemImg?.getAttribute?.("href") || itemImg?.textContent;
    if (itemHref) return itemHref;

    const chanImg = channel?.querySelector("image > url");
    if (chanImg?.textContent) return chanImg.textContent.trim();

    const chanItunesImg = channel?.querySelector('[*|image]');
    const chanHref = chanItunesImg?.getAttribute?.("href");
    if (chanHref) return chanHref;

    return null;
  }

  return { resolve, resolveAll, ResolveError };
})();
