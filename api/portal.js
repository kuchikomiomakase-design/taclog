// POST /api/portal {teamId} -> {url}   (Stripe customer portal: change card, cancel)
const { send, fail, readBody, getUser, membership, stripe, env } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method !== "POST") return fail(res, 405, "POST only");
  try {
    const auth = await getUser(req); if (!auth) return fail(res, 401, "ログインしてください。");
    const body = await readBody(req);
    const m = await membership(body.teamId, auth);
    if (!m || m.role !== "admin") return fail(res, 403, "支払いの管理は、チームの管理者だけができます。");
    const customer = m.teams && m.teams.stripe_customer_id;
    if (!customer) return fail(res, 400, "まだ支払いの登録がありません。");
    const site = env("SITE_URL", "https://" + req.headers.host);
    const s = await stripe("billing_portal/sessions", { customer, return_url: site + "/app#settings", locale: "ja" });
    send(res, 200, { url: s.url });
  } catch (e) { fail(res, e.status || 500, e.status ? e.message : "管理画面を開けませんでした。"); }
};
