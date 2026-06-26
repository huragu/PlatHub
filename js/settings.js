/* ════════════════════════════════════════════════════════
   settings.js — PlatHub Settings Panel

   Handles:
   - Rendering the settings UI into a target container
   - Per-platform volume sliders
   - Radio / autoplay behavior options
   - About / usage guide / creator links
   - Settings persistence via localStorage

   Called from app.js:  Settings.render(containerEl)
                        Settings.load()   → prefs object
                        Settings.save(prefs)
════════════════════════════════════════════════════════ */

const Settings = (() => {

  const SETTINGS_KEY = "plathub_settings_v1";

  const DEFAULT = {
    vol_youtube:          1.0,
    vol_spotify:          1.0,
    vol_podcast:          1.0,
    radio_autostart:      false,
    radio_shuffle_on_start: false,  // when radio auto-starts, start with shuffle on?
  };

  /* ── Persistence ── */

  function load() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? { ...DEFAULT, ...JSON.parse(raw) } : { ...DEFAULT };
    } catch { return { ...DEFAULT }; }
  }

  function save(prefs) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(prefs));
    } catch (e) { console.warn("Settings save failed:", e); }
  }

  /* ── Helpers ── */

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else node.setAttribute(k, v);
    });
    children.forEach(c => {
      if (typeof c === "string") node.appendChild(document.createTextNode(c));
      else if (c) node.appendChild(c);
    });
    return node;
  }

  function section(title, ...contents) {
    const s = el("div", { class: "setting-section" });
    s.appendChild(el("div", { class: "setting-section-title" }, title));
    contents.forEach(c => s.appendChild(c));
    return s;
  }

  function row(label, control, description) {
    const r = el("div", { class: "setting-row" });
    const left = el("div", { class: "setting-row-label" }, label);
    if (description) {
      const desc = el("div", { class: "setting-row-desc" }, description);
      left.appendChild(desc);
    }
    r.appendChild(left);
    r.appendChild(control);
    return r;
  }

  function volumeSlider(id, value, label, onInput) {
    const wrap = el("div", { class: "setting-vol-wrap" });
    const slider = el("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "1";
    slider.step = "0.05";
    slider.value = String(value);
    slider.className = "volume-slider setting-vol-slider";
    slider.id = id;

    const pct = el("span", { class: "setting-vol-pct" }, Math.round(value * 100) + "%");

    slider.addEventListener("input", () => {
      pct.textContent = Math.round(+slider.value * 100) + "%";
      onInput(+slider.value);
    });

    wrap.appendChild(slider);
    wrap.appendChild(pct);
    return wrap;
  }

  function toggle(id, checked, onChange) {
    const label = el("label", { class: "setting-toggle", for: id });
    const input = el("input");
    input.type = "checkbox";
    input.id = id;
    input.checked = checked;
    input.addEventListener("change", () => onChange(input.checked));
    const knob = el("span", { class: "setting-toggle-knob" });
    label.appendChild(input);
    label.appendChild(knob);
    return label;
  }

  /* ── Main render ── */

  function render(container, prefs, onPrefsChange) {
    container.innerHTML = "";

    /* ─ 1. 音量バランス ─ */
    const volSection = section("音量バランス");

    volSection.appendChild(row(
      "YouTube",
      volumeSlider("vol_youtube", prefs.vol_youtube, "YouTube", v => {
        prefs.vol_youtube = v;
        onPrefsChange(prefs);
      }),
      "マスター音量に対する相対音量"
    ));

    volSection.appendChild(row(
      "Spotify",
      volumeSlider("vol_spotify", prefs.vol_spotify, "Spotify", v => {
        prefs.vol_spotify = v;
        onPrefsChange(prefs);
      })
    ));

    volSection.appendChild(row(
      "Podcast / MP3",
      volumeSlider("vol_podcast", prefs.vol_podcast, "Podcast", v => {
        prefs.vol_podcast = v;
        onPrefsChange(prefs);
      })
    ));

    container.appendChild(volSection);

    /* ─ 2. ラジオ / 自動再生 ─ */
    const radioSection = section("ラジオ / 自動再生");

    radioSection.appendChild(row(
      "RADIO ON 時に自動再生開始",
      toggle("radio_autostart", prefs.radio_autostart, v => {
        prefs.radio_autostart = v;
        onPrefsChange(prefs);
      }),
      "📻 RADIOをオンにしたときに先頭から自動で再生を始める"
    ));

    radioSection.appendChild(row(
      "自動再生をシャッフルで開始",
      toggle("radio_shuffle_on_start", prefs.radio_shuffle_on_start, v => {
        prefs.radio_shuffle_on_start = v;
        onPrefsChange(prefs);
      }),
      "🔀 自動再生開始時にシャッフルをオンにする（「RADIO ON 時に自動再生開始」が有効のとき機能します）"
    ));

    container.appendChild(radioSection);

    /* ─ 3. 使い方 ─ */
    const guideSection = section("使い方");
    guideSection.appendChild(el("div", { class: "setting-guide", html: `
      <p>URLを「+ 追加」欄に貼り付けると、サービスを自動判別して追加します。</p>
      <ul>
        <li><strong>YouTube</strong> — <code>youtube.com/watch?v=…</code> または <code>youtu.be/…</code></li>
        <li><strong>Spotify 単曲</strong> — <code>open.spotify.com/track/…</code>（要ログイン）</li>
        <li><strong>Spotify リスト</strong> — <code>open.spotify.com/playlist/…</code> または <code>/album/…</code>（全曲プレビュー→一括追加）</li>
        <li><strong>Apple Podcasts 番組</strong> — <code>podcasts.apple.com/…</code>（全話プレビュー→一括追加）</li>
        <li><strong>MP3 直リンク</strong> — <code>.mp3 / .m4a / .ogg</code> など</li>
        <li><strong>Podcastフィード</strong> — <code>*.rss</code> 等、任意のRSS/Atomフィード（全話プレビュー→一括追加）</li>
      </ul>
      <p><strong>ラジオモード</strong>（📻）をオンにするとプレイリストをループ再生します。</p>
      <p><strong>シャッフル</strong>（🔀）と<strong>リピート</strong>（🔁）はプレーヤーバー中央のボタンで切り替えられます。</p>
    ` }));
    container.appendChild(guideSection);

    /* ─ 4. 利用規約 ─ */
    const tosSection = section("利用規約");
    tosSection.appendChild(el("div", { class: "setting-guide", html: `
      <p>本アプリは個人利用を目的として作成されています。</p>
      <ul>
        <li>YouTube・Spotify・Apple Podcasts 等の各サービスの利用規約に従って使用してください。</li>
        <li>各サービスのコンテンツの著作権は各権利者に帰属します。</li>
        <li>本アプリは非商用・個人利用のツールです。商用利用や再配布は行わないでください。</li>
        <li>本アプリの使用によって生じたいかなる損害についても、作成者は責任を負いかねます。</li>
        <li>Spotify 連携には Spotify Premium アカウントが必要です（Spotify 社の仕様）。</li>
      </ul>
    ` }));
    container.appendChild(tosSection);

    /* ─ 5. 作成者 ─ */
    const aboutSection = section("作成者");
    aboutSection.appendChild(el("div", { class: "setting-about", html: `
      <div class="setting-creator">
        <div class="setting-creator-name">フラグ神ユーメル</div>
        <div class="setting-creator-links">
          <a href="https://x.com/Huragu_GOD" target="_blank" rel="noopener" class="setting-link">
            𝕏 @Huragu_GOD
          </a>
          <a href="https://huragusin.booth.pm/" target="_blank" rel="noopener" class="setting-link">
            🛍 Booth
          </a>
        </div>
      </div>
      <div class="setting-app-info">
        <span>PlatHub</span>
        <span style="color:#444">—</span>
        <span style="color:#555;">マルチプラットフォーム統合プレーヤー</span>
      </div>
    ` }));
    container.appendChild(aboutSection);
  }

  return { load, save, render, DEFAULT };
})();
