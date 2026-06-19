/* ════════════════════════════════════════════════════════
   podcast-feed-resolver.js
   Generic resolver for "paste any podcast link" support.

   Handles:
   - Direct RSS 2.0 feed URLs (Omny: .../podcast.rss, Buzzsprout,
     Libsyn, Anchor/Spotify-for-Podcasters, self-hosted feeds, etc.)
   - Atom feeds (rare for podcasts, but some hosts emit them)

   Strategy:
   1. Fetch the URL as text.
   2. Parse as XML. If it's not parseable XML at all, the URL
      probably isn't a feed -> surface a clear error so the
      track can be added as a plain "Link" instead.
   3. RSS 2.0: look for <item><enclosure url="...">.
      Atom:    look for <entry><link rel="enclosure" href="...">
               or <link type="audio/*">.
   4. If the feed URL itself contains a fragment/query hinting at
      a specific episode (rare, but some hosts do this), prefer
      that episode; otherwise default to the first (latest) item.

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
   * Fetch + parse a feed URL, returning the playable episode.
   * @param {string} feedUrl
   * @returns {Promise<{audioUrl, title, artist, artwork, note}>}
   */
  async function resolve(feedUrl) {
    const xmlText = await fetchText(feedUrl);
    const doc = parseXml(xmlText);
    const root = doc.documentElement;

    if (!root) {
      throw new ResolveError("このURLはRSS/Atomフィードとして認識できませんでした");
    }

    const tag = root.tagName.toLowerCase();
    if (tag === "rss" || root.querySelector("channel")) {
      return resolveRss2(doc, feedUrl);
    }
    if (tag === "feed") {
      return resolveAtom(doc, feedUrl);
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

  /* ── RSS 2.0 ── */
  function resolveRss2(doc, feedUrl) {
    const channel = doc.querySelector("channel");
    const showTitle = textOf(channel, "title") || "Podcast";
    const items = Array.from(doc.querySelectorAll("item"));
    if (items.length === 0) {
      throw new ResolveError("このフィードにエピソードが見つかりませんでした");
    }

    // Default: most recent episode (RSS convention = newest first).
    const item = items[0];
    const enclosure = item.querySelector("enclosure[url]");
    const audioUrl = enclosure?.getAttribute("url");

    if (!audioUrl) {
      throw new ResolveError("エピソードの音声URL（enclosure）が見つかりませんでした");
    }

    const episodeTitle = textOf(item, "title") || "Untitled Episode";
    const artwork = findArtwork(channel, item);

    return {
      audioUrl,
      title: episodeTitle,
      artist: showTitle,
      artwork,
      note: items.length > 1 ? "フィード内の最新エピソードを追加しました" : null,
    };
  }

  /* ── Atom (rare for podcasts, but handled for completeness) ── */
  function resolveAtom(doc, feedUrl) {
    const feedTitle = textOf(doc, "feed > title") || "Podcast";
    const entries = Array.from(doc.querySelectorAll("entry"));
    if (entries.length === 0) {
      throw new ResolveError("このフィードにエピソードが見つかりませんでした");
    }

    const entry = entries[0];
    const audioLink =
      entry.querySelector('link[rel="enclosure"]') ||
      Array.from(entry.querySelectorAll("link")).find((l) =>
        (l.getAttribute("type") || "").startsWith("audio/")
      );
    const audioUrl = audioLink?.getAttribute("href");

    if (!audioUrl) {
      throw new ResolveError("このAtomフィードに音声リンクが見つかりませんでした");
    }

    const episodeTitle = textOf(entry, "title") || "Untitled Episode";

    return {
      audioUrl,
      title: episodeTitle,
      artist: feedTitle,
      artwork: null,
      note: entries.length > 1 ? "フィード内の最新エピソードを追加しました" : null,
    };
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

  return { resolve, ResolveError };
})();
