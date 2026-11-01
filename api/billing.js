// POST /api/billing  — the person's payments, not tied to one team (so a plan of a deleted team can still be cancelled)
//   {action:"list"}                 -> {subs:[{id, status, cancelAt, periodEnd, items:[{name, yen, qty}], team}]}
//   {action:"cancel", sub}          -> {ok}   (stops at the end of the paid month; no refund of the current month)
//   {action:"resume", sub}          -> {ok}
//   {action:"portal", customer}     -> {url}  (Stripe page: card, receipts)
// Customers are found by the login email (TacLog creates them with it).
const { send, fail, readBody, getUser, rest, stripe, env } = require("./_lib");

// the person's Stripe customers: by login email, by their user id (saved on new customers), and those of teams they manage
// (so a changed email on the Stripe page does not hide a payment)
async function myCustomers(user) {
  const ids = new Set();
  if (user.email) { const r = await stripe("customers?limit=20&email=" + encodeURIComponent(user.email), null, "GET"); (r.data || []).forEach((c) => ids.add(c.id)); }
  try { const r = await stripe("customers/search?limit=20&query=" + encodeURIComponent("metadata['user_id']:'" + user.id + "'"), null, "GET"); (r.data || []).forEach((c) => ids.add(c.id)); } catch (e) {}
  try { const t = await rest("team_members?select=teams(stripe_customer_id)&role=eq.admin&user_id=eq." + user.id, { service: true }) || []; t.forEach((x) => x.teams && x.teams.stripe_customer_id && ids.add(x.teams.stripe_customer_id)); } catch (e) {}
  return [...ids];
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return fail(res, 405, "POST only");
  try {
    const auth = await getUser(req); if (!auth) return fail(res, 401, "ログインしてください。");
    const body = await readBody(req);
    if (!env("STRIPE_SECRET_KEY")) return send(res, 200, { subs: [], off: true });
    const custs = await myCustomers(auth.user);
    if (body.action === "list") {
      const subs = [];
      for (const c of custs) {
        const r = await stripe("subscriptions?status=all&limit=20&customer=" + c + "&expand[]=data.items.data.price.product", null, "GET");
        for (const s of r.data || []) {
          if (["canceled", "incomplete_expired"].includes(s.status)) continue;
          const tid = s.metadata && s.metadata.team_id; let team = null;
          if (tid && /^[0-9a-f-]{36}$/i.test(tid)) { const t = await rest("teams?select=name&id=eq." + tid, { service: true }); team = t && t[0] ? t[0].name : "(削除したチーム)"; }
          subs.push({ id: s.id, customer: c, status: s.status, cancelAt: s.cancel_at_period_end ? s.current_period_end : null, periodEnd: s.current_period_end, team,
            items: (s.items.data || []).map((it) => ({ name: (it.price.product && it.price.product.name) || it.price.nickname || "プラン", yen: it.price.unit_amount, qty: it.quantity || 1 })) });
        }
      }
      return send(res, 200, { subs });
    }
    if (body.action === "cancel" || body.action === "resume") {
      const s = await stripe("subscriptions/" + encodeURIComponent(String(body.sub || "")), null, "GET");
      if (!custs.includes(s.customer)) return fail(res, 403, "このお支払いは操作できません。");
      await stripe("subscriptions/" + s.id, { cancel_at_period_end: body.action === "cancel" ? "true" : "false" });
      return send(res, 200, { ok: true });
    }
    if (body.action === "portal") {
      if (!custs.includes(body.customer)) return fail(res, 403, "このお支払いは操作できません。");
      const site = env("SITE_URL", "https://" + req.headers.host);
      const p = await stripe("billing_portal/sessions", { customer: body.customer, return_url: site + "/billing", locale: "ja" });
      return send(res, 200, { url: p.url });
    }
    fail(res, 400, "bad action");
  } catch (e) { fail(res, e.status || 500, e.status ? e.message : "お支払いの情報を読み込めませんでした。"); }
};
