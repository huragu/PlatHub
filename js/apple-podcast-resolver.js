/* ════════════════════════════════════════════════════════
   apple-podcast-resolver.js
   Resolves an Apple Podcasts episode URL into a playable
   MP3 URL, via two public steps:

   1. iTunes Lookup API (no auth, CORS-friendly)
      https://itunes.apple.com/lookup?id={podcastId}&entity=podcastEpisode
      -> gives us the show's RSS feed URL AND (usually) a
         direct episodeUrl for the specific episode.

   2. If step 1 doesn't yield a direct audio URL for the
      requested episode, fall back to fetching the RSS feed
      itself and matching the episode by Apple's episodeId
      (guid often embeds it) or by title/duration heuristics.

   NOTE: Step 2 depends on the podcast's own server sending
   permissive CORS headers. Many do; some don't. If it fails,
   we surface a clear error rather than silently breaking.
════════════════════════════════════════════════════════ */

const ApplePodcastResolver = (() => {

  async function resolve({ podcastId, episodeId }) {
    // ── Step 1: iTunes Lookup API ──
    const lookupUrl = episodeId
      ? `https://itunes.apple.com/lookup?id=${podcastId}&entity=podcastEpisode&limit=200`
      : `https://itunes.apple.com/lookup?id=${podcastId}`;

    let lookupData;
    try {
      const res = await fetch(lookupUrl);
      if (!res.ok) throw new Error(`iTunes API HTTP ${res.status}`);
      lookupData = await res.json();
    } catch (e) {
      throw new ResolveError(
        "Apple Podcastsの情報取得に失敗しました（iTunes APIに到達できません）",
        e
      );
    }

    if (!lookupData.results || lookupData.results.length === 0) {
      throw new ResolveError("指定されたPodcast/エピソードが見つかりませんでした");
    }

    const showInfo = lookupData.results.find((r) => r.kind === "podcast" || r.wrapperType === "track" && !r.episodeUrl) || lookupData.results[0];
    const feedUrl = showInfo.feedUrl;
    const showTitle = showInfo.collectionName || showInfo.artistName || "Unknown Podcast";

    // Try to find the specific episode directly from lookup results
    if (episodeId) {
      const episode = lookupData.results.find(
        (r) => String(r.trackId) === String(episodeId) && r.episodeUrl
      );
      if (episode) {
        return {
          audioUrl: episode.episodeUrl,
          title: episode.trackName || "Untitled Episode",
          artist: showTitle,
          artwork: episode.artworkUrl160 || episode.artworkUrl60 || null,
        };
      }
    } else {
      // Show-level link (no specific episode) -> just grab the latest episode
      const latest = lookupData.results.find((r) => r.episodeUrl);
      if (latest) {
        return {
          audioUrl: latest.episodeUrl,
          title: latest.trackName || "Untitled Episode",
          artist: showTitle,
          artwork: latest.artworkUrl160 || latest.artworkUrl60 || null,
        };
      }
    }

    // ── Step 2: fall back to fetching the RSS feed directly ──
    if (!feedUrl) {
      throw new ResolveError("このPodcastのRSSフィードURLが取得できませんでした");
    }
    try {
      const resolved = await PodcastFeedResolver.resolve(feedUrl);
      // PodcastFeedResolver already picked the latest episode and a
      // sensible note; just make sure the show name matches what
      // Apple told us (more reliable than the feed's own <title>).
      return { ...resolved, artist: showTitle };
    } catch (e) {
      throw new ResolveError(
        "RSSフィードの取得・解析に失敗しました（配信元がCORSをブロックしている可能性があります）",
        e
      );
    }
  }

  class ResolveError extends Error {
    constructor(message, cause) {
      super(message);
      this.name = "ResolveError";
      this.cause = cause;
    }
  }

  return { resolve, ResolveError };
})();
