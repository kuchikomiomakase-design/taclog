// 公開してよい設定だけをここに書きます(秘密の鍵は絶対に書かないこと)。
// Supabase の「Project Settings → API」にある値を入れてください。
window.TACLOG_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-ANON-PUBLIC-KEY",
  // Riot の承認が下りて、Stripe の本番設定が終わったら true にします。
  BILLING_ENABLED: false
};
