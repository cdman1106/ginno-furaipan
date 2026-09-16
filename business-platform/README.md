# Instagram Feed Platform prototype

複数店舗のInstagram連携を、1つの管理画面から登録・運用するためのCloudflare Workerプロトタイプです。

## 管理画面でできること

- 管理パスワードでログイン
- 店舗名とホームページURLを登録
- 店舗ごとのInstagram接続URLを自動発行
- お客様はInstagram公式画面で接続を許可するだけ
- 店舗ごとの埋め込みコードを自動発行
- 投稿 / Reels / 取得可能なStoriesを10分ごとに同期
- アクセストークンはKVに平文保存せずAES-GCMで暗号化

## Cloudflareに必要な設定

KV Namespaceを1つ作成し、Workerに次のBinding名で接続します。

- `PLATFORM`

Variables / Secrets:

- `ADMIN_PASSWORD` : 管理ページのログインパスワード。Secret推奨
- `SESSION_SECRET` : 32文字以上のランダム文字列。Secret
- `TOKEN_ENCRYPTION_KEY` : 32文字以上のランダム文字列。Secret
- `IG_APP_ID` : Meta DevelopersのInstagram App ID
- `IG_APP_SECRET` : Meta DevelopersのInstagram App Secret。Secret
- `BASE_URL` : Workerの公開URL。例 `https://instagram-feed-platform.example.workers.dev`

Cron Trigger:

- `*/10 * * * *`

## Meta Developers

Instagram API with Instagram Login を使います。
OAuth Redirect URI は次の1本を登録します。

`BASE_URL/oauth/callback`

例:

`https://instagram-feed-platform.example.workers.dev/oauth/callback`

## 利用の流れ

1. `/admin` を開く
2. `ADMIN_PASSWORD` でログイン
3. 店舗名とホームページURLを登録
4. 自動発行された「お客様に送るInstagram接続URL」を店主へ送る
5. 店主が「Instagramと接続する」を押し、Meta公式画面で許可
6. 管理画面が「Instagram接続済み」になる
7. 管理画面に出る埋め込みコードを対象ホームページへ貼る

埋め込みコードの形式:

```html
<div data-instagram-feed="SITE_ID"></div>
<script src="https://YOUR-WORKER/embed.js" data-site="SITE_ID" defer></script>
```

## 事業化する場合の重要事項

開発モードでは、MetaアプリのRole/Test accountなどに追加したアカウントしか接続できない場合があります。一般のお客様が自分で接続できる本番サービスにするには、Meta側で必要な権限のApp Reviewとアプリ公開設定を進めてください。

お客様のInstagramパスワードを自社フォームで収集・保存する設計にはしないでください。OAuthで店主本人がMeta公式画面から許可する形にします。
