/* ════════════════════════════════════════════════════════
   youtube-engine.js — YouTube IFrame Player API wrapper
   Requires a *visible* DOM host element (YT API rejects
   zero-size / display:none containers in some browsers).
════════════════════════════════════════════════════════ */

const YouTubeEngine = (() => {
  let player = null;
  let hostEl = null;
  let ready = false;
  let pendingPlayState = false;
  let onEndedCb = null;
  let onReadyCb = null;
  let onErrorCb = null;

  function isApiReady() {
    return !!(window.YT && window.YT.Player);
  }

  function waitForApi(cb) {
    if (isApiReady()) { cb(); return; }
    window.__ytReadyQueue = window.__ytReadyQueue || [];
    window.__ytReadyQueue.push(cb);
    // The iframe_api script tag in index.html will eventually call this.
    if (!window.onYouTubeIframeAPIReady) {
      window.onYouTubeIframeAPIReady = () => {
        (window.__ytReadyQueue || []).forEach((fn) => fn());
        window.__ytReadyQueue = [];
      };
    }
  }

  function destroy() {
    if (player) {
      try { player.destroy(); } catch (_) {}
      player = null;
    }
    ready = false;
  }

  /**
   * Load (or reload) a video into the given host element.
   * @param {HTMLElement} el - visible container element
   * @param {string} videoId
   * @param {number} volume - 0..1
   * @param {boolean} autoplay
   */
  function load(el, videoId, volume, autoplay) {
    hostEl = el;
    pendingPlayState = autoplay;
    destroy();

    waitForApi(() => {
      player = new window.YT.Player(el, {
        videoId,
        playerVars: {
          autoplay: autoplay ? 1 : 0,
          controls: 0,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady(e) {
            ready = true;
            try { e.target.setVolume(Math.round(volume * 100)); } catch (_) {}
            if (pendingPlayState) {
              try { e.target.playVideo(); } catch (_) {}
            }
            onReadyCb && onReadyCb();
          },
          onStateChange(e) {
            if (e.data === window.YT.PlayerState.ENDED) {
              onEndedCb && onEndedCb();
            }
          },
          onError(e) {
            const messages = {
              2: "無効な動画IDです",
              5: "HTML5プレーヤーで再生できません",
              100: "動画が見つかりません（削除/非公開）",
              101: "この動画は埋め込みが許可されていません",
              150: "この動画は埋め込みが許可されていません",
            };
            onErrorCb && onErrorCb(messages[e.data] || `YouTubeエラー (code ${e.data})`);
          },
        },
      });
    });
  }

  function play() {
    pendingPlayState = true;
    if (ready && player) { try { player.playVideo(); } catch (_) {} }
  }

  function pause() {
    pendingPlayState = false;
    if (ready && player) { try { player.pauseVideo(); } catch (_) {} }
  }

  function seekTo(sec) {
    if (ready && player) { try { player.seekTo(sec, true); } catch (_) {} }
  }

  function setVolume(vol) {
    if (ready && player) { try { player.setVolume(Math.round(vol * 100)); } catch (_) {} }
  }

  function getCurrentTime() {
    if (ready && player) { try { return player.getCurrentTime() || 0; } catch (_) { return 0; } }
    return 0;
  }

  function getDuration() {
    if (ready && player) { try { return player.getDuration() || 0; } catch (_) { return 0; } }
    return 0;
  }

  function onEnded(cb) { onEndedCb = cb; }
  function onReady(cb) { onReadyCb = cb; }
  function onError(cb) { onErrorCb = cb; }

  return {
    load, destroy, play, pause, seekTo, setVolume,
    getCurrentTime, getDuration,
    onEnded, onReady, onError,
  };
})();
