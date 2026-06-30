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
    radio_shuffle_on_start: false,
    yt_worker_url:        "",   // Cloudflare Worker URL for YouTube playlist fetch
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

    /* ─ 3. YouTube ─ */
    const ytSection = section("YouTube");

    // Worker URL input for playlist bulk-add
    const ytWorkerRow = el("div", { class: "setting-row setting-row-col" });
    const ytWorkerLabel = el("div", { class: "setting-row-label" }, "プレイリスト取得 Worker URL");
    const ytWorkerDesc = el("div", { class: "setting-row-desc" },
      "YouTubeプレイリストURLを一括追加するためのCloudflare Worker URL。未設定の場合は単曲追加のみ可能です。"
    );
    ytWorkerLabel.appendChild(ytWorkerDesc);

    const ytWorkerWrap = el("div", { class: "setting-text-input-wrap" });
    const ytWorkerInput = el("input");
    ytWorkerInput.type = "text";
    ytWorkerInput.className = "setting-text-input";
    ytWorkerInput.placeholder = "https://your-worker.your-name.workers.dev";
    ytWorkerInput.value = prefs.yt_worker_url || "";
    ytWorkerInput.addEventListener("change", () => {
      prefs.yt_worker_url = ytWorkerInput.value.trim();
      onPrefsChange(prefs);
    });

    ytWorkerWrap.appendChild(ytWorkerInput);
    ytWorkerRow.appendChild(ytWorkerLabel);
    ytWorkerRow.appendChild(ytWorkerWrap);
    ytSection.appendChild(ytWorkerRow);

    ytSection.appendChild(el("div", { class: "setting-guide", html: `
      <p>Cloudflare Worker を使うと、YouTube Data API を安全に呼び出してプレイリストを丸ごと追加できます。</p>
      <p>Worker のコードと設定手順は <code>README.md</code> に記載しています。</p>
    ` }));

    ytSection.appendChild(el("div", { class: "setting-guide", html: `
      <p><strong>広告について</strong> — PlatHubはYouTube公式のIFrame Player APIで再生しているため、
      広告を消す機能はアプリ側には実装できません（YouTube側の仕様上の制約です）。</p>

      <p>広告が出るかどうかには、独立した3つの要因が関わります。</p>

      <p><strong>① 動画自体に広告が入っているか</strong><br>
      埋め込み動画は youtube.com 本体と同じ広告設定を引き継ぎます。チャンネル側が
      その動画で広告を有効にしていなければ、そもそも誰が見ても広告は出ません。</p>

      <p><strong>② YouTube Premiumアカウントでログインしているか</strong><br>
      Premiumはサーバー側で広告を取り除く仕組みのため、ブラウザの設定とは別の話です。
      YouTube公式ヘルプ
      （<a href="https://support.google.com/youtube/answer/7437519" target="_blank" rel="noopener">support.google.com/youtube/answer/7437519</a>）
      では、埋め込み動画で広告が出る場合の対処として「YouTubeのCookieをブロックしていないか確認する」ことが
      案内されています。Premiumアカウントでログイン＋Cookie許可の状態であれば、埋め込みでも
      広告なしになることをYouTube自身が想定しているとみてよさそうです。</p>

      <p style="color:#999;">ただし保証ではありません。YouTube公式コミュニティには「Premium契約中なのに
      埋め込み動画で広告が出る」という報告も複数あり、解消しないケースが実際に存在します。</p>

      <p><strong>③ 広告ブロッカー拡張機能（uBlock Originなど）</strong><br>
      Premiumとは別の、無料の代替手段です。ただしPlatHubの埋め込みプレーヤーで実際に効くかは
      未検証で、YouTube側もブロッカー検出を年々強化しており、検出されると警告や再生停止に
      つながることがあります。安定した方法ではないため積極的にはおすすめしていません。</p>

      <p>Premiumの効果を確認する項目：</p>
      <ul>
        <li>別タブで youtube.com を開き、右上のアカウントがPremium契約のものになっているか</li>
        <li>ブラウザの「サードパーティCookieをブロックする」設定がオフになっているか
        （Chrome: 設定 → プライバシーとセキュリティ → Cookie）</li>
        <li>シークレット/プライベートウィンドウでは反映されにくいため、通常ウィンドウで利用する</li>
      </ul>
    ` }));

    container.appendChild(ytSection);

    /* ─ 4. 使い方 ─ */
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

    /* ─ 5. 利用規約 ─ */
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

    /* ─ 6. 作成者 ─ */
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
