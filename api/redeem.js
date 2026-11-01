// POST /api/redeem {teamId, code} -> gives the team a paid plan for free until a date (tester / invite codes; no payment).
const { send, fail, readBody, getUser, membership, rest } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method !== "POST") return fail(res, 405, "POST only");
  try {
    const auth = await getUser(req); if (!auth) return fail(res, 401, "ログインしてください。");
    const body = await readBody(req);
    const m = await membership(body.teamId, auth); if (!m) return fail(res, 403, "このチームのメンバーではありません。");
    if (m.role !== "admin") return fail(res, 403, "コードを使えるのは、チームの管理者だけです。");
    const code = String(body.code || "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 40);
    if (!/^[A-Z0-9-]{4,40}$/.test(code)) return fail(res, 400, "コードの形が正しくありません。");
    const rows = await rest("promo_codes?select=*&code=eq." + encodeURIComponent(code), { service: true });
    const pc = rows && rows[0];
    if (!pc) return fail(res, 404, "このコードは見つかりません。");
    if (pc.used >= pc.max_uses) return fail(res, 410, "このコードは、もう使われています。");
    const already = await rest("promo_redemptions?select=id&code=eq." + encodeURIComponent(code) + "&team_id=eq." + body.teamId, { service: true });
    if (already && already.length) return fail(res, 409, "このチームでは、もうこのコードを使っています。");
    const t = m.teams || {};
    if (t.stripe_subscription_id) return fail(res, 409, "すでに有料プランを契約中です。");
    // take one use (only if still available, so two people cannot use the last one at the same time)
    const took = await rest("promo_codes?code=eq." + encodeURIComponent(code) + "&used=lt." + pc.max_uses, { method: "PATCH", service: true, prefer: "return=representation", body: { used: pc.used + 1 } });
    if (!took || !took.length) return fail(res, 410, "このコードは、もう使われています。");
    const until = new Date(); until.setMonth(until.getMonth() + pc.months);
    await rest("teams?id=eq." + body.teamId, { method: "PATCH", service: true, body: { plan: pc.plan, comp_until: until.toISOString() } });
    await rest("promo_redemptions", { method: "POST", service: true, body: { code, team_id: body.teamId, user_id: auth.user.id } });
    send(res, 200, { plan: pc.plan, until: until.toISOString() });
  } catch (e) {
    fail(res, e.status || 500, e.status ? e.message : "コードを使えませんでした。もう一度試してください。");
  }
};
