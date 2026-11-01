// GET /api/diag?secret=CRON_SECRET  ->  checks the server settings without showing any secret values.
// Use it when something (Discord, database, AI) silently does not work.
const { send, fail, rest, discord, env } = require("./_lib");

module.exports = async (req, res) => {
  const secret = env("CRON_SECRET");
  const url = new URL(req.url, "http://x");
  if (!secret || (req.headers.authorization !== "Bearer " + secret && url.searchParams.get("secret") !== secret)) return fail(res, 401, "unauthorized");
  const out = {};
  const names = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY", "DISCORD_BOT_TOKEN", "DISCORD_CONTACT_CHANNEL_ID", "DISCORD_REPORT_CHANNEL_ID", "DISCORD_SIGNUP_CHANNEL_ID", "CRON_SECRET", "USD_JPY", "MONTHLY_FIXED_COST_JPY"];
  out.settings = Object.fromEntries(names.map((n) => { const v = env(n); return [n, v ? (v !== v.trim() ? "入っている(前後に空白あり!)" : "入っている(" + v.length + "文字)") : "未設定"]; }));
  try { await rest("teams?select=id&limit=1", { service: true }); out.database = "OK"; } catch (e) { out.database = "NG: " + e.message; }
  try { const me = await discord("users/@me"); out.discord_bot = "OK (" + me.username + ")"; } catch (e) { out.discord_bot = "NG: " + e.message; }
  for (const [label, n] of [["contact", "DISCORD_CONTACT_CHANNEL_ID"], ["report", "DISCORD_REPORT_CHANNEL_ID"], ["signup", "DISCORD_SIGNUP_CHANNEL_ID"]]) {
    const id = String(env(n) || "").trim();
    if (!/^\d{15,22}$/.test(id)) { out["channel_" + label] = id ? "NG: 数字のチャンネルIDではありません" : "未設定"; continue; }
    try { const c = await discord("channels/" + id); out["channel_" + label] = "OK (#" + c.name + ")"; } catch (e) { out["channel_" + label] = "NG: " + e.message + "(BOTがそのチャンネルを見られない/IDが違う)"; }
  }
  if (url.searchParams.get("test") === "1") {   // actually post (and make a thread) in the contact channel, like a real inquiry
    const id = String(env("DISCORD_CONTACT_CHANNEL_ID") || "").trim();
    try {
      const m = await discord("channels/" + id + "/messages", { method: "POST", body: { content: "🔧 TacLog 接続テスト(このメッセージは消してOKです)", allowed_mentions: { parse: [] } } });
      out.test_post = "OK";
      try { await discord("channels/" + id + "/messages/" + m.id + "/threads", { method: "POST", body: { name: "接続テスト", auto_archive_duration: 60 } }); out.test_thread = "OK"; }
      catch (e) { out.test_thread = "NG: " + e.message + "(BOTに「公開スレッドの作成」の権限がない可能性)"; }
    } catch (e) { out.test_post = "NG: " + e.message + "(BOTに「メッセージを送信」の権限がない可能性)"; }
  }
  send(res, 200, out);
};
