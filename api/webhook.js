// POST /api/webhook  (Stripe -> TacLog). Keeps teams.plan in sync with the subscription.
const { send, fail, readRaw, rest, stripe, verifyStripe, discord, env } = require("./_lib");
const PLAN_JA = { free: "無料", team: "チーム(月2,980円)", org: "コーチ・組織(月6,980円〜)" };

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

const VALID = ["valorant", "ow2"];
// One subscription can hold a plan item (team/org) and a title add-on item (quantity = extra titles).
function readSub(sub) {
  const live = sub && ["active", "trialing", "past_due"].includes(sub.status);
  let plan = "free", extra = 0;
  for (const it of (live && sub.items && sub.items.data) || []) {
    const p = it.price && it.price.id;
    if (p === env("STRIPE_PRICE_ORG")) plan = "org";
    else if (p === env("STRIPE_PRICE_TEAM") && plan !== "org") plan = "team";
    else if (p === env("STRIPE_PRICE_GAME")) extra = it.quantity || 0;
  }
  return { live, plan, extra };
}
async function applySub(sub) {
  const teamId = sub.metadata && sub.metadata.team_id;
  const { live, plan, extra } = readSub(sub);
  const q = teamId && /^[0-9a-f-]{36}$/i.test(teamId) ? "teams?id=eq." + teamId : "teams?stripe_customer_id=eq." + encodeURIComponent(sub.customer);
  const before = await rest(q.replace("teams?", "teams?select=name,plan,games&"), { service: true });
  const cur = before && before[0];
  let games = cur ? cur.games || ["valorant"] : ["valorant"];
  const wanted = String((sub.metadata && sub.metadata.games) || "").split(",").filter((g) => VALID.includes(g));
  if (live && wanted.length) games = [...new Set(wanted)];
  const allowed = plan === "org" ? 99 : 1 + extra;
  games = games.slice(0, Math.max(1, allowed));
  await rest(q, { method: "PATCH", service: true, body: { plan, extra_games: extra, games, stripe_subscription_id: live ? sub.id : null } });
  // teams added under an organization follow it (back to free when the organization stops)
  try { const ids = await rest(q.replace("teams?", "teams?select=id&"), { service: true }) || []; for (const t of ids) await rest("teams?parent_team=eq." + t.id, { method: "PATCH", service: true, body: { plan: plan === "org" ? "org" : "free" } }); } catch (e) {}
  if (cur) await notify(cur, cur.plan, plan);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return fail(res, 405, "POST only");
  let raw;
  try { raw = await readRaw(req); } catch (e) { return fail(res, 400, "bad body"); }
  if (!(await verifyStripe(raw, req.headers["stripe-signature"], env("STRIPE_WEBHOOK_SECRET")))) return fail(res, 400, "invalid signature");
  try {
    const ev = JSON.parse(raw);
    const o = ev.data && ev.data.object;
    if (ev.type === "checkout.session.completed" && o.subscription) await applySub(await stripe("subscriptions/" + o.subscription, null, "GET"));
    else if (ev.type === "customer.subscription.created" || ev.type === "customer.subscription.updated" || ev.type === "customer.subscription.deleted") await applySub(o);
    send(res, 200, { received: true });
  } catch (e) { fail(res, 500, "webhook error"); }
};
module.exports.config = { api: { bodyParser: false } };
