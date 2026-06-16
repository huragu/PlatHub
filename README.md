# MIXCAST — マルチソース統合プレーヤー（Phase 1）

YouTube / Podcast(MP3) を横断してプレイリストを一元管理・連続再生するWebアプリ。
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

## ファイル構成

```
mixcast/
├── index.html              画面構造
├── css/style.css           デザイン（放送局モチーフ：深紺×信号赤）
└── js/
    ├── storage.js          LocalStorage永続化
    ├── services.js         URL→サービス判定、バッジ、時刻整形
    ├── youtube-engine.js   YouTube IFrame Player APIラッパー
    ├── audio-engine.js     HTML5 <audio> ラッパー（Podcast/MP3用）
    ├── player-panel.js     プレーヤーUIのテンプレート展開
    └── app.js              状態管理・画面描画・イベント処理
```

## 動作確認状況

| 機能 | 状態 | 備考 |
|---|---|---|
| Podcast/MP3再生 | ✅ 実機検証済み | 同一オリジンの自作MP3で再生・経過時間の進行を確認 |
| YouTube再生 | ⚠️ 未検証 | 検証環境のネットワーク制限によりIFrame API自体に到達できず確認不能。標準的な実装だが実機での確認を推奨 |
| ラジオモード（自動連続再生） | ✅ ロジック確認済み | トラック終了イベント→次トラックへの遷移ロジックは実装済み |
| プレイリストCRUD | ✅ 実機検証済み | 作成・名前変更・削除・トラック追加/削除を確認 |
| モバイルレイアウト（タブ切替） | ✅ 実装済み | 640px未満で3タブ構成に切替 |
| LocalStorage永続化 | ✅ 実装済み | ページリロード後もプレイリストを復元 |

## 既知の注意点

- サンプルのPodcast URL（`w3schools.com/html/horse.mp3`）は動作実績の高い定番テストファイルですが、
  検証環境のネットワーク制限により今回の開発過程では直接確認できていません。
  もし再生できない場合は、お手持ちの別のMP3 URLで試してください。
- YouTube再生がうまくいかない場合、ブラウザの開発者ツール（F12）のConsoleタブに
  エラーが出ていればその内容を教えてください。原因を特定しやすくなります。
