// GET /api/cron-monthly   (run by Vercel Cron every day at 23:00 JST; posts only on the last day of the month)
// Posts this month's results to the Discord "成果" channel: teams, sign-ups, revenue, costs and the difference.
// Manual test: open /api/cron-monthly?force=1&secret=<CRON_SECRET> in a browser
const { send, fail, rest, stripe, discord, env, serviceHeaders } = require("./_lib");

const yen = (n) => "¥" + Math.round(n || 0).toLocaleString("ja-JP");
const JST = 9 * 3600e3;

function monthRange(now) {
  const j = new Date(now.getTime() + JST);                    // JST wall clock in UTC fields
  const y = j.getUTCFullYear(), m = j.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1) - JST), end = new Date(Date.UTC(y, m + 1, 1) - JST);
  const tomorrow = new Date(j.getTime() + 864e5);
  return { start, end, label: y + "年" + (m + 1) + "月", lastDay: tomorrow.getUTCDate() === 1 };
}

async function countUsers(start) {
  let page = 1, total = 0, fresh = 0;
  while (page < 50) {
    const r = await fetch(env("SUPABASE_URL") + "/auth/v1/admin/users?page=" + page + "&per_page=1000", { headers: serviceHeaders() });
    if (!r.ok) break;
    const d = await r.json(), users = d.users || [];
    total += users.length; fresh += users.filter((u) => new Date(u.created_at) >= start).length;
    if (users.length < 1000) break; page++;
  }
  return { total, fresh };
}

async function stripeMonth(start, end) {
  if (!env("STRIPE_SECRET_KEY")) return { revenue: 0, fees: 0, configured: false };
  let revenue = 0, fees = 0, after = null;
  for (let i = 0; i < 20; i++) {
    const q = "balance_transactions?limit=100&created[gte]=" + Math.floor(start / 1000) + "&created[lt]=" + Math.floor(end / 1000) + (after ? "&starting_after=" + after : "");
    const d = await stripe(q, null, "GET");
    for (const t of d.data || []) {
      if (!["charge", "payment", "refund", "payment_refund"].includes(t.type)) continue;
      const k = t.currency === "jpy" ? 1 : 0.01 * Number(env("USD_JPY", "155")); // non-JPY amounts are in cents
      revenue += t.amount * k; fees += t.fee * k;
    }
    if (!d.has_more || !d.data.length) break; after = d.data[d.data.length - 1].id;
  }
  return { revenue, fees, configured: true };
}

module.exports = async (req, res) => {
  const secret = env("CRON_SECRET");
  const url = new URL(req.url, "http://x");
  // The daily GitHub Actions job sends the secret in the Authorization header; a manual test can pass ?secret=... in the browser.
  if (!secret || (req.headers.authorization !== "Bearer " + secret && url.searchParams.get("secret") !== secret)) return fail(res, 401, "unauthorized");
  try {
    const force = url.searchParams.get("force") === "1";
    await rest("teams?select=id&limit=1", { service: true }); // daily touch so the free database is never paused for inactivity
    // tester plans that reached their end date go back to free (teams paying through Stripe are left alone)
    try { await rest("teams?comp_until=lt." + new Date().toISOString() + "&stripe_subscription_id=is.null&plan=neq.free", { method: "PATCH", service: true, body: { plan: "free", comp_until: null } }); } catch (e) {}
    const { start, end, label, lastDay } = monthRange(new Date());
    if (!lastDay && !force) return send(res, 200, { skipped: "not the last day of the month" });

    const teams = await rest("teams?select=id,plan,created_at", { service: true }) || [];
    const newTeams = teams.filter((t) => new Date(t.created_at) >= start).length;
    const paid = teams.filter((t) => t.plan !== "free");
    const users = await countUsers(start);
    const ai = await rest("ai_usage?select=cost_usd&created_at=gte." + start.toISOString() + "&created_at=lt." + end.toISOString(), { service: true }) || [];
    const aiYen = ai.reduce((a, r) => a + Number(r.cost_usd || 0), 0) * Number(env("USD_JPY", "155"));
    const st = await stripeMonth(start, end);
    const fixed = Number(env("MONTHLY_FIXED_COST_JPY", "0"));
    const cost = aiYen + st.fees + fixed, diff = st.revenue - cost;

    const ch = env("DISCORD_REPORT_CHANNEL_ID");
    if (!ch) return fail(res, 503, "DISCORD_REPORT_CHANNEL_ID が入っていません。");
    await discord("channels/" + ch + "/messages", { method: "POST", body: {
      allowed_mentions: { parse: [] },
      content: "📊 **" + label + "の成果**",
      embeds: [{ color: diff >= 0 ? 0x1B7A4E : 0xC2413A, fields: [
        { name: "申し込みチーム数", value: teams.length + "チーム(今月 +" + newTeams + ")\n有料:" + paid.length + "チーム(チーム " + paid.filter((t) => t.plan === "team").length + " / 組織 " + paid.filter((t) => t.plan === "org").length + ")", inline: true },
        { name: "登録者数", value: users.total + "人(今月 +" + users.fresh + ")", inline: true },
        { name: "売り上げ", value: st.configured ? yen(st.revenue) : "決済の設定前", inline: true },
        { name: "出費", value: yen(cost) + "\nAI " + yen(aiYen) + " / 決済手数料 " + yen(st.fees) + " / 固定費 " + yen(fixed), inline: false },
        { name: "差額", value: (diff >= 0 ? "+" : "") + yen(diff), inline: true }
      ], footer: { text: "AIの出費は使用量からの概算(1ドル=" + env("USD_JPY", "155") + "円で計算)" }, timestamp: new Date().toISOString() }]
    } });
    send(res, 200, { posted: true, label });
  } catch (e) { fail(res, 500, "report failed: " + (e.message || "")); }
};
