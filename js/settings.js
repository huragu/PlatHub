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
    radio_shuffle_on_start: false,
    auto_update_check:    true,   // 起動時に自動でインポート元の新着をチェックする
    confirm_track_delete: false,  // トラック削除ボタンに確認ダイアログを挟む
    force_marquee:        false,  // OSの「視差効果を減らす」設定を無視してスクロール表示を使う
    yt_worker_url:        "",     // Cloudflare Worker URL for YouTube playlist/channel fetch
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
      "RADIO開始時にシャッフルする",
      toggle("radio_shuffle_on_start", prefs.radio_shuffle_on_start, v => {
        prefs.radio_shuffle_on_start = v;
        onPrefsChange(prefs);
      }),
      "RADIOボタンを押して連続再生を始めるとき、シャッフルもオンにする"
    ));

    container.appendChild(radioSection);

    /* ─ 2.5. 動作設定（オンオフ切替できる機能） ─ */
    const behaviorSection = section("動作設定");

    behaviorSection.appendChild(row(
      "新着の自動チェック",
      toggle("auto_update_check", prefs.auto_update_check, v => {
        prefs.auto_update_check = v;
        onPrefsChange(prefs);
      }),
      "起動時に、追加済みのYouTubeチャンネル・プレイリストやSpotifyの新着を自動確認する（オフにすると「更新を確認」ボタンからの手動チェックのみになります）"
    ));

    behaviorSection.appendChild(row(
      "トラック削除前に確認する",
      toggle("confirm_track_delete", prefs.confirm_track_delete, v => {
        prefs.confirm_track_delete = v;
        onPrefsChange(prefs);
      }),
      "トラックの✕ボタンを押したときに確認ダイアログを表示する（誤操作防止）"
    ));

    behaviorSection.appendChild(row(
      "長い曲名・アーティスト名をスクロール表示",
      toggle("force_marquee", prefs.force_marquee, v => {
        prefs.force_marquee = v;
        onPrefsChange(prefs);
      }),
      "枠に収まらない曲名・アーティスト名を一時的に左右スクロールして全文表示する。お使いの端末で「視差効果を減らす」設定が有効な場合、通常はこの機能を自動的に無効化しますが、ここをオンにすると設定を上書きして使用します。"
    ));

    container.appendChild(behaviorSection);

    /* ─ 4. 使い方 ─ */
    const guideSection = section("使い方");
    guideSection.appendChild(el("div", { class: "setting-guide", html: `
      <p>URLを「+ 追加」欄に貼り付けると、サービスを自動判別して追加します。</p>
      <ul>
        <li><strong>YouTube</strong> — <code>youtube.com/watch?v=…</code> または <code>youtu.be/…</code></li>
        <li><strong>YouTube プレイリスト</strong> — <code>youtube.com/playlist?list=…</code>（全動画プレビュー→一括追加）</li>
        <li><strong>YouTube チャンネル</strong> — <code>youtube.com/@ハンドル名</code> 等（全動画プレビュー→一括追加）</li>
        <li><strong>Spotify 単曲・エピソード</strong> — <code>open.spotify.com/track/…</code> または <code>/episode/…</code>（要ログイン）</li>
        <li><strong>Spotify リスト・番組</strong> — <code>/playlist/…</code>・<code>/album/…</code>・<code>/show/…</code>（全曲プレビュー→一括追加）</li>
        <li><strong>Apple Podcasts 番組</strong> — <code>podcasts.apple.com/…</code>（全話プレビュー→一括追加）</li>
        <li><strong>MP3 直リンク</strong> — <code>.mp3 / .m4a / .ogg</code> など</li>
        <li><strong>Podcastフィード</strong> — <code>*.rss</code> 等、任意のRSS/Atomフィード（全話プレビュー→一括追加）</li>
      </ul>
      <p><strong>RADIO</strong>（${iconMarkup("radio", "icon icon-inline")}）ボタンは、今表示しているリストの連続再生を始めます。
      トラック一覧の見出し右、「+ 追加」の隣にあります。</p>
      <p><strong>シャッフル</strong>（${iconMarkup("shuffle", "icon icon-inline")}）と<strong>リピート</strong>（${iconMarkup("repeat", "icon icon-inline")}）はプレーヤーバー中央のボタンで切り替えられます。</p>
      <p>一括追加したYouTubeチャンネル・プレイリストやSpotifyのリストは、トラック一覧の上部に表示される
      「更新を確認」から新着の有無をいつでもチェックできます。</p>
    ` }));
    container.appendChild(guideSection);

    /* ─ 5. 詳細設定（上級者向け） ─ */
    const advancedSection = section("詳細設定（上級者向け）");

    const advancedIntro = el("div", { class: "setting-guide" },
      "ここから下は普段は触らなくて大丈夫です。YouTubeのプレイリストやチャンネルを丸ごと追加したい場合のみ設定してください。"
    );
    advancedSection.appendChild(advancedIntro);

    // Worker URL input for playlist/channel bulk-add
    const ytWorkerRow = el("div", { class: "setting-row setting-row-col" });
    const ytWorkerLabel = el("div", { class: "setting-row-label" }, "プレイリスト/チャンネル取得 Worker URL");
    const ytWorkerDesc = el("div", { class: "setting-row-desc" },
      "YouTubeのプレイリストやチャンネルを一括追加するためのCloudflare Worker URL。未設定の場合は動画を1件ずつ追加できます。"
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
    advancedSection.appendChild(ytWorkerRow);

    advancedSection.appendChild(el("div", { class: "setting-guide", html: `
      <p>設定方法は <code>README.md</code> に記載しています。</p>
    ` }));

    container.appendChild(advancedSection);

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
            ${iconMarkup("shop", "icon icon-inline")} Booth
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
