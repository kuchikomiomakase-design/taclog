// 公開してよい設定だけをここに書きます(秘密の鍵は絶対に書かないこと)。
// Supabase の「Project Settings → API」にある値を入れてください。
window.TACLOG_CONFIG = {
  SUPABASE_URL: "https://galkaartnzotypwxcgpg.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdhbGthYXJ0bnpvdHlwd3hjZ3BnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM0NTc2ODYsImV4cCI6MjEwOTAzMzY4Nn0.8hKoXNnHBxcb7eWBHXDpPJ_7-NdeU2wMQL9yahPNoPM",
  // Riot の承認が下りて、Stripe の本番設定が終わったら true にします。
  BILLING_ENABLED: false,
  // 試作期間中は無料プランも無制限(表示用)。制限を戻すときは false に
  TRIAL_UNLIMITED: true,
  // Supabase で Google ログインを設定したら true にします(README の手順5)。
  GOOGLE_LOGIN_ENABLED: false
};
