const YouTubeEngine = (() => {
  let player = null;
  let hostEl = null;
  let ready = false;
  let pendingPlayState = false;
  let onEndedCb = null;
  let onReadyCb = null;
  let onErrorCb = null;
  let endFired = false;  // guard against double-fire during destroy/reload

  function isApiReady() {
    return !!(window.YT && window.YT.Player);
  }

  function waitForApi(cb) {
    if (isApiReady()) { cb(); return; }
    window.__ytReadyQueue = window.__ytReadyQueue || [];
    window.__ytReadyQueue.push(cb);
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

  function load(el, videoId, volume, autoplay) {
    hostEl = el;
    pendingPlayState = autoplay;
    endFired = false;   // new track — reset the guard
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
            // Explicitly grant the Permissions Policy YouTube's cross-origin
            // iframe needs to autoplay/resume without being blocked by the
            // browser. YT.Player doesn't reliably set this itself, and its
            // absence is a documented cause of blocked programmatic play()
            // calls on cross-origin iframes (e.g. resuming after the tab
            // was backgrounded, or auto-advancing to the next track).
            try {
              const iframeEl = e.target.getIframe?.();
              if (iframeEl) {
                iframeEl.allow = "autoplay; encrypted-media; picture-in-picture";
                // Extra safeguard against YouTube's "Error 153" (missing
                // Referer header) — belt-and-suspenders alongside the
                // document-level <meta name="referrer"> tag.
                iframeEl.referrerPolicy = "strict-origin-when-cross-origin";
              }
            } catch (_) {}
            if (pendingPlayState) {
              try { e.target.playVideo(); } catch (_) {}
            }
            onReadyCb && onReadyCb();
          },
          onStateChange(e) {
            if (e.data === window.YT.PlayerState.ENDED && !endFired) {
              endFired = true;
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
            const msg = messages[e.data];
            if (!msg) return; // ignore unknown/transient codes (e.g. during init)
            // Small delay: if the player recovers and starts playing within
            // 1.5s, the error was transient and we don't surface it.
            setTimeout(() => {
              if (!ready || !player) return; // already destroyed
              try {
                const state = player.getPlayerState();
                // Only show error if not currently playing or buffering
                if (state !== window.YT.PlayerState.PLAYING &&
                    state !== window.YT.PlayerState.BUFFERING) {
                  onErrorCb && onErrorCb(msg);
                }
              } catch (_) {}
            }, 1500);
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
