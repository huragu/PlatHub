# PlatHub — マルチプラットフォーム統合プレーヤー

YouTube / Spotify / Apple Podcasts / Podcast RSSフィード / 直接MP3リンクを横断して
プレイリストを一元管理・連続再生するWebアプリ。
RADIOボタンを押すと、今表示しているリストをサービスをまたいで連続再生します。
プレイリスト・チャンネル・番組のURLを貼ると、収録内容を丸ごとプレビューしてから
一括追加できます。

## なぜGitHub Pagesが必要か

Claude Artifact（ブラウザ内サンドボックス）では、YouTube IFrame APIや外部音声URL・
Spotify Web Playback SDKへのネットワークアクセスがブロックされるため、メディア再生
が機能しません。このアプリは通常のWebサイトとして動作するため、GitHub Pagesなど
実際のドメイン上に置くことでこの制約を回避できます。

## ローカルで試す場合

YouTube IFrame APIは `file://` では動作しないため、簡易サーバーを使ってください。

```
python3 -m http.server 8080
```

ブラウザで `http://localhost:8080` を開く。

## Spotify連携のセットアップ（デプロイ前に一度だけ）

Spotifyのトラック再生・プレイリスト/アルバム/番組の一括追加を使うには、
Spotify Client IDを取得して設定する必要があります（無料・5分程度）。
**この設定はデプロイする人が一度行えば、訪問者は個別設定なしでそのまま使えます。**

1. https://developer.spotify.com/dashboard を開き、Spotifyアカウントでログイン
   （**Premiumアカウント**でのログインを推奨。Web Playback SDKはPremium限定のため）
2. 「Create app」→ App name・Description を入力
3. 「Which API/SDKs are you planning to use?」で **Web Playback SDK** と
   **Web API** の両方にチェック
4. Redirect URIs に、デプロイ後の `callback.html` のURLを追加
   ```
   https://<ユーザー名>.github.io/<リポジトリ名>/callback.html
   ```
   ローカルテスト用には合わせて以下も追加（Spotifyは`localhost`を許可しないため`127.0.0.1`を使用）：
   ```
   http://127.0.0.1:8080/callback.html
   ```
5. 作成されたアプリの **Client ID** をコピー
   （Client Secretは使いません — PKCEフローのため不要です）
6. `js/spotify-auth.js` を開き、`HARDCODED_CLIENT_ID` の値を貼り付けてデプロイ：
   ```js
   const HARDCODED_CLIENT_ID = "ここに取得したClient IDを貼り付け";
   ```

設定が済むと、訪問者はヘッダーの「Spotifyでログイン」ボタンを押すだけで使えます。
（個人の検証用に、ヘッダーのダイアログから別のClient IDを一時的に上書きすることも可能です）

## 対応URL形式

「+ 追加」の入力欄にURLを貼ると、自動で種類を判定して追加します。
**番組・プレイリスト・アルバム・チャンネル全体を表すURL**の場合は、収録内容を
プレビューするモーダルが開き、チェックボックスで選んだものだけを一括追加できます。

| 入力例 | 判定 | 動作 |
|---|---|---|
| `youtube.com/watch?v=...` / `youtu.be/...` | YouTube | IFrame APIで直接再生 |
| `youtube.com/playlist?list=...` | YouTube（一括） | Worker設定時のみ。**全動画プレビュー→選択追加** |
| `youtube.com/@ハンドル名` など | YouTubeチャンネル（一括） | Worker設定時のみ。**全動画プレビュー→選択追加** |
| `open.spotify.com/track/...` | Spotify（単曲） | 要ログイン。Web Playback SDKで直接再生 |
| `open.spotify.com/episode/...` | Spotify（単体エピソード） | 要ログイン。Web Playback SDKで直接再生 |
| `open.spotify.com/playlist/...` / `/album/...` | Spotify（一括） | 要ログイン。**全曲プレビュー→選択追加** |
| `open.spotify.com/show/...` | Spotify番組（一括） | 要ログイン。**全話プレビュー→選択追加** |
| `podcasts.apple.com/.../id1234?i=5678`（エピソード単体） | Apple Podcasts | iTunes Lookup APIでMP3を解決して1件追加 |
| `podcasts.apple.com/.../id1234`（番組ページ） | Apple Podcasts（一括） | **全話プレビュー→選択追加** |
| `....mp3` / `.m4a` / `.wav` など直リンク | 直接音声 | そのまま `<audio>` で再生 |
| **それ以外すべて**（Omnyの`podcast.rss`、Buzzsprout、Libsyn、Anchor、自前ホスティングのRSS/Atomなど） | Podcastフィード（一括） | URLをRSS/Atomとして取得・解析し、**全話プレビュー→選択追加** |

