# TacLog(タクログ)

スクリムの録画を読み取って、ラウンドごとの勝敗・攻守・ファーストキル・設置タイミングとサイトを記録し、チームの傾向をAIに質問できるサービスです。

- 録画は**使う人のパソコンの中で読み取り**、読み取った結果(文字のデータ)だけをサーバーに保存します
- 結果はチームで共有され、メンバーは誰でも質問できます
- パッケージのインストールやビルドは不要です(Vercel の標準機能だけで動きます)

## フォルダの中身

| 場所 | 中身 |
|---|---|
| `index.html` / `pricing.html` | トップページ・料金ページ |
| `login.html` | ログインと無料登録(`/signup` も同じページ) |
| `onboarding.html` | はじめての設定(チーム作成 → Riot連携 → OBS → お知らせ → 招待) |
| `invite.html` | 招待リンクからチームに参加する画面 |
| `app.html` | アプリ本体(録画を分析・AIに質問・試合一覧・設定) |
| `guide-obs.html` | OBSの設定ガイド |
| `legal/` | 利用規約・プライバシーポリシー・特定商取引法に基づく表記(**下書き**) |
| `assets/` | 共通のデザイン・プログラム。`config.js` に Supabase の公開設定を書きます |
| `api/` | サーバー側の処理(AIの呼び出し、決済) |
| `supabase/schema.sql` | データベースの設計 |

## 公開までの手順

### 1. Supabase(ログインとデータ保存)
1. https://supabase.com で新しいプロジェクトを作る(地域は **Tokyo** がおすすめ)
2. 左メニューの **SQL Editor** を開き、`supabase/schema.sql` の中身を全部貼り付けて **Run**
3. **Authentication → URL Configuration** で
   - Site URL:公開したサイトのURL(例:`https://taclog.vercel.app`)
   - Redirect URLs:`https://taclog.vercel.app/**` を追加
4. **Project Settings → API** にある次の3つを控えておく
   - Project URL
   - anon public キー(公開してよい鍵)
   - service_role キー(**絶対に公開しない鍵**)

### 2. `assets/config.js` を書きかえる
Project URL と anon public キーを入れます(この2つは公開されても問題ない値です)。

### 3. Claude API(AI)
1. https://console.anthropic.com で API キーを作る
2. 使いすぎを防ぐため、**月の利用上限(Spend limit)を設定**しておく

### 4. Vercel(公開)
1. Vercel の「新しいプロジェクト」で GitHub の `taclog` を **Import**
2. Framework Preset は **Other**、ビルドの設定は空のままでOK
3. **Environment Variables** に次を入れる

| 名前 | 値 |
|---|---|
| `SUPABASE_URL` | Supabase の Project URL |
| `SUPABASE_ANON_KEY` | anon public キー |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role キー |
| `ANTHROPIC_API_KEY` | Claude の API キー |

4. **Deploy** を押す

### 5. Googleログイン(任意)
Supabase の **Authentication → Providers → Google** をオンにします。Google Cloud で OAuth クライアントを作り、そのIDとシークレットを入れます。設定しない場合は、メールアドレスとパスワードでの登録だけ使えます。

### 6. 決済(Riot の承認後)
1. Stripe でアカウントを作り、本人確認と振込先を登録
2. 商品を2つ作る:「チーム」月1,980円、「コーチ・組織」月4,980円(どちらも毎月の定期支払い)
3. **Developers → Webhooks** で `https://(サイトのURL)/api/webhook` を登録し、次のイベントを選ぶ
   `checkout.session.completed` / `customer.subscription.created` / `customer.subscription.updated` / `customer.subscription.deleted`
4. **Settings → Billing → Customer portal** を有効にする(解約・カード変更の画面)
5. Vercel の Environment Variables に追加して、もう一度 Deploy

| 名前 | 値 |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe のシークレットキー |
| `STRIPE_PRICE_TEAM` | 「チーム」の価格ID(price_…) |
| `STRIPE_PRICE_ORG` | 「コーチ・組織」の価格ID |
| `STRIPE_WEBHOOK_SECRET` | Webhook の署名シークレット(whsec_…) |
| `SITE_URL` | サイトのURL(例:`https://taclog.gg`) |

6. `assets/config.js` の `BILLING_ENABLED` を `true` にする

最初は Stripe の**テストモード**の鍵で試し、問題なければ本番の鍵に入れ替えます。

## 料金プランと制限

| | 無料 | チーム | コーチ・組織 |
|---|---|---|---|
| 録画の分析 | 月2本 | 無制限 | 無制限 |
| AIへの質問 | 月20回 | 月300回 | 無制限 |
| 見られるデータ | 直近14日 | 全期間 | 全期間 |
| メンバー | 3人 | 無制限 | 無制限 |

制限は `supabase/schema.sql` の `plan_limits` と `api/_lib.js` の `PLAN_LIMITS` で変えられます。

## まだ作っていないもの
- お知らせの送信(設定の保存までは動きます)
- Riotアカウント連携(Riot の承認後に追加)
- Googleドライブ・YouTubeチャンネル連携
- 公開前に、`legal/` の下書きの [ ] の部分を埋めて、内容を確認してください
