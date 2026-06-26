/* ════════════════════════════════════════════════════════
   audio-engine.js — HTML5 <audio> wrapper for Podcast/MP3
════════════════════════════════════════════════════════ */

const AudioEngine = (() => {
  const audioEl = new Audio();
  audioEl.preload = "auto";

  let onEndedCb = null;
  let onTimeCb = null;
  let onDurationCb = null;
  let onErrorCb = null;
  let onPlayBlockedCb = null;   // fired when play() is rejected (likely autoplay policy)

  audioEl.addEventListener("ended", () => onEndedCb && onEndedCb());
  audioEl.addEventListener("timeupdate", () => {
    onTimeCb && onTimeCb(audioEl.currentTime, audioEl.duration || 0);
  });
  audioEl.addEventListener("loadedmetadata", () => {
    onDurationCb && onDurationCb(audioEl.duration || 0);
  });
  audioEl.addEventListener("error", () => {
    const code = audioEl.error ? audioEl.error.code : 0;
    const messages = {
      1: "再生が中断されました",
      2: "ネットワークエラーで読み込めません",
      3: "デコードに失敗しました（非対応フォーマット）",
      4: "このURLは音声ファイルとして再生できません（CORS制限の可能性）",
    };
    onErrorCb && onErrorCb(messages[code] || "音声の読み込みに失敗しました");
  });

  function load(src, volume, autoplay) {
    audioEl.pause();
    audioEl.src = src;
    audioEl.volume = clamp(volume);
    audioEl.load();
    if (autoplay) {
      audioEl.play().catch((e) => {
        if (e.name === "NotAllowedError") {
          // Browser rejected play() due to autoplay policy (likely backgrounded tab).
          // Don't surface this as a user-facing error; let the app handle it silently.
          onPlayBlockedCb && onPlayBlockedCb();
        } else {
          onErrorCb && onErrorCb(`再生開始に失敗: ${e.message}`);
        }
      });
    }
  }

  function play() {
    if (audioEl.src) {
      audioEl.play().catch((e) => {
        if (e.name === "NotAllowedError") {
          onPlayBlockedCb && onPlayBlockedCb();
        } else {
          onErrorCb && onErrorCb(`再生開始に失敗: ${e.message}`);
        }
      });
    }
  }

  function pause() { audioEl.pause(); }

  function seekTo(sec) { audioEl.currentTime = sec; }

  function setVolume(vol) { audioEl.volume = clamp(vol); }

  function getCurrentTime() { return audioEl.currentTime || 0; }

  function getDuration() { return audioEl.duration || 0; }

  function clamp(v) { return Math.max(0, Math.min(1, v)); }

  function onEnded(cb) { onEndedCb = cb; }
  function onTime(cb) { onTimeCb = cb; }
  function onDuration(cb) { onDurationCb = cb; }
  function onError(cb) { onErrorCb = cb; }
  function onPlayBlocked(cb) { onPlayBlockedCb = cb; }

  return {
    load, play, pause, seekTo, setVolume,
    getCurrentTime, getDuration,
    onEnded, onTime, onDuration, onError, onPlayBlocked,
  };
})();
