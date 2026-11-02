// POST /api/addteam {teamId, name, myName, game, kind}
// Adds a team without going through the first-time setup again (recording settings and Riot are already done).
//  - kind "solo": the person's own space (one per person), free until they choose the personal plan.
//  - kind "team": only for admins of a coach/organization team. 2 teams are included; from the 3rd, 2,480 yen a month each
//    (added to the organization's Stripe subscription, STRIPE_PRICE_EXTRA_TEAM). Teams set up by hand (no subscription) are not charged.
const { send, fail, readBody, getUser, membership, rest, stripe, env } = require("./_lib");
const VALID = ["valorant", "cs2", "ow2", "apex", "fortnite"];
const clip = (s, n) => String(s || "").trim().slice(0, n);

async function create(uid, row, myName) {
  const [t] = await rest("teams", { method: "POST", service: true, prefer: "return=representation", body: { ...row, created_by: uid } });
  await rest("team_members", { method: "POST", service: true, body: { team_id: t.id, user_id: uid, role: "admin", display_name: myName, can_stream: true } });
  await rest("notification_prefs", { method: "POST", service: true, body: { team_id: t.id, user_id: uid } }).catch(() => {});
  return t.id;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return fail(res, 405, "POST only");
  try {
    const auth = await getUser(req); if (!auth) return fail(res, 401, "ログインしてください。");
    const uid = auth.user.id, body = await readBody(req);
    const name = clip(body.name, 40), myName = clip(body.myName, 30), game = VALID.includes(body.game) ? body.game : "valorant";
    if (!myName) return fail(res, 400, "表示名を入れてください。");

    if (body.kind === "solo") {
      const mine = await rest("teams?select=id&kind=eq.solo&created_by=eq." + uid, { service: true });
      if (mine && mine.length) return fail(res, 400, "solo exists");
      const id = await create(uid, { name: (name || myName + "(個人)").slice(0, 40), games: [game], kind: "solo", plan: "free" }, myName);
      return send(res, 200, { teamId: id });
    }

    if (!name) return fail(res, 400, "チーム名を入れてください。");
    const m = await membership(body.teamId, auth);
    if (!m || m.role !== "admin" || !m.teams || m.teams.plan !== "org") return fail(res, 403, "org plan required");
    const parentRows = await rest("teams?select=id,parent_team,stripe_subscription_id,comp_until&id=eq." + body.teamId, { service: true });
    let root = parentRows && parentRows[0]; if (!root) return fail(res, 404, "チームが見つかりません。");
    if (root.parent_team) { const r = await rest("teams?select=id,parent_team,stripe_subscription_id,comp_until&id=eq." + root.parent_team, { service: true }); if (r && r[0]) root = r[0]; }
    const family = await rest("teams?select=id&or=(id.eq." + root.id + ",parent_team.eq." + root.id + ")", { service: true }) || [];
    if (family.length >= 10) return fail(res, 400, "team limit");
    const row = { name, games: [game], kind: "team", plan: "org", parent_team: root.id, comp_until: root.comp_until || null };

    // 2 teams included, or a hand-made organization (tester / owner): just add
    if (family.length < 2 || !root.stripe_subscription_id) { const id = await create(uid, row, myName); return send(res, 200, { teamId: id, extra: Math.max(0, family.length + 1 - 2), charged: false }); }

    // 3rd team and later: add 1 to the "extra team" item of the organization's subscription (prorated), then create the team
    const price = env("STRIPE_PRICE_EXTRA_TEAM");
    if (!price || !env("STRIPE_SECRET_KEY")) return fail(res, 503, "3チーム目からの追加(月2,480円)は、お支払いの準備中です。");
    if (!body.confirm) return send(res, 200, { needConfirm: true, extra: family.length + 1 - 2, yen: 2480 });
    const sub = await stripe("subscriptions/" + root.stripe_subscription_id, null, "GET");
    const item = (sub.items.data || []).find((it) => it.price.id === price), qty = family.length + 1 - 2;
    if (item) await stripe("subscription_items/" + item.id, { quantity: qty, proration_behavior: "create_prorations" });
    else await stripe("subscription_items", { subscription: sub.id, price, quantity: qty, proration_behavior: "create_prorations" });
    const id = await create(uid, row, myName);
    send(res, 200, { teamId: id, extra: qty, charged: true });
  } catch (e) { fail(res, e.status || 500, e.status ? e.message : "チームを追加できませんでした。"); }
};
