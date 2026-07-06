/* ════════════════════════════════════════════════════════
   player-panel.js — Renders the player panel (YT host /
   track info / waveform / controls) into a target container.
   Used for BOTH the desktop right-pane and the mobile
   fullscreen player tab, since their DOM structure is
   generated from the same <template>.
════════════════════════════════════════════════════════ */

const PlayerPanel = (() => {
  const template = document.getElementById("playerPanelTemplate");

  /**
   * Render a fresh panel instance into `container`.
   * Returns an object with references to key elements,
   * scoped to this specific instance (desktop or mobile).
   */
  function mount(container) {
    container.innerHTML = "";
    const frag = template.content.cloneNode(true);
    container.appendChild(frag);

    const root = container;
    return {
      root,
      errorEl: root.querySelector(".pp-error"),
      ytWrap: root.querySelector(".pp-youtube-wrap"),
      ytHost: root.querySelector(".pp-youtube-host"),
      popoutBtn: root.querySelector(".pp-popout-btn"),
      pipHintEl: root.querySelector(".pp-pip-hint"),
      popoutActiveNote: root.querySelector(".pp-popout-active-note"),
      badgeRow: root.querySelector(".pp-badge-row"),
      titleEl: root.querySelector(".pp-track-title"),
      artistEl: root.querySelector(".pp-track-artist"),
      onairEl: root.querySelector(".pp-onair-wrap .onair"),
      waveformEl: root.querySelector(".pp-waveform"),
      shuffleBtn: root.querySelector(".pp-shuffle"),
      prevBtn: root.querySelector(".pp-prev"),
      playBtn: root.querySelector(".pp-play"),
      nextBtn: root.querySelector(".pp-next"),
      repeatBtn: root.querySelector(".pp-repeat"),
      currentTimeEl: root.querySelector(".pp-current"),
      durationEl: root.querySelector(".pp-duration"),
      progressTrack: root.querySelector(".pp-track.progress-track"),
      progressFill: root.querySelector(".pp-fill"),
      progressHandle: root.querySelector(".pp-handle"),
      volumeSlider: root.querySelector(".pp-volume"),
      playingFromEl: root.querySelector(".pp-playing-from"),
      playingFromLabel: root.querySelector(".pp-playing-from-label"),
    };
  }

  function buildWaveform(el, count = 28) {
    el.innerHTML = "";
    for (let i = 0; i < count; i++) {
      const bar = document.createElement("div");
      bar.className = "wave-bar";
      bar.style.height = "14px";
      el.appendChild(bar);
    }
  }

  function animateWaveform(el, playing, t) {
    const bars = el.querySelectorAll(".wave-bar");
    bars.forEach((bar, i) => {
      const h = 12 + Math.sin(i * 0.8 + t * 2) * 10 + (playing ? Math.random() * 8 : 0);
      bar.style.height = `${Math.max(6, h)}px`;
      bar.classList.toggle("playing", playing);
    });
  }

  return { mount, buildWaveform, animateWaveform };
})();