フィードとして解析できなかった場合はエラーメッセージとともに
「リンクとして追加する」ボタンが出るので、再生はできなくても記録だけは残せます。

一括追加したYouTubeチャンネル・プレイリストやSpotifyのリスト・番組は、後から
新着の有無を確認できます（起動時の自動チェック、またはトラック一覧上部の
「更新を確認」ボタンから手動チェック。自動チェックは設定画面でオフにできます）。

## ファイル構成

```
mixcast/
├── index.html                     画面構造
├── callback.html                  Spotify OAuth2リダイレクト先
├── favicon.svg                    ファビコン
├── assets/icons.svg               SVGアイコンスプライト
├── css/style.css                  デザイン（放送局モチーフ：深紺×信号赤）
└── js/
    ├── storage.js                 LocalStorage永続化
    ├── services.js                URL→サービス判定、バッジ、時刻整形
    ├── settings.js                設定パネル（音量・動作設定・詳細設定）
    ├── podcast-feed-resolver.js   汎用RSS/Atomフィードリゾルバー（単件/全件）
    ├── apple-podcast-resolver.js  Apple Podcasts URL → MP3 解決（単件/全件）
    ├── spotify-auth.js            Spotify OAuth2 PKCEフロー
    ├── spotify-resolver.js        Spotify Web API（トラック/エピソード/プレイリスト/アルバム/番組取得）
    ├── youtube-engine.js          YouTube IFrame Player APIラッパー
    ├── audio-engine.js            HTML5 <audio> ラッパー（Podcast/MP3用）
    ├── spotify-engine.js          Spotify Web Playback SDKラッパー
    ├── player-panel.js            プレーヤーUIのテンプレート展開
    └── app.js                     状態管理・画面描画・イベント処理・一括追加モーダル
```

## 既知の注意点

- Apple PodcastsやPodcastフィードの取得に失敗する場合、配信元がCORSヘッダーを
  返していない可能性があります。その場合はエラーメッセージにその旨が表示されます。
- Spotifyの再生にはPremiumアカウントが必須です（Spotify側の仕様）。無料アカウント
  でログインした場合、再生時に「Premiumアカウントが必要です」というエラーが出ます。
- YouTube再生がうまくいかない場合、ブラウザの開発者ツール（F12）のConsoleタブに
  エラーが出ていればその内容を教えてください。原因を特定しやすくなります。

## YouTubeプレイリスト・チャンネル一括追加 — Cloudflare Worker の設定

プレイリストやチャンネルのURLを貼るだけで全動画を一括追加したい場合、Cloudflare Worker を使います。

### Worker の作成手順

