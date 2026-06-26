# MIXCAST — マルチソース統合プレーヤー

YouTube / Spotify / Apple Podcasts / Podcast RSSフィード / 直接MP3リンクを横断して
プレイリストを一元管理・連続再生するWebアプリ。
ラジオモードON時はサービスをまたいで自動的に次のトラックへ遷移します。
番組・プレイリストのURLを貼ると、収録曲/エピソードを丸ごとプレビューしてから
一括追加できます。

## なぜGitHub Pagesが必要か

Claude Artifact（ブラウザ内サンドボックス）では、YouTube IFrame APIや外部音声URL・
Spotify Web Playback SDKへのネットワークアクセスがブロックされるため、メディア再生
が機能しません。このアプリは通常のWebサイトとして動作するため、GitHub Pagesなど
実際のドメイン上に置くことでこの制約を回避できます。

## デプロイ方法

1. このフォルダを新しいGitHubリポジトリの内容としてpush
   ```
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin <あなたのリポジトリURL>
   git push -u origin main
   ```
2. リポジトリの Settings → Pages → Source で `main` ブランチ / `/ (root)` を選択
3. 数分後、`https://<ユーザー名>.github.io/<リポジトリ名>/` で公開されます

## ローカルで試す場合

YouTube IFrame APIは `file://` では動作しないため、簡易サーバーを使ってください。

```
python3 -m http.server 8080
```

ブラウザで `http://localhost:8080` を開く。

## Spotify連携のセットアップ（任意）

Spotifyのトラック再生・プレイリスト/アルバム一括追加を使うには、自分のSpotify
Client IDを取得して設定する必要があります（無料・5分程度）。

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
6. `js/spotify-auth.js` を開き、`CLIENT_ID` の値を貼り付け：
   ```js
   const CLIENT_ID = "ここに取得したClient IDを貼り付け";
   ```

設定が済むとヘッダーの「Spotify未設定」ボタンが「Spotifyでログイン」に変わります。

## 対応URL形式

「+ 追加」の入力欄にURLを貼ると、自動で種類を判定して追加します。
**番組・プレイリスト・アルバム全体を表すURL**の場合は、収録内容をプレビューする
モーダルが開き、チェックボックスで選んだものだけを一括追加できます。

| 入力例 | 判定 | 動作 |
|---|---|---|
| `youtube.com/watch?v=...` / `youtu.be/...` | YouTube | IFrame APIで直接再生 |
| `open.spotify.com/track/...` | Spotify（単曲） | 要ログイン。Web Playback SDKで直接再生 |
| `open.spotify.com/playlist/...` | Spotify（一括） | 要ログイン。**全曲プレビュー→選択追加** |
| `open.spotify.com/album/...` | Spotify（一括） | 要ログイン。**全曲プレビュー→選択追加** |
| `podcasts.apple.com/.../id1234?i=5678`（エピソード単体） | Apple Podcasts | iTunes Lookup APIでMP3を解決して1件追加 |
| `podcasts.apple.com/.../id1234`（番組ページ） | Apple Podcasts（一括） | **全話プレビュー→選択追加** |
| `....mp3` / `.m4a` / `.wav` など直リンク | 直接音声 | そのまま `<audio>` で再生 |
| **それ以外すべて**（Omnyの`podcast.rss`、Buzzsprout、Libsyn、Anchor、自前ホスティングのRSS/Atomなど） | Podcastフィード（一括） | URLをRSS/Atomとして取得・解析し、**全話プレビュー→選択追加** |

フィードとして解析できなかった場合はエラーメッセージとともに
「🔗 リンクとして追加する」ボタンが出るので、再生はできなくても記録だけは残せます。

### YouTubeプレイリストの一括追加について

YouTubeの「再生リスト共有URL」からの一括追加は、**今回見送り**ました。
YouTube Data API（無料枠あり・APIキー要発行）を使わない場合、ブラウザの
CORS制限によりプレイリストの中身を取得する手段がないためです。将来的に
APIキーを発行する場合は対応を追加できます。

## 動作確認状況

