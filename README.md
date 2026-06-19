# MIXCAST — マルチソース統合プレーヤー（Phase 1）

YouTube / Apple Podcasts / Podcast RSSフィード / 直接MP3リンクを横断して
プレイリストを一元管理・連続再生するWebアプリ。
ラジオモードON時はサービスをまたいで自動的に次のトラックへ遷移します。

## なぜGitHub Pagesが必要か

Claude Artifact（ブラウザ内サンドボックス）では、YouTube IFrame APIや外部音声URLへの
ネットワークアクセスがブロックされるため、メディア再生が機能しません。
このアプリは通常のWebサイトとして動作するため、GitHub Pagesなど実際のドメイン上に
置くことでこの制約を回避できます。

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

## 対応URL形式

「+ 追加」の入力欄にURLを貼ると、自動で種類を判定して追加します。

| 入力例 | 判定 | 動作 |
|---|---|---|
| `youtube.com/watch?v=...` / `youtu.be/...` | YouTube | IFrame APIで直接再生 |
| `podcasts.apple.com/.../id1234?i=5678` | Apple Podcasts | iTunes Lookup APIでMP3を解決して追加 |
| `....mp3` / `.m4a` / `.wav` など直リンク | 直接音声 | そのまま `<audio>` で再生 |
| **それ以外すべて**（Omnyの`podcast.rss`、Buzzsprout、Libsyn、Anchor、自前ホスティングのRSS/Atomなど） | Podcastフィード | URLをRSS/Atomとして取得・解析し、最新エピソードのMP3を自動抽出して追加 |

「それ以外すべて」を一律フィードとして試す設計のため、個別のPodcastホスト名を
覚える必要はありません。フィードとして解析できなかった場合はエラーメッセージとともに
「🔗 リンクとして追加する」ボタンが出るので、再生はできなくても記録だけは残せます。

### 動作確認済み

`*.omnycontent.com/d/playlist/.../podcast.rss` 形式（標準的なRSS 2.0 + `<enclosure>`）は、
同一構造の自作フィードで実機検証済みです。実際のOmny URLそのものは検証環境の
ネットワーク制限で直接確認できていないため、お手数ですがGitHub Pagesデプロイ後に
一度お試しください。

## ファイル構成

```
mixcast/
├── index.html                     画面構造
├── css/style.css                  デザイン（放送局モチーフ：深紺×信号赤）
└── js/
    ├── storage.js                 LocalStorage永続化
    ├── services.js                URL→サービス判定、バッジ、時刻整形
    ├── podcast-feed-resolver.js   汎用RSS/Atomフィードリゾルバー（Omny等）
    ├── apple-podcast-resolver.js  Apple Podcasts URL → MP3 解決
    ├── youtube-engine.js          YouTube IFrame Player APIラッパー
    ├── audio-engine.js            HTML5 <audio> ラッパー（Podcast/MP3用）
    ├── player-panel.js            プレーヤーUIのテンプレート展開
    └── app.js                     状態管理・画面描画・イベント処理
```

## 動作確認状況

| 機能 | 状態 | 備考 |
|---|---|---|
| Podcast/MP3直接再生 | ✅ 実機検証済み | 同一オリジンの自作MP3で再生・経過時間の進行を確認 |
| Omny形式RSSフィード追加 | ✅ 実機検証済み | 同一構造の自作フィードで`<enclosure>`抽出・再生まで確認。実際のOmny URLは未検証（ネットワーク制限） |
| その他Podcastフィード全般 | ✅ ロジック実装済み | RSS 2.0 / Atom 両対応。失敗時はリンク追加にフォールバック |
| Apple Podcasts URL追加 | ⚠️ 部分検証 | iTunes Lookup APIがlocalhostからのCORSをブロック。GitHub Pages実ドメインでは動く可能性が高いが未確認 |
| YouTube再生 | ⚠️ 未検証 | 検証環境のネットワーク制限によりIFrame API自体に到達できず確認不能 |
| ラジオモード（自動連続再生） | ✅ ロジック確認済み | トラック終了イベント→次トラックへの遷移ロジックは実装済み |
| プレイリストCRUD | ✅ 実機検証済み | 作成・名前変更・削除・トラック追加/削除を確認 |
| モバイルレイアウト（タブ切替） | ✅ 実機検証済み | 640px未満で3タブ構成に切替、表示崩れがないことをスクリーンショットで確認 |
| LocalStorage永続化 | ✅ 実装済み | ページリロード後もプレイリストを復元 |

## 既知の注意点

- Apple PodcastsやPodcastフィードの取得に失敗する場合、配信元がCORSヘッダーを
  返していない可能性があります。その場合はエラーメッセージにその旨が表示されます。
- YouTube再生がうまくいかない場合、ブラウザの開発者ツール（F12）のConsoleタブに
  エラーが出ていればその内容を教えてください。原因を特定しやすくなります。