1. [https://dash.cloudflare.com](https://dash.cloudflare.com) にアクセスしてアカウント作成（無料）
2. **Workers & Pages** → **Create** → **Create Worker**
3. 以下のコードをそのまま貼り付けて **Save and deploy**

```js
// PlatHub — YouTube Playlist Worker
// Cloudflare Worker: proxies YouTube Data API v3 calls for playlist expansion.
// Set the environment variable YT_API_KEY to your YouTube Data API key.
//   (Workers → Settings → Variables → Add variable: YT_API_KEY)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

async function fetchAllVideosFromPlaylist(playlistId, apiKey) {
  const videos = [];
  let pageToken = "";
  while (videos.length < 500) {
    const ytUrl = `https://www.googleapis.com/youtube/v3/playlistItems`
      + `?part=snippet&maxResults=50&playlistId=${playlistId}&key=${apiKey}`
      + (pageToken ? `&pageToken=${pageToken}` : "");
    const res = await fetch(ytUrl);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error?.message || "YouTube API error");
    }
    for (const item of data.items || []) {
      const vid = item.snippet?.resourceId?.videoId;
      if (vid) {
        videos.push({
          id: vid,
          title: item.snippet.title,
          channelTitle: item.snippet.videoOwnerChannelTitle || "",
        });
      }
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return videos;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);
    const apiKey = env.YT_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "YT_API_KEY not configured" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // ── /playlist?id=PLxxxx — expand a playlist ──
    if (url.pathname === "/playlist") {
      const playlistId = url.searchParams.get("id");
      if (!playlistId) {
        return new Response(JSON.stringify({ error: "id parameter required" }), {
          status: 400, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      const metaRes = await fetch(
        `https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=${playlistId}&key=${apiKey}`
      );
      const metaData = await metaRes.json();
      const playlistTitle = metaData.items?.[0]?.snippet?.title || "YouTube Playlist";

      try {
        const videos = await fetchAllVideosFromPlaylist(playlistId, apiKey);
        return new Response(JSON.stringify({ playlistTitle, videos }), {
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
    }

    // ── /channel?handle=@name  OR  /channel?id=UCxxxx — expand a channel's
    //    entire upload history via its "uploads" playlist (UUxxxx, derived
    //    by swapping the UC prefix — a stable YouTube convention). ──
    if (url.pathname === "/channel") {
      const handle = url.searchParams.get("handle");
      const channelIdParam = url.searchParams.get("id");
      if (!handle && !channelIdParam) {
        return new Response(JSON.stringify({ error: "handle or id parameter required" }), {
          status: 400, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      let channelId = channelIdParam;
      let channelTitle = "";

      // Resolve @handle -> channel ID + uploads playlist ID in one call
      const lookupUrl = handle
        ? `https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&forHandle=${encodeURIComponent(handle)}&key=${apiKey}`
        : `https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&id=${channelIdParam}&key=${apiKey}`;

      const chRes = await fetch(lookupUrl);
      const chData = await chRes.json();
      if (!chRes.ok) {
        return new Response(JSON.stringify({ error: chData.error?.message || "YouTube API error" }), {
          status: 500, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
      const channel = chData.items?.[0];
      if (!channel) {
        return new Response(JSON.stringify({ error: "チャンネルが見つかりませんでした" }), {
          status: 404, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
      channelId = channel.id;
      channelTitle = channel.snippet?.title || "YouTube Channel";
      const uploadsPlaylistId = channel.contentDetails?.relatedPlaylists?.uploads;
      if (!uploadsPlaylistId) {
        return new Response(JSON.stringify({ error: "アップロード一覧を取得できませんでした" }), {
          status: 500, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      try {
        const videos = await fetchAllVideosFromPlaylist(uploadsPlaylistId, apiKey);
        return new Response(JSON.stringify({ channelId, channelTitle, videos }), {
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404, headers: { ...CORS, "Content-Type": "application/json" },
    });
  },
};
```

4. Worker の設定画面 → **Variables** → **Add variable**
   - Variable name: `YT_API_KEY`
   - Value: YouTube Data API v3 のキー（[Google Cloud Console](https://console.cloud.google.com/) で発行）

5. Worker の URL（`https://your-worker.your-name.workers.dev`）を PlatHub の設定画面 →「詳細設定（上級者向け）」→「プレイリスト/チャンネル取得 Worker URL」に貼り付け

### YouTube Data API キーの取得

1. [Google Cloud Console](https://console.cloud.google.com/) で新しいプロジェクトを作成
2. **APIとサービス** → **ライブラリ** → **YouTube Data API v3** を有効化
3. **APIとサービス** → **認証情報** → **APIキーを作成**
4. （推奨）作成したキーのリファクタリング制限に Cloudflare Workers のドメインを追加

無料枠：YouTube Data API v3 は1日10,000ユニット無料。プレイリスト取得は約1–3ユニット/リクエストなので、個人利用では無制限に近い。
