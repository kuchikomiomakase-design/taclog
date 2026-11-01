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
   - Site URL:公開したサイトのURL(例:`https://taclog.app`)
   - Redirect URLs:`https://taclog.app/**` を追加
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
2. 商品を3つ作る:「チーム」月2,480円、「コーチ・組織」月4,980円、「タイトル追加」月500円(どれも毎月の定期支払い)
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
| `STRIPE_PRICE_GAME` | 「タイトル追加」の価格ID(月500円の定期支払い。数量=追加タイトル数) |
| `SITE_URL` | サイトのURL(例:`https://taclog.gg`) |

6. `assets/config.js` の `BILLING_ENABLED` を `true` にする

最初は Stripe の**テストモード**の鍵で試し、問題なければ本番の鍵に入れ替えます。

### 7. お問い合わせとDiscordの通知
1. Supabase の SQL Editor で `supabase/002_contact_and_reports.sql` を実行する
2. https://discord.com/developers/applications で「New Application」を作る(名前は TacLog など)
3. 左の「Bot」で「Reset Token」を押してトークンをコピーし、同じ画面の **Message Content Intent をオン** にして保存
4. 左の「OAuth2 → URL Generator」で、Scopes は `bot`、Bot Permissions は次の5つにチェックし、下に出たURLを開いて自分のサーバーに招待する
   `View Channels` / `Send Messages` / `Create Public Threads` / `Send Messages in Threads` / `Read Message History`
5. Discordの「ユーザー設定 → 詳細設定 → 開発者モード」をオンにし、「お問い合わせ」と「成果」のチャンネルを右クリック →「チャンネルIDをコピー」
6. Vercel の Environment Variables に追加して、もう一度 Deploy

| 名前 | 値 |
|---|---|
| `DISCORD_BOT_TOKEN` | Botのトークン(**秘密**) |
| `DISCORD_CONTACT_CHANNEL_ID` | 「お問い合わせ」チャンネルのID |
| `DISCORD_REPORT_CHANNEL_ID` | 「成果」チャンネルのID |
| `DISCORD_SIGNUP_CHANNEL_ID` | 「申し込み」チャンネルのID(有料プランの登録・変更・解約を通知) |
| `CRON_SECRET` | 長いランダムな文字列(月末報告の呼び出しを守る合言葉) |
| `MONTHLY_FIXED_COST_JPY` | 毎月の固定費(円)。ドメイン代やサーバー代など。例:`1500` |
| `USD_JPY` | ドル→円の換算レート。例:`155` |

**使い方**:問い合わせが来ると「お問い合わせ」チャンネルに投稿され、問い合わせごとにスレッドができます。スレッドに書き込むと、相手のアプリの「お問い合わせ」画面に返信として届きます(相手が画面を開いたとき、または1分ごとに取り込みます)。「!完了」と書き込むと対応済みになります。

### 8. 月末の成果報告
`vercel.json` の設定で、毎日23時(日本時間)に `/api/cron-monthly` が動き、**月の最終日だけ**「成果」チャンネルに次を投稿します。
申し込みチーム数(今月の増加・有料チーム数)/ 登録者数 / 売り上げ(Stripe)/ 出費(AIの利用量から計算した概算 + 決済手数料 + 固定費)/ 差額

すぐに試したいときは、次のように送ると、月末でなくても投稿されます(`CRON_SECRET` は自分で決めた値)。
```
curl -H "Authorization: Bearer (CRON_SECRET)" "https://taclog.app/api/cron-monthly?force=1"
```

### 9. ゲームタイトル
Supabase の SQL Editor で `supabase/003_games.sql` を実行してください。1つ目のタイトルは無料、2つ目から1タイトル月500円(コーチ・組織プランは全タイトル込み)。録画の自動分析は今のところ VALORANT だけで、ほかは「準備中」と表示されます。

## 料金プランと制限

**いまは試作期間なので、すべてのプランが無制限です。** 制限を戻すときは次の3つを行います。
1. Supabase の SQL Editor で `supabase/005_restore_limits.sql` を実行
2. `api/_lib.js` の `TRIAL_UNLIMITED` を `false` に
3. `assets/config.js` の `TRIAL_UNLIMITED` を `false` に


| | 無料 | チーム | コーチ・組織 |
|---|---|---|---|
| 録画の分析 | 月2本 | 無制限 | 無制限 |
| AIへの質問 | 月20回 | 月300回 | 無制限 |
| 見られるデータ | 直近14日 | 全期間 | 全期間 |
| メンバー | 3人 | 無制限 | 無制限 |

制限は `supabase/schema.sql` の `plan_limits` と `api/_lib.js` の `PLAN_LIMITS` で変えられます。

## まだ作っていないもの
- お知らせの送信(設定の保存までは動きます)
- お問い合わせの返信が届いたときの、メールでの通知
- Riotアカウント連携(Riot の承認後に追加)
- Googleドライブ・YouTubeチャンネル連携
- 公開前に、`legal/` の下書きの [ ] の部分を埋めて、内容を確認してください

## 広告(アフィリエイト)
`assets/ads.js` の `ITEMS` に、A8.net・もしもアフィリエイトで作ったリンクを1行ずつ足すと、次の場所に「PR」つきで表示されます(リンクがないあいだは何も表示されません)。
- トップページの下、OBSガイドの「録画すると重い・カクつくとき」、ダッシュボードの下(無料プランのチームだけ)、`/gear`(おすすめ機材のページ)

```js
{ cat: "pc", title: "ゲーミングPC ○○", note: "配信しながら録画しても軽い", url: "https://px.a8.net/...", pixel: "https://www10.a8.net/0.gif?..." },
```
`cat` は pc / capture / mic / camera / mouse / keyboard / headset / monitor / net のどれか。

## テスター用の招待コード(お金なしで有料プランを使ってもらう)
1. Supabase の SQL Editor で `supabase/006_promo_codes.sql` を実行(最初の1回だけ)
2. コードを作る(例:チームプランを3か月、10チームまで使えるコード)
```sql
insert into promo_codes (code, plan, months, max_uses, note) values ('TACLOG-TESTER', 'team', 3, 10, '知り合いのテスター用');
```
3. チームの管理者が、アプリの「設定 → チーム → プラン」の欄に入れて「コードを使う」を押す
期限が来ると、毎晩の自動処理で無料プランに戻ります。使われた数は `select * from promo_codes;` で見られます。
