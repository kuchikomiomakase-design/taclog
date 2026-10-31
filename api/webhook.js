// POST /api/webhook  (Stripe -> TacLog). Keeps teams.plan in sync with the subscription.
const { send, fail, readRaw, rest, stripe, verifyStripe, discord, env } = require("./_lib");
const PLAN_JA = { free: "無料", team: "チーム(月1,980円)", org: "コーチ・組織(月4,980円〜)" };

// Tells the Discord "申し込み" channel when a team starts, changes or cancels a paid plan.
async function notify(team, before, after) {
  const ch = env("DISCORD_SIGNUP_CHANNEL_ID"); if (!ch || before === after) return;
  const title = before === "free" ? "🎉 有料プランに登録されました" : after === "free" ? "👋 有料プランが解約されました" : "🔁 プランが変更されました";
  await discord("channels/" + ch + "/messages", { method: "POST", body: {
    allowed_mentions: { parse: [] }, content: title,
    embeds: [{ color: after === "free" ? 0x8A9794 : 0xF08A24, fields: [
      { name: "チーム", value: String(team.name || "-").slice(0, 100), inline: true },
      { name: "プラン", value: PLAN_JA[before] + " → " + PLAN_JA[after], inline: true }
    ], timestamp: new Date().toISOString() }] } }).catch(() => {});
}

function planFromSub(sub) {
  if (!sub || !["active", "trialing", "past_due"].includes(sub.status)) return "free";
  const price = sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price && sub.items.data[0].price.id;
  if (price && price === env("STRIPE_PRICE_ORG")) return "org";
  if (price && price === env("STRIPE_PRICE_TEAM")) return "team";
  return "free";
}
async function applySub(sub) {
  const teamId = sub.metadata && sub.metadata.team_id;
  const plan = planFromSub(sub);
  const q = teamId && /^[0-9a-f-]{36}$/i.test(teamId) ? "teams?id=eq." + teamId : "teams?stripe_customer_id=eq." + encodeURIComponent(sub.customer);
  const before = await rest(q.replace("teams?", "teams?select=name,plan&"), { service: true });
  await rest(q, { method: "PATCH", service: true, body: { plan, stripe_subscription_id: plan === "free" ? null : sub.id } });
  if (before && before[0]) await notify(before[0], before[0].plan, plan);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return fail(res, 405, "POST only");
  let raw;
  try { raw = await readRaw(req); } catch (e) { return fail(res, 400, "bad body"); }
  if (!verifyStripe(raw, req.headers["stripe-signature"], env("STRIPE_WEBHOOK_SECRET"))) return fail(res, 400, "invalid signature");
  try {
    const ev = JSON.parse(raw);
    const o = ev.data && ev.data.object;
    if (ev.type === "checkout.session.completed" && o.subscription) await applySub(await stripe("subscriptions/" + o.subscription, null, "GET"));
    else if (ev.type === "customer.subscription.created" || ev.type === "customer.subscription.updated" || ev.type === "customer.subscription.deleted") await applySub(o);
    send(res, 200, { received: true });
  } catch (e) { fail(res, 500, "webhook error"); }
};
module.exports.config = { api: { bodyParser: false } };