| 機能 | 状態 | 備考 |
|---|---|---|
| Podcast/MP3直接再生 | ✅ 実機検証済み | 同一オリジンの自作MP3で再生・経過時間の進行を確認 |
| Podcastフィード一括追加 | ✅ 実機検証済み | 自作の3話フィードで全件プレビュー・選択追加・除外まで確認 |
| Apple Podcasts単体エピソード追加 | ✅ ロジック実装済み | iTunes Lookup API |
| Apple Podcasts番組まるごと追加 | ⚠️ 部分検証 | ロジック・モーダル分岐は確認済み。iTunes APIがlocalhostからのCORSをブロックするため、フェッチ自体はGitHub Pages実ドメインでの確認が必要 |
| Omny形式RSSフィード | ✅ 実機検証済み | 同一構造の自作フィードで`<enclosure>`抽出・再生まで確認 |
| Spotify OAuth2ログイン（PKCE） | ⚠️ 未検証 | Client ID未設定のため、このままでは動作しません。上記セットアップ手順に沿って設定後にお試しください |
| Spotify単曲再生 | ⚠️ 未検証 | Web Playback SDK・Premium必須。Client ID設定後に要確認 |
| Spotifyプレイリスト/アルバム一括追加 | ⚠️ 未検証 | Web API呼び出しロジックは実装済み（ページネーション対応）。Client ID設定後に要確認 |
| YouTube再生 | ⚠️ 未検証 | 検証環境のネットワーク制限によりIFrame API自体に到達できず確認不能 |
| ラジオモード（自動連続再生） | ✅ ロジック確認済み | トラック終了イベント→次トラックへの遷移ロジックは実装済み（YouTube/Audio/Spotify共通） |
| プレイリストCRUD | ✅ 実機検証済み | 作成・名前変更・削除・トラック追加/削除を確認 |
| モバイルレイアウト（タブ切替） | ✅ 実機検証済み | 一括追加モーダルもモバイルで崩れないことをスクリーンショットで確認 |
| LocalStorage永続化 | ✅ 実装済み | ページリロード後もプレイリストを復元 |

## ファイル構成

```
mixcast/
├── index.html                     画面構造
├── callback.html                  Spotify OAuth2リダイレクト先
├── css/style.css                  デザイン（放送局モチーフ：深紺×信号赤）
└── js/
    ├── storage.js                 LocalStorage永続化
    ├── services.js                URL→サービス判定、バッジ、時刻整形
    ├── podcast-feed-resolver.js   汎用RSS/Atomフィードリゾルバー（単件/全件）
    ├── apple-podcast-resolver.js  Apple Podcasts URL → MP3 解決（単件/全件）
    ├── spotify-auth.js            Spotify OAuth2 PKCEフロー
    ├── spotify-resolver.js        Spotify Web API（トラック/プレイリスト/アルバム取得）
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

## YouTubeプレイリスト一括追加 — Cloudflare Worker の設定

プレイリストURLを貼るだけで全動画を一括追加したい場合、Cloudflare Worker を使います。

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

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/playlist") {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const playlistId = url.searchParams.get("id");
    if (!playlistId) {
      return new Response(JSON.stringify({ error: "id parameter required" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const apiKey = env.YT_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "YT_API_KEY not configured" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Fetch playlist metadata
    const metaRes = await fetch(
      `https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=${playlistId}&key=${apiKey}`
    );
    const metaData = await metaRes.json();
    const playlistTitle = metaData.items?.[0]?.snippet?.title || "YouTube Playlist";

    // Fetch all playlist items (paginate up to 500 videos)
    const videos = [];
    let pageToken = "";
    while (videos.length < 500) {
      const ytUrl = `https://www.googleapis.com/youtube/v3/playlistItems`
        + `?part=snippet&maxResults=50&playlistId=${playlistId}&key=${apiKey}`
        + (pageToken ? `&pageToken=${pageToken}` : "");
      const res = await fetch(ytUrl);
      const data = await res.json();
      if (!res.ok) {
        return new Response(JSON.stringify({ error: data.error?.message || "YouTube API error" }), {
          status: 500, headers: { ...CORS, "Content-Type": "application/json" },
        });
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

    return new Response(JSON.stringify({ playlistTitle, videos }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  },
};
```

4. Worker の設定画面 → **Variables** → **Add variable**
   - Variable name: `YT_API_KEY`
   - Value: YouTube Data API v3 のキー（[Google Cloud Console](https://console.cloud.google.com/) で発行）

5. Worker の URL（`https://your-worker.your-name.workers.dev`）を PlatHub の設定画面（⚙）→「YouTube」→「プレイリスト取得 Worker URL」に貼り付け

### YouTube Data API キーの取得

1. [Google Cloud Console](https://console.cloud.google.com/) で新しいプロジェクトを作成
2. **APIとサービス** → **ライブラリ** → **YouTube Data API v3** を有効化
3. **APIとサービス** → **認証情報** → **APIキーを作成**
4. （推奨）作成したキーのリファクタリング制限に Cloudflare Workers のドメインを追加

無料枠：YouTube Data API v3 は1日10,000ユニット無料。プレイリスト取得は約1–3ユニット/リクエストなので、個人利用では無制限に近い。
