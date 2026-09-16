# 銀のフライパン Instagram自動連携セットアップ

このWorkerは、店主さんがInstagramのパスワードを制作者へ渡さずに、公式Instagram OAuthで連携し、最新投稿をホームページ用JSONとして自動更新するためのものです。

## 1. Cloudflare Workerを作成

Worker名の例: `ginno-furaipan-instagram`

`worker/instagram-worker.js` をWorker本体としてデプロイします。

## 2. KVを作成

Cloudflare > Workers & Pages > KV でNamespaceを作成します。

例: `ginno-furaipan-instagram-store`

作成したKVをWorkerへ `IG_STORE` というBinding名で接続します。

## 3. Variables / Secrets

Workerの Settings > Variables and Secrets へ以下を登録します。

### Secret
- `IG_APP_SECRET` : Meta DevelopersのInstagram app secret
- `CONNECT_KEY` : 店主さん専用連携URLを保護するランダムな長い文字列

### Variable / Secretどちらでも可
- `IG_APP_ID` : Meta Developers画面に表示されるInstagram app ID
- `IG_REDIRECT_URI` : `https://<worker-domain>/instagram/callback`

### 任意
- `SITE_ORIGIN` : 本番サイトのOrigin。例 `https://example.com`
- `IG_GRAPH_VERSION` : Graph API version
- `IG_TESTER_INVITE_URL` : 店主さんがテスター招待を確認するInstagram公式URL

※ `IG_APP_SECRET` やアクセストークンをGitHubに書かないでください。

## 4. Meta Developers側

Instagram API > InstagramログインによるAPI設定 > Instagramビジネスログインを設定する、でRedirect URIとしてWorkerの

`https://<worker-domain>/instagram/callback`

を登録します。

今回の読み取り用途では `instagram_business_basic` を要求します。

## 5. 店主さんへ渡すURL

`CONNECT_KEY` を設定した後、店主さんには次のURLだけを送ります。

`https://<worker-domain>/connect?key=<CONNECT_KEY>`

店主さんの作業は基本的に以下だけです。

1. 必要な場合のみInstagramテスター招待を承認
2. 「Instagramと連携する」を押す
3. 銀のフライパンのInstagramアカウントを選択
4. Metaの画面で許可/続行
5. 「連携完了」が表示されたら終了

## 6. 自動更新

Cron Triggerは10分ごとです。

`*/10 * * * *`

Workerが最新投稿を取得し、KVへ保存します。

公開JSON:

`https://<worker-domain>/instagram`

返却例:

```json
{
  "updatedAt": "2026-09-16T09:00:00.000Z",
  "profile": {
    "id": "...",
    "username": "ginno_furaipan"
  },
  "posts": [],
  "reels": [],
  "stories": []
}
```

## 7. トークン更新

長期アクセストークンはWorker内で定期更新します。店主さんがInstagram側でアプリ連携を解除した場合などは、同じ接続URLから再認証してください。

## 8. 次の工程

Instagram連携テスト成功後、`dist/index.html` と `dist/assets/script.js` を更新して、固定画像の一部をInstagramの最新投稿・Reels表示へ差し替えます。
