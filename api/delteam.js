// POST /api/delteam {teamId, confirmName} -> {ok, next}
// Deletes a team and everything in it (matches, views, members, question history). Admin only, and the team name must be typed again.
//  - The plan and its payment are not changed (a warning is shown before deleting).
//  - A team added under an organization: the organization's "extra team" count goes down (prorated).
//  - An organization's first team: the teams added under it go back to the free plan.
const { send, fail, readBody, getUser, membership, rest, stripe, env } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method !== "POST") return fail(res, 405, "POST only");
  try {
    const auth = await getUser(req); if (!auth) return fail(res, 401, "ログインしてください。");
    const body = await readBody(req);
    const m = await membership(body.teamId, auth);
    if (!m || m.role !== "admin") return fail(res, 403, "チームを削除できるのは、チームの管理者だけです。");
    const rows = await rest("teams?select=id,name,plan,stripe_subscription_id,parent_team&id=eq." + body.teamId, { service: true });
    const t = rows && rows[0]; if (!t) return fail(res, 404, "チームが見つかりません。");
    if (String(body.confirmName || "").trim() !== String(t.name).trim()) return fail(res, 400, "確認のチーム名が違います。");
    // Deleting does not change the plan or the payment (people sometimes just want to start over). Teams added under this
    // organization lose the organization plan with it (back to free), so nothing stays paid-for without a payment.
    await rest("teams?parent_team=eq." + t.id, { method: "PATCH", service: true, body: { plan: "free", parent_team: null } }).catch(() => {});

    if (t.parent_team) {   // organization's added team: lower the extra-team count on its subscription
      const p = await rest("teams?select=id,stripe_subscription_id&id=eq." + t.parent_team, { service: true });
      const root = p && p[0], price = env("STRIPE_PRICE_EXTRA_TEAM");
      if (root && root.stripe_subscription_id && price && env("STRIPE_SECRET_KEY")) {
        const fam = await rest("teams?select=id&or=(id.eq." + root.id + ",parent_team.eq." + root.id + ")", { service: true }) || [];
        const qty = Math.max(0, fam.length - 1 - 2);
        const sub = await stripe("subscriptions/" + root.stripe_subscription_id, null, "GET");
        const item = (sub.items.data || []).find((it) => it.price.id === price);
        if (item) { if (qty === 0) await stripe("subscription_items/" + item.id, { proration_behavior: "create_prorations" }, "DELETE"); else await stripe("subscription_items/" + item.id, { quantity: qty, proration_behavior: "create_prorations" }); }
      }
    }
    await rest("teams?id=eq." + t.id, { method: "DELETE", service: true });
    const left = await rest("team_members?select=team_id&user_id=eq." + auth.user.id, { service: true }) || [];
    send(res, 200, { ok: true, next: left.length ? left[0].team_id : null });
  } catch (e) { fail(res, e.status || 500, e.status ? e.message : "チームを削除できませんでした。"); }
};
