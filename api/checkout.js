// POST /api/checkout {teamId, plan:"team"|"org"} -> {url}   (Stripe Checkout, monthly subscription)
const { send, fail, readBody, getUser, membership, rest, stripe, env } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method !== "POST") return fail(res, 405, "POST only");
  try {
    const auth = await getUser(req); if (!auth) return fail(res, 401, "ログインしてください。");
    const body = await readBody(req);
    const m = await membership(body.teamId, auth);
    if (!m || m.role !== "admin") return fail(res, 403, "プランの変更は、チームの管理者だけができます。");
    const price = body.plan === "org" ? env("STRIPE_PRICE_ORG") : env("STRIPE_PRICE_TEAM");
    if (!price) return fail(res, 503, "料金の設定がまだ入っていません。");
    let customer = m.teams && m.teams.stripe_customer_id;
    if (!customer) {
      const c = await stripe("customers", { email: auth.user.email, metadata: { team_id: body.teamId } });
      customer = c.id;
      await rest("teams?id=eq." + body.teamId, { method: "PATCH", service: true, body: { stripe_customer_id: customer } });
    }
    const site = env("SITE_URL", "https://" + req.headers.host);
    // Already paying for title add-ons: add the plan to the same subscription instead of starting a second one.
    const subId = m.teams && m.teams.stripe_subscription_id;
    if (subId) {
      const sub = await stripe("subscriptions/" + subId, null, "GET");
      const planItem = (sub.items.data || []).find((it) => [env("STRIPE_PRICE_TEAM"), env("STRIPE_PRICE_ORG")].includes(it.price.id));
      if (planItem) await stripe("subscription_items/" + planItem.id, { price, proration_behavior: "create_prorations" });
      else await stripe("subscription_items", { subscription: subId, price, quantity: 1, proration_behavior: "create_prorations" });
      return send(res, 200, { url: site + "/app?billing=success#settings" });
    }
    const s = await stripe("checkout/sessions", {
      mode: "subscription", customer, client_reference_id: body.teamId, locale: "ja", allow_promotion_codes: "true",
      line_items: { 0: { price, quantity: 1 } },
      subscription_data: { metadata: { team_id: body.teamId } },
      metadata: { team_id: body.teamId },
      success_url: site + "/app?billing=success#settings", cancel_url: site + "/app#settings"
    });
    send(res, 200, { url: s.url });
  } catch (e) { fail(res, e.status || 500, e.status ? e.message : "決済画面を開けませんでした。"); }
};
